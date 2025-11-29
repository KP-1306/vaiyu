// web/src/routes/HotelJobs.tsx
import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import BackHome from "../components/BackHome";
import Spinner from "../components/Spinner";
import {
  listWorkforceJobs,
  applyForWorkforceJob,
  type WorkforceJob,
} from "../lib/api";

type ApplyState = {
  job: WorkforceJob | null;
  fullName: string;
  phone: string;
  email: string;
  notes: string;
};

export default function HotelJobs() {
  const { slug } = useParams<{ slug: string }>();

  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState<WorkforceJob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [apply, setApply] = useState<ApplyState>({
    job: null,
    fullName: "",
    phone: "",
    email: "",
    notes: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const hotelName = useMemo(
    () =>
      (jobs[0] as any)?.hotel_name ||
      (jobs[0] as any)?.hotelName ||
      "this hotel",
    [jobs]
  );

  useEffect(() => {
    let alive = true;

    async function load() {
      if (!slug) {
        setError("Missing hotel in URL. Open this page from the hotel link.");
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      setSuccessMsg(null);

      try {
        const result = await listWorkforceJobs({
          slug,
          status: "open",
        } as any); // keep flexible with current API signature
        if (!alive) return;
        setJobs(result || []);
      } catch (e) {
        console.error("Error loading jobs", e);
        if (!alive) return;
        setError(
          "We couldn’t load open roles right now. Please try again in a few minutes."
        );
        setJobs([]);
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    }

    load();
    return () => {
      alive = false;
    };
  }, [slug]);

  function openApply(job: WorkforceJob) {
    setSuccessMsg(null);
    setApply({
      job,
      fullName: "",
      phone: "",
      email: "",
      notes: "",
    });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!apply.job) return;

    const trimmedName = apply.fullName.trim();
    const trimmedPhone = apply.phone.trim();

    if (!trimmedName || !trimmedPhone) {
      setError("Please add your name and phone number.");
      return;
    }

    setSubmitting(true);
    setError(null);
    setSuccessMsg(null);

    try {
      await applyForWorkforceJob(apply.job.id, {
        full_name: trimmedName,
        phone: trimmedPhone,
        email: apply.email.trim() || undefined,
        notes: apply.notes.trim() || undefined,
        source_text: "Guest app – Jobs at this hotel",
      } as any);

      setSuccessMsg(
        "Thank you! The hotel team has received your interest and will contact you if there’s a match."
      );
      // reset form but keep the job visible
      setApply((prev) => ({
        ...prev,
        fullName: "",
        phone: "",
        email: "",
        notes: "",
      }));
    } catch (e) {
      console.error("Error applying for job", e);
      setError(
        "We couldn’t submit your details right now. Please check your connection and try again."
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-[60vh] bg-slate-50">
        <div className="mx-auto max-w-3xl px-4 py-6">
          <BackHome />
          <div className="mt-8 grid place-items-center">
            <Spinner label="Loading open roles…" />
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-3xl px-4 py-6 space-y-5">
        <BackHome />

        <header className="rounded-3xl border border-slate-100 bg-white/95 px-4 py-4 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">
            Work with us
          </p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-slate-900">
            Jobs at {hotelName}
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            A simple way for local talent and repeat guests to discover open
            roles at the property and share basic details in under a minute.
          </p>
          {slug && (
            <p className="mt-1 text-[11px] text-slate-500">
              Property code: <span className="font-mono">{slug}</span>
            </p>
          )}
        </header>

        {error && (
          <div className="rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-xs text-rose-800">
            {error}
          </div>
        )}

        {successMsg && (
          <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
            {successMsg}
          </div>
        )}

        {/* Jobs list */}
        <section className="space-y-3">
          {jobs.length === 0 ? (
            <div className="rounded-2xl border border-slate-100 bg-white px-4 py-4 text-sm text-slate-600 shadow-sm">
              There are no open roles listed right now. You can check again
              later, or leave your details at the front desk so the team can
              reach out when they’re hiring.
            </div>
          ) : (
            jobs.map((job) => (
              <article
                key={job.id}
                className="rounded-2xl border border-slate-100 bg-white px-4 py-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-900">
                      {job.title}
                    </h2>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      {(job as any).department || "Department not specified"}
                      {(job as any).hotel_city
                        ? ` · ${(job as any).hotel_city}`
                        : ""}
                    </p>
                  </div>
                  <div className="text-right text-[11px] text-slate-500">
                    {(job as any).contract_type && (
                      <div>{(job as any).contract_type}</div>
                    )}
                    {(job as any).min_rate && (
                      <div className="font-medium text-slate-800">
                        ₹{(job as any).min_rate}+
                      </div>
                    )}
                  </div>
                </div>
                {(job as any).short_summary && (
                  <p className="mt-2 text-xs text-slate-600">
                    {(job as any).short_summary}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => openApply(job)}
                  className="mt-3 inline-flex items-center rounded-full bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-50 hover:bg-slate-800"
                >
                  Quick apply
                  <span aria-hidden="true" className="ml-1">
                    →
                  </span>
                </button>
              </article>
            ))
          )}
        </section>

        {/* Apply form */}
        {apply.job && (
          <section className="rounded-3xl border border-sky-100 bg-gradient-to-r from-sky-50 via-white to-emerald-50 px-4 py-4 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-900">
              Quick apply: {apply.job.title}
            </h2>
            <p className="mt-0.5 text-xs text-slate-600">
              Share just your basic contact details. The hotel will reach out
              directly if there’s a fit.
            </p>
            <form className="mt-3 space-y-3" onSubmit={handleSubmit}>
              <div>
                <label className="block text-[11px] font-medium text-slate-700">
                  Full name<span className="text-rose-500">*</span>
                </label>
                <input
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/70"
                  value={apply.fullName}
                  onChange={(e) =>
                    setApply((prev) => ({
                      ...prev,
                      fullName: e.target.value,
                    }))
                  }
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-700">
                  Phone / WhatsApp<span className="text-rose-500">*</span>
                </label>
                <input
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/70"
                  value={apply.phone}
                  onChange={(e) =>
                    setApply((prev) => ({
                      ...prev,
                      phone: e.target.value,
                    }))
                  }
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-700">
                  Email (optional)
                </label>
                <input
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/70"
                  value={apply.email}
                  onChange={(e) =>
                    setApply((prev) => ({
                      ...prev,
                      email: e.target.value,
                    }))
                  }
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-700">
                  Anything you’d like to add (optional)
                </label>
                <textarea
                  rows={3}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/70"
                  placeholder="For example: years of experience, current role, preferred shift…"
                  value={apply.notes}
                  onChange={(e) =>
                    setApply((prev) => ({
                      ...prev,
                      notes: e.target.value,
                    }))
                  }
                />
              </div>
              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  className="text-xs text-slate-500 hover:text-slate-700"
                  onClick={() =>
                    setApply({
                      job: null,
                      fullName: "",
                      phone: "",
                      email: "",
                      notes: "",
                    })
                  }
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center rounded-full bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-emerald-50 shadow-sm hover:bg-emerald-700 disabled:opacity-60"
                >
                  {submitting ? "Sending…" : "Submit details"}
                </button>
              </div>
              <p className="mt-1 text-[10px] text-slate-500">
                By submitting, you agree to be contacted by the hotel on the
                details shared above. VAiyu does not make hiring decisions — we
                only pass your information to the property team.
              </p>
            </form>
          </section>
        )}

        <footer className="pb-4 pt-2 text-center text-[11px] text-slate-500">
          Powered by VAiyu — helping hotels find trusted local talent.
        </footer>
      </div>
    </main>
  );
}
