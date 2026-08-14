// Shared Gemini cost estimator — logs a single [cost-estimate] line per call.
// Server-side only (Supabase function logs); never returned to clients. This is an
// ESTIMATE for observability; Google billing is the source of truth.
// Prices USD per 1M tokens — keep in sync with https://ai.google.dev/gemini-api/docs/pricing
const PRICING: Record<string, { in: number; out: number }> = {
  "gemini-2.5-flash":       { in: 0.30, out: 2.50 },
  "gemini-2.5-flash-lite":  { in: 0.10, out: 0.40 },
  "gemini-2.5-pro":         { in: 1.25, out: 10.00 },
  "gemini-3.5-flash":       { in: 1.50, out: 9.00 },
  "gemini-3-flash-preview": { in: 0.50, out: 3.00 },
  "gemini-2.5-flash-image": { in: 0.30, out: 0.00 }, // image output billed per image
};
export const GEMINI_IMAGE_PRICE_PER_IMAGE = 0.039; // gemini-2.5-flash-image, 1 image (~1290 tok)

export function geminiPricing(model: string): { in: number; out: number } {
  if (PRICING[model]) return PRICING[model];
  const k = Object.keys(PRICING).find((x) => model.startsWith(x));
  return k ? PRICING[k] : PRICING["gemini-2.5-flash"];
}

// Log an estimated USD cost from a Gemini response's usageMetadata.
// `fn` = caller name; `extra.images` = number of generated images (image model).
export function logGeminiCost(fn: string, model: string, usage: any, extra?: { images?: number }): void {
  try {
    const p = geminiPricing(model);
    const i = Number(usage?.promptTokenCount ?? usage?.prompt_token_count ?? 0);
    const o = Number(usage?.candidatesTokenCount ?? usage?.candidates_token_count ?? 0);
    const tool = Number(usage?.toolUsePromptTokenCount ?? usage?.tool_use_prompt_token_count ?? 0);
    const imgs = extra?.images ?? 0;
    const usd = (i / 1e6) * p.in + (o / 1e6) * p.out + imgs * GEMINI_IMAGE_PRICE_PER_IMAGE;
    console.log(`[cost-estimate] fn=${fn} model=${model} in=${i} out=${o}${tool ? ` tool=${tool}` : ""}${imgs ? ` images=${imgs}` : ""} ~=$${usd.toFixed(5)}`);
    // E TAMBEM grava no ledger. Ate 14/08 esta funcao so escrevia no console, entao doze edge
    // functions — inclusive as que geram IMAGEM (generate-images, generate-ad-creatives) e as
    // que usam gemini-2.5-pro (agents-lp, generate-landing) — gastavam sem deixar linha na
    // tabela. O ledger enxergava so o caminho externo de anuncios, e por isso mostrava R$ 26
    // num dia em que a fatura cobrou R$ 150. O nome da funcao vira a coluna source.
    logGeminiUsage(fn, model, usage);
  } catch (_) { /* logging must never break a generation */ }
}

// Fire-and-forget: POST one Gemini call's RAW usageMetadata to the PHP usage ledger
// (log-gemini-usage.php), which is the SINGLE pricing authority — it computes the exact USD
// (INCLUDING thinking tokens, which the estimate above omits) and persists it to gemini_usage.
// Never blocks or throws. No-op if USAGE_LOG_URL / USAGE_LOG_SECRET are not configured.
export function logGeminiUsage(source: string, model: string, usage: unknown, jobId?: number | string): void {
  try {
    const url = (globalThis as any).Deno?.env?.get?.("USAGE_LOG_URL");
    const secret = (globalThis as any).Deno?.env?.get?.("USAGE_LOG_SECRET");
    if (!url || !secret) return;
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, source, model, usage: usage ?? {}, job_id: jobId ? Number(jobId) : null }),
      signal: AbortSignal.timeout(4000),
    }).catch(() => {});
  } catch (_) { /* never break a generation */ }
}
