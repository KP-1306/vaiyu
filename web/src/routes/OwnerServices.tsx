// web/src/routes/OwnerServices.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import OwnerGate from "../components/OwnerGate";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Switch } from "../components/ui/switch";
import { Card } from "../components/ui/card";
import { Progress } from "../components/ui/progress";
import { useToast } from "../components/ui/use-toast";
import SEO from "../components/SEO";
import Empty from "../components/Empty";

import { getServices } from "../lib/api";
import { saveServices as apiSave } from "../lib/api";

type Service = { key: string; label_en: string; sla_minutes: number; active?: boolean };

const LKEY = "owner:services:local";

export default function OwnerServices() {
  const { toast } = useToast();

  const [rows, setRows] = useState<Service[] | null>(null);
  const [filter, setFilter] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // focus the filter for keyboard users
  const filterRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    filterRef.current?.focus();
  }, []);

  // 1) Load services from your existing API; if it fails, use localStorage so the page is still usable.
  useEffect(() => {
    let ok = true;
    (async () => {
      try {
        const r = await getServices(); // your current API helper
        if (!ok) return;
        const items: Service[] = Array.isArray((r as any)?.items) ? (r as any).items : [];
        if (items.length) {
          setRows(items.map(n => ({ ...n, active: n.active ?? true })));
          localStorage.setItem(LKEY, JSON.stringify(items));
        } else {
          // try local cache so UI still works
          const cached = localStorage.getItem(LKEY);
          setRows(cached ? (JSON.parse(cached) as Service[]) : []);
        }
      } catch (e: any) {
        // graceful fallback
        const cached = localStorage.getItem(LKEY);
        setRows(cached ? (JSON.parse(cached) as Service[]) : []);
        setErr(e?.message || String(e));
      }
    })();
    return () => {
      ok = false;
    };
  }, []);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.key.toLowerCase().includes(q) ||
        (r.label_en || "").toLowerCase().includes(q)
    );
  }, [rows, filter]);

  function patch(i: number, p: Partial<Service>) {
    if (!rows) return;
    const next = rows.map((r, idx) => (idx === i ? { ...r, ...p } : r));
    setRows(next);
    setDirty(true);
  }

  function addRow() {
    const draft: Service = {
      key: "new_service",
      label_en: "New Service",
      sla_minutes: 30,
      active: true,
    };
    setRows([...(rows || []), draft]);
    setDirty(true);
  }

  async function saveAll() {
    if (!rows) return;
    // simple validation
    const bad = rows.find(
      (r) => !r.key?.trim() || !r.label_en?.trim() || (r.sla_minutes as number) < 0
    );
    if (bad) {
      toast({
        title: "Fix validation",
        description: "Key & Label are required; SLA must be ≥ 0.",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      if (typeof apiSave === "function") {
        await apiSave(rows);
        toast({ title: "Saved", description: "Services updated." });
      } else {
        // fallback: local cache so you can test the UI now
        localStorage.setItem(LKEY, JSON.stringify(rows));
        toast({
          title: "Saved (local only)",
          description: "API save not wired yet—changes kept in this browser.",
        });
      }
      setDirty(false);
    } catch (e: any) {
      toast({
        title: "Save failed",
        description: e?.message || String(e),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <SEO title="Owner Services (SLA)" noIndex />
      {/* OwnerGate already exists in your repo; it protects owner/manager routes */}
      <OwnerGate roles={["owner", "manager"]}>
        <main className="max-w-5xl mx-auto p-4 space-y-4" aria-labelledby="page-title">
          <h1 id="page-title" className="text-xl font-semibold">Services (SLA)</h1>

          <section className="flex items-center gap-2" aria-label="Service controls">
            <Input
              ref={filterRef}
              placeholder="Filter by key or label…"
              aria-label="Filter services by key or label"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="max-w-sm"
            />
            <div className="ml-auto flex items-center gap-2">
              <Button variant="secondary" onClick={addRow} aria-label="Add a new service">
                Add service
              </Button>
              <Button disabled={!dirty || saving} onClick={saveAll} aria-label="Save changes">
                {saving ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </section>

          {err && (
            <div className="text-sm text-orange-700" role="status" aria-live="polite">
              Loaded from cache because API failed: {err}
            </div>
          )}

          {!rows ? (
            <Card className="p-6" aria-busy="true" aria-live="polite">
              <div className="text-sm text-muted-foreground">Loading services…</div>
              <Progress className="mt-3" value={33} />
            </Card>
          ) : rows.length === 0 ? (
            <Empty
              title="No services yet"
              hint="Add your first service and set an SLA in minutes."
              action={<Button onClick={addRow}>Add service</Button>}
            />
          ) : (
            <section className="rounded-xl border overflow-hidden" aria-label="Services table">
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
                    <Input
                      value={r.key}
                      onChange={(e) => patch(i, { key: e.target.value })}
                      aria-label={`Service key for row ${i + 1}`}
                    />
                  </div>
                  <div className="col-span-5 pr-2">
                    <Input
                      value={r.label_en}
                      onChange={(e) => patch(i, { label_en: e.target.value })}
                      aria-label={`Service label for row ${i + 1}`}
                    />
                  </div>
                  <div className="col-span-2 pr-2">
                    <Input
                      type="number"
                      min={0}
                      value={r.sla_minutes}
                      onChange={(e) =>
                        patch(i, { sla_minutes: Number(e.target.value) })
                      }
                      aria-label={`SLA minutes for row ${i + 1}`}
                    />
                  </div>
                  <div className="col-span-2 flex justify-end">
                    <Switch
                      checked={r.active ?? true}
                      onCheckedChange={(v) => patch(i, { active: Boolean(v) })}
                      aria-label={`Toggle active for ${r.key}`}
                    />
                  </div>
                </div>
              ))}
            </section>
          )}

          <p className="text-xs text-muted-foreground">
            Changes are saved via your API (<code>saveServices</code>). If that isn’t wired yet,
            they’re cached in this browser under <code>{LKEY}</code>.
          </p>
        </main>
      </OwnerGate>
    </>
  );
}
