# Digital Asset Manager v0 — Owner Guide

The Asset Workspace helps you organise the photos and documents that Google verification, your microsite, and your VAiyu onboarding team rely on. It's a checklist + library in one place.

---

## What it is

You'll see this in two places:

1. **Owner Dashboard tile** — small card showing your readiness percentage and the top 3 assets that still need attention.
2. **Full workspace** — `/owner/<your-hotel>/assets` — every requirement grouped by category with upload/replace/delete.

The system tells you *what* to collect, *why* it matters, and *how* to do it well. You upload, the VAiyu team reviews.

---

## The 4 categories

| Category | What goes here | Where it's used |
|---|---|---|
| **Verification Proof** | Signboard, entrance, business card, letterhead, blank invoice, booking register cover, branded menu, reception desk | VAiyu onboarding team's verification dossier — primarily for the Google Business Profile claim |
| **Trust Essentials** | Logo, cover, room photos, bathroom photos, dining/food, parking, view, common areas | Your microsite, package landing pages, quote PDFs, OTA listings |
| **Operational Assets** | Menu, service list, room category images, in-room QR placement proof, staff uniform | Day-to-day reuse: menu on packages, room images for booking selection |
| **Experience Content** | Local attractions, package photos, trek/tour, temple/spiritual, wellness, seasonal offers | Local SEO landing pages, seasonal campaigns, Package Builder experience cards |

Verification Proof items go to a **private vault** — only you and VAiyu's team can see them via a short-lived signed link. Everything else uses your existing public marketing bucket.

---

## Status meanings

| Pill | What it means |
|---|---|
| **Missing** | No file uploaded yet for this requirement |
| **Collected** | You've uploaded at least one file — the VAiyu team hasn't reviewed yet |
| **Approved** | VAiyu's onboarding team has verified the asset (only they can set this) |
| **Rejected** | VAiyu's team rejected the asset — see the reason and re-upload |
| **Needs replacement** | All files were removed, or you marked it for replacement |

You'll never see a stuck "Pending" — after upload it just shows **Collected ✓**.

---

## Privacy — what NOT to upload

> Do not upload Aadhaar, PAN, bank statements, guest IDs, or private personal documents. Use only public business materials like signboard, blank invoice, letterhead, business card, rooms and property photos.

> Aadhaar, PAN, bank statement, guest ID jaise documents UPLOAD NA KAREIN. Sirf public business material — signboard, blank invoice, letterhead, business card, room aur property ki photos hi dalein.

The system blocks the obvious cases automatically (filenames like `aadhaar.jpg`, `pan-card.pdf`), but please don't try to bypass it. The VAiyu team will refuse to review anything that looks like PII.

---

## No guarantees

> Asset readiness improves preparation quality but does not guarantee Google verification approval, ranking, bookings, revenue, or occupancy.

> Asset taiyaar rakhne se preparation behtar hoti hai, par Google verification, ranking, bookings ya revenue ki guarantee nahi.

Having a complete asset library makes verification + microsite work go faster, but Google's decision is Google's decision.

---

## How to use it (3-step flow)

### Step 1 — Open the workspace

From the dashboard, tap the **📷 Assets** tile in the quick-nav grid, or click **Open** on the **Asset Readiness** card.

The page opens with:
- Your **readiness ring** (top right) — % of requirements collected
- **Privacy banner** (red) — the do-not-upload list
- **Disclaimer banner** (amber) — no guarantees
- **4 collapsible category sections** — Verification Proof first (most important), then Trust / Operational / Experience

If a category is fully collected, it shows up collapsed. Categories with gaps stay open by default.

### Step 2 — Upload a file

Pick a requirement (e.g. "Permanent signboard photo"). Three ways to upload:

- **Drag-and-drop** a file from your computer into the dotted box
- **Click** the box to pick from your file picker
- For multi-file requirements (rooms, food, etc.) tap **Manage** to open the gallery drawer

The system validates:
- **File type** — JPG / PNG / WEBP / HEIC / PDF only
- **Size** — under 10 MB
- **Filename** — no PII patterns

If anything fails you get a friendly Hinglish-friendly message. Server checks the same rules.

### Step 3 — Reorder or remove (multi-file requirements only)

Tap **Manage** on any multi-file requirement to open the gallery drawer:

- **Drag** the grip handle on any file to reorder — saved automatically
- **Trash** icon to remove a file (confirms first)

If you remove the last file from a collected requirement, status auto-flips to **Needs replacement**.

---

## Tips by category

### Verification Proof — get these right the first time

- **Signboard photo**: daytime, from across the road, full board visible, business name readable. The single most important asset for Google verification.
- **Blank invoice / receipt**: a *blank* template — never one with guest data. Use a sample receipt format.
- **Booking register**: ONLY the closed front cover. Never inside pages with guest data.

### Trust Essentials — quality wins bookings

- **Room photos**: bed made, desk tidy, curtains open, natural light if possible
- **Bathroom photos**: shower / sink / toiletries visible; avoid mirror reflections of the photographer
- **Dining / food**: plated dishes, breakfast spread; natural light beats flash
- **View**: golden-hour shots from balconies / rooftops convert best

### Operational — workhorse content

- **Menu**: use the same file as Verification Proof's "Branded menu" if it's the same — the system accepts both pointers
- **QR placement**: shows VAiyu QR codes are actually mounted

### Experience — for Package Builder + Local SEO

- **Local attractions**: caption with the landmark name (you can add alt-text inside the drawer)
- **Trek / tour**: real photos from past guests / trips your hotel organized
- **Temple / spiritual**: critical for Char Dham packages

---

## What about logos that already exist?

Hotels with a logo or cover already uploaded via **Settings → Branding** get those auto-linked to the matching requirements on day 1. You'll see them tagged **linked from Hotel Settings** with the Manage button disabled — to replace, go to Hotel Settings and the new file syncs back here automatically.

---

## Frequently asked

**Q: I uploaded a room photo but the status still says Missing.**
A: Refresh the page. If still wrong, the upload likely failed — check your browser console or try a smaller file.

**Q: Why can't I approve my own assets?**
A: Approval is the VAiyu onboarding team's job — it represents a real human verification of the asset. Owners see "Collected ✓" until reviewed.

**Q: A file I uploaded shows Rejected. What do I do?**
A: Tap the red rejection reason to see what the VAiyu team flagged. Upload a replacement — status will go back to Collected on the next upload.

**Q: Will my room photos appear on my microsite?**
A: That integration ships in a follow-up sprint. For now uploads are stored and available to your VAiyu account manager.

**Q: Is there a limit on total uploads?**
A: Per-file cap is 10 MB. No total cap today; we'll add per-hotel quotas if real usage demands it.

**Q: Can I delete files I've uploaded?**
A: Yes for any **Collected** or **Needs replacement** asset. **Approved** assets need VAiyu team confirmation before removal — contact your account manager.

---

## Where to get help

If you're confused about what a requirement means, hover the requirement row to see the **Why** and **Tip** lines — both rendered in English by default and Hinglish if you flip the **Show Hinglish** toggle (top right of the workspace).

For anything else, message your VAiyu onboarding team — they have a live view of every asset you've uploaded.

**Hinglish reminder:** *Google verification ke liye aapke hotel ka board, entrance aur business proof clear hona zaroori hai. Keep these assets ready with your VAiyu onboarding team.*
