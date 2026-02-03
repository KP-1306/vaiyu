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

    -- Start SLA
    INSERT INTO food_order_sla_state (
        food_order_id,
        sla_started_at,
        sla_target_at
    )
    VALUES (
        p_order_id,
        now(),
        now() + interval '30 minutes'
    )
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
    SELECT hm.id -- Use hotel_member_id
    INTO v_runner
    FROM hotel_members hm
    JOIN hotel_member_roles hmr ON hmr.hotel_member_id = hm.id
    JOIN hotel_roles r ON r.id = hmr.role_id
    WHERE hm.hotel_id = p_hotel_id
      AND r.code = 'RUNNER'
      -- Simple load balancing: count orders currently in 'READY' status assigned to this runner
    ORDER BY (
        SELECT COUNT(*)
        FROM food_order_assignments foa
        JOIN food_orders fo ON fo.id = foa.food_order_id
        WHERE foa.hotel_member_id = hm.id
          AND foa.role = 'RUNNER'
          AND fo.status = 'READY'
    ) ASC
    LIMIT 1;

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
AS $$
DECLARE
    v_member_id UUID;
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM hotel_members hm
        JOIN hotel_member_roles hmr ON hmr.hotel_member_id = hm.id
        JOIN hotel_roles r ON r.id = hmr.role_id
        WHERE hm.hotel_id = p_hotel_id
          AND hm.user_id = auth.uid()
          AND r.code IN ('RUNNER','ADMIN','OWNER')
    ) THEN
        RAISE EXCEPTION 'Unauthorized delivery action';
    END IF;

    PERFORM 1 FROM food_orders WHERE id = p_order_id FOR UPDATE;
    
    -- Claim assignment for the deliverer (Audit/Credit)
    -- 1. Try to update existing runner assignment
    
    -- First, get the hotel_member_id of the current user
    SELECT id INTO v_member_id
    FROM hotel_members
    WHERE hotel_id = p_hotel_id AND user_id = auth.uid();
    
    IF v_member_id IS NULL THEN
            RAISE EXCEPTION 'User is not a member of this hotel';
    END IF;

    UPDATE food_order_assignments
    SET hotel_member_id = v_member_id,
        assigned_at = now()
    WHERE food_order_id = p_order_id
        AND role = 'RUNNER';

    -- 2. If no runner was assigned, insert new assignment
    IF NOT FOUND THEN
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
            v_member_id,
            'RUNNER',
            now()
        );
    END IF;

    UPDATE food_orders
    SET status = 'DELIVERED', updated_at = now()
    WHERE id = p_order_id
      AND status = 'READY';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invalid delivery transition';
    END IF;

    UPDATE food_order_sla_state
    SET sla_completed_at = now(),
        breached = (now() > sla_target_at),
        breached_at = CASE WHEN now() > sla_target_at THEN now() END
    WHERE food_order_id = p_order_id;

    INSERT INTO food_order_events
    VALUES (
        gen_random_uuid(),
        p_order_id,
        'ORDER_DELIVERED',
        'RUNNER',
        auth.uid(),
        '{}',
        now()
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
