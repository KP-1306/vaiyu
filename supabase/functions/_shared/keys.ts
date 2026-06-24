// supabase/functions/_shared/keys.ts
//
// Supabase API key resolution during the legacy → new-key migration.
//
// Supabase is retiring the legacy JWT-based `anon` / `service_role` keys (plain
// strings in SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY) in favour of the new
// `sb_publishable_…` / `sb_secret_…` keys. In Edge Functions the new keys are
// injected as JSON objects keyed by name, in SUPABASE_PUBLISHABLE_KEYS /
// SUPABASE_SECRET_KEYS, e.g. {"default":"sb_secret_…"}.
//
// During the transition BOTH are present, so we PREFER the new key and FALL BACK
// to the legacy one. That means these helpers keep working:
//   • before the new keys are created (only legacy injected),
//   • during the transition (both injected), and
//   • after legacy keys are deactivated (only new injected).
//
// Privileges are unchanged: the secret key authorizes as the `service_role`
// Postgres role (BYPASSRLS); the publishable key carries the same low privileges
// as `anon` (RLS applies). See docs/guides/getting-started/migrating-to-new-api-keys.

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
 * Prefers the new `sb_secret_…` (SUPABASE_SECRET_KEYS["default"]), falls back to
 * the legacy SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SERVICE_ROLE.
 */
export function secretKey(): string {
  return (
    fromJsonEnv("SUPABASE_SECRET_KEYS") ??
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    Deno.env.get("SUPABASE_SERVICE_ROLE") ??
    ""
  );
}

/**
 * Publishable (anon-equivalent) key. RLS applies — safe for client-forwarding.
 * Prefers the new `sb_publishable_…` (SUPABASE_PUBLISHABLE_KEYS["default"]),
 * falls back to the legacy SUPABASE_ANON_KEY.
 */
export function publishableKey(): string {
  return (
    fromJsonEnv("SUPABASE_PUBLISHABLE_KEYS") ??
    Deno.env.get("SUPABASE_ANON_KEY") ??
    ""
  );
}

/**
 * True if `token` is a valid service-role credential — accepting EITHER the new
 * secret key OR the legacy service_role key. Used by functions that authorize a
 * caller by comparing the bearer to their own secret (e.g. cron→fn invokers that
 * pass the key from Vault). Accepting both keeps the invoker↔function pair working
 * whether Vault still holds the legacy key or has been switched to the new one,
 * so the migration can't 403 these mid-flight. (Phase C: drop legacy acceptance.)
 */
export function isServiceToken(token: string): boolean {
  if (!token) return false;

  // 1. Exact match to a known key VALUE. Handles the new sb_secret_ caller (opaque
  //    string, stable) and an exact legacy match.
  const legacy =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    Deno.env.get("SUPABASE_SERVICE_ROLE") ??
    "";
  const sk = fromJsonEnv("SUPABASE_SECRET_KEYS") ?? "";
  if ((sk !== "" && token === sk) || (legacy !== "" && token === legacy)) return true;

  // 2. Role-claim path (for a service_role JWT bearer). The exact JWT STRING drifts
  //    across surfaces after a JWT signing-key migration (the same logical key gets
  //    re-signed), so a string compare is fragile. Instead accept any JWT whose `role`
  //    claim is "service_role". SAFE because these functions run with verify_jwt = true,
  //    so the gateway has ALREADY verified the signature before we read the claim — a
  //    regular user's JWT (role "authenticated"/"anon") is rejected here.
  //    NOTE: if a function is moved to verify_jwt = false, it must rely ONLY on the
  //    exact sb_secret_ match in (1) — this decode path is not signature-checked.
  try {
    const part = token.split(".")[1];
    if (part) {
      const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
      const payload = JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)));
      if (payload?.role === "service_role") return true;
    }
  } catch { /* not a JWT */ }

  return false;
}
