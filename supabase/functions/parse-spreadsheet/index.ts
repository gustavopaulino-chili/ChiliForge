import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { sheetData } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const systemPrompt = `You are a data extraction assistant. You receive raw spreadsheet data (rows and columns) from a business planning or website briefing document. Your job is to intelligently extract and map the information to website form fields.

The spreadsheet may have ANY format — it could be a structured table, a free-form analysis document, a briefing with sections like "Resumo geral", "Análise do Site", "Cores do Site", "Descrição do Negócio", "Link das imagens", etc.

Extract ALL relevant information and return a JSON object using the generate_form_data tool. Map the data intelligently:
- Business name, description, category from context clues
- Colors (primary/secondary) from any color references (hex codes, color names)
- Image URLs from any links to images
- Services from product/service descriptions
- Contact info from emails, phones, addresses
- Style preferences from design descriptions
- Target audience from audience mentions
- Value proposition from business descriptions
- Differentiators from competitive analysis sections

Be smart about extracting data even when column names don't match exactly. Read the content and understand what it means.

For the websiteType field, infer from context: corporate, landing, ecommerce, portfolio, saas, blog, or educational.
For preferredStyle, choose from: modern, corporate, minimal, bold, premium.`;

    const userPrompt = `Here is the raw spreadsheet data. Extract all business information for a website generator form:\n\n${sheetData}`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "generate_form_data",
              description: "Extract structured form data from spreadsheet content",
              parameters: {
                type: "object",
                properties: {
                  websiteType: { type: "string", enum: ["corporate", "landing", "ecommerce", "portfolio", "saas", "blog", "educational"] },
                  businessName: { type: "string" },
                  businessDescription: { type: "string" },
                  businessCategory: { type: "string" },
                  targetAudience: { type: "string" },
                  services: { type: "array", items: { type: "string" } },
                  valueProposition: { type: "string" },
                  differentiators: { type: "array", items: { type: "string" } },
                  primaryColor: { type: "string", description: "Hex color code" },
                  secondaryColor: { type: "string", description: "Hex color code" },
                  preferredStyle: { type: "string", enum: ["modern", "corporate", "minimal", "bold", "premium"] },
                  heroImage1: { type: "string", description: "URL" },
                  heroImage2: { type: "string", description: "URL" },
                  logoUrl: { type: "string", description: "URL" },
                  brandImage: { type: "string", description: "URL" },
                  sectionImage1: { type: "string", description: "URL" },
                  sectionImage2: { type: "string", description: "URL" },
                  sectionImage3: { type: "string", description: "URL" },
                  city: { type: "string" },
                  country: { type: "string" },
                  phone: { type: "string" },
                  whatsapp: { type: "string" },
                  email: { type: "string" },
                  facebook: { type: "string" },
                  instagram: { type: "string" },
                  twitter: { type: "string" },
                  linkedin: { type: "string" },
                  youtube: { type: "string" },
                },
                required: ["businessName"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "generate_form_data" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI usage limit reached. Please add credits." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error("No tool call in AI response");

    const extracted = JSON.parse(toolCall.function.arguments);

    return new Response(JSON.stringify({ extracted }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("parse-spreadsheet error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
