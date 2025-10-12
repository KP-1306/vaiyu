import { useEffect, useMemo, useState } from 'react';
import { gridGetDevices, gridDeviceShed, gridDeviceRestore, Device } from '../lib/api';

/* --------------------------- local demo helpers --------------------------- */

function demoDevices(): Device[] {
  return [
    { id: 'pool-pump',     name: 'Pool Pump',      group: 'pumps',   priority: 1, control: 'advisory', power_kw: 2.2, min_off: 30, max_off: 60, on: true },
    { id: 'corridor-fans', name: 'Corridor Fans',  group: 'fans',    priority: 1, control: 'advisory', power_kw: 1.0, min_off: 20, max_off: 45, on: true },
    { id: 'laundry',       name: 'Laundry Bank',   group: 'laundry', priority: 2, control: 'advisory', power_kw: 3.5, min_off: 30, max_off: 90, on: true },
  ] as unknown as Device[];
}

/* --------------------------------- page ---------------------------------- */

export default function GridDevices() {
  const [items, setItems] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [demoMode, setDemoMode] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const apiItems = await gridGetDevices().catch(() => []);
        if (apiItems && apiItems.length) {
          setItems(apiItems);
          setDemoMode(false);
        } else {
          setItems(demoDevices());
          setDemoMode(true);
        }
      } catch {
        setItems(demoDevices());
        setDemoMode(true);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const totalKW = useMemo(
    () => Math.round((items.reduce((s, d) => s + (d.power_kw ?? 0), 0)) * 10) / 10,
    [items]
  );

  async function doAction(d: Device, action: 'shed' | 'restore') {
    // Manual-mode UX: checklist message before confirming
    const msg =
      action === 'shed'
        ? `Ask staff to pause "${d.name}" for ${d.min_off ?? 30}-${d.max_off ?? 60} min.\nConfirm to log this action.`
        : `Confirm restore for "${d.name}".`;
    if (!confirm(msg)) return;

    try {
      if (!demoMode) {
        if (action === 'shed') await gridDeviceShed(d.id);
        else await gridDeviceRestore(d.id);
      }
      // Update local view in both modes (API or demo)
      setItems(prev =>
        prev.map(x =>
          x.id === d.id ? { ...x, on: action === 'restore' } : x
        )
      );
    } catch (e: any) {
      alert(e?.message || 'Failed');
    }
  }

  function loadDemoManually() {
    setItems(demoDevices());
    setDemoMode(true);
  }

  if (loading) return <div className="p-4">Loading…</div>;

  return (
    <main className="max-w-5xl mx-auto p-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">
          Grid · Devices {demoMode && <span className="text-xs text-amber-600 ml-2">(demo)</span>}
        </h1>
        <div className="flex gap-2">
          <div className="text-sm text-gray-600 self-center">
            {items.length} devices · ~{totalKW} kW
          </div>
          <button className="btn btn-light" onClick={loadDemoManually}>
            Load demo devices
          </button>
        </div>
      </div>

      {!items.length && (
        <div className="card mt-3">
          <div className="font-medium mb-1">No devices found</div>
          <div className="text-sm text-gray-600">
            Connect BMS/smart plugs later. For now, load a demo set to explore the flow.
          </div>
          <div className="mt-2">
            <button className="btn" onClick={loadDemoManually}>Load demo devices</button>
          </div>
        </div>
      )}

      {!!items.length && (
        <>
          <p className="text-sm text-gray-600 mt-2 mb-3">
            Manual mode — actions are advisory; we log what staff does. In demo mode, buttons
            toggle state locally so you can practice the flow.
          </p>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
            {items.map(d => (
              <div key={d.id} className="card">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-medium">{d.name}</div>
                    <div className="text-xs text-gray-500">
                      {d.group || '—'} · Priority {d.priority} · {d.control}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      Est. {d.power_kw ?? 0} kW
                      {typeof d.min_off !== 'undefined' && typeof d.max_off !== 'undefined' && (
                        <> · Off {d.min_off}-{d.max_off} min</>
                      )}
                    </div>
                  </div>
                  <span
                    className={`text-xs px-2 py-0.5 rounded ${
                      d.on ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-200 text-gray-700'
                    }`}
                  >
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
        </>
      )}
    </main>
  );
}
