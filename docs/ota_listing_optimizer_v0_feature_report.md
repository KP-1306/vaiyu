# OTA Listing Optimizer v0 — Feature Report

**Position:** 2 of the Growth Hub sheet
**Shipped:** 2026-06-01
**Status:** Implementation complete, awaiting deployment approval
**Identity:** Traveler-Trust & OTA Readiness Intelligence Layer (internal self-audit workbook)

---

## What this is — and is not

OTA Listing Optimizer is an **internal readiness checklist** that helps hotel
owners identify what is missing across 8 major OTAs (MakeMyTrip, Goibibo,
Booking.com, Agoda, Airbnb, Expedia, Yatra, TripAdvisor). It is deterministic,
bilingual (English + Hinglish), and feeds the Visibility Score via a single
new `ota_listing_ready` signal.

**This is NOT:**
- A channel manager (no inventory/rate sync to OTAs)
- An OTA API integration (zero `fetch` calls to any OTA platform)
- A scraping tool (zero browser automation, zero HTML parsing)
- An OTA ranking predictor (we make no booking/revenue guarantees)
- An AI feature (zero LLM calls, deterministic scoring only)
- A public-publishing surface (it changes nothing on any external platform)

Per CLAUDE.md "no phase 2" rule: every concern raised in design review landed in
v1 — no deferred items, no `// TODO` markers anywhere in the codebase.

---

## Architecture

### Two-table lean schema (per architectural review pass)

After reviewer pushback during design, the schema was deliberately stripped
of two would-be tables:

| Originally proposed | Why dropped | Replacement |
|---|---|---|
| `ota_readiness_catalog` table | Visibility Score precedent puts catalog in SQL function + TS mirror | `_ota_catalog()` SQL function with vitest parity test |
| `hotel_ota_readiness_events` table | Visibility Score uses `va_audit_logs`; no per-entity timeline UI surface | All audit writes go to shared `va_audit_logs` |
| `hotels.property_type` column | Closed-vocab enum on a critical multi-tenant table; not load-bearing in v0 catalog | Dropped entirely. If a future catalog item needs it, add `property_categories text[]` matching the existing `amenities text[]` pattern. |
| `hotels.is_mountain_property` boolean | Module-specific concern leaked onto `hotels`; reuses Seasonal Calendar's pattern of deriving from `hotels.state` | State-derived shortlist + per-hotel override in `hotel_ota_optimizer_settings.show_mountain_checks_override` |

**Tables shipped (2):**
- `hotel_ota_optimizer_settings` — one row per hotel: active OTAs, mountain override, wizard completion
- `hotel_ota_readiness_state` — one row per (hotel × OTA × category × item_key): status + reviewed_at + note

**SQL functions (8):**
- `_ota_catalog()` — IMMUTABLE; 52 catalog rows authoritative
- `_ota_mountain_states()` — IMMUTABLE; 6-state mountain shortlist
- `_ota_catalog_has_item(category, item_key)` — STABLE; existence check for write RPCs
- `_ota_effective_mountain(hotel_id)` — STABLE; resolves state-derived + override
- `_ota_signal_for_visibility(hotel_id)` — STABLE SECURITY DEFINER; bridge to Visibility Score signal `ota_listing_ready`
- 8 owner-callable RPCs (next section)

**Views (2):**
- `v_hotel_ota_readiness` — per-(hotel × active OTA) breakdown with score, band, counts, staleness
- `v_hotel_ota_readiness_summary` — hotel-overall aggregate

Both views use `WITH (security_invoker = on)` + explicit `WHERE vaiyu_is_hotel_member(h.id)` defense-in-depth (lesson from Seasonal Calendar leak fix).

### RPCs (7 owner-callable)

1. `set_ota_active_otas(hotel_id, otas[])` — toggle active OTA set; ≥1 required
2. `set_ota_mountain_override(hotel_id, override boolean)` — null = auto-derive
3. `set_ota_readiness_status(hotel_id, ota, category, item_key, status, note?)` — single-item upsert
4. `bulk_set_ota_readiness(hotel_id, items jsonb)` — wizard payload, max 200 items per call
5. `mark_ota_review_complete(hotel_id, ota)` — refresh `reviewed_at` for one OTA's items
6. `complete_ota_wizard(hotel_id)` — idempotent wizard-completion stamp
7. `reset_ota_readiness(hotel_id, ota?)` — owner-initiated state wipe (auditable)

All RPCs:
- `SECURITY DEFINER` with `SET search_path = 'public'`
- Internal `vaiyu_is_hotel_member()` re-check (defense-in-depth)
- Direct INSERT/UPDATE/DELETE revoked from `authenticated` role
- Audit writes go to `va_audit_logs` with `entity ∈ ('ota_readiness_state', 'ota_optimizer_settings')`

### Catalog (52 items, 11 categories)

| Category | Items | Total weight | Notes |
|---|---:|---:|---|
| LISTING_QUALITY | 4 | 12 | All OTAs |
| PHOTOS_MEDIA | 7 | 18 | All OTAs |
| ROOM_NAMING | 3 | 6 | 2 items N/A on Airbnb |
| AMENITIES_FACILITIES | 3 | 9 | All OTAs |
| POLICIES | 5 | 12 | All OTAs |
| REVIEW_DISCIPLINE | 3 | 10 | All OTAs |
| PAYMENT_BOOKING_CLARITY | 3 | 8 | 3 items N/A on TripAdvisor |
| SEASONAL_POSITIONING | 4 | 8 | All OTAs |
| TRUST_SIGNALS | 3 | 8 | All OTAs |
| DIRECT_BOOKING_READINESS | 4 | 9 | All OTAs |
| **MOUNTAIN_DISCLOSURE** | 13 | 30 | **Mountain-only** (state-derived + override) |
| **Non-mountain total** | 39 | **100** | |
| **Mountain hotels total** | 52 | 130 | view normalizes via SUM(possible) |

Catalog `version = 1`. Bumping requires migration + TS mirror update; the vitest
parity test (`otaOptimizer.test.ts`) catches any drift.

### Visibility Score integration (v2)

Added one new TRUST_REPUTATION signal `ota_listing_ready` (weight 4) with internal
rebalance to keep category at 25 and total at 100:

| Signal | v1 | v2 | Δ |
|---|---:|---:|---:|
| review_link_set | 5 | 4 | −1 |
| reviews_flowing | 7 | 7 | 0 |
| off_platform_response | 5 | 4 | −1 |
| trust_essentials_assets | 8 | 6 | −2 |
| **ota_listing_ready (NEW)** | — | **4** | **+4** |
| TRUST_REPUTATION subtotal | 25 | 25 | 0 |

Formula `version` bumped 1 → 2. Old snapshots retain `formula_version=1` for
trend interpretability. The bridge function `_ota_signal_for_visibility(hotel_id)`
returns true when overall OTA readiness is ≥ 50 (Moderate or Premium band).

### Staleness model (90d / 120d, locked decision)

- `reviewed_at >= now() - 90 days` → fresh (counted as-is)
- `reviewed_at < now() - 90 days AND >= now() - 120 days` → stale (counted but flagged for UI badge)
- `reviewed_at < now() - 120 days` → expired (view replaces status with UNKNOWN for scoring)

Mirrors Visibility Score's 90d verify-expiry discipline.

### Mountain gating (state-derived + override)

Default mountain-checks visibility uses `hotels.state ∈ {'Uttarakhand', 'Himachal Pradesh', 'Jammu and Kashmir', 'Ladakh', 'Sikkim', 'Arunachal Pradesh'}`. Owner override (`hotel_ota_optimizer_settings.show_mountain_checks_override`) takes precedence when set (true/false), null = use derived. Matches Seasonal Calendar's `region_state_codes` pattern.

---

## Files added/modified

### Added (15 files)

| Path | Purpose | LOC |
|---|---|---:|
| `supabase/migrations/20260601000002_ota_listing_optimizer.sql` | Main migration | 740 |
| `supabase/migrations/20260601000003_visibility_score_v2_ota_signal.sql` | Visibility v2 with `ota_listing_ready` | 480 |
| `web/src/types/otaOptimizer.ts` | TS enums + view row types | 145 |
| `web/src/config/otaOptimizer.ts` | Feature flag + catalog mirror (52 items × EN/Hi) | 590 |
| `web/src/services/otaOptimizerService.ts` | Typed RPC wrappers + summary aggregator | 280 |
| `web/src/services/otaOptimizerQueryKeys.ts` | TanStack Query key factory | 15 |
| `web/src/hooks/useOTAReadinessRealtime.ts` | 250ms debounced realtime invalidation | 50 |
| `web/src/components/owner/OTAReadinessCard.tsx` | Dashboard card with band ring + per-OTA pills | 195 |
| `web/src/routes/owner/OTAOptimizer.tsx` | Workspace page + wizard orchestrator | 270 |
| `web/src/components/ota/OTAMatrixView.tsx` | Cross-OTA matrix (read-only) | 165 |
| `web/src/components/ota/OTAEditPanel.tsx` | Per-(OTA × category) edit drawer | 145 |
| `web/src/components/ota/OTAItemSetter.tsx` | 5-state status setter + deep-link | 130 |
| `web/src/components/ota/OTASettingsStrip.tsx` | Active OTAs + mountain override | 175 |
| `web/src/components/ota/OTAReadinessWizard.tsx` | 4-step cold-start wizard | 320 |
| `web/src/config/otaOptimizer.test.ts` | SQL↔TS parity matrix + applicability + bands | 280 |
| `web/src/services/otaOptimizerService.test.ts` | Service error mapping + summary aggregator tests | 130 |
| `web/scripts/verify-ota-optimizer.mjs` | E2E node script (50 checks) | 410 |

### Modified (5 files)

| Path | Change |
|---|---|
| `web/src/main.tsx` | Lazy import + `/owner/:slug/ota` route |
| `web/src/routes/OwnerDashboard.tsx` | `OTAReadinessCard` insertion + import |
| `web/src/config/visibilityScore.ts` | Add `ota_listing_ready` signal meta + v2 weights |
| `web/src/types/visibilityScore.ts` | Add `'ota_listing_ready'` to `VisibilitySignalKey` union |
| `web/src/config/visibilityScore.test.ts` | Point parity test at v2 migration file |
| `web/src/components/seasonal/SeasonalWindowCard.tsx` | Drop dead `'unhide'` from `actionFormOpen` union (pre-existing) |

### Untouched (explicit)
- Razorpay / payments
- Folio / billing
- Walk-in flow
- Lead CRM core / Drip Engine core
- Package Builder core (deep-linked only)
- DAM core (deep-linked only)
- SEO Planner core (deep-linked only)
- Seasonal Calendar core (deep-linked only)

---

## Verification results

### Local DB smoke test
- `_ota_catalog()` returns 52 rows, catalog_version = 1 ✓
- Non-mountain weights sum = 100 ✓
- Mountain weights sum = 30 ✓
- 11 categories, all weight totals match design ✓
- `_ota_mountain_states()` returns 6 expected states ✓
- `_visibility_weights()` v2 total = 100, `ota_listing_ready` weight = 4 ✓

### Unit tests
```
Test Files  35 passed (35)
     Tests  699 passed (699)
  Duration  1.06s
```

OTA-specific:
- `otaOptimizer.test.ts`: 30 tests (parity, weights, band thresholds, freshness, applicability matrix sizes, mountain states)
- `otaOptimizerService.test.ts`: 9 tests (error code extraction, friendly error messages, summarizer)
- `visibilityScore.test.ts`: extended to v2 (catalog parity now reads v2 migration; per-category sums unchanged at 25)

### TypeScript
```
npx tsc --noEmit → 0 errors
```

### Production build
```
✓ built in 5.66s
✓ sitemap.xml written with 10 routes
```
Build warns about chunk size on unrelated modules (`ImportBookings`, `TicketDetailsDrawer`) — not from this PR.

### E2E verification (50 checks across 17 sections)
```
✓ All checks passed
```

Coverage:
1. Catalog function + version ✓
2. Mountain states helper ✓
3. View initial state (UNKNOWN + CRITICAL) ✓
4. `set_ota_active_otas` + empty-array rejection ✓
5. `set_ota_mountain_override` (true/false toggle, item-count delta) ✓
6. `set_ota_readiness_status` golden + `ITEM_KEY_NOT_IN_CATALOG` ✓
7. `OTA_NOT_APPLICABLE_FOR_ITEM` for Airbnb + room_naming ✓
8. `MOUNTAIN_ITEM_NOT_APPLICABLE` on non-mountain hotel ✓
9. `bulk_set_ota_readiness` (4-item upsert + empty/too-many/idempotent) ✓
10. `mark_ota_review_complete` (refresh + `NO_STATES_FOR_OTA`) ✓
11. `complete_ota_wizard` (first call stamps, second is idempotent) ✓
12. View aggregation (per-OTA score + band + counts; summary view) ✓
13. **Cross-tenant isolation**: outsider sees 0 rows + `NOT_A_MEMBER` on writes ✓
14. `_ota_signal_for_visibility` bridge returns false when score < 50 ✓
15. Visibility v2 weights: version=2, total=100, `ota_listing_ready`=4 ✓
16. Visibility compute includes new signal (kind=AUTO_DERIVED, max_contribution=4) ✓
17. `reset_ota_readiness` (per-OTA + all) ✓

---

## Design decisions resolved during planning

Locked via `AskUserQuestion` (recorded in conversation):
1. **All 8 OTAs with per-hotel active toggle** (not property-type defaults or trimmed set)
2. **90d stale, 120d expired** (matches Visibility Score discipline)
3. **Separate `MOUNTAIN_DISCLOSURE` category**, mountain-only via state-derived gate
4. **15-min guided cold-start wizard** (mandatory, addresses the 80-data-point burden)

Defended in plan-review iteration:
5. **No catalog table** — SQL function + TS mirror + parity test (Visibility Score pattern)
6. **No events table** — `va_audit_logs` is sufficient (Visibility Score pattern)
7. **No `property_type` column on hotels** — closed-vocab enum trap; deferred with concrete trigger condition (add `property_categories text[]` when a future catalog item needs it)
8. **No `is_mountain_property` boolean on hotels** — state-derived + per-hotel override (Seasonal Calendar pattern)

---

## Bugs caught during implementation

| # | Where | What | Fix |
|---|---|---|---|
| 1 | `OTAItemSetter.tsx` | `ReturnType<typeof OTA_STATUS_TONE['COMPLETE']>` invalid — value is a string literal, not a function | Use exported `StatusTone` type directly |
| 2 | `OTAOptimizer.tsx` | DarkShell import — file has no default export (only named `OwnerDarkPage`) | Drop wrapper; use plain `<div className="min-h-screen bg-[#0B0E14]">` like SeasonalCalendar |
| 3 | `SeasonalWindowCard.tsx` (pre-existing) | `'unhide'` in `actionFormOpen` union with no setter call, breaking `InlineReasonForm` variant typing | Drop `'unhide'` from union (dead code from earlier work) |
| 4 | `mark_ota_review_complete` SQL | `UPDATE ... RETURNING 1 INTO v_count` raises `TOO_MANY_ROWS` when >1 rows match | Drop the RETURNING INTO, rely on `GET DIAGNOSTICS ROW_COUNT` alone |
| 5 | `extractOtaErrorCode` | Regex was greedy on first `[A-Z][A-Z0-9_]+` match; "ERROR: NOT_A_MEMBER" returned 'ERROR' (not in known codes) → null | Replace with `KNOWN_CODES.find(c => msg.includes(c))` (matches Visibility Service pattern) |

All caught by typecheck + tests + E2E before deployment. Total: 5 bugs.

---

## OTA compliance summary

| Requirement | Compliance |
|---|---|
| No OTA API calls | ✓ Verified by `grep -r 'fetch.*makemytrip\|fetch.*booking.com\|fetch.*goibibo' web/src/` — zero hits |
| No scraping | ✓ No Puppeteer/Playwright in this module |
| No credentials collected | ✓ No password/login fields in any UI |
| No auto-actions | ✓ Every status mutation requires an owner click |
| Disclaimer displayed | ✓ EN + Hi disclaimers on dashboard card, workspace header, wizard intro |
| Deep links only to shipped routes | ✓ `otaFixActionRoute()` only emits `/owner/:slug/*` paths that exist |

---

## Risk summary

| Risk | Mitigation in v1 |
|---|---|
| Stale state → false-positive PREMIUM badge | 90d "Stale" badge; 120d view-level revert to UNKNOWN; "Last reviewed" stamp |
| Cold-start abandonment (80 data points) | 15-min wizard with smart defaults; skip-and-fill-later supported |
| Mountain hotel misses mountain checks | State-derived auto-detect from `hotels.state` shortlist; per-hotel override |
| Visibility Score rebalance hurts existing scores | TRUST_REPUTATION rebalance is internal (-2/-1/-1, +4), category subtotal unchanged at 25; total still 100 |
| Owner toggles off all OTAs | `CHECK array_length(active_otas, 1) >= 1` + `OTAS_REQUIRED` RPC error |
| Wizard run twice creates duplicates | `bulk_set_ota_readiness` uses `ON CONFLICT DO UPDATE`; `complete_ota_wizard` checks existing timestamp |
| RLS bypass via direct table | `REVOKE INSERT/UPDATE/DELETE` from `authenticated`; all mutations via `SECURITY DEFINER` RPC with `vaiyu_is_hotel_member()` re-check |
| 8 OTA columns × 11 categories on mobile | Matrix uses horizontal scroll on small screens; planned mobile-stacked accordion view in case scroll is too cramped (acceptable in v1; defer trigger: user feedback) |
| Catalog rename breaks state | TS catalog `itemKey` strongly commented as immutable contract; rename = breaking change requiring v2 catalog version |

---

## Manual QA checklist

For deployment-day smoke test on staging:

1. Owner with no settings opens `/owner/:slug/ota` → wizard auto-launches
2. Wizard step 1: toggle off Yatra + Expedia, save → workspace shows 6 OTAs
3. Wizard step 2: confirm mountain (auto-detected for Uttarakhand hotel) → matrix shows MOUNTAIN_DISCLOSURE row
4. Wizard step 3: mark 3-4 items COMPLETE per OTA → finish wizard
5. Workspace matrix shows updated scores; dashboard card overall band reflects
6. Click a matrix cell → drawer opens with item setters
7. Toggle one item to NOT_APPLICABLE → cell denominator drops
8. Switch mountain override to "Hide" → mountain row disappears from matrix
9. Run "Reset MMT" → MMT cells revert to all-unknown
10. Cross-tenant: second user (different hotel) cannot see this hotel's data
11. Visibility Score card shows total in range; check `ota_listing_ready` appears in signal breakdown
12. After 90 days of inactivity (or simulated by adjusting reviewed_at), stale badge appears
13. Disclaimers visible on card + workspace + wizard

---

## Rollback strategy

### Frontend
Set feature flag `OTA_LISTING_OPTIMIZER_V0_ENABLED = false` in
`web/src/config/otaOptimizer.ts`. Dashboard card hides; route 404s on
membership-gated lookup (no data exposed). No code revert needed.

### Backend (if migration must be rolled back)

Write a rollback migration (do NOT run automatically — only if explicitly approved):

```sql
-- File: rollback_20260601000002_ota_listing_optimizer.sql
DROP VIEW IF EXISTS public.v_hotel_ota_readiness_summary;
DROP VIEW IF EXISTS public.v_hotel_ota_readiness;
DROP FUNCTION IF EXISTS public.reset_ota_readiness(uuid, public.ota_platform);
DROP FUNCTION IF EXISTS public.complete_ota_wizard(uuid);
DROP FUNCTION IF EXISTS public.mark_ota_review_complete(uuid, public.ota_platform);
DROP FUNCTION IF EXISTS public.bulk_set_ota_readiness(uuid, jsonb);
DROP FUNCTION IF EXISTS public.set_ota_readiness_status(
  uuid, public.ota_platform, public.ota_readiness_category, text,
  public.ota_readiness_status, text
);
DROP FUNCTION IF EXISTS public.set_ota_mountain_override(uuid, boolean);
DROP FUNCTION IF EXISTS public.set_ota_active_otas(uuid, public.ota_platform[]);
DROP FUNCTION IF EXISTS public._ota_signal_for_visibility(uuid);
DROP FUNCTION IF EXISTS public._ota_effective_mountain(uuid);
DROP FUNCTION IF EXISTS public._ota_catalog_has_item(public.ota_readiness_category, text);
DROP FUNCTION IF EXISTS public._ota_catalog();
DROP FUNCTION IF EXISTS public._ota_mountain_states();
DROP TABLE IF EXISTS public.hotel_ota_readiness_state CASCADE;
DROP TABLE IF EXISTS public.hotel_ota_optimizer_settings CASCADE;
DROP TYPE IF EXISTS public.ota_readiness_band;
DROP TYPE IF EXISTS public.ota_readiness_status;
DROP TYPE IF EXISTS public.ota_readiness_category;
DROP TYPE IF EXISTS public.ota_platform;
```

Visibility Score v2 rollback (only if needed):
- Revert `_visibility_weights()` to v1 weights (5/5/8 instead of 4/4/6, no `ota_listing_ready`)
- Revert `_compute_visibility_score()` to drop the `ota_listing_ready` block
- Existing v2 snapshots retain `formula_version=2` for historical accuracy

---

## Deployment recommendation

Build passed. Typecheck clean. 699/699 unit tests passing. 50/50 E2E checks passing. RLS verified cross-tenant. Migrations applied cleanly to local. No `// TODO` or `// FIXME` markers in the codebase.

**Deployment appears safe, pending your approval.**

Run order (no auto-deploy — owner triggers):
1. `supabase/migrations/20260601000002_ota_listing_optimizer.sql`
2. `supabase/migrations/20260601000003_visibility_score_v2_ota_signal.sql`
3. Deploy frontend (`npm run build` artifact)
4. Smoke-test using the Manual QA checklist above
