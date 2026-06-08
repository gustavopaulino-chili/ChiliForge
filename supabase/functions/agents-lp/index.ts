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
  geminiApiKey?: string;
  globalStoreName?: string;
  companyStoreName: string;
  generationChoices: string;
  customSlug?: string;
  accountType?: "admin" | "user";
  maxTokensOverride?: number;
};

const env = (globalThis as any).Deno?.env;
const MODEL_CHAIN = ["gemini-2.5-pro", "gemini-2.5-flash"];

function getApiKey(userKey?: string): string {
  if (userKey?.trim()) return userKey.trim();
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

type GeminiCallOptions = {
  thinkingLevel?: "minimal" | "low" | "medium" | "high";
};

async function callGemini(
  systemPrompt: string,
  userMessage: string,
  model: string,
  temperature: number,
  maxTokens: number,
  apiKey: string,
  fileSearchStores?: string[],
  options?: GeminiCallOptions
): Promise<GeminiResult> {
  const effectiveSystemPrompt = [
    systemPrompt,
    fileSearchStores?.length
      ? "MANDATORY KNOWLEDGE BASE: Use the attached File Search stores as global/company guidelines. Treat retrieved guidance as higher priority than generic landing page design instincts. If retrieved guidance conflicts with the request, preserve the user's explicit business data but follow the retrieved creative/layout/copy rules."
      : "",
  ].filter(Boolean).join("\n\n");

  const generationConfig: Record<string, unknown> = { temperature, maxOutputTokens: maxTokens };
  // `thinkingLevel` (minimal|low|medium|high) is a Gemini 3.x parameter. The 2.5
  // models reject it with 400 "Thinking level is not supported for this model"
  // (they use thinkingConfig.thinkingBudget instead, and reason by default).
  // Only send it for models that support it.
  if (options?.thinkingLevel && /gemini-3/i.test(model)) {
    generationConfig.thinkingConfig = { thinkingLevel: options.thinkingLevel };
  }

  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: effectiveSystemPrompt }] },
    contents: [{ parts: [{ text: userMessage }] }],
    generationConfig,
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
  fileSearchStores?: string[],
  options?: GeminiCallOptions
): Promise<GeminiResult> {
  const chain = [preferredModel, ...MODEL_CHAIN.filter((m) => m !== preferredModel)];
  let lastError: Error | null = null;

  for (const model of chain) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await callGemini(systemPrompt, userMessage, model, temperature, maxTokens, apiKey, fileSearchStores, options);
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        const status = lastError.message.match(/returned (\d+)/)?.[1];
        if (model !== preferredModel || attempt > 0) {
          console.warn(
            `[agents-lp][model-fallback] preferred=${preferredModel} current=${model} ` +
            `attempt=${attempt + 1}/2 status=${status ?? "non-http"}`
          );
        }
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
    const apiKey = getApiKey(typeof payload.geminiApiKey === "string" ? payload.geminiApiKey : undefined);

    if (!apiKey) {
      return new Response(JSON.stringify({ error: "Gemini API key not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const fileSearchStores = [
      globalStoreName?.trim(),
      companyStoreName?.trim(),
    ].filter(Boolean) as string[];

    if (!globalStoreName?.trim()) {
      return new Response(JSON.stringify({ error: "globalStoreName is required. Upload the global LP store first in the admin panel." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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
      "HERO IMAGE RULE: The hero/header section MUST always contain a prominent image (an <img> or a CSS background-image with object-fit:cover). If the campaign data has no hero image URL, use this neutral placeholder so the hero is NEVER empty: https://placehold.co/1280x720?text=Imagem — keep it as a real <img> so the user can swap it later. Never output a hero without a visible image.",
      "",
      [
        "████ BRAND-SPECIFIC, NOT A TEMPLATE — REQUIRED ████",
        "This page must look like THIS company's own site — NOT a reused skeleton. Two different companies must produce clearly different pages. Concretely:",
        "• BRAND COLORS ARE IMMUTABLE RULES: the exact brand colors stated in the request are mandatory — wire them into the inline tailwind.config (theme.extend.colors) and use them verbatim. The visual style and the scraped source site control layout/typography/mood ONLY — they must NEVER change the colors or swap the background to a dark theme.",
        "• Make the brand's PRIMARY color the dominant accent everywhere (buttons, links, active states, section highlights, icons) — never a generic default blue. Use secondary/accent for depth/gradients.",
        "• Be FAITHFUL to the scraped source site when one is provided: follow its structure, sections, real content and overall vibe (the page should read as the same business), then adapt copy to the objective — but keep the brand colors above.",
        "• LOGO COLOR STRATEGY is BINDING for the HEADER/NAV surface: if the request says the logo is 'dark', the header MUST be a light surface (dark colors FORBIDDEN in the header); if 'light', the header MUST be dark. The logo must always be clearly legible.",
        "• LEAD-CAPTURE FORM: build a real, working <form> WHENEVER the request calls for one — i.e. the conversion goal is lead/contact oriented, OR any requested section is of type 'form', OR a section name/description mentions a form/formulário/cadastro/newsletter/inscrição/contato. When you build it, use labeled fields with placeholders (Name, Email, Phone and an optional Message), required where sensible, a full-width high-contrast submit button with an action label, and standard field names: name, email, phone, message. NEVER replace a requested form with a plain link or mailto:. If nothing calls for a form, do not force one.",
        "• Use the brand's heading/body fonts throughout (headings vs body clearly distinct).",
        "• Let the INDUSTRY + brand personality drive the art direction: hero layout, section order, imagery style, copy angle, shapes and decorative motifs. A law firm, a bakery and a SaaS must look visibly different (palette mood, density, imagery, tone).",
        "• VARY the structure: do NOT always output the same hero → features → testimonials → CTA skeleton. Reorder, merge, split or drop sections to fit THIS offer and goal. Aim for at least 3 visually distinct section layouts.",
        "• Pull real specifics from the company store + campaign data (actual services, value proposition, differentiators, location, tone) into the headlines and sections — avoid generic filler copy.",
      ].join("\n"),
      "",
      `=== GENERATION REQUEST ===\n${generationChoices.trim()}`,
    ].filter(Boolean).join("\n");

    const result = await generateWithRetry(
      agentConfig.systemPrompt,
      userMessage,
      agentConfig.model || "gemini-2.5-pro",
      agentConfig.temperature ?? 0.9,
      agentConfig.maxTokens ?? 65000,
      apiKey,
      fileSearchStores.length ? fileSearchStores : undefined,
      { thinkingLevel: "medium" }
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
