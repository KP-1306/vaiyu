import { describe, expect, it } from 'vitest';
import { humanizeError, extractFieldErrors } from './LeadQuickAddModal.errorMapping';
import { LeadServiceError } from '../../services/leadService';
import type { LeadErrorCode } from '../../types/lead';

function err(code: LeadErrorCode, message = 'msg') {
  return new LeadServiceError(code, message);
}

describe('humanizeError', () => {
  it('returns user-friendly text for NOT_AUTHORIZED', () => {
    expect(humanizeError(err('NOT_AUTHORIZED'))).toMatch(/permission/i);
  });
  it('returns user-friendly text for INVALID_CONTACT', () => {
    expect(humanizeError(err('INVALID_CONTACT'))).toMatch(/phone.*email|email.*phone/i);
  });
  it('returns user-friendly text for INVALID_NAME', () => {
    expect(humanizeError(err('INVALID_NAME'))).toMatch(/name/i);
  });
  it('returns user-friendly text for INVALID_DATES', () => {
    expect(humanizeError(err('INVALID_DATES'))).toMatch(/check.?out|check.?in/i);
  });
  it('returns user-friendly text for SESSION_EXPIRED', () => {
    expect(humanizeError(err('SESSION_EXPIRED'))).toMatch(/session|sign in/i);
  });
  it('falls back to original message for UNKNOWN_ERROR', () => {
    expect(humanizeError(err('UNKNOWN_ERROR', 'specific server msg'))).toContain('specific server msg');
  });
  it('falls back gracefully for codes without a specific mapping', () => {
    const out = humanizeError(err('BOOKING_REQUIRED', 'fallback msg'));
    expect(out.length).toBeGreaterThan(0);
  });
});

describe('extractFieldErrors', () => {
  it('flags both phone+email fields for INVALID_CONTACT', () => {
    const out = extractFieldErrors(err('INVALID_CONTACT'));
    expect(out.contactPhone).toBeDefined();
    expect(out.contactEmail).toBeDefined();
  });
  it('flags name for INVALID_NAME', () => {
    expect(extractFieldErrors(err('INVALID_NAME')).contactName).toBeDefined();
  });
  it('flags checkOut for INVALID_DATES', () => {
    expect(extractFieldErrors(err('INVALID_DATES')).checkOut).toBeDefined();
  });
  it('flags all party fields for INVALID_PARTY', () => {
    const out = extractFieldErrors(err('INVALID_PARTY'));
    expect(out.partyAdults).toBeDefined();
    expect(out.partyChildren).toBeDefined();
    expect(out.roomCount).toBeDefined();
  });
  it('returns empty for non-mapped codes', () => {
    expect(extractFieldErrors(err('NOT_AUTHORIZED'))).toEqual({});
    expect(extractFieldErrors(err('UNKNOWN_ERROR'))).toEqual({});
  });
});
