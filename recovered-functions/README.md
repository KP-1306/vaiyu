# recovered-functions/

Source for 14 Supabase Edge Functions that are **deployed on prod** (vaiyu-prod,
`vsqiuwbmawygkxxjrxnt`) but were **never in git** — recovered 2026-06-27 via
`supabase functions download --use-api`. They were deployed Nov–Dec 2025 and never
redeployed.

## Why this dir is NOT under `supabase/functions/`
`.github/workflows/deploy-functions.yml` globs `supabase/functions/*` and deploys
**every** function with **`--no-verify-jwt`**. These recovered functions have not been
vetted for that posture, so they live here (outside the glob) to capture the source
under version control **without triggering a redeploy**. Do **not** move one into
`supabase/functions/` until it's reviewed (see below).

## Status at recovery — healthy, not broken
All 14 are live on prod. They read the platform-injected `SUPABASE_ANON_KEY` /
`SUPABASE_SERVICE_ROLE_KEY` env vars, which **still resolve to valid keys** after the
legacy-key disable + JWT-secret revoke (verified: `workforce-jobs` returns real data).
So the revoke did **not** break them, and the originally-leaked key string remains dead.

## Usage map (which app surface calls each)
- **Owner console (active):** `ai` (UsageMeter on OwnerSettings/OwnerHome),
  `ops-heatmap` + `staffing-plan` (OwnerDashboard on-mount).
- **Guest portal (old architecture, via lib/api.ts + VITE_API_URL=functions-base):**
  `me`, `me-stays`, `guest-identity`, `guest-identity-upsert`, `guest-profile`,
  `hotel-orders`, `catalog_menu2`.
- **Careers:** `workforce-jobs`, `workforce-profile`.
- **Claim-stay (dormant — `/claim` route mounted but no nav link):** `claim-init`, `claim-verify`.

## Before promoting any of these into `supabase/functions/` (the eventual fix)
1. **Confirm it does its own in-code auth** (`getUser` / `auth.uid`). The deploy CI uses
   `--no-verify-jwt`, so a function that relies on the gateway becomes an **open endpoint**
   if promoted as-is.
   - Has in-code auth signals: `guest-identity`, `guest-identity-upsert`, `me`, `me-stays`,
     `guest-profile`, `claim-init`, `claim-verify`, `workforce-jobs`, `workforce-profile`, `ai`.
   - **Zero auth signals — review for exposure first:** `catalog_menu2` (public menu, likely ok),
     `hotel-orders`, `ops-heatmap`, `staffing-plan`.
2. Swap the legacy env reads → the new-key helpers (`publishableKey()` / `secretKey()` in
   `supabase/functions/_shared/keys.ts`) for consistency.
3. Add `config.toml` `verify_jwt` entries as needed.

Alternatively, **retire** the dormant/superseded ones (delete the function + its UI wiring)
rather than promoting them — e.g. claim-stay (deferred), or any guest-portal endpoint a
newer path replaces.
