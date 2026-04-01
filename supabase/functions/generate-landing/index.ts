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

    // System prompt: convert the Lovable prompt into a complete standalone HTML file
    const systemPrompt = `You are an expert front-end developer. The user will give you a detailed landing page specification originally designed for a React/Lovable project.

Your task: Generate a SINGLE, COMPLETE, STANDALONE HTML file that implements the exact same landing page described.

CRITICAL REQUIREMENTS:
1. Output ONLY the raw HTML code. No markdown, no \`\`\`, no explanation. Just pure HTML starting with <!DOCTYPE html>.
2. Use Tailwind CSS via CDN: <script src="https://cdn.tailwindcss.com"></script>
3. All CSS must be inline via Tailwind classes or in a <style> tag inside the HTML.
4. All JavaScript must be in <script> tags inside the HTML (for mobile menu toggles, smooth scroll, animations, etc.).
5. Use Google Fonts via <link> tags if fonts are specified.
6. All images from the specification must be used via <img> tags with the exact URLs provided.
7. The page must be fully responsive (mobile-first).
8. Include smooth scroll behavior, sticky header, mobile hamburger menu.
9. Include all meta tags for SEO (title, description, viewport, charset).
10. Use modern CSS: gradients, shadows, transitions, hover effects.
11. The visual quality must match a premium agency landing page.
12. Use the EXACT brand colors specified in the prompt (as hex or converted to appropriate format).
13. Include all sections described in the specification.
14. Add subtle CSS animations (fade-in on scroll using IntersectionObserver, hover effects, etc.).
15. The HTML file must work when opened directly in any browser — no build step needed.
16. Include Font Awesome or Heroicons CDN for icons if needed.
17. DO NOT use React, Vue, or any framework. Pure HTML + Tailwind + vanilla JS only.
18. Make the design pixel-perfect, premium, and professional.
19. Add a favicon link using a generic one or the logo if provided.
20. Ensure proper contrast ratios and accessibility (alt text, aria-labels, focus states).`;

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
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: systemPrompt },
            {
              role: "user",
              content: `Generate the complete HTML landing page based on this specification:\n\n${prompt}`,
            },
          ],
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
    let htmlContent = data.choices?.[0]?.message?.content;
    if (!htmlContent) throw new Error("No response from AI");

    // Clean up: remove markdown code fences if present
    htmlContent = htmlContent.trim();
    if (htmlContent.startsWith("```html")) {
      htmlContent = htmlContent.slice(7);
    } else if (htmlContent.startsWith("```")) {
      htmlContent = htmlContent.slice(3);
    }
    if (htmlContent.endsWith("```")) {
      htmlContent = htmlContent.slice(0, -3);
    }
    htmlContent = htmlContent.trim();

    // Validate it looks like HTML
    if (!htmlContent.includes("<!DOCTYPE") && !htmlContent.includes("<html")) {
      console.error("Generated content doesn't look like HTML:", htmlContent.substring(0, 200));
      throw new Error("AI did not generate valid HTML");
    }

    // Generate a unique filename
    const slug = (businessName || "landing")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .substring(0, 30);
    const timestamp = Date.now();
    const fileName = `${slug}-${timestamp}.html`;

    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from("landing-pages")
      .upload(fileName, htmlContent, {
        contentType: "text/html",
        upsert: false,
      });

    if (uploadError) {
      console.error("Storage upload error:", uploadError);
      throw new Error(`Failed to upload: ${uploadError.message}`);
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from("landing-pages")
      .getPublicUrl(fileName);

    const publicUrl = urlData.publicUrl;
    console.log("Landing page generated and uploaded:", publicUrl);

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
      JSON.stringify({
        url: publicUrl,
        fileName,
        htmlLength: htmlContent.length,
      }),
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
