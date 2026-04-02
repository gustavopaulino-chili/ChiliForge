import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const PRIMARY_MODEL = "google/gemini-2.5-flash";
const STANDARD_MAX_TOKENS = 7000;
const COMPACT_MAX_TOKENS = 5200;

function stripCodeFences(content: string) {
  let cleaned = content.trim();
  if (cleaned.startsWith("```html")) cleaned = cleaned.slice(7);
  else if (cleaned.startsWith("```")) cleaned = cleaned.slice(3);
  if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3);
  return cleaned.trim();
}

function findHtmlStartIndex(content: string) {
  const patterns = [/<!DOCTYPE/i, /<html/i, /<body/i, /<main/i, /<header/i, /<section/i];
  let startIndex = -1;

  for (const pattern of patterns) {
    const index = content.search(pattern);
    if (index !== -1 && (startIndex === -1 || index < startIndex)) {
      startIndex = index;
    }
  }

  return startIndex;
}

function ensureHtmlDocument(content: string) {
  let html = stripCodeFences(content);
  const hasDoctype = /<!DOCTYPE/i.test(html);
  const hasHtmlTag = /<html[\s>]/i.test(html);
  const hasBodyTag = /<body[\s>]/i.test(html);

  if (!hasHtmlTag) {
    html = `<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1.0">\n<title>Generated Landing Page</title>\n</head>\n<body>\n${html}`;
  } else if (!hasDoctype) {
    html = `<!DOCTYPE html>\n${html}`;
  }

  if (!hasBodyTag) {
    if (/<\/head>/i.test(html)) html = html.replace(/<\/head>/i, "</head>\n<body>");
    else html = html.replace(/<html([^>]*)>/i, "<html$1>\n<body>");
  }

  if (!/<\/body>/i.test(html)) html += "\n</body>";
  if (!/<\/html>/i.test(html)) html += "\n</html>";

  return html.trim();
}

function recoverHtmlFromRawText(rawText: string) {
  const directHtmlStart = findHtmlStartIndex(rawText);
  if (directHtmlStart !== -1) {
    return ensureHtmlDocument(rawText.slice(directHtmlStart));
  }

  const contentKeyIndex = rawText.indexOf('"content"');
  if (contentKeyIndex === -1) return null;

  const colonIndex = rawText.indexOf(":", contentKeyIndex);
  const openingQuoteIndex = rawText.indexOf('"', colonIndex + 1);
  if (colonIndex === -1 || openingQuoteIndex === -1) return null;

  const decodedContent = rawText
    .slice(openingQuoteIndex + 1)
    .replace(/\\u003c/g, "<")
    .replace(/\\u003e/g, ">")
    .replace(/\\u0026/g, "&")
    .replace(/\\\//g, "/")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "")
    .replace(/\\t/g, "  ")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");

  const recoveredStart = findHtmlStartIndex(decodedContent);
  if (recoveredStart === -1) return null;

  return ensureHtmlDocument(decodedContent.slice(recoveredStart));
}

function parseAiPayload(rawText: string) {
  try {
    return JSON.parse(rawText);
  } catch (parseError) {
    console.error(
      "Failed to parse AI response, length:",
      rawText.length,
      "first 500 chars:",
      rawText.substring(0, 500),
      parseError,
    );

    const recoveredHtml = recoverHtmlFromRawText(rawText);
    if (!recoveredHtml) return null;

    console.log("Recovered HTML from incomplete AI response");
    return { choices: [{ message: { content: recoveredHtml } }] };
  }
}

function extractHtmlContent(data: any) {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) return null;

  const cleaned = stripCodeFences(content);
  const looksLikeHtml = /<!DOCTYPE/i.test(cleaned) || /<html/i.test(cleaned) || /<(body|main|header|section|div)\b/i.test(cleaned);
  if (!looksLikeHtml) return null;

  return ensureHtmlDocument(cleaned);
}

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
- Keep the implementation lean: no comments, no duplicated wrappers/scripts, concise copy, and reusable patterns so the final HTML stays compact enough to return in one response.

HEADER — CRITICAL (NON-NEGOTIABLE):
- The header/navbar MUST NEVER be fully transparent. ALWAYS use a translucent solid background.
- Use backdrop-blur-xl combined with a semi-opaque background color: e.g. bg-white/90, bg-gray-900/95, bg-black/80, bg-[#1a1a2e]/90.
- The header background MUST provide enough contrast for ALL nav links and logo to be clearly readable at ALL times, even when scrolling over hero images or colorful sections.
- NEVER use bg-transparent or bg-opacity-0 on headers. Minimum opacity: 80%.
- On scroll, optionally increase opacity or add shadow, but NEVER start from transparent.
- Test mentally: "If this header scrolls over a white hero image, can I still read the nav links?" — if not, darken the background.

TAILWIND / DESIGN RULES:
- Define all brand colors in tailwind.config inside a script block.
- Use semantic colors: primary, secondary, accent, background, foreground, muted, card, border.
- Never rely on random hardcoded design decisions outside the provided spec.
- Typography must be expressive and premium.
- Use asymmetry, depth, gradient moments, and at least one strong hero moment.

TEXT READABILITY — CRITICAL:
- EVERY text element MUST have sufficient contrast against its background. This is non-negotiable.
- On dark backgrounds: use white (#FFFFFF) or very light colors (min contrast ratio 4.5:1).
- On light backgrounds: use dark colors (#111827, #1F2937) (min contrast ratio 4.5:1).
- NEVER place gray text on dark backgrounds. NEVER place light text on light backgrounds.
- For text over images, ALWAYS add a dark overlay (bg-black/60 minimum) AND use white text.
- Muted/secondary text must still be readable: use opacity-70 on white text over dark, or use #6B7280 on white backgrounds.
- Navigation links, footer text, card descriptions — ALL must be clearly legible.
- When in doubt, increase contrast. Unreadable text is the worst UX failure.
- Test every section mentally: "Can a user with normal vision read this text instantly?"

IMAGE ANALYSIS & PLACEMENT RULES:
- BEFORE placing any image, analyze its likely content based on the URL and context (e.g., a Pexels photo of "restaurant interior" should go in the About or Gallery section, not as a tiny icon).
- Match each image to the MOST RELEVANT section of the page. Hero images should be wide/cinematic. Service images should be cropped to cards. Team/about images should be portrait-friendly.
- Use ONLY image URLs explicitly provided in the specification.
- NEVER invent, guess, or use URLs from unsplash.com, pexels.com, or any external domain that was not provided.
- When you need PLACEHOLDER or DECORATIVE images that were NOT provided, use ONLY these reliable services:
  * https://picsum.photos/WIDTH/HEIGHT (e.g. https://picsum.photos/800/600 for a landscape photo)
  * https://placehold.co/WIDTHxHEIGHT/HEX_BG/HEX_TEXT?text=LABEL (e.g. https://placehold.co/400x300/1a1a2e/ffffff?text=Hero)

IMAGE QUALITY, UPSCALING & ANTI-PIXELATION RULES:
- For ALL provided image URLs, you MUST request the MAXIMUM RESOLUTION available to prevent pixelation:
  * For Pexels URLs: ALWAYS replace any existing size params with ?auto=compress&cs=tinysrgb&w=1920&h=1280&dpr=2&fit=crop
  * If a Pexels URL contains /w=XXX/ or similar path-based sizing, replace with the largest: w=1920
  * For other external URLs: append quality/size parameters (e.g., q=100, w=1920, dpr=2)
  * NEVER use image URLs with w=400, w=640 or any width below 1200px. Always request w=1920 minimum.
- Add this CSS to EVERY page to upscale and sharpen images:
  img { image-rendering: auto; image-rendering: -webkit-optimize-contrast; }
  @media (-webkit-min-device-pixel-ratio: 2), (min-resolution: 192dpi) { img { image-rendering: auto; } }
- EVERY image MUST use these CSS properties for professional presentation:
  * object-fit: cover — ALWAYS. Never allow images to stretch or distort.
  * object-position: center — to focus on the subject.
  * width: 100% on the container, with explicit height (e.g., h-64, h-80, h-96, h-[500px] for heroes).
  * border-radius for cards (rounded-lg or rounded-xl).
- For HERO images: use min-h-[500px] or min-h-[600px] with w-full and object-cover. Add a dark overlay (bg-black/50 minimum) for text readability.
- For CARD images: use fixed aspect ratios with aspect-video or aspect-[4/3]. Ensure uniform height across cards in a grid. Minimum height: h-48 or h-56.
- For GALLERY images: use a consistent grid with gap-4 and uniform aspect ratios. Each image min-h-[250px].
- NEVER display images at their raw/natural size. ALWAYS constrain them within styled containers with explicit dimensions.
- NEVER use images smaller than their container — this causes pixelation. Always request large versions.
- If a provided image URL fails to load, gracefully fall back to CSS gradients, shapes, or a typographic wordmark.
- If the logo image is unavailable, render the business name as a high-quality styled text logo.
- Every img must include descriptive alt text and an onerror handler.
- Lazy-load below-the-fold images with loading="lazy".
- Add this onerror to ALL img tags: onerror="this.parentElement.classList.add('img-fallback');this.style.display='none'"
- Add this CSS to the page for fallback styling:
  .img-fallback { background: linear-gradient(135deg, var(--tw-gradient-from, #667eea), var(--tw-gradient-to, #764ba2)); min-height: 200px; display:flex; align-items:center; justify-content:center; }
  .img-fallback::after { content: ''; }

FONT RULES:
- If the requested fonts are proprietary or unavailable publicly, choose the closest high-quality public equivalent and preserve the brand feel.

CONVERSION RULES:
- The page must feel strategic and conversion-focused.
- Use strong CTA hierarchy: header CTA, hero CTA, mid-page CTA, final CTA.
- Include social proof / testimonials / trust indicators when relevant.
- Write persuasive, realistic copy tailored to the business.

FINAL CHECKLIST:
- ALL text is readable with high contrast against its background — verify every section
- Looks premium, intentional, and production-ready
- Fully responsive
- Images are high-resolution and handled gracefully
- No broken assets
- Strong visual hierarchy
- Smooth interactions
- Complete HTML document`;

    const buildUserPrompt = (compact = false) => {
      const compactInstructions = compact
        ? `\n\nTRUNCATION RECOVERY MODE:\n- The previous response was cut off. Regenerate the SAME landing page with the SAME requested sections and assets, but keep the markup and copy concise.\n- No comments.\n- No duplicated wrappers or repeated decorative elements.\n- Use a single compact script block.\n- Keep the output compact enough to fit safely in one response.`
        : "";

      return `Generate the complete HTML landing page based on this specification:\n\n${prompt}${compactInstructions}`;
    };

    const requestAiResponse = async (compact = false) => {
      const aiBody = JSON.stringify({
        model: PRIMARY_MODEL,
        max_tokens: compact ? COMPACT_MAX_TOKENS : STANDARD_MAX_TOKENS,
        temperature: compact ? 0.6 : 0.7,
        messages: [
          {
            role: "system",
            content: compact
              ? `${systemPrompt}\n\nOUTPUT SIZE RECOVERY MODE:\n- Preserve the requested sections, visuals, accessibility, and conversion intent.\n- Keep the HTML lean and compact.\n- No comments.\n- Avoid overly verbose copy and repeated decorative markup.\n- Keep JavaScript concise and centralized in one script block.`
              : systemPrompt,
          },
          {
            role: "user",
            content: buildUserPrompt(compact),
          },
        ],
      });

      let response: Response | null = null;
      const maxRetries = compact ? 2 : 3;

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        console.log(`AI request attempt ${attempt + 1}/${maxRetries}${compact ? " (compact fallback)" : ""}`);
        response = await fetch(AI_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: aiBody,
        });

        if (response.ok) {
          return { kind: "ok" as const, text: await response.text() };
        }

        if (response.status === 429) {
          return { kind: "rate_limit" as const };
        }

        if (response.status === 402) {
          return { kind: "credits" as const };
        }

        if ([502, 503, 504].includes(response.status) && attempt < maxRetries - 1) {
          const delay = (attempt + 1) * 5000;
          console.log(`Got ${response.status}, retrying in ${delay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        const text = await response.text();
        console.error("AI gateway error:", response.status, text);
        throw new Error(`AI gateway error: ${response.status}`);
      }

      throw new Error("AI gateway failed after retries");
    };

    console.log("Calling AI gateway to generate HTML landing page...");

    const primaryResult = await requestAiResponse(false);
    if (primaryResult.kind === "rate_limit") {
      return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (primaryResult.kind === "credits") {
      return new Response(JSON.stringify({ error: "AI credits exhausted. Please add funds." }), {
        status: 402,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let data = parseAiPayload(primaryResult.text);
    let htmlContent = data ? extractHtmlContent(data) : null;

    if (!htmlContent) {
      console.warn("Primary AI response was incomplete; retrying with compact output constraints");

      const compactResult = await requestAiResponse(true);
      if (compactResult.kind === "rate_limit") {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (compactResult.kind === "credits") {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add funds." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      data = parseAiPayload(compactResult.text);
      htmlContent = data ? extractHtmlContent(data) : null;
    }

    if (!htmlContent) {
      throw new Error("AI response was truncated and could not be recovered. Please try again.");
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
      html_file_name: fileName,
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