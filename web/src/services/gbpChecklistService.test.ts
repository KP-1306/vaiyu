// web/src/services/gbpChecklistService.test.ts

import { describe, expect, it } from 'vitest';

import { extractGBPErrorCode, friendlyGBPError } from './gbpChecklistService';

describe('extractGBPErrorCode', () => {
  it('parses known codes from PG error message', () => {
    expect(extractGBPErrorCode({ message: 'ERROR: NOT_A_MEMBER' })).toBe('NOT_A_MEMBER');
    expect(extractGBPErrorCode({ message: 'ITEM_KEY_NOT_IN_CATALOG detail' })).toBe('ITEM_KEY_NOT_IN_CATALOG');
    expect(extractGBPErrorCode({ message: 'ITEM_NOT_SELF_ATTESTABLE' })).toBe('ITEM_NOT_SELF_ATTESTABLE');
    expect(extractGBPErrorCode({ message: 'ATTESTATION_LOCKED — only verifying manager' })).toBe('ATTESTATION_LOCKED');
    expect(extractGBPErrorCode({ message: 'REASON_REQUIRED' })).toBe('REASON_REQUIRED');
  });

  it('returns null for unknown patterns', () => {
    expect(extractGBPErrorCode({ message: 'random garbage' })).toBe(null);
    expect(extractGBPErrorCode(null)).toBe(null);
    expect(extractGBPErrorCode(undefined)).toBe(null);
    expect(extractGBPErrorCode({})).toBe(null);
  });
});

describe('friendlyGBPError', () => {
  it('returns human copy for each known code', () => {
    expect(friendlyGBPError('NOT_A_MEMBER', 'fb')).toMatch(/permission/i);
    expect(friendlyGBPError('NOT_A_MANAGER', 'fb')).toMatch(/owner or manager/i);
    expect(friendlyGBPError('ITEM_KEY_NOT_IN_CATALOG', 'fb')).toMatch(/Refresh/i);
    expect(friendlyGBPError('ITEM_NOT_SELF_ATTESTABLE', 'fb')).toMatch(/read-only/i);
    expect(friendlyGBPError('NOTHING_TO_VERIFY', 'fb')).toMatch(/self-attest/i);
    expect(friendlyGBPError('ATTESTATION_LOCKED', 'fb')).toMatch(/manager who verified/i);
    expect(friendlyGBPError('REASON_REQUIRED', 'fb')).toMatch(/reason/i);
    expect(friendlyGBPError('REASON_TOO_LONG', 'fb')).toMatch(/1000/);
    expect(friendlyGBPError('EVIDENCE_URL_TOO_LONG', 'fb')).toMatch(/2048/);
  });

  it('returns fallback for null/UNKNOWN_ERROR', () => {
    expect(friendlyGBPError(null, 'custom')).toBe('custom');
    expect(friendlyGBPError('UNKNOWN_ERROR', 'custom')).toBe('custom');
  });
});
