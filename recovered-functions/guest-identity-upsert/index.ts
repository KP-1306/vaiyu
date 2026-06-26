// supabase/functions/guest-identity-upsert/index.ts
//
// POST /functions/v1/guest-identity-upsert
//
// Body (JSON) – we accept a superset of fields, but only use identity fields:
//
// {
//   "booking_code": "ABC123",          // optional (ignored for now)
//   "hotel_id": "uuid-of-hotel",       // optional (ignored for now)
//
//   "full_name": "Demo Guest",
//   "phone": "9999999999",
//   "email": "guest@example.com",
//   "country": "IN",
//   "preferred_language": "en-IN",
//
//   "id_type": "AADHAAR" | "PASSPORT" | "DL" | "VOTER_ID" | string,
//   "id_number": "XXXX1234"
// }
//
// Behaviour:
//   • Uses ANON key + Supabase Auth (Authorization: Bearer …).
//   • Upserts into `guest_identity` with account_id = auth.uid().
//   • Does NOT throw to the frontend; always 200 with:
//       { ok: true }  OR  { ok: false, error, message }
//
// IMPORTANT:
//   • Make sure `guest_identity` table exists and RLS allows the authed user
//     to insert/update their own row (account_id = auth.uid()).

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.0";

// -----------------------------------------------------------------------------
// CORS + helpers
// -----------------------------------------------------------------------------
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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

function normalizePhone(raw: unknown): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/[^\d]/g, "");
  return digits || null;
}

function isTableMissing(error: unknown): boolean {
  return !!(
    error &&
    typeof error === "object" &&
    (error as { code?: string }).code === "42P01"
  );
}

// -----------------------------------------------------------------------------
// Main handler
// -----------------------------------------------------------------------------
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    // Soft-fail but keep HTTP 200 so frontend never explodes
    return json({
      ok: false,
      error: "method_not_allowed",
      message: "Only POST is supported.",
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error(
      "[guest-identity-upsert] Missing SUPABASE_URL or SUPABASE_ANON_KEY",
    );
    return json(
      {
        ok: false,
        error: "backend_not_configured",
        message: "Supabase environment not configured.",
      },
      500,
    );
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
    // Upsert is only allowed for logged-in guests
    return json({
      ok: false,
      error: "unauthorized",
      message: "Missing or invalid Authorization header.",
    });
  }

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return json({
      ok: false,
      error: "invalid_body",
      message: "Expected a JSON object body.",
    });
  }
  if (!body || typeof body !== "object") {
    return json({
      ok: false,
      error: "invalid_body",
      message: "Expected a JSON object body.",
    });
  }

  const client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
    global: {
      headers: {
        apikey: supabaseAnonKey,
        Authorization: authHeader,
      },
    },
  });

  try {
    // 1) Resolve current authenticated user
    const {
      data: { user },
      error: userError,
    } = await client.auth.getUser();

    if (userError) {
      console.error("[guest-identity-upsert] getUser error", userError);
    }

    if (!user) {
      return json({
        ok: false,
        error: "unauthorized",
        message: "Sign-in required to save guest identity.",
      });
    }

    // 2) Extract + normalise identity fields from body
    const fullName = (body.full_name ?? "").trim() || null;
    const phone = normalizePhone(body.phone);
    const emailRaw = (body.email ?? "").trim();
    const email = emailRaw ? emailRaw.toLowerCase() : null;
    const country = (body.country ?? "").trim() || null;
    const preferredLanguage =
      (body.preferred_language ?? "").trim() || null;

    const idType = (body.id_type ?? "").trim() || null;
    const idNumber = (body.id_number ?? "").trim() || null;

    // Optional: we still accept booking_code / hotel_id but ignore them for now.
    // const bookingCode = (body.booking_code ?? "").trim() || null;
    // const hotelId = body.hotel_id ?? null;

    // At least one identifier (phone/email) is strongly recommended
    if (!phone && !email && !fullName && !idType && !idNumber) {
      return json({
        ok: false,
        error: "no_fields",
        message:
          "Nothing to save – provide at least one of name, phone, email or ID details.",
      });
    }

    const row = {
      account_id: user.id,
      full_name: fullName,
      primary_phone: phone,
      primary_email: email,
      id_type: idType,
      id_number: idNumber,
      country,
      preferred_language: preferredLanguage,
      // created_at / updated_at can be handled by DB defaults/triggers
    };

    // 3) Upsert into guest_identity (by account_id)
    const { error: upsertError } = await client
      .from("guest_identity")
      .upsert(row, { onConflict: "account_id" });

    if (upsertError) {
      if (isTableMissing(upsertError)) {
        console.error(
          "[guest-identity-upsert] guest_identity table is missing",
          upsertError,
        );
        return json({
          ok: false,
          error: "table_missing",
          message:
            "guest_identity table not found. Run the migration before using this endpoint.",
        });
      }

      console.error(
        "[guest-identity-upsert] upsert error",
        upsertError,
      );
      return json({
        ok: false,
        error: "upsert_failed",
        message: "Could not save guest identity.",
      });
    }

    // 4) Success
    return json({ ok: true });
  } catch (err) {
    console.error("[guest-identity-upsert] Unhandled error", err);
    return json({
      ok: false,
      error: "internal_error",
      message: "Unexpected error while saving guest identity.",
    });
  }
});
