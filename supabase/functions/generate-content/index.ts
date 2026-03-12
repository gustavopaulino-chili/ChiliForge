import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { formData } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const services = (formData.services || []).filter((s: string) => s).join(", ");
    const diffs = (formData.differentiators || []).filter((s: string) => s).join(", ");

    const systemPrompt = `You are a professional website content writer and UX strategist. Generate website content for a business based on the provided details. Return JSON with this exact structure:

{
  "heroHeadline": "compelling headline",
  "heroSubheadline": "supporting subheadline",
  "aboutTitle": "about section title",
  "aboutContent": "2-3 paragraph about section",
  "servicesIntro": "services section intro text",
  "services": [{"name": "service name", "description": "service description"}],
  "benefits": [{"title": "benefit title", "description": "benefit description"}],
  "ctaHeadline": "call to action headline",
  "ctaSubtext": "call to action supporting text",
  "ctaButtonText": "button text",
  "testimonials": [{"quote": "testimonial quote", "author": "name", "role": "title/company"}],
  "metaTitle": "SEO page title under 60 chars",
  "metaDescription": "SEO meta description under 160 chars"
}

Make content conversion-focused, professional, and specific to the business. Use the business details to create authentic, compelling copy. Generate 3 testimonials, 3 benefits, and descriptions for all services provided.`;

    const userPrompt = `Generate website content for:
Business: ${formData.businessName}
Description: ${formData.businessDescription}
Industry: ${formData.businessCategory}
Target Audience: ${formData.targetAudience}
Services: ${services}
Value Proposition: ${formData.valueProposition}
Differentiators: ${diffs}
Style: ${formData.preferredStyle}
Location: ${formData.city}, ${formData.country}`;

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
              name: "generate_website_content",
              description: "Generate structured website content",
              parameters: {
                type: "object",
                properties: {
                  heroHeadline: { type: "string" },
                  heroSubheadline: { type: "string" },
                  aboutTitle: { type: "string" },
                  aboutContent: { type: "string" },
                  servicesIntro: { type: "string" },
                  services: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        name: { type: "string" },
                        description: { type: "string" },
                      },
                      required: ["name", "description"],
                    },
                  },
                  benefits: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        title: { type: "string" },
                        description: { type: "string" },
                      },
                      required: ["title", "description"],
                    },
                  },
                  ctaHeadline: { type: "string" },
                  ctaSubtext: { type: "string" },
                  ctaButtonText: { type: "string" },
                  testimonials: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        quote: { type: "string" },
                        author: { type: "string" },
                        role: { type: "string" },
                      },
                      required: ["quote", "author", "role"],
                    },
                  },
                  metaTitle: { type: "string" },
                  metaDescription: { type: "string" },
                },
                required: [
                  "heroHeadline", "heroSubheadline", "aboutTitle", "aboutContent",
                  "servicesIntro", "services", "benefits", "ctaHeadline",
                  "ctaSubtext", "ctaButtonText", "testimonials",
                  "metaTitle", "metaDescription",
                ],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "generate_website_content" } },
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

    const content = JSON.parse(toolCall.function.arguments);

    return new Response(JSON.stringify({ content }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-content error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
