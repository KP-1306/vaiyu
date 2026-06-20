-- ============================================================
-- VAiyu: SECURITY DEFINER view sweep — Tier A (anon-readable leaks)
-- ============================================================
-- Postgres 15 views run as their creator (postgres) and BYPASS RLS unless
-- created with security_invoker=true. Supabase's linter (0010_security_definer_view)
-- flags all such views. This is the same class as the v_owner_* leak fixed in
-- 20260616000006 — the views are a hole OVER the base-table RLS sealed in the
-- 2026-06-12..20 perimeter work.
--
-- CONFIRMED by anon black-box probe on prod (open-internet caller got rows):
--   v_folio_balance (booking_id + balance — FINANCIAL), v_booking_activity,
--   v_available_staff, v_staff_shift_board, v_staff_shifts_active,
--   v_supervisor_task_header, v_ticket_timeline, tickets_sla_status,
--   v_effective_room_price — all returned cross-tenant rows to anon.
--
-- FIX: security_invoker=true so the querying user's RLS applies (anon → 0 rows;
-- an authenticated member still sees their own hotel's rows via the base-table
-- member RLS), + REVOKE anon (defense-in-depth; none of these are anon-intended —
-- verified 0 anon/guest frontend callers, or authenticated-only callers).
--
-- NOT touched here (verified safe / intentional):
--   • v_public_hotels — the INTENTIONAL anon bridge (anon can't read raw hotels);
--     making it invoker would break every public page. Stays definer by design.
--   • self-filtering views that already return 0 rows to anon (user_bills_overview,
--     v_guest_food_orders, v_guest_tickets, v_food_orders_sla_risk, hotels_for_user,
--     v_api_24h, v_api_top_fns_24h) — not leaking; flipping risks the guest portal.
--   • the 82 authenticated-readable definer views — separate Tier C follow-up.
--
-- _tz is `SELECT now() AT TIME ZONE 'Asia/Kolkata'` (no table, not a data leak,
-- no dependent views) — security_invoker=true is a pure lint fix, grant kept.
--
-- Idempotent (ALTER VIEW SET / REVOKE are safe to re-run).
-- ============================================================

-- ── Confirmed cross-tenant leaks → invoker + revoke anon ───────────────────
DO $$
DECLARE
  v text;
  leak_views text[] := ARRAY[
    'tickets_sla_status',
    'v_available_staff',
    'v_booking_activity',
    'v_folio_balance',
    'v_staff_shift_board',
    'v_staff_shifts_active',
    'v_supervisor_task_header',
    'v_ticket_timeline',
    'v_effective_room_price'
  ];
BEGIN
  FOREACH v IN ARRAY leak_views LOOP
    IF EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=v AND c.relkind='v'
    ) THEN
      EXECUTE format('ALTER VIEW public.%I SET (security_invoker = true);', v);
      EXECUTE format('REVOKE SELECT ON public.%I FROM anon;', v);
    ELSE
      RAISE NOTICE 'security-invoker sweep: view % not present, skipping', v;
    END IF;
  END LOOP;
END $$;

-- ── _tz: lint-only fix (server time, no table data) ────────────────────────
ALTER VIEW public._tz SET (security_invoker = true);
