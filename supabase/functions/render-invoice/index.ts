// supabase/functions/render-invoice/index.ts
//
// Renders a GST-compliant invoice PDF for a folio and returns a signed URL.
// - TAX INVOICE (CGST/SGST split, GSTIN, SAC) when the hotel is GST-registered;
//   BILL OF SUPPLY (no GST lines) otherwise.
// - Sequential invoice number is allocated ONCE per folio (atomic RPC) and reused.
// - AuthZ: an active hotel member (staff) OR the guest who owns the booking.
// - Optional B2B: guest_gstin / guest_legal_name persist to the folio.
import { withObs } from "../_shared/http-telemetry.ts";
import { assertAuthed, json, preflight, supabaseService } from "../_shared/auth.ts";
import { generateInvoicePdf, type InvoiceLine } from "../_shared/invoice-pdf.ts";

const SIGNED_URL_TTL_SEC = 7 * 24 * 60 * 60;
const num = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);
const r2 = (n: number) => Math.round(n * 100) / 100;
const LABELS: Record<string, string> = {
  ROOM_CHARGE: "Accommodation",
  FOOD_CHARGE: "Food & Beverage",
  ADJUSTMENT: "Adjustment",
  SERVICE_CHARGE: "Service Charge",
};
// SAC (Service Accounting Code) per charge type — accommodation vs restaurant
// differ. ROOM falls back to the hotel's configured SAC. Adjustments carry none.
const SAC_BY_TYPE: Record<string, string> = {
  FOOD_CHARGE: "996331",
  SERVICE_CHARGE: "999799",
};
// GST state codes (first two digits of a GSTIN). Used for the Place-of-Supply line.
const STATE_CODES: Record<string, string> = {
  "jammu and kashmir": "01", "himachal pradesh": "02", "punjab": "03", "chandigarh": "04",
  "uttarakhand": "05", "haryana": "06", "delhi": "07", "rajasthan": "08", "uttar pradesh": "09",
  "bihar": "10", "sikkim": "11", "arunachal pradesh": "12", "nagaland": "13", "manipur": "14",
  "mizoram": "15", "tripura": "16", "meghalaya": "17", "assam": "18", "west bengal": "19",
  "jharkhand": "20", "odisha": "21", "chhattisgarh": "22", "madhya pradesh": "23", "gujarat": "24",
  "maharashtra": "27", "karnataka": "29", "goa": "30", "kerala": "32", "tamil nadu": "33",
  "puducherry": "34", "telangana": "36", "andhra pradesh": "37", "ladakh": "38",
};
// Edge runtime is UTC; pin IST so a stay date near midnight isn't off by a day.
const fmtDate = (d: Date) => d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return json(405, { ok: false, code: "METHOD_NOT_ALLOWED" });

  const authed = await assertAuthed(req);
  if (authed instanceof Response) return authed;
  const userId = authed.user.id;

  let body: { folio_id?: string; booking_id?: string; guest_gstin?: string; guest_legal_name?: string };
  try { body = await req.json(); } catch { return json(400, { ok: false, code: "INVALID_REQUEST" }); }

  const svc = supabaseService();

  // Resolve folio (by id, or the unique folio for a booking)
  let folioQ = svc.from("folios").select("id, hotel_id, booking_id, invoice_no, guest_gstin, guest_legal_name");
  if (body.folio_id) folioQ = folioQ.eq("id", body.folio_id);
  else if (body.booking_id) folioQ = folioQ.eq("booking_id", body.booking_id);
  else return json(400, { ok: false, code: "INVALID_REQUEST", detail: "folio_id_or_booking_id_required" });
  const { data: folio, error: fErr } = await folioQ.maybeSingle();
  if (fErr) return json(500, { ok: false, code: "DB_ERROR" });
  if (!folio) return json(404, { ok: false, code: "FOLIO_NOT_FOUND" });

  // Fetch hotel + booking + entries (service-role; authorize below)
  const [{ data: hotel }, { data: booking }, { data: entries }] = await Promise.all([
    svc.from("hotels").select("name, legal_name, address, city, state, gst_number, sac_code, tax_percentage, phone, email").eq("id", folio.hotel_id).maybeSingle(),
    svc.from("bookings").select("code, guest_name, guest_profile_id, scheduled_checkin_at, scheduled_checkout_at").eq("id", folio.booking_id).maybeSingle(),
    svc.from("folio_entries").select("entry_type, amount").eq("folio_id", folio.id),
  ]);
  if (!hotel) return json(404, { ok: false, code: "HOTEL_NOT_FOUND" });

  // AuthZ: staff member of this hotel OR the booking's guest
  const isGuest = !!booking?.guest_profile_id && booking.guest_profile_id === userId;
  let isStaff = false;
  if (!isGuest) {
    const { count } = await svc.from("hotel_members").select("id", { count: "exact", head: true })
      .eq("hotel_id", folio.hotel_id).eq("user_id", userId).eq("is_active", true);
    isStaff = (count ?? 0) > 0;
  }
  if (!isGuest && !isStaff) return json(403, { ok: false, code: "FORBIDDEN" });

  // Optional B2B capture → persist to folio (only fields provided)
  const patch: Record<string, string> = {};
  if (typeof body.guest_gstin === "string") patch.guest_gstin = body.guest_gstin.trim().toUpperCase();
  if (typeof body.guest_legal_name === "string") patch.guest_legal_name = body.guest_legal_name.trim();
  if (Object.keys(patch).length) {
    await svc.from("folios").update(patch).eq("id", folio.id);
    Object.assign(folio, patch);
  }

  // Sequential invoice number (idempotent)
  const { data: invNo, error: allocErr } = await svc.rpc("allocate_invoice_number", { p_folio_id: folio.id });
  if (allocErr || !invNo) return json(500, { ok: false, code: "INVOICE_NUMBER_FAILED", detail: allocErr?.message });

  // Aggregate folio entries
  const byType: Record<string, number> = {};
  for (const e of entries ?? []) byType[e.entry_type] = (byType[e.entry_type] || 0) + num(e.amount);
  const taxableValue = r2(num(byType.ROOM_CHARGE) + num(byType.FOOD_CHARGE) + num(byType.ADJUSTMENT) + num(byType.SERVICE_CHARGE));
  const taxTotal = r2(num(byType.TAX));
  const amountPaid = r2(-num(byType.PAYMENT)); // PAYMENT stored negative
  const grandTotal = r2(taxableValue + taxTotal);
  const balanceDue = r2(grandTotal - amountPaid);
  const registered = !!(hotel.gst_number && String(hotel.gst_number).trim());

  const lineItems: InvoiceLine[] = Object.entries(byType)
    .filter(([t]) => t !== "TAX" && t !== "PAYMENT")
    .filter(([, v]) => Math.abs(v) >= 0.01)
    .map(([t, v]) => ({
      label: LABELS[t] ?? t.replace(/_/g, " "),
      amount: r2(v),
      sac: t === "ROOM_CHARGE" ? (hotel.sac_code || "996311") : SAC_BY_TYPE[t],
    }));

  // Stay period (a hotel invoice should show the dates served).
  const ci = booking?.scheduled_checkin_at ? new Date(booking.scheduled_checkin_at) : null;
  const co = booking?.scheduled_checkout_at ? new Date(booking.scheduled_checkout_at) : null;
  const nights = ci && co ? Math.max(1, Math.round((co.getTime() - ci.getTime()) / 86400000)) : undefined;

  // Place of supply — for hotel accommodation this is always the hotel's state
  // (IGST Act §12(3), immovable-property rule), hence the intra-state CGST/SGST split.
  let placeOfSupply: string | undefined;
  if (registered && hotel.state && String(hotel.state).trim()) {
    const st = String(hotel.state).trim();
    const code = STATE_CODES[st.toLowerCase()];
    placeOfSupply = code ? `${st} (${code})` : st;
  }

  const taxRate = num(hotel.tax_percentage);
  let pdfBytes: Uint8Array;
  try {
    pdfBytes = await generateInvoicePdf({
      registered,
      docTitle: registered ? "TAX INVOICE" : "BILL OF SUPPLY",
      copyLabel: registered ? "ORIGINAL FOR RECIPIENT" : undefined,
      hotel: {
        legalName: hotel.legal_name || hotel.name || "Hotel",
        tradeName: hotel.name || undefined,
        address: hotel.address || undefined,
        cityState: [hotel.city, hotel.state].filter(Boolean).join(", ") || undefined,
        gstin: registered ? hotel.gst_number : undefined,
        sac: registered ? (hotel.sac_code || "996311") : undefined,
        phone: hotel.phone || undefined,
        email: hotel.email || undefined,
      },
      invoiceNo: String(invNo),
      invoiceDate: fmtDate(new Date()),
      bookingCode: booking?.code || undefined,
      checkIn: ci ? fmtDate(ci) : undefined,
      checkOut: co ? fmtDate(co) : undefined,
      nights,
      placeOfSupply,
      reverseCharge: false,
      guest: {
        name: folio.guest_legal_name || booking?.guest_name || "Guest",
        gstin: folio.guest_gstin || undefined,
        legalName: folio.guest_legal_name || undefined,
      },
      lineItems,
      taxableValue,
      taxRate,
      cgst: registered ? r2(taxTotal / 2) : 0,
      sgst: registered ? r2(taxTotal / 2) : 0,
      taxTotal,
      grandTotal,
      amountPaid,
      balanceDue,
    });
  } catch (e) {
    console.error("[render-invoice] pdf gen failed", e);
    return json(500, { ok: false, code: "PDF_GENERATION_FAILED" });
  }

  const storagePath = `${folio.hotel_id}/${folio.id}.pdf`;
  const { error: upErr } = await svc.storage.from("invoice-pdfs").upload(storagePath, pdfBytes, { contentType: "application/pdf", upsert: true });
  if (upErr) { console.error("[render-invoice] upload failed", upErr); return json(500, { ok: false, code: "STORAGE_UPLOAD_FAILED" }); }

  const { data: signed, error: signErr } = await svc.storage.from("invoice-pdfs").createSignedUrl(storagePath, SIGNED_URL_TTL_SEC);
  if (signErr) return json(500, { ok: false, code: "SIGN_URL_FAILED" });

  return json(200, { ok: true, invoice_no: invNo, signed_url: signed.signedUrl, expires_in_sec: SIGNED_URL_TTL_SEC });
}

Deno.serve(withObs("render-invoice", handler));
