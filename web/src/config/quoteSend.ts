// web/src/config/quoteSend.ts
//
// Quote-send v1 feature flag — gates the "Send via email" button + PDF
// rendering surface on QuoteDrafts. Default OFF; flip per environment.

export const QUOTE_SEND_V1_ENABLED = true;

/** WhatsApp channel is stubbed until Meta template approval lands. */
export const QUOTE_SEND_WHATSAPP_AVAILABLE = false;

/** Edge function names. */
export const QUOTE_SEND_FN = 'send-quote';
export const QUOTE_RENDER_PDF_FN = 'render-quote-pdf';
