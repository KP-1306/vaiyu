-- ============================================================
-- VAiyu WRITE-PATH AUDIT (4/5): owner_applications — intake-only INSERT
-- ============================================================
-- FINDING (class C): owner_applications had two anon/public INSERT policies, both
-- WITH CHECK (true). The table carries review/decision columns (status default
-- 'pending', reviewed_at, reviewer_id, review_notes, rejected_reason), so a
-- public submitter could INSERT status='approved' with a forged reviewer_id —
-- self-"approving" a partner application and polluting the admin review queue.
--
-- There is currently NO caller (no web/src, edge, or RPC writes this table), so
-- locking it to intake-only values is zero-risk today and the correct posture if
-- the public "list your hotel" form is (re)wired later: a submission may only
-- create a fresh pending row; the decision columns must stay server-controlled
-- (set later via the existing admin UPDATE policy "owner_apps admin update").
--
-- FIX: replace the two CHECK(true) INSERT policies with one intake-only policy.
-- The admin UPDATE policy is left untouched. Idempotent.
-- ============================================================

DROP POLICY IF EXISTS "owner_apps insert"                    ON public.owner_applications;
DROP POLICY IF EXISTS "public can submit owner applications" ON public.owner_applications;

CREATE POLICY "owner_apps_public_intake"
  ON public.owner_applications
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    status = 'pending'
    AND reviewed_at     IS NULL
    AND reviewer_id     IS NULL
    AND review_notes    IS NULL
    AND rejected_reason IS NULL
  );
