// supabase/functions/guest-identity/index.ts
//
// GET /functions/v1/guest-identity
//
// Safe "current guest identity" lookup for autofill flows.
// - Uses Supabase Auth (Authorization: Bearer <access_token>).
// - Looks up a single row from `guest_identity` where account_id = auth.uid().
// - Returns a reusable identity payload suitable for pre-filling forms.
//
// Response shape:
//   { ok: true, identity: {...} }   // when row exists
//   { ok: true, identity: null }    // when no row yet
//
// Notes:
//   • Uses ANON key + RLS; no service role, safe to call from the browser
//     as long as you pass a valid Supabase session token.
//   • If the `guest_identity` table doesn't exist yet, we soft-fail with
//     { ok: true, identity: null } so the UI never crashes.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.0";

// -----------------------------------------------------------------------------
// CORS + helpers
// -----------------------------------------------------------------------------
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
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

  if (req.method !== "GET") {
    // Soft-fail (200) so frontend never explodes on wrong method.
    return json({
      ok: false,
      error: "method_not_allowed",
      message: "Only GET is supported.",
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error(
      "[guest-identity] Missing SUPABASE_URL or SUPABASE_ANON_KEY",
    );
    return json(
      {
        ok: false,
        error: "backend_not_configured",
      },
      500,
    );
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
    // No valid auth token → just tell the caller they’re unauthenticated.
    return json(
      {
        ok: false,
        error: "unauthorized",
        message: "Missing or invalid Authorization header.",
        identity: null,
      },
      401,
    );
  }

  const client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
    },
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
      console.error("[guest-identity] getUser error", userError);
    }

    if (!user) {
      return json(
        {
          ok: false,
          error: "unauthorized",
          message: "Sign-in required to load guest identity.",
          identity: null,
        },
        401,
      );
    }

    // 2) Look up guest_identity row by account_id
    let identity: any = null;

    try {
      const { data, error } = await client
        .from("guest_identity")
        .select(
          `
          account_id,
          full_name,
          primary_phone,
          primary_email,
          id_type,
          id_number,
          city,
          country,
          created_at,
          updated_at
        `,
        )
        .eq("account_id", user.id)
        .maybeSingle();

      if (error) {
        if (!isTableMissing(error)) {
          console.error("[guest-identity] guest_identity error", error);
        }
        // If table is missing, we just behave like "no identity yet".
      } else if (data) {
        identity = data;
      }
    } catch (err) {
      console.error(
        "[guest-identity] guest_identity unexpected error",
        err,
      );
    }

    // 3) Shape payload (only safe, form-friendly fields)
    let shaped: any = null;
    if (identity) {
      shaped = {
        account_id: identity.account_id ?? user.id,
        full_name: identity.full_name ?? null,
        primary_phone: identity.primary_phone ?? null,
        primary_email: identity.primary_email ?? null,
        id_type: identity.id_type ?? null,
        id_number: identity.id_number ?? null,
        city: identity.city ?? null,
        country: identity.country ?? null,
        created_at: identity.created_at ?? null,
        updated_at: identity.updated_at ?? null,
      };
    }

    return json({
      ok: true,
      identity: shaped, // null if no row yet
    });
  } catch (err) {
    console.error("[guest-identity] Unhandled error", err);
    return json(
      {
        ok: false,
        error: "internal_error",
        identity: null,
      },
      500,
    );
  }
});
