# AI Quote Drafts + Send — Hotel Owner Guide

**Version:** Compose v1.1 + Send v1.2 (PDF + email + idempotency + bounce-aware)
**Released:** 27 May 2026
**Where to find it:**
- **AI Quote Drafts** card on the owner dashboard
- **Quotes** tile (📝) in the quick-link grid
- `/owner/<your-hotel>/quote-drafts`

---

## What is it?

**Guest ko quote bhejna hai? Yahan banao, edit karo, PDF banao, email karo — sab ek hi screen pe.**

AI Quote Drafts turns a guest enquiry into a polished proposal in seconds. Three things on one screen:

1. **Compose** — pick a lead, pick a package, type the price you commit to. The system writes the proposal — either by deterministic template (no AI) or by Anthropic Claude (with per-hotel consent).
2. **Save & edit** — drafts persist with full audit. You can come back, tweak, save again.
3. **Deliver** — click **Send via email** to actually email a branded PDF to the guest. Or click **Mark as sent** to record a manual send via WhatsApp / phone / in-person.

You always edit the draft before sending. Nothing is sent without an explicit click. The disclaimer line ("final availability and price must be confirmed by the property team") is in every draft, every time.

---

## What's new in this release

**Send pipeline v1 + 1.1 + 1.2 (new):**
- **One-click email send.** A "Send via email" button next to the existing "Mark as sent". Opens a dialog with the recipient pre-filled, an optional subject override, and Send. PDF generated, email sent via Resend, quote marked Sent — one click.
- **Branded PDF attached as a link.** Email contains a "View quote PDF" button opening a 7-day signed download link. PDF has your hotel name in the header, the guest's stay details, the body text from your draft, and a disclaimer footer.
- **Idempotent — no double-sends.** Click Send twice in quick succession? The system detects the duplicate via an idempotency key and returns the original send instead of firing a second email.
- **Explicit resend with reason.** Need to send the same quote again? Button changes to "Resend via email" once the draft is SENT. Resend asks you for a short reason (e.g. "guest asked for it again" / "updated the price") which is logged.
- **Auto-pause on bounce.** If the guest's email address is invalid, the system marks the send failed and (if the email belongs to an active drip) auto-pauses the drip with reason "Email bounced." No more emailing into the void.
- **Auto-pause on spam complaint.** If the guest marks the email as spam, drip pauses with reason "Guest marked as spam."
- **Lead-side bookkeeping.** Each lead now shows `quote_count`, `last_quote_at`, and a link to the most recent PDF.

**Compose v1.1 (carried forward from earlier release):**
- AI generation via Anthropic Claude (per-hotel consent, default OFF, daily token cap)
- Saved drafts persist with full audit
- "Mark as sent" records manual sends (WhatsApp / Email / Phone / In-person / Other)
- Realtime — your manager sees changes in their tab within ~1s

---

## What you'll see on the dashboard

A card called **AI Quote Drafts** sits next to your other dashboard cards. Click to open the workspace.

A **Quotes** tile (📝) is in the quick-link grid.

---

## How to use the workspace

Open `/owner/<your-hotel>/quote-drafts`. You'll see two columns:

### Left column — the form

1. **Pick an enquiry** — dropdown of real open leads (New / Qualified / Quoted / Won). Selecting one shows a small summary box: name, party size, dates, source.
2. **Choose a package** — pick from sample templates (Honeymoon, Family, Business, Weekend), or leave blank for a fully custom proposal. When picked, tick the inclusions you want to mention.
3. **Verified details (manual)** — pick the room type, type the final price you commit to in plain words ("₹8,500 per room per night including breakfast"), enter nights, add any owner notes. A suggested base rate from your rate engine appears for reference; the number you type is the number that goes into the draft.
4. **Two approval checkboxes** — you must tick:
   - "I verified room type, price and availability manually."
   - "I understand this is a draft proposal, not a confirmed booking."

These guard both the **Copy** button and the **Send via email** button.

### Right column — the draft preview

The draft text appears here. You can edit freely.

---

## Two ways to generate a draft

### 1. Generate from template (always available)

- Click **"Generate from template"** — instant, deterministic text built from your inputs
- Costs nothing, no AI involved
- Tone is professional but plain

### 2. Generate with AI (requires opt-in)

- Click **"Generate with AI"** — calls Anthropic Claude to write a warmer, more natural draft
- Takes 2-5 seconds
- **Only works after you opt the hotel into AI** (see "Turning AI on" below)
- Footer shows which model was used + how many tokens were spent

You can run either as many times as you want. You can edit either result before saving / sending.

---

## Three ways to deliver

After you've saved a draft and ticked both governance checkboxes:

### A. Send via email (new — Send Pipeline)

1. Click **Send via email** (green button)
2. Modal opens with the guest's email pre-filled
3. (Optional) tick "Override default subject" to type your own subject. Default: *"Your quote from \<your hotel\>"*.
4. Click **Send email**
5. Success line below the button: "Sent · View PDF →"

The draft status switches to SENT; the button changes to **Resend via email** (amber).

### B. Resend via email (new)

1. Click **Resend via email** on an already-SENT draft
2. Modal asks for a **Resend reason** — required, short sentence
3. Click **Resend email**

Original `sent_at` doesn't change (so dashboards still show when the first send happened); a new notification fires with a fresh signed PDF URL. Timeline gets a `RESENT` event with your reason.

### C. Mark as sent (legacy — for manual channels)

If you send the quote via WhatsApp / phone / in-person yourself:
1. Click **Mark as sent**
2. Pick the channel (WhatsApp / Email / Phone / In-person / Other)
3. The draft moves to SENT — but **VAiyu does NOT send anything**. This just records what you did.

Use B+C interchangeably depending on whether you want VAiyu to actually deliver the email or just record your manual send.

---

## The PDF that goes out (when you use Send via email)

Every PDF includes:

- **Header strip** — Hotel name + city, "Quote / Proposal" label, quote ID snippet + issued date
- **Guest greeting** — "For \<Guest name\>"
- **Stay block** — Check-in / Check-out / Nights / Guests / Room type / Package (if any) / Manual price (if you typed one)
- **Body** — The draft text from your editor (AI-composed or template), word-wrapped
- **Inclusions** — Bulleted list (if your draft had inclusion chips)
- **Disclaimer** in italic
- **Footer** — Hotel email + phone, "Powered by VAiyu"

The PDF is private — only people with the signed URL can fetch it, and the URL is valid for 7 days. After 7 days, the link 403s; click "Resend via email" with reason "previous link expired" to generate a fresh one.

---

## Turning AI on for your hotel

AI is **off by default** for every hotel. Switching it on is a one-time decision per property.

### How

1. Open `/owner/<your-hotel>/settings`
2. Scroll to **Integrations** → **AI Quote Drafts**
3. Read the description
4. Flip the toggle to ON

The "Generate with AI" button in the workspace is now unlocked.

### Why you might want to turn it on

- Drafts feel warmer, more natural, more like a person writing
- Saves the operator typing time
- Especially helpful for non-English-first staff who can review/edit instead of writing from scratch

### Why you might keep it off

- You haven't reviewed the privacy section below yet (please read it first)
- Your hotel has very specific tone/phrasing requirements — the template is more predictable
- You don't want any guest data going to a third party

You can flip it off any time. The template path keeps working regardless.

---

## What you need to know about AI + privacy

When AI is **on** and the operator clicks "Generate with AI", these specific pieces of guest information are sent to Anthropic's servers to write the draft:

- Guest name (as it appears on the lead)
- Number of adults, children, rooms
- Requested check-in and check-out dates
- The room type, package name, and inclusions you've picked
- The final price text you typed
- Any owner notes you added

**What is NOT sent to Anthropic:**
- Guest phone number
- Guest email
- Guest ID / passport / address
- Any booking history
- Any payment information
- Any data from other guests at your hotel

**What is logged in our systems:**
- The number of tokens used (for billing / cost-tracking only)
- The hotel ID and the user who clicked the button
- The model name and prompt version

We do NOT log the prompt content or the generated text in our server logs. The actual draft text is saved in our database only when you click "Save draft".

If you stop using AI, flip the toggle off in Settings. Existing saved drafts remain accessible.

---

## What you need to know about email send + privacy

When you click **Send via email** (or **Resend**), VAiyu does send actual email via Resend on your behalf. What goes out:

- The recipient email address you typed (default = the lead's `contact_email`)
- The branded email body (default template or your custom override)
- The PDF link (7-day signed URL pointing to the private storage bucket)

What's stored:
- The draft text + PDF stay in your hotel's private storage (`quote-pdfs/<hotel_id>/<draft_id>.pdf`)
- The notification queue row carries the recipient address + subject + body for audit
- The Resend `email_id` is stored on the queue row so bounce / complaint events can be correlated back

Bounce / complaint detection (Resend webhooks):
- If the email bounces (bad address, full inbox, etc.) → queue row marked failed, no follow-up sent
- If the guest marks as spam → same
- If the email belongs to an active drip subscription for the same lead → that drip auto-pauses with the corresponding reason ("Email bounced", "Guest marked as spam")

---

## Saving and reusing drafts

After you generate a draft (template or AI), you can:

- **Save draft** — persists to our database. Survives refresh, logout, and team handoffs.
- **Edit and save again** — every save creates an audit log entry. Nothing is lost.
- **Copy draft** — copies the current text to your clipboard (paste into WhatsApp, anywhere).
- **Clear** — empties the editor without affecting the saved version.
- **Mark as sent** — records manual delivery (see "Three ways to deliver" above).
- **Send via email** — actual delivery via Resend (see above).
- **Resend via email** — explicit resend with reason.

A "Previous drafts" sidebar shows the 10 most recent drafts for the selected lead (or for this hotel if no lead is picked). Click any to load back into the editor — if previously marked sent / actually-sent, the channel and timestamp display in the form.

### Realtime — your team sees changes immediately

If your manager opens the workspace in another tab or device, any save / send / withdraw / resend action propagates within ~1 second. No need to refresh.

---

## What we built in to keep things safe

| Safety measure | What it does |
|---|---|
| **Default-OFF AI consent** | Every hotel starts with AI disabled. You actively turn it on. |
| **Daily token cap** | 50,000 tokens per hotel per day by default. Hard stop. We can adjust per hotel on request. |
| **Rate limit (AI)** | 10 AI calls per minute per staff member per hotel. |
| **Mandatory disclaimer** | Every draft ends with the verbatim disclaimer. Both AI and template add it. |
| **No invented prices** | AI uses only the price text you typed. Empty price field → AI writes "[price to be confirmed]" — never guesses. |
| **No invented features** | AI uses only the inclusions you ticked. Can't add a swimming pool or amenity you didn't list. |
| **No URLs or payment links in AI output** | AI is forbidden from inserting links, payment URLs, or fake booking confirmations. |
| **Two operator checkboxes** | Both Copy AND Send-via-email are locked until you confirm verification + draft-status. |
| **Email format check (3 layers)** | Modal + edge function + database CHECK all reject malformed email. |
| **Idempotency on send** | Double-click can't produce a double-send. Same key returns the original notification. |
| **Resend requires reason** | Re-sending a SENT quote prompts for a short reason, logged to audit. |
| **Audit trail** | Every save, edit, copy, send, resend is recorded. |
| **Token usage visible** | Open the **Usage** widget on your dashboard — quote tokens show up there. |
| **Bounce auto-handling** | Bad email → queue row marked failed + any drip auto-pauses. |

---

## What it does NOT do

| It will NOT | Because |
|---|---|
| Send WhatsApp quotes | Meta template approval pending. Schema supports it; we flip when Meta approves. |
| Send SMS quotes | No India SMS provider integrated. |
| Render Hindi / Devanagari in the PDF | Helvetica only for v1. Future phase adds Devanagari font embed. |
| Confirm a booking | Bookings live in your Walk-in / Booking flows. Quote Drafts only writes + sends text. |
| Lock a room | No availability hold from this page. |
| Take a payment | No payment link from this page. |
| Update tickets, reviews, or guest profiles | None of those are touched. |
| Run on its own at night | No scheduled / background AI or sends. Every call is a staff click. |
| Auto-translate | English / Hinglish only in v1. |
| Track opens / clicks | Bounce + complaint events are caught; opens / clicks are not stored in v1. |
| Auto-expire SENT quotes | `expires_at` column exists but isn't used yet. |
| Remember "draft accepted" automatically | Manual operator action only for now. |

---

## What's coming next

| Phase | What |
|---|---|
| **8D** | Real WhatsApp send button (only after Meta Business approval + compliance review) |
| **8E** | Quote acceptance tracking — guest can click an "Accept" link, marks the lead as won |
| **8F** | Hindi / regional-language drafts + Devanagari font embedding in the PDF |
| **8G** | Per-hotel tone customisation — formal / casual / family-friendly presets |
| **8H** | Hotel logo upload (replaces text header in PDF) |
| **8I** | Auto-expire SENT quotes after N days (per-hotel config) |
| **8J** | Open / click analytics |
| **8K** | Multi-quote comparison ("Option A / Option B / Option C" in one PDF) |

Each phase ships behind its own feature flag and gets its own owner sign-off.

---

## Front-desk QA — try this on day one

### Compose path
1. Open dashboard → click **AI Quote Drafts** card → workspace loads
2. Pick a real enquiry from the dropdown → summary box appears
3. Pick a package → inclusions appear as checkboxes
4. Pick a room type → the **Suggested base rate** chip appears (informational)
5. Type a final price in the manual price field
6. Click **Generate from template** → draft appears on the right
7. Read the draft → edit if needed
8. Tick both approval checkboxes → **Copy** + **Send via email** + **Mark as sent** all enable
9. Click **Save draft** → "Previous drafts" sidebar shows it

If AI is enabled:
- Click **Generate with AI** → loading state → AI draft appears in 2-5 seconds
- Footer shows model + token count
- Edit, save — same as template path

### Send path
1. After the steps above, verify the lead has a `contact_email` (use one you own for testing)
2. Click **Send via email** → modal opens with your email pre-filled
3. Click **Send email** → modal closes, success line shows below the button
4. Click the **View PDF** link → branded PDF renders in a new tab
5. Check your inbox → email arrives with a "View quote PDF" button
6. Return → button now shows **Resend via email** in amber
7. Click Resend → modal asks for a reason → type "test resend" → click Resend
8. Check inbox → second email arrives with the same PDF
9. Refresh page → status stays SENT
10. Visit the test lead's detail drawer → `quote_count` shows 1 (resend doesn't increment); `last_quote_at` shows the most recent timestamp
11. **(Optional)** Click Send twice in rapid succession on a fresh draft → only ONE email arrives (idempotency working)

### Legacy mark-sent path
1. On a fresh saved draft, click **Mark as sent** instead of Send via email
2. Pick a channel (e.g. WhatsApp)
3. Draft moves to SENT in the previous-drafts sidebar with a timestamp — confirms "VAiyu does not send any message itself" copy

---

## A note on language

Default workspace + email use **English and Hinglish**:

> **Guest ko quote bhejna hai? Draft yahan banayein.**
> **AI sirf draft banata hai. Bhejna aur final price humesha staff ke control mein hota hai.**

If you want default email subject/body in Hinglish or Hindi, edit before sending (the modal's "Override default subject" + the draft body itself both accept any language).

---

## When something looks wrong

### Compose
- AI draft missing the disclaimer line → should never happen; report with draft ID
- AI invents a price not in your form → also should never happen; report it
- AI invents a room feature you didn't list → report it
- "Generate with AI" locked even though you turned consent on → wait 60s (cache) then refresh
- "Daily AI budget reached" → message us, we can raise your cap

### Send
- **Send button stays disabled** → tick both governance checkboxes; lead must have `contact_email`
- **"Already sent" error** → draft is already SENT; click Resend instead
- **Email never arrives** → check Resend dashboard for the message; if bounced, fix recipient + resend
- **PDF link in email returns 403** → URL expired (7-day TTL); click Resend with reason "previous link expired"
- **Guest got 2 emails** → check the quote's timeline (`quote_draft_events`) for `SENT` vs `RESENT` rows
- **PDF shows `{{guest_name}}` etc unrendered** → draft text still has the placeholder; edit
- **Hindi characters as boxes in PDF** → known v1 limitation; transliterate or use English for now

Until the next phase ships, your team still sends manually OR uses Send via email — both paths work. The draft is a head start, not a robot.

---

**Owner feedback welcome.** This is the first VAiyu release where guest data leaves our database in two distinct ways: to Anthropic (compose-AI) and to the guest's inbox (send). Defaults are conservative (consent OFF, daily cap, mandatory governance + idempotency). Tell us where the workflow feels right or wrong as you watch real drafts + sends fire.
