// web/src/routes/Demo.tsx
import { Link } from "react-router-dom";
import { useMemo, useState } from "react";

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

/** Ideal story order for the scripted flow */
const SCRIPTED_STEPS: DemoLink[] = [
  guest[0], // microsite
  guest[1], // pre-check-in
  guest[2], // guest menu
  staff[0], // front desk
  staff[1], // housekeeping
  staff[2], // kitchen
  owner[0], // owner dashboard
  owner[1], // review moderation
  owner[2], // grid devices
  owner[3], // grid events
];

export default function Demo() {
  // Scripted demo index (kept in URL-less state so it’s ephemeral)
  const [stepIdx, setStepIdx] = useState(0);
  const current = SCRIPTED_STEPS[stepIdx];

  function next() {
    setStepIdx((i) => Math.min(i + 1, SCRIPTED_STEPS.length - 1));
  }
  function back() {
    setStepIdx((i) => Math.max(i - 1, 0));
  }

  const micrositeUrl = new URL("/hotel/sunrise", location.origin).toString();
  const precheckUrl = new URL("/precheck/DEMO", location.origin).toString();

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

      {/* Scripted demo banner */}
      <div className="mx-auto max-w-7xl px-4 pt-6">
        <div className="rounded-2xl border bg-white p-4 sm:p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="flex-1">
            <div className="text-xs font-medium inline-flex items-center gap-2 px-2 py-1 rounded-full bg-sky-50 text-sky-800 border border-sky-200">
              ▶️ Start scripted demo
            </div>
            <div className="mt-2 font-semibold">
              {current.emoji} {current.title}
            </div>
            <div className="text-sm text-gray-600">{current.subtitle}</div>
            <div className="text-xs text-gray-500 mt-1">
              Step {stepIdx + 1} of {SCRIPTED_STEPS.length}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <CardActions to={current.to} label="Open" />
            <button
              className="text-xs px-2 py-1 rounded border hover:bg-gray-50"
              onClick={() => copyDeepLink(current.to)}
              title="Copy deep link"
            >
              Copy link
            </button>
            <button
              className="text-xs px-2 py-1 rounded border hover:bg-gray-50 disabled:opacity-40"
              onClick={back}
              disabled={stepIdx === 0}
              title="Back"
            >
              ← Back
            </button>
            <button
              className="text-xs px-2 py-1 rounded border hover:bg-gray-50 disabled:opacity-40"
              onClick={next}
              disabled={stepIdx === SCRIPTED_STEPS.length - 1}
              title="Next"
            >
              Next →
            </button>
          </div>
        </div>
      </div>

      {/* Hero */}
      <section className="mx-auto max-w-7xl px-4 py-8">
        <div className="max-w-3xl">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Choose a demo route</h1>
          <p className="mt-2 text-gray-600">
            Short, focused flows that show how VAiyu upgrades the stay — for guests, staff, and owners.
          </p>
        </div>

        {/* QR Panel */}
        <div className="mt-6 grid md:grid-cols-2 gap-3">
          <QRCard title="Property microsite" url={micrositeUrl} hint="Scan to open on phone" />
          <QRCard title="Pre-check-in (demo)" url={precheckUrl} hint="Try the guest flow live" />
        </div>

        {/* Sections */}
        <div className="mt-8 grid gap-6">
          <Section title="Guest experience" items={guest} color="sky" />
          <Section title="Staff ops" items={staff} color="amber" />
          <Section title="Owner & grid" items={owner} color="violet" />
        </div>

        {/* Tips row */}
        <div className="mt-10 grid md:grid-cols-3 gap-3">
          <Tip title="Best viewed on mobile too" text="Scan the microsite & pre-check-in with these QR codes." />
          <Tip title="Live SSE" text="Front Desk updates without page reloads; call it out during the demo." />
          <Tip title="AI + Grid are new" text="Review drafts are facts-based; grid starts in manual mode (no hardware required)." />
        </div>
      </section>
    </main>
  );
}

/* ---------- helpers ---------- */

function absoluteUrl(to: string) {
  return new URL(to, location.origin).toString();
}

function copyDeepLink(to: string) {
  const url = absoluteUrl(to);
  navigator.clipboard.writeText(url).catch(() => {});
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

function CardActions({ to, label = "Open" }: { to: string; label?: string }) {
  return (
    <Link
      to={to}
      className="text-xs px-2 py-1 rounded border hover:bg-gray-50"
      title={label}
    >
      {label} →
    </Link>
  );
}

function CardLink({
  to,
  title,
  subtitle,
  emoji,
  ring,
}: DemoLink & { ring: string }) {
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
            onClick={() => copyDeepLink(to)}
            title="Copy deep link"
          >
            Copy link
          </button>
          <CardActions to={to} />
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

/* ---------- QR component (uses hosted QR API for simplicity) ---------- */
/* If you prefer no external service, swap this with a tiny inline QR SVG generator later. */

function QRCard({ title, url, hint }: { title: string; url: string; hint?: string }) {
  const qrSrc = useMemo(() => {
    const u = new URL("https://api.qrserver.com/v1/create-qr-code/");
    u.searchParams.set("size", "160x160");
    u.searchParams.set("data", url);
    u.searchParams.set("margin", "0");
    return u.toString();
  }, [url]);

  return (
    <div className="rounded-2xl border bg-white p-4 sm:p-5 flex items-center gap-4">
      <img
        src={qrSrc}
        alt={`QR for ${title}`}
        className="h-28 w-28 sm:h-32 sm:w-32 rounded-md border"
        loading="eager"
      />
      <div className="min-w-0">
        <div className="font-semibold">{title}</div>
        {hint && <div className="text-sm text-gray-600">{hint}</div>}
        <div className="text-xs text-gray-500 truncate mt-1">{url}</div>
        <div className="mt-2 flex gap-2">
          <a
            href={url}
            className="text-xs px-2 py-1 rounded border hover:bg-gray-50"
            target="_blank"
            rel="noreferrer"
          >
            Open ↗
          </a>
          <button
            className="text-xs px-2 py-1 rounded border hover:bg-gray-50"
            onClick={() => navigator.clipboard.writeText(url)}
          >
            Copy link
          </button>
        </div>
      </div>
    </div>
  );
}
