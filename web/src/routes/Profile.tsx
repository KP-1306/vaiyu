// web/src/routes/Profile.tsx
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import Spinner from "../components/Spinner";

type Profile = { full_name: string | null; phone: string | null; avatar_url: string | null };

export default function Profile() {
  const nav = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [email, setEmail] = useState<string | null>(null);
  const [p, setP] = useState<Profile>({ full_name: "", phone: "", avatar_url: null });
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [{ data: u }, { data: prof, error }] = await Promise.all([
          supabase.auth.getUser(),
          supabase.from("user_profiles").select("full_name, phone, avatar_url").single(),
        ]);
        if (!mounted) return;
        setEmail(u.user?.email ?? null);
        if (error && error.code !== "PGRST116") throw error; // ignore ‘no rows’
        if (prof) setP({ full_name: prof.full_name, phone: prof.phone, avatar_url: prof.avatar_url });
      } catch (e: any) {
        setErr(e?.message ?? "Could not load profile");
      } finally {
        setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  async function save() {
    setSaving(true);
    setErr(null);
    setOk(null);
    try {
      const { error } = await supabase.from("user_profiles").upsert(
        {
          id: (await supabase.auth.getUser()).data.user?.id,
          full_name: p.full_name,
          phone: p.phone,
          avatar_url: p.avatar_url ?? null,
        },
        { onConflict: "id" }
      );
      if (error) throw error;
      setOk("Profile updated.");
    } catch (e: any) {
      setErr(e?.message ?? "Could not save profile");
    } finally {
      setSaving(false);
    }
  }

  async function onAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      setSaving(true);
      const userId = (await supabase.auth.getUser()).data.user!.id;
      const key = `avatars/${userId}-${Date.now()}-${f.name}`;
      const { error: upErr } = await supabase.storage.from("public").upload(key, f, { upsert: true });
      if (upErr) throw upErr;
      const { data: url } = supabase.storage.from("public").getPublicUrl(key);
      setP((old) => ({ ...old, avatar_url: url.publicUrl }));
      setOk("Avatar updated. Don’t forget to Save changes.");
    } catch (e: any) {
      setErr(e?.message ?? "Could not upload avatar");
    } finally {
      setSaving(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  if (loading) {
    return (
      <div className="min-h-[50vh] grid place-items-center">
        <Spinner label="Loading profile…" />
      </div>
    );
  }

  return (
    <main className="max-w-3xl mx-auto p-4 space-y-5">
      {/* Top bar */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Your profile</h1>
          <div className="text-sm text-gray-600">{email ?? ""}</div>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/guest" className="btn btn-light" aria-label="Back to dashboard">
            ← Back to dashboard
          </Link>
        </div>
      </div>

      {/* Alerts */}
      {ok && <div className="rounded-md bg-green-50 border border-green-200 text-green-800 px-3 py-2 text-sm">{ok}</div>}
      {err && <div className="rounded-md bg-red-50 border border-red-200 text-red-700 px-3 py-2 text-sm">{err}</div>}

      <section className="rounded-2xl p-4 shadow bg-white border">
        <div className="flex items-center gap-4">
          <div
            className="w-16 h-16 rounded-full bg-indigo-100 grid place-items-center overflow-hidden border"
            aria-label="Avatar"
          >
            {p.avatar_url ? (
              <img src={p.avatar_url} alt="Avatar" className="w-full h-full object-cover" />
            ) : (
              <span className="text-indigo-700 font-semibold text-lg">{(email?.[0] || "G").toUpperCase()}</span>
            )}
          </div>
          <div className="text-sm">
            <div className="font-medium">Change avatar</div>
            <input ref={fileRef} type="file" accept="image/*" onChange={onAvatarChange} className="mt-1" />
            <div className="text-gray-500">JPG/PNG, &lt;~1MB is ideal.</div>
          </div>
        </div>

        <div className="mt-5 space-y-3">
          <div>
            <label className="block text-sm font-medium">Full name</label>
            <input
              className="mt-1 w-full rounded-lg border px-3 py-2"
              value={p.full_name ?? ""}
              onChange={(e) => setP({ ...p, full_name: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-sm font-medium">Phone</label>
            <input
              className="mt-1 w-full rounded-lg border px-3 py-2"
              value={p.phone ?? ""}
              onChange={(e) => setP({ ...p, phone: e.target.value })}
            />
          </div>
        </div>

        <div className="mt-5">
          <button className="btn" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </button>
          <Link to="/guest" className="btn btn-light ml-2">
            Cancel
          </Link>
        </div>
      </section>
    </main>
  );
}
