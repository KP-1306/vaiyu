-- ============================================================
-- OWNER DASHBOARD ANALYTICS (RPCs)
-- ============================================================

-- 1. SLA Trend RPC
-- Returns daily SLA compliance for the last N days
-- Handles gaps (returns 0s) and adjusts to Hotel Timezone
CREATE OR REPLACE FUNCTION get_dashboard_sla_trend(
  p_hotel_id UUID,
  p_timezone TEXT DEFAULT 'UTC',   -- e.g., 'Asia/Kolkata'
  p_days INT DEFAULT 7
)
RETURNS TABLE (
  date DATE,
  total_tickets BIGINT,
  breached_tickets BIGINT,
  compliant_tickets BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_end_date TIMESTAMP;
  v_start_date TIMESTAMP;
BEGIN
  -- Calculate range in target timezone
  v_end_date := date_trunc('day', now() AT TIME ZONE p_timezone);
  v_start_date := v_end_date - (p_days - 1 || ' days')::interval;

  -- 🔒 SECURITY CHECK
  IF NOT EXISTS (
    SELECT 1 FROM hotel_members 
    WHERE user_id = auth.uid() 
    AND hotel_id = p_hotel_id
  ) THEN
    RAISE EXCEPTION 'Access Denied: You are not a member of this hotel.';
  END IF;

  RETURN QUERY
  WITH date_series AS (
    SELECT generate_series(v_start_date, v_end_date, '1 day'::interval) AS day_ts
  ),
  daily_data AS (
    SELECT
      date_trunc('day', t.created_at AT TIME ZONE p_timezone) as ticket_day,
      count(*) as total,
      count(*) FILTER (WHERE s.breached_at IS NOT NULL) as breached,
      count(*) FILTER (WHERE s.breached_at IS NULL) as compliant
    FROM tickets t
    JOIN departments d ON t.service_department_id = d.id
    LEFT JOIN ticket_sla_state s ON t.id = s.ticket_id
    WHERE
      d.hotel_id = p_hotel_id
      AND t.status IN ('COMPLETED', 'CANCELLED')
      AND t.created_at >= (v_start_date AT TIME ZONE p_timezone)
    GROUP BY 1
  )
  SELECT
    ds.day_ts::date,
    COALESCE(dd.total, 0),
    COALESCE(dd.breached, 0),
    COALESCE(dd.compliant, 0)
  FROM date_series ds
  LEFT JOIN daily_data dd ON ds.day_ts = dd.ticket_day
  ORDER BY ds.day_ts;
END;
$$;


-- 2. Hourly Task Volume RPC
CREATE OR REPLACE FUNCTION get_dashboard_hourly_volume(
  p_hotel_id UUID,
  p_timezone TEXT DEFAULT 'UTC'
)
RETURNS TABLE (
  hour_of_day INT,
  ticket_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_today_start TIMESTAMP;
  v_next_day_start TIMESTAMP;
BEGIN
  -- 🔒 SECURITY CHECK
  IF NOT EXISTS (
    SELECT 1 FROM hotel_members 
    WHERE user_id = auth.uid() 
    AND hotel_id = p_hotel_id
  ) THEN
    RAISE EXCEPTION 'Access Denied: You are not a member of this hotel.';
  END IF;

  -- Today in Hotel Time
  v_today_start := date_trunc('day', now() AT TIME ZONE p_timezone);
  v_next_day_start := v_today_start + interval '1 day';

  RETURN QUERY
  WITH hour_series AS (
    SELECT generate_series(0, 23) AS hr
  ),
  hourly_data AS (
    SELECT
      extract(hour from t.created_at AT TIME ZONE p_timezone)::int as hr,
      count(*) as cnt
    FROM tickets t
    JOIN departments d ON t.service_department_id = d.id
    WHERE
      d.hotel_id = p_hotel_id
      AND t.created_at >= (v_today_start AT TIME ZONE p_timezone)
      AND t.created_at <  (v_next_day_start AT TIME ZONE p_timezone)
    GROUP BY 1
  )
  SELECT
    hs.hr,
    COALESCE(hd.cnt, 0)
  FROM hour_series hs
  LEFT JOIN hourly_data hd ON hs.hr = hd.hr
  ORDER BY hs.hr;
END;
$$;


-- 3. Performance Index
CREATE INDEX IF NOT EXISTS idx_tickets_created_at_brin
ON tickets USING brin(created_at);


-- 4. Occupancy Trend RPC
-- Returns nightly occupancy % for the last N days
CREATE OR REPLACE FUNCTION get_dashboard_occupancy_trend(
  p_hotel_id UUID,
  p_timezone TEXT DEFAULT 'UTC',
  p_days INT DEFAULT 30
)
RETURNS TABLE (
  date DATE,
  occupied_count BIGINT,
  total_rooms BIGINT,
  occupancy_pct NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_end_date TIMESTAMP;
  v_start_date TIMESTAMP;
  v_total_rooms BIGINT;
BEGIN
  -- 🔒 SECURITY CHECK
  IF NOT EXISTS (
    SELECT 1 FROM hotel_members 
    WHERE user_id = auth.uid() 
    AND hotel_id = p_hotel_id
  ) THEN
    RAISE EXCEPTION 'Access Denied: You are not a member of this hotel.';
  END IF;

  -- 1. Get snapshot of total rooms (Assuming fairly constant, or usage current count)
  SELECT count(*) INTO v_total_rooms FROM rooms WHERE hotel_id = p_hotel_id;

  -- 2. Date Ranges
  v_end_date := date_trunc('day', now() AT TIME ZONE p_timezone);
  v_start_date := v_end_date - (p_days - 1 || ' days')::interval;

  RETURN QUERY
  WITH date_series AS (
    SELECT generate_series(v_start_date, v_end_date, '1 day'::interval) AS day_ts
  ),
  daily_occupancy AS (
    -- Count stays that overlap with the NIGHT of each date
    SELECT
      ds.day_ts::date as report_date,
      count(s.id) as occupied
    FROM date_series ds
    LEFT JOIN stays s ON 
      s.hotel_id = p_hotel_id
      -- Logic: Stay is active if check_in <= date AND check_out > date (Standard hotel logic)
      -- Using TZ conversion to ensure date boundaries match
      AND s.check_in_start < (ds.day_ts + interval '1 day') AT TIME ZONE p_timezone
      AND s.check_out_end > ds.day_ts AT TIME ZONE p_timezone
      AND s.status IN ('arriving', 'inhouse', 'departed') -- active stays only
    GROUP BY 1
  )
  SELECT
    occ.report_date,
    occ.occupied,
    v_total_rooms,
    CASE 
      WHEN v_total_rooms > 0 THEN round((occ.occupied::numeric / v_total_rooms) * 100, 1)
      ELSE 0
    END as pct
  FROM daily_occupancy occ
  ORDER BY occ.report_date;
END;
$$;


-- 5. Revenue Trend RPC
-- Returns nightly revenue (sum of orders) for the last N days
CREATE OR REPLACE FUNCTION get_dashboard_revenue_trend(
  p_hotel_id UUID,
  p_timezone TEXT DEFAULT 'UTC',
  p_days INT DEFAULT 30
)
RETURNS TABLE (
  date DATE,
  revenue NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_end_date TIMESTAMP;
  v_start_date TIMESTAMP;
BEGIN
  -- 🔒 SECURITY CHECK
  IF NOT EXISTS (
    SELECT 1 FROM hotel_members 
    WHERE user_id = auth.uid() 
    AND hotel_id = p_hotel_id
  ) THEN
    RAISE EXCEPTION 'Access Denied: You are not a member of this hotel.';
  END IF;

  -- Date Ranges
  v_end_date := date_trunc('day', now() AT TIME ZONE p_timezone);
  v_start_date := v_end_date - (p_days - 1 || ' days')::interval;

  RETURN QUERY
  WITH date_series AS (
    SELECT generate_series(v_start_date, v_end_date, '1 day'::interval) AS day_ts
  ),
  daily_revenue AS (
    SELECT
      date_trunc('day', o.created_at AT TIME ZONE p_timezone) as report_date,
      sum(o.price) as total_rev
    FROM orders o
    WHERE
      o.hotel_id = p_hotel_id
      AND o.price IS NOT NULL -- only orders with price
      AND o.created_at >= (v_start_date AT TIME ZONE p_timezone)
    GROUP BY 1
  )
  SELECT
    ds.day_ts::date,
    COALESCE(dr.total_rev, 0)
  FROM date_series ds
  LEFT JOIN daily_revenue dr ON ds.day_ts = dr.report_date
  ORDER BY ds.day_ts;
END;
$$;


-- 6. Today Stats RPC (Arrivals, Departures)
CREATE OR REPLACE FUNCTION get_dashboard_today_stats(
  p_hotel_id UUID,
  p_timezone TEXT DEFAULT 'UTC'
)
RETURNS TABLE (
  arrivals_count BIGINT,
  departures_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_today_start TIMESTAMP;
  v_next_day_start TIMESTAMP;
BEGIN
   -- 🔒 SECURITY CHECK
  IF NOT EXISTS (
    SELECT 1 FROM hotel_members 
    WHERE user_id = auth.uid() 
    AND hotel_id = p_hotel_id
  ) THEN
    RAISE EXCEPTION 'Access Denied: You are not a member of this hotel.';
  END IF;

  -- Today in Hotel Time
  v_today_start := date_trunc('day', now() AT TIME ZONE p_timezone);
  v_next_day_start := v_today_start + interval '1 day';

  RETURN QUERY
  SELECT
    count(*) FILTER (
        WHERE check_in_start >= (v_today_start AT TIME ZONE p_timezone)
        AND check_in_start < (v_next_day_start AT TIME ZONE p_timezone)
    ) as arrivals,
    count(*) FILTER (
        WHERE check_out_end >= (v_today_start AT TIME ZONE p_timezone)
        AND check_out_end < (v_next_day_start AT TIME ZONE p_timezone)
    ) as departures
  FROM stays
  WHERE hotel_id = p_hotel_id
  AND status IN ('arriving', 'inhouse', 'departed'); -- active stays only
END;
$$;


-- 7. Staff Leaderboard RPC
-- Returns all staff for a hotel with their name and department
CREATE OR REPLACE FUNCTION get_dashboard_staff_leaderboard(
  p_hotel_id UUID
)
RETURNS TABLE (
  staff_id UUID,
  display_name TEXT,
  department_name TEXT,
  role TEXT,
  tickets_completed BIGINT,
  avg_completion_min NUMERIC,
  is_online BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- 🔒 SECURITY CHECK
  IF NOT EXISTS (
    SELECT 1 FROM hotel_members 
    WHERE user_id = auth.uid() 
    AND hotel_id = p_hotel_id
  ) THEN
    RAISE EXCEPTION 'Access Denied: You are not a member of this hotel.';
  END IF;

  RETURN QUERY
  SELECT
    hm.id as staff_id,
    COALESCE(p.full_name, 'Staff ' || substring(hm.id::text, 1, 8))::TEXT as display_name,
    COALESCE(d.name, 'General')::TEXT as department_name,
    hm.role::TEXT,
    (SELECT count(*) FROM tickets t WHERE t.current_assignee_id = hm.id AND t.status = 'COMPLETED')::BIGINT as tickets_completed,
    NULL::NUMERIC as avg_completion_min,
    hm.is_active as is_online
  FROM hotel_members hm
  LEFT JOIN profiles p ON p.id = hm.user_id
  LEFT JOIN departments d ON d.id = hm.department_id
  WHERE hm.hotel_id = p_hotel_id
  AND hm.is_active = true
  ORDER BY hm.created_at ASC;
END;
$$;

-- Grants
GRANT EXECUTE ON FUNCTION get_dashboard_sla_trend TO authenticated;
GRANT EXECUTE ON FUNCTION get_dashboard_hourly_volume TO authenticated;
GRANT EXECUTE ON FUNCTION get_dashboard_occupancy_trend TO authenticated;
GRANT EXECUTE ON FUNCTION get_dashboard_revenue_trend TO authenticated;
GRANT EXECUTE ON FUNCTION get_dashboard_today_stats TO authenticated;
GRANT EXECUTE ON FUNCTION get_dashboard_staff_leaderboard TO authenticated;
