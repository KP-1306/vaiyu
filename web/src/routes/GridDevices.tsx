import { useEffect, useState } from 'react';
import { gridGetDevices, gridDeviceShed, gridDeviceRestore, Device } from '../lib/api';

export default function GridDevices() {
  const [items, setItems] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState<string>('');

  useEffect(() => {
    (async () => {
      setLoading(true);
      try { setItems(await gridGetDevices()); } finally { setLoading(false); }
    })();
  }, []);

  async function doAction(d: Device, action: 'shed'|'restore') {
    // Manual-mode UX: checklist message before confirming
    const msg = action === 'shed'
      ? `Ask staff to pause "${d.name}" for ${d.min_off ?? 30}-${d.max_off ?? 60} min. Confirm to log.`
      : `Confirm restore for "${d.name}".`;
    if (!confirm(msg)) return;
    try {
      if (action === 'shed') await gridDeviceShed(d.id);
      else await gridDeviceRestore(d.id);
      setItems(prev => prev.map(x => x.id === d.id ? { ...x, on: action === 'restore' } : x));
    } catch (e: any) { alert(e?.message || 'Failed'); }
  }

  if (loading) return <div className="p-4">Loading…</div>;

  return (
    <main className="max-w-5xl mx-auto p-4">
      <h1 className="text-xl font-semibold">Grid · Devices</h1>
      <p className="text-sm text-gray-600 mb-3">Manual mode — actions are advisory; we log what staff does.</p>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
        {items.map(d => (
          <div key={d.id} className="card">
            <div className="flex items-start justify-between">
              <div>
                <div className="font-medium">{d.name}</div>
                <div className="text-xs text-gray-500">{d.group || '—'} · Priority {d.priority} · {d.control}</div>
                <div className="text-xs text-gray-500 mt-1">Est. {d.power_kw ?? 0} kW</div>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded ${d.on ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-200 text-gray-700'}`}>
                {d.on ? 'ON' : 'OFF'}
              </span>
            </div>

            <div className="mt-3 flex gap-2">
              <button className="btn btn-light" onClick={() => doAction(d, 'shed')}>Shed</button>
              <button className="btn btn-light" onClick={() => doAction(d, 'restore')}>Restore</button>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
