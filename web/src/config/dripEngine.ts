// web/src/config/dripEngine.ts
//
// Lead Drip Engine v1 feature flag. Default OFF; flip per environment.
// Gated separately from the Follow-up Radar UI so we can ship the radar
// without the automated send pipeline, or vice versa.

export const DRIP_ENGINE_V1_ENABLED = true;

/** Owner-facing label for the surface. */
export const DRIP_RULE_KIND_LABEL: Record<string, string> = {
  GENERAL_ENQUIRY: 'New enquiry follow-up',
  QUOTE_SENT: 'Post-quote nudge',
  WALKIN_LOST: 'Walk-in win-back',
};

/** Operator-facing copy explaining what pause/cancel/etc reasons mean. */
export const DRIP_PAUSE_REASON_LABEL: Record<string, string> = {
  LEAD_QUALIFIED: 'Lead qualified — operator engaged',
  LEAD_WON: 'Lead won',
  LEAD_CONVERTED: 'Booked',
  LEAD_LOST: 'Lead lost',
  SUPERSEDED_BY_QUOTE: 'Quote sent — new sequence took over',
  MANUAL: 'Paused manually',
  BOUNCED: 'Email bounced',
  BOUNCED_TRANSIENT: 'Email bounced (temporary)',
  BOUNCED_PERMANENT: 'Email bounced (permanent)',
  COMPLAINT: 'Guest marked as spam',
  LEAD_REPLIED_WHATSAPP: 'Guest replied on WhatsApp',
  LEAD_REPLIED_EMAIL: 'Guest replied on email',
  LEAD_REPLIED_SMS: 'Guest replied on SMS',
  NO_CHANNEL: 'No email on file',
  RULE_INACTIVE: 'Rule disabled',
};
