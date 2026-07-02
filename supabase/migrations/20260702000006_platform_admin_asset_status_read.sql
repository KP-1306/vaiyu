-- 20260702000006_platform_admin_asset_status_read.sql
--
-- Close the last gap in the VAiyu-seed onboarding path: let a platform admin open
-- the DAM Assets workspace (/owner/:slug/assets) for ANY hotel to seed photos.
--
-- Everything else on that path is already platform-admin-ready:
--   • router      : owner/:slug/assets is AuthGate only (no membership gate)
--   • hotels read : hotels_select_for_platform_admin        (20260702000004)
--   • storage I/O : "Hotel asset insert/update/delete policy" already gate on
--                   is_platform_admin() OR vaiyu_is_hotel_manager(...)  (20260623000009)
--   • record RPC  : record_hotel_asset_file gate widened      (20260702000002)
--   • files read  : hotel_asset_files_select_platform_admin   (20260702000004)
--
-- The one hole is the status list the workspace renders from: v_hotel_asset_status
-- filters `vaiyu_is_hotel_member(h.id)` (inner), so a non-member platform admin sees
-- zero rows. Fix = widen that inner predicate with `OR is_platform_admin()`. Its
-- OUTER gate vaiyu_can_view_hotel_analytics() ALREADY admits platform admins
-- (`is_platform_admin() OR <owner/manager member check>`), so only the inner
-- membership filter needs it — mirroring that helper's own shape.
--
-- SECURITY_INVOKER: this view is restored to `security_invoker = false` (DEFINER).
-- Rationale:
--   • Its original definition (20260619000006) was definer. The 06-20 blanket sweep
--     flipped it to invoker; the 06-28 ops-board restore (20260628000001) only
--     covered the 5 hot boards (v_kitchen_queue/…), so this view was left at
--     invoker=true — a leftover of that same bad sweep, not an intended state.
--   • It is a HOTEL-level-guarded view (vaiyu_is_hotel_member + analytics gate),
--     exactly the class the ops-board restore standardized on definer: the explicit
--     predicates + grants gate access, base tables are hotel-level, so definer and
--     invoker are security-equivalent here — and definer avoids the per-row RLS
--     re-planning that caused the 57014 timeout. auth.uid() still resolves the CALLER
--     under a definer view (reads the JWT GUC), so the predicates gate by caller.
--   • Anon has no SELECT grant on the view (blocked at the grant layer regardless).
-- So this migration also finishes the definer restore this view missed on 06-28.

-- 1. Platform-admin SELECT on hotel_assets. Defense-in-depth + symmetry with
--    hotel_asset_files_select_platform_admin (20260702000004): platform admins can
--    read every asset table. Not strictly required while the view is definer
--    (definer bypasses base RLS), but keeps any direct read — and a future invoker
--    flip — safe. is_platform_admin() is false for members/non-members/anon.
drop policy if exists hotel_assets_select_platform_admin on public.hotel_assets;
create policy hotel_assets_select_platform_admin
  on public.hotel_assets
  for select
  using (public.is_platform_admin());

-- 2. Restore definer + widen the inner membership predicate to admit platform admins.
--    Body reproduced verbatim from 20260619000006; the ONLY change vs. that original
--    is the inner WHERE gaining `OR public.is_platform_admin()`.
create or replace view public.v_hotel_asset_status with (security_invoker = false) as
select _s.* from (
 select r.code as requirement_code,
    r.category,
    r.priority,
    r.storage_zone,
    r.display_name_en,
    r.display_name_hi,
    r.why_it_matters_en,
    r.why_it_matters_hi,
    r.recommended_action_en,
    r.recommended_action_hi,
    r.allow_multiple_files,
    r.sort_order,
        case r.priority
            when 'CRITICAL'::asset_priority then 0
            when 'HIGH'::asset_priority then 1
            when 'MEDIUM'::asset_priority then 2
            when 'LOW'::asset_priority then 3
            else null::integer
        end as priority_rank,
        case r.category
            when 'VERIFICATION_PROOF'::asset_category then 0
            when 'TRUST_ESSENTIALS'::asset_category then 1
            when 'OPERATIONAL'::asset_category then 2
            when 'EXPERIENCE'::asset_category then 3
            else null::integer
        end as category_rank,
    h.id as hotel_id,
    ha.id as hotel_asset_id,
    coalesce(ha.status::text, 'MISSING'::text) as status,
    ha.collected_via,
    ha.owner_notes,
    ha.internal_notes,
    ha.rejection_reason,
    ha.reviewed_at,
    ha.review_actor_name,
    ha.updated_at as asset_updated_at,
    coalesce(fc.file_count, 0) as file_count,
    fc.last_file_at
   from asset_requirements r
     cross join hotels h
     left join hotel_assets ha on ha.hotel_id = h.id and ha.requirement_code = r.code
     left join lateral ( select count(*)::integer as file_count,
            max(hotel_asset_files.created_at) as last_file_at
           from hotel_asset_files
          where hotel_asset_files.hotel_asset_id = ha.id) fc on true
  where r.is_active = true and (vaiyu_is_hotel_member(h.id) or public.is_platform_admin())
) _s
where public.vaiyu_can_view_hotel_analytics(_s.hotel_id);
