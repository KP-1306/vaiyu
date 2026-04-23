-- Migration: Enable RLS for Room Types

ALTER TABLE public.room_types ENABLE ROW LEVEL SECURITY;

-- 1. Read Policy: All members can view
DROP POLICY IF EXISTS "Everyone can view room types" ON public.room_types;
DROP POLICY IF EXISTS "Hotel members can view room types" ON public.room_types;

CREATE POLICY "Hotel members can view room types"
ON public.room_types
FOR SELECT
USING (
    public.is_platform_admin()
    OR EXISTS (
        SELECT 1
        FROM public.hotel_members hm
        WHERE hm.user_id = auth.uid()
        AND hm.hotel_id = room_types.hotel_id
    )
);

-- 2. Management Policy: OWNER/ADMIN/MANAGER only
DROP POLICY IF EXISTS "Staff can manage room types" ON public.room_types;

CREATE POLICY "Staff can manage room types"
ON public.room_types
FOR ALL
USING (
    public.is_platform_admin()
    OR EXISTS (
        SELECT 1
        FROM public.hotel_members hm
        JOIN public.hotel_member_roles hmr ON hmr.hotel_member_id = hm.id
        JOIN public.hotel_roles hr ON hr.id = hmr.role_id
        WHERE hm.user_id = auth.uid()
        AND hm.hotel_id = room_types.hotel_id
        AND hr.code IN ('OWNER','ADMIN','MANAGER')
    )
)
WITH CHECK (
    public.is_platform_admin()
    OR EXISTS (
        SELECT 1
        FROM public.hotel_members hm
        JOIN public.hotel_member_roles hmr ON hmr.hotel_member_id = hm.id
        JOIN public.hotel_roles hr ON hr.id = hmr.role_id
        WHERE hm.user_id = auth.uid()
        AND hm.hotel_id = room_types.hotel_id
        AND hr.code IN ('OWNER','ADMIN','MANAGER')
    )
);
