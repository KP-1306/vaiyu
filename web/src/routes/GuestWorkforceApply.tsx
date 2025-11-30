// web/src/routes/GuestWorkforceApply.tsx
// Guest-facing: apply for an open role at a specific property.

import { FormEvent, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import SEO from "../components/SEO";
import Spinner from "../components/Spinner";
import BackHome from "../components/BackHome";

type JobRow = {
  id: string;
  hotel_id: string;
  department: string | null;
  role_name: string | null;
  status: string | null;
  urgency: string | null;
  shift_notes: string | null;
  notes: string | null;
  property_id: string | null;
  min_experience_years: number | null;
  max_experience_years: number | null;
};

type HotelRow = {
  id: string;
  name: string;
  city: string | null;
};

type SubmitState = {
  status: "idle" | "submitting" | "success" | "error";
  message?: string;
};

export default function GuestWorkforceApply() {
  const params = useParams();
  const slug = (params.slug || "").trim();
  const jobId = (params.jobId || "").trim();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<JobRow | null>(null);
  const [hotel, setHotel] = useState<HotelRow | null>(null);

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [notes, setNotes] = useState("");

  const [submitState, setSubmitState] = useState<SubmitState>({
    status: "idle",
  });

  useEffect(() => {
    if (!jobId) {
      setLoading(false);
      setError("We couldn’t find this role. The link may be invalid.");
      return;
    }

    let alive = true;

    (async () => {
      setLoading(true);
      setError(null);

      try {
        const { data: jobRow, error: jobErr } = await supabase
          .from("workforce_jobs")
          .select(
            [
              "id",
              "hotel_id",
              "department",
              "role_name",
              "status",
              "urgency",
              "shift_notes",
              "notes",
              "property_id",
              "min_experience_years",
              "max_experience_years",
            ].join(","),
          )
          .eq("id", jobId)
          .maybeSingle();

        if (!alive) return;

        if (jobErr || !jobRow) {
          console.error("Error loading job", jobErr);
          setError(
            "We couldn’t find this role. It may have been closed or removed.",
          );
          setLoading(false);
          return;
        }

        setJob(jobRow as JobRow);

        const hotelId = (jobRow as any).hotel_id as string | null;
        if (hotelId) {
          const { data: hotelRow, error: hotelErr } = await supabase
            .from("hotels")
            .select("id,name,city")
            .eq("id", hotelId)
            .maybeSingle();

          if (!alive) return;

          if (hotelErr) {
            console.error("Error loading hotel", hotelErr);
          } else {
            setHotel(hotelRow as HotelRow);
          }
        }

        setLoading(false);
      } catch (e) {
        console.error("Error loading job/apply view", e);
        if (!alive) return;
        setError("We couldn’t open this role right now. Please try again.");
        setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [jobId]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!job) return;

    if (!fullName.trim()) {
      setSubmitState({
        status: "error",
        message: "Please enter your full name.",
      });
      return;
    }

    setSubmitState({ status: "submitting" });

    try {
      const payload = {
        job_id: job.id,
        property_id: job.property_id ?? null,
        full_name: fullName.trim(),
        phone: phone.trim() || null,
        email: email.trim() || null,
        message: message.trim() || null,
        notes: notes.trim() || null,
        source: "guest_app",
        stage: "new",
      };

      const { error: insertErr } = await supabase
        .from("workforce_applications") // 👈 if your table is named workforce_applicants, change this
        .insert(payload);

      if (insertErr) throw insertErr;

      setSubmitState({
        status: "success",
        message:
          "Thank you. Your details have been shared with the hotel’s hiring team.",
      });
    } catch (err: any) {
      console.error("Error submitting workforce application", err);
      setSubmitState({
        status: "error",
        message:
          err?.message ||
          "We couldn’t submit your application. Please try again in a moment.",
      });
    }
  };

  const isSubmitting = submitState.status === "submitting";
  const isSuccess = submitState.status === "success";

  if (loading) {
    return (
      <>
        <SEO title="Apply for a local role" />
        <main className="min-h-[60vh] grid place-items-center bg-slate-50">
          <Spinner label="Opening role…" />
        </main>
      </>
    );
  }

  if (error || !job) {
    return (
      <>
        <SEO title="Apply for a local role" />
        <main className="max-w-xl mx-auto p-4 bg-slate-50">
          <BackHome />
          <div className="mt-4 rounded-2xl border bg-white p-5 shadow-sm">
            <div className="mb-2 text-lg font-semibold text-slate-900">
              Role not available
            </div>
            <p className="text-sm text-slate-600">{error}</p>
            <div className="mt-4">
              <Link to="/" className="btn btn-light text-xs">
                Go to home
              </Link>
            </div>
          </div>
        </main>
      </>
    );
  }

  const roleTitle = job.role_name || "Open role";

  return (
    <>
      <SEO title={`Apply · ${roleTitle}`} />
      <main className="min-h-screen bg-slate-50">
        <div className="mx-auto max-w-2xl px-4 py-4 lg:px-6 lg:py-6 space-y-4">
          <BackHome />

          <header className="rounded-3xl border border-slate-100 bg-white/90 px-4 py-4 shadow-sm shadow-slate-200/60">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h1 className="text-xl font-semibold tracking-tight text-slate-900">
                  Apply for this role
                </h1>
                <p className="mt-1 text-xs text-slate-600">
                  Share your basic details. The hotel’s team will contact you
                  if your profile is a good fit.
                </p>
              </div>
              {hotel && (
                <div className="text-right text-[11px] text-slate-500">
                  <div className="font-medium text-slate-800">
                    {hotel.name}
                  </div>
                  <div>{hotel.city || "Local"}</div>
                </div>
              )}
            </div>
          </header>

          <section className="rounded-2xl border border-slate-100 bg-white/95 px-4 py-4 shadow-sm space-y-3">
            <div className="border-b border-slate-100 pb-3 mb-3">
              <div className="text-sm font-semibold text-slate-900">
                {roleTitle}
              </div>
              <div className="mt-0.5 text-[11px] text-slate-500">
                {job.department && <span>{job.department}</span>}
                {job.department && (hotel?.city || job.shift_notes) && (
                  <span> · </span>
                )}
                {hotel?.city && <span>{hotel.city}</span>}
                {job.shift_notes && (
                  <>
                    {" "}
                    · <span>{job.shift_notes}</span>
                  </>
                )}
              </div>
              {(job.min_experience_years != null ||
                job.max_experience_years != null) && (
                <div className="mt-0.5 text-[11px] text-slate-500">
                  Experience:{" "}
                  {job.min_experience_years != null
                    ? `${job.min_experience_years}+ years`
                    : "Some experience preferred"}
                  {job.max_experience_years != null &&
                    ` (up to ${job.max_experience_years} years)`}
                </div>
              )}
              {job.notes && (
                <div className="mt-2 rounded-md bg-slate-50 px-3 py-2 text-[11px] text-slate-700">
                  {job.notes}
                </div>
              )}
            </div>

            <form onSubmit={handleSubmit} className="space-y-3 text-xs">
              <div className="grid gap-2 md:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-slate-700">
                    Full name
                  </label>
                  <input
                    className="h-9 w-full rounded-md border border-slate-200 bg-slate-50 px-2 text-xs"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Your name"
                    disabled={isSubmitting || isSuccess}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-slate-700">
                    Phone
                  </label>
                  <input
                    className="h-9 w-full rounded-md border border-slate-200 bg-slate-50 px-2 text-xs"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="For a callback (optional)"
                    disabled={isSubmitting || isSuccess}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-slate-700">
                    Email
                  </label>
                  <input
                    type="email"
                    className="h-9 w-full rounded-md border border-slate-200 bg-slate-50 px-2 text-xs"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="If you prefer email"
                    disabled={isSubmitting || isSuccess}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-medium text-slate-700">
                  About your experience
                </label>
                <textarea
                  rows={3}
                  className="w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Where have you worked before? Any special skills or languages?"
                  disabled={isSubmitting || isSuccess}
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-medium text-slate-700">
                  Notes for the hotel (optional)
                </label>
                <textarea
                  rows={2}
                  className="w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Preferred shift, notice period, anything else."
                  disabled={isSubmitting || isSuccess}
                />
              </div>

              {submitState.status === "error" && (
                <div className="rounded-md bg-rose-50 px-3 py-2 text-[11px] text-rose-800">
                  {submitState.message}
                </div>
              )}
              {submitState.status === "success" && (
                <div className="rounded-md bg-emerald-50 px-3 py-2 text-[11px] text-emerald-800">
                  {submitState.message}
                </div>
              )}

              <div className="flex items-center justify-between gap-2 pt-1">
                <p className="text-[10px] text-slate-500">
                  Your details are shared only with this property’s hiring team.
                </p>
                <button
                  type="submit"
                  disabled={isSubmitting || isSuccess}
                  className="btn h-8 px-4 text-xs"
                >
                  {isSubmitting ? "Submitting…" : "Submit application"}
                </button>
              </div>
            </form>
          </section>
        </div>
      </main>
    </>
  );
}
