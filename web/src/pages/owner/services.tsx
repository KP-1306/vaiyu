import { useEffect, useMemo, useState } from "react";
import { supa } from "@/lib/db";
import { hasRole, Role } from "@/lib/rbac";
import NoAccess from "@/components/NoAccess";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/use-toast";

// replace with your actual auth/profile hook
function useAuth() {
  // expected: { user, profile: { role: "owner"|"manager"|... , hotel_id, tenant_slug } }
  // wire to your existing auth gate
  // @ts-ignore
  return window.__FAKE_AUTH__ || { user: { id: "x" }, profile: { role: "owner", hotel_id: null, tenant_slug: "default" } };
}

type Service = {
  hotel_id: string | null;
  key: string;
  label: string;
  sla_minutes: number;
  active: boolean;
};

export default function OwnerServicesPage() {
  const { profile } = useAuth();
  const role = (profile?.role ?? "guest") as Role;
  const hotelId = profile?.hotel_id ?? null;
  const { toast } = useToast();

  const [rows, setRows] = useState<Service[] | null>(null);
  const [filter, setFilter] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const canEdit = hasRole(role, ["owner", "manager"]);

  useEffect(() => {
    let ok = true;
    (async () => {
      try {
        // scope to hotel_id if you store it; otherwise pull all by tenant in RLS
        const q = hotelId
          ? supa.from("services").select("hotel_id,key,label,sla_minutes,active").eq("hotel_id", hotelId).order("key")
          : supa.from("services").select("hotel_id,key,label,sla_minutes,active").order("key");

        const { data, error } = await q;
        if (error) throw error;
        if (ok) setRows(data as Service[]);
      } catch (e: any) {
        if (ok) {
          setRows([]);
          toast({ title: "Failed to load services", description: e.message ?? String(e), variant: "destructive" });
        }
      }
    })();
    return () => { ok = false; };
  }, [hotelId]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r => r.key.toLowerCase().includes(q) || (r.label||"").toLowerCase().includes(q));
  }, [rows, filter]);

  function patch(i: number, p: Partial<Service>) {
    if (!rows) return;
    const next = rows.map((r, idx) => (idx === i ? { ...r, ...p } : r));
    setRows(next);
    setDirty(true);
  }

  async function saveAll() {
    if (!rows) return;
    // basic validation
    const bad = rows.find(r => !r.key || !r.label || r.sla_minutes < 0);
    if (bad) {
      toast({ title: "Fix validation", description: "Key/Label required, SLA >= 0", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      // upsert each (conflict target: hotel_id + key)
      const payload = rows.map(r => ({
        hotel_id: r.hotel_id ?? hotelId, // set if null
        key: r.key.trim(),
        label: r.label.trim(),
        sla_minutes: Number(r.sla_minutes) || 0,
        active: !!r.active,
      }));

      const { error } = await supa.from("services").upsert(payload, { onConflict: "hotel_id,key" });
      if (error) throw error;

      toast({ title: "Saved", description: "Services updated" });
      setDirty(false);
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message ?? String(e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  if (!canEdit) return <NoAccess hint="You need Owner/Manager role to edit services." />;

  if (!rows) {
    return <div className="text-sm text-muted-foreground">Loading services…</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Input placeholder="Filter by key/label…" value={filter} onChange={e => setFilter(e.target.value)} className="max-w-sm" />
        <div className="ml-auto flex items-center gap-2">
          {dirty && <span className="text-xs text-muted-foreground">Unsaved changes</span>}
          <Button disabled={!dirty || saving} onClick={saveAll}>{saving ? "Saving…" : "Save changes"}</Button>
        </div>
      </div>

      <div className="rounded-xl border overflow-hidden">
        <div className="grid grid-cols-12 px-4 py-2 text-xs uppercase tracking-wide text-muted-foreground border-b bg-muted/40">
          <div className="col-span-3">Key</div>
          <div className="col-span-5">Label</div>
          <div className="col-span-2">SLA (min)</div>
          <div className="col-span-2 text-right">Active</div>
        </div>

        {filtered.map((r, i) => (
          <div key={`${r.key}-${i}`} className="grid grid-cols-12 items-center px-4 py-3 border-b">
            <div className="col-span-3 pr-2">
              <Input value={r.key} onChange={e => patch(i, { key: e.target.value })} aria-label={`Key row ${i+1}`} />
            </div>
            <div className="col-span-5 pr-2">
              <Input value={r.label} onChange={e => patch(i, { label: e.target.value })} aria-label={`Label row ${i+1}`} />
            </div>
            <div className="col-span-2 pr-2">
              <Input type="number" min={0} value={r.sla_minutes} onChange={e => patch(i, { sla_minutes: Number(e.target.value) })} aria-label={`SLA row ${i+1}`} />
            </div>
            <div className="col-span-2 flex justify-end">
              <Switch checked={r.active} onCheckedChange={v => patch(i, { active: Boolean(v) })} aria-label={`Active ${r.key}`} />
            </div>
          </div>
        ))}
      </div>

      <div className="text-xs text-muted-foreground">Changes are written to <code>services</code> with conflict target <code>(hotel_id, key)</code>.</div>
    </div>
  );
}
