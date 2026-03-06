-- Migration: Hotels Onboarding RLS Policies (Enterprise Safe)
-- Date: 2026-03-03
-- Purpose: Allow ONLY Platform Admins to insert new hotels. Platform or Hotel Admins can update.

BEGIN;

ALTER TABLE public.hotels ENABLE ROW LEVEL SECURITY;

-- INSERT (Platform Admin Only)
DROP POLICY IF EXISTS "Authenticated users can create hotels" ON public.hotels;
DROP POLICY IF EXISTS "Platform admins can create hotels" ON public.hotels;

CREATE POLICY "Platform admins can create hotels"
ON public.hotels
FOR INSERT
WITH CHECK (
    EXISTS (
        SELECT 1
        FROM public.platform_admins pa
        WHERE pa.user_id = auth.uid()
        AND pa.is_active = true
    )
);

-- UPDATE (Platform OR Hotel Admin)
DROP POLICY IF EXISTS "Hotel admins can update hotel details" ON public.hotels;

CREATE POLICY "Hotel admins can update hotel details"
ON public.hotels
FOR UPDATE
USING (
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
        JOIN public.hotel_member_roles hmr ON hmr.hotel_member_id = hm.id
        JOIN public.hotel_roles hr ON hr.id = hmr.role_id
        WHERE hm.user_id = auth.uid()
        AND hm.hotel_id = hotels.id
        AND hr.code IN ('OWNER','ADMIN','MANAGER')
    )
)
WITH CHECK (
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
        JOIN public.hotel_member_roles hmr ON hmr.hotel_member_id = hm.id
        JOIN public.hotel_roles hr ON hr.id = hmr.role_id
        WHERE hm.user_id = auth.uid()
        AND hm.hotel_id = hotels.id
        AND hr.code IN ('OWNER','ADMIN','MANAGER')
    )
);

COMMIT;
