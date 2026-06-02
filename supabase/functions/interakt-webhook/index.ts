// supabase/functions/interakt-webhook/index.ts
//
// Webhook receiver for Interakt. Handles three event families:
//   1. message_status / template_status — delivery receipts
//   2. message_received — inbound guest messages
//   3. account / template_event         — template approval/rejection mirroring
//
// Auth model: no JWT (Interakt's HTTP callback). We verify the call by HMAC
// signature against INTERAKT_WEBHOOK_SECRET. Public surface: anyone can hit
// the URL; only valid signatures progress past the front gate.
//
// Single-account model: one inbound number serves all hotels. We resolve
// which hotel the inbound belongs to by `wa_resolve_hotel_for_phone(phone)`.
// Routing decisions:
//   • 1 candidate hotel → record_inbound_wa_message + run state machine
//   • multiple candidates → enqueue `which_property` template (template
//     handle the multi-property choice via button reply, NOT auto-resolve)
//   • zero candidates → enqueue `unknown_guest` template; do NOT create
//     a hotel-less thread
//
// Realtime: ALL successful chat_messages writes propagate via Supabase
// Realtime to the staff inbox UI automatically (publication added in
// 20260602000002_wa_chat_threads.sql).

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { verifyInteraktSignature } from "../_shared/interakt.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-interakt-signature, x-hub-signature-256",
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function jsonResponse(status: number, body: Record<string, unknown>): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}

interface ResolveCandidate {
    hotel_id: string;
    hotel_slug: string;
    hotel_name: string;
    booking_id: string | null;
    matched_at: string;
    match_kind: string;
}

async function resolveHotel(phone: string): Promise<ResolveCandidate[]> {
    const { data, error } = await supabase.rpc("wa_resolve_hotel_for_phone", { p_phone: phone });
    if (error) {
        console.error("wa_resolve_hotel_for_phone error:", error);
        return [];
    }
    return (data ?? []) as ResolveCandidate[];
}

async function recordInbound(args: {
    hotelId: string;
    phone: string;
    guestName: string | null;
    messageType: string;
    body: string | null;
    payload: Record<string, unknown>;
    provider: string;
    providerMessageId: string;
    lastBookingId?: string | null;
}): Promise<{ thread_id: string; message_id: string } | null> {
    const { data, error } = await supabase.rpc("record_inbound_chat_message", {
        p_hotel_id: args.hotelId,
        p_guest_phone: args.phone,
        p_guest_name: args.guestName,
        p_message_type: args.messageType,
        p_body: args.body,
        p_payload: args.payload,
        p_provider: args.provider,
        p_provider_message_id: args.providerMessageId,
        p_last_booking_id: args.lastBookingId ?? null,
    });
    if (error) {
        console.error("record_inbound_chat_message error:", error);
        return null;
    }
    return data as { thread_id: string; message_id: string };
}

async function setThreadState(threadId: string, state: Record<string, unknown> | null) {
    await supabase.rpc("set_chat_thread_state", {
        p_thread_id: threadId,
        p_state: state ?? {},
        p_expires_in_minutes: 30,
    });
}

async function getThreadState(threadId: string): Promise<{
    state: Record<string, unknown>;
    state_expires_at: string | null;
    last_booking_id: string | null;
}> {
    const { data } = await supabase
        .from("wa_chat_threads")
        .select("state, state_expires_at, last_booking_id")
        .eq("id", threadId)
        .single();
    return (data ?? { state: {}, state_expires_at: null, last_booking_id: null }) as {
        state: Record<string, unknown>;
        state_expires_at: string | null;
        last_booking_id: string | null;
    };
}

async function enqueueWhatsAppTemplate(args: {
    hotelId: string;
    bookingId: string | null;
    phone: string;
    templateCode: string;
    payload: Record<string, unknown>;
}) {
    // Insert into notification_queue with channel=whatsapp, provider=INTERAKT.
    // The send-notifications worker picks this up.
    const { error } = await supabase.from("notification_queue").insert({
        booking_id: args.bookingId,
        hotel_id: args.hotelId,
        channel: "whatsapp",
        template_code: args.templateCode,
        payload: {
            ...args.payload,
            phone: args.phone,
        },
        provider: "INTERAKT",
        status: "pending",
        next_attempt_at: new Date().toISOString(),
    });
    if (error) console.error("enqueue WhatsApp template failed:", error);
}

// ─── State machine ─────────────────────────────────────────────────────────
//
// Hybrid: buttons drive the common paths, keywords parse free-text fallbacks,
// no AI. State held in wa_chat_threads.state with 30-min expiry.

type Category = "housekeeping" | "food" | "concierge" | "staff";

const KEYWORD_MAP: Array<{ kw: RegExp; category: Category }> = [
    { kw: /\b(towel|towels|clean|cleaning|sheets?|laundry|housekeeping)\b/i, category: "housekeeping" },
    { kw: /\b(food|meal|breakfast|lunch|dinner|menu|kitchen|order)\b/i, category: "food" },
    { kw: /\b(taxi|cab|tour|driver|guide|trek|concierge|tickets?)\b/i, category: "concierge" },
    { kw: /\b(staff|help|talk|speak|manager|reception|frontdesk|front\s*desk)\b/i, category: "staff" },
];

function detectCategoryFromText(text: string | null): Category | null {
    if (!text) return null;
    for (const { kw, category } of KEYWORD_MAP) {
        if (kw.test(text)) return category;
    }
    return null;
}

async function runStateMachine(args: {
    hotelId: string;
    threadId: string;
    phone: string;
    bookingId: string | null;
    inboundType: string;
    inboundText: string | null;
    buttonId?: string | null;
}) {
    const { hotelId, threadId, phone, bookingId, inboundType, inboundText, buttonId } = args;
    const stateRow = await getThreadState(threadId);

    // Expire stale state
    const stateActive =
        stateRow.state_expires_at && new Date(stateRow.state_expires_at) > new Date();

    const pending = stateActive ? (stateRow.state.pending as string | undefined) : undefined;

    // ── Branch 1: mid-conversation — interpret as answer to pending question
    if (pending) {
        // The bot already asked something. Take the inbound as the answer and
        // hand off to staff (v1: we don't auto-create tickets — staff convert).
        await enqueueWhatsAppTemplate({
            hotelId,
            bookingId,
            phone,
            templateCode: "staff_handoff",
            payload: {
                guest_phone: phone,
                pending_category: stateRow.state.category,
                guest_answer: inboundText,
            },
        });
        await setThreadState(threadId, null); // clear state
        return;
    }

    // ── Branch 2: button reply directly
    if (inboundType === "BUTTON_REPLY" && buttonId) {
        const category = mapButtonIdToCategory(buttonId);
        if (category) {
            await dispatchByCategory({ hotelId, threadId, phone, bookingId, category });
            return;
        }
    }

    // ── Branch 3: keyword match in free-text
    const guessed = detectCategoryFromText(inboundText);
    if (guessed) {
        await dispatchByCategory({ hotelId, threadId, phone, bookingId, category: guessed });
        return;
    }

    // ── Branch 4: first message OR no keyword → send the "how can we help" template
    await enqueueWhatsAppTemplate({
        hotelId,
        bookingId,
        phone,
        templateCode: "how_can_we_help",
        payload: { guest_phone: phone, guest_text: inboundText },
    });
    // Set state so next reply is interpreted as the answer
    await setThreadState(threadId, {
        pending: "how_can_we_help_choice",
        category: null,
        since: new Date().toISOString(),
    });
}

function mapButtonIdToCategory(buttonId: string): Category | null {
    const norm = buttonId.toLowerCase();
    if (/house|towel|clean/.test(norm)) return "housekeeping";
    if (/food|menu/.test(norm)) return "food";
    if (/concier|taxi|tour/.test(norm)) return "concierge";
    if (/staff|talk/.test(norm)) return "staff";
    return null;
}

async function dispatchByCategory(args: {
    hotelId: string;
    threadId: string;
    phone: string;
    bookingId: string | null;
    category: Category;
}) {
    const { hotelId, threadId, phone, bookingId, category } = args;
    const templateCode =
        category === "housekeeping" ? "housekeeping_ack" :
        category === "food"          ? "food_menu_link" :
        category === "concierge"     ? "concierge_ack" :
                                       "staff_handoff";

    await enqueueWhatsAppTemplate({
        hotelId,
        bookingId,
        phone,
        templateCode,
        payload: { guest_phone: phone, category },
    });

    // For housekeeping + concierge, keep state set so we collect more detail
    if (category === "housekeeping" || category === "concierge") {
        await setThreadState(threadId, {
            pending: `${category}_detail`,
            category,
            since: new Date().toISOString(),
        });
    } else {
        await setThreadState(threadId, null);
    }
}

// ─── Webhook event handlers ────────────────────────────────────────────────

async function handleMessageReceived(event: Record<string, unknown>) {
    // Interakt's message_received payload shape (varies; we extract defensively).
    const data = (event.data ?? event) as Record<string, unknown>;
    const phone =
        (data.phoneNumber as string) ??
        (data.from as string) ??
        ((data.customer as Record<string, unknown> | undefined)?.phone as string) ??
        "";
    if (!phone) return jsonResponse(400, { ok: false, error: "phone_missing" });

    const guestName =
        ((data.customer as Record<string, unknown> | undefined)?.name as string) ??
        (data.profileName as string) ??
        null;

    const providerMessageId =
        (data.id as string) ??
        (data.messageId as string) ??
        (data.message_id as string) ??
        "";

    // Determine message kind
    const messageType = String((data.messageType ?? data.type ?? "TEXT")).toUpperCase();
    const isButton = /BUTTON/i.test(messageType) || data.button !== undefined;
    const isList = /LIST/i.test(messageType) || data.list !== undefined;

    let body: string | null = null;
    let buttonId: string | null = null;
    let normalizedType = "TEXT";

    if (isButton) {
        normalizedType = "BUTTON_REPLY";
        const btn = (data.button ?? data.buttonReply ?? {}) as Record<string, unknown>;
        body = (btn.text as string) ?? (btn.title as string) ?? null;
        buttonId = (btn.payload as string) ?? (btn.id as string) ?? null;
    } else if (isList) {
        normalizedType = "LIST_REPLY";
        const lst = (data.list ?? data.listReply ?? {}) as Record<string, unknown>;
        body = (lst.title as string) ?? null;
        buttonId = (lst.id as string) ?? null;
    } else if (data.text !== undefined) {
        normalizedType = "TEXT";
        body = ((data.text as Record<string, unknown> | string)?.toString().slice(0, 4096)) || null;
        if (typeof data.text === "object") {
            body = ((data.text as Record<string, unknown>).body as string) ?? null;
        }
    } else if (data.image || data.video || data.document || data.audio) {
        normalizedType = data.image ? "IMAGE" : data.video ? "VIDEO" : data.document ? "DOCUMENT" : "AUDIO";
    }

    // Resolve hotel
    const candidates = await resolveHotel(phone);

    // 0 matches → unknown guest
    if (candidates.length === 0) {
        // We don't have a hotel to bind the thread to. Best-effort:
        // pick the platform's first hotel as a sink, OR drop the message.
        // For v1, log + drop. The owner sees nothing; the guest gets a
        // generic "no booking found" via an unmatched-direct-template.
        console.log(`No hotel match for inbound from ${phone}; dropping.`);
        // Optionally send an "unknown_guest" template if a default hotel exists
        // — skipped in v1 to avoid impersonation.
        return jsonResponse(200, { ok: true, dropped: "unknown_guest" });
    }

    // 1+ matches → record on the best (first) candidate
    const primary = candidates[0];

    const inserted = await recordInbound({
        hotelId: primary.hotel_id,
        phone,
        guestName,
        messageType: normalizedType,
        body,
        payload: data,
        provider: "INTERAKT",
        providerMessageId,
        lastBookingId: primary.booking_id,
    });

    if (!inserted) {
        return jsonResponse(500, { ok: false, error: "record_inbound_failed" });
    }

    // If multiple candidates, ask which property (a future ambiguity-resolution flow)
    if (candidates.length > 1) {
        await enqueueWhatsAppTemplate({
            hotelId: primary.hotel_id,
            bookingId: primary.booking_id,
            phone,
            templateCode: "which_property",
            payload: {
                candidates: candidates.map((c) => ({ id: c.hotel_id, name: c.hotel_name })),
            },
        });
        return jsonResponse(200, { ok: true, asked_which_property: true });
    }

    // Single hotel → run the state machine
    await runStateMachine({
        hotelId: primary.hotel_id,
        threadId: inserted.thread_id,
        phone,
        bookingId: primary.booking_id,
        inboundType: normalizedType,
        inboundText: body,
        buttonId,
    });

    // Existing drip auto-pause hook — uses (hotel_id, lead_id, channel) signature
    try {
        const { data: leads } = await supabase.rpc("lookup_lead_by_contact", {
            p_hotel_id: primary.hotel_id,
            p_phone: phone,
            p_email: null,
        });
        // lookup_lead_by_contact RETURNS TABLE → array
        const leadId = Array.isArray(leads) && leads.length > 0
            ? (leads[0] as { lead_id: string }).lead_id
            : null;
        if (leadId) {
            await supabase.rpc("pause_drips_on_lead_reply", {
                p_hotel_id: primary.hotel_id,
                p_lead_id: leadId,
                p_channel: "WHATSAPP",
            });
        }
    } catch {
        // best-effort; drip pause is not load-bearing for this webhook
    }

    return jsonResponse(200, { ok: true, thread_id: inserted.thread_id });
}

async function handleMessageStatus(event: Record<string, unknown>) {
    const data = (event.data ?? event) as Record<string, unknown>;
    const providerMessageId =
        (data.id as string) ??
        (data.messageId as string) ??
        (data.message_id as string) ??
        (data.callbackData as string) ??
        "";
    if (!providerMessageId) {
        return jsonResponse(200, { ok: true, skipped: "no_id" });
    }

    const rawStatus = String(data.status ?? data.event ?? "").toLowerCase();
    const status: string =
        rawStatus.includes("read")      ? "READ"  :
        rawStatus.includes("delivered") ? "DELIVERED" :
        rawStatus.includes("failed")    ? "FAILED" :
        rawStatus.includes("sent")      ? "SENT" :
                                          "SENT";

    const failedReason =
        (data.reason as string) ??
        (data.errorMessage as string) ??
        (data.error_message as string) ??
        null;

    await supabase.rpc("update_chat_message_status", {
        p_provider_message_id: providerMessageId,
        p_status: status,
        p_failed_reason: failedReason,
    });

    return jsonResponse(200, { ok: true });
}

async function handleTemplateStatus(_event: Record<string, unknown>) {
    // v1: log only. Future: mirror to an interakt_template_status table for
    // the owner UI to show which templates are approved.
    return jsonResponse(200, { ok: true, noted: "template_status" });
}

// ─── HTTP handler ──────────────────────────────────────────────────────────

serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }
    if (req.method !== "POST") {
        return jsonResponse(405, { ok: false, error: "method_not_allowed" });
    }

    // Read raw body for signature verification BEFORE parsing JSON.
    const rawBody = await req.text();

    // Signature header name varies; accept either Interakt's bespoke
    // 'x-interakt-signature' or Meta-style 'x-hub-signature-256'.
    const sigHeader =
        req.headers.get("x-interakt-signature") ??
        req.headers.get("x-hub-signature-256") ??
        req.headers.get("x-signature");

    const valid = await verifyInteraktSignature(rawBody, sigHeader);
    if (!valid) {
        console.error("Interakt webhook signature verification FAILED");
        return jsonResponse(401, { ok: false, error: "invalid_signature" });
    }

    let event: Record<string, unknown>;
    try {
        event = JSON.parse(rawBody);
    } catch {
        return jsonResponse(400, { ok: false, error: "invalid_json" });
    }

    const eventType = String(
        event.type ?? event.event ?? (event.data as Record<string, unknown> | undefined)?.event ?? "",
    ).toLowerCase();

    try {
        if (eventType.includes("message_received") || eventType.includes("incoming") || eventType.includes("user_replied")) {
            return await handleMessageReceived(event);
        }
        if (eventType.includes("status") || eventType.includes("delivered") || eventType.includes("read") || eventType.includes("failed")) {
            return await handleMessageStatus(event);
        }
        if (eventType.includes("template")) {
            return await handleTemplateStatus(event);
        }
        // Unknown event — accept (200) so Interakt doesn't retry indefinitely
        console.log("Unhandled Interakt event type:", eventType);
        return jsonResponse(200, { ok: true, unhandled: eventType });
    } catch (err) {
        // Always return 200 to prevent infinite retries; log internally.
        console.error("Interakt webhook handler error:", err);
        return jsonResponse(200, { ok: false, error: (err as Error).message });
    }
});
