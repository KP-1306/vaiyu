// web/src/components/leads/LostReasonModal.validation.ts
//
// Pure validation for the LOST reason input. RPC also enforces REASON_REQUIRED
// — this is the client-side first pass to avoid a roundtrip on obvious empties.

const MIN_REASON_LENGTH = 3;

export function validateLostReason(reason: string): string | null {
  const trimmed = (reason ?? '').trim();
  if (trimmed.length === 0) return 'Reason is required';
  if (trimmed.length < MIN_REASON_LENGTH) return 'Reason is too short';
  return null;
}
