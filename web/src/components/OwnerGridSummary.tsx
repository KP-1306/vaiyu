// web/src/components/OwnerGridSummary.tsx
import { useEffect, useMemo, useState } from 'react';
import { gridListEvents, gridGetDevices, GridEvent, Device } from '../lib/api';

function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function startOfWeek(d = new Date()) {
  const x = new Date(d);
  const day = x.getDay(); // 0 = Sun
  const diff = x.getDate() - day + (day === 0 ? -6 : 1); // Mon start
  x.setDate(diff);
  x.setHours(0, 0, 0, 0);
  return x;
}

export default function OwnerGridSummary() {
  const [events, setEvents] = useState<GridEvent[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string>('');

  useEffect(() => {
    (async () => {
      setLoading(true);
      setErr('');
      try {
        const [{ items }, devs] = await Promise.all([gridListEvents(), gridGetDevices()]);
        setEvents(items || []);
        setDevices(devs || []);
      } catch (e: any) {
        setErr(e?.message || 'Failed to load grid events');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const nameFor = (id: string) => devices.find(d => d.id === id)?.name || id;

  const stats = useMemo(() => {
    const today0 = startOfDay();
    const week0 = startOfWeek();

    let today = 0;
    let week = 0;
    let reducedKwTotal = 0;

    // device shed counts
    const shedCount = new Map<string, number>();

    for (const ev of events) {
      const startAt = new Date(ev.start_at);
      if (startAt >= today0) today++;
      if (startAt >= week0) week++;

      if (typeof ev.reduced_kw === 'number') {
        reducedKwTotal += ev.reduced_kw;
      }

      for (const a of ev.actions) {
        if (a.action === 'shed') {
          shedCount.set(a.device_id, (shedCount.get(a.device_id) || 0) + 1);
        }
      }
    }

    // top 3 devices by shed count
    const top = Array.from(shedCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([id, count]) => ({ id, name: nameFor(id), count }));

    return {
      today,
      week,
      reducedKwTotal: Number(reducedKwTotal.toFixed(2)),
      top,
    };
  }, [events, devices]);

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs text-gray-500">Grid</div>
          <div className="font-semibold">Peak-Hour Summary</div>
        </div>
        <a href="/grid/events" className="btn btn-light">Open Events</a>
      </div>

      {loading && <div className="text-sm text-gray-600 mt-2">Loading…</div>}
      {err && <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 mt-2">{err}</div>}

      {!loading && !err && (
        <>
          <div className="grid grid-cols-3 gap-3 mt-3">
            <Kpi label="Events today" value={String(stats.today)} />
            <Kpi label="Events this week" value={String(stats.week)} />
            <Kpi label="Est. kW reduced" value={String(stats.reducedKwTotal)} />
          </div>

          <div className="mt-4">
            <div className="text-xs text-gray-500 mb-1">Top devices by sheds</div>
            {stats.top.length ? (
              <ul className="text-sm text-gray-700 space-y-1">
                {stats.top.map(d => (
                  <li key={d.id} className="flex items-center justify-between">
                    <span>{d.name}</span>
                    <span className="text-gray-500">{d.count}×</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-sm text-gray-500">No shed actions yet</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-white p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-xl font-semibold mt-1">{value}</div>
    </div>
  );
}
