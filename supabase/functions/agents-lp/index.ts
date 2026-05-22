import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type AgentConfig = {
  systemPrompt: string;
  model: string;
  temperature: number;
  maxTokens: number;
  version: number;
};

type AgentsLpPayload = {
  agentConfig: AgentConfig;
  globalStoreName?: string;
  companyStoreName: string;
  generationChoices: string;
  customSlug?: string;
  accountType?: "admin" | "user";
  maxTokensOverride?: number;
};

const env = (globalThis as any).Deno?.env;
const MODEL_CHAIN = ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.5-flash-lite"];

function getApiKey(): string {
  return env?.get("GEMINI_API_KEY_PRODUCTION") || env?.get("GEMINI_API_KEY_TESTING") || "";
}

function buildAiUrl(model: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

function extractAssets(html: string): string[] {
  const urls: string[] = [];
  const patterns = [/src=["']([^"']+)["']/g, /url\(["']?([^"')]+)["']?\)/g];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(html)) !== null) {
      const url = m[1].trim();
      if (url.startsWith("http") && !url.includes("fonts.googleapis")) urls.push(url);
    }
  }
  return [...new Set(urls)];
}

type GeminiResult = {
  text: string;
  groundingMetadata?: unknown;
};

async function callGemini(
  systemPrompt: string,
  userMessage: string,
  model: string,
  temperature: number,
  maxTokens: number,
  apiKey: string,
  fileSearchStores?: string[]
): Promise<GeminiResult> {
  const effectiveSystemPrompt = [
    systemPrompt,
    fileSearchStores?.length
      ? "MANDATORY KNOWLEDGE BASE: Use the attached File Search stores as global/company guidelines. Treat retrieved guidance as higher priority than generic landing page design instincts. If retrieved guidance conflicts with the request, preserve the user's explicit business data but follow the retrieved creative/layout/copy rules."
      : "",
  ].filter(Boolean).join("\n\n");

  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: effectiveSystemPrompt }] },
    contents: [{ parts: [{ text: userMessage }] }],
    generationConfig: { temperature, maxOutputTokens: maxTokens },
  };

  if (fileSearchStores?.length) {
    body.tools = [{ file_search: { file_search_store_names: fileSearchStores } }];
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
  const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("") ?? "";
  if (!text.trim()) throw new Error(`Gemini ${model} returned empty response`);
  return { text, groundingMetadata: data?.candidates?.[0]?.groundingMetadata ?? data?.candidates?.[0]?.grounding_metadata };
}

async function generateWithRetry(
  systemPrompt: string,
  userMessage: string,
  preferredModel: string,
  temperature: number,
  maxTokens: number,
  apiKey: string,
  fileSearchStores?: string[]
): Promise<GeminiResult> {
  const chain = [preferredModel, ...MODEL_CHAIN.filter((m) => m !== preferredModel)];
  let lastError: Error | null = null;

  for (const model of chain) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await callGemini(systemPrompt, userMessage, model, temperature, maxTokens, apiKey, fileSearchStores);
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        const status = lastError.message.match(/returned (\d+)/)?.[1];
        if (status === "429" || status === "503") {
          await new Promise((r) => setTimeout(r, attempt === 0 ? 3000 : 8000));
        } else {
          break;
        }
      }
    }
  }

  throw lastError ?? new Error("All Gemini models failed");
}

function extractHtml(raw: string): string {
  const docMatch = raw.match(/<!DOCTYPE[\s\S]*<\/html>/i);
  if (docMatch) return docMatch[0].trim();
  const htmlMatch = raw.match(/<html[\s\S]*<\/html>/i);
  if (htmlMatch) return htmlMatch[0].trim();
  return raw.trim();
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const payload = await req.json() as AgentsLpPayload;

    if (!payload.agentConfig?.systemPrompt) {
      return new Response(JSON.stringify({ error: "agentConfig.systemPrompt is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!payload.generationChoices?.trim()) {
      return new Response(JSON.stringify({ error: "generationChoices is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { agentConfig, globalStoreName, companyStoreName, generationChoices, customSlug } = payload;
    const apiKey = getApiKey();

    if (!apiKey) {
      return new Response(JSON.stringify({ error: "Gemini API key not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const fileSearchStores = [
      globalStoreName?.trim(),
      companyStoreName?.trim(),
    ].filter(Boolean) as string[];

    if (!companyStoreName?.trim()) {
      return new Response(JSON.stringify({ error: "companyStoreName is required. Sync the company store before generation." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const storeInstruction = fileSearchStores.length
      ? [
          "STEP 1 — Query stores: Before writing any HTML, retrieve from the File Search stores:",
          "  • Global LP store: HTML technical standards, section rules, copy principles, and design principles.",
          "  • Company store: brand colors (primary, secondary, accent), fonts, logo URL, contact info, services, and tone of voice.",
          "Apply every retrieved rule throughout the page. Treat store content as higher priority than generic instincts.",
        ].join("\n")
      : "";

    const userMessage = [
      storeInstruction,
      "",
      `=== GENERATION REQUEST ===\n${generationChoices.trim()}`,
    ].filter(Boolean).join("\n");

    const result = await generateWithRetry(
      agentConfig.systemPrompt,
      userMessage,
      agentConfig.model || "gemini-2.5-flash",
      agentConfig.temperature ?? 0.9,
      agentConfig.maxTokens ?? 24000,
      apiKey,
      fileSearchStores.length ? fileSearchStores : undefined
    );
    const raw = result.text;

    const html = extractHtml(raw);
    if (!html.includes("</html>")) throw new Error("Agent returned invalid HTML (no </html>)");

    const slug = customSlug
      ? slugify(customSlug)
      : `lp-${slugify(generationChoices.slice(0, 40))}`;

    return new Response(
      JSON.stringify({ html, slug, assets: extractAssets(html), usedStores: fileSearchStores, groundingMetadata: result.groundingMetadata ?? null }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[agents-lp] error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
