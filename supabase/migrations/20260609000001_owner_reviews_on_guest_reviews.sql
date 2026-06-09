-- =====================================================================
-- Owner Reviews v1 — surface real guest reviews to the owner, and make the
-- dashboard reputation reflect where guests actually write (guest_reviews).
-- =====================================================================
-- Context: guests submit reviews into `guest_reviews` (overall_rating,
-- review_text) + `review_ratings` (per-category). The owner-side review
-- screen was wired to a legacy `reviews` table via a now-dead Fastify API.
-- This migration moves the owner reputation surface onto `guest_reviews`:
--   1) RLS: allow hotel staff to UPDATE reviews (visibility moderation).
--      SELECT/INSERT staff policies already exist; only UPDATE was missing.
--      (review_flags already has a "Staff manage flags" ALL policy.)
--   2) Repoint owner_dashboard_kpis.avg_rating_30d from `reviews` to
--      `guest_reviews`. Definition is identical to the live matview except
--      the rating_30d CTE source (reviews.rating -> guest_reviews.overall_rating).
--
-- Safe to re-run: the policy is guarded with IF NOT EXISTS; the matview is
-- dropped + recreated WITH DATA (populated immediately, no "not populated" 500).

-- ── 1. Staff can update reviews (visibility moderation) ──────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'guest_reviews'
      AND policyname = 'Staff update reviews'
  ) THEN
    CREATE POLICY "Staff update reviews" ON public.guest_reviews
      FOR UPDATE
      USING (EXISTS (
        SELECT 1 FROM public.hotel_members
        WHERE hotel_members.hotel_id = guest_reviews.hotel_id
          AND hotel_members.user_id = auth.uid()
      ))
      WITH CHECK (EXISTS (
        SELECT 1 FROM public.hotel_members
        WHERE hotel_members.hotel_id = guest_reviews.hotel_id
          AND hotel_members.user_id = auth.uid()
      ));
  END IF;
END $$;

-- ── 2. Repoint dashboard reputation to guest_reviews ────────────────
DROP MATERIALIZED VIEW IF EXISTS public.owner_dashboard_kpis;

CREATE MATERIALIZED VIEW public.owner_dashboard_kpis AS
 WITH today AS (
         SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata'::text)::date AS as_of_date
        ), hotel_set AS (
         SELECT h.id AS hotel_id,
            h.slug AS hotel_slug,
            h.name AS hotel_name
           FROM hotels h
        ), rooms_today AS (
         SELECT b.hotel_id,
            t.as_of_date,
            count(*)::integer AS occupied_today
           FROM bookings b
             CROSS JOIN today t
          WHERE date(b.scheduled_checkin_at) <= t.as_of_date AND date(b.scheduled_checkout_at) > t.as_of_date
          GROUP BY b.hotel_id, t.as_of_date
        ), orders_today AS (
         SELECT o.hotel_id,
            t.as_of_date,
            count(*)::integer AS orders_today,
            COALESCE(sum(COALESCE(o.price, 0::numeric) * GREATEST(COALESCE(o.qty, 1), 1)::numeric), 0::numeric) AS revenue_today
           FROM orders o
             CROSS JOIN today t
          WHERE (o.created_at AT TIME ZONE 'Asia/Kolkata'::text)::date = t.as_of_date
          GROUP BY o.hotel_id, t.as_of_date
        ), pickup_7d AS (
         SELECT b.hotel_id,
            t.as_of_date,
            count(*)::integer AS pickup_7d
           FROM bookings b
             CROSS JOIN today t
          WHERE date(b.scheduled_checkin_at) >= (t.as_of_date - '6 days'::interval) AND date(b.scheduled_checkin_at) <= t.as_of_date
          GROUP BY b.hotel_id, t.as_of_date
        ), rating_30d AS (
         -- Repointed: reviews.rating -> guest_reviews.overall_rating
         SELECT r.hotel_id,
            t.as_of_date,
            avg(r.overall_rating)::numeric(4,2) AS avg_rating_30d
           FROM guest_reviews r
             CROSS JOIN today t
          WHERE (r.created_at AT TIME ZONE 'Asia/Kolkata'::text)::date >= (t.as_of_date - '30 days'::interval) AND (r.created_at AT TIME ZONE 'Asia/Kolkata'::text)::date <= t.as_of_date
          GROUP BY r.hotel_id, t.as_of_date
        ), final AS (
         SELECT h.hotel_id,
            h.hotel_slug,
            h.hotel_name,
            t.as_of_date,
            COALESCE(rt.occupied_today, 0) AS occupied_today,
            COALESCE(ot.orders_today, 0) AS orders_today,
            COALESCE(ot.revenue_today, 0::numeric) AS revenue_today,
            COALESCE(pk.pickup_7d, 0) AS pickup_7d,
            r30.avg_rating_30d,
            now() AS updated_at
           FROM hotel_set h
             CROSS JOIN today t
             LEFT JOIN rooms_today rt ON rt.hotel_id = h.hotel_id AND rt.as_of_date = t.as_of_date
             LEFT JOIN orders_today ot ON ot.hotel_id = h.hotel_id AND ot.as_of_date = t.as_of_date
             LEFT JOIN pickup_7d pk ON pk.hotel_id = h.hotel_id AND pk.as_of_date = t.as_of_date
             LEFT JOIN rating_30d r30 ON r30.hotel_id = h.hotel_id AND r30.as_of_date = t.as_of_date
        )
 SELECT hotel_id,
    hotel_slug,
    hotel_name,
    as_of_date,
    occupied_today,
    orders_today,
    revenue_today,
    pickup_7d,
    avg_rating_30d,
    updated_at
   FROM final;

ALTER MATERIALIZED VIEW public.owner_dashboard_kpis OWNER TO postgres;
GRANT ALL ON public.owner_dashboard_kpis TO anon, authenticated, service_role;
