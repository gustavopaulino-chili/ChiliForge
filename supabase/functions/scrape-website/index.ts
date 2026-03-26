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

    // Fetch the website HTML
    let formattedUrl = url.trim();
    if (!formattedUrl.startsWith("http://") && !formattedUrl.startsWith("https://")) {
      formattedUrl = `https://${formattedUrl}`;
    }

    console.log("Fetching website:", formattedUrl);

    const siteResponse = await fetch(formattedUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
      },
    });

    if (!siteResponse.ok) {
      throw new Error(`Failed to fetch website: ${siteResponse.status}`);
    }

    const html = await siteResponse.text();
    
    // Truncate HTML to avoid token limits (keep first ~80k chars)
    const truncatedHtml = html.length > 80000 ? html.substring(0, 80000) : html;

    console.log(`Fetched ${html.length} chars, sending ${truncatedHtml.length} to AI`);

    const systemPrompt = `You are a website analyzer expert. You receive the full HTML source code of a website. Your job is to deeply analyze the website and extract ALL relevant information for recreating a similar website.

CRITICAL INSTRUCTIONS:
1. Extract the EXACT color palette used (primary, secondary, accent colors as hex codes)
2. Identify the visual style (modern, corporate, minimal, bold, premium)
3. Extract ALL text content: business name, description, services, value proposition, differentiators
4. Find ALL image URLs (logo, hero images, section images) - return FULL absolute URLs
5. Extract contact information: phone, email, social media links, address
6. Identify the business category and target audience
7. Extract any product/service listings with descriptions
8. Identify the language/locale of the website content

CONTACT INFORMATION EXTRACTION - VERY IMPORTANT:
- Look deeply into CTAs (Call-to-Action buttons and links) throughout the entire page
- Search for "Contact", "Contato", "Fale Conosco", "Contact Us" sections
- Look in the FOOTER - most websites put all contact info and social links there
- Search for href="mailto:", href="tel:", href="https://wa.me/", href="https://api.whatsapp.com/"
- Extract social media links from icon links (Facebook, Instagram, Twitter/X, LinkedIn, YouTube, TikTok)
- Look for patterns like: data-social, class="social", aria-label with social network names
- Search for WhatsApp links in floating buttons, CTAs, and footer
- Phone numbers may appear in tel: links, WhatsApp links, or plain text
- Email addresses may appear in mailto: links or plain text
- Look for address/location info near maps or in structured data (JSON-LD, microdata)

For image URLs:
- Convert relative URLs to absolute URLs using the base domain
- Prioritize logo, hero/banner images, and section background images
- Only include valid image URLs (ending in .jpg, .jpeg, .png, .svg, .webp or from image CDNs)
- CRITICAL: Analyze each image URL path carefully. URLs often contain descriptive names like "/images/product-name.jpg" or "/assets/hero-banner.webp". Use these URL segments to understand WHAT the image represents (product name, section purpose, etc.)
- For each image field, add a brief description of what the image likely shows based on URL analysis and its position in the HTML

For colors - CRITICAL, DO NOT just pick the first colors you see:
- PRIMARY COLOR = The main brand color used on primary buttons, CTAs, links, and key interactive elements. This is the color that represents the brand identity.
- SECONDARY COLOR = The supporting color used for secondary buttons, backgrounds, cards, or accent sections. It complements the primary color.
- Do NOT use background colors (white, black, gray) as primary/secondary unless they truly are the brand colors
- Look at: primary CTA buttons, navigation highlights, active states, hover states, brand accents, icons
- Check CSS variables like --primary, --brand, --accent, --main-color
- Check Tailwind/Bootstrap classes for brand colors (bg-primary, btn-primary, text-brand)
- If the logo has a distinctive color, that is likely the primary color
- Return as hex codes

For style:
- modern = Clean lines, gradients, bold typography, contemporary feel
- corporate = Professional, structured, trustworthy, traditional
- minimal = Lots of white space, simple, elegant, understated
- bold = High contrast, dramatic colors, impactful visuals
- premium = Luxury feel, refined, sophisticated, dark themes

Base URL for resolving relative URLs: ${formattedUrl}`;

    const userPrompt = `Analyze this website HTML and extract all business information:\n\n${truncatedHtml}`;

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
          { role: "user", content: userPrompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "extract_website_data",
              description: "Extract structured data from website analysis",
              parameters: {
                type: "object",
                properties: {
                  websiteType: { type: "string", enum: ["corporate", "landing", "ecommerce", "portfolio", "saas", "blog", "educational"] },
                  businessName: { type: "string" },
                  businessDescription: { type: "string", description: "Detailed description of the business, its mission and what it does" },
                  businessCategory: { type: "string" },
                  targetAudience: { type: "string" },
                  services: { type: "array", items: { type: "string" }, description: "List of services or products offered" },
                  valueProposition: { type: "string", description: "The main value proposition or tagline" },
                  differentiators: { type: "array", items: { type: "string" }, description: "What makes this business unique" },
                  primaryColor: { type: "string", description: "Primary brand color as hex code" },
                  secondaryColor: { type: "string", description: "Secondary brand color as hex code" },
                  accentColor: { type: "string", description: "Accent/highlight color used for badges, icons, special elements as hex code" },
                  textColor: { type: "string", description: "Main text color used for headings and body as hex code" },
                  backgroundColor: { type: "string", description: "Page background color as hex code" },
                  preferredStyle: { type: "string", enum: ["modern", "corporate", "minimal", "bold", "premium"] },
                  logoUrl: { type: "string", description: "Absolute URL to the logo image" },
                  heroImage1: { type: "string", description: "Absolute URL to the main hero/banner image" },
                  heroImage2: { type: "string", description: "Absolute URL to a secondary hero image" },
                  brandImage: { type: "string", description: "Absolute URL to an about/brand image" },
                  sectionImage1: { type: "string", description: "Absolute URL to a section image" },
                  sectionImage2: { type: "string", description: "Absolute URL to another section image" },
                  sectionImage3: { type: "string", description: "Absolute URL to another section image" },
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
                  designNotes: { type: "string", description: "Detailed notes about the website's visual design, layout patterns, typography, spacing, animations, and any distinctive design elements that should be replicated" },
                },
                required: ["businessName"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "extract_website_data" } },
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
    console.error("scrape-website error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
