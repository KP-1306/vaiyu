# Supabase API-key migration (legacy → new publishable/secret keys)

**Why:** retire the legacy JWT-based `anon` / `service_role` keys in favour of the new
`sb_publishable_…` / `sb_secret_…` keys. Trigger was a leaked legacy `service_role`
key (in a tooling transcript) — the only way to invalidate it is to disable the legacy
keys and revoke the legacy JWT secret, which requires moving the whole app onto the new
keys first. Supabase is also deprecating legacy keys by end of 2026.

Done on a **demo/test** project, so cutover disruption (logouts, brief breakage) costs
no real hotels. Branch: `feat/migrate-supabase-api-keys`.

## Design: new-key-with-legacy-fallback (zero flag-day)

Every key read prefers the **new** key and falls back to **legacy**, so the code works
before, during, and after the dashboard switch. Helpers:

- Edge functions: [`supabase/functions/_shared/keys.ts`](../supabase/functions/_shared/keys.ts)
  — `secretKey()`, `publishableKey()`, `isServiceToken()`. New keys arrive as JSON env
  vars `SUPABASE_SECRET_KEYS` / `SUPABASE_PUBLISHABLE_KEYS` (parsed `["default"]`),
  legacy as plain `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_ANON_KEY`.
- Netlify functions: [`web/functions/_supakeys.ts`](../web/functions/_supakeys.ts) —
  `secretKey()`, `publishableKey()`, `pgServiceHeaders()`. On Netlify the new keys are
  plain env vars we set (`SUPABASE_SECRET_KEY` / `SUPABASE_PUBLISHABLE_KEY`).
- Frontend: [`web/src/lib/supabaseKey.ts`](../web/src/lib/supabaseKey.ts) —
  `SUPABASE_PUBLISHABLE_KEY` (`VITE_SUPABASE_PUBLISHABLE_KEY` → `VITE_SUPABASE_ANON_KEY`).

### apikey-vs-Bearer gotcha (handled)
New keys must be sent on the **`apikey` header only** — the gateway parses a `Bearer`
as a JWT and rejects a non-JWT with "Invalid JWT". `pgServiceHeaders()` omits the
Bearer for non-JWT (`!startsWith("eyJ")`) keys. supabase-js (latest `@2`) handles this
itself; **two functions pin old versions and must be bumped** before relying on the new
key in their service client: `generate-reminders` (`@2.7.1`), `get-document-url`
(`@2.38.4`).

## What this branch already did (Phase A — non-breaking, safe to deploy)

- Frontend: all 4 browser clients route through `SUPABASE_PUBLISHABLE_KEY`
  (`lib/supabase.ts`, `lib/db.ts`, `hooks/useOwnerKpis.ts`, `GuestDashboard.tsx`).
- Edge: `_shared/auth.ts` (covers 22 fns) + `_shared/http-telemetry.ts` + 23 direct
  `service_role` readers → `secretKey()`/`publishableKey()`.
- Token-comparison auth (`admin-alerts`, `cleanup-guest-documents`) → `isServiceToken()`
  which accepts **new OR legacy** so the invoker↔function pair can't 403 mid-migration.
- Netlify: `admin-metrics`, `obs`, `_adminAuth` → new keys + `pgServiceHeaders()`.

Verified: `tsc` 0 errors; vitest 824/825 (the 1 failure is unrelated i18n WIP).

## Remaining steps (do in order)

### Phase B — create keys + deploy + verify (non-destructive)
1. **Dashboard → Settings → API Keys:** create a publishable key and a secret key
   (legacy keeps working).
2. **Set env vars:**
   - Netlify: `SUPABASE_SECRET_KEY` = `sb_secret_…`, `SUPABASE_PUBLISHABLE_KEY` =
     `sb_publishable_…`, and `VITE_SUPABASE_PUBLISHABLE_KEY` = `sb_publishable_…`.
   - Supabase Edge: the new keys are auto-injected as `SUPABASE_SECRET_KEYS` /
     `SUPABASE_PUBLISHABLE_KEYS` (verify they appear; see issue #37648 about env not
     refreshing — redeploy functions if stale).
3. **Bump old supabase-js** in `generate-reminders` and `get-document-url` to `@2`.
4. **Deploy** this branch (frontend + Netlify + `deploy-functions` CI).
5. **Verify** with new keys live: owner dashboard loads, a logged-in user action works,
   Operator Console (`admin-metrics`/`obs`) loads, a webhook + a cron-invoked function
   run clean. Legacy still active as the safety net.

### Phase C — cut over the gateway + invokers, then disable legacy (the careful part)
6. **JWT Signing Keys:** Dashboard → JWT Keys → **Migrate JWT secret** (non-destructive),
   then rotate (keeps sessions alive during the grace period).
7. **`verify_jwt = false`** in `supabase/config.toml` for every function that is called
   with the publishable/secret key on `Authorization` (gateway can't verify new keys):
   - **Required + already in-code-authed:** `admin-alerts`, `cleanup-guest-documents`
     (both now use `isServiceToken()`), the existing cron/webhook set already `false`.
   - **Audit before flipping:** functions currently `verify_jwt=true` that may be called
     by anon/logged-out users (publishable sent as Bearer). Confirm each has in-code auth
     (`assertAuthed`/`getUser`/role check) BEFORE turning the gateway off, or it becomes
     an open endpoint. (Functions only ever called by logged-in users with a user JWT
     keep working with `verify_jwt=true`.)
8. **Update Vault** `service_role_key` secret → the new `sb_secret_…` value. This is what
   `va_admin_invoke_alerts` and `va_invoke_cleanup_guest_documents` pass as `Bearer`.
   (Must come AFTER step 7 sets those two functions to `verify_jwt=false`, else the
   gateway rejects the sb_secret Bearer.) `va_cron_invoke_fn` passes no key — unaffected.
9. **Audit "last used":** confirm the legacy keys go idle (Dashboard shows last-used).
10. **Disable** legacy `anon` + `service_role` (reversible — reactivate if anything breaks).
11. **Revoke** the legacy JWT secret → the leaked `service_role` is finally dead.

### Phase D — cleanup
12. Drop the legacy branches: `isServiceToken()` legacy acceptance; the `?? legacy` tails
    in `keys.ts`/`_supakeys.ts`; legacy env vars. Lower access-token expiry 86400→3600s.

## Rollback
Until step 11 (revoke), everything is reversible: re-enable legacy keys (step 10),
or unset the new env vars (the fallback resumes using legacy).
