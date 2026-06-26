// supabase/functions/claim-verify/index.ts
//
// POST /functions/v1/claim-verify
//
// Step 2 of "claim your stay":
// - Validates booking_code + otp (and phone)
// - Checks booking_claim_otps for a matching, non-expired OTP
// - Links the booking to the logged-in user via bookings.guest_id
// - Returns a clean booking payload (now also includes guest_id, status)
//
// IMPORTANT:
// - Requires SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
// - Expects tables: bookings, booking_claim_otps.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.0";

// ---------------------------------------------------------------------------
// Shared helpers (same pattern as claim-init)
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

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json(
      {
        ok: false,
        error: "method_not_allowed",
        message: "Only POST is supported.",
      },
      405,
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const supabaseServiceKey =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
    console.error(
      "[claim-verify] Missing SUPABASE_URL / ANON_KEY / SERVICE_ROLE_KEY",
    );
    return json(
      { ok: false, error: "backend_not_configured" },
      500,
    );
  }

  // -------------------------------------------------------------------------
  // Parse body
  // -------------------------------------------------------------------------
  let body: any;
  try {
    body = await req.json();
  } catch {
    return json(
      {
        ok: false,
        error: "invalid_body",
        message: "Expected JSON body.",
      },
      400,
    );
  }

  const rawCode =
    body?.code ?? body?.booking_code ?? body?.bookingCode ?? "";
  const rawOtp = body?.otp ?? body?.code_otp ?? "";
  const rawPhone =
    body?.phone ?? body?.contact ?? body?.mobile ?? body?.phone_number ?? "";

  const bookingCode = String(rawCode).trim().toUpperCase();
  const otp = String(rawOtp).trim();
  const phoneDigits = normalizePhone(rawPhone);

  if (!bookingCode) {
    return json(
      {
        ok: false,
        error: "code_required",
        message: "Please provide booking code in body.code.",
      },
      400,
    );
  }

  if (!otp) {
    return json(
      {
        ok: false,
        error: "otp_required",
        message: "Please provide the OTP sent to your phone.",
      },
      400,
    );
  }

  // Phone is kept mandatory for now, to stay aligned with claim-init.
  if (!phoneDigits || phoneDigits.length < 8 || phoneDigits.length > 15) {
    return json(
      {
        ok: false,
        error: "phone_invalid",
        message:
          "Please provide a valid phone number (8–15 digits) used for claim-init.",
      },
      400,
    );
  }

  // -------------------------------------------------------------------------
  // Auth: which user is claiming?
  // -------------------------------------------------------------------------

  // Use anon client + Authorization header ONLY to get auth user
  const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        apikey: supabaseAnonKey,
        authorization: req.headers.get("Authorization") ?? "",
      },
    },
  });

  const {
    data: { user },
    error: userErr,
  } = await supabaseAuth.auth.getUser();

  if (userErr || !user) {
    console.error("[claim-verify] auth error", userErr);
    return json(
      {
        ok: false,
        error: "not_authenticated",
        message: "Please sign in before claiming your stay.",
      },
      401,
    );
  }

  // Service client for privileged DB updates (bypasses RLS safely)
  const supabaseService = createClient(supabaseUrl, supabaseServiceKey, {
    global: {
      headers: {
        apikey: supabaseServiceKey,
      },
    },
  });

  try {
    // -----------------------------------------------------------------------
    // 1) Look up latest OTP for this booking_code + phone
    // -----------------------------------------------------------------------
    const { data: otpRow, error: otpErr } = await supabaseService
      .from("booking_claim_otps")
      .select("id, booking_code, phone, otp, expires_at")
      .eq("booking_code", bookingCode)
      .eq("phone", phoneDigits)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (otpErr) {
      console.error("[claim-verify] booking_claim_otps error", otpErr);
      return json(
        {
          ok: false,
          error: "otp_lookup_failed",
          message: "Could not verify OTP. Please try again.",
        },
        400,
      );
    }

    if (!otpRow) {
      return json(
        {
          ok: false,
          error: "otp_not_found",
          message: "We couldn’t find a valid OTP. Please restart the claim.",
        },
        400,
      );
    }

    // Check expiry
    if (otpRow.expires_at) {
      const exp = new Date(otpRow.expires_at).getTime();
      if (isFinite(exp) && exp < Date.now()) {
        return json(
          {
            ok: false,
            error: "otp_expired",
            message: "Your OTP has expired. Please request a new one.",
          },
          400,
        );
      }
    }

    // Check code match
    if (String(otpRow.otp).trim() !== otp) {
      return json(
        {
          ok: false,
          error: "otp_mismatch",
          message: "Incorrect OTP. Please check and try again.",
        },
        400,
      );
    }

    // -----------------------------------------------------------------------
    // 2) Link booking to this user: bookings.guest_id = user.id
    // -----------------------------------------------------------------------
    const { data: booking, error: updErr } = await supabaseService
      .from("bookings")
      .update({ guest_id: user.id })
      .eq("code", bookingCode)
      .select(
        // NOTE: we also select guest_id + status now (for Stays screen)
        "code, hotel_id, guest_name, check_in, check_out, guest_id, status",
      )
      .maybeSingle();

    if (updErr || !booking) {
      console.error("[claim-verify] bookings update error", updErr);
      return json(
        {
          ok: false,
          error: "booking_update_failed",
          message:
            "We verified your OTP but could not link the booking. Please contact support.",
        },
        400,
      );
    }

    // -----------------------------------------------------------------------
    // 3) Optional: mark OTP as used (best practice)
    // -----------------------------------------------------------------------
    if (otpRow.id) {
      await supabaseService
        .from("booking_claim_otps")
        .delete()
        .eq("id", otpRow.id)
        .catch((e) =>
          console.warn("[claim-verify] could not delete otp row", e),
        );
    }

    // -----------------------------------------------------------------------
    // 4) Respond with a simple, frontend-friendly payload
    //    (old fields preserved; new fields guest_id + status are additive)
// -----------------------------------------------------------------------
    return json({
      ok: true,
      booking: {
        code: booking.code,
        hotel_id: booking.hotel_id,
        guest_name: booking.guest_name,
        check_in: booking.check_in,
        check_out: booking.check_out,
        guest_id: booking.guest_id,       // NEW: useful for debugging / me-stays
        status: booking.status ?? null,   // NEW: optional, doesn’t break callers
      },
    });
  } catch (err) {
    console.error("[claim-verify] fatal error", err);
    return json(
      {
        ok: false,
        error: "server_error",
        message: "Something went wrong while verifying your claim.",
      },
      500,
    );
  }
});
