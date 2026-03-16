// supabase/functions/_shared/cors.ts
export function allowCors(req: Request) {
  const origins = (Deno.env.get("VA_ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);

  const origin = req.headers.get("origin") ?? "";
  
  // Default to allowing localhost and 127.0.0.1 for development if not explicitly restricted
  const isLocal = origin.includes("localhost") || origin.includes("127.0.0.1");
  const ok = origins.length === 0 || origins.includes(origin) || isLocal;

  if (!ok && origin) {
    console.warn(`[CORS] Blocked request from unauthorized origin: ${origin}`);
  }

  const corsHeaders: Record<string, string> = {
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "authorization,content-type,x-api-key,x-client-info,apikey",
    "vary": "origin",
  };
  
  if (ok) {
    corsHeaders["access-control-allow-origin"] = origin || "*";
  }
  
  return corsHeaders;
}

export function j(req: Request, status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      ...allowCors(req),
    },
  });
}
