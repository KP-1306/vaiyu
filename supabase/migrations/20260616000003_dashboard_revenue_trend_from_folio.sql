-- 20260616000003_dashboard_revenue_trend_from_folio.sql
--
-- Converge the OWNER DASHBOARD's revenue trend onto the same folio-backed
-- source of truth as the Revenue overview (see 20260616000002).
--
-- get_dashboard_revenue_trend (feeds the dashboard Today card's revenue + the
-- weekly trend via revenueHistory) summed `orders.price` — the food/service
-- ordering table — the same mislabel that made owner_revenue_daily_v wrong.
-- On prod that meant the dashboard revenue trend was ~₹0 and disagreed with
-- the (now-corrected) overview. This repoints it at owner_revenue_daily_v so
-- every revenue number on the owner board agrees.
--
-- Signature, security check, params, and the zero-filled date spine are all
-- preserved — only the data source (orders → folio view) changes. Day grain is
-- the view's day (UTC), matching the overview, so the two reconcile exactly.

CREATE OR REPLACE FUNCTION public.get_dashboard_revenue_trend(
  "p_hotel_id" "uuid",
  "p_timezone" "text" DEFAULT 'UTC'::"text",
  "p_days" integer DEFAULT 30
) RETURNS TABLE("date" "date", "revenue" numeric)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_end_date TIMESTAMP;
  v_start_date TIMESTAMP;
BEGIN
  -- 🔒 SECURITY CHECK (unchanged)
  IF NOT EXISTS (
    SELECT 1 FROM hotel_members
    WHERE user_id = auth.uid()
    AND hotel_id = p_hotel_id
  ) THEN
    RAISE EXCEPTION 'Access Denied: You are not a member of this hotel.';
  END IF;

  -- Date ranges (unchanged)
  v_end_date := date_trunc('day', now() AT TIME ZONE p_timezone);
  v_start_date := v_end_date - (p_days - 1 || ' days')::interval;

  RETURN QUERY
  WITH date_series AS (
    SELECT generate_series(v_start_date, v_end_date, '1 day'::interval) AS day_ts
  ),
  daily_revenue AS (
    -- Folio-backed total revenue (room + F&B + service, ex-tax) per day —
    -- the single source of truth shared with the Revenue overview.
    SELECT v.day AS report_date, v.total_revenue AS total_rev
    FROM public.owner_revenue_daily_v v
    WHERE v.hotel_id = p_hotel_id
      AND v.day >= v_start_date::date
      AND v.day <= v_end_date::date
  )
  SELECT
    ds.day_ts::date,
    COALESCE(dr.total_rev, 0)
  FROM date_series ds
  LEFT JOIN daily_revenue dr ON ds.day_ts::date = dr.report_date
  ORDER BY ds.day_ts;
END;
$$;

ALTER FUNCTION public.get_dashboard_revenue_trend("p_hotel_id" "uuid", "p_timezone" "text", "p_days" integer) OWNER TO "postgres";
