# Follow-up Operations — Hotel Owner Guide

**Version:** Radar v1.1 + Drip Engine v1.2 (auto-send + bounce/reply auto-pause)
**Released:** 27 May 2026
**Where to find it:**
- **Action Radar** card + **Follow-up emails** card on the owner dashboard
- **Radar** tile (📡) and **Drips** tile (✉️) in the quick-link grid
- Inside any lead's detail drawer (the Drip panel shows per-lead state)

---

## What is it?

**Aaj kaunse follow-up karne hain, aur kaunse apne aap ja chuke hain — dono ek hi jagah pe.**

Two surfaces, one purpose: making sure no guest enquiry slips through the cracks.

| Surface | What it does | When to use it |
|---|---|---|
| **Follow-up Radar** | A daily action checklist. Tells you what needs your hands today — replies to handle, blocked guests to unblock, manual nudges to send. | Morning huddle. End of shift. Anytime you ask "what's pending?" |
| **Lead Drip Engine** | Automated email sequences VAiyu sends on a schedule. Handles the routine "Day 1 / Day 3 / Day 7" follow-ups so your team doesn't have to. | Always running in background. Open the editor only when you want to change the email copy. |

**Together:** the Drip Engine fires the standard nudges automatically; the Radar shows you the exceptions — replies, blocks, anything that needs a human. Your daily Radar list is short because the routine work is already happening.

---

## What's new since the last version

**Drip Engine v1 + 1.1 + 1.2 (new this release):**
- VAiyu now **actually sends** the follow-up emails to guests on a schedule. Three sequences are pre-loaded per hotel (New enquiry / Post-quote nudge / Walk-in win-back).
- Drips **auto-pause** when a guest engages — bounces, marks as spam, replies on WhatsApp, or when you move the lead to Qualified / Won / Booked.
- A **Drip panel** appears inside every lead's detail drawer with Pause / Resume / Cancel buttons.
- A **Follow-up emails** dashboard card shows Active / Due-24h / Sent-today / Paused counters.
- **Edit the email copy** at `/owner/<slug>/drip` — change subject, body, delay, or disable any step. Every edit is audited.

**Radar v1.1 (carried forward from earlier release):**
- No more sample data. Empty workspaces show a clean "No follow-ups yet" message.
- Full row menu (3-dot) — Dismiss / Block (with reason) / Unblock / Reopen.
- Failed auto-create won't break Lead CRM — fail-soft trigger.

---

## What you'll see on the dashboard

Two cards, side by side:

### 1. Action Radar card (manual)

| Number | Means |
|---|---|
| **Due today** | Follow-ups due by end of today |
| **Overdue** | You missed the window — chase as soon as possible |
| **Blocked** | A guest has an open complaint or service issue — fix that first |

Red warning strip if any **critical** items appear.

### 2. Follow-up emails card (auto)

| Number | Means |
|---|---|
| **Active** | Drip sequences currently sending |
| **Due 24h** | Sequences with a step scheduled in the next 24 hours |
| **Sent today** | Drip emails actually delivered today |
| **Paused** | Sequences temporarily stopped (includes "no email on file") |

Amber line under the counters if any leads are stuck on "no email on file."

Plus two quick-link tiles in the grid: **Radar** (📡) and **Drips** (✉️).

---

## How follow-ups + drips are created

### Automatic (most of your work)

| Lead event | Radar effect | Drip effect |
|---|---|---|
| **New lead arrives** (any source except walk-in) | Creates DIRECT_ENQUIRY follow-up, due tomorrow, priority High | Subscribes to **New enquiry follow-up** drip sequence (Day 0 / 1 / 3 / 7) |
| **New walk-in lead** | Same Radar row | (No drip yet — walk-ins follow a different path) |
| **You mark lead as Quoted** | Creates QUOTE_SENT follow-up, due in 2 days, priority Medium | Pauses the new-enquiry drip with "Quote sent — new sequence took over" + subscribes to **Post-quote nudge** drip (Day 2 / 5 / 14) |
| **You mark lead as Qualified** | (No auto-action) | Pauses all active drips with reason "Lead qualified — operator engaged" |
| **You mark lead as Won** | (No auto-action) | Pauses all active drips with reason "Lead won" |
| **Lead converts to a booking** | Auto-addresses every open Radar row with "Auto-resolved: lead converted to booking" | Pauses all active drips with reason "Booked" |
| **Lead marked LOST** | Auto-dismisses every open Radar row | Cancels all active drips; if source = walk-in, subscribes to **Walk-in win-back** drip (Day 0 / 30) |
| **Guest replies on WhatsApp** (matching the lead's phone) | (No auto-action — you respond manually) | Pauses active drips with reason "Guest replied on WhatsApp" |
| **Drip email bounces or guest marks as spam** | (No auto-action) | Pauses that drip with reason "Email bounced (permanent/temporary)" or "Guest marked as spam" |

### Manual (for everything else)

- **+ Add follow-up** in the Radar workspace — for things the system doesn't auto-detect (e.g. "Reply to that 2-star Google review", "Send review link to Mrs Verma")
- **Manual Pause / Resume / Cancel** in the lead's Drip panel — for things you want to override

The system never creates a Radar row or a drip out of nowhere — every auto-action is tied to a real lead.

---

## The three stock drip sequences

### 1. New enquiry follow-up (`GENERAL_ENQUIRY`)

| Day | What goes out |
|---|---|
| Day 0 (immediate) | Welcome — "Thanks for reaching out, we're putting together a response" |
| Day 1 | Soft offer — "As a welcome gesture, complimentary breakfast or upgrade if you confirm this week" |
| Day 3 | Reminder — "Just checking in, happy to call you instead" |
| Day 7 | Last touch — "We won't crowd your inbox; door always open" |

Triggered when: a new lead arrives from any source **except** walk-in.

### 2. Post-quote nudge (`QUOTE_SENT`)

| Day | What goes out |
|---|---|
| Day 2 | "Following up on your quote — happy to revise dates or call" |
| Day 5 | "Should we keep the rooms held?" |
| Day 14 | "Closing this enquiry — door always open" |

Triggered when: a lead's status changes to QUOTED.

### 3. Walk-in win-back (`WALKIN_LOST`)

| Day | What goes out |
|---|---|
| Day 0 (immediate) | "Thank you for visiting — sorry we couldn't fit you in today" |
| Day 30 | "It's been a few weeks — share your next planned dates" |

Triggered when: a walk-in lead is marked LOST.

---

## When drips pause (and what you'll see in the Drip panel)

| Pause reason | When it fires | What the panel shows |
|---|---|---|
| `LEAD_QUALIFIED` | You mark the lead as Qualified | "Paused — Lead qualified — operator engaged" |
| `LEAD_WON` | You mark as Won | "Paused — Lead won" |
| `LEAD_CONVERTED` | Lead converts to a booking | "Paused — Booked" |
| `SUPERSEDED_BY_QUOTE` | Lead moves to QUOTED, GENERAL_ENQUIRY pauses | "Paused — Quote sent — new sequence took over" |
| `MANUAL` | You clicked Pause | "Paused manually" |
| `BOUNCED_PERMANENT` | Email permanently failed (bad address) | "Paused — Email bounced (permanent)" |
| `BOUNCED_TRANSIENT` | Email temporarily failed | "Paused — Email bounced (temporary)" |
| `COMPLAINT` | Guest marked the email as spam | "Paused — Guest marked as spam" |
| `LEAD_REPLIED_WHATSAPP` | Guest texted you on WhatsApp | "Paused — Guest replied on WhatsApp" |
| `NO_CHANNEL` | Lead has no email on file | "Paused — No email on file" |
| `RULE_INACTIVE` | The rule got disabled mid-flight | "Paused — Rule disabled" |

For BOUNCED, COMPLAINT, NO_CHANNEL → fix the underlying issue, then click **Resume** in the lead's drip panel.
For LEAD_REPLIED_* → usually mark the lead Qualified (at that point the drip is permanently paused with the cleaner `LEAD_QUALIFIED` reason).

LOST is a **cancel**, not a pause — terminal.

---

## Using the Radar workspace

Open `/owner/<your-hotel>/follow-up`. Items are grouped:

1. **Due today** — green border. Action by tonight.
2. **Overdue** — red border. Missed window; chase ASAP.
3. **Blocked — guest issue first** — red warning. **Do not** pitch the guest until the issue is resolved.
4. **Coming up** — future items.
5. **Already addressed** — items you've ticked off.

For each row:
- **Copy note** — copies the recommended action to your clipboard
- **Mark addressed** — saves it as done (persisted; survives refresh and logout)
- **3-dot menu (top right)** — opens a dropdown with the long-tail actions:
  - **Mark blocked** — reason form; moves to Blocked section
  - **Unblock** — only on a blocked row
  - **Dismiss** — for follow-ups that no longer apply (optional reason)
  - **Reopen** — only on Addressed or Dismissed rows

Filter pills (category / status / priority) reflect in the URL — share a filtered link with your manager.

### "Sync from leads" button

If you had leads **before** the auto-create trigger went live, those leads didn't spawn follow-ups. Click **Sync from leads** (manager+ only) to backfill. Safe to click multiple times — never duplicates.

---

## Editing the drip email copy

Visit `/owner/<your-hotel>/drip` (or click the **Drips** tile).

Three rule cards: New enquiry follow-up / Post-quote nudge / Walk-in win-back. Click any to expand its steps.

For each step you can change:
- **Send when** — hours from when the sequence started (Day 1 = 24, Day 3 = 72, Day 7 = 168, etc.)
- **Subject** — with placeholders like `{{guest_name}}`, `{{hotel_name}}`, `{{check_in}}`
- **Body** — multi-line, same placeholders
- **Active** — disable a single step without disabling the whole rule

Available placeholders (auto-substituted at send time):
`{{guest_name}}`, `{{hotel_name}}`, `{{hotel_city}}`, `{{check_in}}`, `{{check_out}}`, `{{nights}}`, `{{contact_phone}}`

Every edit writes an audit row showing who changed what.

---

## Per-lead controls (Drip panel)

Open any lead's detail drawer. The **Follow-up email sequences** section lists all subscriptions for that lead.

| Status | What you can do |
|---|---|
| **Active** | Click **Pause** to stop mid-flight (the system auto-pauses on engagement signals already) |
| **Paused** | Click **Resume** to restart from where it left off |
| **NO_CHANNEL** | Add an email to the lead, then click Resume |
| **Completed / Cancelled** | Terminal — sequence is finished |

The 🗑 button cancels the sequence (terminal). You'll be asked for a reason which gets logged.

---

## The daily send cap

By default, each hotel can send up to **200 drip emails per day**. The worker counts today's sent drip rows and refuses to claim more once the cap is hit; affected steps simply defer 1 hour and try again.

To change: update `hotels.drip_daily_send_cap` directly in Supabase (settings UI lands in a later phase).

---

## What it does NOT do (read this carefully)

| It will NOT | Because |
|---|---|
| Send WhatsApp drips | Meta template approval pending. Schema supports it; we flip when Meta approves. |
| Send SMS drips | No India SMS provider integrated. |
| Pause on inbound **email** reply | Email reply detection requires DNS setup (Resend Inbound Parse). WhatsApp replies DO pause; email replies don't yet. |
| Auto-create Radar rows for complaints / SLA / reviews | These categories exist (you can manually create them) but the system does not derive them from real tickets. Future phase after privacy review. |
| Reply to reviews automatically | Manual only. |
| Update tickets or close them | Tickets stay in your existing ticket system. |
| Take payments / hold rooms / confirm bookings | None of those exist here. |
| Generate or rewrite the email body with AI | The bodies you see in the editor are what gets sent. AI Quote Drafts is a separate feature. |
| Send to guests who haven't given consent | Each drip targets a lead in your CRM. The lead was created with contact info the guest gave you. Your privacy policy + opt-out language applies. |
| Track opens / clicks beyond bounce/complaint | Resend supports it but v1 doesn't store it. Future phase if a hotel asks. |
| Run the same sequence twice on the same lead | UNIQUE constraint enforces one subscription per (lead, rule). |
| Lose messages during an outage | If Supabase or Resend is down, the queue waits. No emails lost — they fire when service returns. |

---

## What's coming next

| Phase | What | Approval needed |
|---|---|---|
| **3** | Real read-only integration with tickets / SLA → automatic blocked banners | RLS review of `tickets` table |
| **4** | Real read-only integration with reviews → auto REVIEW_REQUEST + OWNER_REPLY | RLS review of `reviews` table |
| **5** | WhatsApp **send** channel for drips | Meta template approval (external) |
| **6** | Email inbound reply auto-pause | Resend Inbound Parse + DNS MX record |
| **7** | A/B testing of subject variants | Sample-size math + per-hotel opt-in |
| **8** | Per-staff drip ownership / routing | Per-staff assignee field |
| **9** | Open/click analytics dashboard | New `notification_events` table |
| **10** | Custom drip rule builder UI | Today only 3 stock rules edit-able via UI; custom codes work via SQL |

Each phase ships behind its own feature flag and gets your sign-off.

---

## A note on language

The Radar uses **English and Hinglish** because front-desk reality is bilingual:

> **Yeh radar batata hai kaunse follow-up aaj karne hain aur kaunse guest issue solve hone tak rokne chahiye.**

Drip email templates default to **professional English** because most enquiries are typed in English. Edit any step's body to Hinglish / Hindi — placeholders work in any script:

> Namaste {{guest_name}}, {{hotel_name}} ki taraf se shukriya. Aap {{check_in}} se {{check_out}} ke liye plan kar rahe the — agar koi sawaal ho toh seedha reply karein.

---

## QA — try this on day one

### Radar
1. Open `/owner/<slug>/follow-up` — workspace loads
2. Visit Leads → "+ New lead" → create test enquiry (e.g. "Test guest, +91 9999999999, 2 adults, next week dates")
3. Return to Radar — verify a **Due today** / **Coming up** follow-up appeared
4. Move test lead to QUOTED — verify a second follow-up appeared ("Nudge Test guest on the quote")
5. Click **Copy note** → paste somewhere to confirm
6. Click **Mark addressed** → row dims, moves to Addressed → refresh page → it stays
7. **+ Add follow-up** → create a manual one → verify it appears
8. Move test lead to CONVERTED → return to Radar → all test-lead follow-ups auto-addressed
9. Open in second tab → mark addressed in one → other tab updates within ~1s (realtime)

### Drip
1. Visit `/owner/<slug>/drip` — three rule cards render
2. Expand "New enquiry follow-up" — see 4 steps with editable subject + body
3. Change Day 0 subject to "Welcome to {{hotel_name}}, {{guest_name}}!" → Save → see "Saved." flash
4. Create test lead with `your-own-email@gmail.com`
5. Open lead detail → confirm **Follow-up email sequences** section shows GENERAL_ENQUIRY = ACTIVE
6. Wait up to 5 minutes (pg_cron tick) → check inbox → Day 0 email arrives with your edited subject
7. Reply on WhatsApp from a phone matching the lead's contact_phone → drip panel flips to "Paused — Guest replied on WhatsApp" within seconds (requires chat-inbound webhook configured)
8. Mark lead Qualified → panel updates to "Paused — Lead qualified — operator engaged"

If you had leads before the feature, click **Sync from leads** (manager+) in the Radar workspace to retroactively spawn follow-ups.

---

## When something looks wrong

### Radar
- Follow-up that doesn't make sense → tell us, we'll adjust the auto-template
- Two follow-ups for the same lead in the same category → shouldn't happen; report it
- "Sync from leads" created duplicates → also shouldn't happen; report it
- Dashboard counts don't match the workspace → screenshot

### Drip
- Email sent that shouldn't have → check the lead's drip panel timeline; pause then 🗑 cancel if wrong
- Drip shows "Paused — No email on file" but lead has an email → open lead → confirm email field is filled → Resume in drip panel
- Guest got same email twice → check `notification_queue` for duplicate `drip_subscription_id` rows; report (UNIQUE constraint should prevent)
- Sequence didn't fire when expected → check `select * from cron.job where jobname='vaiyu_lead_drip_tick'` is registered
- Bounce came in but drip didn't pause → check `resend-webhook` is configured in Resend dashboard with the correct `RESEND_WEBHOOK_SECRET`

---

**Owner feedback welcome.** This is the first VAiyu release where the platform sends emails to guests on its own (drip) AND a daily action checklist that survives refresh (radar). Defaults are conservative — 4 emails over 7 days, daily cap of 200, easy pause everywhere. As you watch real drips fire and your team works the Radar, tell us what to adjust.
