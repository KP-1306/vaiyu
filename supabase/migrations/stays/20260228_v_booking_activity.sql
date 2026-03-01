-- ──────────────────────────────────────────────────────────────────
-- unified_booking_activity.sql
-- ──────────────────────────────────────────────────────────────────
-- Creates a single chronological event stream view for the Activity Tab
-- Combines Arrival Events, Food Orders, Payments, and Service Requests 
-- so the frontend can fetch everything in one query without mapping.
-- ──────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.v_booking_activity AS

-- 1️⃣ ARRIVAL / LIFECYCLE EVENTS
SELECT
    ae.booking_id,
    ae.created_at AS event_time,
    'ARRIVAL'::text AS event_category,
    ae.event_type AS event_type,
    ae.event_type AS title,
    CASE
        WHEN ae.event_type = 'CHECKIN' OR (ae.event_type = 'STATUS_CHANGE' AND (ae.new_value = 'checked_in' OR ae.new_value = 'inhouse')) THEN 'Guest checked in'
        WHEN ae.event_type = 'STATUS_CHANGE' AND ae.new_value = 'precheckin' THEN 'Guest completed pre-checkin'
        WHEN ae.event_type = 'CHECKOUT' OR (ae.event_type = 'STATUS_CHANGE' AND ae.new_value = 'checked_out') THEN 'Guest checked out'
        WHEN ae.event_type = 'ROOM_ASSIGNED' THEN 'Room ' || COALESCE(ae.new_value, 'assigned')
        WHEN ae.event_type = 'ROOM_REASSIGNED' THEN 'Room changed from ' || ae.old_value || ' to ' || ae.new_value
        WHEN ae.event_type = 'CANCEL' OR (ae.event_type = 'STATUS_CHANGE' AND ae.new_value = 'cancelled') THEN 'Booking cancelled'
        WHEN ae.event_type = 'NO_SHOW' OR (ae.event_type = 'STATUS_CHANGE' AND ae.new_value = 'no_show') THEN 'Marked as no show'
        ELSE COALESCE('Status changed to ' || ae.new_value, 'Status changed')
    END AS description,
    NULL::numeric AS amount,
    NULL::text AS reference_id,
    ae.performed_by AS actor_id,
    4 AS sort_priority
FROM arrival_events ae

UNION ALL

-- 2️⃣ FOOD ORDERS
SELECT
    s.booking_id,
    fo.created_at AS event_time,
    'FOOD'::text AS event_category,
    fo.status AS event_type,
    'Food Order ' || fo.display_id AS title,
    'Order ' || fo.status AS description,
    fo.total_amount AS amount,
    fo.display_id AS reference_id,
    NULL::uuid AS actor_id,
    2 AS sort_priority
FROM food_orders fo
JOIN stays s ON s.id = fo.stay_id
WHERE fo.status IN ('CREATED', 'DELIVERED', 'CANCELLED')

UNION ALL

-- 3️⃣ PAYMENTS
SELECT
    p.booking_id,
    p.created_at AS event_time,
    'PAYMENT'::text AS event_category,
    p.status AS event_type,
    'Payment Received' AS title,
    '₹' || p.amount || ' via ' || replace(p.method, '_', ' ') AS description,
    p.amount AS amount,
    p.id::text AS reference_id,
    p.collected_by AS actor_id,
    1 AS sort_priority
FROM payments p
WHERE p.status = 'COMPLETED' AND p.booking_id IS NOT NULL

UNION ALL

-- 4️⃣ SERVICE REQUEST EVENTS
SELECT
    s.booking_id,
    te.created_at AS event_time,
    'SERVICE'::text AS event_category,
    te.event_type AS event_type,
    'Request ' || t.display_id AS title,
    COALESCE(te.comment, 'Status updated') AS description,
    NULL::numeric AS amount,
    t.display_id AS reference_id,
    te.actor_id,
    3 AS sort_priority
FROM ticket_events te
JOIN tickets t ON t.id = te.ticket_id
JOIN stays s ON s.id = t.stay_id
WHERE te.event_type IN ('CREATED', 'COMPLETED', 'CANCELLED');

-- Enable RLS logic via the view
GRANT SELECT ON public.v_booking_activity TO authenticated, service_role;

-- ──────────────────────────────────────────────────────────────────
-- Performance Indices for v_booking_activity
-- ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_arrival_events_booking_created
ON arrival_events(booking_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_food_orders_stay_created
ON food_orders(stay_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payments_booking_created
ON payments(booking_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ticket_events_ticket_created
ON ticket_events(ticket_id, created_at DESC);
