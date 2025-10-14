import { useEffect } from "react";

type JsonLd = Record<string, any>;

type Props = {
  title?: string;
  description?: string;
  canonical?: string;
  noIndex?: boolean;
  ogImage?: string;            // absolute or site-relative path
  twitter?: {
    site?: string;             // e.g. "@vaiyu"
    card?: "summary" | "summary_large_image";
  };
  jsonLd?: JsonLd | JsonLd[];  // schema.org payload(s)
};

/**
 * Production-ready SEO helper:
 * - <title>, meta description
 * - canonical link
 * - robots noindex
 * - Open Graph + Twitter tags
 * - JSON-LD (accepts single object or array)
 */
export default function SEO({
  title,
  description,
  canonical,
  noIndex,
  ogImage,
  twitter,
  jsonLd,
}: Props) {
  useEffect(() => {
    const head = document.head;

    // Title
    if (title) document.title = title;

    // Description
    setMeta("description", description);

    // Canonical
    setLink("canonical", canonical || undefined);

    // Robots
    setMeta("robots", noIndex ? "noindex, nofollow" : undefined);

    // Open Graph
    setMeta("og:title", title);
    setMeta("og:description", description);
    setMeta("og:type", "website");
    setMeta("og:url", canonical || location.href);
    if (ogImage) setMeta("og:image", absoluteUrl(ogImage));

    // Twitter
    const cardType = twitter?.card || (ogImage ? "summary_large_image" : "summary");
    setMeta("twitter:card", cardType);
    if (twitter?.site) setMeta("twitter:site", twitter.site);
    setMeta("twitter:title", title);
    setMeta("twitter:description", description);
    if (ogImage) setMeta("twitter:image", absoluteUrl(ogImage));

    // JSON-LD (remove any older script we inserted)
    removeOldLd();
    if (jsonLd) {
      const scripts = Array.isArray(jsonLd) ? jsonLd : [jsonLd];
      scripts.forEach((obj) => {
        const s = document.createElement("script");
        s.type = "application/ld+json";
        s.setAttribute("data-seo-ld", "true");
        s.text = JSON.stringify(obj);
        head.appendChild(s);
      });
    }

    // helpers
    function setMeta(name: string, content?: string) {
      const sel = name.startsWith("og:") || name.startsWith("twitter:")
        ? `meta[property="${name}"], meta[name="${name}"]`
        : `meta[name="${name}"]`;

      let el = head.querySelector<HTMLMetaElement>(sel);
      if (content) {
        if (!el) {
          el = document.createElement("meta");
          if (name.startsWith("og:")) el.setAttribute("property", name);
          else el.setAttribute("name", name);
          head.appendChild(el);
        }
        el.setAttribute("content", content);
      } else if (el) {
        head.removeChild(el);
      }
    }

    function setLink(rel: string, href?: string) {
      let el = head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
      if (href) {
        if (!el) {
          el = document.createElement("link");
          el.rel = rel;
          head.appendChild(el);
        }
        el.href = href;
      } else if (el) {
        head.removeChild(el);
      }
    }

    function absoluteUrl(path: string) {
      if (!path) return path;
      if (/^https?:\/\//i.test(path)) return path;
      return new URL(path, location.origin).toString();
    }

    function removeOldLd() {
      head.querySelectorAll('script[data-seo-ld="true"]').forEach((n) => n.remove());
    }
  }, [title, description, canonical, noIndex, ogImage, twitter?.site, twitter?.card, jsonLd]);

  return null;
}
