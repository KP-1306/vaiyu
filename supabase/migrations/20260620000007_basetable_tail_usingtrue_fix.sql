-- ============================================================
-- VAiyu: base-table anon tail — Group 3 (USING(true) policy fixes)
-- ============================================================
-- These 4 tables had RLS ON but a permissive USING(true)/role-any policy open to
-- PUBLIC/anon. Each keeps its legit scoped policies; we drop only the wide-open
-- ones and add scoped reads where needed. Legit anon paths preserved (careers
-- apply INSERT; public open-jobs read).
-- ============================================================

-- 1. chat_messages: drop the [ALL] USING(true) PUBLIC policy (anon read AND write).
--    Keep the scoped guest read/insert + staff [ALL] policies. Guests are
--    authenticated (current_guest_id() <- auth.uid()); anon has no business here.
DROP POLICY IF EXISTS "Guests can access messages by stay_id" ON public.chat_messages;
REVOKE ALL ON public.chat_messages FROM anon, PUBLIC;
GRANT  SELECT, INSERT, UPDATE, DELETE ON public.chat_messages TO authenticated;
GRANT  ALL ON public.chat_messages TO service_role;

-- 2. ticket_attachments: the only SELECT policy was USING(true) PUBLIC. Replace
--    with "members of the ticket's hotel" (via tickets, which is member-scoped by
--    its own RLS). Keep authenticated upload (INSERT). Revoke anon.
DROP POLICY IF EXISTS "Public read access to ticket attachments" ON public.ticket_attachments;
REVOKE ALL ON public.ticket_attachments FROM anon, PUBLIC;
GRANT  SELECT, INSERT ON public.ticket_attachments TO authenticated;
GRANT  ALL ON public.ticket_attachments TO service_role;
CREATE POLICY "ta read via visible ticket"
  ON public.ticket_attachments
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tickets t WHERE t.id = ticket_attachments.ticket_id));

-- 3. workforce_applicants: drop the USING(true) + role-any SELECT policies (any
--    account could read all applicant PII). Add "staff of the job's hotel" read.
--    KEEP the anon INSERT (public careers application) + service_role policy.
DROP POLICY IF EXISTS "owners-staff-see-applicants" ON public.workforce_applicants;
DROP POLICY IF EXISTS "workforce_applicants_select_auth" ON public.workforce_applicants;
REVOKE SELECT ON public.workforce_applicants FROM anon, PUBLIC;   -- anon keeps INSERT
GRANT  SELECT ON public.workforce_applicants TO authenticated;
CREATE POLICY "wa read by job-hotel staff"
  ON public.workforce_applicants
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.workforce_jobs j
    WHERE j.id = workforce_applicants.job_id
      AND public.vaiyu_is_hotel_member(j.hotel_id)
  ));

-- 4. workforce_jobs: drop the two over-broad SELECT policies (USING(true) +
--    role-any) that exposed ALL jobs incl unpublished/internal notes. The scoped
--    staff policies + the public careers policy (status=open AND is_published)
--    remain, so anon now sees only open+published jobs. No grant change (anon
--    SELECT is still needed for the public careers listing).
DROP POLICY IF EXISTS "owners-staff-see-jobs" ON public.workforce_jobs;
DROP POLICY IF EXISTS "workforce_jobs_select_auth" ON public.workforce_jobs;
