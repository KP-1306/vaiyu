// web/src/routes/OwnerWorkforce.tsx
// Owner Workforce – roles + applicants (beta)
// Uses workforce_jobs + workforce_applications if present, but degrades gracefully.

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

import OwnerGate from "../components/OwnerGate";
import SEO from "../components/SEO";
import { useOwnerT, useOwnerLocale, type OwnerT } from "../i18n/useOwnerT";

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

  // Core DB fields
  department?: string | null;
  role_name?: string | null;
  status?: string | null;
  urgency?: string | null;
  openings?: number | null;
  min_experience_years?: number | null;
  max_experience_years?: number | null;
  shift_notes?: string | null;
  notes?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  property_id?: string | null;
  slug?: string | null;
  is_published?: boolean | null;
  published_at?: string | null;

  // Friendly UI aliases (derived in frontend)
  title?: string | null;
  city?: string | null;
  priority?: string | null;
  shift_type?: string | null;
  salary_band?: string | null;
  applicants_count?: number | null;
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
  message?: string | null; // safe even if column not present – will just be undefined
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
  const t = useOwnerT("owner-workforce");
  const ownerLocale = useOwnerLocale();
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
      setJobsError(t("errors.missingSlug", "Missing property slug in the URL."));
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
          t(
            "errors.openProperty",
            "We couldn’t open this property. You might not have access yet or the property doesn’t exist.",
          ),
        );
        setLoading(false);
        return;
      }

      setHotel(hotelRow as Hotel);

      // 2) Fetch roles for this hotel
      try {
        const { data, error } = await supabase
          .from("workforce_jobs")
          .select(
            [
              "id",
              "hotel_id",
              "department",
              "role_name",
              "status",
              "urgency",
              "openings",
              "min_experience_years",
              "max_experience_years",
              "shift_notes",
              "notes",
              "created_at",
              "updated_at",
              "property_id",
              "slug",
              "is_published",
              "published_at",
            ].join(","),
          )
          .eq("hotel_id", (hotelRow as Hotel).id)
          .order("created_at", { ascending: false });

        if (error) throw error;
        if (!alive) return;

        const rows = (data ?? []) as any[];

        // Map DB columns → UI-friendly aliases
        const mapped: WorkforceJob[] = rows.map((row) => ({
          ...row,
          title: row.role_name ?? row.title ?? "",
          priority: row.urgency ?? row.priority ?? "normal",
          shift_type: row.shift_notes ?? row.shift_type ?? "",
          // Use job-specific city if present, otherwise fall back to property city for filters/UI
          city: row.city ?? (hotelRow as Hotel).city ?? null,
        }));

        setJobs(mapped);
      } catch (e) {
        console.error("Error loading workforce_jobs", e);
        if (!alive) return;
        setJobs([]);
        setJobsError(
          t(
            "errors.loadRoles",
            "We couldn’t load roles yet. Check that the workforce_jobs table exists for this project.",
          ),
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
          .from("workforce_applications")
          .select("*")
          .eq("job_id", selectedJob.id)
          .order("created_at", { ascending: false });

        if (error) throw error;
        if (!alive) return;

        setApplicants((data as WorkforceApplicant[]) ?? []);
      } catch (e) {
        console.error("Error loading workforce_applications", e);
        if (!alive) return;
        setApplicants([]);
        setApplicantsError(
          t(
            "errors.loadApplicants",
            "We couldn’t load applicants yet. Check that the workforce_applications table exists.",
          ),
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
      city: hotel.city ?? undefined,
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

    // Map UI fields → DB columns
    const department =
      (draft.department || "").trim() || "General";
    const role_name =
      (draft.title || "").trim() || "New role";
    const status =
      (draft.status || "open").trim() || "open";
    const urgency =
      (draft.priority || "normal").trim() || "normal";
    const openings =
      typeof draft.openings === "number" && !Number.isNaN(draft.openings)
        ? draft.openings
        : 1;

    const payload: any = {
      hotel_id: hotel.id,
      property_id: hotel.id, // keep hotel-based today, but future-ready for generic property OS
      department,
      role_name,
      status,
      urgency,
      openings,
      shift_notes: (draft.shift_type || "").trim() || null,
      notes: (draft.notes || "").trim() || null,
      // city / salary_band are UI-only for now – DB columns not created yet
    };

    setSaveState({ status: "saving" });

    try {
      if (mode === "create") {
        const { data, error } = await supabase
          .from("workforce_jobs")
          .insert(payload)
          .select(
            [
              "id",
              "hotel_id",
              "department",
              "role_name",
              "status",
              "urgency",
              "openings",
              "min_experience_years",
              "max_experience_years",
              "shift_notes",
              "notes",
              "created_at",
              "updated_at",
              "property_id",
              "slug",
              "is_published",
              "published_at",
            ].join(","),
          )
          .maybeSingle();
        if (error) throw error;

        const row = data as any;
        const created: WorkforceJob = {
          ...row,
          title: row.role_name ?? row.title ?? "",
          priority: row.urgency ?? row.priority ?? "normal",
          shift_type: row.shift_notes ?? row.shift_type ?? "",
          city: row.city ?? hotel.city ?? null,
        };

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
          .select(
            [
              "id",
              "hotel_id",
              "department",
              "role_name",
              "status",
              "urgency",
              "openings",
              "min_experience_years",
              "max_experience_years",
              "shift_notes",
              "notes",
              "created_at",
              "updated_at",
              "property_id",
              "slug",
              "is_published",
              "published_at",
            ].join(","),
          )
          .maybeSingle();
        if (error) throw error;

        const row = data as any;
        const updated: WorkforceJob = {
          ...row,
          title: row.role_name ?? row.title ?? "",
          priority: row.urgency ?? row.priority ?? "normal",
          shift_type: row.shift_notes ?? row.shift_type ?? "",
          city: row.city ?? hotel.city ?? null,
        };

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
          t(
            "errors.saveRole",
            "We couldn’t save this role. Please try again or check Supabase logs.",
          ),
      });
    }
  };

  // One-touch applicant stage update
  const updateApplicantStage = async (id: string, stage: string) => {
    try {
      const { error } = await supabase
        .from("workforce_applications")
        .update({ stage })
        .eq("id", id);
      if (error) throw error;

      setApplicants((prev) =>
        prev.map((a) => (a.id === id ? { ...a, stage } : a)),
      );
    } catch (e) {
      console.error("Error updating applicant stage", e);
      setApplicantsError(
        t(
          "errors.updateStage",
          "We couldn’t update this applicant’s stage. Please try again.",
        ),
      );
    }
  };

  const workforceEnabled = HAS_WORKFORCE;

  // ---- Render branches wrapped in OwnerGate + SEO ----

  if (loading) {
    return (
      <>
        <SEO title={t("seoTitle", "Local workforce")} noIndex />
        <OwnerGate>
          <main className="vaiyu-owner min-h-[60vh] grid place-items-center bg-[#0B0E14] text-slate-200">
            <Spinner label={t("loading", "Loading Workforce…")} />
          </main>
        </OwnerGate>
      </>
    );
  }

  if (!hotel) {
    return (
      <>
        <SEO title={t("seoTitle", "Local workforce")} noIndex />
        <OwnerGate>
          <main className="vaiyu-owner max-w-3xl mx-auto p-6 min-h-screen bg-[#0B0E14] text-slate-200">

            <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-6 shadow-sm">
              <div className="mb-2 text-lg font-semibold">
                {t("notAvail.title", "Workforce not available")}
              </div>
              <p className="text-sm text-slate-400">
                {t(
                  "notAvail.body",
                  "We couldn’t find this property. Open it from the Owner Home screen and try again.",
                )}
              </p>
              <div className="mt-4">
                <Link to="/owner" className="btn btn-light">
                  {t("notAvail.ownerHome", "Owner Home")}
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
      <SEO title={t("seoTitle", "Local workforce")} noIndex />
      <OwnerGate>
        <main className="vaiyu-owner min-h-screen bg-[#0B0E14] text-slate-200">
          <div className="mx-auto max-w-7xl space-y-5 px-4 py-4 lg:px-6 lg:py-6">
            {/* Breadcrumb */}
            <div className="flex items-center gap-2 text-xs font-medium text-slate-500 mb-2">
              <Link to={hotel && hotel.slug ? `/owner/${hotel.slug}` : '/owner'} className="hover:text-white transition">{t("crumbDashboard", "Dashboard")}</Link>
              <span className="text-slate-300">/</span>
              <span className="text-slate-200">{t("crumbWorkforce", "Workforce")}</span>
            </div>

            {/* Top header */}
            <header className="flex flex-col gap-3 rounded-3xl border border-white/10 bg-white/5 px-4 py-4 shadow-sm shadow-slate-200/60 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-semibold tracking-tight text-white">
                    {t("header.title", "Local workforce")}
                  </h1>
                  <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-300 ring-1 ring-emerald-500/30">
                    {t("header.beta", "Beta")}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  {t(
                    "header.desc",
                    "Create open roles for this property, see applicants in one place, and move them to shortlisted or hired in a single tap.",
                  )}
                </p>
                {!workforceEnabled && (
                  <p className="mt-1 text-[11px] text-amber-300">
                    {t(
                      "header.notEnabledPre",
                      "Workforce is not fully enabled yet in this project. The UI is safe to explore; saving requires the",
                    )}{" "}
                    <code className="rounded bg-white/10 px-1 text-[10px]">
                      workforce_jobs
                    </code>{" "}
                    {t("header.notEnabledMid", "and")}{" "}
                    <code className="rounded bg-white/10 px-1 text-[10px]">
                      workforce_applications
                    </code>{" "}
                    {t("header.notEnabledPost", "tables to exist.")}
                  </p>
                )}
              </div>
              <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
                <div className="flex flex-col items-end text-right text-[11px] text-slate-500">
                  <span className="font-medium text-slate-200">
                    {hotel.name}
                  </span>
                  <span>
                    {hotel.city ? `${hotel.city} · ` : ""}
                    {t("header.propertyId", "Property ID:")}{" "}
                    {hotel.id.slice(0, 8)}…
                  </span>
                  <span>
                    {t("header.openRoles", "{{count}} open roles", {
                      count: openCount,
                    })}{" "}
                    · {t("header.total", "{{count}} total", { count: jobs.length })}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleStartCreate}
                  className="btn mt-2 h-9 px-4 text-xs sm:mt-0"
                >
                  {t("header.newRole", "+ New role")}
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

                <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3 shadow-sm">
                  <SectionHeader
                    title={t("roles.title", "Roles for this property")}
                    desc={t(
                      "roles.desc",
                      "Every role here is scoped to this hotel only. No cross-property confusion.",
                    )}
                  />
                  {jobsError && (
                    <div className="mb-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-300 ring-1 ring-amber-500/20">
                      {jobsError}
                    </div>
                  )}
                  {filteredJobs.length === 0 ? (
                    <div className="text-sm text-slate-500">
                      {jobs.length === 0
                        ? t(
                            "roles.emptyNoRoles",
                            "No roles yet. Create your first role to start hiring locally.",
                          )
                        : t(
                            "roles.emptyFiltered",
                            "No roles match your filters. Try clearing the filters or search text.",
                          )}
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead className="text-left text-slate-500">
                          <tr>
                            <th className="py-2 pr-3 font-medium">{t("roles.colRole", "Role")}</th>
                            <th className="py-2 pr-3 font-medium">{t("roles.colDept", "Dept")}</th>
                            <th className="py-2 pr-3 font-medium">{t("roles.colCity", "City")}</th>
                            <th className="py-2 pr-3 font-medium">{t("roles.colStatus", "Status")}</th>
                            <th className="py-2 pr-3 font-medium">{t("roles.colPriority", "Priority")}</th>
                            <th className="py-2 pr-3 text-right font-medium">
                              {t("roles.colApplicants", "Applicants")}
                            </th>
                            <th className="py-2 pl-3 text-right font-medium">
                              {t("roles.colOpened", "Opened")}
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
                                className={`cursor-pointer border-t border-white/10 text-[11px] transition-colors hover:bg-white/5 ${isSelected ? "bg-indigo-500/15" : ""
                                  }`}
                                onClick={() => {
                                  setSelectedJobId(job.id);
                                  setMode("view");
                                  setSaveState({ status: "idle" });
                                }}
                              >
                                <td className="py-2 pr-3">
                                  <div className="font-medium text-white">
                                    {job.title || t("roles.untitled", "Untitled role")}
                                  </div>
                                  <div className="text-[10px] text-slate-500">
                                    {job.shift_type
                                      ? t("roles.shiftSuffix", "{{shift}} shift", {
                                          shift: job.shift_type,
                                        })
                                      : t("roles.shiftFlexible", "Shift flexible")}
                                  </div>
                                </td>
                                <td className="py-2 pr-3">
                                  {job.department || "—"}
                                </td>
                                <td className="py-2 pr-3">
                                  {job.city || hotel.city || t("local", "Local")}
                                </td>
                                <td className="py-2 pr-3">
                                  <StatusPill
                                    label={statusLabel(status, t)}
                                    tone={tone}
                                  />
                                </td>
                                <td className="py-2 pr-3">
                                  {priorityLabel(job.priority || "normal", t)}
                                </td>
                                <td className="py-2 pr-3 text-right">
                                  {applicantsCount ?? "—"}
                                </td>
                                <td className="py-2 pl-3 text-right">
                                  {job.created_at
                                    ? fmtDate(job.created_at, ownerLocale)
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
                <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3 shadow-sm">
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
                      {t(
                        "detailEmpty.noRoles",
                        "Start by creating your first role. You can later manage applicants and shortlist in one tap.",
                      )}
                    </div>
                  )}
                </div>
              </div>
            </section>

            {/* Footer helper */}
            <footer className="pt-2">
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-[11px] text-slate-400 shadow-sm">
                {t(
                  "footerTip",
                  "Tip: In the next phase, workforce can plug directly into your “Invisible staff shortage” radar — so if rooms and tickets are suffering because of hiring gaps, you’ll see it here first.",
                )}
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
  const t = useOwnerT("owner-workforce");

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-3 shadow-sm md:flex-row md:items-center md:justify-between">
      <div className="flex-1">
        <input
          className="h-9 w-full rounded-full border border-white/10 bg-white/5 px-3 text-xs text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/60"
          placeholder={t(
            "filter.searchPlaceholder",
            "Search by role, department, city, status…",
          )}
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>
      <div className="flex flex-wrap gap-2 text-[11px] text-slate-400 md:justify-end">
        <select
          className="h-8 rounded-full border border-white/10 bg-white/5 px-2"
          value={status}
          onChange={(e) => onStatusChange(e.target.value)}
        >
          {statusOptions.map((s) => (
            <option key={s} value={s}>
              {s === "all"
                ? t("filter.allStatuses", "All statuses")
                : t(`status.${s}`, capitalize(s))}
            </option>
          ))}
        </select>
        <select
          className="h-8 rounded-full border border-white/10 bg-white/5 px-2"
          value={department}
          onChange={(e) => onDepartmentChange(e.target.value)}
        >
          {departmentOptions.map((d) => (
            <option key={d} value={d}>
              {d === "all" ? t("filter.allDepartments", "All departments") : d}
            </option>
          ))}
        </select>
        <select
          className="h-8 rounded-full border border-white/10 bg-white/5 px-2"
          value={city}
          onChange={(e) => onCityChange(e.target.value)}
        >
          {cityOptions.map((c) => (
            <option key={c} value={c}>
              {c === "all" ? t("filter.allCities", "All cities") : c}
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
        <h2 className="text-sm font-semibold tracking-tight text-white">
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
    green: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
    amber: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
    red: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
    grey: "bg-white/10 text-slate-300 ring-white/20",
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
  const t = useOwnerT("owner-workforce");
  const isSaving = saveState.status === "saving";

  const updateField = (key: keyof WorkforceJob, value: any) => {
    setDraft({ ...draft, [key]: value });
  };

  return (
    <form onSubmit={onSave} className="space-y-3">
      <SectionHeader
        title={
          mode === "create"
            ? t("form.createTitle", "New role")
            : t("form.editTitle", "Edit role")
        }
        desc={t(
          "form.desc",
          "Describe the role clearly. Applicants will see this in their guest app.",
        )}
      />
      <div className="grid gap-2 text-xs md:grid-cols-2">
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-slate-200">
            {t("form.roleTitle", "Role title")}
          </label>
          <input
            className="h-8 w-full rounded-md border border-white/10 bg-white/5 px-2 text-xs"
            required
            value={draft.title || ""}
            onChange={(e) => updateField("title", e.target.value)}
            placeholder={t(
              "form.roleTitlePlaceholder",
              "Front Office Associate, F&B Steward, Room Attendant…",
            )}
          />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-slate-200">
            {t("form.department", "Department")}
          </label>
          <input
            className="h-8 w-full rounded-md border border-white/10 bg-white/5 px-2 text-xs"
            value={draft.department || ""}
            onChange={(e) => updateField("department", e.target.value)}
            placeholder={t(
              "form.departmentPlaceholder",
              "Front Desk, Housekeeping, F&B, Engineering…",
            )}
          />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-slate-200">
            {t("form.cityLocality", "City / Locality")}
          </label>
          <input
            className="h-8 w-full rounded-md border border-white/10 bg-white/5 px-2 text-xs"
            value={draft.city || ""}
            onChange={(e) => updateField("city", e.target.value)}
            placeholder={t(
              "form.cityLocalityPlaceholder",
              "Use property city by default",
            )}
          />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-slate-200">
            {t("form.status", "Status")}
          </label>
          <select
            className="h-8 w-full rounded-md border border-white/10 bg-white/5 px-2 text-xs"
            value={draft.status || "open"}
            onChange={(e) => updateField("status", e.target.value)}
          >
            <option value="open">{t("status.open", "Open")}</option>
            <option value="paused">{t("status.paused", "Paused")}</option>
            <option value="closed">{t("status.closed", "Closed")}</option>
            <option value="draft">{t("status.draft", "Draft")}</option>
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-slate-200">
            {t("form.priority", "Priority")}
          </label>
          <select
            className="h-8 w-full rounded-md border border-white/10 bg-white/5 px-2 text-xs"
            value={draft.priority || "normal"}
            onChange={(e) => updateField("priority", e.target.value)}
          >
            <option value="low">{t("priority.low", "Low")}</option>
            <option value="normal">{t("priority.normal", "Normal")}</option>
            <option value="high">{t("priority.high", "High")}</option>
            <option value="urgent">{t("priority.urgent", "Urgent")}</option>
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-slate-200">
            {t("form.shiftType", "Shift type")}
          </label>
          <input
            className="h-8 w-full rounded-md border border-white/10 bg-white/5 px-2 text-xs"
            value={draft.shift_type || ""}
            onChange={(e) => updateField("shift_type", e.target.value)}
            placeholder={t(
              "form.shiftTypePlaceholder",
              "Rotational, Morning, Night-only…",
            )}
          />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-slate-200">
            {t("form.salaryBand", "Salary band (optional)")}
          </label>
          <input
            className="h-8 w-full rounded-md border border-white/10 bg-white/5 px-2 text-xs"
            value={draft.salary_band || ""}
            onChange={(e) => updateField("salary_band", e.target.value)}
            placeholder={t(
              "form.salaryBandPlaceholder",
              "e.g. ₹16k–₹20k per month",
            )}
          />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-slate-200">
            {t("form.openings", "No. of openings")}
          </label>
          <input
            type="number"
            min={1}
            className="h-8 w-full rounded-md border border-white/10 bg-white/5 px-2 text-xs"
            value={draft.openings ?? 1}
            onChange={(e) =>
              updateField("openings", Number(e.target.value) || 1)
            }
          />
        </div>
      </div>
      <div className="space-y-1 text-xs">
        <label className="text-[11px] font-medium text-slate-200">
          {t("form.notes", "Notes for hiring team (internal)")}
        </label>
        <textarea
          rows={3}
          className="w-full rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs"
          value={draft.notes || ""}
          onChange={(e) => updateField("notes", e.target.value)}
          placeholder={t(
            "form.notesPlaceholder",
            "What kind of profile works best? Any hard constraints or must-have qualities?",
          )}
        />
      </div>
      {saveState.status === "error" && (
        <div className="rounded-md bg-rose-500/10 px-3 py-2 text-[11px] text-rose-300 ring-1 ring-rose-500/20">
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
          {t("form.cancel", "Cancel")}
        </button>
        <button
          type="submit"
          disabled={isSaving}
          className="btn h-8 px-4 text-xs"
        >
          {isSaving
            ? t("form.saving", "Saving…")
            : mode === "create"
              ? t("form.create", "Create role")
              : t("form.save", "Save changes")}
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
  const t = useOwnerT("owner-workforce");
  const status = (job.status || "open").toLowerCase();
  const tone =
    status.includes("closed") || status.includes("filled")
      ? ("grey" as const)
      : status.includes("paused")
        ? ("amber" as const)
        : ("green" as const);

  return (
    <div className="space-y-3 text-xs text-slate-200">
      <SectionHeader
        title={job.title || t("roles.untitled", "Untitled role")}
        desc={
          job.department
            ? `${job.department} · ${job.city || t("local", "Local")}`
            : job.city || t("local", "Local")
        }
        action={
          <button
            type="button"
            onClick={onEdit}
            className="btn btn-light h-8 px-3 text-xs"
          >
            {t("detail.editRole", "Edit role")}
          </button>
        }
      />
      <div className="flex flex-wrap gap-2">
        <StatusPill label={statusLabel(status, t)} tone={tone} />
        {job.priority && (
          <StatusPill
            label={t("detail.priorityPill", "{{label}} priority", {
              label: priorityLabel(job.priority, t),
            })}
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
          <span className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-slate-400 ring-1 ring-white/15">
            {t("roles.shiftSuffix", "{{shift}} shift", { shift: job.shift_type })}
          </span>
        )}
        {job.openings != null && (
          <span className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-slate-400 ring-1 ring-white/15">
            {t("detail.openingsPill", "{{count}} openings", {
              count: job.openings,
            })}
          </span>
        )}
      </div>
      {job.salary_band && (
        <div className="text-[11px] text-slate-400">
          {t("detail.salaryBand", "Salary band: {{band}}", {
            band: job.salary_band,
          })}
        </div>
      )}
      {job.notes && (
        <div className="rounded-md bg-white/5 px-3 py-2 text-[11px] text-slate-200">
          {job.notes}
        </div>
      )}

      <div className="mt-2 border-t border-white/10 pt-3">
        <SectionHeader
          title={t("detail.applicantsTitle", "Applicants for this role")}
          desc={t(
            "detail.applicantsDesc",
            "Shortlist or move someone to hired in one tap.",
          )}
        />
        {applicantsError && (
          <div className="mb-2 rounded-md bg-rose-500/10 px-3 py-2 text-[11px] text-rose-300 ring-1 ring-rose-500/20">
            {applicantsError}
          </div>
        )}
        {applicantsLoading ? (
          <div className="text-xs text-slate-500">
            {t("loadingApplicants", "Loading applicants…")}
          </div>
        ) : applicants.length === 0 ? (
          <div className="text-xs text-slate-500">
            {t(
              "detail.noApplicants",
              "No applicants yet. Once candidates apply from the guest app or your share link, they’ll show here automatically.",
            )}
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
  const t = useOwnerT("owner-workforce");
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
    <div className="flex items-start justify-between gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[11px]">
      <div>
        <div className="font-medium text-white">
          {applicant.full_name || t("applicant.unnamed", "Unnamed applicant")}
        </div>
        <div className="text-[10px] text-slate-500">
          {applicant.source || t("applicant.sourceDefault", "Source: Guest app")}
          {applicant.rating != null &&
            ` · ${t("applicant.rating", "Rating {{rating}}/5", {
              rating: applicant.rating,
            })}`}
        </div>
        {(applicant.phone || applicant.email) && (
          <div className="mt-0.5 text-[10px] text-slate-500">
            {applicant.phone && <span>📞 {applicant.phone} </span>}
            {applicant.email && <span> · ✉️ {applicant.email}</span>}
          </div>
        )}
        {applicant.message && (
          <div className="mt-1 text-[10px] text-slate-400">
            {applicant.message}
          </div>
        )}
        {applicant.notes && (
          <div className="mt-1 text-[10px] text-slate-400">
            {applicant.notes}
          </div>
        )}
      </div>
      <div className="flex flex-col items-end gap-1">
        <StatusPill label={stageLabel(stage, t)} tone={tone} />
        <div className="flex flex-wrap justify-end gap-1">
          <button
            type="button"
            onClick={() => onUpdateStage(applicant.id, "shortlisted")}
            className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-300 ring-1 ring-emerald-500/30"
          >
            {t("applicant.shortlist", "Shortlist")}
          </button>
          <button
            type="button"
            onClick={() => onUpdateStage(applicant.id, "hired")}
            className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] text-sky-300 ring-1 ring-sky-500/30"
          >
            {t("applicant.markHired", "Mark hired")}
          </button>
          <button
            type="button"
            onClick={() => onUpdateStage(applicant.id, "rejected")}
            className="rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] text-rose-300 ring-1 ring-rose-500/30"
          >
            {t("applicant.reject", "Reject")}
          </button>
        </div>
      </div>
    </div>
  );
}

function EmptyDetailCard() {
  const t = useOwnerT("owner-workforce");
  return (
    <div className="space-y-2 text-xs text-slate-400">
      <div className="font-medium text-slate-200">
        {t("detailEmpty.title", "Select a role on the left")}
      </div>
      <p>
        {t(
          "detailEmpty.body",
          "You’ll see role details here along with every applicant. From here, the owner or HR can shortlist or mark someone as hired with a single tap.",
        )}
      </p>
    </div>
  );
}

/** ===== small helpers ===== */

function capitalize(v: string) {
  if (!v) return v;
  return v.charAt(0).toUpperCase() + v.slice(1);
}

function fmtDate(iso: string, locale: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(locale, {
    day: "2-digit",
    month: "short",
  });
}

function statusLabel(status: string, t: OwnerT) {
  if (status.includes("closed") || status.includes("filled"))
    return t("status.closed", "Closed");
  if (status.includes("paused")) return t("status.paused", "Paused");
  if (status.includes("draft")) return t("status.draft", "Draft");
  return t("status.open", "Open");
}

function priorityLabel(priority: string, t: OwnerT) {
  return t(`priority.${priority}`, capitalize(priority));
}

function stageLabel(stage: string, t: OwnerT) {
  if (stage === "hired") return t("stage.hired", "Hired");
  if (stage === "shortlisted") return t("stage.shortlisted", "Shortlisted");
  if (stage === "rejected") return t("stage.rejected", "Rejected");
  if (stage === "interview") return t("stage.interview", "Interviewing");
  return t("stage.new", "New");
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
