// supabase/functions/owner/index.ts
// Fixes CORS for both OPTIONS and POST. Accepts subpaths like /owner/register

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const ALLOW_ORIGIN = Deno.env.get("CORS_ALLOW_ORIGIN") ?? "*"; // or "https://vaiyu.co.in"
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": ALLOW_ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // 1) Handle preflight quickly
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  try {
    // 2) Route (optional): we don’t care which subpath after /owner
    const url = new URL(req.url);
    const pathname = url.pathname; // e.g., /functions/v1/owner/register

    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // 3) Parse multipart (FormData) or JSON gracefully
    let payload: any = {};
    let coverFile: File | undefined;

    const ct = req.headers.get("content-type") ?? "";

    if (ct.includes("multipart/form-data")) {
      const form = await req.formData();
      const dataBlob = form.get("data");
      coverFile = form.get("cover_file") as File | undefined;

      if (dataBlob && typeof dataBlob !== "string") {
        const text = await (dataBlob as Blob).text();
        payload = JSON.parse(text || "{}");
      } else if (typeof dataBlob === "string") {
        payload = JSON.parse(dataBlob || "{}");
      }
    } else if (ct.includes("application/json")) {
      payload = await req.json();
    } else {
      // Treat as empty / unsupported content-type
      payload = {};
    }

    // 4) TODO: persist to your DB / storage if needed
    // For now, just echo back to prove it works:
    const result = {
      ok: true,
      path: pathname,
      received: payload,
      fileReceived: !!coverFile,
      fileName: coverFile?.name ?? null,
      fileType: coverFile?.type ?? null,
      fileSize: coverFile?.size ?? null,
    };

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: String(err?.message ?? err) }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }
});
