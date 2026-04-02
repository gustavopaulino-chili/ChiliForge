import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { prompt, businessName } = await req.json();

    if (!prompt || typeof prompt !== "string" || prompt.length < 50) {
      return new Response(JSON.stringify({ error: "Invalid prompt provided." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Supabase credentials not configured");
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const systemPrompt = `You are an elite front-end developer and UX strategist at a premium digital agency. You build conversion-focused landing pages with the same level of polish, structure, and intentionality expected from Lovable-quality production work.

Your task is to generate a SINGLE, COMPLETE, STANDALONE HTML document.

OUTPUT RULES:
1. Output ONLY raw HTML starting with <!DOCTYPE html>.
2. No markdown fences. No explanations.
3. The HTML must work when opened directly in a browser.
4. Use Tailwind CSS via CDN.
5. Use vanilla JavaScript only.

TECH STACK:
- <script src="https://cdn.tailwindcss.com"></script>
- Google Fonts via <link> when public fonts exist
- Font Awesome via CDN if icons are needed
- No React, no Vue, no frameworks

CRITICAL QUALITY RULES:
- Match Lovable-style quality: premium composition, clear hierarchy, non-generic layout, strong CTA placement, thoughtful spacing, bold but elegant aesthetics.
- Build a real responsive landing page, not a wireframe.
- Use semantic HTML: header, nav, main, section, footer.
- Add full SEO tags: charset, viewport, title, description, robots, canonical, OG, Twitter.
- Include sticky header, mobile menu, smooth scroll, hover states, section reveal animations.
- Include subtle but meaningful animation with IntersectionObserver.
- Include proper accessibility: alt text, aria-labels, focus states, single H1.

TAILWIND / DESIGN RULES:
- Define all brand colors in tailwind.config inside a script block.
- Use semantic colors: primary, secondary, accent, background, foreground, muted, card, border.
- Never rely on random hardcoded design decisions outside the provided spec.
- Typography must be expressive and premium.
- Use asymmetry, depth, gradient moments, and at least one strong hero moment.

IMAGE RULES:
- Use ONLY image URLs explicitly provided in the specification.
- NEVER invent, guess, scrape, or replace with external URLs that were not provided.
- If a provided image is unavailable or missing, gracefully fall back to gradients, shapes, iconography, or a typographic wordmark.
- If the logo image is unavailable, render the business name as a high-quality text logo instead of showing a broken image.
- Every img must include descriptive alt text and onerror fallback behavior.
- Lazy-load below-the-fold images.

FONT RULES:
- If the requested fonts are proprietary or unavailable publicly, choose the closest high-quality public equivalent and preserve the brand feel.

CONVERSION RULES:
- The page must feel strategic and conversion-focused.
- Use strong CTA hierarchy: header CTA, hero CTA, mid-page CTA, final CTA.
- Include social proof / testimonials / trust indicators when relevant.
- Write persuasive, realistic copy tailored to the business.

FINAL CHECKLIST:
- Looks premium, intentional, and production-ready
- Fully responsive
- Images handled gracefully
- No broken assets
- Strong visual hierarchy
- Smooth interactions
- Complete HTML document`;

    console.log("Calling AI gateway to generate HTML landing page...");

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `Generate the complete HTML landing page based on this specification:\n\n${prompt}`,
          },
        ],
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add funds." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const text = await response.text();
      console.error("AI gateway error:", response.status, text);
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const data = await response.json();
    let htmlContent = data.choices?.[0]?.message?.content;
    if (!htmlContent) throw new Error("No response from AI");

    htmlContent = htmlContent.trim();
    if (htmlContent.startsWith("```html")) htmlContent = htmlContent.slice(7);
    else if (htmlContent.startsWith("```")) htmlContent = htmlContent.slice(3);
    if (htmlContent.endsWith("```")) htmlContent = htmlContent.slice(0, -3);
    htmlContent = htmlContent.trim();

    if (!htmlContent.includes("<!DOCTYPE") && !htmlContent.includes("<html")) {
      console.error("Generated content doesn't look like HTML:", htmlContent.substring(0, 200));
      throw new Error("AI did not generate valid HTML");
    }

    const slug = (businessName || "landing")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .substring(0, 30);

    const fileName = `${slug}-${Date.now()}.html`;
    const htmlBlob = new Blob([htmlContent], { type: "text/html; charset=utf-8" });

    const { error: uploadError } = await supabase.storage
      .from("landing-pages")
      .upload(fileName, htmlBlob, {
        contentType: "text/html; charset=utf-8",
        upsert: false,
      });

    if (uploadError) {
      console.error("Storage upload error:", uploadError);
      throw new Error(`Failed to upload: ${uploadError.message}`);
    }

    const { data: urlData } = supabase.storage.from("landing-pages").getPublicUrl(fileName);

    await supabase.from("generated_prompts").insert({
      business_name: businessName || "Landing Page",
      prompt_text: prompt,
    });

    return new Response(
      JSON.stringify({
        url: urlData.publicUrl,
        html: htmlContent,
        fileName,
        htmlLength: htmlContent.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("generate-landing error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
