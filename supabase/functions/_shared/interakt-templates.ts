// supabase/functions/_shared/interakt-templates.ts
//
// Catalog mapping our internal template_code (the value stored in
// notification_queue.template_code) to the Interakt-side template
// configuration (name + language + variable order + header/buttons).
//
// HOW TO ADD A TEMPLATE
//
// 1. Submit the template to Meta via Interakt dashboard.
// 2. Wait for Meta approval (status: APPROVED).
// 3. Add a row to INTERAKT_TEMPLATES below with the exact Interakt-side name.
// 4. Add a `mapPayload` function that converts notification_queue.payload
//    into the positional body/header/button values the template expects.
// 5. Restart the send-notifications edge function (or redeploy).
//
// Until a template is added here, the dispatcher will raise
// INTERAKT_TEMPLATE_NOT_CONFIGURED and keep the queue row pending so it
// can be retried after the template lands. No silent failures, no skipped
// notifications.

export interface InteraktTemplateDef {
  /** Exact name as it appears on Interakt dashboard (case-sensitive). */
  name: string;
  /** Language code from Interakt: 'en' | 'en_IN' | 'hi' | 'hi_IN' etc. */
  languageCode: string;
  /** Header kind. NONE = no header variable. */
  headerKind: 'NONE' | 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT';
  /** Optional buttons spec (URL with variable / quick reply / etc.). */
  buttons?: Array<{
    kind: 'URL' | 'QUICK_REPLY' | 'PHONE_NUMBER';
    /** Variable key in the payload object (for dynamic URL/text buttons). */
    payloadKey?: string;
  }>;
  /**
   * Maps notification_queue.payload to:
   *   - bodyValues: ordered string array matching the template body's {{1}}, {{2}}...
   *   - headerValues: matching header variables (if templated)
   *   - fileName: media URL/id for IMAGE/VIDEO/DOCUMENT headers
   *   - buttonValues: dynamic-button params
   * Pure function; receives a guest-name + hotel-name helper already resolved.
   */
  mapPayload: (input: TemplateMapInput) => {
    bodyValues: string[];
    headerValues?: string[];
    fileName?: string;
    buttonValues?: Record<string, string[]>;
  };
}

export interface TemplateMapInput {
  guestName: string;
  hotelName: string;
  payload: Record<string, unknown>;
}

// ─── Catalog ────────────────────────────────────────────────────────────────
//
// PLACEHOLDER REGISTRY: fill in the template names + language codes + payload
// mappings once Interakt approvals land. Each entry below is a STUB that
// throws if invoked (so we fail loud, not silent, until the real template
// is wired). When you add a real entry, replace the throw with the actual
// mapPayload function.

const PLACEHOLDER: InteraktTemplateDef = {
  name: '__NOT_CONFIGURED__',
  languageCode: 'en',
  headerKind: 'NONE',
  mapPayload() {
    throw new Error('INTERAKT_TEMPLATE_NOT_CONFIGURED');
  },
};

// ─── service_request_completed (outbound) ────────────────────────────────────
//
// Sent when staff complete a guest's service request (enqueued by the
// trg_enqueue_service_request_completed DB trigger). This is a fully-coded,
// ACTIVE def — the only remaining step is Meta/Interakt approval of a template
// whose NAME and BODY match below; on approval it sends with zero code change.
//
// Submit this template to Meta via Interakt exactly as:
//   Name:     service_request_completed
//   Language: en
//   Category: UTILITY
//   Body:     Hi {{1}}, your request for "{{2}}" at {{3}} is now complete.
//             We hope everything's perfect — just reply here if there's
//             anything else we can do. 🙏
//   (no header, no buttons; 3 body variables in this order)
const SERVICE_REQUEST_COMPLETED_DEF: InteraktTemplateDef = {
  name: 'service_request_completed',
  languageCode: 'en',
  headerKind: 'NONE',
  mapPayload({ guestName, hotelName, payload }) {
    const service = String(payload.service_title ?? 'your request').trim() || 'your request';
    return {
      bodyValues: [
        guestName || 'Valued Guest',
        service,
        hotelName || 'our hotel',
      ],
    };
  },
};

// ─── Lifecycle template defs (outbound) ──────────────────────────────────────
//
// Copy ported faithfully from formatWhatsAppMessage() in the send-notifications
// worker (the META_DIRECT free-text path), so the Interakt template reads
// identically to the message that already shipped. Each is ACTIVE — the only
// remaining step is Meta/Interakt approval of a template whose NAME and BODY
// match the comment above it; on approval it sends with zero code change.
//
// Note on links: these put the deep link in a body variable to match the
// existing copy. If Meta prefers, the link can instead be a URL button at
// submission time — adjust the body + add a `buttons` URL spec here to match.

/** Build the guest pre-check-in deep link from payload.link or payload.token. */
function precheckinLink(payload: Record<string, unknown>): string {
  const link = payload.link;
  if (typeof link === 'string' && link.trim()) return link.trim();
  const token = payload.token;
  if (typeof token === 'string' && token.trim()) {
    return `https://vaiyu.co.in/precheckin/${token.trim()}`;
  }
  return 'https://vaiyu.co.in';
}

/** Format an ISO timestamp as the Indian-style date the worker already uses. */
function formatInDate(value: unknown, fallback: string): string {
  if (!value) return fallback;
  const d = new Date(value as string);
  if (Number.isNaN(d.getTime())) return fallback;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Meta template — name: precheckin_link · lang: en · category: UTILITY
//   Body: Hello {{1}}, please complete your pre-check-in here: {{2}}
const PRECHECKIN_LINK_DEF: InteraktTemplateDef = {
  name: 'precheckin_link',
  languageCode: 'en',
  headerKind: 'NONE',
  mapPayload({ guestName, payload }) {
    return { bodyValues: [guestName || 'Valued Guest', precheckinLink(payload)] };
  },
};

// Meta template — name: precheckin_reminder_1 · lang: en · category: UTILITY
//   Body: Hi {{1}}, your stay is coming up tomorrow! Complete pre-check-in to save time: {{2}}
const PRECHECKIN_REMINDER_1_DEF: InteraktTemplateDef = {
  name: 'precheckin_reminder_1',
  languageCode: 'en',
  headerKind: 'NONE',
  mapPayload({ guestName, payload }) {
    return { bodyValues: [guestName || 'Valued Guest', precheckinLink(payload)] };
  },
};

// Meta template — name: precheckin_reminder_2 · lang: en · category: UTILITY
//   Body: Good morning {{1}}! We look forward to welcoming you today. Quick pre-check-in: {{2}}
const PRECHECKIN_REMINDER_2_DEF: InteraktTemplateDef = {
  name: 'precheckin_reminder_2',
  languageCode: 'en',
  headerKind: 'NONE',
  mapPayload({ guestName, payload }) {
    return { bodyValues: [guestName || 'Valued Guest', precheckinLink(payload)] };
  },
};

// Meta template — name: post_checkout_thankyou · lang: en · category: UTILITY
//   Body: Thank you for staying with us at {{1}}, {{2}}! We hope you had a
//         wonderful experience. We'd love your feedback — it takes just a
//         minute: {{3}}
const POST_CHECKOUT_THANKYOU_DEF: InteraktTemplateDef = {
  name: 'post_checkout_thankyou',
  languageCode: 'en',
  headerKind: 'NONE',
  mapPayload({ guestName, hotelName, payload }) {
    const hotel = String(payload.hotel_name || hotelName ||'our hotel');
    const feedback = payload.feedback_token
      ? `https://vaiyu.co.in/feedback/${String(payload.feedback_token)}`
      : 'https://vaiyu.co.in';
    return { bodyValues: [hotel, guestName || 'Valued Guest', feedback] };
  },
};

// Meta template — name: extension_approved_guest · lang: en · category: UTILITY
//   Body: Hi {{1}}, your stay extension at {{2}} is approved. New checkout:
//         {{3}} ({{4}}). {{5}}
//   {{4}} = "N additional night(s)"; {{5}} = charge line (always non-empty so
//   Meta accepts the variable).
const EXTENSION_APPROVED_GUEST_DEF: InteraktTemplateDef = {
  name: 'extension_approved_guest',
  languageCode: 'en',
  headerKind: 'NONE',
  mapPayload({ guestName, hotelName, payload }) {
    const hotel = String(payload.hotel_name || hotelName ||'the hotel');
    const newDate = formatInDate(payload.new_checkout_at, 'your new date');
    const nights = Number(payload.additional_nights) || 1;
    const nightsLabel = `${nights} additional night${nights === 1 ? '' : 's'}`;
    const amount = Number(payload.additional_amount) || 0;
    const chargeLine = amount > 0
      ? `An additional charge of ₹${amount.toLocaleString('en-IN')} has been added to your folio.`
      : 'No additional charge applies.';
    return { bodyValues: [guestName || 'Valued Guest', hotel, newDate, nightsLabel, chargeLine] };
  },
};

// Meta template — name: extension_rejected_guest · lang: en · category: UTILITY
//   Body: Hi {{1}}, we're unable to extend your stay at {{2}} to {{3}}. {{4}}
//         Please contact the front desk if you'd like to discuss alternatives.
//   {{4}} = reason line (always non-empty).
const EXTENSION_REJECTED_GUEST_DEF: InteraktTemplateDef = {
  name: 'extension_rejected_guest',
  languageCode: 'en',
  headerKind: 'NONE',
  mapPayload({ guestName, hotelName, payload }) {
    const hotel = String(payload.hotel_name || hotelName ||'the hotel');
    const reqDate = formatInDate(payload.requested_checkout_at, 'your requested date');
    const reason = payload.staff_note
      ? `Reason: ${String(payload.staff_note)}.`
      : 'We would be glad to discuss other options with you.';
    return { bodyValues: [guestName || 'Valued Guest', hotel, reqDate, reason] };
  },
};

/**
 * Add one row per approved Interakt template. The KEY here must match the
 * `template_code` column in notification_queue (the value enqueue_* functions
 * write today).
 */
export const INTERAKT_TEMPLATES: Record<string, InteraktTemplateDef> = {
  // ─── Pre-checkin lifecycle ────────────────────────────────────────────────
  // Code-complete & active; gated only by Meta approval of the matching
  // templates (see the *_DEF blocks above). Enqueued today by the precheckin
  // crons/RPCs.
  precheckin_link:       PRECHECKIN_LINK_DEF,
  precheckin_reminder_1: PRECHECKIN_REMINDER_1_DEF,
  precheckin_reminder_2: PRECHECKIN_REMINDER_2_DEF,

  // ─── Stay lifecycle ──────────────────────────────────────────────────────
  // checkin_welcome / checkout_reminder have no enqueue path yet (no trigger
  // writes them) — left as placeholders until that wiring + copy are decided.
  checkin_welcome:       PLACEHOLDER,
  checkout_reminder:     PLACEHOLDER,
  post_checkout_thankyou: POST_CHECKOUT_THANKYOU_DEF,

  // ─── Stay extension ──────────────────────────────────────────────────────
  extension_approved_guest: EXTENSION_APPROVED_GUEST_DEF,
  extension_rejected_guest: EXTENSION_REJECTED_GUEST_DEF,

  // ─── Money ───────────────────────────────────────────────────────────────
  payment_receipt:       PLACEHOLDER,

  // ─── Sales / leads ───────────────────────────────────────────────────────
  quote_send_v1:         PLACEHOLDER,

  // ─── Staff onboarding ────────────────────────────────────────────────────
  staff_invite:          PLACEHOLDER,

  // ─── Inbound service-request hybrid flow ─────────────────────────────────
  how_can_we_help:       PLACEHOLDER,
  housekeeping_ack:      PLACEHOLDER,
  food_menu_link:        PLACEHOLDER,
  concierge_ack:         PLACEHOLDER,
  staff_handoff:         PLACEHOLDER,
  unknown_guest:         PLACEHOLDER,
  which_property:        PLACEHOLDER, // multi-hotel disambiguation

  // ─── Outbound service-request lifecycle ──────────────────────────────────
  // Code-complete & active; gated only by Meta approval of the matching
  // template (see SERVICE_REQUEST_COMPLETED_DEF above). Enqueued by the
  // trg_enqueue_service_request_completed DB trigger.
  service_request_completed: SERVICE_REQUEST_COMPLETED_DEF,
};

// ─── Lead drip ────────────────────────────────────────────────────────────
//
// The drip engine writes ~6 template_codes like `lead_drip_step_1`,
// `lead_drip_step_2`, ... When you set up the drip templates on Interakt,
// register each with the matching key below.
//
// Example:
//   INTERAKT_TEMPLATES.lead_drip_step_1 = { name: 'vaiyu_drip_1', ... }

// ─── Lookup helpers ─────────────────────────────────────────────────────────

/** True if the template_code has a non-placeholder entry registered. */
export function isTemplateConfigured(templateCode: string): boolean {
  const def = INTERAKT_TEMPLATES[templateCode];
  return !!def && def.name !== '__NOT_CONFIGURED__';
}

export function getTemplate(templateCode: string): InteraktTemplateDef | null {
  return INTERAKT_TEMPLATES[templateCode] ?? null;
}

/** List configured templates (for owner UI). */
export function listConfiguredTemplates(): Array<{ code: string; name: string; language: string }> {
  return Object.entries(INTERAKT_TEMPLATES)
    .filter(([, def]) => def.name !== '__NOT_CONFIGURED__')
    .map(([code, def]) => ({ code, name: def.name, language: def.languageCode }));
}
