// web/scripts/publishSite.mjs <hotelId>
//
// Node stand-in for the publish action: assembles the payload from LIVE data and
// stores it as the hotel_sites publish snapshot (status=PUBLISHED). The production
// trigger is the `site-publish` edge function, which runs the SAME assemble logic
// after the publish-gate check. Kept here for local testing + as the reference.
//
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (required)
//   SITE_BASE   absolute site origin          (default: https://vaiyu.co.in)

import { createClient } from '@supabase/supabase-js';
import { assembleSitePayload } from '../../supabase/functions/_shared/assembleSitePayload.mjs';

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BASE = process.env.SITE_BASE || 'https://vaiyu.co.in';
const hotelId = process.argv[2];

if (!URL || !KEY || !hotelId) {
  console.error('usage: SUPABASE_URL=.. SUPABASE_SERVICE_ROLE_KEY=.. node scripts/publishSite.mjs <hotelId>');
  process.exit(1);
}

const supabase = createClient(URL, KEY, { auth: { persistSession: false } });

const payload = await assembleSitePayload(supabase, hotelId, { siteBase: BASE });
const { error } = await supabase.from('hotel_sites').upsert({
  hotel_id: hotelId,
  status: 'PUBLISHED',
  published_payload: payload,
  published_at: new Date().toISOString(),
}, { onConflict: 'hotel_id' });

if (error) {
  console.error('publishSite: failed —', error.message);
  process.exit(1);
}
console.log(`publishSite: ${payload.hotel.name} (${payload.hotel.slug}) — rooms:${payload.rooms.length} photos:${payload.gallery.length} reviews:${payload.reviews.length}`);
