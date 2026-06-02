// Unit tests for client-side invariants. The server re-validates everything
// (PII regex via SQL, MIME/size via DB CHECK + RPC), but these are the
// guardrails that prevent obvious mistakes from ever leaving the browser.

import { describe, it, expect } from 'vitest';
import {
  pickBucketForZone,
  buildStoragePath,
  validateBeforeUpload,
  newIdempotencyKey,
  extractAssetErrorCode,
  friendlyAssetError,
} from './digitalAssetService';

function makeFile(name: string, type: string, sizeBytes: number): File {
  return new File([new Uint8Array(sizeBytes)], name, { type });
}

describe('pickBucketForZone', () => {
  it('routes PUBLIC_MARKETING to hotel-assets', () => {
    expect(pickBucketForZone('PUBLIC_MARKETING')).toBe('hotel-assets');
  });

  it('routes PRIVATE_VAULT to hotel-asset-vault', () => {
    expect(pickBucketForZone('PRIVATE_VAULT')).toBe('hotel-asset-vault');
  });
});

describe('buildStoragePath', () => {
  it('builds a hotel-scoped path with the dam/ prefix', () => {
    const path = buildStoragePath({
      hotelId: '11111111-2222-3333-4444-555555555555',
      requirementCode: 'verification_signboard_exterior',
      fileName: 'signboard.jpg',
      idempotencyKey: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    });
    expect(path).toBe(
      '11111111-2222-3333-4444-555555555555/dam/verification_signboard_exterior/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jpg'
    );
  });

  it('lowercases the extension', () => {
    const path = buildStoragePath({
      hotelId: 'abc',
      requirementCode: 'x',
      fileName: 'photo.JPEG',
      idempotencyKey: 'k',
    });
    expect(path.endsWith('.jpeg')).toBe(true);
  });

  it('strips dodgy characters from the extension', () => {
    const path = buildStoragePath({
      hotelId: 'abc',
      requirementCode: 'x',
      fileName: 'file.j p g?foo=1',
      idempotencyKey: 'k',
    });
    // Dodgy characters stripped, then truncated to 6 chars.
    expect(path.endsWith('.jpgfoo')).toBe(true);
  });

  it('falls back to .bin when no extension present', () => {
    const path = buildStoragePath({
      hotelId: 'abc',
      requirementCode: 'x',
      fileName: 'no_extension',
      idempotencyKey: 'k',
    });
    expect(path.endsWith('.bin')).toBe(true);
  });
});

describe('validateBeforeUpload', () => {
  it('accepts a normal JPEG', () => {
    const result = validateBeforeUpload(makeFile('signboard.jpg', 'image/jpeg', 100_000));
    expect(result.ok).toBe(true);
  });

  it('rejects oversized files (> 10 MB)', () => {
    const result = validateBeforeUpload(makeFile('huge.png', 'image/png', 11 * 1024 * 1024));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('FILE_TOO_LARGE');
  });

  it('rejects zero-byte files', () => {
    const result = validateBeforeUpload(makeFile('empty.png', 'image/png', 0));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('FILE_TOO_LARGE');
  });

  it('rejects unsupported MIME types', () => {
    const result = validateBeforeUpload(makeFile('script.js', 'application/javascript', 100));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('MIME_NOT_ALLOWED');
  });

  it('rejects filenames that look like PII (aadhaar)', () => {
    const result = validateBeforeUpload(makeFile('aadhaar.jpg', 'image/jpeg', 100));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('PII_FILENAME_REJECTED');
  });

  it('rejects filenames that look like PII (PAN card)', () => {
    const result = validateBeforeUpload(makeFile('pan-card.png', 'image/png', 100));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('PII_FILENAME_REJECTED');
  });

  it('rejects filenames that look like PII (passport)', () => {
    const result = validateBeforeUpload(makeFile('Passport.pdf', 'application/pdf', 100));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('PII_FILENAME_REJECTED');
  });

  it('rejects filenames that look like PII (bank statement)', () => {
    const result = validateBeforeUpload(makeFile('bank_statement.pdf', 'application/pdf', 100));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('PII_FILENAME_REJECTED');
  });

  it('does NOT false-positive panorama.jpg', () => {
    const result = validateBeforeUpload(makeFile('panorama.jpg', 'image/jpeg', 100));
    expect(result.ok).toBe(true);
  });

  it('does NOT false-positive japanese-temple.jpg', () => {
    const result = validateBeforeUpload(makeFile('japanese-temple.jpg', 'image/jpeg', 100));
    expect(result.ok).toBe(true);
  });

  it('accepts HEIC by extension when browser returns empty MIME', () => {
    const result = validateBeforeUpload(makeFile('photo.heic', '', 1000));
    expect(result.ok).toBe(true);
  });
});

describe('newIdempotencyKey', () => {
  it('returns a UUID-ish string', () => {
    const k = newIdempotencyKey();
    expect(k).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('generates distinct values across calls', () => {
    const a = newIdempotencyKey();
    const b = newIdempotencyKey();
    expect(a).not.toBe(b);
  });
});

describe('extractAssetErrorCode', () => {
  it('extracts PII_FILENAME_REJECTED from an error message', () => {
    const err = new Error('PII_FILENAME_REJECTED: Personal identity documents are not accepted.');
    expect(extractAssetErrorCode(err)).toBe('PII_FILENAME_REJECTED');
  });

  it('extracts WRONG_BUCKET_FOR_ZONE', () => {
    const err = new Error('WRONG_BUCKET_FOR_ZONE: requirement X expects bucket Y, got Z');
    expect(extractAssetErrorCode(err)).toBe('WRONG_BUCKET_FOR_ZONE');
  });

  it('returns null for unknown errors', () => {
    expect(extractAssetErrorCode(new Error('something else exploded'))).toBeNull();
  });
});

describe('friendlyAssetError', () => {
  it('rewrites PII rejection as owner-friendly copy', () => {
    const msg = friendlyAssetError('PII_FILENAME_REJECTED', 'raw');
    expect(msg.toLowerCase()).toContain('personal id');
  });

  it('rewrites FILE_TOO_LARGE with the cap', () => {
    const msg = friendlyAssetError('FILE_TOO_LARGE', 'raw');
    expect(msg).toContain('10 MB');
  });

  it('rewrites MIME_NOT_ALLOWED with allowed list', () => {
    const msg = friendlyAssetError('MIME_NOT_ALLOWED', 'raw');
    expect(msg).toMatch(/JPG|PNG|PDF/i);
  });

  it('returns fallback when code is null', () => {
    const msg = friendlyAssetError(null, 'fallback text');
    expect(msg).toBe('fallback text');
  });
});
