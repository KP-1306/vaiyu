export type AnalyticsProvider = "ga4" | "plausible" | "mixpanel" | "";
const provider = (import.meta.env.VITE_ANALYTICS_PROVIDER || "") as AnalyticsProvider;

let inited = false;

export function initAnalytics() {
  if (inited || typeof window === "undefined" || !provider) return;
  inited = true;

  if (provider === "ga4") {
    const id = import.meta.env.VITE_GA4_ID;
    if (!id) return;

    // Load GA4 library
    const s = document.createElement("script");
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${id}`;
    document.head.appendChild(s);

    // Minimal boot
    (window as any).dataLayer = (window as any).dataLayer || [];
    (window as any).gtag = function gtag() {
      (window as any).dataLayer.push(arguments);
    };
    (window as any).gtag("js", new Date());
    (window as any).gtag("config", id);
  }

  if (provider === "plausible") {
    const domain = import.meta.env.VITE_PLAUSIBLE_DOMAIN;
    if (!domain) return;

    const s = document.createElement("script");
    s.async = true;
    s.setAttribute("data-domain", domain);
    s.src = "https://plausible.io/js/script.js";
    document.head.appendChild(s);
  }

  if (provider === "mixpanel") {
    const token = import.meta.env.VITE_MIXPANEL_TOKEN;
    if (!token) return;

    const s = document.createElement("script");
    s.async = true;
    s.src = "https://cdn.mxpnl.com/libs/mixpanel-2-latest.min.js";
    s.onload = () => {
      (window as any).mixpanel?.init?.(token, { debug: false, track_pageview: true });
    };
    document.head.appendChild(s);
  }
}

export function track(event: string, props: Record<string, any> = {}) {
  if (!provider || typeof window === "undefined") return;

  if (provider === "ga4") {
    (window as any).gtag?.("event", event, props);
  } else if (provider === "plausible") {
    (window as any).plausible?.(event, { props });
  } else if (provider === "mixpanel") {
    (window as any).mixpanel?.track?.(event, props);
  }
}
