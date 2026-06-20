// web/src/i18n/ownerGlossary.ts
// Curated consistency layer for owner-console Hindi authoring.
//
// Two jobs, both load-bearing (enforced by ownerGlossary.test.ts):
//
//   1. OWNER_GLOSSARY — the canonical Hindi for high-frequency operational
//      nouns, so the SAME English term renders the SAME Hindi everywhere in the
//      console. Front-desk loanwords keep the form staff actually say (बुकिंग,
//      रूम, चेक-इन) rather than a dictionary calque — same philosophy as the
//      menu dict (बटर चिकन, not मक्खन चिकन). The test asserts every owner-*.json
//      value that is EXACTLY one of these terms maps to the glossary's Hindi.
//
//   2. ENGLISH_RETAINED — industry acronyms / brands / units that must stay in
//      English even in Hindi mode (Devanagari-ising "RevPAR" → रेवपार reads
//      worse, not better). The test asserts that wherever an English value
//      contains one of these tokens, the Hindi value still contains it verbatim.
//
// Keys are lowercase, looked up case-insensitively by the test.

export const OWNER_GLOSSARY: Readonly<Record<string, string>> = {
  booking: 'बुकिंग',
  room: 'रूम',
  guest: 'गेस्ट',
  'check-in': 'चेक-इन',
  checkin: 'चेक-इन',
  'check-out': 'चेक-आउट',
  checkout: 'चेक-आउट',
  housekeeping: 'हाउसकीपिंग',
  payment: 'पेमेंट',
  folio: 'फोलियो',
  occupancy: 'ऑक्यूपेंसी',
  revenue: 'रेवेन्यू',
  staff: 'स्टाफ़',
  service: 'सर्विस',
  dashboard: 'डैशबोर्ड',
  settings: 'सेटिंग्स',
  arrivals: 'अराइवल्स',
  pickup: 'पिकअप',
  rooms: 'रूम्स',
  bookings: 'बुकिंग्स',
};

// Industry English that survives Hindi mode verbatim. Compared case-sensitively
// with word boundaries, so "ID" matches "Govt ID" but not "VALID"/"Identity".
export const ENGLISH_RETAINED: readonly string[] = [
  'RevPAR',
  'ADR',
  'GMB',
  'OTA',
  'KYC',
  'SLA',
  'QR',
  'UPI',
  'GST',
  'GSTIN',
  'HSN',
  'PMS',
  'POS',
  'CRM',
  'WhatsApp',
  'Razorpay',
  'VAiyu',
  'OTP',
  'PDF',
  'CSV',
  'API',
  'ID',
];
