-- Fix the hotel-assets storage write policies (insert/update/delete).
--
-- These 3 policies on storage.objects were dashboard-created (never in a migration;
-- present on prod, absent on local — drift). They carry TWO defects:
--   1. Dead member branch: `(hm.hotel_id)::text = split_part(hr.NAME, '/', 1)` compares a
--      hotel UUID to a ROLE NAME (split on '/'). Role names have no '/', so this is always
--      false → NO hotel member can write hotel-assets today; only platform admins can
--      (the upload path is `{hotel_id}/file`, so the member match should key off the OBJECT
--      name, not hr.name).
--   2. Hardcoded role codes (insert/update: OWNER/ADMIN/MANAGER; delete: OWNER/ADMIN) — the
--      same triplet issue canonicalized in 20260623000007/08.
--
-- Fix mirrors the working hotel-asset-vault pattern
-- (`vaiyu_is_hotel_member((NULLIF(split_part(name,'/',1),''))::uuid)`): key the member match
-- off the OBJECT path's first segment (= hotel_id, confirmed against live data), and gate by
-- the canonical manager tier via vaiyu_is_hotel_manager(). Platform-admin branch retained.
--
-- NO FUNCTIONALITY DISTURBED: the member branch is currently dead, so platform-admin writes
-- (the only writes that work today, incl. the /onboard operator's logo upload) are unchanged;
-- this only RESTORES the intended hotel-owner/manager write access. The "Public read hotel
-- assets" SELECT policy (guest-facing image display) is deliberately left untouched.
--
-- Behavior delta to note: DELETE was OWNER/ADMIN-only; it now matches insert/update
-- (owner+manager tier), so a hotel manager can delete their own hotel's marketing assets,
-- consistent with being able to upload/replace them. (Moot for existing data — member delete
-- was non-functional.) Easy to tighten later if owner/admin-only delete is desired.
--
-- DROP IF EXISTS + CREATE: on prod replaces the live policies; on local creates them (also
-- captures these dashboard-drifted policies in version control).

DROP POLICY IF EXISTS "Hotel asset insert policy" ON storage.objects;
CREATE POLICY "Hotel asset insert policy" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'hotel-assets'
    AND position('/' in name) > 0
    AND (
      public.is_platform_admin()
      OR public.vaiyu_is_hotel_manager((NULLIF(split_part(name, '/', 1), ''))::uuid)
    )
  );

DROP POLICY IF EXISTS "Hotel asset update policy" ON storage.objects;
CREATE POLICY "Hotel asset update policy" ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'hotel-assets'
    AND position('/' in name) > 0
    AND (
      public.is_platform_admin()
      OR public.vaiyu_is_hotel_manager((NULLIF(split_part(name, '/', 1), ''))::uuid)
    )
  )
  WITH CHECK (
    bucket_id = 'hotel-assets'
    AND position('/' in name) > 0
    AND (
      public.is_platform_admin()
      OR public.vaiyu_is_hotel_manager((NULLIF(split_part(name, '/', 1), ''))::uuid)
    )
  );

DROP POLICY IF EXISTS "Hotel asset delete policy" ON storage.objects;
CREATE POLICY "Hotel asset delete policy" ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'hotel-assets'
    AND position('/' in name) > 0
    AND (
      public.is_platform_admin()
      OR public.vaiyu_is_hotel_manager((NULLIF(split_part(name, '/', 1), ''))::uuid)
    )
  );
