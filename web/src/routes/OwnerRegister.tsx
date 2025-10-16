// web/src/routes/OwnerRegister.tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

export default function OwnerRegister() {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const nav = useNavigate();

  async function createProperty(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setSaving(true);
    try {
      // naive insert — adjust to your schema
      const { data: session } = await supabase.auth.getSession();
      const userId = session.session?.user.id;
      if (!userId) throw new Error("Not signed in");

      const { data: prop, error: e1 } = await supabase
        .from("properties")
        .insert({ name, slug, created_by: userId })
        .select("id, slug")
        .single();
      if (e1) throw e1;

      // add membership
      await supabase
        .from("property_members")
        .insert({ property_id: prop.id, user_id: userId, role: "owner" });

      nav(`/owner?slug=${encodeURIComponent(prop.slug)}`, { replace: true });
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="max-w-lg mx-auto p-6">
      <h1 className="text-xl font-semibold">Register a property</h1>
      <form className="mt-4 space-y-3" onSubmit={createProperty}>
        <input
          className="input w-full"
          placeholder="Property name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <input
          className="input w-full"
          placeholder="Property slug (e.g., sunrise)"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          required
        />
        {err && <div className="text-sm text-red-600">{err}</div>}
        <button className="btn" disabled={saving} type="submit">
          {saving ? "Saving…" : "Create property"}
        </button>
      </form>
    </main>
  );
}
