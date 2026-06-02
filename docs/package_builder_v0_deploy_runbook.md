# Package Builder v0 — Production Deploy Runbook

**Prod project ref:** `vsqiuwbmawygkxxjrxnt`
**Prepared:** 2026-05-27
**Rule:** No auto-push to prod Supabase without explicit per-feature approval (CLAUDE.md). Run these by hand.

> **The order matters.** Step 2 (migration) MUST run before step 4 (function deploy), or every public enquiry submission breaks. Read §"Why order matters" before starting.

---

## Pre-flight

```bash
# Confirm you're linked to the right prod project
npx supabase projects list
cat supabase/.temp/project-ref          # should print vsqiuwbmawygkxxjrxnt

# Confirm local migration ledger is clean and ahead of prod by exactly the
# two Package Builder migrations
ls supabase/migrations | tail -4
# expect:
#   20260527000001_package_builder.sql
#   20260527000002_lead_public_source_detail.sql
```

---

## Step 1 + 2 — Migrations (run together, in order)

`db push` applies pending migrations in filename order, so a single push handles
both. The ordering guarantee (000001 before 000002) is automatic by filename.

```bash
npx supabase db push --linked
```

Verify both landed:

```bash
npx supabase db remote query \
  "select version from supabase_migrations.schema_migrations
   where version in ('20260527000001','20260527000002') order by version;"
# expect 2 rows
```

Verify the new RPC signature exists (this is what step 4 depends on):

```bash
npx supabase db remote query \
  "select pg_get_function_identity_arguments(oid)
   from pg_proc where proname='create_lead_public';"
# expect the 12-arg form ending in '... p_notes text, p_source_detail text'
```

**Do not proceed to step 4 until the line above shows `p_source_detail text`.**

---

## Step 3 — Deploy the new view-tracker (order-independent)

```bash
npx supabase functions deploy packages-track-view
```

This function is anon-callable (`verify_jwt = false` already in `config.toml`).
It has no migration dependency — safe to deploy any time.

---

## Step 4 — Deploy the updated enquiry capture (AFTER step 2)

```bash
npx supabase functions deploy leads-public-capture
```

This is the one with the ordering dependency. It now forwards `p_source_detail`
to `create_lead_public`. If the 12-arg RPC from step 2 isn't live yet, every
public enquiry POST returns a signature-mismatch error.

---

## Step 5 — Frontend

`PACKAGE_BUILDER_V0_ENABLED` is already `true` in `web/src/config/packages.ts`.
Just rebuild + redeploy the web app via the normal Netlify pipeline.

```bash
npm --prefix web run build   # sanity-build locally first
# then push / trigger the Netlify deploy as usual
```

---

## Step 6 — (Optional) salt rotation env var

The view-tracker derives a stable secret salt from the service-role key when
`PACKAGE_VIEW_IP_SALT` is unset — there is **no weak default**, so this step is
optional. Set it only if you want to rotate the analytics IP-hash salt
independently of the service-role key:

```bash
npx supabase secrets set PACKAGE_VIEW_IP_SALT="$(openssl rand -hex 24)" \
  --project-ref vsqiuwbmawygkxxjrxnt
# then redeploy the function so it picks up the new env:
npx supabase functions deploy packages-track-view
```

---

## Step 7 — Post-deploy smoke (on prod)

1. Sign in as an owner of a real hotel.
2. `/owner/<slug>/packages` → **New package** → fill required fields → Save.
3. Submit for approval → Approve → Publish.
4. Open the public URL `/p/<slug>/package/<package-slug>` in an incognito window.
   - Page renders (light theme), pricing + inclusions show, disclaimer present.
5. Tap **Enquire** → form pre-fills notes + shows the "About: <package>" chip.
6. Submit the enquiry with a test phone/email.
7. Back in `/owner/<slug>/leads`, confirm the new lead shows
   `source_detail = "Package: <name>"`.
8. Confirm the dashboard **Experience Packages** card shows 1 active + a view.

If all 8 pass, the feature is live.

---

## Rollback

- **Frontend:** flip `PACKAGE_BUILDER_V0_ENABLED = false` and redeploy — hides
  all owner surfaces + the public route returns the "not enabled" guard. The DB
  + functions can stay; they're inert without the UI.
- **Functions:** redeploy the previous version from git history if needed.
- **Migrations:** both are additive (new tables + a function signature change).
  No destructive DDL. `create_lead_public` can be reverted to its 11-arg form by
  re-running `20260526000001_create_lead_public.sql` if absolutely necessary —
  but only after re-deploying the old `leads-public-capture` first (reverse the
  order dependency).
