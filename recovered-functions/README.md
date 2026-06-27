# recovered-functions/

Source recovered 2026-06-27 (via `supabase functions download`) for prod edge functions that
were deployed but **never in git** (Nov–Dec 2025 orphans). Most have since been resolved; this dir
now holds only the **4 healthy keepers** pending a key-migration + promotion into `supabase/functions/`.

## Pending here — keep + migrate (4)
Healthy + actively used. They still read the legacy-named `SUPABASE_ANON_KEY` /
`SUPABASE_SERVICE_ROLE_KEY` env vars (prod still resolves those to valid keys, so they work).
Migrate to the new-key helpers (`publishableKey()`/`secretKey()`) + promote into
`supabase/functions/` when touching the feature / before prod:

- `catalog_menu2` — guest menu (public; intentionally low-auth)
- `me-stays` — guest dashboard stays (guest auth)
- `workforce-jobs` — careers job list
- `workforce-profile` — careers / owner workforce

Before promoting: the deploy CI runs `--no-verify-jwt`, so confirm in-code auth first
(`me-stays`/`workforce-*` have it; `catalog_menu2` is intentionally public).

## Resolved (no longer here)
- **Fixed + secured + promoted:** `hotel-orders` — was the one genuinely exploitable cross-tenant
  leak (orders query worked) → now assertAuthed + `vaiyu_is_hotel_member` + new key, unused POST dropped.
- **Retired (deleted from prod):** `ops-heatmap`, `staffing-plan`, `ai`, `me`, `guest-identity`,
  `guest-identity-upsert`, `guest-profile`, `claim-init`, `claim-verify`. All rotted (queried tables/
  columns that were dropped — `ops_ticket_heatmap.hour_bucket`, `ai_usage_daily`, `guest_identity`,
  `credit_balances`) or dormant (claim, hidden route). They'd 500'd for months and never leaked
  (the query died before returning data). UI removed: ops/staffing dashboard widgets, `ai` UsageMeter,
  `claim` route + component. A few dead `lib/api` exports remain (`claimInit`/`claimVerify`, `me`/
  `guest-*` fns + demo handlers) — graceful 404s, sweep when convenient.

Full migration history: `docs/supabase-api-key-migration.md`.
