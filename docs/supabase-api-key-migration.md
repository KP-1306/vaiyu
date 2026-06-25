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

## Gotcha hit during Phase B: service_role JWT string drift (admin-alerts / cleanup)

Creating the new keys (+ the JWT-signing-key migrate) **re-signs the legacy
`service_role` JWT**, so its exact STRING now differs across surfaces (Vault copy
vs the edge-injected `SUPABASE_SERVICE_ROLE_KEY`). `admin-alerts` and
`cleanup-guest-documents` authorize the cron invoker by comparing the bearer to a
key — that string compare started 403'ing (the gateway still accepted the JWT as
valid; only the in-code string compare failed). Re-syncing Vault and redeploying
did NOT fix it (the injected env string also drifted).

**Fix (commit 5aebc8d):** `isServiceToken` now also accepts a bearer whose JWT
`role` claim is `service_role`, not just an exact string. Safe because both
functions run `verify_jwt = true`, so the gateway verifies the signature before
the claim is read. Verified: cron path back to 200.

**Phase C implication for these two:** when you set `verify_jwt = false` (step 7),
the gateway no longer verifies the signature, so the role-claim decode path is NO
LONGER safe (a forged unsigned `role:service_role` token would pass). At that
point they must authorize ONLY via the exact `sb_secret_` match — so do step 7
(verify_jwt=false) and step 8 (Vault → new `sb_secret_`) together, and the
role-claim branch can be removed in Phase D cleanup.

**Pre-staged (commit `167956c` on branch `phase-c-api-keys`, NOT merged):** the
code half of steps 7 is ready — `config.toml` sets `verify_jwt=false` for both
functions and `isServiceToken` drops the role-claim path (exact `sb_secret_`/legacy
match only). It is deliberately off the deploy path because deploying it WITHOUT
the simultaneous Vault → `sb_secret_` switch would 403 these two. **Activation
sequence (one window):** (a) Vault `service_role_key` → new `sb_secret_`;
(b) merge/push `phase-c-api-keys` → main (deploys config + keys.ts);
(c) verify the cron path returns 200 on both (exact-secret match — if 403, the
edge `SUPABASE_SECRET_KEYS` doesn't match Vault's value, so revert: re-point Vault
to legacy + redeploy `main`'s role-claim version). Only then proceed to disable +
revoke legacy.

## Phase C — function cutover DONE (2026-06-26)

Steps 7 + 8 for the two cron-invoked functions are **live**. We did NOT use the
sb_secret_ exact-match after all: the secret has **different string representations**
across surfaces — management API returns len 67, the edge-injected
`SUPABASE_SECRET_KEYS.default` is len 41 — so an exact match would have 403'd.

Instead, a **dedicated cron secret** set to the SAME value on both sides (matches by
construction, independent of any key representation):
- `supabase secrets set VA_CRON_SECRET=<random>` → injected into the edge functions.
- Vault `service_role_key` → the SAME `VA_CRON_SECRET` value (what the invokers pass).
- `isServiceToken` accepts `VA_CRON_SECRET` first (sb_secret_/legacy kept as fallback).
- `admin-alerts` + `cleanup-guest-documents`: `verify_jwt = false`, redeployed.

Verified: `admin-alerts` 200 on both the direct call and the cron path (Vault); no
breakage window observed across the cutover. `cleanup` uses the identical mechanism.

**Still pending (your dashboard actions, when ready):**
- Step 9–10: confirm legacy idle → **disable** legacy `anon` + `service_role` (reversible).
- Step 11: **revoke** the legacy JWT secret → kills the originally-leaked key.
- Phase D: drop the `?? legacy` fallbacks + lower access-token expiry 86400→3600.

## Rollback
Until step 11 (revoke), everything is reversible: re-enable legacy keys (step 10),
or unset the new env vars (the fallback resumes using legacy). For the two cutover
functions specifically, revert = point Vault back to a legacy `service_role` JWT +
redeploy `main`'s role-claim version with `verify_jwt=true`.
