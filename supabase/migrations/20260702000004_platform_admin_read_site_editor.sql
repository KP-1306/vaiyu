-- 20260702000004_platform_admin_read_site_editor.sql
--
-- Additive: let platform admins SELECT hotels + hotel_asset_files so the VAiyu
-- "seed" site editor can load a hotel it is NOT a member of (hero/photo picker +
-- hotel identity). Members are unaffected — RLS policies OR together, and these
-- are brand-new policies that don't touch the existing member policies.
-- (hotel_sites already grants platform-admin SELECT; hotels/hotel_asset_files did
-- not.) Platform admins already have cross-tenant reach via the service-role
-- admin console, so this exposes nothing new — it just enables the client path.

drop policy if exists hotels_select_for_platform_admin on public.hotels;
create policy hotels_select_for_platform_admin on public.hotels
  for select using (public.is_platform_admin());

drop policy if exists hotel_asset_files_select_platform_admin on public.hotel_asset_files;
create policy hotel_asset_files_select_platform_admin on public.hotel_asset_files
  for select using (public.is_platform_admin());
