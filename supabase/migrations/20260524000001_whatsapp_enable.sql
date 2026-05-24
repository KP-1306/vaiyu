-- WhatsApp enablement toggle
--
-- Adds an owner-controlled boolean so a hotel must explicitly opt in to the
-- WhatsApp notification channel. Default false → safe to ship before any
-- hotel has a verified Meta Business number, since the send-notifications
-- worker checks both this flag and `wa_phone_number_id` before dispatch.
--
-- Pairs with two pre-existing columns on `hotels`:
--   - wa_phone_number_id  text  (Meta phone_number_id; required for sending)
--   - wa_display_number   text  (E.164 number shown to guests on QR posters)

ALTER TABLE public.hotels
  ADD COLUMN IF NOT EXISTS whatsapp_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.hotels.whatsapp_enabled IS
  'Owner-controlled WhatsApp opt-in. When false, WhatsApp-channel notifications are skipped even if wa_phone_number_id is set.';
