CREATE OR REPLACE FUNCTION trg_validate_stay_room_hotel()
RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM rooms r
    WHERE r.id = NEW.room_id
      AND r.hotel_id = NEW.hotel_id
  ) THEN
    RAISE EXCEPTION
      'Room % does not belong to hotel %',
      NEW.room_id, NEW.hotel_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


CREATE TRIGGER validate_stay_room_hotel
BEFORE INSERT OR UPDATE ON stays
FOR EACH ROW
EXECUTE FUNCTION trg_validate_stay_room_hotel();
