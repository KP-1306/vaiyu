import { useState } from 'react';

type Device = { id: string; name: string; group: string; control: string; power_kw: number; on?: boolean; };

const seed: Device[] = [
  { id: 'pool-pump', name: 'Pool Pump', group: 'pumps', control: 'advisory', power_kw: 2.2, on: true },
  { id: 'corridor-fans', name: 'Corridor Fans', group: 'fans', control: 'advisory', power_kw: 1.0, on: true },
  { id: 'laundry', name: 'Laundry Bank', group: 'laundry', control: 'advisory', power_kw: 3.5, on: true },
];

export default function GridDevices() {
  const [devices, setDevices] = useState(seed);
  function shed(id: string)  { setDevices(d => d.map(x => x.id===id? {...x, on:false}:x)); }
  function restore(id: string){ setDevices(d => d.map(x => x.id===id? {...x, on:true}:x)); }

  return (
    <main className="max-w-4xl mx-auto p-4">
      <h1 className="text-xl font-semibold">Grid: Devices (demo)</h1>
      <p className="text-sm text-gray-600 mb-3">Manual mode: actions are advisory only; logs in the real product.</p>
      <ul className="grid sm:grid-cols-2 gap-3">
        {devices.map(d => (
          <li key={d.id} className="card">
            <div className="font-medium">{d.name}</div>
            <div className="text-xs text-gray-600">{d.group} • {d.control} • {d.power_kw} kW</div>
            <div className="mt-2 flex gap-2">
              <button className="btn btn-light" onClick={() => shed(d.id)} disabled={!d.on}>Shed</button>
              <button className="btn" onClick={() => restore(d.id)} disabled={d.on}>Restore</button>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
