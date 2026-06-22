// web/functions/_adminAuth.ts
//
// Shared platform-admin authn/authz for the Operator Console endpoints.
// Underscore-prefixed so Netlify (zip-it-and-ship-it) treats this as a shared
// module that gets BUNDLED into importing functions — it is NOT deployed as a
// function of its own.
//
// Canonical platform-admin check (identical to public.is_platform_admin()):
// an active row in public.platform_admins. Also returns the admin's tier
// (super_admin | support_admin | finance_admin) so callers can enforce
// per-panel role access.

export type AdminEnv = { url: string; service: string; anon: string };
export type AdminCtx = { uid: string; role: string };

/** Resolve the bearer token → an active platform admin, or null (fail-closed).
 *  Uses the service-role key (RLS-bypassing) only AFTER verifying the token. */
export async function getPlatformAdmin(env: AdminEnv, token: string): Promise<AdminCtx | null> {
  if (!token || !env.url || !env.service) return null;

  // 1. token → user id (the bearer identifies the user; apikey is just the project key)
  const userRes = await fetch(`${env.url}/auth/v1/user`, {
    headers: { apikey: env.anon || env.service, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) return null;
  const user = await userRes.json().catch(() => null);
  const uid = user?.id;
  if (!uid) return null;

  // 2. active platform_admins row (service-role read = is_platform_admin())
  const r = await fetch(
    `${env.url}/rest/v1/platform_admins?select=role&user_id=eq.${encodeURIComponent(uid)}&is_active=eq.true&limit=1`,
    { headers: { apikey: env.service, Authorization: `Bearer ${env.service}` } },
  );
  if (!r.ok) return null;
  const rows = await r.json().catch(() => null);
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return { uid, role: String(rows[0]?.role ?? "") };
}

/** Panels each admin tier may read. super_admin sees everything. */
export function canSeePanel(role: string, panel: string): boolean {
  if (role === "super_admin") return true;
  const COMMON = ["me", "summary", "fleet", "health", "tenants"]; // any active admin
  if (COMMON.includes(panel)) return true;
  if (panel === "payments") return role === "finance_admin";
  if (panel === "onboarding") return role === "support_admin";
  if (panel === "audit") return false; // super_admin only (handled above)
  return false;
}
