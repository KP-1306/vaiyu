-- ============================================================
-- FOOD ORDER RPCs — FINAL (WITH ASSIGNMENT)
-- Design locked in this version
--
-- Event-driven
-- Explicit kitchen acceptance
-- Kitchen assignment on ACCEPT
-- Runner assignment on READY (auto)
-- Monotonic SLA (start on ACCEPT, end on DELIVER)
-- Role-based authorization
-- Concurrency safe
-- No reuse of service auto-assign trigger
-- ============================================================


-- ============================================================
-- 1. CREATE FOOD ORDER (Guest / Staff)
-- No assignment
-- No SLA
-- Goes into Kitchen Queue
-- ============================================================
CREATE OR REPLACE FUNCTION create_food_order(
    p_hotel_id UUID,
    p_stay_id UUID,
    p_room_id UUID,
    p_items JSONB,
    p_total_amount NUMERIC DEFAULT 0,
    p_special_instructions TEXT DEFAULT NULL
)
RETURNS JSONB -- Returns {id, display_id}
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_order_id UUID := gen_random_uuid();
    v_display_id TEXT;
    v_total NUMERIC := 0;
BEGIN
    -- Pre-generate display_id so we can return it
    v_display_id := 'ORD-' || nextval('food_order_display_id_seq');

    INSERT INTO food_orders (
        id, display_id, hotel_id, stay_id, room_id, status, total_amount, special_instructions
    )
    VALUES (
        v_order_id, v_display_id, p_hotel_id, p_stay_id, p_room_id, 'CREATED', p_total_amount, p_special_instructions
    );

    INSERT INTO food_order_items (
        id,
        food_order_id,
        menu_item_id,
        item_name,
        quantity,
        unit_price,
        total_price,
        modifiers,
        status
    )
    SELECT
        gen_random_uuid(),
        v_order_id,
        (i->>'menu_item_id')::UUID,
        i->>'name',
        (i->>'qty')::INT,
        (i->>'unit_price')::NUMERIC,
        (i->>'qty')::INT * (i->>'unit_price')::NUMERIC,
        COALESCE(i->'modifiers','{}'),
        'PENDING'
    FROM jsonb_array_elements(p_items) i;

    -- If total wasn't passed or is 0, calculate it
    IF p_total_amount <= 0 THEN
        SELECT SUM(total_price)
        INTO v_total
        FROM food_order_items
        WHERE food_order_id = v_order_id;

        UPDATE food_orders
        SET total_amount = v_total
        WHERE id = v_order_id;
    END IF;

    -- (SLA state is initialized later on ACCEPT)

    INSERT INTO food_order_events
    VALUES (
        gen_random_uuid(),
        v_order_id,
        'ORDER_CREATED',
        'GUEST',
        auth.uid(),
        '{}',
        now()
    );

    -- Notify real-time listeners
    PERFORM pg_notify(
        'food_orders',
        json_build_object(
            'event', 'ORDER_CREATED',
            'order_id', v_order_id,
            'hotel_id', p_hotel_id,
            'display_id', v_display_id
        )::text
    );

    RETURN jsonb_build_object('id', v_order_id, 'display_id', v_display_id);
END;
$$;


-- ============================================================
-- 2. ACCEPT FOOD ORDER (Kitchen)
-- ➕ Kitchen assignment + SLA start
-- ============================================================
CREATE OR REPLACE FUNCTION accept_food_order(
    p_order_id UUID,
    p_hotel_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Authorization
    IF NOT EXISTS (
        SELECT 1
        FROM hotel_members hm
        JOIN hotel_member_roles hmr ON hmr.hotel_member_id = hm.id
        JOIN hotel_roles r ON r.id = hmr.role_id
        WHERE hm.hotel_id = p_hotel_id
          AND hm.user_id = auth.uid()
          AND r.code IN ('KITCHEN','KITCHEN_MANAGER','ADMIN','OWNER')
    ) THEN
        RAISE EXCEPTION 'Unauthorized kitchen action';
    END IF;

    PERFORM 1 FROM food_orders WHERE id = p_order_id FOR UPDATE;

    UPDATE food_orders
    SET status = 'ACCEPTED', updated_at = now()
    WHERE id = p_order_id
      AND status = 'CREATED';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order cannot be accepted';
    END IF;

    -- Assign kitchen staff (ownership)
    INSERT INTO food_order_assignments (
        id, 
        food_order_id,
        hotel_member_id,
        role,
        assigned_at
    )
    SELECT
        gen_random_uuid(),
        p_order_id,
        hm.id, -- Use hotel_member_id
        'KITCHEN',
        now()
    FROM hotel_members hm
    WHERE hm.hotel_id = p_hotel_id 
      AND hm.user_id = auth.uid()
    ON CONFLICT DO NOTHING;

    -- Start SLA (anchored to order creation time, not accept time)
    INSERT INTO food_order_sla_state (
        food_order_id,
        sla_started_at,
        sla_target_at
    )
    SELECT
        p_order_id,
        now(),
        fo.created_at + (COALESCE(sp.target_minutes, 30) || ' minutes')::interval
    FROM food_orders fo
    JOIN departments d ON d.hotel_id = fo.hotel_id AND d.code = 'KITCHEN'
    LEFT JOIN sla_policies sp ON sp.department_id = d.id AND sp.is_active = true AND sp.valid_to IS NULL
    WHERE fo.id = p_order_id
    ON CONFLICT DO NOTHING;

    INSERT INTO food_order_events
    VALUES (
        gen_random_uuid(),
        p_order_id,
        'ORDER_ACCEPTED',
        'KITCHEN',
        auth.uid(),
        '{}',
        now()
    );
END;
$$;


-- ============================================================
-- 3. MARK ORDER PREPARING (Kitchen)
-- ============================================================
CREATE OR REPLACE FUNCTION mark_food_order_preparing(
    p_order_id UUID,
    p_hotel_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM hotel_members hm
        JOIN hotel_member_roles hmr ON hmr.hotel_member_id = hm.id
        JOIN hotel_roles r ON r.id = hmr.role_id
        WHERE hm.hotel_id = p_hotel_id
          AND hm.user_id = auth.uid()
          AND r.code IN ('KITCHEN','KITCHEN_MANAGER','ADMIN','OWNER')
    ) THEN
        RAISE EXCEPTION 'Unauthorized kitchen action';
    END IF;

    PERFORM 1 FROM food_orders WHERE id = p_order_id FOR UPDATE;

    UPDATE food_orders
    SET status = 'PREPARING', updated_at = now()
    WHERE id = p_order_id
      AND status = 'ACCEPTED';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invalid state transition';
    END IF;

    INSERT INTO food_order_events
    VALUES (
        gen_random_uuid(),
        p_order_id,
        'ORDER_PREPARING',
        'KITCHEN',
        auth.uid(),
        '{}',
        now()
    );
END;
$$;


-- ============================================================
-- 4. MARK ORDER READY (Kitchen)
-- ➕ AUTO-ASSIGN RUNNER
-- ============================================================
CREATE OR REPLACE FUNCTION mark_food_order_ready(
    p_order_id UUID,
    p_hotel_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_runner UUID;
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM hotel_members hm
        JOIN hotel_member_roles hmr ON hmr.hotel_member_id = hm.id
        JOIN hotel_roles r ON r.id = hmr.role_id
        WHERE hm.hotel_id = p_hotel_id
          AND hm.user_id = auth.uid()
          AND r.code IN ('KITCHEN','KITCHEN_MANAGER','ADMIN','OWNER')
    ) THEN
        RAISE EXCEPTION 'Unauthorized kitchen action';
    END IF;

    PERFORM 1 FROM food_orders WHERE id = p_order_id FOR UPDATE;

    UPDATE food_orders
    SET status = 'READY', updated_at = now()
    WHERE id = p_order_id
      AND status = 'PREPARING';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invalid state transition';
    END IF;

    UPDATE food_order_items
    SET status = 'READY'
    WHERE food_order_id = p_order_id;

    -- Auto-assign runner (least load = fewest active READY orders)
    v_runner := (
        SELECT hm.id
        FROM hotel_members hm
        JOIN hotel_member_roles hmr ON hmr.hotel_member_id = hm.id
        JOIN hotel_roles r ON r.id = hmr.role_id
        WHERE hm.hotel_id = p_hotel_id
          AND r.code = 'RUNNER'
        ORDER BY (
            SELECT COUNT(*)
            FROM food_order_assignments foa
            JOIN food_orders fo ON fo.id = foa.food_order_id
            WHERE foa.hotel_member_id = hm.id
              AND foa.role = 'RUNNER'
              AND fo.status = 'READY'
        ) ASC
        LIMIT 1
    );

    IF v_runner IS NOT NULL THEN
        INSERT INTO food_order_assignments (
            id,
            food_order_id,
            hotel_member_id,
            role,
            assigned_at
        )
        VALUES (
            gen_random_uuid(),
            p_order_id,
            v_runner,
            'RUNNER',
            now()
        )
        ON CONFLICT DO NOTHING;
    END IF;

    INSERT INTO food_order_events
    VALUES (
        gen_random_uuid(),
        p_order_id,
        'ORDER_READY',
        'KITCHEN',
        auth.uid(),
        '{}',
        now()
    );
END;
$$;


-- ============================================================
-- 5. DELIVER FOOD ORDER (Runner)
-- ➕ SLA end
-- ============================================================
CREATE OR REPLACE FUNCTION deliver_food_order(
    p_order_id UUID,
    p_hotel_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_member_id UUID;
    v_now TIMESTAMPTZ := now();
BEGIN
    -- 1. Input Validation
    IF p_hotel_id IS NULL THEN
        RAISE EXCEPTION 'Missing hotel_id for delivery action';
    END IF;

    -- 2. Authorization (Safe assignment to prevent P0002)
    v_member_id := (
        SELECT hm.id
        FROM hotel_members hm
        JOIN hotel_member_roles hmr ON hmr.hotel_member_id = hm.id
        JOIN hotel_roles r ON r.id = hmr.role_id
        WHERE hm.hotel_id = p_hotel_id
          AND hm.user_id = auth.uid()
          AND r.code IN ('RUNNER','ADMIN','OWNER')
        LIMIT 1
    );

    IF v_member_id IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: User not allowed to deliver orders at hotel %', p_hotel_id;
    END IF;

    -- 3. Atomic Lock & State Validation
    PERFORM 1 
    FROM food_orders 
    WHERE id = p_order_id 
      AND hotel_id = p_hotel_id 
      AND status = 'READY'
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order % not found, belongs to another hotel, or is not in READY state', p_order_id;
    END IF;

    -- 4. Audit Model: Preserve assignment history if runner changes
    UPDATE food_order_assignments
    SET unassigned_at = v_now
    WHERE food_order_id = p_order_id
      AND role = 'RUNNER'
      AND unassigned_at IS NULL
      AND hotel_member_id <> v_member_id;

    -- Atomic injection: Concurrency handled by unique partial index
    INSERT INTO food_order_assignments (id, food_order_id, hotel_member_id, role, assigned_at)
    VALUES (gen_random_uuid(), p_order_id, v_member_id, 'RUNNER', v_now)
    ON CONFLICT DO NOTHING;

    -- 5. Unified Status Update
    UPDATE food_orders
    SET status = 'DELIVERED',
        delivered_at = v_now,
        delivered_by = v_member_id,
        updated_at = v_now
    WHERE id = p_order_id
      AND status = 'READY';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order % status transition failed (already processed or invalid state)', p_order_id;
    END IF;

    -- 6. Streamlined SLA Close
    UPDATE food_order_sla_state
    SET sla_completed_at = v_now,
        breached = (v_now > sla_target_at),
        breached_at = CASE WHEN v_now > sla_target_at THEN v_now END
    WHERE food_order_id = p_order_id;

    IF NOT FOUND THEN
        RAISE DEBUG 'SLA state record missing for order %', p_order_id;
    END IF;

    -- 7. High-Traceability Event Logging (V2 with transition metadata)
    INSERT INTO food_order_events (
        id, food_order_id, event_type, actor_type, actor_id, payload, created_at
    )
    VALUES (
        gen_random_uuid(),
        p_order_id,
        'ORDER_DELIVERED',
        'RUNNER',
        v_member_id, 
        jsonb_build_object(
            'hotel_member_id', v_member_id,
            'actor_user_id', auth.uid(),
            'from_status', 'READY',
            'to_status', 'DELIVERED',
            'delivered_at', v_now
        ),
        v_now
    );

END;
$$;


-- ============================================================
-- 6. CANCEL FOOD ORDER
-- ============================================================
CREATE OR REPLACE FUNCTION cancel_food_order(
    p_order_id UUID,
    p_reason TEXT,
    p_actor_type TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    PERFORM 1 FROM food_orders WHERE id = p_order_id FOR UPDATE;

    UPDATE food_orders
    SET status = 'CANCELLED',
        cancelled_reason = p_reason,
        cancelled_by = p_actor_type,
        updated_at = now()
    WHERE id = p_order_id
      AND status IN ('CREATED','ACCEPTED','PREPARING');

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order cannot be cancelled';
    END IF;

    INSERT INTO food_order_events
    VALUES (
        gen_random_uuid(),
        p_order_id,
        'ORDER_CANCELLED',
        p_actor_type,
        auth.uid(),
        jsonb_build_object('reason', p_reason),
        now()
    );
END;
$$;


-- ============================================================
-- Permissions
-- ============================================================
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;
