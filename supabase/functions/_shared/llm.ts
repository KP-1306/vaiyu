// supabase/functions/_shared/llm.ts
import OpenAI from "https://esm.sh/openai@4.55.0";

export type LlmOut = { text: string; model: string; totalTokens: number };

export async function runReviewDraftLLM(kpisDraft: string): Promise<LlmOut> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) throw new Error("OPENAI_API_KEY missing");
  const client = new OpenAI({ apiKey });

  const model = Deno.env.get("OPENAI_MODEL") || "gpt-4o-mini";

  const resp = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: "You are a concise hotel operations assistant." },
      {
        role: "user",
        content:
          `Turn this KPI summary into a short, guest-friendly review draft (no hallucinations, keep facts):\n\n${kpisDraft}`,
      },
    ],
    temperature: 0.2,
  });

  const text = resp.choices?.[0]?.message?.content?.trim() || kpisDraft;
  const totalTokens =
    (resp as any)?.usage?.total_tokens ??
    (((resp as any)?.usage?.prompt_tokens ?? 0) + ((resp as any)?.usage?.completion_tokens ?? 0));

  return { text, model, totalTokens: Math.max(0, Number(totalTokens || 0)) };
}
