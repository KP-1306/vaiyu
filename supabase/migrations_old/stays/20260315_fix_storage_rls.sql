-- ============================================================
-- FIX: Enterprise Secure Storage Policies (Option B)
-- 
-- With the 'upload-guest-id' Edge Function in place, we can
-- keep storage RLS strict (authenticated only). 
-- The Edge Function bypasses RLS using the service_role 
-- for guest/kiosk uploads.
-- ============================================================

-- 1. Ensure 'identity_proofs' bucket exists and is private
INSERT INTO storage.buckets (id, name, public)
VALUES ('identity_proofs', 'identity_proofs', false)
ON CONFLICT (id) DO UPDATE SET public = false;

-- 2. SELECT policy (Restricted to Staff/Authenticated)
DROP POLICY IF EXISTS "identity_proofs_select" ON storage.objects;
CREATE POLICY "identity_proofs_select"
ON storage.objects FOR SELECT
TO authenticated
USING ( bucket_id = 'identity_proofs' );

-- 3. INSERT policy (Restricted to Staff/Authenticated)
DROP POLICY IF EXISTS "identity_proofs_upload" ON storage.objects;
CREATE POLICY "identity_proofs_upload"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK ( bucket_id = 'identity_proofs' );

-- 4. UPDATE policy (Restricted to Staff/Authenticated)
DROP POLICY IF EXISTS "identity_proofs_update" ON storage.objects;
CREATE POLICY "identity_proofs_update"
ON storage.objects FOR UPDATE
TO authenticated
USING ( bucket_id = 'identity_proofs' );

-- NOTE: Public 'anon' access is NO LONGER REQUIRED on the storage bucket.
-- All guest uploads now flow through the 'upload-guest-id' Edge Function.
