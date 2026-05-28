import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type AdFormatInput = {
  platform?: string;
  format?: string;
  label?: string;
  width?: number;
  height?: number;
  enabled?: boolean;
};

type AdCreativePayload = {
  prompt?: string;
  businessName?: string;
  accountType?: "admin" | "testing";
  adData?: {
    brandName?: string;
    productName?: string;
    offer?: string;
    valueProposition?: string;
    ctaText?: string;
    targetAudience?: string;
    toneOfVoice?: string;
    urgencyLevel?: string;
    preferredStyle?: string;
    primaryColor?: string;
    secondaryColor?: string;
    accentColor?: string;
    textColor?: string;
    backgroundColor?: string;
    headingFont?: string;
    bodyFont?: string;
    logoUrl?: string;
    productImageUrl?: string;
    backgroundImageUrl?: string;
    logoVariants?: Array<{ id?: string; url?: string; label?: string; usageHint?: string }>;
    preferredLogoStrategy?: string;
    imageFallbackMode?: "auto" | "gemini" | "pexels" | "none";
    imageFallbackPrompt?: string;
    assetBaseUrl?: string;
    abTestingEnabled?: boolean;
    abVariantCount?: number;
    abTestFocus?: string;
    headlineVariants?: string[];
    ctaVariants?: string[];
    customHeadingFontName?: string;
    customBodyFontName?: string;
    productImageVariants?: string[];
    backgroundImageVariants?: string[];
    context?: string;
    campaignName?: string;
    campaignObjective?: string;
    funnelStage?: string;
    websiteUrl?: string;
    industry?: string;
    brandKeywords?: string;
    forbiddenWords?: string;
    mainHeadline?: string;
    subheadline?: string;
    useAiCopy?: boolean;
    pricing?: string;
    discount?: string;
    guarantee?: string;
    scarcity?: string;
    ageRange?: string;
    gender?: string;
    painPoints?: string;
    desires?: string;
    creativeStrategy?: string;
    creativeStrategyOther?: string;
    selectedFormats?: AdFormatInput[];
    formatNotes?: Record<string, string>;
  };
};

const env = (globalThis as any).Deno?.env;
const MODEL_CHAIN = ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.5-flash-lite"];
const GEMINI_IMAGE_MODEL_CHAIN = ["gemini-2.5-flash-image"];

function isRetiredGeminiImageModel(model: string): boolean {
  return /^gemini-2\.0-.*image/i.test(model) || /^gemini-2\.5-.*image-preview$/i.test(model);
}

const PEXELS_STOP_WORDS = new Set([
  "a", "an", "and", "the", "for", "with", "without", "from", "into", "onto", "over", "under", "of", "to", "in", "on", "at", "by",
  "ad", "ads", "creative", "banner", "image", "photo", "background", "professional", "high", "quality", "modern", "business",
]);

const PT_EN_HINTS: Record<string, string> = {
  "barbearia": "barbershop",
  "barbeiro": "barber",
  "salao": "salon",
  "salão": "salon",
  "advocacia": "law firm",
  "clinica": "clinic",
  "clínica": "clinic",
  "restaurante": "restaurant",
  "academia": "gym fitness",
  "imobiliaria": "real estate",
  "imobiliária": "real estate",
  "construcao": "construction",
  "construção": "construction",
  "beleza": "beauty",
  "saude": "healthcare",
  "saúde": "healthcare",
  "moda": "fashion",
  "joias": "jewelry",
  "odontologia": "dentistry clinic",
};

function normalizeAccountType(value: unknown) {
  return value === "admin" ? "admin" : "testing";
}

function parseGeminiModelList(raw: string | undefined | null) {
  if (!raw) return [];
  return raw.split(",").map((value) => value.trim()).filter((model) => model.startsWith("gemini-"));
}

function unique(values: string[]) {
  return values.filter((value, index, array) => value && array.indexOf(value) === index);
}

function tokenizeForPexels(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !PEXELS_STOP_WORDS.has(token));
}

function expandQueryForPexels(query: string) {
  const lower = query.toLowerCase();
  const translatedTerms = Object.entries(PT_EN_HINTS)
    .filter(([pt]) => lower.includes(pt))
    .map(([, en]) => en);
  return unique([...translatedTerms, query.trim().replace(/\s+/g, " ")]).join(" ").trim();
}

function relevanceScore(query: string, photo: any) {
  const queryTokens = unique(tokenizeForPexels(query)).slice(0, 7);
  if (!queryTokens.length) return 0;

  const source = [photo?.alt, photo?.photographer, photo?.url]
    .filter((part) => typeof part === "string" && part)
    .join(" ")
    .toLowerCase();

  let matched = 0;
  for (const token of queryTokens) {
    if (source.includes(token)) matched += 1;
  }

  if ((query.includes("barbearia") || query.includes("barbeiro")) && /(barbecue|grill|sausages|chicken)/i.test(source)) {
    matched -= 1;
  }

  return Math.max(0, matched) / Math.max(1, queryTokens.length);
}

function buildFallbackImagePrompt(data: AdCreativePayload["adData"] = {}, slot: "product" | "background") {
  const explicit = String(data.imageFallbackPrompt || "").trim();
  if (explicit) return explicit;

  const parts = [
    data.brandName,
    data.productName,
    data.industry,
    data.valueProposition,
    data.targetAudience,
    data.preferredStyle,
    slot === "product" ? "commercial product advertising image" : "paid social ad lifestyle background",
  ].filter(Boolean);

  return `${parts.join(", ")}, premium campaign visual, no text, no logo, clean composition`;
}

function buildPollinationsUrl(prompt: string, slot: "product" | "background") {
  const size = slot === "product" ? "width=1024&height=1024" : "width=1792&height=1024";
  const seed = Math.floor(Math.random() * 999999999);
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(`${prompt}, high quality ad photography, no text, no watermark`)}?${size}&seed=${seed}&model=flux&nologo=true`;
}

async function searchPexelsImage(query: string, slot: "product" | "background") {
  const apiKey = env?.get("PEXELS_API_KEY");
  if (!apiKey) return null;

  const orientation = slot === "product" ? "square" : "landscape";
  const variants = unique([
    expandQueryForPexels(query),
    tokenizeForPexels(expandQueryForPexels(query)).slice(0, 7).join(" "),
    `${tokenizeForPexels(expandQueryForPexels(query)).slice(0, 5).join(" ")} commercial photography`,
  ].filter(Boolean));

  let best: { photo: any; relevance: number; quality: number } | null = null;
  for (const variant of variants.slice(0, 4)) {
    const response = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(variant)}&per_page=18&orientation=${orientation}`, {
      headers: { Authorization: apiKey },
    });
    if (!response.ok) continue;

    const data = await response.json();
    const photos = Array.isArray(data.photos) ? data.photos : [];
    for (const photo of photos) {
      const width = Number(photo?.width || 0);
      const height = Number(photo?.height || 0);
      const area = width * height;
      const aspect = height > 0 ? width / height : 0;
      const fit = slot === "product"
        ? (aspect > 0.75 && aspect < 1.35 ? 1 : 0)
        : (aspect > 1.35 && aspect < 2.2 ? 1 : 0);
      const candidate = { photo, relevance: relevanceScore(variant, photo), quality: area + fit * 10_000_000 };
      if (!best || candidate.relevance > best.relevance || (candidate.relevance === best.relevance && candidate.quality > best.quality)) {
        best = candidate;
      }
    }
    if (best && best.relevance >= 0.25) break;
  }

  return best?.photo?.src?.large2x || best?.photo?.src?.large || best?.photo?.src?.original || null;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function extractGeminiImageDataUrl(payload: any) {
  const parts = payload?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return null;
  const imagePart = parts.find((part: any) => typeof part?.inlineData?.data === "string" && String(part?.inlineData?.mimeType || "").startsWith("image/"));
  return imagePart ? `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}` : null;
}

async function generateGeminiFallbackImage(prompt: string, accountType: unknown) {
  let keys: string[] = [];
  try {
    keys = getGeminiApiKeysForAccountType(accountType);
  } catch {
    return null;
  }
  const models = unique([
    ...parseGeminiModelList(env?.get("GEMINI_IMAGE_MODELS") || env?.get("GEMINI_IMAGE_MODEL")),
    ...GEMINI_IMAGE_MODEL_CHAIN,
  ]).filter((model) => !isRetiredGeminiImageModel(model)).slice(0, 4);

  for (const key of keys) {
    for (const model of models) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 22000);
      try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseModalities: ["TEXT", "IMAGE"], temperature: 0.25 },
          }),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        if (!response.ok) continue;
        const imageUrl = extractGeminiImageDataUrl(await response.json());
        if (imageUrl) return imageUrl;
      } catch {
        clearTimeout(timeoutId);
      }
    }
  }
  return null;
}

async function resolveMissingAdImages(payload: AdCreativePayload) {
  const data = payload.adData || {};
  return {
    productImageUrl: String(data.productImageUrl || "").trim(),
    backgroundImageUrl: String(data.backgroundImageUrl || "").trim(),
    sources: [] as string[],
  };
}

function getAdGenerationModels(accountType: unknown) {
  const normalized = normalizeAccountType(accountType);
  const envList = normalized === "admin"
    ? parseGeminiModelList(env?.get("GEMINI_AD_MODELS") || env?.get("GEMINI_SITE_MODELS"))
    : parseGeminiModelList(env?.get("GEMINI_AD_MODELS_TESTING") || env?.get("GEMINI_SITE_MODELS_TESTING"));
  return unique([...envList, ...MODEL_CHAIN]);
}

function getGeminiApiKeysForAccountType(accountType: unknown) {
  const productionKey = env?.get("GEMINI_API_KEY_PRODUCTION") || env?.get("GEMINI_API_KEY");
  const testingKey = env?.get("GEMINI_API_KEY_TESTING");

  if (normalizeAccountType(accountType) === "admin") {
    const keys = [productionKey, testingKey].filter((key): key is string => Boolean(key));
    if (!keys.length) throw new Error("GEMINI_API_KEY_PRODUCTION/GEMINI_API_KEY_TESTING are not configured");
    return keys;
  }

  const keys = [testingKey, productionKey].filter((key): key is string => Boolean(key));
  if (!keys.length) throw new Error("GEMINI_API_KEY_TESTING/GEMINI_API_KEY_PRODUCTION are not configured");
  return keys;
}

function stripCodeFences(content: string) {
  let cleaned = content.trim();
  if (cleaned.startsWith("```html")) cleaned = cleaned.slice(7);
  else if (cleaned.startsWith("```")) cleaned = cleaned.slice(3);
  if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3);
  return cleaned.trim();
}

function extractModelText(payload: any) {
  return payload?.candidates?.[0]?.content?.parts
    ?.filter((part: any) => part?.text && !part?.thought)
    .map((part: any) => part.text)
    .join("\n")
    .trim() || "";
}

function parseHtmlResponse(raw: string) {
  try {
    const payload = JSON.parse(raw);
    const text = extractModelText(payload);
    if (text) return stripCodeFences(text);
  } catch {
    // Raw HTML fallback below.
  }
  return stripCodeFences(raw);
}

function slugify(value: string) {
  return (value || "ad-creatives")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "ad-creatives";
}


function getEnabledFormats(payload: AdCreativePayload): Required<Pick<AdFormatInput, "platform" | "format" | "label" | "width" | "height">>[] {
  return (payload.adData?.selectedFormats || [])
    .filter((format) => format?.enabled !== false && Number(format?.width) > 0 && Number(format?.height) > 0)
    .map((format) => ({
      platform: String(format.platform || "unknown"),
      format: String(format.format || "custom"),
      label: String(format.label || `${format.width}x${format.height}`),
      width: Number(format.width),
      height: Number(format.height),
    }));
}

function extractAssets(html: string) {
  const found = new Set<string>();
  const patterns = [
    /\bsrc=["'](https?:\/\/[^"']+)["']/gi,
    /\bposter=["'](https?:\/\/[^"']+)["']/gi,
    /url\((["']?)(https?:\/\/[^"')]+)\1\)/gi,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(html)) !== null) {
      found.add(match[2] || match[1]);
    }
  }
  return Array.from(found).filter(Boolean);
}



function injectAdSafetyCss(html: string) {
  // Non-invasive safety CSS — does NOT force flex-direction or alignment on .ad-banner
  // so each format can implement its own layout (row for leaderboards, column for others)
  const safetyCss = `<style data-cf-ad-safety>
    *{box-sizing:border-box}
    .ad-banner{position:relative!important;overflow:hidden!important;isolation:isolate!important}
    .ad-banner .ad-bg{position:absolute!important;inset:0!important;width:100%!important;height:100%!important;background-size:cover!important;background-position:center!important;z-index:0!important}
    .ad-banner > :not(.ad-bg){z-index:1}
    .ad-banner img.ad-logo{object-fit:contain!important;max-width:min(24%,140px)!important;max-height:min(14%,76px)!important;width:auto;height:auto;flex-shrink:0!important}
    .ad-banner img.ad-media,.ad-banner img.ad-product{object-fit:contain!important;max-width:68%!important;max-height:72%!important}
    .ad-banner .ad-headline{font-weight:800!important;line-height:1.1!important;letter-spacing:-0.02em!important;text-wrap:balance}
    .ad-banner .ad-subheadline{font-weight:500!important;line-height:1.3!important}
    .ad-banner .ad-cta{display:inline-flex!important;align-items:center!important;justify-content:center!important;white-space:nowrap!important;flex-shrink:0!important;cursor:pointer!important;min-height:34px!important;border-radius:9999px!important;font-weight:800!important;text-transform:uppercase!important;letter-spacing:.04em!important;box-shadow:0 6px 22px rgba(0,0,0,.34)!important}
    .ad-banner h1,.ad-banner h2,.ad-banner h3{overflow-wrap:break-word;word-break:break-word}
    .ad-banner p{overflow-wrap:break-word;word-break:break-word}
  </style>`;

  if (html.includes("data-cf-ad-safety")) return html;
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${safetyCss}</head>`);
  return html.replace(/<body/i, `${safetyCss}<body`);
}


type FormatCategory = "leaderboard" | "landscape" | "square" | "portrait" | "story";

type BannerAssetPlan = {
  fmt: Required<Pick<AdFormatInput, "platform" | "format" | "label" | "width" | "height">>;
  category: FormatCategory;
  variantLabel?: string;
  logoUrl: string;
  productUrl: string;
  bgUrl: string;
};

type BannerTaskSpec = {
  bannerId: string;
  assetPlan: BannerAssetPlan;
  density: string;
  seedArchetype: string;
  formatNote: string;
  variantImageOverrides: { productUrl?: string; bgUrl?: string };
};

type CreativePlan = {
  concept: string;
  headline: string;
  subheadline: string;
  cta: string;
  layoutInstruction: string;
  visualHierarchy: string;
  backgroundTreatment: string;
  productTreatment: string;
  imageRole: string;
  textSafeZone: string;
  productCropStrategy: string;
  backgroundOverlayStrategy: string;
  visualFocalPoint: string;
  readabilityPlan: string;
  layoutRisk: string;
  logoTreatment: string;
  colorTreatment: string;
  typographyTreatment: string;
  abHypothesis: string;
  assetUsage: {
    logo: string;
    product: string;
    background: string;
  };
  complianceNotes: string[];
};

function categorizeFormat(fmt: { width: number; height: number }): FormatCategory {
  const ratio = fmt.width / fmt.height;
  if (ratio >= 3.0) return "leaderboard";
  if (ratio >= 1.4) return "landscape";
  if (ratio >= 0.85) return "square";
  if (fmt.height / fmt.width >= 1.7) return "story";
  return "portrait";
}

function stripJsonFences(value: string) {
  let cleaned = String(value || "").trim();
  if (cleaned.startsWith("```json")) cleaned = cleaned.slice(7);
  else if (cleaned.startsWith("```")) cleaned = cleaned.slice(3);
  if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3);
  return cleaned.trim();
}

function parseJsonResponse(raw: string) {
  const parsedText = parseHtmlResponse(raw);
  const cleaned = stripJsonFences(parsedText);
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Gemini did not return JSON");
    return JSON.parse(match[0]);
  }
}

function normalizeCreativePlan(value: any): CreativePlan | null {
  if (!value || typeof value !== "object") return null;
  const plan = {
    concept: String(value.concept || "").trim(),
    headline: String(value.headline || "").trim(),
    subheadline: String(value.subheadline || "").trim(),
    cta: String(value.cta || "").trim(),
    layoutInstruction: String(value.layoutInstruction || "").trim(),
    visualHierarchy: String(value.visualHierarchy || "").trim(),
    backgroundTreatment: String(value.backgroundTreatment || "").trim(),
    productTreatment: String(value.productTreatment || "").trim(),
    imageRole: String(value.imageRole || "").trim(),
    textSafeZone: String(value.textSafeZone || "").trim(),
    productCropStrategy: String(value.productCropStrategy || "").trim(),
    backgroundOverlayStrategy: String(value.backgroundOverlayStrategy || "").trim(),
    visualFocalPoint: String(value.visualFocalPoint || "").trim(),
    readabilityPlan: String(value.readabilityPlan || "").trim(),
    layoutRisk: String(value.layoutRisk || "").trim(),
    logoTreatment: String(value.logoTreatment || "").trim(),
    colorTreatment: String(value.colorTreatment || "").trim(),
    typographyTreatment: String(value.typographyTreatment || "").trim(),
    abHypothesis: String(value.abHypothesis || "").trim(),
    assetUsage: {
      logo: String(value.assetUsage?.logo || "").trim(),
      product: String(value.assetUsage?.product || "").trim(),
      background: String(value.assetUsage?.background || "").trim(),
    },
    complianceNotes: Array.isArray(value.complianceNotes)
      ? value.complianceNotes.map((note: unknown) => String(note || "").trim()).filter(Boolean).slice(0, 8)
      : [],
  };

  return plan.concept || plan.layoutInstruction || plan.headline ? plan : null;
}

function creativePlanToPrompt(plan?: CreativePlan | null) {
  if (!plan) return "";
  return `LOCKED CREATIVE PLAN - FOLLOW THIS EXACTLY
Concept: ${plan.concept}
Headline: ${plan.headline}
Subheadline: ${plan.subheadline}
CTA: ${plan.cta}
Layout: ${plan.layoutInstruction}
Visual hierarchy: ${plan.visualHierarchy}
Background treatment: ${plan.backgroundTreatment}
Product treatment: ${plan.productTreatment}
Image role: ${plan.imageRole}
Text safe zone: ${plan.textSafeZone}
Product crop strategy: ${plan.productCropStrategy}
Background overlay strategy: ${plan.backgroundOverlayStrategy}
Visual focal point: ${plan.visualFocalPoint}
Readability plan: ${plan.readabilityPlan}
Layout risk: ${plan.layoutRisk}
Logo treatment: ${plan.logoTreatment}
Color treatment: ${plan.colorTreatment}
Typography: ${plan.typographyTreatment}
A/B hypothesis: ${plan.abHypothesis}
Asset usage - Logo: ${plan.assetUsage.logo}
Asset usage - Product: ${plan.assetUsage.product}
Asset usage - Background: ${plan.assetUsage.background}
Compliance notes: ${plan.complianceNotes.join(" | ")}`;
}

function appendStyleDeclaration(existing: string, addition: string) {
  const current = String(existing || "").trim().replace(/;+\s*$/g, "");
  const next = String(addition || "").trim().replace(/^;+\s*/g, "").replace(/;+\s*$/g, "");
  return [current, next].filter(Boolean).join("; ");
}

function upsertInlineStyleForClass(html: string, className: string, style: string) {
  const escapedClass = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tagPattern = new RegExp(`<([a-z][\\w:-]*)([^>]*\\bclass=["'][^"']*\\b${escapedClass}\\b[^"']*["'][^>]*)>`, "i");

  return html.replace(tagPattern, (full, tagName, attrs) => {
    if (/\sstyle=["'][^"']*["']/i.test(attrs)) {
      const updatedAttrs = attrs.replace(/\sstyle=(["'])([^"']*)\1/i, (_styleMatch: string, quote: string, existing: string) => {
        return ` style=${quote}${appendStyleDeclaration(existing, style)}${quote}`;
      });
      return `<${tagName}${updatedAttrs}>`;
    }

    return `<${tagName}${attrs} style="${style}">`;
  });
}

function stripInlineFlowFromAdBanner(html: string) {
  const bannerStyle = getInlineStyleForClass(html, "ad-banner");
  if (!bannerStyle) return html;

  const cleaned = bannerStyle
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part && !/^(display|flex-direction|align-items|justify-content|gap)\s*:/i.test(part))
    .join("; ");

  return html.replace(
    /(<[a-z][\w:-]*[^>]*\bclass=["'][^"']*\bad-banner\b[^"']*["'][^>]*\sstyle=)(["'])([^"']*)(\2)/i,
    (_match, prefix, quote, _existing, suffix) => `${prefix}${quote}${cleaned}${suffix}`,
  );
}

function getNonOverlappingLayoutStyles(plan: BannerAssetPlan) {
  const { width, height } = plan.fmt;
  const category = plan.category;
  const shortSide = Math.min(width, height);
  const headlineSize = Math.round(Math.max(
    category === "leaderboard" ? 18 : 26,
    Math.min(category === "story" ? 64 : 50, Math.round(shortSide * (category === "leaderboard" ? 0.18 : 0.081))),
  ) * 0.92);
  const subSize = Math.max(13, Math.min(23, Math.round(shortSide * 0.04)));
  const ctaMinH = Math.max(34, Math.round(height * (category === "leaderboard" ? 0.42 : 0.062)));

  if (category === "leaderboard") {
    return {
      logo: `left:4%!important; top:50%!important; transform:translateY(-50%)!important; max-width:16%!important; max-height:${Math.round(height * 0.62)}px!important;`,
      headline: `left:22%!important; top:50%!important; transform:translateY(-50%)!important; width:42%!important; max-width:42%!important; height:${Math.round(height * 0.72)}px!important; font-size:${headlineSize}px!important; white-space:nowrap!important; text-overflow:ellipsis!important;`,
      subheadline: `display:none!important;`,
      cta: `right:4%!important; top:50%!important; transform:translateY(-50%)!important; width:auto!important; max-width:25%!important; min-height:${ctaMinH}px!important;`,
      product: `left:66%!important; top:50%!important; transform:translateY(-50%)!important; width:10%!important; max-width:10%!important; max-height:${Math.round(height * 0.78)}px!important; opacity:.9!important;`,
    };
  }

  if (category === "story") {
    return {
      logo: `left:6%!important; top:5%!important; max-width:28%!important; max-height:8%!important;`,
      headline: `left:7%!important; top:auto!important; bottom:20%!important; width:86%!important; max-width:86%!important; height:16%!important; font-size:${headlineSize}px!important;`,
      subheadline: `display:none!important;`,
      cta: `left:7%!important; top:auto!important; bottom:8%!important; max-width:70%!important; min-height:${ctaMinH}px!important;`,
      product: `right:4%!important; top:16%!important; left:auto!important; width:52%!important; max-width:52%!important; max-height:46%!important;`,
    };
  }

  if (category === "landscape") {
    return {
      logo: `left:5%!important; top:7%!important; max-width:16%!important; max-height:13%!important;`,
      headline: `left:6%!important; top:28%!important; width:48%!important; max-width:48%!important; height:24%!important; font-size:${headlineSize}px!important;`,
      subheadline: `left:6%!important; top:55%!important; width:44%!important; max-width:44%!important; height:16%!important; font-size:${subSize}px!important;`,
      cta: `left:6%!important; top:auto!important; bottom:9%!important; max-width:35%!important; min-height:${ctaMinH}px!important;`,
      product: `right:5%!important; left:auto!important; top:12%!important; width:38%!important; max-width:38%!important; max-height:78%!important;`,
    };
  }

  if (category === "portrait") {
    return {
      logo: `left:6%!important; top:5%!important; max-width:25%!important; max-height:9%!important;`,
      headline: `left:7%!important; top:auto!important; bottom:28%!important; width:86%!important; max-width:86%!important; height:18%!important; font-size:${headlineSize}px!important;`,
      subheadline: `left:7%!important; top:auto!important; bottom:18%!important; width:80%!important; max-width:80%!important; height:8%!important; font-size:${subSize}px!important;`,
      cta: `left:7%!important; top:auto!important; bottom:8%!important; max-width:70%!important; min-height:${ctaMinH}px!important;`,
      product: `right:4%!important; left:auto!important; top:14%!important; width:58%!important; max-width:58%!important; max-height:38%!important;`,
    };
  }

  return {
    logo: `left:6%!important; top:5%!important; max-width:22%!important; max-height:10%!important;`,
    headline: `left:7%!important; top:12%!important; width:86%!important; max-width:86%!important; height:18%!important; font-size:${headlineSize}px!important; text-align:center!important;`,
    subheadline: `left:10%!important; top:31%!important; width:80%!important; max-width:80%!important; height:10%!important; font-size:${subSize}px!important; text-align:center!important;`,
    cta: `left:50%!important; top:auto!important; bottom:8%!important; transform:translateX(-50%)!important; max-width:72%!important; min-height:${ctaMinH}px!important;`,
    product: `left:50%!important; top:43%!important; transform:translateX(-50%)!important; width:54%!important; max-width:54%!important; max-height:34%!important;`,
  };
}

function enforceBannerAssets(html: string, plan: BannerAssetPlan) {
  if (!/\bclass=["'][^"']*\bad-banner\b/i.test(html)) return html;

  const { width, height } = plan.fmt;
  const category = plan.category;
  const logoMaxW = category === "leaderboard" ? 120 : Math.round(width * (category === "story" ? 0.28 : 0.22));
  const logoMaxH = category === "leaderboard" ? Math.round(height * 0.56) : Math.round(height * (category === "story" ? 0.08 : 0.12));
  let output = stripInlineFlowFromAdBanner(html);

  output = upsertInlineStyleForClass(
    output,
    "ad-banner",
    `width:${width}px; height:${height}px; position:relative; overflow:hidden; box-sizing:border-box; isolation:isolate`,
  );

  output = upsertInlineStyleForClass(
    output,
    "ad-bg",
    "position:absolute!important; inset:0!important; width:100%!important; height:100%!important; z-index:0; background-size:cover; background-position:center",
  );

  // Only protection enforced: logo must not be clipped — position and layout are AI's choice
  output = upsertInlineStyleForClass(
    output,
    "ad-logo",
    `object-fit:contain!important; max-width:${Math.max(56, logoMaxW)}px!important; max-height:${Math.max(28, logoMaxH)}px!important; width:auto!important; height:auto!important;`,
  );

  return output;
}

function htmlContainsAssetUrl(html: string, url: string) {
  if (!url) return true;
  const normalized = String(url).trim();
  if (!normalized) return true;
  return html.includes(normalized)
    || html.includes(normalized.replace(/&/g, "&amp;"))
    || html.includes(encodeURI(normalized));
}

function missingRequiredAssetUrls(html: string, plan: BannerAssetPlan) {
  return [
    ["logo", plan.logoUrl],
    ["product", plan.productUrl],
    ["background", plan.bgUrl],
  ]
    .filter(([, url]) => String(url || "").trim())
    .filter(([, url]) => !htmlContainsAssetUrl(html, String(url)))
    .map(([slot, url]) => ({ slot, url: String(url) }));
}

function getInlineStyleForClass(html: string, className: string) {
  const escapedClass = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const classBeforeStyle = new RegExp(`<[^>]+class=["'][^"']*\\b${escapedClass}\\b[^"']*["'][^>]*\\sstyle=["']([^"']*)["']`, "i");
  const styleBeforeClass = new RegExp(`<[^>]+\\sstyle=["']([^"']*)["'][^>]*class=["'][^"']*\\b${escapedClass}\\b[^"']*["']`, "i");
  return html.match(classBeforeStyle)?.[1] || html.match(styleBeforeClass)?.[1] || "";
}

function inlineStyleHasAbsolutePosition(style: string) {
  return /(^|;)\s*position\s*:\s*absolute\s*(;|$)/i.test(style || "");
}

function inlineStyleHasCoordinates(style: string) {
  const hasX = /(^|;)\s*(left|right)\s*:/i.test(style || "");
  const hasY = /(^|;)\s*(top|bottom)\s*:/i.test(style || "");
  return hasX && hasY;
}

function rootAdBannerStyle(html: string) {
  return getInlineStyleForClass(html, "ad-banner");
}

function missingAbsoluteLayerRequirements(html: string, plan: BannerAssetPlan) {
  const missing: string[] = [];
  const rootStyle = rootAdBannerStyle(html);

  if (!/(^|;)\s*position\s*:\s*relative\s*(;|$)/i.test(rootStyle)) {
    missing.push(".ad-banner must use position:relative");
  }
  if (/(^|;)\s*display\s*:\s*(flex|grid|inline-flex|inline-grid)\s*(;|$)/i.test(rootStyle)) {
    missing.push(".ad-banner root must not use flex/grid for primary layout");
  }

  const requiredClasses = [
    "ad-bg",
    "ad-cta",
    plan.logoUrl ? "ad-logo" : "",
    plan.productUrl ? "ad-media" : "",
  ].filter(Boolean);

  for (const className of requiredClasses) {
    const style = getInlineStyleForClass(html, className);
    if (!style || !inlineStyleHasAbsolutePosition(style)) {
      missing.push(`.${className} must be an absolute-positioned layer`);
    } else if (className !== "ad-bg" && !inlineStyleHasCoordinates(style)) {
      missing.push(`.${className} must define both horizontal and vertical coordinates`);
    }
  }

  return missing;
}

function resolveAssetUrlForFetch(url: string, baseUrl?: string) {
  const trimmed = String(url || "").trim();
  if (!trimmed || /^data:/i.test(trimmed) || /^https?:\/\//i.test(trimmed)) return trimmed;
  if (!trimmed.startsWith("/")) return trimmed;

  const base = String(baseUrl || env?.get("PUBLIC_SITE_URL") || env?.get("SITE_URL") || "").trim().replace(/\/+$/, "");
  return base ? `${base}${trimmed}` : trimmed;
}

function assetNameFromUrl(url: string) {
  try {
    const clean = String(url || "").split("?")[0].split("#")[0];
    return decodeURIComponent(clean.split("/").filter(Boolean).pop() || "image");
  } catch {
    return "image";
  }
}

async function imageUrlToGeminiPart(url: string, label: string, baseUrl?: string) {
  const trimmed = String(url || "").trim();
  if (!trimmed) return null;
  const fetchUrl = resolveAssetUrlForFetch(trimmed, baseUrl);
  const fileName = assetNameFromUrl(trimmed);

  try {
    if (trimmed.startsWith("data:image/")) {
      const match = trimmed.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) return null;
      return {
        textPart: { text: `${label} image attached as inline data. Asset name/context: ${fileName}. Required source URL/data URI starts with: ${trimmed.slice(0, 80)}` },
        imagePart: { inlineData: { mimeType: match[1], data: match[2] } },
      };
    }

    if (!/^https?:\/\//i.test(fetchUrl)) return null;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(fetchUrl, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!response.ok) return null;

    const contentType = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!contentType.startsWith("image/")) return null;

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length || bytes.byteLength > 4_500_000) return null;

    return {
      textPart: { text: `${label} image attached. Asset name/context: ${fileName}. Required URL in final HTML: ${trimmed}. Fetch URL used for visual understanding: ${fetchUrl}` },
      imagePart: { inlineData: { mimeType: contentType, data: bytesToBase64(bytes) } },
    };
  } catch {
    return null;
  }
}

async function buildImagePartsForPlan(assetPlan: BannerAssetPlan, baseUrl?: string) {
  const entries = [
    [`Logo (${assetPlan.variantLabel || "main"})`, assetPlan.logoUrl],
    [`Product/Hero (${assetPlan.variantLabel || "main"})`, assetPlan.productUrl],
    [`Background (${assetPlan.variantLabel || "main"})`, assetPlan.bgUrl],
  ] as const;

  const resolved = await Promise.all(entries.map(([label, url]) => imageUrlToGeminiPart(url, label, baseUrl)));
  return resolved.flatMap((item) => item ? [item.textPart, item.imagePart] : []);
}

const FORMAT_ARCHETYPES: Record<FormatCategory, string[]> = {
  leaderboard: [
    "MINIMAL-ROW: logo left (max 120px wide) | bold headline center (single line, max 5 words) | accent-color pill CTA right. Solid or subtle gradient background.",
    "ACCENT-BAR: primary-color vertical bar 40px on far left | logo + headline in center area | CTA button far right. Clean light or dark background.",
    "FULL-STRIP: logo small top-left corner | oversized bold headline dominates center | CTA right edge with high-contrast button.",
  ],
  landscape: [
    "SPLIT-CANVAS: left 55% product/lifestyle image with hard vertical edge | right 45% solid primary color block with white headline + subheadline stacked + CTA button bottom-right.",
    "FULL-BLEED-OVERLAY: image fills 100% of banner | left-to-right dark gradient overlay (left 70% opaque → right 20%) | text left-aligned on left side | CTA bottom-left.",
    "EDITORIAL-BAND: top 50% lifestyle image | bottom 50% solid brand color band | headline and CTA side by side in bottom band.",
    "PRODUCT-HERO: product image left 40% on clean/white background | bold typographic headline right 60% | accent color tagline below headline | CTA bottom-right.",
  ],
  square: [
    "CENTERED-SHOWCASE: layered gradient background | product image centered 50% of frame | headline top 20% | CTA button bottom 15%.",
    "EDITORIAL-SPLIT: left 50% solid primary color with large white headline + CTA stacked vertically | right 50% product or lifestyle image with no text.",
    "TYPE-FORWARD: bold ultra-large headline (40px+) occupies 55% of frame as visual anchor | brand color background | logo top-left corner | CTA bottom.",
    "OFFER-BADGE: product image top 60% with subtle gradient vignette | solid accent color band bottom 40% with discount callout badge + headline + CTA.",
    "DARK-LUXURY: near-black or deep brand color background | product centered with light/glow effect | minimal white headline bottom-center | small logo top-right.",
  ],
  portrait: [
    "VERTICAL-STACK: full-width product image top 58% with no overlay | solid primary color panel bottom 42% | headline + subheadline + CTA stacked in panel.",
    "LIFESTYLE-TOP: lifestyle/product photo top 60% with subtle dark bottom gradient | text + CTA in solid-color bottom panel.",
    "GRADIENT-SPLIT: bold diagonal gradient background (primary → secondary) | logo top-right | large headline left-center | subheadline below | CTA bottom-left.",
    "DARK-EDITORIAL: near-black background | product image with high contrast and rim light effect | bold white headline bottom two-thirds | minimal subtle CTA.",
    "OFFER-FOCUSED: large discount badge or benefit callout centered as hero element | primary color stripe top 15% with logo | secondary color stripe bottom 15% with CTA.",
  ],
  story: [
    "CINEMATIC: full-bleed dramatic image | thin logo centered 8% from top | bold white headline 32px+ centered in lower third | solid accent-color CTA button 12% above bottom edge.",
    "LIFESTYLE-IMMERSIVE: full-bleed bright lifestyle photo | dark gradient overlay bottom 35% | white headline + CTA inside gradient zone — no text outside safe zone.",
    "UGC-STYLE: product image centered 70% of height | plain brand color top and bottom strips | caption-style headline in bottom strip | minimal CTA.",
    "BOLD-TEXT: solid bold brand color fills 100% | oversized headline 48px+ takes 60% of frame | product image as secondary accent (smaller, corner or side) | CTA at bottom.",
  ],
};

const CONTENT_DENSITY: Record<FormatCategory, string> = {
  leaderboard: "Headline: max 4 words, SINGLE LINE, no line breaks. No subheadline. CTA button: max 2 words. Logo: max 120px wide, 40px tall. If text risks overflow, REDUCE font-size to fit in one line.",
  landscape:   "Headline: max 6 words, 1-2 lines. Subheadline: max 10 words. CTA: max 3 words. Adjust font-size down if needed so ALL text is fully visible — never let content be clipped.",
  square:      "Headline: max 8 words. Subheadline: max 12 words (optional). CTA: max 3 words. Adjust font-size down if needed so ALL text is fully visible — never let content be clipped.",
  portrait:    "Headline: max 9 words, 2-3 lines. Subheadline: max 14 words. CTA: max 4 words. Adjust font-size down if needed so ALL text is fully visible — never let content be clipped.",
  story:       "Headline: max 5 words, 30px+ font size. NO subheadline. CTA: max 3 words. All text ONLY in bottom 35% safe zone. Adjust font-size down if needed so ALL text is fully visible — never let content be clipped.",
};

function pickArchetype(category: FormatCategory): string {
  const opts = FORMAT_ARCHETYPES[category];
  return opts[Math.floor(Math.random() * opts.length)];
}

function buildBannerSystemPrompt(
  fmt: { platform: string; format: string; label: string; width: number; height: number },
  category: FormatCategory,
  archetype: string,
  density: string,
  bannerId: string,
  variantLabel?: string
): string {
  const leaderboardRules = `• The .ad-banner MUST use display:flex; flex-direction:row; align-items:center on its outer div
• Content flows LEFT→RIGHT in ONE horizontal line: [logo][headline][cta]
• Height is only ${fmt.height}px — NOTHING overflows vertically
• Logo: max-height:${Math.round(fmt.height * 0.6)}px
• No stacking, no background image (too small)`;

  const storyRules = `• Full-bleed background fills all ${fmt.width}×${fmt.height}px
• Text ONLY in bottom 35% safe zone (below y=${Math.round(fmt.height * 0.65)}px)
• Headline: 32px minimum font size
• Logo near top (within top 10%)
• Safe zones: top 8%, bottom 8%, left/right 5%`;

  const defaultRules = `• The .ad-banner MUST use display:flex; flex-direction:column on its outer div
• Banner fills exactly ${fmt.width}×${fmt.height}px — respect proportions
• Follow the LAYOUT BLUEPRINT composition above precisely
• Safe zones: 6% padding all sides minimum`;

  const absoluteLeaderboardRules = `- Use absolute left-to-right layer placement: logo around left:4%, headline around left:22%, CTA around right:4%.
- Height is only ${fmt.height}px; nothing overflows vertically.
- Logo layer: position:absolute; top:50%; transform:translateY(-50%); max-width:120px; max-height:${Math.round(fmt.height * 0.6)}px.
- Headline layer: position:absolute; top:50%; transform:translateY(-50%); left:22%; width:44%; single line.
- CTA layer: position:absolute; top:50%; transform:translateY(-50%); right:4%; min-height:${Math.max(34, Math.round(fmt.height * 0.42))}px.
- Product image may be omitted or used as a subtle absolute side accent only if it does not compete with text.`;

  const absoluteStoryRules = `- Full-bleed background fills all ${fmt.width}x${fmt.height}px.
- Text only in bottom 35% safe zone, below y=${Math.round(fmt.height * 0.65)}px.
- Headline layer: position:absolute; left:7%; bottom:18%; width:86%; font-size 32px minimum.
- CTA layer: position:absolute; left:7%; bottom:8%; width:auto.
- Logo layer: position:absolute; top:6%; left:6%; max-width:38%.
- Safe zones: top 8%, bottom 8%, left/right 5%.`;

  const absoluteLandscapeRules = `- Banner fills exactly ${fmt.width}x${fmt.height}px and respects proportions.
- SUGGESTED NON-OVERLAPPING ZONES — use these as a starting reference; adjust positions creatively as long as elements do not overlap:
  • Logo zone:       left:5%;  top:7%;    max-width:16%; max-height:13%  — top-left corner
  • Headline zone:   left:6%;  top:28%;   width:48%                      — middle-left column
  • Subheadline:     left:6%;  top:55%;   width:44%                      — below headline
  • CTA zone:        left:6%;  bottom:9%; max-width:35%                  — bottom-left
  • Product zone:    right:5%; top:12%;   max-width:38%; max-height:78%  — full right column
- Elements must NOT overlap each other — maintain clear separation between text, product, and logo zones.`;

  const absolutePortraitRules = `- Banner fills exactly ${fmt.width}x${fmt.height}px and respects proportions.
- SUGGESTED NON-OVERLAPPING ZONES — use these as a starting reference; adjust positions creatively as long as elements do not overlap:
  • Logo zone:       left:6%;  top:5%;    max-width:25%; max-height:9%   — top-left
  • Product zone:    right:4%; top:14%;   max-width:58%; max-height:38%  — right, upper half
  • Headline zone:   left:7%;  bottom:28%; width:86%                     — lower section
  • Subheadline:     left:7%;  bottom:18%; width:80%                     — between headline and CTA
  • CTA zone:        left:7%;  bottom:8%; max-width:70%                  — bottom-left
- Elements must NOT overlap each other — product image must end before the text zone begins.`;

  const absoluteSquareRules = `- Banner fills exactly ${fmt.width}x${fmt.height}px and respects proportions.
- SUGGESTED NON-OVERLAPPING ZONES — use these as a starting reference; adjust positions creatively as long as elements do not overlap:
  • Logo zone:       left:6%;  top:5%;    max-width:22%; max-height:10%  — top-left
  • Headline zone:   left:7%;  top:12%;   width:86%;     text-align:center
  • Subheadline:     left:10%; top:31%;   width:80%;     text-align:center
  • Product zone:    left:50%; top:43%;   max-width:54%; max-height:34%; transform:translateX(-50%) — center-lower
  • CTA zone:        left:50%; bottom:8%; max-width:72%; transform:translateX(-50%)                 — bottom-center
- Elements must NOT overlap each other — maintain clear separation between all zones.`;

  const absoluteDefaultRules =
    category === "landscape" ? absoluteLandscapeRules :
    category === "portrait"  ? absolutePortraitRules  :
    absoluteSquareRules;

  const layoutRules = category === "leaderboard" ? absoluteLeaderboardRules : category === "story" ? absoluteStoryRules : absoluteDefaultRules;

  return `You are a senior paid-media HTML banner designer specializing in pixel-perfect inline-styled ad creatives.
Your task: generate EXACTLY ONE ad banner. No more, no less.

════════════════════════════════════════
TARGET FORMAT
════════════════════════════════════════
Platform: ${fmt.platform}
Format: ${fmt.label}
Dimensions: WIDTH=${fmt.width}px × HEIGHT=${fmt.height}px  ← EXACT, non-negotiable
Category: ${category.toUpperCase()}
${variantLabel ? `A/B Variant: ${variantLabel}` : ""}

════════════════════════════════════════
LAYOUT BLUEPRINT — IMPLEMENT THIS EXACTLY
════════════════════════════════════════
${archetype}

Content rules: ${density}

════════════════════════════════════════
OUTPUT FORMAT — CRITICAL
════════════════════════════════════════
Return ONLY:
One <div class="ad-banner" style="width:${fmt.width}px;height:${fmt.height}px;position:relative;overflow:hidden;box-sizing:border-box;" data-platform="${fmt.platform}" data-format="${fmt.format}"${variantLabel ? ` data-variant="${variantLabel}"` : ""}> ... </div>

ALL STYLES MUST BE INLINE using style="..." attributes on every element.
DO NOT output any <style> block, <link> tag, or class-based CSS rules.
Every div, img, p, span, button MUST carry its complete inline style="" attribute.
For Google Fonts: use font-family:'Font Name' in inline style — the parent document loads the font.
DO NOT return <!DOCTYPE>, <html>, <head>, <body>, markdown, or code fences.
ONLY the single .ad-banner div.

ABSOLUTE POSITIONING - NON-NEGOTIABLE
The .ad-banner is a fixed creative canvas, not a web layout.
Every visible primary element inside .ad-banner MUST be an independent layer with position:absolute.
Do NOT use flexbox, grid, normal document flow, margins, or relative wrappers for the primary layout.
Allowed exception: small internal spans inside one already absolute text panel.

Required layer classes and positioning:
- .ad-bg: position:absolute; inset:0; z-index:0.
- .ad-logo: position:absolute; z-index:20; explicit left/top or right/top; explicit width/max-width.
- .ad-headline: position:absolute; z-index:30; explicit left/top/bottom and width.
- .ad-subheadline: position:absolute; z-index:30; explicit left/top/bottom and width.
- .ad-cta: position:absolute; z-index:40; explicit left/top/bottom or right/top; min-height:38px.
- .ad-media.ad-product: position:absolute; z-index:15 or 25; explicit left/top and width/height or max-width/max-height.
- Badges/accent shapes: position:absolute with explicit z-index.

Use percentages for scalable placement and px for font sizes, border radius, shadows, and padding.
The root .ad-banner MUST NOT include display:flex, display:grid, align-items, justify-content, gap, or flex-direction.
Never place two primary layers in the same zone. Reserve separate non-overlapping zones for logo, headline, subheadline, CTA, and product:
- Logo: set width:auto; height:auto on the img element — use ONLY max-width and max-height constraints, NEVER explicit pixel width or height (breaks scaling and causes overflow/clipping). Example: <img src="URL" class="ad-logo" style="position:absolute; width:auto; height:auto; max-width:140px; max-height:60px; object-fit:contain; top:5%; left:6%;">
- Logo stays in its designated corner zone — never more than 22% of banner width or 12% of banner height.
- Headline and subheadline share a text panel zone, but product/media cannot overlap that zone.
- CTA gets its own zone below or beside text, with at least 4% spacing from headline/subheadline.
- Product/media gets a separate visual zone and may sit behind text only if a solid/gradient text panel protects readability.
- Decorative shapes must stay behind text/media with lower z-index.

════════════════════════════════════════
LAYOUT RULES FOR ${category.toUpperCase()}
════════════════════════════════════════
${layoutRules}

════════════════════════════════════════
IMAGE EMBEDDING — NON-NEGOTIABLE
════════════════════════════════════════
• Logo URL provided → <img src="URL" class="ad-logo" style="object-fit:contain;flex-shrink:0;..."> styled per the blueprint
• Product image → <img src="URL" class="ad-media" style="object-fit:contain;..."> visible, not decorative
• Background image → <div class="ad-bg" style="position:absolute;inset:0;background-image:url('URL');background-size:cover;background-position:center;z-index:0;"> + overlay child div with rgba background ≤65% opacity
• If any URL is provided in the creative brief, the final HTML MUST contain that exact URL string. Treat missing URLs as a failed output.
• A/B variants with variant-specific image URLs MUST use those exact variant URLs, not the default image URLs.
• NO background image → rich layered gradient using multiple nested divs or background with gradient — NO flat solid color
• NEVER replace a provided URL with a placeholder

════════════════════════════════════════
HTML STRUCTURE — REQUIRED
════════════════════════════════════════
• Root .ad-banner: style="width:${fmt.width}px;height:${fmt.height}px;position:relative;overflow:hidden;box-sizing:border-box;"
• Background layer: <div class="ad-bg" style="position:absolute;inset:0;z-index:0;..."></div>
• Preferred: place all absolute layers DIRECTLY inside .ad-banner — no intermediate wrapper needed.
• If you use a content wrapper: <div class="ad-content" style="position:relative;z-index:1;width:100%;height:100%;overflow:visible;"> — MUST use overflow:visible, NEVER overflow:hidden (it clips absolute children near edges and causes logo/text cutoff).
• CTA: element with class="ad-cta" style="display:inline-flex;align-items:center;justify-content:center;..." — visible, high-contrast, min-height:38px

════════════════════════════════════════
INLINE CSS QUALITY STANDARDS — MANDATORY
════════════════════════════════════════
Background depth (NEVER a single flat solid color):
• Root .ad-banner or .ad-bg MUST use gradient: background:linear-gradient(135deg,COLOR1,COLOR2) or multi-stop gradient
• Add geometric accent: a second absolutely positioned div with clip-path or rotated transform for visual interest
• Inner vignette: box-shadow:inset 0 0 80px rgba(0,0,0,0.25) on .ad-banner or .ad-bg

Typography:
• Headline: font-weight:800; letter-spacing:-0.02em; line-height:1.1; overflow:hidden — CRITICAL: size your font so the FULL headline fits within its container WITHOUT being clipped; reduce font-size if needed
• Subheadline: font-weight:500; line-height:1.35; opacity:0.88; overflow:hidden
• ALL text containers: overflow:hidden; max-width:100%; word-break:break-word

Visual depth (mandatory):
• Headline on dark bg: text-shadow:0 2px 16px rgba(0,0,0,0.55)
• CTA button: box-shadow:0 4px 20px rgba(0,0,0,0.38)
• Logo/product img: filter:drop-shadow(0 6px 24px rgba(0,0,0,0.45))

CTA button:
• border-radius:9999px (pill) or ≥8px; padding:10px 28px minimum
• font-weight:700; letter-spacing:0.05em; text-transform:uppercase
• background = accent color from palette; color = high-contrast (white or very dark)
• NEVER square corners (border-radius:0)

Layout safety:
• Fixed-size children: flex-shrink:0
• No percentage heights on children — use px or flex:1
• Headline ≤5 words: white-space:nowrap

════════════════════════════════════════
COPY & BRAND STANDARDS
════════════════════════════════════════
• Real paid-media copy — punchy, specific to brand brief, no Lorem ipsum
• ctaText provided → use VERBATIM on .ad-cta
• mainHeadline provided → use as primary copy anchor (adapt to format density)
• Brand colors → use ONLY the provided palette, NOT invented colors
• Urgency high/medium → include urgency badge ("Today only", "Limited spots")`;
}

function buildBannerUserPrompt(
  data: NonNullable<AdCreativePayload["adData"]>,
  fontSection: string,
  brandName: string,
  variantLabel: string | undefined,
  variantImageOverrides: { productUrl?: string; bgUrl?: string },
  formatNote?: string,
  creativePlan?: CreativePlan | null
): string {
  const effectiveProduct = variantImageOverrides.productUrl || data.productImageUrl || "";
  const effectiveBg = variantImageOverrides.bgUrl || data.backgroundImageUrl || "";
  const variantIndex = variantLabel ? ["A", "B", "C"].indexOf(variantLabel) : -1;
  const variantHeadline = variantIndex >= 0 ? (data.headlineVariants || [])[variantIndex] : "";
  const variantCta = variantIndex >= 0 ? (data.ctaVariants || [])[variantIndex] : "";
  const effectiveCta = variantCta || data.ctaText || "Get Started";

  const imageSectionFinal = [
    data.logoUrl && `REQUIRED LOGO URL: ${data.logoUrl}
Use exactly: <img src="${data.logoUrl}" class="ad-logo" ...>`,
    effectiveProduct && `REQUIRED PRODUCT/HERO IMAGE URL: ${effectiveProduct}
Use exactly: <img src="${effectiveProduct}" class="ad-media ad-product" ...>. It must be visible and large enough to notice.`,
    effectiveBg && `REQUIRED BACKGROUND IMAGE URL: ${effectiveBg}
Use exactly: background-image:url('${effectiveBg}') on .ad-bg with a readable overlay.`,
  ].filter(Boolean).join("\n") || "No images — build rich gradient/geometric background";

  const imageArtDirection = `IMAGE ART DIRECTION:
- Analyze attached images before layout: identify product packshot vs lifestyle/person vs screenshot vs texture/background vs logo.
- Product image must be integrated intentionally: floating cutout, masked frame, angled card, side crop, corner anchor, or split-panel hero. Never leave a square product photo dumped in the center.
- Background image must include a readability system if text overlaps it: gradient overlay, solid panel, vignette, blur panel, or split layout.
- Define a clear text safe zone and keep headline/CTA away from the visual focal point.
- For this format, follow the locked plan's product crop strategy, background overlay strategy, focal point, and readability plan.`;

  const exactCopy = !data.useAiCopy && (data.mainHeadline || data.subheadline)
    ? `\n★ VERBATIM COPY:\n${data.mainHeadline ? `  Headline: "${data.mainHeadline}"` : ""}\n${data.subheadline ? `  Subheadline: "${data.subheadline}"` : ""}`
    : "";

  const urgencyBadge = (data.urgencyLevel === "high" || data.urgencyLevel === "medium") && (data.scarcity || data.discount || data.guarantee)
    ? `URGENCY BADGE: ${[data.scarcity, data.discount, data.guarantee].filter(Boolean).join(" · ")}`
    : "";

  const funnelHint =
    data.funnelStage === "awareness" ? "CTA tone: light/exploratory" :
    data.funnelStage === "consideration" ? "CTA tone: informative/persuasive" :
    data.funnelStage === "conversion" ? "CTA tone: direct/urgent" : "";

  const variantDirection = variantLabel
    ? (() => {
        const focus = data.abTestFocus || "mixed";
        const focusRules: Record<string, string> = {
          headline: "Change the primary hook/headline only. Keep layout, palette, imagery and CTA treatment close to the other variants.",
          cta: "Change the CTA text/tone and CTA visual emphasis only. Keep headline, layout, palette and imagery close to the other variants.",
          visual: "Change the visual composition clearly: layout archetype, image crop, product/background placement, and hierarchy must be visibly different.",
          color: "Change the color treatment clearly while staying inside the provided palette: rotate primary/secondary/accent roles, test light vs dark background, and make the variant visually distinguishable.",
          mixed: "Change one major lever per variant: Variant A is direct/control, Variant B tests a different hook or CTA, Variant C (if present) tests a stronger visual/color angle.",
        };
        const visualHypothesis = focus === "visual"
          ? "Each visual variant must test a named hypothesis: image-led vs type-led, product-closeup vs lifestyle/context, light background vs dark overlay, or centered product vs side product. Keep the rest controlled."
          : "Keep the A/B change intentional and controlled; do not randomly redesign every element.";
        return [
          `A/B TEST VARIANT ${variantLabel} - FOCUS: ${focus.toUpperCase()}`,
          focusRules[focus] || focusRules.mixed,
          visualHypothesis,
          variantHeadline && `MANDATORY HEADLINE FOR VARIANT ${variantLabel}: "${variantHeadline}"`,
          variantCta && `MANDATORY CTA FOR VARIANT ${variantLabel}: "${variantCta}"`,
          effectiveProduct && variantImageOverrides.productUrl && `Use this variant-specific product image: ${effectiveProduct}`,
          effectiveBg && variantImageOverrides.bgUrl && `Use this variant-specific background image: ${effectiveBg}`,
          "The final HTML root MUST include the exact data-variant attribute already requested in the system prompt.",
        ].filter(Boolean).join("\n");
      })()
    : "";

  return `CREATIVE BRIEF — ALL FIELDS MANDATORY

${imageSectionFinal}

${imageArtDirection}

IMAGE COMPLIANCE CHECK BEFORE YOU ANSWER:
Every REQUIRED URL listed above must appear verbatim in your final HTML. Do not summarize, omit, rename, crop out, or replace those URLs.

${creativePlanToPrompt(creativePlan)}

FONTS: ${fontSection || "no custom fonts — use clean sans-serif"}

Campaign: ${data.campaignName || ""}
Objective: ${data.campaignObjective || ""} ${funnelHint}
Strategy/Angle: ${data.creativeStrategy || "direct-response"}${data.creativeStrategy === "other" && data.creativeStrategyOther ? ` — ${data.creativeStrategyOther}` : ""}
Brand: ${data.brandName || brandName} | Industry: ${data.industry || ""}
Keywords (use in copy): ${data.brandKeywords || ""}
Forbidden words: ${data.forbiddenWords || ""}
Product/Service: ${data.productName || ""}
Value Proposition: ${data.valueProposition || ""}
Offer: ${data.offer || ""} | Price: ${data.pricing || ""} | Discount: ${data.discount || ""}
Guarantee: ${data.guarantee || ""} | Scarcity: ${data.scarcity || ""}
${urgencyBadge}
CTA (VERBATIM): "${effectiveCta}"
${exactCopy}
${variantDirection}
Audience: ${data.targetAudience || ""} | Age: ${data.ageRange || ""} | Gender: ${data.gender || "all"}
Pain points: ${data.painPoints || ""}
Desires: ${data.desires || ""}
Tone: ${data.toneOfVoice || "confident"} | Urgency: ${data.urgencyLevel || "medium"}
Visual style: ${data.preferredStyle || "modern"}
Colors — Primary: ${data.primaryColor || "#3B82F6"} | Secondary: ${data.secondaryColor || "#111827"} | Accent: ${data.accentColor || "#F59E0B"} | Text: ${data.textColor || "#FFFFFF"} | Background: ${data.backgroundColor || "#111827"}
Logo strategy: ${data.preferredLogoStrategy || "auto"}
Logo variants: ${(data.logoVariants || []).map((v: any, i: number) => `${i + 1}) ${v.label || "Logo"} ${v.url ? `<${v.url}>` : "no URL"}${v.usageHint ? ` [${v.usageHint}]` : ""}`).join(" | ") || "none"}
Context: ${data.context || ""}
Website: ${data.websiteUrl || ""}
${formatNote ? `\nFORMAT NOTE (OVERRIDE): ${formatNote}` : ""}`;
}

function extractBannerSnippet(raw: string): { styles: string; html: string } | null {
  const cleaned = stripCodeFences(raw).trim();
  const withoutStyles = cleaned.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "").trim();
  if (!withoutStyles.match(/class=["']ad-banner["']/i)) return null;
  const textContent = withoutStyles.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  if (textContent.length < 20) return null;
  return { styles: "", html: withoutStyles };
}

function extractBannerSnippets(raw: string): string[] {
  const cleaned = stripCodeFences(raw)
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<!doctype[^>]*>/gi, "")
    .replace(/<\/?(?:html|head|body)[^>]*>/gi, "")
    .trim();

  const starts: number[] = [];
  const startPattern = /<div\b[^>]*class=["'][^"']*\bad-banner\b[^"']*["'][^>]*>/gi;
  let startMatch: RegExpExecArray | null;
  while ((startMatch = startPattern.exec(cleaned)) !== null) {
    starts.push(startMatch.index);
  }

  const snippets: string[] = [];
  for (const start of starts) {
    const tagPattern = /<\/?div\b[^>]*>/gi;
    tagPattern.lastIndex = start;
    let depth = 0;
    let end = -1;
    let match: RegExpExecArray | null;
    while ((match = tagPattern.exec(cleaned)) !== null) {
      if (match[0].startsWith("</")) {
        depth -= 1;
        if (depth === 0) {
          end = tagPattern.lastIndex;
          break;
        }
      } else {
        depth += 1;
      }
    }

    if (end > start) {
      const snippet = cleaned.slice(start, end).trim();
      const textContent = snippet.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      if (textContent.length >= 20) snippets.push(snippet);
    }
  }

  if (snippets.length > 0) return snippets;
  const single = extractBannerSnippet(cleaned);
  return single?.html ? [single.html] : [];
}

function bannerMatchesPlan(html: string, plan: BannerAssetPlan) {
  const platform = plan.fmt.platform.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const format = plan.fmt.format.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const hasPlatform = new RegExp(`data-platform=["']${platform}["']`, "i").test(html);
  const hasFormat = new RegExp(`data-format=["']${format}["']`, "i").test(html);
  const hasVariant = plan.variantLabel
    ? new RegExp(`data-variant=["']${plan.variantLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`, "i").test(html)
    : true;
  return hasPlatform && hasFormat && hasVariant;
}

function buildBannerGroupSystemPrompt(
  fmt: Required<Pick<AdFormatInput, "platform" | "format" | "label" | "width" | "height">>,
  category: FormatCategory,
  archetype: string,
  density: string,
  groupCount: number,
) {
  return buildBannerSystemPrompt(fmt, category, archetype, density, "group")
    .replace(
      "generate EXACTLY ONE ad banner. No more, no less.",
      `generate EXACTLY ${groupCount} ad banners for the same ${fmt.width}x${fmt.height}px format family. No more, no less.`,
    )
    .replace(
      /Return ONLY:[\s\S]*?ALL STYLES MUST BE INLINE/i,
      `Return ONLY:\n${groupCount} sibling <div class="ad-banner" ...> blocks, one per requested creative. Use the exact data-platform, data-format, and data-variant attributes specified in the user prompt. No wrapper div.\n\nALL STYLES MUST BE INLINE`,
    )
    .replace(/ONLY the single \.ad-banner div\./gi, `ONLY the ${groupCount} .ad-banner divs. No wrapper, no markdown.`);
}

function buildBannerGroupUserPrompt(
  data: NonNullable<AdCreativePayload["adData"]>,
  fontSection: string,
  brandName: string,
  specs: BannerTaskSpec[],
) {
  const base = buildBannerUserPrompt(
    data,
    fontSection,
    brandName,
    specs[0].assetPlan.variantLabel,
    specs[0].variantImageOverrides,
    specs[0].formatNote,
    null,
  );

  const creativeList = specs.map((spec, index) => {
    const plan = spec.assetPlan;
    const variantIndex = plan.variantLabel ? ["A", "B", "C"].indexOf(plan.variantLabel) : -1;
    const variantHeadline = variantIndex >= 0 ? (data.headlineVariants || [])[variantIndex] : "";
    const variantCta = variantIndex >= 0 ? (data.ctaVariants || [])[variantIndex] : "";
    return `CREATIVE ${index + 1}
- Banner ID: ${spec.bannerId}
- Required root attributes: class="ad-banner" data-platform="${plan.fmt.platform}" data-format="${plan.fmt.format}"${plan.variantLabel ? ` data-variant="${plan.variantLabel}"` : ""}
- Dimensions: ${plan.fmt.width}x${plan.fmt.height}px
- Format label: ${plan.fmt.label}
- Variant headline: ${variantHeadline || "none"}
- Variant CTA: ${variantCta || data.ctaText || "none"}
- Format note: ${spec.formatNote || "none"}
- Required logo URL: ${plan.logoUrl || "none"}
- Required product URL: ${plan.productUrl || "none"}
- Required background URL: ${plan.bgUrl || "none"}`;
  }).join("\n\n");

  return `${base}

GROUPED FORMAT GENERATION OVERRIDE:
Generate all requested creatives below in ONE response because they share the same dimension family.
They must look like one coherent campaign, but each ad must be a complete standalone .ad-banner.
Return exactly ${specs.length} sibling .ad-banner divs and nothing else.

${creativeList}`;
}

function getAdPlanningModels(accountType: unknown) {
  const normalized = normalizeAccountType(accountType);
  const envList = normalized === "admin"
    ? parseGeminiModelList(env?.get("GEMINI_AD_PLANNING_MODELS") || env?.get("GEMINI_AD_MODELS") || env?.get("GEMINI_SITE_MODELS"))
    : parseGeminiModelList(env?.get("GEMINI_AD_PLANNING_MODELS_TESTING") || env?.get("GEMINI_AD_MODELS_TESTING") || env?.get("GEMINI_SITE_MODELS_TESTING"));
  return unique([...envList, "gemini-2.5-pro", "gemini-2.5-flash"]);
}

const CREATIVE_PLAN_SCHEMA = {
  type: "object",
  properties: {
    concept: { type: "string" },
    headline: { type: "string" },
    subheadline: { type: "string" },
    cta: { type: "string" },
    layoutInstruction: { type: "string" },
    visualHierarchy: { type: "string" },
    backgroundTreatment: { type: "string" },
    productTreatment: { type: "string" },
    imageRole: { type: "string" },
    textSafeZone: { type: "string" },
    productCropStrategy: { type: "string" },
    backgroundOverlayStrategy: { type: "string" },
    visualFocalPoint: { type: "string" },
    readabilityPlan: { type: "string" },
    layoutRisk: { type: "string" },
    logoTreatment: { type: "string" },
    colorTreatment: { type: "string" },
    typographyTreatment: { type: "string" },
    abHypothesis: { type: "string" },
    assetUsage: {
      type: "object",
      properties: {
        logo: { type: "string" },
        product: { type: "string" },
        background: { type: "string" },
      },
      required: ["logo", "product", "background"],
    },
    abVariantPlan: {
      type: "object",
      properties: {
        controlledVariable: { type: "string" },
        changedVariable: { type: "string" },
        expectedLearning: { type: "string" },
      },
      required: ["controlledVariable", "changedVariable", "expectedLearning"],
    },
    complianceNotes: { type: "array", items: { type: "string" } },
  },
  required: [
    "concept",
    "headline",
    "subheadline",
    "cta",
    "layoutInstruction",
    "visualHierarchy",
    "backgroundTreatment",
    "productTreatment",
    "imageRole",
    "textSafeZone",
    "productCropStrategy",
    "backgroundOverlayStrategy",
    "visualFocalPoint",
    "readabilityPlan",
    "layoutRisk",
    "logoTreatment",
    "colorTreatment",
    "typographyTreatment",
    "abHypothesis",
    "assetUsage",
    "complianceNotes",
  ],
};

function buildCreativePlanPrompt(
  data: NonNullable<AdCreativePayload["adData"]>,
  brandName: string,
  assetPlan: BannerAssetPlan,
  density: string,
  seedArchetype: string,
  formatNote?: string,
) {
  const variantIndex = assetPlan.variantLabel ? ["A", "B", "C"].indexOf(assetPlan.variantLabel) : -1;
  const variantHeadline = variantIndex >= 0 ? (data.headlineVariants || [])[variantIndex] : "";
  const variantCta = variantIndex >= 0 ? (data.ctaVariants || [])[variantIndex] : "";

  return `Create a precise paid-media creative plan for ONE HTML ad banner. Return JSON only.

FORMAT
Platform: ${assetPlan.fmt.platform}
Format: ${assetPlan.fmt.label}
Dimensions: ${assetPlan.fmt.width}x${assetPlan.fmt.height}
Category: ${assetPlan.category}
Content density: ${density}
Seed layout archetype: ${seedArchetype}
Format note: ${formatNote || "none"}

BRAND AND CAMPAIGN
Brand: ${data.brandName || brandName}
Campaign: ${data.campaignName || ""}
Objective: ${data.campaignObjective || ""}
Funnel stage: ${data.funnelStage || ""}
Industry: ${data.industry || ""}
Context: ${data.context || ""}
Website: ${data.websiteUrl || ""}
Keywords: ${data.brandKeywords || ""}
Forbidden words: ${data.forbiddenWords || ""}
Strategy: ${data.creativeStrategy || "direct-response"} ${data.creativeStrategy === "other" ? data.creativeStrategyOther || "" : ""}

OFFER AND AUDIENCE
Product/service: ${data.productName || ""}
Value proposition: ${data.valueProposition || ""}
Offer: ${data.offer || ""}
Pricing: ${data.pricing || ""}
Discount: ${data.discount || ""}
Guarantee: ${data.guarantee || ""}
Scarcity: ${data.scarcity || ""}
Audience: ${data.targetAudience || ""}
Age: ${data.ageRange || ""}
Gender: ${data.gender || "all"}
Pain points: ${data.painPoints || ""}
Desires: ${data.desires || ""}
Tone: ${data.toneOfVoice || ""}
Urgency: ${data.urgencyLevel || ""}

COPY CONTROLS
Use AI copy: ${data.useAiCopy !== false ? "yes" : "no"}
Main headline: ${data.mainHeadline || ""}
Subheadline: ${data.subheadline || ""}
Default CTA: ${data.ctaText || ""}

A/B CONTROLS
Variant: ${assetPlan.variantLabel || "none"}
A/B focus: ${data.abTestFocus || "none"}
Mandatory variant headline: ${variantHeadline || "none"}
Mandatory variant CTA: ${variantCta || "none"}

VISUAL IDENTITY
Style: ${data.preferredStyle || ""}
Colors: primary ${data.primaryColor || ""}, secondary ${data.secondaryColor || ""}, accent ${data.accentColor || ""}, text ${data.textColor || ""}, background ${data.backgroundColor || ""}
Heading font: ${data.customHeadingFontName || data.headingFont || ""}
Body font: ${data.customBodyFontName || data.bodyFont || ""}
Logo strategy: ${data.preferredLogoStrategy || "auto"}
Logo variants: ${(data.logoVariants || []).map((v: any) => `${v.label || "Logo"} ${v.url || ""} ${v.usageHint || ""}`).join(" | ") || "none"}

REQUIRED ASSETS
Logo URL: ${assetPlan.logoUrl || "none"}
Product URL: ${assetPlan.productUrl || "none"}
Background URL: ${assetPlan.bgUrl || "none"}

FORMAT-SPECIFIC CREATIVE DIRECTION
${assetPlan.category === "leaderboard"
  ? "- Leaderboard: keep product small/lateral or omit product prominence if space is too tight; text and CTA must stay in one row with no visual clutter."
  : assetPlan.category === "story"
    ? "- Story: use full-height composition, strict top/bottom safe zones, CTA above bottom UI area, and image focal point away from lower-third text."
    : assetPlan.category === "square"
      ? "- Square: use product as a deliberate visual anchor with mask/shadow/frame; headline and CTA need separate text-safe areas."
      : assetPlan.category === "landscape"
        ? "- Landscape: prefer split image/text, side hero product, or full-bleed image with directional overlay and protected text panel."
        : "- Portrait: stack image and text zones vertically or use a strong split; never let product cover headline/CTA."}

Plan requirements:
- Choose the strongest use of the provided/attached images for this exact format.
- If an asset URL exists, describe exactly where it should appear and how large/prominent it should be.
- First analyze each attached image: classify it as product packshot, lifestyle/person, screenshot, logo, texture/background, or abstract. Use that classification to decide composition.
- Product images must receive an art-directed treatment: masked frame, cropped side hero, floating cutout with shadow, angled card, corner anchor, split-panel stage, or deliberate product showcase. Never plan a raw square image dumped in the center.
- Background images require a text-safe readability plan: gradient overlay, solid text panel, vignette, blur panel, split layout, or dark/light mask. Never place important copy directly over busy image areas.
- Define a concrete text safe zone and visual focal point so headline, CTA, logo, product, and background do not compete.
- Include the biggest layout risk for this format and how the renderer should avoid it.
- For A/B, state a clear hypothesis that differs from sibling variants while staying controlled.
- Keep copy short enough for the target dimensions.
- The later HTML renderer will follow your plan exactly, so be concrete and implementation-ready.`;
}

async function callGeminiJson(systemPrompt: string, userPrompt: string, imageParts: any[], accountType: unknown) {
  const keys = getGeminiApiKeysForAccountType(accountType);
  const models = getAdPlanningModels(accountType);
  let lastError = "";

  for (const key of keys) {
    for (const model of models) {
      try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: "user", parts: [{ text: userPrompt }, ...imageParts] }],
            generationConfig: {
              temperature: 0.35,
              topP: 0.85,
              maxOutputTokens: 8192,
              responseMimeType: "application/json",
              responseJsonSchema: CREATIVE_PLAN_SCHEMA,
            },
          }),
        });

        const text = await response.text();
        if (!response.ok) {
          lastError = `Gemini planning ${model} failed with ${response.status}: ${text.slice(0, 240)}`;
          continue;
        }
        return parseJsonResponse(text);
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }
  }

  throw new Error(lastError || "AI planning failed");
}

async function callGemini(systemPrompt: string, userPrompt: string, accountType: unknown, imageParts: any[] = []) {
  const keys = getGeminiApiKeysForAccountType(accountType);
  const models = getAdGenerationModels(accountType);
  let lastError = "";

  for (const key of keys) {
    for (const model of models) {
      try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: "user", parts: [{ text: userPrompt }, ...imageParts] }],
            generationConfig: {
              temperature: 0.58,
              topP: 0.90,
              maxOutputTokens: 32768,
              thinkingConfig: { thinkingBudget: 0 },
            },
          }),
        });

        const text = await response.text();
        if (!response.ok) {
          if (response.status === 429) await sleep(5000);
          lastError = `Gemini ${model} failed with ${response.status}: ${text.slice(0, 240)}`;
          continue;
        }
        return parseHtmlResponse(text);
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }
  }

  throw new Error(lastError || "AI gateway failed");
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

async function runWithConcurrency<T>(
  fns: Array<() => Promise<T>>,
  limit: number
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(fns.length);
  let index = 0;
  async function worker() {
    while (index < fns.length) {
      const i = index++;
      try { results[i] = { status: "fulfilled", value: await fns[i]() }; }
      catch (e) { results[i] = { status: "rejected", reason: e }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, fns.length) }, worker));
  return results;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const payload = await req.json() as AdCreativePayload;
    const formats = getEnabledFormats(payload);
    if (!formats.length) {
      return new Response(JSON.stringify({ error: "No enabled ad formats provided." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const brandName = String(payload.businessName || payload.adData?.brandName || "AD Creative");
    payload.adData = payload.adData || {};
    const imageResolution = await resolveMissingAdImages(payload);
    payload.adData.productImageUrl = imageResolution.productImageUrl;
    payload.adData.backgroundImageUrl = imageResolution.backgroundImageUrl;
    const data = payload.adData;
    const assetBaseUrl = String(data.assetBaseUrl || "").trim();

    const fontSection = [
      (data.customHeadingFontName || data.headingFont) && (
        data.customHeadingFontName
          ? `HEADING FONT: "${data.customHeadingFontName}" — CUSTOM FONT embedded as @font-face. MANDATORY: use font-family: '${data.customHeadingFontName}' on ALL h1/h2/h3. DO NOT @import from Google Fonts for headings.`
          : `HEADING FONT: "${data.headingFont}" — @import from Google Fonts, apply to all h1/h2/h3 elements`
      ),
      (data.customBodyFontName || data.bodyFont) && (
        data.customBodyFontName
          ? `BODY FONT: "${data.customBodyFontName}" — CUSTOM FONT embedded as @font-face. MANDATORY: use font-family: '${data.customBodyFontName}' on ALL body text (p, span, a, button). DO NOT @import from Google Fonts for body text.`
          : `BODY FONT: "${data.bodyFont}" — @import from Google Fonts, apply to all p/span/a/button elements`
      ),
    ].filter(Boolean).join("\n");

    const variantCount = data.abTestingEnabled ? Math.min(3, Math.max(2, Number(data.abVariantCount || 2))) : 1;
    const variantLabels = ["A", "B", "C"].slice(0, variantCount);

    const taskSpecs = formats.flatMap((fmt, fi): BannerTaskSpec[] => {
      const category = categorizeFormat(fmt);
      const density = CONTENT_DENSITY[category];
      const fmtNoteKey = `${fmt.platform}-${fmt.label}`;
      const formatNote = (data.formatNotes || {})[fmtNoteKey] || "";

      return (data.abTestingEnabled ? variantLabels : [undefined as string | undefined]).map((variantLabel, vi) => {
        const variantProductUrl = variantLabel ? String((data.productImageVariants || [])[vi] || "").trim() : "";
        const variantBgUrl = variantLabel ? String((data.backgroundImageVariants || [])[vi] || "").trim() : "";
        return {
          bannerId: `b${fi}${vi > 0 ? `v${vi}` : ""}`,
          assetPlan: {
            fmt,
            category,
            variantLabel,
            logoUrl: String(data.logoUrl || "").trim(),
            productUrl: variantProductUrl || String(data.productImageUrl || "").trim(),
            bgUrl: variantBgUrl || String(data.backgroundImageUrl || "").trim(),
          },
          density,
          seedArchetype: pickArchetype(category),
          formatNote,
          variantImageOverrides: {
            productUrl: variantProductUrl || undefined,
            bgUrl: variantBgUrl || undefined,
          },
        };
      });
    });

    const generateOne = async (spec: BannerTaskSpec): Promise<{ raw: string; assetPlan: BannerAssetPlan } | null> => {
      const { assetPlan, bannerId } = spec;
      for (let attempt = 0; attempt < 2; attempt++) {
        if (attempt > 0) await sleep(3000);
        try {
          const imageParts = await buildImagePartsForPlan(assetPlan, assetBaseUrl);
          const creativePlan: CreativePlan | null = null;
          const archetype = creativePlan?.layoutInstruction || spec.seedArchetype;
          const systemPrompt = buildBannerSystemPrompt(assetPlan.fmt, assetPlan.category, archetype, spec.density, bannerId, assetPlan.variantLabel);
          const userPrompt = buildBannerUserPrompt(data, fontSection, brandName, assetPlan.variantLabel, spec.variantImageOverrides, spec.formatNote, creativePlan);

          let raw = await callGemini(systemPrompt, userPrompt, payload.accountType, imageParts);
          let snippet = extractBannerSnippet(raw);
          if (!snippet) throw new Error("Banner sem conteudo de texto valido");

          let missingAssets = missingRequiredAssetUrls(snippet.html, assetPlan);
          if (missingAssets.length > 0) {
            const repairPrompt = `${userPrompt}

CRITICAL REQUIRED IMAGE REPAIR:
Your previous HTML omitted required image URL(s). Regenerate the same banner now, but include every missing URL verbatim in the HTML:
${missingAssets.map((asset) => `- ${asset.slot}: ${asset.url}`).join("\n")}

Do not use placeholders. Do not invent substitute images. Return only the single .ad-banner div.`;
            raw = await callGemini(systemPrompt, repairPrompt, payload.accountType, imageParts);
            snippet = extractBannerSnippet(raw);
            if (!snippet) throw new Error("Banner repair returned empty HTML");
            missingAssets = missingRequiredAssetUrls(snippet.html, assetPlan);
          }

          if (missingAssets.length > 0) {
            console.warn(`[ChiliForge] Banner ${bannerId}: assets still missing after repair: ${missingAssets.map(a => a.slot).join(", ")}`);
          }

          let missingAbsoluteLayers = missingAbsoluteLayerRequirements(snippet.html, assetPlan);
          if (missingAbsoluteLayers.length > 0) {
            const absoluteRepairPrompt = `${userPrompt}

CRITICAL ABSOLUTE LAYOUT REPAIR:
Your previous HTML did not satisfy the required absolute-positioned ad layer contract:
${missingAbsoluteLayers.map((item) => `- ${item}`).join("\n")}

Regenerate the same banner now. Return only the single .ad-banner div.
Every primary visual element must be an independent position:absolute layer.
The .ad-banner root must be position:relative and must not use flex/grid for primary layout.
Use required classes: ad-bg, ad-logo, ad-headline, ad-subheadline if present, ad-media ad-product, and ad-cta.
Keep layers in separate, non-overlapping zones. Logo must be small, never a hero element.`;
            raw = await callGemini(systemPrompt, absoluteRepairPrompt, payload.accountType, imageParts);
            snippet = extractBannerSnippet(raw);
            if (!snippet) throw new Error("Absolute layout repair returned empty HTML");
            missingAssets = missingRequiredAssetUrls(snippet.html, assetPlan);
            missingAbsoluteLayers = missingAbsoluteLayerRequirements(snippet.html, assetPlan);
          }

          if (missingAbsoluteLayers.length > 0) {
            console.warn(`[ChiliForge] Banner ${bannerId}: absolute layer warnings after repair: ${missingAbsoluteLayers.join(", ")}`);
          }

          return { raw, assetPlan };
        } catch (e) {
          console.warn(`[ChiliForge] Banner attempt ${attempt + 1} failed:`, e instanceof Error ? e.message : e);
          if (attempt === 1) return null;
        }
      }
      return null;
    };

    const groupedSpecs = new Map<string, BannerTaskSpec[]>();
    taskSpecs.forEach((spec) => {
      const key = `${spec.assetPlan.fmt.width}x${spec.assetPlan.fmt.height}`;
      groupedSpecs.set(key, [...(groupedSpecs.get(key) || []), spec]);
    });

    const generateGroup = async (specs: BannerTaskSpec[]): Promise<Array<{ raw: string; assetPlan: BannerAssetPlan }>> => {
      if (specs.length <= 1) {
        const single = await generateOne(specs[0]);
        return single ? [single] : [];
      }

      try {
        const first = specs[0];
        const imagePartGroups = await Promise.all(specs.map((spec) => buildImagePartsForPlan(spec.assetPlan, assetBaseUrl)));
        const imageParts = imagePartGroups.flat().slice(0, 12);
        const systemPrompt = buildBannerGroupSystemPrompt(first.assetPlan.fmt, first.assetPlan.category, first.seedArchetype, first.density, specs.length);
        const userPrompt = buildBannerGroupUserPrompt(data, fontSection, brandName, specs);
        const raw = await callGemini(systemPrompt, userPrompt, payload.accountType, imageParts);
        const snippets = extractBannerSnippets(raw);
        const used = new Set<number>();
        const results: Array<{ raw: string; assetPlan: BannerAssetPlan }> = [];

        for (const spec of specs) {
          let index = snippets.findIndex((snippet, i) => !used.has(i) && bannerMatchesPlan(snippet, spec.assetPlan));
          if (index < 0) index = snippets.findIndex((_snippet, i) => !used.has(i));
          const snippet = index >= 0 ? snippets[index] : "";
          if (snippet) used.add(index);

          const missingAssets = missingRequiredAssetUrls(snippet, spec.assetPlan);
          const missingAbsolute = missingAbsoluteLayerRequirements(snippet, spec.assetPlan);
          if (snippet && missingAssets.length === 0 && missingAbsolute.length === 0) {
            results.push({ raw: snippet, assetPlan: spec.assetPlan });
            continue;
          }

          const fallback = await generateOne(spec);
          if (fallback) results.push(fallback);
        }

        return results;
      } catch (e) {
        console.warn(`[ChiliForge] Grouped generation failed:`, e instanceof Error ? e.message : e);
        const settledSingles = await runWithConcurrency(specs.map((spec) => () => generateOne(spec)), 2);
        return settledSingles
          .filter((r): r is PromiseFulfilledResult<{ raw: string; assetPlan: BannerAssetPlan } | null> => r.status === "fulfilled")
          .map((r) => r.value)
          .filter((value): value is { raw: string; assetPlan: BannerAssetPlan } => value !== null);
      }
    };

    const settled = await runWithConcurrency(Array.from(groupedSpecs.values()).map((specs) => () => generateGroup(specs)), 2);
    const results = settled
      .filter((r): r is PromiseFulfilledResult<Array<{ raw: string; assetPlan: BannerAssetPlan }>> =>
        r.status === "fulfilled" && r.value !== null)
      .flatMap(r => r.value);
    const allBanners: string[] = [];
    for (const { raw, assetPlan } of results) {
      const snippet = extractBannerSnippet(raw);
      if (snippet?.html) allBanners.push(enforceBannerAssets(snippet.html, assetPlan));
    }

    if (!allBanners.length) {
      throw new Error("O Gemini não retornou nenhum banner válido. Tente novamente.");
    }

    // Build Google Fonts link from brief fonts (banners reference font-family by name via inline styles)
    const fontFamilies = [data.headingFont, data.bodyFont].filter((f): f is string => Boolean(f));
    const fontLinkHtml = fontFamilies.length
      ? `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${fontFamilies.map(f => `family=${encodeURIComponent(f)}:wght@400;500;600;700;800;900`).join("&")}&display=swap">`
      : "";

    const combinedHtml = `<!DOCTYPE html>\n<html><head><meta charset="UTF-8">\n${fontLinkHtml}\n<style>*{box-sizing:border-box}body{margin:0;padding:0}</style>\n</head><body>\n${allBanners.join("\n")}\n</body></html>`;
    const finalHtml = injectAdSafetyCss(combinedHtml);

    if (!finalHtml.includes("ad-banner")) {
      throw new Error("O Gemini retornou uma resposta vazia ou inválida. Tente novamente.");
    }

    const totalCreatives = formats.length * variantCount;

    return new Response(JSON.stringify({
      html: finalHtml,
      css: "",
      js: "",
      assets: extractAssets(finalHtml),
      slug: `ad-creative-${slugify(brandName)}`,
      creativeCount: totalCreatives,
      formats,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : "Failed to generate ad creatives",
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
