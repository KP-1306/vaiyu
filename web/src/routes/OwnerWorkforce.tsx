// web/src/routes/OwnerWorkforce.tsx
// Owner Workforce – roles + applicants (beta)
// Uses workforce_jobs + workforce_applicants if present, but degrades gracefully.

import {
  useEffect,
  useMemo,
  useState,
  type ReactNode,
  FormEvent,
} from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import Spinner from "../components/Spinner";
import BackHome from "../components/BackHome";
import OwnerGate from "../components/OwnerGate";
import SEO from "../components/SEO";

// Env flag – same as OwnerDashboard
const HAS_WORKFORCE = import.meta.env.VITE_HAS_WORKFORCE === "true";

type Hotel = {
  id: string;
  name: string;
  slug: string;
  city: string | null;
};

type WorkforceJob = {
  id: string;
  hotel_id: string;
  title?: string | null;
  department?: string | null;
  city?: string | null;
  status?: string | null;
  priority?: string | null;
  shift_type?: string | null;
  salary_band?: string | null;
  openings?: number | null;
  applicants_count?: number | null;
  notes?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type WorkforceApplicant = {
  id: string;
  job_id: string;
  full_name?: string | null;
  phone?: string | null;
  email?: string | null;
  source?: string | null;
  stage?: string | null;
  rating?: number | null;
  notes?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type SaveState = {
  status: "idle" | "saving" | "error";
  message?: string;
};

type Mode = "view" | "create" | "edit";

export default function OwnerWorkforce() {
  const params = useParams();
  const slug = (params.slug || "").trim();
  const [loading, setLoading] = useState(true);
  const [hotel, setHotel] = useState<Hotel | null>(null);
  const [jobs, setJobs] = useState<WorkforceJob[]>([]);
  const [jobsError, setJobsError] = useState<string | null>(null);

  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [applicants, setApplicants] = useState<WorkforceApplicant[]>([]);
  const [applicantsError, setApplicantsError] = useState<string | null>(null);
  const [applicantsLoading, setApplicantsLoading] = useState(false);

  const [mode, setMode] = useState<Mode>("view");
  const [draft, setDraft] = useState<Partial<WorkforceJob>>({});
  const [saveState, setSaveState] = useState<SaveState>({ status: "idle" });

  // Filters
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("open");
  const [deptFilter, setDeptFilter] = useState<string>("all");
  const [cityFilter, setCityFilter] = useState<string>("all");

  useEffect(() => {
    if (!slug) {
      setLoading(false);
      setJobsError("Missing property slug in the URL.");
      return;
    }

    let alive = true;

    (async () => {
      setLoading(true);
      setJobsError(null);

      // 1) Resolve hotel by slug
      const { data: hotelRow, error: hErr } = await supabase
        .from("hotels")
        .select("id,name,slug,city")
        .eq("slug", slug)
        .limit(1)
        .maybeSingle();

      if (!alive) return;

      if (hErr || !hotelRow) {
        setHotel(null);
        setJobs([]);
        setJobsError(
          "We couldn’t open this property. You might not have access yet or the property doesn’t exist.",
        );
        setLoading(false);
        return;
      }

      setHotel(hotelRow as Hotel);

      // 2) Fetch roles for this hotel
      try {
        const { data, error } = await supabase
          .from("workforce_jobs")
          .select("*")
          .eq("hotel_id", hotelRow.id)
          .order("created_at", { ascending: false });

        if (error) throw error;
        if (!alive) return;

        setJobs((data as WorkforceJob[]) ?? []);
      } catch (e) {
        console.error("Error loading workforce_jobs", e);
        if (!alive) return;
        setJobs([]);
        setJobsError(
          "We couldn’t load roles yet. Check that the workforce_jobs table exists for this project.",
        );
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [slug]);

  // Derived lists & filters
  const statusOptions = useMemo(() => {
    const base = ["open", "paused", "closed", "draft"];
    const seen = new Set(
      jobs
        .map((j) => (j.status || "").toLowerCase())
        .filter(Boolean),
    );
    const result = ["all", ...base.filter((s) => seen.has(s))];
    return result.length > 1 ? result : ["all", "open"];
  }, [jobs]);

  const departmentOptions = useMemo(() => {
    const set = new Set(
      jobs
        .map((j) => (j.department || "").trim())
        .filter(Boolean),
    );
    return ["all", ...Array.from(set).sort()];
  }, [jobs]);

  const cityOptions = useMemo(() => {
    const set = new Set(
      jobs
        .map((j) => (j.city || "").trim())
        .filter(Boolean),
    );
    return ["all", ...Array.from(set).sort()];
  }, [jobs]);

  const filteredJobs = useMemo(() => {
    const s = search.trim().toLowerCase();
    return jobs.filter((j) => {
      const st = (j.status || "open").toLowerCase();
      const dep = (j.department || "").toLowerCase();
      const city = (j.city || "").toLowerCase();
      const title = (j.title || "").toLowerCase();

      if (statusFilter !== "all" && !st.includes(statusFilter)) {
        return false;
      }
      if (deptFilter !== "all" && dep !== deptFilter.toLowerCase()) {
        return false;
      }
      if (cityFilter !== "all" && city !== cityFilter.toLowerCase()) {
        return false;
      }
      if (s) {
        const blob = [title, dep, city, st].join(" ");
        if (!blob.includes(s)) return false;
      }
      return true;
    });
  }, [jobs, search, statusFilter, deptFilter, cityFilter]);

  const openCount = useMemo(
    () =>
      jobs.filter((j) =>
        (j.status || "open").toLowerCase().includes("open"),
      ).length,
    [jobs],
  );

  const selectedJob = useMemo(
    () => jobs.find((j) => j.id === selectedJobId) || null,
    [jobs, selectedJobId],
  );

  // Load applicants when a role is selected
  useEffect(() => {
    if (!selectedJob) {
      setApplicants([]);
      setApplicantsError(null);
      return;
    }

    let alive = true;

    (async () => {
      setApplicantsLoading(true);
      setApplicantsError(null);
      try {
        const { data, error } = await supabase
          .from("workforce_applicants")
          .select("*")
          .eq("job_id", selectedJob.id)
          .order("created_at", { ascending: false });

        if (error) throw error;
        if (!alive) return;

        setApplicants((data as WorkforceApplicant[]) ?? []);
      } catch (e) {
        console.error("Error loading workforce_applicants", e);
        if (!alive) return;
        setApplicants([]);
        setApplicantsError(
          "We couldn’t load applicants yet. Check that the workforce_applicants table exists.",
        );
      } finally {
        if (!alive) return;
        setApplicantsLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [selectedJob]);

  // Start New Role
  const handleStartCreate = () => {
    if (!hotel) return;
    setMode("create");
    setSelectedJobId(null);
    setApplicants([]);
    setApplicantsError(null);
    setDraft({
      hotel_id: hotel.id,
      status: "open",
      priority: "normal",
      openings: 1,
    });
    setSaveState({ status: "idle" });
  };

  // Start Edit Role
  const handleStartEdit = () => {
    if (!selectedJob) return;
    setMode("edit");
    setDraft({ ...selectedJob });
    setSaveState({ status: "idle" });
  };

  // Cancel edit/create
  const handleCancelEdit = () => {
    setMode("view");
    setDraft({});
    setSaveState({ status: "idle" });
  };

  // Save role (create or update)
  const handleSaveRole = async (e: FormEvent) => {
    e.preventDefault();
    if (!hotel) return;

    const payload: Partial<WorkforceJob> = {
      hotel_id: hotel.id,
      title: (draft.title || "").trim() || "New role",
      department: (draft.department || "").trim() || null,
      city: (draft.city || "").trim() || hotel.city || null,
      status: (draft.status || "open").trim() || "open",
      priority: (draft.priority || "normal").trim() || "normal",
      shift_type: (draft.shift_type || "").trim() || null,
      salary_band: (draft.salary_band || "").trim() || null,
      openings:
        typeof draft.openings === "number" && !Number.isNaN(draft.openings)
          ? draft.openings
          : 1,
      notes: (draft.notes || "").trim() || null,
    };

    setSaveState({ status: "saving" });

    try {
      if (mode === "create") {
        const { data, error } = await supabase
          .from("workforce_jobs")
          .insert(payload)
          .select("*")
          .maybeSingle();
        if (error) throw error;

        const created = data as WorkforceJob;
        setJobs((prev) => [created, ...prev]);
        setSelectedJobId(created.id);
        setMode("view");
        setDraft({});
        setSaveState({ status: "idle" });
      } else if (mode === "edit" && selectedJob) {
        const { data, error } = await supabase
          .from("workforce_jobs")
          .update(payload)
          .eq("id", selectedJob.id)
          .select("*")
          .maybeSingle();
        if (error) throw error;

        const updated = data as WorkforceJob;
        setJobs((prev) =>
          prev.map((j) => (j.id === updated.id ? updated : j)),
        );
        setMode("view");
        setDraft({});
        setSaveState({ status: "idle" });
      }
    } catch (err: any) {
      console.error("Error saving workforce job", err);
      setSaveState({
        status: "error",
        message:
          err?.message ||
          "We couldn’t save this role. Please try again or check Supabase logs.",
      });
    }
  };

  // One-touch applicant stage update
  const updateApplicantStage = async (id: string, stage: string) => {
    try {
      const { error } = await supabase
        .from("workforce_applicants")
        .update({ stage })
        .eq("id", id);
      if (error) throw error;

      setApplicants((prev) =>
        prev.map((a) => (a.id === id ? { ...a, stage } : a)),
      );
    } catch (e) {
      console.error("Error updating applicant stage", e);
      setApplicantsError(
        "We couldn’t update this applicant’s stage. Please try again.",
      );
    }
  };

  const workforceEnabled = HAS_WORKFORCE;

  // ---- Render branches wrapped in OwnerGate + SEO ----

  if (loading) {
    return (
      <>
        <SEO title="Local workforce" noIndex />
        <OwnerGate>
          <main className="min-h-[60vh] grid place-items-center bg-slate-50">
            <Spinner label="Loading Workforce…" />
          </main>
        </OwnerGate>
      </>
    );
  }

  if (!hotel) {
    return (
      <>
        <SEO title="Local workforce" noIndex />
        <OwnerGate>
          <main className="max-w-3xl mx-auto p-6 bg-slate-50">
            <BackHome />
            <div className="mt-4 rounded-2xl border bg-white p-6 shadow-sm">
              <div className="mb-2 text-lg font-semibold">
                Workforce not available
              </div>
              <p className="text-sm text-slate-600">
                We couldn’t find this property. Open it from the Owner Home
                screen and try again.
              </p>
              <div className="mt-4">
                <Link to="/owner" className="btn btn-light">
                  Owner Home
                </Link>
              </div>
            </div>
          </main>
        </OwnerGate>
      </>
    );
  }

  return (
    <>
      <SEO title="Local workforce" noIndex />
      <OwnerGate>
        <main className="min-h-screen bg-slate-50">
          <div className="mx-auto max-w-7xl space-y-5 px-4 py-4 lg:px-6 lg:py-6">
            <BackHome />

            {/* Top header */}
            <header className="flex flex-col gap-3 rounded-3xl border border-slate-100 bg-white/90 px-4 py-4 shadow-sm shadow-slate-200/60 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-semibold tracking-tight text-slate-900">
                    Local workforce
                  </h1>
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-200">
                    Beta
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-600">
                  Create open roles for this property, see applicants in one
                  place, and move them to shortlisted or hired in a single tap.
                </p>
                {!workforceEnabled && (
                  <p className="mt-1 text-[11px] text-amber-700">
                    Workforce is not fully enabled yet in this project. The UI
                    is safe to explore; saving requires the{" "}
                    <code className="rounded bg-slate-100 px-1 text-[10px]">
                      workforce_jobs
                    </code>{" "}
                    and{" "}
                    <code className="rounded bg-slate-100 px-1 text-[10px]">
                      workforce_applicants
                    </code>{" "}
                    tables to exist.
                  </p>
                )}
              </div>
              <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
                <div className="flex flex-col items-end text-right text-[11px] text-slate-500">
                  <span className="font-medium text-slate-800">
                    {hotel.name}
                  </span>
                  <span>
                    {hotel.city ? `${hotel.city} · ` : ""}
                    Property ID: {hotel.id.slice(0, 8)}…
                  </span>
                  <span>
                    {openCount} open role{openCount === 1 ? "" : "s"} ·{" "}
                    {jobs.length} total
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleStartCreate}
                  className="btn mt-2 h-9 px-4 text-xs sm:mt-0"
                >
                  + New role
                </button>
              </div>
            </header>

            {/* Jobs + detail */}
            <section className="grid gap-4 lg:grid-cols-12">
              {/* Left: roles table + filters */}
              <div className="space-y-3 lg:col-span-7">
                <FilterBar
                  search={search}
                  onSearchChange={setSearch}
                  status={statusFilter}
                  onStatusChange={setStatusFilter}
                  statusOptions={statusOptions}
                  department={deptFilter}
                  onDepartmentChange={setDeptFilter}
                  departmentOptions={departmentOptions}
                  city={cityFilter}
                  onCityChange={setCityFilter}
                  cityOptions={cityOptions}
                />

                <div className="rounded-2xl border border-slate-100 bg-white/95 px-3 py-3 shadow-sm">
                  <SectionHeader
                    title="Roles for this property"
                    desc="Every role here is scoped to this hotel only. No cross-property confusion."
                  />
                  {jobsError && (
                    <div className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      {jobsError}
                    </div>
                  )}
                  {filteredJobs.length === 0 ? (
                    <div className="text-sm text-slate-500">
                      {jobs.length === 0
                        ? "No roles yet. Create your first role to start hiring locally."
                        : "No roles match your filters. Try clearing the filters or search text."}
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead className="text-left text-slate-500">
                          <tr>
                            <th className="py-2 pr-3 font-medium">Role</th>
                            <th className="py-2 pr-3 font-medium">Dept</th>
                            <th className="py-2 pr-3 font-medium">City</th>
                            <th className="py-2 pr-3 font-medium">Status</th>
                            <th className="py-2 pr-3 font-medium">Priority</th>
                            <th className="py-2 pr-3 text-right font-medium">
                              Applicants
                            </th>
                            <th className="py-2 pl-3 text-right font-medium">
                              Opened
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredJobs.map((job) => {
                            const isSelected = job.id === selectedJobId;
                            const status = (job.status || "open").toLowerCase();
                            const tone =
                              status.includes("closed") ||
                              status.includes("filled")
                                ? ("grey" as const)
                                : status.includes("paused")
                                ? ("amber" as const)
                                : ("green" as const);
                            const applicantsCount =
                              job.applicants_count ??
                              applicantsCountFallback(job.id, applicants);

                            return (
                              <tr
                                key={job.id}
                                className={`cursor-pointer border-t text-[11px] transition-colors hover:bg-slate-50 ${
                                  isSelected ? "bg-sky-50/60" : ""
                                }`}
                                onClick={() => {
                                  setSelectedJobId(job.id);
                                  setMode("view");
                                  setSaveState({ status: "idle" });
                                }}
                              >
                                <td className="py-2 pr-3">
                                  <div className="font-medium text-slate-900">
                                    {job.title || "Untitled role"}
                                  </div>
                                  <div className="text-[10px] text-slate-500">
                                    {job.shift_type
                                      ? `${job.shift_type} shift`
                                      : "Shift flexible"}
                                  </div>
                                </td>
                                <td className="py-2 pr-3">
                                  {job.department || "—"}
                                </td>
                                <td className="py-2 pr-3">
                                  {job.city || hotel.city || "Local"}
                                </td>
                                <td className="py-2 pr-3">
                                  <StatusPill
                                    label={statusLabel(status)}
                                    tone={tone}
                                  />
                                </td>
                                <td className="py-2 pr-3 capitalize">
                                  {job.priority || "normal"}
                                </td>
                                <td className="py-2 pr-3 text-right">
                                  {applicantsCount ?? "—"}
                                </td>
                                <td className="py-2 pl-3 text-right">
                                  {job.created_at
                                    ? fmtDate(job.created_at)
                                    : "—"}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>

              {/* Right: detail + applicants / form */}
              <div className="lg:col-span-5">
                <div className="rounded-2xl border border-slate-100 bg-white/95 px-3 py-3 shadow-sm">
                  {mode === "create" && (
                    <RoleForm
                      mode="create"
                      draft={draft}
                      setDraft={setDraft}
                      onSave={handleSaveRole}
                      onCancel={handleCancelEdit}
                      saveState={saveState}
                    />
                  )}
                  {mode === "edit" && selectedJob && (
                    <RoleForm
                      mode="edit"
                      draft={draft}
                      setDraft={setDraft}
                      onSave={handleSaveRole}
                      onCancel={handleCancelEdit}
                      saveState={saveState}
                    />
                  )}
                  {mode === "view" && selectedJob && (
                    <RoleDetail
                      job={selectedJob}
                      applicants={applicants}
                      applicantsError={applicantsError}
                      applicantsLoading={applicantsLoading}
                      onEdit={handleStartEdit}
                      onUpdateStage={updateApplicantStage}
                    />
                  )}
                  {mode === "view" && !selectedJob && jobs.length > 0 && (
                    <EmptyDetailCard />
                  )}
                  {mode === "view" && !selectedJob && jobs.length === 0 && (
                    <div className="text-sm text-slate-500">
                      Start by creating your first role. You can later manage
                      applicants and shortlist in one tap.
                    </div>
                  )}
                </div>
              </div>
            </section>

            {/* Footer helper */}
            <footer className="pt-2">
              <div className="rounded-2xl border border-slate-100 bg-white px-4 py-3 text-[11px] text-slate-600 shadow-sm">
                Tip: In the next phase, workforce can plug directly into your
                “Invisible staff shortage” radar — so if rooms and tickets are
                suffering because of hiring gaps, you’ll see it here first.
              </div>
            </footer>
          </div>
        </main>
      </OwnerGate>
    </>
  );
}

/** ===== Helpers & subcomponents ===== */

function FilterBar(props: {
  search: string;
  onSearchChange: (v: string) => void;
  status: string;
  onStatusChange: (v: string) => void;
  statusOptions: string[];
  department: string;
  onDepartmentChange: (v: string) => void;
  departmentOptions: string[];
  city: string;
  onCityChange: (v: string) => void;
  cityOptions: string[];
}) {
  const {
    search,
    onSearchChange,
    status,
    onStatusChange,
    statusOptions,
    department,
    onDepartmentChange,
    departmentOptions,
    city,
    onCityChange,
    cityOptions,
  } = props;

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-slate-100 bg-white/80 px-3 py-3 shadow-sm md:flex-row md:items-center md:justify-between">
      <div className="flex-1">
        <input
          className="h-9 w-full rounded-full border border-slate-200 bg-slate-50 px-3 text-xs text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/60"
          placeholder="Search by role, department, city, status…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>
      <div className="flex flex-wrap gap-2 text-[11px] text-slate-600 md:justify-end">
        <select
          className="h-8 rounded-full border border-slate-200 bg-slate-50 px-2"
          value={status}
          onChange={(e) => onStatusChange(e.target.value)}
        >
          {statusOptions.map((s) => (
            <option key={s} value={s}>
              {s === "all" ? "All statuses" : capitalize(s)}
            </option>
          ))}
        </select>
        <select
          className="h-8 rounded-full border border-slate-200 bg-slate-50 px-2"
          value={department}
          onChange={(e) => onDepartmentChange(e.target.value)}
        >
          {departmentOptions.map((d) => (
            <option key={d} value={d}>
              {d === "all" ? "All departments" : d}
            </option>
          ))}
        </select>
        <select
          className="h-8 rounded-full border border-slate-200 bg-slate-50 px-2"
          value={city}
          onChange={(e) => onCityChange(e.target.value)}
        >
          {cityOptions.map((c) => (
            <option key={c} value={c}>
              {c === "all" ? "All cities" : c}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function SectionHeader({
  title,
  desc,
  action,
}: {
  title: string;
  desc?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3">
      <div>
        <h2 className="text-sm font-semibold tracking-tight text-slate-900">
          {title}
        </h2>
        {desc && <p className="mt-0.5 text-xs text-slate-500">{desc}</p>}
      </div>
      {action}
    </div>
  );
}

function StatusPill({
  label,
  tone,
}: {
  label: string;
  tone: "green" | "amber" | "red" | "grey";
}) {
  const map = {
    green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    amber: "bg-amber-50 text-amber-700 ring-amber-200",
    red: "bg-rose-50 text-rose-700 ring-rose-200",
    grey: "bg-slate-50 text-slate-600 ring-slate-200",
  }[tone];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${map}`}
    >
      {label}
    </span>
  );
}

function RoleForm({
  mode,
  draft,
  setDraft,
  onSave,
  onCancel,
  saveState,
}: {
  mode: Mode;
  draft: Partial<WorkforceJob>;
  setDraft: (d: Partial<WorkforceJob>) => void;
  onSave: (e: FormEvent) => void;
  onCancel: () => void;
  saveState: SaveState;
}) {
  const isSaving = saveState.status === "saving";

  const updateField = (key: keyof WorkforceJob, value: any) => {
    setDraft({ ...draft, [key]: value });
  };

  return (
    <form onSubmit={onSave} className="space-y-3">
      <SectionHeader
        title={mode === "create" ? "New role" : "Edit role"}
        desc="Describe the role clearly. Applicants will see this in their guest app."
      />
      <div className="grid gap-2 text-xs md:grid-cols-2">
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-slate-700">
            Role title
          </label>
          <input
            className="h-8 w-full rounded-md border border-slate-200 bg-slate-50 px-2 text-xs"
            required
            value={draft.title || ""}
            onChange={(e) => updateField("title", e.target.value)}
            placeholder="Front Office Associate, F&B Steward, Room Attendant…"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-slate-700">
            Department
          </label>
          <input
            className="h-8 w-full rounded-md border border-slate-200 bg-slate-50 px-2 text-xs"
            value={draft.department || ""}
            onChange={(e) => updateField("department", e.target.value)}
            placeholder="Front Desk, Housekeeping, F&B, Engineering…"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-slate-700">
            City / Locality
          </label>
          <input
            className="h-8 w-full rounded-md border border-slate-200 bg-slate-50 px-2 text-xs"
            value={draft.city || ""}
            onChange={(e) => updateField("city", e.target.value)}
            placeholder="Use property city by default"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-slate-700">
            Status
          </label>
          <select
            className="h-8 w-full rounded-md border border-slate-200 bg-slate-50 px-2 text-xs"
            value={draft.status || "open"}
            onChange={(e) => updateField("status", e.target.value)}
          >
            <option value="open">Open</option>
            <option value="paused">Paused</option>
            <option value="closed">Closed</option>
            <option value="draft">Draft</option>
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-slate-700">
            Priority
          </label>
          <select
            className="h-8 w-full rounded-md border border-slate-200 bg-slate-50 px-2 text-xs"
            value={draft.priority || "normal"}
            onChange={(e) => updateField("priority", e.target.value)}
          >
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-slate-700">
            Shift type
          </label>
          <input
            className="h-8 w-full rounded-md border border-slate-200 bg-slate-50 px-2 text-xs"
            value={draft.shift_type || ""}
            onChange={(e) => updateField("shift_type", e.target.value)}
            placeholder="Rotational, Morning, Night-only…"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-slate-700">
            Salary band (optional)
          </label>
          <input
            className="h-8 w-full rounded-md border border-slate-200 bg-slate-50 px-2 text-xs"
            value={draft.salary_band || ""}
            onChange={(e) => updateField("salary_band", e.target.value)}
            placeholder="e.g. ₹16k–₹20k per month"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-slate-700">
            No. of openings
          </label>
          <input
            type="number"
            min={1}
            className="h-8 w-full rounded-md border border-slate-200 bg-slate-50 px-2 text-xs"
            value={draft.openings ?? 1}
            onChange={(e) =>
              updateField("openings", Number(e.target.value) || 1)
            }
          />
        </div>
      </div>
      <div className="space-y-1 text-xs">
        <label className="text-[11px] font-medium text-slate-700">
          Notes for hiring team (internal)
        </label>
        <textarea
          rows={3}
          className="w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs"
          value={draft.notes || ""}
          onChange={(e) => updateField("notes", e.target.value)}
          placeholder="What kind of profile works best? Any hard constraints or must-have qualities?"
        />
      </div>
      {saveState.status === "error" && (
        <div className="rounded-md bg-rose-50 px-3 py-2 text-[11px] text-rose-800">
          {saveState.message}
        </div>
      )}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          disabled={isSaving}
          onClick={onCancel}
          className="btn btn-light h-8 px-3 text-xs"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isSaving}
          className="btn h-8 px-4 text-xs"
        >
          {isSaving
            ? "Saving…"
            : mode === "create"
            ? "Create role"
            : "Save changes"}
        </button>
      </div>
    </form>
  );
}

function RoleDetail({
  job,
  applicants,
  applicantsError,
  applicantsLoading,
  onEdit,
  onUpdateStage,
}: {
  job: WorkforceJob;
  applicants: WorkforceApplicant[];
  applicantsError: string | null;
  applicantsLoading: boolean;
  onEdit: () => void;
  onUpdateStage: (id: string, stage: string) => void;
}) {
  const status = (job.status || "open").toLowerCase();
  const tone =
    status.includes("closed") || status.includes("filled")
      ? ("grey" as const)
      : status.includes("paused")
      ? ("amber" as const)
      : ("green" as const);

  return (
    <div className="space-y-3 text-xs text-slate-700">
      <SectionHeader
        title={job.title || "Untitled role"}
        desc={
          job.department
            ? `${job.department} · ${job.city || "Local"}`
            : job.city || "Local"
        }
        action={
          <button
            type="button"
            onClick={onEdit}
            className="btn btn-light h-8 px-3 text-xs"
          >
            Edit role
          </button>
        }
      />
      <div className="flex flex-wrap gap-2">
        <StatusPill label={statusLabel(status)} tone={tone} />
        {job.priority && (
          <StatusPill
            label={`${capitalize(job.priority)} priority`}
            tone={
              job.priority === "urgent"
                ? "red"
                : job.priority === "high"
                ? "amber"
                : "grey"
            }
          />
        )}
        {job.shift_type && (
          <span className="rounded-full bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600 ring-1 ring-slate-200">
            {job.shift_type} shift
          </span>
        )}
        {job.openings != null && (
          <span className="rounded-full bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600 ring-1 ring-slate-200">
            {job.openings} opening{job.openings === 1 ? "" : "s"}
          </span>
        )}
      </div>
      {job.salary_band && (
        <div className="text-[11px] text-slate-600">
          Salary band: {job.salary_band}
        </div>
      )}
      {job.notes && (
        <div className="rounded-md bg-slate-50 px-3 py-2 text-[11px] text-slate-700">
          {job.notes}
        </div>
      )}

      <div className="mt-2 border-t pt-3">
        <SectionHeader
          title="Applicants for this role"
          desc="Shortlist or move someone to hired in one tap."
        />
        {applicantsError && (
          <div className="mb-2 rounded-md bg-rose-50 px-3 py-2 text-[11px] text-rose-800">
            {applicantsError}
          </div>
        )}
        {applicantsLoading ? (
          <div className="text-xs text-slate-500">Loading applicants…</div>
        ) : applicants.length === 0 ? (
          <div className="text-xs text-slate-500">
            No applicants yet. Once candidates apply from the guest app or your
            share link, they’ll show here automatically.
          </div>
        ) : (
          <div className="space-y-2">
            {applicants.map((a) => (
              <ApplicantRow
                key={a.id}
                applicant={a}
                onUpdateStage={onUpdateStage}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ApplicantRow({
  applicant,
  onUpdateStage,
}: {
  applicant: WorkforceApplicant;
  onUpdateStage: (id: string, stage: string) => void;
}) {
  const stage = (applicant.stage || "new").toLowerCase();
  const tone: "green" | "amber" | "red" | "grey" =
    stage === "hired"
      ? "green"
      : stage === "shortlisted"
      ? "amber"
      : stage === "rejected"
      ? "red"
      : "grey";

  return (
    <div className="flex items-start justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-[11px]">
      <div>
        <div className="font-medium text-slate-900">
          {applicant.full_name || "Unnamed applicant"}
        </div>
        <div className="text-[10px] text-slate-500">
          {applicant.source || "Source: Guest app"}
          {applicant.rating != null && ` · Rating ${applicant.rating}/5`}
        </div>
        {(applicant.phone || applicant.email) && (
          <div className="mt-0.5 text-[10px] text-slate-500">
            {applicant.phone && <span>📞 {applicant.phone} </span>}
            {applicant.email && <span> · ✉️ {applicant.email}</span>}
          </div>
        )}
        {applicant.notes && (
          <div className="mt-1 text-[10px] text-slate-600">
            {applicant.notes}
          </div>
        )}
      </div>
      <div className="flex flex-col items-end gap-1">
        <StatusPill label={stageLabel(stage)} tone={tone} />
        <div className="flex flex-wrap justify-end gap-1">
          <button
            type="button"
            onClick={() => onUpdateStage(applicant.id, "shortlisted")}
            className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-700 ring-1 ring-emerald-200"
          >
            Shortlist
          </button>
          <button
            type="button"
            onClick={() => onUpdateStage(applicant.id, "hired")}
            className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] text-sky-700 ring-1 ring-sky-200"
          >
            Mark hired
          </button>
          <button
            type="button"
            onClick={() => onUpdateStage(applicant.id, "rejected")}
            className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] text-rose-700 ring-1 ring-rose-200"
          >
            Reject
          </button>
        </div>
      </div>
    </div>
  );
}

function EmptyDetailCard() {
  return (
    <div className="space-y-2 text-xs text-slate-600">
      <div className="font-medium text-slate-800">
        Select a role on the left
      </div>
      <p>
        You’ll see role details here along with every applicant. From here, the
        owner or HR can shortlist or mark someone as hired with a single tap.
      </p>
    </div>
  );
}

/** ===== small helpers ===== */

function capitalize(v: string) {
  if (!v) return v;
  return v.charAt(0).toUpperCase() + v.slice(1);
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
  });
}

function statusLabel(status: string) {
  if (status.includes("closed") || status.includes("filled")) return "Closed";
  if (status.includes("paused")) return "Paused";
  if (status.includes("draft")) return "Draft";
  return "Open";
}

function stageLabel(stage: string) {
  if (stage === "hired") return "Hired";
  if (stage === "shortlisted") return "Shortlisted";
  if (stage === "rejected") return "Rejected";
  if (stage === "interview") return "Interviewing";
  return "New";
}

// If you later add applicants_count column to jobs, you can remove this.
// For now, just a cheap fallback using loaded applicants (only for selected job).
function applicantsCountFallback(
  jobId: string,
  loadedApplicants: WorkforceApplicant[],
) {
  const count = loadedApplicants.filter((a) => a.job_id === jobId).length;
  return count || undefined;
}
