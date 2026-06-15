# WhatsApp (Interakt) Activation Runbook

**Status as of 2026-06-16: built, dark, NOT one-flip-away.**
Email notifications are live (Resend). WhatsApp is fully dormant — verified:
all 11 hotels `whatsapp_enabled=false` / `whatsapp_provider=META_DIRECT`, and
**no** `INTERAKT_API_KEY` / `INTERAKT_BASE_URL` / `INTERAKT_WEBHOOK_SECRET` /
`WHATSAPP_TOKEN` secrets are set in the prod project.

This doc is the exact, ordered checklist to take a template from "Meta approved"
to "sending in prod". It is **not** a single config change.

---

## Architecture (so the steps make sense)

```
 DB trigger / RPC ──► notification_queue (channel='whatsapp', template_code, payload, status='pending')
                                   │
              pg_cron (hourly) ──► send-notifications edge fn
                                   │  per row:
                                   │   • hotels.whatsapp_enabled = false ─► throw WHATSAPP_DISABLED_FOR_HOTEL
                                   │   • provider = hotels.whatsapp_provider (default META_DIRECT)
                                   │
                   ┌───────────────┴────────────────┐
        provider = INTERAKT                  provider = META_DIRECT (legacy)
        • TEMPLATE_APPROVED[code]?           • free-text via graph.facebook.com
        • getConfig() needs INTERAKT_API_KEY • needs WHATSAPP_TOKEN + wa_phone_number_id
        • sendInteraktTemplate()             • only works inside 24h session window
```

Key code:
- Templates + approval gate: `supabase/functions/_shared/interakt-templates.ts`
- Interakt client: `supabase/functions/_shared/interakt.ts`
- Dispatcher: `supabase/functions/send-notifications/index.ts`
- Owner UI toggles: `web/src/components/owner/WhatsAppPanel.tsx`,
  `web/src/components/owner/InteraktPanel.tsx`

---

## Activation checklist (per template, in order)

### 0. Interakt account (one-time, before any template)
- [ ] WhatsApp Business Account (WABA) + sender number connected in Interakt.
- [ ] Set prod edge secrets (one-time, serves all hotels — single-account model):
      ```
      npx supabase secrets set INTERAKT_API_KEY='<base64 from Interakt dashboard>'
      npx supabase secrets set INTERAKT_BASE_URL='https://api.interakt.ai'   # region-specific
      npx supabase secrets set INTERAKT_WEBHOOK_SECRET='<32-byte hex>'        # for delivery/read receipts
      ```
      Without `INTERAKT_API_KEY`, every Interakt send throws `INTERAKT_CONFIG_MISSING`.
- [ ] Point Interakt's delivery webhook at the `interakt-webhook` function and
      use the same `INTERAKT_WEBHOOK_SECRET` (else `provider_message_id` never
      reconciles to delivered/read).

### 1. Submit + approve the template on Meta/Interakt
- [ ] Submit with the **exact** name, language, category, and body shown in the
      comment above each `*_DEF` in `interakt-templates.ts`. The variable count
      and order (`{{1}}`, `{{2}}`…) must match `mapPayload` exactly — a mismatch
      → `INTERAKT_TEMPLATE_NOT_FOUND` / `INTERAKT_TEMPLATE_NOT_APPROVED`.
- [ ] Wait for Meta status = APPROVED.

### 2. Flip the code gate (this is CODE, not runtime config)
- [ ] In `interakt-templates.ts`, set the template's flag in `TEMPLATE_APPROVED`
      to `true`.
- [ ] Commit + push. `deploy-functions.yml` auto-deploys `send-notifications`.
      (So step 2 = a code change + redeploy, per template — not a console toggle.)

### 3. Enable WhatsApp per hotel (this IS a UI config toggle)
- [ ] In Owner Settings → WhatsApp panel: turn on `whatsapp_enabled`.
- [ ] In the Interakt panel: set `whatsapp_provider = INTERAKT` (default is
      `META_DIRECT`, which uses the legacy free-text path, not templates).
- [ ] Confirm the hotel's daily cap (`whatsapp_daily_cap`, default 200).
- [ ] Do this **at** activation, not before — there is no backlog to bank
      (queued rows dead-letter after 48 hourly attempts).

### 4. Smoke test (before real guests)
- [ ] Trigger one real event for an enabled hotel (e.g. a checkout → enqueues
      `post_checkout_thankyou` whatsapp) OR insert a test queue row.
- [ ] Watch `send-notifications` logs + the row: `status` → `sent`,
      `provider_message_id` populated.
- [ ] Confirm the message arrives on a real handset.
- [ ] Confirm the delivery webhook updates `delivered_at` / `read_at`.

---

## Failure codes → meaning (all surface in `notification_queue.error_message`)

| `error_message`                 | Cause | Fix |
|---|---|---|
| `INTERAKT_CONFIG_MISSING`       | `INTERAKT_API_KEY` not set | Step 0 |
| `INTERAKT_TEMPLATE_NOT_CONFIGURED` | `TEMPLATE_APPROVED[code]` still false | Step 2 |
| `INTERAKT_TEMPLATE_NOT_FOUND` / `_NOT_APPROVED` | Name/lang/body mismatch vs Meta | Step 1 |
| `INTERAKT_AUTH_FAIL`            | Wrong/expired API key | Step 0 |
| `INTERAKT_INVALID_PHONE`        | Bad number / `splitE164` misparse | Normalize guest phone to E.164 |
| `INTERAKT_WINDOW_CLOSED`        | Free-text outside 24h window | Use a template, not free-text |
| `WHATSAPP_DISABLED_FOR_HOTEL`   | `whatsapp_enabled=false` | Step 3 (or guarded at enqueue, see below) |
| `Hotel WhatsApp ID not configured` | META_DIRECT path, no `wa_phone_number_id` | Set provider=INTERAKT, or add the Meta number |

> Note: `error_message` is the live reason column (written by
> `mark_notification_failed`). The separate `failed_reason` column is vestigial
> and stays NULL — don't rely on it.

---

## Hardening shipped alongside this doc

- **Enqueue guard** (`20260616000001_whatsapp_enqueue_guard.sql`): booking-linked
  WhatsApp rows are no longer enqueued for hotels with `whatsapp_enabled=false`,
  so they stop dead-lettering. Fail-open; never touches email or lead/drip rows.
- **Stale-failure cleanup** (`supabase/maintenance/20260616_whatsapp_stale_failure_cleanup.sql`):
  removes the 36 pre-existing dead rows. STEP 1 preview → STEP 2 delete.

## Known constraints (by design, not bugs)
- **No pre-approval backlog.** Deferred rows permanently fail after 48 hourly
  attempts (`20260602001004`). Enable hotels at activation.
- **Single Interakt account** serves all hotels (one API key).
- **`splitE164` is heuristic** — defaults bare 10-digit numbers to +91. If you
  onboard non-Indian hotels, normalize phones to full E.164 at capture time.
