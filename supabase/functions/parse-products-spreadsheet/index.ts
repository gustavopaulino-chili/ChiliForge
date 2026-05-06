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
    const { sheetData, accountType } = await req.json();
    const GEMINI_API_KEY = getGeminiApiKeyForAccountType(accountType);

    const systemPrompt = `You are a product data extraction assistant. You receive raw spreadsheet data (rows and columns) containing product information. Your job is to identify each product and extract its details.

The spreadsheet may have ANY format — columns might be named differently in different languages (Portuguese, English, Spanish, etc). Common patterns:
- Product name / Nome do produto / Nombre
- Description / Descrição / Descripción  
- Price / Preço / Precio
- Discount price / Preço com desconto / Precio de descuento
- SKU / Código
- Category / Categoria / Categoría
- Variants / Variantes (sizes, colors, etc.)

Each ROW typically represents one product. Extract ALL products found in the data.
Be smart about mapping columns even when names don't match exactly.
If a field is not present, leave it as an empty string.
Prices should keep their original format (with currency symbol if present).

Return ONLY valid JSON with this exact structure:
{
  "products": [
    {
      "name": "string",
      "description": "string", 
      "price": "string",
      "discountPrice": "string",
      "sku": "string",
      "category": "string",
      "variants": "string"
    }
  ]
}`;

    const data = await requestAiPayload(JSON.stringify({
      contents: [{
        parts: [{
          text: `${systemPrompt}\n\nExtract all products from this spreadsheet data. Each row is likely a separate product:\n\n${sheetData}\n\nReturn ONLY valid JSON with the products array structure.`
        }]
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 4000,
      }
    }), GEMINI_API_KEY);
    const content = extractModelText(data);
    if (!content) throw new Error("No content in AI response");
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found in AI response");
    const extracted = JSON.parse(jsonMatch[0]);

    return new Response(JSON.stringify({ products: extracted.products }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    const status = message.includes("Rate limit exceeded")
      ? 429
      : message.includes("credits") || message.includes("usage limit")
        ? 402
        : 500;

    console.error("parse-products-spreadsheet error:", e);
    return new Response(JSON.stringify({ error: message }), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
