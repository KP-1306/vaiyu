// web/src/routes/OwnerServices.tsx
import { useEffect, useMemo, useState } from "react";
import OwnerGate from "../components/OwnerGate";
import SEO from "../components/SEO";
import Empty from "../components/Empty";
import { getServices, saveServices as apiSave } from "../lib/api";

type Service = { key: string; label_en: string; sla_minutes: number; active?: boolean };

const LKEY = "owner:services:local";

export default function OwnerServices() {
  const [rows, setRows] = useState<Service[] | null>(null);
  const [filter, setFilter] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<{ t: string; d?: string; kind?: "ok" | "err" } | null>(null);

  // 1) Load services (fallback to local cache if API fails)
  useEffect(() => {
    let ok = true;
    (async () => {
      try {
        const r = await getServices();
        if (!ok) return;
        const items: Service[] = Array.isArray(r?.items) ? r.items : [];
        if (items.length) {
          setRows(items.map(n => ({ ...n, active: n.active ?? true })));
          localStorage.setItem(LKEY, JSON.stringify(items));
        } else {
          const cached = localStorage.getItem(LKEY);
          setRows(cached ? (JSON.parse(cached) as Service[]) : []);
        }
      } catch (e: any) {
        const cached = localStorage.getItem(LKEY);
        setRows(cached ? (JSON.parse(cached) as Service[]) : []);
        setErr(e?.message || String(e));
      }
    })();
    return () => { ok = false; };
  }, []);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      r => r.key.toLowerCase().includes(q) || (r.label_en || "").toLowerCase().includes(q)
    );
  }, [rows, filter]);

  function patch(i: number, p: Partial<Service>) {
    if (!rows) return;
    const next = rows.map((r, idx) => (idx === i ? { ...r, ...p } : r));
    setRows(next);
    setDirty(true);
  }

  function addRow() {
    const draft: Service = { key: "new_service", label_en: "New Service", sla_minutes: 30, active: true };
    setRows([...(rows || []), draft]);
    setDirty(true);
  }

  async function saveAll() {
    if (!rows) return;
    const bad = rows.find(r => !r.key?.trim() || !r.label_en?.trim() || r.sla_minutes < 0);
    if (bad) {
      setToast({ t: "Fix validation", d: "Key & Label are required; SLA must be ≥ 0.", kind: "err" });
      return;
    }
    setSaving(true);
    try {
      await apiSave(rows);
      setDirty(false);
      setToast({ t: "Saved", d: "Services updated.", kind: "ok" });
    } catch (e: any) {
      // fallback local cache
      localStorage.setItem(LKEY, JSON.stringify(rows));
      setToast({
        t: "Saved locally (API failed)",
        d: e?.message || String(e),
        kind: "err",
      });
    } finally {
      setSaving(false);
      setTimeout(() => setToast(null), 3000);
    }
  }

  return (
    <>
      <SEO title="Owner Services (SLA)" noIndex />
      <OwnerGate roles={["owner", "manager"]}>
        <div className="space-y-4">
          <header className="flex items-center gap-2">
            <input
              className="input max-w-sm"
              placeholder="Filter by key or label…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              aria-label="Filter services"
            />
            <div className="ml-auto flex items-center gap-2">
              <button className="btn btn-light" onClick={addRow}>Add service</button>
              <button className="btn" disabled={!dirty || saving} onClick={saveAll}>
                {saving ? "Saving…" : "Save changes"}
              </button>
            </div>
          </header>

          {toast && (
            <div
              className={`rounded-lg px-3 py-2 text-sm ${
                toast.kind === "err" ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"
              }`}
              role="status"
            >
              <div className="font-medium">{toast.t}</div>
              {toast.d && <div className="opacity-80">{toast.d}</div>}
            </div>
          )}

          {err && (
            <div className="text-sm text-orange-600">
              Loaded from cache because API failed: {err}
            </div>
          )}

          {!rows ? (
            <div className="card p-6">
              <div className="text-sm text-muted-foreground">Loading services…</div>
              <div className="mt-3 h-2 w-full rounded bg-gray-200 overflow-hidden">
                <div className="h-full w-1/3 bg-gray-400 animate-pulse" />
              </div>
            </div>
          ) : rows.length === 0 ? (
            <Empty
              title="No services yet"
              hint='Click “Add service” to create your first row.'
            />
          ) : (
            <div className="rounded-xl border overflow-hidden">
              <div className="grid grid-cols-12 px-4 py-2 text-xs uppercase tracking-wide text-muted-foreground border-b bg-muted/40">
                <div className="col-span-3">Key</div>
                <div className="col-span-5">Label</div>
                <div className="col-span-2">SLA (min)</div>
                <div className="col-span-2 text-right">Active</div>
              </div>

              {filtered.map((r, i) => (
                <div
                  key={`${r.key}-${i}`}
                  className="grid grid-cols-12 items-center px-4 py-3 border-b"
                >
                  <div className="col-span-3 pr-2">
                    <input
                      className="input"
                      value={r.key}
                      onChange={(e) => patch(i, { key: e.target.value })}
                      aria-label={`Service key row ${i + 1}`}
                    />
                  </div>
                  <div className="col-span-5 pr-2">
                    <input
                      className="input"
                      value={r.label_en}
                      onChange={(e) => patch(i, { label_en: e.target.value })}
                      aria-label={`Service label row ${i + 1}`}
                    />
                  </div>
                  <div className="col-span-2 pr-2">
                    <input
                      className="input"
                      type="number"
                      min={0}
                      value={r.sla_minutes}
                      onChange={(e) => patch(i, { sla_minutes: Number(e.target.value) })}
                      aria-label={`SLA minutes row ${i + 1}`}
                    />
                  </div>
                  <div className="col-span-2 flex justify-end">
                    <label className="inline-flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={r.active ?? true}
                        onChange={(e) => patch(i, { active: e.target.checked })}
                        aria-label={`Toggle active for ${r.key}`}
                      />
                      <span className="text-sm text-gray-700">Active</span>
                    </label>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="text-xs text-muted-foreground">
            Changes save via your API (<code>saveServices</code>). If the API fails,
            they’re cached in this browser under <code>{LKEY}</code>.
          </div>
        </div>
      </OwnerGate>
    </>
  );
}
