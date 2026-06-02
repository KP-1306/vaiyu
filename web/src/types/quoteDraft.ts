// web/src/types/quoteDraft.ts
//
// AI Quote Drafts v0 — Phase 8A types only. Phase 8A is a deterministic-
// template workspace. NO real AI calls, NO persistence, NO send actions.

export interface QuotePackage {
  code: string;
  name: string;
  durationNights: number;
  inclusions: string[]; // e.g. ['Breakfast', 'Airport transfer']
  startingPriceText: string; // display-only, free-text per brief
  policyNotes: string;
}

export interface QuoteLeadSnapshot {
  id: string;            // real lead UUID when picked from Lead CRM
  name: string;          // guest display name
  partyAdults: number;
  partyChildren: number;
  roomCount: number;
  checkIn: string | null;  // YYYY-MM-DD
  checkOut: string | null;
  source: string;          // lead_source enum
  notePreview: string | null;
}

export interface QuoteVerifiedInputs {
  roomTypeId: string | null;
  roomTypeName: string | null;
  // Manual price is a free-text string per brief — operator types what they're
  // committing to. We do NOT compute it from the rate engine.
  manualPriceText: string;
  nights: number; // derived from selected check-in/out if available; else manual
  selectedInclusions: string[]; // subset of package inclusions
  ownerNotes: string;
  // Governance gates
  availabilityConfirmed: boolean;
  termsConfirmed: boolean;
}

export interface QuoteDraftForm {
  lead: QuoteLeadSnapshot | null;
  packageCode: string | null;
  verified: QuoteVerifiedInputs;
  draftText: string;     // editable; populated by buildQuoteDraft()
  draftDirty: boolean;   // true if operator has edited the textarea
}
