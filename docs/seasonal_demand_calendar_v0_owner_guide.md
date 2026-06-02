# Seasonal Demand Calendar — Hotel Owner Guide

**Version:** Seasonal Demand Calendar v0
**Released:** 2026-06-01
**Where to find it:**
- **Seasonal Demand Calendar** card on the owner dashboard
- **Seasonal** quick-link tile (📅) in the dashboard grid
- Workspace at `/owner/<your-slug>/seasonal`

---

## What is it?

**Yeh prediction tool nahi hai. Yeh planning aur preparation guide hai.**

The Seasonal Demand Calendar is a curated planning workspace. It shows you the known travel rhythms for India's hospitality — Char Dham yatra, summer hill escapes, monsoon, weddings, long weekends — and gives you a step-by-step prep checklist for each one. Your job: walk the checklist before the season starts.

**It is NOT:**
- a forecasting engine
- a demand / occupancy / revenue prediction system
- a campaign automation tool — it sends no email, no WhatsApp, no SMS
- an AI feature
- a publish path of any kind

**Why we built it as a planning guide first:** the value isn't in predicting demand (no model can predict demand at the single-hotel level reliably). The value is making sure that when Char Dham starts in 18 days, your packages are live, your photos are refreshed, your OTA pricing is updated, and your front-desk team is briefed — instead of scrambling at the last minute.

---

## What you'll see

| Surface | What it does |
|---|---|
| **Dashboard card** | Your "next focus" planning window + counters for Now / Prepare / Watch urgency + how many windows you've marked READY |
| **Workspace** | All 16 planning windows grouped by 8 categories; each one expandable with full detail + checklist + governance + history |
| **Window card** | One season — title, dates, why it matters, recommended action, checklist, your notes, manager actions, and an inline activity history |

---

## The 8 categories

| Category | What's in it |
|---|---|
| **Religious / Yatra** | Char Dham (Opening / Peak / Closing phases) |
| **Metro Escape** | Summer hill escape for Delhi-NCR families |
| **Climate Peak** | Autumn shoulder (clear weather, fewer crowds) |
| **Off-peak Value** | Monsoon value window |
| **Winter / Snow** | Snow stay for honeymoon couples + families |
| **Long Weekend** | Republic Day, Holi, Independence Day, Diwali |
| **Wellness / Workation** | Long-stay workation window |
| **Family Event** | Christmas / NYE, wedding season, school summer holidays, Valentine's Week |

16 windows total. New windows are added via migration (system-defined, not per-hotel customisable).

---

## The 4 urgency bands

Urgency is **deterministic** — it's a function of today's date and the window's date range. There's no demand model, no prediction, no AI.

| Urgency | When | UI tone | What it means |
|---|---|---|---|
| **NOW** | Today is inside the window, OR the window starts in ≤ 7 days | Rose | Last call — prep should already be done |
| **PREPARE** | Starts in 8 – 30 days | Amber | Walk the checklist this week |
| **WATCH** | Starts in 31 – 60 days | Sky | On the horizon — start gathering inputs |
| **QUIET** | Starts in 61+ days | Slate | Not actionable yet, but visible |

If you want to suppress an urgency level without dismissing the window (e.g. "we're running staff training this month, don't show NOW"), use **Override urgency** (manager+, reason required).

---

## What is "approximate window"?

Many windows ship as **approximate ranges** intentionally. Char Dham opens on a date set by the panchang each year (varies). Holi shifts ~2 weeks year to year. Monsoon onset varies ±2 weeks.

If we hardcoded "Apr 30" for Char Dham, the urgency math would be wrong in years where doors open May 2. Instead:

- **Approximate windows** are wide enough to always contain the actual date (e.g. Char Dham Opening = Apr 20 – May 25). UI shows "Around mid Apr – late May" + a disclaimer footnote.
- **Exact-date windows** (Republic Day, Independence Day, Christmas) show the precise range with no disclaimer.

You don't have to know which is which — the UI tells you.

---

## Step-by-step: working a planning window

### 1. Open the workspace from your dashboard

The dark **Seasonal Demand Calendar** card on `/owner/<slug>` shows your next focus + urgency counters. Click to open the full workspace.

### 2. Skim the "Next 3 to focus on" tiles

At the top of the workspace, the 3 most urgent windows (NOW first, then PREPARE, then WATCH, ties broken by days-to-start) are surfaced as click-to-jump tiles. Click one → scrolls smoothly to the full window card below.

### 3. Inside a window card

Each card shows:
- **Header:** name + urgency badge + days until + dates + a "May not apply to your region" badge if your hotel state isn't in the window's target region list
- **Why it matters:** 1-2 sentences on why this matters for your hotel (EN + Hi)
- **Recommended action:** what to focus on overall
- **Target guest segment:** who travels in this window
- **Suggested package idea:** what to put in Package Builder for this season
- **Preparation checklist:** the items you actually tick off
- **Your notes:** free-text 4000-char notebook for this window
- **Governance actions:** Mark READY / Dismiss for this cycle / Override urgency / Hide forever
- **View history:** inline timeline of every change anyone on your team has made

### 4. Tick the checklist as you do the work

Each item has:
- A label (EN + Hinglish — toggle with the "Show Hinglish" pill)
- A `T-N` chip showing days-before-window-start when the item should be done
- An optional link to the related VAiyu module (Package Builder / Drips / Asset Manager / Local SEO Planner)

Tick → optimistic update, saved server-side, logged in the timeline with your name + timestamp.

### 5. Write owner notes as you go

The notes textarea auto-saves 700ms after you stop typing. You'll see "Saved" appear. If save fails (network glitch), an error appears in-card and you can try again.

### 6. When your team's done — manager marks READY

Once the checklist is fully ticked (or you're confident enough to declare ready even with some items N/A), a manager (owner / manager role) clicks **Mark READY**. The window's badge flips from urgency tone to a green READY badge. Marking READY does NOT block anything — it's an explicit "we've done our prep" signal that shows up on the dashboard counter and in the workspace.

### 7. After the season — let it auto-rollover

When the cycle ends naturally (the actual end-of-window date passes), the workspace automatically shows the NEXT cycle for that window. Your prior season's state (ticks, notes, dismissal, mark-ready) stays in the database keyed on the old season_year, and next year you start fresh.

---

## Governance — what each action does

| Action | Who | Effect |
|---|---|---|
| **Tick / untick checklist item** | Any team member | Adds/removes the key from `ticked_keys`; logs in timeline |
| **Edit owner notes** | Any team member | Auto-saves 700ms after typing stops |
| **Mark READY** | Manager+ | review_status = READY; records who + when; checklist completion % captured |
| **Return to planning** | Manager+ | READY → PLANNING; clears the "marked ready" stamp |
| **Dismiss for this cycle** | Manager+ | Hides the window for the current season only; reason required; auto-resurfaces next cycle |
| **Resume** | Manager+ | Reverses a dismiss within the same cycle |
| **Override urgency** | Manager+ | Forces NOW / PREPARE / WATCH / QUIET regardless of dates; reason required; dashboard reflects override |
| **Clear override** | Manager+ | Returns to computed urgency |
| **Hide forever** | Manager+ | Permanently hides this window for your hotel across all future cycles; reason required |
| **Unhide** | Manager+ | Reverses a permanent hide |

Every governance action is logged in the inline timeline with the actor's name, timestamp, and (where applicable) the reason.

---

## "Dismiss for this cycle" vs "Hide forever" — what's the difference?

| | Dismiss for this cycle | Hide forever |
|---|---|---|
| **Scope** | Just this year's cycle | Every cycle, indefinitely |
| **Example** | "We're under renovation this winter — skip Winter Snow this year" | "We never serve the pilgrim segment — hide all 3 Char Dham windows" |
| **Auto-reset?** | Yes — next cycle the window shows again as PLANNING | No — stays hidden until you unhide |
| **Where it appears** | Stays in workspace under "Dismissed" tab | Stays in workspace under "Permanently hidden" accordion (collapsed by default) |
| **Reason** | Required | Required when hiding |

---

## Region filtering — why some windows show "May not apply to your region"

The catalog tags each window with the Indian states where it's relevant:
- **PAN_INDIA** windows (long weekends, school holidays, Eid) show for everyone
- **UTTARAKHAND** windows (Char Dham, monsoon value) show with a "match" badge only for hotels with state = Uttarakhand
- **HILLS_NORTH_INDIA** (Summer Hill Escape, Autumn Shoulder, Winter Snow Stay) show for UK / HP / J&K hotels
- **DELHI_NCR_SOURCE** etc.

If your hotel's `state` field is set to something the catalog doesn't recognise, you'll still see all windows but the regional ones will be badged **"May not apply to your region"**. Fix: update your hotel's state in **Settings** so the system knows where you are.

If your hotel's `state` field is empty/null, the system **fail-opens** — you see every window, no "may not apply" badge. Recommended: set your state so the badging is accurate.

---

## What the dashboard card tells you

- **Next focus:** the most urgent window (NOW → PREPARE → WATCH → QUIET, ties broken by days-to-start). Shows name, days until, urgency, and prep-done count.
- **Now / Prepare / Watch** counters: how many windows fall into each band right now (excludes dismissed + permanently hidden)
- **N marked READY by manager:** when at least one window has been signed off

The card is read-only — click to open the workspace for any action.

---

## Connected module links

Some checklist items carry a soft link to another VAiyu module:
- **Verify yatra packages are live** → opens **Package Builder**
- **Refresh signboard photos** → opens **Asset Manager**
- **Run a follow-up drip** → opens **Follow-up Drip** (when wired)
- **Plan a local landing page** → opens **Local SEO Planner**

The link opens in the same tab. We don't auto-fill anything in the destination — you complete the action yourself. This keeps the planner honest: it nudges, it doesn't act.

---

## What this calendar will and won't do

**Will:**
- Surface the next high-impact planning window with enough lead time to actually prepare
- Walk you through a curated, hospitality-specific prep checklist (Uttarakhand-anchored, expanding)
- Keep an audit trail of who did what when, including dismissals + overrides + sign-offs
- Help multi-staff hotels coordinate (real-time updates — staff A ticks, staff B sees it immediately)

**Won't:**
- Forecast your bookings, occupancy, revenue, or demand
- Send any email, WhatsApp, SMS, or notification on your behalf
- Modify your pricing, packages, or microsite
- Scrape Google, OTAs, or any external source
- Generate AI text or suggestions

> *Seasonal Demand Calendar is a planning guide based on common regional travel patterns. It does not guarantee bookings, occupancy, revenue, Google ranking, OTA reduction, or business growth.*
>
> *Yeh calendar prediction nahi hai. Yeh Uttarakhand aur baaki regions ke common travel seasons ke hisaab se planning aur preparation reminder hai. Bookings, occupancy, revenue, ya Google ranking ki koi guarantee nahi.*

---

## Quick reference — common scenarios

| You want to | Do this |
|---|---|
| See what's next on the horizon | Open dashboard → read the **Seasonal Demand Calendar** card's "Next focus" line |
| Walk through this week's prep | Open workspace → look at "Next 3 to focus on" → click into each → tick checklist |
| Leave a note on a window for your team | Type into the **Your notes** field → it auto-saves |
| Mark a window as fully prepped | Manager+ clicks **Mark READY** |
| Un-mark a window from READY | Manager+ clicks **Return to planning** |
| Tell the system "we're skipping this year" | Manager+ clicks **Dismiss for this cycle** → enter reason |
| Tell the system "we never serve this segment" | Manager+ clicks **Hide forever** → enter reason |
| Force an urgency band different from the date math | Manager+ clicks **Override urgency** → pick band + reason |
| See who changed what on a window | Click **View history** inside the window card |
| Switch UI to Hinglish | Top-right pill: **Show Hinglish** |

---

## Common questions

**Q: Why doesn't Char Dham show NOW even though doors are open today?**
A: Check if the window has been Dismissed for this cycle (manager action), Permanently hidden, or had its urgency Overridden (forced to QUIET). Open the workspace and find the window — the badges + governance actions will tell you why.

**Q: I'm in Karnataka — why do I see Char Dham windows at all?**
A: You see every window so you can decide for yourself. UK-targeted windows show a "May not apply to your region" badge for you. If you genuinely don't serve pilgrim guests, use **Hide forever** with a one-line reason — they'll stop appearing in your dashboard counters.

**Q: Can I add my own custom planning window?**
A: Not in v0. Windows are system-defined and shared across hotels. If you have a strong case for a new window (e.g. "Onam in Kerala"), tell us and we'll add it via migration.

**Q: Can I edit the checklist items?**
A: No — checklist items are part of the catalog, same across all hotels. You can leave detailed context in **Your notes** for your team.

**Q: I made a typo in a dismiss reason — can I edit it?**
A: No — the reason is locked once submitted (it's part of the audit trail). You can **Resume** and then **Dismiss again** with a new reason; both events will appear in the timeline.

**Q: Why is my READY status gone after the cycle ended?**
A: That's by design — each cycle is independent. Last year's "READY" doesn't mean you're ready for next year. The new cycle starts in PLANNING.

**Q: My team ticked a checklist item by mistake. How do we untick?**
A: Click the checkbox again to untick. The untick is logged in the timeline too (CHECKLIST_UNTICKED event with the user's name).

**Q: Can I see Char Dham 2025's checklist progress now (in mid-2026)?**
A: The view only shows the current/next cycle. Prior years' state rows stay in the database but aren't surfaced in v0. If you need historical reporting, ask support.

---

## Privacy + compliance

- No guest data, payment data, or files are involved in this feature
- All your team's notes + governance actions stay within your hotel — strict multi-tenant isolation enforced at the database (RLS policies + RPC-level recheck)
- No external API calls; no AI; no data sent anywhere outside VAiyu
- Audit retention follows VAiyu's standard retention policy via the events table

---

## Need help?

The **Show Hinglish** toggle (top-right of the workspace) is there for any team member who's more comfortable in mixed Hindi-English. Every checklist label, every disclaimer, every confirmation has a Hinglish version.

For anything else, write to support@vaiyu.co.in with subject "Seasonal Calendar — <your hotel name>" and one of us will get back to you.
