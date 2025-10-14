import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
    },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return json(200, { ok: true });

  try {
    const body = await req.json().catch(() => ({}));
    const phone = body?.phone ?? null;
    const email = body?.email ?? null;

    const dev = (Deno.env.get("VA_DEV_MODE") || "true").toLowerCase() === "true";
    const otp = dev ? "000000" : String(Math.floor(100000 + Math.random() * 900000));

    // TODO: If dev=false, send `otp` via your SMS/Email provider here.

    return json(200, {
      ok: true,
      otpId: crypto.randomUUID(),
      ttlSec: 300,
      delivery: phone ? "sms" : (email ? "email" : "none"),
      hint: dev ? "DEV: use 000000" : undefined,
    });
  } catch (e) {
    return json(500, { ok: false, error: String(e) });
  }
});
