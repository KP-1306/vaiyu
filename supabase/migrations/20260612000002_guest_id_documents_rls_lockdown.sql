-- RLS lockdown — guest_id_documents (missed by 20260602001007 phase-2 sweep).
--
-- THE LEAK: policy "Staff can view all documents" is `FOR SELECT TO authenticated
-- USING (true)`. RLS policies are OR'd, so this `true` overrides every other
-- (correct) policy on the table — ANY authenticated user, including a guest
-- logged into the guest portal, can `select * from guest_id_documents` and read
-- EVERY guest's Aadhaar/passport across the whole platform (unmasked
-- document_number + raw storage paths). Proven on local: a non-member auth user
-- saw all rows before this fix, 0 after.
--
-- WHY MEMBERSHIP-SCOPED, NOT HOTEL-SCOPED (the deviation from phase-2):
-- guest_id_documents has NO hotel_id column. It is a GLOBAL, per-guest table
-- (one guest per mobile via uq_global_guest_mobile; upsert_guest_v2 resolves by
-- mobile with no hotel scope). The "upload ID once, reuse at any VAiyu hotel"
-- flow is intentional (WalkInPayment resolves a returning guest by mobile and
-- reuses their existing document). A hotel-scoped policy (hm.hotel_id =
-- table.hotel_id) is therefore impossible here and would break that reuse. The
-- correct gate is "requester is active staff at SOME hotel" — i.e. a member of
-- hotel_members, not a guest/anon.
--
-- WHY MEMBERSHIP, NOT ROLE: the pre-existing staff_view_documents required an
-- hotel_member_roles (M2M) row. Per the auth model, legacy-invited staff can be
-- active members with NO M2M role row (8 such members on local) — a role gate
-- would silently lock them out of doc reuse. Membership (is_active) covers them.
--
-- The image bytes are independently protected by the get-document-url Edge
-- Function (relationship-gated to the caller's hotels, rate-limited, audited to
-- identity_document_views, masked number). This migration only governs the
-- direct table read used by WalkInPayment for the raw reuse paths.
--
-- Also drops two dead `WITH CHECK (true)` INSERT policies: real uploads go
-- through the service-role upload-guest-id Edge Function (RLS-immune) and the
-- insert RPCs (process_checkin / submit_precheckin / upsert_guest_v2) are all
-- SECURITY DEFINER. No client does a direct insert. The narrow
-- insert_guest_documents + "Guests can insert own valid docs" policies remain.
--
-- Idempotent (DROP IF EXISTS → CREATE). service_role is unaffected (BYPASSRLS).

-- ─── 1. Remove the SELECT leak ──────────────────────────────────────────────
DROP POLICY IF EXISTS "Staff can view all documents" ON public.guest_id_documents;

-- ─── 2. Replace the role-gated staff SELECT with a membership-based gate ─────
--      (covers legacy members with no M2M role; preserves cross-hotel reuse).
DROP POLICY IF EXISTS "staff_view_documents" ON public.guest_id_documents;
CREATE POLICY "staff_view_documents"
  ON public.guest_id_documents
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.hotel_members hm
            WHERE hm.user_id = auth.uid()
              AND hm.is_active = true)
  );

-- ─── 3. Drop dead WITH CHECK(true) INSERT policies (uploads are service-role) ─
DROP POLICY IF EXISTS "Anon can upload documents"         ON public.guest_id_documents;
DROP POLICY IF EXISTS "Staff/System can upload documents" ON public.guest_id_documents;

-- Untouched (kept): "Guests can view own docs", "guest_view_own_documents"
-- (guest self-view), "insert_guest_documents", "Guests can insert own valid
-- docs". RLS remains enabled on the table.
