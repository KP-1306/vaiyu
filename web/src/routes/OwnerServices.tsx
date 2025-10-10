import { useEffect, useMemo, useState } from "react";
import OwnerGate from "../components/OwnerGate";
import { getServices } from "../lib/api";

// Optional enhanced endpoints (if you add API routes below):
import { saveServices as apiSave, upsertService as apiUpsert, deleteService as apiDelete } from "../lib/api";

type Service = { key: string; label_en: string; sla_minutes: number };

const LKEY = "owner:services:local";

export default function OwnerServices() {
  const [rows, setRows] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [draft, setDraft] = useState<Service>({ key: "", label_en: "", sla_minutes: 30 });
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [useLocalFallback, setUseLocalFallback] = useState(false);

  useEffect(() => {
    (async () => {
      setErr(null);
      setLoading(true);
      try {
        const r = await getServices();
        const items = (r as any)?.items || [];
        setRows(items as Service[]);
      } catch (e: any) {
        // Fallback to local storage if API POST/PATCH/DELETE not added yet
        const raw = localStorage.getItem(LKEY);
        if (raw) {
          setRows(JSON.parse(raw));
          setUseLocalFallback(true);
        } else {
          setErr(e?.message || "Failed to load services");
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter(
      (r) =>
        r.key.toLowerCase().includes(s) ||
        r.label_en.toLowerCase().includes(s) ||
        String(r.sla_minutes).includes(s)
    );
  }, [rows, q]);

  function resetDraft() {
    setDraft({ key: "", label_en: "", sla_minutes: 30 });
    setEditingKey(null);
  }

  function startEdit(s: Service) {
    setDraft({ ...s });
    setEditingKey(s.key);
  }

  // Save to API (preferred) else localStorage
  async function saveAllToApiOrLocal(next: Service[]) {
    try {
      await apiSave(next); // POST /catalog/services (replace-all)
      setUseLocalFallback(false);
    } catch {
      // fallback to local only
      localStorage.setItem(LKEY, JSON.stringify(next));
      setUseLocalFallback(true);
    }
    setRows(next);
  }

  async function upsertOne(s: Service) {
    // optimistic update
    const exists = rows.some((r) => r.key === s.key);
    const updated = exists ? rows.map((r) => (r.key === s.key ? s : r)) : [s, ...rows];

    try {
      await apiUpsert(s); // PATCH/POST single
      setUseLocalFallback(false);
    } catch {
      localStorage.setItem(LKEY, JSON.stringify(updated));
      setUseLocalFallback(true);
    }
    setRows(updated);
  }

  async function deleteOne(key: string) {
    const updated = rows.filter((r) => r.key !== key);
    try {
      await apiDelete(key);
      setUseLocalFallback(false);
    } catch {
      localStorage.setItem(LKEY, JSON.stringify(updated));
      setUseLocalFallback(true);
    }
    setRows(updated);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const cleanKey = draft.key.trim().toLowerCase().replace(/\s+/g, "_");
    if (!cleanKey) return alert("Service key is required");
    if (!draft.label_en.trim()) return alert("Label is required");
    const s: Service = { key: cleanKey, label_en: draft.label_en.trim(), sla_minutes: Math.max(1, Number(draft.sla_minutes) || 30) };

    if (editingKey && editingKey !== cleanKey) {
      // key changed: remove old, add new
      const pruned = rows.filter((r) => r.key !== editingKey);
      await saveAllToApiOrLocal([s, ...pruned]);
    } else {
      await upsertOne(s);
    }
    resetDraft();
  }

  return (
    <OwnerGate>
      <main className="max-w-3xl mx-auto p-4 space-y-4">
        <header className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">Services & SLA</h1>
            <div className="text-sm text-gray-600">
              Define guest services (e.g., Towel, Room Cleaning) and their SLA mins.
            </div>
          </div>
          <input
            className="input"
            placeholder="Search services…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ width: 240 }}
          />
        </header>

        {err && <div className="card" style={{ borderColor: "#f59e0b" }}>⚠️ {err}</div>}
        {loading && <div>Loading…</div>}

        {useLocalFallback && (
          <div className="card" style={{ borderColor: "#f59e0b" }}>
            Using local storage (API save endpoints not detected). You can still manage services for demo purposes.
          </div>
        )}

        <section className="card">
          <form onSubmit={submit} className="grid sm:grid-cols-5 gap-3 items-end">
            <label className="text-sm sm:col-span-2">
              Key
              <input
                className="input mt-1"
                placeholder="towel"
                value={draft.key}
                onChange={(e) => setDraft((p) => ({ ...p, key: e.target.value }))}
              />
            </label>
            <label className="text-sm sm:col-span-2">
              Label
              <input
                className="input mt-1"
                placeholder="Towel"
                value={draft.label_en}
                onChange={(e) => setDraft((p) => ({ ...p, label_en: e.target.value }))}
              />
            </label>
            <label className="text-sm">
              SLA (mins)
              <input
                type="number"
                min={1}
                className="input mt-1"
                value={draft.sla_minutes}
                onChange={(e) => setDraft((p) => ({ ...p, sla_minutes: Number(e.target.value || 0) }))}
              />
            </label>
            <div className="flex gap-2">
              <button className="btn" type="submit">{editingKey ? "Update" : "Add"}</button>
              {editingKey && (
                <button className="btn btn-outline" type="button" onClick={resetDraft}>
                  Cancel
                </button>
              )}
            </div>
          </form>
        </section>

        <section className="card">
          {!filtered.length ? (
            <div className="text-gray-600">No services.</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 160 }}>Key</th>
                  <th>Label</th>
                  <th style={{ width: 120 }}>SLA (mins)</th>
                  <th style={{ width: 200 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr key={s.key}>
                    <td className="font-mono">{s.key}</td>
                    <td>{s.label_en}</td>
                    <td>{s.sla_minutes}</td>
                    <td>
                      <div className="flex gap-2">
                        <button className="btn btn-light" onClick={() => startEdit(s)}>
                          Edit
                        </button>
                        <button
                          className="btn btn-outline"
                          onClick={() => {
                            if (!confirm(`Delete service "${s.label_en}"?`)) return;
                            deleteOne(s.key);
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </main>
    </OwnerGate>
  );
}
