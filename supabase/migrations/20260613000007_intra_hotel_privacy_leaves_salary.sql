-- Intra-hotel privacy: restrict leaves + staff salary to self + owner/manager.
--
-- Closes the item deferred by the RLS perimeter audit. Until now, the phase-4
-- policies `leaves_member_all` and `hotel_staff_member_all` let ANY active member
-- of a hotel read (and write) every colleague's leave records and
-- `hotel_staff.cost_per_hour` (salary). Cross-tenant was already sealed; this
-- tightens the intra-hotel grain to: a member sees only their OWN row, and
-- owners/managers (incl. finance managers) see/manage all.
--
-- Reader audit (verified, not assumed):
--   • leaves        — only OwnerHRMS.tsx reads it, via `.from("leaves")` as the
--                     authenticated owner/manager. No staff-facing leave screen
--                     exists, so restricting SELECT to self + owner/manager
--                     breaks nothing.
--   • hotel_staff   — NO direct authenticated reader anywhere in the app; the
--                     staff board / member mgmt go through SECURITY DEFINER RPCs
--                     (get_staff_shifts_dashboard, update_hotel_member) which
--                     bypass RLS. So the old "any member" policy only exposed
--                     salary to raw PostgREST queries — a real leak, no UI to break.
--   • service_role  — kept FOR ALL (edge functions).
--
-- `vaiyu_is_hotel_finance_manager(hotel_id)` already encapsulates the
-- owner/admin/manager/finance check across M2M + legacy role (case-insensitive)
-- with a platform-admin bypass — reused here, not reinvented.
--
-- NOTE (deliberate, documented): writes are tightened to owner/manager only
-- (the old policy let any member write anyone's rows). There is no staff
-- self-service leave-request UI today; if one is built, add a narrow
-- `leaves_self_insert` (WITH CHECK user_id = auth.uid()) at that time.

-- ════════════════════════════════════════════════════════════════════════
-- leaves — self sees own; owner/manager see & manage all
-- ════════════════════════════════════════════════════════════════════════
ALTER TABLE public.leaves ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "leaves_member_all"         ON public.leaves;
DROP POLICY IF EXISTS "leaves_self_select"        ON public.leaves;
DROP POLICY IF EXISTS "leaves_owner_manager_all"  ON public.leaves;
DROP POLICY IF EXISTS "leaves_service_role_all"   ON public.leaves;
CREATE POLICY "leaves_self_select"
  ON public.leaves FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "leaves_owner_manager_all"
  ON public.leaves FOR ALL TO authenticated
  USING (public.vaiyu_is_hotel_finance_manager(hotel_id))
  WITH CHECK (public.vaiyu_is_hotel_finance_manager(hotel_id));
CREATE POLICY "leaves_service_role_all"
  ON public.leaves FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ════════════════════════════════════════════════════════════════════════
-- hotel_staff — self sees own (incl. own salary); owner/manager see & manage all
-- ════════════════════════════════════════════════════════════════════════
ALTER TABLE public.hotel_staff ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "hotel_staff_member_all"         ON public.hotel_staff;
DROP POLICY IF EXISTS "hotel_staff_self_select"        ON public.hotel_staff;
DROP POLICY IF EXISTS "hotel_staff_owner_manager_all"  ON public.hotel_staff;
DROP POLICY IF EXISTS "hotel_staff_service_role_all"   ON public.hotel_staff;
CREATE POLICY "hotel_staff_self_select"
  ON public.hotel_staff FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "hotel_staff_owner_manager_all"
  ON public.hotel_staff FOR ALL TO authenticated
  USING (public.vaiyu_is_hotel_finance_manager(hotel_id))
  WITH CHECK (public.vaiyu_is_hotel_finance_manager(hotel_id));
CREATE POLICY "hotel_staff_service_role_all"
  ON public.hotel_staff FOR ALL TO service_role USING (true) WITH CHECK (true);
