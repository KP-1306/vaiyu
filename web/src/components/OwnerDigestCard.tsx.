import { useEffect, useMemo, useState } from "react";
import { downloadCsv } from "../lib/downloadCsv";
import { track } from "../lib/analytics";

type Digest = {
  date: string;                  // ISO day
  ticketsOpened: number;
  ticketsClosed: number;
  onTimePct: number;             // 0..100
  avgMinutesToClose: number;     // float
  lateCount: number;
  // optional richer bits used for CSV
  closedSamples?: Array<{
    id: string;
    kind: string;                // hk | maint | desk | order
    openedAt: string;            // ISO
    closedAt: string;            // ISO
    minutesToClose: number;
    onTime: boolean;
  }>;
};

function demoDigest(slug: string): Digest {
  const rnd = (min: number, max: number) => Math.round(min + Math.random() * (max - min));
  const open = rnd(18, 42);
  const closed = rnd(15, open);
  const onTimePct = rnd(72, 93);
  const avg = rnd(14, 38);
  const late = Math.max(0, Math.round(closed * (1 - onTimePct / 100)));
  const now = new Date();
  const samples = Array.from({ length: closed }).map((_, i) => {
    const openedAt = new Date(now.getTime() - (i + 1) * 60 * 60 * 1000);
    const dur = rnd(8, 60);
    const closedAt = new Date(openedAt.getTime() + dur * 60 * 1000);
    return {
      id: `${slug}-${i + 1}`,
      kind: ["hk", "maint", "desk", "order"][i % 4],
      openedAt: openedAt.toISOString(),
      closedAt: closedAt.toISOString(),
      minutesToClose: dur,
      onTime: dur <= 30,
    };
  });
  return {
    date: now.toISOString().slice(0, 10),
    ticketsOpened: open,
    ticketsClosed: closed,
    onTimePct,
    avgMinutesToClose: avg,
    lateCount: late,
    closedSamples: samples,
  };
}

async function fetchDigest(apiBase: string, slug: string, isoDay: string): Promise<Digest | null> {
  try {
    const url = new URL(`${apiBase.replace(/\/$/, "")}/owner/digest`);
    url.searchParams.set("slug", slug);
    url.searchParams.set("date", isoDay);
    const r = await fetch(url.toString(), { credentials: "include" });
    if (!r.ok) return null;
    return (await r.json()) as Digest;
  } catch {
    return null;
  }
}

export default function OwnerDigestCard({ slug, apiBase, className = "" }: { slug: string; apiBase: string; className?: string }) {
  const [digest, setDigest] = useState<Digest | null>(null);
  const [loading, setLoading] = useState(true);
  const [isoDay] = useState(() => new Date().toISOString().slice(0, 10));

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      const server = await fetchDigest(apiBase, slug, isoDay);
      const data = server || demoDigest(slug);
      if (mounted) {
        setDigest(data);
        setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [apiBase, slug, isoDay]);

  const rows = useMemo(() => {
    if (!digest?.closedSamples?.length) return [];
    return digest.closedSamples.map(s => ({
      id: s.id,
      type: s.kind,
      openedAt: s.openedAt,
      closedAt: s.closedAt,
      minutesToClose: s.minutesToClose,
      onTime: s.onTime ? "yes" : "no",
    }));
  }, [digest]);

  function onExport() {
    if (!rows.length) return;
    const fname = `owner-digest-${slug}-${isoDay}.csv`;
    downloadCsv(fname, rows);
    track("export_csv", { page: "owner_home", slug, date: isoDay });
  }

  return (
    <div className={`rounded-2xl border border-black/10 bg-white p-5 ${className}`}>
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-sm text-gray-500">What changed today</div>
          <div className="text-xs text-gray-500">{slug} · {isoDay}</div>
        </div>
        <button
          onClick={onExport}
          disabled={!rows.length}
          className="rounded-xl border px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50"
          title={rows.length ? "Download CSV" : "No closed items yet"}
        >
          Export CSV
        </button>
      </div>

      <div className="mt-4 grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Kpi label="Tickets opened" value={loading ? "—" : digest?.ticketsOpened ?? 0} />
        <Kpi label="Tickets closed" value={loading ? "—" : digest?.ticketsClosed ?? 0} />
        <Kpi label="On-time %" value={loading ? "—" : `${Math.round(digest?.onTimePct ?? 0)}%`} good />
        <Kpi label="Late" value={loading ? "—" : digest?.lateCount ?? 0} warn />
        <Kpi label="Avg mins to close" value={loading ? "—" : Math.round(digest?.avgMinutesToClose ?? 0)} />
      </div>

      <ul className="mt-4 list-disc pl-5 text-sm text-gray-600">
        <li>Includes requests from Desk/HK/Maint/orders.</li>
        <li>On-time = closed within SLA target; late are highlighted.</li>
      </ul>
    </div>
  );
}

function Kpi({ label, value, good, warn }: { label: string; value: string | number; good?: boolean; warn?: boolean }) {
  const chip =
    good ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
    warn ? "bg-amber-50 text-amber-700 border-amber-200" :
           "bg-gray-50 text-gray-700 border-gray-200";
  return (
    <div className={`rounded-xl border ${chip} p-3`}>
      <div className="text-xs">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}
