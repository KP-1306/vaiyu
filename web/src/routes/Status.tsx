import { useEffect, useState } from "react";
import SEO from "../components/SEO";
import { API } from "../lib/api";
import { ping, type PingResult } from "../lib/ping";

type Check = {
  name: string;
  url: string;
  result?: PingResult;
};

export default function Status() {
  const [checks, setChecks] = useState<Check[]>([
    { name: "Web (this page)", url: location.origin + "/" },
    { name: "API: /health", url: `${API}/health` },
    { name: "API: owner peek", url: `${API}/owner/peek/sunrise` }, // demo slug
  ]);
  const [running, setRunning] = useState(false);

  async function run() {
    setRunning(true);
    const results: Check[] = [];
    for (const c of checks) {
      const r = await ping(c.url, 5000);
      results.push({ ...c, result: r });
    }
    setChecks(results);
    setRunning(false);
  }

  useEffect(() => { run(); /* run once on load */ }, []); // eslint-disable-line

  return (
    <main id="main" className="mx-auto max-w-3xl px-4 py-8 space-y-6">
      <SEO title="Status" canonical={`${location.origin}/status`} description="VAiyu service health and API latency." />
      <h1 className="text-2xl font-semibold">Status</h1>
      <p className="text-sm text-gray-600">Quick self-checks for the website and API.</p>

      <div className="flex items-center gap-2">
        <button className="btn" onClick={run} disabled={running}>{running ? "Checking…" : "Re-run checks"}</button>
        <span className="text-xs text-gray-500">API base: <code>{API}</code></span>
      </div>

      <div className="grid gap-3">
        {checks.map((c) => {
          const r = c.result;
          const ok = r?.ok;
          const chip = ok ? "badge-success" : "badge-warn";
          return (
            <div key={c.name} className="card">
              <div className="flex items-center justify-between">
                <div className="font-medium">{c.name}</div>
                <span className={`badge ${chip}`}>
                  {ok ? "OK" : "Issue"}
                </span>
              </div>
              <div className="mt-2 text-sm text-gray-700 break-all">{c.url}</div>
              {r && (
                <div className="mt-2 text-sm text-gray-700 flex flex-wrap gap-4">
                  <div><span className="text-gray-500">Status:</span> {r.status ?? "—"}</div>
                  <div><span className="text-gray-500">Latency:</span> {r.ms} ms</div>
                  {!ok && <div className="text-rose-700"><span className="text-gray-500">Error:</span> {r.error ?? "Unknown"}</div>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-xs text-gray-500">
        Notes: API timings include network and server time. The owner peek uses a demo slug (<code>sunrise</code>).
      </p>
    </main>
  );
}
