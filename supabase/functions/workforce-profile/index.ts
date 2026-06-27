// supabase/functions/workforce-profile/index.ts

import { serve } from "https://deno.land/std@0.210.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

serve(async (req: Request): Promise<Response> => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

  if (!supabaseUrl || !supabaseAnonKey) {
    return jsonResponse(500, { error: "supabase_env_not_configured" });
  }

  const authHeader = req.headers.get("Authorization") ?? "";

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: authHeader
      ? {
          headers: { Authorization: authHeader },
        }
      : undefined,
  });

  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();

  if (userErr || !user) {
    return jsonResponse(401, { error: "not_authenticated" });
  }

  // ----- GET: return caller’s own workforce profile -----
  if (req.method === "GET") {
    const { data, error } = await supabase
      .from("workforce_profiles")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) {
      return jsonResponse(500, { error: error.message });
    }
    // When no row exists, data will be null – that’s fine, UI sees { profile: null }
    return jsonResponse(200, { profile: data });
  }

  // ----- POST: upsert caller’s workforce profile -----
  if (req.method === "POST") {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return jsonResponse(400, { error: "invalid_json" });
    }

    const experienceYears =
      typeof body.experience_years === "number"
        ? body.experience_years
        : body.experience_years != null
        ? Number(body.experience_years) || null
        : null;

    const payload = {
      user_id: user.id,
      full_name: body.full_name ?? null,
      headline: body.headline ?? null,
      bio: body.bio ?? null,
      skills: Array.isArray(body.skills) ? body.skills : null,
      languages: Array.isArray(body.languages) ? body.languages : null,
      experience_years: experienceYears,
      location_city: body.location_city ?? null,
      location_state: body.location_state ?? null,
      location_country: body.location_country ?? "IN",
      preferred_property_types: Array.isArray(
        body.preferred_property_types,
      )
        ? body.preferred_property_types
        : null,
      willing_relocate:
        typeof body.willing_relocate === "boolean"
          ? body.willing_relocate
          : null,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from("workforce_profiles")
      .upsert(payload, { onConflict: "user_id" })
      .select("*")
      .maybeSingle();

    if (error) {
      return jsonResponse(500, { error: error.message });
    }

    return jsonResponse(200, { profile: data });
  }

  // ----- Unsupported method -----
  return jsonResponse(405, { error: "method_not_allowed" });
});
