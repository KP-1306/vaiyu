-- ============================================================
-- VAIYU ENTERPRISE CONTROL PLANE (FINAL CORRECTED)
-- Onboarding + Lifecycle + SLA + Billing + Grace + Override
-- Optional Owner Provisioning + Activation Guard
-- ============================================================

BEGIN;

-- ============================================================
-- 1️⃣ ENUMS
-- ============================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'hotel_lifecycle_status') THEN
        CREATE TYPE public.hotel_lifecycle_status AS ENUM (
            'DRAFT',
            'CONFIGURING',
            'READY_FOR_REVIEW',
            'ACTIVE',
            'SUSPENDED',
            'TRIAL_EXPIRED'
        );
    END IF;
END$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'hotel_onboarding_step') THEN
        CREATE TYPE public.hotel_onboarding_step AS ENUM (
            'hotel_details',
            'operational_settings',
            'room_setup',
            'staff_setup',
            'financial_setup',
            'branding',
            'features'
        );
    END IF;
END$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'hotel_billing_status') THEN
        CREATE TYPE public.hotel_billing_status AS ENUM (
            'trialing',
            'active',
            'past_due',
            'canceled',
            'incomplete',
            'suspended'
        );
    END IF;
END$$;

-- ============================================================
-- 2️⃣ EXTEND HOTELS TABLE
-- ============================================================

ALTER TABLE public.hotels
    ADD COLUMN IF NOT EXISTS lifecycle_status public.hotel_lifecycle_status NOT NULL DEFAULT 'DRAFT',
    ADD COLUMN IF NOT EXISTS is_setup_complete boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS go_live_at timestamptz,
    ADD COLUMN IF NOT EXISTS onboarding_started_at timestamptz,
    ADD COLUMN IF NOT EXISTS onboarding_due_at timestamptz,
    ADD COLUMN IF NOT EXISTS onboarding_sla_days integer DEFAULT 14,
    ADD COLUMN IF NOT EXISTS billing_status public.hotel_billing_status DEFAULT 'trialing',
    ADD COLUMN IF NOT EXISTS billing_started_at timestamptz,
    ADD COLUMN IF NOT EXISTS billing_expires_at timestamptz,
    ADD COLUMN IF NOT EXISTS billing_grace_until timestamptz,
    ADD COLUMN IF NOT EXISTS billing_override boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS billing_override_reason text;

CREATE INDEX IF NOT EXISTS idx_hotels_lifecycle_status ON public.hotels(lifecycle_status);
CREATE INDEX IF NOT EXISTS idx_hotels_billing_status ON public.hotels(billing_status);

-- ============================================================
-- 3️⃣ REQUIRED STEP REGISTRY
-- ============================================================

CREATE TABLE IF NOT EXISTS public.hotel_onboarding_required_steps (
    step_name public.hotel_onboarding_step PRIMARY KEY
);

INSERT INTO public.hotel_onboarding_required_steps(step_name)
VALUES
    ('hotel_details'),
    ('operational_settings'),
    ('room_setup'),
    ('financial_setup')
ON CONFLICT DO NOTHING;

-- ============================================================
-- 4️⃣ ONBOARDING PROGRESS TABLE (RLS ENABLED)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.hotel_onboarding_progress (
    hotel_id uuid NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
    step_name public.hotel_onboarding_step NOT NULL,
    completed_at timestamptz NOT NULL DEFAULT now(),
    completed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    PRIMARY KEY (hotel_id, step_name)
);

CREATE INDEX IF NOT EXISTS idx_onboarding_progress_hotel
ON public.hotel_onboarding_progress (hotel_id);

ALTER TABLE public.hotel_onboarding_progress ENABLE ROW LEVEL SECURITY;

-- Platform Admin Policy
CREATE POLICY onboarding_platform_admin_select
ON public.hotel_onboarding_progress
FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM public.platform_admins pa
        WHERE pa.user_id = auth.uid()
        AND pa.is_active = true
    )
);

-- Hotel Admin Policy
CREATE POLICY onboarding_hotel_admin_select
ON public.hotel_onboarding_progress
FOR SELECT
USING (
    EXISTS (
        SELECT 1
        FROM public.hotel_members hm
        JOIN public.hotel_member_roles hmr ON hmr.hotel_member_id = hm.id
        JOIN public.hotel_roles hr ON hr.id = hmr.role_id
        WHERE hm.user_id = auth.uid()
        AND hm.hotel_id = hotel_onboarding_progress.hotel_id
        AND hr.code IN ('OWNER','ADMIN','MANAGER')
        AND hm.is_active = true
        AND hr.is_active = true
    )
);

-- ============================================================
-- 5️⃣ CHECK REQUIRED STEPS
-- ============================================================

CREATE OR REPLACE FUNCTION public.are_required_onboarding_steps_complete(p_hotel_id uuid)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
    required_count integer;
    completed_count integer;
BEGIN
    SELECT COUNT(*) INTO required_count
    FROM public.hotel_onboarding_required_steps;

    SELECT COUNT(*) INTO completed_count
    FROM public.hotel_onboarding_progress hop
    JOIN public.hotel_onboarding_required_steps hrs
      ON hop.step_name = hrs.step_name
    WHERE hop.hotel_id = p_hotel_id;

    RETURN completed_count = required_count;
END;
$$;

-- ============================================================
-- 6️⃣ ENSURE AT LEAST ONE OWNER EXISTS
-- ============================================================

CREATE OR REPLACE FUNCTION public.hotel_has_owner(p_hotel_id uuid)
RETURNS boolean
LANGUAGE sql
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.hotel_members hm
        JOIN public.hotel_member_roles hmr ON hmr.hotel_member_id = hm.id
        JOIN public.hotel_roles hr ON hr.id = hmr.role_id
        WHERE hm.hotel_id = p_hotel_id
          AND hr.code = 'OWNER'
          AND hm.is_active = true
          AND hr.is_active = true
    );
$$;

-- ============================================================
-- 7️⃣ MARK STEP COMPLETE (CONCURRENCY SAFE)
-- ============================================================

CREATE OR REPLACE FUNCTION public.mark_onboarding_step_complete(
    p_hotel_id uuid,
    p_step public.hotel_onboarding_step
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM 1 FROM public.hotels
    WHERE id = p_hotel_id
    FOR UPDATE;

    INSERT INTO public.hotel_onboarding_progress (
        hotel_id,
        step_name,
        completed_by
    )
    VALUES (
        p_hotel_id,
        p_step,
        auth.uid()
    )
    ON CONFLICT (hotel_id, step_name)
    DO UPDATE SET completed_at = now();

    UPDATE public.hotels
    SET lifecycle_status = 'CONFIGURING',
        onboarding_started_at = COALESCE(onboarding_started_at, now()),
        onboarding_due_at = COALESCE(onboarding_due_at, now() + (onboarding_sla_days || ' days')::interval)
    WHERE id = p_hotel_id
      AND lifecycle_status = 'DRAFT';

    IF public.are_required_onboarding_steps_complete(p_hotel_id) THEN
        UPDATE public.hotels
        SET lifecycle_status = 'READY_FOR_REVIEW',
            is_setup_complete = true
        WHERE id = p_hotel_id;
    END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mark_onboarding_step_complete(uuid, public.hotel_onboarding_step) FROM PUBLIC;

-- ============================================================
-- 8️⃣ CREATE HOTEL ONBOARDING RPC
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_hotel_onboarding(payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    new_hotel_id uuid;
    owner_role_id uuid;
    owner_member_id uuid;
    v_owner_user_id uuid;
BEGIN
    IF payload->>'name' IS NULL OR payload->>'slug' IS NULL THEN
        RAISE EXCEPTION 'Hotel name and slug are required';
    END IF;

    v_owner_user_id := (payload->>'owner_user_id')::uuid;

    INSERT INTO public.hotels (
        name, slug, description, phone, email, address,
        city, state, country, postal_code,
        latitude, longitude, legal_name, gst_number,
        logo_path, cover_image_path, brand_color,
        onboarding_started_at
    )
    VALUES (
        payload->>'name',
        payload->>'slug',
        payload->>'description',
        payload->>'phone',
        payload->>'email',
        payload->>'address',
        payload->>'city',
        payload->>'state',
        payload->>'country',
        payload->>'postal_code',
        (payload->>'latitude')::numeric,
        (payload->>'longitude')::numeric,
        payload->>'legal_name',
        payload->>'gst_number',
        payload->>'logo_path',
        payload->>'cover_image_path',
        payload->>'brand_color',
        now()
    )
    RETURNING id INTO new_hotel_id;

    INSERT INTO public.hotel_roles (hotel_id, name, code, description, is_active)
    VALUES (new_hotel_id, 'Owner', 'OWNER', 'Full administrative access.', true)
    RETURNING id INTO owner_role_id;

    INSERT INTO public.hotel_roles (hotel_id, name, code, description, is_active)
    VALUES
        (new_hotel_id, 'Admin', 'ADMIN', 'Administrative control.', true),
        (new_hotel_id, 'Manager', 'MANAGER', 'Operational management.', true),
        (new_hotel_id, 'Front Desk', 'FRONT_DESK', 'Front office.', true),
        (new_hotel_id, 'Housekeeping', 'HOUSEKEEPING', 'Cleaning operations.', true);

    IF v_owner_user_id IS NOT NULL THEN
        INSERT INTO public.hotel_members (
            hotel_id, user_id, status, is_active, is_verified
        )
        VALUES (
            new_hotel_id,
            v_owner_user_id,
            'active',
            true,
            true
        )
        RETURNING id INTO owner_member_id;

        INSERT INTO public.hotel_member_roles (hotel_member_id, role_id)
        VALUES (owner_member_id, owner_role_id);
    END IF;

    PERFORM public.mark_onboarding_step_complete(
        new_hotel_id,
        'hotel_details'
    );

    INSERT INTO public.hotel_audit_logs (
        hotel_id, user_id, action, entity_type, entity_id, changes, created_at
    )
    VALUES (
        new_hotel_id,
        auth.uid(),
        'HOTEL_CREATED',
        'hotels',
        new_hotel_id,
        jsonb_build_object(
            'name', payload->>'name',
            'slug', payload->>'slug',
            'owner_user_id', v_owner_user_id
        ),
        now()
    );

    RETURN new_hotel_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_hotel_onboarding(jsonb) FROM PUBLIC;

-- ============================================================
-- 9️⃣ ACTIVATE HOTEL (WITH OWNER + BILLING + OVERRIDE CHECK)
-- ============================================================

CREATE OR REPLACE FUNCTION public.activate_hotel(p_hotel_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_status public.hotel_billing_status;
    v_override boolean;
BEGIN
    PERFORM 1 FROM public.hotels WHERE id = p_hotel_id FOR UPDATE;

    IF NOT public.are_required_onboarding_steps_complete(p_hotel_id) THEN
        RAISE EXCEPTION 'Onboarding incomplete';
    END IF;

    IF NOT public.hotel_has_owner(p_hotel_id) THEN
        RAISE EXCEPTION 'Cannot activate hotel without an OWNER assigned';
    END IF;

    SELECT billing_status, billing_override
    INTO v_status, v_override
    FROM public.hotels
    WHERE id = p_hotel_id;

    IF NOT v_override THEN
        IF v_status NOT IN ('active','trialing') THEN
            RAISE EXCEPTION 'Billing not active';
        END IF;
    END IF;

    UPDATE public.hotels
    SET lifecycle_status = 'ACTIVE',
        status = 'active',
        go_live_at = now()
    WHERE id = p_hotel_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.activate_hotel(uuid) FROM PUBLIC;

-- ============================================================
-- 🔟 SLA ENFORCEMENT
-- ============================================================

CREATE OR REPLACE FUNCTION public.enforce_onboarding_sla()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.hotels
    SET lifecycle_status = 'TRIAL_EXPIRED'
    WHERE lifecycle_status IN ('DRAFT','CONFIGURING', 'READY_FOR_REVIEW')
      AND onboarding_due_at IS NOT NULL
      AND now() > onboarding_due_at;
END;
$$;

-- ============================================================
-- 11️⃣ BILLING ENFORCEMENT (GRACE + OVERRIDE)
-- ============================================================

CREATE OR REPLACE FUNCTION public.enforce_billing_compliance()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.hotels
    SET lifecycle_status = 'SUSPENDED'
    WHERE lifecycle_status = 'ACTIVE'
      AND billing_status IN ('past_due','canceled','suspended')
      AND billing_override = false
      AND (
            billing_grace_until IS NULL
            OR now() > billing_grace_until
          );
END;
$$;

COMMIT;
