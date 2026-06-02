-- folios RLS policies
--
-- Bug: the baseline migration enables RLS on public.folios but creates no
-- policies. With RLS on and no policies, every SELECT through anon /
-- authenticated returns zero rows — which silently breaks the Outstanding
-- Balance card, walk-in checkout, guest folio view, and any other surface
-- that joins through `folios` (e.g. PostgREST `folios!inner(status)`).
--
-- The intended access model mirrors `payments`:
--   • Hotel staff (any role in hotel_members) get ALL on folios for their
--     hotel. Folios are operational containers; permission boundaries are
--     enforced on the actual money rows (folio_entries / payments) by other
--     triggers and policies.
--   • Guests get SELECT on folios attached to their own bookings, so the
--     guest portal can render their bill.
--   • Anon gets nothing (no policy → no access).
--
-- All scoping uses hotel_members (multi-tenant RLS pattern from CLAUDE.md)
-- and `current_guest_id()` (the existing helper used by bookings + payments
-- guest-view policies).
--
-- IF NOT EXISTS-style idempotency: drop first, then create, so this can be
-- re-applied safely if the schema-migrations ledger gets out of sync.

DROP POLICY IF EXISTS "folios_staff_all"        ON public.folios;
DROP POLICY IF EXISTS "folios_guest_view_own"   ON public.folios;
DROP POLICY IF EXISTS "folios_service_role_all" ON public.folios;

-- Staff at the same hotel can read/write any folio for that hotel. The
-- restriction on creating folios for OTHER hotels is enforced by the
-- existence check against `hotel_members.hotel_id = folios.hotel_id`.
CREATE POLICY "folios_staff_all"
  ON public.folios
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.hotel_members hm
      WHERE hm.hotel_id = folios.hotel_id
        AND hm.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.hotel_members hm
      WHERE hm.hotel_id = folios.hotel_id
        AND hm.user_id = auth.uid()
    )
  );

-- Guests can view their own folios — joined via bookings.guest_id matching
-- the current guest session. folios.booking_id is nullable, so guard with
-- IS NOT NULL to avoid a NULL-vs-NULL match.
CREATE POLICY "folios_guest_view_own"
  ON public.folios
  FOR SELECT
  TO authenticated
  USING (
    booking_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.bookings b
      WHERE b.id = folios.booking_id
        AND b.guest_id = public.current_guest_id()
    )
  );

-- Service role bypass — explicit for clarity. Service role generally
-- bypasses RLS already, but adding a permissive policy here makes the intent
-- legible to anyone auditing the table.
CREATE POLICY "folios_service_role_all"
  ON public.folios
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
