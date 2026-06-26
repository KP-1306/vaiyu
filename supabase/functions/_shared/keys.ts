// supabase/functions/_shared/keys.ts
//
// Supabase API key resolution. The legacy JWT-based `anon` / `service_role` keys
// were revoked (2026-06-26); these helpers now read ONLY the new keys, which the
// platform injects into Edge Functions as JSON objects keyed by name:
// SUPABASE_PUBLISHABLE_KEYS / SUPABASE_SECRET_KEYS, e.g. {"default":"sb_secret_…"}.
//
// Privileges: the secret key authorizes as the `service_role` Postgres role
// (BYPASSRLS); the publishable key carries the same low privileges as the old
// anon key (RLS applies).

function fromJsonEnv(name: string, prefer = "default"): string | null {
  const raw = Deno.env.get(name);
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw) as Record<string, string>;
    return obj[prefer] ?? Object.values(obj)[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Secret (service-role-equivalent) key. Bypasses RLS — server-only.
 * Reads the new `sb_secret_…` from SUPABASE_SECRET_KEYS["default"].
 */
export function secretKey(): string {
  return fromJsonEnv("SUPABASE_SECRET_KEYS") ?? "";
}

/**
 * Publishable (anon-equivalent) key. RLS applies — safe for client-forwarding.
 * Reads the new `sb_publishable_…` from SUPABASE_PUBLISHABLE_KEYS["default"].
 */
export function publishableKey(): string {
  return fromJsonEnv("SUPABASE_PUBLISHABLE_KEYS") ?? "";
}

/**
 * True if `token` is a valid service-role credential. Used by cron-invoked
 * functions (verify_jwt = false) that authorize the caller by comparing the
 * bearer to a known secret.
 */
export function isServiceToken(token: string): boolean {
  if (!token) return false;
  // verify_jwt = false on these functions, so the gateway does NOT verify the
  // bearer's signature — a JWT role-claim decode would be forgeable, so we match
  // exact secret VALUES only.
  //
  // PRIMARY: a dedicated cron secret set to the SAME value on both the edge env
  // (`supabase secrets set VA_CRON_SECRET`) and Vault (what the cron invoker passes).
  const cron = Deno.env.get("VA_CRON_SECRET") ?? "";
  if (cron !== "" && token === cron) return true;
  // The new sb_secret_ key (edge-injected SUPABASE_SECRET_KEYS).
  const sk = fromJsonEnv("SUPABASE_SECRET_KEYS") ?? "";
  return sk !== "" && token === sk;
}
