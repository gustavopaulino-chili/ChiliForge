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
Prices should keep their original format (with currency symbol if present).`;

    const userPrompt = `Extract all products from this spreadsheet data. Each row is likely a separate product:\n\n${sheetData}`;

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
              name: "extract_products",
              description: "Extract product list from spreadsheet data",
              parameters: {
                type: "object",
                properties: {
                  products: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        name: { type: "string", description: "Product name" },
                        description: { type: "string", description: "Product description" },
                        price: { type: "string", description: "Product price with currency" },
                        discountPrice: { type: "string", description: "Discount/sale price" },
                        sku: { type: "string", description: "SKU or product code" },
                        category: { type: "string", description: "Product category" },
                        variants: { type: "string", description: "Variants like size, color separated by commas" },
                      },
                      required: ["name"],
                    },
                  },
                },
                required: ["products"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "extract_products" } },
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

    return new Response(JSON.stringify({ products: extracted.products }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("parse-products-spreadsheet error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
