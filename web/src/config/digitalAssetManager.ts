// Digital Asset Manager v0 — feature flag + shared constants.
//
// Toggle: flip DIGITAL_ASSET_MANAGER_V0_ENABLED = false to hide all surfaces
// (dashboard card + side-nav + /owner/:slug/assets route).
//
// Per CLAUDE.md anti-features: there's no per-hotel asset config UI — the
// requirements catalog (~28 rows) is system-defined; mutations only via
// migration. Label dictionaries live here for UI rendering.

export const DIGITAL_ASSET_MANAGER_V0_ENABLED = true;

/** Bucket id for marketing-grade content (rooms, food, logo, cover). Public. */
export const DAM_BUCKET_PUBLIC_MARKETING = 'hotel-assets';

/** Bucket id for verification-grade content (signboard, business card, etc.). Private. */
export const DAM_BUCKET_PRIVATE_VAULT = 'hotel-asset-vault';

/** Signed-URL TTL for vault files (seconds). Mirrors quote-pdfs default. */
export const DAM_VAULT_SIGNED_URL_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Per-file size cap (must match DB CHECK). */
export const DAM_MAX_FILE_BYTES = 10 * 1024 * 1024;

/** MIME allowlist — must match DB CHECK. */
export const DAM_ALLOWED_MIME_TYPES: ReadonlyArray<string> = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
];

/** Client-side PII filename guardrail. Backed by server check, but a fast UX hint. */
export const DAM_PII_FILENAME_REGEX =
  /\b(aadhaar|aadhar|pan[._-]?card|pan[._-]?copy|passport|cheque|bank[._-]?statement|driving[._-]?licen[sc]e|voter[._-]?id)\b/i;

export const DAM_CATEGORY_LABELS = {
  VERIFICATION_PROOF: 'Verification Proof',
  TRUST_ESSENTIALS:   'Trust Essentials',
  OPERATIONAL:        'Operational Assets',
  EXPERIENCE:         'Experience Content',
} as const;

export const DAM_CATEGORY_SUBTITLES = {
  VERIFICATION_PROOF: 'Business identity for Google verification + VAiyu onboarding dossier',
  TRUST_ESSENTIALS:   'Photos guests see before booking — microsite, packages, quotes',
  OPERATIONAL:        'Day-to-day operational visuals',
  EXPERIENCE:         'Local attractions + package + seasonal content',
} as const;

export const DAM_PRIORITY_LABELS = {
  CRITICAL: 'Critical',
  HIGH:     'High',
  MEDIUM:   'Medium',
  LOW:      'Low',
} as const;

export const DAM_STATUS_LABELS = {
  MISSING:            'Missing',
  COLLECTED:          'Collected',
  APPROVED:           'Approved',
  REJECTED:           'Rejected',
  NEEDS_REPLACEMENT:  'Needs Replacement',
} as const;

/** Verbatim privacy + disclaimer copy (EN + Hinglish). Per PO brief. */
export const DAM_COPY = {
  privacyEN:
    'Do not upload Aadhaar, PAN, bank statements, guest IDs, or private personal documents. Use only public business materials like signboard, blank invoice, letterhead, business card, rooms and property photos.',
  privacyHI:
    'Aadhaar, PAN, bank statement, guest ID jaise documents UPLOAD NA KAREIN. Sirf public business material — signboard, blank invoice, letterhead, business card, room aur property ki photos hi dalein.',
  disclaimerEN:
    'Asset readiness improves preparation quality but does not guarantee Google verification approval, ranking, bookings, revenue, or occupancy.',
  disclaimerHI:
    'Asset taiyaar rakhne se preparation behtar hoti hai, par Google verification, ranking, bookings ya revenue ki guarantee nahi.',
  onboardingHI:
    'Keep these assets ready with your VAiyu onboarding team. — VAiyu onboarding team ke saath in assets ko tayar rakhein.',
  googleProofHI:
    'Google verification ke liye aapke hotel ka board, entrance aur business proof clear hona zaroori hai.',
} as const;
