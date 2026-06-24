// web/src/components/leads/LostReasonModal.validation.ts
//
// Pure validation for the LOST reason input. RPC also enforces REASON_REQUIRED
// — this is the client-side first pass to avoid a roundtrip on obvious empties.

import type { OwnerT } from '../../i18n/useOwnerT';

const MIN_REASON_LENGTH = 3;

// Optional `t` keeps this pure helper unit-testable in English (called with no
// `t` → English literal) while the modal passes `t` to localise (owner-leads ns).
export function validateLostReason(reason: string, t?: OwnerT): string | null {
  const tr = (key: string, en: string) => (t ? t(key, en) : en);
  const trimmed = (reason ?? '').trim();
  if (trimmed.length === 0) return tr('lostModal.reasonRequired', 'Reason is required');
  if (trimmed.length < MIN_REASON_LENGTH) return tr('lostModal.reasonTooShort', 'Reason is too short');
  return null;
}
