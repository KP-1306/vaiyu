// web/functions/_supakeys.ts
//
// Node/Netlify-side Supabase key resolution for the legacy → new-key migration.
//
// Unlike Edge Functions (where Supabase injects SUPABASE_SECRET_KEYS /
// SUPABASE_PUBLISHABLE_KEYS as JSON), on Netlify these are plain env vars we set
// ourselves. Prefer the new key, fall back to the legacy one so nothing breaks
// before/after the Netlify env is switched.

export function secretKey(): string {
  return (
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SERVICE_ROLE_KEY ||
    ""
  );
}

export function publishableKey(): string {
  return (
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    ""
  );
}

/**
 * Headers for a service-role REST/RPC call. Legacy keys are JWTs (eyJ…) and may be
 * sent on Authorization; new sb_secret_ keys must go on apikey ONLY — the gateway
 * tries to parse a Bearer as a JWT and rejects a non-JWT with "Invalid JWT".
 */
export function pgServiceHeaders(key: string): Record<string, string> {
  return key.startsWith("eyJ")
    ? { apikey: key, Authorization: `Bearer ${key}` }
    : { apikey: key };
}
