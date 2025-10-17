import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import Spinner from "../components/Spinner";

type Profile = {
  full_name: string | null;
  phone: string | null;
  avatar_url: string | null;
  // optional extras if your table has them
  gender?: string | null;
  dob?: string | null; // ISO yyyy-mm-dd
};

function hasCol(cols: string[], name: string) {
  return cols.includes(name);
}

export default function Profile() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [email, setEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [cols, setCols] = useState<string[]>([]); // columns that actually exist
  const [p, setP] = useState<Profile>({
    full_name: "",
    phone: "",
    avatar_url: null,
  });

  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        // 1) Who am I?
        const { data: u, error: uErr } = await supabase.auth.getUser();
        if (uErr) throw uErr;
        const uid = u.user?.id ?? null;
        if (!uid) throw new Error("Not signed in.");
        if (!mounted) return;

        setUserId(uid);
        setEmail(u.user?.email ?? null);

        // 2) Detect which columns exist so we can read/write safely
        let existingCols: string[] = ["id", "email", "full_name", "phone", "avatar_url"];
        try {
          const { data: oneRow } = await supabase
            .from("user_profiles")
            .select("*")
            .eq("id", uid)
            .limit(1)
            .maybeSingle();

          if (oneRow) existingCols = Object.keys(oneRow);
        } catch {
          // ignore, we’ll keep the defaults
        }
        if (!mounted) return;
        setCols(existingCols);

        // 3) Read my profile row (if any)
        const { data: prof, error } = await supabase
          .from("user_profiles")
          .select(
            [
              "full_name",
              "phone",
              "avatar_url",
              hasCol(existingCols, "gender") ? "gender" : undefined,
              hasCol(existingCols, "dob") ? "dob" : undefined,
            ]
              .filter(Boolean)
              .join(",")
          )
          .eq("id", uid)
          .maybeSingle();

        if (!mounted) return;

        if (error && error.code !== "PGRST116") throw error; // ignore “no rows”
        if (prof) {
          setP((old) => ({
            ...old,
            full_name: prof.full_name ?? "",
            phone: prof.phone ?? "",
            avatar_url: prof.avatar_url ?? null,
            ...(hasCol(existingCols, "gender") ? { gender: prof.gender ?? null } : {}),
            ...(hasCol(existingCols, "dob") ? { dob: prof.dob ?? null } : {}),
          }));
        }
      } catch (e: any) {
        setErr(e?.message ?? "Could not load profile");
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  async function save() {
    if (!userId) return;
    setSaving(true);
    setErr(null);
    setOk(null);
    try {
      // Build payload only with columns that exist
      const payload: Record<string, any> = {
        id: userId,
        full_name: p.full_name ?? null,
        phone: p.phone ?? null,
        avatar_url: p.avatar_url ?? null,
      };
      if (hasCol(cols, "gender")) payload.gender = p.gender ?? null;
      if (hasCol(cols, "dob")) payload.dob = p.dob ?? null;

      const { error } = await supabase
        .from("user_profiles")
        .upsert(payload, { onConflict: "id" });

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
    if (!f || !userId) return;
    try {
      setSaving(true);
      const key = `avatars/${userId}-${Date.now()}-${f.name}`;
      const { error: upErr } = await supabase.storage
        .from("public")
        .upload(key, f, { upsert: true });
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
      {ok && (
        <div className="rounded-md bg-green-50 border border-green-200 text-green-800 px-3 py-2 text-sm">
          {ok}
        </div>
      )}
      {err && (
        <div className="rounded-md bg-red-50 border border-red-200 text-red-700 px-3 py-2 text-sm">
          {err}
        </div>
      )}

      <section className="rounded-2xl p-4 shadow bg-white border">
        <div className="flex items-center gap-4">
          <div
            className="w-16 h-16 rounded-full bg-indigo-100 grid place-items-center overflow-hidden border"
            aria-label="Avatar"
          >
            {p.avatar_url ? (
              <img src={p.avatar_url} alt="Avatar" className="w-full h-full object-cover" />
            ) : (
              <span className="text-indigo-700 font-semibold text-lg">
                {(email?.[0] || "G").toUpperCase()}
              </span>
            )}
          </div>
          <div className="text-sm">
            <div className="font-medium">Change avatar</div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              onChange={onAvatarChange}
              className="mt-1"
            />
            <div className="text-gray-500">JPG/PNG, &lt;~1MB is ideal.</div>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium">Full name</label>
            <input
              className="mt-1 w-full rounded-lg border px-3 py-2"
              value={p.full_name ?? ""}
              onChange={(e) => setP({ ...p, full_name: e.target.value })}
              placeholder="Your name"
            />
          </div>

          <div>
            <label className="block text-sm font-medium">Phone</label>
            <input
              className="mt-1 w-full rounded-lg border px-3 py-2"
              value={p.phone ?? ""}
              onChange={(e) => setP({ ...p, phone: e.target.value })}
              placeholder="+91…"
            />
          </div>

          {hasCol(cols, "gender") && (
            <div>
              <label className="block text-sm font-medium">Gender</label>
              <select
                className="mt-1 w-full rounded-lg border px-3 py-2"
                value={p.gender ?? ""}
                onChange={(e) => setP({ ...p, gender: e.target.value || null })}
              >
                <option value="">—</option>
                <option>Male</option>
                <option>Female</option>
                <option>Non-binary</option>
                <option>Prefer not to say</option>
              </select>
            </div>
          )}

          {hasCol(cols, "dob") && (
            <div>
              <label className="block text-sm font-medium">Date of birth</label>
              <input
                type="date"
                className="mt-1 w-full rounded-lg border px-3 py-2"
                value={p.dob ?? ""}
                onChange={(e) => setP({ ...p, dob: e.target.value || null })}
              />
            </div>
          )}
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
