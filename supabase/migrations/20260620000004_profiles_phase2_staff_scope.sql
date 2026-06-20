-- ============================================================
-- VAiyu: profiles Phase 2 — authenticated cross-tenant scoping
-- ============================================================
-- Phase 1 (20260620000001) closed the ANONYMOUS read of profiles. This Phase 2
-- closes the remaining hole: the "Public profiles read" policy was USING(true),
-- so after Phase 1 ANY authenticated account could still read every profile
-- (full_name, phone, email, govt_id_number, address, emergency_*, vehicle).
-- Since signup is free/instant, that was effectively a govt-ID leak one signup
-- away from anon.
--
-- OWNER CONSTRAINT (do not violate): the VAiyu guest/user identity is GLOBAL.
-- Any hotel's staff must be able to read an existing VAiyu user's profile during
-- check-in / guest lookup (returning-guest recognition), EVEN with no prior
-- booking at that hotel. So the boundary is NOT per-hotel-relationship; it is:
--   self  OR  caller is hotel staff (member of ANY hotel)  OR  platform admin.
-- The hole this closes: a plain authenticated account with NO hotel membership
-- (free signup, or a pure guest) can no longer read OTHER users' profiles.
--
-- Verified against all 13 frontend readers of public.profiles:
--   * self-reads (.eq('id', auth.uid())): AdminGate, Profile, OwnerDashboard,
--     GuestDashboard, GuestNew{Home,Layout,Checkout} -> covered by the existing
--     "profiles read own" / "profiles select own" (id = auth.uid()) policies.
--   * staff-reading-others (.in('id', userIds)): StaffPicker, FolioDrawer,
--     OwnerHousekeeping, HotelOnboarding, OwnerDashboard, OwnerStaffShifts,
--     OpsBoard -> all are owner/staff screens (caller is a hotel member) ->
--     covered by the new staff clause.
-- Check-in does not read profiles directly (uses SECURITY DEFINER RPCs), and
-- those RPCs bypass RLS as owner, so global-guest recognition is unaffected.
-- ============================================================

-- "is the caller staff/member of ANY hotel?" (SD to bypass hotel_members RLS /
-- avoid recursion; mirrors vaiyu_is_hotel_member's active-membership semantics)
CREATE OR REPLACE FUNCTION public.vaiyu_is_hotel_staff()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.hotel_members hm
    WHERE hm.user_id = auth.uid()
      AND hm.is_active = true
  );
$function$;

REVOKE ALL ON FUNCTION public.vaiyu_is_hotel_staff() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vaiyu_is_hotel_staff() TO authenticated, service_role;

-- Drop the wide-open read; replace with the scoped staff/admin read.
-- (The self-read policies "profiles read own" / "profiles select own" remain,
--  so a guest/plain account still reads its own row.)
DROP POLICY IF EXISTS "Public profiles read" ON public.profiles;

CREATE POLICY "profiles staff or admin read"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    public.vaiyu_is_hotel_staff()
    OR public.is_platform_admin()
  );
