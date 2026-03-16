-- ==============================================================================
-- MIGRATION: 20260317_harden_identity_linking.sql
-- DESCRIPTION: Final Production-Grade Identity Linking.
-- 1. Performance: Composite + Partial indices for deterministic resolution.
-- 2. Optimization: Efficient single-pass metadata extraction.
-- 3. Observability: RAISE LOG for non-blocking identity collisions.
-- 4. Security: Strict verified-only linking (Protects PII).
-- 5. Correctness: Email > Phone priority with oldest-record tie-breaking.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. PERFORMANCE & INTEGRITY LAYER
-- ------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_guests_email_created 
ON public.guests (email_normalized, created_at);

CREATE INDEX IF NOT EXISTS idx_guests_mobile_created 
ON public.guests (mobile_normalized, created_at);

CREATE INDEX IF NOT EXISTS idx_guests_email_not_null
ON public.guests (email_normalized, created_at)
WHERE email_normalized IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_guests_mobile_not_null
ON public.guests (mobile_normalized, created_at)
WHERE mobile_normalized IS NOT NULL;

-- ------------------------------------------------------------------------------
-- 2. PRODUCTION LINKING RPC
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.link_auth_user_to_guest()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
 v_guest_id UUID;
 v_email text;
 v_phone text;
 v_full_name text;
 v_email_verified boolean;
 v_phone_verified boolean;
 v_existing_user_id UUID;
BEGIN
 -- 1. Authentication Guard
 IF auth.uid() IS NULL THEN
  RAISE EXCEPTION 'Unauthorized';
 END IF;

 -- 2. Short-circuit if ALREADY linked
 SELECT guest_id INTO v_guest_id
 FROM public.guest_user_map
 WHERE user_id = auth.uid();

 IF FOUND THEN
  RETURN v_guest_id;
 END IF;

 -- 3. Single-pass Identity Extraction (Efficient)
 SELECT 
   lower(trim(email)),
   regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g'),
   (email_confirmed_at IS NOT NULL),
   (phone_confirmed_at IS NOT NULL)
 INTO v_email, v_phone, v_email_verified, v_phone_verified
 FROM auth.users
 WHERE id = auth.uid();

 -- Extract display metadata once
 v_full_name := COALESCE(auth.jwt() ->> 'full_name', 'Guest');

 -- 4. Identity Resolution (Deterministic matching, oldest record wins)
 
 -- Priority 1: Verified Email
 IF v_email IS NOT NULL AND v_email != '' AND v_email_verified THEN
  SELECT id INTO v_guest_id 
  FROM public.guests 
  WHERE email_normalized = v_email 
  ORDER BY created_at ASC 
  LIMIT 1;
 END IF;

 -- Priority 2: Verified Phone (Smart Normalization)
 IF v_guest_id IS NULL AND v_phone IS NOT NULL AND v_phone != '' AND v_phone_verified THEN
  -- A: Exact match
  SELECT id INTO v_guest_id FROM public.guests WHERE mobile_normalized = v_phone ORDER BY created_at ASC LIMIT 1;
  
  -- B: Try strip 91
  IF v_guest_id IS NULL AND v_phone LIKE '91%' AND length(v_phone) > 10 THEN
    SELECT id INTO v_guest_id FROM public.guests WHERE mobile_normalized = substring(v_phone from 3) ORDER BY created_at ASC LIMIT 1;
  END IF;

  -- C: Try add 91
  IF v_guest_id IS NULL AND length(v_phone) = 10 THEN
    SELECT id INTO v_guest_id FROM public.guests WHERE mobile_normalized = '91' || v_phone ORDER BY created_at ASC LIMIT 1;
  END IF;
 END IF;

 -- 5. Conditional Guest Creation (Prevents data pollution)
 -- We only link if we can anchor to a verified identity.
 IF v_guest_id IS NULL THEN
  IF v_email_verified AND v_email IS NOT NULL AND v_email != '' THEN
    INSERT INTO public.guests (full_name, email, email_normalized, created_at, updated_at)
    VALUES (v_full_name, v_email, v_email, now(), now())
    ON CONFLICT ON CONSTRAINT uq_global_guest_email DO UPDATE SET updated_at = now()
    RETURNING id INTO v_guest_id;
  ELSIF v_phone_verified AND v_phone IS NOT NULL AND v_phone != '' THEN
    INSERT INTO public.guests (full_name, mobile, mobile_normalized, created_at, updated_at)
    VALUES (v_full_name, v_phone, v_phone, now(), now())
    ON CONFLICT (mobile_normalized) WHERE mobile_normalized IS NOT NULL AND mobile_normalized != ''
    DO UPDATE SET updated_at = now()
    RETURNING id INTO v_guest_id;
  ELSE
    -- Reaching here means user is authenticated but has no verified identifier.
    -- Abort to prevent anonymous/unidentified guest list pollution.
    RETURN NULL;
  END IF;
 END IF;

 -- 6. Secure & Observable Mapping Injection
 IF v_guest_id IS NOT NULL THEN
  -- Collision Check: Is this guest already claimed by a DIFFERENT user?
  SELECT user_id INTO v_existing_user_id FROM public.guest_user_map WHERE guest_id = v_guest_id;

  IF FOUND AND v_existing_user_id != auth.uid() THEN
    -- Identity protection: Do not overwrite or swap mappings.
    RAISE LOG 'Identity collision: guest %, existing user %, attempted user %',
      v_guest_id, v_existing_user_id, auth.uid();
    RETURN v_guest_id; 
  END IF;

  -- Insert/Idempotent link
  INSERT INTO public.guest_user_map (user_id, guest_id)
  VALUES (auth.uid(), v_guest_id)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN v_guest_id;
 END IF;

 RETURN NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.link_auth_user_to_guest() TO authenticated;

-- Final database guardrail
ALTER TABLE public.guest_user_map DROP CONSTRAINT IF EXISTS uq_guest_user_map_user;
ALTER TABLE public.guest_user_map ADD CONSTRAINT uq_guest_user_map_user UNIQUE (user_id);

CREATE INDEX IF NOT EXISTS idx_guest_user_map_user 
ON public.guest_user_map (user_id);

CREATE INDEX IF NOT EXISTS idx_guest_user_map_guest 
ON public.guest_user_map (guest_id);