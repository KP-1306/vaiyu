// Generates dist/sitemap.xml during build
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const SITE_URL = process.env.SITE_URL || "https://vaiyu.co.in";

// Public, indexable paths only (don’t include owner/staff/grid)
const ROUTES = [
  "/", "/about", "/about-ai", "/press",
  "/privacy", "/terms", "/contact", "/careers",
  "/status", "/demo"
];

// Change frequency hints (optional)
const FREQ = {
  "/": "weekly",
  "/press": "weekly",
};

const lastmod = new Date().toISOString().slice(0, 10);

const urls = ROUTES.map((p) => {
  const loc = `${SITE_URL}${p}`;
  const changefreq = FREQ[p] || "monthly";
  const priority = p === "/" ? "1.0" : "0.7";
  return `
  <url>
    <loc>${loc}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`;
}).join("");

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;

const outDir = resolve("dist");
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, "sitemap.xml"), xml, "utf8");

console.log(`✓ sitemap.xml written with ${ROUTES.length} routes → ${resolve(outDir, "sitemap.xml")}`);
