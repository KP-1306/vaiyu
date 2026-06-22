-- ============================================================================
-- Operator Console refinements — close 3 hostile-pass items
--   #1 true windowed avg latency (was an unweighted mean of per-bucket avgs)
--   #2 gap-filled health series (empty time buckets now render, not collapse)
--   #3 server-side Tenants search / filter / sort / pagination (incl. revenue),
--      so the table is correct past one page instead of filtering the loaded set
-- All service_role-only, matching the va_admin_* family. Idempotent.
-- ============================================================================

-- #1 — add a true avg(ms) over the window to the latency RPC. Adding an OUT
-- column changes the signature, so DROP first (only caller is admin-metrics).
DROP FUNCTION IF EXISTS public.va_admin_api_latency(int);
CREATE FUNCTION public.va_admin_api_latency(p_hours int DEFAULT 24)
RETURNS TABLE(avg_ms int, p95_ms int, p99_ms int)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    coalesce(avg(ms)::int, 0)                                       AS avg_ms,
    coalesce(percentile_cont(0.95) WITHIN GROUP (ORDER BY ms), 0)::int AS p95_ms,
    coalesce(percentile_cont(0.99) WITHIN GROUP (ORDER BY ms), 0)::int AS p99_ms
  FROM public.api_hits
  WHERE at > now() - make_interval(hours => least(168, greatest(1, coalesce(p_hours, 24))))
    AND fn IS NOT NULL
    AND ms IS NOT NULL;
$$;

-- #2 — gap-filled series: generate every bucket in the window and LEFT JOIN the
-- aggregated hits, so quiet periods show as zero bars instead of disappearing
-- (the old GROUP-BY-only version emitted just non-empty buckets). Same adaptive
-- bucketing: hourly <=48h, 6-hour beyond. Cap at 168h (api_hits retains 7 days).
CREATE OR REPLACE FUNCTION public.va_admin_api_series(p_hours int DEFAULT 24)
RETURNS TABLE(hour_bucket timestamptz, calls bigint, avg_ms int, err_4xx bigint, err_5xx bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH cfg AS (
    SELECT h AS hrs, CASE WHEN h <= 48 THEN 3600 ELSE 21600 END AS bsec
    FROM (SELECT least(168, greatest(1, coalesce(p_hours, 24))) AS h) x
  ),
  bounds AS (
    SELECT
      to_timestamp(floor(extract(epoch FROM now() - make_interval(hours => hrs)) / bsec) * bsec) AS start_b,
      to_timestamp(floor(extract(epoch FROM now()) / bsec) * bsec)                                AS end_b,
      bsec
    FROM cfg
  ),
  buckets AS (
    SELECT generate_series(start_b, end_b, make_interval(secs => bsec)) AS b FROM bounds
  ),
  hits AS (
    SELECT to_timestamp(floor(extract(epoch FROM a.at) / cfg.bsec) * cfg.bsec)   AS b,
           count(*)                                                              AS calls,
           coalesce(avg(a.ms)::int, 0)                                           AS avg_ms,
           sum(CASE WHEN a.status BETWEEN 400 AND 499 THEN 1 ELSE 0 END)         AS err_4xx,
           sum(CASE WHEN a.status >= 500 THEN 1 ELSE 0 END)                      AS err_5xx
    FROM public.api_hits a, cfg, bounds
    WHERE a.at >= bounds.start_b AND a.fn IS NOT NULL
    GROUP BY 1
  )
  SELECT bk.b, coalesce(h.calls, 0), coalesce(h.avg_ms, 0), coalesce(h.err_4xx, 0), coalesce(h.err_5xx, 0)
  FROM buckets bk
  LEFT JOIN hits h ON h.b = bk.b
  ORDER BY bk.b;
$$;

-- #3 — server-side Tenants: filter (search/plan/status) + sort (incl. computed
-- revenue_today) + paginate, with the exact match total carried on each row.
-- revenue_today = today's COMPLETED payments per hotel, IST day boundary.
CREATE OR REPLACE FUNCTION public.va_admin_tenants(
  p_offset int  DEFAULT 0,
  p_limit  int  DEFAULT 50,
  p_q      text DEFAULT NULL,
  p_plan   text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_sort   text DEFAULT 'created_at',
  p_dir    text DEFAULT 'desc'
)
RETURNS TABLE(
  slug text, name text, city text, plan text, plan_status text,
  created_at timestamptz, revenue_today numeric, total bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH day_start AS (
    SELECT (date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata')) AT TIME ZONE 'Asia/Kolkata' AS d
  ),
  rev AS (
    SELECT p.hotel_id, sum(p.amount) AS revenue_today
    FROM public.payments p, day_start
    WHERE p.status = 'COMPLETED' AND p.created_at >= day_start.d
    GROUP BY p.hotel_id
  ),
  filtered AS (
    SELECT h.slug, h.name, h.city, h.plan, h.plan_status, h.created_at,
           round(coalesce(r.revenue_today, 0)::numeric, 2) AS revenue_today
    FROM public.hotels h
    LEFT JOIN rev r ON r.hotel_id = h.id
    WHERE (p_q IS NULL OR p_q = '' OR
             h.name ILIKE '%' || p_q || '%' OR
             h.slug ILIKE '%' || p_q || '%' OR
             coalesce(h.city, '') ILIKE '%' || p_q || '%')
      AND (p_plan   IS NULL OR p_plan   = '' OR h.plan        = p_plan)
      AND (p_status IS NULL OR p_status = '' OR h.plan_status = p_status)
  ),
  counted AS (SELECT count(*) AS total FROM filtered)
  SELECT f.slug, f.name, f.city, f.plan, f.plan_status, f.created_at, f.revenue_today, c.total
  FROM filtered f CROSS JOIN counted c
  ORDER BY
    CASE WHEN p_sort = 'name'         AND p_dir = 'asc'  THEN f.name          END ASC,
    CASE WHEN p_sort = 'name'         AND p_dir = 'desc' THEN f.name          END DESC,
    CASE WHEN p_sort = 'city'         AND p_dir = 'asc'  THEN f.city          END ASC,
    CASE WHEN p_sort = 'city'         AND p_dir = 'desc' THEN f.city          END DESC,
    CASE WHEN p_sort = 'plan'         AND p_dir = 'asc'  THEN f.plan          END ASC,
    CASE WHEN p_sort = 'plan'         AND p_dir = 'desc' THEN f.plan          END DESC,
    CASE WHEN p_sort = 'plan_status'  AND p_dir = 'asc'  THEN f.plan_status   END ASC,
    CASE WHEN p_sort = 'plan_status'  AND p_dir = 'desc' THEN f.plan_status   END DESC,
    CASE WHEN p_sort = 'revenueToday' AND p_dir = 'asc'  THEN f.revenue_today END ASC,
    CASE WHEN p_sort = 'revenueToday' AND p_dir = 'desc' THEN f.revenue_today END DESC,
    CASE WHEN p_sort = 'created_at'   AND p_dir = 'asc'  THEN f.created_at     END ASC,
    f.created_at DESC
  LIMIT greatest(1, least(5000, coalesce(p_limit, 50)))
  OFFSET greatest(0, coalesce(p_offset, 0));
$$;

-- distinct plan / status values across the WHOLE fleet, for the filter dropdowns
-- (deriving them from the current page would miss values not on that page).
CREATE OR REPLACE FUNCTION public.va_admin_tenant_facets()
RETURNS TABLE(plans text[], statuses text[])
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    coalesce((SELECT array_agg(DISTINCT plan        ORDER BY plan)        FROM public.hotels WHERE plan        IS NOT NULL), '{}'),
    coalesce((SELECT array_agg(DISTINCT plan_status ORDER BY plan_status) FROM public.hotels WHERE plan_status IS NOT NULL), '{}');
$$;

REVOKE ALL ON FUNCTION public.va_admin_api_latency(int)    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.va_admin_api_series(int)     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.va_admin_tenants(int, int, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.va_admin_tenant_facets()     FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.va_admin_api_latency(int)    TO service_role;
GRANT EXECUTE ON FUNCTION public.va_admin_api_series(int)     TO service_role;
GRANT EXECUTE ON FUNCTION public.va_admin_tenants(int, int, text, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.va_admin_tenant_facets()     TO service_role;
