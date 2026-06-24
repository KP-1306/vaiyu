// web/src/components/leads/LeadQuickAddModal.validation.ts
//
// Pure validation logic for the lead-create form. Mirrors the server-side
// checks in create_lead RPC + a few client-side niceties (date order, etc.)
// so we surface errors before a network roundtrip.
//
// Server enforces the same invariants as the safety net.

import type { CreateLeadInput } from '../../types/lead';
import type { OwnerT } from '../../i18n/useOwnerT';

export interface ValidationErrors {
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  checkIn?: string;
  checkOut?: string;
  partyAdults?: string;
  partyChildren?: string;
  roomCount?: string;
}

export type ValidatableField = keyof ValidationErrors;

const FIELD_ORDER: ValidatableField[] = [
  'contactName',
  'contactPhone',
  'contactEmail',
  'checkIn',
  'checkOut',
  'partyAdults',
  'partyChildren',
  'roomCount',
];

// Optional `t` keeps this pure helper unit-testable in English (called with no
// `t` → English literal) while the form passes `t` to localise (owner-leads ns).
export function validateLeadInput(input: CreateLeadInput, t?: OwnerT): ValidationErrors {
  const tr = (key: string, en: string) => (t ? t(key, en) : en);
  const errors: ValidationErrors = {};

  if (!input.contactName || input.contactName.trim() === '') {
    errors.contactName = tr('validation.nameRequired', 'Name is required');
  }

  const hasPhone = !!input.contactPhone && input.contactPhone.trim() !== '';
  const hasEmail = !!input.contactEmail && input.contactEmail.trim() !== '';
  if (!hasPhone && !hasEmail) {
    const phoneOrEmail = tr('validation.phoneOrEmailRequired', 'Phone or email is required');
    errors.contactPhone = phoneOrEmail;
    errors.contactEmail = phoneOrEmail;
  }

  if (input.checkIn && input.checkOut && input.checkOut <= input.checkIn) {
    errors.checkOut = tr('validation.checkoutAfterCheckin', 'Check-out must be after check-in');
  }

  if (typeof input.partyAdults === 'number' && input.partyAdults < 0) {
    errors.partyAdults = tr('validation.cannotBeNegative', 'Cannot be negative');
  }
  if (typeof input.partyChildren === 'number' && input.partyChildren < 0) {
    errors.partyChildren = tr('validation.cannotBeNegative', 'Cannot be negative');
  }
  if (typeof input.roomCount === 'number' && input.roomCount < 1) {
    errors.roomCount = tr('validation.atLeastOneRoom', 'At least 1 room required');
  }

  return errors;
}

export function hasValidationErrors(errors: ValidationErrors): boolean {
  return Object.values(errors).some((v) => !!v);
}

export function firstErrorField(errors: ValidationErrors): ValidatableField | null {
  for (const field of FIELD_ORDER) {
    if (errors[field]) return field;
  }
  return null;
}
