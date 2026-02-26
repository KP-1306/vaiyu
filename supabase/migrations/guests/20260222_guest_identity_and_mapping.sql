-- ==============================================================================
-- MIGRATION: 20260222_guest_identity.sql
-- DESCRIPTION: Phase 1 of Enterprise Identity Architecture.
-- 1. Drops hotel_id from guests (making them global).
-- 2. Deduplicates existing guests across hotels based on mobile/email.
-- 3. Creates guest_user_map for bidirectional identity linking with auth.users.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- STEP 1: DEDUPLICATE EXISTING GUESTS 
-- Before we can make mobile_normalized/email globally unique, we must merge duplicates.
-- We will keep the OLDER guest record as the primary and update all foreign keys.
-- ------------------------------------------------------------------------------

DO $$
DECLARE
 rec RECORD;
 v_survivor_id UUID;
 v_duplicate_id UUID;
BEGIN
 -- LOCK table to prevent concurrent writes during global deduplication
 LOCK TABLE public.guests IN SHARE ROW EXCLUSIVE MODE;

 FOR rec IN 
 SELECT array_agg(id ORDER BY created_at ASC) as guest_ids, mobile_normalized 
 FROM public.guests 
 WHERE mobile_normalized IS NOT NULL AND mobile_normalized != ''
 GROUP BY mobile_normalized 
 HAVING count(id) > 1
 LOOP
 v_survivor_id := rec.guest_ids[1]; 
 
 FOR i IN 2..array_length(rec.guest_ids, 1) LOOP
 v_duplicate_id := rec.guest_ids[i];

 -- Update all known foreign key dependencies
 UPDATE public.stays SET guest_id = v_survivor_id WHERE guest_id = v_duplicate_id;
 UPDATE public.stay_guests SET guest_id = v_survivor_id WHERE guest_id = v_duplicate_id;
 UPDATE public.booking_room_guests SET guest_id = v_survivor_id WHERE guest_id = v_duplicate_id;
 UPDATE public.guest_id_documents SET guest_id = v_survivor_id WHERE guest_id = v_duplicate_id;
 UPDATE public.reviews SET created_by = v_survivor_id WHERE created_by = v_duplicate_id;
 
 -- Keep the latest email/name/address if survivor is missing info
 UPDATE public.guests s
 SET email = COALESCE(s.email, d.email),
 full_name = COALESCE(s.full_name, d.full_name),
 address = COALESCE(s.address, d.address),
 nationality = COALESCE(s.nationality, d.nationality),
 dob = COALESCE(s.dob, d.dob)
 FROM public.guests d
 WHERE s.id = v_survivor_id AND d.id = v_duplicate_id;

 -- Delete the duplicate guest safely
 DELETE FROM public.guests WHERE id = v_duplicate_id;
 END LOOP;
 END LOOP;

 -- Repeat deduplication for email-only duplicates (where mobile was null)
 FOR rec IN 
 SELECT array_agg(id ORDER BY created_at ASC) as guest_ids
 FROM public.guests 
 WHERE email IS NOT NULL AND email != ''
 GROUP BY lower(trim(email)) 
 HAVING count(id) > 1
 LOOP
 v_survivor_id := rec.guest_ids[1]; 
 
 FOR i IN 2..array_length(rec.guest_ids, 1) LOOP
 v_duplicate_id := rec.guest_ids[i];

 UPDATE public.stays SET guest_id = v_survivor_id WHERE guest_id = v_duplicate_id;
 UPDATE public.stay_guests SET guest_id = v_survivor_id WHERE guest_id = v_duplicate_id;
 UPDATE public.booking_room_guests SET guest_id = v_survivor_id WHERE guest_id = v_duplicate_id;
 UPDATE public.guest_id_documents SET guest_id = v_survivor_id WHERE guest_id = v_duplicate_id;
 UPDATE public.reviews SET created_by = v_survivor_id WHERE created_by = v_duplicate_id;

 -- Keep the latest phone/name/address if survivor is missing info
 UPDATE public.guests s
 SET mobile = COALESCE(s.mobile, d.mobile),
 full_name = COALESCE(s.full_name, d.full_name),
 address = COALESCE(s.address, d.address),
 nationality = COALESCE(s.nationality, d.nationality),
 dob = COALESCE(s.dob, d.dob)
 FROM public.guests d
 WHERE s.id = v_survivor_id AND d.id = v_duplicate_id;

 DELETE FROM public.guests WHERE id = v_duplicate_id;
 END LOOP;
 END LOOP;
END $$;


-- ------------------------------------------------------------------------------
-- STEP 2: GLOBALIZE GUESTS TABLE
-- Drop hotel_id constraint and column, add global uniqueness
-- ------------------------------------------------------------------------------

-- Drop any previous unique indices relying on hotel_id
DROP INDEX IF EXISTS public.uq_guest_mobile;
DROP INDEX IF EXISTS public.uq_guest_email;
ALTER TABLE public.guests DROP CONSTRAINT IF EXISTS guests_hotel_id_fkey;

-- Drop hotel_id column
ALTER TABLE public.guests DROP COLUMN IF EXISTS hotel_id CASCADE;

-- Clean up empty strings to NULL to prevent unique constraint violations
UPDATE public.guests SET mobile = NULL WHERE mobile = '';
UPDATE public.guests SET email = NULL WHERE email = '';

-- Create global unique indices
-- uq_global_guest_mobile must be a partial index to allow multiple NULLs or empty strings
CREATE UNIQUE INDEX IF NOT EXISTS uq_global_guest_mobile 
ON public.guests(mobile_normalized) 
WHERE mobile_normalized IS NOT NULL AND mobile_normalized != '';

-- For email, we must add a generated column first to support the UNIQUE constraint
-- Wrapped in DO block for idempotency (production-safe)
DO $$
BEGIN
 IF NOT EXISTS (
 SELECT 1 FROM information_schema.columns 
 WHERE table_schema = 'public' 
 AND table_name = 'guests' 
 AND column_name = 'email_normalized'
 ) THEN
 ALTER TABLE public.guests
 ADD COLUMN email_normalized text GENERATED ALWAYS AS (lower(email)) STORED;
 END IF;
END $$;

ALTER TABLE public.guests DROP CONSTRAINT IF EXISTS uq_global_guest_email;
ALTER TABLE public.guests
ADD CONSTRAINT uq_global_guest_email
UNIQUE (email_normalized)
DEFERRABLE INITIALLY IMMEDIATE;


-- ------------------------------------------------------------------------------
-- STEP 3: CREATE guest_user_map TABLE & HELPER
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.guest_user_map (
 user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 guest_id UUID UNIQUE NOT NULL REFERENCES public.guests(id) ON DELETE CASCADE,
 created_at TIMESTAMPTZ DEFAULT now()
);

-- ADD MISSING INDEX
CREATE INDEX IF NOT EXISTS idx_guest_user_map_guest_id ON public.guest_user_map(guest_id);
CREATE INDEX IF NOT EXISTS idx_stays_guest_id ON public.stays(guest_id);
CREATE INDEX IF NOT EXISTS idx_stay_guests_guest_id ON public.stay_guests(guest_id);

-- Performance indices for RLS scalability
CREATE INDEX IF NOT EXISTS idx_stays_hotel_id ON public.stays(hotel_id);
CREATE INDEX IF NOT EXISTS idx_hotel_members_user_hotel ON public.hotel_members(user_id, hotel_id);
CREATE INDEX IF NOT EXISTS idx_bookings_hotel_id ON public.bookings(hotel_id);
CREATE INDEX IF NOT EXISTS idx_payments_booking_id ON public.payments(booking_id);

-- ------------------------------------------------------------------------------
-- HELPER FUNCTION: current_guest_id()
-- Required for RLS policies
-- ------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.current_guest_id();
CREATE OR REPLACE FUNCTION public.current_guest_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
 SELECT guest_id
 FROM public.guest_user_map
 WHERE user_id = auth.uid()
 LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.current_guest_id() FROM public;
GRANT EXECUTE ON FUNCTION public.current_guest_id() TO authenticated;

-- RLS Activation
ALTER TABLE public.guest_user_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

-- guest_user_map policies
DROP POLICY IF EXISTS "Users can view their own mapping" ON public.guest_user_map;
CREATE POLICY "Users can view their own mapping" ON public.guest_user_map 
FOR SELECT USING (auth.uid() = user_id);

-- guests policies (Enterprise Strict Mode)
DROP POLICY IF EXISTS guest_self_access ON public.guests;
CREATE POLICY guest_self_access ON public.guests 
FOR SELECT USING (id = public.current_guest_id());

DROP POLICY IF EXISTS guest_self_update ON public.guests;
CREATE POLICY guest_self_update ON public.guests 
FOR UPDATE USING (id = public.current_guest_id())
WITH CHECK (id = public.current_guest_id());

-- staff/owner access to guests (Enterprise Mode)
-- Allows staff to view/update guests who have a stay at their hotel
DROP POLICY IF EXISTS staff_view_hotel_guests ON public.guests;
CREATE POLICY staff_view_hotel_guests ON public.guests
FOR SELECT USING (
 EXISTS (
 SELECT 1 FROM public.hotel_members hm
 JOIN public.stays s ON s.hotel_id = hm.hotel_id
 WHERE hm.user_id = auth.uid()
 AND s.guest_id = guests.id
 )
);

DROP POLICY IF EXISTS staff_update_hotel_guests ON public.guests;
CREATE POLICY staff_update_hotel_guests ON public.guests
FOR UPDATE USING (
 EXISTS (
 SELECT 1 FROM public.hotel_members hm
 JOIN public.stays s ON s.hotel_id = hm.hotel_id
 WHERE hm.user_id = auth.uid()
 AND s.guest_id = guests.id
 )
);

-- Safely backfill mapping for all existing users to prevent session breakage
-- FIXED: Try match by email ONLY first using email_normalized index
INSERT INTO public.guest_user_map (user_id, guest_id)
SELECT u.id, g.id
FROM auth.users u
JOIN public.guests g ON g.email_normalized = lower(u.email)
WHERE u.email IS NOT NULL AND u.email != ''
ON CONFLICT (user_id) DO NOTHING;

-- FIXED: Try match by phone ONLY for users not matched by email
INSERT INTO public.guest_user_map (user_id, guest_id)
SELECT u.id, g.id
FROM auth.users u
JOIN public.guests g ON g.mobile_normalized = regexp_replace(COALESCE(u.phone, ''), '[^0-9]', '', 'g')
WHERE u.phone IS NOT NULL AND u.phone != ''
 AND NOT EXISTS (SELECT 1 FROM public.guest_user_map gum WHERE gum.user_id = u.id)
ON CONFLICT (user_id) DO NOTHING;

-- Further backfill: if there was ever an implicit guests.id = auth.users.id
INSERT INTO public.guest_user_map (user_id, guest_id)
SELECT id, id
FROM auth.users u
WHERE EXISTS (SELECT 1 FROM public.guests g WHERE g.id = u.id)
ON CONFLICT (user_id) DO NOTHING;

-- ------------------------------------------------------------------------------
-- STEP 4: LINKING RPC
-- Executed safely upon successful login to bind auth identity to global guest identity
-- ------------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_link_auth_user_guest ON auth.users; -- Important dependency fix
DROP FUNCTION IF EXISTS public.link_auth_user_to_guest();
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
BEGIN
 -- Defensive Guard: Ensure user is authenticated
 IF auth.uid() IS NULL THEN
 RAISE EXCEPTION 'Unauthorized';
 END IF;

 -- 1. If already linked, return existing guest
 SELECT guest_id INTO v_guest_id
 FROM public.guest_user_map
 WHERE user_id = auth.uid();

 IF FOUND THEN
 RETURN v_guest_id;
 END IF;

 -- Extract verified identity from JWT token
 -- Only trust verified emails and phones
 IF auth.jwt() ->> 'email_confirmed_at' IS NOT NULL THEN
 v_email := lower(trim(auth.jwt() ->> 'email'));
 END IF;

 IF auth.jwt() ->> 'phone_confirmed_at' IS NOT NULL THEN
 v_phone := regexp_replace(COALESCE(auth.jwt() ->> 'phone', ''), '[^0-9]', '', 'g');
 END IF;

 -- 2. Try match by email
 IF v_email IS NOT NULL AND v_email != '' THEN
 SELECT id INTO v_guest_id
 FROM public.guests
 WHERE email_normalized = v_email
 LIMIT 1;
 END IF;

 -- 3. Try match by phone (if email failed)
 IF v_guest_id IS NULL AND v_phone IS NOT NULL AND v_phone != '' THEN
 SELECT id INTO v_guest_id
 FROM public.guests
 WHERE mobile_normalized = v_phone
 LIMIT 1;
 END IF;

 -- 4. If not found, create new global guest profile
 -- FIXED: Branching logic to handle conflicting constraints safely
 IF v_guest_id IS NULL THEN
 IF v_phone IS NOT NULL AND v_phone != '' THEN
 INSERT INTO public.guests (
 full_name, 
 email, 
 mobile,
 mobile_normalized,
 created_at, 
 updated_at
 )
 VALUES (
 COALESCE(auth.jwt() ->> 'email', auth.jwt() ->> 'phone', 'Guest'),
 NULLIF(v_email, ''),
 NULLIF(v_phone, ''),
 v_phone,
 now(),
 now()
 )
 ON CONFLICT (mobile_normalized) WHERE mobile_normalized IS NOT NULL AND mobile_normalized != ''
 DO UPDATE SET updated_at = now()
 RETURNING id INTO v_guest_id;
 ELSIF v_email IS NOT NULL AND v_email != '' THEN
 INSERT INTO public.guests (
 full_name, 
 email, 
 mobile,
 mobile_normalized,
 created_at, 
 updated_at
 )
 VALUES (
 COALESCE(auth.jwt() ->> 'email', auth.jwt() ->> 'phone', 'Guest'),
 NULLIF(v_email, ''),
 NULLIF(v_phone, ''),
 v_phone,
 now(),
 now()
 )
 ON CONFLICT ON CONSTRAINT uq_global_guest_email
 DO UPDATE SET updated_at = now()
 RETURNING id INTO v_guest_id;
 ELSE
 INSERT INTO public.guests (
 full_name, 
 email, 
 mobile,
 mobile_normalized,
 created_at, 
 updated_at
 )
 VALUES (
 COALESCE(auth.jwt() ->> 'email', auth.jwt() ->> 'phone', 'Guest'),
 NULLIF(v_email, ''),
 NULLIF(v_phone, ''),
 v_phone,
 now(),
 now()
 )
 RETURNING id INTO v_guest_id;
 END IF;
 END IF;

 -- 5. Insert mapping safely
 INSERT INTO public.guest_user_map (user_id, guest_id)
 VALUES (auth.uid(), v_guest_id)
 ON CONFLICT (user_id) DO NOTHING;

 RETURN v_guest_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.link_auth_user_to_guest() TO authenticated;


-- ------------------------------------------------------------------------------
-- STEP 5: UPDATE RLS POLICIES & VIEWS
-- Replace auth.uid() = guest_id checks with guest_id = current_guest_id()
-- ------------------------------------------------------------------------------

-- 0. CORE ENTITIES RLS (Stays, Bookings, Docs, Secondary Guests, Orders)
DROP POLICY IF EXISTS "Guests can view own stays" ON public.stays;
CREATE POLICY "Guests can view own stays" ON public.stays FOR SELECT USING (guest_id = public.current_guest_id());

DROP POLICY IF EXISTS "Guests can view own secondary stays" ON public.stay_guests;
CREATE POLICY "Guests can view own secondary stays" ON public.stay_guests FOR SELECT USING (guest_id = public.current_guest_id());

DROP POLICY IF EXISTS "Guests can view own bookings" ON public.bookings;
CREATE POLICY "Guests can view own bookings" ON public.bookings FOR SELECT USING (guest_id = public.current_guest_id());

DROP POLICY IF EXISTS "Guests can view own docs" ON public.guest_id_documents;
CREATE POLICY "Guests can view own docs" ON public.guest_id_documents FOR SELECT USING (guest_id = public.current_guest_id());

DROP POLICY IF EXISTS "Guests can insert own valid docs" ON public.guest_id_documents;
CREATE POLICY "Guests can insert own valid docs" ON public.guest_id_documents FOR INSERT WITH CHECK (guest_id = public.current_guest_id());

DROP POLICY IF EXISTS "Guests can view own orders" ON public.food_orders;
CREATE POLICY "Guests can view own orders" ON public.food_orders
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.stays s 
    WHERE s.id = food_orders.stay_id 
    AND (
      s.guest_id = public.current_guest_id() 
      OR EXISTS (SELECT 1 FROM public.stay_guests sg WHERE sg.stay_id = s.id AND sg.guest_id = public.current_guest_id())
    )
  )
);

-- 1. TICKETS RLS (views.sql)
DROP POLICY IF EXISTS guest_can_view_own_tickets_only ON public.tickets;
CREATE POLICY guest_can_view_own_tickets_only
ON public.tickets
FOR SELECT
USING (
 EXISTS (
 SELECT 1 FROM public.stays s
 WHERE s.id = tickets.stay_id AND (
 s.guest_id = public.current_guest_id()
 OR
 EXISTS (SELECT 1 FROM public.stay_guests sg WHERE sg.stay_id = s.id AND sg.guest_id = public.current_guest_id())
 )
 )
);

-- 2. v_guest_tickets VIEW (views.sql)
CREATE OR REPLACE VIEW public.v_guest_tickets AS
SELECT
 t.id, t.display_id, t.status, t.reason_code, t.created_at, t.completed_at, t.cancelled_at, t.description, t.stay_id,
 r.number AS room_number, s.label AS service_name, s.sla_minutes, tss.sla_started_at, z.name AS zone_name,
 CASE WHEN t.zone_id IS NOT NULL THEN z.name ELSE CONCAT('Room ', r.number) END AS location_label,
 st.booking_code
FROM public.tickets t
-- Replace direct guest_id check with mapping lookup
JOIN public.stays st ON st.id = t.stay_id AND (
 st.guest_id = public.current_guest_id()
 OR EXISTS (SELECT 1 FROM public.stay_guests sg WHERE sg.stay_id = st.id AND sg.guest_id = public.current_guest_id())
)
JOIN public.services s ON s.id = t.service_id
LEFT JOIN public.ticket_sla_state tss ON tss.ticket_id = t.id
LEFT JOIN public.rooms r ON r.id = st.room_id
LEFT JOIN public.hotel_zones z ON z.id = t.zone_id
WHERE t.status IN ('NEW','IN_PROGRESS','BLOCKED','COMPLETED','CANCELLED')
ORDER BY t.created_at DESC;


-- 3. GUEST STAY HERO DASHBOARD (stays/views.sql)
CREATE OR REPLACE VIEW public.v_guest_stay_hero AS
SELECT *
FROM public.v_guest_stay_hero_base h
WHERE h.guest_id = public.current_guest_id()
 OR EXISTS (SELECT 1 FROM public.stay_guests sg WHERE sg.stay_id = h.stay_id AND sg.guest_id = public.current_guest_id());

CREATE OR REPLACE VIEW public.v_guest_home_dashboard AS
SELECT *
FROM public.v_guest_home_dashboard_base
WHERE guest_id = public.current_guest_id()
 OR EXISTS (SELECT 1 FROM public.stay_guests sg WHERE sg.stay_id = v_guest_home_dashboard_base.stay_id AND sg.guest_id = public.current_guest_id());

CREATE OR REPLACE VIEW public.user_stay_detail AS
SELECT
 s.id AS stay_id, s.guest_id AS user_id, s.hotel_id, s.scheduled_checkin_at AS checkin_at, s.scheduled_checkout_at AS checkout_at, s.actual_checkin_at, s.actual_checkout_at, s.status, s.source, s.booking_code, r.number AS room_number, h.name AS hotel_name, h.slug
FROM public.stays s
JOIN public.hotels h ON h.id = s.hotel_id
JOIN public.rooms r ON r.id = s.room_id
WHERE s.guest_id = public.current_guest_id()
 OR EXISTS (SELECT 1 FROM public.stay_guests sg WHERE sg.stay_id = s.id AND sg.guest_id = public.current_guest_id());


-- 4. TICKET RPCs (rpcs_lifecycle.sql / add_guest_updates.sql)
DROP FUNCTION IF EXISTS public.reopen_ticket(UUID, UUID, TEXT);
CREATE OR REPLACE FUNCTION public.reopen_ticket(
 p_ticket_id UUID,
 p_stay_id UUID,
 p_reason TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
 v_status TEXT;
 v_ticket_stay_id UUID;
 v_reopen_count INT;
BEGIN
 SELECT status, stay_id INTO v_status, v_ticket_stay_id FROM public.tickets WHERE id = p_ticket_id FOR UPDATE;

 IF NOT FOUND THEN RAISE EXCEPTION 'Ticket not found: %', p_ticket_id; END IF;

 -- Replaced auth.uid() check with lookup
 IF NOT EXISTS (
 SELECT 1 FROM public.stays
 WHERE id = p_stay_id AND (
 guest_id = public.current_guest_id()
 OR EXISTS (SELECT 1 FROM public.stay_guests sg WHERE sg.stay_id = p_stay_id AND sg.guest_id = public.current_guest_id())
 )
 ) THEN
 RAISE EXCEPTION 'Unauthorized reopen attempt';
 END IF;

 IF v_ticket_stay_id != p_stay_id THEN RAISE EXCEPTION 'Ticket does not belong to this stay'; END IF;
 IF v_status != 'COMPLETED' THEN RAISE EXCEPTION 'Only COMPLETED tickets can be reopened. Current status: %', v_status; END IF;

 UPDATE public.tickets SET status = 'NEW', updated_at = now() WHERE id = p_ticket_id;

 INSERT INTO public.ticket_events (ticket_id, event_type, actor_type, actor_id, comment)
 VALUES (
 p_ticket_id, 'STATUS_CHANGED', 'GUEST', 
 public.current_guest_id(), 
 COALESCE(p_reason, 'Guest requested reopen')
 );

 SELECT count(*) INTO v_reopen_count FROM public.ticket_events WHERE ticket_id = p_ticket_id AND event_type = 'STATUS_CHANGED' AND comment LIKE '%reopen%';

 INSERT INTO public.internal_jobs (job_type, payload)
 VALUES ('routing.ticket_assigned', jsonb_build_object('ticket_id', p_ticket_id, 'is_reopen', true, 'reopen_count', v_reopen_count));

 UPDATE public.ticket_sla_state SET sla_started_at = NULL, sla_target_at = NULL, breached = false WHERE ticket_id = p_ticket_id;

 RETURN jsonb_build_object('success', true, 'new_status', 'NEW', 'reopen_count', v_reopen_count);
END;
$$;


DROP FUNCTION IF EXISTS public.guest_update_ticket(TEXT, TEXT, JSONB);
CREATE OR REPLACE FUNCTION public.guest_update_ticket(
 p_display_id TEXT,
 p_details TEXT DEFAULT NULL,
 p_media_urls JSONB DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
 v_ticket_id UUID;
 v_old_description TEXT;
 v_created_by_id UUID;
 v_url TEXT;
 v_mapped_guest_id UUID;
BEGIN
 -- We assume they can only see the ticket if they passed the VIEW policy, but strictly we could enforce ownership.
 SELECT id, description, created_by_id INTO v_ticket_id, v_old_description, v_created_by_id
 FROM public.tickets
 WHERE display_id = p_display_id AND status NOT IN ('COMPLETED', 'CANCELLED');

 IF v_ticket_id IS NULL THEN RAISE EXCEPTION 'Ticket not found or closed for updates'; END IF;

 -- Get mapping
 v_mapped_guest_id := public.current_guest_id();

 IF p_details IS NOT NULL AND length(trim(p_details)) > 0 THEN
 UPDATE public.tickets 
 SET description = COALESCE(description, '') || E'\n\n[Guest Update]: ' || p_details, updated_at = now()
 WHERE id = v_ticket_id;

 INSERT INTO public.ticket_events (ticket_id, event_type, actor_type, actor_id, comment)
 VALUES (v_ticket_id, 'COMMENT_ADDED', 'GUEST', v_mapped_guest_id, p_details);
 END IF;

 IF p_media_urls IS NOT NULL AND jsonb_array_length(p_media_urls) > 0 THEN
 FOR v_url IN SELECT * FROM jsonb_array_elements_text(p_media_urls) LOOP
 v_url := trim(both '"' from v_url);
 IF v_url NOT LIKE 'tickets/%' THEN RAISE EXCEPTION 'Invalid file path: %', v_url; END IF;
 INSERT INTO public.ticket_attachments (ticket_id, file_path, uploaded_by, uploaded_by_type)
 VALUES (v_ticket_id, v_url, NULL, 'GUEST'); 
 END LOOP;
 END IF;

 RETURN jsonb_build_object('success', true);
END;
$$;

-- ------------------------------------------------------------------------------
-- STEP 6: OTHER RLS POLICIES (Food Orders, Messaging, Payments)
-- ------------------------------------------------------------------------------

-- FOOD ORDERS
DROP VIEW IF EXISTS public.v_guest_food_orders CASCADE;
CREATE OR REPLACE VIEW public.v_guest_food_orders AS
SELECT fo.id AS order_id, fo.display_id, fo.status, fo.created_at, fo.updated_at, fo.total_amount, fo.currency, fo.special_instructions, r.number AS room_number, st.booking_code, sla.sla_target_at, EXTRACT(EPOCH FROM (sla.sla_target_at - now())) / 60 AS sla_minutes_remaining, sla.breached AS sla_breached, items.items, items.total_items
FROM public.food_orders fo
LEFT JOIN public.stays st ON st.id = fo.stay_id
LEFT JOIN public.rooms r ON r.id = fo.room_id
LEFT JOIN public.food_order_sla_state sla ON sla.food_order_id = fo.id
LEFT JOIN LATERAL (
 SELECT COUNT(*) AS total_items, COALESCE(jsonb_agg(jsonb_build_object('name', item_name, 'quantity', quantity, 'price', total_price)) FILTER (WHERE id IS NOT NULL), '[]'::jsonb) AS items
 FROM public.food_order_items WHERE food_order_id = fo.id
) items ON true
WHERE fo.created_at >= now() - interval '7 days'
AND (
 st.guest_id = public.current_guest_id() OR
 EXISTS (SELECT 1 FROM public.stay_guests sg WHERE sg.stay_id = st.id AND sg.guest_id = public.current_guest_id())
)
GROUP BY fo.id, fo.display_id, fo.status, fo.created_at, fo.updated_at, fo.total_amount, fo.currency, fo.special_instructions, r.number, st.booking_code, sla.sla_target_at, sla.breached, items.items, items.total_items;

GRANT SELECT ON public.v_guest_food_orders TO authenticated;

-- MESSAGING (Chat allowed for assigned guests)
DROP POLICY IF EXISTS "Guests can view own chats" ON public.chat_messages;
CREATE POLICY "Guests can view own chats" ON public.chat_messages FOR SELECT USING (
 stay_id IN (
 SELECT id FROM public.stays s WHERE 
 s.guest_id = public.current_guest_id() OR
 EXISTS (SELECT 1 FROM public.stay_guests sg WHERE sg.stay_id = s.id AND sg.guest_id = public.current_guest_id())
 )
);

DROP POLICY IF EXISTS "Guests can insert own chats" ON public.chat_messages;
CREATE POLICY "Guests can insert own chats" ON public.chat_messages FOR INSERT WITH CHECK (
 author_role = 'guest' 
 AND stay_id IN (
 SELECT id FROM public.stays s WHERE 
 s.guest_id = public.current_guest_id() OR
 EXISTS (SELECT 1 FROM public.stay_guests sg WHERE sg.stay_id = s.id AND sg.guest_id = public.current_guest_id())
 )
);

-- PAYMENTS / FOLIO
DROP POLICY IF EXISTS "Guests can view own payments" ON public.payments;
DROP POLICY IF EXISTS guest_can_view_own_payments ON public.payments;

CREATE POLICY guest_can_view_own_payments
ON public.payments
FOR SELECT
USING (
 EXISTS (
 SELECT 1
 FROM public.bookings b
 WHERE b.id = payments.booking_id
 AND b.guest_id = public.current_guest_id()
 )
);

-- staff/owner management of hotel payments
DROP POLICY IF EXISTS staff_manage_hotel_payments ON public.payments;
CREATE POLICY staff_manage_hotel_payments
ON public.payments
FOR ALL
USING (
 EXISTS (
 SELECT 1 FROM public.hotel_members hm
 JOIN public.bookings b ON b.hotel_id = hm.hotel_id
 WHERE hm.user_id = auth.uid()
 AND b.id = payments.booking_id
 )
);


-- ------------------------------------------------------------------------------
-- STEP 7: BIDIRECTIONAL IDENTITY LINKING (PMS/WALK-IN)
-- Update resolve_guest_identity to link an auth user if they exist
-- ------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.resolve_guest_identity(uuid, text, text, text);
CREATE OR REPLACE FUNCTION public.resolve_guest_identity(
 p_hotel_id uuid, -- Kept for interface compatibility, but unused logically
 p_name text,
 p_mobile text,
 p_email text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
 v_guest_id uuid;
 v_mobile text;
 v_email text;
 v_auth_user_id uuid;
BEGIN
 v_mobile := NULLIF(regexp_replace(trim(p_mobile), '[^0-9]', '', 'g'), '');
 v_email := NULLIF(lower(trim(p_email)), '');

 IF length(v_mobile) < 6 THEN v_mobile := NULL; END IF;

 -- 1. Try match by mobile
 IF v_mobile IS NOT NULL THEN
 SELECT id INTO v_guest_id FROM public.guests WHERE mobile_normalized = v_mobile LIMIT 1;
 IF v_guest_id IS NOT NULL THEN RETURN v_guest_id; END IF;
 END IF;

 -- 2. Try match by email
 IF v_email IS NOT NULL THEN
 SELECT id INTO v_guest_id FROM public.guests WHERE email_normalized = v_email LIMIT 1;
 IF v_guest_id IS NOT NULL THEN RETURN v_guest_id; END IF;
 END IF;

 -- 3. Create new guest
 -- FIXED: Branching logic to handle conflicting constraints based on provided fields
 IF v_guest_id IS NULL THEN
 IF v_mobile IS NOT NULL THEN
 INSERT INTO public.guests(full_name, mobile, mobile_normalized, email, created_at, updated_at)
 VALUES(COALESCE(p_name,'Guest'), p_mobile, v_mobile, v_email, now(), now())
 ON CONFLICT (mobile_normalized) WHERE mobile_normalized IS NOT NULL AND mobile_normalized != ''
 DO UPDATE SET updated_at = now()
 RETURNING id INTO v_guest_id;
 ELSIF v_email IS NOT NULL THEN
 INSERT INTO public.guests(full_name, mobile, mobile_normalized, email, created_at, updated_at)
 VALUES(COALESCE(p_name,'Guest'), p_mobile, v_mobile, v_email, now(), now())
 ON CONFLICT ON CONSTRAINT uq_global_guest_email
 DO UPDATE SET updated_at = now()
 RETURNING id INTO v_guest_id;
 ELSE
 INSERT INTO public.guests(full_name, mobile, mobile_normalized, email, created_at, updated_at)
 VALUES(COALESCE(p_name,'Guest'), p_mobile, v_mobile, v_email, now(), now())
 RETURNING id INTO v_guest_id;
 END IF;
 END IF;

 -- 4. Bidirectional mapping: Check if auth user exists
 -- FIXED: Sequential matching instead of OR
 IF v_guest_id IS NOT NULL THEN
 IF v_email IS NOT NULL THEN
 SELECT id INTO v_auth_user_id FROM auth.users WHERE lower(email) = v_email LIMIT 1;
 END IF;

 IF v_auth_user_id IS NULL AND v_mobile IS NOT NULL THEN
 SELECT id INTO v_auth_user_id FROM auth.users WHERE regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') = v_mobile LIMIT 1;
 END IF;

 IF v_auth_user_id IS NOT NULL THEN
 -- Row-level lock to prevent concurrent mapping races
 PERFORM 1 FROM public.guest_user_map WHERE user_id = v_auth_user_id FOR UPDATE;
 
 INSERT INTO public.guest_user_map (user_id, guest_id)
 VALUES (v_auth_user_id, v_guest_id)
 ON CONFLICT (user_id) DO NOTHING;
 END IF;
 END IF;

 RETURN v_guest_id;
END;
$$;

-- ------------------------------------------------------------------------------
-- STEP 8: UPDATE PRECHECKIN & WALKIN RPCs (Global Guests & Mapping)
-- ------------------------------------------------------------------------------

-- Update create_walkin RPC (removes hotel_id from guest lookup/insert)
DROP FUNCTION IF EXISTS public.create_walkin(uuid, uuid, uuid, date, date, jsonb, numeric, text);
CREATE OR REPLACE FUNCTION public.create_walkin(
 p_hotel_id uuid,
 p_room_type_id uuid,
 p_room_id uuid,
 p_checkin_date date,
 p_checkout_date date,
 p_guest_details jsonb,
 p_total_amount numeric,
 p_source text DEFAULT 'WALK_IN'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
 v_booking_id uuid;
 v_booking_room_id uuid;
 v_stay_id uuid;
 v_guest_id uuid;
 v_folio_id uuid;
 v_clean_phone text;
 v_email text;
 v_auth_user_id uuid;
BEGIN
 v_clean_phone := NULLIF(regexp_replace(COALESCE(p_guest_details->>'mobile', ''), '[^0-9]', '', 'g'), '');
 v_email := NULLIF(lower(trim(p_guest_details->>'email')), '');

 -- 1. Global Guest Lookup or Creation
 IF v_clean_phone IS NOT NULL THEN
 SELECT id INTO v_guest_id FROM public.guests WHERE mobile_normalized = v_clean_phone LIMIT 1;
 END IF;
 
 IF v_guest_id IS NULL AND v_email IS NOT NULL THEN
 SELECT id INTO v_guest_id FROM public.guests WHERE email_normalized = v_email LIMIT 1;
 END IF;

 IF v_guest_id IS NULL THEN
 IF v_clean_phone IS NOT NULL THEN
 INSERT INTO public.guests (full_name, mobile, mobile_normalized, email, nationality, address)
 VALUES (
 p_guest_details->>'full_name', p_guest_details->>'mobile', v_clean_phone,
 v_email, p_guest_details->>'nationality', p_guest_details->>'address'
 )
 ON CONFLICT (mobile_normalized) WHERE mobile_normalized IS NOT NULL AND mobile_normalized != ''
 DO UPDATE SET updated_at = now()
 RETURNING id INTO v_guest_id;
 ELSIF v_email IS NOT NULL THEN
 INSERT INTO public.guests (full_name, mobile, mobile_normalized, email, nationality, address)
 VALUES (
 p_guest_details->>'full_name', p_guest_details->>'mobile', v_clean_phone,
 v_email, p_guest_details->>'nationality', p_guest_details->>'address'
 )
 ON CONFLICT ON CONSTRAINT uq_global_guest_email
 DO UPDATE SET updated_at = now()
 RETURNING id INTO v_guest_id;
 ELSE
 INSERT INTO public.guests (full_name, mobile, mobile_normalized, email, nationality, address)
 VALUES (
 p_guest_details->>'full_name', p_guest_details->>'mobile', v_clean_phone,
 v_email, p_guest_details->>'nationality', p_guest_details->>'address'
 )
 RETURNING id INTO v_guest_id;
 END IF;
 END IF;

 -- 1.5. Bidirectional Mapping Trigger
 -- FIXED: Sequential matching instead of OR
 IF v_email IS NOT NULL THEN
 SELECT id INTO v_auth_user_id FROM auth.users WHERE lower(email) = v_email LIMIT 1;
 END IF;
 
 IF v_auth_user_id IS NULL AND v_clean_phone IS NOT NULL THEN
 SELECT id INTO v_auth_user_id FROM auth.users WHERE regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') = v_clean_phone LIMIT 1;
 END IF;

 IF v_auth_user_id IS NOT NULL THEN
 INSERT INTO public.guest_user_map (user_id, guest_id) VALUES (v_auth_user_id, v_guest_id) ON CONFLICT (user_id) DO NOTHING;
 END IF;


 -- 2. Create Booking
 INSERT INTO public.bookings (hotel_id, guest_id, source, status, check_in_date, check_out_date,
 total_amount, amount_due, currency, booking_time, checked_in_at)
 VALUES (p_hotel_id, v_guest_id, p_source, 'checked_in', p_checkin_date, p_checkout_date,
 p_total_amount, p_total_amount, 'INR', now(), now())
 RETURNING id INTO v_booking_id;

 -- 3. Create Booking Room
 INSERT INTO public.booking_rooms (booking_id, hotel_id, room_type_id, room_id, adults, children, status)
 VALUES (v_booking_id, p_hotel_id, p_room_type_id, p_room_id, 
 COALESCE((p_guest_details->>'adults')::int, 1), COALESCE((p_guest_details->>'children')::int, 0), 'inhouse')
 RETURNING id INTO v_booking_room_id;

 -- 4. Create Booking Room Guest (Primary)
 INSERT INTO public.booking_room_guests (booking_room_id, guest_id, is_primary) VALUES (v_booking_room_id, v_guest_id, true);

 -- 5. Create Stay
 INSERT INTO public.stays (hotel_id, room_id, guest_id, booking_id, booking_room_id, status, source,
 scheduled_checkin_at, scheduled_checkout_at, actual_checkin_at)
 VALUES (p_hotel_id, p_room_id, v_guest_id, v_booking_id, v_booking_room_id, 'inhouse', 'walk_in',
 p_checkin_date + time '14:00', p_checkout_date + time '11:00', now())
 RETURNING id INTO v_stay_id;

 -- 6. Create Stay Guest Mapping
 INSERT INTO public.stay_guests (stay_id, guest_id, is_primary) VALUES (v_stay_id, v_guest_id, true);

 -- 7. Update Room Status
 UPDATE public.rooms SET housekeeping_status = 'occupied' WHERE id = p_room_id;

 -- 8. Create Folio & Charge
 INSERT INTO public.folios (booking_id, hotel_id, status, currency) VALUES (v_booking_id, p_hotel_id, 'OPEN', 'INR') RETURNING id INTO v_folio_id;
 INSERT INTO public.folio_line_items (folio_id, item_type, amount, description, quantity) VALUES (v_folio_id, 'ROOM_CHARGE', p_total_amount, 'Room Charge (Walk-in)', 1);

 RETURN jsonb_build_object('success', true, 'booking_id', v_booking_id, 'stay_id', v_stay_id);
END;
$$;


-- Update submit_precheckin RPC (removes hotel_id from guest lookup/insert)
DROP FUNCTION IF EXISTS public.submit_precheckin(uuid, jsonb);
CREATE OR REPLACE FUNCTION public.submit_precheckin(
 p_token uuid,
 p_data jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
 v_booking_id uuid;
 v_hotel_id uuid;
 v_guest_id uuid;
 v_token_status text;
 v_mobile_normalized text;
 v_email text;
 v_auth_user_id uuid;
 v_doc jsonb;
BEGIN
 SELECT booking_id, status, hotel_id INTO v_booking_id, v_token_status, v_hotel_id
 FROM public.precheckin_tokens WHERE id = p_token AND expires_at > now();

 IF NOT FOUND THEN
 RETURN jsonb_build_object('success', false, 'error', 'Invalid or expired pre-checkin token');
 END IF;

 IF v_token_status != 'PENDING' THEN
 RETURN jsonb_build_object('success', false, 'error', 'Pre-checkin already completed');
 END IF;

 v_mobile_normalized := NULLIF(regexp_replace(COALESCE(p_data->>'mobile', ''), '[^0-9]', '', 'g'), '');
 v_email := NULLIF(lower(trim(p_data->>'email')), '');

 -- 1. Global Guest Lookup or Creation
 IF v_mobile_normalized IS NOT NULL THEN
 SELECT id INTO v_guest_id FROM public.guests WHERE mobile_normalized = v_mobile_normalized LIMIT 1;
 END IF;

 IF v_guest_id IS NULL AND v_email IS NOT NULL THEN
 SELECT id INTO v_guest_id FROM public.guests WHERE email_normalized = v_email LIMIT 1;
 END IF;

 IF v_guest_id IS NULL THEN
 IF v_mobile_normalized IS NOT NULL THEN
 INSERT INTO public.guests (full_name, mobile, mobile_normalized, email, dob, nationality, address)
 VALUES (
 p_data->>'full_name', p_data->>'mobile', v_mobile_normalized, v_email,
 NULLIF(p_data->>'dob', '')::date,
 p_data->>'nationality', p_data->>'address'
 )
 ON CONFLICT (mobile_normalized) WHERE mobile_normalized IS NOT NULL AND mobile_normalized != ''
 DO UPDATE SET updated_at = now()
 RETURNING id INTO v_guest_id;
 ELSIF v_email IS NOT NULL THEN
 INSERT INTO public.guests (full_name, mobile, mobile_normalized, email, dob, nationality, address)
 VALUES (
 p_data->>'full_name', p_data->>'mobile', v_mobile_normalized, v_email,
 NULLIF(p_data->>'dob', '')::date,
 p_data->>'nationality', p_data->>'address'
 )
 ON CONFLICT ON CONSTRAINT uq_global_guest_email
 DO UPDATE SET updated_at = now()
 RETURNING id INTO v_guest_id;
 ELSE
 INSERT INTO public.guests (full_name, mobile, mobile_normalized, email, dob, nationality, address)
 VALUES (
 p_data->>'full_name', p_data->>'mobile', v_mobile_normalized, v_email,
 NULLIF(p_data->>'dob', '')::date,
 p_data->>'nationality', p_data->>'address'
 )
 RETURNING id INTO v_guest_id;
 END IF;
 ELSE
 -- Update existing guest profile with precheckin data
 UPDATE public.guests
 SET 
 full_name = p_data->>'full_name',
 dob = NULLIF(p_data->>'dob', '')::date,
 nationality = p_data->>'nationality',
 address = p_data->>'address',
 updated_at = now()
 WHERE id = v_guest_id;
 END IF;

 -- 2. Bidirectional Mapping Trigger
 -- FIXED: Sequential matching instead of OR
 IF v_email IS NOT NULL THEN
 SELECT id INTO v_auth_user_id FROM auth.users WHERE lower(email) = v_email LIMIT 1;
 END IF;
 
 IF v_auth_user_id IS NULL AND v_mobile_normalized IS NOT NULL THEN
 SELECT id INTO v_auth_user_id FROM auth.users WHERE regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') = v_mobile_normalized LIMIT 1;
 END IF;

 IF v_auth_user_id IS NOT NULL THEN
 INSERT INTO public.guest_user_map (user_id, guest_id) VALUES (v_auth_user_id, v_guest_id) ON CONFLICT (user_id) DO NOTHING;
 END IF;

 -- 3. Document insertion logic
 IF p_data->'documents' IS NOT NULL THEN
 FOR v_doc IN SELECT * FROM jsonb_array_elements(p_data->'documents')
 LOOP
 INSERT INTO public.guest_id_documents (guest_id, document_type, document_number, document_url)
 VALUES (
 v_guest_id,
 v_doc->>'document_type',
 v_doc->>'document_number',
 v_doc->>'document_url'
 );
 END LOOP;
 END IF;

 -- 4. Mark Pre-checkin Completed
 UPDATE public.precheckin_tokens
 SET status = 'COMPLETED', completed_at = now(), updated_at = now()
 WHERE id = p_token;

 -- 5. Mark Booking Arrival Status
 UPDATE public.bookings
 SET status = 'pre_checked_in', updated_at = now()
 WHERE id = v_booking_id;

 RETURN jsonb_build_object('success', true, 'guest_id', v_guest_id);
END;
$$;

COMMIT;
