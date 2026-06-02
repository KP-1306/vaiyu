// web/src/components/packages/PackageLandingInclusions.tsx

import { Check, Compass, MapPin, UtensilsCrossed } from 'lucide-react';
import type { PublicPackagePayload } from '../../types/package';

interface Props {
  payload: PublicPackagePayload;
}

export function PackageLandingInclusions({ payload }: Props) {
  const { food_inclusions, activity_inclusions, transfer_inclusions, custom_inclusions } = payload.package;
  const groups = [
    { label: 'Meals & dining',  icon: UtensilsCrossed, items: food_inclusions },
    { label: 'Activities',      icon: Compass,         items: activity_inclusions },
    { label: 'Transfers',       icon: MapPin,          items: transfer_inclusions },
    { label: 'Extras',          icon: Check,           items: custom_inclusions },
  ];
  const nonEmpty = groups.filter((g) => g.items.length > 0);

  if (nonEmpty.length === 0) return null;

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 sm:p-8">
      <h2 className="text-base font-semibold text-slate-900 mb-4">What's included</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        {nonEmpty.map(({ label, icon: Icon, items }) => (
          <div key={label}>
            <div className="flex items-center gap-2 text-sm font-medium text-slate-800 mb-2">
              <Icon className="h-4 w-4 text-emerald-600" aria-hidden />
              {label}
            </div>
            <ul className="space-y-1.5 text-sm text-slate-700">
              {items.map((it) => (
                <li key={it} className="flex items-start gap-2">
                  <Check className="h-3.5 w-3.5 mt-0.5 shrink-0 text-emerald-500" aria-hidden />
                  <span>{it}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
