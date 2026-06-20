-- ============================================================================
-- Close a CONFIRMED latent cross-tenant leak: v_food_orders_sla_risk
-- ============================================================================
-- v_food_orders_sla_risk was a SECURITY DEFINER view (runs as postgres, BYPASSES
-- RLS) over food_orders / food_order_sla_state / rooms with NO tenant predicate —
-- its only filter is order status + SLA breach window. It was granted to anon and
-- consumed by KitchenDashboard via `.from('v_food_orders_sla_risk').select('*')`
-- with no hotel filter (the view exposes no hotel_id to filter on).
--
-- Verified on prod 2026-06-21: the view body spans 25 orders across 3 distinct
-- hotels. It returned 0 rows to anon ONLY because nothing was within the SLA
-- breach window at probe time — incidental emptiness, not a security control. The
-- instant any hotel has an at-risk order, BOTH anon (public anon key) AND any
-- authenticated kitchen staffer (no own-hotel scope) read order_id / status /
-- room_number / SLA timing for EVERY hotel.
--
-- Fix mirrors the Tier A/C view sweep (20260620000015/0016): security_invoker so
-- the caller's RLS applies, + revoke anon. The 3 underlying tables already carry
-- member-scoped SELECT policies (food_orders_staff_all / food_order_sla_state_
-- staff_all / rooms_select_for_members: EXISTS hotel_members hm WHERE
-- hm.hotel_id = <t>.hotel_id AND hm.user_id = auth.uid()), so under invoker a
-- kitchen staffer sees only their own hotel(s)' at-risk orders — exactly what the
-- dashboard needs — and anon/non-members see zero. No frontend change: columns
-- are unchanged.
-- ============================================================================

ALTER VIEW public.v_food_orders_sla_risk SET (security_invoker = true);

REVOKE SELECT ON public.v_food_orders_sla_risk FROM anon;
-- authenticated (kitchen staff) + service_role keep SELECT; reassert authenticated
-- so the grant is explicit and self-documenting.
GRANT SELECT ON public.v_food_orders_sla_risk TO authenticated;
