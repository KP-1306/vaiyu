-- Authorization guards on platform-onboarding RPCs (auth sweep, batch 2 — 2026-06-14).
--
-- Found in the post-checkout authorization sweep: three onboarding RPCs are
-- SECURITY DEFINER, granted to PUBLIC (anon), with NO authorization guard:
--   • approve_owner_application / reject_owner_application — review owner
--     applications and CREATE new properties. p_reviewer is a trusted param.
--     Anon could approve/reject ANY pending application → onboard a fake
--     property or block a real one. Platform-level action → platform admin only.
--   • activate_hotel — flips a hotel to ACTIVE / go-live. Called by the owner in
--     HotelOnboarding. Anon could activate any onboarding-complete hotel.
--     Hotel-scoped action → member of that hotel (owner completing onboarding)
--     or platform admin.
--
-- Fix: add the guards and REVOKE EXECUTE from PUBLIC + anon. Bodies reproduced
-- from their audited live definitions with only the guard inserted.

-- ════════════════════════════════════════════════════════════════════════
-- approve_owner_application — platform admin only.
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.approve_owner_application(p_app_id uuid, p_reviewer uuid, p_notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  app record;
  new_prop_id uuid;
begin
  -- Authorization: onboarding review is a platform-staff action.
  if not public.is_platform_admin() then
    raise exception 'Not authorized: platform admin required'
      using errcode = 'insufficient_privilege';
  end if;

  select * into app
  from public.owner_applications
  where id = p_app_id and status = 'pending';

  if not found then
    raise exception 'Application not found or not pending';
  end if;

  insert into public.properties (
    name, type, city, country, map_link,
    approx_room_count, website_links, cover_url,
    owner_contact_name, owner_contact_email, owner_contact_phone
  )
  values (
    app.property_name, app.property_type, app.city, app.country, app.map_link,
    app.room_count, app.links, app.cover_url,
    app.contact_name, app.contact_email, app.contact_phone
  )
  returning id into new_prop_id;

  update public.owner_applications
  set status = 'approved',
      reviewer_id = coalesce(auth.uid(), p_reviewer),
      reviewed_at = now(),
      review_notes = p_notes,
      property_id = new_prop_id
  where id = p_app_id;

  return new_prop_id;
end;
$function$;

REVOKE ALL ON FUNCTION public.approve_owner_application(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_owner_application(uuid, uuid, text) TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════
-- reject_owner_application — platform admin only.
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.reject_owner_application(p_app_id uuid, p_reviewer uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  app record;
begin
  -- Authorization: onboarding review is a platform-staff action.
  if not public.is_platform_admin() then
    raise exception 'Not authorized: platform admin required'
      using errcode = 'insufficient_privilege';
  end if;

  select * into app
  from public.owner_applications
  where id = p_app_id and status = 'pending';

  if not found then
    raise exception 'Application not found or not pending';
  end if;

  update public.owner_applications
  set status = 'rejected',
      reviewer_id = coalesce(auth.uid(), p_reviewer),
      reviewed_at = now(),
      review_notes = coalesce(p_reason, 'rejected')
  where id = p_app_id;
end;
$function$;

REVOKE ALL ON FUNCTION public.reject_owner_application(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_owner_application(uuid, uuid, text) TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════
-- activate_hotel — hotel member (owner completing onboarding) or platform admin.
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.activate_hotel(p_hotel_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_status public.hotel_billing_status;
    v_override boolean;
BEGIN
    -- Authorization: activation is performed by a member of the hotel (the owner
    -- completing onboarding) or a platform admin. Blocks anon / cross-tenant.
    IF NOT (public.vaiyu_is_hotel_member(p_hotel_id) OR public.is_platform_admin()) THEN
        RAISE EXCEPTION 'Not authorized to activate this hotel'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

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
$function$;

REVOKE ALL ON FUNCTION public.activate_hotel(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.activate_hotel(uuid) TO authenticated, service_role;
