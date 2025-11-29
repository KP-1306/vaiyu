// web/src/routes/WorkforceProfile.tsx

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import SEO from "../components/SEO";
import BackHome from "../components/BackHome";
import {
  fetchMyWorkforceProfile,
  saveMyWorkforceProfile,
  type WorkforceProfile,
} from "../lib/api";

function toCsv(arr?: string[] | null) {
  return (arr || []).join(", ");
}
function fromCsv(s: string): string[] {
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

export default function WorkforceProfilePage() {
  const [profile, setProfile] = useState<WorkforceProfile | null>(null);
  const [skillsCsv, setSkillsCsv] = useState("");
  const [rolesCsv, setRolesCsv] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr(null);
      setOk(null);
      try {
        const { data } = await supabase.auth.getSession();
        const token = data?.session?.access_token;

        if (!token) {
          throw new Error("Please sign in to set up your workforce profile.");
        }

        const existing = await fetchMyWorkforceProfile(token);
        const base: WorkforceProfile =
          existing || {
            full_name: "",
            headline: "",
            city: "",
            state: "",
            country: "India",
            skills: [],
            preferred_roles: [],
          };

        if (!cancelled) {
          setProfile(base);
          setSkillsCsv(toCsv(base.skills));
          setRolesCsv(toCsv(base.preferred_roles));
        }
      } catch (e: any) {
        if (!cancelled) {
          setErr(e?.message || "Failed to load workforce profile");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function patch<K extends keyof WorkforceProfile>(key: K, val: WorkforceProfile[K]) {
    setProfile((prev) => (prev ? { ...prev, [key]: val } : { [key]: val } as any));
  }

  async function handleSave() {
    if (!profile) return;
    setSaving(true);
    setErr(null);
    setOk(null);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data?.session?.access_token;
      if (!token) {
        throw new Error("Session expired. Please sign in again.");
      }

      const payload: Partial<WorkforceProfile> = {
        ...profile,
        skills: fromCsv(skillsCsv),
        preferred_roles: fromCsv(rolesCsv),
      };

      const saved = await saveMyWorkforceProfile(payload, token);
      setProfile(saved);
      setSkillsCsv(toCsv(saved.skills));
      setRolesCsv(toCsv(saved.preferred_roles));
      setOk("Profile saved successfully.");
    } catch (e: any) {
      setErr(e?.message || "Failed to save profile");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <SEO title="Workforce profile – Labour Beta" noIndex />
      <main className="max-w-3xl mx-auto p-4 space-y-4">
        <BackHome />

        <header className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">
              Workforce profile{" "}
              <span className="ml-2 text-xs rounded-full bg-amber-100 text-amber-700 px-2 py-0.5 uppercase tracking-wide">
                Labour Beta
              </span>
            </h1>
            <p className="text-sm text-gray-600">
              Tell nearby hotels what kind of work you&apos;re open to.{" "}
              <span className="font-medium">
                Your contact details are visible only to properties you apply to.
              </span>
            </p>
          </div>
        </header>

        {err && (
          <div className="card border border-red-300 bg-red-50 text-sm text-red-800">
            {err}
          </div>
        )}
        {ok && (
          <div className="card border border-emerald-300 bg-emerald-50 text-sm text-emerald-800">
            {ok}
          </div>
        )}

        {loading && (
          <div className="card text-sm text-gray-600">Loading profile…</div>
        )}

        {!loading && profile && (
          <section className="bg-white rounded shadow p-4 space-y-4">
            <div className="grid md:grid-cols-2 gap-3">
              <label className="text-sm">
                Full name
                <input
                  className="mt-1 input w-full"
                  value={profile.full_name || ""}
                  onChange={(e) => patch("full_name", e.target.value)}
                />
              </label>
              <label className="text-sm">
                Headline
                <input
                  className="mt-1 input w-full"
                  placeholder="Housekeeping | 3 yrs | Night shifts OK"
                  value={profile.headline || ""}
                  onChange={(e) => patch("headline", e.target.value)}
                />
              </label>
              <label className="text-sm">
                City
                <input
                  className="mt-1 input w-full"
                  value={profile.city || ""}
                  onChange={(e) => patch("city", e.target.value)}
                />
              </label>
              <label className="text-sm">
                State
                <input
                  className="mt-1 input w-full"
                  value={profile.state || ""}
                  onChange={(e) => patch("state", e.target.value)}
                />
              </label>
              <label className="text-sm">
                Country
                <input
                  className="mt-1 input w-full"
                  value={profile.country || ""}
                  onChange={(e) => patch("country", e.target.value)}
                />
              </label>
              <label className="text-sm">
                Experience (years)
                <input
                  type="number"
                  min={0}
                  className="mt-1 input w-full"
                  value={profile.experience_years ?? ""}
                  onChange={(e) =>
                    patch(
                      "experience_years",
                      e.target.value === ""
                        ? null
                        : Number(e.target.value) || 0
                    )
                  }
                />
              </label>
            </div>

            <div className="grid md:grid-cols-2 gap-3 pt-2">
              <label className="text-sm">
                Skills (CSV)
                <input
                  className="mt-1 input w-full"
                  placeholder="Housekeeping, Front desk, Kitchen helper"
                  value={skillsCsv}
                  onChange={(e) => setSkillsCsv(e.target.value)}
                />
              </label>
              <label className="text-sm">
                Roles you&apos;re open to (CSV)
                <input
                  className="mt-1 input w-full"
                  placeholder="Housekeeping, Cook, Night security"
                  value={rolesCsv}
                  onChange={(e) => setRolesCsv(e.target.value)}
                />
              </label>
            </div>

            <div className="pt-3 flex gap-2">
              <button
                className="btn"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? "Saving…" : "Save profile"}
              </button>
            </div>
          </section>
        )}
      </main>
    </>
  );
}
