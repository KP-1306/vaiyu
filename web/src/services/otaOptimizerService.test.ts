// web/src/services/otaOptimizerService.test.ts
//
// Service-layer tests (pure TS — no live DB). Validates error code extraction,
// friendly error rendering, and the summarizeOtaReadiness aggregator.

import { describe, expect, it } from 'vitest';

import {
  extractOtaErrorCode,
  friendlyOtaError,
  summarizeOtaReadiness,
} from './otaOptimizerService';
import type {
  HotelOTAReadinessRow,
  HotelOTAReadinessSummaryRow,
} from '../types/otaOptimizer';

function row(partial: Partial<HotelOTAReadinessRow>): HotelOTAReadinessRow {
  return {
    hotel_id: 'h1',
    hotel_slug: 'hotel-slug',
    hotel_name: 'Hotel',
    ota: 'MMT',
    wizard_completed_at: '2026-05-01T00:00:00Z',
    effective_mountain: true,
    ota_score: 0,
    band: 'CRITICAL',
    oldest_review_at: '2026-04-01T00:00:00Z',
    complete_count: 0,
    partial_count: 0,
    missing_count: 0,
    unknown_count: 0,
    na_count: 0,
    stale_count: 0,
    total_count: 0,
    ...partial,
  };
}

describe('extractOtaErrorCode', () => {
  it('parses known codes from PG error message', () => {
    expect(extractOtaErrorCode({ message: 'ERROR: NOT_A_MEMBER' })).toBe('NOT_A_MEMBER');
    expect(extractOtaErrorCode({ message: 'something something OTAS_REQUIRED foo' })).toBe('OTAS_REQUIRED');
    expect(extractOtaErrorCode({ message: 'ITEM_KEY_NOT_IN_CATALOG' })).toBe('ITEM_KEY_NOT_IN_CATALOG');
    expect(extractOtaErrorCode({ message: 'OTA_NOT_APPLICABLE_FOR_ITEM detail' })).toBe('OTA_NOT_APPLICABLE_FOR_ITEM');
    expect(extractOtaErrorCode({ message: 'MOUNTAIN_ITEM_NOT_APPLICABLE blah' })).toBe('MOUNTAIN_ITEM_NOT_APPLICABLE');
  });

  it('returns null for unknown patterns', () => {
    expect(extractOtaErrorCode({ message: 'random garbage' })).toBe(null);
    expect(extractOtaErrorCode({ message: 'some_lowercase_thing' })).toBe(null);
    expect(extractOtaErrorCode(null)).toBe(null);
    expect(extractOtaErrorCode(undefined)).toBe(null);
    expect(extractOtaErrorCode({})).toBe(null);
  });
});

describe('friendlyOtaError', () => {
  it('returns human copy for each known code', () => {
    expect(friendlyOtaError('NOT_A_MEMBER', 'fb')).toMatch(/permission/);
    expect(friendlyOtaError('OTAS_REQUIRED', 'fb')).toMatch(/at least one OTA/);
    expect(friendlyOtaError('ITEMS_TOO_MANY', 'fb')).toMatch(/200/);
    expect(friendlyOtaError('ITEM_KEY_NOT_IN_CATALOG', 'fb')).toMatch(/Refresh the page/);
    expect(friendlyOtaError('OTA_NOT_APPLICABLE_FOR_ITEM', 'fb')).toMatch(/does not apply/);
    expect(friendlyOtaError('MOUNTAIN_ITEM_NOT_APPLICABLE', 'fb')).toMatch(/mountain/);
    expect(friendlyOtaError('NOTE_TOO_LONG', 'fb')).toMatch(/2000/);
    expect(friendlyOtaError('NO_STATES_FOR_OTA', 'fb')).toMatch(/set a few statuses/);
  });

  it('returns fallback for null/UNKNOWN_ERROR', () => {
    expect(friendlyOtaError(null, 'custom fb')).toBe('custom fb');
    expect(friendlyOtaError('UNKNOWN_ERROR', 'custom fb')).toBe('custom fb');
  });
});

describe('summarizeOtaReadiness', () => {
  it('returns null when neither summary nor perOta rows exist', () => {
    expect(summarizeOtaReadiness(null, [])).toBe(null);
  });

  it('uses summary view row when present', () => {
    const sum: HotelOTAReadinessSummaryRow = {
      hotel_id: 'h1',
      hotel_slug: 'hotel-slug',
      hotel_name: 'Hotel',
      wizard_completed_at: '2026-05-01T00:00:00Z',
      effective_mountain: true,
      active_ota_count: 3,
      overall_score: 67,
      overall_band: 'MODERATE',
      oldest_review_at: '2026-04-01T00:00:00Z',
      total_gap_count: 20,
      total_stale_count: 4,
    };
    const perOta = [
      row({ ota: 'MMT', ota_score: 80, band: 'PREMIUM' }),
      row({ ota: 'BOOKING_COM', ota_score: 60, band: 'MODERATE' }),
      row({ ota: 'AIRBNB', ota_score: 40, band: 'CRITICAL' }),
    ];
    const res = summarizeOtaReadiness(sum, perOta);
    expect(res).not.toBe(null);
    expect(res!.overallScore).toBe(67);
    expect(res!.overallBand).toBe('MODERATE');
    expect(res!.activeOtaCount).toBe(3);
    expect(res!.perOta[0].ota).toBe('AIRBNB'); // worst first
    expect(res!.focusOta?.ota).toBe('AIRBNB');
    expect(res!.wizardCompletedAt).toBe('2026-05-01T00:00:00Z');
    expect(res!.effectiveMountain).toBe(true);
  });

  it('falls back to computing from perOta when summary missing', () => {
    const perOta = [
      row({ ota: 'MMT', ota_score: 80, band: 'PREMIUM', missing_count: 1, unknown_count: 2, stale_count: 0 }),
      row({ ota: 'BOOKING_COM', ota_score: 60, band: 'MODERATE', missing_count: 3, unknown_count: 4, stale_count: 1 }),
    ];
    const res = summarizeOtaReadiness(null, perOta);
    expect(res).not.toBe(null);
    expect(res!.overallScore).toBe(70);
    expect(res!.overallBand).toBe('MODERATE');
    expect(res!.activeOtaCount).toBe(2);
    expect(res!.totalGapCount).toBe(10); // 1+2+3+4
    expect(res!.totalStaleCount).toBe(1);
  });

  it('sorts perOta worst-first by band then by score', () => {
    const perOta = [
      row({ ota: 'MMT', ota_score: 90, band: 'PREMIUM' }),
      row({ ota: 'BOOKING_COM', ota_score: 30, band: 'CRITICAL' }),
      row({ ota: 'AIRBNB', ota_score: 40, band: 'CRITICAL' }),
      row({ ota: 'AGODA', ota_score: 70, band: 'MODERATE' }),
    ];
    const res = summarizeOtaReadiness(null, perOta);
    expect(res!.perOta.map((r) => r.ota)).toEqual([
      'BOOKING_COM',  // CRITICAL, score 30
      'AIRBNB',       // CRITICAL, score 40
      'AGODA',        // MODERATE, score 70
      'MMT',          // PREMIUM, score 90
    ]);
  });

  it('picks the worst OTA as focusOta', () => {
    const perOta = [
      row({ ota: 'MMT', ota_score: 80, band: 'PREMIUM' }),
      row({ ota: 'AIRBNB', ota_score: 35, band: 'CRITICAL' }),
    ];
    const res = summarizeOtaReadiness(null, perOta);
    expect(res!.focusOta?.ota).toBe('AIRBNB');
  });
});
