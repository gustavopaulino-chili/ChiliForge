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
    console.error(`AI error from ${model}:`, response.status, text);
    throw new Error(`AI error from ${model}: ${response.status}`);
  }

  if (sawRateLimit) {
    throw new Error("Rate limit exceeded. Please try again in a moment.");
  }

  throw new Error("AI gateway failed for all configured models.");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { description, accountType } = await req.json();
    if (!description || typeof description !== "string" || description.trim().length < 5) {
      return new Response(JSON.stringify({ error: "Please provide a description with at least 5 characters." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const GEMINI_API_KEY = getGeminiApiKeyForAccountType(accountType);

    const systemPrompt = `You are a landing page architecture expert. Given a user description, generate the optimal page sections for a high-converting landing page.

Return a JSON object with:
- "preset": one of "general", "campaign", "black-friday", "launch", "webinar", "lead-capture", "app-download", "seasonal" — pick the best match
- "sections": an array of section objects, each with:
  - "name": short section name (e.g. "Hero", "Benefits", "Pricing")
  - "description": detailed description of what this section should contain, specific to the user's business (2-3 sentences)
  - "required": boolean, true for Hero and CTA sections

Generate 5-8 sections. Be specific to the business described. Do NOT be generic.
Return ONLY valid JSON, no markdown.`;

    const data = await requestAiPayload(JSON.stringify({
      contents: [{
        parts: [{
          text: `${systemPrompt}\n\n${description}\n\nReturn ONLY valid JSON with this exact structure:\n{\n  "preset": "general|campaign|black-friday|launch|webinar|lead-capture|app-download|seasonal",\n  "sections": [\n    {\n      "name": "string",\n      "description": "string",\n      "required": boolean\n    }\n  ]\n}`
        }]
      }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 2000,
      }
    }), GEMINI_API_KEY);
    const content = extractModelText(data);
    if (!content) throw new Error("No response from AI");
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found in AI response");
    const parsed = JSON.parse(jsonMatch[0]);

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    const status = message.includes("Rate limit exceeded")
      ? 429
      : message.includes("credits") || message.includes("usage limit")
        ? 402
        : 500;

    console.error("generate-preset error:", e);
    return new Response(JSON.stringify({ error: message }), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
