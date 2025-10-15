// supabase/functions/_shared/alert.ts
export async function alertError(webhook: string | undefined | null, payload: {
  fn: string;
  message: string;
  stack?: string;
  meta?: Record<string, unknown>;
}) {
  if (!webhook) return; // quietly skip if not configured
  try {
    await fetch(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: `❗Edge Function Error: ${payload.fn}\n${payload.message}`,
        ...payload,
      }),
    });
  } catch {
    // never throw from alerts
  }
}
