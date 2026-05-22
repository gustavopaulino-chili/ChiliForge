import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type AgentConfig = {
  systemPrompt: string;
  model: string;
  temperature?: number;
};

type BadAd = {
  id: number;
  platform?: string;
  format?: string;
  label?: string;
};

type AgentsLearnPayload = {
  agentConfig: AgentConfig;
  companyStoreName: string;
  badAds: BadAd[];
  feedback?: string;
  metrics?: Record<string, any>;
  accountType?: "admin" | "user";
};

const env = (globalThis as any).Deno?.env;

function getApiKey(): string {
  return env?.get("GEMINI_API_KEY_PRODUCTION") || env?.get("GEMINI_API_KEY_TESTING") || "";
}

function buildAiUrl(model: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const payload = await req.json() as AgentsLearnPayload;

    if (!payload.badAds?.length) {
      return new Response(JSON.stringify({ error: "badAds array is required and must not be empty" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { agentConfig, companyStoreName, badAds, feedback, metrics, accountType } = payload;
    const apiKey = getApiKey();

    if (!apiKey) {
      return new Response(JSON.stringify({ error: "Gemini API key not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const model = agentConfig?.model || "gemini-2.5-flash";

    const adsList = badAds
      .map((a) => `  - Ad ID ${a.id}${a.platform ? ` (${a.platform}` : ""}${a.format ? ` / ${a.format}` : ""}${a.platform ? ")" : ""}`)
      .join("\n");

    const metricsText = metrics ? `\nMETRICS:\n${JSON.stringify(metrics, null, 2)}` : "";
    const feedbackText = feedback ? `\nUSER FEEDBACK: ${feedback}` : "";

    const userMessage = [
      "=== ADS THAT DID NOT PERFORM WELL ===",
      adsList,
      metricsText,
      feedbackText,
      "",
      "=== TASK ===",
      "Given the brand context from the knowledge base above and the underperforming ads listed, extract practical, actionable learnings about what to AVOID in future creatives for this company.",
      "Format as a concise bullet list. Each point must be specific and directly actionable.",
      "Focus ONLY on what should be avoided or changed — do not repeat what was done well.",
    ].filter(Boolean).join("\n");

    const systemPrompt = agentConfig?.systemPrompt ||
      "You are an expert in paid advertising creative analysis. Your job is to identify what went wrong in underperforming ad creatives and extract clear, actionable learnings to improve future campaigns.";

    const hasStore = Boolean(companyStoreName?.trim());
    const body: Record<string, unknown> = {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ parts: [{ text: userMessage }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 2048 },
    };

    if (hasStore) {
      body.tools = [{ file_search: { file_search_store_names: [companyStoreName.trim()] } }];
    }

    const res = await fetch(`${buildAiUrl(model)}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => "");
      throw new Error(`Gemini ${model} returned ${res.status}: ${err.slice(0, 300)}`);
    }

    const data = await res.json();
    const learnings = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("") ?? "";

    if (!learnings.trim()) throw new Error("Agent returned empty learnings");

    return new Response(
      JSON.stringify({ learnings: learnings.trim(), adCount: badAds.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[agents-learn] error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
