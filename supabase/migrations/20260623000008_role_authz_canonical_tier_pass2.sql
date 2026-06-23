-- Role-authz canonicalization, pass 2: the remaining hotel admin/manager gates.
--
-- Follow-up to 20260623000007. The same hardcoded `hr.code IN ('OWNER','ADMIN','MANAGER')`
-- triplet (which excludes management-tier codes like GENERAL_MANAGER/ADMINISTRATOR/OPS_MANAGER
-- that role_code_to_legacy_tier() maps to 'manager') still gated the rest of the hotel
-- admin surface, leaving the affected prod member (ADMINISTRATOR+GENERAL_MANAGER) blocked from:
--   • updating hotel details (hotels UPDATE)            • updating guest info (hotel_guest_info UPDATE)
--   • reading audit logs (hotel_audit_logs SELECT)      • reading onboarding progress (SELECT)
--   • resend / revoke invites, update members, update onboarding settings (RPCs)
--
-- Fix: swap each caller-authz check from the triplet to the canonical tier check
-- `role_code_to_legacy_tier(hr.code) IN ('owner','manager')` (functions, surgical predicate-only
-- swap — bodies otherwise verbatim) or `is_platform_admin() OR vaiyu_is_hotel_manager(hotel_id)`
-- (policies). Strictly additive (triplet ⊂ tier set); departmental *_MANAGER stays staff;
-- update_hotel_member's owner-PROTECTION checks (hr.code = 'OWNER') are intentionally left as-is.
--
-- NOT touched (intentional, different semantics): vaiyu_is_hotel_finance_manager (FINANCE_MANAGER
-- list), kitchen RPCs (KITCHEN_MANAGER list).

CREATE OR REPLACE FUNCTION public.resend_hotel_invite(p_invite_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_invite RECORD;
    v_max_resend integer := 5;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    -- Lock invite row
    SELECT *
    INTO v_invite
    FROM public.hotel_invites
    WHERE id = p_invite_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invite not found';
    END IF;

    -- 🔒 Ensure caller is platform admin or OWNER/ADMIN/MANAGER
    IF NOT public.is_platform_admin() AND NOT EXISTS (
        SELECT 1
        FROM public.hotel_members hm
        JOIN public.hotel_member_roles hmr ON hmr.hotel_member_id = hm.id
        JOIN public.hotel_roles hr ON hr.id = hmr.role_id
        WHERE hm.hotel_id = v_invite.hotel_id
        AND hm.user_id = auth.uid()
        AND public.role_code_to_legacy_tier(hr.code) IN ('owner','manager')
        AND hm.is_active = true
        AND hr.is_active = true
    ) THEN
        RAISE EXCEPTION 'Insufficient permissions for this hotel';
    END IF;

    -- State validation
    IF v_invite.status = 'accepted' THEN
        RAISE EXCEPTION 'Cannot resend accepted invite';
    END IF;

    IF v_invite.status = 'revoked' THEN
        RAISE EXCEPTION 'Cannot resend revoked invite';
    END IF;

    -- Resend limit
    IF v_invite.resend_count >= v_max_resend THEN
        RAISE EXCEPTION 'Resend limit exceeded';
    END IF;

    -- Optional cooldown (enterprise safety)
    IF v_invite.last_sent_at IS NOT NULL
       AND v_invite.last_sent_at > now() - interval '30 seconds'
    THEN
        RAISE EXCEPTION 'Invite recently sent. Please wait.';
    END IF;

    -- If expired, reactivate and extend expiry
    IF v_invite.status = 'expired' OR v_invite.expires_at < now() THEN
        UPDATE public.hotel_invites
        SET status = 'pending',
            expires_at = now() + interval '7 days'
        WHERE id = v_invite.id;
    END IF;

    -- Increment resend tracking
    UPDATE public.hotel_invites
    SET resend_count = resend_count + 1,
        last_sent_at = now()
    WHERE id = v_invite.id;

    -- Re-fetch latest values
    SELECT *
    INTO v_invite
    FROM public.hotel_invites
    WHERE id = p_invite_id;

    -- Enterprise Audit Log
    INSERT INTO public.hotel_audit_logs (
        hotel_id,
        user_id,
        action,
        entity_type,
        entity_id,
        changes
    )
    VALUES (
        v_invite.hotel_id,
        auth.uid(),
        'INVITE_RESENT',
        'hotel_invites',
        v_invite.id,
        jsonb_build_object(
            'email', v_invite.email,
            'resend_count', v_invite.resend_count
        )
    );

    -- Queue the email notification (Resend)
    INSERT INTO public.notification_queue (
        channel,
        template_code,
        payload
    )
    VALUES (
        'email',
        'staff_invite',
        jsonb_build_object(
            'email', v_invite.email,
            'invite_token', v_invite.token,
            'hotel_id', v_invite.hotel_id,
            'role_id', v_invite.role_id
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'invite_id', v_invite.id,
        'resend_count', v_invite.resend_count,
        'expires_at', v_invite.expires_at
    );
END;
$function$

;

CREATE OR REPLACE FUNCTION public.revoke_hotel_invite(p_invite_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_invite RECORD;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    -- Lock invite row
    SELECT *
    INTO v_invite
    FROM public.hotel_invites
    WHERE id = p_invite_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invite not found';
    END IF;

    -- 🔒 Ensure caller is platform admin or OWNER/ADMIN/MANAGER
    IF NOT public.is_platform_admin() AND NOT EXISTS (
        SELECT 1
        FROM public.hotel_members hm
        JOIN public.hotel_member_roles hmr ON hmr.hotel_member_id = hm.id
        JOIN public.hotel_roles hr ON hr.id = hmr.role_id
        WHERE hm.hotel_id = v_invite.hotel_id
        AND hm.user_id = auth.uid()
        AND public.role_code_to_legacy_tier(hr.code) IN ('owner','manager')
        AND hm.is_active = true
        AND hr.is_active = true
    ) THEN
        RAISE EXCEPTION 'Insufficient permissions for this hotel';
    END IF;

    -- Idempotent behavior
    IF v_invite.status = 'revoked' THEN
        RETURN jsonb_build_object(
            'success', true,
            'invite_id', v_invite.id,
            'status', 'revoked',
            'message', 'Invite already revoked'
        );
    END IF;

    -- Cannot revoke accepted invite
    IF v_invite.status = 'accepted' THEN
        RAISE EXCEPTION 'Cannot revoke an accepted invite';
    END IF;

    UPDATE public.hotel_invites
    SET status = 'revoked'
    WHERE id = v_invite.id
    AND status IN ('pending','expired');

    -- Enterprise Audit Log
    INSERT INTO public.hotel_audit_logs (
        hotel_id,
        user_id,
        action,
        entity_type,
        entity_id,
        changes
    )
    VALUES (
        v_invite.hotel_id,
        auth.uid(),
        'INVITE_REVOKED',
        'hotel_invites',
        v_invite.id,
        jsonb_build_object(
            'email', v_invite.email
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'invite_id', v_invite.id,
        'status', 'revoked'
    );
END;
$function$

;

CREATE OR REPLACE FUNCTION public.update_hotel_member(p_member_id uuid, p_is_active boolean DEFAULT NULL::boolean, p_is_verified boolean DEFAULT NULL::boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
begin
  -- Ensure the hotel member actually exists
  if not exists (select 1 from public.hotel_members where id = p_member_id) then
    raise exception 'Member not found';
  end if;

  -- Ensure the executing user is part of the same hotel (and ideally an ADMIN/OWNER)
  if not exists (
    select 1 from public.hotel_members hm
    join public.hotel_member_roles hmr on hmr.hotel_member_id = hm.id
    join public.hotel_roles hr on hr.id = hmr.role_id
    where hm.user_id = auth.uid()
      and hm.hotel_id = (select hotel_id from public.hotel_members where id = p_member_id limit 1)
      and public.role_code_to_legacy_tier(hr.code) IN ('owner','manager')
      and hm.is_active = true
  ) then
    raise exception 'Not authorized to modify this member';
  end if;

  -- Apply the update
  if p_is_active is not null then
    -- If deactivating, ensure we correspond to a safe state
    if p_is_active = false then
      -- Check if the member being deactivated is currently an active owner
      if exists (
        select 1 from public.hotel_member_roles hmr
        join public.hotel_roles hr on hr.id = hmr.role_id
        join public.hotel_members hm on hm.id = hmr.hotel_member_id
        where hmr.hotel_member_id = p_member_id 
          and hr.code = 'OWNER'
          and hm.is_active = true
      ) then
        -- Check if there are any *other* active owners in this hotel
        if not exists (
          select 1
          from public.hotel_members hm
          join public.hotel_member_roles hmr on hmr.hotel_member_id = hm.id
          join public.hotel_roles hr on hr.id = hmr.role_id
          where hm.hotel_id = (select hotel_id from public.hotel_members where id = p_member_id limit 1)  -- Using a robust subquery instead of the local variable
            and hm.is_active = true
            and hr.code = 'OWNER'
            and hm.id != p_member_id
        ) then
          raise exception 'Cannot deactivate the only remaining active owner of the hotel';
        end if;
      end if;
    end if;

    update public.hotel_members set is_active = p_is_active where id = p_member_id;
  end if;
  
  if p_is_verified is not null then
    update public.hotel_members set is_verified = p_is_verified where id = p_member_id;
  end if;

end;
$function$

;

CREATE OR REPLACE FUNCTION public.update_hotel_settings_onboarding(p_hotel_id uuid, payload jsonb, p_action text DEFAULT 'HOTEL_UPDATED'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_has_access boolean;
    v_rowcount integer;
BEGIN
    SET LOCAL statement_timeout = '10s';

    -- Require authentication
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    -- Protect against empty payload
    IF payload IS NULL OR payload = '{}'::jsonb THEN
        RAISE EXCEPTION 'Payload cannot be empty';
    END IF;

    -- Prevent absurdly large payloads
    IF (SELECT count(*) FROM jsonb_object_keys(payload)) > 50 THEN
        RAISE EXCEPTION 'Payload is too large';
    END IF;

    -- Slug handling moved after row lock

    -- Validate existence and grab row lock in one operation
    PERFORM 1 FROM public.hotels WHERE id = p_hotel_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Hotel not found';
    END IF;


    -- Block restricted fields from being updated directly via this RPC
    IF payload ? 'plan' 
       OR payload ? 'plan_status' 
       OR payload ? 'status' 
       OR payload ? 'lifecycle_status' 
       OR payload ? 'go_live_at' THEN
        RAISE EXCEPTION 'Restricted core lifecycle fields cannot be updated via the onboarding settings RPC';
    END IF;

    -- Security Check: The user must either be:
    -- 1. An active Platform Admin
    -- 2. An active OWNER/ADMIN/MANAGER of the hotel
    -- 3. In the middle of an active onboarding session triggered by them
    
    -- Check Platform Admin
    SELECT EXISTS (
        SELECT 1 FROM public.platform_admins
        WHERE user_id = auth.uid()
        AND is_active = true
    ) INTO v_has_access;

    IF NOT v_has_access THEN
        -- Check Hotel Member
        SELECT EXISTS (
            SELECT 1
            FROM public.hotel_members hm
            JOIN public.hotel_member_roles hmr ON hmr.hotel_member_id = hm.id
            JOIN public.hotel_roles hr ON hr.id = hmr.role_id
            WHERE hm.user_id = auth.uid()
            AND hm.hotel_id = p_hotel_id
            AND public.role_code_to_legacy_tier(hr.code) IN ('owner','manager')
            AND hm.is_active = true
            AND hr.is_active = true
        ) INTO v_has_access;
    END IF;

    IF NOT v_has_access THEN
        -- Check if they are actively onboarding this specific hotel right now
        -- (They ran step 1, creating progress logs but aren't members yet)
        SELECT EXISTS (
            SELECT 1 
            FROM public.hotel_audit_logs
            WHERE hotel_id = p_hotel_id
            AND user_id = auth.uid()
            AND action = 'HOTEL_CREATED'
        ) INTO v_has_access;
    END IF;

    IF NOT v_has_access THEN
        RAISE EXCEPTION 'Insufficient permissions to update this hotel';
    END IF;

    -- Validate slug format, ensure uniqueness, and normalize
    IF payload ? 'slug' THEN
        -- Safely normalize first to gracefully handle spaces and uppercase from legacy data
        payload := jsonb_set(
            payload,
            '{slug}',
            to_jsonb(lower(trim(payload->>'slug')))
        );

        -- Format validation: only lowercase alphanumerics and hyphens
        IF payload->>'slug' = '' THEN
            RAISE EXCEPTION 'Slug cannot be empty';
        END IF;
        IF payload->>'slug' !~ '^[a-z0-9\-]+$' THEN
            RAISE EXCEPTION 'Invalid slug format';
        END IF;

        -- Ensure slug uniqueness (excluding current hotel)
        IF EXISTS (
            SELECT 1
            FROM public.hotels
            WHERE slug = payload->>'slug'
            AND id <> p_hotel_id
        ) THEN
            RAISE EXCEPTION 'Slug already exists';
        END IF;
    END IF;

    -- Dynamic Update Logic via JSONB
    UPDATE public.hotels
    SET 
        name = COALESCE((payload->>'name'), name),
        slug = CASE WHEN payload ? 'slug' THEN payload->>'slug' ELSE slug END,
        description = COALESCE((payload->>'description'), description),
        phone = COALESCE((payload->>'phone'), phone),
        email = COALESCE((payload->>'email'), email),
        address = COALESCE((payload->>'address'), address),
        city = COALESCE((payload->>'city'), city),
        state = COALESCE((payload->>'state'), state),
        country = COALESCE((payload->>'country'), country),
        postal_code = COALESCE((payload->>'postal_code'), postal_code),
        latitude = CASE WHEN payload ? 'latitude' AND payload->>'latitude' IS NOT NULL THEN (payload->>'latitude')::numeric ELSE latitude END,
        longitude = CASE WHEN payload ? 'longitude' AND payload->>'longitude' IS NOT NULL THEN (payload->>'longitude')::numeric ELSE longitude END,
        legal_name = COALESCE((payload->>'legal_name'), legal_name),
        gst_number = COALESCE((payload->>'gst_number'), gst_number),
        logo_path = COALESCE((payload->>'logo_path'), logo_path),
        cover_image_path = COALESCE((payload->>'cover_image_path'), cover_image_path),
        brand_color = COALESCE((payload->>'brand_color'), brand_color),
        
        default_checkin_time = COALESCE(NULLIF(payload->>'default_checkin_time', '')::time, default_checkin_time),
        default_checkout_time = COALESCE(NULLIF(payload->>'default_checkout_time', '')::time, default_checkout_time),
        timezone = COALESCE((payload->>'timezone'), timezone),
        currency_code = COALESCE((payload->>'currency_code'), currency_code),
        tax_percentage = CASE WHEN payload ? 'tax_percentage' AND payload->>'tax_percentage' IS NOT NULL THEN (payload->>'tax_percentage')::numeric ELSE tax_percentage END,
        service_charge_percentage = CASE WHEN payload ? 'service_charge_percentage' AND payload->>'service_charge_percentage' IS NOT NULL THEN (payload->>'service_charge_percentage')::numeric ELSE service_charge_percentage END,
        invoice_prefix = COALESCE((payload->>'invoice_prefix'), invoice_prefix),
        invoice_counter = CASE WHEN payload ? 'invoice_counter' AND payload->>'invoice_counter' IS NOT NULL THEN (payload->>'invoice_counter')::integer ELSE invoice_counter END,
        upi_id = CASE WHEN payload ? 'upi_id' THEN payload->>'upi_id' ELSE upi_id END,
        booking_url = CASE WHEN payload ? 'booking_url' THEN payload->>'booking_url' ELSE booking_url END,
        amenities = CASE 
            WHEN payload ? 'amenities' AND jsonb_typeof(payload->'amenities') = 'array' 
            THEN ARRAY(SELECT jsonb_array_elements_text(payload->'amenities')) 
            ELSE amenities 
        END,
        early_checkin_allowed = CASE WHEN payload ? 'early_checkin_allowed' THEN (payload->>'early_checkin_allowed')::boolean ELSE early_checkin_allowed END,
        late_checkout_allowed = CASE WHEN payload ? 'late_checkout_allowed' THEN (payload->>'late_checkout_allowed')::boolean ELSE late_checkout_allowed END,
        
        updated_at = now()
    WHERE id = p_hotel_id;

    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount = 0 THEN
        RAISE EXCEPTION 'Hotel update failed or no rows matched';
    END IF;

    -- Update Guest Info if provided in payload
    IF payload ? 'wifi_ssid' OR payload ? 'wifi_password' OR payload ? 'breakfast_start' OR payload ? 'breakfast_end' OR payload ? 'guest_notes' THEN
        UPDATE public.hotel_guest_info
        SET
            wifi_ssid = CASE WHEN payload ? 'wifi_ssid' THEN payload->>'wifi_ssid' ELSE wifi_ssid END,
            wifi_password = CASE WHEN payload ? 'wifi_password' THEN payload->>'wifi_password' ELSE wifi_password END,
            breakfast_start = CASE WHEN payload ? 'breakfast_start' THEN CAST(NULLIF(payload->>'breakfast_start', '') AS time) ELSE breakfast_start END,
            breakfast_end = CASE WHEN payload ? 'breakfast_end' THEN CAST(NULLIF(payload->>'breakfast_end', '') AS time) ELSE breakfast_end END,
            notes = CASE WHEN payload ? 'guest_notes' THEN payload->>'guest_notes' ELSE notes END,
            updated_at = now()
        WHERE hotel_id = p_hotel_id;
        
        -- If update affected 0 rows (missing relation), then insert
        IF NOT FOUND THEN
            INSERT INTO public.hotel_guest_info (
                hotel_id, 
                wifi_ssid, 
                wifi_password, 
                breakfast_start, 
                breakfast_end, 
                notes
            )
            VALUES (
                p_hotel_id,
                payload->>'wifi_ssid',
                payload->>'wifi_password',
                CAST(NULLIF(payload->>'breakfast_start', '') AS time),
                CAST(NULLIF(payload->>'breakfast_end', '') AS time),
                payload->>'guest_notes'
            );
        END IF;
    END IF;

    -- Audit Log the Update
    INSERT INTO public.hotel_audit_logs (
        hotel_id, user_id, action, entity_type, entity_id, changes, created_at
    )
    VALUES (
        p_hotel_id,
        auth.uid(),
        p_action,
        'hotels',
        p_hotel_id,
        jsonb_build_object('updated_fields', payload),
        now()
    );

    RETURN p_hotel_id;
END;
$function$

;


-- ════════════════════════ Policies ════════════════════════
DROP POLICY IF EXISTS "Hotel admins can update hotel details" ON public.hotels;
CREATE POLICY "Hotel admins can update hotel details" ON public.hotels
  FOR UPDATE
  USING (public.is_platform_admin() OR public.vaiyu_is_hotel_manager(id))
  WITH CHECK (public.is_platform_admin() OR public.vaiyu_is_hotel_manager(id));

DROP POLICY IF EXISTS "Hotel admins can update guest info" ON public.hotel_guest_info;
CREATE POLICY "Hotel admins can update guest info" ON public.hotel_guest_info
  FOR UPDATE
  USING (public.is_platform_admin() OR public.vaiyu_is_hotel_manager(hotel_id))
  WITH CHECK (public.is_platform_admin() OR public.vaiyu_is_hotel_manager(hotel_id));

-- audit + onboarding-progress SELECT: preserve original semantics (no platform-admin branch),
-- only widen the member match from triplet to canonical tier.
DROP POLICY IF EXISTS hotel_audit_hotel_admin_select ON public.hotel_audit_logs;
CREATE POLICY hotel_audit_hotel_admin_select ON public.hotel_audit_logs
  FOR SELECT
  USING (public.vaiyu_is_hotel_manager(hotel_id));

DROP POLICY IF EXISTS onboarding_hotel_admin_select ON public.hotel_onboarding_progress;
CREATE POLICY onboarding_hotel_admin_select ON public.hotel_onboarding_progress
  FOR SELECT
  USING (public.vaiyu_is_hotel_manager(hotel_id));
