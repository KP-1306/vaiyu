# Visibility Score — Owner Guide

## What is the Visibility Score?

A single 0–100 number that tells you how *ready* your property is to be found and trusted by direct guests. It looks at things you already do in VAiyu — your photos, your packages, your lead response speed, your reviews — plus a few Google Business basics you confirm yourself.

The score does **not** predict your Google ranking, your bookings, or your revenue. It tells you *what to fix next*, in order of impact.

> *"Yeh score sirf readiness dikhata hai. Google ranking, bookings, ya revenue ki koi guarantee nahi."*

---

## Where to find it

- **Dashboard hero card** (top-right of your dashboard) — current score + band + 7-day change
- **Quick-nav tile** on the dashboard ("📊 Visibility")
- **Full workspace** at *Visibility* (link from the hero card or quick-nav)

---

## How the score works

### Five categories
| Category | Max points |
|---|---|
| Google Business profile | 30 |
| Trust & reputation | 25 |
| Digital assets | 20 |
| Direct enquiry readiness | 15 |
| Local experience & packages | 10 |
| **Total** | **100** |

### Four bands
- **80–100 — Strong** (*"Bahut achhi tarah ready ho."*)
- **60–79 — Good, with gaps** (*"Theek hai, lekin kuch fix karne ke liye hai."*)
- **40–59 — Needs attention** (*"Kaafi cheezein adhuri hain."*)
- **0–39 — Critical gaps** (*"Pehle yeh basics fix karein."*)

### Onboarding state
If your property is brand-new and we don't have enough data yet (fewer than 5 signals evaluable), we show **Onboarding** instead of a number — you won't be penalised for things you haven't had a chance to do yet.

---

## How each signal is scored

Signals fall into two kinds:

### 1. Auto-derived signals (the system checks these for you)
Things like "phone number on file", "map pin set", "≥5 reviews in last 90 days", "at least one active package". Either pass or fail based on what's in VAiyu.

**Example:** "Address fields complete" passes when your property's address, city, state, country, and postal code are all filled in (Property settings).

### 2. Self-attested signals (you confirm these)
Things that happen *outside* VAiyu — like whether you've claimed your profile on Google Business. We can't see Google, so you tell us.

For these:
- **Not yet claimed** → 0 points
- **Self-attested by you** → 50% credit (amber tick)
- **Verified by manager** → 100% credit (green check)

A manager on your team can click *Verify* once they've confirmed the claim. Verification expires after **90 days** to keep it honest — you'll see the score drop back to 50% and a reminder to re-verify.

---

## The Google Business Checklist

A focused block above the full breakdown showing the 6 Google Business signals together. These are the highest-leverage items for visibility — knock them out first.

| # | Signal | Type | Max pts |
|---|---|---|---|
| 1 | Profile claimed on Google Business | Self-attested | 6 |
| 2 | GMB verification badge active | Self-attested | 6 |
| 3 | Correct GMB category set (Hotel / Resort / Homestay) | Self-attested | 4 |
| 4 | Address fields complete | Auto-derived | 5 |
| 5 | Map pin set (lat / long) | Auto-derived | 5 |
| 6 | Phone number on file | Auto-derived | 4 |

---

## How to use the workspace

1. **Open Visibility** from the dashboard.
2. **Read your band + delta** on the hero card. If the score dropped, the trend chart tooltip tells you what changed.
3. **Click any red item** to jump straight to the module that fixes it (e.g. *Open property settings*, *Open asset manager*, *Open Package Builder*).
4. For self-attested items: click *Self-attest*, optionally paste an evidence URL (only allowed domains accepted), and confirm.
5. If you're a manager: review your team's self-attestations and click *Verify* once you've confirmed them.
6. Click *Refresh* to take an on-demand snapshot. Auto-snapshot runs every Sunday at 03:00 IST.

---

## Evidence URLs

When you self-attest a Google-Business signal, you can paste a proof link. We validate the domain so screenshots-of-Google-from-some-blog don't pass:

- **GMB signals** — must be `business.google.com`, `g.page`, or `google.com/maps`
- **Off-platform review response** — must be Google, Booking.com, MakeMyTrip, Goibibo, TripAdvisor, Agoda, or Airbnb

If the URL doesn't match, the form shows *"Evidence URL must point to the official Google Business or supported review platform."* and the attestation isn't saved.

---

## Score history

The trend chart shows your last 12 snapshots (newest on the right). Hover any point to see the date + score + delta. Reference lines at 80 / 60 / 40 mark the band boundaries.

If the cron skipped a Sunday (rare, but possible), a yellow banner appears: *"The weekly snapshot hasn't run in over 9 days. Take a manual snapshot via Refresh."*

---

## What governance looks like

Every attestation change and every snapshot is logged. You can ask your platform admin for the audit trail of a specific signal — useful when verifying a team member's work or troubleshooting a sudden score drop.

**Manager re-verification rules:**
- Once a manager verifies a signal, only **that manager** or a **platform admin** can un-verify it
- Other managers see *"Only the manager who verified this can unverify it."*
- This prevents two managers from flip-flopping each other's work

---

## When manager verification expires

Manager verification stays valid for **90 days**. Two things happen as expiry approaches:

- **From day 76 onwards** (≤14 days left) the signal row shows an amber chip: *"Verification expires in N days."*
- **At day 90** an overnight job (`visibility_attestation_daily_degrade`, runs 08:00 IST) automatically demotes the row from MANAGER_VERIFIED back to SELF_ATTESTED. The score drops to 50% credit and an audit event (`visibility_attestation_auto_degraded`) is written.

The owner sees the change next time they open the workspace; the row's amber chip will say *"Verification has expired — re-verify to restore full credit."* A manager can click *Verify* again to restore full credit.

## If the owner replaces evidence

Clicking *Re-attest* on a row that's currently MANAGER_VERIFIED opens a confirmation dialog (*"Replace manager verification?"*) before wiping the manager seal. This prevents accidental loss of full credit. The owner must explicitly confirm; the manager then re-verifies the new evidence to restore 100%.

## Limits

- The score is **rate-limited**: owners can refresh once every 5 minutes per hotel; managers once every minute. This prevents accidental flooding of snapshot history.
- Online external GMB links open in a new tab — VAiyu does not call Google APIs.

---

## Glossary

| Term | What it means |
|---|---|
| **Signal** | One scored item (e.g. "Map pin set"). |
| **Auto-derived** | Scored automatically from VAiyu data — no action needed beyond filling in the underlying field. |
| **Self-attested** | You confirm it; scores 50% until manager-verified. |
| **Manager-verified** | A manager on your team has confirmed; scores 100%. Expires after 90 days. |
| **Band** | Strong / Good / Needs Attention / Critical — coarse status label. |
| **Pending data** | A signal that can't be scored yet (new hotel, no lead history, etc.). Excluded from the denominator — won't lower your score. |
| **Unlockable** | Points you'll be able to earn once data accumulates (e.g. once you have 5+ reviews). |
| **Snapshot** | A point-in-time record of your score. Auto-written every Sunday; on-demand via Refresh. |
| **Formula version** | We may rebalance weights over time. Every snapshot stores the version it was scored under, so old snapshots remain interpretable. |

---

## FAQ

**Q: Why isn't my Google rating in the score?**
We deliberately don't use the Google Places API. The score measures your *readiness to be found and trusted*, not after-the-fact metrics. Plus: Google API quotas + per-call cost would push complexity (and price) up without telling you anything more actionable.

**Q: I just self-attested and only got half credit. Why?**
That's by design. Manager verification doubles the credit — ask the manager on your team to click *Verify* once they've confirmed.

**Q: My hotel just opened. Why is the score lower than I expected?**
For brand-new hotels, signals that need history (≥5 reviews, ≥5 leads with response time) are *excluded* — you'll see "Pending data" badges. The score is normalised to what's evaluable, so you can still hit 100/100 by completing the basics.

**Q: I changed our property logo. The score went up — did I do something special?**
The *brand_basics* signal (5 pts) checks for logo + brand colour together. Adding the logo flipped it from fail → pass.

**Q: How often does the score update?**
The hero card and workspace pull live data every time you load the page. The *snapshot history* updates weekly (Sunday 03:00 IST) plus any manual refreshes you trigger.
