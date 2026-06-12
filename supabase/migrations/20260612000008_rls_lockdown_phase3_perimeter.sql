-- RLS lockdown — Phase 3: close the perimeter the 24-table lockdown missed.
--
-- A cross-tenant audit (two-hotel visibility matrix on local) found the 24
-- tables from 20260602001005/6/7 are correctly sealed, BUT a set of OLDER
-- permissive policies — literal `USING (true)` granted to `authenticated`
-- (and some `anon`), several named "Public view X" — left these hotel-scoped
-- tables fully cross-tenant readable, and two cross-tenant WRITABLE:
--
--   food_orders, food_order_items, food_order_sla_state, checkin_sessions(ALL),
--   checkin_events, chat_threads, feedback_tokens, rooms, shift_override_requests(ALL)
--   + tickets (the `current_assignee_id IS NULL` branch had no hotel filter)
--
-- Evidence (local): a Hotel A staffer saw all 22 food_orders across 4 hotels;
-- a Hotel-A-only staffer read 4 unassigned tickets belonging to 3 other hotels.
--
-- Each fix DROPs the blanket-true policy and ADDs the standard hotel_members
-- staff scope used by the existing lockdown — while PRESERVING verified
-- non-staff paths (confirmed against app code, not assumed):
--   • feedback_tokens — guests validate via SECURITY DEFINER rpc
--     `validate_feedback_token` (GuestFeedback.tsx), never a direct anon read,
--     so both blanket selects are safe to drop.
--   • food_order_items / food_order_sla_state — read by the authenticated
--     guest tracker (FoodOrderTracker / GuestNewHome via current_guest_id),
--     so a guest-own policy is ADDED alongside the staff seal.
--   • rooms — the guest food tracker reads the room on its own order
--     (FoodOrderTracker.tsx:168), so a guest-own-room policy is ADDED; existing
--     staff read/write policies are left intact (only "Public view rooms" drops).
--   • checkin_sessions — anon precheckin create + anon read-own (by session_id
--     jwt claim) are KEPT; only the authenticated ALL-true is replaced.
--
-- NOT global-leaks (verified as platform seed catalogs, intentionally public):
--   asset_requirements, seasonal_calendar_windows — left untouched.
--
-- Globally not-a-leak but flagged for follow-up (NOT fixed here — it is an
-- over-tight, not a cross-tenant leak): tickets.supervisors_and_owners_see_all
-- checks uppercase 'OWNER'/'SUPERVISOR' only, so legacy lowercase 'owner'
-- members can't see their hotel's full ticket board. Tracked separately.
--
-- All policies idempotent (DROP IF EXISTS → CREATE).

-- ════════════════════════════════════════════════════════════════════════
-- FOOD ORDERS (parent) — seal cross-tenant read; keep guest-own
-- ════════════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "Public view food orders"   ON public.food_orders;
DROP POLICY IF EXISTS "food_orders_staff_all"      ON public.food_orders;
CREATE POLICY "food_orders_staff_all"
  ON public.food_orders FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.hotel_members hm
                 WHERE hm.hotel_id = food_orders.hotel_id AND hm.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.hotel_members hm
                 WHERE hm.hotel_id = food_orders.hotel_id AND hm.user_id = auth.uid()));
-- "Guests can view own orders" (existing) is preserved.

-- ─── food_order_items ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "Public view food items"            ON public.food_order_items;
DROP POLICY IF EXISTS "food_order_items_staff_all"        ON public.food_order_items;
DROP POLICY IF EXISTS "food_order_items_guest_view_own"   ON public.food_order_items;
CREATE POLICY "food_order_items_staff_all"
  ON public.food_order_items FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.food_orders fo
                 JOIN public.hotel_members hm ON hm.hotel_id = fo.hotel_id
                 WHERE fo.id = food_order_items.food_order_id AND hm.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.food_orders fo
                 JOIN public.hotel_members hm ON hm.hotel_id = fo.hotel_id
                 WHERE fo.id = food_order_items.food_order_id AND hm.user_id = auth.uid()));
CREATE POLICY "food_order_items_guest_view_own"
  ON public.food_order_items FOR SELECT TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM public.food_orders fo
    LEFT JOIN public.stays s ON s.id = fo.stay_id
    WHERE fo.id = food_order_items.food_order_id
      AND (s.guest_id = public.current_guest_id()
           OR EXISTS (SELECT 1 FROM public.stay_guests sg
                      WHERE sg.stay_id = s.id AND sg.guest_id = public.current_guest_id()))));

-- ─── food_order_sla_state ──────────────────────────────────────────────
DROP POLICY IF EXISTS "Public view food sla"                  ON public.food_order_sla_state;
DROP POLICY IF EXISTS "food_order_sla_state_staff_all"        ON public.food_order_sla_state;
DROP POLICY IF EXISTS "food_order_sla_state_guest_view_own"   ON public.food_order_sla_state;
CREATE POLICY "food_order_sla_state_staff_all"
  ON public.food_order_sla_state FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.food_orders fo
                 JOIN public.hotel_members hm ON hm.hotel_id = fo.hotel_id
                 WHERE fo.id = food_order_sla_state.food_order_id AND hm.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.food_orders fo
                 JOIN public.hotel_members hm ON hm.hotel_id = fo.hotel_id
                 WHERE fo.id = food_order_sla_state.food_order_id AND hm.user_id = auth.uid()));
CREATE POLICY "food_order_sla_state_guest_view_own"
  ON public.food_order_sla_state FOR SELECT TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM public.food_orders fo
    LEFT JOIN public.stays s ON s.id = fo.stay_id
    WHERE fo.id = food_order_sla_state.food_order_id
      AND (s.guest_id = public.current_guest_id()
           OR EXISTS (SELECT 1 FROM public.stay_guests sg
                      WHERE sg.stay_id = s.id AND sg.guest_id = public.current_guest_id()))));

-- ════════════════════════════════════════════════════════════════════════
-- ROOMS — drop public read; ADD guest-own-room. Staff policies kept as-is.
-- ════════════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "Public view rooms"          ON public.rooms;
DROP POLICY IF EXISTS "rooms_guest_view_own_stay"  ON public.rooms;
CREATE POLICY "rooms_guest_view_own_stay"
  ON public.rooms FOR SELECT TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM public.stays s
    WHERE s.room_id = rooms.id
      AND (s.guest_id = public.current_guest_id()
           OR EXISTS (SELECT 1 FROM public.stay_guests sg
                      WHERE sg.stay_id = s.id AND sg.guest_id = public.current_guest_id()))));

-- ════════════════════════════════════════════════════════════════════════
-- CHECK-IN — seal session manage to staff-hotel; keep anon precheckin paths
-- ════════════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "Authenticated users can manage checkin sessions" ON public.checkin_sessions;
DROP POLICY IF EXISTS "checkin_sessions_staff_all"                       ON public.checkin_sessions;
CREATE POLICY "checkin_sessions_staff_all"
  ON public.checkin_sessions FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.hotel_members hm
                 WHERE hm.hotel_id = checkin_sessions.hotel_id AND hm.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.hotel_members hm
                 WHERE hm.hotel_id = checkin_sessions.hotel_id AND hm.user_id = auth.uid()));
-- "Anon can create checkin sessions" + "Anon can read own checkin session" kept.

-- ─── checkin_events — drop blanket staff view; scope via session/stay→hotel
DROP POLICY IF EXISTS "Staff can view events"        ON public.checkin_events;
DROP POLICY IF EXISTS "checkin_events_staff_view"    ON public.checkin_events;
CREATE POLICY "checkin_events_staff_view"
  ON public.checkin_events FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.checkin_sessions cs
            JOIN public.hotel_members hm ON hm.hotel_id = cs.hotel_id
            WHERE cs.id = checkin_events.session_id AND hm.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.stays s
               JOIN public.hotel_members hm ON hm.hotel_id = s.hotel_id
               WHERE s.id = checkin_events.stay_id AND hm.user_id = auth.uid())
  );
-- INSERT policies (anon/authenticated/service) kept: append-only event log.

-- ════════════════════════════════════════════════════════════════════════
-- CHAT THREADS — owner-internal; seal read to staff-hotel
-- ════════════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "chat_threads_read_auth"   ON public.chat_threads;
DROP POLICY IF EXISTS "chat_threads_staff_read"  ON public.chat_threads;
CREATE POLICY "chat_threads_staff_read"
  ON public.chat_threads FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.hotel_members hm
                 WHERE hm.hotel_id = chat_threads.hotel_id AND hm.user_id = auth.uid()));
-- chat_threads_insert_auth + service kept (writes go via app/service paths).

-- ════════════════════════════════════════════════════════════════════════
-- FEEDBACK TOKENS — drop blanket anon/auth reads; guests use the RPC
-- ════════════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "feedback_tokens_anon_select" ON public.feedback_tokens;
DROP POLICY IF EXISTS "feedback_tokens_auth_select" ON public.feedback_tokens;
-- feedback_tokens_staff_all (scoped) + service kept; validate_feedback_token
-- RPC (SECURITY DEFINER) serves the guest validation path.

-- ════════════════════════════════════════════════════════════════════════
-- SHIFT OVERRIDE REQUESTS — drop ALL-true; scope via shift→staff_shifts.
--
-- staff_shifts.staff_id is an FK to hotel_members.id (verified against the
-- live FK — NOT hotel_staff). The shift's hotel is therefore reachable only
-- through the shift OWNER's hotel_members row — which the viewer cannot read,
-- because hotel_members RLS is self-only (user_id = auth.uid()). A policy that
-- joined that row directly resolved to zero (silently over-tight).
--
-- So resolve the shift's hotel in a SECURITY DEFINER helper (same pattern as
-- current_guest_id / vaiyu_is_hotel_finance_manager) and check the viewer's
-- OWN membership against it.
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.staff_shift_hotel_id(p_shift_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT hm.hotel_id
  FROM public.staff_shifts ss
  JOIN public.hotel_members hm ON hm.id = ss.staff_id
  WHERE ss.id = p_shift_id
  LIMIT 1;
$$;

DROP POLICY IF EXISTS "allow_authenticated_all"                ON public.shift_override_requests;
DROP POLICY IF EXISTS "shift_override_requests_staff_all"      ON public.shift_override_requests;
CREATE POLICY "shift_override_requests_staff_all"
  ON public.shift_override_requests FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.hotel_members hm
    WHERE hm.hotel_id = public.staff_shift_hotel_id(shift_override_requests.shift_id)
      AND hm.user_id = auth.uid()))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.hotel_members hm
    WHERE hm.hotel_id = public.staff_shift_hotel_id(shift_override_requests.shift_id)
      AND hm.user_id = auth.uid()));

-- ════════════════════════════════════════════════════════════════════════
-- TICKETS — add hotel scoping to the unassigned branch (was global)
-- ════════════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "staff_can_see_assigned_and_unassigned_tickets" ON public.tickets;
CREATE POLICY "staff_can_see_assigned_and_unassigned_tickets"
  ON public.tickets FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.hotel_members hm
            WHERE hm.hotel_id = tickets.hotel_id AND hm.user_id = auth.uid())
    AND (
      current_assignee_id IN (SELECT hm.id FROM public.hotel_members hm WHERE hm.user_id = auth.uid())
      OR current_assignee_id IS NULL
    )
  );
