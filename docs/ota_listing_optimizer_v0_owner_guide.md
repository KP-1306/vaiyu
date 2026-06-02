# OTA Listing Optimizer — Owner Guide

A self-audit workbook that helps you see what's missing across MakeMyTrip,
Goibibo, Booking.com, Agoda, Airbnb, Expedia, Yatra, and TripAdvisor.

> **Yeh tool sirf readiness dikhata hai. OTA ranking ya booking ki koi guarantee nahi hai.**
> VAiyu doesn't connect to any OTA. We don't change your listings, sync inventory, or
> guarantee rankings. This is a private workbook for you to track what's done and what's pending.

---

## Why this exists

OTAs don't have public APIs for hotel listings. You can't automate them. What
you CAN do is keep a clean, deterministic checklist of what's done on each
platform, so:
- Nothing gets missed during onboarding
- New staff onboarded next quarter know exactly what to verify
- You compare across OTAs in one place instead of logging into 8 extranets

Most owners we've spoken to manage 3–5 OTAs actively. This workbook handles
all 8 — toggle off the ones you don't list on.

---

## How to start (15 minutes)

### Step 1 — Open the workbook
From the dashboard → **OTA Listing Optimizer** card → click to open. Or visit
`/owner/your-hotel/ota` directly.

### Step 2 — Confirm active OTAs
The wizard asks which OTAs you list on. Defaults to all 8. Toggle off any you
don't use. You can change this later in **Workbook settings**.

### Step 3 — Confirm mountain disclosures
If your property is in Uttarakhand, Himachal, J&K, Ladakh, Sikkim, or Arunachal,
the wizard auto-enables 13 mountain-specific checks (parking, steep road, snow
access, heating, hot water, etc.).

You can override:
- **Auto** — use state-based default
- **Show** — force mountain checks ON (e.g., a Tamil Nadu hotel in Ooty)
- **Hide** — force mountain checks OFF (e.g., a plains hotel that markets
  itself for mountain trips)

### Step 4 — Quick first-pass (optional)
The wizard shows the most important items (LISTING_QUALITY + PHOTOS_MEDIA) for
each active OTA. Mark whatever you can in a few minutes — leave the rest for
later.

### Step 5 — Done
The wizard stamps completion. You can re-run it anytime from the workspace
("Re-run setup" button top right).

---

## The matrix view

After the wizard, the workspace shows:

| | MMT | Booking | Airbnb | … |
|---|---|---|---|---|
| Listing Quality | 3/4 | 1/4 | 2/4 | … |
| Photos & Media | 5/7 | 3/7 | 7/7 | … |
| Room Naming | 2/3 | 3/3 | — (N/A) | … |
| Mountain disclosures | 8/13 | 6/13 | 9/13 | … |

- **X/Y format**: X complete items / Y applicable items
- **Cell colour**: green = ≥80% complete, amber = 50–80%, red = <50%
- **Locked cell (🔒)**: item doesn't apply to that OTA (e.g., Room Naming on Airbnb)

**Click any cell** → opens an edit drawer with all items in that category for that OTA.

---

## Setting status

For each item, choose one of:

| Status | Meaning | Counts toward score |
|---|---|---|
| **Complete** | Fully done on this OTA | 100% of item weight |
| **Partial** | Some progress but not finished | 50% of weight |
| **Missing** | Not yet done | 0% |
| **Not reviewed** | Haven't checked yet | 0% (same as Missing) |
| **N/A** | Genuinely doesn't apply | Excluded from score |

> Use **N/A** sparingly. It's for cases like "we don't have pets policy because pets are not allowed in our area at all" — not a way to skip items.

Every status change includes a stamp of `reviewed_at`. If you don't update for
90 days, you'll see a **Stale** badge. After 120 days, the item reverts to
"Not reviewed" for scoring (UI shows it as expired).

**"I just reviewed [OTA] — refresh freshness"** button: refreshes timestamps
without changing statuses, for when you've audited an OTA and confirmed
everything is still correct.

---

## Scoring

Each OTA gets a score 0–100 based on:
- Complete items contribute their full weight
- Partial items contribute half
- N/A items are excluded from the denominator
- Missing/Not reviewed items contribute zero (but stay in denominator)

**Bands:**
- **Premium** (≥80) — solid listing
- **Moderate** (50–80) — most basics done
- **Critical** (<50) — significant gaps

Overall hotel score = average across active OTAs.

---

## The 11 categories

### 1. Listing Quality
Title, description, uniqueness, consistency across OTAs.
> Strong titles include property type + location + a hook (e.g. "Family resort with snow view, Mussoorie").

### 2. Photos & Media
Exterior (3+), room (2+ per type), bathroom, dining, common areas, parking, attractions.
> Parking visible in photos = top guest question answered visually.

### 3. Room Naming
Naming consistency, differentiation, occupancy clarity.
> Don't list "Deluxe" and "Deluxe Plus" without saying what's different.
> (Naming items don't apply to Airbnb single-unit listings.)

### 4. Amenities & Facilities
Complete amenity ticks, facility clarity, service visibility.
> List paid vs free services upfront — hidden charges drive negative reviews.

### 5. Policies
Cancellation, child, pet, check-in, check-out.
> Indian families always ask about child policy. Spell it out.

### 6. Review Discipline
Active collection process, response cadence, professional negative-review handling.
> Respond to every review in 48 hours. Unanswered reviews signal "doesn't care".

### 7. Payment & Booking Clarity
Payment methods, booking confirmation, refund policy.
> (Doesn't apply to TripAdvisor — they're a review platform with redirect bookings.)

### 8. Seasonal Positioning
Summer, winter, monsoon, festival positioning.
> Festival packages get more searches in the 2–3 weeks before. Time them with Seasonal Calendar.

### 9. Trust Signals
OTA verification badge, brand assets, GST/business proof.
> Verified badges drive trust. Booking.com, Airbnb both verify hosts.

### 10. Direct Booking Readiness
Website, microsite, WhatsApp visibility, enquiry contact.
> Indian guests prefer WhatsApp. Visible number on listings = more direct enquiries.

### 11. Mountain Disclosure (mountain hotels only)
- Parking visibility
- Road approach (paved/unpaved)
- Steep road / difficult drive
- Monsoon access
- Winter/snow access
- Heating
- Hot water (24h vs fixed-hours)
- WiFi quality (honestly stated)
- Power backup
- Workation features
- Driver stay availability
- Pet policy (mountain trips often include pets)
- Early check-in clarity

> **Why these matter**: Mountain road-tripping guests check these obsessively
> before booking. Honest disclosure beats over-promising and getting bad reviews.

---

## Connection to Visibility Score

OTA Listing Optimizer feeds the **Visibility Score** module via a single signal
called `ota_listing_ready`. When your overall OTA readiness is ≥ 50 (Moderate or
Premium band), this signal goes green and adds 4 points to your Visibility
Score's TRUST_REPUTATION category.

**Direction is one-way**: OTA Optimizer → Visibility Score. Not the reverse.

---

## Common questions

**Q: Does this actually change anything on MMT/Booking/etc?**
No. Nothing. VAiyu doesn't connect to any OTA. This is your private workbook.
After marking an item Complete here, you still need to go to that OTA's
extranet and verify/edit there. The fix-action links in this tool deep-link to
the relevant VAiyu module (Asset Manager, SEO Planner, etc.) — they don't open
OTA extranets.

**Q: Why no OTA API integration?**
Most OTAs (MMT, Goibibo, Agoda, Airbnb, Yatra) have no public hotel-listing
API. Booking.com has a partial Connectivity API gated behind partnership tiers
that small hotels cannot access. We refuse to misrepresent what's possible.

**Q: Will this guarantee me more bookings or better rankings?**
No. OTAs don't share ranking formulas. We make zero booking/revenue/ranking
guarantees. What we do guarantee: nothing gets quietly forgotten as your team
turns over.

**Q: How often should I review?**
Quarterly works for most hotels. The 90d staleness badge nudges you. After
120 days, items expire (treated as Not Reviewed for scoring).

**Q: My hotel is in Tamil Nadu (Ooty) — how do I get mountain checks?**
Use **Workbook settings → Mountain property disclosures → Show**. State-derived
default doesn't cover Tamil Nadu's hill stations.

**Q: Can I import statuses from elsewhere?**
No bulk import in v0. The wizard's quick first-pass lets you set many statuses
at once, but each owner reviews their own platforms.

**Q: Can I delete history?**
Yes. **Reset MMT** (or any single OTA) wipes state for that OTA only. **Reset
all** wipes everything for this hotel. Both are auditable — entry stays in
`va_audit_logs`.

**Q: What if I have many properties?**
Each hotel has its own workbook. Multi-property owners use the Visibility Score
portfolio view to see overall readiness across properties.

---

## Disclaimers (verbatim)

**English:** OTA Listing Optimizer is an internal readiness tool. It does not
connect to OTA platforms, change listings, sync inventory, guarantee rankings,
bookings, revenue, or occupancy.

**Hinglish:** Yeh tool sirf readiness dikhata hai. OTA ranking ya booking ki
koi guarantee nahi hai. VAiyu se koi OTA pe seedha kuch nahi badalta — sirf
checklist hai.

---

## Need help?

If anything looks wrong (a cell that should be applicable shows as locked, or a
mountain check is missing for your property), reach out to the VAiyu team. The
catalog is deterministic — there's no AI guessing — so any oddity is either a
config issue or a bug worth reporting.
