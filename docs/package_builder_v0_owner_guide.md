# Experience Packages — Hotel Owner Guide

**Version:** Package Builder v0
**Released:** 27 May 2026
**Where to find it:**
- **Experience Packages** card on the owner dashboard
- Workspace at `/owner/<your-slug>/packages`
- Inside any lead's detail drawer (the **Suggested packages** panel)
- Inside the AI Quote Drafts page (the **Choose a package** dropdown)

---

## What is it?

**Aaj agar guest ne pucha "honeymoon ke liye kya special hai?" — to ek ready-made page ka link bhej do WhatsApp pe.**

Package Builder lets you publish curated "experience packages" — Weekend Escape, Honeymoon, Char Dham Yatra, Family Stay, Adventure Trekking, Workation — each on its own clean landing page. Staff shares the link, the guest sees curated meals + activities + transfers + a starting price, and one tap takes them into your enquiry form with the package already attached.

**It is NOT** a booking engine. Final rate aur availability staff hi confirm karenge — every public page carries that line clearly.

---

## What you can do with it

| Surface | What you do |
|---|---|
| **Dashboard card** | See active count, draft count, 7-day public views. Amber banner if anything is awaiting your approval. |
| **Workspace** | Build, edit, submit, approve, publish, pause, duplicate, archive packages. Filter by status / category / search. |
| **Public landing page** | A clean white marketing page at `/p/<your-slug>/package/<package-slug>`. Share via WhatsApp or link from your hotel website. |
| **Lead drawer** | When you open any lead, you'll see up to 3 best-fit packages right inside the drawer. One tap → URL copied → paste into WhatsApp. |
| **Quote Drafts** | Your real published packages appear in the package picker. No more "sample templates" once you've built one. |

---

## The two-stage governance — why approval matters

A package goes through two parallel axes:

### Lifecycle (`status`)
- **Draft** — you're still writing it; only you (and other owners/managers) can see it
- **Ready** — you're done; submitted for review
- **Active** — published; the public landing page is live
- **Paused** — was active but you stopped it temporarily (peak season ended, sold out)
- **Archived** — no longer being used; slug freed up for re-use

### Approval (`owner_approval_status`)
- **Awaiting review** — submitted, not yet approved
- **Approved** — owner/manager has signed off
- **Changes requested** — sent back with a note explaining what to fix

**Critical rule:** a package can only be **Active** if it is **Approved**. The database enforces this — even if a bug tried to skip approval, the page can't go live.

**Equally critical rule:** if you edit a package that's already approved, its approval automatically resets to **Awaiting review**. This is a 4-eyes guardrail — you cannot approve your own edit by accident.

---

## Step-by-step: building your first package

### 1. From the dashboard → "Experience Packages" card → "New package"

### 2. Fill in the marketing side
- **Name** — "Honeymoon Escape — 3 nights" (this shows in WhatsApp previews)
- **Slug** — auto-fills from name; you can override. URL-safe lowercase only.
- **Category** — pick one of 8 (Weekend Escape, Adventure & Trekking, Religious / Spiritual, Wellness & Yoga, Workation / Monsoon, Family Stay, Couple Retreat, Custom)
- **Ideal for** — short text ("Honeymooners, anniversary couples"). Surfaces in the suggest panel and on the page.
- **Hero image URL** — optional. Use a Cloudinary / S3 / public URL. The page renders 16:9.
- **Short pitch** — one-liner shown at the top of the public page
- **Long description** — the body copy

### 3. Define the stay shape
- **Duration** — nights (1–30)
- **Party size** — min and optional max adults
- **Linked room type** — optional; for future inventory hooks

### 4. Seasonality
- **Months active** — tick the months this package runs (or All = year-round)
- **Validity window** — optional date range (e.g. "Only valid through 30 Sep 2026")

### 5. Inclusions (4 grouped categories)
- **Meals & dining** — "Breakfast", "Candlelight dinner"
- **Activities** — "Local sightseeing (half day)"
- **Transfers** — "Airport pickup", "Pickup from Haridwar railway station"
- **Extras** — "Welcome drink", "Spa credit"

Type and press Enter to add. Click an existing chip to remove. Suggestions appear as you type.

### 6. Pricing — both numeric and text
- **Numeric base price** (optional) — used for future AI / quote math
- **Basis** — per room per night / per person per night / per package total
- **Display text** — what guests actually see ("Starting ₹8,500 per couple per night"). Use the **"Use this suggestion"** button to auto-generate from the numeric inputs, then edit freely.

### 7. CTA + internal notes
- **Enquiry CTA label** — defaults to "Enquire now". Override if you want ("Book this trip", "Check availability").
- **Internal notes** — only visible to your team. Use for things like "Manager: review pricing if monsoon advance bookings drop".

### 8. Save → Submit for approval → Approve → Publish

The action bar at the top of the builder shows what's available at each state:

| State | Visible actions |
|---|---|
| **Draft** | Save · Submit for approval · Delete |
| **Ready, Awaiting review** | Save (re-bumps to review) · Approve · Request changes |
| **Approved (Ready)** | Publish · Edit (sends back to review) |
| **Active** | Pause · Duplicate (read-only — **to change a live package you must Pause it first**) |
| **Paused** | Resume · Edit · Submit for approval · Archive |
| **Archived** | Duplicate (only — the original cannot be reactivated) |

> **Why you can't edit a live package directly:** an Active page is being shown to real guests. The system blocks edits on Active packages (you'll see "not editable") to prevent a half-finished change going live. **Pause → edit → re-submit → re-approve → resume/publish.** While paused, the public page goes offline (guests see "package not available"), so do your edits quickly or duplicate-then-swap if you need zero downtime.

---

## What guests see (the public page)

`/p/<your-slug>/package/<package-slug>` is a light-themed page with:
- Hero image + category chip + duration + season label
- Short pitch + long description
- Inclusions grid (Meals / Activities / Transfers / Extras)
- Stay details (duration, party size, validity window)
- Pricing card with the starting-price text + confirmation note
- **Enquire now** button — opens your existing public enquiry form with the package pre-attached

**Always-on disclaimer** at the bottom: "Package prices and details are promotional guidelines only. Final availability and rates must be manually confirmed by property staff before sharing with guests."

---

## How this integrates with the rest of VAiyu

### Lead CRM — "Suggested packages" panel
When you open any lead's drawer, you'll see up to 3 best-fit packages, scored on:
- **Party size match** — package's min/max adults vs lead's party_adults
- **Season match** — does the lead's check-in month fall within the package's active months?
- **Family signal** — has children in party → favours Family Stay
- **Couple signal** — 2 adults, 0 kids, 1 room → favours Couple Retreat
- **Category keyword hints** — picks up "honeymoon", "trek", "yatra", "yoga", "workation" from the lead's `source_detail` or tags

For each suggested package:
- **Copy URL** button → public landing URL copied to clipboard, ready to paste into WhatsApp
- **Open** button → opens the page in a new tab (with preview flag, so the view isn't counted in analytics)

### Quote Drafts — real packages in the picker
The package picker on `/owner/<slug>/quote-drafts` now loads your published packages first. The dropdown label switches from "Sample templates" to "Your packages" the moment you publish anything. The deterministic template and the AI generator both use the real inclusions + duration + pricing.

### Public lead-capture with `?package=` attribution
When the guest taps **Enquire now** from a package page, they land on the public lead form with:
- An emerald chip: "About: Honeymoon Escape — 3 nights"
- Notes pre-filled: 'Asked about "Honeymoon Escape — 3 nights".'
- `source_detail = "Package: Honeymoon Escape — 3 nights"` on the resulting lead — operators see this immediately in Lead CRM

### Analytics — 7-day public views
The dashboard card shows views from the last 7 days. Workspace cards show per-package view counts. View tracking is privacy-respecting:
- Raw IP addresses are **never** stored — sha256 hash with a daily-rotating salt
- 1/minute rate-limit per IP+package — accidental refresh doesn't inflate counts
- Bot views are classified separately (you can still see them, but they don't pad your real numbers)

---

## Editing rules (the bits that catch people out)

| What you tried to do | What happens |
|---|---|
| Edit an Active+Approved package | **Blocked** — "not editable". Pause it first, then edit. (Pausing takes the public page offline until you resume.) |
| Edit a Ready+Approved package (not yet published) | Allowed — auto-resets to **Awaiting review** so it must be re-approved before publishing. |
| Make a package Active without approving | Blocked at the DB level — can never happen. |
| Re-use an archived slug | Allowed. The unique index ignores archived rows. |
| Re-use a non-archived slug | Blocked — error "SLUG_TAKEN". Pick a different one or archive the conflict first. |
| Publish a Draft without going through Ready | Blocked — error "INVALID_TRANSITION". Submit for approval first. |
| Approve your own edit | Allowed for now (no separate-author check) but discouraged — pair-review with another manager. |
| Delete a package | Soft-delete only. Restorable from the DB if needed. |

---

## When NOT to use packages

- **Bespoke quotes for a single VIP** — use Quote Drafts directly with a custom-proposal (no package). Packages are for the "we can pitch this to anyone matching this profile" archetype.
- **One-off pricing experiments** — packages are durable. Use Pricing Rules + Rate Plans for short-term price discovery.
- **As a substitute for inventory management** — the package's "linked room type" field is currently advisory. Allocation + blocks still live in Pricing → Rate Calendar.

---

## What's coming next (deliberately NOT in v0)

These are tracked, not deferred. They will ship only if a paying hotel explicitly needs them:

- **Public listing page** (`/p/<hotel>/packages`) — single-package URLs are intentional for SEO + conversion clarity
- **A/B testing per package** — out of scope; we measure on view counts only
- **Package versioning / changelogs** — events table captures who edited what when; no UI to diff yet
- **Automatic discount stacking on linked room types** — pricing is display-only; final rate is operator-confirmed

---

## Quick reference — sharing a package via WhatsApp

1. Open a lead's drawer in Lead CRM
2. In the "Suggested packages" panel, find the right one
3. Tap **Copy URL**
4. Paste into WhatsApp
5. Send 🎉

That's the whole flow. The guest taps the link, sees the page, taps Enquire — you get a new lead with full attribution back to that package, ready to convert.

---

## Need help?

- Stuck on approval flow → ping Ajit
- Missing a category you want → comment on the next product review; we're keeping the list short on purpose
- Want a custom landing page layout → out of scope for v0; one template fits all hotels for now
