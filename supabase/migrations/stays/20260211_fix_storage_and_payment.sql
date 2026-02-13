-- Migration: Secure Guest ID Upload (Strict RLS + Future-Proof Staff Roles)

-- ============================================================
-- A. GUEST DOCUMENTS TABLE SECURITY
-- ============================================================

-- Enable RLS
ALTER TABLE public.guest_id_documents ENABLE ROW LEVEL SECURITY;

-- 1. Combined INSERT Policy (Guest OR Staff)
--    - Guests insert their own docs (guest_id = auth.uid())
--    - Staff insert docs for guests (checked via hotel_member_roles)
DROP POLICY IF EXISTS "insert_guest_documents" ON public.guest_id_documents;
DROP POLICY IF EXISTS "guest_insert_own_documents" ON public.guest_id_documents;
DROP POLICY IF EXISTS "staff_insert_guest_documents" ON public.guest_id_documents;

CREATE POLICY "insert_guest_documents"
ON public.guest_id_documents
FOR INSERT
TO authenticated
WITH CHECK (
    guest_id = auth.uid()
    OR
    EXISTS (
        SELECT 1 
        FROM hotel_members hm
        JOIN hotel_member_roles hmr ON hm.id = hmr.hotel_member_id
        JOIN hotel_roles hr ON hmr.role_id = hr.id
        WHERE hm.user_id = auth.uid()
        AND hr.code IN ('OWNER', 'MANAGER', 'STAFF', 'SUPERVISOR', 'ADMIN')
        AND hm.is_active = true
        AND hr.is_active = true
    )
);

-- 2. Guests can view their own documents
DROP POLICY IF EXISTS "guest_view_own_documents" ON public.guest_id_documents;
CREATE POLICY "guest_view_own_documents"
ON public.guest_id_documents
FOR SELECT
TO authenticated
USING (guest_id = auth.uid());

-- 3. Staff can view guest documents (Verification)
DROP POLICY IF EXISTS "staff_view_documents" ON public.guest_id_documents;
CREATE POLICY "staff_view_documents"
ON public.guest_id_documents
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 
    FROM hotel_members hm
    JOIN hotel_member_roles hmr ON hm.id = hmr.hotel_member_id
    JOIN hotel_roles hr ON hmr.role_id = hr.id
    WHERE hm.user_id = auth.uid()
    AND hr.code IN ('OWNER', 'MANAGER', 'STAFF', 'SUPERVISOR', 'ADMIN')
    AND hm.is_active = true
    AND hr.is_active = true
  )
);

-- Cleanup old/conflicting policies
DROP POLICY IF EXISTS "Guests can upload documents" ON public.guest_id_documents;
DROP POLICY IF EXISTS "Guests can view documents" ON public.guest_id_documents;
DROP POLICY IF EXISTS "guest_insert_docs" ON public.guest_id_documents;
DROP POLICY IF EXISTS "guest_select_docs" ON public.guest_id_documents;

-- ============================================================
-- B. STORAGE BUCKET SECURITY
-- ============================================================

-- 1. Allowed authenticated upload to 'guest-documents' bucket
DROP POLICY IF EXISTS "authenticated_upload_guest_documents" ON storage.objects;
CREATE POLICY "authenticated_upload_guest_documents"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'guest-documents'
);

-- 2. Guests can read ONLY their own files (guest-documents/{guest_id}/...)
DROP POLICY IF EXISTS "read_guest_own_files" ON storage.objects;
DROP POLICY IF EXISTS "guest_read_own_files" ON storage.objects; -- clean up previous name

CREATE POLICY "read_guest_own_files"
ON storage.objects
FOR SELECT
TO authenticated
USING (
    bucket_id = 'guest-documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
);

-- 3. Staff can read ALL files in 'guest-documents' (Verification)
DROP POLICY IF EXISTS "staff_read_all_files" ON storage.objects;
CREATE POLICY "staff_read_all_files"
ON storage.objects
FOR SELECT
TO authenticated
USING (
    bucket_id = 'guest-documents'
    AND EXISTS (
        SELECT 1 
        FROM hotel_members hm
        JOIN hotel_member_roles hmr ON hm.id = hmr.hotel_member_id
        JOIN hotel_roles hr ON hmr.role_id = hr.id
        WHERE hm.user_id = auth.uid()
        AND hr.code IN ('OWNER', 'MANAGER', 'STAFF', 'SUPERVISOR', 'ADMIN')
        AND hm.is_active = true
        AND hr.is_active = true
    )
);

-- Cleanup old storage policies
DROP POLICY IF EXISTS "Guests can upload documents" ON storage.objects;
DROP POLICY IF EXISTS "Guests can view documents" ON storage.objects;
DROP POLICY IF EXISTS "guest_upload_docs" ON storage.objects;
DROP POLICY IF EXISTS "guest_view_docs" ON storage.objects;
