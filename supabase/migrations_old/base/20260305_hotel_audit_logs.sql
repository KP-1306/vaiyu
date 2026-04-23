-- Migration: Hotel Audit Logs
-- Date: 2026-03-05
-- Purpose: Enterprise-grade immutable audit logging for all hotel lifecycle and access events.

BEGIN;

CREATE TABLE IF NOT EXISTS public.hotel_audit_logs (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    hotel_id uuid NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
    user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL, -- Who performed the action
    action text NOT NULL,                                       -- e.g. 'HOTEL_CREATED', 'INVITE_ACCEPTED'
    entity_type text NOT NULL,                                  -- e.g. 'hotels', 'hotel_invites'
    entity_id uuid NOT NULL,                                    -- ID of the affected row
    changes jsonb NOT NULL DEFAULT '{}'::jsonb,                 -- What changed (from/to JSON payload)
    source text DEFAULT 'webapp',                               -- Where did this occur
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexing for fast dashboard retrieval by hotel and entity
CREATE INDEX IF NOT EXISTS idx_hotel_audit_logs_hotel ON public.hotel_audit_logs(hotel_id);
CREATE INDEX IF NOT EXISTS idx_hotel_audit_logs_entity ON public.hotel_audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_hotel_audit_logs_created ON public.hotel_audit_logs(created_at DESC);

-- Enable RLS
ALTER TABLE public.hotel_audit_logs ENABLE ROW LEVEL SECURITY;

-- 🛡️ STRICT VIEW POLICY: Only Platform Admins or Hotel OWNER/ADMINs can view logs
CREATE POLICY "Strict audit log viewing"
ON public.hotel_audit_logs
FOR SELECT
USING (
    -- 1. Allowed if Platform Admin
    EXISTS (
        SELECT 1 FROM public.platform_admins pa
        WHERE pa.user_id = auth.uid()
        AND pa.is_active = true
    )
    OR
    -- 2. Allowed if Hotel Owner or Admin
    EXISTS (
        SELECT 1
        FROM public.hotel_members hm
        JOIN public.hotel_member_roles hmr ON hmr.hotel_member_id = hm.id
        JOIN public.hotel_roles hr ON hr.id = hmr.role_id
        WHERE hm.hotel_id = hotel_audit_logs.hotel_id
        AND hm.user_id = auth.uid()
        AND hr.code IN ('OWNER', 'ADMIN')
        AND hm.is_active = true
        AND hr.is_active = true
    )
    OR
    -- 3. Allowed if you performed the action yourself (during onboarding steps before owner assignment)
    user_id = auth.uid()
);

-- 🛡️ NO UPDATE/DELETE POLICIES (Immutable Log)
-- Inserts happen via SECURITY DEFINER functions, so we do not even need an INSERT policy for the public.

COMMIT;
