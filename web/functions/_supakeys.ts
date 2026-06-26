// web/functions/_supakeys.ts
//
// Node/Netlify-side Supabase key resolution. The legacy JWT-based `anon` /
// `service_role` keys were revoked (2026-06-26); on Netlify the new keys are plain
// env vars we set ourselves: SUPABASE_SECRET_KEY / SUPABASE_PUBLISHABLE_KEY.

export function secretKey(): string {
  return process.env.SUPABASE_SECRET_KEY || "";
}

export function publishableKey(): string {
  return process.env.SUPABASE_PUBLISHABLE_KEY || "";
}

/**
 * Headers for a service-role REST/RPC call. New sb_secret_ keys go on `apikey`
 * ONLY — the gateway parses an Authorization Bearer as a JWT and rejects a
 * non-JWT with "Invalid JWT".
 */
export function pgServiceHeaders(key: string): Record<string, string> {
  return { apikey: key };
}
