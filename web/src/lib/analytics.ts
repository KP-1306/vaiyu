export type AnalyticsProvider = 'ga4'|'plausible'|'mixpanel'|'';
const provider = (import.meta.env.VITE_ANALYTICS_PROVIDER||'') as AnalyticsProvider;


export function track(event: string, props: Record<string,any> = {}) {
if (!provider) return;
if (provider==='ga4' && typeof window !== 'undefined') {
// @ts-ignore
window.gtag && window.gtag('event', event, props);
} else if (provider==='plausible' && typeof window !== 'undefined') {
// @ts-ignore
window.plausible && window.plausible(event, { props });
} else if (provider==='mixpanel' && typeof window !== 'undefined' && (window as any).mixpanel) {
(window as any).mixpanel.track(event, props);
}
}
