import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { fetchOwnerApps, approveOwnerApp, rejectOwnerApp, OwnerApp } from "../../lib/api";

export default function OwnerApplications() {
  const [apps, setApps] = useState<OwnerApp[]>([]);
  const [status, setStatus] = useState<'pending'|'approved'|'rejected'>('pending');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setLoading(true); setErr(null);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const list = await fetchOwnerApps(status, token);
      setApps(list);
    } catch (e:any) {
      setErr(e.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [status]);

  async function onApprove(id: string) {
    const notes = prompt("Notes (optional):") || undefined;
    const { data } = await supabase.auth.getSession();
    await approveOwnerApp(id, notes, data.session?.access_token);
    load();
  }

  async function onReject(id: string) {
    const reason = prompt("Reason (required):");
    if (!reason) return;
    const { data } = await supabase.auth.getSession();
    await rejectOwnerApp(id, reason, data.session?.access_token);
    load();
  }

  return (
    <main className="max-w-5xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-4">Owner Applications</h1>

      <div className="mb-4 flex gap-2">
        {(['pending','approved','rejected'] as const).map(s => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`px-3 py-1 rounded ${status===s?'bg-blue-600 text-white':'border'}`}
          >
            {s}
          </button>
        ))}
      </div>

      {loading && <p>Loading…</p>}
      {err && <p className="text-red-600">{err}</p>}

      {!loading && !err && (
        <div className="space-y-3">
          {apps.map(a => (
            <div key={a.id} className="border rounded-xl p-4">
              <div className="font-medium">{a.property_name} — {a.city}, {a.country}</div>
              <div className="text-sm text-slate-600">{a.contact_name} • {a.contact_email} • {a.contact_phone}</div>
              <div className="text-sm mt-1">Status: {a.status}</div>
              {a.status === 'pending' && (
                <div className="mt-3 flex gap-2">
                  <button className="px-3 py-1 rounded bg-green-600 text-white" onClick={() => onApprove(a.id)}>Approve</button>
                  <button className="px-3 py-1 rounded bg-rose-600 text-white" onClick={() => onReject(a.id)}>Reject</button>
                </div>
              )}
              {a.status !== 'pending' && (
                <div className="text-sm mt-2">
                  {a.status==='approved' && <>Notes: {a.review_notes || '—'}</>}
                  {a.status==='rejected' && <>Reason: {a.rejected_reason || '—'}</>}
                </div>
              )}
            </div>
          ))}
          {apps.length === 0 && <p>No applications.</p>}
        </div>
      )}
    </main>
  );
}
