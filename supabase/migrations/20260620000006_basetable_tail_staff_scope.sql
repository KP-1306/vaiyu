-- ============================================================
-- VAiyu: base-table anon tail — Group 2 (staff-scoped)
-- ============================================================
-- hotel_member_roles (81 rows live) and staff_departments (23 live) were RLS
-- DISABLED + anon-granted, so anon (and any authenticated user) could read every
-- hotel's role/department assignments across all tenants. Both are read+written
-- by authenticated owner/staff screens (OwnerStaffShifts, HotelOnboarding).
--
-- Both FK to hotel_members.id:
--   hotel_member_roles.hotel_member_id -> hotel_members.id
--   staff_departments.staff_id         -> hotel_members.id
-- so a single SD helper "does the caller share a hotel with this member?" scopes
-- both. SECURITY DEFINER => bypasses hotel_members RLS (no recursion).
--
-- Server-side role resolution runs through SECURITY DEFINER functions (owner) and
-- service_role workers, both of which bypass RLS, so enabling RLS here does not
-- affect role checks — only the direct authenticated reads/writes from the staff
-- UI, which are correctly scoped to the caller's own hotel(s).
-- ============================================================

CREATE OR REPLACE FUNCTION public.vaiyu_member_shares_hotel(p_member_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.hotel_members tgt
    JOIN public.hotel_members me ON me.hotel_id = tgt.hotel_id
    WHERE tgt.id = p_member_id
      AND me.user_id = auth.uid()
      AND me.is_active = true
  );
$function$;

REVOKE ALL ON FUNCTION public.vaiyu_member_shares_hotel(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vaiyu_member_shares_hotel(uuid) TO authenticated, service_role;

-- hotel_member_roles: same-hotel members can read/manage role assignments
ALTER TABLE public.hotel_member_roles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hotel_member_roles FROM anon, PUBLIC;
GRANT  SELECT, INSERT, UPDATE, DELETE ON public.hotel_member_roles TO authenticated;
GRANT  ALL ON public.hotel_member_roles TO service_role;
CREATE POLICY "hmr same-hotel members"
  ON public.hotel_member_roles
  FOR ALL TO authenticated
  USING (public.vaiyu_member_shares_hotel(hotel_member_id))
  WITH CHECK (public.vaiyu_member_shares_hotel(hotel_member_id));

-- staff_departments: same-hotel members can read/manage dept assignments
ALTER TABLE public.staff_departments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staff_departments FROM anon, PUBLIC;
GRANT  SELECT, INSERT, UPDATE, DELETE ON public.staff_departments TO authenticated;
GRANT  ALL ON public.staff_departments TO service_role;
CREATE POLICY "staff_departments same-hotel members"
  ON public.staff_departments
  FOR ALL TO authenticated
  USING (public.vaiyu_member_shares_hotel(staff_id))
  WITH CHECK (public.vaiyu_member_shares_hotel(staff_id));
