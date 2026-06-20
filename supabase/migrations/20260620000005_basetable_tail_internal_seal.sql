-- ============================================================
-- VAiyu: base-table anon tail — Group 1 (internal/server-side-only)
-- ============================================================
-- Part of finishing the 2026-06-20 base-table audit. These 7 tables were RLS
-- DISABLED + granted to anon/authenticated (no row filtering at all), so anon
-- could read every row via PostgREST. Audit confirmed live: import_idempotency
-- (34 rows), staff_zone_assignments (1); the rest latent (0 rows) but would leak
-- on first write (properties = owner_contact PII; chat_webhook_logs = raw
-- WhatsApp payloads; user_roles = identifies platform admins; grid_readings;
-- staff_shift_notes).
--
-- Classification (verified): NONE are referenced anywhere in web/src (0 direct
-- reads/writes) and NONE are written by an anon-key edge function. Their writers
-- are SECURITY DEFINER RPCs / triggers (run as owner) or service_role workers,
-- and any reads happen via plain (owner-run, RLS-bypassing) analytics views.
-- So locking them to service_role/owner breaks nothing:
--   * import_idempotency   - booking-import idempotency (import RPC, owner)
--   * chat_webhook_logs    - raw inbound webhook payloads (webhook, service_role)
--   * grid_readings        - IoT device energy readings (worker); UI reads the
--                            sealed grid_* plain views, not this base table
--   * staff_shift_notes    - shift notes (server-side; no frontend reader)
--   * staff_zone_assignments - staff->zone (server-side; no frontend reader)
--   * user_roles           - global user role map (admin/migration managed)
--   * properties           - owner-application PII (onboarding RPC, owner)
--
-- FIX: enable RLS (defense-in-depth) + REVOKE all from anon/authenticated/PUBLIC
-- + GRANT to service_role. SECURITY DEFINER callers (owner) and service_role
-- (BYPASSRLS) are unaffected; anon/authenticated -> 401 at the grant layer.
-- ============================================================

ALTER TABLE public.import_idempotency      ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.import_idempotency    FROM anon, authenticated, PUBLIC;
GRANT  ALL ON public.import_idempotency    TO service_role;

ALTER TABLE public.chat_webhook_logs       ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.chat_webhook_logs     FROM anon, authenticated, PUBLIC;
GRANT  ALL ON public.chat_webhook_logs     TO service_role;

ALTER TABLE public.grid_readings           ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.grid_readings         FROM anon, authenticated, PUBLIC;
GRANT  ALL ON public.grid_readings         TO service_role;

ALTER TABLE public.staff_shift_notes       ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staff_shift_notes     FROM anon, authenticated, PUBLIC;
GRANT  ALL ON public.staff_shift_notes     TO service_role;

ALTER TABLE public.staff_zone_assignments  ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staff_zone_assignments FROM anon, authenticated, PUBLIC;
GRANT  ALL ON public.staff_zone_assignments TO service_role;

ALTER TABLE public.user_roles              ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_roles            FROM anon, authenticated, PUBLIC;
GRANT  ALL ON public.user_roles            TO service_role;

ALTER TABLE public.properties              ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.properties            FROM anon, authenticated, PUBLIC;
GRANT  ALL ON public.properties            TO service_role;
