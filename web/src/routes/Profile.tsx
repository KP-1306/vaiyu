import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export default function Profile() {
  const [loading, setLoading] = useState(true);
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", phone: "", avatar_url: "" });
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));
      if (!mounted) return;
      const u = data?.user;
      setUserId(u?.id ?? null);
      setForm({
        name: (u?.user_metadata?.name as string) || "",
        phone: (u?.user_metadata?.phone as string) || "",
        avatar_url: (u?.user_metadata?.avatar_url as string) || "",
      });
      setLoading(false);
    })();
    return () => { mounted = false; };
  }, []);

  function onPick(f: File | null) {
    setFile(f);
    if (f) {
      const url = URL.createObjectURL(f);
      setPreview(url);
    } else {
      setPreview(null);
    }
  }

  async function uploadAvatarIfNeeded(): Promise<string | null> {
    if (!file || !userId) return null;
    const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const path = `${userId}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("avatars").upload(path, file, {
      cacheControl: "3600",
      upsert: true,
      contentType: file.type || "image/jpeg",
    });
    if (error) throw error;
    const { data } = supabase.storage.from("avatars").getPublicUrl(path);
    return data.publicUrl || null;
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setOk(null); setErr(null);
    try {
      setLoading(true);
      const avatarUrl = (await uploadAvatarIfNeeded()) || form.avatar_url;

      // Store into user_metadata (quick path). You can mirror into a user_profiles table if you wish.
      const { error } = await supabase.auth.updateUser({
        data: { name: form.name, phone: form.phone, avatar_url: avatarUrl },
      });
      if (error) throw error;

      setForm((f) => ({ ...f, avatar_url: avatarUrl || "" }));
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

      <form className="space-y-4" onSubmit={save}>
        <div className="flex items-start gap-4">
          <div className="w-20 h-20 rounded-full overflow-hidden border bg-gray-50 shrink-0">
            {preview ? (
              <img src={preview} alt="Avatar preview" className="w-full h-full object-cover" />
            ) : form.avatar_url ? (
              <img src={form.avatar_url} alt="Your avatar" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full grid place-items-center text-gray-400">👤</div>
            )}
          </div>
          <div className="grow">
            <label className="block text-sm font-medium">Change avatar</label>
            <input
              type="file"
              accept="image/*"
              className="mt-1 block w-full text-sm"
              onChange={(e) => onPick(e.target.files?.[0] || null)}
            />
            <div className="text-xs text-gray-500 mt-1">JPG/PNG, ~1MB is ideal.</div>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium">Full name</label>
          <input className="mt-1 w-full rounded-lg border px-3 py-2"
                 value={form.name}
                 onChange={(e)=>setForm({...form, name:e.target.value})}
                 disabled={loading}/>
        </div>

        <div>
          <label className="block text-sm font-medium">Phone</label>
          <input className="mt-1 w-full rounded-lg border px-3 py-2"
                 value={form.phone}
                 onChange={(e)=>setForm({...form, phone:e.target.value})}
                 disabled={loading}/>
        </div>

        <button className="btn w-full" type="submit" disabled={loading}>
          {loading ? "Saving…" : "Save changes"}
        </button>
      </form>
    </main>
  );
}
