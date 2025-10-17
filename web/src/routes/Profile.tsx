import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export default function Profile() {
  const [loading, setLoading] = useState(true);
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", phone: "" });

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));
      if (!mounted) return;
      const u = data?.user;
      setForm({
        name: (u?.user_metadata?.name as string) || "",
        phone: (u?.user_metadata?.phone as string) || "",
      });
      setLoading(false);
    })();
    return () => { mounted = false; };
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setOk(null); setErr(null);
    try {
      setLoading(true);
      // Store in user_metadata (quick) — replace with your own API/profile table if needed
      const { error } = await supabase.auth.updateUser({ data: { name: form.name, phone: form.phone } });
      if (error) throw error;
      setOk("Profile updated.");
    } catch (e: any) {
      setErr(e?.message || "Could not update profile.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="max-w-xl mx-auto p-6 space-y-4">
      <h1 className="text-xl font-semibold">Your profile</h1>

      {ok && <div className="rounded-md bg-green-50 text-green-800 p-3 text-sm">{ok}</div>}
      {err && <div className="rounded-md bg-red-50 text-red-700 p-3 text-sm">{err}</div>}

      <form className="space-y-3" onSubmit={save}>
        <div>
          <label className="block text-sm font-medium">Full name</label>
          <input className="mt-1 w-full rounded-lg border px-3 py-2" value={form.name}
                 onChange={(e)=>setForm({...form, name:e.target.value})} disabled={loading}/>
        </div>
        <div>
          <label className="block text-sm font-medium">Phone</label>
          <input className="mt-1 w-full rounded-lg border px-3 py-2" value={form.phone}
                 onChange={(e)=>setForm({...form, phone:e.target.value})} disabled={loading}/>
        </div>
        <button className="btn w-full" type="submit" disabled={loading}>
          {loading ? "Saving…" : "Save changes"}
        </button>
      </form>
    </main>
  );
}
