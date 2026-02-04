import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import OwnerGate from "../components/OwnerGate";
import { Plus, IndianRupee, Search, Calendar, Filter, X, ArrowUpRight, ArrowDownLeft, Info } from "lucide-react";

type Payment = {
    id: string;
    amount: number;
    type: 'CHARGE' | 'PAYMENT' | 'INFO';
    method: 'UPI' | 'CASH' | 'CARD' | 'ROOM_CHARGE' | 'OTHER' | null;
    status: 'PENDING' | 'COMPLETED' | 'FAILED';
    notes: string | null;
    created_at: string;
    stay: {
        room: { number: string };
        guest: { full_name: string } | null;
    };
};

export default function OwnerPayments() {
    const { slug } = useParams<{ slug: string }>();
    const [payments, setPayments] = useState<Payment[]>([]);
    const [loading, setLoading] = useState(true);
    const [showAddModal, setShowAddModal] = useState(false);

    // Form State
    const [roomNumber, setRoomNumber] = useState("");
    const [amount, setAmount] = useState("");
    const [type, setType] = useState<'CHARGE' | 'PAYMENT'>('PAYMENT');
    const [method, setMethod] = useState<string>('CASH');
    const [notes, setNotes] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (slug) fetchPayments();
    }, [slug]);

    const fetchPayments = async () => {
        setLoading(true);
        try {
            // 1. Get Hotel ID
            const { data: hotel } = await supabase.from('hotels').select('id').eq('slug', slug).single();
            if (!hotel) return;

            // 2. Fetch Payments (Joined with Stay -> Room)
            const { data, error } = await supabase
                .from('payments')
                .select(`
                    *,
                    stay:stays!inner(
                        room:rooms!inner(number, hotel_id),
                        guest:guests(full_name)
                    )
                `)
                .eq('stay.room.hotel_id', hotel.id)
                .order('created_at', { ascending: false })
                .limit(50); // Pagination later

            if (error) throw error;
            setPayments(data as any || []);
        } catch (err) {
            console.error("Error fetching payments:", err);
        } finally {
            setLoading(false);
        }
    };

    const handleAddTransaction = async () => {
        setSubmitting(true);
        setError(null);
        try {
            // 1. Get Hotel ID
            const { data: hotel } = await supabase.from('hotels').select('id').eq('slug', slug).single();
            if (!hotel) throw new Error("Hotel not found");

            // 2. Find Active Stay for Room
            const { data: stays, error: stayError } = await supabase
                .from('stays')
                .select('id')
                .eq('hotel_id', hotel.id)
                .
                // We need to join with rooms to filter by number, but supabase query syntax is tricky for nested filters on generic columns if not related directly.
                // Easier: Get room id first.
                // Or better: Use the 'is_active' computed col if possible, or status.
                in('status', ['inhouse', 'arriving']);

            // Let's do a more robust lookup: Find active stay by room number
            // Get Room ID first
            const { data: room } = await supabase
                .from('rooms')
                .select('id')
                .eq('hotel_id', hotel.id)
                .eq('number', roomNumber)
                .single();

            if (!room) throw new Error(`Room ${roomNumber} not found.`);

            // Get Active Stay
            const { data: activeStay } = await supabase
                .from('stays')
                .select('id')
                .eq('room_id', room.id)
                .in('status', ['inhouse', 'arriving']) // Assume allow posting to arriving too? Or just inhouse.
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (!activeStay) throw new Error(`No active stay found for Room ${roomNumber}.`);

            // 3. Insert Payment
            const { error: insertError } = await supabase
                .from('payments')
                .insert({
                    stay_id: activeStay.id,
                    amount: parseFloat(amount),
                    type,
                    method: type === 'CHARGE' ? 'ROOM_CHARGE' : method, // Force Room Charge for charges usually? Or generic.
                    // Actually, if I add a "Charge", method could be "LAUNDRY" etc. But our enum is 'UPI','CASH','CARD','ROOM_CHARGE','OTHER'. 
                    // Let's use 'ROOM_CHARGE' for debits, and others for credits.
                    status: 'COMPLETED',
                    notes
                });

            if (insertError) throw insertError;

            // Success
            setShowAddModal(false);
            setRoomNumber("");
            setAmount("");
            setNotes("");
            fetchPayments();
        } catch (err: any) {
            setError(err.message);
        } finally {
            setSubmitting(false);
        }
    };

    const stats = {
        collected: payments.filter(p => p.type === 'PAYMENT').reduce((sum, p) => sum + p.amount, 0),
        charges: payments.filter(p => p.type === 'CHARGE').reduce((sum, p) => sum + p.amount, 0)
    };

    return (
        <OwnerGate>
            <div className="p-6 max-w-7xl mx-auto space-y-6">
                <div className="flex justify-between items-center">
                    <div>
                        <h1 className="text-2xl font-bold text-slate-800">Payments & Ledger</h1>
                        <p className="text-slate-500">Track charges, payments, and financial logs.</p>
                    </div>
                    <button
                        onClick={() => setShowAddModal(true)}
                        className="bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-blue-700 transition-colors"
                    >
                        <Plus size={18} /> Add Transaction
                    </button>
                </div>

                {/* Stats Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
                        <div className="text-sm font-medium text-slate-500 mb-1">Total Collections</div>
                        <div className="text-2xl font-bold text-emerald-600 flex items-center">
                            <IndianRupee size={20} /> {stats.collected.toLocaleString('en-IN')}
                        </div>
                    </div>
                    <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
                        <div className="text-sm font-medium text-slate-500 mb-1">Total Charges Posted</div>
                        <div className="text-2xl font-bold text-red-600 flex items-center">
                            <IndianRupee size={20} /> {stats.charges.toLocaleString('en-IN')}
                        </div>
                    </div>
                    <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
                        <div className="text-sm font-medium text-slate-500 mb-1">Net Balance (Due)</div>
                        <div className="text-2xl font-bold text-slate-800 flex items-center">
                            <IndianRupee size={20} /> {(stats.charges - stats.collected).toLocaleString('en-IN')}
                        </div>
                    </div>
                </div>

                {/* Payments Table */}
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                            <thead className="bg-slate-50 border-b border-slate-200">
                                <tr>
                                    <th className="px-6 py-4 font-medium text-slate-600">Date</th>
                                    <th className="px-6 py-4 font-medium text-slate-600">Room</th>
                                    <th className="px-6 py-4 font-medium text-slate-600">Guest</th>
                                    <th className="px-6 py-4 font-medium text-slate-600">Details</th>
                                    <th className="px-6 py-4 font-medium text-slate-600 text-right">Amount</th>
                                    <th className="px-6 py-4 font-medium text-slate-600 text-right">Status</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {loading ? (
                                    <tr><td colSpan={6} className="px-6 py-8 text-center text-slate-500">Loading records...</td></tr>
                                ) : payments.length === 0 ? (
                                    <tr><td colSpan={6} className="px-6 py-8 text-center text-slate-500">No transactions found.</td></tr>
                                ) : (
                                    payments.map((p) => (
                                        <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                                            <td className="px-6 py-4 text-slate-600">
                                                {new Date(p.created_at).toLocaleDateString('en-IN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                            </td>
                                            <td className="px-6 py-4 font-medium text-slate-800">
                                                {p.stay?.room?.number || 'N/A'}
                                            </td>
                                            <td className="px-6 py-4 text-slate-600">
                                                {p.stay?.guest?.full_name || 'Unknown'}
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-2">
                                                    {p.type === 'PAYMENT' ? (
                                                        <span className="bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded text-xs font-medium flex items-center gap-1">
                                                            <ArrowDownLeft size={10} /> Received
                                                        </span>
                                                    ) : p.type === 'CHARGE' ? (
                                                        <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded text-xs font-medium flex items-center gap-1">
                                                            <ArrowUpRight size={10} /> Charge
                                                        </span>
                                                    ) : (
                                                        <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded text-xs font-medium flex items-center gap-1">
                                                            <Info size={10} /> Info
                                                        </span>
                                                    )}
                                                    <span className="text-slate-500">{p.method?.replace('_', ' ')}</span>
                                                    {p.notes && <span className="text-slate-400 italic text-xs">- {p.notes}</span>}
                                                </div>
                                            </td>
                                            <td className={`px-6 py-4 font-medium text-right ${p.type === 'PAYMENT' ? 'text-emerald-600' : 'text-red-600'}`}>
                                                {p.type === 'PAYMENT' ? '+' : '-'}
                                                {p.amount.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}
                                            </td>
                                            <td className="px-6 py-4 text-right">
                                                <span className="bg-green-50 text-green-700 border border-green-200 px-2 py-1 rounded-full text-xs font-medium">
                                                    {p.status}
                                                </span>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Add Transaction Modal */}
                {showAddModal && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
                        <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
                            <div className="flex justify-between items-center mb-6">
                                <h2 className="text-xl font-bold text-slate-800">New Transaction</h2>
                                <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-slate-600">
                                    <X size={20} />
                                </button>
                            </div>

                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Room Number *</label>
                                    <input
                                        type="text"
                                        value={roomNumber}
                                        onChange={e => setRoomNumber(e.target.value)}
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                        placeholder="e.g. 101"
                                    />
                                    <p className="text-xs text-slate-500 mt-1">Must have an active stay (Checked In).</p>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1">Type</label>
                                        <select
                                            value={type}
                                            onChange={(e: any) => setType(e.target.value)}
                                            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                        >
                                            <option value="PAYMENT">Payment (Credit)</option>
                                            <option value="CHARGE">Charge (Debit)</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1">Amount (₹) *</label>
                                        <input
                                            type="number"
                                            value={amount}
                                            onChange={e => setAmount(e.target.value)}
                                            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                            placeholder="0.00"
                                        />
                                    </div>
                                </div>
                                {type === 'PAYMENT' && (
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1">Method</label>
                                        <select
                                            value={method}
                                            onChange={e => setMethod(e.target.value)}
                                            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                        >
                                            <option value="CASH">Cash</option>
                                            <option value="UPI">UPI</option>
                                            <option value="CARD">Card</option>
                                            <option value="OTHER">Other</option>
                                        </select>
                                    </div>
                                )}
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
                                    <textarea
                                        value={notes}
                                        onChange={e => setNotes(e.target.value)}
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 h-20"
                                        placeholder="e.g. Laundry, Mini Bar, Deposit..."
                                    />
                                </div>

                                {error && (
                                    <div className="bg-red-50 text-red-600 text-sm p-3 rounded-lg">
                                        {error}
                                    </div>
                                )}

                                <button
                                    onClick={handleAddTransaction}
                                    disabled={submitting}
                                    className="w-full bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
                                >
                                    {submitting ? 'Processing...' : 'Save Transaction'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </OwnerGate>
    );
}
