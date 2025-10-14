import { useEffect } from "react";

type Props = {
  title?: string;                 // Page title without brand suffix
  description?: string;           // Meta description
  canonical?: string;             // Absolute URL for canonical tag
  noIndex?: boolean;              // If true -> robots:noindex, nofollow
  ogImage?: string;               // Absolute URL to OG/Twitter image
  jsonLd?: Record<string, any>;   // Structured data (JSON-LD)
  brandSuffix?: string;           // Defaults to " · VAiyu"
};

function upsertMeta(attr: { name?: string; property?: string }, content?: string) {
  if (!attr.name && !attr.property) return;
  const selector = attr.name
    ? `meta[name="${attr.name}"]`
    : `meta[property="${attr.property}"]`;
  let el = document.head.querySelector(selector) as HTMLMetaElement | null;
  if (!content) {
    el?.parentElement?.removeChild(el);
    return;
  }
  if (!el) {
    el = document.createElement("meta");
    if (attr.name) el.name = attr.name;
    if (attr.property) el.setAttribute("property", attr.property);
    document.head.appendChild(el);
  }
  el.content = content;
}

function upsertLink(rel: string, href?: string) {
  const selector = `link[rel="${rel}"]`;
  let el = document.head.querySelector(selector) as HTMLLinkElement | null;
  if (!href) {
    el?.parentElement?.removeChild(el);
    return;
  }
  if (!el) {
    el = document.createElement("link");
    el.rel = rel;
    document.head.appendChild(el);
  }
  el.href = href;
}

function upsertJsonLd(id: string, data?: Record<string, any>) {
  const selector = `script[type="application/ld+json"][data-id="${id}"]`;
  let el = document.head.querySelector(selector) as HTMLScriptElement | null;
  if (!data) {
    el?.parentElement?.removeChild(el);
    return;
  }
  if (!el) {
    el = document.createElement("script");
    el.type = "application/ld+json";
    el.setAttribute("data-id", id);
    document.head.appendChild(el);
  }
  el.text = JSON.stringify(data);
}

export default function SEO({
  title,
  description = "AI for hotels: truth-anchored reviews, refer-and-earn growth, and grid-interactive operations.",
  canonical,
  noIndex,
  ogImage,
  jsonLd,
  brandSuffix = " · VAiyu",
}: Props) {
  useEffect(() => {
    // Compose title
    const fullTitle = title ? `${title}${brandSuffix}` : `VAiyu — Where Intelligence Meets Comfort`;
    document.title = fullTitle;

    // Description
    upsertMeta({ name: "description" }, description);

    // Canonical
    upsertLink("canonical", canonical);

    // Robots
    if (noIndex) {
      upsertMeta({ name: "robots" }, "noindex, nofollow");
    } else {
      // Prefer removing robots tag so default indexing applies
      upsertMeta({ name: "robots" }, undefined);
    }

    // Open Graph (social)
    const url = canonical || (typeof window !== "undefined" ? window.location.href : undefined);
    upsertMeta({ property: "og:title" }, fullTitle);
    upsertMeta({ property: "og:description" }, description);
    upsertMeta({ property: "og:type" }, "website");
    if (url) upsertMeta({ property: "og:url" }, url);
    if (ogImage) upsertMeta({ property: "og:image" }, ogImage);

    // Twitter
    upsertMeta({ name: "twitter:card" }, ogImage ? "summary_large_image" : "summary");
    upsertMeta({ name: "twitter:title" }, fullTitle);
    upsertMeta({ name: "twitter:description" }, description);
    if (ogImage) upsertMeta({ name: "twitter:image" }, ogImage);

    // JSON-LD structured data (optional)
    upsertJsonLd("page-ld", jsonLd);

    // Cleanup is intentionally omitted so tags persist during client navigation
    // (they will be updated/removed by subsequent calls)
  }, [title, description, canonical, noIndex, ogImage, jsonLd, brandSuffix]);

  return null;
}
