// web/scripts/previewSite.mjs
// Renders the luxury template with a sample payload to an HTML file, so we can
// screenshot the DESIGN before wiring the DB-driven generator. Photos here are
// placeholder stock images (Unsplash) — the real generator uses DAM photos.
//
//   node web/scripts/previewSite.mjs  ->  writes .playwright-mcp/preview-site.html

import { writeFileSync, mkdirSync } from 'node:fs';
import { renderSiteHTML } from './siteTemplate.mjs';

const U = (id, w = 1600) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=${w}&q=70`;

const payload = {
  lang: 'en',
  hotel: {
    name: 'The Kafal House',
    slug: 'the-kafal-house',
    city: 'Nainital', state: 'Uttarakhand', country: 'India',
    address: 'Ayarpatta Slopes, Mallital, Nainital 263001',
    phone: '+91 94100 12345',
    brandColor: '#9a7b4f',
    postalCode: '263001',
  },
  seo: {
    title: 'The Kafal House · Luxury lake-view retreat in Nainital',
    description: 'A Himalayan hideaway above Naini Lake — heritage suites, Kumaoni dining, and the quiet of the hills.',
    canonical: 'https://vaiyu.co.in/the-kafal-house',
    ogImage: U('1566073771259-6a8506099945'),
  },
  tagline: 'A Himalayan hideaway above the lake.',
  aboutHeading: 'Where the hills exhale',
  aboutMd: `Perched on the Ayarpatta slopes, The Kafal House is a restored colonial estate looking out over Naini Lake and the Kumaon range beyond. Nine individually styled rooms, wood fires, and mornings that begin with mist lifting off the water.

Named for the wild Himalayan kafal berry, the house keeps the pace of the hills — slow breakfasts, long walks, and evenings by the bonfire under a sky thick with stars.`,
  hero: { imageUrl: U('1566073771259-6a8506099945'), alt: 'Hotel exterior at dusk' },
  rooms: [
    { name: 'Valley Deluxe', description: 'A warm room with a private balcony framing the Kumaon ridgeline.', fromPriceInr: 6500, maxOccupancy: 2, imageUrl: U('1611892440504-42a792e24d32', 1000) },
    { name: 'Lake-View Suite', description: 'Our signature suite — bay windows over Naini Lake and a claw-foot tub.', fromPriceInr: 12000, maxOccupancy: 3, imageUrl: U('1582719478250-c89cae4dc85b', 1000) },
    { name: 'Kumaoni Cottage', description: 'A standalone stone cottage with a fireplace and a private garden.', fromPriceInr: 9000, maxOccupancy: 4, imageUrl: U('1618773928121-c32242e63f39', 1000) },
  ],
  amenities: ['Heated lake-view pool', 'Himalayan spa', 'Fireside dining', 'Evening bonfire', 'Complimentary Wi-Fi', 'Valet parking', 'Curated library', 'Sunrise yoga deck'],
  dining: {
    intro: 'Kumaoni thalis, wood-fired breads, and single-estate teas served on the terrace as the valley wakes.',
    images: [{ url: U('1517248135467-4c7edcad34c4', 800), alt: 'Dining terrace' }, { url: U('1414235077428-338989a2e8c0', 800), alt: 'Plated dinner' }, { url: U('1467003909585-2f8a72700288', 800), alt: 'Local cuisine' }],
  },
  experiences: {
    intro: 'Guided ridge walks, boat mornings on the lake, and visits to the Naina Devi temple — arranged by our concierge.',
    items: ['Guided ridge walks at dawn', 'Boating on Naini Lake', 'Naina Devi temple darshan', 'Sunrise at Tiffin Top', 'Kumaoni cooking session'],
    images: [{ url: U('1506905925346-21bda4d32df4', 900), alt: 'Mountain trail' }, { url: U('1470071459604-3b5ec3a7fe05', 900), alt: 'Misty forest' }],
  },
  gallery: [
    { imageUrl: U('1571896349842-33c89424de2d', 1000), alt: 'Suite interior' },
    { imageUrl: U('1540555700478-4be289fbecef', 800), alt: 'Spa' },
    { imageUrl: U('1445019980597-93fa8acb246c', 800), alt: 'Breakfast' },
    { imageUrl: U('1520250497591-112f2f40a3f4', 800), alt: 'Bathroom' },
    { imageUrl: U('1596394516093-501ba68a0ba6', 800), alt: 'Lounge' },
    { imageUrl: U('1600585154340-be6161a56a0c', 800), alt: 'Room detail' },
  ],
  location: {
    intro: 'Fifteen minutes above the Mallital bazaar, yet a world away from it. Kathgodam railhead is a scenic 35 km drive.',
    address: 'Ayarpatta Slopes, Mallital, Nainital 263001',
    lat: 29.3919, lng: 79.4542,
  },
  reviews: [
    { rating: 5, text: 'The most beautiful stay of our lives. Woke up to clouds below the balcony.', author: 'Ananya & Rahul, Delhi' },
    { rating: 5, text: 'Impeccable service and the food — those Kumaoni breakfasts! We did not want to leave.', author: 'The Menon family, Bengaluru' },
    { rating: 4, text: 'Heritage charm done right. The bonfire evenings were magical.', author: 'Priya S., Mumbai' },
  ],
  aggregateRating: { value: 4.8, count: 126 },
  priceRange: '₹₹₹',
  cta: { href: '#enquire', label: 'Enquire' },
};

const html = renderSiteHTML(payload);
mkdirSync('.playwright-mcp', { recursive: true });
writeFileSync('.playwright-mcp/preview-site.html', html);
console.log('wrote .playwright-mcp/preview-site.html (' + html.length + ' bytes)');
