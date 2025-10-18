import { useEffect, useMemo, useRef, useState } from "react";
import { fetchJSON, asObject } from "../lib/safeFetch";
import IntelligenceLoop from "../components/IntelligenceLoop";

type Status = { ok?: boolean; env?: string; version?: string } | null;

export default function HomeOrApp() {
  const [status, setStatus] = useState<Status>(null);
  const [err, setErr] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const apiBase = useMemo(() => {
    // Be forgiving if env var missing—don’t crash, just skip call
    const v = (import.meta as any)?.env?.VITE_API_URL || "";
    return typeof v === "string" ? v : "";
  }, []);

  useEffect(() => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    (async () => {
      if (!apiBase) {
        setErr("API not configured (VITE_API_URL missing). Showing offline home.");
        return;
      }
      try {
        const data = await fetchJSON(`${apiBase}/status`, {
          timeoutMs: 5000,
          retries: 1,
          signal: abortRef.current.signal,
        });
        setStatus(asObject(data));
        setErr(null);
      } catch (e: any) {
        console.error("[HomeOrApp] status error", e);
        setErr(e?.message || "Failed to reach backend");
      }
    })();

    return () => abortRef.current?.abort();
  }, [apiBase]);

  return (
    <main className="p-8 space-y-6">
      <h1 className="text-2xl font-semibold">Welcome to VAiyu</h1>

      {err && (
        <div className="p-4 border rounded-xl bg-yellow-50 text-sm">
          <b>Degraded:</b> {err}
        </div>
      )}

      <section className="p-4 border rounded-xl bg-white/60">
        <h2 className="font-medium">App Status</h2>
        <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
          <dt>Backend reachable</dt>
          <dd>{status?.ok ? "Yes" : err ? "No (offline)" : "Checking…"}</dd>
          <dt>Environment</dt>
          <dd>{status?.env ?? "—"}</dd>
          <dt>Version</dt>
          <dd>{status?.version ?? "—"}</dd>
        </dl>
      </section>

      <section className="p-4 border rounded-xl bg-white/60">
        <p className="text-gray-700">
          Use the top links or go directly to{" "}
          <a className="text-blue-700 underline" href="/guest">
            Guest Dashboard
          </a>.
        </p>
      </section>

      {/* ✅ New: Public “Use Cases / VAiyu Intelligence Loop” */}
      <section id="use-cases" className="py-8 md:py-12 bg-white">
  <div className="mx-auto max-w-7xl px-0 md:px-8">
    <IntelligenceLoop theme="light" />
  </div>
</section>
    </main>
  );
}
