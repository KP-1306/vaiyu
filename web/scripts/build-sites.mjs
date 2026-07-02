// web/scripts/build-sites.mjs
//
// Static site generator. Reads PUBLISHED hotel-site snapshots and emits one
// static HTML file per hotel + sitemap.xml + robots.txt.
//
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (required)
//   SITES_OUT   output dir            (default: dist-sites)
//   SITE_BASE   absolute site origin  (default: https://vaiyu.co.in)
//
// Renders from published_payload only (the publish snapshot) — never from draft
// data — so in-progress edits can't leak onto the live site.

import { createClient } from '@supabase/supabase-js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { renderSiteHTML } from './siteTemplate.mjs';

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OUT = process.env.SITES_OUT || 'dist-sites';
const BASE = (process.env.SITE_BASE || 'https://vaiyu.co.in').replace(/\/$/, '');

if (!URL || !KEY) {
  console.warn('build-sites: no SUPABASE creds in env — skipping hotel-site generation (fine for local / PR builds).');
  process.exit(0);
}

const supabase = createClient(URL, KEY, { auth: { persistSession: false } });

const { data: sites, error } = await supabase
  .from('v_public_hotel_sites')
  .select('hotel_id,slug,name,published_payload,published_at');

if (error) {
  console.error('build-sites: query failed —', error.message);
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });
const urls = [];
let n = 0;

for (const s of (sites || [])) {
  if (!s.published_payload || !s.slug) {
    console.warn('  · skip (no payload/slug):', s.hotel_id);
    continue;
  }
  // Defence-in-depth: never emit a static file that would shadow an app route.
  // The DB slug guard blocks new reserved slugs; this catches any grandfathered
  // slug that predates the guard.
  const { data: reserved } = await supabase.rpc('is_reserved_hotel_slug', { p_slug: s.slug });
  if (reserved === true) {
    console.warn('  · skip (reserved slug — would shadow an app route):', s.slug);
    continue;
  }
  const payload = s.published_payload;
  payload.seo = payload.seo || {};
  payload.seo.canonical = `${BASE}/${s.slug}`; // pin canonical to this deploy origin
  const html = renderSiteHTML(payload);
  const dir = join(OUT, s.slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), html);
  urls.push({ loc: `${BASE}/${s.slug}`, lastmod: String(s.published_at || new Date().toISOString()).slice(0, 10) });
  n++;
  console.log('  ✓', s.slug, `(${html.length} bytes)`);
}

const sitemap =
  `<?xml version="1.0" encoding="UTF-8"?>\n` +
  `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  urls.map((u) => `  <url><loc>${u.loc}</loc><lastmod>${u.lastmod}</lastmod></url>`).join('\n') +
  `\n</urlset>\n`;
// Separate sitemap so we never clobber the app's dist/sitemap.xml (written by
// generate-sitemap.mjs). The app's public/robots.txt references sitemap-hotels.xml.
writeFileSync(join(OUT, 'sitemap-hotels.xml'), sitemap);

console.log(`\nbuild-sites: generated ${n} site(s) + sitemap-hotels.xml → ${OUT}/`);
