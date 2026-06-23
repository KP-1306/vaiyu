-- Role-management RBAC for hotel_roles + hotel_member_roles.
--
-- Context: `/onboard` is platform-admin operated, and Staff & Shifts
-- (OwnerStaffShifts.tsx) lets a hotel OWNER/MANAGER manage role DEFINITIONS
-- (hotel_roles) and role ASSIGNMENTS (hotel_member_roles) via direct PostgREST
-- writes. Two problems with the pre-existing RLS:
--
--   1. hotel_roles (`hotel_roles_member_all`, ALL): allowed ANY member of the
--      hotel to write role definitions, and had NO platform-admin branch — so
--      the /onboard operator (not a member of the new hotel) got 403 at step 3
--      and onboarding could never complete. (room_types/rooms/hotel_invites all
--      already carry an is_platform_admin() branch; hotel_roles was missed.)
--
--   2. hotel_member_roles (`hmr same-hotel members`, ALL via
--      vaiyu_member_shares_hotel): allowed ANY active member to INSERT/UPDATE/
--      DELETE assignments for ANYONE in their hotel — including their own row.
--      i.e. a housekeeping staffer could self-assign the OWNER role. Real
--      intra-tenant privilege escalation.
--
-- Fix: a shared SECURITY DEFINER helper `vaiyu_is_hotel_manager(hotel_id)` (the
-- SAME OWNER/ADMIN/MANAGER definition create_hotel_invite already enforces, plus
-- OWNER_0 and a legacy-column fallback for safety), then split each table's
-- single ALL policy into:
--   • SELECT — any member of the hotel may READ (the staff app needs role
--     names / assignments); unchanged from today's read access.
--   • WRITE (ALL) — only a platform admin OR a hotel manager/owner may
--     INSERT/UPDATE/DELETE.
--
-- Why this is safe for Staff & Shifts (the operator concern): verified on the
-- live data — every hotel with members has ≥1 active member whose canonical M2M
-- code is in (OWNER,ADMIN,MANAGER), and the legacy hotel_members.role column is
-- unused (all 0). So every real owner/manager passes vaiyu_is_hotel_manager and
-- keeps full role-management access. accept_hotel_invite + create_hotel_onboarding
-- write these tables as SECURITY DEFINER (they bypass RLS), so invite-acceptance
-- and onboarding bootstrap are unaffected. The helper is SECURITY DEFINER so it
-- can read hotel_roles inside hotel_roles' own policy without RLS recursion.
--
-- Prod-verified (read-only): hotel_roles currently has exactly
-- `hotel_roles_member_all` (no platform-admin branch) and hotel_member_roles has
-- exactly `hmr same-hotel members`; is_platform_admin() (no-arg) exists and is
-- already used by room_types. So the DROP/CREATE below cleanly replace them.

-- ════════════════════════════════════════════════════════════════════════
-- Shared helper: is the caller an OWNER/ADMIN/MANAGER of this hotel?
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.vaiyu_is_hotel_manager(p_hotel_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    -- Canonical M2M role (same set create_hotel_invite trusts) + OWNER_0.
    SELECT 1
    FROM public.hotel_members hm
    JOIN public.hotel_member_roles hmr ON hmr.hotel_member_id = hm.id
    JOIN public.hotel_roles hr ON hr.id = hmr.role_id
    WHERE hm.hotel_id = p_hotel_id
      AND hm.user_id = auth.uid()
      AND hm.is_active = true
      AND hr.is_active = true
      AND hr.code IN ('OWNER','OWNER_0','ADMIN','MANAGER')
  )
  OR EXISTS (
    -- Legacy fallback (hotel_members.role is currently unused, but keep this so a
    -- hotel relying on the legacy column is never locked out of its own roles).
    SELECT 1
    FROM public.hotel_members hm
    WHERE hm.hotel_id = p_hotel_id
      AND hm.user_id = auth.uid()
      AND hm.is_active = true
      AND lower(hm.role) IN ('owner','admin','manager')
  );
$function$;

REVOKE ALL ON FUNCTION public.vaiyu_is_hotel_manager(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vaiyu_is_hotel_manager(uuid) TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════
-- hotel_roles: any member READS, only manager/platform-admin WRITES.
-- ════════════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS hotel_roles_member_all ON public.hotel_roles;

CREATE POLICY hotel_roles_select ON public.hotel_roles
  FOR SELECT
  USING (public.is_platform_admin() OR public.vaiyu_is_hotel_member(hotel_id));

CREATE POLICY hotel_roles_modify ON public.hotel_roles
  FOR ALL
  USING (public.is_platform_admin() OR public.vaiyu_is_hotel_manager(hotel_id))
  WITH CHECK (public.is_platform_admin() OR public.vaiyu_is_hotel_manager(hotel_id));

-- ════════════════════════════════════════════════════════════════════════
-- hotel_member_roles: any same-hotel member READS, only manager/platform-admin
-- WRITES (closes the self-assign-OWNER escalation).
-- ════════════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "hmr same-hotel members" ON public.hotel_member_roles;

CREATE POLICY hmr_select ON public.hotel_member_roles
  FOR SELECT
  USING (public.is_platform_admin() OR public.vaiyu_member_shares_hotel(hotel_member_id));

CREATE POLICY hmr_modify ON public.hotel_member_roles
  FOR ALL
  USING (
    public.is_platform_admin()
    OR public.vaiyu_is_hotel_manager(public.hotel_member_hotel_id(hotel_member_id))
  )
  WITH CHECK (
    public.is_platform_admin()
    OR public.vaiyu_is_hotel_manager(public.hotel_member_hotel_id(hotel_member_id))
  );
