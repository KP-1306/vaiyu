-- Auth sweep residual lockdown (2026-06-14) — clean baseline before the CI ratchet.
--
-- Re-running the sweep query after batches 1–4 + the PII/chat fixes left 14
-- anon-callable mutating SECURITY DEFINER functions with no auth-helper. Caller
-- analysis (frontend + edge + cron + internal DB) classified them:
--   • 5 public-by-design (allowlisted in the CI ratchet): create_lead_public,
--     record_package_view, submit_precheckin, submit_public_feedback,
--     validate_precheckin_token.
--   • 8 cron / worker / internal-trigger → service_role only (below).
--   • 1 authenticated staff action with no guard → add a real guard
--     (upsert_department_sla).
--
-- Notably this caught auto_checkout_overdue_stays, which was MISSED in batch 4 —
-- it is the pg_cron force-checkout job (anon could have triggered it).

-- ── cron / worker / internal-trigger helpers → service_role only ───────────
-- auto_checkout_overdue_stays ← pg_cron (postgres owner; unaffected)
-- cleanup_guest_documents, replay_missed_snapshots ← maintenance (no live caller)
-- defer_notification_one_hour/_to_tomorrow ← send-notifications edge (service_role)
-- link_hotel_brand_to_asset_requirement ← trigger _trg_sync_hotel_brand_to_assets
-- queue_extension_notification ← approve_stay_extension / reject_stay_extension
-- seed_hotel_review_categories ← trigger trg_seed_categories_on_hotel_creation
REVOKE ALL ON FUNCTION public.auto_checkout_overdue_stays(p_grace_hours integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_checkout_overdue_stays(p_grace_hours integer) TO service_role;

REVOKE ALL ON FUNCTION public.cleanup_guest_documents(p_retention_days integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_guest_documents(p_retention_days integer) TO service_role;

REVOKE ALL ON FUNCTION public.defer_notification_one_hour(p_id uuid, p_reason text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.defer_notification_one_hour(p_id uuid, p_reason text) TO service_role;

REVOKE ALL ON FUNCTION public.defer_notification_to_tomorrow(p_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.defer_notification_to_tomorrow(p_id uuid) TO service_role;

REVOKE ALL ON FUNCTION public.link_hotel_brand_to_asset_requirement(p_hotel_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.link_hotel_brand_to_asset_requirement(p_hotel_id uuid) TO service_role;

REVOKE ALL ON FUNCTION public.queue_extension_notification(p_booking_id uuid, p_template_code text, p_payload jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.queue_extension_notification(p_booking_id uuid, p_template_code text, p_payload jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.replay_missed_snapshots(p_hotel_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replay_missed_snapshots(p_hotel_id uuid) TO service_role;

REVOKE ALL ON FUNCTION public.seed_hotel_review_categories(p_hotel_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_hotel_review_categories(p_hotel_id uuid) TO service_role;

-- ── upsert_department_sla: authenticated staff of the department's hotel ────
-- Called from OwnerServices (SLA config). Was anon-callable with no guard → anon
-- could rewrite any department's SLA policies. Authorize against the department's
-- hotel; body otherwise unchanged from the audited live definition.
CREATE OR REPLACE FUNCTION public.upsert_department_sla(p_department_id uuid, p_target_minutes integer, p_warn_minutes integer, p_escalate_minutes integer, p_sla_start_trigger text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_existing_sla_id UUID;
  v_new_sla_id UUID;
  v_hotel_id UUID;
BEGIN
  -- Authorization: SLA config is a staff action scoped to the department's hotel.
  SELECT hotel_id INTO v_hotel_id FROM public.departments WHERE id = p_department_id;
  IF v_hotel_id IS NULL THEN
    RAISE EXCEPTION 'Department not found';
  END IF;
  IF NOT (public.vaiyu_is_hotel_member(v_hotel_id) OR public.is_platform_admin()) THEN
    RAISE EXCEPTION 'Not authorized to configure SLAs for this department'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ============================================================
  -- Step 1: Check if current active SLA has identical values
  -- If so, return existing ID (no-op prevention)
  -- ============================================================
  SELECT id INTO v_existing_sla_id
  FROM sla_policies
  WHERE department_id = p_department_id
    AND valid_to IS NULL
    AND is_active = true
    AND target_minutes = p_target_minutes
    AND warn_minutes = p_warn_minutes
    AND escalate_minutes = p_escalate_minutes
    AND sla_start_trigger = p_sla_start_trigger;

  IF v_existing_sla_id IS NOT NULL THEN
    RETURN v_existing_sla_id;
  END IF;

  -- ============================================================
  -- Step 2: Mark existing active SLA as inactive (if exists)
  -- ============================================================
  UPDATE sla_policies
  SET
    valid_to = now(),
    is_active = false,
    updated_at = now()
  WHERE department_id = p_department_id
    AND valid_to IS NULL
    AND is_active = true;

  -- ============================================================
  -- Step 3: Insert new SLA policy
  -- ============================================================
  INSERT INTO sla_policies (
    department_id,
    target_minutes,
    warn_minutes,
    escalate_minutes,
    sla_start_trigger,
    valid_from,
    valid_to,
    is_active,
    created_at,
    updated_at
  )
  VALUES (
    p_department_id,
    p_target_minutes,
    p_warn_minutes,
    p_escalate_minutes,
    p_sla_start_trigger,
    now(),
    NULL,
    true,
    now(),
    now()
  )
  RETURNING id INTO v_new_sla_id;

  RETURN v_new_sla_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.upsert_department_sla(uuid, integer, integer, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_department_sla(uuid, integer, integer, integer, text) TO authenticated, service_role;
