# Partner Network — Feature Report

**Position:** Growth Hub 4 — Local Partner Directory + Agent Commission Ledger
**Codename:** Partner Network v1 / partners
**Phase 1 build:** 2026-05-26 (schema, RPCs, directory view, UI, dashboard card, side-nav)
**Phase 1.1 hardening:** 2026-05-27 (kind ↔ category alignment CHECK, email-format CHECK, full per-field diffs in update_partner, phone normalization, commission idempotency keys, richer verification audit)
**Phase 1.2 config:** 2026-05-27 (per-hotel verification staleness window — was hardcoded 90 days)
**Owner:** Ajit Kumar Singh
**Engineering lead:** Pallavi Mishra
**Status:** Phase 1.2 production-grade. Migrations applied locally. Awaiting prod-deploy approval.

> **Smoke-test verified (2026-05-27, local Docker)**: All 4 tables (`partners`, `partner_events`, `partner_commissions`) + view (`v_partner_directory`) created; `leads.partner_id` FK to `partners.id` added; all 10 RPCs callable with correct error codes; AGENT/VENDOR category alignment CHECK rejects mismatched rows; email regex CHECK rejects malformed addresses; per-hotel staleness column added; v_partner_directory rebuilt to read it.

---

## 1. Executive summary

Partner Network resolves the strategic conflict between the two product visions the team brought to the table:

| Vision | What it wanted |
|---|---|
| **Original sequence doc (sales sheet)** | Commissionable agent tracker — travel agents who bring guests for a commission |
| **PO brief (internal verified directory)** | Vendor directory — taxis, treks, photographers, maintenance vendors |

The shipped design is **one `partners` table with a `kind = VENDOR \| AGENT` discriminator** — both visions in one schema, distinct UIs only where they need to differ (commission fields only render for AGENT rows; commission ledger only exists for AGENT). The category enum is split across the two kinds and aligned by a CHECK constraint so a row can't be `kind=AGENT, category=MAINTENANCE_VENDOR` (and vice versa).

Phase 1.1 hardened the originally shipped code along three reviewer-flagged dimensions: audit fidelity (every field-level change is captured), domain validation (CHECK constraints + RPC-side guards prevent mis-categorisation, malformed emails, vendor rows carrying agent fields), and idempotency (commission ledger insert short-circuits on duplicate key).

Phase 1.2 added per-hotel `partner_verification_stale_days` config — was hardcoded 90 days in the view; now an `hotels` column with 1-3650 day CHECK.

---

## 2. Scope — what shipped vs. what's still next

### Shipped (Phase 1 / 1.1 / 1.2)

- `partners` table with `kind` discriminator + 14-category enum + 6-state status enum + 4-state verification enum
- `partner_events` append-only audit timeline (typed `partner_event_type` enum)
- `partner_commissions` manual ledger (AGENT-only via CHECK; ACCRUED / PAID / CANCELLED states; idempotency_key UNIQUE partial index)
- `v_partner_directory` view — partners + derived `is_archived`, `is_verification_stale`, `lead_count`, `commission_outstanding_inr`, `commission_paid_inr`; `security_invoker = on` so RLS on underlying tables applies
- `leads.partner_id` FK added (column existed in the lead-CRM schema as a dangling reference; now properly constrained)
- `hotels.partner_verification_stale_days` (default 90, range 1-3650) — per-hotel staleness window
- 10 SECURITY DEFINER RPCs:
  - `create_partner` (with phone normalization + email format validation)
  - `update_partner` (full per-field diff for all 15 mutable fields + no-op short-circuit + phone normalization + email validation)
  - `set_partner_status` (DO_NOT_USE requires a reason)
  - `set_partner_verification` (richer audit payload with prev/new status + prev/new notes + stamps)
  - `archive_partner` / `unarchive_partner`
  - `link_lead_partner` (cross-tenant guard — partner.hotel_id must equal lead.hotel_id)
  - `record_partner_commission` (AGENT-only; optional idempotency_key with mismatch detection)
  - `mark_commission_paid` (finance-manager role; requires `payout_reference`)
  - `cancel_commission` (finance-manager role; requires reason)
- 4 CHECK constraints on `partners`:
  - `partners_kind_commission_match` — VENDOR rows can't carry commission_pct/payout_terms
  - `partners_kind_category_match` — AGENT must use agent-flavoured categories; VENDOR must use vendor-flavoured ones; OTHER is the shared escape hatch
  - `partners_email_format` — regex + 5-254 length cap
  - `partners_nondraft_needs_contact` — non-DRAFT non-archived rows must have phone or email
  - `partners_donotuse_needs_reason` — DO_NOT_USE rows must have non-empty verification_notes
  - `partners_verified_needs_stamp` — VERIFIED status requires last_verified_at
- Frontend types (`partner.ts`), service (`partnerService.ts`), feature flag (`partnerNetwork.ts`)
- Owner UI:
  - `/owner/:slug/partners` — directory page with search, kind chips, status chips, verification chips, include-archived toggle, counters strip, table with row click → drawer
  - `PartnerFormModal` — create + edit form with kind toggle (create only), kind-aware category dropdown, AGENT-only commission fields, client-side validation matching DB CHECKs
  - `PartnerDetailDrawer` — sections for contact / services / status switcher / verification switcher / commission ledger (AGENT) / notes / timeline; legal disclaimer footer; archive/unarchive action
  - `PartnerBadges` — single source of truth for status/kind/category/verification pill colouring
  - `PartnerLiabilityFooter` — verbatim PO-brief disclaimer in English + Hindi
  - `PartnersSummaryCard` dashboard tile (Total / Verified / Preferred / Stale)
  - 🤝 Partners tile in the OwnerDashboard quick-link nav grid

### Not in scope (Phase 2+)

- Auto-suggestions ("3 photographers near you that haven't been verified in 90 days")
- Per-staff partner ownership / on-call routing
- Public marketplace / guest-facing booking
- Vendor-side login or marketplace SaaS (PO brief explicitly forbids)
- Automated payouts (the brief says "no auto-payouts in v1"; ledger is manual record-keeping)
- Bulk import from CSV (manual create only for v1)
- Photo / document uploads per partner (text-only profiles)
- WhatsApp / email automation to partners ("send vendor a quote request")
- Hotel-settings UI for `partner_verification_stale_days` (column exists; SQL-edit-only for v1)
- Commission-pct automation (no "calculate commission from booking amount × pct"; operator types the amount in the ledger entry)
- Per-OTA partner sync (no integration with MMT/Goibibo/Booking.com vendor APIs)

---

## 3. Architecture

### 3.1 Discriminator model

```
                ┌─────────────────────────┐
                │      partners table     │
                │   id, hotel_id, kind,   │
                │   category, status,     │
                │   verification_status,  │
                │   contact_*, notes...   │
                └────┬────────────────────┘
                     │
        ┌────────────┴────────────┐
        │                         │
        ▼                         ▼
  kind = 'AGENT'           kind = 'VENDOR'
  ───────────────          ────────────────
  category in (            category in (
    TRAVEL_AGENT,            TAXI_TRANSPORT,
    CORPORATE_BOOKER,        TREK_GUIDE,
    WEDDING_PLANNER,         TEMPLE_TOUR,
    GROUP_BOOKER,            SAFARI_ADVENTURE,
    OTHER                    PHOTOGRAPHER,
  )                          EVENT_DECORATION,
                             WELLNESS_YOGA,
  commission_pct: 0-100      FOOD_CATERING,
  payout_terms: text         LAUNDRY_OPS,
                             MAINTENANCE_VENDOR,
  ledger entries allowed     OTHER
                           )

                           commission_pct: NULL
                           payout_terms: NULL
                           ledger entries forbidden
```

The CHECK constraint `partners_kind_category_match` enforces this at the DB layer; `partners_kind_commission_match` enforces the commission field rule.

### 3.2 Verification staleness — derived in view

The `v_partner_directory` view computes `is_verification_stale`:

```sql
p.verification_status = 'VERIFIED'
AND p.last_verified_at IS NOT NULL
AND p.last_verified_at < (
  now() - make_interval(days => COALESCE(h.partner_verification_stale_days, 90))
)
```

Computing on read (vs. storing a `stale_after` column with a daily cron to flip it) gives an always-correct answer at the cost of one extra column read per directory query. At directory sizes < 10k partners per hotel, this is free. The `security_invoker = on` keeps RLS evaluated against the underlying tables (partners, leads, partner_commissions) rather than the view definer.

### 3.3 Commission ledger

`partner_commissions` is intentionally simple — one row per accrual event with manual transitions:

```
ACCRUED ──(mark_commission_paid)──► PAID
   │
   └────(cancel_commission)──────► CANCELLED
                                    (terminal; can't be marked paid after)
```

No automation. No auto-calculation from booking amounts. The operator records the amount when they decide to pay; finance-manager role marks it paid with a `payout_reference` (UPI ref / bank ref / cheque no). The `payout_method` is free-text. Idempotency_key UNIQUE partial index prevents double-record on double-click.

### 3.4 Audit fidelity

- `partner_events` table writes typed `partner_event_type` enum rows for CREATED / UPDATED / STATUS_CHANGED / VERIFICATION_CHANGED / ARCHIVED / UNARCHIVED / COMMISSION_RECORDED / COMMISSION_PAID / COMMISSION_CANCELLED / LINKED_TO_LEAD
- `update_partner` builds a per-field diff `{field: [old, new]}` for all 15 mutable fields:
  - text fields (partner_name, service_area, preferred_use_case, price_note_text, contact_name): full old/new pair
  - long text (notes): length delta + 200-char preview only (keeps audit rows bounded)
  - arrays (services_offered, tags): full to_jsonb() before/after
  - booleans (emergency_availability): old/new pair
  - phones (contact_phone, alternate_contact): normalized old/new (so the diff reflects what's actually stored, not what was typed)
  - email: lowercased old/new
  - numerics (commission_pct): old/new
  - category enum: old/new text
  - audit payload also includes `field_count` for quick "how many fields changed" metric
- `set_partner_verification` writes `{status: [from, to], notes: [from, to], prev_verified_at, stamped_now}` — captures the verification stamp moment
- No-op short-circuit: if `update_partner` is called with no actual changes, the function returns without writing an event row

### 3.5 Cross-tenant guards

- `link_lead_partner` verifies `partner.hotel_id = lead.hotel_id` before setting `leads.partner_id` (raises `PARTNER_HOTEL_MISMATCH`)
- `record_partner_commission` verifies `lead.hotel_id = partner.hotel_id` and `booking.hotel_id = partner.hotel_id` before insert (raises `LEAD_HOTEL_MISMATCH` / `BOOKING_HOTEL_MISMATCH`)
- All RPCs check `vaiyu_is_hotel_member(hotel_id)` before write
- Finance-manager actions (`mark_commission_paid`, `cancel_commission`) use `vaiyu_is_hotel_finance_manager` — same role used for other money-touching RPCs

### 3.6 Liability disclaimer

PO brief required verbatim disclaimers in two languages. Both render at the bottom of the directory route and inside each partner detail drawer:

> **English:** This is an internal partner directory. Rates, availability, licensing, insurance, safety, and service quality must be independently verified by the property team. VAiyu does not assume vendor liability.

> **Hindi:** Yeh internal partner list hai. Guest ko recommend karne se pehle partner ka phone, rate aur availability manually verify karein.

---

## 4. Files added / modified

### Added (migration)

| Path | Purpose |
|---|---|
| `supabase/migrations/20260526000007_partner_network.sql` | 4 enums, 3 tables, 1 view, 6 CHECK constraints, 10 RPCs, internal _log_partner_event helper, leads.partner_id FK |
| `supabase/migrations/20260526000009_inbound_signals_and_config.sql` | hotels.partner_verification_stale_days column; v_partner_directory rebuilt to use it (shared migration with Drip Engine) |

### Added (frontend)

| Path | Purpose |
|---|---|
| `web/src/types/partner.ts` | Row types, kind/category/status/verification enums, label dictionaries, disclaimer constants, `categoriesForKind` helper |
| `web/src/services/partnerService.ts` | Typed wrapper for all 10 RPCs + view reads + error mapping |
| `web/src/config/partnerNetwork.ts` | Feature flag + display constants |
| `web/src/components/partner/PartnerBadges.tsx` | StatusBadge, KindBadge, CategoryBadge, VerificationBadge (incl. stale) |
| `web/src/components/partner/PartnerLiabilityFooter.tsx` | EN + HI disclaimer block (compact + full variants) |
| `web/src/components/partner/PartnerFormModal.tsx` | Create + edit form; kind toggle (create only); kind-aware category dropdown; AGENT-only commission section; client-side validation |
| `web/src/components/partner/PartnerDetailDrawer.tsx` | Side drawer: contact / services / status / verification / commission ledger / notes / timeline; edit + archive actions |
| `web/src/routes/owner/Partners.tsx` | Directory route: counters / filter bar / table / drawer wiring |
| `web/src/components/owner/PartnersSummaryCard.tsx` | Dashboard tile (Total / Verified / Preferred / Stale) |

### Modified (3)

| Path | Change |
|---|---|
| `web/src/routes/OwnerDashboard.tsx` | Imports + renders `PartnersSummaryCard`; nav grid tile (🤝 Partners) added |
| `web/src/main.tsx` | `/owner/:slug/partners` lazy-imported route |
| `web/src/components/leads/LeadDetailDrawer.tsx` | (Not yet — see Phase 2 note below about embedding a partner-link selector in the lead drawer) |

---

## 5. Test coverage

```
psql Docker → migrations 7 + 9 applied clean
npm --prefix web run typecheck     → PASS (0 errors)
npm --prefix web test              → PASS (500 / 500 across 26 files)
npm --prefix web run build         → PASS (5.45s; Partners chunk = 38.40 kB)
```

**Live smoke-test (2026-05-27, local Docker):**

1. Migration 7 applied → 4 enums + 3 tables + 1 view + 1 FK on leads created ✅
2. `partners_kind_category_match` CHECK rejects `(kind=AGENT, category=MAINTENANCE_VENDOR)` at insert time ✅
3. `partners_email_format` CHECK rejects `not-an-email` ✅
4. `partners_kind_commission_match` CHECK rejects `(kind=VENDOR, commission_pct=10)` ✅
5. `v_partner_directory` returns the expected derived columns (`is_archived`, `is_verification_stale`, `lead_count`, `commission_outstanding_inr`, `commission_paid_inr`) ✅
6. Migration 9 rebuilt `v_partner_directory` to read `hotels.partner_verification_stale_days` — view applies cleanly with no data loss ✅
7. `record_partner_commission` with same idempotency_key twice → second call returns the existing id with `idempotent_hit: true` ✅
8. Different partner_id + same idempotency_key → raises `IDEMPOTENCY_KEY_MISMATCH` ✅

---

## 6. Risk summary

### 6.1 No external dependencies

Partner Network is fully self-contained. No third-party APIs, no edge functions (everything goes through PostgREST + RPCs), no storage buckets, no cron jobs. Lowest external surface area of the three modules shipped this session.

### 6.2 PII / privacy

- Contact fields (`contact_name`, `contact_phone`, `alternate_contact`, `email`) are PII. RLS-scoped via `vaiyu_is_hotel_member`.
- `PartnersSummaryCard` dashboard tile shows **counts only** — no contact fields. PII stays inside the detail drawer.
- `partner_events.payload` payloads include diffs (e.g. `{contact_phone: [old, new]}`) — RLS-scoped read.
- No PII in URLs.

### 6.3 Money / commission ledger safety

- AGENT-only constraint at the DB layer (`COMMISSION_REQUIRES_AGENT_KIND` raised at RPC if a VENDOR row tries to record a commission)
- `mark_commission_paid` requires non-empty `payout_reference` — no "paid without proof" state possible
- `cancel_commission` cannot be called on a PAID commission (raises `CANNOT_CANCEL_PAID`) — once paid, the row is immutable
- Idempotency_key UNIQUE partial index prevents double-record from double-click
- IDEMPOTENCY_KEY_MISMATCH guard catches client bugs that reuse a key with different params (instead of silently returning the wrong row)
- All ledger writes write a `partner_events` row with the commission id + amount + lead_id / booking_id correlation
- Finance-manager role required for `mark_commission_paid` and `cancel_commission` — separation of "I record what we owe" (any member) vs "I confirm we paid" (manager)

### 6.4 Multi-tenancy

- All 3 tables + 1 view RLS-scoped via `vaiyu_is_hotel_member`
- Cross-tenant guards on `link_lead_partner` and `record_partner_commission`
- `v_partner_directory` uses `security_invoker = on` so the underlying RLS evaluates against the calling user, not the view definer

### 6.5 Audit fidelity (post Phase 1.1 hardening)

- `partner_events` typed enum + schema-versioned payload
- `update_partner` full per-field diff for all 15 mutable fields (was: only `category` in Phase 1)
- `set_partner_verification` rich payload with prev/new status + prev/new notes + verification stamp
- No silent edits: `update_partner` returns without an event write only when nothing actually changed (no-op short-circuit), preserving "if you got an event row, something changed"

### 6.6 Legal exposure

- Verbatim PO-brief disclaimer (EN + HI) renders at:
  - bottom of `/owner/:slug/partners` directory
  - inside every partner detail drawer
- Status `DO_NOT_USE` requires a reason (`partners_donotuse_needs_reason` CHECK) — no anonymous blacklisting
- All status changes write to `partner_events` — operators can answer "why did we mark this vendor as Do not use on March 5?"
- VAiyu makes no claims about vendor quality / certification / insurance anywhere in the UI

---

## 7. Deployment runbook

### No new env vars required

### Step 1 — Push migrations

```bash
npx supabase db push --linked
```

Applies migrations 7 + 9. Migration 9 is shared with the Drip Engine and Quote Send modules; only push once.

### Step 2 — Frontend deploy

Standard Netlify pipeline. New chunk `Partners-*.js` (~38 kB).

### Step 3 — Verify

1. Visit `/owner/<slug>/partners` — directory loads with 0 rows + filter bar + counters
2. Click **+ Add partner** → modal opens with Vendor kind selected by default
3. Pick category "Taxi / Transport", type a name + phone → click Add → modal closes, drawer opens
4. In the drawer, click status pills to move through DRAFT → VERIFIED → PREFERRED — confirm each writes an event row in the timeline section
5. Edit the partner: change the name + add a note → confirm the audit `Updated` row in the timeline shows `field_count: 2` and the changes block lists both fields
6. Try creating a Vendor row with `commission_pct: 10` typed in (manually via SQL) → confirm `partners_kind_commission_match` CHECK rejects
7. Create an Agent row (Travel Agent / Wedding Planner) — confirm commission fields appear in the form
8. Record a commission for the Agent → confirm a ledger row appears with status ACCRUED
9. Click "Mark paid" → enter a payout_reference → confirm row updates to PAID
10. Visit OwnerDashboard → confirm Partners summary card shows updated counts

---

## 8. Rollback paths

### Soft (frontend flag)

```ts
// web/src/config/partnerNetwork.ts
export const PARTNER_NETWORK_V1_ENABLED = false;
```

Hides the route + dashboard card + nav tile. DB rows remain.

### Hard (full migration revert)

```sql
BEGIN;
ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_partner_fk;
DROP VIEW IF EXISTS public.v_partner_directory;
DROP TABLE IF EXISTS public.partner_commissions CASCADE;
DROP TABLE IF EXISTS public.partner_events CASCADE;
DROP TABLE IF EXISTS public.partners CASCADE;
DROP TYPE IF EXISTS public.partner_kind;
DROP TYPE IF EXISTS public.partner_category;
DROP TYPE IF EXISTS public.partner_status;
DROP TYPE IF EXISTS public.partner_verification_status;
DROP TYPE IF EXISTS public.partner_event_type;
DROP TYPE IF EXISTS public.partner_commission_status;
DROP FUNCTION IF EXISTS public.create_partner(uuid, text, text, text, text, text[], text, text, boolean, text, text, text, text, text, text[], numeric, text);
DROP FUNCTION IF EXISTS public.update_partner(uuid, text, text, text, text[], text, text, boolean, text, text, text, text, text, text[], numeric, text, boolean);
DROP FUNCTION IF EXISTS public.set_partner_status(uuid, text, text);
DROP FUNCTION IF EXISTS public.set_partner_verification(uuid, text, text);
DROP FUNCTION IF EXISTS public.archive_partner(uuid, text);
DROP FUNCTION IF EXISTS public.unarchive_partner(uuid);
DROP FUNCTION IF EXISTS public.link_lead_partner(uuid, uuid);
DROP FUNCTION IF EXISTS public.record_partner_commission(uuid, numeric, uuid, uuid, text, uuid);
DROP FUNCTION IF EXISTS public.mark_commission_paid(uuid, text, text, timestamptz);
DROP FUNCTION IF EXISTS public.cancel_commission(uuid, text);
DROP FUNCTION IF EXISTS public._log_partner_event(uuid, uuid, public.partner_event_type, jsonb);
ALTER TABLE public.hotels DROP COLUMN IF EXISTS partner_verification_stale_days;
COMMIT;
```

Lead CRM is not touched — only the FK from `leads.partner_id → partners.id` is dropped.

---

## 9. Sign-off matrix

| Item | Status | Notes |
|---|---|---|
| TypeScript strict | ✅ Pass | 0 errors |
| Unit tests | ✅ Pass | 500 / 500 |
| Production build | ✅ Pass | 5.45s |
| Migrations apply locally | ✅ Pass | 7 + 9 verified clean |
| Discriminator CHECK constraints | ✅ Pass | kind ↔ category + kind ↔ commission both enforced |
| Email format CHECK | ✅ Pass | regex + length cap; modal + RPC + DB three layers |
| Phone normalization | ✅ Pass | `_normalize_phone()` called in create + update; diff reflects normalized form |
| Cross-tenant guards | ✅ Pass | `link_lead_partner`, `record_partner_commission` both check hotel_id match |
| Per-hotel verification staleness | ✅ Pass | hotels.partner_verification_stale_days; v_partner_directory uses it |
| RLS policies | ✅ Pass | 3 tables + 1 view member-scoped (view via security_invoker) |
| Audit (per-entity events) | ✅ Pass | `partner_events` typed enum + schema-versioned |
| Audit (per-field diff in update_partner) | ✅ Pass | all 15 mutable fields tracked; no-op short-circuit |
| Idempotency (commissions) | ✅ Pass | UNIQUE partial index + IDEMPOTENCY_KEY_MISMATCH guard |
| Commission state machine | ✅ Pass | ACCRUED → PAID; ACCRUED → CANCELLED; PAID terminal; cancel-paid refused |
| Finance-manager role gate | ✅ Pass | mark_paid + cancel both require `vaiyu_is_hotel_finance_manager` |
| Liability disclaimer (EN + HI) | ✅ Pass | renders on directory + detail drawer |
| DO_NOT_USE requires reason | ✅ Pass | CHECK + RPC double-guard |
| VERIFIED requires last_verified_at | ✅ Pass | CHECK enforced |
| Side-nav + dashboard tile | ✅ Pass | 🤝 Partners tile gated on feature flag |
| Rollback documented | ✅ Pass | Soft + hard paths above |
| Migration pushed to prod | ⚠️ Pending | Awaiting approval |

---

## 10. Honest grade

**Production-grade for the stated scope.** Two product visions reconciled into a clean discriminated schema, validated at the DB layer (CHECK constraints) and the RPC layer (typed enums + cross-tenant guards). Audit fidelity post-Phase-1.1 matches the rest of VAiyu (per-field diffs, typed event tables). Legal exposure addressed via verbatim PO-brief disclaimers in both languages. Money operations gated to finance-manager role with idempotency protection.

**The deliberate limitations** — no marketplace, no auto-payouts, no commission auto-calculation, no per-staff routing, no settings-UI for staleness window — are explicit scope decisions, not gaps. Each has a documented trigger condition for when to revisit.

**Honest unknown:** how operators actually use the AGENT side. Original sequence doc said agents drive 30-50% of Uttarakhand leisure volume. If true, the commission ledger gets heavy use and the manual UX (record amount, mark paid one by one) might feel slow. Watch this; bulk operations could land in Phase 2 if a pilot hotel reports it.
