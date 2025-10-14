import { useEffect, useState } from 'react';
import { gridGetPlaybooks, gridStartEvent, Playbook } from '../lib/api';
import SEO from "../components/SEO";

export default function GridPlaybooks() {
  const [items, setItems] = useState<Playbook[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try { setItems(await gridGetPlaybooks()); } finally { setLoading(false); }
    })();
  }, []);

  <SEO title="Owner Home" noIndex />
  
  async function run(pb: Playbook) {
    const target = Number(prompt('Target kW to shed (estimate)', '3')) || 0;
    try {
      await gridStartEvent(target, pb.id);
      alert('Playbook started. See Events timeline for details.');
    } catch (e: any) { alert(e?.message || 'Failed'); }
  }

  if (loading) return <div className="p-4">Loading…</div>;

  return (
    <main className="max-w-4xl mx-auto p-4">
      <h1 className="text-xl font-semibold">Grid · Playbooks</h1>
      <div className="grid md:grid-cols-2 gap-3 mt-3">
        {items.map(pb => (
          <div key={pb.id} className="card">
            <div className="font-medium">{pb.name}</div>
            <ul className="text-sm text-gray-600 mt-2 space-y-1">
              {pb.steps.map((s, i) => (
                <li key={i}>• {s.do.toUpperCase()} {s.device_id} ({s.duration_min ?? 30}m)</li>
              ))}
            </ul>
            <div className="mt-3">
              <button className="btn" onClick={() => run(pb)}>Run</button>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
