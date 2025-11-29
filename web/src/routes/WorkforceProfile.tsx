// web/src/routes/WorkforceProfile.tsx
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import {
  fetchWorkforceProfile,
  upsertWorkforceProfile,
  listWorkforceJobs,
  applyForWorkforceJob,
  listWorkforceApplications,
  type WorkforceProfile,
  type WorkforceJob,
  type WorkforceApplication,
} from "../lib/api";
import BackHome from "../components/BackHome";
import Spinner from "../components/Spinner";

function useAuthToken() {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) {
        setToken(data.session?.access_token ?? null);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return { token, loading };
}

export default function WorkforceProfilePage() {
  const { token, loading: authLoading } = useAuthToken();
  const [profile, setProfile] = useState<WorkforceProfile | null>(null);
  const [jobs, setJobs] = useState<WorkforceJob[]>([]);
  const [applications, setApplications] = useState<WorkforceApplication[]>([]);
  const [saving, setSaving] = useState(false);
  const [applyingJobId, setApplyingJobId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [expectedSalary, setExpectedSalary] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Load profile + my applications + jobs
  useEffect(() => {
    if (!token || authLoading) return;

    let cancelled = false;

    async function load() {
      try {
        setError(null);
        const [prof, myApps] = await Promise.all([
          fetchWorkforceProfile(token),
          listWorkforceApplications({ mode: "mine", token }),
        ]);

        if (cancelled) return;

        setProfile(prof);
        setApplications(myApps);

        const city = prof?.location_city ?? undefined;
        const state = prof?.location_state ?? undefined;

        const openJobs = await listWorkforceJobs({
          mode: "open",
          city,
          state,
        });

        if (!cancelled) setJobs(openJobs);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load data");
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [token, authLoading]);

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;

    setSaving(true);
    setError(null);
    try {
      const form = e.target as HTMLFormElement;
      const formData = new FormData(form);

      const payload: Partial<WorkforceProfile> = {
        full_name: String(formData.get("full_name") || "").trim() || null,
        headline: String(formData.get("headline") || "").trim() || null,
        location_city:
          String(formData.get("location_city") || "").trim() || null,
        location_state:
          String(formData.get("location_state") || "").trim() || null,
        location_country:
          String(formData.get("location_country") || "IN").trim() || "IN",
        experience_years: formData.get("experience_years")
          ? Number(formData.get("experience_years"))
          : null,
        willing_relocate: formData.get("willing_relocate") === "on",
      };

      const skillsRaw = String(formData.get("skills") || "").trim();
      payload.skills = skillsRaw
        ? skillsRaw.split(",").map((s) => s.trim()).filter(Boolean)
        : null;

      const updated = await upsertWorkforceProfile(payload, token);
      setProfile(updated);
    } catch (e: any) {
      setError(e?.message || "Failed to save profile");
    } finally {
      setSaving(false);
    }
  }

  async function handleApply(job: WorkforceJob) {
    if (!token || !job.id) return;
    setApplyingJobId(job.id);
    setError(null);

    try {
      const app = await applyForWorkforceJob(
        job.id,
        {
          message: message.trim() || undefined,
          expected_salary: expectedSalary || undefined,
        },
        token
      );

      setApplications((prev) => {
        const existing = prev.find((a) => a.id === app.id);
        if (existing) {
          return prev.map((a) => (a.id === app.id ? app : a));
        }
        return [app, ...prev];
      });

      setMessage("");
      setExpectedSalary("");
      alert("Application sent ✅");
    } catch (e: any) {
      setError(e?.message || "Failed to submit application");
    } finally {
      setApplyingJobId(null);
    }
  }

  if (authLoading) {
    return (
      <div className="page">
        <BackHome />
        <div className="flex justify-center items-center py-16">
          <Spinner />
        </div>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="page max-w-3xl mx-auto px-4 py-8">
        <BackHome />
        <h1 className="text-2xl font-semibold mb-4">
          VAiyu Workforce – Experimental
        </h1>
        <p className="mb-4 text-slate-600">
          Sign in with your VAiyu account to create your workforce profile and
          see open jobs from nearby hotels and stays.
        </p>
        <a href="/signin" className="btn btn-primary">
          Sign in to get started
        </a>
      </div>
    );
  }

  const cityState = [
    profile?.location_city,
    profile?.location_state,
    profile?.location_country ?? "IN",
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="page max-w-5xl mx-auto px-4 py-8 space-y-8">
      <BackHome />
      <header className="flex flex-col gap-2 mb-2">
        <h1 className="text-2xl font-semibold">
          VAiyu Workforce <span className="text-xs px-2 py-1 rounded-full bg-amber-100 text-amber-800 align-middle">Labour Beta – Experimental</span>
        </h1>
        <p className="text-slate-600 max-w-2xl text-sm">
          One simple profile that hotels can discover when they need extra
          staff. During peak season, a single click can connect you to hotels
          looking for housekeepers, cooks, front desk, live music and more.
        </p>
        {cityState && (
          <p className="text-xs text-slate-500">
            We’ll use your location ({cityState}) to show nearby jobs.
          </p>
        )}
      </header>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Profile card */}
      <section className="card p-4 md:p-6 space-y-4">
        <h2 className="text-lg font-semibold">Your workforce profile</h2>
        <form className="space-y-4" onSubmit={handleSaveProfile}>
          <div className="grid md:grid-cols-2 gap-4">
            <label className="flex flex-col gap-1 text-sm">
              Full name
              <input
                name="full_name"
                defaultValue={profile?.full_name ?? ""}
                className="input"
                placeholder="Eg. Deepak Kumar"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Headline
              <input
                name="headline"
                defaultValue={profile?.headline ?? ""}
                className="input"
                placeholder="Eg. Housekeeping | 3 yrs experience"
              />
            </label>
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            <label className="flex flex-col gap-1 text-sm">
              City / Town
              <input
                name="location_city"
                defaultValue={profile?.location_city ?? ""}
                className="input"
                placeholder="Eg. Nainital"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              State
              <input
                name="location_state"
                defaultValue={profile?.location_state ?? ""}
                className="input"
                placeholder="Eg. Uttarakhand"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Country
              <input
                name="location_country"
                defaultValue={profile?.location_country ?? "IN"}
                className="input"
              />
            </label>
          </div>

          <div className="grid md:grid-cols-3 gap-4 items-end">
            <label className="flex flex-col gap-1 text-sm">
              Experience (years)
              <input
                name="experience_years"
                type="number"
                min={0}
                defaultValue={profile?.experience_years ?? ""}
                className="input"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm md:col-span-2">
              Skills (comma separated)
              <input
                name="skills"
                defaultValue={profile?.skills?.join(", ") ?? ""}
                className="input"
                placeholder="Eg. housekeeping, front desk, barista"
              />
            </label>
          </div>

          <label className="inline-flex items-center gap-2 text-sm">
            <input
              name="willing_relocate"
              type="checkbox"
              defaultChecked={!!profile?.willing_relocate}
            />
            Willing to relocate for the right opportunity
          </label>

          <div className="flex gap-3">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={saving}
            >
              {saving ? "Saving..." : "Save profile"}
            </button>
            <p className="text-xs text-slate-500 self-center">
              Hotels only see this when you apply or when they search in
              VAiyu&apos;s talent pool.
            </p>
          </div>
        </form>
      </section>

      {/* Jobs + applications */}
      <section className="grid md:grid-cols-3 gap-6">
        {/* Open jobs */}
        <div className="md:col-span-2 card p-4 md:p-6 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">Open jobs near you</h2>
            <span className="text-xs text-slate-400">
              Showing {jobs.length} job{jobs.length === 1 ? "" : "s"}
            </span>
          </div>

          {jobs.length === 0 ? (
            <p className="text-sm text-slate-500">
              No jobs posted yet. As more hotels join VAiyu, you’ll start seeing
              openings here.
            </p>
          ) : (
            <ul className="space-y-3">
              {jobs.map((job) => (
                <li
                  key={job.id}
                  className="border border-slate-100 rounded-xl px-3 py-3 flex flex-col md:flex-row md:items-center md:justify-between gap-2"
                >
                  <div>
                    <div className="font-medium text-sm">
                      {job.title || "Untitled role"}
                    </div>
                    <div className="text-xs text-slate-500">
                      {job.property_type ?? "Hotel"} •{" "}
                      {[job.city, job.state].filter(Boolean).join(", ") ||
                        "Location not set"}
                    </div>
                    {job.min_salary != null && job.max_salary != null && (
                      <div className="text-xs text-slate-500 mt-1">
                        Approx. salary: {job.currency ?? "INR"}{" "}
                        {job.min_salary} – {job.max_salary}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <textarea
                      className="input text-xs w-full md:w-64"
                      rows={2}
                      placeholder="Optional message to hotel (experience, notice period)…"
                      value={applyingJobId === job.id ? message : ""}
                      onChange={(e) => {
                        setApplyingJobId(job.id ?? null);
                        setMessage(e.target.value);
                      }}
                    />
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        className="input h-8 w-28 text-xs"
                        placeholder="Expected"
                        value={applyingJobId === job.id ? expectedSalary : ""}
                        onChange={(e) => {
                          setApplyingJobId(job.id ?? null);
                          setExpectedSalary(e.target.value);
                        }}
                      />
                      <button
                        className="btn btn-sm btn-primary"
                        onClick={() => handleApply(job)}
                        disabled={applyingJobId === job.id && saving}
                      >
                        {applyingJobId === job.id ? "Applying…" : "Apply"}
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* My applications */}
        <div className="card p-4 md:p-6 space-y-3">
          <h2 className="text-lg font-semibold text-sm">
            Your applications
          </h2>
          {applications.length === 0 ? (
            <p className="text-sm text-slate-500">
              You haven&apos;t applied to any jobs yet.
            </p>
          ) : (
            <ul className="space-y-2 max-h-80 overflow-auto">
              {applications.map((app) => (
                <li
                  key={app.id}
                  className="border border-slate-100 rounded-lg px-3 py-2 text-xs"
                >
                  <div className="font-medium">
                    {app.job?.title || "Job application"}
                  </div>
                  <div className="text-slate-500">
                    {[app.job?.city, app.job?.state]
                      .filter(Boolean)
                      .join(", ")}
                  </div>
                  <div className="mt-1">
                    Status:{" "}
                    <span className="font-medium">
                      {app.status || "applied"}
                    </span>
                  </div>
                  {app.expected_salary != null && (
                    <div className="text-slate-500">
                      Expected: {app.expected_salary}
                    </div>
                  )}
                  {app.message && (
                    <div className="mt-1 text-slate-600">
                      “{app.message.slice(0, 120)}
                      {app.message.length > 120 ? "…" : ""}”
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
