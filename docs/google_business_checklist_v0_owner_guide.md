# Google Business Checklist — Owner Guide

A readiness checklist embedded inside Visibility Score that tracks 30 items
across 7 categories of Google Business Profile readiness. It feeds the
Visibility Score's `Trust & reputation` category — but the checklist itself
is the workbook you'll actually edit.

> **Yeh tool sirf readiness dikhata hai. Google ranking ya booking ki koi guarantee nahi hai.**
> VAiyu doesn't connect to Google or any API. This is your private workbook for tracking what's done on your Google Business Profile.

---

## Where to find it

`/owner/:slug/visibility` — same page as your Visibility Score hero. The GBP
Checklist is a section below the score ring with 7 collapsible categories.

---

## What the 7 categories cover

### 1. Business Profile (4 items)
Claimed → Verified → Primary category → Secondary categories.
> Most owners stop after Verified. Add secondary categories like Restaurant, Spa, Wedding Venue where applicable — improves discoverability.

### 2. Location Accuracy (4 items)
Address complete, address matches your invoices/signboard, map pin at the actual entrance, service-area zone (if applicable).
> Mismatched address between GBP and your invoice/signboard is the #1 cause of verification rejection. Audit both.

### 3. Contact Readiness (4 items)
Phone, WhatsApp visible on GBP, website link on GBP, direct enquiry path (form or "Send message" CTA).
> Visible WhatsApp on GBP is the single biggest driver of direct enquiries in India. Don't skip.

### 4. Content Readiness (6 items)
Business description (≥30 chars, auto-detected from your settings) + 5 photo categories on GBP: exterior, room, bathroom, dining, common area.
> Exterior + room photos minimum. Bathroom photo signals cleanliness — guests check.

### 5. Trust Signals (5 items)
Review link, documented review-collection process, review response discipline (linked to Visibility), policies visible on GBP, amenities (≥3, auto-detected).
> "Documented review process" means you have a check-out script or follow-up message asking for reviews. Hope is not a strategy.

### 6. Experience Readiness (3 items)
At least one experience package live, local attractions listed (in GBP posts or website), seasonal experiences documented in Seasonal Calendar.
> Packages give guests a concrete reason to book direct vs OTA.

### 7. Verification Readiness (4 items)
Signboard photo, business proof (GST/Shop Act), branded invoice template, letterhead.
> These are required for Google's verification flows. Have them ready as PDFs/images in your Asset Manager.

---

## Three kinds of items

You'll see three different row styles depending on the item kind:

### Linked to Visibility Score (9 items)
The 9 items that overlap with Visibility Score's existing GMB signals show
the same status here as on the Visibility breakdown. Attest once — state
flows to both surfaces.

These are: profile_claimed, profile_verified, primary_category_set,
address_complete, map_pin_accurate, phone_present, review_link_available,
review_response_discipline, packages_available.

### Self-attested (19 items)
Owner clicks "Self-attest" → optionally adds an evidence URL → state changes
to amber "Self-attested". Manager (you, or another hotel manager) can then
click "Verify" → state goes emerald "Verified" with a 90-day expiry.

After 90 days verification expires — re-verify to restore full credit. You
get an in-row warning 14 days before expiry.

### Auto-derived (2 items)
- `description_present` — auto-pass if your property description is ≥30 chars in settings
- `amenities_visible_on_gbp` — auto-pass if you have ≥3 amenities listed in settings

These are read-only — no buttons. Edit the underlying fields in settings to change the status.

---

## Status meanings

| Badge | Meaning |
|---|---|
| **Verified** (emerald) | Owner attested + manager verified, within 90 days |
| **Self-attested** (amber) | Owner attested, not yet manager-verified |
| **Verification expired** (amber + warning) | Was verified >90 days ago — re-verify |
| **Not yet claimed** (slate) | Item not attested at all |
| **Pass** (emerald) | AUTO_DERIVED rule satisfied |
| **Fail** (rose) | AUTO_DERIVED rule not satisfied |

---

## Manager verification rules

- Only members with **manager** or **owner** role can verify
- Manager who verified is the only one who can unverify (or a platform admin)
- Unverify requires a written reason (audit trail)
- Re-attestation by the owner clears prior manager verification automatically — the manager has to re-verify the new state

This prevents the failure mode where staff attest, manager verifies, owner re-attests something different, and the manager-verify badge stays incorrectly active.

---

## How this feeds your Visibility Score

When **≥70% of 30 items** are satisfied (21 or more), the Visibility Score's
`gbp_checklist_ready` signal flips to "satisfied" and adds **4 points** to
your overall score. Below the threshold, the signal is 0 points.

The 9 LINKED items also continue to feed Visibility Score independently
through their own `GMB_READINESS` and `TRUST_REPUTATION` weights.

---

## Common questions

**Q: Does this actually change anything on Google?**
No. Nothing. VAiyu doesn't connect to Google. This is your private workbook
for tracking what you've already done (or need to do) on your GBP. After
ticking an item here, you still need to go to Google Business and verify the
real state.

**Q: Why are 9 items "linked" instead of just being normal items?**
Those 9 already exist as signals in Visibility Score (gmb_claimed etc.).
Duplicating them would mean owners attest the same thing twice. The linked
design uses one source of truth — Visibility attestations — and surfaces it
in both places.

**Q: How often should I review?**
Quarterly works. The 90-day verification expiry nudges you when the badge
falls off. Items expire to "Self-attested" automatically — re-verify to
restore full credit.

**Q: Can I delete an attestation?**
Yes — click "Unclaim" to revert to UNCLAIMED. This wipes any manager
verification too.

**Q: Why is `description_present` read-only?**
It's auto-detected from your property description in settings. Edit there;
this row updates automatically.

**Q: My business doesn't have a service area — should I attest service_area_accurate?**
The spec includes this even for hotels that don't pick up/drop guests. If
you don't have a service area, leave it as UNCLAIMED. It costs you marginal
score but the description tells you to skip if not applicable.

**Q: What if Google rejects verification despite all items showing Verified?**
This tool tracks readiness, not Google's actual decision. Verification
rejections usually come from address mismatch, signboard mismatch, or
business proof issues. Make sure those items are genuinely verified (not just
attested).

---

## Disclaimer (verbatim)

**English:** VAiyu Google Business Checklist is an internal readiness tool.
It does not guarantee Google ranking, bookings, revenue, occupancy, or
verification approval.

**Hinglish:** Yeh tool sirf readiness dikhata hai. Google ranking ya booking
ki koi guarantee nahi hai.
