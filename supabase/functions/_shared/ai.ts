// supabase/functions/_shared/ai.ts
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export async function logTokens(
  supabase: SupabaseClient,
  hotelId: string,
  tokens: number,
  meta?: { model?: string; func?: string }
) {
  // Fire-and-forget; we don't want this to block the response
  try {
    await supabase.rpc("log_ai_tokens", {
      p_hotel_id: hotelId,
      p_tokens: Math.max(0, Math.floor(tokens || 0)),
      p_model: meta?.model ?? null,
      p_func:  meta?.func  ?? null,
    });
  } catch (_e) {
    // swallow — logging must never break the main workflow
  }
}
