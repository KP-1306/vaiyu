-- Migration: Update Guest Info RLS Policies
-- Date: 2026-03-10

BEGIN;

-- Drop the generic 'FOR ALL' policy
DROP POLICY IF EXISTS "Enable write access for authorized roles" ON public.hotel_guest_info;

-- Add strict INSERT policy
CREATE POLICY "Platform admins can create guest info" ON public.hotel_guest_info
    FOR INSERT
    WITH CHECK (
        public.is_platform_admin()
    );

-- Add strict UPDATE policy
CREATE POLICY "Hotel admins can update guest info" ON public.hotel_guest_info
    FOR UPDATE
    USING (
        public.is_platform_admin() OR
        EXISTS (
            SELECT 1 FROM public.hotel_members hm
            JOIN public.hotel_member_roles hmr ON hmr.hotel_member_id = hm.id
            JOIN public.hotel_roles hr ON hr.id = hmr.role_id
            WHERE hm.hotel_id = hotel_guest_info.hotel_id
            AND hm.user_id = auth.uid()
            AND hr.code IN ('OWNER', 'ADMIN', 'MANAGER')
            AND hm.is_active = true
            AND hr.is_active = true
        )
    )
    WITH CHECK (
        public.is_platform_admin() OR
        EXISTS (
            SELECT 1 FROM public.hotel_members hm
            JOIN public.hotel_member_roles hmr ON hmr.hotel_member_id = hm.id
            JOIN public.hotel_roles hr ON hr.id = hmr.role_id
            WHERE hm.hotel_id = hotel_guest_info.hotel_id
            AND hm.user_id = auth.uid()
            AND hr.code IN ('OWNER', 'ADMIN', 'MANAGER')
            AND hm.is_active = true
            AND hr.is_active = true
        )
    );

COMMIT;
