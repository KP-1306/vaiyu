# Partner Network — Hotel Owner Guide

**Version:** v1.2 (vendor directory + agent commission ledger + per-hotel verification window)
**Released:** 27 May 2026
**Where to find it:** Owner dashboard → **Local Partner Directory** card, **Partners** (🤝) tile in the quick-link grid, or `/owner/<your-hotel>/partners`

---

## What is it?

**Aapke trusted local partners ka ek hi list — verify, status, aur agent commission tak.**

Partner Network is your hotel's internal directory of the people your team relies on:

- **Vendors** — taxis, trek guides, photographers, decorators, yoga instructors, food/catering, laundry, maintenance, etc. The list you reach for when a guest asks "can you book a Char Dham vehicle?" or "we need someone to fix the geyser."
- **Agents** — travel agents, corporate bookers, wedding planners who send you guests and (typically) get a commission. The list you reach for when accounts asks "who do we owe commission to this month?"

One place for both, with status tracking (Preferred / Backup / Do not use), verification tracking (Verified / Pending / Rejected, with a stale warning after 90 days by default), and (for agents only) a manual commission ledger.

**This is NOT a marketplace.** Guests can't see it. Vendors can't log in. VAiyu makes no claim about anyone's licensing or insurance — your team verifies independently.

---

## What's new in v1.2

- **Per-hotel verification stale window.** Default 90 days, but configurable per hotel via the `hotels.partner_verification_stale_days` column. Some categories (yoga, transport) re-verify monthly; others (laundry) can drift for a year. Settings UI for this lands in Phase 2 — for now, edit via Supabase Studio if you need a different threshold.
- **Full per-field audit.** Earlier the audit row for an update only captured `category` changes. Now every field change writes a diff (subject/body length, before/after for arrays, normalized phone number, lowercased email, etc.) so the timeline answers "who changed the commission % on Tuesday?"
- **Phone numbers are normalised on save.** Type "+91 98765 43210" or "9876543210" or "098765 43210" — they all store as `+919876543210`. The audit diff shows the normalised value so what's in storage matches what's audited.
- **Email format check at three layers.** The form, the RPC, and the database all reject "not-an-email". Less chance of silently storing junk.
- **Commission idempotency.** Click "Record commission" twice on a slow network? Only one ledger entry is created. Click with the same key but different amount? The system loudly refuses (`IDEMPOTENCY_KEY_MISMATCH`) instead of silently creating a wrong entry.

---

## How to think about it — two kinds, one table

When you click **+ Add partner**, you first choose a **kind**:

| Kind | Use when | Commission tracking |
|---|---|---|
| **Vendor** | Operational supplier (taxi / trek / temple tour / safari / photographer / event decoration / wellness / food / laundry / maintenance / etc.) | No commission fields |
| **Agent** | Books guests on your behalf for a commission (travel agent / corporate booker / wedding planner / group booker) | Commission % + payout terms + ledger |

The categories you can pick from change based on the kind — you can't accidentally mark a Wedding Planner as a Vendor or a Taxi Service as an Agent. If the same business is both (rare — a tour operator who also books rooms), create two rows.

---

## Status — what the pills mean

Every partner has a **Status**:

| Status | What it means | Example |
|---|---|---|
| **Draft** | You're still filling out details. Hidden from operator-facing search. | "Got this guy's number from a friend, need to verify before recommending" |
| **Verified** | You've called them, confirmed they're real, can serve your guests | Default once you mark verification VERIFIED |
| **Preferred** | First-choice for their category. The reliable one. | "Always call this taxi guy first; he picks up" |
| **Backup** | Use when the Preferred can't deliver | "If primary photographer is booked, call this one" |
| **Inactive** | Temporarily not in use (e.g. seasonal vendor in off-season) | "Off-season — Char Dham guides until April" |
| **Do not use** | Bad experience; never recommend. **Requires a reason** that's logged to the audit. | "Vehicle was unsafe, refused to refund — DO NOT call" |

You can only move to a non-Draft status if the partner has at least one contact channel (phone or email). The system enforces this.

---

## Verification — what those badges mean

Independent of Status, every partner has a **Verification status**:

| Verification | What it means |
|---|---|
| **Not verified** | You haven't checked them yet. Default for new entries. |
| **Verification pending** | Someone on your team is verifying. Optional notes. |
| **Verified** | You've confirmed phone, rate range, availability. Stamps `last_verified_at`. |
| **Stale** | (Derived — not a stored state) Verified status, but `last_verified_at` is older than your hotel's threshold (default 90 days). The badge shows "Verified · stale" in amber. Re-verify and re-stamp. |
| **Rejected** | You verified and the partner failed — they should never become Preferred. Often pairs with Do not use status. |

Verification is **operator-asserted**. VAiyu doesn't verify anyone. We don't have access to GST / shop & establishment / insurance records. The badge means "your team checked" — nothing more.

---

## The commission ledger (Agent rows only)

Open any Agent partner's detail drawer. Below the contact/services sections is a **Commission ledger** section.

To record a commission:
1. Click **+ Record commission**
2. Enter the amount in INR (decimal allowed)
3. Optional notes — booking ref, dates, number of nights
4. Click Record

The row appears in the ledger with status **ACCRUED** (amber pill). The system auto-generates an idempotency key per click so you can't double-record by accident.

When you actually pay the agent:
1. Click **Mark paid** next to the ledger row
2. Enter the payout reference (UPI ref / bank ref / cheque no.) — **required**
3. Optionally enter the method (UPI / BANK / CASH / CHEQUE) — free-text
4. Click

Status moves to **PAID** (green pill). This action requires the Finance Manager role.

To cancel an accrued (not yet paid) commission:
1. Click **Cancel** next to the row
2. Enter a reason (logged to audit)

Status moves to **CANCELLED** (grey pill). A PAID commission cannot be cancelled — once you've paid, the row is immutable.

**What the ledger does NOT do:**
- Auto-calculate commission from booking amount × commission % — you record the actual paid amount yourself
- Auto-trigger payment — the "paid" stamp is bookkeeping, not a transfer
- Reconcile with bank statements — out of scope
- Generate GST invoices for the agent — out of scope

---

## What you'll see on the dashboard

A card called **Local Partner Directory** shows four numbers:

| Number | Means |
|---|---|
| **Total** | All non-archived partners |
| **Verified** | Partners with verification_status = VERIFIED |
| **Preferred** | Partners with status = PREFERRED |
| **Stale** | Verified partners whose `last_verified_at` is past your hotel's stale window. Re-verify these. |

If you have leads stuck on partners that are stale or inactive, that surfaces here. Click the card or the 🤝 Partners tile to open the directory.

---

## Using the directory

Visit `/owner/<your-hotel>/partners`. Layout:

1. **Counters strip** at top
2. **Filter bar:**
   - Free-text search (matches partner name + service area)
   - Kind chips (All / Vendors / Agents)
   - Status chips (toggle multiple — Verified, Preferred, etc.)
   - Verification chips (Unverified / Pending / Verified / Rejected)
   - "Include archived" toggle
3. **Table:**
   - Name + service area + phone (compact)
   - Kind + Category badges
   - Status badge
   - Verification badge (with stale warning if applicable)
   - Lead count (how many leads in your CRM list this partner as the source)
   - Outstanding commission (₹ amount of ACCRUED ledger entries — Agent rows only)
   - Click any row to open the detail drawer

**Detail drawer** sections:
- Contact (call / email links)
- Services & area
- Status switcher (click any status pill to change)
- Verification switcher
- Commission ledger (Agent only — record + mark paid + cancel)
- Internal notes (free-form)
- Timeline (every status change, every edit, every commission action)
- Liability disclaimer footer (compact)

---

## What it does NOT do (read this carefully)

| It will NOT | Because |
|---|---|
| Show this list to guests | Internal-only. No public marketplace. |
| Let vendors log in to update their info | Internal-only. You own the data. |
| Auto-call or auto-message vendors | No outbound automation in v1. |
| Send a quote request to a vendor on your behalf | Same. |
| Verify a vendor's GST / insurance / licensing | Your team does. VAiyu makes zero claim. |
| Reconcile commissions with bank statements | Out of scope. Manual record-keeping only. |
| Calculate commission from booking amount automatically | Operator records the actual amount paid. |
| Auto-trigger payouts via UPI / bank API | No payment integration. |
| Import partners from CSV | Manual create only for v1. Tell us if you need bulk import. |
| Render partner logos / photos / brochures | Text-only profiles. |
| Per-staff partner ownership ("Suresh's vendors only") | Hotel-scoped only. |

---

## A note on legal exposure

Every page in this module carries this disclaimer (English + Hindi):

> **English:** This is an internal partner directory. Rates, availability, licensing, insurance, safety, and service quality must be independently verified by the property team. VAiyu does not assume vendor liability.

> **Hindi:** Yeh internal partner list hai. Guest ko recommend karne se pehle partner ka phone, rate aur availability manually verify karein.

This is non-negotiable — your team is on the hook for partner quality, not VAiyu. The "Verified" badge means *your team verified*, not VAiyu. The "Preferred" badge means *your team prefers them*, not VAiyu.

---

## What's coming next

| Phase | What | What it needs |
|---|---|---|
| **2** | Auto-suggestions ("3 photographers near you, none verified in 90 days — re-verify?") | Geographic data + scheduling |
| **3** | Per-staff partner ownership / on-call routing | Per-staff assignee field |
| **4** | Hotel settings UI for `partner_verification_stale_days` | Settings page extension |
| **5** | Bulk CSV import for partners (one-time migration tool) | CSV schema + dedup logic |
| **6** | Photo / brochure upload per partner | Storage bucket + RLS |
| **7** | Per-OTA partner sync (MMT / Goibibo agents) | OTA API integration |

Each phase ships behind its own feature flag and gets your sign-off.

---

## QA — try this on day one

1. Visit `/owner/<slug>/partners` — directory loads with 0 rows + filter bar + counters
2. Click **+ Add partner** → modal opens with Vendor kind selected
3. Pick category "Taxi / Transport", type "Test Taxi Service" + phone "9999999999" + click Add
4. Drawer opens automatically with the new partner
5. In the drawer, click **Status: Verified** → confirm the badge flips to green and a "STATUS_CHANGED" event appears in the Timeline section
6. Click **Verification: Verified** → confirm "Last verified [today]" stamp appears
7. Click **Edit** → change the price note to "₹1500/day" → Save → confirm timeline shows an "UPDATED" event with `field_count: 1`
8. Try setting Status to "Do not use" without entering a reason → confirm it asks for one
9. Visit OwnerDashboard → confirm Partners summary card shows Total = 1, Verified = 1
10. Click **+ Add partner** again → switch kind to **Agent** → pick "Travel Agent" → name "Test Travel Co" → enter `commission_pct: 10` → Save
11. Open the new Agent row → confirm the **Commission ledger** section appears (it doesn't for Vendors)
12. Click **+ Record commission** → enter `₹5000` → Save → confirm row appears with ACCRUED pill
13. Click **Mark paid** → enter "UPI-test-ref-123" → confirm status flips to PAID
14. Try clicking **Cancel** on the now-paid commission → confirm it refuses
15. **(Optional)** Try inserting via SQL: `INSERT INTO partners (hotel_id, kind, category, partner_name, contact_phone) VALUES ('<your hotel id>', 'AGENT', 'MAINTENANCE_VENDOR', 'Bad row', '+919999999999')` → confirm the `partners_kind_category_match` CHECK rejects

---

## When something looks wrong

- **"Add partner" form refuses to save** → check the kind ↔ category combination; AGENT can't use VENDOR categories and vice versa
- **Phone numbers all stored as `+91...` even when I typed something else** → that's normalization working (E.164 form); the audit shows what was actually stored
- **Two partners with the same name** → no dedup in v1; if this becomes a problem, tell us
- **A partner shows "Verified · stale" when I just verified them yesterday** → check `hotels.partner_verification_stale_days` for your hotel (default 90); should be much larger than 1 day
- **Commission ledger shows wrong amount** → click Cancel on the wrong row, then record fresh; if you've already marked it paid, the row is immutable — record an offset entry with notes
- **Agent commission stuck in ACCRUED for months** → that's just bookkeeping; mark paid when you actually pay
- **Verified vendor returns terrible service** → set status to Do not use with a clear reason; the row gets a red pill and a permanent audit trail

---

**Owner feedback welcome.** The biggest unknown here is whether the AGENT side is heavily used. Original sales sheet said agents drive 30-50% of Uttarakhand leisure volume — if your hotel matches that pattern and the manual ledger feels slow, tell us and we'll prioritise bulk operations in Phase 2.
