import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AUX_TEXT_MODELS = (Deno.env.get("GEMINI_AUX_MODELS") || "gemini-2.5-flash-lite,gemini-2.5-flash")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

function normalizeAccountType(value: unknown) {
  return value === "admin" ? "admin" : "testing";
}

function getGeminiApiKeyForAccountType(accountType: unknown) {
  const productionKey = Deno.env.get("GEMINI_API_KEY_PRODUCTION") || Deno.env.get("GEMINI_API_KEY");
  const testingKey = Deno.env.get("GEMINI_API_KEY_TESTING");

  if (normalizeAccountType(accountType) === "admin") {
    if (!productionKey) throw new Error("GEMINI_API_KEY_PRODUCTION is not configured");
    return productionKey;
  }

  if (!testingKey) throw new Error("GEMINI_API_KEY_TESTING is not configured");
  return testingKey;
}

function buildAiUrl(model: string) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

function extractModelText(payload: any) {
  return payload?.candidates?.[0]?.content?.parts
    ?.filter((part: any) => part?.text && !part?.thought)
    .map((part: any) => part.text)
    .join("\n")
    .trim() || null;
}

async function requestAiPayload(body: string, apiKey: string) {
  let sawRateLimit = false;

  for (const model of AUX_TEXT_MODELS) {
    const response = await fetch(`${buildAiUrl(model)}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

    if (response.ok) return await response.json();

    if (response.status === 429) {
      sawRateLimit = true;
      console.warn(`AI model ${model} rate limited:`, await response.text());
      continue;
    }

    if (response.status === 402) throw new Error("AI usage limit reached. Please add credits.");
    if ([404, 502, 503, 504].includes(response.status)) {
      console.warn(`AI model ${model} unavailable:`, response.status, await response.text());
      continue;
    }

    const text = await response.text();
    console.error(`AI error from ${model}:`, response.status, text);
    throw new Error(`AI error from ${model}: ${response.status}`);
  }

  if (sawRateLimit) throw new Error("Rate limit exceeded. Please try again in a moment.");
  throw new Error("AI gateway failed for all configured models.");
}

function stripJsonFences(value: string) {
  let cleaned = String(value || "").trim();
  if (cleaned.startsWith("```json")) cleaned = cleaned.slice(7);
  else if (cleaned.startsWith("```")) cleaned = cleaned.slice(3);
  if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3);
  return cleaned.trim();
}

function extractJson(content: string) {
  const cleaned = stripJsonFences(content);
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("No JSON found in AI response");
    return JSON.parse(match[0]);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { description, currentData, accountType } = await req.json();
    const brief = typeof description === "string" ? description.trim() : "";
    if (brief.length < 20) {
      return new Response(JSON.stringify({ error: "Describe the campaign with at least 20 characters." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const apiKey = getGeminiApiKeyForAccountType(accountType);
    const systemPrompt = `You are an expert paid-media campaign strategist and form autofill assistant.
Extract and infer fields for an ad creative generator from the user's campaign description.

Rules:
- Return ONLY valid JSON.
- Use empty strings for unknown values. Do not invent URLs.
- Prefer concise, production-ready values a marketer can edit later.
- Infer objective, funnel stage, strategy, tone, urgency, and audience when the brief supports it.
- Keep copy short enough for ads.
- Preserve any important user wording in context.
- Do not include images unless the user provided explicit image URLs.
- Suggest 2-4 relevant ad formats in selectedFormats based on the campaign objective and industry.
  Common dimensions: Instagram Feed Square (1080x1080), Instagram Stories (1080x1920),
  Facebook Feed Landscape (1200x628), Google Display Banner 300x250 (300x250),
  LinkedIn Feed (1200x627), TikTok Video (1080x1920), Pinterest Pin (1000x1500).
  Match formats to the campaign's likely distribution channels.`;

    const schema = `{
  "campaignName": "string",
  "campaignObjective": "lead-generation|sales|awareness|product-launch|retargeting|engagement|app-install|whatsapp|traffic|event|",
  "funnelStage": "awareness|consideration|conversion",
  "brandName": "string",
  "industry": "string",
  "brandKeywords": "comma-separated string",
  "forbiddenWords": "comma-separated string",
  "productName": "string",
  "mainHeadline": "string",
  "subheadline": "string",
  "offer": "string",
  "pricing": "string",
  "discount": "string",
  "guarantee": "string",
  "scarcity": "string",
  "valueProposition": "string",
  "ctaText": "string",
  "targetAudience": "string",
  "ageRange": "string",
  "gender": "all|male|female",
  "painPoints": "string",
  "desires": "string",
  "toneOfVoice": "formal|casual|inspirational|authoritative|conversational|urgent|empathetic",
  "urgencyLevel": "none|low|medium|high",
  "creativeStrategy": "problem-solution|before-after|testimonial|ugc|founder-story|educational|emotional|luxury-premium|direct-response|meme-trend|comparison|authority|lifestyle|product-showcase|other|",
  "creativeStrategyOther": "string",
  "preferredStyle": "modern|corporate|minimal|bold|premium|luxury|futuristic|cinematic|clean|high-contrast",
  "primaryColor": "#RRGGBB or empty",
  "secondaryColor": "#RRGGBB or empty",
  "accentColor": "#RRGGBB or empty",
  "textColor": "#RRGGBB or empty",
  "backgroundColor": "#RRGGBB or empty",
  "headlineVariants": ["string"],
  "ctaVariants": ["string"],
  "abTestingEnabled": boolean,
  "abVariantCount": 2,
  "abTestFocus": "headline|cta|visual|color|mixed",
  "context": "string",
  "selectedFormats": [
    {
      "platform": "Instagram|Facebook|Google Ads|LinkedIn|TikTok|Twitter/X|Pinterest",
      "format": "string",
      "label": "string",
      "width": 1080,
      "height": 1080,
      "enabled": true
    }
  ]
}`;

    const data = await requestAiPayload(JSON.stringify({
      contents: [{
        parts: [{
          text: `${systemPrompt}

Current partially filled form data, only use it as context and do not overwrite clear user choices unless the brief is more specific:
${JSON.stringify(currentData || {}, null, 2).slice(0, 6000)}

Campaign description:
${brief}

Return JSON exactly matching this shape:
${schema}`
        }]
      }],
      generationConfig: {
        temperature: 0.2,
        topP: 0.85,
        maxOutputTokens: 4096,
        responseMimeType: "application/json",
      },
    }), apiKey);

    const content = extractModelText(data);
    if (!content) throw new Error("No response from AI");
    const extracted = extractJson(content);

    return new Response(JSON.stringify({ extracted }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.includes("Rate limit exceeded")
      ? 429
      : message.includes("credits") || message.includes("usage limit")
        ? 402
        : 500;

    console.error("analyze-ad-brief error:", error);
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
