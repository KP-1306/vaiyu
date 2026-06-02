// supabase/functions/_shared/anthropic.ts
//
// Thin wrapper around Anthropic's Messages API for Deno Edge Functions.
// Uses fetch directly — no SDK install needed in the Deno runtime.
//
// Usage:
//   const out = await runAnthropic({
//     model: "claude-haiku-4-5",
//     systemPrompt,
//     userMessage,
//     maxTokens: 1500,
//     temperature: 0.3,
//   });
//   await logTokens(supabase, hotelId, out.totalTokens, { model: out.model, func });
//
// Returns { text, model, tokensIn, tokensOut, totalTokens }.
// Throws Error("ANTHROPIC_API_KEY missing") if the secret isn't set.

const ENDPOINT = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";
const DEFAULT_TIMEOUT_MS = 30_000;

export interface AnthropicCallInput {
  model: string;
  systemPrompt: string;
  userMessage: string;
  maxTokens: number;
  temperature?: number;
  timeoutMs?: number;
}

export interface AnthropicCallOutput {
  text: string;
  model: string;
  stopReason: string | null;
  tokensIn: number;
  tokensOut: number;
  totalTokens: number;
}

export async function runAnthropic(input: AnthropicCallInput): Promise<AnthropicCallOutput> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY missing");
  }

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), input.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": API_VERSION,
      },
      body: JSON.stringify({
        model: input.model,
        max_tokens: input.maxTokens,
        temperature: input.temperature ?? 0.3,
        system: input.systemPrompt,
        messages: [{ role: "user", content: input.userMessage }],
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(t);
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`ANTHROPIC_HTTP_${res.status}: ${errText.slice(0, 500)}`);
  }

  const data = await res.json();

  // Content is an array of blocks; first text block is the model's reply.
  const text = Array.isArray(data?.content)
    ? data.content
        .filter((b: { type?: string }) => b?.type === "text")
        .map((b: { text?: string }) => b?.text ?? "")
        .join("")
    : "";

  const tokensIn = Number(data?.usage?.input_tokens ?? 0);
  const tokensOut = Number(data?.usage?.output_tokens ?? 0);

  return {
    text: text.trim(),
    model: String(data?.model ?? input.model),
    stopReason: data?.stop_reason ?? null,
    tokensIn: Math.max(0, tokensIn | 0),
    tokensOut: Math.max(0, tokensOut | 0),
    totalTokens: Math.max(0, (tokensIn | 0) + (tokensOut | 0)),
  };
}
