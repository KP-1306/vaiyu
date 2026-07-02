// web/scripts/assembleSitePayload.mjs
//
// assembleSitePayload(supabase, hotelId, opts) -> payload (the hotel_sites
// publish snapshot / renderSiteHTML input).
//
// PORTABLE: it receives an already-created supabase client (service role), so the
// same logic runs in the Node generator AND the Deno publish edge function. It
// uses only supabase-js query methods — no Node/Deno-specific APIs.
//
// Photos come from the DAM (hotel_asset_files in the public hotel-assets bucket),
// filtered to COLLECTED/APPROVED. Rooms/rates from room_types + rate_plan_prices.
// Reviews from public guest_reviews. Copy from hotel_sites. Identity from hotels.

const PUB_BUCKET = 'hotel-assets';

// DAM requirement_code -> template section grouping
const GROUP = {
  cover:      ['trust_cover_image', 'trust_view_surroundings'],
  rooms:      ['trust_room_photos', 'operational_room_category_images'],
  dining:     ['trust_dining_food', 'operational_menu_photo'],
  common:     ['trust_common_areas', 'trust_bathroom_photos', 'trust_parking'],
  experience: ['experience_local_attractions', 'experience_packages', 'experience_trek_tour',
               'experience_temple_spiritual', 'experience_wellness_yoga', 'experience_seasonal_offers'],
};

export async function assembleSitePayload(supabase, hotelId, opts = {}) {
  const base = (opts.siteBase || 'https://vaiyu.co.in').replace(/\/$/, '');
  const pub = (path) => supabase.storage.from(PUB_BUCKET).getPublicUrl(path).data.publicUrl;

  const [hotelRes, siteRes, roomsRes, priceRes, revRes, fileRes] = await Promise.all([
    supabase.from('hotels').select('id,slug,name,city,state,country,address,phone,email,brand_color,latitude,longitude,postal_code,booking_url,description,amenities,cover_image_path,logo_path').eq('id', hotelId).maybeSingle(),
    supabase.from('hotel_sites').select('*').eq('hotel_id', hotelId).maybeSingle(),
    supabase.from('room_types').select('id,name,description,max_occupancy').eq('hotel_id', hotelId).eq('is_active', true),
    supabase.from('rate_plan_prices').select('room_type_id,price').eq('hotel_id', hotelId),
    supabase.from('guest_reviews').select('overall_rating,review_text,is_anonymous,guest_id,created_at').eq('hotel_id', hotelId).eq('is_public', true).order('created_at', { ascending: false }),
    supabase.from('hotel_asset_files').select('id,storage_path,alt_text,sort_order,hotel_assets!inner(requirement_code,status)').eq('hotel_id', hotelId).eq('bucket', PUB_BUCKET),
  ]);

  const hotel = hotelRes.data;
  if (!hotel) throw new Error(`hotel_not_found: ${hotelId}`);
  const site = siteRes.data || {};

  // ── photos ─────────────────────────────────────────────────────────────────
  const files = (fileRes.data || []).filter((f) => ['COLLECTED', 'APPROVED'].includes(f.hotel_assets?.status));
  const inGroup = (g) => files
    .filter((f) => GROUP[g].includes(f.hotel_assets?.requirement_code))
    .sort((a, b) => (a.sort_order - b.sort_order))
    .map((f) => ({ id: f.id, url: pub(f.storage_path), alt: f.alt_text || '' }));
  const coverPics = inGroup('cover'), roomPics = inGroup('rooms'), diningPics = inGroup('dining'), commonPics = inGroup('common'), expPics = inGroup('experience');

  // hero: explicit pick, else first cover/room/common photo, else the cover set in
  // Hotel Settings. hotels.cover_image_path is stored as a full public URL, so the
  // settings cover reaches the site even when no DAM gallery photo has been uploaded.
  let hero = null;
  if (site.hero_asset_file_id) {
    const hf = files.find((f) => f.id === site.hero_asset_file_id);
    if (hf) hero = { imageUrl: pub(hf.storage_path), alt: hf.alt_text || hotel.name };
  }
  if (!hero) {
    const first = coverPics[0] || roomPics[0] || commonPics[0] || null;
    if (first) hero = { imageUrl: first.url, alt: first.alt || hotel.name };
    else if (hotel.cover_image_path) hero = { imageUrl: hotel.cover_image_path, alt: hotel.name };
  }
  // og image pick
  let ogImage = hero?.imageUrl || null;
  if (site.og_asset_file_id) {
    const of = files.find((f) => f.id === site.og_asset_file_id);
    if (of) ogImage = pub(of.storage_path);
  }

  // gallery: a curated pool across categories (deduped), cap 12
  const seen = new Set();
  const gallery = [...coverPics, ...roomPics, ...commonPics, ...diningPics, ...expPics]
    .filter((g) => (seen.has(g.url) ? false : (seen.add(g.url), true)))
    .slice(0, 12)
    .map((g) => ({ imageUrl: g.url, alt: g.alt }));

  // ── rooms + "from" price ─────────────────────────────────────────────────────
  const priceByRoom = {};
  for (const p of (priceRes.data || [])) {
    const v = Number(p.price);
    if (!Number.isFinite(v)) continue;
    if (priceByRoom[p.room_type_id] == null || v < priceByRoom[p.room_type_id]) priceByRoom[p.room_type_id] = v;
  }
  const rooms = (roomsRes.data || []).map((r, i) => ({
    name: r.name,
    description: r.description || '',
    maxOccupancy: r.max_occupancy || null,
    fromPriceInr: priceByRoom[r.id] ?? null,
    imageUrl: roomPics[i]?.url || coverPics[i + 1]?.url || null,
  }));

  // ── reviews + aggregate ──────────────────────────────────────────────────────
  const allRev = revRes.data || [];
  const guestIds = [...new Set(allRev.filter((r) => !r.is_anonymous && r.guest_id).map((r) => r.guest_id))];
  let names = {};
  if (guestIds.length) {
    const { data: profs } = await supabase.from('profiles').select('id,full_name').in('id', guestIds);
    names = Object.fromEntries((profs || []).map((p) => [p.id, p.full_name]));
  }
  const reviews = allRev
    .filter((r) => (r.review_text || '').trim())
    .slice(0, 6)
    .map((r) => ({
      rating: Math.max(1, Math.min(5, r.overall_rating || 5)),
      text: r.review_text.trim(),
      author: r.is_anonymous ? 'A verified guest' : (names[r.guest_id] || 'A verified guest'),
    }));
  const ratings = allRev.map((r) => r.overall_rating).filter((n) => Number.isFinite(n));
  const aggregateRating = ratings.length
    ? { value: +(ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1), count: ratings.length }
    : null;

  // price range hint from room rates
  const priceVals = Object.values(priceByRoom);
  const maxPrice = priceVals.length ? Math.max(...priceVals) : null;
  const priceRange = maxPrice == null ? undefined : (maxPrice < 4000 ? '₹₹' : maxPrice < 9000 ? '₹₹₹' : '₹₹₹₹');

  // ── CTA ──────────────────────────────────────────────────────────────────────
  const useBooking = site.cta_mode === 'booking_url' && hotel.booking_url;
  const cta = useBooking
    ? { href: hotel.booking_url, label: 'Book now' }
    : { href: `${base}/p/${hotel.slug}/enquire`, label: 'Enquire' };

  return {
    lang: opts.lang || 'en',
    hotel: {
      name: hotel.name, slug: hotel.slug,
      city: hotel.city, state: hotel.state, country: hotel.country,
      address: hotel.address, phone: hotel.phone, email: hotel.email,
      brandColor: hotel.brand_color, postalCode: hotel.postal_code, bookingUrl: hotel.booking_url,
    },
    seo: {
      title: site.seo_title || `${hotel.name}${hotel.city ? ' · ' + hotel.city : ''}`,
      description: site.seo_description || site.tagline || hotel.description || `${hotel.name} — book your stay.`,
      canonical: `${base}/${hotel.slug}`,
      ogImage,
    },
    tagline: site.tagline || '',
    aboutMd: site.about_md || hotel.description || '',
    hero,
    rooms,
    amenities: Array.isArray(hotel.amenities) ? hotel.amenities : [],
    dining: { intro: site.dining_intro || '', images: diningPics.map((g) => ({ url: g.url, alt: g.alt })) },
    experiences: { intro: site.experiences_intro || '', items: [], images: expPics.map((g) => ({ url: g.url, alt: g.alt })) },
    gallery,
    location: { intro: site.location_intro || '', address: hotel.address, lat: hotel.latitude, lng: hotel.longitude },
    reviews,
    aggregateRating,
    priceRange,
    cta,
  };
}
