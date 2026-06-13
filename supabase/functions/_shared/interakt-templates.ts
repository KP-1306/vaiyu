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

/**
 * Add one row per approved Interakt template. The KEY here must match the
 * `template_code` column in notification_queue (the value enqueue_* functions
 * write today).
 */
export const INTERAKT_TEMPLATES: Record<string, InteraktTemplateDef> = {
  // ─── Pre-checkin lifecycle ────────────────────────────────────────────────
  precheckin_link:       PLACEHOLDER,
  precheckin_reminder_1: PLACEHOLDER,
  precheckin_reminder_2: PLACEHOLDER,

  // ─── Stay lifecycle ──────────────────────────────────────────────────────
  checkin_welcome:       PLACEHOLDER,
  checkout_reminder:     PLACEHOLDER,
  post_checkout_thankyou: PLACEHOLDER,

  // ─── Stay extension ──────────────────────────────────────────────────────
  extension_approved_guest: PLACEHOLDER,
  extension_rejected_guest: PLACEHOLDER,

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
