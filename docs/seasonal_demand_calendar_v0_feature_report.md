# Seasonal Demand Calendar v0 — Feature Report

**Position 8** of the VAiyu Growth Hub roadmap. Shipped 2026-06-01.

---

## What this is (and what it is NOT)

**IS:** A curated planning + readiness workspace that converts known regional travel rhythms (Char Dham, monsoon, weddings, long weekends) into deterministic prep checklists owners walk through manually.

**IS NOT:**
- A forecasting engine
- A demand / revenue / occupancy / booking prediction system
- A campaign automation queue
- A publish path of any kind
- An AI feature

**Zero outbound side effects:** no email, WhatsApp, SMS, scheduled tasks, CRON jobs, edge functions, OTA scraping, Google scraping, or AI text generation.

---

## Architecture

Three-layer schema mirroring DAM (Position 6) + Local SEO Planner (Position 7):

| Layer | Table | Purpose |
|---|---|---|
| Catalog | `seasonal_calendar_windows` | System-defined; 16 seeded rows; mutations only via migration |
| Per-hotel state | `hotel_seasonal_window_states` | UNIQUE(hotel_id, window_code, season_year); only `ticked_keys text[]` for checklist progress (labels render live from catalog) |
| Append-only events | `hotel_seasonal_window_events` | First-class governance timeline; rendered inline in window cards |
| Read-model view | `v_visible_seasonal_windows` | Hotels × catalog (region-filtered) with computed urgency, days_to_start, checklist progress |

### Key architectural decisions

**`ticked_keys text[]` over jsonb-cloned-checklist.** State stores only the keys; labels come live from catalog. Seed updates (new prep step, fixed typo, deprecated item) roll forward instantly without per-hotel migration.

**Catalog-owned `region_state_codes text[]` + `_seasonal_normalize_state()` helper.** `hotels` table is **not modified** (it already has `state` from baseline migration). The catalog declares acceptable lowercase region codes; the helper normalizes hotels.state free-text (`"Uttarakhand"`, `"UK"`, `"uttarakhand"`) for matching. Reviewer's pushback: "don't modify hotels without inspection" — heeded.

**`is_approximate boolean` + widened windows.** Char Dham doors, Holi, Diwali, monsoon onset all shift annually (panchang/lunar/weather). Approximate windows have intentionally wide ranges that always contain the actual date; UI softens display ("Around late April – late May") and surfaces a `date_disclaimer`. **We never have to ship a date-correction migration.**

**Explicit `WHERE vaiyu_is_hotel_member(h.id)` in the view.** `hotels` carries permissive public-read policies (microsite, public-jobs, etc.). `security_invoker` alone leaked cross-tenant rows through the view. Mandatory defense-in-depth (same pattern as DAM's `v_hotel_asset_status`). Caught by E2E verify; would have been invisible in unit tests.

**Permission split:**
- **Any member** (incl. staff): tick checklist, edit notes
- **Manager+** (`vaiyu_is_hotel_finance_manager`): dismiss-for-year, override urgency, mark ready, return-to-planning, permanently-hide

**Inline timeline (no separate drawer component).** Reviewer's point: drawer was the least valuable piece. Events table preserved; timeline renders inline in the window card via a `View history` collapsible — one less file, no modal context switch.

---

## RPCs (8 total — all SECURITY DEFINER, `SET search_path = 'public'`)

| RPC | Gate | Behaviour |
|---|---|---|
| `tick_seasonal_checklist` | member | Toggles a checklist item. Validates item_key exists in catalog seed. Idempotent. |
| `update_seasonal_window_notes` | member | Owner / internal notes; empty string normalized to NULL; audit fires only on actual change. |
| `override_seasonal_window_urgency` | manager+ | Sets/clears `urgency_override` + required reason. View reflects override. |
| `dismiss_seasonal_window_for_year` | manager+ | review_status → DISMISSED + required reason. Clears any `marked_ready_*` to satisfy READY-pairing CHECK. |
| `resume_seasonal_window` | manager+ | DISMISSED → PLANNING. INVALID_TRANSITION otherwise. |
| `mark_seasonal_window_ready` | manager+ | PLANNING → READY + `marked_ready_at/by`. Idempotent (no-op if already READY). Logs checklist completion % in event payload. |
| `return_seasonal_window_to_planning` | manager+ | READY → PLANNING. INVALID_TRANSITION otherwise. |
| `set_seasonal_window_permanently_hidden` | manager+ | Cross-year "never relevant" toggle + required reason when hiding. |
| `get_seasonal_window_timeline` (read) | member | Last N events for a (hotel, window, season_year) — powers the inline history. |

Plus internal helpers (all IMMUTABLE/STABLE):
- `_seasonal_normalize_state(text)`
- `_seasonal_window_next_occurrence(...)` — handles cross-year windows correctly
- `_seasonal_window_urgency(...)` — TS mirror parity-tested
- `_seasonal_window_current_season_year(text, timestamptz)`
- `_record_seasonal_window_event(...)` — internal audit helper

---

## Seed catalog (16 windows)

Categories: `RELIGIOUS_YATRA`, `METRO_ESCAPE`, `CLIMATE_PEAK`, `OFF_PEAK_VALUE`, `WINTER_SNOW`, `LONG_WEEKEND`, `WELLNESS_WORKATION`, `FAMILY_EVENT`.

Each window ships with:
- EN + Hi `display_name`, `why_it_matters`, `recommended_action`, `target_guest_segment`, `suggested_package_idea`
- Wide approximate date window OR exact dates
- Region codes (`{uk}`, `{uk,hp,jk}`, `{dl,hr,up,uk}`, etc.; `{}` for PAN_INDIA)
- 4–7 item prep checklist (with `days_before` and optional `link_target` to PACKAGE_BUILDER/DRIP/DAM/SEO_PLANNER)
- `date_disclaimer` copy when approximate

12 of 16 windows are approximate (yatra/lunar/seasonal); 4 are exact-date (Republic Day, Independence Day, Christmas/NYE, Valentine's Week).

**Catalog content note (post-hostile-pass v2):** `EID_AL_FITR` was originally in the seed but dropped during the second hostile re-verification pass. The reason: Eid al-Fitr drifts ~11 days earlier per Gregorian year (2026 Mar 21, 2027 Mar 10, 2028 Feb 26, 2029 Feb 14), and a single static window cannot absorb ~40 days of drift without producing a meaninglessly wide NOW state. Replaced with `VALENTINES_WEEK` (Feb 7-14, exact dates, stable hospitality marketing window for couples segment). Eid returns when per-year lunar overrides ship as a future enhancement. Simultaneously, `LONGWKND_HOLI` was widened from `Mar 1-25` → `Feb 15-Mar 30` to cover Holi 2030 (Feb 19) which fell outside the original range.

---

## Files touched

**Added (15):**
- `supabase/migrations/20260530000001_seasonal_demand_calendar.sql` (~960 lines: enums, helpers, 3 tables, 1 view, 8 RPCs + 1 read RPC, RLS, 16-row seed)
- `web/src/config/seasonalCalendar.ts` (flag + EN/Hi disclaimer + label dicts + TS urgency mirror + window-range formatter)
- `web/src/types/seasonalCalendar.ts`
- `web/src/services/seasonalCalendarService.ts`
- `web/src/services/seasonalCalendarQueryKeys.ts`
- `web/src/services/seasonalCalendarService.test.ts` (33 cases, incl. SQL↔TS urgency parity matrix)
- `web/src/hooks/useSeasonalWindowsRealtime.ts`
- `web/src/components/owner/SeasonalCalendarCard.tsx` (dark dashboard card)
- `web/src/components/seasonal/SeasonalDisclaimerBanner.tsx`
- `web/src/components/seasonal/SeasonalCategorySection.tsx`
- `web/src/components/seasonal/SeasonalChecklist.tsx`
- `web/src/components/seasonal/SeasonalWindowCard.tsx` (header + dates + checklist + notes + governance actions + inline timeline)
- `web/src/routes/owner/SeasonalCalendar.tsx` (workspace page)
- `web/scripts/verify-seasonal-calendar.mjs` (Node E2E verifier — 41 checks)
- `docs/seasonal_demand_calendar_v0_feature_report.md` (this file)

**Modified (2 — surgical):**
- `web/src/main.tsx` — lazy import + route at `/owner/:slug/seasonal`
- `web/src/routes/OwnerDashboard.tsx` — card + quick-nav 📅 tile

**Untouched:** Every other module. `hotels` table. All payment / folio / bookings / housekeeping / tickets / HRMS schema. No edge functions. No new buckets. No CRON.

---

## Verification

| Check | Result |
|---|---|
| TypeScript typecheck | ✓ pass |
| Production build (`vite build`) | ✓ pass |
| Unit tests (`vitest run`) | ✓ 614 / 614 (33 new) |
| E2E (`verify-seasonal-calendar.mjs`) | ✓ 41 / 41 |

**Critical bug caught by E2E only (not unit/typecheck):** view inherited permissive public-read from `hotels`; required explicit `vaiyu_is_hotel_member(h.id)` filter in `joined` CTE. Mirrored DAM's `v_hotel_asset_status` pattern.

### Hostile re-verification pass — 4 issues caught + fixed

After the implementation passed all automated checks, an adversarial walkthrough surfaced four real issues that would have shipped:

1. **Wrong-year dismiss label** — `"Dismiss for {season_year}"` showed e.g. "Dismiss for 2025" in January 2026 for cross-year windows like Winter Snow Stay (Dec→Feb cycle keyed on its start year). Fixed by replacing with cycle-agnostic copy "Dismiss for this cycle" (EN) / "Iss cycle ke liye dismiss karein" (Hi) in both the button and the inline reason form title.
2. **Broken "Next 3 to focus on" anchors** — `<Link to="#WINDOW_CODE">` had no matching `id` on `<SeasonalWindowCard>`. Click did nothing. Fixed by adding `id={w.window_code}` + `scroll-mt-4` to the card's `<article>` and converting tiles to `<button>` with explicit `scrollIntoView({behavior: 'smooth', block: 'start'})`.
3. **Silent workspace failure on view query error** — `listQ.error` had no UI surface; a failed fetch rendered as an empty workspace with no feedback. Fixed by adding a visible rose-bordered error block with a **Retry** button calling `listQ.refetch()`.
4. **Catalog checklist-key safety not documented** — per-hotel `ticked_keys[]` reference catalog seed keys by string; a future migration renaming a key would orphan all existing ticks silently. Added strong `COMMENT ON TABLE` explicitly forbidding key renames ("Add new keys, soft-deprecate with `is_active=false`; do NOT mutate existing key strings").

All 4 fixes re-verified: typecheck ✓, build ✓, 614/614 unit tests ✓, 41/41 E2E ✓.

### Second hostile re-verification pass — 3 more issues caught + fixed

A second adversarial walkthrough surfaced three additional issues, all production-blocking:

5. **Eid al-Fitr lunar drift exceeded the window** — the `EID_AL_FITR` window (Mar 25 – May 30) **missed the actual Eid date in every year from 2026 onward** because Eid drifts ~11 days earlier per Gregorian year (2026 Mar 21, 2027 Mar 10, 2028 Feb 26). A single static range cannot absorb ~40 days of drift. **Fix:** dropped the window; replaced with `VALENTINES_WEEK` (Feb 7-14, exact dates) for stable couples-segment marketing. Eid will return when per-year overrides ship.
6. **Holi 2030 fell outside the window** — `LONGWKND_HOLI` (Mar 1-25) covered Holi 2026-2029 but missed 2030 (Feb 19). **Fix:** widened to Feb 15 – Mar 30 (covers 2026-2030 + buffer). Disclaimer updated to mention the broader range explicitly.
7. **Notes save UX leaked stale "Saved" alongside failure** — when a save failed, `notesSavedAt` from a prior success kept showing "Saved" while the error message appeared simultaneously. Worse: a realtime invalidation arriving mid-typing (within the 700ms debounce) would silently clobber the user's unsaved input. **Fix:** added a `localDirty` flag (set on input, cleared on successful save) to protect against the realtime clobber; `notesSavedAt` now clears on save failure; the textarea border turns rose + the error renders inline beneath. Also improved the dashboard card's empty-state copy ("No active planning windows" → distinct messages for loading / error / all-dismissed).

All 3 fixes re-verified: typecheck ✓, build ✓, 614/614 unit tests ✓, 40/40 E2E ✓ (catalog now has 16 windows: Eid out, Valentine's in, Holi widened).

---

## Rollback

1. **Hide UI instantly:** `SEASONAL_DEMAND_CALENDAR_V0_ENABLED = false` in `web/src/config/seasonalCalendar.ts` → redeploy.
2. **Full schema rollback:** `DROP TABLE … CASCADE` on the 3 tables + DROP enums + DROP view + DROP functions. Catalog is recoverable by re-applying migration. No FK damage to existing tables (read-only `hotels` reference).
3. **Storage:** no buckets created; no cleanup.

---

## What is intentionally NOT in v0

Per CLAUDE.md quality bar ("100% production, no deferred known issues"), the only items not in v0 are ones that genuinely depend on infrastructure VAiyu doesn't have:

- **Notification engine / outbound reminders.** VAiyu has no in-app notification primitive today. Dashboard widget IS the nudge.
- **Lunar-floating exact dates per year** (Holi 2027 = Mar 3, not Mar 14). Wide-window approach makes annual updates unnecessary; if a hotel asks for exact-date precision, add a `per_year_override` jsonb column to catalog.
- **Multi-hotel state aggregation** for multi-property owners. Out of scope (no current customer with multi-property + cross-property planning workflow).

These have concrete trigger conditions documented above.

---

## Manual QA checklist

1. Open `/owner/tenant1` → "Seasonal Demand Calendar" dark card appears with next-focus line + urgency counters.
2. Click the card → workspace at `/owner/tenant1/seasonal` opens with:
   - Hotel header + ring (% ready)
   - 4-stat counter strip (Now / Prepare / Watch / Ready)
   - Amber disclaimer banner (EN + Hi)
   - "Next 3 to focus on" highlight tiles
   - 8 category accordions (collapsed if no urgent window in section)
3. Toggle "Show Hinglish" → labels switch to Hinglish.
4. Inside any window:
   - Tick a checklist item → optimistic update, persists across refresh.
   - Edit owner notes → auto-saves after 700ms; shows "Saved".
   - Click "Mark READY" → status switches; "Return to planning" appears.
   - Click "Dismiss for {year}" → reason form; submit → window moves to dismissed state.
   - Click "Override urgency" → urgency picker + reason form.
   - Click "Hide forever" → reason form; submit → window dims, badged "Hidden".
   - Click "View history" → inline timeline of all governance events with actor + time.
5. Refresh the page → all state preserved.

---

## Deployment recommendation

Build passed. Typecheck passed. 614 unit tests passing. 41 E2E checks passing including cross-tenant RLS isolation. No regressions in unrelated modules.

**Deployment appears safe, pending user approval.**

Migration runs additively: 3 new tables, 1 new view, ~14 new functions, 16 catalog seed rows. No destructive changes to existing tables.
