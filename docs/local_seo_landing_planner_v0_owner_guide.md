# Local SEO Landing Planner — Hotel Owner Guide

**Version:** Local SEO Landing Planner v0
**Released:** 2026-05-29
**Where to find it:**
- **Local SEO Planner** card on the owner dashboard
- **SEO Plan** quick-link tile (🛡️) in the dashboard grid
- Workspace at `/owner/<your-slug>/seo-planner`

---

## What is it?

**Yeh ek planning aur governance tool hai — public page banata nahi hai.**

The Local SEO Landing Planner is a thinking tool. It helps you write down *page ideas* for local-SEO landings (e.g. "Family stay in Mukteshwar", "Monsoon retreat in Uttarakhand"), and tells you which ideas are **safe** vs. which look **spammy or fake** — *before* anyone builds a real public page. The system itself never publishes anything.

**It is NOT:**
- a public page publisher
- an SEO auto-generator
- a doorway-page generator
- a ranking, traffic, booking, or revenue guarantee
- a keyword research tool

**Why we built it as a planner first:** programmatically generating local landing pages across many hotels is *exactly* the pattern Google penalises as "doorway pages" — and the penalty can drop your hotel's *whole* website from Google, not just the new pages. This planner is the safety net that decides which ideas would be safe to build before we ever build them.

---

## What you'll see

| Surface | What it does |
|---|---|
| **Dashboard card** | Counts of Safe / Needs-proof / Risky blueprints + how many are in review / ready to build |
| **Workspace** | Build, review, approve, hold, archive blueprints. Filter by risk / status / category. |
| **Blueprint editor** | Inline form with live Policy-Shield feedback as you type + a proof checklist + a (manager-only) override panel |

---

## The 6 blueprint categories

| Category | Use when | Proof required? |
|---|---|---|
| **Geographic focus** | Anchored to a place/landmark ("Family stay in Mukteshwar") | Yes — real location + photos + honest distance |
| **Traveler niche** | Audience-led ("Workation homestay", "Wellness retreat") | Only if you list a niche amenity |
| **Seasonal position** | Time-of-year angle ("Monsoon retreat") | No, but tie to a real seasonal offer |
| **Target market** | Source-market angle ("Weekend stay from Delhi NCR") | Yes — honest travel time/route |
| **Amenity / trust** | Amenity claim ("Parking-friendly stay") | Yes — amenity must genuinely exist + photo proof |
| **Package-led** | Built around a real Package Builder package | Yes — package should be live |

---

## The 6 Policy-Shield flags

| Flag | What it means | What to do |
|---|---|---|
| **Safe blueprint** ✓ | Concept reads as safe, no overclaim, proof gathered (where needed) | Submit for review when ready |
| **Needs proof** | The claim is verifiable but you haven't ticked the proof checklist yet | Gather the proof and tick the items |
| **Risky / doorway** | Title uses superlative or unprovable overclaim ("best", "cheapest", "#1", "guaranteed") | Reword to a specific, honest claim |
| **Fake local claim** | A reviewer has flagged the claim as untrue (e.g. "near X" when X is 80 km away) | Rework the concept around a real location |
| **Duplicate / low value** | Another live blueprint with the same title already exists | Combine, differentiate, or archive one |
| **On hold** | A reviewer parked this idea | Resume from the lifecycle bar when ready |

**Hard rule:** a manager **cannot** approve a Risky, Fake, or Duplicate blueprint. Fix the concept (or override the flag with a written reason) before approval.

---

## Two-axis governance — Status × Review

A blueprint moves through two parallel axes at once:

### Status (lifecycle)
- **Draft** — you're writing it
- **In review** — submitted for governance
- **Ready to build** — approved and queued for the future publisher (Phase 2 — not built yet)
- **On hold** — parked temporarily
- **Archived** — retired

### Review (approval)
- **Awaiting review** — submitted, not yet approved
- **Approved** — manager has signed off
- **Changes requested** — sent back with a note

**Hard rule (enforced in the database):** a blueprint can only be **Ready to build** if it is **Approved**. The approve action atomically lifts both.

**Edits while Ready to build are blocked.** To change a ready blueprint: **Hold → Edit → Submit for review → Approve.** Holding from Ready drops the approval too — so re-approval is needed before it can return to Ready.

---

## Step-by-step: building your first blueprint

### 1. Dashboard → **Local SEO Planner** card → workspace

### 2. Pick a starter or write your own
- 6 safe starter ideas are pre-loaded ("Family stay in Mukteshwar", etc.). Clicking one pre-fills the form with the right category + proof checklist.
- Or click **Start a blank blueprint** and write your own concept.

### 3. Fill the editor
- **Page-title concept** — the idea, plain English ("Family stay in Mukteshwar")
- **Target category** — pick from the 6
- **Why it matters** (optional) — internal note: what guest, what conversion
- **Hinglish guidance** (optional) — your team's local context
- **Safe next action** (optional) — what proof to gather first
- **Connected module suggestion** (optional) — Package Builder / Digital Asset Manager / Seasonal Calendar (coming soon)
- **Owner notes / Internal notes** — visible to the team

### 4. Watch the Policy Shield
- As you type, the live shield tells you the deterministic risk classification.
- "Best stay in Mukteshwar"? Instantly flags **Risky / doorway** (superlative).
- "Family stay in Mukteshwar" with no proof ticked? Instantly flags **Needs proof**.
- Same title as another live blueprint for your hotel? Instantly flags **Duplicate**.

### 5. Tick the proof checklist
- Items are bilingual (English + Hinglish). Tap to satisfy.
- All proof satisfied → flag flips to **Safe blueprint**.
- *Proof is advisory in v0* — you can still send a blueprint to "Ready to build" without all proof. The hard proof-gate becomes mandatory at the Phase 2 publish step (when there's something publishable to guard).

### 6. **Save** → **Submit for review** → manager **Approves** (or requests changes)

---

## The override panel (managers only)

The Policy Shield is deterministic — it can't tell you whether a "Char Dham" claim is real or fake; it can only tell you whether you've ticked the proof. When a human knows something the rules can't infer (a verified false claim, parking an idea), use the **Override the Policy Shield** panel in the editor.

- A **reason is required** when overriding.
- Every override is recorded in the audit timeline as a `RECLASSIFIED` event.
- Typical legitimate uses: marking a `FAKE_LOCAL_CLAIM` after verification, parking with `ON_HOLD`, or temporarily overriding `NEEDS_PROOF` to `SAFE_BLUEPRINT` with a strong note (use sparingly — undermines the safety net).

---

## What the dashboard card tells you

- **Safe** — blueprints the Policy Shield rates as safe
- **Needs proof** — blueprints with unsatisfied proof on a verifiable-claim category
- **Risky** — sum of Risky / Fake / Duplicate (the three approval-blocked flags)
- **In review** — submitted, waiting on manager
- **Ready to build** — approved and queued for the future publisher

If you see a high "Risky" count, walk through those and either reword the title or override (with reason) before they pile up.

---

## What's coming next (deliberately NOT in v0)

These are tracked, sequenced, and will ship only with a clear trigger:

- **Phase 2 — Publisher.** Will publish real public landing pages, but *only* for blueprints the planner has marked Safe + Approved + every proof satisfied. Needs SSR/prerender infrastructure that doesn't exist in the app yet. The planner is the gate.
- **Seasonal Calendar (Position 8).** Will deep-link from Seasonal-position blueprints when it ships.
- **Visibility Score (Position 9).** Will consume the planner's read-model (Safe / Risky / Ready counts) as one of several signals — no rework of the planner needed.
- **AI-assisted suggestions.** Only if a real workflow gap demands them. Even then, the Policy Shield + governance stays the authoritative path — AI can propose, governance disposes.

---

## Quick reference — common scenarios

| You want to | Do this |
|---|---|
| Capture an idea for later | Create a blueprint, leave it as Draft |
| Submit for governance | Open it → **Submit for review** |
| As a manager, sign off a safe idea | Open it → **Approve & mark ready** |
| Send back with feedback | **Request changes** + note |
| Park an idea temporarily | **Hold** (drops approval if it was Ready) |
| Restart a held idea | **Resume** → back to Draft |
| Permanently retire an idea | **Archive** (manager+) |
| Change a Ready-to-build blueprint | **Hold** → Edit → Submit → Approve again |
| Flag a claim as fake | Edit → Override panel → choose **Fake local claim** + give a reason |

---

## What this tool will and won't do for your Google ranking

**Will:**
- Keep a structured, audited list of safe local page ideas you can act on with confidence.
- Stop your team from accidentally building doorway-style pages that could penalise your domain.
- Give you a shared vocabulary (safe / needs-proof / risky) so reviews are fast.

**Won't:**
- Publish pages, change your sitemap, edit your metadata, or post anything to Google.
- Guarantee any ranking, traffic, booking, revenue, or visibility improvement.
- Replace honest local effort — real photos, real packages, real proof of place.

> *Local SEO Landing Planner is an internal planning tool. It does not publish pages, modify metadata, guarantee rankings, traffic, bookings, revenue, or Google visibility.*
