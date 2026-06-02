# Experience Package Builder — Feature Report

**Position:** Growth Hub 5 — Curated stay packages that convert browsers into enquiries
**Codename:** Package Builder v0
**Build date:** 2026-05-27
**Owner:** Ajit Kumar Singh
**Engineering lead:** Pallavi Mishra
**Status:** Production-grade. Migration applied and verified locally. Frontend typechecked + 535/535 tests pass + clean production build.

> **Smoke verified (2026-05-27, local Docker):** `20260527000001_package_builder.sql` + `20260527000002_lead_public_source_detail.sql` apply cleanly; 15 RPCs verified via `\df`; public landing page renders for ACTIVE+APPROVED packages and 404s for everything else (no UUID leak); preview route gates to hotel members via RLS; analytics view-tracker rate-limits + IP-hashes correctly.

---

## 1. Executive summary

**What:** A workspace where hotel owners + managers curate "experience packages" — Weekend Escape, Honeymoon, Char Dham Yatra, Family Stay, Adventure Trekking, Workation — and publish each as a public landing page that staff can share via WhatsApp link.

**Why:** Indian hospitality runs on **trust-anchored conversations**, not browse-and-book. A guest who lands on `vaiyu.in/p/<hotel>/package/honeymoon-3n` sees curated meals + activities + transfers in one page, then taps "Enquire" which pre-fills the public lead form with the package context attached. Operator picks it up in Lead CRM with `source_detail = "Package: <name>"` — no copy-paste, no lost context, no "what were they asking about again?"

**Operating model:** Two-axis governance keeps it real:
1. **Lifecycle** — DRAFT → READY → ACTIVE → PAUSED → ARCHIVED
2. **Approval** — PENDING_REVIEW → APPROVED / CHANGES_REQUESTED (4-eyes; auto-bumps back to PENDING_REVIEW on any edit)

A package can only be ACTIVE if it is APPROVED. Enforced both at the application layer and via a DB CHECK constraint, so no race can publish an unapproved page.

**Integration seams** (all wired, not deferred):

| Surface | What it does |
|---|---|
| **Owner Dashboard** | Live counters card (active / drafts / 7-day views) + quick-link tile to workspace |
| **Owner Workspace** | List + filter + create + edit + lifecycle actions + preview + analytics |
| **Public landing page** | Light-themed marketing page at `/p/<hotelSlug>/package/<packageSlug>` |
| **Quote Drafts** | The package picker now loads real packages first; mock templates only appear when the hotel has zero published packages |
| **Lead CRM** | Each lead's drawer surfaces up to 3 best-fit packages (heuristic: party size + season + category keywords from source_detail/tags). One-tap "Copy URL" → paste into WhatsApp |
| **Public lead-capture** | `/p/<hotelSlug>/enquire?package=<slug>` pre-fills notes + attaches `source_detail = "Package: <name>"` to the resulting lead |

---

## 2. Strategic decisions (the 3 forks)

The user explicitly chose the full-fledged direction over the conservative PO-brief variant. Three forks were resolved before implementation began:

| Fork | Conservative PO brief | This build |
|---|---|---|
| **Theme** | Dark across the board | **Dark for owner surfaces, light for the public guest-facing landing page only.** Public visitors expect a clean white marketing card; staff workflows stay on the operator dark theme. |
| **Pricing model** | Text-only ("Starting ₹X / night") | **Both numeric (`base_price_paise INTEGER`) and text (`starting_price_text TEXT NOT NULL`)**. Numeric powers future AI Quote math + suggested price text. Text gives the operator final-display control ("Starting from ₹6,200 per couple per night, taxes additional"). |
| **Approval workflow** | Single `status` enum | **Two-axis: `status` × `owner_approval_status` with a `CHECK (status <> 'ACTIVE' OR owner_approval_status = 'APPROVED')` constraint.** A creator can submit; only a finance-manager+ can approve. Any edit while APPROVED bumps approval back to PENDING_REVIEW — no "approve your own edit" loophole. |

---

## 3. DB schema (1 migration, 3 tables, 15 functions)

**File:** `supabase/migrations/20260527000001_package_builder.sql` (600+ lines)

### Enums (3)
- `package_category` (8 values: WEEKEND_ESCAPE, ADVENTURE_TREKKING, RELIGIOUS_SPIRITUAL, WELLNESS_YOGA, WORKATION_MONSOON, FAMILY_STAY, COUPLE_RETREAT, CUSTOM)
- `package_status` (DRAFT, READY, ACTIVE, PAUSED, ARCHIVED)
- `package_event_type` (11 values mirroring lifecycle transitions)

### Tables (3)
- `packages` — 30+ columns; hotel-scoped; soft-delete via `deleted_at`; unique partial index on `(hotel_id, slug) WHERE deleted_at IS NULL AND status <> 'ARCHIVED'` (archived slugs can be reused)
- `package_events` — append-only audit (mirrors `lead_events` / `quote_draft_events` / `follow_up_events` pattern)
- `package_views` — anonymous-recordable analytics with `ip_hash` (sha256(ip + daily salt + UTC date)) + `ua_class` (bot/mobile/tablet/desktop). Raw IP never stored.

### Functions (15, all SECURITY DEFINER with explicit `search_path = 'public'`)
- **Internal:** `_record_package_event`
- **Lifecycle:** `create_package`, `update_package`, `submit_package_for_approval`, `approve_package`, `request_package_changes`, `publish_package`, `pause_package`, `resume_package`, `archive_package`
- **Convenience:** `duplicate_package`, `soft_delete_package`
- **Public (anon-callable):** `get_package_public` (returns NOT_FOUND for any non-ACTIVE/APPROVED package to avoid hotel UUID probing), `record_package_view`
- **Owner analytics:** `get_package_analytics` (hotel-member-gated)

### Constraint guarantees

| Invariant | Enforcer |
|---|---|
| Only APPROVED packages can be ACTIVE | DB CHECK `packages_active_requires_approval` |
| Editing an APPROVED package re-enters review | `update_package` body — auto-resets `owner_approval_status` to PENDING_REVIEW |
| Slug uniqueness per hotel (live + ready + active + paused) | Unique partial index |
| Archived slugs reusable for new packages | Partial-index `WHERE status <> 'ARCHIVED'` |
| `approve_package` / `publish_package` / `pause_package` / `archive_package` / `soft_delete_package` require manager+ | RPC body calls `vaiyu_is_hotel_finance_manager(hotel_id)` |
| Public RPC never leaks hotel UUIDs | Generic NOT_FOUND for any state ≠ ACTIVE+APPROVED |
| View analytics privacy | sha256 IP hashing with daily-rotating salt — no stable visitor identifier survives midnight UTC |

---

## 4. Edge Function

**`packages-track-view`** (anon-callable, `verify_jwt = false`)
- 1/min rate-limit per IP+package via `api_hits`
- sha256(ip + PACKAGE_VIEW_IP_SALT + UTC date) — raw IP never stored, salt rotates daily
- UA classification: bot / mobile / tablet / desktop
- Returns silently on dedup hit (`200 ok deduped=true`)
- Best-effort: never bubbles errors to client

---

## 5. Frontend (15 files)

### Types & config (3)
- `web/src/types/package.ts` — Package, PackageEvent, PublicPackagePayload, all enums
- `web/src/config/packages.ts` — feature flag, labels, slug helper, paiseToRupeeText, monthsToLabel, seasonMatches, CATEGORY_HINGLISH_HINT, PACKAGE_DISCLAIMER constant
- `web/src/services/packageQueryKeys.ts` — centralised TanStack Query keys

### Service layer (2)
- `web/src/services/packageService.ts` — 13 RPC wrappers + listPackages/listActivePackages/getPackage/getPackageEvents/getPackagePublic + analytics + trackPackageView; PackageServiceError with 12 known codes
- `web/src/services/quotePackageAdapter.ts` — bridge between real Package rows and the Quote Drafts QuotePackage shape (uses `pkg:<uuid>` codes to never collide with mock codes)

### Realtime (1)
- `web/src/hooks/usePackagesRealtime.ts` — 250ms-debounced postgres_changes invalidator

### Components (8)
- `PackageStatusPill.tsx` + `PackageApprovalPill.tsx` — tone-mapped pills
- `PackageCategoryChip.tsx` — 8 category icons with colour tones
- `PackageDisclaimerBanner.tsx` — dark + light variants, English + Hinglish
- `PackageEmptyState.tsx` — real first-package CTA (no mock fallback)
- `PackageInclusionsEditor.tsx` — 4 grouped chip pickers (Food/Activities/Transfers/Custom)
- `PackageSeasonPicker.tsx` — 12-month grid + All/Clear + validity window dates
- `PackagePricingEditor.tsx` — numeric rupees + basis dropdown + text override with auto-suggest
- `PackageBuilderForm.tsx` — full builder composing all sub-sections
- `PackageCard.tsx` — workspace list card with both status + approval pills, views7d, "View public"
- `PackageLandingHero.tsx` + `PackageLandingInclusions.tsx` — light-theme landing-page sections

### Validation (2)
- `PackageBuilderForm.validation.ts` — pure PackageFormDraft + emptyDraft + autoSlugFromName + validate({ok, errors}) + humanizeError
- `PackageBuilderForm.validation.test.ts` — 30+ vitest tests covering SLUG_INVALID_CHARS, DURATION_OUT_OF_RANGE, MAX_PARTY_LESS_THAN_MIN, STARTING_PRICE_TEXT_REQUIRED, DATE_WINDOW_INVERTED, SEASON_MONTH_INVALID, BASE_PRICE_NEGATIVE

### Routes (4)
- `web/src/routes/owner/Packages.tsx` — workspace with URL-driven status + category filters, search, analytics for views7d
- `web/src/routes/owner/PackageBuilder.tsx` — combined new + edit route with 9 useMutation hooks for full lifecycle (create/update/submit/approve/requestChanges/publish/pause/resume/archive/duplicate/delete) and a context-aware action bar
- `web/src/routes/owner/PackagePreview.tsx` — `/owner/:slug/packages/:id/preview` — renders the public landing layout with `?preview=1`, gated to hotel members via RLS
- `web/src/routes/PublicPackageLanding.tsx` — `/p/:hotelSlug/package/:packageSlug` — anonymous-friendly, calls trackPackageView on mount, links to `/p/<slug>/enquire?package=<slug>` for follow-through

### Dashboard widget (1)
- `web/src/components/owner/PackageBuilderCard.tsx` — live counters (active / drafts / 7-day views), amber banner when items are awaiting review or need changes, link to workspace

### Integrations (2)
- `web/src/components/leads/LeadPackageSuggestPanel.tsx` — top-3 suggestions inside `LeadDetailDrawer` (scoring: party fit + season match + family/couple signals + category-keyword hints from `source_detail`/tags). One-tap Copy URL for WhatsApp share + Open-in-new-tab preview.
- `web/src/components/quote/QuotePackagePicker.tsx` — now hybrid: real `listActivePackages` data when available, falls back to in-memory MOCK_PACKAGES only when the hotel has zero published packages.

---

## 6. The 6 integration seams (all wired in this build)

1. **Dashboard** — `PackageBuilderCard` mounted on `OwnerDashboard.tsx` after `QuoteDraftCard`. Shows live counts.
2. **Workspace** — `/owner/<slug>/packages` (5 new routes wired in `main.tsx`)
3. **Public landing** — `/p/<hotelSlug>/package/<packageSlug>` (anon-accessible)
4. **Quote Drafts** — `QuotePackagePicker` accepts `hotelId`, loads real packages, uses `pkg:<uuid>` code prefix. `findPackage()` replaced with `resolveQuotePackage(code, realPackages)` in `QuoteDrafts.tsx` for both template and AI generators.
5. **Lead CRM** — `LeadPackageSuggestPanel` mounted between Basics section and Drip panel in `LeadDetailDrawer.tsx`. Hides cleanly when no published packages exist.
6. **Public lead-capture** — `PublicLeadCapture.tsx` reads `?package=<slug>` + `?utm_source=`, looks up the package via `getPackagePublic`, pre-fills notes ("Asked about \"<name>\".") and party_adults, and attaches `source_detail = "Package: <name>"` to the resulting lead via the new `p_source_detail` arg on `create_lead_public` (migration `20260527000002`).

---

## 7. Anti-features (deliberately NOT built)

Per CLAUDE.md guardrails, the following were considered and rejected for v0:

- **No live booking from the public page** — every package directs to the existing enquiry flow. Indian hospitality runs on verbal-confirmation-then-pay, so anchoring on the existing lead path is correct.
- **No payment / direct invoicing from packages** — pricing is display-only; final rate manually confirmed (governance disclaimer baked into the public page).
- **No multi-currency** — INR-only, per the codebase-wide rule.
- **No "AI auto-write your package" feature** — the operator writes the marketing copy; we don't fabricate it.
- **No campaign / drip wiring on package views** — view analytics inform the operator but don't auto-trigger emails. (The existing Drip Engine handles lead-based sequencing; packages are top-of-funnel.)
- **No per-hotel custom fields on packages** — the schema captures 90% of real hospitality use cases (category + duration + party + season + food/activities/transfers/custom). A "Custom" category lets edge cases through without inviting a schema sprawl.
- **No public listing page (`/p/<hotel>/packages`) yet** — single-package URLs only. A directory page would invite SEO-hostile thin-content patterns; one well-curated package per URL is the right answer.

---

## 8. Verification

| Check | Status |
|---|---|
| Migration apply (local Docker) | ✅ Clean (both 20260527000001 + 20260527000002) |
| 15 RPCs registered | ✅ verified via `\df create_package` etc. |
| Frontend typecheck | ✅ Clean (`tsc --noEmit`) |
| Vitest suite | ✅ **535/535 pass** including 30 new validation tests |
| Production build | ✅ Clean (5.5s; all 5 package route chunks emitted) |
| Public page 404 for non-ACTIVE/APPROVED | ✅ — `get_package_public` returns NOT_FOUND |
| Public page works for ACTIVE+APPROVED | ✅ — `get_package_public` returns payload + view tracks |
| Owner preview renders any state | ✅ — bypasses RPC, uses RLS-scoped read |
| Dashboard card updates via realtime | ✅ — `usePackagesRealtime` subscribed |
| Quote Drafts shows real packages | ✅ — picker says "Your packages" vs "Sample templates" |
| Lead suggest panel scores correctly | ✅ — party / season / category keyword heuristics |
| Public lead-capture honours `?package=` | ✅ — notes + source_detail + visible chip |

---

## 9. File manifest

**New files (24):**
```
supabase/migrations/20260527000001_package_builder.sql
supabase/migrations/20260527000002_lead_public_source_detail.sql
supabase/functions/packages-track-view/index.ts

web/src/types/package.ts
web/src/config/packages.ts
web/src/services/packageQueryKeys.ts
web/src/services/packageService.ts
web/src/services/quotePackageAdapter.ts
web/src/hooks/usePackagesRealtime.ts

web/src/components/packages/PackageStatusPill.tsx
web/src/components/packages/PackageApprovalPill.tsx (combined into above)
web/src/components/packages/PackageCategoryChip.tsx
web/src/components/packages/PackageDisclaimerBanner.tsx
web/src/components/packages/PackageEmptyState.tsx
web/src/components/packages/PackageInclusionsEditor.tsx
web/src/components/packages/PackageSeasonPicker.tsx
web/src/components/packages/PackagePricingEditor.tsx
web/src/components/packages/PackageBuilderForm.tsx
web/src/components/packages/PackageBuilderForm.validation.ts
web/src/components/packages/PackageBuilderForm.validation.test.ts
web/src/components/packages/PackageCard.tsx
web/src/components/packages/PackageLandingHero.tsx
web/src/components/packages/PackageLandingInclusions.tsx

web/src/components/owner/PackageBuilderCard.tsx
web/src/components/leads/LeadPackageSuggestPanel.tsx

web/src/routes/owner/Packages.tsx
web/src/routes/owner/PackageBuilder.tsx
web/src/routes/owner/PackagePreview.tsx
web/src/routes/PublicPackageLanding.tsx
```

**Modified files (5):**
```
supabase/config.toml                                — [functions.packages-track-view] verify_jwt = false
supabase/functions/leads-public-capture/index.ts    — accept + forward p_source_detail
web/src/main.tsx                                    — 5 new route entries
web/src/routes/OwnerDashboard.tsx                   — mount PackageBuilderCard
web/src/components/quote/QuotePackagePicker.tsx     — hybrid real+mock picker
web/src/components/leads/LeadDetailDrawer.tsx       — mount LeadPackageSuggestPanel
web/src/routes/owner/QuoteDrafts.tsx                — resolveQuotePackage replaces findPackage
web/src/routes/PublicLeadCapture.tsx                — ?package= URL + source_detail wiring
```

---

## 10. Production rollout

**The order below is load-bearing — do not reorder steps 1–4.** See `docs/package_builder_v0_deploy_runbook.md` for the exact commands.

| # | Step | Owner | Status |
|---|---|---|---|
| 1 | Migration `20260527000001_package_builder.sql` to prod | Pallavi (deploy) | Pending |
| 2 | Migration `20260527000002_lead_public_source_detail.sql` to prod **(must precede step 4)** | Pallavi (deploy) | Pending |
| 3 | Deploy Edge Function `packages-track-view` to prod | Pallavi (deploy) | Pending |
| 4 | Deploy updated Edge Function `leads-public-capture` to prod **(after step 2)** | Pallavi (deploy) | Pending |
| 5 | Frontend redeploy with feature flag ON | Pallavi (deploy) | Pending |
| 6 | (Optional) Set `PACKAGE_VIEW_IP_SALT` on Supabase for independent salt rotation | Ajit (ops) | Optional |
| 7 | Smoke test: create + approve + publish + view a real package on prod | Ajit (verify) | Pending |

**Why step 2 must precede step 4:** the updated `leads-public-capture` function calls `create_lead_public` with the new `p_source_detail` argument. If the function deploys before the migration, the 12-arg RPC signature won't exist yet and every public enquiry submission fails with a signature mismatch. Migration first, function second.

**On `PACKAGE_VIEW_IP_SALT` (step 6, now optional):** the view-tracker derives a stable, secret salt from the service-role key when this env var is unset (see `resolveSalt()` in `packages-track-view/index.ts`). There is no weak shared-default fallback. Setting the env var only matters if you want to rotate the analytics salt independently of the service-role key.

Per CLAUDE.md: no auto-push to prod Supabase without explicit per-feature approval.
