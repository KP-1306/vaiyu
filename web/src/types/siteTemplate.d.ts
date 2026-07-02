// Type shim for the framework-free site renderer shared with the Node generator.
declare module '*siteTemplate.mjs' {
  export function renderSiteHTML(payload: unknown): string;
}
