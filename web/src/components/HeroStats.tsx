import type { HeroMetric } from '../lib/metrics';

export default function HeroStats({ items }: { items: HeroMetric[] }) {
  if (!items?.length) return null;

  return (
    <div className="mx-auto max-w-7xl px-4 -mb-6">
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {items.map(m => (
          <div key={m.id} className="rounded-xl border bg-white/90 backdrop-blur px-4 py-3 shadow-sm">
            <div className="text-xs text-gray-500">{m.emoji ? `${m.emoji} ` : ''}{m.label}</div>
            <div className="text-2xl font-semibold leading-tight mt-0.5">{m.value}</div>
            {m.sub && <div className="text-xs text-gray-500 mt-0.5">{m.sub}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
