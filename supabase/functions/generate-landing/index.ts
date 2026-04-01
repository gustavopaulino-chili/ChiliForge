import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  try {
    const { prompt, businessName } = await req.json();
    if (!prompt || typeof prompt !== "string" || prompt.length < 50) {
      return new Response(
        JSON.stringify({ error: "Invalid prompt provided." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY)
      throw new Error("Supabase credentials not configured");

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const systemPrompt = `You are an expert web designer and front-end developer. The user will give you a detailed landing page specification.

Your task: Generate a SINGLE, COMPLETE, SELF-CONTAINED HTML file that is a beautiful, modern, responsive landing page.

Return a JSON object with this exact structure:
{
  "html": "<!DOCTYPE html>..."
}

TECHNOLOGY STACK — the HTML file must include everything inline:
- Tailwind CSS via CDN: <script src="https://cdn.tailwindcss.com"></script>
- Google Fonts via <link> tags in <head>
- Lucide Icons via CDN: <script src="https://unpkg.com/lucide@latest"></script> and call lucide.createIcons() at end of body
- Vanilla JavaScript only — NO frameworks, NO React, NO Vue, NO Angular
- All CSS custom styles in a <style> tag in <head>
- All JavaScript in a <script> tag at end of <body>

STRUCTURE OF THE HTML FILE:
1. <!DOCTYPE html> with lang attribute
2. <head> with:
   - charset UTF-8
   - viewport meta tag
   - <title> with business name
   - Meta description for SEO
   - Google Fonts <link> tags
   - Tailwind CSS CDN script
   - Tailwind config script to customize theme colors
   - <style> tag for custom animations, gradients, and any extra CSS
3. <body> with:
   - <header> — sticky navigation with logo text, nav links, mobile hamburger menu
   - <main> with multiple <section> elements
   - <footer> with contact info, links, social icons
   - Lucide icons CDN script
   - <script> for mobile menu toggle, smooth scroll, scroll animations, and lucide.createIcons()

TAILWIND CONFIGURATION (in the HTML file):
<script>
tailwind.config = {
  theme: {
    extend: {
      colors: {
        primary: 'THE_PRIMARY_COLOR',
        secondary: 'THE_SECONDARY_COLOR',
        accent: 'THE_ACCENT_COLOR',
      }
    }
  }
}
</script>

DESIGN RULES:
- Modern, premium, professional design — this must look like a real agency-built website
- Mobile-first responsive design using Tailwind breakpoints (sm:, md:, lg:, xl:)
- Smooth scroll behavior: html { scroll-behavior: smooth; }
- Subtle CSS animations (fade-in on scroll, hover effects, transitions)
- Proper visual hierarchy with clear spacing system
- Alternating section backgrounds for visual rhythm
- Professional typography with proper font weights
- High contrast and readability
- Images: use exact URLs from the spec, with proper alt text. Use object-cover and rounded corners.
- If no images provided, use CSS gradients, patterns, or placeholder backgrounds — NOT broken image URLs
- Icons: use Lucide icons via <i data-lucide="icon-name"></i> syntax
- Available Lucide icons: menu, x, phone, mail, map-pin, star, chevron-right, arrow-right, check, facebook, instagram, twitter, linkedin, youtube, heart, shield, clock, users, zap, award, target, trending-up, sparkles, globe, message-circle, calendar, dollar-sign, bar-chart-3, layers, settings, play, download, external-link, chevron-down, chevron-up, search, plus, minus, eye, copy, share-2, thumbs-up, briefcase, home, info, alert-circle, help-circle, bell, bookmark, filter, refresh-cw, send, trash-2, edit, lock, unlock, wifi, monitor, smartphone, tablet, code, database, server, cloud, credit-card, shopping-cart, gift, percent, tag, file-text, image, video, music, headphones, mic, volume-2, sun, moon, thermometer, droplets, wind, umbrella, coffee, utensils, car, plane, train, ship, building-2, store, graduation-cap, book-open, pen-tool, palette, camera, scissors, wrench, hammer, key

MOBILE MENU (required JavaScript):
- Hamburger button visible on mobile, hidden on md+
- Toggle a mobile nav overlay/drawer
- Close on link click
- Smooth transitions

SCROLL ANIMATIONS (required JavaScript):
- Use IntersectionObserver to add fade-in/slide-up animations as sections enter viewport
- Add CSS classes for the animations in the <style> block
- Apply data-animate attribute to sections

MANDATORY SECTIONS:
- Header/Navigation (sticky)
- Hero section with headline, subtitle, CTA button(s)
- At least 3-5 content sections based on the spec
- Footer with contact info

HARD BANS:
- NEVER use React, Vue, Angular, or any framework
- NEVER use require() or import statements (except ES module script type)
- NEVER reference external JS files you haven't included via CDN
- NEVER use broken image URLs — if unsure, use a gradient background instead
- NEVER use placeholder.com or via.placeholder.com — use placehold.co if needed
- The file must work by simply opening it in a browser — zero build step needed

SELF-CHECK before returning:
1. The HTML is valid and complete (opens and closes all tags)
2. Tailwind CDN script is included
3. tailwind.config script customizes colors from the spec
4. Mobile menu JavaScript works
5. lucide.createIcons() is called after the Lucide CDN script
6. All sections are responsive
7. No framework code (no React, no JSX, no Vue directives)
8. The page renders beautifully on first load with no errors

Return ONLY valid JSON with the "html" key. No markdown, no code fences, no explanation.`;

    console.log("Calling AI gateway to generate HTML landing page...");

    const response = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
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
              content: `Generate the HTML landing page based on this specification:\n\n${prompt}`,
            },
          ],
          response_format: { type: "json_object" },
        }),
      }
    );

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Please add funds." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const data = await response.json();
    const rawContent = data.choices?.[0]?.message?.content;
    if (!rawContent) throw new Error("No response from AI");

    // Clean markdown fences and extract JSON
    const cleaned = rawContent.replace(/```json\s*|```/gi, "").trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("Could not extract JSON from AI response:", rawContent.substring(0, 500));
      throw new Error("AI did not return valid JSON");
    }

    let parsed: { html: string };
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      console.error("Failed to parse extracted JSON:", jsonMatch[0].substring(0, 500));
      throw new Error("AI returned malformed JSON");
    }

    if (!parsed.html || typeof parsed.html !== "string") {
      throw new Error("AI response missing html content");
    }

    // ── Post-processing: sanitize the HTML ──────
    let html = parsed.html;

    // Ensure Tailwind CDN is present
    if (!html.includes("cdn.tailwindcss.com")) {
      html = html.replace("</head>", '<script src="https://cdn.tailwindcss.com"></script>\n</head>');
    }

    // Ensure Lucide CDN is present
    if (!html.includes("lucide")) {
      html = html.replace("</body>", '<script src="https://unpkg.com/lucide@latest"></script>\n<script>lucide.createIcons();</script>\n</body>');
    }

    // Ensure lucide.createIcons() is called
    if (html.includes("lucide") && !html.includes("createIcons")) {
      html = html.replace("</body>", '<script>lucide.createIcons();</script>\n</body>');
    }

    // Ensure viewport meta is present
    if (!html.includes("viewport")) {
      html = html.replace("<head>", '<head>\n<meta name="viewport" content="width=device-width, initial-scale=1.0">');
    }

    // Ensure charset is present
    if (!html.includes("charset")) {
      html = html.replace("<head>", '<head>\n<meta charset="UTF-8">');
    }

    console.log(`Generated HTML landing page: ${html.length} chars`);

    // Save to generated_prompts for history
    await supabase
      .from("generated_prompts")
      .insert({
        business_name: businessName || "Landing Page",
        prompt_text: prompt,
      })
      .select()
      .single();

    return new Response(
      JSON.stringify({ html }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("generate-landing error:", e);
    return new Response(
      JSON.stringify({
        error: e instanceof Error ? e.message : "Unknown error",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
