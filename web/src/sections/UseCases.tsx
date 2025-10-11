// web/src/sections/UseCases.tsx
import { Link } from "react-router-dom";

type Case = {
  title: string;
  body: string;
  cta: { label: string; to: string };
  badge?: string;
  extra?: JSX.Element;
};

const cases: Case[] = [
  {
    title: "Pre-check-in",
    body: "Guests share ID & ETA ahead of arrival; faster front-desk flow.",
    cta: { label: "Try pre-check-in", to: "/precheck/DEMO" },
  },
  {
    title: "Guest Menu & Services",
    body: "Zomato-style F&B + quick service tickets with live ETA.",
    cta: { label: "Open menu", to: "/menu" },
  },
  {
    title: "Checkout & Billing",
    body: "Transparent folio, UPI payments, and truth-anchored reviews.",
    cta: { label: "Go to checkout", to: "/checkout/DEMO" },
  },
  // NEW
  {
    title: "Refer & Earn + Credits",
    badge: "New",
    body:
      "Guests refer friends using VAiyu Account ID / registered phone / email. Credits are issued after the friend’s checkout and are property-scoped—redeem on F&B and services.",
    cta: { label: "See my credits", to: "/guest" },
    extra: (
      <p className="text-[11px] text-gray-500 mt-1">
        Anti-abuse: no self-referrals; credit only after completion; per-property caps & expiry.
      </p>
    ),
  },
];

export default function UseCases() {
  return (
    <section className="max-w-6xl mx-auto px-6 py-12 bg-white">
      <h2 className="text-2xl font-semibold">Use-cases</h2>
      <p className="text-gray-600 text-sm mt-1">
        Ship faster with opinionated guest & operations workflows.
      </p>

      <ul className="mt-6 grid gap-4 md:grid-cols-2">
        {cases.map((c) => (
          <li key={c.title} className="rounded-2xl border p-5 bg-white">
            <div className="flex items-center gap-2">
              <div className="text-lg font-medium">{c.title}</div>
              {c.badge && (
                <span className="text-[10px] px-2 py-0.5 rounded-full border bg-green-50 text-green-700">
                  {c.badge}
                </span>
              )}
            </div>
            <p className="text-sm text-gray-600 mt-2">{c.body}</p>
            {c.extra}
            <div className="mt-4">
              <Link to={c.cta.to} className="px-3 py-2 rounded-xl border hover:bg-gray-50 text-sm">
                {c.cta.label}
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
