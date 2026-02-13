-- Migration: Fix View Permissions
-- The base view 'v_guest_stay_hero_base' is used by 'v_guest_stay_hero'.
-- Since 'v_guest_stay_hero' is a standard view (security invoker),
-- the authenticated user needs permission to SELECT from the base view as well.

GRANT SELECT ON public.v_guest_stay_hero_base TO authenticated;

-- Ensure other dependent views are also accessible if needed (though they seem covered)
GRANT SELECT ON public.v_guest_home_dashboard_base TO authenticated;
