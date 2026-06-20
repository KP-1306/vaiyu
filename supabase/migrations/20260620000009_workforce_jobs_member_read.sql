-- ============================================================
-- VAiyu: workforce_jobs — restore owner/staff read-back (RETURNING)
-- ============================================================
-- Regression from Group 3 (20260620000007): dropping the over-broad SELECT
-- policies (incl. workforce_jobs_select_auth, USING auth.role()='authenticated')
-- removed the visibility that let an owner read a row back. The surviving SELECT
-- policies scope via user_profiles, which some owners/staff don't match — so the
-- "Edit role" save (UPDATE … .select()) and create (INSERT … .select()) got a
-- NULL RETURNING → the UI crashed ("Cannot read properties of null (role_name)").
-- The write committed; only the read-back failed.
--
-- FIX: add a hotel-member-scoped SELECT policy (the correct scoping, via the
-- proven SD helper vaiyu_is_hotel_member). Owners/staff of the job's hotel can
-- read back their own hotel's roles, so create/edit RETURNING works again.
--
-- SAFE / non-disturbing: RLS SELECT policies are PERMISSIVE (OR-combined), so this
-- only GRANTS members visibility to their own hotel's rows. It does not alter or
-- weaken the existing policies: the public careers policy (status=open AND
-- is_published) and the user_profiles-scoped staff policies are untouched, and it
-- does NOT re-open the USING(true) leak (a member of hotel A still cannot see
-- hotel B's unpublished roles).
-- ============================================================

CREATE POLICY "wf_jobs members of hotel read"
  ON public.workforce_jobs
  FOR SELECT
  TO authenticated
  USING (public.vaiyu_is_hotel_member(hotel_id));
