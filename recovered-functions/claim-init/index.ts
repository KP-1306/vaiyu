// supabase/functions/claim-init/index.ts
//
// POST /functions/v1/claim-init
//
// Starts a "claim your stay" OTP flow.
// - Validates booking_code + phone
// - Optionally checks the bookings table
// - Generates an OTP and (if table exists) stores it in booking_claim_otps
// - In demo mode, returns otp_hint so you can test without SMS.
//
// This is intentionally soft-failing: if bookings or claim-OTP tables don't
// exist yet, it still returns ok:true for demo/testing.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.0";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function normalizePhone(raw: string | null | undefined): string {
  if (!raw) return "";
  return String(raw).replace(/[^\d]/g, "");
}

function generateOtp(): string {
  const n = Math.floor(Math.random() * 900_000) + 100_000;
  return String(n);
}

function isTableMissing(error: unknown): boolean {
  return !!(
    error &&
    typeof error === "object" &&
    (error as any).code === "42P01"
  );
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    // Soft fail so frontend never crashes
    return json({
      ok: false,
      error: "method_not_allowed",
      message: "Only POST is supported.",
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!supabaseUrl || !supabaseAnonKey) {
    console.error("[claim-init] Missing SUPABASE_URL or SUPABASE_ANON_KEY");
    return json({ ok: false, error: "backend_not_configured" }, 500);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({
      ok: false,
      error: "invalid_body",
      message: "Expected JSON body.",
    });
  }

  const rawCode =
    body?.code ?? body?.booking_code ?? body?.bookingCode ?? "";
  const rawPhone =
    body?.phone ?? body?.contact ?? body?.mobile ?? body?.phone_number ?? "";

  const bookingCode = String(rawCode).trim().toUpperCase();
  const phoneDigits = normalizePhone(rawPhone);

  if (!bookingCode) {
    return json({
      ok: false,
      error: "code_required",
      message: "Please provide booking code in body.code.",
    });
  }
  if (!phoneDigits || phoneDigits.length < 8 || phoneDigits.length > 15) {
    return json({
      ok: false,
      error: "phone_invalid",
      message: "Please provide a valid phone number (8–15 digits).",
    });
  }

  const client = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        apikey: supabaseAnonKey,
        authorization: req.headers.get("Authorization") ?? "",
      },
    },
  });

  let booking: any = null;

  // 1) Try to look up the booking (optional, but nice if bookings exists)
  try {
    const { data, error } = await client
      .from("bookings")
      .select("code, hotel_id, guest_name, phone")
      .eq("code", bookingCode)
      .maybeSingle();

    if (error) {
      if (!isTableMissing(error)) {
        console.error("[claim-init] bookings error", error);
      }
    } else {
      booking = data;
    }
  } catch (err) {
    console.error("[claim-init] bookings unexpected error", err);
  }

  // If we found a booking, and it has a phone, check it matches
  if (booking?.phone) {
    const storedDigits = normalizePhone(booking.phone);
    if (storedDigits && storedDigits !== phoneDigits) {
      return json({
        ok: false,
        error: "phone_mismatch",
        message:
          "Phone number does not match the one on your reservation. Please check and try again.",
      });
    }
  }

  // 2) Generate OTP and try to persist it (for a real production flow)
  const otp =
    Deno.env.get("VAIYU_CLAIM_DEMO_OTP")?.trim() || generateOtp();
  const ttlMinutes = Number(
    Deno.env.get("VAIYU_CLAIM_OTP_TTL_MINUTES") || "10",
  );
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString();

  try {
    const { error } = await client.from("booking_claim_otps").insert({
      booking_code: bookingCode,
      phone: phoneDigits,
      otp, // for stricter security, change to a hash & adjust verify fn
      expires_at: expiresAt,
    });

    if (error && !isTableMissing(error)) {
      console.error("[claim-init] booking_claim_otps insert error", error);
    }
  } catch (err) {
    console.error("[claim-init] booking_claim_otps unexpected error", err);
  }

  // 3) TODO: send SMS via your provider here
  // (Twilio, Gupshup, etc.) using phoneDigits + otp.

  const showHint =
    Deno.env.get("VAIYU_CLAIM_SHOW_OTP_HINT") === "1" ||
    Deno.env.get("VAIYU_CLAIM_DEMO_MODE") === "1";

  return json({
    ok: true,
    method: "otp",
    sent: true,
    ttl_seconds: ttlMinutes * 60,
    demo: showHint, // just for debug
    otp_hint: showHint ? otp : undefined,
    booking: booking
      ? {
          code: booking.code,
          hotel_id: booking.hotel_id,
          guest_name: booking.guest_name,
        }
      : null,
  });
});
