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
    const code = String(body?.code ?? "");
    const dev = (Deno.env.get("VA_DEV_MODE") || "true").toLowerCase() === "true";

    if (dev && code === "000000") {
      return json(200, {
        ok: true,
        accessToken: "dev-access-token",
        refreshToken: "dev-refresh-token",
        user: { id: "dev-user", phone: body?.phone ?? null, email: body?.email ?? null },
      });
    }

    // TODO: switch to real OTP validation later
    return json(400, { ok: false, error: "Invalid code (use 000000 in dev)" });
  } catch (e) {
    return json(500, { ok: false, error: String(e) });
  }
});
