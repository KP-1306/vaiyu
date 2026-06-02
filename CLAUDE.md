# VAiyu — Project Instructions for Claude

## Context

VAiyu is a hotel SaaS for the Indian (Uttarakhand-focused) market: multi-tenant
operations OS covering bookings, folio, payments (Razorpay), housekeeping,
food orders, walk-ins, guest portal, and (in progress) WhatsApp + Lead CRM.

Stack: React + Vite frontend, Supabase (Postgres + Edge Functions in Deno),
Netlify hosting, Razorpay payments.

## Quality bar — 100% production solution, no known-but-deferred issues

**The user's standard: if a known issue has a cheap fix available now, fix it
now.** Verbatim user direction: *"I want 100% production solution, no future
changes if we know that is there."*

These framings are NOT acceptable when designing or implementing:
- "Not urgent"
- "v1.1 / v2 / later" / "Phase 2" / "follow-up PR"
- "Future-me's problem"
- "We can defer this"
- "Acceptable trade-off for now" (without explicit user sign-off)
- "Future iteration" / "polish pass" / "nice-to-have"
- "Ship this now, harden later"
- Any item that would land in a "Known limitations" section

**The ONLY valid deferrals are:**
1. **Explicitly out of scope** per a decision the user signed off on in this
   conversation, OR
2. **Requires infrastructure that doesn't exist yet** AND has a concrete
   trigger condition documented for when to revisit (e.g. "Add per-hotel
   claim TTL config IF a paying hotel asks for it"), OR
3. **Cost demonstrably exceeds value** AND you've told the user explicitly
   with numbers so they can override.

**Apply to all of these specifically:**
- Reviewer suggestions tagged "not urgent" or "current is fine" — treat as
  decisions due, not optional polish. Either fix or document the explicit
  trigger condition. Never just nod and move on.
- Edge cases you identified that the user didn't ask about — fix or surface.
- "We could improve this later" thoughts you have while writing code — fix now.
- Anything where you'd be tempted to write `// TODO` or `// FIXME` — those
  comments are forbidden unless paired with a ticket reference or user-approved
  deferral.

**Why this matters:** the user is shipping to real hotels with real money.
Every "we'll fix it later" is a debugging session at 11pm next month when a
front-desk staffer hits the bug.

## Planning behaviour — before sharing any implementation plan

**Two-pass requirement. Never share a plan after one pass.**

- **Pass 1 — confirmation mode:** verify the plan covers requirements and is
  internally consistent. This is what a plan author naturally does.
- **Pass 2 — hostile mode:** re-read your own plan as an adversarial reviewer.
  Assume you are wrong somewhere and hunt until you find where. The six passes
  below ARE the hostile-mode checklist — each is a different angle of attack
  on your own plan, not just additional rules to follow.

| Confirmation mode asks | Hostile mode asks |
|---|---|
| Does this cover the requirements? | How does this break at 11pm with a brand-new hotel that has no data yet? |
| Are the parts internally consistent? | Where do two parts of the plan silently contradict each other? |
| Is the scope reasonable? | What did I quietly defer by calling the scope "reasonable"? |
| Does the schema work? | What query pattern silently penalizes a real tenant? |
| Does this match existing conventions? | What invariant is enforced by *nothing* because I assumed someone else's code does it? |

If hostile-mode review surfaces zero gaps, you did it wrong — run it again.
A polished plan with no flagged risks almost always means the reviewer was the
author, not an adversary.

**Connection to the Quality bar above is direct:** hostile mode is *how* you
uphold "100% production, no deferred issues" — because deferred issues are
exactly what confirmation mode quietly accepts. The two sections are one rule
split across two phases (planning + implementing).

When the user asks *"is this 100% production ready?"* or *"Google-level?"* —
that is an explicit signal that hostile mode was skipped on the prior plan.
Re-run all six passes before answering.

1. **Operator pass.** Walk the plan as the real user (front-desk staff at 11pm,
   hotel owner on a phone, guest with poor signal, brand-new hotel with zero
   data). Where does a rule, constraint, or required field trip a real workflow?
   Where do derived metrics unfairly score a tenant who hasn't generated data
   yet? Fix operator reality before engineering invariants. If a CHECK
   constraint forces staff to create phantom data to satisfy it, the constraint
   is wrong, not the staff.

2. **Codebase pass.** Grep for existing patterns before importing generic ones.
   If `X_events` exists, don't invent `Y_status_history`. If audit goes to
   `va_audit_logs`, don't fork audit infrastructure. Name and shape new tables
   after the closest existing precedent.

3. **Risks are decisions due, not future-me problems.** Every item in a "Risks"
   section either (a) becomes a v1 design change, or (b) meets the bar in the
   "Quality bar" section above for a valid deferral with concrete trigger
   condition. No shrugging. "Not urgent" / "v1.1" are forbidden framings.

4. **Self-contradiction pass.** Re-read the plan once specifically hunting for:
   CHECK constraints described as enforcing transitions (they can't see OLD),
   RLS claims that contradict the RPC path, atomicity claims that span separate
   network calls, "enforced both by X and Y" phrasing where only one actually
   enforces.

5. **Strategic framing before tactical scope.** Before listing what NOT to build
   (no scoring, no custom fields), state in one sentence what the product IS and
   ISN'T at the identity level. "Hospitality conversion layer, not a generic
   CRM" beats fifteen specific anti-features.

6. **Operational reality > engineering elegance** when they conflict. Indian
   hospitality especially: verbal commits before payment, manual room holds,
   agent-driven bookings, families calling twice. Design for the messy real
   workflow, not the clean diagram.

## Coding conventions in this repo

- **Multi-tenancy:** every new table needs RLS scoped via `hotel_members`.
  Use `hotels_write_for_owner_manager` and `leads_select_for_members` as the
  reference patterns. Never write a table that lacks hotel-scoped RLS.

- **Money math:** always `Math.round(rupees * 100)` for paise. Never
  `parseFloat * 100`. All amounts stored as numeric(10,2) in INR.

- **Immutability:** payment rows are immutable post-INSERT (enforced by
  `trg_restrict_payment_update` / `trg_prevent_payment_delete`). Never UPDATE
  a payment — insert refunds/adjustments instead.

- **Razorpay:** dual-mode (DIRECT live, ROUTE gated behind `ROUTE_ENABLED` flag).
  Per-payment `razorpay_mode` tag drives refund dispatch. Don't touch Route
  Edge Functions when adding Direct features.

- **Migrations:** local has many more migrations than production. Use
  `IF NOT EXISTS` patterns for safety. Test against fresh + cumulative apply.

- **Audit:** prefer the existing `va_audit_logs` table over inventing per-entity
  audit tables. Per-entity event tables (`ticket_events`, future `lead_events`)
  are justified only when the timeline is a first-class UI surface that gets
  queried often.

- **Edge Functions:** auth via `_shared/auth.ts` (`assertAuthed`, role checks,
  rate limiting). CORS via `_shared/cors.ts`. Never roll your own.

- **Tests:** Vitest for frontend (`*.test.ts` next to source). Deno test for
  Edge Function shared utilities. Test the money-correctness invariants
  specifically.

## Anti-features (do not build without explicit approval)

The product is a **hospitality conversion + operations orchestration layer**,
not a generic CRM, not a generic POS, not a generic PMS clone.

- No custom fields per hotel
- No workflow builder UI
- No pipeline templates (one hospitality lifecycle, period)
- No marketing automation campaigns (lead drips are stay-enquiry-specific)
- No multi-currency until first non-INR hotel arrives
- No sales rep constructs (territories, quotas, commissions for VAiyu sales)
- No third-party integration marketplace
- No "AI assistant" features without a real workflow gap they fill

## Communication

- Match response length to ask. Short questions get short answers.
- Don't narrate internal deliberation in user-facing text.
- File references use markdown link format: `[file.tsx:42](path/to/file.tsx#L42)`
- Indian English / INR / 24h time where formatting matters.
