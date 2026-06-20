-- ============================================================
-- VAiyu WRITE-PATH AUDIT (3/5): workforce anon INSERT + pipeline escalation
-- ============================================================
-- FINDING A (class C — subtle {public} ALL policy): on workforce_jobs and
-- workforce_applicants, the "<t>_service_role_all" policies were granted to role
-- {public} (not {service_role}) with USING (auth.role()='service_role') and
-- WITH CHECK (true). For INSERT, Postgres evaluates only WITH CHECK — so the
-- USING service_role gate is bypassed on INSERT and ANY anon client could INSERT.
--   → anon could post FAKE job listings (workforce_jobs) shown on the public
--     careers page, and inject applicant rows.
-- Owner job create/edit does NOT depend on these policies — it runs through the
-- dedicated user_profiles-scoped policies (staff_manage_jobs_for_property,
-- owners-staff-insert-jobs, owners-staff-update-jobs). So re-scoping the role to
-- {service_role} closes the anon-INSERT hole with zero impact on owners.
--
-- FINDING B (pipeline escalation): the public apply INSERT policies on
-- workforce_applications used WITH CHECK (true), letting an applicant self-set
-- privileged columns — stage='hired' / rating=5 — i.e. advance themselves
-- through the hiring pipeline (the table's own stage CHECK permits
-- applied/screened/interviewing/offered/hired/rejected, so ONLY RLS blocks the
-- escalation). The intended public-intake form (PublicJobs.tsx) sends
-- stage='applied', no rating; the owner advances stage later via the separate
-- UPDATE policies (unaffected). Lockdown: stage may only be 'applied' (NULL-safe
-- via IS NOT DISTINCT FROM; the column default is 'applied' so an omitted stage
-- still passes), rating must be NULL, job_id required. `notes` stays writable
-- (free text, not an escalation vector).
--
-- workforce_applicants is DEAD (0 callers in web/src+edge, 0 rows, live careers
-- apply is mailto via Careers.tsx; PublicJobs/GuestWorkforceApply are unmounted).
-- It has no stage CHECK to anchor an allowlist, so rather than guess a domain we
-- LOCK its anon INSERT to service_role. A future public-applicant feature gets a
-- properly guarded policy when it is actually built.
--
-- All changes idempotent.
-- ============================================================

-- ── workforce_jobs: close the {public} INSERT side-effect ──────────────────
DROP POLICY IF EXISTS "workforce_jobs_service_role_all" ON public.workforce_jobs;
CREATE POLICY "workforce_jobs_service_role_all"
  ON public.workforce_jobs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ── workforce_applicants: same {public}→service_role fix + escalation lockdown ─
DROP POLICY IF EXISTS "workforce_applicants_service_role_all" ON public.workforce_applicants;
CREATE POLICY "workforce_applicants_service_role_all"
  ON public.workforce_applicants
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Dead table → lock anon INSERT entirely (drop, do not recreate). service_role
-- retains access via workforce_applicants_service_role_all above.
DROP POLICY IF EXISTS "public-submit-application" ON public.workforce_applicants;

-- ── workforce_applications: consolidate the two open INSERT policies into one
--    escalation-safe public-apply policy ─────────────────────────────────────
DROP POLICY IF EXISTS "anyone_can_apply_for_job" ON public.workforce_applications;
DROP POLICY IF EXISTS "guests-apply-for-jobs"    ON public.workforce_applications;
CREATE POLICY "public-apply-for-job"
  ON public.workforce_applications
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    job_id IS NOT NULL
    AND stage IS NOT DISTINCT FROM 'applied'
    AND rating IS NULL
  );
