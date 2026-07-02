// web/scripts/siteTemplate.mjs
//
// Self-contained luxury hotel microsite renderer.
//   renderSiteHTML(payload) -> a complete, static HTML document (embedded CSS,
//   JSON-LD, OG tags). No Tailwind/React/runtime deps — each published hotel page
//   is a standalone file the CDN serves as-is (best SEO + WhatsApp previews + LCP).
//
// The `payload` is exactly what a hotel_sites publish snapshot stores. The build
// generator assembles it from hotels + hotel_sites + hotel_asset_files (DAM) +
// room_types/rate_plan_prices + guest_reviews; this preview harness fakes it.

/** HTML-escape (all copy is user-authored → must be escaped in static output). */
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
/** Attribute-safe (for url/attr contexts). */
function att(s) { return esc(s); }
/** ₹ formatting, en-IN, no decimals. */
function inr(n) {
  if (n == null || Number.isNaN(Number(n))) return '';
  return '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}
/** Minimal markdown-ish: paragraphs from blank-line-separated text. */
function paras(md) {
  return String(md ?? '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
    .map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('\n');
}

function heroSection(p) {
  const img = p.hero?.imageUrl;
  return `
  <section class="hero" ${img ? `style="--hero:url('${att(img)}')"` : ''}>
    <div class="hero__scrim"></div>
    <div class="hero__inner">
      ${p.hotel.city ? `<p class="eyebrow eyebrow--light">${esc([p.hotel.city, p.hotel.state].filter(Boolean).join(', '))}</p>` : ''}
      <h1 class="hero__title">${esc(p.hotel.name)}</h1>
      ${p.tagline ? `<p class="hero__tagline">${esc(p.tagline)}</p>` : ''}
      <div class="hero__cta">
        <a class="btn btn--primary" href="${att(p.cta.href)}">${esc(p.cta.label)}</a>
        ${p.hotel.phone ? `<a class="btn btn--ghost" href="tel:${att(p.hotel.phone)}">Call ${esc(p.hotel.phone)}</a>` : ''}
      </div>
    </div>
    <div class="hero__scroll" aria-hidden="true">✦</div>
  </section>`;
}

function aboutSection(p) {
  if (!p.aboutMd && !p.tagline) return '';
  return `
  <section class="section section--about" id="about">
    <div class="wrap wrap--narrow center">
      <p class="eyebrow">The Property</p>
      <h2 class="display">${esc(p.aboutHeading || 'A stay to remember')}</h2>
      <div class="prose">${paras(p.aboutMd)}</div>
    </div>
  </section>`;
}

function roomsSection(p) {
  if (!p.rooms?.length) return '';
  const cards = p.rooms.map((r) => `
    <article class="room">
      ${r.imageUrl ? `<div class="room__img" style="background-image:url('${att(r.imageUrl)}')"></div>` : `<div class="room__img room__img--empty"></div>`}
      <div class="room__body">
        <h3 class="room__name">${esc(r.name)}</h3>
        ${r.description ? `<p class="room__desc">${esc(r.description)}</p>` : ''}
        <div class="room__meta">
          ${r.maxOccupancy ? `<span class="pill">Sleeps ${esc(r.maxOccupancy)}</span>` : ''}
          ${r.fromPriceInr != null ? `<span class="room__price">from <strong>${inr(r.fromPriceInr)}</strong><span class="room__per"> / night</span></span>` : ''}
        </div>
      </div>
    </article>`).join('\n');
  return `
  <section class="section section--rooms" id="rooms">
    <div class="wrap">
      <div class="section__head center">
        <p class="eyebrow">Stay</p>
        <h2 class="display">Rooms &amp; Suites</h2>
      </div>
      <div class="rooms">${cards}</div>
    </div>
  </section>`;
}

/** Thin line-icon per amenity (keyword match; elegant sparkle fallback). */
function amenityIcon(label) {
  const l = String(label || '').toLowerCase();
  const has = (kw) => kw.some((k) => l.includes(k));
  let d;
  if (has(['pool', 'swim'])) d = '<path d="M2 15c2 1.5 4 1.5 6 0s4-1.5 6 0 4 1.5 6 0"/><path d="M2 19c2 1.5 4 1.5 6 0s4-1.5 6 0 4 1.5 6 0"/>';
  else if (has(['spa', 'wellness', 'massage', 'sauna'])) d = '<path d="M12 21C7 18 5 14 5 10a7 7 0 0 1 14 0c0 4-2 8-7 11z"/><path d="M12 21V9"/>';
  else if (has(['wifi', 'wi-fi', 'internet'])) d = '<path d="M5 12.5a10 10 0 0 1 14 0"/><path d="M8.5 15.5a5 5 0 0 1 7 0"/><circle cx="12" cy="19" r=".6"/>';
  else if (has(['din', 'restaurant', 'food', 'breakfast', 'cuisine', 'kitchen'])) d = '<path d="M7 3v18M5 3v5a2 2 0 0 0 4 0V3"/><path d="M16 21V3c-1.6 1-2 3-2 5s.6 3 2 3.5"/>';
  else if (has(['park', 'valet', 'car'])) d = '<path d="M5 11l1.6-4A2 2 0 0 1 8.5 6h7a2 2 0 0 1 1.9 1L19 11M4 11h16v5H4z"/><circle cx="7.5" cy="16.5" r=".8"/><circle cx="16.5" cy="16.5" r=".8"/>';
  else if (has(['yoga', 'medit'])) d = '<circle cx="12" cy="12" r="3.2"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M6 6l1.6 1.6M16.4 16.4L18 18M18 6l-1.6 1.6M7.6 16.4L6 18"/>';
  else if (has(['librar', 'book', 'read'])) d = '<path d="M4 5a2 2 0 0 1 2-2h6v16H6a2 2 0 0 0-2 2zM20 5a2 2 0 0 0-2-2h-6"/>';
  else if (has(['bonfire', 'fire', 'campfire', 'hearth'])) d = '<path d="M12 3c.5 3 3 4 3 7a3 3 0 0 1-6 0c0-1.5.7-2.4 1.6-3 .1 1.3 1.4 1.3 1.4 0 0-1.2 0-2.8 0-4z"/>';
  else if (has(['bar', 'drink', 'wine', 'cocktail'])) d = '<path d="M6 4h12l-5 7v7M9 18h6"/>';
  else if (has(['gym', 'fitness', 'workout'])) d = '<path d="M4 9v6M7 7v10M17 7v10M20 9v6M7 12h10"/>';
  else if (has(['view', 'mountain', 'valley', 'ridge', 'hill', 'lake'])) d = '<path d="M3 18l5-9 4 5 3-4 6 8z"/>';
  else d = '<path d="M12 3l1.7 6.3L20 11l-6.3 1.7L12 19l-1.7-6.3L4 11l6.3-1.7z"/>';
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
}

function amenitiesSection(p) {
  if (!p.amenities?.length) return '';
  const items = p.amenities.map((a) => `<li class="amenity"><span class="amenity__ic">${amenityIcon(a)}</span><span>${esc(a)}</span></li>`).join('\n');
  return `
  <section class="section section--amenities" id="amenities">
    <div class="wrap center">
      <p class="eyebrow">Comfort</p>
      <h2 class="display">Amenities</h2>
      <ul class="amenities">${items}</ul>
    </div>
  </section>`;
}

function stripSection(p, key, id, eyebrow, heading) {
  const s = p[key];
  if (!s || (!s.intro && !(s.images?.length))) return '';
  const imgs = (s.images || []).map((im) => `<div class="strip__img" style="background-image:url('${att(im.url)}')" role="img" aria-label="${att(im.alt || heading)}"></div>`).join('\n');
  return `
  <section class="section section--strip" id="${id}">
    <div class="wrap">
      <div class="section__head center">
        <p class="eyebrow">${esc(eyebrow)}</p>
        <h2 class="display">${esc(heading)}</h2>
        ${s.intro ? `<p class="lede">${esc(s.intro)}</p>` : ''}
      </div>
      ${imgs ? `<div class="strip">${imgs}</div>` : ''}
    </div>
  </section>`;
}

function experiencesSection(p) {
  const s = p.experiences;
  if (!s || (!s.intro && !s.images?.length && !s.items?.length)) return '';
  const imgs = (s.images || []).slice(0, 2)
    .map((im) => `<div class="expo__img" style="background-image:url('${att(im.url)}')" role="img" aria-label="${att(im.alt || 'Experience')}"></div>`).join('\n');
  const items = (s.items || []).map((i) => `<li>${esc(i)}</li>`).join('\n');
  return `
  <section class="section section--exp" id="experiences">
    <div class="wrap grid2 grid2--exp">
      <div>
        <p class="eyebrow">Beyond the stay</p>
        <h2 class="display">Experiences</h2>
        ${s.intro ? `<p class="prose">${esc(s.intro)}</p>` : ''}
        ${items ? `<ul class="expo__list">${items}</ul>` : ''}
      </div>
      ${imgs ? `<div class="expo">${imgs}</div>` : ''}
    </div>
  </section>`;
}

function gallerySection(p) {
  if (!p.gallery?.length) return '';
  const tiles = p.gallery.map((g, i) => `<a class="tile tile--${(i % 5) + 1}" href="${att(g.imageUrl)}" style="background-image:url('${att(g.imageUrl)}')" aria-label="${att(g.alt || 'Photo')}"></a>`).join('\n');
  return `
  <section class="section section--gallery" id="gallery">
    <div class="wrap">
      <div class="section__head center">
        <p class="eyebrow">Gallery</p>
        <h2 class="display">Moments &amp; spaces</h2>
      </div>
      <div class="gallery">${tiles}</div>
    </div>
  </section>`;
}

function locationSection(p) {
  const loc = p.location;
  if (!loc || (!loc.intro && !loc.address && loc.lat == null)) return '';
  const hasGeo = loc.lat != null && loc.lng != null;
  const dLat = 0.008, dLng = 0.012;
  const bbox = hasGeo ? `${loc.lng - dLng},${loc.lat - dLat},${loc.lng + dLng},${loc.lat + dLat}` : '';
  // Keyless OpenStreetMap embed (Google's keyless embed is unreliable), plus a
  // deep link to Google Maps for actual turn-by-turn directions.
  const map = hasGeo
    ? `<iframe class="map" loading="lazy" title="Map of ${att(p.hotel.name)}" src="https://www.openstreetmap.org/export/embed.html?bbox=${att(bbox)}&amp;layer=mapnik&amp;marker=${att(loc.lat)},${att(loc.lng)}"></iframe>`
    : '';
  const directions = hasGeo
    ? `<a class="btn btn--outline" href="https://www.google.com/maps/search/?api=1&amp;query=${att(loc.lat)},${att(loc.lng)}" target="_blank" rel="noopener">Get directions</a>`
    : '';
  return `
  <section class="section section--location" id="location">
    <div class="wrap grid2">
      <div>
        <p class="eyebrow">Find us</p>
        <h2 class="display">Location</h2>
        ${loc.intro ? `<p class="prose">${esc(loc.intro)}</p>` : ''}
        ${loc.address ? `<p class="addr">${esc(loc.address)}</p>` : ''}
        ${p.hotel.phone ? `<p class="addr"><a href="tel:${att(p.hotel.phone)}">${esc(p.hotel.phone)}</a></p>` : ''}
        ${directions ? `<p style="margin-top:22px">${directions}</p>` : ''}
      </div>
      ${map ? `<div class="map__wrap">${map}</div>` : ''}
    </div>
  </section>`;
}

function reviewsSection(p) {
  if (!p.reviews?.length) return '';
  const stars = (n) => '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n);
  const cards = p.reviews.map((r) => `
    <figure class="quote">
      <div class="quote__stars" aria-label="${att(r.rating)} out of 5">${stars(r.rating)}</div>
      <blockquote>${esc(r.text)}</blockquote>
      ${r.author ? `<figcaption>— ${esc(r.author)}</figcaption>` : ''}
    </figure>`).join('\n');
  return `
  <section class="section section--reviews" id="reviews">
    <div class="wrap center">
      <p class="eyebrow">Guest voices</p>
      <h2 class="display">What guests say</h2>
      <div class="quotes">${cards}</div>
    </div>
  </section>`;
}

function ctaSection(p) {
  return `
  <section class="section section--cta" id="enquire">
    <div class="wrap center">
      <h2 class="display display--invert">Plan your stay</h2>
      <p class="lede lede--invert">Tell us your dates and we'll take care of the rest.</p>
      <a class="btn btn--primary btn--lg" href="${att(p.cta.href)}">${esc(p.cta.label)}</a>
    </div>
  </section>`;
}

function jsonLd(p) {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'LodgingBusiness',
    name: p.hotel.name,
    description: p.seo.description || p.tagline || undefined,
    url: p.seo.canonical || undefined,
    telephone: p.hotel.phone || undefined,
    image: [p.hero?.imageUrl, ...(p.gallery || []).slice(0, 4).map((g) => g.imageUrl)].filter(Boolean),
    address: (p.hotel.address || p.hotel.city) ? {
      '@type': 'PostalAddress',
      streetAddress: p.hotel.address || undefined,
      addressLocality: p.hotel.city || undefined,
      addressRegion: p.hotel.state || undefined,
      postalCode: p.hotel.postalCode || undefined,
      addressCountry: p.hotel.country || 'IN',
    } : undefined,
    geo: (p.location?.lat != null) ? { '@type': 'GeoCoordinates', latitude: p.location.lat, longitude: p.location.lng } : undefined,
    aggregateRating: p.aggregateRating ? {
      '@type': 'AggregateRating', ratingValue: p.aggregateRating.value, reviewCount: p.aggregateRating.count,
    } : undefined,
    priceRange: p.priceRange || undefined,
  };
  return JSON.stringify(data, (_k, v) => (v === undefined ? undefined : v));
}

/** Render the complete static HTML document for one hotel site. */
export function renderSiteHTML(p) {
  const accent = p.hotel.brandColor && /^#?[0-9a-fA-F]{3,8}$/.test(p.hotel.brandColor)
    ? (p.hotel.brandColor.startsWith('#') ? p.hotel.brandColor : '#' + p.hotel.brandColor)
    : '#9a7b4f';
  const title = p.seo.title || `${p.hotel.name}${p.hotel.city ? ' · ' + p.hotel.city : ''}`;
  const desc = p.seo.description || p.tagline || `${p.hotel.name} — book your stay.`;
  const og = p.seo.ogImage || p.hero?.imageUrl || '';
  const canon = p.seo.canonical || '';

  return `<!doctype html>
<html lang="${att(p.lang || 'en')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${att(desc)}">
${canon ? `<link rel="canonical" href="${att(canon)}">` : ''}
<meta property="og:type" content="website">
<meta property="og:title" content="${att(title)}">
<meta property="og:description" content="${att(desc)}">
${canon ? `<meta property="og:url" content="${att(canon)}">` : ''}
${og ? `<meta property="og:image" content="${att(og)}">` : ''}
<meta name="twitter:card" content="${og ? 'summary_large_image' : 'summary'}">
<meta name="twitter:title" content="${att(title)}">
<meta name="twitter:description" content="${att(desc)}">
${og ? `<meta name="twitter:image" content="${att(og)}">` : ''}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600&family=Jost:wght@300;400;500&display=swap" rel="stylesheet">
<script type="application/ld+json">${jsonLd(p)}</script>
<style>
:root{--accent:${accent};--ink:#20201d;--muted:#57524a;--line:#e7e1d8;--ivory:#faf8f4;--cream:#f2ede4;}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;font-family:'Jost',system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:var(--ink);background:var(--ivory);line-height:1.6;font-weight:300;-webkit-font-smoothing:antialiased}
h1,h2,h3{font-family:'Cormorant Garamond',Georgia,serif;font-weight:500;letter-spacing:.01em;margin:0}
a{color:inherit;text-decoration:none}
img{max-width:100%}
.wrap{max-width:1140px;margin:0 auto;padding:0 24px}
.wrap--narrow{max-width:760px}
.center{text-align:center}
.eyebrow{font-family:'Jost',sans-serif;text-transform:uppercase;letter-spacing:.28em;font-size:11px;color:var(--accent);font-weight:500;margin:0 0 14px}
.eyebrow--light{color:rgba(255,255,255,.85)}
.display{font-size:clamp(30px,4.4vw,52px);line-height:1.08;margin:0 0 18px}
.display--invert{color:#fff}
.lede{font-size:18px;color:var(--muted);max-width:640px;margin:0 auto}
.lede--invert{color:rgba(255,255,255,.82)}
.prose p{margin:0 0 16px;color:var(--muted);font-size:17px}
.section{padding:clamp(52px,7vw,96px) 0}
.section--about{background:var(--ivory)}
.section--rooms,.section--gallery{background:var(--cream)}
.section__head{margin-bottom:40px}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:15px 30px;border-radius:2px;font-family:'Jost',sans-serif;font-size:13px;letter-spacing:.16em;text-transform:uppercase;font-weight:400;transition:.25s;cursor:pointer;border:1px solid transparent}
.btn--primary{background:var(--accent);color:#fff}
.btn--primary:hover{filter:brightness(.92)}
.btn--ghost{background:transparent;border-color:rgba(255,255,255,.55);color:#fff}
.btn--ghost:hover{background:rgba(255,255,255,.12)}
.btn--lg{padding:18px 42px;font-size:14px}
.btn--outline{background:transparent;border-color:var(--accent);color:var(--accent)}
.btn--outline:hover{background:var(--accent);color:#fff}
.pill{display:inline-block;font-size:12px;letter-spacing:.06em;color:var(--muted);border:1px solid var(--line);border-radius:999px;padding:4px 12px}
/* nav */
.nav{position:absolute;top:0;left:0;right:0;z-index:5;display:flex;align-items:center;justify-content:space-between;padding:22px 24px;max-width:1140px;margin:0 auto}
.nav__brand{font-family:'Cormorant Garamond',serif;font-size:22px;color:#fff;letter-spacing:.04em}
.nav .btn{padding:11px 22px}
/* hero */
.hero{position:relative;min-height:92vh;display:flex;align-items:center;justify-content:center;text-align:center;color:#fff;background:#2a2622 var(--hero,none) center/cover no-repeat}
.hero__scrim{position:absolute;inset:0;background:linear-gradient(180deg,rgba(20,18,15,.55) 0%,rgba(20,18,15,.25) 40%,rgba(20,18,15,.7) 100%)}
.hero__inner{position:relative;z-index:2;padding:0 24px;max-width:820px}
.hero__title{font-size:clamp(44px,8vw,92px);line-height:1;margin:8px 0 18px;font-weight:500}
.hero__tagline{font-family:'Cormorant Garamond',serif;font-style:italic;font-size:clamp(19px,2.6vw,27px);color:rgba(255,255,255,.9);margin:0 0 34px;font-weight:400}
.hero__cta{display:flex;gap:14px;justify-content:center;flex-wrap:wrap}
.hero__scroll{position:absolute;bottom:26px;left:0;right:0;z-index:2;color:rgba(255,255,255,.8);font-size:14px;animation:float 2.4s ease-in-out infinite}
@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(7px)}}
/* rooms */
.rooms{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:28px}
.room{background:var(--ivory);border:1px solid var(--line);border-radius:3px;overflow:hidden;display:flex;flex-direction:column}
.room__img{height:230px;background:#ded7cc center/cover no-repeat}
.room__img--empty{background:linear-gradient(135deg,#e7e1d8,#d7cdbf)}
.room__body{padding:26px}
.room__name{font-size:26px;margin-bottom:10px}
.room__desc{color:var(--muted);font-size:15px;margin:0 0 18px}
.room__meta{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;border-top:1px solid var(--line);padding-top:16px}
.room__price{font-size:14px;color:var(--muted)}
.room__price strong{font-family:'Cormorant Garamond',serif;font-size:24px;color:var(--ink);font-weight:600}
.room__per{color:var(--muted)}
/* amenities */
.amenities{list-style:none;padding:0;margin:48px 0 0;display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:34px 20px}
.amenity{display:flex;flex-direction:column;align-items:center;gap:12px;text-align:center;font-size:14px;letter-spacing:.03em;color:var(--ink)}
.amenity__ic{color:var(--accent)}
.amenity__ic svg{width:30px;height:30px;stroke:currentColor;fill:none;stroke-width:1.3;stroke-linecap:round;stroke-linejoin:round}
/* strip (dining/experiences) */
.strip{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin-top:44px}
.strip__img{height:280px;background:#ded7cc center/cover no-repeat;border-radius:3px}
/* experiences (distinct editorial split) */
.section--exp{background:var(--ivory)}
.grid2--exp{align-items:center}
.expo{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.expo__img{height:300px;background:#ded7cc center/cover no-repeat;border-radius:3px}
.expo__img:first-child{margin-top:36px}
.expo__list{list-style:none;padding:0;margin:24px 0 0}
.expo__list li{padding:11px 0 11px 22px;border-bottom:1px solid var(--line);position:relative;color:var(--ink);font-size:15px}
.expo__list li:before{content:'✦';position:absolute;left:0;top:12px;color:var(--accent);font-size:11px}
/* gallery */
.gallery{display:grid;grid-template-columns:repeat(4,1fr);grid-auto-rows:200px;gap:12px}
.tile{background:#ded7cc center/cover no-repeat;border-radius:2px;display:block;transition:.4s;filter:saturate(.95)}
.tile:hover{filter:saturate(1.1) brightness(1.03)}
.tile--1{grid-column:span 2;grid-row:span 2}
.tile--4{grid-column:span 2}
/* location */
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:44px;align-items:center}
.addr{color:var(--muted);margin:6px 0}
.map__wrap{border-radius:3px;overflow:hidden;border:1px solid var(--line)}
.map{width:100%;height:340px;border:0;display:block}
/* reviews */
.quotes{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:26px;margin-top:44px;text-align:left}
.quote{margin:0;background:var(--ivory);border:1px solid var(--line);border-radius:3px;padding:30px}
.quote__stars{color:var(--accent);letter-spacing:3px;margin-bottom:14px}
.quote blockquote{margin:0 0 16px;font-family:'Cormorant Garamond',serif;font-size:21px;line-height:1.4;color:var(--ink)}
.quote figcaption{color:var(--muted);font-size:14px;letter-spacing:.05em}
/* cta */
.section--cta{background:#20201d center/cover no-repeat}
.section--cta .display{margin-bottom:14px}
/* footer */
.foot{background:#17150f;color:rgba(255,255,255,.7);padding:56px 0 40px;text-align:center}
.foot__name{font-family:'Cormorant Garamond',serif;font-size:26px;color:#fff;margin-bottom:10px}
.foot__row{font-size:14px;margin:4px 0}
.foot__credit{margin-top:26px;font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:rgba(255,255,255,.4)}
/* sticky enquire */
.sticky{position:fixed;right:20px;bottom:20px;z-index:20;opacity:0;transition:opacity .3s}
.sticky .btn{box-shadow:0 8px 24px rgba(0,0,0,.22)}
@media(max-width:820px){.grid2{grid-template-columns:1fr}.gallery{grid-template-columns:repeat(2,1fr);grid-auto-rows:160px}.tile--1{grid-column:span 2;grid-row:span 1}}
</style>
</head>
<body>
<nav class="nav">
  <span class="nav__brand">${esc(p.hotel.name)}</span>
  <a class="btn btn--ghost" href="#enquire">Enquire</a>
</nav>
${heroSection(p)}
${aboutSection(p)}
${roomsSection(p)}
${amenitiesSection(p)}
${stripSection(p, 'dining', 'dining', 'Dining', 'Food & dining')}
${experiencesSection(p)}
${gallerySection(p)}
${locationSection(p)}
${reviewsSection(p)}
${ctaSection(p)}
<footer class="foot">
  <div class="wrap">
    <div class="foot__name">${esc(p.hotel.name)}</div>
    ${p.hotel.address ? `<div class="foot__row">${esc(p.hotel.address)}</div>` : ''}
    <div class="foot__row">${[p.hotel.city, p.hotel.state, p.hotel.country].filter(Boolean).map(esc).join(', ')}</div>
    ${p.hotel.phone ? `<div class="foot__row"><a href="tel:${att(p.hotel.phone)}">${esc(p.hotel.phone)}</a></div>` : ''}
    <div class="foot__credit">Powered by VAiyu</div>
  </div>
</footer>
<div class="sticky"><a class="btn btn--primary" href="#enquire">Enquire now</a></div>
<script>(function(){var s=document.querySelector('.sticky');if(!s)return;var h=document.querySelector('.hero');function u(){var t=h?h.offsetHeight-80:400;var on=window.scrollY>t;s.style.opacity=on?'1':'0';s.style.pointerEvents=on?'auto':'none';}window.addEventListener('scroll',u,{passive:true});u();})();</script>
</body>
</html>`;
}
