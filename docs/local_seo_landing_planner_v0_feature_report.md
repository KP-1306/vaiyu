# Local SEO Landing Planner v0 — Feature Report

**Position:** Growth Hub 7 — INTERNAL content-planning + governance workspace for local-SEO landing-page *ideas*
**Codename:** Local SEO Landing Planner v0
**Build date:** 2026-05-29 (planner v0 — publisher is Phase 2, **not** built)
**Owner:** Ajit Kumar Singh
**Engineering lead:** Pallavi Mishra
**Status:** Production-grade. Migration applied + verified locally. Frontend typechecked + 581/581 tests pass + clean production build. Full browser+DB smoke test passed (2 bugs found and fixed inline).

> **Smoke verified (2026-05-31, local Docker):**
> - Migration applies cleanly; classifier truth-table correct (NEEDS_PROOF / SAFE / RISKY / DUPLICATE / FAKE / ON_HOLD).
> - Workspace opens, dev-auth works, empty state + 6 safe starters render.
> - Create from a starter → DB row created with the same risk the UI showed.
> - Submit-for-review → IN_REVIEW; Approve → READY_TO_BUILD + APPROVED atomically; audit trail clean (CREATED → SUBMITTED → APPROVED).
> - Duplicate detection: a re-cased / re-punctuated title (`"FAMILY  STAY in mukteshwar!"`) normalises-equal to the existing live blueprint and is flagged DUPLICATE_LOW_VALUE.
> - Approve guard: a RISKY_DOORWAY blueprint raises `RISK_BLOCKS_APPROVAL` from the RPC.
> - TS classifier vs SQL classifier: 20 vitest assertions in lockstep.

---

## 1. Executive summary

**What:** An internal workspace where owners and managers plan local-SEO **page ideas** (called blueprints), classify each idea against a deterministic Policy Shield, gather proof, and walk approved blueprints through a two-axis governance lifecycle. The system flags risky/spammy/fake-local concepts *before* anyone builds a real page.

**Why:** Programmatically generating per-city/per-hotel landing pages from a multi-tenant SaaS is the textbook Google-doorway-pages pattern — it can tank a hotel's *entire* domain in a manual spam action. This v0 is the safety-first foundation: deliberately publishes nothing, but ensures that when (Phase 2) a publisher does ship, it can only build pages the planner has marked `SAFE_BLUEPRINT` with proof attached.

**Operating model — two-axis governance (mirrors Package Builder):**
1. **Lifecycle** — DRAFT → IN_REVIEW → READY_TO_BUILD → ON_HOLD → ARCHIVED
2. **Review** — PENDING_REVIEW → APPROVED / CHANGES_REQUESTED
3. **Invariant** — `status='READY_TO_BUILD' ⇒ review_status='APPROVED'` (DB CHECK + RPC). A manager+ approves; approval atomically lifts status to READY_TO_BUILD.

**Strict guardrails enforced in code:**
- No public routes. No sitemap/robots/metadata changes. No AI calls. No keyword scraping. No external SEO APIs. No anon grants.
- Disclaimer shown verbatim per spec (English + Hinglish).
- A manager *cannot* sign off a `RISKY_DOORWAY` / `FAKE_LOCAL_CLAIM` / `DUPLICATE_LOW_VALUE` blueprint (RPC raises `RISK_BLOCKS_APPROVAL`).
- Owners may override the deterministic flag with a required reason (governance-logged); used for human assertions like "verified false claim" that the rules can't infer.

---

## 2. Strategic decisions (the 3 forks, all locked with the user)

| Fork | Decision | Why |
|---|---|---|
| **Spec direction** (publisher vs planner) | **Planner v0 + planner-gated Phase 2 publisher (not built)** | The two specs the user shared pointed in opposite directions; the publisher path is a doorway-page footgun that can penalise hotel domains, and the app has no SSR. Planner first sequences risk correctly. |
| **Governance model** | **Two-axis** (status × review_status) with DB CHECK `READY_TO_BUILD ⇒ APPROVED` | Matches the PO spec's reviewStatus/reviewNotes fields and the proven Package Builder precedent; 4-eyes on every transition to ready. |
| **Proof gate** | **Advisory in v0** (unsatisfied proof drives the `NEEDS_PROOF` flag but doesn't hard-block `READY_TO_BUILD`) | Lower friction during ideation. The hard gate becomes mandatory at Phase 2 publish-time when there's something publishable to guard. |

---

## 3. DB schema (1 migration, 2 tables, 12 functions, 4 enums)

**File:** `supabase/migrations/20260529000001_local_seo_landing_planner.sql`

### Enums (4)
- `seo_blueprint_category` (GEOGRAPHIC_FOCUS, TRAVELER_NICHE, SEASONAL_POSITION, TARGET_MARKET, AMENITY_TRUST, PACKAGE_LED)
- `seo_blueprint_risk` (SAFE_BLUEPRINT, NEEDS_PROOF, RISKY_DOORWAY, FAKE_LOCAL_CLAIM, DUPLICATE_LOW_VALUE, ON_HOLD)
- `seo_blueprint_status` (DRAFT, IN_REVIEW, READY_TO_BUILD, ON_HOLD, ARCHIVED)
- `seo_blueprint_event_type` (10 lifecycle events: CREATED, EDITED, RECLASSIFIED, SUBMITTED_FOR_REVIEW, APPROVED, CHANGES_REQUESTED, HELD, RESUMED, ARCHIVED, SOFT_DELETED)

### Tables (2)
- `seo_landing_blueprints` — per-hotel rows (page_title_concept, target_category, risk_classification, status, review_status, required_proof jsonb, why_it_matters / hinglish_guidance / safe_next_action / connected_module_suggestion / owner_notes / internal_notes / review_notes / review_actor_id / reviewed_at / timestamps). CHECK `seo_blueprints_ready_requires_approval`.
- `seo_landing_blueprint_events` — append-only audit (mirrors `package_events` / `lead_events` precedent), `clock_timestamp()` ordering.

### Functions (12, all SECURITY DEFINER with explicit `search_path = 'public'`)
- **Pure helpers (IMMUTABLE):** `_seo_normalize_title`, `_classify_seo_blueprint` (the deterministic Policy Shield)
- **Internal:** `_record_seo_blueprint_event`
- **Lifecycle (member):** `create_seo_blueprint`, `update_seo_blueprint`, `submit_seo_blueprint_for_review`, `hold_seo_blueprint`, `resume_seo_blueprint`
- **Governance (manager+):** `approve_seo_blueprint`, `request_seo_blueprint_changes`, `archive_seo_blueprint`, `soft_delete_seo_blueprint`
- **Read-model:** `get_seo_blueprint_summary` (counts by risk + status — designed to be reused later by Visibility Score / Pos 9)

### Constraint guarantees

| Invariant | Enforcer |
|---|---|
| READY_TO_BUILD requires APPROVED | DB CHECK `seo_blueprints_ready_requires_approval` (defense-in-depth alongside the approve RPC, which sets both atomically) |
| Editing only in DRAFT / IN_REVIEW / ON_HOLD | `update_seo_blueprint` RPC raises `NOT_EDITABLE` for READY_TO_BUILD / ARCHIVED |
| Approve cannot sign off unsafe risks | `approve_seo_blueprint` raises `RISK_BLOCKS_APPROVAL` when risk ∈ {RISKY_DOORWAY, FAKE_LOCAL_CLAIM, DUPLICATE_LOW_VALUE} |
| Override the deterministic flag needs a reason | `update_seo_blueprint` raises `OVERRIDE_REASON_REQUIRED`; RECLASSIFIED event records the from/to + reason |
| Hold from READY_TO_BUILD drops approval | `hold_seo_blueprint` resets `review_status` to PENDING_REVIEW when leaving READY_TO_BUILD (CHECK guarded) |
| Manager+ only for approve / request_changes / archive / soft_delete | RPC body calls `vaiyu_is_hotel_finance_manager(hotel_id)` |
| TS classifier ↔ SQL classifier byte-for-byte equivalence | 20 vitest assertions; integration check via direct SQL truth-table |

---

## 4. The Deterministic Policy Shield

Pure function. No AI. Same inputs → same output.

```
classify(title, category, proof, isDuplicate):
  if isDuplicate: return DUPLICATE_LOW_VALUE
  if title matches /(best|cheapest|cheap|top|number one|no. 1|lowest|guaranteed|world class|5 star|five star)/ word-boundary
     OR title matches /#\s*1\b/                              -> RISKY_DOORWAY
  if category ∈ {GEOGRAPHIC_FOCUS, AMENITY_TRUST, TARGET_MARKET}
     AND (proof empty OR not all satisfied)                  -> NEEDS_PROOF
  if proof.length > 0 AND not all satisfied                  -> NEEDS_PROOF
  return SAFE_BLUEPRINT
```

The frontend mirrors this exactly (in `web/src/config/localSeoPlanner.ts`) for instant in-form feedback; the **server value is authoritative** on every write. The 20 vitest tests assert both implementations agree on duplicate / superlative / case-insensitivity / word-boundary / per-category proof / partial-proof / empty-proof edge cases.

`FAKE_LOCAL_CLAIM` and `ON_HOLD` are deliberately **never** auto-computed — the system can't verify ground truth. A human reviewer assigns them via the override path (with a required reason, governance-logged).

---

## 5. Frontend (16 new files, 3 modified)

### Config / types / service
- `web/src/config/localSeoPlanner.ts` — flag, labels, deterministic classifier mirror, proof catalogs per category, disclaimer (en + hi), starter ideas, connected-module options
- `web/src/types/seoBlueprint.ts` — Blueprint, Event, Summary, Risk, Status, Category, Proof types
- `web/src/services/seoBlueprintQueryKeys.ts` — centralised query keys
- `web/src/services/seoBlueprintService.ts` — typed RPC wrappers + `SeoBlueprintServiceError` with 10 known codes
- `web/src/hooks/useSeoBlueprintsRealtime.ts` — 250 ms-debounced postgres_changes invalidator

### Components (8)
- `web/src/components/seo/SeoPills.tsx` — tone-mapped RiskPill / StatusPill / ReviewPill
- `web/src/components/seo/PolicyShieldBanner.tsx` — live deterministic-shield explainer
- `web/src/components/seo/ProofChecklist.tsx` — bilingual toggleable proof items
- `web/src/components/seo/PlannerDisclaimerBanner.tsx` — required disclaimer (en + hi)
- `web/src/components/seo/PlannerEmptyState.tsx` — first-blueprint state + 6 safe starters
- `web/src/components/seo/BlueprintCard.tsx` — list card with risk/status/review pills
- `web/src/components/seo/BlueprintForm.tsx` — composed editor with live Policy Shield, proof checklist, optional override panel (with required reason)
- `web/src/components/seo/BlueprintForm.validation.ts` — pure validation + `classifyDraft` helper

### Tests
- `web/src/components/seo/BlueprintForm.validation.test.ts` — **20 vitest assertions** covering classifier (duplicate, superlative variants, case-insensitivity, word-boundary safety, per-category proof, partial-proof, empty-proof), proof helpers, validate(), humanizeError, and TS↔SQL parity expectations

### Routes + dashboard
- `web/src/routes/owner/LocalSeoPlanner.tsx` — workspace + inline EditView with full lifecycle action bar
- `web/src/components/owner/LocalSeoPlannerCard.tsx` — dashboard widget (Safe / Needs-proof / Risky counts + In-review / Ready-to-build)

### Wiring (3 modified files)
- `web/src/main.tsx` — 1 lazy import + 1 route entry (`owner/:slug/seo-planner`)
- `web/src/routes/OwnerDashboard.tsx` — card mount after `PackageBuilderCard` + nav tile after Assets
- (no OwnerSidebar — nav is inline in OwnerDashboard)

---

## 6. Bugs found and fixed during smoke test

| # | Bug | Fix |
|---|---|---|
| 1 | Governance mutations (Submit / Approve / Request-changes / Hold / Resume) invalidated only the list query, not the detail. EditView stayed stale after each transition even though the DB had updated. | Introduced `invalidateAfterGovernance(id)` helper in `LocalSeoPlanner.tsx` that invalidates both `['seo-blueprints', hotelId]` (list) and `seoBlueprintQueryKeys.detail(id)`. Wired into all 5 governance mutations. |
| 2 | A unique index on `(hotel_id, _seo_normalize_title(title))` would have hard-blocked duplicate creation with a raw `unique_violation` — contradicting the spec where DUPLICATE_LOW_VALUE is meant as a **soft governance signal** so owners can see the dup and decide to differentiate or merge. | Demoted to a non-unique `idx_seo_blueprints_hotel_title` (keeps lookup speed; classifier still flags duplicates on create/update). |

Both fixes verified by re-running the smoke test and the full vitest suite (581/581 pass).

---

## 7. Forward extensibility (Phase 2 publisher, Visibility Score, future modules)

- **Phase 2 publisher** (NOT built; documented here so the design choice is locked):
  - **Gate:** publish only `status='READY_TO_BUILD'` AND `review_status='APPROVED'` AND `risk_classification='SAFE_BLUEPRINT'` AND every `required_proof[].satisfied = true` (proof becomes a *hard* gate at publish time).
  - **Infra:** requires SSR/prerender for `/<city>/<hotel-slug>` routes — VAiyu is a client-rendered SPA today, so this is real infra work to scope when the time comes.
  - **Schema:** no migration changes needed — the planner row already carries everything the publisher would consume.
- **Visibility Score (Position 9):** `get_seo_blueprint_summary` is the read-model the future Score can consume (`safe / needs_proof / risky / in_review / ready_to_build` counts) without any rework.
- **Seasonal Calendar (Position 8):** `connected_module_suggestion` is a soft text label today; once the calendar ships, swap the `SEASONAL_CALENDAR` option's UI to a real link.
- **AI assistance (someday):** if/when AI-assisted suggestions are approved, they would only *propose* blueprint drafts that an owner accepts — the deterministic Policy Shield + governance flow stays the authoritative path.

---

## 8. SEO / platform compliance risk — **LOW**

Nothing is published. No public routes, no sitemap, no robots, no metadata. The disclaimer is shown verbatim on the workspace and the dashboard card. The tool's entire purpose is to *prevent* doorway / spam patterns reaching production. Manager+ cannot sign off the three highest-risk classifications.

## 9. AI governance risk — **NONE**

No AI calls. No LLM prompts. No keyword scraping. All guidance deterministic and rule-based, mirrored byte-for-byte between TS and SQL.

## 10. Overpromise / ranking risk — **LOW**

Copy uses "internal planning / readiness / proof needed / safe blueprint / risk flag / governance review". Disclaimer explicitly disclaims rankings / traffic / bookings / revenue / Google visibility. No "rank #1 / SEO hack / traffic guaranteed" anywhere in the codebase.

## 11. Security / RLS

- Every table `vaiyu_is_hotel_member`-scoped for SELECT; INSERT/UPDATE only via SECURITY DEFINER RPCs (audit + writes stay paired).
- Governance transitions gated by `vaiyu_is_hotel_finance_manager`.
- All RPCs explicitly `SET search_path = 'public'`.
- No anon grants — internal planning only.
- Cross-hotel RLS validated indirectly via `vaiyu_is_hotel_member` rechecks in every RPC body.

## 12. Verification (final)

| Check | Status |
|---|---|
| Migration applies cleanly | ✅ |
| 12 RPCs + 2 tables + 4 enums verified | ✅ |
| Frontend typecheck | ✅ |
| Vitest suite | ✅ **581/581** (includes 20 new classifier/validation tests) |
| Production build | ✅ Clean (6 s) |
| SQL ↔ TS classifier parity | ✅ Direct DB truth-table matches all vitest cases |
| Browser smoke: create → submit → approve → READY_TO_BUILD | ✅ |
| Audit trail clean (CREATED → SUBMITTED_FOR_REVIEW → APPROVED) | ✅ |
| Duplicate detection (normalised-title match) | ✅ |
| Superlative detection (including `#1`) | ✅ |
| Approve guard blocks unsafe risks | ✅ |
| No public routes / sitemap / robots / AI / anon grants | ✅ |
| Bugs found during smoke test | 2 found, **2 fixed inline** |

## 13. File manifest

**New (17):**
```
supabase/migrations/20260529000001_local_seo_landing_planner.sql

web/src/config/localSeoPlanner.ts
web/src/types/seoBlueprint.ts
web/src/services/seoBlueprintQueryKeys.ts
web/src/services/seoBlueprintService.ts
web/src/hooks/useSeoBlueprintsRealtime.ts

web/src/components/seo/SeoPills.tsx
web/src/components/seo/PolicyShieldBanner.tsx
web/src/components/seo/ProofChecklist.tsx
web/src/components/seo/PlannerDisclaimerBanner.tsx
web/src/components/seo/PlannerEmptyState.tsx
web/src/components/seo/BlueprintCard.tsx
web/src/components/seo/BlueprintForm.tsx
web/src/components/seo/BlueprintForm.validation.ts
web/src/components/seo/BlueprintForm.validation.test.ts

web/src/components/owner/LocalSeoPlannerCard.tsx
web/src/routes/owner/LocalSeoPlanner.tsx
```

**Modified (2):**
```
web/src/main.tsx                    — 1 lazy import + 1 route entry
web/src/routes/OwnerDashboard.tsx   — card mount + nav tile
```

---

## 14. Production rollout

| # | Step | Owner | Status |
|---|---|---|---|
| 1 | Migration `20260529000001_local_seo_landing_planner.sql` to prod (`npx supabase db push --linked`) | Pallavi (deploy) | Pending |
| 2 | Frontend redeploy with flag ON (`LOCAL_SEO_LANDING_PLANNER_V0_ENABLED=true`) | Pallavi (deploy) | Pending |
| 3 | Post-deploy smoke: open `/owner/<slug>/seo-planner`, create a blueprint from a starter, submit, approve. Confirm DB row reaches `READY_TO_BUILD + APPROVED`. | Ajit (verify) | Pending |

Migration is **purely additive** (new enums + tables + functions + index). No destructive DDL, no signature changes to existing RPCs, no Edge Function deploy needed. Rollback = `LOCAL_SEO_LANDING_PLANNER_V0_ENABLED=false` + redeploy; the DB stays inert without the UI.

Per CLAUDE.md: no auto-push to prod Supabase without explicit per-feature approval.

## 15. Deployment recommendation

**Build passed. No blocking errors found. Deployment appears safe, pending your approval.**
