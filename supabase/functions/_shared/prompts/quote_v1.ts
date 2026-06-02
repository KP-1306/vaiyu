// supabase/functions/_shared/prompts/quote_v1.ts
//
// Versioned system prompt + structured-input builder for ai-generate-quote.
//
// CRITICAL RULES (read before changing):
//   1. NEVER concatenate raw user-supplied text into the system prompt. Guest
//      name, package text, owner notes, etc. travel inside a JSON payload that
//      the user-message references — the model sees clearly-delimited data,
//      never a free-form blend with instructions.
//   2. Numeric facts the model receives are the operator's typed values. The
//      model must echo them verbatim, never invent a different number.
//   3. The verbatim disclaimer line is part of the model's instructions AND
//      we re-append it server-side after generation as defense-in-depth.
//   4. Bumping the version constant below requires a code review — older
//      callers may rely on the previous output shape.

export const QUOTE_PROMPT_VERSION = "quote_v1";

export const QUOTE_DISCLAIMER_LINE =
  "Indicative proposal only. Final room availability, price, taxes and booking confirmation must be manually confirmed by the property team.";

const SYSTEM_PROMPT = `You are a professional hotel front-office assistant in India. Write a warm, concise quote proposal to a guest for the property identified below.

Rules you must follow:
- Use ONLY the structured data provided in the user message. Never invent prices, taxes, room features, availability, dates, or guest details that are not in the data.
- If the manual_price_text is empty, write "[price to be confirmed]" — do NOT guess a number.
- Keep the tone polite and unhurried. Indian English. Avoid jargon.
- Output plain text only. No HTML, no markdown headings, no emoji.
- The proposal must end with this exact line on its own (verbatim, no edits):
  ${QUOTE_DISCLAIMER_LINE}
- If you cannot produce a quote (e.g. the data is so sparse you would have to invent details), output exactly:
  CANNOT_DRAFT: <one-line reason>
- Do not include any contact links, payment URLs, or booking confirmations. Only the property team will confirm.

Length: 6–12 short paragraphs. Greeting → stay summary → package summary (if any) → pricing → optional notes → polite sign-off → the verbatim disclaimer line.`;

export interface QuotePromptVars {
  guest_name: string | null;
  party_adults: number;
  party_children: number;
  room_count: number;
  check_in: string | null;
  check_out: string | null;
  nights: number;
  room_type_name: string | null;
  package_name: string | null;
  package_duration_nights: number | null;
  package_inclusions: string[];
  selected_inclusions: string[];
  package_policy_notes: string | null;
  manual_price_text: string;
  owner_notes: string;
  property_name: string;
  property_city: string | null;
}

/** Returns { systemPrompt, userMessage } for the Anthropic call. */
export function buildQuotePrompt(vars: QuotePromptVars): {
  systemPrompt: string;
  userMessage: string;
} {
  const userMessage =
    "Structured guest + property data (use only these facts):\n\n```json\n" +
    JSON.stringify(vars, null, 2) +
    "\n```\n\nWrite the quote proposal now per the rules in the system prompt.";
  return { systemPrompt: SYSTEM_PROMPT, userMessage };
}
