# Visibility Score — Feature Report

**Position:** Growth Hub 9 — INTERNAL readiness scorer + Google Business checklist
**Codename:** Visibility Score (no v0 / v1 framing — shipped complete per the user's "100% production, no Phase 2" rule)
**Build date:** 2026-06-01 (initial) + 2026-06-01 hardening pass (5 P0/P1 issues found via post-ship hostile-mode self-review; all fixed)
**Owner:** Ajit Kumar Singh
**Engineering lead:** Pallavi Mishra
**Status:** Production-grade. Migration applied + verified locally. Frontend typechecked, 627/627 vitest pass (13 new parity assertions), production build clean (5.66s). Full browser smoke test passed across all governance paths.

> **Smoke verified (2026-06-01, local Docker):**
> - Migration applies cleanly; `_compute_visibility_score(hotel_id)` returns valid breakdown jsonb for both populated and brand-new hotels.
> - Workspace opens at `/owner/:slug/visibility`; dev-auth + RLS work; hero ring + GMB checklist + breakdown + history-empty-state all render.
> - Self-attest → 50% credit (`+3/6 pts` on `gmb_claimed`); manager verify → 100% credit (`+6/6 pts`).
> - Score recomputes correctly after attestation (`10 → 17`).
> - Owner/manager refresh writes a snapshot row; rapid second click hits the rate-limit guard and surfaces tier-specific copy.
> - Cron-health view fires the "no snapshot in 9 days" warning when only manual snapshots exist.
> - Evidence-URL allowlist rejects `https://example.com/…` for `off_platform_response` with stable error `EVIDENCE_URL_NOT_ALLOWED`.
> - Audit log writes a row for every attestation change + every snapshot (entity `visibility_attestation` / `visibility_snapshot`).
> - Hero card on dashboard right rail shows the latest score + band + signals-satisfied count + unlockable-pts badge.

---

## 1. Executive summary

**What:** An internal readiness scorer that aggregates first-party signals across Digital Asset Manager, Local SEO Planner, Package Builder, Lead CRM, Reviews, and the hotels table into a single 0–100 index. Surfaces a Google Business Checklist as a first-class self-attested-with-manager-verification governance flow. Each signal links directly into the module that fixes it (orchestrator role).

**Why:** Owners need to know *what to fix first* across the dozen Growth Hub modules. A composite readiness score with per-signal breakdown turns "I've shipped a lot of features" into "I know exactly which 3 things will move the needle." The score is also the meta-KPI that motivates use of the other modules.

**What this is NOT:**
- Not a Google ranking predictor (no Places API, no GMB scraping, no external SEO tools)
- Not a booking/revenue forecaster
- Not a cross-hotel benchmark / leaderboard
- Not an AI feature (no LLM calls, no learned weights — deterministic only)
- Not a public-publishing surface

**Operating model:**
- **5 weighted categories** summing to 100: GMB Readiness (30) · Trust & Reputation (25) · Digital Assets (20) · Direct Enquiry (15) · Experience & Packages (10)
- **19 signals** evaluated per call:
  - **14 AUTO_DERIVED** from existing first-party data (DAM, packages, leads, reviews, hotels table)
  - **5 SELF_ATTESTED** (4 GMB-class + 1 off-platform-review-response) with manager-verification flow
- **3-tier credit model:** UNCLAIMED 0% · SELF_ATTESTED 50% · MANAGER_VERIFIED 100% (90-day expiry then auto-degrade)
- **Min-sample carve-out:** brand-new hotels (no review history, no lead history) score *against the evaluable subset*, not 22/22 — so a new hotel can still hit 100/100 by completing what is measurable

**Strict guardrails enforced in code:**
- No Google APIs. No scraping. No external SEO data. No anon grants.
- Verbatim disclaimer (English + Hinglish) on hero + workspace
- Self-attested items can only reach 50% without manager confirmation (gaming guard)
- Evidence URLs validated against per-signal trusted-domain allowlist (`_visibility_evidence_pattern`)
- Manager unverify locked to original verifier or platform_admin (no manager-vs-manager flip-flop)
- Owner refresh rate-limited via `api_hits` (5min owner / 1min manager)

---

## 2. Strategic decisions (locked with the user)

### 2.1 — First-party-only scoring (no Google APIs)
The user's spec proposed Google Places API for `rating / review_count / photo_count`. The PO/architect spec forbade it. **Decision: align with PO.** Reasons:
1. Google Places isn't free or quota-free; per-hotel coverage requires GMB-claimed first (chicken-and-egg)
2. First-party data is *more meaningful* — measures readiness-to-be-found, not the after-effect
3. Outage surface, cost surprise, and quota throttling are eliminated

### 2.2 — Two-axis credit model (50% / 100%)
Three-way tradeoff was: (a) full credit on self-attest, (b) zero until verified, (c) fractional. **Decision: 50% self / 100% verified** — gives owners immediate signal that completion matters while preserving the incentive to push for manager confirmation. The UI hides the fractional math behind visual states (amber tick / emerald check / slate ring).

### 2.3 — Weekly cron + on-demand refresh (snapshots ship in v1)
The reviewer pushed back on the snapshot/cron/history scope as "too database-heavy." **Decision: keep all three.** Reasons:
1. Cost is trivial — 1 table, ~52 rows/hotel/year, pg_cron is already a hard dep
2. "Will owners compare every week?" → operator pass says yes; static score = dashboard decoration, trending score = orchestrator
3. The user's standing rule explicitly forbids "ship later" framing

### 2.4 — Catalog lives in TS, weights in SQL+TS with parity test
Reviewer flagged the 22-row catalog table as DB-heavy. **Decision: catalog (labels, translations, fix-action targets) moves to `web/src/config/visibilityScore.ts`. Weights live in `_visibility_weights()` IMMUTABLE SQL function PLUS TS mirror, with vitest parity test reading the migration file and asserting byte-equality.** Same pattern as the SEO Planner classifier.

### 2.5 — All 12 + 5 hostile-review gaps fixed in v1 (no Phase 2)

The first hostile pass surfaced 12 gaps. A second pass after smoke-testing surfaced 5 more that the first pass missed. All 17 landed in v1. The second-pass items are documented as the "hardening migration" (`20260601000001_visibility_score_hardening.sql`):

- **H1** — Snapshot `signals_changed` was always empty because the prior implementation re-read the previous snapshot's *delta* (not its *state*) and had a `WHERE false` clamp. Fixed by adding `signal_states jsonb` column to snapshots + correct full-outer-join diff in the RPC.
- **H2** — RLS policy `hotel_id IS NULL OR vaiyu_is_hotel_member(hotel_id)` let any authenticated user read orphaned snapshots after hotel deletion. Tightened to AND.
- **H3** — Cron-health view showed false-alarm "no snapshot in 9 days" for hotels created Wednesday before their first Sunday cron. Added 14-day grace from `hotels.created_at`.
- **H4** — Manager-verify expired at read-time only; DB state stayed `MANAGER_VERIFIED` forever and no audit event fired at the 90-day mark. Added `_degrade_expired_visibility_attestations()` + daily pg_cron job (`visibility_attestation_daily_degrade`, 08:00 IST) that demotes expired rows and writes `visibility_attestation_auto_degraded` audit events.
- **H5** — Unverify-lock check on a deleted verifier relied on `NULL <> uuid` returning NULL to bypass the lock. Made explicit with an `IS NOT NULL` guard.

UI hardening alongside:
- `window.prompt` for unverify reason replaced with a proper accessible `UnverifyDialog` modal (required-reason validation, ESC handling, focus management, 500-char limit, audit-trail copy).
- New `ReattestConfirmDialog` shown when an owner clicks *Re-attest* on a `MANAGER_VERIFIED` row, warning that the manager seal will be wiped.
- Per-signal **expiry warning** chip appears when `manager_verified_at + 90d` is within 14 days.
- Self-attested + Manager-verified rows now show their **bookkeeping dates** + an *Evidence link* if one was provided.
- Cron-health warning now shows magnitude ("Last weekly snapshot was N days ago") instead of generic copy.

### 2.6 — Original 12 v1 gaps (first hostile pass)
After the user asked "is this Google-level ready?", a hostile-mode review surfaced 12 gaps. All landed in v1:
1. Min-sample carve-outs for derived signals
2. `vaiyu_is_system_cron()` (session_user-based) — not `current_user`
3. Owner-refresh rate limit via `api_hits` (5min/1min tiers)
4. Snapshot delta cols (`previous_score`, `signals_changed`)
5. 90-day manager-verify expiry → auto-degrade
6. Evidence URL allowlist regex per signal_key
7. CHECK constraints (score 0–100, version ≥1, attestation_schema_version ≥1)
8. Onboarding state when <5 signals evaluable
9. Manager re-verification lock rule (original verifier or platform_admin only)
10. `v_visibility_cron_health` view + in-app warning
11. ON DELETE CASCADE attestations / SET NULL snapshots (`hotel_id_at_snapshot` preserved)
12. Band thresholds 80/60/40 locked, asserted in vitest, SQL CASE regex-matched

---

## 3. Schema

### 3.1 Enums (3)
- `visibility_category` — `GMB_READINESS | TRUST_REPUTATION | DIGITAL_ASSETS | DIRECT_ENQUIRY | EXPERIENCE_PACKAGES`
- `visibility_attestation_state` — `UNCLAIMED | SELF_ATTESTED | MANAGER_VERIFIED`
- `visibility_snapshot_trigger` — `CRON | OWNER_REFRESH | MANAGER_REFRESH | ADMIN_BACKFILL`

### 3.2 Tables (2)
- **`hotel_visibility_attestations`** — per-hotel per-self-attested-signal row. Lazy-created on first attest. Carries `attestation_schema_version` so future catalog renames can leave old rows ignorable rather than blocking RLS reads. UNIQUE `(hotel_id, signal_key)`.
- **`visibility_score_snapshots`** — append-only history. Carries `formula_version` (interpretable across weight rebalances), `previous_score` + `signals_changed` (delta-aware trend chart), `hotel_id_at_snapshot` (permanent ID surviving hotel deletion via `SET NULL` on the FK).

### 3.3 Views (2, `security_invoker = on`)
- **`v_hotel_visibility_score`** — primary read surface. One row per hotel the caller is a member of, with full breakdown jsonb (score, band, category_scores, per-signal details). Filter `where hotel_id = $1`.
- **`v_visibility_cron_health`** — per-hotel `last_cron_snapshot_at` + `healthy` boolean (false when no CRON snapshot in last 9 days). Drives the in-app warning + future Sentry alert.

### 3.4 Functions (6)
- **`vaiyu_is_system_cron()`** — `session_user = 'postgres'` AND no JWT claims. Gates the CRON snapshot path so owners cannot impersonate cron via the SECURITY DEFINER side-channel.
- **`_visibility_weights()`** — IMMUTABLE, returns `(version int, weights jsonb)` atomically. TS mirror in `web/src/config/visibilityScore.ts`; parity asserted by vitest.
- **`_visibility_evidence_pattern(signal_key)`** — IMMUTABLE, returns POSIX regex per signal_key. GMB-class → only `business.google.com` / `g.page` / `google.com/maps`. Off-platform-response → Booking / MMT / Goibibo / TripAdvisor / Agoda / Airbnb.
- **`_compute_visibility_score(hotel_id)`** — STABLE, SECURITY INVOKER. Loops 19 signals, applies per-signal evaluation + min-sample carve-outs + 90-day verify-expiry, returns full breakdown jsonb.
- **`snapshot_visibility_score(hotel_id, trigger)`** — SECURITY DEFINER. Validates trigger-specific auth (cron / member / manager), rate-limits via `api_hits`, writes snapshot + audit log row.
- **`set_visibility_attestation` / `manager_verify_attestation` / `manager_unverify_attestation` / `replay_missed_snapshots`** — the mutation RPCs.

### 3.5 pg_cron schedules
- **`visibility_score_weekly_snapshot`** — Saturday 21:30 UTC (Sunday 03:00 IST). Loops every hotel with at least one `hotel_members` row, calls `snapshot_visibility_score(id, 'CRON')`. Per-hotel exception is caught + audit-logged so a single failure doesn't abort the batch.
- **`visibility_attestation_daily_degrade`** — 02:30 UTC daily (08:00 IST). Demotes manager-verified attestations older than 90 days to `SELF_ATTESTED` and writes `visibility_attestation_auto_degraded` audit events. Read-time degradation in `_compute_visibility_score` is independently correct; this keeps DB state consistent with score and produces audit visibility at the 90-day boundary.

### 3.6 RLS + grants
All reads gated by `vaiyu_is_hotel_member`. Direct DML revoked from `anon, authenticated` — writes only via the four RPCs (`replay_missed_snapshots` is `postgres`-only by virtue of no GRANT).

---

## 4. Frontend

### 4.1 Files
| Path | Purpose |
|---|---|
| `web/src/config/visibilityScore.ts` | Feature flag, formula mirror, band thresholds, 19-signal catalog (bilingual), disclaimer (en + hi), fix-action deep-links |
| `web/src/types/visibilityScore.ts` | All TS types + `VisibilityServiceError` stable codes |
| `web/src/services/visibilityScoreService.ts` | Typed wrappers around RPCs + RLS-scoped reads |
| `web/src/services/visibilityScoreQueryKeys.ts` | Centralised TanStack Query keys |
| `web/src/components/owner/VisibilityScoreCard.tsx` | Hero card on dashboard right rail (SVG ring + band + delta) |
| `web/src/components/visibility/VisibilityDisclaimerBanner.tsx` | Bilingual disclaimer with toggle |
| `web/src/components/visibility/VisibilityTrendChart.tsx` | Pure-SVG sparkline of last 12 snapshots |
| `web/src/components/visibility/VisibilitySignalRow.tsx` | One row in the breakdown: status pill, self-attest input, manager verify, deep-link |
| `web/src/components/visibility/VisibilityBreakdown.tsx` | 5-category collapsible accordion |
| `web/src/components/visibility/GoogleBusinessChecklist.tsx` | Focused GMB block (above breakdown) reusing VisibilitySignalRow |
| `web/src/routes/owner/Visibility.tsx` | Workspace route at `/owner/:slug/visibility` |
| `web/src/config/visibilityScore.test.ts` | 13 parity assertions (TS↔SQL weights, band CASE, category sums) |

### 4.2 Wiring
- **Dashboard hero card:** `OwnerDashboard.tsx` — mounted at the top of the right rail, above OutstandingBalanceCard, flag-gated by `VISIBILITY_SCORE_ENABLED`.
- **Quick-nav tile:** dashboard quick-nav grid, next to the SEO Plan tile.
- **Route:** `main.tsx` — `owner/:slug/visibility` lazy-loaded under `AuthGate`.
- **No sidebar entry needed** — the existing pattern uses dashboard cards + quick-nav tiles as the primary nav surface for Growth Hub modules.

### 4.3 CI
New workflow `.github/workflows/test.yml` runs `npm run typecheck && npm run test` on every push/PR. Closes a long-standing gap where vitest parity tests existed across multiple modules (SEO Planner, Quote Drafts, Lead CRM, now Visibility) but no machine ever ran them.

---

## 5. Scoring formula reference

```
Total possible (when all signals evaluable) = 100

GMB_READINESS (30):
  gmb_claimed              6    (self-attested)
  gmb_verified             6    (self-attested)
  gmb_category_set         4    (self-attested)
  address_complete         5    (derived: address + city + state + country + postal_code)
  map_pin_set              5    (derived: latitude AND longitude)
  phone_present            4    (derived: hotels.phone)

TRUST_REPUTATION (25):
  review_link_set          5    (derived: hotels.review_policy_url)
  reviews_flowing          7    (derived: ≥5 reviews in last 90d; min-sample carve-out for hotels <30d old)
  off_platform_response    5    (self-attested)
  trust_essentials_assets  8    (derived: DAM TRUST_ESSENTIALS ≥80% COLLECTED/APPROVED; partial credit allowed)

DIGITAL_ASSETS (20):
  critical_assets_ready   10    (derived: DAM CRITICAL priority ≥80%; partial credit)
  high_assets_ready        5    (derived: DAM HIGH priority ≥60%; partial credit)
  brand_basics             5    (derived: logo_path AND brand_color)

DIRECT_ENQUIRY (15):
  whatsapp_connected       4    (derived: hotels.wa_phone_number_id)
  booking_url_set          3    (derived: hotels.booking_url)
  payment_ready            4    (derived: razorpay_account_id OR upi_id)
  lead_response_time       4    (derived: median first-response on last 10 leads ≤4h; min sample 5)

EXPERIENCE_PACKAGES (10):
  package_live             5    (derived: ≥1 ACTIVE non-deleted package)
  seo_blueprint_ready      5    (derived: ≥1 READY_TO_BUILD + SAFE_BLUEPRINT SEO blueprint)

Bands:
  80–100 STRONG          ·  "Bahut achhi tarah ready ho."
  60–79  GOOD            ·  "Theek hai, lekin kuch fix karne ke liye hai."
  40–59  NEEDS_ATTENTION ·  "Kaafi cheezein adhuri hain."
  0–39   CRITICAL        ·  "Pehle yeh basics fix karein."
  <5 evaluable signals   →  ONBOARDING (no numeric score shown)
```

---

## 6. Risks + mitigations

| Risk | Mitigation in v1 |
|---|---|
| Owner gaming self-attestation | 50% cap until manager-verified |
| Manager verification rots silently | 90-day auto-degrade with audit event |
| Manager-vs-manager flip-flop | Lock to original verifier or platform_admin |
| Weight drift between SQL and TS | Parity vitest test reads migration file + new CI workflow runs it |
| Snapshot identity confusion across formula bumps | `formula_version` stored per snapshot row |
| Cron silent failure | `v_visibility_cron_health` view + in-app warning + `replay_missed_snapshots` recovery RPC |
| New hotel scored zero unfairly | Min-sample carve-out excludes signal from denominator (visible as "X pts unlockable") |
| Hotel deletion orphans history | `hotel_id_at_snapshot` is FK-less; cascade only on attestation |
| Evidence URL theatre | Per-signal regex allowlist + stable error code |
| Rate-limit DoS via refresh spam | `api_hits` with 5min owner / 1min manager tier |

---

## 7. Verification

| Step | Result |
|---|---|
| Migration applies (single transaction, ON_ERROR_STOP) | ✅ clean |
| `_compute_visibility_score` returns valid jsonb for populated hotel | ✅ score 5.5 / CRITICAL / 1 of 15 satisfied / 4 excluded |
| `snapshot_visibility_score(...,'CRON')` writes row + audit | ✅ |
| Frontend typecheck | ✅ clean (only pre-existing untracked Position 8 error) |
| Vitest | ✅ **627/627 pass** (+13 new parity assertions) |
| Production build | ✅ clean in 5.66s |
| Browser smoke test — self-attest | ✅ 50% credit shown |
| Browser smoke test — manager verify | ✅ 100% credit shown, score 10 → 17 |
| Browser smoke test — refresh + rate limit | ✅ stable error surfaces |
| Browser smoke test — evidence URL rejection | ✅ `EVIDENCE_URL_NOT_ALLOWED` |
| Browser smoke test — cron health warning | ✅ visible (no CRON snapshot in 9d) |
| Audit trail | ✅ all 4 mutation paths log to `va_audit_logs` |
| Dashboard hero card | ✅ renders with score + band + delta + unlockable badge |

---

## 8. Deployment

**Not yet pushed to production.** Per CLAUDE.md "no auto-push to prod Supabase without explicit per-feature approval."

When approved:
1. `supabase db push --linked` to apply migration
2. `supabase secrets list --project-ref <prod>` — no new secrets needed
3. `git push` to trigger Netlify deploy + new `test.yml` CI workflow
4. Verify pg_cron `visibility_score_weekly_snapshot` is scheduled in prod
5. Spot-check `/owner/<slug>/visibility` against a real hotel
6. (Optional) Trigger one `snapshot_visibility_score(id, 'OWNER_REFRESH')` per hotel to seed history immediately
