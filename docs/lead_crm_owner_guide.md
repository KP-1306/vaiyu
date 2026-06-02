# Lead CRM — Hotel Owner Guide

**Version:** v1 (live in production since 26 May 2026)
**Where to find it:** Owner dashboard → "Open leads" card, or **Leads** tile in the quick-link grid → `/owner/<your-hotel>/leads`

---

## What is it?

**Har enquiry ek hi jagah pe — kya aaya, kisne reply kiya, kya hua aage.**

Lead CRM is the system that holds every guest enquiry your hotel gets — phone, website, walk-in, OTA referral, agent — and walks each one through the steps from "first contact" to "confirmed booking." It records who said what, who's working on whom, and what the next action is, so nothing slips through the cracks at the front desk.

It is **the foundation of the Growth Hub** — Follow-up Radar, AI Quote Drafts, and the upcoming Drip Engine all read from this single source of truth.

---

## What's on the dashboard

Two surfaces tied to Lead CRM:

| Surface | What it shows |
|---|---|
| **Open leads card** | Live count of leads in NEW / QUALIFIED / QUOTED / WON, with a breakdown. Click → full workspace. |
| **Leads tile** (📞) | Quick-link in the dashboard tile grid. |

---

## How a lead moves through the system

Every lead has one of 6 statuses. The system enforces which moves are allowed — you can't accidentally skip from NEW to CONVERTED.

```
                    ┌──────── LOST ─── (reopen → NEW)
                    ↓
NEW ──→ QUALIFIED ──→ QUOTED ──→ WON ──→ CONVERTED (booking exists)
                                  ↓
                                LOST
```

**What each status means:**
- **NEW** — Just came in. No one has done anything yet.
- **QUALIFIED** — Staff has decided this is a real, workable enquiry (dates fit, guest is responsive).
- **QUOTED** — You sent a price / package. Waiting on the guest.
- **WON** — Guest has committed (verbally, by message, by contract). Booking paperwork might still be pending.
- **CONVERTED** — Booking row created in your bookings system. Lead is closed in the books.
- **LOST** — Guest dropped off or chose a competitor. Reason is recorded.

The **WON vs CONVERTED** split is important — your front desk often says "they're confirming Friday" before any walk-in / reservation entry happens. WON captures that commitment without forcing premature paperwork.

---

## Two ways leads get created

### 1. Manual (front-desk entry)
Click **+ New lead** in the workspace. Fill the form (name + at least one of phone/email is required; dates and party size optional). The lead lands in NEW.

### 2. Public website form
Embed `/p/<your-hotel-slug>/enquire` on your website. Guests fill the form themselves — name, contact, dates, party size, notes — and the lead lands in NEW automatically, with source = WEBSITE. No login required for guests.

**Safety:** the public form is rate-limited (5 submissions per minute per visitor) and validates input before creating the lead. Unknown / spoofed hotel IDs get a generic "could not submit" so the form can't be used to probe your account.

---

## Working a lead

Click any lead to open the **detail drawer**. You'll see:

| Section | What it does |
|---|---|
| **Header** | Name, status pill, source icon, assignee |
| **Claim badge** | "Worked by [name]" — see § Claim lock below |
| **Status menu** | Dropdown to move the lead to the next valid status (LOST asks for a reason; CONVERTED opens the convert flow) |
| **Contact** | Name, phone, email — editable, with diff captured in the timeline |
| **Basics** | Dates, adults, children, room count, value estimate, source detail, tags — editable, with diff |
| **Notes** | Add a note any time — visible to all staff at this hotel |
| **Timeline** | Append-only history of everything that's happened to this lead (claimed, status changed, contact edited, notes added, converted, etc.) |
| **Actions** | Soft delete (manager+ only) |

### The claim lock — so two staff don't step on each other

When you open a lead detail, the system **automatically claims it for 15 minutes**. While you have the claim:
- Your colleagues see "Currently with [your name]" on that lead
- They can still read everything, but they get a visible signal not to call/email the guest in parallel
- The claim auto-refreshes every 10 minutes while the drawer is open
- The claim releases when you close the drawer

If someone tries to work a lead you have claimed, they'll see your name and decide whether to wait or to ask you. If you're stuck (in a meeting / lunch / forgot to close the tab), a **manager can force-release** the claim with a reason. You'll see a realtime toast if that happens to you.

---

## Filters, search, sort, and views

The workspace has **two views**:

- **List view** — compact rows, faster for skim/scroll
- **Kanban view** — board with 6 columns (one per status), drag-and-drop to change status

Filter bar (works in both views):
- **Status chips** — toggle which statuses to show
- **Source dropdown** — filter by GOOGLE / WEBSITE / INSTAGRAM / FACEBOOK / OTA / WALK_IN / REFERRAL / AGENT / CORPORATE / WEDDING / GROUP / OTHER
- **Assignee dropdown** — filter by who owns it (or "Assigned to me")
- **Search** — name / phone / email substring
- **Sort dropdown** — by last activity / due date / created / value estimate

**Filters are URL-encoded.** Share a filtered view by copying the page URL — your manager can open the same view.

---

## Converting a lead to a booking

When a guest says "yes" and you're ready to enter the walk-in:

1. Click the lead → **Convert to walk-in** (in the status menu or actions)
2. The convert modal opens, pre-filled from the lead: name, dates, party size, source
3. Pick a room type (live list from your inventory, with effective price from your rate engine)
4. Confirm
5. The system creates the booking + folio + walk-in flow atomically, sets `bookings.lead_id` as a back-link, marks the lead CONVERTED, clears the claim, and writes a CONVERTED_TO_BOOKING event

**Important:** the whole thing is one transaction. If the walk-in flow fails for any reason (room conflict, validation error), nothing is left half-done — the lead stays exactly where it was.

If you accidentally try to convert a lead that's already CONVERTED, the modal tells you which booking it became and offers a link.

---

## Duplicates and dedupe

When you create a lead, the system checks: in the same hotel, in the last 30 days, was there already a lead with the same phone number? If yes, you get a yellow **possible duplicate** warning with a link to the earlier lead. You can still create the new lead — duplicates are flagged, not blocked.

Phone numbers are normalised:
- Bare 10-digit (e.g. `9876543210`) → `+919876543210`
- International (e.g. `+97150123…`) → preserved as-is
- Anything weird is stored as-typed (no data loss; dup-check may miss)

---

## Export your leads

Click **Export CSV** in the workspace header (top-right). The export:
- Honours your current filter (status, source, assignee, search)
- Streams up to 200,000 rows with keyset pagination
- Includes every column: id, status, source, contact, dates, party, value, notes preview, tags, timestamps, assignee, converted booking id
- UTF-8 with BOM so Excel double-click opens cleanly with accented characters intact

Filename pattern: `leads-<hotel-id>-<YYYYMMDD>.csv`

---

## Realtime — everyone stays in sync

Multiple staff in the same workspace? When anyone:
- Creates / edits / deletes a lead
- Moves a lead to a new status
- Claims or releases a lead
- Adds a note

Your tab updates within ~1 second. No need to refresh.

---

## What it does NOT do (read this carefully)

| It will NOT | Because |
|---|---|
| Send WhatsApp / SMS / email to guests | Lead CRM is a record-keeping system, not a sender. Use AI Quote Drafts to draft a reply, then send it through your usual channel. |
| Auto-assign leads to specific staff | No round-robin. You assign or claim manually. |
| Push leads to OTAs / channel managers | OTA integration is its own future work. |
| Auto-respond to enquiries | Guests get a "Thanks, we'll be in touch" page after submitting the public form — that's it. Your team writes the reply. |
| Send drip campaigns | The Lead Drip Engine does that (separate module). |
| Track guest journey beyond the booking | Once converted, the lead is closed. The booking system handles the stay. |

---

## How the surrounding Growth Hub uses your leads

| Module | What it reads from Lead CRM |
|---|---|
| **Follow-up Radar** | New leads auto-create a "Follow up with [guest]" reminder; status → QUOTED creates a "Nudge on the quote" reminder; status → CONVERTED auto-resolves all the lead's follow-ups |
| **AI Quote Drafts** | Open leads (NEW / QUALIFIED / QUOTED / WON) show in the lead picker; selecting one pre-fills the quote form with name, dates, party size |
| **Lead Drip Engine** | New leads (eligible sources) start the drip sequence; status moves (QUALIFIED / WON / CONVERTED / LOST) pause / cancel the drip |

You don't have to do anything to wire these up — they all subscribe to your Lead CRM automatically.

---

## Front-desk QA — try this on day one

Run through this once with your team:

1. **Manual create**: `/owner/<slug>/leads` → **+ New lead** → fill name + phone → save → lead appears in NEW column / list
2. **Edit contact**: open the lead → change phone → save → check the timeline shows "Contact updated"
3. **Add note**: open the lead → type a note → save → check it appears at the top of Notes + in the timeline
4. **Claim handoff**: open the lead in one tab → in another browser/tab, the lead shows "Worked by [name]"
5. **Move statuses**: NEW → QUALIFIED → QUOTED → WON. Each transition writes to the timeline.
6. **LOST with reason**: pick a lead → status menu → LOST → reason required → save → check it moved to LOST with the reason visible
7. **Reopen**: open the LOST lead → status menu → NEW → it's back in the list
8. **Convert**: open a WON lead → Convert to walk-in → fill room type + dates → confirm → booking exists, lead is CONVERTED with a back-link
9. **Export**: click Export CSV → download starts → open in Excel → all columns present + UTF-8 readable
10. **Public form**: visit `/p/<your-hotel-slug>/enquire` (not logged in) → fill form → submit → see "Thanks, we'll be in touch" → check the lead appears in your workspace with source = WEBSITE
11. **Filter**: tick **Status: QUOTED** + **Source: WEBSITE** → URL updates → refresh → filter holds
12. **Realtime**: open the workspace in two browser tabs → change something in one → other updates within ~1 second

---

## A note on language

Form labels are English. Helper lines are English + Hinglish where they help — e.g. on the public form: *"Share a few details and we'll get back to you with availability and rates."* If you'd prefer a different phrasing for the public form before you publish the URL on your website, tell us and we'll customise per hotel.

---

## When something looks wrong

| Symptom | What to do |
|---|---|
| A lead appears in the list but disappears on refresh | Probably soft-deleted. Check the timeline — soft-delete is recorded. Manager can reopen. |
| "Could not submit" on the public form for a real guest | Check the rate-limit (5/min per IP). If a tour operator is auto-submitting, ask them to throttle. |
| Convert button is greyed out | Lead must be in WON status. Move it through QUOTED → WON first. |
| The claim badge shows someone who isn't around | Manager can force-release with a reason. The displaced person gets a realtime toast. |
| CSV export looks wrong in Excel | Make sure to double-click the file rather than File → Open. The UTF-8 BOM tells Excel to read it correctly. |
| A lead I converted shows wrong dates in the booking | The convert modal pulls dates from the lead; if you changed them in the modal, the booking has the modal values. Edit the booking directly. |

---

**Owner feedback welcome.** Lead CRM is the foundation everything else builds on. Anything that feels off here cascades into Follow-up Radar / AI Quote Drafts / Drip — so flag friction here first.
