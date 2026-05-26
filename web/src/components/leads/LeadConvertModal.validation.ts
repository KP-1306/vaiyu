// web/src/components/leads/LeadConvertModal.validation.ts
//
// Pure validation for the convert-to-booking form. Mirrors server-side
// _validate_walkin_args + adds the form-specific cross-field rules.

export interface ConvertValidationErrors {
  guestName?: string;
  guestPhone?: string;
  guestEmail?: string;
  checkIn?: string;
  checkOut?: string;
  adults?: string;
  children?: string;
  rooms?: string;
  /** Per-row rate errors keyed by room_id. */
  rates?: Record<string, string>;
}

export interface ConvertInput {
  guestName: string;
  guestPhone: string;
  guestEmail: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  selectedRooms: Array<{
    room_id: string;
    room_type_id: string;
    amount_per_night: number;
  }>;
}

export function validateConvertInput(input: ConvertInput): ConvertValidationErrors {
  const errors: ConvertValidationErrors = {};

  if (!input.guestName || input.guestName.trim() === '') {
    errors.guestName = 'Guest name is required';
  }

  const hasPhone = !!input.guestPhone && input.guestPhone.trim() !== '';
  const hasEmail = !!input.guestEmail && input.guestEmail.trim() !== '';
  if (!hasPhone && !hasEmail) {
    errors.guestPhone = 'Phone or email is required';
    errors.guestEmail = 'Phone or email is required';
  }

  if (!input.checkIn) errors.checkIn = 'Check-in date is required';
  if (!input.checkOut) errors.checkOut = 'Check-out date is required';

  if (input.checkIn && input.checkOut && input.checkOut <= input.checkIn) {
    errors.checkOut = 'Check-out must be after check-in';
  }

  if (input.adults < 1) errors.adults = 'At least 1 adult required';
  if (input.children < 0) errors.children = 'Cannot be negative';

  if (input.selectedRooms.length === 0) {
    errors.rooms = 'Select at least one room';
  }

  const rateErrors: Record<string, string> = {};
  for (const room of input.selectedRooms) {
    if (!Number.isFinite(room.amount_per_night) || room.amount_per_night < 0) {
      rateErrors[room.room_id] = 'Rate must be 0 or greater';
    }
  }
  if (Object.keys(rateErrors).length > 0) errors.rates = rateErrors;

  return errors;
}

export function hasConvertErrors(errors: ConvertValidationErrors): boolean {
  if (errors.guestName || errors.guestPhone || errors.guestEmail) return true;
  if (errors.checkIn || errors.checkOut) return true;
  if (errors.adults || errors.children) return true;
  if (errors.rooms) return true;
  if (errors.rates && Object.keys(errors.rates).length > 0) return true;
  return false;
}
