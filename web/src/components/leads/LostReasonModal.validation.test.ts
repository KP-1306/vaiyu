import { describe, expect, it } from 'vitest';
import { validateLostReason } from './LostReasonModal.validation';

describe('validateLostReason', () => {
  it('rejects empty string', () => {
    expect(validateLostReason('')).toBe('Reason is required');
  });
  it('rejects whitespace-only', () => {
    expect(validateLostReason('   ')).toBe('Reason is required');
    expect(validateLostReason('\n\t  ')).toBe('Reason is required');
  });
  it('rejects too-short trimmed', () => {
    expect(validateLostReason('a')).toBe('Reason is too short');
    expect(validateLostReason(' ab ')).toBe('Reason is too short');
  });
  it('accepts trimmed 3+ chars', () => {
    expect(validateLostReason('abc')).toBeNull();
    expect(validateLostReason('Booked elsewhere via MMT')).toBeNull();
  });
});
