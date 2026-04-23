-- Migration: Staff Manage Rooms Policy

ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;

-- 1. Read Policy: All members can view
DROP POLICY IF EXISTS "Everyone can view rooms" ON public.rooms;
DROP POLICY IF EXISTS "Hotel members can view rooms" ON public.rooms;

CREATE POLICY "Hotel members can view rooms"
ON public.rooms
FOR SELECT
USING (
    public.is_platform_admin()
    OR EXISTS (
        SELECT 1
        FROM public.hotel_members hm
        WHERE hm.user_id = auth.uid()
        AND hm.hotel_id = rooms.hotel_id
    )
);

-- 2. Management Policy: OWNER/ADMIN/MANAGER only
DROP POLICY IF EXISTS "Staff can manage rooms" ON public.rooms;

CREATE POLICY "Staff can manage rooms"
ON public.rooms
FOR ALL
USING (
    public.is_platform_admin()
    OR EXISTS (
        SELECT 1
        FROM public.hotel_members hm
        JOIN public.hotel_member_roles hmr ON hmr.hotel_member_id = hm.id
        JOIN public.hotel_roles hr ON hr.id = hmr.role_id
        WHERE hm.user_id = auth.uid()
        AND hm.hotel_id = rooms.hotel_id
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
        AND hm.hotel_id = rooms.hotel_id
        AND hr.code IN ('OWNER','ADMIN','MANAGER')
    )
);
