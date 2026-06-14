# VAiyu — Production Operations Runbook: Backups & Error Alerting

**Owner:** platform / founder · **Last updated:** 2026-06-14

This runbook closes the two operational gaps flagged after the security sweep —
**data durability (backups / PITR)** and **error visibility (alerting)**. These
are the highest real-world risk to a hotel SaaS handling real money: a missing
backup can lose folio/payment data with no recovery, and a silent prod failure at
11pm is invisible until a front-desk staffer calls.

Most steps are in dashboards (Supabase / Sentry / Netlify) — they cannot be done
from the repo or CLI with the current access. Each step says **where** to do it and
**how to verify** it worked.

> Status legend: ☐ = action you must take · ✅ = already in the codebase

---

## Part A — Database backups & Point-in-Time Recovery (PITR)

**Why first:** this is the irreversible risk. Code bugs are fixable; lost payment
data is not.

### A.1 Confirm your Supabase plan and current backup state
☐ Supabase Dashboard → Project → **Database → Backups**.
- **Free plan:** no reliable automated backups — treat prod data as *unprotected*.
- **Pro plan:** daily logical backups, retained 7 days, downloadable.
- **PITR (add-on, needs Pro):** continuous WAL-based recovery to any second within
  the retention window (7 / 14 / 28 days). This is what you want for a payments
  system — a daily backup can still lose up to ~24h of bookings/payments.

### A.2 Enable PITR
☐ Dashboard → **Settings → Add-ons → Point-in-Time Recovery** → enable (pick ≥ 7
days; 14 recommended). Confirm the **Backups** page then shows a PITR timeline.

### A.3 Prove recovery actually works (do this once, now — an untested backup is not a backup)
☐ Note the current time `T0`. Insert a sentinel row in a throwaway table, or note a
recent booking code.
☐ Dashboard → Database → Backups → **Restore** → use *Restore to a new project* (or
a branch) at a timestamp just after `T0`. **Never test-restore over prod.**
☐ Verify the sentinel/booking is present in the restored copy. Delete the throwaway
project. Record the wall-clock restore time — that is your real RTO.

### A.4 Off-platform copy (defense against account-level loss)
☐ Schedule a weekly logical dump stored outside Supabase (e.g. to object storage you
control). The repo already has the CLI for it:
```bash
supabase db dump --linked -f backups/vaiyu_$(date +%F).sql        # schema + data
# store the file off-Supabase; keep ≥ 4 weekly copies
```
This protects against billing/account suspension or a region incident, which PITR
within the same project does not.

### A.5 Acceptance
- [ ] PITR enabled, retention ≥ 7 days, timeline visible.
- [ ] One restore test completed; RTO recorded.
- [ ] Weekly off-platform dump scheduled.

---

## Part B — Error alerting

### B.1 Frontend (Sentry) — **code is done; just activate it** ✅☐
The frontend monitoring is fully built and **dormant behind one env var** (same
pattern as the WhatsApp layer):
- ✅ `web/src/lib/monitoring.ts` — `initMonitoring()` (called from `main.tsx`) lazy-
  loads `@sentry/browser@7.120.0` from CDN **only when `VITE_SENTRY_DSN` is set and
  the build is production**. Includes `captureException`, `captureMessage`,
  `addBreadcrumb`, `setUserContext`, and `beforeSend` noise-filtering (drops
  Razorpay/extension/ResizeObserver noise). Falls back to `console.error` with no DSN.
- ✅ Error boundaries: `GlobalErrorBoundary`, `HardErrorBoundary`, `RouteErrorBoundary`,
  `ErrorBoundary`, `FinanceErrorBoundary`.
- ✅ Env placeholders: `VITE_SENTRY_DSN`, `VITE_SENTRY_TRACES_SAMPLE_RATE` in
  `web/.env.production.example`.
- 🔸 `web/src/lib/sentry.ts` is a dead no-op stub superseded by `monitoring.ts` —
  safe to delete in a cleanup (not required for activation).

**Activate:**
☐ Create a Sentry project (platform: *React*), copy its **DSN**.
☐ Netlify → Site → **Environment variables** → set:
  - `VITE_SENTRY_DSN` = the DSN
  - `VITE_SENTRY_TRACES_SAMPLE_RATE` = `0.15` (already defaulted)
  - `VITE_APP_VERSION` = your release SHA/tag (so Sentry groups by release)
☐ **Redeploy** the frontend (Vite inlines `VITE_*` at build time — a redeploy is
  required; setting the var alone does nothing).
☐ **CSP check:** `monitoring.ts` loads Sentry from `https://esm.sh` at runtime and
  Sentry posts to `*.ingest.sentry.io`. If a Content-Security-Policy is set (Netlify
  `_headers`/`netlify.toml`), add both to `script-src`/`connect-src`, or Sentry will
  silently fail to load.

**Verify:** open the deployed site, trigger a harmless error (e.g. a thrown test in a
non-prod page, or `window.__vaiyuTestError?.()` if wired) → event appears in Sentry
within ~1 min.

### B.2 Edge functions (Deno) — server-side capture
Edge functions currently `catch` + `console.error` to Supabase logs but raise no
alert. Two levels:
☐ **Minimum (no code):** Supabase Dashboard → **Logs → Edge Functions** → save a
  query for `severity = error` and attach a **Log Drain / alert** (B.4).
☐ **Better (small code add):** in each function's top-level `catch`, POST the error to
  Sentry's [Deno SDK] or its HTTP **store** endpoint using a server-side
  `SENTRY_DSN` secret (`supabase secrets set SENTRY_DSN=…`). Prioritise the
  money/integrity functions: `razorpay-direct-webhook`, `razorpay-direct-verify-payment`,
  `send-notifications`, `process-import-rows`, `auto-apply-pricing`. *(This is a
  follow-up code task, not a dashboard flip — track it separately.)*

### B.3 Database / platform
☐ Dashboard → **Reports / Database health** → enable alerts for: error rate, CPU,
  disk usage, connection saturation. Disk-full on Postgres = hard outage.
☐ Confirm a **cron-failure** signal exists for the pg_cron jobs
  (`vaiyu_auto_checkout_overdue_stays`, `vaiyu_lead_drip_tick`,
  `generate-checkout-reminders`, etc.). The visibility cron already writes
  `va_audit_logs('*_cron_error', …)` on failure — add an alert (B.4) on those rows.

### B.4 Alert routing & rules (what should page you)
☐ Pick a channel: Slack/email/PagerDuty. Wire Sentry **Alerts** + Supabase **Log
  drains** to it.
☐ Minimum rule set (tuned to a payments app):
  | Signal | Condition | Action |
  |---|---|---|
  | Payment/folio errors | any Sentry event tagged from Razorpay/folio paths | page immediately |
  | Frontend error spike | > 10 events / 5 min on one release | notify |
  | Edge function errors | any `severity=error` in `razorpay-*` / `send-notifications` | page |
  | DB disk usage | > 80% | notify; > 90% page |
  | Cron failure | new `va_audit_logs.action ILIKE '%cron_error%'` | notify |
  | Auth/permission denials surge | spike in `42501` (the RPC guards firing) | notify — could be an attack probe |

### B.5 Acceptance
- [ ] `VITE_SENTRY_DSN` set in Netlify; frontend redeployed; test event received.
- [ ] CSP allows esm.sh + sentry ingest (or no CSP in place).
- [ ] Supabase error-rate / disk alerts enabled and routed to a channel.
- [ ] Payment-path and cron-failure alert rules created and test-fired once.

---

## Notes / honest scope
- Parts A and B.1 are **flips** (dashboard + one env var); the frontend code is
  already in place and verified. Part B.2 (edge-function Sentry capture) is a small
  **code** follow-up, not a flip — it's called out so it isn't forgotten.
- PITR plan/cost is a billing decision; for a system holding real folio/payment data
  the cost is almost certainly justified vs. the loss of even one day of bookings.
- After completing A + B, update the status legend marks here and link this runbook
  from `docs/PRODUCTION_RELEASE_REVIEW.md` §5 (Known Gaps).
