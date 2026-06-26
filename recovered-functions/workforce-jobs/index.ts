// supabase/functions/workforce-jobs/index.ts
import { serve } from "https://deno.land/std@0.210.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.0";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
};
function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}
serve(async (req)=>{
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") ?? "open";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!supabaseUrl || !supabaseAnonKey) {
    return jsonResponse(500, {
      error: "supabase_env_not_configured"
    });
  }
  const authHeader = req.headers.get("Authorization") ?? "";
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: authHeader ? {
      headers: {
        Authorization: authHeader
      }
    } : undefined
  });
  // ---------------------------------------------------------------------------
  // GET: list jobs
  //   mode=open      → public/open jobs (search by city/state/role)
  //   mode=property  → jobs for a specific property (owner/manager)
  // ---------------------------------------------------------------------------
  if (req.method === "GET") {
    if (mode === "open") {
      let query = supabase.from("workforce_jobs").select("*").eq("status", "open").order("created_at", {
        ascending: false
      }).limit(100);
      const city = url.searchParams.get("city");
      const state = url.searchParams.get("state");
      const role = url.searchParams.get("role");
      if (city) {
        // exact case-insensitive match; you can later switch to `%${city}%`
        query = query.ilike("city", city);
      }
      if (state) {
        query = query.ilike("state", state);
      }
      if (role) {
        query = query.eq("role_key", role);
      }
      const { data, error } = await query;
      if (error) {
        // permission denied → 403, everything else → 500
        const status = error.code === "42501" ? 403 : 500;
        return jsonResponse(status, {
          error: error.message
        });
      }
      return jsonResponse(200, {
        jobs: data ?? []
      });
    }
    if (mode === "property") {
      // accept a few variants just in case: property_id / hotel_id / propertyId / hotelId
      const propertyId = url.searchParams.get("property_id") ?? url.searchParams.get("hotel_id") ?? url.searchParams.get("propertyId") ?? url.searchParams.get("hotelId");
      if (!propertyId) {
        return jsonResponse(400, {
          error: "property_id_required"
        });
      }
      const { data, error } = await supabase.from("workforce_jobs").select("*").eq("property_id", propertyId).neq("status", "deleted").order("created_at", {
        ascending: false
      });
      if (error) {
        const status = error.code === "42501" ? 403 : 500;
        return jsonResponse(status, {
          error: error.message
        });
      }
      return jsonResponse(200, {
        jobs: data ?? []
      });
    }
    return jsonResponse(400, {
      error: "invalid_mode"
    });
  }
  // ---------------------------------------------------------------------------
  // POST: create / update a job
  // ---------------------------------------------------------------------------
  if (req.method === "POST") {
    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) {
      return jsonResponse(401, {
        error: "not_authenticated"
      });
    }
    let body;
    try {
      body = await req.json();
    } catch  {
      return jsonResponse(400, {
        error: "invalid_json"
      });
    }
    // Normalise IDs (property & job) to support a few client shapes
    const propertyId = body.property_id ?? body.hotel_id ?? body.propertyId ?? body.hotelId ?? null;
    const jobId = body.id ?? body.job_id ?? body.jobId ?? null;
    const contractDays = typeof body.contract_days === "number" ? body.contract_days : body.contract_days != null ? Number(body.contract_days) || null : null;
    const minSalary = typeof body.min_salary === "number" ? body.min_salary : body.min_salary != null ? Number(body.min_salary) || null : null;
    const maxSalary = typeof body.max_salary === "number" ? body.max_salary : body.max_salary != null ? Number(body.max_salary) || null : null;
    const base = {
      property_type: body.property_type ?? "hotel",
      property_id: propertyId,
      title: body.title ?? null,
      role_key: body.role_key ?? null,
      job_type: body.job_type ?? "full_time",
      contract_days: contractDays,
      min_salary: minSalary,
      max_salary: maxSalary,
      currency: body.currency ?? "INR",
      city: body.city ?? null,
      state: body.state ?? null,
      country: body.country ?? "IN",
      status: body.status ?? "open",
      notes: body.notes ?? null,
      created_by: user.id,
      updated_at: new Date().toISOString()
    };
    let result;
    if (jobId) {
      const { data, error } = await supabase.from("workforce_jobs").update(base).eq("id", jobId).select("*").maybeSingle();
      if (error) {
        const status = error.code === "42501" ? 403 : 500;
        return jsonResponse(status, {
          error: error.message
        });
      }
      result = data;
    } else {
      const { data, error } = await supabase.from("workforce_jobs").insert(base).select("*").maybeSingle();
      if (error) {
        const status = error.code === "42501" ? 403 : 500;
        return jsonResponse(status, {
          error: error.message
        });
      }
      result = data;
    }
    // Shape is still { job: {...} } as before
    return jsonResponse(200, {
      job: result
    });
  }
  // ---------------------------------------------------------------------------
  // Fallback
  // ---------------------------------------------------------------------------
  return jsonResponse(405, {
    error: "method_not_allowed"
  });
});
