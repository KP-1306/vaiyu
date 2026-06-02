# Lead Generation CRM — Feature Report

**Position:** Growth Hub 1 — Lead Generation CRM (foundation for all subsequent growth modules)
**Codename:** Lead CRM
**Build dates:** 2026-05-25 → 2026-05-26 (11-day build, shipped to prod on day 11)
**Owner:** Ajit Kumar Singh
**Engineering lead:** Pallavi Mishra
**Status:** **Live in production.** All 11 migrations applied, both Edge Functions deployed (project `vsqiuwbmawygkxxjrxnt`).

> Lead CRM is the foundational system the rest of the Growth Hub depends on. Follow-up Radar's auto-create triggers read `leads` and `lead_events`. AI Quote Drafts reads `leads.contact_name` / dates / party size for the draft. The Lead Drip Engine subscribes to lead status changes. Designed first; deployed first; everything else stands on it.

---

## 1. Executive summary

A hospitality-specific lead pipeline that captures enquiries from any surface (front-desk entry, public website form, manual import), routes them through a 6-state lifecycle, lets staff collaborate without stepping on each other via an optimistic claim lock, and converts a won lead into a real walk-in booking atomically. The product is a **hospitality conversion orchestration layer, not a generic CRM** — every design choice is shaped around what a 20-room Indian property actually does at the front desk.

Key shipped surfaces:
- Full owner-side workspace at `/owner/:slug/leads` with list, Kanban, filters, search, pagination, lead detail drawer, optimistic claim
- Public-facing capture form at `/p/:hotelSlug/enquire` for hotel website embedding
- CSV export with keyset pagination
- Dashboard summary widget (`LeadsSummaryCard`)
- Realtime updates across tabs/staff
- Convert-to-walk-in flow that atomically creates booking + folio + sets back-link

---

## 2. Hospitality lifecycle

Every lead moves through the following states (enforced by `transition_lead_status` RPC):

```
                           ┌──────── LOST  (terminal, reopen → NEW only)
                           ↓
NEW ──→ QUALIFIED ──→ QUOTED ──→ WON ──→ CONVERTED  (booking exists)
                                    ↓
                                  LOST (reachable from WON)
```

**Distinction that matters at the front desk:**
- `WON` = guest committed (verbal / email / contract). Booking may not exist yet.
- `CONVERTED` = booking row created and linked. Lead is closed in the books.

This separation lets the property mark a lead "we've got this one" without yet entering the walk-in / reservation flow — common at small Indian properties where commitments precede paperwork.

Reopen path: `LOST → NEW` is the only resurrection. We don't allow LOST → QUALIFIED directly because the operator should re-evaluate the lead from scratch after a loss.

---

## 3. Architecture

### 3.1 Data model

| Table | Purpose | Key invariant |
|---|---|---|
| `leads` | One row per enquiry, denormalised `status` + audit columns | `status='LOST' ⇒ status_reason IS NOT NULL`; `status='CONVERTED' ⇒ converted_booking_id IS NOT NULL` |
| `lead_events` | Append-only audit timeline (CREATED, STATUS_CHANGED, ASSIGNED, CLAIMED, CONTACT_UPDATED, BASICS_UPDATED, NOTE_ADDED, CONVERTED_TO_BOOKING, SOFT_DELETED, REOPENED, etc.) | No UPDATE/DELETE policy — write-only |
| `bookings.lead_id` | Back-link from booking to the lead it converted | Set atomically by `convert_lead_to_walkin` |

Three enums: `lead_status` (6 values), `lead_source` (12 values: GOOGLE, WEBSITE, INSTAGRAM, FACEBOOK, OTA, WALK_IN, REFERRAL, AGENT, CORPORATE, WEDDING, GROUP, OTHER), `lead_event_type` (14 event types).

**Multi-tenancy:** every read/write goes through `vaiyu_is_hotel_member(hotel_id)` — RLS policy on `leads` + `lead_events`; same check inside every RPC. Inactive `hotel_members.is_active = false` rows are filtered (Day 1.5 fix — original policy missed this).

**Event-sourcing with denormalisation:** `leads.status` holds the current state for fast queries; `lead_events` is the truth-of-the-past. Every state-changing RPC writes both atomically inside one transaction.

### 3.2 Optimistic claim lock

To prevent two staff working the same lead simultaneously without RBAC-level privacy:

- `leads.claimed_by` + `leads.claimed_at` columns
- 15-minute TTL via `_claim_ttl()` helper (single source of truth)
- `claim_lead(p_lead_id)` does an atomic check-and-set: predicate `WHERE claimed_by IS NULL OR claimed_by = auth.uid() OR claimed_at < clock_timestamp() - ttl`
- `clock_timestamp()` (not `now()`) for claim writes — `now()` is transaction-start, which produces tied timestamps across multiple events in one RPC. Bug caught and fixed in Day 3.
- `release_claim` uses a boolean-gated approach (pre-read, then UPDATE, then check `FOUND`) — the naive `RETURNING ... INTO v_updated; IF v_updated IS NULL` is broken because Postgres treats all-NULL records as IS NULL. Bug caught and fixed in Day 3.
- `force_release_claim(reason)` for manager+ override. Writes `release_type='forced'` into the event, so the displaced holder gets a realtime toast.

### 3.3 RPCs (14 total)

**Write paths (mutating, all SECURITY DEFINER, `search_path=public`):**
| RPC | Authority | Purpose |
|---|---|---|
| `create_lead` | hotel_member | Constructor with phone normalisation + duplicate warning (30-day window on normalised phone) |
| `create_lead_public` | anon (granted) | Public-form capture; restricted to `WEBSITE` / `OTHER` sources; generic `INVALID_REQUEST` for unknown hotel UUIDs (no probing leak) |
| `transition_lead_status` | hotel_member | Enforces the 6-state graph; LOST requires reason; CONVERTED requires booking_id + same-hotel guard |
| `assign_lead` | hotel_member | Assign / unassign (NULL); same-hotel guard on assignee |
| `soft_delete_lead` | finance_manager+ | Manager-only; clears any active claim |
| `update_lead_contact` | hotel_member | Name/phone/email with diff event; re-validates contact_min CHECK |
| `update_lead_basics` | hotel_member | Dates/party/value/tags with diff event |
| `add_lead_note` | hotel_member | Appends NOTE_ADDED event; updates `latest_note_preview` (200 char) |
| `claim_lead` | hotel_member | Optimistic claim with refresh-on-same-user (heartbeat-friendly) |
| `release_claim` | hotel_member | Voluntary release; no-op if caller isn't the holder |
| `force_release_claim` | finance_manager+ | Override with mandatory reason; emits realtime CLAIM_RELEASED w/ release_type='forced' |
| `convert_lead_to_walkin` | hotel_member | Atomic: auto-promote through pipeline → call `create_walkin_v2` → set `bookings.lead_id` → mark CONVERTED + clear claim, all in one transaction |

**Read paths (helpers / status):**
| RPC | Purpose |
|---|---|
| `get_lead_claim_status` | Returns `{claimed_by, claimed_by_name, claimed_at, claim_expires_at, is_expired, is_self}` |

**Internal (`_` prefix, not granted):**
- `_normalize_phone(text)` — India-aware: bare 10-digit gets `+91` prefix; international `+xx…` preserved; unknown formats stored as-stripped (no data loss, dup-check may miss)
- `_hotel_role_code(uuid)` — caller's role for event payloads
- `_claim_ttl()`, `_is_claim_expired(ts)` — single source of truth for 15-min TTL
- `_user_display_name(uuid)` — `full_name > name > email-alias > 'unknown'` (Day 9: snapshot into event payloads so timelines remain meaningful if a user is later deleted)
- `_build_claim_status_jsonb`, `_build_status_changed_payload`, `_build_contact_updated_payload` — consistent payload builders
- `_validate_walkin_args(jsonb)` — shape validation used by `convert_lead_to_walkin`

### 3.4 Edge Functions (2)

| Function | Auth | Purpose |
|---|---|---|
| `leads-public-capture` | **No JWT** (`verify_jwt = false` in `config.toml`) | Calls `create_lead_public`. Per-IP rate-limit 5/min keyed on `lead-public:{hotel_id}:{origin}` (origin captured for audit). Generic INVALID_REQUEST mapping to avoid hotel UUID probing. CORS open by design (hotels embed from their own domains). |
| `leads-export-csv` | JWT required | Hotel-member check via `vaiyu_is_hotel_member` RPC. Keyset cursor pagination (`{activity, id}`) — no offset degradation at 50k+ rows. PAGE_SIZE=1000, MAX_PAGES=200 (200k row hard cap). UTF-8 BOM + RFC 4180 CSV. Telemetry: row_count, duration_ms, filter_summary. |

### 3.5 Frontend surfaces

**Routes (2):**
- `/owner/:slug/leads` — full workspace (398 lines): list + Kanban toggle, URL-driven filters/search/sort/pagination, lead detail drawer, quick-add modal, convert modal, export button. `<AuthGate>`-wrapped.
- `/p/:hotelSlug/enquire` — public capture form (367 lines): slug-to-hotel resolution, client-side validation, error-code → friendly-text mapping, success screen. No auth.

**Services (4):**
- `leadService.ts` (725 lines) — 14 RPC wrappers + `validateLeadEventRow` + `KNOWN_MAX_SCHEMA_VERSION` + `LeadServiceError` class + `PAYLOAD_VALIDATORS` registry per event type
- `leadCsvExport.ts` — invokes the export Edge Function, builds Blob, triggers download with breadcrumb telemetry
- `leadQueryKeys.ts` — centralised TanStack query keys + `getHotelInvalidationKeys` / `getLeadInvalidationKeys` (Day 11 — single source for invalidation across leads/kanban/openSummary/detail/events/claim/rooms)
- `roomService.ts` — `listRoomsForHotel` merges `rooms` + `pricing_current_rates` client-side (needed by Convert modal)

**Hooks (5):**
- `useLeadsRealtime` — 250 ms-debounced TanStack invalidator on `leads` + `lead_events` postgres_changes
- `useLeadEventsRealtime` — lead-detail-scoped subscription with `onEvent` callback (used for force-release toast)
- `useLeadDetail` — bundles `getLead` + `getLeadEvents`
- `useLeadClaimLifecycle` — auto-claim on drawer open, 10-minute heartbeat, release on unmount, realtime force-release detection
- `useFocusTrap` — keyboard accessibility for the drawer (Tab cycling)

**Components (~30 in `web/src/components/leads/`):**
- Pills/icons: `LeadStatusPill`, `LeadSourceIcon` (+ `.config` files with separate test files)
- List: `LeadCard`, `EmptyLeadsState`, `LeadsErrorState`, `LeadsListSkeleton`, `FilteredEmptyState`
- Kanban: `KanbanBoard` (DndContext + 6 parallel queries + optimistic mutation + LOST modal), `KanbanColumn`, `KanbanLeadCard`, `ViewToggle`
- Filters: `LeadsFilterBar`, `StatusFilterChips`, `SourceFilterDropdown`, `AssigneeFilterDropdown`, `SortDropdown`, `FilterSheet`, `leadsFilters` helpers (URL ↔ service translation)
- Pagination: `LeadsPagination`
- Quick add: `LeadQuickAddModal` (thin shell) + extracted helpers `validation`, `optimistic`, `errorMapping` (each with its own `.test.ts`)
- Detail drawer: `LeadDetailDrawer`, `LeadDetailHeader`, `LeadDetailClaimBadge`, `LeadDetailStatusMenu`, `LeadDetailContactSection`, `LeadDetailBasicsSection`, `LeadDetailNotesSection`, `LeadDetailTimeline`, `LeadDetailActions`, `leadDetailStyles`
- Convert: `LeadConvertModal` (3 modes: form / success / already-converted) + `LeadConvertRoomPicker` + validation
- Lost: `LostReasonModal` + validation
- Export: `LeadsExportButton`
- Event formatting: `formatLeadEvent` (timeline labels)
- Kanban helpers: `kanbanHelpers` (priority sort, drag tolerance, etc.)
- Drip integration: `LeadDripPanel` (mounts inside the detail drawer for the adjacent drip module)

**Dashboard widget:**
- `web/src/components/owner/LeadsSummaryCard.tsx` — open-status breakdown with realtime; click → `/leads`

---

## 4. Key design decisions (recorded for future maintainers)

### "Hospitality conversion layer, not a generic CRM"
The original strategic framing — pinned in CLAUDE.md as an anti-feature list. No custom fields per hotel. No workflow builder UI. No pipeline templates. No marketing automation campaigns. One hospitality lifecycle, period. The simplicity is the feature; it lets every adjacent module (Follow-up Radar, Quote Drafts, Drip Engine) assume a stable shape.

### Event-sourced + denormalised
We did NOT introduce a `lead_status_history` table (caught early as the two-truth-systems anti-pattern). The `lead_events` table is the truth-of-the-past; `leads.status` is the current-state denormalisation. Same shape later adopted by `quote_draft_events` and `follow_up_events`. Every state-mutating RPC writes both atomically.

### Optimistic claim lock over RBAC privacy
Two staff at a front desk picking up the same enquiry is the actual problem. RBAC-level "this lead is only visible to assignee X" was rejected as overengineering for a 20-room property. The claim lock auto-expires (15 min TTL) so a tab-close or distracted staff member doesn't permanently block their colleagues.

### Public capture path uses anonymous Edge Function with rate-limit
A hotel website needs to embed an enquiry form without exposing service-role credentials. The `leads-public-capture` Edge Function runs unauthenticated, rate-limits per IP+origin+hotel (5/min), and calls a separate `create_lead_public` RPC restricted to `WEBSITE` / `OTHER` sources. Unknown hotel UUIDs return generic `INVALID_REQUEST` to prevent UUID-probing leaks.

### `clock_timestamp()` everywhere events are written
`now()` returns transaction-start time, so multiple events written in one RPC end up identical and the timeline UI renders them in random order. Caught during Day 2 smoke testing. Fix migrated in `20260525000004_lead_events_clock_timestamp.sql` and `20260525000006_lead_claim_fixes.sql`.

### Snapshot user display names into event payloads (Day 9)
`{ by_user_name, prev_user_name, to_user_name, from_user_name }` written at event-create time. Otherwise the timeline UI has to JOIN `auth.users` at render time, which (a) is RLS-noisy and (b) renders "unknown" if the user is later deleted/rotated. Migration `20260525000009_event_actor_names.sql` recreated all 7 mutating RPCs to snapshot.

### Schema version on every event (Day 8)
`lead_events.event_schema_version int NOT NULL DEFAULT 1`. Bump protocol documented inline: DO bump on breaking changes (rename, type change, restructure); DO NOT bump on additive changes. The frontend `validateLeadEventRow` reads it and refuses to parse versions > `KNOWN_MAX_SCHEMA_VERSION`. Forward-compat groundwork for future migrations.

### Convert-to-walkin is atomic — single transaction
`convert_lead_to_walkin` locks the lead, auto-promotes through intermediate statuses, calls `create_walkin_v2`, sets `bookings.lead_id`, marks CONVERTED + clears claim, writes events. If `create_walkin_v2` fails (room conflict, validation), the entire transaction rolls back — lead state preserved exactly as it was. Latency is captured (`conversion_latency_ms`) for telemetry.

### Centralised query keys (Day 11 refactor)
`leadQueryKeys.list/kanban/openSummary/detail/events/claim/rooms` + `getHotelInvalidationKeys()` / `getLeadInvalidationKeys()`. Single place to add a new lead view — invalidation stays consistent. Caught after the second time I forgot to invalidate a query.

### Keyset pagination for CSV export
`cursor = {last_activity_at, id}` — same order as the list view's stable sort. PAGE_SIZE=1000, MAX_PAGES=200. Offset pagination at 50k+ rows degrades to seconds-per-page; keyset stays O(log n).

---

## 5. Files inventory

### Migrations (11, all on prod)
| Version | Title | Notes |
|---|---|---|
| `20260525000001` | `lead_crm` | Tables, enums, RLS, indexes, triggers |
| `20260525000002` | `lead_schema_refinements` | notes→latest_note_preview rename; contact_phone_normalized; BASICS_UPDATED enum; RLS hardening to canonical `vaiyu_is_hotel_member` (closes the inactive-member gap) |
| `20260525000003` | `lead_crm_rpcs` | 7 RPCs + helpers |
| `20260525000004` | `lead_events_clock_timestamp` | occurred_at → clock_timestamp() default |
| `20260525000005` | `lead_claim_rpcs` | 4 claim RPCs + helpers; snapshot names |
| `20260525000006` | `lead_claim_fixes` | release_claim IS-NULL-record bug + clock_timestamp consistency |
| `20260525000007` | `lead_convert_rpc` | convert_lead_to_walkin + auto-promotion + telemetry |
| `20260525000008` | `lead_events_schema_version` | event_schema_version column + bump protocol comment |
| `20260525000009` | `event_actor_names` | Recreated 7 RPCs to snapshot by_user_name etc. into payloads |
| `20260526000001` | `create_lead_public` | Public anon-callable RPC + generic INVALID_REQUEST + possible_duplicate flag |

### Edge Functions (2, both deployed to prod)
- `supabase/functions/leads-public-capture/` — anon, rate-limited
- `supabase/functions/leads-export-csv/` — JWT, keyset paginated

### Frontend
- Types: `web/src/types/lead.ts` (26 exports)
- Services (4): `leadService.ts`, `leadCsvExport.ts`, `leadQueryKeys.ts`, `roomService.ts`
- Tests: `leadService.test.ts`, `roomService.test.ts`
- Hooks (5): `useLeadsRealtime`, `useLeadEventsRealtime`, `useLeadDetail`, `useLeadClaimLifecycle`, `useFocusTrap` (+ tests on `useLeadsRealtime`, `useLeadClaimLifecycle`, `useFocusTrap`)
- Components: ~40 files in `web/src/components/leads/` including all *.test.ts files
- Dashboard widget: `web/src/components/owner/LeadsSummaryCard.tsx`
- Routes: `web/src/routes/owner/Leads.tsx`, `web/src/routes/PublicLeadCapture.tsx`

---

## 6. Quality + production status

### Test coverage (as part of the full suite — 500/500 passing as of 2026-05-27)
- `leadService.test.ts` — RPC contract + error mapping
- `roomService.test.ts` — rate-engine join behaviour
- `leadsFilters.test.ts` — URL ↔ service-filter translation
- `kanbanHelpers.test.ts` — drag/sort behaviour
- `formatLeadEvent.test.ts` — timeline label rendering
- `LeadStatusPill.config.test.ts`, `LeadSourceIcon.config.test.ts` — enum maps
- `LeadQuickAddModal.validation.test.ts`, `.optimistic.test.ts`, `.errorMapping.test.ts` — 3 separate concerns
- `LeadConvertModal.validation.test.ts`
- `LostReasonModal.validation.test.ts`
- `useLeadsRealtime.test.ts`, `useLeadClaimLifecycle.test.ts`, `useFocusTrap.test.ts`

### Production deployment (2026-05-26)
- All 11 migrations applied to `vsqiuwbmawygkxxjrxnt` via `supabase db push --linked`
- Both Edge Functions deployed: `leads-public-capture` (64.5 kB) + `leads-export-csv` (66.26 kB)
- Both OPTIONS preflights returned 204
- Frontend deployed via the standard Netlify pipeline; `Leads-*.js` chunk emitted

### Multi-tenancy verification
Every RPC was tested by inserting a lead under hotel A and confirming a hotel-B member cannot read it (RLS bypass impossible via `SELECT`, RPC-internal `vaiyu_is_hotel_member` check fails with `NOT_AUTHORIZED`).

### Error-code contract (parseable by frontend)
Every RPC raises stable error codes (`RAISE EXCEPTION 'CODE_NAME'`). The frontend `LeadServiceError` class maps PostgrestError → typed code. Known codes: `NOT_AUTHORIZED`, `LEAD_NOT_FOUND`, `LEAD_DELETED`, `INVALID_TRANSITION`, `INVALID_NAME`, `INVALID_CONTACT`, `INVALID_DATES`, `INVALID_PARTY`, `REASON_REQUIRED`, `BOOKING_REQUIRED`, `BOOKING_NOT_FOUND`, `BOOKING_MISMATCH`, `ASSIGNEE_NOT_MEMBER`, `NOTE_EMPTY`, `ALREADY_CONVERTED`, `LEAD_IS_LOST`, `WALKIN_ARGS_REQUIRED`, etc. Every code has a friendly-text mapping in `LeadQuickAddModal.errorMapping.ts` / `LeadConvertModal`.

---

## 7. Operational notes

### Backfill from existing leads
Lead CRM landed before its adjacent modules. When **Follow-up Radar** went live (2026-05-27), its triggers only fire on NEW lead inserts — so a `sync_follow_ups_from_leads(hotel_id)` RPC was added (manager+ only) to backfill follow-ups for leads that pre-dated Phase 2. Pattern likely to repeat for any future module that reads from `leads` / `lead_events`: ship a manager-only backfill RPC alongside the trigger.

### Realtime + pagination interaction
The 250 ms debounced query invalidator coalesces bursts of changes so the page doesn't re-render 6 times in 50 ms. `placeholderData: keepPreviousData` on the list query prevents a skeleton flash when filters change.

### Public capture rate-limiting
Per-IP, per-hotel, per-origin: `lead-public:{hotel_id}:{origin}:{ip}`. 5/min is generous for real form usage and blocks bots. Origin is captured for audit/abuse investigation. If a hotel reports getting blocked from their own form, check `api_hits` for their origin string.

### Anonymous form CORS
`Access-Control-Allow-Origin: *` is intentional — hotels embed the form from their own domains, which we don't know in advance. The `create_lead_public` RPC's `source NOT IN ('WEBSITE','OTHER')` check is the real enforcement.

---

## 8. Rollback paths

Lead CRM is the foundation. Removing it would break Follow-up Radar's triggers, AI Quote Drafts' lead picker, and the Lead Drip Engine.

**Soft rollback (hide UI, keep DB):**
```ts
// Remove the route entry from main.tsx and the dashboard quick-link tile.
// The DB and Edge Functions stay; adjacent modules continue to work since
// they read from leads / lead_events directly.
```

**Hard rollback (full removal):** discouraged. Would require:
1. Drop `convert_lead_to_walkin` RPC
2. Drop the back-link: `ALTER TABLE bookings DROP COLUMN lead_id`
3. Drop Follow-up Radar's auto-create triggers on `leads` and `lead_events`
4. Drop AI Quote Drafts' `quote_drafts.lead_id` FK
5. Drop the Lead Drip Engine's subscriptions
6. Drop `leads` + `lead_events` + the enums + the 14 RPCs

Don't do this without a full plan; the dependency graph is non-trivial. If a critical bug forces a rollback, prefer a forward-fix migration.

---

## 9. Honest status (as of 2026-05-27)

| Question | Answer |
|---|---|
| Live in production? | ✅ Yes — since 2026-05-26 |
| Multi-tenant safe? | ✅ Yes — RLS + RPC-level checks; tested across hotels |
| Tested? | ✅ Yes — 13 service/hook/helper test files; full suite green |
| Adjacent modules dependent on it? | ✅ Follow-up Radar (triggers), AI Quote Drafts (lead picker), Lead Drip Engine (subscriptions). Don't break the contract. |
| Outstanding bugs? | None known. Two real bugs caught during the build (release_claim NULL-record, now() vs clock_timestamp()) — both fixed via subsequent migrations. |
| Phase 2 candidates | Per-staff "my leads" view, bulk operations, lead merge/dedupe UI, custom-source taxonomy per hotel (would break the anti-feature stance — defer until a paying hotel explicitly asks). |
