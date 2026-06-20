-- ============================================================
-- VAiyu WRITE-PATH AUDIT (2/5): sla_policies — hotel-scope, not admin-lock
-- ============================================================
-- FINDING (class A, but operationally different from migration ...0010):
-- sla_policies shipped with RLS DISABLED, so anon could insert/delete SLA timers
-- for ANY hotel's departments. It has no hotel_id, so at first glance it looks
-- like global reference data — but it is NOT: it is keyed by department_id (FK →
-- departments, which IS hotel-scoped) and it is OWNER-WRITTEN from the app:
--   web/src/routes/OwnerServices.tsx:544  supabase.from('sla_policies').insert(...)
-- (new departments) and via the SECURITY DEFINER RPC upsert_department_sla
-- (existing departments). So locking it to platform-admin would break owner SLA
-- setup. The correct fix is hotel-MEMBER scoping through department_id.
--
-- FIX: enable RLS + a member-scoped policy via
--   EXISTS (departments d WHERE d.id = department_id
--           AND vaiyu_is_hotel_member(d.hotel_id))
-- This preserves the owner's direct INSERT (their JWT passes the membership
-- check) and the SD RPC (runs as owner → bypasses RLS). Anon writes are denied
-- (anon has no membership). service_role bypasses via its own grant for any
-- server-side SLA engine work. Idempotent.
-- ============================================================

ALTER TABLE public.sla_policies ENABLE ROW LEVEL SECURITY;

-- Member-scoped read + write through the department's hotel.
DROP POLICY IF EXISTS "sla_policies_member_rw" ON public.sla_policies;
CREATE POLICY "sla_policies_member_rw"
  ON public.sla_policies
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.departments d
      WHERE d.id = sla_policies.department_id
        AND public.vaiyu_is_hotel_member(d.hotel_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.departments d
      WHERE d.id = sla_policies.department_id
        AND public.vaiyu_is_hotel_member(d.hotel_id)
    )
  );

-- Platform admins retain full visibility/management across hotels.
DROP POLICY IF EXISTS "sla_policies_admin_all" ON public.sla_policies;
CREATE POLICY "sla_policies_admin_all"
  ON public.sla_policies
  FOR ALL
  TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

-- Deny anon writes (no client write grant needed; SD RPC + service_role cover
-- the legitimate server paths).
REVOKE INSERT, UPDATE, DELETE ON public.sla_policies FROM anon, PUBLIC;
GRANT  SELECT, INSERT, UPDATE, DELETE ON public.sla_policies TO service_role;
