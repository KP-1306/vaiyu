// supabase/functions/render-quote-pdf/index.ts
//
// Renders a quote_draft to PDF and saves it to the private `quote-pdfs`
// storage bucket at `<hotel_id>/<quote_id>.pdf`. Records the path back
// onto the quote_drafts row via record_quote_pdf RPC.
//
// Callable by:
//   • UI "Preview PDF" / "Download PDF" buttons (authenticated hotel member)
//   • send-quote function (also auth required; it forwards the user's JWT)
//
// Flow:
//   1. JWT-required, parse quote_id from body
//   2. Membership check via vaiyu_is_hotel_member RPC
//   3. Service-role read of quote_draft + lead + hotel
//   4. Generate PDF bytes via shared helper
//   5. Upload (upsert) to storage as service_role
//   6. record_quote_pdf RPC stamps pdf_storage_path / pdf_generated_at /
//      pdf_byte_size onto the row
//   7. Generate a 7-day signed URL and return it

import {
  assertAuthed,
  json,
  preflight,
  rateLimitForUser,
  supabaseAnon,
  supabaseService,
  tooManyRequests,
} from "../_shared/auth.ts";
import { generateQuotePdf } from "../_shared/quote-pdf.ts";

const FUNC_NAME = "render-quote-pdf";
const RATE_LIMIT_PER_MIN = 20;
const SIGNED_URL_TTL_SEC = 7 * 24 * 60 * 60;

interface BodyShape {
  quote_id?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return json(405, { ok: false, code: "METHOD_NOT_ALLOWED" });

  const authed = await assertAuthed(req);
  if (authed instanceof Response) return authed;
  const userId = authed.user.id;

  let body: BodyShape;
  try { body = await req.json(); } catch {
    return json(400, { ok: false, code: "INVALID_REQUEST", detail: "malformed_json" });
  }
  const quoteId = body.quote_id;
  if (!quoteId || typeof quoteId !== "string") {
    return json(400, { ok: false, code: "INVALID_REQUEST", detail: "quote_id_missing" });
  }

  const anon = supabaseAnon(req);
  const svc  = supabaseService();

  // ── Fetch the quote (service-role so we sidestep RLS races; we authorise
  // immediately below). ──────────────────────────────────────────────────
  const { data: draft, error: draftErr } = await svc
    .from("quote_drafts")
    .select(
      "id, hotel_id, lead_id, draft_text, manual_price_text, nights, inclusions, owner_notes, package_code, room_type_id, pdf_storage_path",
    )
    .eq("id", quoteId)
    .maybeSingle();

  if (draftErr) {
    console.error("[render-quote-pdf] draft fetch failed", draftErr);
    return json(500, { ok: false, code: "DB_ERROR" });
  }
  if (!draft) return json(404, { ok: false, code: "QUOTE_NOT_FOUND" });

  // Membership check (uses caller JWT — enforces RLS-level hotel scoping)
  const { data: isMember, error: memberErr } = await anon.rpc("vaiyu_is_hotel_member", {
    p_hotel_id: draft.hotel_id,
  });
  if (memberErr) {
    console.error("[render-quote-pdf] member check failed", memberErr);
    return json(500, { ok: false, code: "UNKNOWN_ERROR" });
  }
  if (isMember !== true) return json(403, { ok: false, code: "NOT_AUTHORIZED" });

  const rl = await rateLimitForUser(anon, userId, `${FUNC_NAME}:${draft.hotel_id}`, RATE_LIMIT_PER_MIN);
  if (!rl.allowed) return tooManyRequests(rl.retryAfterSec);

  // ── Resolve hotel + lead context for the PDF body ────────────────────────
  const [hotelRes, leadRes, roomRes] = await Promise.all([
    svc.from("hotels").select("id, name, city, email, contact_phone").eq("id", draft.hotel_id).maybeSingle(),
    draft.lead_id
      ? svc.from("leads").select("contact_name, requested_check_in, requested_check_out, party_adults, party_children").eq("id", draft.lead_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    draft.room_type_id
      ? svc.from("room_types").select("name").eq("id", draft.room_type_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (hotelRes.error || !hotelRes.data) {
    console.error("[render-quote-pdf] hotel fetch failed", hotelRes.error);
    return json(500, { ok: false, code: "HOTEL_FETCH_FAILED" });
  }

  // ── Generate PDF ─────────────────────────────────────────────────────────
  let pdfBytes: Uint8Array;
  try {
    pdfBytes = await generateQuotePdf({
      hotel: hotelRes.data,
      lead: leadRes.data ?? null,
      draft: {
        id: draft.id,
        draft_text: draft.draft_text,
        manual_price_text: draft.manual_price_text,
        nights: draft.nights,
        inclusions: draft.inclusions,
        owner_notes: draft.owner_notes,
        package_code: draft.package_code,
        room_type_name: (roomRes.data as { name?: string } | null)?.name ?? null,
      },
      generatedAt: new Date(),
    });
  } catch (e) {
    console.error("[render-quote-pdf] pdf generation failed", e);
    return json(500, { ok: false, code: "PDF_GENERATION_FAILED" });
  }

  // ── Upload to storage (service role bypasses RLS) ────────────────────────
  const storagePath = `${draft.hotel_id}/${draft.id}.pdf`;
  const { error: uploadErr } = await svc.storage
    .from("quote-pdfs")
    .upload(storagePath, pdfBytes, {
      contentType: "application/pdf",
      upsert: true,
    });
  if (uploadErr) {
    console.error("[render-quote-pdf] storage upload failed", uploadErr);
    return json(500, { ok: false, code: "STORAGE_UPLOAD_FAILED" });
  }

  // ── Record path on the draft row ─────────────────────────────────────────
  const { error: recErr } = await svc.rpc("record_quote_pdf", {
    p_quote_id:     draft.id,
    p_storage_path: storagePath,
    p_byte_size:    pdfBytes.byteLength,
  });
  if (recErr) {
    console.error("[render-quote-pdf] record_quote_pdf failed", recErr);
    return json(500, { ok: false, code: "RECORD_PDF_FAILED", detail: recErr.message });
  }

  // ── Signed URL (7 day TTL) ───────────────────────────────────────────────
  const { data: signed, error: signErr } = await svc.storage
    .from("quote-pdfs")
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SEC);
  if (signErr) {
    console.error("[render-quote-pdf] signed URL failed", signErr);
    return json(500, { ok: false, code: "SIGN_URL_FAILED" });
  }

  return json(200, {
    ok: true,
    storage_path: storagePath,
    byte_size: pdfBytes.byteLength,
    signed_url: signed.signedUrl,
    expires_in_sec: SIGNED_URL_TTL_SEC,
  });
});
