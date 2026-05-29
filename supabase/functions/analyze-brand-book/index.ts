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

function getGeminiApiKeyCandidates(accountType: unknown): string[] {
  const productionKey = Deno.env.get("GEMINI_API_KEY_PRODUCTION") || Deno.env.get("GEMINI_API_KEY");
  const testingKey = Deno.env.get("GEMINI_API_KEY_TESTING");

  if (normalizeAccountType(accountType) === "admin") {
    if (!productionKey) throw new Error("GEMINI_API_KEY_PRODUCTION is not configured");
    return [productionKey];
  }

  const candidates: string[] = [];
  if (testingKey) candidates.push(testingKey);
  if (productionKey) candidates.push(productionKey);
  if (!candidates.length) throw new Error("GEMINI_API_KEY_TESTING is not configured");
  return candidates;
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

async function requestAiPayloadWithFallback(body: string, apiKeys: string[]) {
  let lastError: unknown;
  for (const apiKey of apiKeys) {
    try {
      return await requestAiPayload(body, apiKey);
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("credits") || msg.includes("usage limit")) throw err;
    }
  }
  throw lastError;
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
    const { fileName, mimeType, fileSize, dataBase64, currentData, accountType } = await req.json();
    const safeFileName = typeof fileName === "string" ? fileName.trim() : "brand-book";
    const safeMimeType = typeof mimeType === "string" && mimeType.trim() ? mimeType.trim() : "application/octet-stream";
    const bytes = Number(fileSize || 0);

    if (!dataBase64 || typeof dataBase64 !== "string") {
      return new Response(JSON.stringify({ error: "Brand book file data is required." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (bytes > 12 * 1024 * 1024 || dataBase64.length > 18_000_000) {
      return new Response(JSON.stringify({
        extracted: {
          sourceFileName: safeFileName,
          extractionStatus: "pending",
          extractionNotes: "File attached, but it is too large for immediate AI extraction in the campaign form.",
        },
        pending: true,
        message: "Brand book attached, but the file is too large for immediate AI extraction.",
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const apiKeys = getGeminiApiKeyCandidates(accountType);
    const systemPrompt = `You are a senior brand strategist extracting usable campaign setup data from a brand book or style guide.
Return ONLY valid JSON. Do not invent details that are not visible or strongly implied.
Prefer exact values from the file. Colors must be #RRGGBB when possible.
The user will review this before applying it to the form, so include concise notes for uncertain findings.`;

    const schema = `{
  "sourceFileName": "string",
  "brandName": "string",
  "industry": "string",
  "brandKeywords": "comma-separated string",
  "forbiddenWords": "comma-separated string",
  "brandVoice": "string",
  "toneOfVoice": "formal|casual|inspirational|authoritative|conversational|urgent|empathetic",
  "preferredStyle": "modern|corporate|minimal|bold|premium|luxury|futuristic|cinematic|clean|high-contrast",
  "primaryColor": "#RRGGBB or empty",
  "secondaryColor": "#RRGGBB or empty",
  "accentColor": "#RRGGBB or empty",
  "textColor": "#RRGGBB or empty",
  "backgroundColor": "#RRGGBB or empty",
  "headingFont": "string",
  "bodyFont": "string",
  "logoGuidance": "string",
  "visualStyle": "string",
  "forbiddenUsage": "string",
  "keyRules": ["string"],
  "extractionNotes": "string"
}`;

    const data = await requestAiPayloadWithFallback(JSON.stringify({
      contents: [{
        parts: [
          { text: `${systemPrompt}

Current campaign form, for context only:
${JSON.stringify(currentData || {}, null, 2).slice(0, 5000)}

Analyze this uploaded brand book file: ${safeFileName} (${safeMimeType}).
Extract colors, fonts, brand voice, logo guidance, visual style, forbidden usage, and key rules.

Return JSON exactly matching this shape:
${schema}` },
          { inline_data: { mime_type: safeMimeType, data: dataBase64 } },
        ],
      }],
      generationConfig: {
        temperature: 0.1,
        topP: 0.8,
        maxOutputTokens: 4096,
        responseMimeType: "application/json",
      },
    }), apiKeys);

    const content = extractModelText(data);
    if (!content) throw new Error("No response from AI");
    const extracted = extractJson(content);
    extracted.sourceFileName = extracted.sourceFileName || safeFileName;

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

    console.error("analyze-brand-book error:", error);
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
