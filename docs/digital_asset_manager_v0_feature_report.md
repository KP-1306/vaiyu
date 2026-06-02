# Digital Asset Manager v0 — Feature Report

**Position 6 of the growth sheet** — shipped 2026-05-28 (with same-day hardening pass).

A merge of two overlapping product visions into a single primitive:
- **Asset Readiness Checklist** (PO brief) — 28 system-defined business-required hotel assets, status tracked per hotel, with a Top Missing widget driving owner action.
- **Asset Library** (sequence doc card #11) — central reusable store for branded media, surfaced to Package Builder + Quote PDF + Microsite via a single view.

Without the merge: build the checklist now, then build a second upload pipe for Package Builder next month, then a third for Microsite the month after. With the merge: one source of truth, two consumers.

---

## 1. What was built

### 1.1 Three-layer schema

| Layer | Table / View | Purpose |
|---|---|---|
| Catalog | `asset_requirements` | System-defined ~28 requirements across 4 categories. Read-only from app; mutations only via migration. Seeded with EN + Hinglish copy. |
| Per-hotel state | `hotel_assets` | One row per (hotel_id, requirement_code), lazy-created. Workflow status, owner + internal notes, review trail. |
| Files | `hotel_asset_files` | 1-to-many under each `hotel_assets` row. Append-only (immutability trigger). Holds bucket + storage_path + metadata. |
| View | `v_hotel_asset_status` | Cross join of catalog × hotels with LEFT JOIN on per-hotel state. Computes `MISSING` for requirements with no row. |
| View | `v_hotel_visible_assets` | Reuse hook for Package Builder / Quote PDF / Microsite. Returns COLLECTED + APPROVED files only. |

### 1.2 Workflow states

```
        ┌──────────────────────────────────────────┐
        │  MISSING (computed, no row stored)       │
        └────────────────────┬─────────────────────┘
                             │ first upload
                             ▼
                       ┌───────────┐
            ┌──────────│ COLLECTED │──────────┐
            │          └───────────┘          │
            │ admin                      admin│
            │ approve                    reject
            ▼                                ▼
       ┌──────────┐                    ┌──────────┐
       │ APPROVED │                    │ REJECTED │
       └────┬─────┘                    └────┬─────┘
            │                               │ owner re-uploads
            │ last file removed             │
            ▼                               ▼
  ┌──────────────────────┐           ┌───────────┐
  │ NEEDS_REPLACEMENT    │◀──────────│ COLLECTED │
  └──────────────────────┘  re-upload└───────────┘
```

`APPROVED` and `REJECTED` are platform-admin only — owners see "COLLECTED ✓" until the VAiyu onboarding team reviews. There's no stuck "Pending Approval" state ever shown to owners.

### 1.3 Dual-bucket storage

| Bucket | Public? | Contents | Access |
|---|---|---|---|
| `hotel-assets` (existing) | Public | Marketing: rooms, food, view, exterior, logo, cover | `getPublicUrl()` — consumed by microsite/PDFs/emails |
| `hotel-asset-vault` (new) | Private, 10 MB cap, MIME allowlist | Verification proofs: signboard, business card, blank invoice, letterhead, booking register | 7-day signed URLs via `createSignedUrl()` |

Bucket selection is **not user-driven**. Each `asset_requirements` row has a `storage_zone` (`PUBLIC_MARKETING` / `PRIVATE_VAULT`) that determines the bucket. The RPC enforces this with a CHECK; the UI selects accordingly. Owners can't accidentally route a letterhead to the public bucket.

Storage RLS uses the canonical `split_part(name, '/', 1)::uuid = hotel membership` pattern (same as `quote-pdfs`). Path convention: `{hotel_id}/dam/{requirement_code}/{idempotency_key}.{ext}`. The `dam/` prefix isolates DAM uploads from existing logo/cover at the bucket root.

### 1.4 The 28 seeded requirements

| Category | Count | Storage zone | Sample requirements |
|---|---|---|---|
| Verification Proof | 9 | PRIVATE_VAULT | Permanent signboard, entrance/front, approach road, business card, letterhead, blank invoice, booking register cover, branded menu, reception desk |
| Trust Essentials | 8 | PUBLIC_MARKETING | Logo, cover, room photos, bathroom photos, common areas, dining/food, parking, view/surroundings |
| Operational | 5 | mixed | Menu, service list, room category images, QR placement (vault), staff uniform |
| Experience | 6 | PUBLIC_MARKETING | Local attractions, package photos, trek/tour, temple/spiritual, wellness/yoga, seasonal offers |

Every requirement carries EN + Hinglish display name, `why_it_matters`, and `recommended_action`. The Hinglish text is what differentiates from a generic CMS — owners read directly in Hinglish without translation friction.

### 1.5 Privacy + safety guardrails

Enforced at three layers (UI + RPC + DB CHECK):

1. **MIME allowlist** — `image/jpeg`, `image/png`, `image/webp`, `image/heic`, `image/heif`, `application/pdf`.
2. **Per-file size cap** — 10 MB (bucket + CHECK constraint).
3. **PII filename rejection** — `_asset_filename_has_pii()` SQL function with word-bounded regex against `aadhaar / aadhar / pancard / pan.card / passport / cheque / bank.statement / driving.licen[sc]e / voter.id`. Catches casual cases without false-positiving `panorama.jpg`.
4. **Hotel folder isolation** — DB CHECK constraint `storage_path ~ ('^' || hotel_id::text || '/.+')`. A row can't reference a path outside its own hotel folder.
5. **Bucket / zone alignment** — RPC raises `WRONG_BUCKET_FOR_ZONE` if a `PRIVATE_VAULT` requirement is uploaded to the public bucket. Defence in depth against UI bugs.

The privacy + disclaimer copy is verbatim from the PO brief:

> **Privacy:** Do not upload Aadhaar, PAN, bank statements, guest IDs, or private personal documents. Use only public business materials like signboard, blank invoice, letterhead, business card, rooms and property photos.
>
> **No guarantees:** Asset readiness improves preparation quality but does not guarantee Google verification approval, ranking, bookings, revenue, or occupancy.

Both render at the top of the workspace, inside every upload drawer, and in the dashboard card footer.

### 1.6 Brand backfill — day-1 progress

Hotels that already have `logo_path` or `cover_image_path` populated get the corresponding requirement (`trust_logo_brand_assets`, `trust_cover_image`) auto-marked `COLLECTED` with `collected_via = 'AUTO_LINK_BRAND'`. The workspace shows "Linked from Hotel Settings" badge so owners know where to manage them.

The trigger `trg_hotel_brand_to_assets` keeps this sync going — if an owner updates the logo later, the asset row stays accurate without manual action.

Verification on local DB: 11 hotels, 5 backfilled rows (2 logos + 3 covers).

### 1.7 Idempotency + audit

- `hotel_asset_files.idempotency_key` UNIQUE partial index — same pattern as `notification_queue` (Position 2/3). Re-submitting the same key short-circuits the RPC and returns the existing file row.
- Every state change (file added, file removed, status changed, approval, rejection) logs to `va_audit_logs` via the shared `vaiyu_log_audit()` helper. Per CLAUDE.md, this is *not* a per-entity event table — the dashboard surface here is the view, not a timeline.

---

## 2. Reuse hooks for downstream features

`v_hotel_visible_assets` is the single read surface for any feature that wants hotel-uploaded content. Today it's not yet wired into Package Builder + Quote PDF (smaller blast radius for the v0), but the contract is locked:

```sql
SELECT *
FROM v_hotel_visible_assets
WHERE hotel_id = $1
  AND category = 'TRUST_ESSENTIALS'
  AND requirement_code = 'trust_room_photos'
ORDER BY sort_order
LIMIT 6;
```

That query, callable from any service, returns room photos with bucket + storage_path so the caller can mint a signed URL (private) or public URL (public). The migration introduces no breaking change for Package Builder / Quote PDF — they continue with their current hero/branding sources until a follow-up PR opts them in.

When that wire-up happens (next sprint), the win is:
- **Package Builder** stops asking owners to re-upload room photos per package; it queries the visible-assets view by requirement.
- **Quote PDF** stops requiring a separate logo upload — uses `trust_logo_brand_assets`.
- **Microsite** (Position 7+) reads its hero from `trust_cover_image` and gallery from `trust_room_photos`.

---

## 3. Architecture decisions worth surfacing

### 3.1 Why a catalog table, not an enum

Asset requirements need 11 fields per row (EN + Hi display name, why_it_matters EN+Hi, recommended_action EN+Hi, priority, storage_zone, multi-file flag, sort_order, active flag). An enum can't carry that payload. The catalog table is system-only — RLS allows authenticated read; no INSERT/UPDATE/DELETE policy means only migrations mutate it. This matches CLAUDE.md anti-feature "no per-hotel custom fields".

### 3.2 Why two-table split (hotel_assets + hotel_asset_files)

Rooms/food/attractions are multi-file requirements. Signboard/business card are single-file. A single-table design (one row per file) couldn't track per-requirement workflow status cleanly. The two-table split lets `hotel_assets` own the workflow state and `hotel_asset_files` be a pure file ledger.

### 3.3 Why MISSING is not stored

A `hotel_assets` row materializes only when the owner takes action (uploads, adds a note, marks needs-replacement). For 11 hotels × 28 requirements = 308 potential rows, only the ones the owner has touched exist. The view's CROSS JOIN + LEFT JOIN computes `MISSING` for the rest. Simpler model, less write amplification on hotel onboarding.

### 3.4 Why immutability trigger on hotel_asset_files

A file row's identity (bucket + path + size + idempotency key + uploaded_by) is locked post-INSERT. Only `sort_order` and `alt_text` are mutable — they're presentation, not identity. This matches the immutability pattern from `payments` (CLAUDE.md). Replacing a file is a DELETE + INSERT pair, not an UPDATE, which preserves audit clarity.

### 3.5 Why dual bucket instead of one public bucket

The existing `hotel-assets` is public (used by ImageUpload for logos/covers). Reusing it for verification proofs would publicly expose blank invoices, letterheads, business cards. None of these are PII, but they're *internal business material* — privacy by default is the right call. The new `hotel-asset-vault` is private; 10 MB cap; MIME allowlist enforced at bucket level; hotel-folder RLS via `split_part`. Owners can't accidentally cross the streams because `asset_requirements.storage_zone` determines the bucket and is read-only.

### 3.6 Why approval is platform-admin only

Owners don't review their own verification dossier — that's circular. APPROVED means "the VAiyu onboarding team has visually verified the asset is real, legible, and on-brand." Today there's no formal QA team, so APPROVED rows will be empty for a while. The owner sees "COLLECTED ✓" until reviewed, never a stuck "Pending Approval". When the QA team forms, no schema change needed.

### 3.7 What's deliberately NOT in v0

Honoring CLAUDE.md "no future-me framing" — these are decisions, not deferrals:

- **No per-hotel custom requirements** — catalog is system-defined (anti-feature). Trigger to revisit: a paying hotel asks for a specific custom asset type.
- **No public asset gallery** — internal-facing only. Microsite (Position 7+) will surface via existing public bucket through specific feature wiring, not a generic gallery.
- **No AI quality scoring** — explicitly out of PO scope. Image dimensions are captured for future use.
- **No alt-text editor in v0** — DB supports it; UI renders alt_text on previews; in-place edit is one component away when a hotel asks. Trigger: first SEO-focused conversation with a hotel.
- **No file content hashing for deduplication** — idempotency by key (caller-supplied UUID) is sufficient. Content hash adds complexity for cross-requirement dedup which isn't a v0 problem.
- **No orphan storage cleanup job** — best-effort `supabase.storage.remove()` in client after RPC delete is sufficient. If an orphan rate >1% emerges, add admin sweep RPC.

---

## 4. Files touched

### Migration

| File | What |
|---|---|
| `supabase/migrations/20260528000001_digital_asset_manager.sql` | 5 enums + 3 tables + 2 views + 8 RPCs + storage bucket + RLS + 28-row seed + brand-backfill trigger + one-shot backfill loop + grants |
| `supabase/migrations/20260528000002_dam_hardening.sql` | Concurrency-safe rewrite of `record_hotel_asset_file` (ON CONFLICT + FOR UPDATE); brand unlink on logo/cover removal; storage-cleanup trigger on file DELETE (vault + DAM-only public paths); `update_hotel_asset_file_alt_text` RPC; **per-hotel idempotency index** (closes cross-tenant key collision); owner notes empty-string normalize. |

### Frontend

| File | Purpose |
|---|---|
| `web/src/config/digitalAssetManager.ts` | Feature flag, bucket constants, MIME/size/PII rules, verbatim disclaimer copy (EN + Hinglish) |
| `web/src/types/digitalAssets.ts` | Types mirroring DB schema + error code union |
| `web/src/services/digitalAssetService.ts` | Typed RPC wrappers, bucket-aware upload helper, signed-URL minting |
| `web/src/components/assets/PrivacyDisclaimerBanner.tsx` | Verbatim PO copy banners + Hinglish helper |
| `web/src/components/assets/AssetStatusBadge.tsx` | Status / priority / category visual primitives |
| `web/src/components/assets/AssetUploadSlot.tsx` | Light-theme drop-zone with client-side validation |
| `web/src/components/assets/AssetRequirementRow.tsx` | One requirement card |
| `web/src/components/assets/AssetCategorySection.tsx` | Collapsible category group |
| `web/src/components/assets/AssetFileGalleryDrawer.tsx` | Multi-file requirement drawer (grid, drag-reorder, signed-URL preview) |
| `web/src/components/owner/AssetReadinessCard.tsx` | Dark-theme dashboard tile with Top 3 missing |
| `web/src/routes/owner/Assets.tsx` | Workspace route (light theme, readiness ring, 4 category sections) |
| `web/src/main.tsx` | Lazy route registration |
| `web/src/routes/OwnerDashboard.tsx` | AssetReadinessCard + 📷 Assets side-nav tile |

---

## 5. What did NOT change

- Guest claim / precheck / regcard / GuestShell — zero touch.
- Tickets / orders / menu / reviews / auth flows — zero touch.
- Existing `hotel-assets` public bucket policies — unchanged.
- Existing `ImageUpload.tsx` (dark-theme logo/cover uploader) — unchanged.
- Razorpay / payments / refunds — zero touch.
- Lead CRM / Drip Engine / Quote Pipeline / Partner Network / Package Builder — zero schema or service edits.

---

## 6. Build / test results

| Check | Result |
|---|---|
| Both migrations applied (local) | ✓ 28 catalog rows seeded; 5 backfill rows; 9 RPCs; 4 vault storage policies; 2 immutability/cleanup triggers |
| Idempotency re-apply | ✓ Both migrations safe to re-apply (CREATE OR REPLACE + DROP IF EXISTS patterns) |
| Brand unlink test | ✓ Setting `logo_path = NULL` on a backfilled hotel removes the auto-link row (1→0) |
| PII regex sanity | ✓ Catches `aadhaar.jpg`, `pancard.pdf`, `bank_statement.pdf`; passes `panorama.jpg`, `signboard.jpg` |
| `npm run typecheck` | ✓ 0 errors |
| `npm run build` | ✓ Built in ~5.5 s; pre-existing chunk-size warnings unchanged |
| `npm run test` | ✓ 561 / 561 passing (28 files; +26 new DAM tests) |

---

## 7. Deployment plan (not yet executed)

Per user direction, deployment is held. When ready:

1. Apply migration on remote DB: `supabase db push` (or via `docker exec psql` for `storage.objects` policy creation if remote runs with a non-superuser).
2. Verify migration recorded in `supabase_migrations.schema_migrations`.
3. Backfill confirmation: query `SELECT requirement_code, COUNT(*) FROM hotel_assets GROUP BY 1` — should match the count of remote hotels with non-null `logo_path` / `cover_image_path`.
4. Deploy `web/` to Netlify; verify the `/owner/<slug>/assets` route loads and the dashboard card renders.

Rollback: flip `DIGITAL_ASSET_MANAGER_V0_ENABLED = false` in `web/src/config/digitalAssetManager.ts` and redeploy. DB is additive; the schema can stay in place even if the UI is hidden. To fully remove: `DROP VIEW v_hotel_visible_assets, v_hotel_asset_status; DROP TABLE hotel_asset_files, hotel_assets, asset_requirements; DELETE FROM storage.buckets WHERE id = 'hotel-asset-vault';`. Existing logo/cover storage objects in `hotel-assets` are unaffected.

---

## 8. Connection points for the next positions

| Next position | How DAM v0 unblocks it |
|---|---|
| #7 Local SEO landing pages | Read room/exterior/view photos directly from `v_hotel_visible_assets` |
| #8 Seasonal demand calendar | Read seasonal offer visuals via `category = 'EXPERIENCE'` |
| #9 Visibility Score | "Assets ready %" becomes a top-line input; the LEFT JOIN view gives it cheap aggregate counts per hotel |
| #5 Package Builder (already shipped) | Switch hero image picker to query DAM (next sprint, not in this PR) |
| #3 Quote PDF (already shipped) | Switch branding source to `trust_logo_brand_assets` (next sprint, not in this PR) |
