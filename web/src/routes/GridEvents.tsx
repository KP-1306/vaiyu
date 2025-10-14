import { useEffect, useMemo, useState } from 'react';
import {
  gridListEvents,
  gridStopEvent,
  gridStepEvent,
  gridGetDevices,
  GridEvent,
  Device,
} from '../lib/api';

import GridEventsTable from "../components/GridEventsTable";
import type { GridEventRow } from "../lib/energy";

/* --------------------------- local demo helpers --------------------------- */

function demoDevices(): Device[] {
  return [
    { id: 'pool-pump', name: 'Pool Pump', group: 'pumps', priority: 1, control: 'advisory', power_kw: 2.2, on: true },
    { id: 'corridor-fans', name: 'Corridor Fans', group: 'fans', priority: 1, control: 'advisory', power_kw: 1.0, on: true },
    { id: 'laundry', name: 'Laundry Bank', group: 'laundry', priority: 2, control: 'advisory', power_kw: 3.5, on: true },
  ] as unknown as Device[];
}

function mkDemoEvent(devs: Device[]): GridEvent {
  const now = Date.now();
  const step = (m: number) => new Date(now + m * 60_000).toISOString();

  const actions = [
    { ts: step(0),  device_id: 'pool-pump',    action: 'shed',    by: 'system', note: '45m' },
    { ts: step(2),  device_id: 'corridor-fans',action: 'shed',    by: 'system', note: '30m' },
    { ts: step(40), device_id: 'pool-pump',    action: 'restore', by: 'staff',  note: 'manual restore' },
  ] as GridEvent['actions'];

  const target_kw =
    (devs.find(d => d.id === 'pool-pump')?.power_kw ?? 0) +
    (devs.find(d => d.id === 'corridor-fans')?.power_kw ?? 0) +
    (devs.find(d => d.id === 'laundry')?.power_kw ?? 0) * 0; // laundry not shed in demo

  return {
    id: 'DEMO',
    start_at: new Date(now).toISOString(),
    end_at: undefined,
    mode: 'manual',
    target_kw,
    reduced_kw: undefined,
    actions,
  } as GridEvent;
}

/** crude estimate: sum(shed device kW) × event hours (until stop) */
function estimateReducedKw(ev: GridEvent, devs: Device[]): number {
  const shedIds = new Set(ev.actions.filter(a => a.action === 'shed').map(a => a.device_id));
  const kW = Array.from(shedIds).reduce((sum, id) => sum + (devs.find(d => d.id === id)?.power_kw ?? 0), 0);
  const start = new Date(ev.start_at).getTime();
  const end = new Date(ev.end_at || Date.now()).getTime();
  const hours = Math.max(0.25, (end - start) / 3_600_000); // floor to 15 min
  return Math.round(kW * hours * 10) / 10; // 1 decimal
}

/* --------------------------------- page ---------------------------------- */

export default function GridEvents() {
  const [events, setEvents] = useState<GridEvent[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [demoMode, setDemoMode] = useState(false);

  // load from API; if empty or error -> demo
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        let dev = await gridGetDevices().catch(() => []);
        if (!dev || !dev.length) dev = demoDevices();
        setDevices(dev);

        const ev = await gridListEvents();
        const items = ev.items || [];
        if (!items.length) {
          // seed demo if API has nothing
          setEvents([mkDemoEvent(dev)]);
          setDemoMode(true);
        } else {
          setEvents(items);
          setDemoMode(false);
        }
      } catch {
        // full fallback
        const dev = demoDevices();
        setDevices(dev);
        setEvents([mkDemoEvent(dev)]);
        setDemoMode(true);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function nameFor(id: string) { return devices.find(d => d.id === id)?.name || id; }

  async function stop(ev: GridEvent) {
    if (!confirm('Stop this event and compute estimated savings?')) return;

    if (!demoMode) {
      // real API
      const r = await gridStopEvent(ev.id);
      setEvents(prev => prev.map(x => x.id === ev.id ? r.event : x));
    } else {
      // local compute
      const end_at = new Date().toISOString();
      const reduced_kw = estimateReducedKw({ ...ev, end_at }, devices);
      setEvents(prev => prev.map(x => x.id === ev.id ? { ...x, end_at, reduced_kw } : x));
    }
  }

  const rows: GridEventRow[] = events.map((e: any) => ({
  id: e.id,
  deviceId: e.deviceId,
  deviceName: e.deviceName,
  startedAt: e.startedAt,
  endedAt: e.endedAt ?? null,
  action: e.action,            // "shed" | "restore"
  watts: e.watts ?? null,
}));

<GridEventsTable events={rows} currency="₹" />
  
  async function restore(ev: GridEvent, device_id: string) {
    if (!demoMode) {
      await gridStepEvent(ev.id, device_id, 'restore', 'manual restore');
      const { items } = await gridListEvents();
      setEvents(items || []);
    } else {
      // local update
      const action = { ts: new Date().toISOString(), device_id, action: 'restore' as const, by: 'staff' as const, note: 'manual restore' };
      setEvents(prev => prev.map(x => x.id === ev.id ? { ...x, actions: [...x.actions, action] } : x));
    }
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

  function loadDemoManually() {
    setDevices(prev => prev.length ? prev : demoDevices());
    setEvents([mkDemoEvent(devices.length ? devices : demoDevices())]);
    setDemoMode(true);
  }

  if (loading) return <div className="p-4">Loading…</div>;

  return (
    <main className="max-w-5xl mx-auto p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Grid · Events {demoMode && <span className="text-xs text-amber-600 ml-2">(demo)</span>}</h1>
        <div className="flex gap-2">
          <button className="btn btn-light" onClick={exportCsv}>Export CSV</button>
          <button className="btn btn-light" onClick={loadDemoManually}>Load demo event</button>
        </div>
      </div>

      {!events.length && (
        <div className="card mt-3">
          <div className="font-medium mb-1">No events yet</div>
          <div className="text-sm text-gray-600">Start an event from the Devices page or load a demo.</div>
          <div className="mt-2"><button className="btn" onClick={loadDemoManually}>Load demo event</button></div>
        </div>
      )}

      <ul className="grid gap-3 mt-3">
        {events.map(ev => (
          <li key={ev.id} className="card">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="font-medium">{ev.id === 'DEMO' ? 'Peak-hour shed (demo)' : `Event ${ev.id}`}</div>
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
                    <div key={i} className="flex items-center justify-between py-0.5">
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
