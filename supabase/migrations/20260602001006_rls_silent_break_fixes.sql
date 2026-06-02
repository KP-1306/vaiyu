-- RLS silent-break fixes — Phase 1
--
-- Same pathology as folios (20260602001005): RLS is ENABLED on these tables
-- but ZERO policies exist, so every authenticated query returns nothing.
-- Pages and surfaces that read these tables fail silently with empty data.
--
-- Tables in this migration:
--   • arrival_events       — arrival timeline (used by Arrivals + audit)
--   • housekeeping_tasks   — HK task board
--   • housekeeping_events  — HK status-change timeline
--   • task_events          — ticket activity timeline
--   • guest_accounts       — guest identity store
--
-- Policy pattern mirrors the existing `payments` table:
--   • staff (hotel_members) — ALL within their hotel
--   • service_role          — ALL (explicit for auditability)
--   • guests / external     — narrow SELECT via existing helpers
--
-- DROP IF EXISTS + CREATE for idempotent re-apply.

-- ─── arrival_events ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS "arrival_events_staff_all"        ON public.arrival_events;
DROP POLICY IF EXISTS "arrival_events_service_role_all" ON public.arrival_events;

CREATE POLICY "arrival_events_staff_all"
  ON public.arrival_events
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.hotel_members hm
      WHERE hm.hotel_id = arrival_events.hotel_id
        AND hm.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.hotel_members hm
      WHERE hm.hotel_id = arrival_events.hotel_id
        AND hm.user_id = auth.uid()
    )
  );

CREATE POLICY "arrival_events_service_role_all"
  ON public.arrival_events
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ─── housekeeping_tasks ─────────────────────────────────────────────────
DROP POLICY IF EXISTS "housekeeping_tasks_staff_all"        ON public.housekeeping_tasks;
DROP POLICY IF EXISTS "housekeeping_tasks_service_role_all" ON public.housekeeping_tasks;

CREATE POLICY "housekeeping_tasks_staff_all"
  ON public.housekeeping_tasks
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.hotel_members hm
      WHERE hm.hotel_id = housekeeping_tasks.hotel_id
        AND hm.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.hotel_members hm
      WHERE hm.hotel_id = housekeeping_tasks.hotel_id
        AND hm.user_id = auth.uid()
    )
  );

CREATE POLICY "housekeeping_tasks_service_role_all"
  ON public.housekeeping_tasks
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ─── housekeeping_events ────────────────────────────────────────────────
DROP POLICY IF EXISTS "housekeeping_events_staff_all"        ON public.housekeeping_events;
DROP POLICY IF EXISTS "housekeeping_events_service_role_all" ON public.housekeeping_events;

CREATE POLICY "housekeeping_events_staff_all"
  ON public.housekeeping_events
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.hotel_members hm
      WHERE hm.hotel_id = housekeeping_events.hotel_id
        AND hm.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.hotel_members hm
      WHERE hm.hotel_id = housekeeping_events.hotel_id
        AND hm.user_id = auth.uid()
    )
  );

CREATE POLICY "housekeeping_events_service_role_all"
  ON public.housekeeping_events
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ─── task_events ─────────────────────────────────────────────────────────
-- task_events has no hotel_id; scope through tickets.hotel_id.
DROP POLICY IF EXISTS "task_events_staff_all"        ON public.task_events;
DROP POLICY IF EXISTS "task_events_service_role_all" ON public.task_events;

CREATE POLICY "task_events_staff_all"
  ON public.task_events
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.tickets t
      JOIN public.hotel_members hm ON hm.hotel_id = t.hotel_id
      WHERE t.id = task_events.task_id
        AND hm.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.tickets t
      JOIN public.hotel_members hm ON hm.hotel_id = t.hotel_id
      WHERE t.id = task_events.task_id
        AND hm.user_id = auth.uid()
    )
  );

CREATE POLICY "task_events_service_role_all"
  ON public.task_events
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ─── guest_accounts ─────────────────────────────────────────────────────
-- Guest identity store. No hotel_id. A guest sees their own row via
-- guest_user_map; staff see the guest_account corresponding to bookings at
-- their hotel.
DROP POLICY IF EXISTS "guest_accounts_self_select"   ON public.guest_accounts;
DROP POLICY IF EXISTS "guest_accounts_staff_select"  ON public.guest_accounts;
DROP POLICY IF EXISTS "guest_accounts_service_role"  ON public.guest_accounts;

CREATE POLICY "guest_accounts_self_select"
  ON public.guest_accounts
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.guest_user_map gum
      WHERE gum.user_id = auth.uid()
        AND gum.guest_id = guest_accounts.id
    )
  );

CREATE POLICY "guest_accounts_staff_select"
  ON public.guest_accounts
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.bookings b
      JOIN public.hotel_members hm ON hm.hotel_id = b.hotel_id
      WHERE b.guest_id = guest_accounts.id
        AND hm.user_id = auth.uid()
    )
  );

CREATE POLICY "guest_accounts_service_role"
  ON public.guest_accounts
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);
