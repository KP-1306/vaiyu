-- Migration: Sync hotel_members.role with hotel_member_roles
-- Date: 2026-04-18

BEGIN;

-- 1. Create the trigger function
CREATE OR REPLACE FUNCTION public.fn_sync_hotel_member_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_member_id uuid;
BEGIN
    -- Determine the member ID based on the operation
    IF TG_OP = 'DELETE' THEN
        v_member_id := OLD.hotel_member_id;
    ELSE
        v_member_id := NEW.hotel_member_id;
    END IF;

    -- Calculate the highest tier role for this member and update in one safe atomic query
    WITH role_calc AS (
        SELECT
            CASE
                WHEN bool_or(hr.code = 'OWNER') THEN 'OWNER'
                WHEN bool_or(hr.code IN ('ADMIN', 'MANAGER', 'OPS_MANAGER')) THEN 'MANAGER'
                ELSE 'STAFF'
            END as new_role
        FROM public.hotel_member_roles hmr
        JOIN public.hotel_roles hr ON hr.id = hmr.role_id
        WHERE hmr.hotel_member_id = v_member_id
          AND hr.is_active = true
    )
    UPDATE public.hotel_members hm
    SET 
        role = COALESCE((SELECT new_role FROM role_calc), 'STAFF'),
        updated_at = now()
    WHERE hm.id = v_member_id
      AND hm.role IS DISTINCT FROM COALESCE((SELECT new_role FROM role_calc), 'STAFF');

    RETURN NULL; -- AFTER trigger
END;
$$;

-- 2. Attach the trigger
-- We attach this to hotel_member_roles. If a role is assigned or removed, we sync.
DROP TRIGGER IF EXISTS trg_sync_member_role_after_change ON public.hotel_member_roles;
CREATE TRIGGER trg_sync_member_role_after_change
AFTER INSERT OR UPDATE OR DELETE ON public.hotel_member_roles
FOR EACH ROW
EXECUTE FUNCTION public.fn_sync_hotel_member_role();

-- 3. Run a one-time backfill to sync all existing members immediately
DO $$
DECLARE
    rec RECORD;
BEGIN
    FOR rec IN 
        SELECT hm.id,
            CASE
                WHEN bool_or(hr.code = 'OWNER') THEN 'OWNER'
                WHEN bool_or(hr.code IN ('ADMIN', 'MANAGER', 'OPS_MANAGER')) THEN 'MANAGER'
                ELSE 'STAFF'
            END as calculated_role
        FROM public.hotel_members hm
        LEFT JOIN public.hotel_member_roles hmr ON hmr.hotel_member_id = hm.id
        LEFT JOIN public.hotel_roles hr ON hr.id = hmr.role_id AND hr.is_active = true
        GROUP BY hm.id
    LOOP
        UPDATE public.hotel_members 
        SET role = COALESCE(rec.calculated_role, 'STAFF')
        WHERE id = rec.id 
          AND role IS DISTINCT FROM COALESCE(rec.calculated_role, 'STAFF');
    END LOOP;
END $$;

COMMIT;
