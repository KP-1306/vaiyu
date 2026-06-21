import { withObs as __withObs } from "../_shared/http-telemetry.ts";
const __serveObs = (h: (req: Request) => Response | Promise<Response>) => Deno.serve(__withObs("send-quote", h));
// supabase/functions/send-quote/index.ts
//
// Operator-facing "Send quote via email" endpoint.
//
// Orchestrates:
//   1. JWT auth + hotel-member check
//   2. Resolves quote_draft + lead + hotel context (service-role read)
//   3. If pdf_storage_path is missing, renders the PDF and records it
//      (uses the shared quote-pdf helper + record_quote_pdf RPC)
//   4. Generates a 7-day signed URL for the PDF
//   5. Builds default email subject + HTML body (operator can override
//      via custom_subject / custom_body_html in the request)
//   6. Calls enqueue_quote_send RPC — single transaction:
//        • inserts notification_queue row (with idempotency_key)
//        • marks quote_drafts.status = SENT
//        • logs SENT event to quote_draft_events
//        • trigger bumps leads.quote_count / last_quote_at / last_quote_pdf_path
//   7. Returns { ok, notification_id, signed_url, idempotent_hit }
//
// send-notifications (already cron-driven) drains the queue row and delivers
// the email via Resend.
//
// Idempotency: frontend MUST supply `idempotency_key` (UUID v4 per send
// click). Same key on retry returns the existing notification_id without
// duplicate send. enqueue_quote_send raises if key reused with mismatched
// quote_id.

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

const FUNC_NAME = "send-quote";
const RATE_LIMIT_PER_MIN = 20;
const SIGNED_URL_TTL_SEC = 7 * 24 * 60 * 60;

interface BodyShape {
  quote_id?: string;
  channel?: "email" | "whatsapp";
  to_address?: string;
  custom_subject?: string;
  custom_body_html?: string;
  idempotency_key?: string;
  /** 'send' (default) = first send via enqueue_quote_send RPC.
   *  'resend' = explicit resend via resend_quote RPC (requires resend_reason). */
  mode?: "send" | "resend";
  resend_reason?: string;
}

// Default email body. Branded but minimal; operator can override.
function defaultEmailBody(opts: {
  guestName: string;
  hotelName: string;
  hotelCity: string | null;
  signedUrl: string;
  checkIn: string | null;
  checkOut: string | null;
}): { subject: string; html: string } {
  const subject = `Your quote from ${opts.hotelName}`;
  const dateLine = opts.checkIn && opts.checkOut
    ? `for ${opts.checkIn} → ${opts.checkOut}`
    : "for your enquiry";

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:Arial,Helvetica,sans-serif;color:#222;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center" style="padding:30px 0;">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 6px 18px rgba(0,0,0,0.08);">
        <tr><td style="background:linear-gradient(135deg,#5b8cff,#7f53ff);color:#ffffff;padding:28px;text-align:center;">
          <h1 style="margin:0;font-size:24px;">Your quote is ready</h1>
          <p style="margin-top:8px;font-size:14px;opacity:0.9;">From ${escapeHtml(opts.hotelName)}${opts.hotelCity ? ` · ${escapeHtml(opts.hotelCity)}` : ""}</p>
        </td></tr>
        <tr><td style="padding:32px;text-align:center;">
          <p style="font-size:16px;line-height:1.6;margin:0 0 18px 0;">Hi ${escapeHtml(opts.guestName)},</p>
          <p style="font-size:15px;line-height:1.6;margin:0 0 22px 0;">
            Thank you for considering <strong>${escapeHtml(opts.hotelName)}</strong>. Please find your quote ${escapeHtml(dateLine)} attached below.
          </p>
          <a href="${opts.signedUrl}" style="display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#ff7a18,#ffb347);color:#ffffff;text-decoration:none;font-weight:bold;border-radius:50px;font-size:15px;box-shadow:0 4px 12px rgba(255,122,24,0.35);">View quote PDF</a>
          <p style="margin-top:24px;font-size:13px;color:#666;line-height:1.5;">
            Reply to this email to confirm the stay, ask for changes, or request a quick call. We'd love to host you.
          </p>
        </td></tr>
        <tr><td style="background:#fafbff;text-align:center;padding:18px;font-size:12px;color:#888;">
          <strong>${escapeHtml(opts.hotelName)}</strong><br>
          <span style="font-size:10px;opacity:0.7;">Powered by VAiyu</span>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  return { subject, html };
}

function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

__serveObs(async (req: Request) => {
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
  const channel = body.channel ?? "email";
  const toAddress = body.to_address;
  const idempotencyKey = body.idempotency_key;

  if (!quoteId)        return json(400, { ok: false, code: "QUOTE_ID_REQUIRED" });
  if (!toAddress)      return json(400, { ok: false, code: "RECIPIENT_REQUIRED" });
  if (!idempotencyKey) return json(400, { ok: false, code: "IDEMPOTENCY_KEY_REQUIRED" });
  if (channel !== "email" && channel !== "whatsapp") {
    return json(400, { ok: false, code: "UNSUPPORTED_CHANNEL" });
  }

  const anon = supabaseAnon(req);
  const svc  = supabaseService();

  const { data: draft, error: draftErr } = await svc
    .from("quote_drafts")
    .select(
      "id, hotel_id, lead_id, draft_text, manual_price_text, nights, inclusions, owner_notes, package_code, room_type_id, pdf_storage_path, status, availability_confirmed, terms_confirmed",
    )
    .eq("id", quoteId)
    .maybeSingle();
  if (draftErr) {
    console.error("[send-quote] draft fetch failed", draftErr);
    return json(500, { ok: false, code: "DB_ERROR" });
  }
  if (!draft) return json(404, { ok: false, code: "QUOTE_NOT_FOUND" });

  // Membership check via caller's JWT
  const { data: isMember, error: memberErr } = await anon.rpc("vaiyu_is_hotel_member", {
    p_hotel_id: draft.hotel_id,
  });
  if (memberErr) return json(500, { ok: false, code: "UNKNOWN_ERROR" });
  if (isMember !== true) return json(403, { ok: false, code: "NOT_AUTHORIZED" });

  const rl = await rateLimitForUser(anon, userId, `${FUNC_NAME}:${draft.hotel_id}`, RATE_LIMIT_PER_MIN);
  if (!rl.allowed) return tooManyRequests(rl.retryAfterSec);

  // Governance check (mirrors RPC; better error than letting CHECK fire)
  if (!draft.availability_confirmed || !draft.terms_confirmed) {
    return json(400, { ok: false, code: "GOVERNANCE_INCOMPLETE" });
  }

  // ── Resolve hotel + lead context ─────────────────────────────────────────
  const [hotelRes, leadRes, roomRes] = await Promise.all([
    svc.from("hotels").select("id, name, city, email, contact_phone").eq("id", draft.hotel_id).maybeSingle(),
    draft.lead_id
      ? svc.from("leads").select("contact_name, contact_phone, contact_email, requested_check_in, requested_check_out, party_adults, party_children").eq("id", draft.lead_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    draft.room_type_id
      ? svc.from("room_types").select("name").eq("id", draft.room_type_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (hotelRes.error || !hotelRes.data) {
    return json(500, { ok: false, code: "HOTEL_FETCH_FAILED" });
  }

  // ── Ensure PDF exists ─────────────────────────────────────────────────────
  let storagePath = draft.pdf_storage_path as string | null;
  if (!storagePath) {
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
      console.error("[send-quote] pdf generation failed", e);
      return json(500, { ok: false, code: "PDF_GENERATION_FAILED" });
    }

    storagePath = `${draft.hotel_id}/${draft.id}.pdf`;
    const { error: uploadErr } = await svc.storage
      .from("quote-pdfs")
      .upload(storagePath, pdfBytes, { contentType: "application/pdf", upsert: true });
    if (uploadErr) {
      console.error("[send-quote] storage upload failed", uploadErr);
      return json(500, { ok: false, code: "STORAGE_UPLOAD_FAILED" });
    }

    const { error: recErr } = await svc.rpc("record_quote_pdf", {
      p_quote_id:     draft.id,
      p_storage_path: storagePath,
      p_byte_size:    pdfBytes.byteLength,
    });
    if (recErr) {
      console.error("[send-quote] record_quote_pdf failed", recErr);
      return json(500, { ok: false, code: "RECORD_PDF_FAILED" });
    }
  }

  // ── Sign URL ──────────────────────────────────────────────────────────────
  const { data: signed, error: signErr } = await svc.storage
    .from("quote-pdfs")
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SEC);
  if (signErr || !signed?.signedUrl) {
    console.error("[send-quote] sign URL failed", signErr);
    return json(500, { ok: false, code: "SIGN_URL_FAILED" });
  }

  // ── Compose email ─────────────────────────────────────────────────────────
  const guestName = leadRes.data?.contact_name || "there";
  const checkIn   = fmtDate(leadRes.data?.requested_check_in ?? null);
  const checkOut  = fmtDate(leadRes.data?.requested_check_out ?? null);

  const composed = defaultEmailBody({
    guestName,
    hotelName: hotelRes.data.name,
    hotelCity: hotelRes.data.city,
    signedUrl: signed.signedUrl,
    checkIn,
    checkOut,
  });

  const finalSubject  = body.custom_subject  && body.custom_subject.trim()  ? body.custom_subject  : composed.subject;
  const finalBodyHtml = body.custom_body_html && body.custom_body_html.trim() ? body.custom_body_html : composed.html;

  // ── Dispatch: send (DRAFT→SENT) vs resend (SENT→new notification) ───────
  const mode = body.mode === "resend" ? "resend" : "send";

  if (mode === "resend") {
    const reason = body.resend_reason?.trim();
    if (!reason) return json(400, { ok: false, code: "RESEND_REASON_REQUIRED" });

    const { data: rs, error: rsErr } = await svc.rpc("resend_quote", {
      p_quote_id:        draft.id,
      p_channel:         channel,
      p_to_address:      toAddress,
      p_subject:         finalSubject,
      p_body_html:       finalBodyHtml,
      p_signed_url:      signed.signedUrl,
      p_resend_reason:   reason,
      p_idempotency_key: idempotencyKey,
    });
    if (rsErr) {
      const msg = String(rsErr.message ?? "");
      if (msg.includes("RESEND_REQUIRES_SENT")) return json(409, { ok: false, code: "RESEND_REQUIRES_SENT" });
      if (msg.includes("INVALID_EMAIL"))         return json(400, { ok: false, code: "INVALID_EMAIL" });
      if (msg.includes("WHATSAPP_PENDING"))      return json(400, { ok: false, code: "WHATSAPP_PENDING_APPROVAL" });
      console.error("[send-quote] resend_quote failed", rsErr);
      return json(500, { ok: false, code: "RESEND_FAILED", detail: msg });
    }
    return json(200, {
      ok: true,
      mode: "resend",
      notification_id: (rs as { notification_id?: string })?.notification_id ?? null,
      idempotent_hit:  (rs as { idempotent_hit?: boolean })?.idempotent_hit ?? false,
      quote_status:    "SENT",
      storage_path:    storagePath,
      signed_url:      signed.signedUrl,
      expires_in_sec:  SIGNED_URL_TTL_SEC,
    });
  }

  // ── Atomic enqueue + mark SENT (initial send) ────────────────────────────
  const { data: enq, error: enqErr } = await svc.rpc("enqueue_quote_send", {
    p_quote_id:        draft.id,
    p_channel:         channel,
    p_to_address:      toAddress,
    p_subject:         finalSubject,
    p_body_html:       finalBodyHtml,
    p_signed_url:      signed.signedUrl,
    p_idempotency_key: idempotencyKey,
  });
  if (enqErr) {
    console.error("[send-quote] enqueue_quote_send failed", enqErr);
    const msg = String(enqErr.message ?? "");
    if (msg.includes("INVALID_TRANSITION"))      return json(409, { ok: false, code: "ALREADY_SENT", detail: "Use mode=resend for already-sent drafts" });
    if (msg.includes("GOVERNANCE_INCOMPLETE"))   return json(400, { ok: false, code: "GOVERNANCE_INCOMPLETE" });
    if (msg.includes("INVALID_EMAIL"))           return json(400, { ok: false, code: "INVALID_EMAIL" });
    if (msg.includes("WHATSAPP_PENDING_APPROVAL"))return json(400, { ok: false, code: "WHATSAPP_PENDING_APPROVAL" });
    return json(500, { ok: false, code: "ENQUEUE_FAILED", detail: msg });
  }

  return json(200, {
    ok: true,
    mode: "send",
    notification_id: (enq as { notification_id?: string })?.notification_id ?? null,
    idempotent_hit:  (enq as { idempotent_hit?: boolean })?.idempotent_hit ?? false,
    quote_status:    (enq as { quote_status?: string })?.quote_status ?? "SENT",
    storage_path:    storagePath,
    signed_url:      signed.signedUrl,
    expires_in_sec:  SIGNED_URL_TTL_SEC,
  });
});
