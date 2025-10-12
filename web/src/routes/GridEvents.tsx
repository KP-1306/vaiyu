import { useEffect, useMemo, useState } from 'react';
import { gridListEvents, gridStopEvent, gridStepEvent, gridGetDevices, GridEvent, Device } from '../lib/api';

export default function GridEvents() {
  const [events, setEvents] = useState<GridEvent[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [ev, dv] = await Promise.all([gridListEvents(), gridGetDevices()]);
        setEvents(ev.items || []);
        setDevices(dv || []);
      } finally { setLoading(false); }
    })();
  }, []);

  function nameFor(id: string) { return devices.find(d => d.id === id)?.name || id; }

  async function stop(ev: GridEvent) {
    if (!confirm('Stop this event and compute estimated savings?')) return;
    const r = await gridStopEvent(ev.id);
    setEvents(prev => prev.map(x => x.id === ev.id ? r.event : x));
  }

  async function restore(ev: GridEvent, device_id: string) {
    await gridStepEvent(ev.id, device_id, 'restore', 'manual restore');
    const { items } = await gridListEvents();
    setEvents(items || []);
  }

  function exportCsv() {
    const rows: string[] = [];
    rows.push(['id','start_at','end_at','mode','target_kw','reduced_kw','ts','device_id','action','by','note'].join(','));
    events.forEach(ev => {
      if (!ev.actions.length) rows.push([ev.id, ev.start_at, ev.end_at||'', ev.mode, String(ev.target_kw), String(ev.reduced_kw||''), '', '', '', '', ''].join(','));
      ev.actions.forEach(a => {
        rows.push([ev.id, ev.start_at, ev.end_at||'', ev.mode, String(ev.target_kw), String(ev.reduced_kw||''), a.ts, a.device_id, a.action, a.by, (a.note||'').replace(/,/g,';')].join(','));
      });
    });
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'grid-events.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) return <div className="p-4">Loading…</div>;

  return (
    <main className="max-w-5xl mx-auto p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Grid · Events</h1>
        <button className="btn btn-light" onClick={exportCsv}>Export CSV</button>
      </div>

      <ul className="grid gap-3 mt-3">
        {events.map(ev => (
          <li key={ev.id} className="card">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="font-medium">Event {ev.id}</div>
                <div className="text-xs text-gray-500">
                  {new Date(ev.start_at).toLocaleString()} → {ev.end_at ? new Date(ev.end_at).toLocaleString() : '…'}
                  {' · '}Mode {ev.mode} · Target {ev.target_kw} kW
                  {typeof ev.reduced_kw !== 'undefined' && <> · Est. reduced {ev.reduced_kw} kW</>}
                </div>
              </div>
              {!ev.end_at && <button className="btn btn-light" onClick={() => stop(ev)}>Stop & compute</button>}
            </div>

            {!!ev.actions.length && (
              <div className="mt-3">
                <div className="text-xs text-gray-500 mb-1">Timeline</div>
                <div className="rounded border bg-gray-50 p-2 text-sm">
                  {ev.actions.map((a, i) => (
                    <div key={i} className="flex items-center justify-between">
                      <div>
                        <b>{a.action.toUpperCase()}</b> · {nameFor(a.device_id)} · {new Date(a.ts).toLocaleTimeString()}
                        {a.note && <span className="text-gray-500"> — {a.note}</span>}
                      </div>
                      {!ev.end_at && a.action === 'shed' && (
                        <button className="btn btn-light !py-1 !px-2" onClick={() => restore(ev, a.device_id)}>Restore now</button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
