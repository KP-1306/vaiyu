-- Migration: Platform Admins
-- Date: 2026-03-03

BEGIN;

create table public.platform_admins (
  user_id uuid primary key
    references auth.users(id)
    on delete cascade,

  role text not null default 'super_admin'
    check (role in ('super_admin','support_admin','finance_admin')),

  is_active boolean not null default true,

  granted_by uuid
    references auth.users(id),

  granted_at timestamptz not null default now(),

  revoked_at timestamptz,

  constraint chk_platform_admin_state
    check (
      (is_active = true AND revoked_at IS NULL)
      OR
      (is_active = false AND revoked_at IS NOT NULL)
    )
);

-- Secure it by default
ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;

-- Allow super_admins to view other admins
CREATE POLICY "Platform admins can view all platform admins"
ON public.platform_admins
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.platform_admins pa
    WHERE pa.user_id = auth.uid() AND pa.is_active = true
  )
);

COMMIT;

-- Helper Function: Check if current user is platform admin
CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.platform_admins
    WHERE user_id = auth.uid() AND is_active = true
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO service_role;
