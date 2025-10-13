// web/src/routes/Demo.tsx
import { Link } from "react-router-dom";

type DemoLink = {
  to: string;
  title: string;
  subtitle: string;
  emoji: string;
  external?: boolean; // optional: open in new tab
};

const guest: DemoLink[] = [
  { to: "/hotel/sunrise", title: "Property microsite", subtitle: "Public-facing page guests see", emoji: "🏖️" },
  { to: "/precheck/DEMO", title: "Pre-check-in", subtitle: "Faster arrivals with e-reg", emoji: "🧾" },
  { to: "/stay/DEMO/menu", title: "Guest menu", subtitle: "One-tap requests & tracking", emoji: "📱" },
];

const staff: DemoLink[] = [
  { to: "/desk", title: "Front Desk", subtitle: "Live SSE tickets; no refresh", emoji: "🛎️" },
  { to: "/hk", title: "Housekeeping", subtitle: "Clean tickets & SLAs", emoji: "🧹" },
  { to: "/kitchen", title: "Kitchen", subtitle: "Room service & F&B orders", emoji: "🍽️" },
];

const owner: DemoLink[] = [
  { to: "/owner/dashboard", title: "Owner dashboard", subtitle: "KPIs, bottlenecks & hints", emoji: "📈" },
  { to: "/owner/reviews", title: "Review moderation", subtitle: "AI drafts grounded in stay data", emoji: "📝" },
  { to: "/grid/devices", title: "Grid: Devices", subtitle: "Manual → Assist → Auto", emoji: "⚡" },
  { to: "/grid/events", title: "Grid: Events", subtitle: "Savings log & CSV export", emoji: "📃" },
];

export default function Demo() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-white to-gray-50 text-gray-900">
      {/* Top bar */}
      <header className="sticky top-0 z-20 backdrop-blur bg-white/70 border-b border-gray-100">
        <div className="mx-auto max-w-7xl px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="inline-block h-6 w-6 rounded-lg" style={{ background: 'var(--brand, #145AF2)' }} />
            <span className="font-semibold">VAiyu Demo</span>
            <span className="ml-2 text-xs rounded-full px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200">
              PWA skeleton is running
            </span>
          </div>
          <Link to="/" className="text-sm text-gray-600 hover:text-gray-900">← Back to website</Link>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-7xl px-4 py-10">
        <div className="max-w-3xl">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Choose a demo route</h1>
          <p className="mt-2 text-gray-600">
            Short, focused flows that show how VAiyu upgrades the stay — for guests, staff, and owners.
          </p>
        </div>

        {/* Sections */}
        <div className="mt-8 grid gap-6">
          <Section title="Guest experience" items={guest} color="sky" />
          <Section title="Staff ops" items={staff} color="amber" />
          <Section title="Owner & grid" items={owner} color="violet" />
        </div>

        {/* Tips row */}
        <div className="mt-10 grid md:grid-cols-3 gap-3">
          <Tip title="Best viewed on mobile too" text="Scan the property microsite & pre-check-in on your phone." />
          <Tip title="Live SSE" text="Front Desk updates without page reloads; mention this during demo." />
          <Tip title="AI + Grid are new" text="Call out review drafts & grid manual mode — no hardware required to start." />
        </div>
      </section>
    </main>
  );
}

/* ---------- sections & cards ---------- */

function Section({
  title,
  items,
  color = "sky",
}: {
  title: string;
  items: DemoLink[];
  color?: "sky" | "amber" | "violet";
}) {
  const ring =
    color === "sky"
      ? "ring-sky-200 hover:ring-sky-300"
      : color === "amber"
      ? "ring-amber-200 hover:ring-amber-300"
      : "ring-violet-200 hover:ring-violet-300";

  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <span
          className={`h-2 w-2 rounded-full ${
            color === "sky" ? "bg-sky-500" : color === "amber" ? "bg-amber-500" : "bg-violet-500"
          }`}
        />
        <h2 className="font-semibold">{title}</h2>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {items.map((it) => (
          <CardLink key={it.to} {...it} ring={ring} />
        ))}
      </div>
    </section>
  );
}

function CardLink({
  to,
  title,
  subtitle,
  emoji,
  ring,
  external,
}: DemoLink & { ring: string }) {
  const absolute = new URL(to, location.origin).toString();

  function copy() {
    navigator.clipboard.writeText(absolute).catch(() => {});
  }

  return (
    <div className={`group rounded-xl border bg-white ring-1 ${ring} transition-shadow hover:shadow-md`}>
      <div className="p-4 flex items-start justify-between gap-3">
        <div>
          <div className="text-xl">{emoji}</div>
          <div className="font-semibold mt-1">{title}</div>
          <div className="text-sm text-gray-600 mt-0.5">{subtitle}</div>
        </div>

        <div className="flex gap-2">
          <button
            className="text-xs px-2 py-1 rounded border hover:bg-gray-50"
            onClick={copy}
            title="Copy deep link"
          >
            Copy link
          </button>
          {external ? (
            <a
              href={to}
              target="_blank"
              rel="noreferrer"
              className="text-xs px-2 py-1 rounded border hover:bg-gray-50"
              title="Open in new tab"
            >
              Open ↗
            </a>
          ) : (
            <Link
              to={to}
              className="text-xs px-2 py-1 rounded border hover:bg-gray-50"
              title="Open"
            >
              Open →
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

function Tip({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="text-sm font-medium">{title}</div>
      <div className="text-sm text-gray-600 mt-1">{text}</div>
    </div>
  );
}
