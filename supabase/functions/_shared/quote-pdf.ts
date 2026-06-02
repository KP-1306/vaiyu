// supabase/functions/_shared/quote-pdf.ts
//
// PDF generation for quote drafts. Used by render-quote-pdf (UI-callable
// preview/save) and send-quote (auto-renders if no PDF on file yet).
//
// Layout choices:
//   • A4 portrait (595×842 pt) — standard for Indian hospitality emails
//   • One page only for v1; if the draft is longer, we paginate (drawText
//     respects y-cursor and we add new pages on overflow)
//   • Branding strip + meta block + body + disclaimer + footer
//   • Helvetica only — no font embedding, no Hindi rendering. Once we have
//     a hotel-uploaded brand font + Devanagari fallback this gets richer.
//
// Word-wrap is hand-rolled (pdf-lib has no layout engine). Empty lines in
// the draft text translate to vertical gaps.

import { PDFDocument, PDFFont, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";

export interface QuotePdfInput {
  hotel: {
    name: string;
    city: string | null;
    email: string | null;
    contact_phone?: string | null;
  };
  lead: {
    contact_name: string;
    requested_check_in: string | null;   // ISO date
    requested_check_out: string | null;
    party_adults: number | null;
    party_children: number | null;
  } | null;
  draft: {
    id: string;
    draft_text: string;
    manual_price_text: string | null;
    nights: number | null;
    inclusions: string[] | null;
    owner_notes: string | null;
    package_code: string | null;
    room_type_name?: string | null;
  };
  generatedAt?: Date;
}

const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN_X = 48;
const CONTENT_W = PAGE_W - MARGIN_X * 2;

const COLOR_BRAND   = rgb(0.05, 0.12, 0.35);
const COLOR_ACCENT  = rgb(0.36, 0.55, 1);
const COLOR_TEXT    = rgb(0.13, 0.13, 0.15);
const COLOR_MUTED   = rgb(0.45, 0.48, 0.55);
const COLOR_HAIRLINE = rgb(0.85, 0.87, 0.92);

function wrapLines(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string[] {
  if (!text) return [];
  const paragraphs = text.replace(/\r\n/g, "\n").split(/\n/);
  const out: string[] = [];
  for (const p of paragraphs) {
    if (p === "") { out.push(""); continue; }
    const words = p.split(/\s+/);
    let line = "";
    for (const w of words) {
      const tentative = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(tentative, size) > maxWidth && line) {
        out.push(line);
        line = w;
      } else {
        line = tentative;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export async function generateQuotePdf(input: QuotePdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const helvBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const helvOblique = await doc.embedFont(StandardFonts.HelveticaOblique);

  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - 60;

  // Header strip
  page.drawRectangle({ x: 0, y: PAGE_H - 56, width: PAGE_W, height: 56, color: COLOR_BRAND });
  page.drawText(input.hotel.name || "Hotel", {
    x: MARGIN_X, y: PAGE_H - 34, size: 18, font: helvBold, color: rgb(1, 1, 1),
  });
  if (input.hotel.city) {
    page.drawText(input.hotel.city, {
      x: MARGIN_X, y: PAGE_H - 50, size: 11, font: helv, color: rgb(0.85, 0.88, 0.95),
    });
  }
  page.drawText("Quote / Proposal", {
    x: PAGE_W - MARGIN_X - helv.widthOfTextAtSize("Quote / Proposal", 11),
    y: PAGE_H - 34, size: 11, font: helv, color: rgb(0.85, 0.88, 0.95),
  });
  const idSnippet = input.draft.id.slice(0, 8);
  const issuedAt = (input.generatedAt ?? new Date()).toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
  });
  const metaRight = `#${idSnippet} · ${issuedAt}`;
  page.drawText(metaRight, {
    x: PAGE_W - MARGIN_X - helv.widthOfTextAtSize(metaRight, 9),
    y: PAGE_H - 50, size: 9, font: helv, color: rgb(0.78, 0.82, 0.92),
  });

  y = PAGE_H - 90;

  // Guest + stay meta block
  const guestName = input.lead?.contact_name || "Guest";
  page.drawText(`For ${guestName}`, { x: MARGIN_X, y, size: 14, font: helvBold, color: COLOR_TEXT });
  y -= 22;

  const partyParts: string[] = [];
  if (input.lead?.party_adults) partyParts.push(`${input.lead.party_adults} adult${input.lead.party_adults === 1 ? "" : "s"}`);
  if (input.lead?.party_children) partyParts.push(`${input.lead.party_children} child${input.lead.party_children === 1 ? "" : "ren"}`);
  const partyStr = partyParts.length ? partyParts.join(", ") : "—";

  const checkIn  = formatDate(input.lead?.requested_check_in ?? null);
  const checkOut = formatDate(input.lead?.requested_check_out ?? null);
  const nightsStr = input.draft.nights && input.draft.nights > 0 ? `${input.draft.nights} night${input.draft.nights === 1 ? "" : "s"}` : "—";

  const meta: Array<[string, string]> = [
    ["Check-in", checkIn],
    ["Check-out", checkOut],
    ["Nights", nightsStr],
    ["Guests", partyStr],
  ];
  if (input.draft.room_type_name)  meta.push(["Room type", input.draft.room_type_name]);
  if (input.draft.package_code)    meta.push(["Package", input.draft.package_code]);

  for (let i = 0; i < meta.length; i += 2) {
    const left  = meta[i];
    const right = meta[i + 1];
    page.drawText(left[0], { x: MARGIN_X, y, size: 9, font: helv, color: COLOR_MUTED });
    page.drawText(left[1], { x: MARGIN_X + 80, y, size: 11, font: helvBold, color: COLOR_TEXT });
    if (right) {
      page.drawText(right[0], { x: MARGIN_X + 280, y, size: 9, font: helv, color: COLOR_MUTED });
      page.drawText(right[1], { x: MARGIN_X + 360, y, size: 11, font: helvBold, color: COLOR_TEXT });
    }
    y -= 18;
  }

  if (input.draft.manual_price_text && input.draft.manual_price_text.trim()) {
    y -= 6;
    page.drawText("Price", { x: MARGIN_X, y, size: 9, font: helv, color: COLOR_MUTED });
    page.drawText(input.draft.manual_price_text, { x: MARGIN_X + 80, y, size: 13, font: helvBold, color: COLOR_BRAND });
    y -= 22;
  }

  // Divider
  y -= 6;
  page.drawLine({
    start: { x: MARGIN_X, y }, end: { x: PAGE_W - MARGIN_X, y },
    thickness: 0.5, color: COLOR_HAIRLINE,
  });
  y -= 18;

  // Body — draft text, word-wrapped
  const bodySize = 11;
  const lineHeight = 16;
  const bodyLines = wrapLines(input.draft.draft_text || "", helv, bodySize, CONTENT_W);

  for (const line of bodyLines) {
    if (y < 110) {  // leave room for footer
      page = doc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - 60;
    }
    if (line) {
      page.drawText(line, { x: MARGIN_X, y, size: bodySize, font: helv, color: COLOR_TEXT });
    }
    y -= lineHeight;
  }

  // Inclusions chip list (if any)
  if (input.draft.inclusions && input.draft.inclusions.length > 0) {
    if (y < 130) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - 60;
    }
    y -= 6;
    page.drawText("Inclusions", { x: MARGIN_X, y, size: 9, font: helv, color: COLOR_MUTED });
    y -= 14;
    let chipX = MARGIN_X;
    for (const inc of input.draft.inclusions) {
      const chipText = `• ${inc}`;
      const w = helv.widthOfTextAtSize(chipText, 10) + 10;
      if (chipX + w > PAGE_W - MARGIN_X) {
        chipX = MARGIN_X;
        y -= 14;
      }
      page.drawText(chipText, { x: chipX, y, size: 10, font: helv, color: COLOR_TEXT });
      chipX += w;
    }
    y -= 18;
  }

  // Disclaimer
  if (y < 110) {
    page = doc.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - 60;
  }
  y -= 12;
  page.drawLine({
    start: { x: MARGIN_X, y }, end: { x: PAGE_W - MARGIN_X, y },
    thickness: 0.5, color: COLOR_HAIRLINE,
  });
  y -= 18;
  const disclaimer = "This is an estimate based on the information shared so far. Final rates, availability, and inclusions are subject to confirmation by the hotel. Taxes apply as per government policy.";
  const disclaimerLines = wrapLines(disclaimer, helvOblique, 9, CONTENT_W);
  for (const line of disclaimerLines) {
    page.drawText(line, { x: MARGIN_X, y, size: 9, font: helvOblique, color: COLOR_MUTED });
    y -= 12;
  }

  // Footer (bottom of page — uses the last page in the doc)
  const pages = doc.getPages();
  const last = pages[pages.length - 1];
  last.drawLine({
    start: { x: MARGIN_X, y: 56 }, end: { x: PAGE_W - MARGIN_X, y: 56 },
    thickness: 0.5, color: COLOR_HAIRLINE,
  });
  const contactLine = [
    input.hotel.email ? `Email: ${input.hotel.email}` : null,
    input.hotel.contact_phone ? `Phone: ${input.hotel.contact_phone}` : null,
  ].filter(Boolean).join("  ·  ");
  if (contactLine) {
    last.drawText(contactLine, { x: MARGIN_X, y: 38, size: 9, font: helv, color: COLOR_MUTED });
  }
  last.drawText("Powered by VAiyu", {
    x: PAGE_W - MARGIN_X - helv.widthOfTextAtSize("Powered by VAiyu", 8),
    y: 38, size: 8, font: helv, color: COLOR_ACCENT,
  });

  return await doc.save();
}
