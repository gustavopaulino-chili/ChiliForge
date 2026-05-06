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
      headers: {
        "Content-Type": "application/json",
      },
      body,
    });

    if (response.ok) {
      return await response.json();
    }

    if (response.status === 429) {
      sawRateLimit = true;
      console.warn(`AI model ${model} rate limited:`, await response.text());
      continue;
    }

    if (response.status === 402) {
      throw new Error("AI usage limit reached. Please add credits.");
    }

    if ([404, 502, 503, 504].includes(response.status)) {
      console.warn(`AI model ${model} unavailable:`, response.status, await response.text());
      continue;
    }

    const text = await response.text();
    console.error(`AI gateway error from ${model}:`, response.status, text);
    throw new Error(`AI gateway error from ${model}: ${response.status}`);
  }

  if (sawRateLimit) {
    throw new Error("Rate limit exceeded. Please try again in a moment.");
  }

  throw new Error("AI gateway failed for all configured models.");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { sheetData, context, accountType } = await req.json();
    const GEMINI_API_KEY = getGeminiApiKeyForAccountType(accountType);

    const contextBlock = context?.trim()
      ? `\n\nAdditional context provided by the user about this business:\n${context.trim()}\n\nUse this context to fill in any gaps or ambiguities in the spreadsheet data.`
      : '';

    const systemPrompt = `You are a data extraction assistant. You receive raw spreadsheet data (rows and columns) from a business planning or website briefing document. Your job is to intelligently extract and map the information to website form fields.

The spreadsheet may have ANY format — it could be a structured table, a free-form analysis document, a briefing with sections like "Resumo geral", "Análise do Site", "Cores do Site", "Descrição do Negócio", "Link das imagens", etc. It may be in any language.

Extract ALL relevant information and return ONLY a valid JSON object with the following structure. Map the data intelligently:
- Business name, description, category from context clues
- Colors (primary/secondary/accent/text/background) from any color references (hex codes, color names)
- Image URLs from any links to images
- Services from product/service descriptions
- Contact info from emails, phones, addresses
- Style preferences from design descriptions
- Target audience from audience mentions
- Value proposition from business descriptions
- Differentiators from competitive analysis sections
- Fonts (headingFont, bodyFont) from any typography references
- Brand personality from tone/voice descriptions
- Social media links from any social media mentions

Be smart about extracting data even when column names don't match exactly. Read the content and understand what it means.

For the websiteType field, infer from context: corporate, landing, ecommerce, portfolio, saas, blog, or educational.
For preferredStyle, choose from: modern, corporate, minimal, bold, premium.
For brandPersonality, choose from: professional, friendly, bold, innovative, luxurious, playful.

Return ONLY valid JSON, no markdown or explanations.`;

    const data = await requestAiPayload(JSON.stringify({
      contents: [{
        parts: [{
          text: `${systemPrompt}${contextBlock}\n\nHere is the raw spreadsheet data. Extract all business information for a website generator form:\n\n${sheetData}\n\nReturn ONLY valid JSON with this exact structure:\n{\n  "websiteType": "corporate|landing|ecommerce|portfolio|saas|blog|educational",\n  "businessName": "string",\n  "businessDescription": "string",\n  "businessCategory": "string",\n  "targetAudience": "string",\n  "services": ["string"],\n  "valueProposition": "string",\n  "differentiators": ["string"],\n  "brandPersonality": "professional|friendly|bold|innovative|luxurious|playful",\n  "primaryColor": "#hex",\n  "secondaryColor": "#hex",\n  "accentColor": "#hex",\n  "textColor": "#hex",\n  "backgroundColor": "#hex",\n  "preferredStyle": "modern|corporate|minimal|bold|premium",\n  "headingFont": "font name",\n  "bodyFont": "font name",\n  "heroImage1": "url",\n  "heroImage2": "url",\n  "logoUrl": "url",\n  "brandImage": "url",\n  "sectionImage1": "url",\n  "sectionImage2": "url",\n  "sectionImage3": "url",\n  "city": "string",\n  "country": "string",\n  "phone": "string",\n  "whatsapp": "string",\n  "email": "string",\n  "facebook": "string",\n  "instagram": "string",\n  "twitter": "string",\n  "linkedin": "string",\n  "youtube": "string"\n}`
        }]
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 4096,
      }
    }), GEMINI_API_KEY);
    const content = extractModelText(data);
    if (!content) throw new Error("No content in AI response");
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found in AI response");
    const extracted = JSON.parse(jsonMatch[0]);

    return new Response(JSON.stringify({ extracted }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    const status = message.includes("Rate limit exceeded")
      ? 429
      : message.includes("credits") || message.includes("usage limit")
        ? 402
        : 500;

    console.error("parse-spreadsheet error:", e);
    return new Response(JSON.stringify({ error: message }), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
