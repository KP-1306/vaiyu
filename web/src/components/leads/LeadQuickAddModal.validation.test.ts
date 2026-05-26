import { describe, expect, it } from 'vitest';
import {
  validateLeadInput,
  hasValidationErrors,
  firstErrorField,
} from './LeadQuickAddModal.validation';
import type { CreateLeadInput } from '../../types/lead';

const baseInput: CreateLeadInput = {
  hotelId: 'H1',
  source: 'WALK_IN',
  contactName: 'Test Guest',
  contactPhone: '+919876543210',
};

describe('validateLeadInput', () => {
  it('passes valid input', () => {
    expect(validateLeadInput(baseInput)).toEqual({});
  });

  it('flags empty name', () => {
    expect(validateLeadInput({ ...baseInput, contactName: '' }).contactName).toBe('Name is required');
    expect(validateLeadInput({ ...baseInput, contactName: '   ' }).contactName).toBe('Name is required');
  });

  it('flags missing both phone and email', () => {
    const errors = validateLeadInput({
      ...baseInput,
      contactPhone: undefined,
      contactEmail: undefined,
    });
    expect(errors.contactPhone).toBe('Phone or email is required');
    expect(errors.contactEmail).toBe('Phone or email is required');
  });

  it('passes when only phone given', () => {
    expect(
      validateLeadInput({
        ...baseInput,
        contactPhone: '+919876543210',
        contactEmail: undefined,
      }),
    ).toEqual({});
  });

  it('passes when only email given', () => {
    expect(
      validateLeadInput({
        ...baseInput,
        contactPhone: undefined,
        contactEmail: 'guest@example.com',
      }),
    ).toEqual({});
  });

  it('flags check-out == check-in as invalid', () => {
    expect(
      validateLeadInput({
        ...baseInput,
        checkIn: '2026-07-10',
        checkOut: '2026-07-10',
      }).checkOut,
    ).toBe('Check-out must be after check-in');
  });

  it('flags check-out < check-in', () => {
    expect(
      validateLeadInput({
        ...baseInput,
        checkIn: '2026-07-10',
        checkOut: '2026-07-09',
      }).checkOut,
    ).toBeDefined();
  });

  it('passes valid date range', () => {
    expect(
      validateLeadInput({
        ...baseInput,
        checkIn: '2026-07-10',
        checkOut: '2026-07-12',
      }),
    ).toEqual({});
  });

  it('passes with only check-in (no check-out)', () => {
    expect(validateLeadInput({ ...baseInput, checkIn: '2026-07-10' })).toEqual({});
  });

  it('flags negative party_adults / party_children', () => {
    expect(validateLeadInput({ ...baseInput, partyAdults: -1 }).partyAdults).toBeDefined();
    expect(validateLeadInput({ ...baseInput, partyChildren: -1 }).partyChildren).toBeDefined();
  });

  it('flags zero rooms', () => {
    expect(validateLeadInput({ ...baseInput, roomCount: 0 }).roomCount).toBeDefined();
  });
});

describe('hasValidationErrors', () => {
  it('returns false for empty errors', () => {
    expect(hasValidationErrors({})).toBe(false);
  });
  it('returns true when any field has an error', () => {
    expect(hasValidationErrors({ contactName: 'required' })).toBe(true);
  });
  it('ignores undefined values', () => {
    expect(hasValidationErrors({ contactName: undefined })).toBe(false);
  });
});

describe('firstErrorField', () => {
  it('returns null for empty errors', () => {
    expect(firstErrorField({})).toBeNull();
  });
  it('returns name before phone (declared order)', () => {
    expect(
      firstErrorField({
        contactName: 'required',
        contactPhone: 'required',
      }),
    ).toBe('contactName');
  });
  it('returns phone if name is fine', () => {
    expect(firstErrorField({ contactPhone: 'required' })).toBe('contactPhone');
  });
});
