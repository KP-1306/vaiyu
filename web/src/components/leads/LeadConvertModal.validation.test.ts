import { describe, expect, it } from 'vitest';
import {
  validateConvertInput,
  hasConvertErrors,
  type ConvertInput,
} from './LeadConvertModal.validation';

const baseInput: ConvertInput = {
  guestName: 'Priya Sharma',
  guestPhone: '+919876543210',
  guestEmail: '',
  checkIn: '2026-07-10',
  checkOut: '2026-07-12',
  adults: 2,
  children: 0,
  selectedRooms: [
    { room_id: 'R1', room_type_id: 'RT1', amount_per_night: 2500 },
  ],
};

describe('validateConvertInput', () => {
  it('passes valid input', () => {
    expect(validateConvertInput(baseInput)).toEqual({});
  });

  it('flags empty guest name', () => {
    expect(validateConvertInput({ ...baseInput, guestName: '' }).guestName).toBe(
      'Guest name is required',
    );
    expect(validateConvertInput({ ...baseInput, guestName: '   ' }).guestName).toBe(
      'Guest name is required',
    );
  });

  it('flags missing phone + email', () => {
    const out = validateConvertInput({ ...baseInput, guestPhone: '', guestEmail: '' });
    expect(out.guestPhone).toBe('Phone or email is required');
    expect(out.guestEmail).toBe('Phone or email is required');
  });

  it('passes with only email', () => {
    expect(
      validateConvertInput({ ...baseInput, guestPhone: '', guestEmail: 'a@b.com' }),
    ).toEqual({});
  });

  it('flags missing check-in', () => {
    expect(validateConvertInput({ ...baseInput, checkIn: '' }).checkIn).toBe(
      'Check-in date is required',
    );
  });

  it('flags missing check-out', () => {
    expect(validateConvertInput({ ...baseInput, checkOut: '' }).checkOut).toBe(
      'Check-out date is required',
    );
  });

  it('flags checkout <= checkin', () => {
    expect(
      validateConvertInput({ ...baseInput, checkIn: '2026-07-10', checkOut: '2026-07-10' })
        .checkOut,
    ).toBe('Check-out must be after check-in');
    expect(
      validateConvertInput({ ...baseInput, checkIn: '2026-07-10', checkOut: '2026-07-09' })
        .checkOut,
    ).toBeDefined();
  });

  it('flags adults < 1', () => {
    expect(validateConvertInput({ ...baseInput, adults: 0 }).adults).toBe(
      'At least 1 adult required',
    );
  });

  it('flags negative children', () => {
    expect(validateConvertInput({ ...baseInput, children: -1 }).children).toBe(
      'Cannot be negative',
    );
  });

  it('flags empty room selection', () => {
    expect(validateConvertInput({ ...baseInput, selectedRooms: [] }).rooms).toBe(
      'Select at least one room',
    );
  });

  it('flags negative rate per row', () => {
    const out = validateConvertInput({
      ...baseInput,
      selectedRooms: [
        { room_id: 'R1', room_type_id: 'RT1', amount_per_night: -100 },
        { room_id: 'R2', room_type_id: 'RT1', amount_per_night: 2000 },
      ],
    });
    expect(out.rates?.R1).toBeDefined();
    expect(out.rates?.R2).toBeUndefined();
  });

  it('allows rate=0 (comp/staff)', () => {
    const out = validateConvertInput({
      ...baseInput,
      selectedRooms: [{ room_id: 'R1', room_type_id: 'RT1', amount_per_night: 0 }],
    });
    expect(out.rates).toBeUndefined();
  });

  it('flags NaN rate', () => {
    const out = validateConvertInput({
      ...baseInput,
      selectedRooms: [{ room_id: 'R1', room_type_id: 'RT1', amount_per_night: NaN }],
    });
    expect(out.rates?.R1).toBeDefined();
  });
});

describe('hasConvertErrors', () => {
  it('returns false for empty', () => {
    expect(hasConvertErrors({})).toBe(false);
  });
  it('returns true when any top-level field has an error', () => {
    expect(hasConvertErrors({ guestName: 'required' })).toBe(true);
    expect(hasConvertErrors({ rooms: 'select one' })).toBe(true);
  });
  it('returns true when any rate has an error', () => {
    expect(hasConvertErrors({ rates: { R1: 'bad' } })).toBe(true);
  });
  it('returns false when rates is empty object', () => {
    expect(hasConvertErrors({ rates: {} })).toBe(false);
  });
});
