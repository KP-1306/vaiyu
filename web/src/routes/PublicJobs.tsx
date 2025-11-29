// web/src/routes/PublicJobs.tsx
import { useEffect, useState, FormEvent } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import SEO from "../components/SEO";
import BackHome from "../components/BackHome";

type Hotel = {
  id: string;
  slug: string;
  name: string;
  city?: string | null;
  state?: string | null;
};

type JobRow = {
  id: string;
  title: string;
  department?: string | null;
  role?: string | null;
  employment_type?: string | null;
  shift_type?: string | null;
  description?: string | null;
  location_city?: string | null;
  location_state?: string | null;
  created_at: string;
};

type ApplyFormState = {
  full_name: string;
  phone: string;
  email: string;
  message: string;
};

export default function PublicJobs() {
  const params = useParams<{ slug?: string }>();
  const slug = params.slug || "TENANT1";

  const [hotel, setHotel] = useState<Hotel | null>(null);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [selectedJob, setSelectedJob] = useState<JobRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const [form, setForm] = useState<ApplyFormState>({
    full_name: "",
    phone: "",
    email: "",
    message: "",
  });

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  async function load() {
    setLoading(true);
    setErr(null);
    setOk(null);
    setSelectedJob(null);

    try {
      const { data: hotelRow, error: hErr } = await supabase
        .from("hotels")
        .select("id,slug,name,city,state")
        .eq("slug", slug)
        .maybeSingle();

      if (hErr || !hotelRow) {
        throw new Error(hErr?.message || "Property not found.");
      }

      const hotelNorm: Hotel = {
        id: hotelRow.id,
        slug: hotelRow.slug,
        name: hotelRow.name,
        city: (hotelRow as any).city ?? null,
        state: (hotelRow as any).state ?? null,
      };

      setHotel(hotelNorm);

      const { data: jobRows, error: jErr } = await supabase
        .from("workforce_jobs")
        .select(
          "id,title,department,role,employment_type,shift_type,description,location_city,location_state,created_at,status,is_published,property_id",
        )
        .eq("property_id", hotelNorm.id)
        .eq("status", "open")
        .eq("is_published", true)
        .order("created_at", { ascending: false });

      if (jErr) throw jErr;

      const filtered: JobRow[] = (jobRows || []).map((j: any) => ({
        id: j.id,
        title: j.title,
        department: j.department,
        role: j.role,
        employment_type: j.employment_type,
        shift_type: j.shift_type,
        description: j.description,
        location_city: j.location_city,
        location_state: j.location_state,
        created_at: j.created_at,
      }));

      setJobs(filtered);
    } catch (e: any) {
      setErr(e?.message || "Failed to load jobs.");
    } finally {
      setLoading(false);
    }
  }

  function onChangeField<K extends keyof ApplyFormState>(
    key: K,
    val: ApplyFormState[K],
  ) {
    setForm((prev) => ({ ...prev, [key]: val }));
  }

  async function handleApply(e: FormEvent) {
    e.preventDefault();
    if (!hotel || !selectedJob) {
      setErr("Please select a job to apply for.");
      return;
    }

    const fullName = form.full_name.trim();
    if (!fullName) {
      setErr("Please enter your name.");
      return;
    }

    setSubmitting(true);
    setErr(null);
    setOk(null);

    try {
      const { error } = await supabase.from("workforce_applications").insert({
        job_id: selectedJob.id,
        property_id: hotel.id,
        profile_id: null, // we can link later if we add login for candidates
        full_name: fullName,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        message: form.message.trim() || null,
        source: "public_jobs_page",
        stage: "applied",
      });

      if (error) throw error;

      setOk("Application submitted. The property team will contact you.");
      setForm({
        full_name: "",
        phone: "",
        email: "",
        message: "",
      });
      setSelectedJob(null);
    } catch (e: any) {
      setErr(e?.message || "Failed to submit application.");
    } finally {
      setSubmitting(false);
    }
  }

  const title = hotel
    ? `Jobs at ${hotel.name}`
    : "Jobs & Hiring";

  return (
    <>
      <SEO title={title} />
      <main className="min-h-screen bg-slate-50">
        <div className="max-w-4xl mx-auto px-4 py-4 space-y-4">
          <header className="flex items-center justify-between gap-2">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-slate-500">
                Careers with {hotel?.name || "this property"}
              </div>
              <h1 className="text-xl font-semibold">
                Jobs &amp; Hiring
              </h1>
              {hotel && (
                <div className="text-sm text-slate-600">
                  {hotel.city && (
                    <>
                      {hotel.city}
                      {hotel.state ? `, ${hotel.state}` : ""}
                    </>
                  )}
                </div>
              )}
            </div>
            <BackHome />
          </header>

          {err && (
            <div className="card border border-amber-400 bg-amber-50 text-sm">
              ⚠️ {err}
            </div>
          )}
          {ok && (
            <div className="card border border-emerald-400 bg-emerald-50 text-sm">
              ✅ {ok}
            </div>
          )}

          {/* Jobs list */}
          <section className="bg-white rounded shadow p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-medium text-sm">Open positions</h2>
              <div className="text-xs text-slate-500">
                {loading
                  ? "Loading…"
                  : jobs.length
                  ? `${jobs.length} opening(s)`
                  : "No active openings right now"}
              </div>
            </div>

            {loading ? (
              <div className="text-sm text-slate-500">
                Please wait while we load the latest openings…
              </div>
            ) : !jobs.length ? (
              <div className="text-sm text-slate-500">
                There are no active roles at the moment. Please check back
                later or contact the property directly.
              </div>
            ) : (
              <div className="space-y-2">
                {jobs.map((job) => {
                  const isSelected = selectedJob?.id === job.id;
                  return (
                    <button
                      key={job.id}
                      type="button"
                      onClick={() =>
                        setSelectedJob(
                          isSelected ? null : job,
                        )
                      }
                      className={`w-full text-left border rounded-xl px-3 py-2 bg-slate-50/60 hover:bg-slate-50 transition ${
                        isSelected ? "ring-2 ring-sky-400" : ""
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold truncate">
                            {job.title}
                          </div>
                          <div className="text-[11px] text-slate-500 flex flex-wrap gap-2 mt-0.5">
                            {job.department && <span>{job.department}</span>}
                            {job.role && (
                              <span className="opacity-80">· {job.role}</span>
                            )}
                            {job.location_city && (
                              <span>
                                · {job.location_city}
                                {job.location_state
                                  ? `, ${job.location_state}`
                                  : ""}
                              </span>
                            )}
                          </div>
                        </div>
                        <span className="text-[11px] text-slate-500">
                          {new Date(job.created_at).toLocaleDateString()}
                        </span>
                      </div>
                      {job.description && (
                        <p className="mt-1 text-xs text-slate-600 line-clamp-2">
                          {job.description}
                        </p>
                      )}
                      <div className="mt-1 text-[11px] text-slate-600 flex flex-wrap gap-2">
                        <span className="px-2 py-0.5 rounded-full bg-white border">
                          {job.employment_type || "full_time"}
                        </span>
                        <span className="px-2 py-0.5 rounded-full bg-white border">
                          {job.shift_type || "rotational"}
                        </span>
                        {isSelected && (
                          <span className="px-2 py-0.5 rounded-full bg-sky-50 border border-sky-200 text-sky-700">
                            Selected
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {/* Apply form */}
          <section className="bg-white rounded shadow p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-medium text-sm">Apply</h2>
              {selectedJob && (
                <div className="text-xs text-slate-600 text-right">
                  Applying for:{" "}
                  <span className="font-semibold">
                    {selectedJob.title}
                  </span>
                </div>
              )}
            </div>

            {!jobs.length ? (
              <div className="text-sm text-slate-500">
                There are no active openings to apply for right now.
              </div>
            ) : !selectedJob ? (
              <div className="text-sm text-slate-500">
                Select a role from the list above to start your application.
              </div>
            ) : (
              <form
                onSubmit={handleApply}
                className="grid md:grid-cols-2 gap-3 text-sm"
              >
                <label className="flex flex-col gap-1">
                  Full name *
                  <input
                    className="input"
                    value={form.full_name}
                    onChange={(e) =>
                      onChangeField("full_name", e.target.value)
                    }
                    required
                  />
                </label>
                <label className="flex flex-col gap-1">
                  Phone
                  <input
                    className="input"
                    value={form.phone}
                    onChange={(e) =>
                      onChangeField("phone", e.target.value)
                    }
                    placeholder="+91…"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  Email
                  <input
                    type="email"
                    className="input"
                    value={form.email}
                    onChange={(e) =>
                      onChangeField("email", e.target.value)
                    }
                    placeholder="you@example.com"
                  />
                </label>
                <div className="md:col-span-2">
                  <label className="flex flex-col gap-1">
                    Tell us briefly about your experience
                    <textarea
                      className="input min-h-[80px]"
                      value={form.message}
                      onChange={(e) =>
                        onChangeField("message", e.target.value)
                      }
                      placeholder="Years of experience, last organisation, notice period, preferred shift, etc."
                    />
                  </label>
                </div>
                <div className="md:col-span-2 flex gap-2">
                  <button
                    type="submit"
                    className="btn"
                    disabled={submitting}
                  >
                    {submitting ? "Submitting…" : "Submit application"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-light"
                    onClick={() => setSelectedJob(null)}
                    disabled={submitting}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </section>

          <footer className="text-[11px] text-slate-500 py-2">
            Your details are shared only with this property’s management team
            for hiring purposes.
          </footer>
        </div>
      </main>
    </>
  );
}
