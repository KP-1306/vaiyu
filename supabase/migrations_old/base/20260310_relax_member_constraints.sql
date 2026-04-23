-- Migration: Relax Hotel Member Constraints
-- Date: 2026-03-10
-- Purpose: Allow staff invitations to be accepted without blocking on legacy role/department fields.
-- Granular roles are now handled in the hotel_member_roles table.

BEGIN;

-- 1. Drop the check constraint on role categories
ALTER TABLE public.hotel_members 
DROP CONSTRAINT IF EXISTS hotel_members_role_check;

-- 2. Make role and department_id nullable
-- We keep the columns for legacy compatibility but move away from enforcement here.
ALTER TABLE public.hotel_members 
ALTER COLUMN role DROP NOT NULL,
ALTER COLUMN department_id DROP NOT NULL;

-- 3. Update any existing NULL roles to 'STAFF' just to be safe for frontend hooks
UPDATE public.hotel_members
SET role = 'STAFF'
WHERE role IS NULL;

-- 4. Add performance indexes for invitation lookups
CREATE INDEX IF NOT EXISTS idx_hotel_invites_token ON public.hotel_invites(token);
CREATE INDEX IF NOT EXISTS idx_hotel_invites_email ON public.hotel_invites(email);


CREATE INDEX IF NOT EXISTS idx_hotel_invites_status ON public.hotel_invites(status);
CREATE INDEX IF NOT EXISTS idx_hotel_invites_expires ON public.hotel_invites(expires_at);

-- 5. Maintenance: Function to cleanup/expire old invites
CREATE OR REPLACE FUNCTION public.cleanup_expired_hotel_invites()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
    UPDATE public.hotel_invites
    SET status = 'expired'
    WHERE status = 'pending'
    AND expires_at < now();
$$;

-- 6. Schedule Cron Job (Daily at 03:00 AM)
-- Requires pg_cron extension enabled
SELECT cron.schedule(
  'cleanup_expired_hotel_invites_daily',
  '0 3 * * *',
  $$ SELECT public.cleanup_expired_hotel_invites(); $$
);

COMMIT;
