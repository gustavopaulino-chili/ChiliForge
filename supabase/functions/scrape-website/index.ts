import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { url } = await req.json();
    if (!url) throw new Error("URL is required");

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    let formattedUrl = url.trim();
    if (!formattedUrl.startsWith("http://") && !formattedUrl.startsWith("https://")) {
      formattedUrl = `https://${formattedUrl}`;
    }

    console.log("Fetching website:", formattedUrl);

    const siteResponse = await fetch(formattedUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    if (!siteResponse.ok) {
      throw new Error(`Failed to fetch website: ${siteResponse.status}`);
    }

    const html = await siteResponse.text();
    const truncatedHtml = html.length > 80000 ? html.substring(0, 80000) : html;

    console.log(`Fetched ${html.length} chars, sending ${truncatedHtml.length} to AI`);

    const systemPrompt = `You are a website analyzer expert. Analyze the HTML and extract ALL relevant business information.

Return a JSON object with these fields (use empty string "" for missing data, never omit fields):

{
  "websiteType": "corporate|landing|ecommerce|portfolio|saas|blog|educational",
  "businessName": "string",
  "businessDescription": "detailed description",
  "businessCategory": "string",
  "targetAudience": "string",
  "services": ["service1", "service2"],
  "valueProposition": "string",
  "differentiators": ["diff1", "diff2"],
  "primaryColor": "#hex - main brand color from buttons/CTAs/links, NOT background",
  "secondaryColor": "#hex - supporting color",
  "accentColor": "#hex - highlight color",
  "textColor": "#hex - main text color",
  "backgroundColor": "#hex - page background",
  "preferredStyle": "modern|corporate|minimal|bold|premium",
  "logoUrl": "absolute URL",
  "heroImage1": "absolute URL to main hero image",
  "heroImage1Context": "what this image represents based on URL path",
  "heroImage2": "absolute URL",
  "heroImage2Context": "context",
  "brandImage": "absolute URL",
  "brandImageContext": "context",
  "sectionImage1": "absolute URL",
  "sectionImage1Context": "context",
  "sectionImage2": "absolute URL",
  "sectionImage2Context": "context",
  "sectionImage3": "absolute URL",
  "sectionImage3Context": "context",
  "city": "string",
  "country": "string",
  "phone": "string",
  "whatsapp": "string",
  "email": "string",
  "facebook": "URL",
  "instagram": "URL",
  "twitter": "URL",
  "linkedin": "URL",
  "youtube": "URL",
  "designNotes": "detailed design analysis",
  "headingFont": "font family used for headings/titles (e.g. 'Inter', 'Montserrat', 'Playfair Display')",
  "bodyFont": "font family used for body text/paragraphs (e.g. 'Open Sans', 'Roboto', 'Lato')"
}

COLOR EXTRACTION RULES:
- PRIMARY = main brand color on primary buttons, CTAs, links, active states
- Do NOT use white/black/gray as primary unless truly the brand color
- Check CSS variables, Tailwind classes, logo colors

IMAGE RULES:
- Convert relative URLs to absolute using base: ${formattedUrl}
- Analyze URL paths for context (e.g. "/images/product-name.jpg")
- Only include valid image URLs (.jpg, .jpeg, .png, .svg, .webp or CDN URLs)

CONTACT RULES:
- Search footer, "Contact" sections, CTAs, floating buttons
- Look for mailto:, tel:, wa.me/, api.whatsapp.com/
- Extract ALL social media links

Return ONLY valid JSON, no markdown fences.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Analyze this website HTML and extract all business information:\n\n${truncatedHtml}` },
        ],
        response_format: { type: "json_object" },
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
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("No content in AI response");

    const extracted = JSON.parse(content);

    return new Response(JSON.stringify({ extracted }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("scrape-website error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
