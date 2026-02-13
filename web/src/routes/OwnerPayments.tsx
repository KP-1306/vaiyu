import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
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

    const totalCollections = payments
        .filter(p => p.type === 'PAYMENT' && p.status === 'COMPLETED')
        .reduce((sum, p) => sum + p.amount, 0);

    const totalCharges = payments
        .filter(p => p.type === 'CHARGE')
        .reduce((sum, p) => sum + p.amount, 0);

    const netBalance = totalCharges - totalCollections;

    return (
        <OwnerGate slug={slug}>
            <div className="min-h-screen bg-slate-950 text-slate-100">
                <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
                    {/* Header */}
                    <div className="flex items-center justify-between mb-8">
                        <div>
                            <div className="flex items-center gap-2 text-sm text-slate-500 mb-1">
                                <Link to={`/owner/${slug}`} className="hover:text-slate-300 transition-colors">Dashboard</Link>
                                <span>/</span>
                                <span className="text-slate-300">Payments & Ledger</span>
                            </div>
                            <h1 className="text-2xl font-bold text-white tracking-tight">Payments & Ledger</h1>
                            <p className="mt-1 text-sm text-slate-400">Track charges, payments, and financial logs.</p>
                        </div>
                        <button
                            onClick={() => setShowAddModal(true)}
                            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-900"
                        >
                            <Plus size={16} />
                            Add Transaction
                        </button>
                    </div>

                    {/* Stats Cards */}
                    <div className="grid grid-cols-1 gap-5 sm:grid-cols-3 mb-8">
                        <div className="overflow-hidden rounded-xl bg-[#1e293b] border border-slate-700 shadow-sm p-5">
                            <dt className="truncate text-sm font-medium text-slate-400 uppercase tracking-wide">Total Collections</dt>
                            <dd className="mt-2 text-3xl font-bold tracking-tight text-white flex items-baseline gap-1">
                                <span className="text-xl text-slate-500">₹</span>
                                {totalCollections.toLocaleString()}
                            </dd>
                        </div>
                        <div className="overflow-hidden rounded-xl bg-[#1e293b] border border-slate-700 shadow-sm p-5">
                            <dt className="truncate text-sm font-medium text-slate-400 uppercase tracking-wide">Total Charges Posted</dt>
                            <dd className="mt-2 text-3xl font-bold tracking-tight text-white flex items-baseline gap-1">
                                <span className="text-xl text-slate-500">₹</span>
                                {totalCharges.toLocaleString()}
                            </dd>
                        </div>
                        <div className="overflow-hidden rounded-xl bg-[#1e293b] border border-slate-700 shadow-sm p-5">
                            <dt className="truncate text-sm font-medium text-slate-400 uppercase tracking-wide">Net Balance (Due)</dt>
                            <dd className="mt-2 text-3xl font-bold tracking-tight text-white flex items-baseline gap-1">
                                <span className="text-xl text-slate-500">₹</span>
                                {netBalance.toLocaleString()}
                            </dd>
                        </div>
                    </div>

                    {/* Transactions Table */}
                    <div className="overflow-hidden rounded-xl bg-[#1e293b] border border-slate-700 shadow-sm">
                        <div className="overflow-x-auto">
                            <table className="min-w-full divide-y divide-slate-700/50">
                                <thead className="bg-[#0f172a]">
                                    <tr>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Date</th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Room</th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Guest</th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Details</th>
                                        <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-slate-400 uppercase tracking-wider">Amount</th>
                                        <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-slate-400 uppercase tracking-wider">Status</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-700/50 bg-[#1e293b]">
                                    {loading ? (
                                        <tr>
                                            <td colSpan={6} className="px-6 py-12 text-center text-sm text-slate-400">
                                                Loading transactions...
                                            </td>
                                        </tr>
                                    ) : payments.length === 0 ? (
                                        <tr>
                                            <td colSpan={6} className="px-6 py-12 text-center text-sm text-slate-500">
                                                No transactions found.
                                            </td>
                                        </tr>
                                    ) : (
                                        payments.map((payment) => (
                                            <tr key={payment.id} className="hover:bg-slate-800/50 transition-colors">
                                                <td className="whitespace-nowrap px-6 py-4 text-sm text-slate-300">
                                                    {new Date(payment.created_at).toLocaleDateString()}
                                                    <div className="text-xs text-slate-500">{new Date(payment.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                                                </td>
                                                <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-white">
                                                    {payment.stay?.room?.number || '—'}
                                                </td>
                                                <td className="whitespace-nowrap px-6 py-4 text-sm text-slate-300">
                                                    {payment.stay?.guest?.full_name || 'Unknown'}
                                                </td>
                                                <td className="px-6 py-4 text-sm text-slate-300">
                                                    <div className="flex items-center gap-2">
                                                        {payment.type === 'CHARGE' ? (
                                                            <span className="inline-flex items-center rounded-full bg-slate-800 px-2 py-0.5 text-xs font-medium text-slate-400 border border-slate-700">Charge</span>
                                                        ) : (
                                                            <span className="inline-flex items-center rounded-full bg-emerald-900/30 px-2 py-0.5 text-xs font-medium text-emerald-400 border border-emerald-900/50">Payment</span>
                                                        )}
                                                        <span className="truncate max-w-[200px]">{payment.notes || payment.method}</span>
                                                    </div>
                                                </td>
                                                <td className={`whitespace-nowrap px-6 py-4 text-right text-sm font-semibold ${payment.type === 'PAYMENT' ? 'text-emerald-400' : 'text-slate-200'
                                                    }`}>
                                                    {payment.type === 'PAYMENT' ? '+' : ''}₹{payment.amount.toLocaleString()}
                                                </td>
                                                <td className="whitespace-nowrap px-6 py-4 text-right text-sm">
                                                    <span className={`inline-flex rounded-full px-2 text-xs font-semibold leading-5 ${payment.status === 'COMPLETED' ? 'bg-emerald-900/30 text-emerald-400 border border-emerald-900/50' :
                                                            payment.status === 'PENDING' ? 'bg-amber-900/30 text-amber-400 border border-amber-900/50' :
                                                                'bg-rose-900/30 text-rose-400 border border-rose-900/50'
                                                        }`}>
                                                        {payment.status}
                                                    </span>
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                {/* Add Transaction Modal */}
                {showAddModal && (
                    <div className="fixed inset-0 z-50 overflow-y-auto">
                        <div className="flex min-h-screen items-end justify-center px-4 pt-4 pb-20 text-center sm:block sm:p-0">
                            <div className="fixed inset-0 transition-opacity" aria-hidden="true">
                                <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm" onClick={() => setShowAddModal(false)}></div>
                            </div>

                            <span className="hidden sm:inline-block sm:h-screen sm:align-middle" aria-hidden="true">&#8203;</span>

                            <div className="inline-block transform overflow-hidden rounded-xl bg-[#1e293b] border border-slate-700 text-left align-bottom shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-lg sm:align-middle">
                                <div className="px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                                    <div className="sm:flex sm:items-start">
                                        <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left w-full">
                                            <h3 className="text-lg font-medium leading-6 text-white" id="modal-title">Add New Transaction</h3>
                                            <div className="mt-4 space-y-4">
                                                <div>
                                                    <label className="block text-sm font-medium text-slate-300">Room Number</label>
                                                    <input
                                                        type="text"
                                                        value={roomNumber}
                                                        onChange={(e) => setRoomNumber(e.target.value)}
                                                        className="mt-1 block w-full rounded-lg border-slate-600 bg-slate-800 text-white shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm placeholder-slate-500"
                                                        placeholder="e.g. 101"
                                                    />
                                                </div>

                                                <div className="grid grid-cols-2 gap-4">
                                                    <div>
                                                        <label className="block text-sm font-medium text-slate-300">Type</label>
                                                        <select
                                                            value={type}
                                                            onChange={(e) => setType(e.target.value as any)}
                                                            className="mt-1 block w-full rounded-lg border-slate-600 bg-slate-800 text-white shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                                                        >
                                                            <option value="PAYMENT">Payment (Credit)</option>
                                                            <option value="CHARGE">Charge (Debit)</option>
                                                        </select>
                                                    </div>
                                                    <div>
                                                        <label className="block text-sm font-medium text-slate-300">Amount (₹)</label>
                                                        <input
                                                            type="number"
                                                            value={amount}
                                                            onChange={(e) => setAmount(e.target.value)}
                                                            className="mt-1 block w-full rounded-lg border-slate-600 bg-slate-800 text-white shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm placeholder-slate-500"
                                                            placeholder="0.00"
                                                        />
                                                    </div>
                                                </div>

                                                {type === 'PAYMENT' && (
                                                    <div>
                                                        <label className="block text-sm font-medium text-slate-300">Method</label>
                                                        <select
                                                            value={method}
                                                            onChange={(e) => setMethod(e.target.value)}
                                                            className="mt-1 block w-full rounded-lg border-slate-600 bg-slate-800 text-white shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                                                        >
                                                            <option value="CASH">Cash</option>
                                                            <option value="UPI">UPI</option>
                                                            <option value="CARD">Card</option>
                                                            <option value="OTHER">Other</option>
                                                        </select>
                                                    </div>
                                                )}

                                                <div>
                                                    <label className="block text-sm font-medium text-slate-300">Notes / Details</label>
                                                    <input
                                                        type="text"
                                                        value={notes}
                                                        onChange={(e) => setNotes(e.target.value)}
                                                        className="mt-1 block w-full rounded-lg border-slate-600 bg-slate-800 text-white shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm placeholder-slate-500"
                                                        placeholder="Optional description..."
                                                    />
                                                </div>

                                                {error && (
                                                    <div className="rounded-md bg-rose-900/30 p-2 text-sm text-rose-300 border border-rose-900/50">
                                                        {error}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div className="bg-[#0f172a] px-4 py-3 sm:flex sm:flex-row-reverse sm:px-6">
                                    <button
                                        type="button"
                                        onClick={handleAddTransaction}
                                        disabled={submitting}
                                        className="inline-flex w-full justify-center rounded-lg border border-transparent bg-blue-600 px-4 py-2 text-base font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-900 sm:ml-3 sm:w-auto sm:text-sm disabled:opacity-50"
                                    >
                                        {submitting ? 'Saving...' : 'Save Transaction'}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setShowAddModal(false)}
                                        className="mt-3 inline-flex w-full justify-center rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-base font-medium text-slate-300 shadow-sm hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2 focus:ring-offset-slate-900 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </OwnerGate>
    );
}
