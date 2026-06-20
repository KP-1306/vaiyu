-- ============================================================
-- VAiyu: base-table anon tail — api_hits (rate-limit table) seal
-- ============================================================
-- api_hits was RLS-disabled + anon-granted: anon could read ALL request logs
-- (key/path/hotel_slug/caller_role/status). It's the rate-limit table — public
-- edge functions (reviews-public, orders, reviews, ops-update) rate-limit by, AS
-- ANON, inserting a hit then SELECT count(*) of recent hits for a key. So anon
-- legitimately needed to READ rows to count them — which IS the leak; no RLS
-- policy can both hide rows from anon and keep the counter working.
--
-- FIX (move the rate-limit DB work server-side): a SECURITY DEFINER RPC does the
-- insert + windowed count as the table owner and returns whether the caller is
-- under the limit. Edge functions call the RPC (anon only needs EXECUTE, not
-- table access), so api_hits can be locked to service_role/owner. Semantics match
-- the existing limiters exactly (insert one hit; count rows for key in the last
-- p_window_seconds; allowed iff count <= p_limit  <=>  old "throw if count > limit").
-- ============================================================

CREATE OR REPLACE FUNCTION public.va_rate_limit_hit(
  p_key            text,
  p_window_seconds int DEFAULT 60,
  p_limit          int DEFAULT 120
)
 RETURNS boolean              -- true = allowed (<= limit), false = exceeded
 LANGUAGE plpgsql
 VOLATILE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count int;
BEGIN
  -- Defensive: a missing key shouldn't hard-block the caller.
  IF p_key IS NULL OR btrim(p_key) = '' THEN
    RETURN true;
  END IF;

  INSERT INTO public.api_hits(key) VALUES (p_key);

  SELECT count(*) INTO v_count
  FROM public.api_hits
  WHERE key = p_key
    AND ts >= now() - make_interval(secs => GREATEST(p_window_seconds, 1));

  RETURN v_count <= GREATEST(p_limit, 1);
END;
$function$;

REVOKE ALL ON FUNCTION public.va_rate_limit_hit(text, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.va_rate_limit_hit(text, int, int) TO anon, authenticated, service_role;

-- Lock the table: only the SD RPC (owner) and service_role touch it now.
ALTER TABLE public.api_hits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.api_hits FROM anon, authenticated, PUBLIC;
GRANT  ALL ON public.api_hits TO service_role;
