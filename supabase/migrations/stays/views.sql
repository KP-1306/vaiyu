-- ============================================================
-- STAY VIEWS
-- ============================================================

-- Guest Mobile App View
-- Shows stay details for logged-in guest
CREATE OR REPLACE VIEW user_stay_detail AS
SELECT
  s.id                 AS stay_id,
  s.guest_id           AS user_id,
  s.hotel_id,
  s.check_in_start     AS checkin_at,
  s.check_out_end      AS checkout_at,
  s.status::text       AS status,
  s.source,
  r.number             AS room_number,
  h.name               AS hotel_name,
  h.slug
FROM stays s
JOIN hotels h
  ON h.id = s.hotel_id
JOIN rooms r
  ON r.id = s.room_id
WHERE s.guest_id = auth.uid();

GRANT SELECT ON user_stay_detail TO authenticated;
