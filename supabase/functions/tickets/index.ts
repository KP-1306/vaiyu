// supabase/functions/tickets/index.ts
// VAiyu – Ops Tickets + SLA HTTP API
//
// Endpoints (all JSON):
// GET    /tickets?hotelId=...&status=...&priority=...&overdue=true|false
// POST   /tickets
// PATCH  /tickets/:id
//
// Auth: expects Authorization: Bearer <supabase-jwt> from frontend.
// RLS is enforced because we use the ANON key + forward the Authorization header.

import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
};

function json(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
      ...(init.headers || {}),
    },
    status: init.status ?? 200,
  });
}

serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const { searchParams } = url;

  // Path will look like: /tickets or /tickets/<id>
  const pathname = url.pathname.replace(/\/+/g, "/");
  const base = pathname.replace(/^\/tickets/, "") || "/";
  const ticketId = base !== "/" ? base.replace(/^\//, "") : null;

  const authHeader = req.headers.get("Authorization") ?? "";

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  try {
    if (req.method === "GET" && base === "/") {
      return handleListTickets(req, supabase, searchParams);
    }

    if (req.method === "POST" && base === "/") {
      return await handleCreateTicket(req, supabase);
    }

    if (req.method === "PATCH" && ticketId) {
      return await handleUpdateTicket(req, supabase, ticketId);
    }

    return json({ error: "Not found" }, { status: 404 });
  } catch (err) {
    console.error("tickets function error:", err);
    return json(
      { error: "Internal server error", details: String(err) },
      { status: 500 },
    );
  }
});

// ---------- Handlers ----------

async function handleListTickets(
  _req: Request,
  supabase: ReturnType<typeof createClient>,
  searchParams: URLSearchParams,
): Promise<Response> {
  const hotelId = searchParams.get("hotelId");
  if (!hotelId) {
    return json(
      { error: "Missing required query param 'hotelId'" },
      { status: 400 },
    );
  }

  const status = searchParams.get("status"); // e.g. 'new', 'in_progress', 'resolved'
  const priority = searchParams.get("priority"); // 'low' | 'normal' | 'high' | 'urgent'
  const overdue = searchParams.get("overdue"); // 'true' | 'false'
  const limit = Number(searchParams.get("limit") ?? "50");
  const offset = Number(searchParams.get("offset") ?? "0");

  let query = supabase
    .from("tickets_sla_status")
    .select("*")
    .eq("hotel_id", hotelId)
    .order("due_at", { ascending: true })
    .range(offset, offset + limit - 1);

  if (status) {
    query = query.eq("status", status);
  }

  if (priority) {
    query = query.eq("priority", priority);
  }

  if (overdue === "true") {
    query = query.eq("is_overdue", true);
  } else if (overdue === "false") {
    query = query.eq("is_overdue", false);
  }

  const { data, error } = await query;

  if (error) {
    console.error("handleListTickets error:", error);
    return json({ error: error.message }, { status: 400 });
  }

  return json({ items: data ?? [] });
}

async function handleCreateTicket(
  req: Request,
  supabase: ReturnType<typeof createClient>,
): Promise<Response> {
  const body = await safeJson(req);
  if (!body.ok) {
    return json({ error: body.error }, { status: 400 });
  }

  const {
    hotelId,
    serviceKey,
    title,
    details,
    source,
    bookingCode,
    priority,
    room,
  } = body.value as {
    hotelId?: string;
    serviceKey?: string;
    title?: string;
    details?: string;
    source?: string;
    bookingCode?: string;
    priority?: string;
    room?: string;
  };

  if (!hotelId || !serviceKey || !title) {
    return json(
      {
        error:
          "Missing required fields: hotelId, serviceKey, title are mandatory",
      },
      { status: 400 },
    );
  }

  const { data, error } = await supabase.rpc("create_ticket", {
    p_hotel_id: hotelId,
    p_service_key: serviceKey,
    p_title: title,
    p_details: details ?? null,
    p_source: (source ?? "guest") as unknown,
    p_booking_code: bookingCode ?? null,
    p_priority: (priority ?? "normal") as unknown,
    p_room: room ?? null,
  });

  if (error) {
    console.error("handleCreateTicket error:", error);
    return json({ error: error.message }, { status: 400 });
  }

  // Optionally enrich with SLA fields from view
  const createdId = (data as any)?.id;
  if (!createdId) {
    return json({ ticket: data });
  }

  const { data: viewRow, error: viewError } = await supabase
    .from("tickets_sla_status")
    .select("*")
    .eq("id", createdId)
    .maybeSingle();

  if (viewError) {
    console.error("handleCreateTicket view error:", viewError);
    return json({ ticket: data });
  }

  return json({ ticket: viewRow ?? data }, { status: 201 });
}

async function handleUpdateTicket(
  req: Request,
  supabase: ReturnType<typeof createClient>,
  ticketId: string,
): Promise<Response> {
  const body = await safeJson(req);
  if (!body.ok) {
    return json({ error: body.error }, { status: 400 });
  }

  const { action, assigneeId } = body.value as {
    action?: string;
    assigneeId?: string;
  };

  if (!action) {
    return json({ error: "Missing 'action' in body" }, { status: 400 });
  }

  const map: Record<
    string,
    { rpc: string; args?: Record<string, unknown> }
  > = {
    accept: { rpc: "accept_ticket" },
    start: { rpc: "start_progress" },
    pause: { rpc: "pause_ticket" },
    resume: { rpc: "resume_ticket" },
    resolve: { rpc: "resolve_ticket" },
    close: { rpc: "close_ticket" },
    bumpPriority: { rpc: "bump_priority" },
    reassign: { rpc: "reassign_ticket" },
  };

  const entry = map[action];
  if (!entry) {
    return json(
      {
        error:
          "Invalid action. Allowed: accept, start, pause, resume, resolve, close, bumpPriority, reassign",
      },
      { status: 400 },
    );
  }

  const rpcArgs: Record<string, unknown> = { p_ticket_id: ticketId };

  if (action === "reassign") {
    if (!assigneeId) {
      return json(
        { error: "assigneeId is required for action 'reassign'" },
        { status: 400 },
      );
    }
    rpcArgs["p_new_assigned_to"] = assigneeId;
  }

  const { error } = await supabase.rpc(entry.rpc, rpcArgs);
  if (error) {
    console.error("handleUpdateTicket RPC error:", error);
    return json({ error: error.message }, { status: 400 });
  }

  // Fetch the updated ticket with SLA fields
  const { data: viewRow, error: viewError } = await supabase
    .from("tickets_sla_status")
    .select("*")
    .eq("id", ticketId)
    .maybeSingle();

  if (viewError) {
    console.error("handleUpdateTicket view error:", viewError);
    return json({ error: viewError.message }, { status: 400 });
  }

  return json({ ticket: viewRow });
}

// ---------- Helpers ----------

async function safeJson(
  req: Request,
): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
  try {
    const text = await req.text();
    if (!text) return { ok: true, value: {} };
    return { ok: true, value: JSON.parse(text) };
  } catch (_err) {
    return { ok: false, error: "Invalid JSON body" };
  }
}
