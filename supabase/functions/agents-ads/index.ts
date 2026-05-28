import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type AgentConfig = {
  systemPrompt: string;
  model: string;
  temperature: number;
  maxTokens: number;
  version: number;
};

type AdFormat = {
  platform?: string;
  format?: string;
  label?: string;
  width?: number;
  height?: number;
  enabled?: boolean;
};

type AgentsAdsPayload = {
  mode?: "full" | "plan" | "render" | "unified" | "interpret" | "image" | "image_to_html" | "copy";
  imageBase64?: string;
  mimeType?: string;
  format?: AdFormat;
  generateAsImage?: boolean;
  geminiApiKey?: string;
  agentConfig: AgentConfig;
  globalStoreName?: string;
  globalReferenceStoreName?: string;
  imageReferenceStoreName?: string;
  companyStoreName: string;
  campaignGoodExamplesStore?: string;
  campaignMemoryStore?: string;
  campaignData: {
    brandName?: string;
    campaignName?: string;
    campaignObjective?: string;
    funnelStage?: string;
    offer?: string;
    pricing?: string;
    discount?: string;
    guarantee?: string;
    scarcity?: string;
    mainHeadline?: string;
    subheadline?: string;
    ctaText?: string;
    useAiCopy?: boolean;
    targetAudience?: string;
    ageRange?: string;
    gender?: string;
    painPoints?: string;
    desires?: string;
    urgencyLevel?: string;
    creativeStrategy?: string;
    abTestingEnabled?: boolean;
    abVariantCount?: number;
    abTestFocus?: string;
    headlineVariants?: string[];
    ctaVariants?: string[];
    logoUrl?: string;
    productImageUrl?: string;
    backgroundImageUrl?: string;
    selectedFormats?: AdFormat[];
    formatNotes?: Record<string, string>;
    [key: string]: any;
  };
  batchFormats?: AdFormat[];
  batchIndex?: number;
  totalBatches?: number;
  creativePlan?: string;
  accountType?: "admin" | "user";
  useCampaignMemory?: boolean;
};

const env = (globalThis as any).Deno?.env;
const PLAN_MODEL_CHAIN   = ["gemini-3.5-flash", "gemini-2.5-pro"];
const RENDER_MODEL_CHAIN = ["gemini-2.5-flash", "gemini-2.5-flash-lite"];
const MODEL_CHAIN        = ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.5-flash-lite"];

const COPY_SYSTEM_PROMPT = `You are an expert direct-response ad copywriter. Generate concise, conversion-focused copy based on campaign data. Output ONLY valid JSON matching the schema.
Rules: mainHeadline max 40 chars — punchy hook/promise. subheadline max 55 chars — reinforces value or specificity. ctaText 2–5 words — action-first verb. bodyText optional supporting line. If abTestingEnabled and abVariantCount > 1, generate abVariants testing the declared abTestFocus.`;

const COPY_JSON_SCHEMA = {
  type: "object",
  properties: {
    mainHeadline: { type: "string" },
    subheadline:  { type: "string" },
    ctaText:      { type: "string" },
    bodyText:     { type: "string" },
    abVariants: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label:    { type: "string" },
          headline: { type: "string" },
          cta:      { type: "string" },
        },
        required: ["label", "headline", "cta"],
      },
    },
  },
  required: ["mainHeadline", "subheadline", "ctaText"],
};

function asList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
}

function getApiKey(userKey?: string): string {
  if (userKey?.trim()) return userKey.trim();
  return env?.get("GEMINI_API_KEY_PRODUCTION") || env?.get("GEMINI_API_KEY_TESTING") || "";
}

function isRetiredGeminiImageModel(model: string): boolean {
  return /^gemini-2\.0-.*image/i.test(model) || /^gemini-2\.5-.*image-preview$/i.test(model);
}

const GEMINI_IMAGE_MODELS = [
  ...(env?.get("GEMINI_IMAGE_MODELS") || env?.get("GEMINI_IMAGE_MODEL") || "")
    .split(",")
    .map((value: string) => value.trim())
    .filter(Boolean),
  "gemini-2.5-flash-image",
].filter((model, index, list) => !isRetiredGeminiImageModel(model) && list.indexOf(model) === index);

function buildImageApiUrl(model: string, key: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
}

function extractImageDataUrl(payload: unknown): string | null {
  const parts = (payload as any)?.candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    const inlineData = part?.inlineData ?? part?.inline_data;
    const mimeType = inlineData?.mimeType ?? inlineData?.mime_type;
    const data = inlineData?.data;
    if (typeof mimeType === "string" && mimeType.startsWith("image/") && typeof data === "string" && data) {
      return `data:${mimeType};base64,${data}`;
    }
  }
  return null;
}

function summarizeGeminiImagePayload(payload: unknown): string {
  const parts = (payload as any)?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "response had no candidate parts";
  const summary = parts.map((part: any) => {
    if (typeof part?.text === "string") return `text:${part.text.slice(0, 160)}`;
    const inlineData = part?.inlineData ?? part?.inline_data;
    const mimeType = inlineData?.mimeType ?? inlineData?.mime_type;
    if (mimeType) return `inline:${mimeType}`;
    return Object.keys(part || {}).join(",");
  }).filter(Boolean).join(" | ");
  return summary || "candidate parts were empty";
}

async function generateAdImage(
  prompt: string,
  refImages: Array<{ data: string; mimeType: string }>,
  apiKey: string,
  aspectRatio?: string,
): Promise<string | null> {
  const parts: unknown[] = [{ text: prompt }];
  for (const img of refImages) {
    parts.push({ inline_data: { mime_type: img.mimeType, data: img.data } });
  }
  let lastError = "";
  for (const model of GEMINI_IMAGE_MODELS) {
    const configVariants = [
      {
        responseModalities: ["TEXT", "IMAGE"],
        ...(aspectRatio ? { imageConfig: { aspectRatio } } : {}),
      },
      { responseModalities: ["TEXT", "IMAGE"] },
    ];
    for (const generationConfig of configVariants) {
      let attempt = 0;
      while (attempt < 3) {
        try {
          const res = await fetch(buildImageApiUrl(model, apiKey), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts }],
              generationConfig,
            }),
          });
          const bodyText = await res.text();
          if (!res.ok) {
            const isTransient = res.status === 503 || res.status === 502 || res.status === 529;
            if (isTransient && attempt < 2) {
              await new Promise(r => setTimeout(r, 3000 + attempt * 2000));
              attempt++;
              continue;
            }
            lastError = `Gemini image ${model} returned ${res.status}: ${bodyText.slice(0, 500)}`;
            break;
          }
          let data: unknown = null;
          try {
            data = JSON.parse(bodyText);
          } catch {
            lastError = `Gemini image ${model} returned invalid JSON: ${bodyText.slice(0, 240)}`;
            break;
          }
          const url = data ? extractImageDataUrl(data) : null;
          if (url) return url;
          lastError = `Gemini image ${model} returned no image part: ${summarizeGeminiImagePayload(data)}`;
          break;
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
          break;
        }
      }
    }
  }
  throw new Error(lastError || "Gemini image generation returned no image");
}

function buildAiUrl(model: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

function extractAssets(html: string): string[] {
  const urls: string[] = [];
  const patterns = [/src=["']([^"']+)["']/g, /url\(["']?([^"')]+)["']?\)/g];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(html)) !== null) {
      const url = m[1].trim();
      if (url.startsWith("http") && !url.includes("fonts.googleapis")) urls.push(url);
    }
  }
  return [...new Set(urls)];
}

function getEnabledFormats(payload: AgentsAdsPayload): AdFormat[] {
  const source = Array.isArray(payload.batchFormats) && payload.batchFormats.length
    ? payload.batchFormats
    : payload.campaignData?.selectedFormats || [];
  return source.filter((f) => f.enabled !== false && f.width && f.height);
}

function imageAspectRatioForFormat(format: AdFormat): string {
  const width = Number(format.width || 1);
  const height = Number(format.height || 1);
  const ratio = width / Math.max(1, height);
  const options = [
    { value: "1:1", ratio: 1 },
    { value: "4:5", ratio: 4 / 5 },
    { value: "9:16", ratio: 9 / 16 },
    { value: "16:9", ratio: 16 / 9 },
    { value: "3:2", ratio: 3 / 2 },
    { value: "2:3", ratio: 2 / 3 },
    { value: "3:4", ratio: 3 / 4 },
    { value: "4:3", ratio: 4 / 3 },
    { value: "21:9", ratio: 21 / 9 },
  ];
  return options.reduce((best, item) =>
    Math.abs(item.ratio - ratio) < Math.abs(best.ratio - ratio) ? item : best,
  ).value;
}

function buildBrandConsistencyRules(data: AgentsAdsPayload["campaignData"]): string {
  const cta = String(data.ctaText || "CTA").trim();
  const hasLogo = Boolean(String(data.logoUrl || "").trim())
    || (Array.isArray(data.logoVariants) && data.logoVariants.some((v: any) => String(v?.url || "").trim()));
  return [
    "NON-NEGOTIABLE BRAND AND CAMPAIGN LOCK",
    "- Treat the form fields as the source of truth. The final creative must visibly reflect brand name, offer/value proposition, target audience, tone of voice, brand personality, objective, colors, CTA, and provided assets.",
    hasLogo
      ? "- ABSOLUTE LOGO LOCK: The company logo is a protected legal/brand asset. Reinterpreted logos are NOT logos. A similar mark, redrawn mark, generated monogram, stylized substitute, recolored version, traced icon, simplified version, or logo-like decoration does not satisfy the logo requirement. It is forbidden to redraw, regenerate, recolor, restyle, warp, crop into unreadability, add effects to, trace, simplify, substitute, or invent a replacement logo. If a logo URL or logo reference image exists, every creative MUST include at least one visible instance of that exact original logo asset with original proportions and original colors. HTML mode must use the exact logo URL in an <img> element. Image mode must place the attached/provided logo unchanged; if the model cannot reproduce it exactly, leave a clean logo-safe area and do not invent any mark."
      : "- ABSOLUTE LOGO LOCK: If no logo asset is provided, use brand name text only. Do not invent a fake symbol, seal, icon, monogram, mascot, or fake logo.",
    "- LOGO PRESENCE CHECK: Before final output, verify the logo is visible when provided. Missing logo, altered logo, or fake logo is a failed creative.",
    "- CTA SYSTEM LOCK: Use one campaign CTA system across all formats: same wording unless an explicit A/B CTA variant is provided, same accent color, same typography weight, and proportional emphasis.",
    "- SOCIAL MEDIA CTA LOCK: For Instagram, Facebook, TikTok, LinkedIn, social feed, social square, social story, and social media formats, NEVER draw a button, pill button, rounded rectangle button, bordered button, app button, or any clickable UI control — and NEVER underline text or use visual affordances that simulate a clickable link. The CTA must be expressed as organic ad copy integrated into the creative: a caption-style phrase at the bottom (e.g., 'Available now · Link in bio', 'Visit our store today', 'DM us for a free quote'), an offer phrase woven into the body, action text set as a typographic element (bold, isolated line, or color-highlighted), or a directional cue ('Swipe up', 'See more below'). Think organic post copy, not app UI. Display/banner formats may use styled buttons; social media formats may not.",
    `- Default CTA text: "${cta}". If A/B focus is not cta, keep this CTA text unchanged across variants and formats.`,
    "- CROSS-FORMAT CONSISTENCY: All formats must feel like one campaign family: same palette roles, same logo treatment, same CTA treatment, same headline/copy tone, same offer hierarchy, and same product/background art direction. Adapt layout to ratio, not identity.",
    "- FORMAT ADAPTATION RULE: Recompose for each ratio while preserving the campaign system. Story, portrait, square, landscape, and display may move zones, but CTA, logo behavior, colors, and message hierarchy must stay consistent.",
    "- A/B CONTROL RULE: Variants must test one named variable only. Keep the campaign system, logo, palette, CTA style, product treatment, and general composition family stable unless that exact variable is the declared focus.",
  ].join("\n");
}

function buildCampaignFactsForImage(data: AgentsAdsPayload["campaignData"]): string {
  const full = buildCampaignFacts(data);
  return full.replace(
    /\nAssets:\n[\s\S]*?(?=\n\n|$)/,
    "\nAssets: All logo, product, and background assets are attached as INLINE REFERENCE IMAGES — use them directly from the attached images. NEVER render URLs, domain names, file paths, or any URL string as visible text in the image.",
  );
}

function buildImageVariantTasks(formats: AdFormat[], data: AgentsAdsPayload["campaignData"]) {
  const isAbTest = Boolean(data.abTestingEnabled) && Number(data.abVariantCount || 2) > 1;
  const variantCount = isAbTest ? Math.min(3, Math.max(2, Number(data.abVariantCount || 2))) : 1;
  const labels = ["A", "B", "C"];
  const focus = String(data.abTestFocus || "mixed").trim() || "mixed";
  return formats.flatMap((format) =>
    Array.from({ length: variantCount }, (_, variantIndex) => {
      const variantLabel = isAbTest ? labels[variantIndex] : "";
      const headline = isAbTest ? String((data.headlineVariants || [])[variantIndex] || "").trim() : "";
      const cta = isAbTest ? String((data.ctaVariants || [])[variantIndex] || "").trim() : "";
      const focusInstruction = !isAbTest
        ? "No A/B variant. Generate the canonical campaign creative for this format."
        : [
            `A/B VARIANT ${variantLabel}. Focus: ${focus}.`,
            headline ? `Use this variant headline/hook: "${headline}".` : "",
            cta ? `Use this variant CTA text: "${cta}".` : "",
            "Keep every non-tested variable consistent with sibling variants: logo treatment, CTA visual style, palette roles, product treatment, background style, and overall campaign family.",
            focus === "cta"
              ? "CTA test: only CTA text/urgency may change. The CTA button visual style must stay the same."
              : focus === "headline"
                ? "Headline test: change the hook/copy angle only. CTA text and visual treatment stay locked."
                : focus === "visual"
                  ? "Visual test: change crop/focal emphasis only while preserving the same CTA system, logo treatment, color roles, and copy intent."
                  : focus === "color"
                    ? "Color test: rotate emphasis only inside the provided brand palette. Do not invent new colors and do not change CTA shape/typography."
                    : "Mixed test: change one major variable intentionally, not the whole design.",
          ].filter(Boolean).join("\n");
      return { format, variantLabel, variantIndex, focusInstruction };
    })
  );
}

function buildCampaignFacts(data: AgentsAdsPayload["campaignData"]): string {
  const lines: string[] = [];

  // — Language (MUST come first — all ad copy must follow this) —
  const LANGUAGE_NAMES: Record<string, string> = {
    pt: "Portuguese (Brazilian)", en: "English", es: "Spanish", fr: "French",
    de: "German", it: "Italian", ja: "Japanese", zh: "Chinese",
  };
  const langCode = typeof data.language === "string" ? data.language.trim().toLowerCase() : "";
  const langLabel = langCode && langCode !== "auto" ? (LANGUAGE_NAMES[langCode] || langCode) : "";
  if (langLabel) {
    lines.push(`⚠️ LANGUAGE MANDATE: ALL copy (headlines, subheadlines, CTA, body text, offer text, disclaimers) MUST be written in ${langLabel}. No mixing of languages. Zero exceptions.`);
  }
  lines.push("⚠️ SPELLING & GRAMMAR MANDATE: Every word of copy must be 100% free of spelling, grammar, and typographical errors. Proofread every text element before output. A single typo is a failed creative.");

  // — Campaign identity —
  if (data.campaignName) lines.push(`Campaign: ${data.campaignName}`);
  if (data.brandName) lines.push(`Brand: ${data.brandName}`);
  if (data.industry) lines.push(`Industry: ${data.industry}`);
  if (data.campaignObjective) lines.push(`Objective: ${data.campaignObjective}`);
  if (data.funnelStage) lines.push(`Funnel: ${data.funnelStage}`);
  if (data.productName) lines.push(`Product/Service: ${data.productName}`);
  if (data.valueProposition) lines.push(`Value prop: ${data.valueProposition}`);
  if (data.context) lines.push(`Notes: ${data.context}`);
  if (data.websiteUrl) lines.push(`Reference website: ${data.websiteUrl}`);

  // — Offer & conversion —
  const offer: string[] = [];
  if (data.offer) offer.push(`Offer: ${data.offer}`);
  if (data.pricing) offer.push(`Price: ${data.pricing}`);
  if (data.discount) offer.push(`Discount: ${data.discount}`);
  if (data.guarantee) offer.push(`Guarantee: ${data.guarantee}`);
  if (data.scarcity) offer.push(`Scarcity: ${data.scarcity}`);
  if (offer.length) lines.push(offer.join(" | "));
  if (data.ctaText) lines.push(`CTA: ${data.ctaText}`);

  // — Audience —
  const aud: string[] = [];
  if (data.targetAudience) aud.push(data.targetAudience);
  if (data.ageRange) aud.push(data.ageRange);
  if (data.gender && data.gender !== "all") aud.push(data.gender);
  if (aud.length) lines.push(`Audience: ${aud.join(", ")}`);
  if (data.painPoints) lines.push(`Pain points: ${data.painPoints}`);
  if (data.desires) lines.push(`Desires: ${data.desires}`);
  if (data.forbiddenWords) lines.push(`Forbidden words: ${data.forbiddenWords}`);
  if (data.brandKeywords) lines.push(`Required keywords: ${data.brandKeywords}`);
  if (data.brandPersonality) lines.push(`Brand personality: ${data.brandPersonality}`);

  // — Exact copy (override AI copy when provided) —
  if (!data.useAiCopy && (data.mainHeadline || data.subheadline)) {
    lines.push("EXACT COPY — do not change:");
    if (data.mainHeadline) lines.push(`  headline: "${data.mainHeadline}"`);
    if (data.subheadline) lines.push(`  subheadline: "${data.subheadline}"`);
    if (data.ctaText) lines.push(`  cta: "${data.ctaText}"`);
  }

  // — Design parameters: values only — rules come from File Search stores —
  lines.push("");
  lines.push("Design parameters (retrieve execution rules from stores for each):");
  if (data.preferredLogoStrategy) lines.push(`  logo-strategy: ${data.preferredLogoStrategy}`);
  if (data.preferredStyle) lines.push(`  visual-style: ${data.preferredStyle}`);
  if (data.toneOfVoice) lines.push(`  tone-of-voice: ${data.toneOfVoice}`);
  if (data.brandPersonality) lines.push(`  brand-personality: ${data.brandPersonality}`);
  if (data.creativeStrategy) lines.push(`  creative-strategy: ${data.creativeStrategy}${data.creativeStrategyOther ? ` (${data.creativeStrategyOther})` : ""}`);
  if (data.urgencyLevel) lines.push(`  urgency-level: ${data.urgencyLevel}`);
  if (data.imageFallbackMode) lines.push(`  image-fallback: ${data.imageFallbackMode}`);
  if (data.abTestingEnabled && data.abTestFocus) lines.push(`  ab-test-focus: ${data.abTestFocus}`);
  const enabledFormats = (data.selectedFormats || []).filter((f: AdFormat) => f.enabled !== false && f.width && f.height);
  if (enabledFormats.length) {
    lines.push(`  selected-formats: ${enabledFormats.map((f: AdFormat) => `${f.platform}/${f.format}/${f.width}x${f.height}`).join(" | ")}`);
  }
  if (data.formatNotes && typeof data.formatNotes === "object" && Object.keys(data.formatNotes).length) {
    lines.push(`  format-notes: ${JSON.stringify(data.formatNotes).slice(0, 1200)}`);
  }
  lines.push("");
  lines.push("Mandatory guideline lookup checklist:");
  [
    ["campaign-objective", data.campaignObjective],
    ["funnel-stage", data.funnelStage],
    ["creative-strategy", data.creativeStrategy],
    ["visual-style", data.preferredStyle],
    ["tone-of-voice", data.toneOfVoice],
    ["brand-personality", data.brandPersonality],
    ["urgency-level", data.urgencyLevel],
    ["logo-strategy", data.preferredLogoStrategy],
    ["image-fallback", data.imageFallbackMode],
    ["ab-test-focus", data.abTestingEnabled ? data.abTestFocus : ""],
  ].forEach(([key, value]) => {
    if (value) lines.push(`  - Retrieve and apply global guideline for ${key}: ${value}`);
  });
  if (enabledFormats.length) {
    lines.push("  - Retrieve and apply the exact layout guideline for every selected platform/format/dimension above");
  }

  // — Brand colors (dynamic per company — NOT in stores) —
  const colors: string[] = [];
  if (data.primaryColor) colors.push(`primary: ${data.primaryColor} → dominant element`);
  if (data.secondaryColor) colors.push(`secondary: ${data.secondaryColor}`);
  if (data.accentColor) colors.push(`accent/CTA: ${data.accentColor} → CTA button`);
  if (data.textColor) colors.push(`text: ${data.textColor}`);
  if (data.backgroundColor && !data.backgroundImageUrl) colors.push(`background: ${data.backgroundColor} → base when no image`);
  if (colors.length) lines.push(`Colors: ${colors.join(" | ")}`);
  if (data.headingFont || data.customHeadingFontName) lines.push(`Heading font: ${data.customHeadingFontName || data.headingFont}`);
  if (data.bodyFont || data.customBodyFontName) lines.push(`Body font: ${data.customBodyFontName || data.bodyFont}`);
  if (data.brandBookExtractedData && typeof data.brandBookExtractedData === "object" && Object.keys(data.brandBookExtractedData).length) {
    lines.push(`Brand book data: ${JSON.stringify(data.brandBookExtractedData).slice(0, 1000)}`);
  }
  if (data.companyProfile && typeof data.companyProfile === "object" && Object.keys(data.companyProfile).length) {
    lines.push(`Company profile facts: ${JSON.stringify(data.companyProfile).slice(0, 1600)}`);
  }

  // — Assets —
  lines.push("");
  lines.push("Assets:");
  if (data.logoUrl) lines.push(`  LOGO: ${data.logoUrl}`);
  const logoVariants = Array.isArray(data.logoVariants)
    ? data.logoVariants.map((v: any) => `${v.label || "Logo"}: ${v.url || ""}${v.usageHint ? ` (${v.usageHint})` : ""}`).filter((v: string) => v.includes("http") || v.includes("data:"))
    : [];
  if (logoVariants.length) lines.push(`  LOGO VARIANTS: ${logoVariants.join(" | ")}`);
  if (data.productImageUrl) lines.push(`  PRODUCT: ${data.productImageUrl}`);
  const productVariants = asList(data.productImageVariants);
  if (productVariants.length) lines.push(`  PRODUCT VARIANTS: ${productVariants.join(" | ")}`);
  if (data.backgroundImageUrl) lines.push(`  BACKGROUND: ${data.backgroundImageUrl}`);
  const bgVariants = asList(data.backgroundImageVariants);
  if (bgVariants.length) lines.push(`  BACKGROUND VARIANTS: ${bgVariants.join(" | ")}`);
  if (data.imageFallbackPrompt) lines.push(`  FALLBACK PROMPT: ${data.imageFallbackPrompt}`);

  lines.push("");
  lines.push(buildBrandConsistencyRules(data));

  // — A/B —
  if (data.abTestingEnabled) {
    lines.push("");
    lines.push(`A/B: ${data.abVariantCount || 2} variants | Focus: ${data.abTestFocus || "mixed"}`);
    if (data.headlineVariants?.length) lines.push(`  Headline variants: ${data.headlineVariants.join(" | ")}`);
    if (data.ctaVariants?.length) lines.push(`  CTA variants: ${data.ctaVariants.join(" | ")}`);
  }

  return lines.filter((l) => l !== undefined).join("\n");
}

function buildRetrievalHints(data: AgentsAdsPayload["campaignData"], formats: AdFormat[]): string {
  const hints: string[] = ["ads-00-retrieval-index"];
  const add = (label: string, value: unknown) => {
    if (typeof value === "string" && value.trim()) hints.push(`${label}=${value.trim()}`);
  };

  add("campaignObjective", data.campaignObjective);
  add("funnelStage", data.funnelStage);
  add("preferredStyle", data.preferredStyle);
  add("toneOfVoice", data.toneOfVoice);
  add("brandPersonality", data.brandPersonality);
  add("creativeStrategy", data.creativeStrategy);
  add("urgencyLevel", data.urgencyLevel);
  if (data.abTestingEnabled) add("abTestFocus", data.abTestFocus || "mixed");

  for (const f of formats) {
    if (f.width && f.height) hints.push(`format=${f.width}x${f.height}`);
    if (f.platform) hints.push(`platform=${f.platform}`);
    if (f.format) hints.push(`formatName=${f.format}`);
  }

  return [...new Set(hints)].join("\n- ");
}

function buildFormatsList(formats: AdFormat[], formatNotes?: Record<string, string>): string {
  return formats.map((f) => {
    const noteKey = `${f.platform}-${f.label}`;
    const note = formatNotes?.[noteKey];
    return `  - ${f.label} (${f.width}×${f.height}px, platform: ${f.platform}, format: ${f.format})${note ? ` — NOTE: ${note}` : ""}`;
  }).join("\n");
}

function deriveFormatCategory(f: AdFormat): string {
  const platform = (f.platform || "social").trim().toLowerCase();
  const format = (f.format || "").trim().toLowerCase();
  // Include platform so social-square (1080x1080) and display-square (250x250) never share a generation call
  if (format) return `${platform}-${format}`;
  const w = f.width ?? 0;
  const h = f.height ?? 0;
  if (!w || !h) return `${platform}-other`;
  const ratio = w / h;
  if (ratio < 0.7) return `${platform}-story`;
  if (ratio < 1.1) return `${platform}-square`;
  if (ratio > 3) return `${platform}-leaderboard`;
  return `${platform}-banner`;
}

function groupFormatsByCategory(formats: AdFormat[]): AdFormat[][] {
  const map = new Map<string, AdFormat[]>();
  for (const f of formats) {
    const key = deriveFormatCategory(f);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(f);
  }
  return Array.from(map.values());
}

function buildSourceOrchestration(hasApprovedExamples = false): string {
  return [
    "Source hierarchy: (1) Campaign facts below — highest priority, mandatory. (2) Company store — brand identity, assets. (3) Global store — design rules, HTML standards, copy principles.",
    "Asset rule: if LOGO, PRODUCT, or BACKGROUND URL is listed in campaign facts, render it as an <img> element. Never replace a provided image with a color block.",
    "Mandatory store order: query global ads guidelines first, company brand/assets second, then campaign memory/examples. Do not skip global guidelines for any non-empty form option.",
    "Conflict rule: campaign facts override store guidance. Store guidance overrides generic instinct.",
    hasApprovedExamples
      ? "Approved examples rule: retrieve the good ad examples before planning. Analyze what made them work: layout structure, focal point, CTA treatment, visual hierarchy, color use, spacing, and format fit. Reuse the winning principles, NOT the exact layout. Every new creative must be a fresh variation inspired by the examples."
      : "",
    "Anti-clone rule: never produce multiple formats by resizing the same design. Same campaign concept is allowed; same positions, same crop, same centered stack, and same CTA placement across ratios are not allowed.",
  ].filter(Boolean).join("\n");
}

const LAYOUT_STRATEGIES = [
  "editorial-crop: use a bold image crop, asymmetric copy block, and one distinctive ad-like device",
  "product-stage: stage the product/hero asset as the focal point with foreground depth and a contrasting CTA area",
  "modular-display: use structured panels, chips, and a horizontal or vertical message system suited to the exact format",
  "cinematic-action: full-bleed image or color field with strong overlay, dramatic type scale, and a clear lower-third action",
  "typographic-poster: make the headline the hero with strong scale contrast, supporting badges, and restrained imagery",
  "brand-system: build a layout around the company's colors, logo behavior, and campaign proof/offer assets",
  "image-dominant: large logo or product image fills 60%+ of banner area, headline overlaid with strong contrast",
  "split-layout: image or logo occupies one half of the banner, copy and CTA on the other half",
  "bottom-anchor: visual content fills the top half, conversion copy and CTA are anchored at the bottom",
  "center-hero: product or logo centered, headline above, CTA below — symmetrical composition",
  "gradient-overlay: full-bleed background image with a strong gradient or color mask to ensure text readability",
  "corner-brand: logo pinned to a corner, large background image fills the banner, CTA floats on opposite corner",
];

function getLayoutSeed(): string {
  return LAYOUT_STRATEGIES[Math.floor(Math.random() * LAYOUT_STRATEGIES.length)];
}

function buildRendererSourceOrchestration(hasApprovedExamples = false, isUnified = false): string {
  return [
    isUnified
      ? "Source hierarchy: (1) Campaign facts — highest priority. (2) Company store — brand identity and assets. (3) Global store — design rules and HTML standards. (4) Reference store — COMPETITOR ADS from other brands, for abstract layout structure only."
      : "Source hierarchy: (1) Campaign facts below - highest priority. (2) Creative plan created from global/company/campaign stores. (3) Attached stores during render for final rule checks, brand identity, CTA sizing, and image treatment.",
    isUnified
      ? "STEP 1 — Query stores BEFORE generating HTML: retrieve brand identity (colors, fonts, logo) from company store, design and layout rules from global store. Only after brand identity is locked in, optionally query reference store for abstract structural inspiration — see isolation rule below."
      : "Renderer rule: use the approved creative plan, direct campaign/company facts, and attached File Search stores. Re-check global guidelines for the exact format, CTA sizing, image treatment, and brand personality before writing HTML.",
    "Asset rule: if LOGO, PRODUCT, or BACKGROUND URL is listed in campaign facts, render it as an <img> element. Never replace a provided image with a color block.",
    "Reference store brand isolation: The reference store contains ADS FROM COMPETITOR BRANDS — never this brand. PROHIBITED: carrying over any color palette, font choice, logo, product imagery, or brand voice from reference ads. ALLOWED: abstract structural principles only — composition skeleton, CTA anchoring, text-to-image ratio, visual hierarchy pattern. This brand's visual identity comes ONLY from the company store and campaign facts.",
    hasApprovedExamples
      ? "Approved examples were already analyzed in the creative plan. Use their winning principles, not their exact layout or coordinates."
      : "",
    "Anti-clone rule: never produce multiple formats by resizing the same design. Same campaign concept is allowed; same positions, same crop, same centered stack, and same CTA placement across ratios are not allowed.",
  ].filter(Boolean).join("\n");
}

function buildReferenceRetrievalGuide(
  campaignData: AgentsAdsPayload["campaignData"],
  formats: AdFormat[],
): string {
  const searches: string[] = [];

  // Format/dimension — highest specificity
  const formatNames = [...new Set(formats.map((f) => f.format).filter(Boolean))];
  const dims = [...new Set(
    formats.map((f) => (f.width && f.height ? `${f.width}x${f.height}` : null)).filter(Boolean),
  )];
  if (formatNames.length) searches.push(`format: ${formatNames.join(" OR ")}`);
  if (dims.length) searches.push(`dimensions: ${dims.join(" OR ")}`);

  // A/B testing
  if (campaignData.abTestingEnabled) {
    const focus = campaignData.abTestFocus || "mixed";
    searches.push(`AB testing ${focus} variant`);
  }

  // Objective + funnel
  if (campaignData.campaignObjective) searches.push(`objective: ${campaignData.campaignObjective}`);
  if (campaignData.funnelStage) searches.push(`funnel: ${campaignData.funnelStage}`);

  // Style + urgency + strategy
  if (campaignData.preferredStyle) searches.push(`style: ${campaignData.preferredStyle}`);
  if (campaignData.urgencyLevel && campaignData.urgencyLevel !== "none") {
    searches.push(`urgency: ${campaignData.urgencyLevel}`);
  }
  if (campaignData.creativeStrategy) searches.push(`strategy: ${campaignData.creativeStrategy}`);

  if (!searches.length) return "";

  return [
    "=== ADS REFERENCE STORE — TARGETED RETRIEVAL GUIDE ===",
    "The reference store contains real example ads. Use SPECIFIC targeted searches — do NOT retrieve broadly:",
    searches.map((q, i) => `  ${i + 1}. Search "${q}" — find layout/composition examples matching this`).join("\n"),
    "Priority order: format/dimensions first → objective/funnel → style.",
    "From retrieved examples extract ONLY: layout technique, z-index layering, CTA zone placement, text-to-image ratio, spacing rhythm, composition shape.",
    "FORBIDDEN from reference examples: colors, hex values, fonts, brand logos, brand names, copy text, imagery. Structure only.",
  ].join("\n");
}


function getAbFocusDescription(focus: string): string {
  const descriptions: Record<string, string> = {
    headline: "vary headline angle, subheadline, and body copy — keep the same visual layout and colors",
    cta: "vary CTA button text, color, shape, and urgency — keep the same copy and layout",
    visual: "vary layout composition, image placement, and visual hierarchy — keep the same copy",
    color: "vary background, primary, and CTA colors across variants — keep the same layout and copy",
    mixed: "vary headline, CTA text, and one visual element simultaneously across variants",
  };
  return descriptions[focus] || "vary headline and CTA across variants";
}

function extractPlanSection(plan: string, category: string): string {
  const re = new RegExp(`\\[GROUP:\\s*${category}\\][\\s\\S]*?(?=\\[GROUP:|$)`, "i");
  const match = plan.match(re);
  return match ? match[0].trim() : plan;
}

const INTERPRET_SYSTEM_PROMPT = `You are a brand design strategist and art director. Your task:
1. Query company store — extract: primary hex, secondary hex, accent hex, exact font family names and weights available (e.g. Roboto 900/700/400), logo style, brand voice.
2. Query global store — extract: HTML/CSS layout rules, spacing guidelines, visual quality standards.
3. Query reference store — extract abstract structural patterns ONLY (composition, CTA zone, text-to-image ratio). FORBIDDEN from reference: colors, fonts, logos, brand names — these are COMPETITOR ADS.
4. For EACH format write a spec using this EXACT format:

BRAND_CSS_VARS: --primary:#HEX;--secondary:#HEX;--accent:#HEX;--font-headline:'Family',sans-serif;--fw-headline:900;--fw-body:400;--fw-cta:700
BRAND_FONT_URL: https://fonts.googleapis.com/css2?family=FAMILY:wght@400;700;900&display=swap
---
Layout: [specific CSS technique, e.g. "clip-path:polygon(0 0,60% 0,40% 100%,0 100%) diagonal overlay on left panel"]
Text: [sizes+weights+legibility, e.g. "headline 36px fw-headline, text-shadow:0 2px 8px rgba(0,0,0,.7)"]
Assets: [logo/product/bg positions with % sizes]
CTA: [button bg, text, box-shadow, border-radius, anchor position]
Shapes: [geometric accents if any — clip-path values, max 20% of product image coverage]
Anti-clone: [how this format differs from ALL other formats in this batch]

Output ONLY valid JSON, no markdown:
{"batchSpecs":[{"label":"...","spec":"BRAND_CSS_VARS: ...\\nBRAND_FONT_URL: ...\\n---\\nLayout: ..."},...]}

Reference isolation: FORBIDDEN in specs — any color, font, logo, imagery from reference ads. Brand identity = company store + campaign facts ONLY.`.trim();


const IMAGE_TO_HTML_SYSTEM_PROMPT = `\
You are an expert HTML/CSS visual reconstruction engineer. Your ONLY task is to convert a raster ad image into a self-contained, pixel-accurate HTML/CSS banner.

IDENTITY: You are NOT generating creative ideas. You are PURELY reading pixels and translating visual structure into code.

RECONSTRUCTION RULES:
1. DIMENSIONS: The root div must use exactly the specified pixel dimensions. Never use percentages for the root width/height.
2. POSITIONING: Every child element MUST use position:absolute with explicit top/left/right/bottom in px or %. Root .ad-banner uses position:relative;overflow:hidden.
3. TEXT — VERBATIM: Read every visible character exactly. Do not paraphrase or improve copy. Every word, comma, period, exclamation mark must match.
4. COLORS — PRECISE: Sample hex values directly from pixels. Use exact #rrggbb notation. Never approximate to "dark blue" — use the actual sampled value.
5. FONT SIZES — PROPORTIONAL: Estimate in px proportional to banner height. Headline ~8% of height, subheadline ~5%, body ~4%, CTA ~4.5%. Round to nearest integer.
6. FONT WEIGHTS: thin=300, regular=400, medium=500, semibold=600, bold=700, extrabold=800, black=900.
7. BACKGROUND: Reconstruct exactly — solid color:background-color, gradient:CSS gradient with sampled stop colors, full-bleed image:position:absolute img tag.
8. LAYERS (Z-INDEX): background=0, overlay=1, product/hero=5-10, shapes/decorative=11-15, text=20-30, CTA/button=40.
9. SHAPES AND DECORATIVE: Reproduce using CSS clip-path, border-radius, transform:rotate(), colored divs. Do not use SVG unless necessary.
10. BUTTONS: Exact background color, border-radius px, padding, font-size, font-weight, text color from image.
11. OVERLAYS: Semi-transparent divs with rgba() background at correct opacity.
12. LOGO: If visible and a URL is provided in context, render as <img src="[URL]" style="position:absolute;...;object-fit:contain">. Otherwise reproduce brand name as text.
13. NO EXTERNAL RESOURCES: Do not reference any image URLs except the logo URL if explicitly provided. Do NOT embed the source image — reconstruct as CSS.
14. SELF-CONTAINED: All CSS inline (style="..."). No external stylesheets. No <link> tags. No JavaScript.

OUTPUT FORMAT — output ONLY this, nothing before or after:
<!-- BANNER_START -->
<div class="ad-banner" data-platform="PLATFORM" data-format="FORMAT" style="position:relative;width:WIDTHpx;height:HEIGHTpx;overflow:hidden;[background]">
  <!-- layers -->
</div>
<!-- BANNER_END -->`.trim();

const COMPOSITION_POOL = [
  "diagonal-split: clip-path:polygon(0 0,62% 0,42% 100%,0 100%) dark overlay on left, product right",
  "hero-full-bleed: product as full background, gradient overlay bottom 50%, text+CTA stacked bottom",
  "top-image-bottom-text: product image top 55% height, brand color panel bottom 45% with text+CTA",
  "left-panel-right-image: solid brand panel left 42%, product image right 58%, logo+text in panel",
  "centered-minimal: product center, headline above, CTA below, geometric accent shape behind product",
  "bold-headline-first: oversized headline top 40%, product mid 40%, CTA bottom 20%, minimal bg",
  "frame-product: product centered with geometric frame/border accent, brand color corners, text at edges",
];

function buildInterpretPrompt(campaignFacts: string, formats: AdFormat[], formatNotes?: Record<string, string>, referenceGuide?: string): string {
  const formatList = buildFormatsList(formats, formatNotes);
  const fontLimits = formats.map((f) => {
    const h = f.height ?? 0;
    const maxH = h < 250 ? 16 : h < 500 ? 26 : h < 900 ? 38 : 52;
    return `- ${f.label || `${f.width}×${f.height}`} (${f.width}×${f.height}px): headline≤${maxH}px`;
  }).join("\n");

  // Assign a unique composition to each format from the pool
  const compositionAssignments = formats.map((f, i) => {
    const comp = COMPOSITION_POOL[i % COMPOSITION_POOL.length];
    return `- ${f.label || `${f.width}×${f.height}`}: use "${comp.split(":")[0]}" composition`;
  }).join("\n");

  return [
    "=== CAMPAIGN FACTS ===",
    campaignFacts,
    "",
    "=== FORMATS (one spec per format) ===",
    formatList,
    "",
    "=== FONT SIZE LIMITS ===",
    fontLimits,
    "",
    "=== MANDATORY COMPOSITION ASSIGNMENT (each format gets a different layout) ===",
    compositionAssignments,
    "Full composition descriptions for reference:",
    COMPOSITION_POOL.join("\n"),
    "",
    referenceGuide || "",
    "",
    "For each format: follow EXACTLY the spec format from the system prompt.",
    "BRAND_CSS_VARS must include all --primary, --secondary, --accent, --font-headline, --fw-headline, --fw-body, --fw-cta.",
    "BRAND_FONT_URL must be a valid Google Fonts URL importing all needed weights.",
    "Layout line must include the specific CSS property/value to use (clip-path, grid-template-areas, etc.).",
    "Reference principles from reference store: structural patterns only, NO brand identity elements.",
    "",
    "Output valid JSON only: {\"batchSpecs\":[{\"label\":\"...\",\"spec\":\"...\"},...]}",
  ].filter((line) => line !== undefined).join("\n");
}

function extractBrandTokens(spec: string): { cssVars: string; fontUrl: string; cleanSpec: string } {
  const cssVarsMatch = spec.match(/^BRAND_CSS_VARS:\s*(.+)$/m);
  const fontUrlMatch = spec.match(/^BRAND_FONT_URL:\s*(.+)$/m);
  const cleanSpec = spec
    .replace(/^BRAND_CSS_VARS:.*\n?/m, "")
    .replace(/^BRAND_FONT_URL:.*\n?/m, "")
    .replace(/^---\s*\n?/m, "")
    .trim();
  return {
    cssVars: cssVarsMatch?.[1]?.trim() || "",
    fontUrl: fontUrlMatch?.[1]?.trim() || "",
    cleanSpec,
  };
}

function injectBrandTokens(html: string, cssVars: string, fontUrl: string): string {
  if (!cssVars && !fontUrl) return html;
  const fontImport = fontUrl ? `@import url('${fontUrl}');` : "";
  const vars = cssVars ? `:root{${cssVars}}` : "";
  const styleBlock = `<style>${fontImport}${vars}</style>`;
  return html.includes("</head>")
    ? html.replace("</head>", `${styleBlock}\n</head>`)
    : styleBlock + html;
}

function extractInterpretJson(raw: string): { batchSpecs: Array<{ label: string; spec: string }> } {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { batchSpecs: [] };
  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    return { batchSpecs: [] };
  }
}

function buildPlanPrompt(campaignFacts: string, formatGroups: AdFormat[][], layoutSeed: string, retrievalHints: string, referenceGuide: string, formatNotes?: Record<string, string>, hasApprovedExamples = false): string {
  const groupsSummary = formatGroups.map((g) => {
    const cat = deriveFormatCategory(g[0]);
    const items = buildFormatsList(g, formatNotes);
    return `Group "${cat}" (${g.length} format${g.length > 1 ? "s" : ""}):\n${items}`;
  }).join("\n\n");

  const groupNames = formatGroups.map((g) => deriveFormatCategory(g[0]));
  return [
    "You are a senior ad creative director. Create a concise creative plan. Plain text only — no HTML.",
    "",
    buildSourceOrchestration(hasApprovedExamples),
    "",
    "=== CAMPAIGN ===",
    campaignFacts,
    "",
    "=== TARGETED STORE RETRIEVAL HINTS ===",
    "- " + retrievalHints,
    "",
    referenceGuide || "",
    "",
    "=== FORMAT GROUPS ===",
    groupsSummary,
    "",
    "=== LAYOUT SEED ===",
    layoutSeed,
    "The layout seed is inspiration only. You may choose a better layout after consulting stores, campaign facts, assets, and examples.",
    "",
    hasApprovedExamples
      ? "APPROVED EXAMPLES TASK - Query the campaign good examples first. Extract: winning layout structure, focal point, CTA treatment, visual hierarchy, color use, spacing, and format fit. Reuse the principles, not the exact arrangement."
      : "",
    "REFERENCE STORE TASK — Follow the targeted retrieval guide above when querying the reference store. Extract structural/compositional patterns only — never brand identity.",
    "VARIATION TASK - Give each exact format a distinct composition recipe. Do not scale or crop the same layout across ratios.",
    "OPEN LAYOUT TASK - Decide the final layout yourself like an art director. Use the global store for constraints, but choose the most persuasive composition for the exact objective, asset set, and format.",
    "STEP 1 — Query stores: for each design parameter listed in campaign facts, retrieve the rule and write one line.",
    "STEP 2 — For each format group, write one section starting with [GROUP: <name>] as a header. Name each group using platform-format style (e.g. [GROUP: social-story], [GROUP: display-banner], [GROUP: display-medium-rectangle]).",
    "In each section cover: the creative thread (one specific concept tying all formats in this group), the composition approach, which asset goes at which z-index layer, CTA style and placement, and how layouts should vary across the formats in the group.",
    "Be specific and actionable — no generic filler.",
  ].join("\n");
}

function enforceAllBannerDimensions(snippets: string[], formats: AdFormat[]): string[] {
  const formatMap = new Map<string, AdFormat>();
  for (const f of formats) {
    if (f.platform && f.format) formatMap.set(`${f.platform}-${f.format}`, f);
  }
  return snippets.map((snippet, index) => {
    const pMatch = snippet.match(/data-platform=["']([^"']+)["']/i);
    const fMatch = snippet.match(/data-format=["']([^"']+)["']/i);
    let fmt: AdFormat | undefined;
    if (pMatch?.[1] && fMatch?.[1]) fmt = formatMap.get(`${pMatch[1]}-${fMatch[1]}`);
    if (!fmt && index < formats.length) fmt = formats[index];
    if (!fmt?.width || !fmt?.height) return snippet;
    const w = fmt.width;
    const h = fmt.height;
    // Strip existing width/height and inject correct values
    return snippet.replace(
      /(<div\b[^>]*\bclass="ad-banner"[^>]*\bstyle=")([^"]*?)(")/i,
      (_m, pre, styles, post) => {
        const s = styles
          .replace(/\bwidth\s*:\s*[\d.]+px\s*;?\s*/gi, "")
          .replace(/\bheight\s*:\s*[\d.]+px\s*;?\s*/gi, "")
          .replace(/^;+/, "");
        return `${pre}width:${w}px;height:${h}px;${s}${post}`;
      }
    );
  });
}

function injectAdSafetyCss(html: string): string {
  const safetyCss = `<style>
.ad-banner *{box-sizing:border-box}
.ad-banner img{max-width:100%;display:block}
.ad-banner{overflow:hidden;position:relative}
.ad-banner h1,.ad-banner h2,.ad-banner h3,.ad-banner h4{margin:0;padding:0;line-height:1.2}
.ad-banner p,.ad-banner span,.ad-banner h1,.ad-banner h2,.ad-banner h3,.ad-banner h4,.ad-banner div{text-overflow:clip!important;-webkit-line-clamp:unset!important}
</style>`;
  return html.replace(/<\/head>/i, `${safetyCss}\n</head>`);
}

function clampHeadingSizes(html: string, format: AdFormat): string {
  const h = format.height ?? 500;
  const maxH1 = h < 250 ? 14 : h < 500 ? 22 : h < 900 ? 34 : 48;
  const maxH2 = Math.round(maxH1 * 0.78);
  const clampStyle = `<style>.ad-banner h1{font-size:${maxH1}px!important;max-width:100%}.ad-banner h2{font-size:${maxH2}px!important}</style>`;
  return html.includes("</head>")
    ? html.replace("</head>", `${clampStyle}\n</head>`)
    : clampStyle + html;
}

function injectButtonSafetyCss(html: string, format: AdFormat): string {
  const w = format.width ?? 300;
  const h = format.height ?? 250;
  if (isSocialMediaFormat(format)) {
    const socialCss = `<style>
.ad-banner .ad-cta,.ad-banner button,.ad-banner a[class*="cta" i],.ad-banner [class*="button" i]{
  background:transparent!important;border:0!important;box-shadow:none!important;border-radius:0!important;padding:0!important;
}
</style>`;
    return html.includes("</head>")
      ? html.replace("</head>", `${socialCss}\n</head>`)
      : socialCss + html;
  }
  const isStrip = h <= 120 || w > h * 3;
  const isSmall = !isStrip && h < 320;
  const isLarge = h >= 700;
  const font = isStrip ? Math.max(10, Math.min(14, Math.round(h * 0.14)))
    : isSmall ? Math.max(12, Math.min(16, Math.round(h * 0.058)))
    : isLarge ? Math.max(16, Math.min(22, Math.round(h * 0.026)))
    : Math.max(13, Math.min(18, Math.round(h * 0.04)));
  const padY = isStrip ? 5 : isSmall ? 7 : isLarge ? 12 : 9;
  const padX = isStrip ? 10 : isSmall ? 13 : isLarge ? 22 : 16;
  const maxWidth = Math.round(w * (isStrip ? 0.3 : isSmall ? 0.54 : isLarge ? 0.46 : 0.44));
  const maxHeight = Math.max(24, Math.round(h * (isStrip ? 0.42 : isSmall ? 0.2 : isLarge ? 0.08 : 0.16)));
  const minHeight = Math.max(24, Math.min(maxHeight, maxHeight - 12));
  const radius = isStrip ? 4 : isSmall ? 8 : isLarge ? 16 : 10;
  const css = `<style>
.ad-banner .ad-cta,.ad-banner button,.ad-banner a[class*="cta" i],.ad-banner [class*="cta" i],.ad-banner [class*="button" i]{
  display:inline-flex!important;align-items:center!important;justify-content:center!important;
  width:auto!important;min-width:0!important;max-width:${maxWidth}px!important;
  min-height:${minHeight}px!important;max-height:${maxHeight}px!important;
  padding:${padY}px ${padX}px!important;border-radius:${radius}px!important;
  font-size:${font}px!important;line-height:1!important;font-weight:700!important;
  white-space:nowrap!important;text-align:center!important;text-decoration:none!important;
  overflow:visible!important;text-overflow:clip!important;
}
</style>`;
  return html.includes("</head>")
    ? html.replace("</head>", `${css}\n</head>`)
    : css + html;
}

function buildCopyRule(format: AdFormat): string {
  if (isSocialMediaFormat(format)) {
    const socialLabel = format.label || `${format.width ?? 300}x${format.height ?? 250}`;
    return `COPY RULE [${socialLabel}]: headline + short CTA text, but CTA must be integrated into the copy/layout and must not be a button. No button-shaped container. Maximum 3 text elements.`;
  }
  const w = format.width ?? 300;
  const h = format.height ?? 250;
  const label = format.label || `${w}×${h}`;
  const isStrip = h <= 120 || (w >= 600 && h <= 120);   // leaderboard, banner strips
  const isSmall = !isStrip && h < 320;                   // medium-rectangle, small squares
  const isLarge = h >= 800;                              // stories, tall portraits

  if (isStrip) {
    return `COPY RULE [${label}]: headline ONLY — max 5 words, single line. CTA text max 3 words. Subheadline, body copy, and extra labels are FORBIDDEN — no space for them.`;
  }
  if (isSmall) {
    return `COPY RULE [${label}]: headline (max 6 words) + CTA button (max 3 words). Subheadline only if it fits on ONE line without overlap — otherwise omit it. No body copy, no bullet lists.`;
  }
  if (isLarge) {
    return `COPY RULE [${label}]: headline (max 8 words) + subheadline OR body (max 14 words, not both) + CTA (max 4 words). Maximum 3 text elements. No bullet lists or multiple paragraphs.`;
  }
  // medium: squares, landscape banners 300–800px tall
  return `COPY RULE [${label}]: headline (max 7 words) + optionally ONE of subheadline (max 8 words) OR body (max 10 words) — never both + CTA (max 4 words). Maximum 3 text elements. No bullet lists.`;
}

function buildFontSizeRule(format: AdFormat): string {
  const w = format.width ?? 300;
  const h = format.height ?? 250;
  const label = format.label || `${w}×${h}`;
  const isWideStrip = w > h * 3;
  const raw = h < 250 ? 16 : h < 500 ? 26 : h < 900 ? 38 : 52;
  const maxH = isWideStrip ? Math.round(raw * 0.6) : raw;
  const maxBody = Math.round(maxH * 0.45);
  const maxCta = Math.round(maxH * 0.5);
  return `FONT SIZE RULE [${label}]: headline max ${maxH}px, body max ${maxBody}px, CTA max ${maxCta}px. Always use px — never em/rem/%. h1/h2 elements MUST have explicit font-size set.`;
}

function isSocialMediaFormat(format: AdFormat): boolean {
  const name = `${format.platform || ""} ${format.format || ""} ${format.label || ""}`.toLowerCase();
  return /(instagram|facebook|tiktok|linkedin|social|feed|story|reels|shorts)/i.test(name)
    && !/(display|leaderboard|rectangle|banner|skyscraper)/i.test(name);
}

function buildButtonRule(format: AdFormat): string {
  if (isSocialMediaFormat(format)) {
    const socialLabel = format.label || `${format.width ?? 300}x${format.height ?? 250}`;
    return `SOCIAL CTA NO-BUTTON RULE [${socialLabel}]: CTA must be visible text but never a button, pill, rounded rectangle, bordered block, or app UI control. Use footer action text, underlined phrase, caption line, swipe/DM cue, offer line, or sticker words without a button container.`;
  }
  const w = format.width ?? 300;
  const h = format.height ?? 250;
  const label = format.label || `${w}×${h}`;
  const isStrip = h <= 120 || w > h * 3;
  const isSmall = !isStrip && h < 320;
  const isLarge = h >= 700;
  const fontMin = isStrip ? 10 : isSmall ? 12 : isLarge ? 16 : 13;
  const fontMax = isStrip ? 14 : isSmall ? 16 : isLarge ? 22 : 18;
  const maxWidth = isStrip ? "30%" : isSmall ? "54%" : isLarge ? "46%" : "44%";
  const maxHeight = isStrip ? "42%" : isSmall ? "20%" : isLarge ? "8%" : "16%";
  return `CTA BUTTON SIZE RULE [${label}]: CTA must be proportional, never oversized or tiny. Use font-size ${fontMin}-${fontMax}px, one-line text, max-width ${maxWidth}, max-height ${maxHeight}, and compact padding. It should look clickable but not become the main visual block unless the objective is direct conversion.`;
}

function buildFormatRules(format: AdFormat): string[] {
  const w = format.width ?? 300;
  const h = format.height ?? 250;
  const label = format.label || `${w}×${h}`;
  const isStrip = h <= 100;
  const isSmall = !isStrip && h < 320;
  const isLarge = h >= 700;

  if (isStrip) {
    return [
      buildFontSizeRule(format),
      buildButtonRule(format),
      buildCopyRule(format),
      `LAYOUT RULE [${label}]: Single horizontal row — logo left | headline center | CTA right. No vertical stacking of any kind. All elements on one line within the banner height.`,
      `TYPOGRAPHY RULE [${label}]: 2 font-weight levels only — headline bold (700+), CTA semibold (600). No body text needed.`,
      `VISUAL POLISH [${label}]: Solid or gradient background. CTA: inline text or minimal button (border-radius:3-4px, no large box-shadow). Keep everything compact — no large padding, no decorative elements.`,
      `SHAPES RULE [${label}]: No geometric shapes or decorative elements — strip format has no space.`,
    ];
  }
  if (isSmall) {
    return [
      buildFontSizeRule(format),
      buildButtonRule(format),
      buildCopyRule(format),
      `LAYOUT NO-OVERLAP RULE [${label}]: Stack elements vertically (flexbox column, gap:8px minimum). Headline top, CTA bottom. If subheadline is included, it must fit between headline and CTA without touching either — otherwise omit it.`,
      `TYPOGRAPHY RULE [${label}]: 2-3 font-weight levels. Headline: 700-900. CTA: 600-700. Body (if used): 400.`,
      `VISUAL POLISH [${label}]: Gradient or solid color background. CTA: border-radius:4-6px, subtle box-shadow. Headline: letter-spacing:0.2px. Text on image: text-shadow:0 1px 6px rgba(0,0,0,.7).`,
      `SHAPES RULE [${label}]: Small accent shapes only (corner element, small circle). Must not overlap product. Max 10% of banner area.`,
    ];
  }
  if (isLarge) {
    return [
      buildFontSizeRule(format),
      buildButtonRule(format),
      buildCopyRule(format),
      `LAYOUT NO-OVERLAP RULE [${label}]: Divide the tall canvas into clear zones (top: logo/image, mid: headline+body, bottom: CTA). Use flexbox or absolute positioning with generous vertical spacing. At least 20px between each zone.`,
      `TYPOGRAPHY RULE [${label}]: 3+ distinct font-weight levels — headline: 800-900, subheadline/body: 400-500, CTA: 700. Use weight contrast expressively to build hierarchy.`,
      `VISUAL POLISH [${label}]: Full-bleed background image or gradient. CTA: large button (border-radius:10px+, box-shadow:0 6px 20px rgba(0,0,0,.35), letter-spacing:0.8px, padding:14px 28px+). Headline: letter-spacing:0.5px+, line-height:1.1. Text on image: strong text-shadow or semi-transparent panel behind text.`,
      `SHAPES RULE [${label}]: Geometric shapes encouraged — diagonal strips, circles, clip-path accents. Shapes must not cover more than 20% of any product or logo image.`,
    ];
  }
  // medium: squares, landscape banners
  return [
    buildFontSizeRule(format),
    buildButtonRule(format),
    buildCopyRule(format),
    `LAYOUT NO-OVERLAP RULE [${label}]: Use flexbox (column or grid). Minimum 10px gap between each text element and between text and CTA. Never overlap two text blocks. Remove the least important element if overlap is unavoidable.`,
    `TYPOGRAPHY RULE [${label}]: 3 distinct font-weight levels — headline: 800+, body/subheadline: 400, CTA: 700. Headline letter-spacing: 0.3px+.`,
    `VISUAL POLISH [${label}]: Background: gradient or image overlay. CTA: border-radius:6-8px, box-shadow:0 4px 16px rgba(0,0,0,.3), letter-spacing:0.5px. Text on image: text-shadow:0 2px 8px rgba(0,0,0,.6) or semi-transparent panel. @import font URL from spec as first CSS line.`,
    `SHAPES RULE [${label}]: Geometric shapes encouraged (clip-path polygons, diagonal strips, circles). Must not cover more than 20% of product image. Shapes frame — they do not block.`,
  ];
}

function stripTextTruncation(html: string): string {
  return html
    .replace(/text-overflow\s*:\s*ellipsis\s*;?/gi, "")
    .replace(/-webkit-line-clamp\s*:\s*[^;}"]+;?/gi, "")
    .replace(/display\s*:\s*-webkit-box\s*;?/gi, "display:block;")
    .replace(/-webkit-box-orient\s*:\s*vertical\s*;?/gi, "");
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function visibleTextLength(html: string): number {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .length;
}

function injectAfterBannerOpen(html: string, injection: string): string {
  return html.replace(
    /(<div\b[^>]*class=["'][^"']*\bad-banner\b[^"']*["'][^>]*>)/i,
    `$1${injection}`,
  );
}

function ensureProvidedAssetVisible(html: string, data: AgentsAdsPayload["campaignData"], format: AdFormat): string {
  const imageUrl = String(data.productImageUrl || data.backgroundImageUrl || "").trim();
  if (!imageUrl || !/^https?:\/\//i.test(imageUrl) || html.includes(imageUrl)) return html;

  const h = format.height ?? 500;
  const isStrip = h <= 120;
  const objectFit = isStrip ? "contain" : "cover";
  const opacity = isStrip ? ".32" : ".86";
  const injection = [
    `<img src="${escapeHtml(imageUrl)}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:${objectFit};z-index:0;opacity:${opacity};">`,
    `<div style="position:absolute;inset:0;background:linear-gradient(90deg,rgba(0,0,0,.62),rgba(0,0,0,.18));z-index:1;"></div>`,
  ].join("");
  return injectAfterBannerOpen(html, injection);
}

function ensureMinimumAdCopy(html: string, data: AgentsAdsPayload["campaignData"], format: AdFormat): string {
  if (visibleTextLength(html) >= 18) return html;

  const w = format.width ?? 1080;
  const h = format.height ?? 1080;
  const isStrip = h <= 120;
  const headline = escapeHtml(data.mainHeadline || data.offer || data.valueProposition || data.productName || data.campaignName || "Limited offer");
  const cta = escapeHtml(data.ctaText || "Get Started");
  const headlineSize = isStrip ? Math.max(12, Math.min(22, Math.round(h * 0.28))) : Math.max(22, Math.min(52, Math.round(h * 0.072)));
  const ctaSize = isStrip ? Math.max(10, Math.min(15, Math.round(h * 0.16))) : Math.max(14, Math.min(24, Math.round(h * 0.036)));

  const injection = isStrip
    ? [
        `<div style="position:absolute;left:${Math.round(w * 0.06)}px;top:50%;transform:translateY(-50%);width:${Math.round(w * 0.58)}px;z-index:30;color:#fff;font-family:Arial,sans-serif;font-size:${headlineSize}px;line-height:1.05;font-weight:900;text-shadow:0 2px 8px rgba(0,0,0,.65);">${headline}</div>`,
        `<div class="ad-cta" style="position:absolute;right:${Math.round(w * 0.04)}px;top:50%;transform:translateY(-50%);z-index:40;background:#fff;color:#111;padding:6px 12px;border-radius:4px;font-family:Arial,sans-serif;font-size:${ctaSize}px;font-weight:800;">${cta}</div>`,
      ].join("")
    : [
        `<div style="position:absolute;left:7%;top:10%;width:76%;z-index:30;color:#fff;font-family:Arial,sans-serif;font-size:${headlineSize}px;line-height:1.05;font-weight:900;text-shadow:0 3px 12px rgba(0,0,0,.62);">${headline}</div>`,
        `<div class="ad-cta" style="position:absolute;left:7%;bottom:8%;z-index:40;background:#fff;color:#111;padding:12px 20px;border-radius:14px;font-family:Arial,sans-serif;font-size:${ctaSize}px;font-weight:800;box-shadow:0 8px 24px rgba(0,0,0,.22);">${cta}</div>`,
      ].join("");

  return injectAfterBannerOpen(html, injection);
}

function polishGeneratedBanner(html: string, data: AgentsAdsPayload["campaignData"], format: AdFormat, cssVars: string, fontUrl: string): string {
  return injectButtonSafetyCss(
    injectBrandTokens(
      ensureMinimumAdCopy(
        ensureProvidedAssetVisible(
          clampHeadingSizes(stripTextTruncation(html), format),
          data,
          format,
        ),
        data,
        format,
      ),
      cssVars,
      fontUrl,
    ),
    format,
  );
}

async function convertImageToHtml(
  imageBase64: string,
  mimeType: string,
  format: AdFormat,
  campaignData: AgentsAdsPayload["campaignData"],
  creativePlan: string,
  apiKey: string,
): Promise<string> {
  const { cssVars, fontUrl } = extractBrandTokens(creativePlan);
  const w = format.width ?? 1080;
  const h = format.height ?? 1080;
  const platform = format.platform || "banner";
  const formatName = format.format || "ad";
  const logoUrl = String(campaignData.logoUrl || "").trim();
  const brandName = String(campaignData.brandName || "").trim();

  const contextLines = [
    `BANNER DIMENSIONS: ${w}px wide × ${h}px tall`,
    `PLATFORM: ${platform}  FORMAT: ${formatName}`,
    brandName ? `BRAND NAME: ${brandName}` : "",
    logoUrl
      ? `LOGO URL (use this exact URL if a logo is visible in the image): ${logoUrl}`
      : "LOGO: No URL provided — if a brand mark is visible, reproduce as CSS/text.",
    campaignData.ctaText ? `KNOWN CTA TEXT: "${campaignData.ctaText}" — use verbatim if visible` : "",
    campaignData.mainHeadline ? `KNOWN HEADLINE: "${campaignData.mainHeadline}" — use verbatim if matches what you see` : "",
  ].filter(Boolean);

  const userMessage = [
    "Reconstruct the attached ad image as pixel-accurate HTML/CSS following the system rules.",
    "",
    "=== CAMPAIGN CONTEXT (reference only — do not override what you actually see in the image) ===",
    ...contextLines,
    "",
    "Steps:",
    "1. Read every visible text character verbatim.",
    "2. Sample exact hex colors from background, text, buttons, shapes, overlays.",
    "3. Estimate font sizes proportional to banner height.",
    "4. Identify all layers (background, overlay, product, shapes, text, CTA).",
    "5. Reconstruct with position:absolute for every element.",
    `6. Output with data-platform="${platform}" data-format="${formatName}" style="width:${w}px;height:${h}px".`,
    "7. Wrap output in <!-- BANNER_START --> ... <!-- BANNER_END --> markers.",
  ].join("\n");

  const referenceImages: ReferenceImage[] = [{
    label: `Source ad image (${w}x${h})`,
    mimeType,
    data: imageBase64,
    role: "source_to_reconstruct",
  }];

  const result = await generateWithRetry(
    IMAGE_TO_HTML_SYSTEM_PROMPT,
    userMessage,
    "gemini-2.5-pro",
    0.2,
    16000,
    apiKey,
    undefined,
    referenceImages,
  );

  const snippets = extractBannerSnippets(result.text);
  if (!snippets.length) {
    throw new Error("Vision model returned no valid banner snippet. The image may be unclear or the model failed to reconstruct it.");
  }
  const [snippet] = enforceAllBannerDimensions(snippets, [format]);
  return polishGeneratedBanner(snippet, campaignData, format, cssVars, fontUrl);
}

function extractBannerSnippets(raw: string): string[] {
  const snippets: string[] = [];
  // Primary: explicit BANNER_START/END markers required by the generation prompt
  const markerRe = /<!--\s*BANNER_START\s*-->([\s\S]*?)<!--\s*BANNER_END\s*-->/gi;
  let m;
  while ((m = markerRe.exec(raw)) !== null) {
    const snippet = m[1].trim();
    if (snippet) snippets.push(snippet);
  }
  if (snippets.length) return snippets;
  // Fallback: return full raw response if it contains ad-banner (handles model ignoring markers)
  if (raw.includes("ad-banner")) snippets.push(raw.trim());
  return snippets;
}

type GeminiResult = {
  text: string;
  groundingMetadata?: unknown;
};

type ReferenceImage = {
  label: string;
  mimeType: string;
  data: string;
  role?: "reference" | "source_to_reconstruct";
};

async function fetchImageBase64(url: string): Promise<{ mimeType: string; data: string } | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const mime = res.headers.get("content-type")?.split(";")[0].trim() ?? "image/jpeg";
    if (!mime.startsWith("image/")) return null;
    // Gemini inline image parts do not accept SVG. Keep SVG URLs in campaign
    // facts so the generated HTML can render them, but do not send SVG bytes
    // as visual reference input.
    if (mime === "image/svg+xml") return null;
    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let bin = "";
    for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
    return { mimeType: mime, data: btoa(bin) };
  } catch {
    return null;
  }
}

type GeminiCallOptions = {
  thinkingLevel?: "minimal" | "low" | "medium" | "high";
  responseMimeType?: string;
  responseSchema?: Record<string, unknown>;
};

type GenerateOptions = GeminiCallOptions & {
  modelChain?: string[];
};

type CreativeGroupPlan = {
  groupKey: string;
  formats: string[];
  headline: string;
  subheadline?: string;
  cta: string;
  bodyText?: string;
  offer?: string;
  layoutNotes: string;
  colorNotes?: string;
  imageNotes?: string;
  abVariants?: Array<{ label: string; headline: string; cta: string }>;
};

type CreativePlanJson = {
  groups: CreativeGroupPlan[];
  globalNotes?: string;
};

const CREATIVE_PLAN_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    groups: {
      type: "array",
      items: {
        type: "object",
        properties: {
          groupKey:    { type: "string" },
          formats:     { type: "array", items: { type: "string" } },
          headline:    { type: "string" },
          subheadline: { type: "string" },
          cta:         { type: "string" },
          bodyText:    { type: "string" },
          offer:       { type: "string" },
          layoutNotes: { type: "string" },
          colorNotes:  { type: "string" },
          imageNotes:  { type: "string" },
          abVariants: {
            type: "array",
            items: {
              type: "object",
              properties: {
                label:    { type: "string" },
                headline: { type: "string" },
                cta:      { type: "string" },
              },
              required: ["label", "headline", "cta"],
            },
          },
        },
        required: ["groupKey", "formats", "headline", "cta", "layoutNotes"],
      },
    },
    globalNotes: { type: "string" },
  },
  required: ["groups"],
};

async function callGemini(
  systemPrompt: string,
  userMessage: string,
  model: string,
  temperature: number,
  maxTokens: number,
  apiKey: string,
  fileSearchStores?: string[],
  referenceImages?: ReferenceImage[],
  options?: GeminiCallOptions
): Promise<GeminiResult> {
  const effectiveSystemPrompt = [
    systemPrompt,
    fileSearchStores?.length
      ? "MANDATORY: Query the attached File Search stores before planning: global ads guidelines for rules; global ad references for visual inspiration only; company store for long-form brand docs; campaign stores for memory and approved examples. Campaign facts override company guidance when they conflict, and company guidance overrides global rules."
      : "",
    fileSearchStores?.length
      ? "For every non-empty form option in the mandatory guideline lookup checklist, retrieve the matching global guideline and visibly apply it in the plan and HTML. If a field has no exact rule, infer from the closest global rule and state the adaptation in the plan."
      : "",
    fileSearchStores?.length
      ? "If approved campaign examples are available, treat them as performance references: infer their winning layout principles, CTA treatment, hierarchy, and visual hooks. Do not clone them; create a new composition that preserves what worked."
      : "",
    fileSearchStores?.length
      ? "Global ad reference store rule: The reference store contains ADS FROM COMPETITOR BRANDS — not this brand. FORBIDDEN: any color scheme, logo, product image, brand name, font choice, or visual identity element from reference ads. ALLOWED: abstract layout principles only — composition skeleton, whitespace ratio, CTA button treatment, text-to-image balance, visual hierarchy structure. This brand's identity comes ONLY from the company store and campaign facts, never from reference ads."
      : "",
  ].filter(Boolean).join("\n\n");

  const parts: unknown[] = [];
  if (referenceImages?.length) {
    for (const img of referenceImages) {
      const labelText = img.role === "source_to_reconstruct"
        ? `ANALYZE THIS IMAGE AND RECONSTRUCT AS HTML/CSS — ${img.label}:`
        : `VISUAL REFERENCE — ${img.label} (use this image in the ad as instructed):`;
      parts.push({ text: labelText });
      parts.push({ inline_data: { mime_type: img.mimeType, data: img.data } });
    }
  }
  parts.push({ text: userMessage });

  const generationConfig: Record<string, unknown> = { temperature, maxOutputTokens: maxTokens };
  if (options?.thinkingLevel) {
    generationConfig.thinkingConfig = { thinkingLevel: options.thinkingLevel };
  }
  if (options?.responseMimeType) {
    generationConfig.responseMimeType = options.responseMimeType;
    if (options.responseSchema) {
      generationConfig.responseSchema = options.responseSchema;
    }
  }

  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: effectiveSystemPrompt }] },
    contents: [{ parts }],
    generationConfig,
  };

  if (fileSearchStores?.length) {
    body.tools = [{ file_search: { file_search_store_names: fileSearchStores } }];
  }

  const res = await fetch(`${buildAiUrl(model)}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`Gemini ${model} returned ${res.status}: ${err.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts
    ?.filter((p: any) => typeof p.text === "string")
    ?.map((p: any) => p.text)
    .join("") ?? "";
  if (!text.trim()) throw new Error(`Gemini ${model} returned empty response`);
  return { text, groundingMetadata: data?.candidates?.[0]?.groundingMetadata ?? data?.candidates?.[0]?.grounding_metadata };
}

async function generateWithRetry(
  systemPrompt: string,
  userMessage: string,
  preferredModel: string,
  temperature: number,
  maxTokens: number,
  apiKey: string,
  fileSearchStores?: string[],
  referenceImages?: ReferenceImage[],
  options?: GenerateOptions
): Promise<GeminiResult> {
  const chainBase = options?.modelChain ?? MODEL_CHAIN;
  const chain = [preferredModel, ...chainBase.filter((m) => m !== preferredModel)];
  let lastError: Error | null = null;

  for (const model of chain) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await callGemini(
          systemPrompt, userMessage, model, temperature, maxTokens,
          apiKey, fileSearchStores, referenceImages,
          { thinkingLevel: options?.thinkingLevel, responseMimeType: options?.responseMimeType, responseSchema: options?.responseSchema }
        );
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        const status = lastError.message.match(/returned (\d+)/)?.[1];
        if (model !== preferredModel || attempt > 0) {
          console.warn(
            `[agents-ads][model-fallback] preferred=${preferredModel} current=${model} ` +
            `attempt=${attempt + 1}/2 status=${status ?? "non-http"} error="${lastError.message.slice(0, 120)}"`
          );
        }
        if (status === "429" || status === "502" || status === "503" || status === "546") {
          await new Promise((r) => setTimeout(r, attempt === 0 ? 4000 : 10000));
        } else {
          break;
        }
      }
    }
  }

  throw lastError ?? new Error("All Gemini models failed");
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const payload = await req.json() as AgentsAdsPayload;
    const mode = payload.mode || "full";

    // ── IMAGE_TO_HTML MODE ────────────────────────────────────────────────────
    // Runs before all other guards — this mode does not need agentConfig,
    // formats, companyStoreName, or globalStoreName.
    if (mode === "image_to_html") {
      const imageBase64 = typeof payload.imageBase64 === "string" ? payload.imageBase64.trim() : "";
      const mimeType = typeof payload.mimeType === "string" ? payload.mimeType.trim() : "image/png";
      const fmt: AdFormat | undefined = payload.format || payload.campaignData?.selectedFormats?.[0];

      if (!imageBase64) {
        return new Response(JSON.stringify({ error: "imageBase64 is required for image_to_html mode" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!fmt?.width || !fmt?.height) {
        return new Response(JSON.stringify({ error: "format with width and height is required for image_to_html mode" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const convertKey = getApiKey(typeof payload.geminiApiKey === "string" ? payload.geminiApiKey : undefined);
      if (!convertKey) {
        return new Response(JSON.stringify({ error: "Gemini API key not configured" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      try {
        const bannerHtml = await convertImageToHtml(
          imageBase64,
          mimeType,
          fmt,
          payload.campaignData || {},
          String(payload.creativePlan || ""),
          convertKey,
        );
        const fullHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}html,body{overflow:hidden;background:transparent}</style></head><body>${bannerHtml}</body></html>`;
        return new Response(JSON.stringify({ mode: "image_to_html", html: fullHtml }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (convErr) {
        return new Response(
          JSON.stringify({ error: convErr instanceof Error ? convErr.message : "Image-to-HTML conversion failed" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }
    // ── END IMAGE_TO_HTML MODE ────────────────────────────────────────────────

    if (!payload.agentConfig?.systemPrompt) {
      return new Response(JSON.stringify({ error: "agentConfig.systemPrompt is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const formats = getEnabledFormats(payload);
    if (!formats.length) {
      return new Response(JSON.stringify({ error: "No enabled ad formats provided." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { agentConfig, globalStoreName, globalReferenceStoreName, companyStoreName, campaignGoodExamplesStore, campaignMemoryStore, campaignData, useCampaignMemory } = payload;
    const apiKey = getApiKey(typeof payload.geminiApiKey === "string" ? payload.geminiApiKey : undefined);

    if (!apiKey) {
      return new Response(JSON.stringify({ error: "Gemini API key not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const fileSearchStores = [
      globalStoreName,
      globalReferenceStoreName,
      companyStoreName,
      ...(useCampaignMemory && campaignMemoryStore ? [campaignMemoryStore] : []),
      campaignGoodExamplesStore,
    ].filter((s): s is string => Boolean(s?.trim()));

    // ── COPY MODE ────────────────────────────────────────────────────────────
    // Copy mode uses no file_search stores — skip store validation entirely.
    if (mode === "copy") {
      const isAb = Boolean(campaignData.abTestingEnabled);
      const variantCount = isAb
        ? Math.min(3, Math.max(2, Number(campaignData.abVariantCount || 2)))
        : 0;

      // Strip any locked copy so buildCampaignFacts never injects "EXACT COPY — do not change"
      const copyData = { ...campaignData, useAiCopy: true };

      const userMessage = [
        buildCampaignFacts(copyData),
        isAb
          ? `A/B TESTING: generate ${variantCount} variants testing: ${campaignData.abTestFocus || "mixed"}`
          : "No A/B testing — generate single canonical copy.",
        "Generate the best possible, compelling copy for this campaign.",
      ].join("\n\n");

      const copyResult = await generateWithRetry(
        COPY_SYSTEM_PROMPT, userMessage,
        "gemini-2.5-flash", 0.9, 2000, apiKey,
        undefined, // file_search conflicts with JSON structured output mode
        undefined,
        { responseMimeType: "application/json", responseSchema: COPY_JSON_SCHEMA },
      );

      let copyJson: unknown;
      try { copyJson = JSON.parse(copyResult.text); } catch { copyJson = { mainHeadline: "", subheadline: "", ctaText: "" }; }

      return new Response(
        JSON.stringify({ mode: "copy", copy: copyJson }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!companyStoreName?.trim()) {
      return new Response(
        JSON.stringify({ error: "companyStoreName is required. Sync the company store before generation." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!globalStoreName?.trim()) {
      return new Response(
        JSON.stringify({ error: "globalStoreName is required. Upload the global ads store first in the admin panel." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const hasApprovedExamples = Boolean(campaignGoodExamplesStore?.trim());
    const isUnified = mode === "unified";
    const formatsList = buildFormatsList(formats, campaignData.formatNotes);
    const campaignFacts = buildCampaignFacts(campaignData);
    const sourceOrchestration = buildRendererSourceOrchestration(hasApprovedExamples, isUnified);
    const layoutSeed = getLayoutSeed();
    const storeNotice = "";

    // Group formats by category early — used in both plan and generation
    const formatGroups = groupFormatsByCategory(formats);
    const retrievalHints = buildRetrievalHints(campaignData, formats);
    const referenceGuide = buildReferenceRetrievalGuide(campaignData, formats);

    // Fetch reference images in parallel — model sees the actual images
    const logoUrl = campaignData.logoUrl;
    const productUrl = campaignData.productImageUrl;
    const bgUrl = campaignData.backgroundImageUrl;
    const imageSpecs = [
      { url: logoUrl,    label: "Company Logo — render as <img> with object-fit:contain in the logo layer (z-index:20)" },
      { url: productUrl, label: "Product / Hero Image — render as <img> in the product layer (z-index:10)" },
      { url: bgUrl,      label: "Background Image — render as full-bleed <img> with object-fit:cover in the background layer (z-index:0)" },
    ].filter((s): s is { url: string; label: string } => typeof s.url === "string" && s.url.startsWith("http"));
    const fetchedImages = await Promise.all(
      imageSpecs.map(({ url, label }) =>
        fetchImageBase64(url).then((img) => (img ? { label, ...img } : null)).catch(() => null)
      )
    );
    const referenceImages: ReferenceImage[] = fetchedImages.filter((img): img is ReferenceImage => img !== null);

    // IMAGE MODE: generate one PNG per format using Gemini image model
    if (payload.generateAsImage || mode === "image") {
      const campaignFactsImg = buildCampaignFactsForImage(campaignData);
      const refImagesForGen = referenceImages.map((r) => ({ data: r.data, mimeType: r.mimeType }));
      const IMAGE_LANGUAGE_NAMES: Record<string, string> = {
        pt: "Portuguese (Brazilian)", en: "English", es: "Spanish", fr: "French",
        de: "German", it: "Italian", ja: "Japanese", zh: "Chinese",
      };
      const imageLangCode = typeof campaignData.language === "string" ? campaignData.language.trim().toLowerCase() : "";
      const imageLangLabel = imageLangCode && imageLangCode !== "auto" ? (IMAGE_LANGUAGE_NAMES[imageLangCode] || imageLangCode) : "";
      const imageTasks = buildImageVariantTasks(formats, campaignData);

      // Creative spec from interpret step — same pipeline as HTML mode, just different output model
      const spec = String(payload.creativePlan || "").trim();

      // Concurrency-limited runner — avoids WORKER_RESOURCE_LIMIT from all-parallel execution
      async function runWithConcurrency<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
        const results: T[] = new Array(tasks.length);
        let idx = 0;
        async function worker() {
          while (idx < tasks.length) {
            const i = idx++;
            results[i] = await tasks[i]();
          }
        }
        await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
        return results;
      }

      const socialPlatforms = new Set(["instagram", "facebook", "tiktok", "linkedin"]);

      const imageFns = imageTasks.map((task) => async () => {
        const { format, variantLabel, focusInstruction } = task;
        const aspectRatio = imageAspectRatioForFormat(format);
        const isSocial = typeof format.platform === "string" && socialPlatforms.has(format.platform.toLowerCase());
        const hasLogo = Boolean(String(campaignData.logoUrl || "").trim());

        const prompt = [
          "Create a complete, professional advertising image for the following campaign. This must look like a real paid advertisement.",
          "",
          spec
            ? `CREATIVE SPEC (authoritative visual direction — follow precisely):\n${spec}`
            : "No creative spec provided. Use the campaign data to define a strong visual design.",
          "",
          "CAMPAIGN DATA:",
          campaignFactsImg,
          "",
          `FORMAT: ${format.width}×${format.height}px | Platform: ${format.platform || "digital"} | Aspect ratio: ${aspectRatio}`,
          variantLabel ? `A/B VARIANT ${variantLabel}: ${focusInstruction}` : focusInstruction,
          isSocial
            ? "SOCIAL FORMAT: Express the CTA as organic text copy integrated into the layout (e.g. 'Available now · Link in bio'). Do not draw buttons or clickable UI elements."
            : "",
          "",
          hasLogo
            ? "LOGO: The first attached reference image is the brand logo. Include it exactly as shown — same proportions, same colors. Do not modify, redraw, or replace it."
            : "No logo provided — use brand name as text only. Do not invent a symbol or icon.",
          refImagesForGen.length > 1
            ? "Additional reference images attached in order: product/hero, background — use them as visual assets."
            : "",
          "",
          imageLangLabel ? `All visible text in this image must be written in ${imageLangLabel}.` : "",
          "Produce a polished, finished ad image with clear visual hierarchy: dominant headline, supporting copy, visible CTA, and brand identity.",
        ].filter(Boolean).join("\n");
        const imageUrl = await generateAdImage(prompt, refImagesForGen, apiKey, aspectRatio);
        return {
          imageUrl: imageUrl ?? "",
          platform: format.platform || "other",
          format: format.format || "ad",
          label: `${format.label || `${format.width}x${format.height}`}${variantLabel ? ` - Variant ${variantLabel}` : ""}`,
          width: format.width || 1080,
          height: format.height || 1080,
          variant: variantLabel || null,
        };
      });

      const images = await runWithConcurrency(imageFns, 1);
      return new Response(JSON.stringify({ mode: "image", images }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Plan is text-only — images not needed and waste bandwidth/tokens
    const groundingMetadata: unknown[] = [];
    let creativePlan = String(payload.creativePlan || "").trim();
    const { cssVars, fontUrl, cleanSpec } = extractBrandTokens(creativePlan);
    if (cleanSpec) creativePlan = cleanSpec;

    if (mode === "interpret") {
      const interpretResult = await generateWithRetry(
        INTERPRET_SYSTEM_PROMPT,
        buildInterpretPrompt(campaignFacts, formats, campaignData.formatNotes, referenceGuide),
        agentConfig.model || "gemini-2.5-flash",
        0.5,
        8000,
        apiKey,
        fileSearchStores.length ? fileSearchStores : undefined,
        undefined,
      );
      const parsed = extractInterpretJson(interpretResult.text);
      return new Response(
        JSON.stringify({ batchSpecs: parsed.batchSpecs || [], usedStores: fileSearchStores }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (mode !== "render" && mode !== "unified") {
      const planResult = await generateWithRetry(
        "You are a senior performance ad creative director. Create concise planning notes only. Do not generate HTML.",
        buildPlanPrompt(campaignFacts, formatGroups, layoutSeed, retrievalHints, referenceGuide, campaignData.formatNotes, hasApprovedExamples),
        "gemini-3.5-flash",
        0.65,
        8000,
        apiKey,
        fileSearchStores.length ? fileSearchStores : undefined,
        undefined,
        { modelChain: PLAN_MODEL_CHAIN, thinkingLevel: "medium", responseMimeType: "application/json", responseSchema: CREATIVE_PLAN_JSON_SCHEMA },
      );
      creativePlan = planResult.text.trim().slice(0, 12000);
      if (planResult.groundingMetadata) groundingMetadata.push(planResult.groundingMetadata);
    }

    if (mode === "plan") {
      return new Response(
        JSON.stringify({
          creativePlan,
          formats,
          usedStores: fileSearchStores,
          groundingMetadata: groundingMetadata.length ? groundingMetadata : null,
          generationMode: "planned_only",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // creativePlan may be empty when using interpret+render flow; renderer falls back to campaign facts

    const isAbTest = Boolean(campaignData.abTestingEnabled) && (campaignData.abVariantCount ?? 2) > 1;
    const variantCount = isAbTest ? (campaignData.abVariantCount ?? 2) : 1;
    const abTestFocus = campaignData.abTestFocus || "mixed";
    const snippets: string[] = [];

    const renderGroups = [formats];
    const groupResults = await Promise.all(renderGroups.map(async (group, groupIndex) => {
      const groupFormatsList = buildFormatsList(group, campaignData.formatNotes);
      const totalBannersInGroup = group.length * variantCount;
      const groupCategory = mode === "render"
        ? `batch-${(payload.batchIndex ?? groupIndex) + 1}-of-${payload.totalBatches ?? renderGroups.length}`
        : "all-formats";

      const outputInstruction = isAbTest
        ? [
            "",
            `A/B TESTING — For EACH format in this group, produce ${variantCount} distinct variants.`,
            `Variation focus: ${abTestFocus} — ${getAbFocusDescription(abTestFocus)}`,
            "Variants of the same format must differ meaningfully in the focus area, not just minor tweaks.",
            "Variants of the same format must still share the same campaign system: logo treatment, CTA visual style, palette roles, product treatment, and general composition family. If focus is cta, change CTA text/urgency only; keep button style locked.",
            `Total output: ${totalBannersInGroup} banners (${group.length} format${group.length > 1 ? "s" : ""} × ${variantCount} variants).`,
            `Wrap EACH banner with: <!-- BANNER_START --> (complete banner HTML) <!-- BANNER_END -->`,
          ].join("\n")
        : [
            `Total output: ${group.length} banner${group.length > 1 ? "s" : ""} — one per format listed.`,
            `Wrap EACH banner with: <!-- BANNER_START --> (complete banner HTML) <!-- BANNER_END -->`,
          ].join("\n");

      const planSection = creativePlan;

      const groupMessage = [
        storeNotice,
        sourceOrchestration,
        "",
        referenceGuide || "REFERENCE STORE TASK - If a global ad reference store is attached, query it for structural patterns only (layout, CTA zone, spacing). Never copy colors, fonts, logos, or brand identity from reference ads.",
        "",
        cssVars ? `=== BRAND CSS TOKENS (inject as :root vars — use var(--primary) etc.) ===\n<style>:root{${cssVars}}</style>${fontUrl ? `\n@import: ${fontUrl}` : ""}` : "",
        "",
        "=== CAMPAIGN ===",
        campaignFacts,
        buildBrandConsistencyRules(campaignData),
        "",
        `=== CREATIVE PLAN — ${groupCategory.toUpperCase()} ===`,
        planSection,
        "",
        `=== FORMAT GROUP ${groupIndex + 1}/${renderGroups.length}: ${groupCategory} ===`,
        groupFormatsList,
        hasApprovedExamples ? "Approved examples were already analyzed in the creative plan. Use their winning principles as references, but do not copy their exact layout, dimensions, or element positions." : "",
        "MANDATORY COPY RULE: every banner must contain visible human-readable ad copy. Use campaign headline/value prop/offer to write a concise headline, plus the CTA text. Never return a banner with only shapes, logo, or image.",
        "MANDATORY LOGO RULE: if a logo URL exists in campaign facts, every banner must include at least one visible <img class=\"ad-logo\"> that uses the exact original logo URL with object-fit:contain. Reinterpreted logos are NOT logos. Similar marks, generated marks, recolored marks, redrawn symbols, monograms, or decorative logo-like shapes do not count. Never redraw, recolor, filter, mask, crop, replace, or invent a logo. If no logo URL exists, use brand name text only and never invent a fake mark.",
        "MANDATORY ASSET RULE: if PRODUCT or BACKGROUND asset URL exists in campaign facts, every banner must include at least one of those URLs in a visible <img>. Do not replace provided images with abstract blocks.",
        "MANDATORY CTA SIZE RULE: every CTA must be proportionate to the exact canvas. It must look clickable but never dominate the ad. Use compact padding, one-line text, and keep it inside the lower-third/action zone.",
        "SOCIAL MEDIA NO-BUTTON RULE: for Instagram, Facebook, TikTok, LinkedIn, social feed, square social, story, reels, and any social media placement, the CTA must NOT be a button/pill/rounded rectangle/bordered clickable block. Use CTA text integrated into the design as footer copy, underlined action text, caption line, swipe/DM cue, or sticker text without a button container. This overrides any generic CTA button guidance.",
        "VISUAL QUALITY GATE: before final output, verify the banner reads like a real paid ad: clear hook, strong focal image, visible CTA, readable hierarchy, enough contrast, no overlapping text, no empty center, no generic centered stack unless the format is too small.",
        "LAYOUT VARIETY GATE: for non-strip formats, choose one distinctive composition technique: diagonal split, product cutout, editorial poster, framed image panel, price/offer badge, asymmetrical text block, or full-bleed image overlay.",
        "Generate one banner per format listed above. Same campaign concept, but a distinct composition recipe for each exact size. Do not reuse the same logo/headline/product/CTA positions across ratios.",
        groupIndex > 0 ? `Vary the visual composition from earlier groups — different focal point, crop, panel shape, or layout rhythm.` : "",
        "CSS TEXT RULE: NEVER use text-overflow:ellipsis, -webkit-line-clamp, or overflow:hidden on any text element. All text must be fully visible. If copy is too long for the space, reduce font-size or shorten the copy — do not truncate.",
        ...buildFormatRules(group[0]),
        "COMPOSITION RULE: Follow the layout technique in the creative plan exactly — use the CSS property specified (clip-path, grid-template-areas, flexbox direction, etc.). Do not default to a centered stack.",
        outputInstruction,
      ].filter(Boolean).join("\n");

      // Scale max tokens: base per format × formats in group × variants
      const baseTokens = agentConfig.maxTokens ?? 16000;
      const effectiveMaxTokens = Math.min(baseTokens * group.length * variantCount, 52000);

      const result = await generateWithRetry(
        agentConfig.systemPrompt,
        groupMessage,
        agentConfig.model || "gemini-2.5-flash",
        agentConfig.temperature ?? 0.8,
        effectiveMaxTokens,
        apiKey,
        fileSearchStores.length ? fileSearchStores : undefined,
        referenceImages.length ? referenceImages : undefined,
        { modelChain: RENDER_MODEL_CHAIN },
      );

      const rawSnippets = enforceAllBannerDimensions(extractBannerSnippets(result.text), group);
      return {
        snippets: rawSnippets.map((s, i) => {
          const fmt = group[i] ?? group[0];
          return polishGeneratedBanner(s, campaignData, fmt, cssVars, fontUrl);
        }),
        groundingMetadata: result.groundingMetadata,
      };
    }));

    for (const result of groupResults) {
      snippets.push(...result.snippets);
      if (result.groundingMetadata) groundingMetadata.push(result.groundingMetadata);
    }

    if (!snippets.length) throw new Error("Agent returned no valid .ad-banner elements");

    const brandName = campaignData.brandName || campaignData.campaignName || "brand";
    const combinedHtml = `<!DOCTYPE html>\n<html><head><meta charset="UTF-8">\n<style>*{box-sizing:border-box}body{margin:0;padding:0}</style>\n</head><body>\n${snippets.join("\n")}\n</body></html>`;
    const finalHtml = injectAdSafetyCss(combinedHtml);

    if (!finalHtml.includes("ad-banner")) throw new Error("Agent returned invalid ad creative HTML");

    return new Response(
      JSON.stringify({
        html: finalHtml,
        snippets,
        assets: extractAssets(finalHtml),
        slug: `ad-${slugify(brandName)}`,
        creativeCount: snippets.length,
        formats,
        usedStores: fileSearchStores,
        groundingMetadata: groundingMetadata.length ? groundingMetadata : null,
        creativePlan,
        generationMode: mode === "render" ? "planned_batch_render" : "planned_per_format",
        batchIndex: payload.batchIndex ?? null,
        totalBatches: payload.totalBatches ?? null,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[agents-ads] error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
