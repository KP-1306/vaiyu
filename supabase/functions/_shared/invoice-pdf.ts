// supabase/functions/_shared/invoice-pdf.ts
//
// GST-compliant invoice PDF (pdf-lib, same approach as quote-pdf.ts). Renders a
// "TAX INVOICE" for GST-registered hotels (GSTIN + CGST/SGST split + SAC) or a
// "BILL OF SUPPLY" for unregistered hotels (no GST lines). Helvetica is WinAnsi-
// only, so text is sanitized to Latin-1 (a Devanagari guest name renders as '?'
// rather than crashing the render); amounts use "Rs." for the same reason.
import { PDFDocument, PDFFont, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";

export interface InvoiceLine { label: string; amount: number }
export interface InvoiceData {
  registered: boolean;
  docTitle: string; // "TAX INVOICE" | "BILL OF SUPPLY"
  hotel: { legalName: string; tradeName?: string; address?: string; cityState?: string; gstin?: string; sac?: string; phone?: string; email?: string };
  invoiceNo: string;
  invoiceDate: string;
  bookingCode?: string;
  checkIn?: string;
  checkOut?: string;
  nights?: number;
  guest: { name: string; gstin?: string; legalName?: string };
  lineItems: InvoiceLine[];
  taxableValue: number;
  taxRate: number;
  cgst: number;
  sgst: number;
  taxTotal: number;
  grandTotal: number;
  amountPaid: number;
  balanceDue: number;
}

const lat1 = (s: string) => (s ?? "").replace(/[^\x00-\xFF]/g, "?");
const money = (n: number) =>
  "Rs. " + (Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Indian numbering amount-in-words (rupees + paise).
function amountInWords(n: number): string {
  const rupees = Math.floor(Math.abs(n));
  const paise = Math.round((Math.abs(n) - rupees) * 100);
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const two = (x: number): string => x < 20 ? ones[x] : tens[Math.floor(x / 10)] + (x % 10 ? " " + ones[x % 10] : "");
  const three = (x: number): string => {
    const h = Math.floor(x / 100), r = x % 100;
    return (h ? ones[h] + " Hundred" + (r ? " " : "") : "") + (r ? two(r) : "");
  };
  if (rupees === 0 && paise === 0) return "Zero Rupees";
  let r = rupees, parts: string[] = [];
  const crore = Math.floor(r / 10000000); r %= 10000000;
  const lakh = Math.floor(r / 100000); r %= 100000;
  const thou = Math.floor(r / 1000); r %= 1000;
  if (crore) parts.push(three(crore) + " Crore");
  if (lakh) parts.push(three(lakh) + " Lakh");
  if (thou) parts.push(three(thou) + " Thousand");
  if (r) parts.push(three(r));
  let words = parts.join(" ").trim() + " Rupees";
  if (paise) words += " and " + two(paise) + " Paise";
  return words + " Only";
}

export async function generateInvoicePdf(d: InvoiceData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]); // A4
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 595.28, M = 50;
  const ink = rgb(0.1, 0.1, 0.12), grey = rgb(0.42, 0.42, 0.46), line = rgb(0.8, 0.8, 0.83);
  let y = 800;

  const T = (s: string, x: number, yy: number, o: { size?: number; b?: boolean; c?: any } = {}) =>
    page.drawText(lat1(s), { x, y: yy, size: o.size ?? 10, font: o.b ? bold : font, color: o.c ?? ink });
  const R = (s: string, xr: number, yy: number, o: { size?: number; b?: boolean; c?: any } = {}) => {
    const f = o.b ? bold : font, sz = o.size ?? 10;
    page.drawText(lat1(s), { x: xr - f.widthOfTextAtSize(lat1(s), sz), y: yy, size: sz, font: f, color: o.c ?? ink });
  };
  const hr = (yy: number) => page.drawLine({ start: { x: M, y: yy }, end: { x: W - M, y: yy }, thickness: 0.75, color: line });

  // Title
  T(d.docTitle, M, y, { size: 18, b: true });
  R(d.registered ? "GST Invoice" : "Receipt", W - M, y + 2, { size: 9, c: grey });
  y -= 26; hr(y); y -= 18;

  // Seller (hotel) block — left; meta — right
  const top = y;
  T(d.hotel.legalName || d.hotel.tradeName || "Hotel", M, y, { size: 12, b: true }); y -= 14;
  if (d.hotel.tradeName && d.hotel.tradeName !== d.hotel.legalName) { T(d.hotel.tradeName, M, y, { c: grey }); y -= 13; }
  for (const ln of [d.hotel.address, d.hotel.cityState].filter(Boolean) as string[]) { T(ln, M, y, { size: 9, c: grey }); y -= 12; }
  if (d.hotel.gstin) { T(`GSTIN: ${d.hotel.gstin}`, M, y, { size: 9, b: true }); y -= 12; }
  if (d.hotel.sac) { T(`SAC: ${d.hotel.sac}`, M, y, { size: 9, c: grey }); y -= 12; }
  for (const ln of [d.hotel.phone, d.hotel.email].filter(Boolean) as string[]) { T(ln, M, y, { size: 9, c: grey }); y -= 12; }

  let my = top;
  const metaX = 360;
  R("Invoice No", W - M - 130, my, { size: 9, c: grey }); R(d.invoiceNo, W - M, my, { b: true }); my -= 14;
  R("Date", W - M - 130, my, { size: 9, c: grey }); R(d.invoiceDate, W - M, my); my -= 14;
  if (d.bookingCode) { R("Booking", W - M - 130, my, { size: 9, c: grey }); R(d.bookingCode, W - M, my); my -= 14; }
  if (d.checkIn || d.checkOut) { R("Stay", W - M - 130, my, { size: 9, c: grey }); R(`${d.checkIn ?? "-"} - ${d.checkOut ?? "-"}${d.nights ? `  (${d.nights}n)` : ""}`, W - M, my, { size: 9 }); my -= 14; }
  void metaX;

  y = Math.min(y, my) - 8; hr(y); y -= 16;

  // Bill to
  T("Bill To", M, y, { size: 9, b: true, c: grey }); y -= 14;
  T(d.guest.legalName || d.guest.name || "Guest", M, y, { b: true }); y -= 13;
  if (d.guest.legalName && d.guest.name && d.guest.legalName !== d.guest.name) { T(`Attn: ${d.guest.name}`, M, y, { size: 9, c: grey }); y -= 12; }
  if (d.guest.gstin) { T(`GSTIN: ${d.guest.gstin}`, M, y, { size: 9, b: true }); y -= 12; }
  y -= 6;

  // Line items table
  const cAmt = W - M;
  page.drawRectangle({ x: M, y: y - 4, width: W - 2 * M, height: 18, color: rgb(0.96, 0.96, 0.97) });
  T("Description", M + 6, y, { size: 9, b: true }); R("Amount", cAmt - 6, y, { size: 9, b: true });
  y -= 20;
  for (const li of d.lineItems) {
    T(li.label, M + 6, y, { size: 10 }); R(money(li.amount), cAmt - 6, y, { size: 10 });
    y -= 16;
  }
  hr(y + 4); y -= 14;

  // Totals
  const tlx = W - M - 200;
  const totalRow = (label: string, val: string, o: { b?: boolean; c?: any } = {}) => {
    T(label, tlx, y, { size: 10, b: o.b, c: o.c }); R(val, cAmt - 6, y, { size: 10, b: o.b, c: o.c }); y -= 16;
  };
  totalRow("Taxable Value", money(d.taxableValue));
  if (d.registered && d.taxTotal > 0) {
    const half = (d.taxRate / 2).toFixed(2).replace(/\.00$/, "");
    totalRow(`CGST @ ${half}%`, money(d.cgst));
    totalRow(`SGST @ ${half}%`, money(d.sgst));
  }
  page.drawLine({ start: { x: tlx, y: y + 6 }, end: { x: cAmt, y: y + 6 }, thickness: 0.75, color: line });
  totalRow("Grand Total", money(d.grandTotal), { b: true });
  if (d.amountPaid) totalRow("Amount Paid", money(d.amountPaid), { c: grey });
  if (Math.abs(d.balanceDue) >= 0.01) totalRow("Balance Due", money(d.balanceDue), { b: true, c: rgb(0.7, 0.1, 0.1) });

  y -= 8;
  T("Amount in words:", M, y, { size: 9, b: true, c: grey }); y -= 12;
  T(amountInWords(d.grandTotal), M, y, { size: 9 }); y -= 22;

  if (!d.registered) {
    T("This is a Bill of Supply. The supplier is not registered under GST; no tax is charged.", M, y, { size: 8, c: grey }); y -= 12;
  }

  // Footer
  const fy = 60;
  hr(fy + 14);
  T("This is a computer-generated invoice and does not require a signature.", M, fy, { size: 8, c: grey });
  R("Generated via VAiyu - vaiyu.co.in", W - M, fy, { size: 8, c: grey });

  return await doc.save();
}
