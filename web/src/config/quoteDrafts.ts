// web/src/config/quoteDrafts.ts
//
// AI Quote Drafts v0 — Phase 8A.
//
// Deterministic template builder + mock packages. NO AI call, NO external
// API, NO persistence. The single source of truth for v0 behaviour.

import type {
  QuoteDraftForm,
  QuoteLeadSnapshot,
  QuotePackage,
  QuoteVerifiedInputs,
} from '../types/quoteDraft';

export const AI_QUOTE_DRAFTS_V0_ENABLED = true;

// Phase 8B — enable the "Generate with AI" button + persistent drafts.
// Per-hotel consent (hotels.ai_quote_drafts_consented) is the second gate;
// this flag only governs whether the UI surface is visible at all.
export const AI_QUOTE_DRAFTS_V1_LIVE_AI = true;

// Mandatory disclaimer line — appended at the end of every generated draft.
export const QUOTE_DISCLAIMER =
  'Indicative proposal only. Final room availability, price, taxes and booking confirmation must be manually confirmed by the property team.';

// AI-future governance line — shown in UI and at the top of the draft.
export const QUOTE_GOVERNANCE_LINE =
  'AI draft future mein help karega, lekin abhi price aur room availability staff ko manually verify karni hogi.';

// ── Mock package templates ─────────────────────────────────────────────────
// Per Phase 8A guardrail "use sample/in-memory package templates". When
// Package Builder ships, these get replaced by hotel-specific real packages.

export const MOCK_PACKAGES: QuotePackage[] = [
  {
    code: 'honeymoon-3n',
    name: 'Honeymoon escape — 3 nights',
    durationNights: 3,
    inclusions: [
      'Breakfast',
      'Candlelight dinner (1 night)',
      'Airport transfer (return)',
      'Welcome drink',
    ],
    startingPriceText: '₹8,500 per couple per night',
    policyNotes:
      'Couples only. ID + marriage proof not required. Free cancellation up to 48 hours before check-in.',
  },
  {
    code: 'family-4n',
    name: 'Family getaway — 4 nights',
    durationNights: 4,
    inclusions: [
      'Breakfast',
      'Dinner buffet',
      'Local sightseeing (half day)',
      'Children below 6 stay free',
    ],
    startingPriceText: '₹6,200 per room per night',
    policyNotes:
      'Extra mattress charged separately. Photo ID for all adult guests at check-in.',
  },
  {
    code: 'business-2n',
    name: 'Business stay — 2 nights',
    durationNights: 2,
    inclusions: [
      'Breakfast',
      'High-speed Wi-Fi',
      'Late checkout (subject to availability)',
      'Boardroom access (2 hours)',
    ],
    startingPriceText: '₹4,500 per room per night',
    policyNotes:
      'Corporate GST invoice available. Single occupancy default; second guest at extra cost.',
  },
  {
    code: 'weekend-2n',
    name: 'Weekend break — 2 nights',
    durationNights: 2,
    inclusions: ['Breakfast', 'Evening tea', 'Bonfire (subject to weather)'],
    startingPriceText: '₹5,200 per room per night',
    policyNotes:
      'Fri–Sun stays only. Standard cancellation policy applies.',
  },
];

export function findPackage(code: string | null): QuotePackage | null {
  if (!code) return null;
  return MOCK_PACKAGES.find((p) => p.code === code) ?? null;
}

// ── Helpers ────────────────────────────────────────────────────────────────

export function computeNights(checkIn: string | null, checkOut: string | null): number {
  if (!checkIn || !checkOut) return 0;
  // YYYY-MM-DD lexicographic compare; only do math if order is sane.
  if (checkOut <= checkIn) return 0;
  const ms = new Date(checkOut).getTime() - new Date(checkIn).getTime();
  return Math.max(0, Math.round(ms / 86_400_000));
}

export function formatDateForDraft(iso: string | null): string {
  if (!iso) return '—';
  // Friendly local format: 14 Jun 2026
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function emptyVerified(): QuoteVerifiedInputs {
  return {
    roomTypeId: null,
    roomTypeName: null,
    manualPriceText: '',
    nights: 0,
    selectedInclusions: [],
    ownerNotes: '',
    availabilityConfirmed: false,
    termsConfirmed: false,
  };
}

export function emptyForm(): QuoteDraftForm {
  return {
    lead: null,
    packageCode: null,
    verified: emptyVerified(),
    draftText: '',
    draftDirty: false,
  };
}

// Operator's two checkboxes gate the copy action. Both must be ticked.
export function isApprovalReady(verified: QuoteVerifiedInputs): boolean {
  return verified.availabilityConfirmed && verified.termsConfirmed;
}

// ── Deterministic template builder ─────────────────────────────────────────
//
// Pure function. Same inputs → same output. No randomness, no Date.now(),
// no external calls. This is the single AI-future seam — Phase 8B can
// replace the body with an AI call while keeping the same shape + disclaimer
// + governance line, and consumers won't have to change.

export interface BuildQuoteDraftInput {
  lead: QuoteLeadSnapshot | null;
  package: QuotePackage | null;
  verified: QuoteVerifiedInputs;
}

export function buildQuoteDraft(input: BuildQuoteDraftInput): string {
  const { lead, verified } = input;
  const pkg = input.package;

  const lines: string[] = [];

  // Greeting
  if (lead?.name) {
    lines.push(`Dear ${lead.name},`);
  } else {
    lines.push('Dear guest,');
  }
  lines.push('');

  // Lead-in
  lines.push(
    'Thank you for considering our property. Please find an indicative proposal below for your enquiry.',
  );
  lines.push('');

  // Stay block
  const partyParts: string[] = [];
  if (lead) {
    partyParts.push(
      `${lead.partyAdults} adult${lead.partyAdults === 1 ? '' : 's'}`,
    );
    if (lead.partyChildren > 0) {
      partyParts.push(
        `${lead.partyChildren} child${lead.partyChildren === 1 ? '' : 'ren'}`,
      );
    }
    partyParts.push(
      `${lead.roomCount} room${lead.roomCount === 1 ? '' : 's'}`,
    );
  }

  const nights = verified.nights || computeNights(lead?.checkIn ?? null, lead?.checkOut ?? null);

  lines.push('Stay details');
  lines.push(`  • Dates: ${formatDateForDraft(lead?.checkIn ?? null)} → ${formatDateForDraft(lead?.checkOut ?? null)}${
    nights > 0 ? `  (${nights} night${nights === 1 ? '' : 's'})` : ''
  }`);
  if (partyParts.length > 0) {
    lines.push(`  • Party: ${partyParts.join(', ')}`);
  }
  if (verified.roomTypeName) {
    lines.push(`  • Room type: ${verified.roomTypeName}`);
  }
  lines.push('');

  // Package block (if any)
  if (pkg) {
    lines.push(`Package — ${pkg.name}`);
    lines.push(`  • Duration: ${pkg.durationNights} night${pkg.durationNights === 1 ? '' : 's'}`);
    if (pkg.inclusions.length > 0) {
      lines.push('  • Inclusions:');
      const selected =
        verified.selectedInclusions.length > 0
          ? verified.selectedInclusions
          : pkg.inclusions;
      for (const inc of selected) lines.push(`      – ${inc}`);
    }
    if (pkg.policyNotes) {
      lines.push(`  • Notes: ${pkg.policyNotes}`);
    }
    lines.push('');
  }

  // Verified price (operator-typed)
  lines.push('Pricing');
  if (verified.manualPriceText.trim()) {
    lines.push(`  • ${verified.manualPriceText.trim()}`);
  } else {
    lines.push('  • To be confirmed by our team.');
  }
  lines.push('  • Taxes are extra and as per applicable rates at time of stay.');
  lines.push('');

  // Optional owner notes
  if (verified.ownerNotes.trim()) {
    lines.push('Additional notes from the property');
    for (const ln of verified.ownerNotes.trim().split('\n')) {
      lines.push(`  ${ln}`);
    }
    lines.push('');
  }

  // Sign-off
  lines.push(
    'Please reply with any questions or to confirm the booking. We will hold this proposal subject to availability at the time of confirmation.',
  );
  lines.push('');
  lines.push('Warm regards,');
  lines.push('The Property Team');
  lines.push('');
  lines.push('—');
  lines.push(QUOTE_DISCLAIMER);

  return lines.join('\n');
}
