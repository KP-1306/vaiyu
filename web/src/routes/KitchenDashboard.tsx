import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { supa } from '../lib/api';

// Types
type OrderStatus = 'CREATED' | 'ACCEPTED' | 'PREPARING' | 'READY' | 'DELIVERED' | 'CANCELLED';

interface FoodOrderITEM {
    id: string;
    name: string;
    quantity: number;
    modifiers?: Record<string, any>;
}

interface FoodOrder {
    id: string;
    display_id?: string; // New field
    hotel_id: string;
    room_id: string | null;
    stay_id: string;
    status: OrderStatus;
    total_amount: number;
    created_at: string;
    updated_at: string;
    items: FoodOrderITEM[];
    assignments?: { hotel_member_id: string; role: string }[];
    assigned_runner_name?: string;
    sla?: {
        sla_target_at: string;
        breached: boolean;
    };
    room_number?: string;
    special_instructions?: string;
}

// Helper: Play a simple notification sound (Success/Chime)
const playNotificationSound = () => {
    try {
        const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioContext) return;

        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.connect(gain);
        gain.connect(ctx.destination);

        // Nice "Ding" sound
        osc.type = 'sine';
        osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
        osc.frequency.exponentialRampToValueAtTime(130.81, ctx.currentTime + 0.5); // Drop to C3

        gain.gain.setValueAtTime(0.5, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);

        osc.start();
        osc.stop(ctx.currentTime + 0.5);
    } catch (e) {
        console.error("Audio play failed", e);
    }
};

export default function KitchenDashboard() {
    // Fix: Handle UTC timestamps correctly. If 'Z' or offset is missing, append 'Z' to treat as UTC.
    const safeDate = (dateStr: string) => {
        if (!dateStr) return new Date();
        if (dateStr.endsWith('Z') || dateStr.includes('+')) return new Date(dateStr);
        return new Date(dateStr + 'Z');
    };

    const [orders, setOrders] = useState<FoodOrder[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [alarmActive, setAlarmActive] = useState(false); // [NEW] Alarm state
    const alarmRef = React.useRef<NodeJS.Timeout | null>(null);

    // Stop alarm on any interaction
    const stopAlarm = () => {
        if (alarmRef.current) {
            clearInterval(alarmRef.current);
            alarmRef.current = null;
        }
        setAlarmActive(false);
    };

    // Global click listener to stop alarm (like "ack" button)
    useEffect(() => {
        const handleInteraction = () => {
            if (alarmActive) stopAlarm();
        };
        window.addEventListener('click', handleInteraction);
        return () => window.removeEventListener('click', handleInteraction);
    }, [alarmActive]);
    const [activeKitchenTab, setActiveKitchenTab] = useState<'NEW' | 'ACCEPTED' | 'PREPARING'>('NEW');
    const [activeRunnerTab, setActiveRunnerTab] = useState<'READY' | 'DELIVERED'>('READY');
    const [userId, setUserId] = useState<string | null>(null);
    const [hotelMemberIds, setHotelMemberIds] = useState<string[]>([]);

    // Fetch User
    useEffect(() => {
        supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id || null));
    }, []);

    // Fetch Orders
    const fetchOrders = useCallback(async () => {
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;
            setUserId(user.id);

            const client = supa() || supabase;

            // 1. Kitchen Queue
            const { data: kQueue, error: kErr } = await client
                .from('v_kitchen_queue')
                .select('*')
                .order('created_at', { ascending: true });

            if (kErr) throw kErr;

            // 2. Runner Queue
            const { data: rQueue, error: rErr } = await client
                .from('v_runner_queue')
                .select('*')
                .order('updated_at', { ascending: true });

            if (rErr) throw rErr;


            // 2b. Fetch Hotel Member ID (Context)
            // We need this to filter "My Orders" correctly now that schema uses member_id
            const { data: memberData, error: memError } = await client
                .from('hotel_members')
                .select('id')
                .eq('user_id', user.id);

            // Handle array of memberships
            const memberIds = memberData?.map((m: any) => m.id) || [];
            console.log("DEBUG: Found Member IDs:", memberIds);
            setHotelMemberIds(memberIds);

            // 3. My Orders
            let mQueue: any[] = [];
            if (memberIds.length > 0) {
                const { data: mData, error: mErr } = await client
                    .from('v_my_food_orders')
                    .select('*')
                    .in('hotel_member_id', memberIds);

                if (mErr) throw mErr;
                mQueue = mData || [];
            }

            // 4. SLA Risks (Optional for main list, but good for alerts)
            const { data: sQueue, error: sErr } = await client
                .from('v_food_orders_sla_risk')
                .select('*')
                .order('minutes_to_breach', { ascending: true });

            if (sErr) throw sErr;

            // Helper to map view row to FoodOrder shape
            const mapToOrder = (row: any, source: string): FoodOrder => {
                const assignments: { hotel_member_id: string; role: string }[] = [];

                // 1. From v_my_food_orders (Direct assignment columns)
                if (row.hotel_member_id && row.role) {
                    assignments.push({ hotel_member_id: row.hotel_member_id, role: row.role });
                }
                // 2. From v_runner_queue (Specific alias)
                else if (row.assigned_runner) {
                    assignments.push({ hotel_member_id: row.assigned_runner, role: 'RUNNER' });
                }
                // 3. From v_kitchen_queue (Specific alias)
                else if (row.assigned_kitchen_staff) {
                    assignments.push({ hotel_member_id: row.assigned_kitchen_staff, role: 'KITCHEN' });
                }

                return {
                    id: row.order_id,
                    display_id: row.display_id, // Map from view
                    hotel_id: row.hotel_id || '',
                    room_id: row.room_id,
                    room_number: row.room_number,
                    stay_id: '',
                    status: row.status,
                    total_amount: row.total_amount || 0,
                    created_at: row.created_at || new Date().toISOString(),
                    updated_at: row.updated_at || new Date().toISOString(),
                    items: row.items || [],
                    assignments: assignments,
                    sla: {
                        sla_target_at: row.sla_target_at,
                        breached: row.sla_minutes_remaining ? row.sla_minutes_remaining < 0 : false
                    },
                    special_instructions: row.special_instructions,
                    assigned_runner_name: row.assigned_runner_name // Map from view
                };
            };

            const allOrdersMap = new Map<string, FoodOrder>();

            kQueue?.forEach((r: any) => allOrdersMap.set(r.order_id, mapToOrder(r, 'kitchen')));
            rQueue?.forEach((r: any) => allOrdersMap.set(r.order_id, mapToOrder(r, 'runner')));
            mQueue?.forEach((r: any) => {
                if (!allOrdersMap.has(r.order_id)) {
                    allOrdersMap.set(r.order_id, mapToOrder(r, 'my'));
                }
            });

            setOrders(Array.from(allOrdersMap.values()));

        } catch (err: any) {
            console.error('Error fetching orders:', err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchOrders();

        // Realtime Subscription
        const channel = supabase
            .channel('kitchen-dashboard')
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'food_orders' },
                (payload) => {
                    if (payload.eventType === 'INSERT') {
                        // Start looping alarm
                        if (!alarmRef.current) {
                            playNotificationSound(); // Play once immediately
                            setAlarmActive(true);
                            alarmRef.current = setInterval(() => {
                                playNotificationSound();
                            }, 3000); // Loop every 3 seconds
                        }
                    }
                    fetchOrders();
                }
            )
            .subscribe();

        // [NEW] Live SLA Ticker: Force re-render every 15s to update "X min remaining"
        // We don't need to re-fetch, just re-calculate the time diffs in the render loop.
        const interval = setInterval(() => {
            setOrders(prev => [...prev]); // Trigger re-render with same data
        }, 15000);

        return () => {
            supabase.removeChannel(channel);
            clearInterval(interval);
        };
    }, [fetchOrders]);

    // Derived States
    const kitchenQueue = orders.filter(o => ['CREATED', 'ACCEPTED', 'PREPARING'].includes(o.status));
    const runnerQueue = orders.filter(o => ['READY', 'DELIVERED'].includes(o.status));

    // SLA Risks: Created long ago or SLA breach?
    const slaRisks = orders.filter(o => {
        if (['DELIVERED', 'CANCELLED'].includes(o.status)) return false;
        if (!o.sla?.sla_target_at) return false;
        return true;
    }).sort((a, b) => new Date(a.sla!.sla_target_at).getTime() - new Date(b.sla!.sla_target_at).getTime());

    const myOrders = orders.filter(o =>
        hotelMemberIds.length > 0 && o.assignments?.some(a => hotelMemberIds.includes(a.hotel_member_id)) &&
        !['CANCELLED'].includes(o.status)
    );


    // Actions
    const handleAction = async (action: string, orderId: string) => {
        try {
            const client = supa();
            if (!client) return;

            // Need hotel_id for RPCs. We'll grab from the order itself since we loaded it.
            const order = orders.find(o => o.id === orderId);
            if (!order) return;

            let rpcName = '';
            if (action === 'ACCEPT') rpcName = 'accept_food_order';
            if (action === 'PREPARE') rpcName = 'mark_food_order_preparing';
            if (action === 'READY') rpcName = 'mark_food_order_ready';
            if (action === 'DELIVER') rpcName = 'deliver_food_order';

            const { error } = await client.rpc(rpcName, {
                p_order_id: orderId,
                p_hotel_id: order.hotel_id
            });

            if (error) throw error;
            if (error) throw error;

            // Auto-switch tabs based on workflow
            if (action === 'ACCEPT') setActiveKitchenTab('ACCEPTED');
            if (action === 'PREPARE') setActiveKitchenTab('PREPARING');

            fetchOrders(); // Optimistic update would be better but simple reload works
        } catch (e: any) {
            alert(`Action failed: ${e.message}`);
        }
    };

    if (loading) return <div className="text-white p-10">Loading Kitchen Dashboard...</div>;

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-white p-6 font-sans">
            {alarmActive && (
                <div onClick={stopAlarm} className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm cursor-pointer animate-pulse">
                    <div className="bg-red-600 text-white px-8 py-6 rounded-2xl shadow-2xl border-4 border-white text-3xl font-bold uppercase tracking-widest flex flex-col items-center gap-4">
                        <span>🔔 New Order!</span>
                        <span className="text-sm font-normal normal-case opacity-80">(Click anywhere to acknowledge)</span>
                    </div>
                </div>
            )}
            <h1 className="text-2xl font-bold tracking-widest uppercase mb-8 text-gray-400">Kitchen & Runner Dashboard</h1>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

                {/* 1. KITCHEN QUEUE */}
                <div className="flex flex-col gap-4">
                    <div className="bg-[#1a1a1a] rounded-xl overflow-hidden border border-white/10">
                        <div className="bg-orange-600 px-4 py-3 font-bold text-white tracking-wide">Kitchen Queue</div>
                        <div className="flex p-2 bg-[#252525] gap-2">
                            {/* Tabs */}
                            <button onClick={() => setActiveKitchenTab('NEW')} className={`flex-1 py-1.5 rounded text-xs font-bold uppercase transition-colors ${activeKitchenTab === 'NEW' ? 'bg-orange-500 text-white' : 'text-gray-400 hover:bg-white/5'}`}>
                                New Orders ({kitchenQueue.filter(o => o.status === 'CREATED').length})
                            </button>
                            <button onClick={() => setActiveKitchenTab('ACCEPTED')} className={`flex-1 py-1.5 rounded text-xs font-bold uppercase transition-colors ${activeKitchenTab === 'ACCEPTED' ? 'bg-orange-500 text-white' : 'text-gray-400 hover:bg-white/5'}`}>
                                Accepted ({kitchenQueue.filter(o => o.status === 'ACCEPTED').length})
                            </button>
                            <button onClick={() => setActiveKitchenTab('PREPARING')} className={`flex-1 py-1.5 rounded text-xs font-bold uppercase transition-colors ${activeKitchenTab === 'PREPARING' ? 'bg-orange-500 text-white' : 'text-gray-400 hover:bg-white/5'}`}>
                                Preparing ({kitchenQueue.filter(o => o.status === 'PREPARING').length})
                            </button>
                        </div>
                        <div className="p-4 flex flex-col gap-3 min-h-[300px]">
                            {kitchenQueue
                                .filter(o =>
                                    (activeKitchenTab === 'NEW' && o.status === 'CREATED') ||
                                    (activeKitchenTab === 'ACCEPTED' && o.status === 'ACCEPTED') ||
                                    (activeKitchenTab === 'PREPARING' && o.status === 'PREPARING')
                                )
                                .map(order => (
                                    <OrderCard
                                        key={order.id}
                                        order={order}
                                        actionLabel={
                                            order.status === 'CREATED' ? 'ACCEPT' :
                                                order.status === 'ACCEPTED' ? 'START PREP' :
                                                    'MARK READY'
                                        }
                                        onAction={() => handleAction(
                                            order.status === 'CREATED' ? 'ACCEPT' :
                                                order.status === 'ACCEPTED' ? 'PREPARE' :
                                                    'READY',
                                            order.id
                                        )}
                                        colorClass={
                                            order.status === 'CREATED' ? 'bg-green-600 hover:bg-green-700' :
                                                order.status === 'ACCEPTED' ? 'bg-blue-600 hover:bg-blue-700' :
                                                    'bg-orange-500 hover:bg-orange-600'
                                        }
                                    />
                                ))}
                            {kitchenQueue.filter(o =>
                                (activeKitchenTab === 'NEW' && o.status === 'CREATED') ||
                                (activeKitchenTab === 'ACCEPTED' && o.status === 'ACCEPTED') ||
                                (activeKitchenTab === 'PREPARING' && o.status === 'PREPARING')
                            ).length === 0 && <div className="text-center text-gray-500 py-10">No orders in this queue</div>}
                        </div>
                    </div>
                </div>

                {/* 2. RUNNER QUEUE */}
                <div className="flex flex-col gap-4">
                    <div className="bg-[#1a1a1a] rounded-xl overflow-hidden border border-white/10">
                        <div className="bg-green-600 px-4 py-3 font-bold text-white tracking-wide">Runner Queue</div>
                        <div className="flex p-2 bg-[#252525] gap-2">
                            {/* Tabs */}
                            <button onClick={() => setActiveRunnerTab('READY')} className={`flex-1 py-1.5 rounded text-xs font-bold uppercase transition-colors ${activeRunnerTab === 'READY' ? 'bg-green-600 text-white' : 'text-gray-400 hover:bg-white/5'}`}>
                                Ready for Pickup ({runnerQueue.filter(o => o.status === 'READY').length})
                            </button>
                            <button onClick={() => setActiveRunnerTab('DELIVERED')} className={`flex-1 py-1.5 rounded text-xs font-bold uppercase transition-colors ${activeRunnerTab === 'DELIVERED' ? 'bg-green-600 text-white' : 'text-gray-400 hover:bg-white/5'}`}>
                                My Deliveries ({myOrders.filter(o => o.assignments?.some(a => hotelMemberIds.includes(a.hotel_member_id) && a.role === 'RUNNER')).length})
                            </button>
                        </div>
                        <div className="p-4 flex flex-col gap-3 min-h-[300px]">
                            {/* Logic:
                                READY Tab -> uses 'runnerQueue' (v_runner_queue: active ready orders)
                                DELIVERED Tab -> now uses 'myOrders' (view already filters for My assignments)
                            */}
                            {(activeRunnerTab === 'READY' ? runnerQueue : myOrders)
                                .filter(o => {
                                    if (activeRunnerTab === 'READY') return o.status === 'READY';
                                    if (activeRunnerTab === 'DELIVERED') {
                                        // Show only orders where I am assigned as RUNNER
                                        // Filter out Kitchen assignments (like ACCEPTED/PREPARING orders where I am the chef)
                                        const myRunnerAssignment = o.assignments?.find(a =>
                                            hotelMemberIds.includes(a.hotel_member_id) && a.role === 'RUNNER'
                                        );
                                        return !!myRunnerAssignment;
                                    }
                                    return false;
                                })
                                .map(order => (
                                    <OrderCard
                                        key={order.id}
                                        order={order}
                                        // If looking at 'READY' tab:
                                        // Always show DELIVER (enabled) to allow any runner to pick it up.
                                        // If looking at 'DELIVERED' tab:
                                        // Show "Delivered" label (disabled)
                                        actionLabel={
                                            order.status === 'READY' ? 'DELIVER' : 'Delivered'
                                        }
                                        onAction={() => {
                                            if (order.status === 'READY') {
                                                handleAction('DELIVER', order.id);
                                            }
                                        }}
                                        disabled={order.status !== 'READY'}
                                        colorClass={order.status === 'READY' ? "bg-blue-600 hover:bg-blue-700" : "bg-green-600"}
                                        assignedTo={order.assigned_runner_name} // Pass name
                                    />
                                ))}
                            {(activeRunnerTab === 'READY' ? runnerQueue : myOrders).filter(o => {
                                if (activeRunnerTab === 'READY') return o.status === 'READY';
                                if (activeRunnerTab === 'DELIVERED') return o.status === 'DELIVERED';
                                return false;
                            }).length === 0 && <div className="text-center text-gray-500 py-10">No orders here</div>}

                        </div>
                    </div>
                </div>

                {/* 3. MY ASSIGNED ORDERS */}
                <div className="flex flex-col gap-4">
                    <div className="bg-[#1a1a1a] rounded-xl overflow-hidden border border-white/10">
                        <div className="bg-blue-600 px-4 py-3 font-bold text-white tracking-wide">My Assigned Orders</div>
                        <div className="p-4 flex flex-col gap-3">
                            {myOrders.map(order => (
                                <div key={order.id} className="bg-white rounded-lg p-4 text-slate-900 shadow-sm flex justify-between items-center">
                                    <div>
                                        <div className="font-bold text-lg text-blue-700">{order.display_id || `Order #${order.id.slice(0, 4)}`}</div>
                                        <div className="text-xs font-bold uppercase tracking-wider mt-1 text-slate-500">Currently: <span className={order.status === 'READY' ? 'text-green-600' : 'text-orange-500'}>{order.status}</span></div>
                                    </div>
                                    {order.sla?.sla_target_at && (
                                        <div className="text-right">
                                            <div className="text-xs text-slate-400 uppercase">SLA Target</div>
                                            <div className="font-mono font-bold text-slate-700">
                                                {safeDate(order.sla.sla_target_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ))}
                            {myOrders.length === 0 && <div className="text-gray-500 text-center py-4">No active assignments</div>}
                        </div>
                    </div>
                </div>

                {/* 4. SLA RISK ALERTS */}
                <div className="flex flex-col gap-4">
                    <div className="bg-[#1a1a1a] rounded-xl overflow-hidden border border-white/10">
                        <div className="bg-red-600 px-4 py-3 font-bold text-white tracking-wide">SLA Risk Alerts</div>
                        <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                            {slaRisks.map(order => {
                                const target = safeDate(order.sla!.sla_target_at);
                                const now = new Date();
                                const diffMins = Math.floor((target.getTime() - now.getTime()) / 60000);
                                const isBreached = diffMins < 0;

                                return (
                                    <div key={order.id} className="bg-white rounded-lg p-3 text-slate-900 border-l-4 border-red-500 shadow-sm">
                                        <div className="flex justify-between items-start mb-2">
                                            <div className="font-bold text-slate-800">{order.display_id || `#${order.id.slice(0, 4)}`}</div>
                                        </div>
                                        <div className="text-xs font-bold uppercase tracking-wider mb-1 text-slate-500">Status: {order.status}</div>
                                        <div className={`text-xs font-bold ${isBreached ? 'text-red-600' : 'text-orange-500'}`}>
                                            {isBreached ? `Breached by ${Math.abs(diffMins)} min` : `Breach in ${diffMins} min`}
                                        </div>
                                    </div>
                                );
                            })}
                            {slaRisks.length === 0 && <div className="col-span-2 text-gray-500 text-center py-4 text-sm">No alerts currently</div>}
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
}

function OrderCard({ order, actionLabel, onAction, colorClass, disabled, assignedTo }: { order: FoodOrder, actionLabel: string, onAction?: () => void, colorClass: string, disabled?: boolean, assignedTo?: string }) {

    // Fix: Handle UTC timestamps correctly. If 'Z' or offset is missing, append 'Z' to treat as UTC.
    const safeDate = (dateStr: string) => {
        if (!dateStr) return new Date();
        if (dateStr.endsWith('Z') || dateStr.includes('+')) return new Date(dateStr);
        return new Date(dateStr + 'Z');
    };

    // Use updated_at for "Time since status change", fallback to created_at
    const displayTime = order.updated_at || order.created_at;
    const timeAgo = Math.floor((Date.now() - safeDate(displayTime).getTime()) / 60000);


    return (
        <div className="bg-white rounded-lg p-4 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
                <div className="flex items-center gap-3 mb-1">
                    <span className="text-lg font-bold text-slate-900">{order.display_id || `Order #${order.id.slice(0, 4)}`}</span>
                    <span className="text-xs font-medium text-slate-500">Room {order.room_number || '---'}</span>
                </div>
                <div className="text-sm text-slate-400 mb-2">
                    <ul className="list-disc list-inside">
                        {order.items.map((item, idx) => (
                            <li key={idx} className="truncate">
                                <span className="font-bold text-slate-700">{item.quantity}x</span> {item.name}
                                {item.modifiers && Object.keys(item.modifiers).length > 0 && (
                                    <span className="text-xs text-slate-500 block ml-5 italic">
                                        {JSON.stringify(item.modifiers)}
                                    </span>
                                )}
                            </li>
                        ))}
                    </ul>
                </div>
                <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                    Total: ₹{order.total_amount}
                </div>
                {order.special_instructions && (
                    <div className="mt-3 p-2 bg-yellow-500/10 border-l-2 border-yellow-500 text-xs text-yellow-500 font-medium flex gap-2 items-start">
                        <span>⚠️</span>
                        <span>{order.special_instructions}</span>
                    </div>
                )}
                <div className="text-xs text-slate-400">
                    {order.status} {timeAgo} min ago
                </div>
                {assignedTo && (
                    <div className="mt-2 text-xs font-semibold text-blue-400 bg-blue-900/30 px-2 py-1 rounded inline-block border border-blue-500/20">
                        👤 Assigned to: {assignedTo}
                    </div>
                )}
            </div>

            {onAction && (
                <button
                    onClick={onAction}
                    disabled={disabled}
                    className={`px-6 py-2 rounded font-bold text-sm text-white shadow-sm transition-all ${disabled ? 'bg-slate-300 cursor-not-allowed' : colorClass}`}
                >
                    {actionLabel}
                </button>
            )}
        </div>
    );
}
