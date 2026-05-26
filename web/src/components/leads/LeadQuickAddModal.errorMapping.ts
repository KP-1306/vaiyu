// web/src/components/leads/LeadQuickAddModal.errorMapping.ts
//
// Translate LeadServiceError into user-friendly strings + per-field error
// hints. Front-desk staff should never see "INVALID_CONTACT" — they should
// see "Please provide either a phone number or email."

import type { LeadServiceError } from '../../services/leadService';
import type { ValidationErrors } from './LeadQuickAddModal.validation';

export function humanizeError(err: LeadServiceError): string {
  switch (err.code) {
    case 'NOT_AUTHORIZED':
      return 'You do not have permission to create leads here.';
    case 'INVALID_CONTACT':
      return 'Please provide either a phone number or email.';
    case 'INVALID_NAME':
      return 'Contact name is required.';
    case 'INVALID_DATES':
      return 'Check-out date must be after check-in date.';
    case 'INVALID_PARTY':
      return 'Party details look wrong: adults / children cannot be negative and rooms must be at least 1.';
    case 'SESSION_EXPIRED':
      return 'Your session has expired. Please sign in again.';
    case 'UNKNOWN_ERROR':
      return err.message || 'Something went wrong. Please try again.';
    default:
      return err.message || `Error: ${err.code}`;
  }
}

/**
 * Map a server error back to which form field(s) should highlight in red.
 * Returns empty object for codes that don't correspond to a specific field.
 */
export function extractFieldErrors(err: LeadServiceError): ValidationErrors {
  switch (err.code) {
    case 'INVALID_CONTACT':
      return {
        contactPhone: 'Phone or email is required',
        contactEmail: 'Phone or email is required',
      };
    case 'INVALID_NAME':
      return { contactName: 'Name is required' };
    case 'INVALID_DATES':
      return { checkOut: 'Check-out must be after check-in' };
    case 'INVALID_PARTY':
      return {
        partyAdults: 'Cannot be negative',
        partyChildren: 'Cannot be negative',
        roomCount: 'At least 1 room required',
      };
    default:
      return {};
  }
}
