// web/src/components/leads/LeadQuickAddModal.errorMapping.ts
//
// Translate LeadServiceError into user-friendly strings + per-field error
// hints. Front-desk staff should never see "INVALID_CONTACT" — they should
// see "Please provide either a phone number or email."

import type { LeadServiceError } from '../../services/leadService';
import type { ValidationErrors } from './LeadQuickAddModal.validation';
import type { OwnerT } from '../../i18n/useOwnerT';

// Optional `t` keeps these pure helpers unit-testable in English (called with no
// `t` → English literal) while components pass `t` to localise (owner-leads ns).
export function humanizeError(err: LeadServiceError, t?: OwnerT): string {
  const tr = (key: string, en: string) => (t ? t(key, en) : en);
  switch (err.code) {
    case 'NOT_AUTHORIZED':
      return tr('errors.notAuthorized', 'You do not have permission to create leads here.');
    case 'INVALID_CONTACT':
      return tr('errors.invalidContact', 'Please provide either a phone number or email.');
    case 'INVALID_NAME':
      return tr('errors.invalidName', 'Contact name is required.');
    case 'INVALID_DATES':
      return tr('errors.invalidDates', 'Check-out date must be after check-in date.');
    case 'INVALID_PARTY':
      return tr(
        'errors.invalidParty',
        'Party details look wrong: adults / children cannot be negative and rooms must be at least 1.',
      );
    case 'SESSION_EXPIRED':
      return tr('errors.sessionExpired', 'Your session has expired. Please sign in again.');
    case 'UNKNOWN_ERROR':
      return err.message || tr('errors.generic', 'Something went wrong. Please try again.');
    default:
      return err.message || `Error: ${err.code}`;
  }
}

/**
 * Map a server error back to which form field(s) should highlight in red.
 * Returns empty object for codes that don't correspond to a specific field.
 */
export function extractFieldErrors(err: LeadServiceError, t?: OwnerT): ValidationErrors {
  const tr = (key: string, en: string) => (t ? t(key, en) : en);
  const phoneOrEmail = tr('validation.phoneOrEmailRequired', 'Phone or email is required');
  switch (err.code) {
    case 'INVALID_CONTACT':
      return {
        contactPhone: phoneOrEmail,
        contactEmail: phoneOrEmail,
      };
    case 'INVALID_NAME':
      return { contactName: tr('validation.nameRequired', 'Name is required') };
    case 'INVALID_DATES':
      return { checkOut: tr('validation.checkoutAfterCheckin', 'Check-out must be after check-in') };
    case 'INVALID_PARTY':
      return {
        partyAdults: tr('validation.cannotBeNegative', 'Cannot be negative'),
        partyChildren: tr('validation.cannotBeNegative', 'Cannot be negative'),
        roomCount: tr('validation.atLeastOneRoom', 'At least 1 room required'),
      };
    default:
      return {};
  }
}
