-- Migration: Enterprise Secure Hotel Assets Storage (Final)
-- Date: 2026-03-03

BEGIN;

-- 1️⃣ Create Bucket (idempotent)
INSERT INTO storage.buckets (id, name, public)
VALUES ('hotel-assets', 'hotel-assets', true)
ON CONFLICT (id) DO NOTHING;

-- 2️⃣ Public Read Access
DROP POLICY IF EXISTS "Public read hotel assets" ON storage.objects;

CREATE POLICY "Public read hotel assets"
ON storage.objects
FOR SELECT
USING (bucket_id = 'hotel-assets');

-- 3️⃣ INSERT Policy (Platform Admin OR Hotel Admin)
DROP POLICY IF EXISTS "Hotel admin upload assets" ON storage.objects;

CREATE POLICY "Hotel asset insert policy"
ON storage.objects
FOR INSERT
WITH CHECK (
    bucket_id = 'hotel-assets'
    AND position('/' in name) > 0
    AND (
        -- ✅ Platform Admin
        EXISTS (
            SELECT 1
            FROM public.platform_admins pa
            WHERE pa.user_id = auth.uid()
            AND pa.is_active = true
        )

        OR

        -- ✅ Hotel Admin
        EXISTS (
            SELECT 1
            FROM public.hotel_members hm
            JOIN public.hotel_member_roles hmr
                ON hmr.hotel_member_id = hm.id
            JOIN public.hotel_roles hr
                ON hr.id = hmr.role_id
            WHERE hm.user_id = auth.uid()
            AND hm.hotel_id::text = split_part(name, '/', 1)
            AND hr.code IN ('OWNER','ADMIN','MANAGER')
        )
    )
);

-- 4️⃣ UPDATE Policy
DROP POLICY IF EXISTS "Hotel admin update assets" ON storage.objects;
DROP POLICY IF EXISTS "Hotel asset update policy" ON storage.objects;

CREATE POLICY "Hotel asset update policy"
ON storage.objects
FOR UPDATE
USING (
    bucket_id = 'hotel-assets'
    AND position('/' in name) > 0
    AND (
        EXISTS (
            SELECT 1
            FROM public.platform_admins pa
            WHERE pa.user_id = auth.uid()
            AND pa.is_active = true
        )
        OR
        EXISTS (
            SELECT 1
            FROM public.hotel_members hm
            JOIN public.hotel_member_roles hmr
                ON hmr.hotel_member_id = hm.id
            JOIN public.hotel_roles hr
                ON hr.id = hmr.role_id
            WHERE hm.user_id = auth.uid()
            AND hm.hotel_id::text = split_part(name, '/', 1)
            AND hr.code IN ('OWNER','ADMIN','MANAGER')
        )
    )
);

-- 5️⃣ DELETE Policy (Stricter)
DROP POLICY IF EXISTS "Hotel admin delete assets" ON storage.objects;
DROP POLICY IF EXISTS "Hotel asset delete policy" ON storage.objects;

CREATE POLICY "Hotel asset delete policy"
ON storage.objects
FOR DELETE
USING (
    bucket_id = 'hotel-assets'
    AND position('/' in name) > 0
    AND (
        EXISTS (
            SELECT 1
            FROM public.platform_admins pa
            WHERE pa.user_id = auth.uid()
            AND pa.is_active = true
        )
        OR
        EXISTS (
            SELECT 1
            FROM public.hotel_members hm
            JOIN public.hotel_member_roles hmr
                ON hmr.hotel_member_id = hm.id
            JOIN public.hotel_roles hr
                ON hr.id = hmr.role_id
            WHERE hm.user_id = auth.uid()
            AND hm.hotel_id::text = split_part(name, '/', 1)
            AND hr.code IN ('OWNER','ADMIN')
        )
    )
);

COMMIT;
