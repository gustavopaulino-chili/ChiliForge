import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const PRIMARY_MODEL = "google/gemini-2.5-flash";
const STANDARD_MAX_TOKENS = 16000;
const COMPACT_MAX_TOKENS = 10000;

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
    const { prompt, businessName, userId } = await req.json();

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

    const systemPrompt = `You are a world-class front-end developer building premium, conversion-focused landing pages.

OUTPUT: A single, complete, standalone HTML document. Raw HTML only — no markdown fences, no explanations. Start with <!DOCTYPE html>.

TECH: Tailwind via <script src="https://cdn.tailwindcss.com"></script>, Google Fonts via <link>, Font Awesome CDN for icons. Vanilla JS only — no frameworks.

BRAND FIDELITY (CRITICAL):
- The page must feel like it was designed BY the brand, not FOR the brand. Study every detail in the specification: colors, fonts, tone of voice, industry, target audience.
- Define ALL brand colors in a tailwind.config script block using semantic names: primary, secondary, accent, background, foreground, muted, card, border.
- Match typography to the brand personality — elegant serif for luxury, clean sans for tech, bold display for creative. Use the exact fonts specified or the closest premium Google Font equivalent.
- Every section's copy must match the brand's tone: formal/corporate, friendly/casual, bold/disruptive, or warm/inviting — as appropriate.
- Color palette usage must be intentional: primary for CTAs and key elements, secondary for supporting areas, accent sparingly for emphasis, muted for backgrounds and subtle UI.

STRUCTURE & SEO:
- Semantic HTML: header, nav, main, section, footer. Single H1. Full meta tags (charset, viewport, title, description, OG, Twitter).
- Sticky header with translucent background (bg-white/90 or bg-gray-900/95 + backdrop-blur-xl). NEVER fully transparent. Min opacity 80%.
- Mobile hamburger menu, smooth scroll, hover states, IntersectionObserver reveal animations.
- Accessibility: alt text, aria-labels, focus states, WCAG contrast.

TEXT CONTRAST (NON-NEGOTIABLE):
- Min 4.5:1 contrast ratio everywhere. White text on dark backgrounds, dark text on light backgrounds.
- Text over images: dark overlay bg-black/60 minimum + white text.
- No gray text on dark backgrounds. No light text on light backgrounds. Every piece of text must be instantly readable.

IMAGES:
- Use ONLY URLs from the specification. For placeholders use picsum.photos/W/H or placehold.co/WxH/BG/FG?text=Label.
- Pexels URLs: always use ?auto=compress&cs=tinysrgb&w=1920&h=1280&dpr=2&fit=crop. Never below w=1200.
- All images: object-fit:cover, object-position:center, explicit container dimensions. Hero min-h-[500px], cards h-48+, gallery min-h-[250px].
- Every img: descriptive alt, loading="lazy" below fold, onerror="this.parentElement.classList.add('img-fallback');this.style.display='none'"
- CSS fallback: .img-fallback{background:linear-gradient(135deg,#667eea,#764ba2);min-height:200px;display:flex;align-items:center;justify-content:center}
- CSS sharpening: img{image-rendering:auto;image-rendering:-webkit-optimize-contrast}

CONVERSION & PROFESSIONALISM:
- Strategic CTA hierarchy: header CTA, hero CTA, mid-page CTA, final CTA section.
- Social proof, testimonials, trust indicators where relevant.
- Persuasive, realistic, industry-specific copy — never generic lorem ipsum.
- Premium visual design: depth via shadows, subtle gradients, asymmetric layouts, generous whitespace, micro-interactions.
- The page must look like a $10,000 agency deliverable, not a template.

KEEP IT COMPACT: No HTML comments, no duplicated wrappers, concise copy, single script block. The full HTML must fit in one response.`;

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