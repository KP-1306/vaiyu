-- =========================================================
-- STORAGE BUCKET
-- =========================================================
INSERT INTO storage.buckets
(id, name, public, avif_autodetection, file_size_limit, allowed_mime_types)
VALUES (
  'guest-documents',
  'guest-documents',
  false,
  false,
  10485760,
  '{image/*,application/pdf}'
)
ON CONFLICT (id) DO NOTHING;


-- =========================================================
-- 1. HOTEL STAFF VIEW (SELECT)
-- =========================================================
CREATE POLICY "Hotel staff view guest docs"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'guest-documents'
  AND (storage.foldername(name))[1] IS NOT NULL
  AND (storage.foldername(name))[1] IN (
      SELECT hotel_id::text
      FROM hotel_members
      WHERE user_id = auth.uid()
        AND role IN ('OWNER','MANAGER','STAFF')
  )
);


-- =========================================================
-- 2. HOTEL STAFF UPLOAD (INSERT)
-- (Cannot upload into kiosk folder)
-- =========================================================
CREATE POLICY "Hotel staff upload guest docs"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'guest-documents'
  AND (storage.foldername(name))[1] IS NOT NULL
  AND (storage.foldername(name))[2] != 'kiosk'
  AND (storage.foldername(name))[1] IN (
      SELECT hotel_id::text
      FROM hotel_members
      WHERE user_id = auth.uid()
        AND role IN ('OWNER','MANAGER','STAFF')
  )
);


-- =========================================================
-- 3. DEVICE / KIOSK UPLOAD (INSERT)
-- (Only DEVICE role allowed into kiosk folder)
-- =========================================================
CREATE POLICY "Kiosk device upload guest docs"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'guest-documents'
  AND (storage.foldername(name))[1] IS NOT NULL
  AND (storage.foldername(name))[2] = 'kiosk'
  AND (storage.foldername(name))[1] IN (
      SELECT hotel_id::text
      FROM hotel_members
      WHERE user_id = auth.uid()
        AND role = 'DEVICE'
  )
);


-- =========================================================
-- 4. HOTEL STAFF UPDATE (Rename / Move protection)
-- =========================================================
CREATE POLICY "Hotel staff update guest docs"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'guest-documents'
  AND (storage.foldername(name))[1] IS NOT NULL
  AND (storage.foldername(name))[1] IN (
      SELECT hotel_id::text
      FROM hotel_members
      WHERE user_id = auth.uid()
        AND role IN ('OWNER','MANAGER','STAFF')
  )
)
WITH CHECK (
  bucket_id = 'guest-documents'
  AND (storage.foldername(name))[1] IS NOT NULL
  AND (storage.foldername(name))[1] IN (
      SELECT hotel_id::text
      FROM hotel_members
      WHERE user_id = auth.uid()
        AND role IN ('OWNER','MANAGER','STAFF')
  )
);


-- =========================================================
-- 5. OWNER / MANAGER DELETE
-- =========================================================
CREATE POLICY "Hotel managers delete guest docs"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'guest-documents'
  AND (storage.foldername(name))[1] IS NOT NULL
  AND (storage.foldername(name))[1] IN (
      SELECT hotel_id::text
      FROM hotel_members
      WHERE user_id = auth.uid()
        AND role IN ('OWNER','MANAGER')
  )
);


CREATE INDEX IF NOT EXISTS idx_hotel_members_user_role
ON hotel_members (user_id, hotel_id, role);
