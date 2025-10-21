// web/src/routes/OwnerHRMS.tsx
import { useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Outlet, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';

// ----------- tiny UI helpers -------------
function Badge({ tone = 'grey', children }: { tone?: 'green'|'amber'|'red'|'grey'|'blue'; children: React.ReactNode }) {
  const cls = {
    green: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
    amber: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
    red:   'bg-rose-50 text-rose-700 ring-1 ring-rose-200',
    grey:  'bg-slate-50 text-slate-600 ring-1 ring-slate-200',
    blue:  'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200',
  }[tone];
  return <span className={`px-2 py-0.5 rounded-full text-xs ${cls}`}>{children}</span>;
}

function Section({ title, desc, right }: { title: string; desc?: string; right?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-start justify-between">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        {desc && <p className="text-sm text-muted-foreground">{desc}</p>}
      </div>
      <div className="flex items-center gap-2">{right}</div>
    </div>
  );
}

function downloadCSV(filename: string, rows: any[]) {
  if (!rows?.length) return;
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(',')];
  for (const r of rows) lines.push(headers.map(h => {
    const v = r[h] ?? '';
    const s = String(v).replaceAll('"','""');
    return `"${s}"`;
  }).join(','));
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ---------- layout with tabs -------------
function HRMSLayout({ children }: { children?: React.ReactNode }) {
  const { slug } = useParams();
  const loc = useLocation();
  const tabs = [
    { to: `/owner/${slug}/hrms/attendance`, label: 'Attendance' },
    { to: `/owner/${slug}/hrms/leaves`, label: 'Leaves' },
    { to: `/owner/${slug}/hrms/staff`, label: 'Staff' },
  ];
  return (
    <main className="max-w-6xl mx-auto p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <div className="text-2xl font-semibold">HRMS</div>
          <p className="text-sm text-muted-foreground">
            Quick team hub — mark presence, approve leaves, and keep staff info up to date.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link className="btn btn-light" to={`/owner/${slug}`}>← Back to dashboard</Link>
        </div>
      </div>

      <nav className="mb-4 flex gap-2">
        {tabs.map(t => (
          <NavLink key={t.to} to={t.to}
            className={({isActive}) =>
              `px-3 py-1.5 rounded-lg border ${isActive ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white hover:bg-slate-50'}`
            }>
            {t.label}
          </NavLink>
        ))}
      </nav>

      {children ?? <Outlet />}
    </main>
  );
}

// ---------- Attendance -------------------
function AttendancePage() {
  const { slug } = useParams();
  const [fromDay, setFromDay] = useState(() => new Date(Date.now()-6*86400000).toISOString().slice(0,10));
  const [toDay, setToDay] = useState(() => new Date().toISOString().slice(0,10));
  const [rows, setRows] = useState<any[]>([]);
  const [profiles, setProfiles] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState<string|undefined>();

  useEffect(() => { let alive = true; (async () => {
    setLoading(true); setErrorText(undefined);
    try {
      // hotel
      const { data: h } = await supabase.from('hotels').select('id').eq('slug', slug!).maybeSingle();
      const hotelId = h?.id;
      // attendance (best-effort)
      const { data: att, error } = await supabase
        .from('attendance') // if table is missing, catch below
        .select('id, user_id, day, status, check_in, check_out')
        .eq('hotel_id', hotelId)
        .gte('day', fromDay)
        .lte('day', toDay)
        .order('day', { ascending: false })
        .limit(500);
      if (error) throw error;
      setRows(att || []);
      // user profiles
      const ids = Array.from(new Set((att||[]).map((r:any)=>r.user_id).filter(Boolean)));
      if (ids.length) {
        const { data: ps } = await supabase.from('user_profiles').select('id, full_name, role, phone, email').in('id', ids);
        const map: Record<string, any> = {}; (ps||[]).forEach(p => map[p.id] = p);
        setProfiles(map);
      } else setProfiles({});
    } catch (e:any) {
      setErrorText('Attendance table not found yet. You can create a table attendance(user_id, hotel_id, day, status, check_in, check_out).');
      setRows([]);
    } finally { if (alive) setLoading(false); }
  })(); return () => { alive = false; }; }, [slug, fromDay, toDay]);

  const csv = rows.map(r => ({
    day: r.day,
    staff: profiles[r.user_id]?.full_name || r.user_id,
    status: r.status,
    check_in: r.check_in || '',
    check_out: r.check_out || '',
  }));

  return (
    <>
      <Section
        title="Attendance"
        desc="Past week by default — filter any dates. Green is present, red is absent."
        right={
          <>
            <button className="btn btn-light" onClick={() => downloadCSV('attendance.csv', csv)}>Export CSV</button>
          </>
        }
      />
      <div className="rounded-xl border bg-white p-4">
        <div className="flex flex-wrap items-end gap-3 mb-3">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">From</label>
            <input type="date" className="border rounded px-2 py-1 text-sm" value={fromDay} onChange={e=>setFromDay(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">To</label>
            <input type="date" className="border rounded px-2 py-1 text-sm" value={toDay} onChange={e=>setToDay(e.target.value)} />
          </div>
        </div>

        {loading ? <div className="text-sm text-muted-foreground">Loading…</div>
         : errorText ? <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded p-3">{errorText}</div>
         : rows.length === 0 ? <div className="text-sm text-muted-foreground">No attendance recorded for this period.</div>
         : (
          <div className="overflow-x-auto">
            <table className="text-sm w-full">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-1 pr-3">Day</th>
                  <th className="py-1 pr-3">Staff</th>
                  <th className="py-1 pr-3">Status</th>
                  <th className="py-1 pr-3">Check-in</th>
                  <th className="py-1 pr-3">Check-out</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r:any) => {
                  const tone = r.status === 'present' ? 'green' : r.status === 'late' ? 'amber' : 'red';
                  return (
                    <tr key={r.id} className="border-t">
                      <td className="py-1 pr-3">{r.day}</td>
                      <td className="py-1 pr-3">{profiles[r.user_id]?.full_name || r.user_id}</td>
                      <td className="py-1 pr-3"><Badge tone={tone as any}>{r.status || '—'}</Badge></td>
                      <td className="py-1 pr-3">{r.check_in || '—'}</td>
                      <td className="py-1 pr-3">{r.check_out || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

// ---------- Leaves -----------------------
function LeavesPage() {
  const { slug } = useParams();
  const [status, setStatus] = useState<'all'|'pending'|'approved'|'denied'>('all');
  const [fromDay, setFromDay] = useState(() => new Date(Date.now()-30*86400000).toISOString().slice(0,10));
  const [toDay, setToDay] = useState(() => new Date().toISOString().slice(0,10));
  const [rows, setRows] = useState<any[]>([]);
  const [profiles, setProfiles] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState<string|undefined>();

  useEffect(() => { let alive = true; (async () => {
    setLoading(true); setErrorText(undefined);
    try {
      const { data: h } = await supabase.from('hotels').select('id').eq('slug', slug!).maybeSingle();
      const hotelId = h?.id;
      let query = supabase
        .from('leaves')
        .select('id, user_id, start_date, end_date, type, status, created_at')
        .eq('hotel_id', hotelId)
        .gte('start_date', fromDay)
        .lte('end_date', toDay)
        .order('created_at', { ascending: false });
      if (status !== 'all') query = query.eq('status', status);
      const { data, error } = await query;
      if (error) throw error;
      setRows(data || []);
      const ids = Array.from(new Set((data||[]).map((r:any)=>r.user_id).filter(Boolean)));
      if (ids.length) {
        const { data: ps } = await supabase.from('user_profiles').select('id, full_name, role, phone, email').in('id', ids);
        const map: Record<string, any> = {}; (ps||[]).forEach(p => map[p.id] = p);
        setProfiles(map);
      } else setProfiles({});
    } catch {
      setErrorText('Leaves table not found yet. You can create leaves(user_id, hotel_id, start_date, end_date, type, status).');
      setRows([]);
    } finally { if (alive) setLoading(false); }
  })(); return () => { alive = false; }; }, [slug, fromDay, toDay, status]);

  const csv = rows.map(r => ({
    created_at: r.created_at || '',
    staff: profiles[r.user_id]?.full_name || r.user_id,
    type: r.type || '',
    status: r.status || '',
    start_date: r.start_date,
    end_date: r.end_date,
  }));

  return (
    <>
      <Section
        title="Leaves"
        desc="Review and track time-off. Pending items show in amber."
        right={<button className="btn btn-light" onClick={() => downloadCSV('leaves.csv', csv)}>Export CSV</button>}
      />
      <div className="rounded-xl border bg-white p-4">
        <div className="flex flex-wrap items-end gap-3 mb-3">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Status</label>
            <select className="border rounded px-2 py-1 text-sm" value={status} onChange={e=>setStatus(e.target.value as any)}>
              <option value="all">All</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="denied">Denied</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">From</label>
            <input type="date" value={fromDay} onChange={e=>setFromDay(e.target.value)} className="border rounded px-2 py-1 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">To</label>
            <input type="date" value={toDay} onChange={e=>setToDay(e.target.value)} className="border rounded px-2 py-1 text-sm" />
          </div>
        </div>

        {loading ? <div className="text-sm text-muted-foreground">Loading…</div>
         : errorText ? <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded p-3">{errorText}</div>
         : rows.length === 0 ? <div className="text-sm text-muted-foreground">No leaves in this period.</div>
         : (
          <div className="overflow-x-auto">
            <table className="text-sm w-full">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-1 pr-3">Created</th>
                  <th className="py-1 pr-3">Staff</th>
                  <th className="py-1 pr-3">Type</th>
                  <th className="py-1 pr-3">Status</th>
                  <th className="py-1 pr-3">From</th>
                  <th className="py-1 pr-3">To</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r:any)=> {
                  const tone = r.status === 'approved' ? 'green' : r.status === 'pending' ? 'amber' : 'red';
                  return (
                    <tr key={r.id} className="border-t">
                      <td className="py-1 pr-3">{r.created_at ? new Date(r.created_at).toLocaleString() : '—'}</td>
                      <td className="py-1 pr-3">{profiles[r.user_id]?.full_name || r.user_id}</td>
                      <td className="py-1 pr-3">{r.type || '—'}</td>
                      <td className="py-1 pr-3"><Badge tone={tone as any}>{r.status || '—'}</Badge></td>
                      <td className="py-1 pr-3">{r.start_date}</td>
                      <td className="py-1 pr-3">{r.end_date}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

// ---------- Staff ------------------------
function StaffPage() {
  const { slug } = useParams();
  const [rows, setRows] = useState<any[]>([]);
  const [q, setQ] = useState('');
  const [role, setRole] = useState<'all'|string>('all');
  const [loading, setLoading] = useState(true);

  useEffect(()=>{ let alive = true; (async()=>{
    setLoading(true);
    // user_profiles is already present in your schema
    const { data } = await supabase
      .from('user_profiles')
      .select('id, full_name, role, phone, email, status, hotel_id')
      .eq('hotel_id', (await supabase.from('hotels').select('id').eq('slug', slug!).maybeSingle()).data?.id)
      .order('full_name', { ascending: true });
    if (!alive) return;
    setRows(data || []);
    setLoading(false);
  })(); return ()=>{ alive=false; }; }, [slug]);

  const filtered = useMemo(()=>{
    let out = rows;
    if (role !== 'all') out = out.filter((r:any)=> (r.role||'').toLowerCase() === role.toLowerCase());
    if (q.trim()) {
      const s = q.trim().toLowerCase();
      out = out.filter((r:any)=> (r.full_name||'').toLowerCase().includes(s) || (r.email||'').toLowerCase().includes(s));
    }
    return out;
  }, [rows, q, role]);

  const roles = Array.from(new Set(rows.map((r:any)=>r.role).filter(Boolean)));

  return (
    <>
      <Section
        title="Staff"
        desc="Your people directory — search by name, filter by role, and contact quickly."
      />
      <div className="rounded-xl border bg-white p-4">
        <div className="flex flex-wrap items-end gap-3 mb-3">
          <div className="flex-1 min-w-[220px]">
            <label className="block text-xs text-muted-foreground mb-1">Search</label>
            <input className="border rounded px-2 py-1 text-sm w-full" placeholder="Type a name or email"
                   value={q} onChange={e=>setQ(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Role</label>
            <select className="border rounded px-2 py-1 text-sm" value={role} onChange={e=>setRole(e.target.value)}>
              <option value="all">All</option>
              {roles.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
        </div>

        {loading ? <div className="text-sm text-muted-foreground">Loading…</div>
         : filtered.length === 0 ? <div className="text-sm text-muted-foreground">No staff match your filters.</div>
         : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((p:any)=>(
              <li key={p.id} className="rounded-xl border p-4">
                <div className="font-medium">{p.full_name || 'Unnamed'}</div>
                <div className="text-xs text-muted-foreground">{p.role || '—'}</div>
                <div className="mt-2 text-sm">
                  {p.phone && <a className="underline mr-3" href={`tel:${p.phone}`}>Call</a>}
                  {p.email && <a className="underline" href={`mailto:${p.email}`}>Email</a>}
                </div>
                <div className="mt-2">
                  <Badge tone={p.status === 'active' ? 'green' : 'grey'}>{p.status || 'unknown'}</Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

// ---------- HRMS router wrapper ----------
export default function OwnerHRMS() {
  // Nested routes so /owner/:slug/hrms/* renders subpages
  return (
    <HRMSLayout>
      <Routes>
        <Route path="/" element={<AttendancePage />} />
        <Route path="/attendance" element={<AttendancePage />} />
        <Route path="/leaves" element={<LeavesPage />} />
        <Route path="/staff" element={<StaffPage />} />
      </Routes>
    </HRMSLayout>
  );
}
