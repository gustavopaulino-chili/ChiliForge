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
  mode?: "full" | "plan" | "render" | "unified" | "interpret" | "interpret_image" | "compose" | "copy";
  format?: AdFormat;
  generateAsImage?: boolean;
  geminiApiKey?: string;
  agentConfig: AgentConfig;
  globalStoreName?: string;
  globalGuidelinesData?: unknown;
  guidelinesStoreData?: unknown;
  globalReferenceStoreName?: string;
  imageReferenceStoreName?: string;
  companyStoreName: string;
  companyStoreData?: unknown;
  campaignGoodExamplesStore?: string;
  examplesStoreData?: unknown;
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
const PLAN_MODEL_CHAIN   = ["gemini-2.5-flash-lite", "gemini-2.5-flash"];
const RENDER_MODEL_CHAIN = ["gemini-2.5-flash"];
const MODEL_CHAIN        = ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.5-flash-lite"];

const COPY_SYSTEM_PROMPT = `You are an expert direct-response ad copywriter. Generate concise, conversion-focused copy based on campaign data. Output ONLY valid JSON matching the schema.
LANGUAGE: Write ALL copy (headline, subheadline, CTA, body) in the language explicitly stated in the campaign data, or — if none is stated — in the SAME language as the campaign data itself (business name, value prop, offer). Never switch or mix languages. A CTA in the wrong language is a failed creative.
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

type GenerateAdImageOptions = {
  maxAttempts?: number;
  timeoutMs?: number;
  singleConfig?: boolean;
  // Optional per-generation cost accumulator (summed across all image calls in one request).
  costAcc?: { usd: number; images: number };
};

// Save a base64 data URL to Supabase Storage (public bucket "ad-images") and return its public
// URL, so a generated image is NEVER carried as base64 through Edge -> PHP -> browser. Falls back
// to the original data URL on ANY failure (missing bucket/env/network) — never breaks generation.
// Uploads a base64 data URL to Supabase Storage (ad-images) and returns its public URL.
// strict=true (used by COMPOSE): NEVER returns base64 — throws on any failure, so a base64
// background can never be embedded/persisted in the banner HTML. strict=false (image mode /
// frontend): returns the original base64 as a fallback (it is converted to a PNG file later).
async function uploadImageToStorage(dataUrl: string | null, strict = false, storageKey?: string): Promise<string | null> {
  if (!dataUrl || !dataUrl.startsWith("data:")) return dataUrl;
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) { if (strict) throw new Error("uploadImageToStorage: input is not a base64 data URL"); return dataUrl; }
  let reason = "";
  try {
    const mime = m[1];
    const ext = (mime.split("/")[1] || "png").split("+")[0];
    const b64 = m[2];
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const e = (globalThis as any).Deno?.env;
    const base = e?.get("SUPABASE_URL");
    // Key priority for Storage auth:
    //  1) storageKey from PHP (when called via agents_call_edge_function)
    //  2) STORAGE_SERVICE_ROLE_KEY custom secret (frontend-direct path: the app
    //     calls agents-ads directly, so no PHP storageKey is present)
    //  3) auto-injected SUPABASE_SERVICE_ROLE_KEY (new non-JWT format; Storage
    //     rejects it with "Invalid Compact JWS" — last-resort only)
    // The legacy service-role JWT (eyJ...) is the one Storage accepts.
    const key = (storageKey && storageKey.trim())
      ? storageKey.trim()
      : (e?.get("STORAGE_SERVICE_ROLE_KEY") || e?.get("SUPABASE_SERVICE_ROLE_KEY"));
    if (!base || !key) {
      reason = `missing env (SUPABASE_URL=${Boolean(base)}, key=${Boolean(key)})`;
    } else {
      const path = `compose/${bytes.length}-${b64.slice(0, 32).replace(/[^a-zA-Z0-9]/g, "")}.${ext}`;
      const res = await fetch(`${base}/storage/v1/object/ad-images/${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": mime, "x-upsert": "true" },
        body: bytes,
      });
      if (res.ok) return `${base}/storage/v1/object/public/ad-images/${path}`;
      reason = `upload HTTP ${res.status} — ${(await res.text().catch(() => "")).slice(0, 200)}`;
    }
  } catch (err) {
    reason = `exception — ${err instanceof Error ? err.message : String(err)}`;
  }
  if (strict) throw new Error(`uploadImageToStorage failed (no base64 fallback in compose): ${reason}`);
  return dataUrl;
}

// Text-overlay recommendation the image model returns ALONGSIDE the background image
// (response text part). Used to fine-tune the HTML overlay; always optional (fallback safe).
type ComposeTextRec = { headlineScale?: number; align?: "left" | "center" | "right" };

function extractTextFromGeminiPayload(data: any): string {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts.map((p: any) => (typeof p?.text === "string" ? p.text : "")).join(" ");
}

// Lenient parse — the image model is unreliable at JSON, so we extract the first {...}
// after the CF_TEXT_REC marker (or anywhere) and clamp the values.
function parseComposeTextRec(text: string): ComposeTextRec | null {
  if (!text) return null;
  const marker = text.indexOf("CF_TEXT_REC");
  const slice = marker >= 0 ? text.slice(marker) : text;
  const start = slice.indexOf("{");
  const end = start >= 0 ? slice.indexOf("}", start) : -1;
  if (start < 0 || end < 0) return null;
  try {
    const obj = JSON.parse(slice.slice(start, end + 1));
    const rec: ComposeTextRec = {};
    const s = Number(obj.headlineScale);
    if (Number.isFinite(s)) rec.headlineScale = Math.min(1.4, Math.max(0.7, s));
    if (obj.align === "left" || obj.align === "center" || obj.align === "right") rec.align = obj.align;
    return rec.headlineScale !== undefined || rec.align ? rec : null;
  } catch {
    return null;
  }
}

async function generateAdImage(
  prompt: string,
  refImages: Array<{ data: string; mimeType: string }>,
  apiKey: string,
  aspectRatio?: string,
  opts: GenerateAdImageOptions = {},
): Promise<{ url: string; rec: ComposeTextRec | null } | null> {
  const { maxAttempts = 3, timeoutMs = 100000, singleConfig = false } = opts;
  const parts: unknown[] = [{ text: prompt }];
  for (const img of refImages) {
    parts.push({ inline_data: { mime_type: img.mimeType, data: img.data } });
  }
  let lastError = "";
  for (const model of GEMINI_IMAGE_MODELS) {
    const primaryConfig = {
      responseModalities: ["TEXT", "IMAGE"],
      ...(aspectRatio ? { imageConfig: { aspectRatio } } : {}),
    };
    const configVariants = singleConfig
      ? [primaryConfig]
      : [primaryConfig, { responseModalities: ["TEXT", "IMAGE"] }];
    for (const generationConfig of configVariants) {
      let attempt = 0;
      while (attempt < maxAttempts) {
        try {
          const res = await fetch(buildImageApiUrl(model, apiKey), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts }],
              generationConfig,
            }),
            signal: AbortSignal.timeout(timeoutMs),
          });
          const bodyText = await res.text();
          if (!res.ok) {
            // Depleted prepay credits / quota come back as 429 RESOURCE_EXHAUSTED.
            // Retrying other models/configs/formats is pointless and just burns calls —
            // abort the whole generation immediately with a clear marker.
            if (res.status === 429 && /credit|deplet|RESOURCE_EXHAUSTED|quota|billing/i.test(bodyText)) {
              throw new Error("GEMINI_CREDITS_DEPLETED");
            }
            const isTransient = res.status === 503 || res.status === 502 || res.status === 529;
            if (isTransient && attempt < maxAttempts - 1) {
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
          const u = (data as any)?.usageMetadata ?? (data as any)?.usage_metadata ?? {};
          try {
            console.log(`[token-usage] IMAGE model=${model} inputImgs=${parts.length - 1} prompt=${u.promptTokenCount ?? "?"} candidates=${u.candidatesTokenCount ?? "?"} total=${u.totalTokenCount ?? "?"}`);
          } catch (_) { /* never break generation on logging */ }
          const url = data ? extractImageDataUrl(data) : null;
          if (url) {
            try {
              const inTok = Number(u.promptTokenCount ?? u.prompt_token_count ?? 0);
              const inUsd = (inTok / 1_000_000) * pricingFor(model).in;
              const total = inUsd + IMAGE_PRICE_PER_IMAGE;
              console.log(`[cost-estimate] IMAGE model=${model} in=${inTok}tok($${inUsd.toFixed(5)}) image=1($${IMAGE_PRICE_PER_IMAGE.toFixed(3)}) ~= $${total.toFixed(5)}`);
              if (opts.costAcc) { opts.costAcc.usd += total; opts.costAcc.images += 1; }
            } catch (_) { /* logging must never break generation */ }
            return { url, rec: parseComposeTextRec(extractTextFromGeminiPayload(data)) };
          }
          lastError = `Gemini image ${model} returned no image part: ${summarizeGeminiImagePayload(data)}`;
          break;
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          if (msg === "GEMINI_CREDITS_DEPLETED") throw error; // fail fast, don't retry
          lastError = msg;
          // A timeout/abort is usually a transient hang — a fresh request normally
          // returns fast. Retry within the same model instead of failing the batch
          // (the old code broke immediately, so one slow image killed the creative).
          if (/timed out|abort/i.test(msg) && attempt < maxAttempts - 1) {
            await new Promise((r) => setTimeout(r, 2000 + attempt * 2000));
            attempt++;
            continue;
          }
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


// Pure-image mode facts: all assets are attached as inline reference images (the model draws
// the whole ad, including text). Restored from the legacy image pipeline for the external API.
function buildCampaignFactsForImage(data: AgentsAdsPayload["campaignData"]): string {
  const full = buildCampaignFacts(data);
  return full.replace(
    /\nAssets:\n[\s\S]*?(?=\n\n|$)/,
    "\nAssets: All logo, product, and background assets are attached as INLINE REFERENCE IMAGES — use them directly from the attached images. NEVER render URLs, domain names, file paths, or any URL string as visible text in the image.",
  );
}

function buildCampaignFactsForCompose(data: AgentsAdsPayload["campaignData"]): string {
  const full = buildCampaignFacts(data);
  // In compose mode the logo is NOT passed as a reference image — it is composited in HTML.
  // Product and background images may still be attached as style references.
  return full.replace(
    /\nAssets:\n[\s\S]*?(?=\n\n|$)/,
    "\nAssets: Product and background reference images may be attached. The brand logo is NOT attached — do not attempt to draw it. NEVER render any URL, domain name, or file path as visible text.",
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
  if ((data as any).businessDescription) lines.push(`Business: ${String((data as any).businessDescription).slice(0, 300)}`);
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

function compactStoreData(value: unknown, maxChars = 6000): string {
  if (value == null) return "";
  const raw = typeof value === "string" ? value : JSON.stringify(value);
  return (raw || "").replace(/\s+/g, " ").trim().slice(0, maxChars);
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


const INTERPRET_SYSTEM_PROMPT = `You are a brand design strategist and art director. Your task:
1. Query company store — extract: primary hex, secondary hex, accent hex, exact font family names and weights available (e.g. Roboto 900/700/400), logo style, brand voice.
2. Query global store — extract: HTML/CSS layout rules, spacing guidelines, visual quality standards.
3. Query reference store — extract abstract structural patterns ONLY (composition, CTA zone, text-to-image ratio). FORBIDDEN from reference: colors, fonts, logos, brand names — these are COMPETITOR ADS.
4. For EACH format write a spec using this EXACT format:

BRAND_CSS_VARS: --primary:#HEX;--secondary:#HEX;--accent:#HEX;--font-headline:'Family',sans-serif;--fw-headline:900;--fw-body:400;--fw-cta:700
BRAND_FONT_URL: https://fonts.googleapis.com/css2?family=FAMILY:wght@400;700;900&display=swap
---
Layout: [specific CSS technique, e.g. "clip-path:polygon(0 0,60% 0,40% 100%,0 100%) diagonal overlay on left panel"]
Text: [typography only — sizes, weights, shadows — e.g. "headline 36px fw-900, text-shadow:0 2px 8px rgba(0,0,0,.7)" — NO copy words]
Assets: [logo/product/bg positions with % sizes and object-fit rules]
CTA: [visual design only — bg-color hex, text-color hex, border-radius, box-shadow, anchor position — NO button label words]
Shapes: [geometric accents if any — clip-path values, max 20% of product image coverage]
Anti-clone: [how this format differs from ALL other formats in this batch]

⚠️ COPY RESTRICTION: Do NOT write any headline text, CTA button words, body copy, or subheadline content in any spec field. Describe VISUAL DESIGN PARAMETERS ONLY. The actual copy is locked externally and will be enforced at render time.

Output ONLY valid JSON, no markdown:
{"batchSpecs":[{"label":"...","spec":"BRAND_CSS_VARS: ...\\nBRAND_FONT_URL: ...\\n---\\nLayout: ..."},...]}

Reference isolation: FORBIDDEN in specs — any color, font, logo, imagery from reference ads. Brand identity = company store + campaign facts ONLY.`.trim();


const INTERPRET_IMAGE_SYSTEM_PROMPT = `You are a visual art director specializing in raster advertising images. Your task:
1. Query company store — extract: exact primary hex, secondary hex, accent hex, brand personality/tone, logo description, key brand visual rules.
2. Query global image guidelines store — extract: composition rules, quality standards, visual hierarchy principles for image ads.
3. Query image reference store — extract COMPOSITION PATTERNS ONLY (layout structure, focal point placement, text zone, product placement). FORBIDDEN from reference: colors, fonts, logos, brand names — these are COMPETITOR ADS.
4. For EACH format write a visual spec using this EXACT format:

Colors: primary #HEX, secondary #HEX, accent #HEX, text #HEX
---
Layout: [visual composition, e.g. "diagonal split — dark brand panel left 40%, product right 60%"]
Hero: [product/hero visual treatment — composition style, placement zone, size, lighting mood — inspired by brand reference images, not copied]
Logo: [placement zone, approximate size ratio, color version — e.g. "top-left, ~20% width, white version on dark bg"]
Headline: [typography only — size relative to canvas, weight, color, placement, treatment — NO copy words]
Subheadline: [if applicable — typography only — size, color, placement — NO copy words]
CTA: [shape, bg-color hex, text-color hex, border-radius, anchor position — NO button label words]
Mood: [2-3 adjectives describing the overall visual feel]
Anti-clone: [how this format's composition differs from ALL other formats in this batch]

LAYOUT FREEDOM: Choose varied text locations. Do not put every headline/subheadline/CTA in the same area. Prefer the strongest layout from: hero-full-bleed, diagonal-split, top-image-bottom-text, left-panel-right-image, centered-minimal, bold-headline-first, frame-product, top-left-editorial, top-right-editorial, bottom-right-editorial, vertical-story-stack, floating-islands. The Layout line should include one of these keys.
SOCIAL CTA RULE: For social/story/reels/feed/post formats, CTA must be organic text placement only. Never specify a button, pill, rectangle, or clickable UI shape.

⚠️ COPY RESTRICTION: Do NOT write any headline text, CTA button words, body copy, or subheadline content in any spec field. Describe VISUAL DESIGN PARAMETERS ONLY. The actual copy is locked externally.

Output ONLY valid JSON, no markdown:
{"batchSpecs":[{"label":"...","spec":"Colors: primary #HEX...\\n---\\nLayout: ..."},...]}

Reference isolation: FORBIDDEN in specs — any color, font, logo, imagery from reference ads. Brand identity = company store + campaign facts ONLY.`.trim();

function buildInterpretImagePrompt(campaignFacts: string, formats: AdFormat[], formatNotes?: Record<string, string>): string {
  const formatList = buildFormatsList(formats, formatNotes);

  const layoutOptions = LAYOUT_KEYS.map((key) => `- ${key}`).join("\n");
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
    "=== MANDATORY COMPOSITION ASSIGNMENT (each format must use a different layout) ===",
    compositionAssignments,
    "Full composition descriptions for reference:",
    COMPOSITION_POOL.join("\n"),
    "",
    "=== LAYOUT FREEDOM OVERRIDE ===",
    "Treat the assignment above as inspiration, not a prison. You are the art director: choose the strongest layout for each format from the allowed keys below and vary text placement across the batch.",
    layoutOptions,
    "Do not default every format to bottom text. Use top-left, top-right, bottom-right, vertical story stack, floating islands, split layouts, or centered layouts when they fit the brand and format.",
    "The Layout line must include one allowed layout key exactly as written.",
    "For social formats (Instagram/Facebook/TikTok/LinkedIn/social/story/reels/feed/post/shorts), CTA must be organic text, never a button/pill/rectangle.",
    "",
    "For each format: follow EXACTLY the spec format from the system prompt.",
    "Colors line must include all key hex values from the brand.",
    "Layout line must describe the visual composition in plain language (no CSS).",
    "Hero line: describe the visual treatment/style inspired by the brand reference images — do NOT copy them, create original compositions.",
    "Headline/Subheadline lines: typography parameters only (size, weight, color, placement) — do NOT include actual headline words or copy.",
    "CTA line: visual shape/color/position only — do NOT include CTA button label words.",
    "Mood line must capture the emotional tone of the ad.",
    "Anti-clone must describe how this format's layout differs from every other format in the batch.",
    "Reference image store: extract structural patterns ONLY — no brand identity elements.",
    "⚠️ COPY RESTRICTION: do NOT write any ad copy words in any spec field. No headline text, no CTA labels, no body copy.",
    "",
    "Output valid JSON only: {\"batchSpecs\":[{\"label\":\"...\",\"spec\":\"...\"},...]}",
  ].filter((line) => line !== undefined).join("\n");
}

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
    "Text line: typography parameters only (font-size, font-weight, text-shadow) — do NOT include headline words or ad copy.",
    "CTA line: visual design only (bg color, text color, border-radius, position) — do NOT include button label words.",
    "Reference principles from reference store: structural patterns only, NO brand identity elements.",
    "⚠️ COPY RESTRICTION: do NOT write any ad copy words in any spec field. No headline text, no CTA labels, no body copy.",
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

function buildPlanPrompt(
  campaignFacts: string,
  formatGroups: AdFormat[][],
  layoutSeed: string,
  retrievalHints: string,
  referenceGuide: string,
  formatNotes?: Record<string, string>,
  hasApprovedExamples = false,
  guidelinesStoreData?: unknown,
  companyStoreData?: unknown,
  examplesStoreData?: unknown,
): string {
  const groupsSummary = formatGroups.map((g) => {
    const cat = deriveFormatCategory(g[0]);
    const items = buildFormatsList(g, formatNotes);
    return `Group "${cat}" (${g.length} format${g.length > 1 ? "s" : ""}):\n${items}`;
  }).join("\n\n");

  const groupNames = formatGroups.map((g) => deriveFormatCategory(g[0]));
  const guidelinesStoreBlock = compactStoreData(guidelinesStoreData, 8000);
  const companyStoreBlock = compactStoreData(companyStoreData);
  const examplesStoreBlock = compactStoreData(examplesStoreData);
  return [
    "You are a senior ad creative director. Create a concise creative plan. Plain text only — no HTML.",
    "",
    buildSourceOrchestration(hasApprovedExamples),
    "",
    guidelinesStoreBlock ? `=== GLOBAL ADS GUIDELINES DATA ===\n${guidelinesStoreBlock}` : "",
    companyStoreBlock ? `=== COMPANY STORE DATA ===\n${companyStoreBlock}` : "",
    examplesStoreBlock ? `=== APPROVED EXAMPLES STORE DATA ===\n${examplesStoreBlock}` : "",
    guidelinesStoreBlock || companyStoreBlock || examplesStoreBlock ? "" : "",
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
    "STEP 1 — Guidelines pass: before planning each group, resolve the applicable global ads guidelines from GLOBAL ADS GUIDELINES DATA and/or File Search for the selected objective, funnel, style, tone, urgency, logo strategy, image fallback, A/B focus, platform, format, and dimensions.",
    "STEP 2 — Write guidelineApplications as concrete rules you applied. Include at least one format/layout guideline per group, and include source labels when available.",
    "STEP 3 — For each format group, write one section/JSON group named with platform-format style (e.g. social-story, display-banner, display-medium-rectangle).",
    "In each group cover: the creative thread (one specific concept tying all formats in this group), the composition approach, which guideline drove the layout, which asset goes at which z-index layer, CTA style and placement, and how layouts should vary across the formats in the group.",
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
    `<div style="position:absolute;inset:0;background:rgba(0,0,0,.42);z-index:1;"></div>`,
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

// ── COMPOSE MODE HELPERS ──────────────────────────────────────────────────────

const LAYOUT_KEYS = [
  "hero-full-bleed",
  "diagonal-split",
  "top-image-bottom-text",
  "left-panel-right-image",
  "centered-minimal",
  "bold-headline-first",
  "frame-product",
  "top-left-editorial",
  "top-right-editorial",
  "bottom-right-editorial",
  "vertical-story-stack",
  "floating-islands",
] as const;
const BACKGROUND_DIRECTIONS = [
  "cinematic close-up crop with shallow depth, layered foreground/background, dynamic diagonal motion",
  "editorial product scene with unexpected angle, dramatic side lighting, tactile materials, premium shadows",
  "abstract brand world with oversized shapes, depth gradients, texture, and one strong focal path",
  "lifestyle environment detail shot, off-center subject, natural negative space, atmospheric color wash",
  "macro texture and product-inspired forms, asymmetric composition, high-end studio lighting",
  "bold graphic composition with large scale contrast, motion blur accents, and a clear visual rhythm",
  "immersive scene with foreground framing, background depth, and brand-color light leaks",
] as const;

function buildComposeCssVars(data: AgentsAdsPayload["campaignData"]): string {
  const parts: string[] = [];
  if (data.primaryColor) parts.push(`--primary:${data.primaryColor}`);
  const secondary = data.secondaryColor || data.accentColor;
  if (secondary) parts.push(`--secondary:${secondary}`);
  if (data.accentColor) parts.push(`--accent:${data.accentColor}`);
  const font = data.customHeadingFontName || data.headingFont;
  if (font) parts.push(`--font-headline:'${font}',sans-serif`);
  return parts.join(";");
}

// Derives brand spec directly from campaignData (already enriched by PHP with company
// colors/fonts/style). No API call needed — avoids a separate Supabase round-trip.
function buildComposeBrandSpec(data: AgentsAdsPayload["campaignData"]): string {
  const cssVars = buildComposeCssVars(data);
  const styleParts: string[] = [];
  if (data.preferredStyle)   styleParts.push(String(data.preferredStyle));
  if (data.brandPersonality) styleParts.push(String(data.brandPersonality));
  if (data.toneOfVoice)      styleParts.push(String(data.toneOfVoice));
  if (data.brandKeywords)    styleParts.push(String(data.brandKeywords).split(/[,;]/)[0]?.trim() || "");
  const visual = styleParts.filter(Boolean).join(", ").slice(0, 120);

  const font = data.customHeadingFontName || data.headingFont;
  const fontUrl = font
    ? `https://fonts.googleapis.com/css2?family=${encodeURIComponent(String(font)).replace(/%20/g, "+")}:wght@400;700;900&display=swap`
    : "";

  return [
    cssVars ? `BRAND_CSS_VARS: ${cssVars}` : "",
    fontUrl ? `BRAND_FONT_URL: ${fontUrl}` : "",
    visual  ? `BRAND_VISUAL: ${visual}` : "",
  ].filter(Boolean).join("\n");
}

const LAYOUT_SPACE_GUIDANCE: Record<string, string> = {
  "diagonal-split":      "Left 48% of the image will be covered by a dark text panel — fill that zone with solid brand color or deep tone. Product/hero goes on the right 52%.",
  "hero-full-bleed":     "Bottom 35% will have a gradient overlay + text — keep the product/hero in the upper half and let colors naturally darken toward the bottom.",
  "top-image-bottom-text": "Bottom 45% will be covered by a brand-color text panel — focus the product/hero in the top 55%. Keep the bottom zone visually simple.",
  "left-panel-right-image": "Left 42% will be covered by a solid panel overlay — place brand color or pattern there. Product hero goes on the right 58%.",
  "centered-minimal":    "Center focus on the product. Text will appear top and bottom — leave those zones slightly darker or plain for legibility.",
  "bold-headline-first": "Top 40% and bottom 20% will carry text overlay — darken those zones naturally. Product hero occupies the middle 40%.",
  "frame-product":       "Edges will have a geometric frame overlay — center the product. Keep corners slightly darker so framing text is legible.",
};

const CREATIVE_SPACE_GUIDANCE: Record<string, string> = {
  "diagonal-split":      "Text will use the left side. Keep that side lower-detail, but not a flat empty panel; use subtle texture, light falloff, or abstract brand shapes. Put the strongest subject energy toward the right.",
  "hero-full-bleed":     "Text will likely use a lower or corner area. Let the image remain cinematic and full-bleed, with the busiest detail away from the text area.",
  "top-image-bottom-text": "Text will sit near the bottom. Put the visual hook in the upper area, while the lower area can contain soft texture, depth, or color wash.",
  "left-panel-right-image": "Text will use the left side. Keep the left side readable with low-detail brand atmosphere, not a blank block. Put subject/product energy on the right.",
  "centered-minimal":    "Text may sit at top and bottom. Use a strong central visual idea with clean surrounding air, avoiding tiny busy details behind text zones.",
  "bold-headline-first": "Text will use top and bottom areas. Make the middle visually expressive, with reduced micro-detail behind the headline and CTA areas.",
  "frame-product":       "Text may sit near edges. Use an inventive framed or layered scene, with readable edges and a stronger center focal area.",
  "top-left-editorial":  "Text will sit in the top-left quadrant. Keep that area lower-detail with atmospheric texture, while the strongest visual subject can sit bottom-right or center-right.",
  "top-right-editorial": "Text will sit in the top-right quadrant. Keep that area readable with soft contrast, while visual energy can sit left or lower-left.",
  "bottom-right-editorial": "Text will sit in the bottom-right quadrant. Keep that area calm and contrast-friendly, with visual subject energy left or upper-left.",
  "vertical-story-stack": "Text will use a vertical story-style stack with logo near top, headline around upper/mid canvas, and CTA near bottom. Keep these lanes readable without making them empty.",
  "floating-islands":    "HTML elements will be spread across separate visual islands. Keep multiple calm zones available, with expressive detail between them.",
};

type LayoutPosition = {
  logo: string;
  headline: string;
  sub: string;
  cta: string;
};

const LAYOUT_POSITIONS: Record<string, LayoutPosition> = {
  "diagonal-split": {
    logo:     "top:6%;left:6%;width:30%;max-height:14%;",
    headline: "top:28%;left:6%;right:54%;",
    sub:      "top:52%;left:6%;right:54%;",
    cta:      "bottom:10%;left:6%;",
  },
  "hero-full-bleed": {
    logo:     "top:5%;left:5%;width:28%;max-height:12%;",
    headline: "bottom:28%;left:5%;right:5%;",
    sub:      "bottom:17%;left:5%;right:5%;",
    cta:      "bottom:6%;left:5%;",
  },
  "top-image-bottom-text": {
    logo:     "bottom:43%;left:5%;width:28%;max-height:12%;",
    headline: "bottom:24%;left:5%;right:5%;",
    sub:      "bottom:13%;left:5%;right:5%;",
    cta:      "bottom:4%;left:5%;",
  },
  "left-panel-right-image": {
    logo:     "top:6%;left:4%;width:30%;max-height:14%;",
    headline: "top:28%;left:4%;right:60%;",
    sub:      "top:50%;left:4%;right:60%;",
    cta:      "bottom:10%;left:4%;",
  },
  "centered-minimal": {
    logo:     "top:5%;left:50%;transform:translateX(-50%);width:28%;max-height:12%;",
    headline: "top:20%;left:5%;right:5%;text-align:center;",
    sub:      "top:44%;left:10%;right:10%;text-align:center;",
    cta:      "bottom:8%;left:50%;transform:translateX(-50%);",
  },
  "bold-headline-first": {
    logo:     "top:5%;right:5%;width:22%;max-height:10%;",
    headline: "top:10%;left:5%;right:5%;",
    sub:      "top:44%;left:5%;right:5%;",
    cta:      "bottom:6%;left:5%;",
  },
  "frame-product": {
    logo:     "top:5%;left:50%;transform:translateX(-50%);width:30%;max-height:14%;",
    headline: "bottom:22%;left:5%;right:5%;text-align:center;",
    sub:      "bottom:13%;left:5%;right:5%;text-align:center;",
    cta:      "bottom:4%;left:50%;transform:translateX(-50%);",
  },
  "top-left-editorial": {
    logo:     "top:5%;left:5%;width:26%;max-height:11%;",
    headline: "top:18%;left:5%;right:42%;",
    sub:      "top:42%;left:5%;right:48%;",
    cta:      "top:68%;left:5%;",
  },
  "top-right-editorial": {
    logo:     "top:5%;right:5%;width:24%;max-height:11%;",
    headline: "top:18%;left:44%;right:5%;text-align:right;",
    sub:      "top:42%;left:48%;right:5%;text-align:right;",
    cta:      "top:68%;right:5%;",
  },
  "bottom-right-editorial": {
    logo:     "top:5%;left:5%;width:24%;max-height:11%;",
    headline: "bottom:25%;left:42%;right:5%;text-align:right;",
    sub:      "bottom:13%;left:48%;right:5%;text-align:right;",
    cta:      "bottom:5%;right:5%;",
  },
  "vertical-story-stack": {
    logo:     "top:5%;left:6%;width:24%;max-height:10%;",
    headline: "top:16%;left:6%;right:16%;",
    sub:      "top:58%;left:6%;right:24%;",
    cta:      "bottom:6%;left:6%;",
  },
  "floating-islands": {
    logo:     "top:5%;left:5%;width:24%;max-height:10%;",
    headline: "top:16%;left:5%;right:38%;",
    sub:      "bottom:18%;left:40%;right:5%;text-align:right;",
    cta:      "bottom:6%;right:5%;",
  },
};

function detectCompositionLayout(spec: string): string {
  const s = spec.toLowerCase();
  if (s.includes("diagonal-split") || s.includes("diagonal split")) return "diagonal-split";
  if (s.includes("top-image-bottom-text") || s.includes("top image bottom")) return "top-image-bottom-text";
  if (s.includes("left-panel-right-image") || s.includes("left panel")) return "left-panel-right-image";
  if (s.includes("centered-minimal") || s.includes("centered minimal")) return "centered-minimal";
  if (s.includes("bold-headline-first") || s.includes("bold headline")) return "bold-headline-first";
  if (s.includes("frame-product") || s.includes("frame product")) return "frame-product";
  if (s.includes("top-left-editorial") || s.includes("top left editorial") || s.includes("top-left")) return "top-left-editorial";
  if (s.includes("top-right-editorial") || s.includes("top right editorial") || s.includes("top-right")) return "top-right-editorial";
  if (s.includes("bottom-right-editorial") || s.includes("bottom right editorial") || s.includes("bottom-right")) return "bottom-right-editorial";
  if (s.includes("vertical-story-stack") || s.includes("vertical story") || s.includes("story stack")) return "vertical-story-stack";
  if (s.includes("floating-islands") || s.includes("floating islands") || s.includes("visual islands")) return "floating-islands";
  return "hero-full-bleed";
}

function resolveCompositionLayout(spec: string, layoutKey?: string, forceLayout?: boolean): string {
  // forceLayout=true bypasses spec detection — used for A/B visual variants so
  // each variant gets its own distinct layout regardless of what the spec says.
  if (forceLayout && layoutKey) return layoutKey;

  const s = spec.toLowerCase();
  const hasExplicitLayout = [
    "diagonal-split", "diagonal split",
    "top-image-bottom-text", "top image bottom",
    "left-panel-right-image", "left panel",
    "centered-minimal", "centered minimal",
    "bold-headline-first", "bold headline",
    "frame-product", "frame product",
    "top-left-editorial", "top left editorial", "top-left",
    "top-right-editorial", "top right editorial", "top-right",
    "bottom-right-editorial", "bottom right editorial", "bottom-right",
    "vertical-story-stack", "vertical story", "story stack",
    "floating-islands", "floating islands", "visual islands",
    "hero-full-bleed", "hero full bleed",
  ].some((token) => s.includes(token));

  return hasExplicitLayout ? detectCompositionLayout(spec) : (layoutKey ?? "hero-full-bleed");
}

function extractCssVarColor(cssVars: string, varName: string): string | null {
  const m = new RegExp(`${varName.replace("-", "\\-")}:\\s*(#[0-9a-fA-F]{3,8})`).exec(cssVars);
  return m ? m[1] : null;
}

function extractCssVarFont(cssVars: string): string | null {
  const m = /--font-(?:headline|body):\s*([^;]+)/.exec(cssVars);
  return m ? m[1].trim() : null;
}

function hexLuminance(hex: string): number {
  const h = hex.replace("#", "").padEnd(6, "0");
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const lin = (c: number) => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastTextColor(bgHex: string): { color: string; shadow: string } {
  try {
    return hexLuminance(bgHex) > 0.35
      ? { color: "#111111", shadow: "0 1px 4px rgba(255,255,255,0.55)" }
      : { color: "#ffffff", shadow: "0 2px 10px rgba(0,0,0,0.50)" };
  } catch {
    return { color: "#ffffff", shadow: "0 2px 10px rgba(0,0,0,0.50)" };
  }
}

function isSocialFormat(format: AdFormat): boolean {
  const haystack = [
    format.platform,
    format.format,
    format.label,
  ].map((value) => String(value || "").toLowerCase()).join(" ");

  return /\b(instagram|facebook|tiktok|linkedin|pinterest|twitter|x|youtube|snapchat|social|story|stories|reel|reels|feed|post|shorts)\b/.test(haystack);
}

function normalizeSpecLabel(value: unknown): string {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function specForFormat(allSpecs: string, format: AdFormat): string {
  const source = String(allSpecs || "").trim();
  if (!source.includes("[") || !source.includes("]")) return source;

  const blocks = source.split(/\n\s*\n(?=\[[^\]]+\]\s*\n)/g);
  const candidates = [
    format.label,
    `${format.width}x${format.height}`,
    `${format.width}×${format.height}`,
    format.format,
    format.platform,
  ].map(normalizeSpecLabel).filter(Boolean);

  for (const block of blocks) {
    const match = block.match(/^\s*\[([^\]]+)\]\s*\n([\s\S]*)$/);
    if (!match) continue;
    const label = normalizeSpecLabel(match[1]);
    if (candidates.some((candidate) => candidate === label || label.includes(candidate) || candidate.includes(label))) {
      return match[2].trim();
    }
  }

  const first = blocks[0]?.replace(/^\s*\[[^\]]+\]\s*\n/, "").trim();
  return first || source;
}

function buildBackgroundPrompt(
  spec: string,
  campaignFactsImg: string,
  format: AdFormat,
  aspectRatio: string,
  layoutKey?: string,
  visualDirection?: string,
  forceLayout?: boolean,
  bgSource: string = "shapes",
  hasRefImages: boolean = false,
): string {
  const layout = resolveCompositionLayout(spec, layoutKey, forceLayout);
  const spaceGuide = CREATIVE_SPACE_GUIDANCE[layout] ?? CREATIVE_SPACE_GUIDANCE["hero-full-bleed"];
  const direction = visualDirection || BACKGROUND_DIRECTIONS[0];

  // Source-specific guidance for HOW to treat (or not) the attached reference images.
  let sourceBlock = "";
  if (bgSource === "reference" && hasRefImages) {
    sourceBlock = [
      "████ BACKGROUND SOURCE: USER REFERENCE — FOLLOW CLOSELY ████",
      "The attached image(s) are the user's chosen REFERENCE for this background. Treat them as the ACTUAL basis:",
      "• Preserve the main subject, scene, composition, color mood and overall style of the reference.",
      "• Adapt only what is needed: reframe/extend for the target aspect ratio and open up the reserved text-safe zone.",
      "• Do NOT invent an unrelated scene and do NOT drift to a generic stock look. This must clearly read as the same visual the user provided.",
    ].join("\n");
  } else if (bgSource === "company" && hasRefImages) {
    sourceBlock = [
      "████ BACKGROUND SOURCE: COMPANY IMAGES — DERIVE FROM BRAND WORLD ████",
      "The attached image(s) are the company's own brand images. Create an ORIGINAL background that captures this brand's visual world:",
      "• Study their palette, materials, textures, lighting and mood, then compose a fresh original backdrop in that language.",
      "• Do NOT copy, trace or paste the reference images — synthesize a new, cohesive brand-consistent scene/texture.",
    ].join("\n");
  } else if (bgSource === "creative") {
    sourceBlock = [
      "████ BACKGROUND SOURCE: FULL CREATIVE FREEDOM ████",
      "No reference image is provided and you are NOT limited to abstract shapes. You have FULL creative freedom to design the strongest possible background for this ad.",
      "Invent the best visual concept for THIS campaign — photographic scene, illustration, 3D render, textured environment, or conceptual composition — whatever best sells the offer.",
      "Base every decision ONLY on the company and campaign description below (product, industry, audience, offer, mood, brand colors/style). Make it look like a real, professionally art-directed ad background — not generic stock.",
    ].join("\n");
  } else {
    // 'shapes' (default) OR any mode with no usable reference image → abstract.
    sourceBlock = [
      "████ BACKGROUND SOURCE: ABSTRACT SHAPES — NO PHOTOGRAPHY ████",
      "No reference image is provided. Build a fully ABSTRACT background — do NOT render realistic product or scene photography.",
      "• Use geometric shapes, clean gradients, brand-color fields, subtle patterns, soft light and depth.",
      "• Modern, premium and on-brand; the brand colors must dominate. Avoid literal objects, people or photographic scenes.",
    ].join("\n");
  }

  return [
    "You are generating the BACKGROUND LAYER of a composite ad.",
    "An HTML overlay placed on top will add: the brand logo, headline, body copy, and CTA. Your image must contain NONE of those.",
    bgSource === "shapes"
      ? "Your job is purely the visual backdrop: brand colors, gradients, geometric shapes, textures, atmospheric elements (NO photography)."
      : "Your job is purely the visual backdrop: colors, textures, gradients, shapes, product/scene photography, atmospheric elements.",
    "",
    sourceBlock,
    "",
    "████ CAMPAIGN RELEVANCE — MAKE IT SPECIFIC, NOT RANDOM ████",
    "The backdrop MUST visually evoke THIS specific campaign — never a generic, arbitrary scene.",
    "Derive the setting, props, materials, color mood, lighting and atmosphere from the product/service, industry, audience, offer and tone described in the CAMPAIGN CONTEXT below.",
    "It should be immediately plausible as the backdrop for what is being advertised (e.g. a fitness offer → energetic motion/gym/outdoor textures; a law firm → refined corporate materials; a dessert brand → warm, appetizing tones).",
    bgSource === "shapes"
      ? "Even though this is an ABSTRACT background, the palette, energy and mood must still reflect the campaign's product, audience and tone — not a decorative pattern unrelated to the offer."
      : "Keep it cohesive with the brand colors and the chosen visual style/tone; do not drift into stock visuals that ignore what is being advertised.",
    "",
    "████ ZERO-TEXT RULE — NO EXCEPTIONS ████",
    "❌ NO text of any kind — not headline, not body copy, not CTA, not tagline, not slogan, not offer, not brand name, not any word or letter.",
    "❌ NO logo, wordmark, icon, seal, emblem, monogram, or any brand symbol whatsoever.",
    "❌ NO button shapes, pill shapes, or any UI element that looks like it holds text.",
    "❌ NO placeholder boxes, lorem ipsum, or text-shaped blanks.",
    "The HTML overlay will handle all of these. Any text or logo in your image will break the composite.",
    "",
    "CREATIVE DIRECTION:",
    direction,
    "Avoid the default centered product-on-plain-background look. Use varied crop, camera angle, depth, lighting, foreground layers, texture, and asymmetry.",
    bgSource === "shapes"
      ? "Compose with shapes, gradients and brand-color fields — no literal objects or photographic scenes."
      : bgSource === "creative"
        ? "Be bold and original — invent a distinctive composition that fits the campaign; avoid generic stock looks."
        : "Do not repeat the same asset placement unless the format absolutely requires it. Reinterpret the reference assets as a brand world, not a template.",
    "When a low-detail zone is requested, do not make it a blank panel. Use soft gradients, depth blur, atmospheric color, subtle materials, or low-contrast pattern.",
    "",
    "████ SPACE RULE — REQUIRED ████",
    `Reserve low-detail zones for the HTML overlay: ${spaceGuide}`,
    (() => {
      const pos = LAYOUT_POSITIONS[layout];
      return pos
        ? `PRECISE OVERLAY ZONES (CSS coords on the final canvas — keep these exact rectangles the calmest, most contrast-friendly areas; the overlay drops text/logo here): logo[${pos.logo}] headline[${pos.headline}] cta[${pos.cta}]. Concentrate visual detail and focal subject AWAY from these rectangles.`
        : "";
    })(),
    "These zones need enough visual calm and contrast so that white or dark text is legible on top.",
    "Avoid filling every pixel — the brand logo and headline need clear breathing room.",
    "",
    spec
      ? `CREATIVE SPEC (follow for color palette, visual style, brand aesthetic, and composition):\n${spec}`
      : "Create a visually compelling backdrop using the brand's colors and visual language.",
    "",
    "CAMPAIGN CONTEXT (for color/style reference only — do NOT render any of this text):",
    campaignFactsImg,
    "",
    `FORMAT: ${format.width}×${format.height}px | Aspect ratio: ${aspectRatio}`,
    "",
    bgSource === "shapes"
      ? "OUTPUT: Pure abstract visual — brand colors, gradients, geometric shapes, textures. NO photography. Zero text. Zero UI elements."
      : "OUTPUT: Pure visual — brand colors, gradients, textures, product/scene photography. Zero text. Zero UI elements.",
    "",
    "████ TEXT-OVERLAY RECOMMENDATION — RESPONSE TEXT ONLY, NEVER DRAWN IN THE IMAGE ████",
    "In your RESPONSE (as a short text note, not painted into the image), add exactly one line:",
    'CF_TEXT_REC: {"headlineScale": <number 0.7-1.4>, "align": "left"|"center"|"right"}',
    "headlineScale = how large the headline can be given the clean/calm space you actually left (1.0 = default; >1.0 if you left generous empty space, <1.0 if the calm area is tight). align = the best horizontal alignment for the overlay text in its zone. This only tunes the separate HTML overlay — the image itself must still contain ZERO text/letters.",
  ].filter(Boolean).join("\n");
}

// Gradient scrims positioned over each layout's text zone.
// These sit at z-index:1 (above background, below text) and guarantee white
// text is legible regardless of what the AI generated in that area.
const LAYOUT_SCRIMS: Record<string, string> = {
  "hero-full-bleed":        "inset:auto 0 0 0;height:55%;background:linear-gradient(to top,rgba(0,0,0,0.72) 0%,rgba(0,0,0,0.36) 55%,rgba(0,0,0,0) 100%)",
  "diagonal-split":         "inset:0 52% 0 0;background:linear-gradient(to right,rgba(0,0,0,0.70) 0%,rgba(0,0,0,0.26) 80%,rgba(0,0,0,0) 100%)",
  "top-image-bottom-text":  "inset:48% 0 0 0;background:linear-gradient(to bottom,rgba(0,0,0,0) 0%,rgba(0,0,0,0.68) 35%,rgba(0,0,0,0.80) 100%)",
  "left-panel-right-image": "inset:0 56% 0 0;background:linear-gradient(to right,rgba(0,0,0,0.72) 0%,rgba(0,0,0,0.30) 75%,rgba(0,0,0,0) 100%)",
  "centered-minimal":       "inset:0;background:radial-gradient(ellipse at center,rgba(0,0,0,0.52) 0%,rgba(0,0,0,0.18) 65%,rgba(0,0,0,0) 100%)",
  "bold-headline-first":    "inset:0 0 auto 0;height:50%;background:linear-gradient(to bottom,rgba(0,0,0,0.72) 0%,rgba(0,0,0,0.28) 72%,rgba(0,0,0,0) 100%)",
  "frame-product":          "inset:0;background:radial-gradient(ellipse at center,rgba(0,0,0,0.08) 28%,rgba(0,0,0,0.64) 100%)",
  "top-left-editorial":     "inset:0 52% 52% 0;background:linear-gradient(135deg,rgba(0,0,0,0.70) 0%,rgba(0,0,0,0) 100%)",
  "top-right-editorial":    "inset:0 0 52% 52%;background:linear-gradient(225deg,rgba(0,0,0,0.70) 0%,rgba(0,0,0,0) 100%)",
  "bottom-right-editorial": "inset:50% 0 0 50%;background:linear-gradient(315deg,rgba(0,0,0,0.70) 0%,rgba(0,0,0,0) 100%)",
  "vertical-story-stack":   "inset:0;background:linear-gradient(to bottom,rgba(0,0,0,0.58) 0%,rgba(0,0,0,0.16) 35%,rgba(0,0,0,0.16) 65%,rgba(0,0,0,0.58) 100%)",
  "floating-islands":       "inset:0;background:rgba(0,0,0,0.30)",
};

function buildCompositionHtml(
  bgDataUrl: string,
  data: AgentsAdsPayload["campaignData"],
  format: AdFormat,
  spec: string,
  cssVars: string,
  fontUrl: string,
  layoutKey?: string,
  forceLayout?: boolean,
  rec?: ComposeTextRec | null,
): string {
  const w = format.width ?? 1080;
  const h = format.height ?? 1080;
  const platform = format.platform || "banner";
  const formatName = format.format || "ad";

  const detectedLayout = resolveCompositionLayout(spec, layoutKey, forceLayout);
  const layout = LAYOUT_POSITIONS[detectedLayout] ?? LAYOUT_POSITIONS["hero-full-bleed"];

  const primaryColor = extractCssVarColor(cssVars, "--primary") || "#1a1a2e";
  const fontFamily = extractCssVarFont(cssVars) || "'Inter','Helvetica Neue',Arial,sans-serif";

  const headline = String(data.mainHeadline || "").trim();
  const sub = String(data.subheadline || data.offer || "").trim();
  const logoUrl = String(data.logoUrl || "").trim();

  // RESOLUTION-INDEPENDENT typography: font sizes are expressed in container-query
  // units (cqw/cqh = % of the banner box) instead of fixed px, so the inserted HTML
  // text always scales with the actual rendered resolution of the banner — whether
  // it is a 320px mobile banner, a 1080px square, or exported/zoomed at any scale.
  // The .ad-banner container sets `container-type:size` so cqw/cqh resolve to its box.
  // min(cqh,cqw) keeps text proportional to the *binding* dimension (no overflow on
  // extreme aspect ratios). sizeScale = optional hint from the image model (how much
  // clean space it left); clamped, 1.0 = computed size when no/invalid recommendation.
  const sizeScale = Math.min(1.4, Math.max(0.7, Number(rec?.headlineScale) || 1));
  const ctaScale  = Math.min(1.2, sizeScale);
  // Length-aware shrink: a long headline/subheadline must not dominate the creative.
  // Combined with the model's clean-space hint (sizeScale) and the cq units (which already
  // scale with the banner's binding dimension), this keeps type proportional on every size.
  const hlLen = headline.length;
  const hlLenScale  = hlLen <= 22 ? 1 : hlLen <= 38 ? 0.86 : hlLen <= 55 ? 0.75 : 0.66;
  const subLen = sub.length;
  const subLenScale = subLen <= 45 ? 1 : subLen <= 75 ? 0.88 : 0.78;
  // Base coefficients lowered (was 8.8cqh/8cqw) — the old size ran ~8% of width (~86px on a
  // 1080 square), which crowded the layout. ~6.2cqw ≈ 67px is a punchy, balanced headline.
  const headlineFs = `calc(min(7cqh, 6.2cqw) * ${(sizeScale * hlLenScale).toFixed(3)})`;
  const subFs      = `calc(min(7cqh, 6.2cqw) * ${(sizeScale * 0.46 * subLenScale).toFixed(3)})`;
  const ctaFs      = `calc(min(4.4cqh, 4.1cqw) * ${ctaScale.toFixed(3)})`;
  const logoFs     = `calc(min(7cqh, 6.2cqw) * ${(sizeScale * 0.46).toFixed(3)})`;

  // Always use white text in compose mode — the scrim layer guarantees contrast
  // regardless of what the AI generated. Using brand color for text caused
  // illegibility whenever background and brand had similar tones.
  const textColor = "#ffffff";
  const textShadow = "0 2px 12px rgba(0,0,0,0.70), 0 1px 3px rgba(0,0,0,0.50)";
  const subColor = "rgba(255,255,255,0.90)";
  const textAlign = rec?.align ?? "left";

  const fontImport = fontUrl ? `<style>@import url('${fontUrl}');</style>` : "";

  const bgLayer = bgDataUrl
    ? `<img class="ad-bg" src="${bgDataUrl}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0" alt="" />`
    : `<div class="ad-bg" style="position:absolute;inset:0;background:${primaryColor};z-index:0"></div>`;

  // Scrim: semi-transparent gradient over the text zone, ensures white text legibility
  const scrimCss = LAYOUT_SCRIMS[detectedLayout] ?? LAYOUT_SCRIMS["hero-full-bleed"];
  const scrimLayer = `<div style="position:absolute;${scrimCss};z-index:1;pointer-events:none"></div>`;

  const logoLayer = logoUrl
    ? `<img src="${logoUrl}" style="position:absolute;${layout.logo}object-fit:contain;z-index:20" alt="logo" />`
    : (data.brandName ? `<div style="position:absolute;${layout.logo}font-family:${fontFamily};font-size:${logoFs};font-weight:700;color:${textColor};z-index:20;white-space:nowrap;text-shadow:${textShadow}">${String(data.brandName).trim()}</div>` : "");

  const headlineLayer = headline
    ? `<div style="position:absolute;${layout.headline}font-family:${fontFamily};font-size:${headlineFs};font-weight:900;color:${textColor};line-height:1.15;text-align:${textAlign};text-shadow:${textShadow};z-index:25;overflow-wrap:break-word">${headline}</div>`
    : "";

  const subLayer = sub
    ? `<div style="position:absolute;${layout.sub}font-family:${fontFamily};font-size:${subFs};font-weight:400;color:${subColor};line-height:1.4;text-align:${textAlign};text-shadow:${textShadow};z-index:25;overflow-wrap:break-word">${sub}</div>`
    : "";

  // CTA layer — social formats get organic text gesture, display formats get a button
  const ctaRaw = String(data.ctaText || "").trim();
  const isSocialFmt = isSocialFormat(format);
  let ctaLayer = "";
  if (ctaRaw) {
    if (isSocialFmt) {
      // Organic CTA: plain text + gesture indicator, no button shape
      ctaLayer = `<div style="position:absolute;${layout.cta}font-family:${fontFamily};font-size:${ctaFs};font-weight:600;color:${textColor};text-shadow:${textShadow};z-index:25;white-space:nowrap;letter-spacing:0.3px;opacity:0.93;">${ctaRaw} ↓</div>`;
    } else {
      // Display CTA: contrasting button. Padding/radius in em so the button scales with its font.
      const isDark = contrastTextColor(primaryColor).color === "#ffffff";
      const btnBg    = isDark ? "rgba(255,255,255,0.95)" : "rgba(20,20,20,0.88)";
      const btnColor = isDark ? "#111111"                : "#ffffff";
      ctaLayer = `<div style="position:absolute;${layout.cta}display:inline-block;background:${btnBg};color:${btnColor};font-family:${fontFamily};font-size:${ctaFs};font-weight:700;padding:0.42em 0.90em;border-radius:0.38em;box-shadow:0 4px 18px rgba(0,0,0,0.22);z-index:25;white-space:nowrap;">${ctaRaw}</div>`;
    }
  }

  return `<!-- BANNER_START -->
<div class="ad-banner" data-platform="${platform}" data-format="${formatName}" style="position:relative;width:${w}px;height:${h}px;overflow:hidden;font-family:${fontFamily};container-type:size">
  ${fontImport}
  ${bgLayer}
  ${scrimLayer}
  ${logoLayer}
  ${headlineLayer}
  ${subLayer}
  ${ctaLayer}
</div>
<!-- BANNER_END -->`;
}

// ── END COMPOSE MODE HELPERS ──────────────────────────────────────────────────

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

// Max base64 size (~300 KB decoded) for reference images sent to the image model.
// Larger images waste input tokens and can OOM the edge function. Style/color
// reference quality is identical at this size.
const MAX_REF_IMAGE_BYTES = 400_000; // base64 chars ≈ 300 KB binary

async function fetchImageBase64(url: string): Promise<{ mimeType: string; data: string } | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const mime = res.headers.get("content-type")?.split(";")[0].trim() ?? "image/jpeg";
    if (!mime.startsWith("image/")) return null;
    // Gemini inline image parts do not accept SVG.
    if (mime === "image/svg+xml") return null;
    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);

    // IMPORTANT: do NOT use char-by-char concatenation (bin += String.fromCharCode(bytes[i])).
    // That is O(n²) in memory — a 1 MB image produces ~50 MB of garbage strings.
    // Chunked spread is O(n) and stays within the 256 MB edge function limit.
    const CHUNK = 8192;
    let bin = "";
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    const data = btoa(bin);

    // Skip oversized reference images — model only needs color/style, not full resolution.
    if (data.length > MAX_REF_IMAGE_BYTES) return null;

    return { mimeType: mime, data };
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
  guidelineApplications?: string[];
  abVariants?: Array<{ label: string; headline: string; cta: string }>;
};

type CreativePlanJson = {
  groups: CreativeGroupPlan[];
  guidelineApplications?: string[];
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
          guidelineApplications: { type: "array", items: { type: "string" } },
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
    guidelineApplications: { type: "array", items: { type: "string" } },
    globalNotes: { type: "string" },
  },
  required: ["groups"],
};

// Estimated paid-tier prices (USD per 1M tokens) — for the [cost-estimate] server
// log only (Supabase function logs). Not billing; Google is the source of truth.
// Keep in sync with https://ai.google.dev/gemini-api/docs/pricing
const GEMINI_PRICING: Record<string, { in: number; out: number }> = {
  "gemini-2.5-flash":        { in: 0.30, out: 2.50 },
  "gemini-2.5-flash-lite":   { in: 0.10, out: 0.40 },
  "gemini-2.5-pro":          { in: 1.25, out: 10.00 },
  "gemini-3.5-flash":        { in: 1.50, out: 9.00 },
  "gemini-3-flash-preview":  { in: 0.50, out: 3.00 },
  "gemini-2.5-flash-image":  { in: 0.30, out: 0.00 }, // output billed per image, not per token
};
const IMAGE_PRICE_PER_IMAGE = 0.039; // gemini-2.5-flash-image, 1 image (~1290 tok)

function pricingFor(model: string): { in: number; out: number } {
  if (GEMINI_PRICING[model]) return GEMINI_PRICING[model];
  const key = Object.keys(GEMINI_PRICING).find((k) => model.startsWith(k));
  return key ? GEMINI_PRICING[key] : GEMINI_PRICING["gemini-2.5-flash"]; // safe default
}

// Logs an estimated USD cost line for a text/plan generation. Server-side only.
function logCostEstimate(model: string, promptTokens: number, outputTokens: number, label = ""): void {
  try {
    const p = pricingFor(model);
    const inUsd = (promptTokens / 1_000_000) * p.in;
    const outUsd = (outputTokens / 1_000_000) * p.out;
    const total = inUsd + outUsd;
    console.log(`[cost-estimate]${label ? ` ${label}` : ""} model=${model} in=${promptTokens}tok($${inUsd.toFixed(5)}) out=${outputTokens}tok($${outUsd.toFixed(5)}) ~= $${total.toFixed(5)}`);
  } catch (_) { /* logging must never break generation */ }
}

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
  // `thinkingLevel` is Gemini 3.x only; 2.5 models reject it (400 "Thinking level
  // is not supported for this model"). Only send it to models that support it.
  if (options?.thinkingLevel && /gemini-3/i.test(model)) {
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
    signal: AbortSignal.timeout(130000),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    if (res.status === 429 && /credit|deplet|RESOURCE_EXHAUSTED|quota|billing/i.test(err)) {
      throw new Error("GEMINI_CREDITS_DEPLETED");
    }
    throw new Error(`Gemini ${model} returned ${res.status}: ${err.slice(0, 300)}`);
  }

  const data = await res.json();
  // TOKEN DIAGNOSTICS — visible in `supabase functions logs agents-ads`.
  // promptTokenCount includes File Search retrieved content, so a big number here
  // points at heavy store retrieval (the usual culprit for token spikes).
  try {
    const u = data?.usageMetadata ?? data?.usage_metadata ?? {};
    const promptTok = Number(u.promptTokenCount ?? u.prompt_token_count ?? 0);
    const outTok = Number(u.candidatesTokenCount ?? u.candidates_token_count ?? 0);
    console.log(`[token-usage] model=${model} stores=${fileSearchStores?.length ?? 0}(${(fileSearchStores ?? []).join(",")}) refImgs=${referenceImages?.length ?? 0} prompt=${u.promptTokenCount ?? u.prompt_token_count ?? "?"} candidates=${u.candidatesTokenCount ?? u.candidates_token_count ?? "?"} toolUse=${u.toolUsePromptTokenCount ?? u.tool_use_prompt_token_count ?? 0} total=${u.totalTokenCount ?? u.total_token_count ?? "?"}`);
    logCostEstimate(model, promptTok, outTok);
  } catch (_) { /* logging must never break generation */ }
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

  const geminiOpts = { thinkingLevel: options?.thinkingLevel, responseMimeType: options?.responseMimeType, responseSchema: options?.responseSchema };

  for (const model of chain) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await callGemini(
          systemPrompt, userMessage, model, temperature, maxTokens,
          apiKey, fileSearchStores, referenceImages, geminiOpts,
        );
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        if (lastError.message === "GEMINI_CREDITS_DEPLETED") throw lastError; // no point retrying other models
        const status = lastError.message.match(/returned (\d+)/)?.[1];
        if (model !== preferredModel || attempt > 0) {
          console.warn(
            `[agents-ads][model-fallback] preferred=${preferredModel} current=${model} ` +
            `attempt=${attempt + 1}/2 status=${status ?? "non-http"} error="${lastError.message.slice(0, 120)}"`
          );
        }
        // 403 from file search store = store missing or wrong API key.
        // Retry immediately on the SAME model without stores so generation continues.
        if (status === "403" && fileSearchStores?.length && lastError.message.includes("file search store")) {
          console.warn(`[agents-ads] File search store 403 — retrying without stores on ${model}`);
          try {
            return await callGemini(
              systemPrompt, userMessage, model, temperature, maxTokens,
              apiKey, undefined, referenceImages, geminiOpts,
            );
          } catch (retryErr) {
            lastError = retryErr instanceof Error ? retryErr : new Error(String(retryErr));
            break;
          }
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
    // debug:true → return the final image prompt + aspectRatio + reference images
    // used, per creative, for prompt calibration. Accepted top-level or inside
    // campaignData (the external API carries it in form_data).
    const debug = Boolean((payload as any).debug || (payload as any).campaignData?.debug);

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

    const {
      agentConfig,
      globalStoreName,
      globalGuidelinesData,
      guidelinesStoreData,
      globalReferenceStoreName,
      companyStoreName,
      companyStoreData,
      campaignGoodExamplesStore,
      examplesStoreData,
      campaignMemoryStore,
      campaignData,
      useCampaignMemory,
    } = payload;
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

    // HTML ad modes (render/full/unified/interpret/plan) are grounded by the global ads
    // guidelines/examples store + the company store. COMPOSE (image ads) must NOT depend on
    // those: its only references are the background + image refs (logo/product/background).
    // The HTML-examples store is not even queried in the compose path, and requiring it was
    // both blocking generation and (per feedback) homogenizing the creatives.
    if (mode !== "compose") {
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
    }

    const hasApprovedExamples = Boolean(campaignGoodExamplesStore?.trim());
    const formatsList = buildFormatsList(formats, campaignData.formatNotes);
    const campaignFacts = buildCampaignFacts(campaignData);
    const layoutSeed = getLayoutSeed();

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
    // Only the pixel-drawing models (image / compose-background) actually need the
    // reference image bytes. The HTML render uses a TEXT model that references the
    // images by URL (campaignFacts) + brand colors (CSS tokens) + the creative plan,
    // so sending base64 there only inflates INPUT TOKENS — and it was re-sent on
    // every format/batch request. Fetch the bytes only for the modes that draw.
    const needsReferenceImages = mode === "image" || mode === "compose";
    const fetchedImages = needsReferenceImages
      ? await Promise.all(
          imageSpecs.map(({ url, label }) =>
            fetchImageBase64(url).then((img) => (img ? { label, ...img } : null)).catch(() => null)
          )
        )
      : [];
    const referenceImages: ReferenceImage[] = fetchedImages.filter((img): img is ReferenceImage => img !== null);

    // For debug: which reference URLs were provided and whether each was fetched
    // within the ~300KB inline limit (fetched=false ⇒ dropped, won't reach the model).
    const refDebug = debug
      ? imageSpecs.map((s, i) => ({ slot: s.label.split(" — ")[0], url: s.url, fetched: !!fetchedImages[i] }))
      : [];

    // ── COMPOSE MODE: background image + HTML overlay ─────────────────────────
    // ── IMAGE MODE: the model draws the WHOLE ad (text included) as a single image ──────────
    // Restored from the legacy pipeline for the external API (pure-image generation). Returns
    // hosted URLs (uploaded to ad-images) instead of base64; falls back to base64 if upload fails.
    if (mode === "image") {
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
      const costAcc = { usd: 0, images: 0 }; // per-generation cost tracker (this request)

      const imageFns = imageTasks.map((task) => async () => {
        const { format, variantLabel, focusInstruction } = task;
        const aspectRatio = imageAspectRatioForFormat(format);
        const isSocial = isSocialFormat(format);
        const hasLogo = Boolean(String(campaignData.logoUrl || "").trim());
        const ctaForImage = String(campaignData.ctaText || "").trim();

        const ctaInstruction = isSocial
          ? `CTA RULE (SOCIAL FORMAT): Do NOT draw a button, pill, rectangle, or any UI element for the CTA. Instead, integrate the call-to-action as organic text — e.g. "${ctaForImage || "Swipe up"} ↑", "See more ↓", or a short phrase that matches the platform's native content style. It must look like in-feed content, not a paid ad button.`
          : ctaForImage
            ? `CTA RULE (DISPLAY FORMAT): Include a prominent CTA button with the exact text: "${ctaForImage}". Use a contrasting pill or rounded-rectangle button that stands out from the background. This is the only button in the image.`
            : "Include a prominent CTA button suited to the brand style.";

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
          "",
          "TEXT HIERARCHY RULE:",
          "• HEADLINE: one dominant line — the main hook or promise.",
          "• BODY COPY: one or two supporting lines — clarify the offer. Keep it short.",
          "• CTA: see CTA rule below. This is separate from body copy — do not repeat copy text as the CTA.",
          "",
          "████ TEXT ACCURACY — NO EXCEPTIONS ████",
          "Every visible word must be spelled correctly with correct grammar and spacing. No invented words, no garbled letters, no duplicated/cut-off characters. Render only the copy provided/implied by the campaign data — proofread before output. A single typo is a failed creative.",
          "",
          ctaInstruction,
          "",
          hasLogo
            ? "BRAND REFERENCE (logo): The first attached image shows the brand logo and its color identity. Study its color palette, typography style, and visual personality to inform the ad. Use the brand colors faithfully. Do NOT attempt to copy-paste or directly reproduce the logo image — render the brand name as text or a clean logotype area using the brand's color system."
            : "No logo provided — use brand name as text only. Do not invent a symbol or icon.",
          refImagesForGen.length > 1
            ? "BRAND REFERENCE (product/background): Additional attached images show the brand's product and visual style. Use them as CREATIVE INSPIRATION — study their lighting, color mood, textures, and composition style, then create an ORIGINAL stylized visual that captures this brand's aesthetic. Do NOT copy, trace, or directly reproduce these reference images. Generate fresh, original visual elements inspired by this brand's visual language."
            : "",
          "",
          imageLangLabel ? `All visible text in this image must be written in ${imageLangLabel}.` : "",
          "Produce a polished, finished ad image with clear visual hierarchy: dominant headline, supporting copy, CTA (per CTA rule above), and brand identity.",
        ].filter(Boolean).join("\n");

        const gen = await generateAdImage(prompt, refImagesForGen, apiKey, aspectRatio, { costAcc });
        const hosted = gen ? (await uploadImageToStorage(gen.url, false, (payload as any).storageKey)) ?? gen.url : "";
        return {
          imageUrl: hosted,
          platform: format.platform || "other",
          format: format.format || "ad",
          label: `${format.label || `${format.width}x${format.height}`}${variantLabel ? ` - Variant ${variantLabel}` : ""}`,
          width: format.width || 1080,
          height: format.height || 1080,
          variant: variantLabel || null,
          ...(debug ? { debug: { mode: "image", model: GEMINI_IMAGE_MODELS[0] || null, aspectRatio, prompt, refs: refDebug } } : {}),
        };
      });

      const images = await runWithConcurrency(imageFns, 1);
      console.log(`[cost-total] mode=image images=${costAcc.images} ~= $${costAcc.usd.toFixed(5)}`);
      return new Response(JSON.stringify({ mode: "image", images }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (mode === "compose") {
      const campaignFactsImg = buildCampaignFactsForCompose(campaignData);
      const costAcc = { usd: 0, images: 0 }; // per-generation cost tracker (this request)

      // CRITICAL: never pass the logo to the background image generator.
      // The logo is composited later in HTML (buildCompositionHtml). Passing it as a
      // visual reference causes the model to embed it in the background pixel art.
      const logoUrlNorm = String(campaignData.logoUrl || "").trim().toLowerCase();
      const MAX_REF_IMAGE_B64 = 400_000;
      const refImagesForGen = referenceImages
        .filter((r) => {
          const spec = imageSpecs.find((s) => s.label === r.label);
          if (!spec) return true;
          const urlNorm = spec.url.trim().toLowerCase();
          return urlNorm !== logoUrlNorm && !spec.label.toLowerCase().startsWith("company logo");
        })
        .filter((r) => r.data.length <= MAX_REF_IMAGE_B64)
        .map((r) => ({ data: r.data, mimeType: r.mimeType }));

      // ── Background source (compose) ────────────────────────────────────────
      //  reference: the user's product/background images ARE the reference
      //  shapes   : no photo — abstract geometric/brand-color background (no refs)
      //  company  : derive the background from the company's own images
      const explicitBgSource = String((campaignData as any).composeBackgroundSource || "").toLowerCase();
      const bgSource = ["reference", "shapes", "company", "creative"].includes(explicitBgSource)
        ? explicitBgSource
        // No explicit choice (older campaigns): infer — a provided background image
        // is treated as a real reference; otherwise an abstract shapes background.
        : (String(campaignData.backgroundImageUrl || "").startsWith("http") ? "reference" : "shapes");

      let bgRefImages = refImagesForGen;
      if (bgSource === "shapes" || bgSource === "creative") {
        bgRefImages = []; // no reference image — abstract (shapes) or full freedom (creative)
      } else if (bgSource === "company") {
        const companyRefUrls = Array.isArray((campaignData as any).composeCompanyRefs)
          ? ((campaignData as any).composeCompanyRefs as unknown[])
              .filter((u): u is string => typeof u === "string" && u.startsWith("http"))
              .slice(0, 4)
          : [];
        const companyFetched = await Promise.all(
          companyRefUrls.map((url) => fetchImageBase64(url).then((img) => img).catch(() => null)),
        );
        bgRefImages = companyFetched
          .filter((img): img is { mimeType: string; data: string } => Boolean(img && img.data))
          .filter((r) => r.data.length <= MAX_REF_IMAGE_B64)
          .map((r) => ({ data: r.data, mimeType: r.mimeType }));
        // No company images available → fall back to abstract shapes.
        if (!bgRefImages.length) {
          // keep empty refs; prompt uses the company-but-no-refs guidance below
        }
      }
      // 'reference' keeps refImagesForGen (product + user background) as-is.

      // brandSpec: use creativePlan if provided (e.g. from external API worker),
      // otherwise derive instantly from campaignData — PHP already enriched it with
      // company colors/fonts/style, so no store query is needed.
      const brandSpec = String(payload.creativePlan || "").trim() || buildComposeBrandSpec(campaignData);

      const { cssVars: specCssVars, fontUrl } = extractBrandTokens(brandSpec);
      const cssVars = specCssVars || buildComposeCssVars(campaignData);
      const imageTasks = buildImageVariantTasks(formats, campaignData);

      // User-chosen text layout (from the form) overrides the auto-rotation and is FORCED
      // across all formats so the background reserves the right negative space and the HTML
      // overlay matches. "auto" / unknown keeps the automatic per-format rotation.
      const userLayout = (LAYOUT_KEYS as readonly string[]).includes(String((campaignData as any).textLayout || ""))
        ? String((campaignData as any).textLayout)
        : null;

      // A/B visual focus: each variant gets its OWN background image and a FORCED
      // distinct layout so variants are visually differentiated. Bypasses ratio dedup.
      const isAbVisual = Boolean(campaignData.abTestingEnabled)
        && String(campaignData.abTestFocus || "").toLowerCase() === "visual";

      let banners: Awaited<ReturnType<typeof runWithConcurrency>>;

      if (isAbVisual) {
        const bgByVariantRatio = new Map<string, { url: string; rec: ComposeTextRec | null; prompt?: string; refCount?: number }>();
        const uniqueVariantRatios = [...new Map(
          imageTasks.map((task) => {
            const aspectRatio = imageAspectRatioForFormat(task.format);
            return [`${task.variantIndex}:${aspectRatio}`, { task, aspectRatio }] as const;
          })
        ).values()];

        for (const { task, aspectRatio } of uniqueVariantRatios) {
          const taskIndex = imageTasks.indexOf(task);
          const layoutHint = userLayout ?? LAYOUT_KEYS[taskIndex % LAYOUT_KEYS.length];
          const visualDirection = BACKGROUND_DIRECTIONS[taskIndex % BACKGROUND_DIRECTIONS.length];
          const taskBrandSpec = specForFormat(brandSpec, task.format);

          const bgPrompt = buildBackgroundPrompt(taskBrandSpec, campaignFactsImg, task.format, aspectRatio, layoutHint, visualDirection, Boolean(userLayout), bgSource, bgRefImages.length > 0);
          const gen = await generateAdImage(bgPrompt, bgRefImages, apiKey, aspectRatio, {
            // ONE attempt with a generous timeout. The image model is slow (~40-90s) and
            // its first request often lags; a SECOND attempt pushed the edge call past the
            // Supabase wall-clock (~150s) → HTTP 546 WORKER_RESOURCE_LIMIT, which is why the
            // larger 9:16 (story) batch always died. A single ~105s wait fits the budget and
            // gives the model time to respond in one shot.
            maxAttempts: 1, timeoutMs: 105000, singleConfig: true, costAcc,
          });
          const bgHosted = gen ? (await uploadImageToStorage(gen.url, true, (payload as any).storageKey)) ?? "" : "";
          bgByVariantRatio.set(`${task.variantIndex}:${aspectRatio}`, { url: bgHosted, rec: gen?.rec ?? null, prompt: bgPrompt, refCount: bgRefImages.length });
        }

        const abComposeFns = imageTasks.map((task, taskIndex) => async () => {
          const { format, variantLabel } = task;
          const aspectRatio = imageAspectRatioForFormat(format);
          const layoutHint = userLayout ?? LAYOUT_KEYS[taskIndex % LAYOUT_KEYS.length];
          const taskBrandSpec = specForFormat(brandSpec, format);
          const bg = bgByVariantRatio.get(`${task.variantIndex}:${aspectRatio}`) ?? { url: "", rec: null, prompt: "", refCount: 0 };

          const bannerHtml = buildCompositionHtml(
            bg.url, campaignData, format, taskBrandSpec, cssVars, fontUrl,
            layoutHint, true, bg.rec, // forceLayout=true; bg.rec = model text-size hint
          );
          const fullHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}html,body{overflow:hidden;background:transparent}</style></head><body>${bannerHtml}</body></html>`;
          return {
            html: fullHtml,
            platform: format.platform || "other",
            format: format.format || "ad",
            label: `${format.label || `${format.width}x${format.height}`}${variantLabel ? ` - Variant ${variantLabel}` : ""}`,
            width: format.width || 1080,
            height: format.height || 1080,
            variant: variantLabel || null,
            ...(debug ? { debug: { mode: "compose", model: GEMINI_IMAGE_MODELS[0] || null, bgSource, layout: layoutHint, aspectRatio, prompt: bg.prompt || "", bgRefImagesSent: bg.refCount || 0, refs: refDebug, note: "Logo & copy are composited as an HTML overlay on top of this AI background — not drawn by the image model." } } : {}),
          };
        });
        banners = await runWithConcurrency(abComposeFns, 1);
      } else {
        // Standard path: deduplicate backgrounds by aspect ratio (cost saving)
        const bgByRatio = new Map<string, { url: string; rec: ComposeTextRec | null; prompt?: string; refCount?: number }>();
        const uniqueRatios = [...new Set(imageTasks.map((task) => imageAspectRatioForFormat(task.format)))];
        for (const aspectRatio of uniqueRatios) {
          const task = imageTasks.find((candidate) => imageAspectRatioForFormat(candidate.format) === aspectRatio)!;
          const ratioIndex = uniqueRatios.indexOf(aspectRatio);
          const taskIndex = imageTasks.indexOf(task);
          const taskBrandSpec = specForFormat(brandSpec, task.format);
          const layoutHint = userLayout ?? LAYOUT_KEYS[(taskIndex + ratioIndex) % LAYOUT_KEYS.length];
          const visualDirection = BACKGROUND_DIRECTIONS[(taskIndex + ratioIndex * 3) % BACKGROUND_DIRECTIONS.length];
          const bgPrompt = buildBackgroundPrompt(taskBrandSpec, campaignFactsImg, task.format, aspectRatio, layoutHint, visualDirection, Boolean(userLayout), bgSource, bgRefImages.length > 0);
          const gen = await generateAdImage(bgPrompt, bgRefImages, apiKey, aspectRatio, {
            // ONE attempt with a generous timeout. The image model is slow (~40-90s) and
            // its first request often lags; a SECOND attempt pushed the edge call past the
            // Supabase wall-clock (~150s) → HTTP 546 WORKER_RESOURCE_LIMIT, which is why the
            // larger 9:16 (story) batch always died. A single ~105s wait fits the budget and
            // gives the model time to respond in one shot.
            maxAttempts: 1, timeoutMs: 105000, singleConfig: true, costAcc,
          });
          const bgHosted = gen ? (await uploadImageToStorage(gen.url, true, (payload as any).storageKey)) ?? "" : "";
          bgByRatio.set(aspectRatio, { url: bgHosted, rec: gen?.rec ?? null, prompt: bgPrompt, refCount: bgRefImages.length });
        }

        const composeFns = imageTasks.map((task, taskIndex) => async () => {
          const { format, variantLabel } = task;
          const aspectRatio = imageAspectRatioForFormat(format);
          const layoutHint = userLayout ?? LAYOUT_KEYS[taskIndex % LAYOUT_KEYS.length];
          const bg = bgByRatio.get(aspectRatio) ?? { url: "", rec: null, prompt: "", refCount: 0 };
          const taskBrandSpec = specForFormat(brandSpec, format);

          const bannerHtml = buildCompositionHtml(
            bg.url, campaignData, format, taskBrandSpec, cssVars, fontUrl, layoutHint, Boolean(userLayout), bg.rec,
          );
          const fullHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}html,body{overflow:hidden;background:transparent}</style></head><body>${bannerHtml}</body></html>`;
          return {
            html: fullHtml,
            platform: format.platform || "other",
            format: format.format || "ad",
            label: `${format.label || `${format.width}x${format.height}`}${variantLabel ? ` - Variant ${variantLabel}` : ""}`,
            width: format.width || 1080,
            height: format.height || 1080,
            variant: variantLabel || null,
            ...(debug ? { debug: { mode: "compose", model: GEMINI_IMAGE_MODELS[0] || null, bgSource, layout: layoutHint, aspectRatio, prompt: bg.prompt || "", bgRefImagesSent: bg.refCount || 0, refs: refDebug, note: "Logo & copy are composited as an HTML overlay on top of this AI background — not drawn by the image model." } } : {}),
          };
        });
        banners = await runWithConcurrency(composeFns, 4);
      }
      console.log(`[cost-total] mode=compose batch=${(payload as any).batchIndex ?? "?"} images=${costAcc.images} banners=${Array.isArray(banners) ? banners.length : 0} ~= $${costAcc.usd.toFixed(5)}`);
      return new Response(JSON.stringify({ mode: "compose", banners }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // ── END COMPOSE MODE ──────────────────────────────────────────────────────

    // Plan is text-only — images not needed and waste bandwidth/tokens
    const groundingMetadata: unknown[] = [];
    let creativePlan = String(payload.creativePlan || "").trim();
    const { cssVars, fontUrl, cleanSpec } = extractBrandTokens(creativePlan);
    if (cleanSpec) creativePlan = cleanSpec;

    if (mode === "interpret") {
      const interpretResult = await generateWithRetry(
        INTERPRET_SYSTEM_PROMPT,
        buildInterpretPrompt(campaignFacts, formats, campaignData.formatNotes, referenceGuide),
        "gemini-3.5-flash",
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

    if (mode === "interpret_image") {
      const imageRefStore = payload.imageReferenceStoreName?.trim();
      const imageFileSearchStores = [
        globalStoreName,
        imageRefStore || globalReferenceStoreName,
        companyStoreName,
        ...(useCampaignMemory && campaignMemoryStore ? [campaignMemoryStore] : []),
        campaignGoodExamplesStore,
      ].filter((s): s is string => Boolean(s?.trim()));

      try {
        const interpretImageResult = await generateWithRetry(
          INTERPRET_IMAGE_SYSTEM_PROMPT,
          buildInterpretImagePrompt(campaignFacts, formats, campaignData.formatNotes),
          "gemini-3.5-flash",
          0.5,
          8000,
          apiKey,
          imageFileSearchStores.length ? imageFileSearchStores : undefined,
          undefined,
        );
        const parsed = extractInterpretJson(interpretImageResult.text);
        return new Response(
          JSON.stringify({ batchSpecs: parsed.batchSpecs || [], usedStores: imageFileSearchStores }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      } catch (interpretErr) {
        // Store unavailable or permission error — return empty specs so compose
        // proceeds with campaignData fallback (buildComposeBrandSpec).
        const msg = String(interpretErr);
        const isStoreError = msg.includes("403") || msg.toLowerCase().includes("permission") || msg.includes("file search store");
        if (isStoreError) {
          console.warn(`[agents-ads] interpret_image store error, returning empty specs: ${msg.slice(0, 200)}`);
          return new Response(
            JSON.stringify({ batchSpecs: [], usedStores: [], storeError: msg.slice(0, 200) }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        throw interpretErr;
      }
    }

    if (mode !== "render" && mode !== "unified") {
      const planResult = await generateWithRetry(
        "You are a senior performance ad creative director. Create concise planning notes only. Do not generate HTML.",
        buildPlanPrompt(
          campaignFacts,
          formatGroups,
          layoutSeed,
          retrievalHints,
          referenceGuide,
          campaignData.formatNotes,
          hasApprovedExamples,
          guidelinesStoreData ?? globalGuidelinesData,
          companyStoreData,
          examplesStoreData,
        ),
        PLAN_MODEL_CHAIN[0],
        0.65,
        8000,
        apiKey,
        fileSearchStores.length ? fileSearchStores : undefined,
        undefined,
        { modelChain: PLAN_MODEL_CHAIN, responseMimeType: "application/json", responseSchema: CREATIVE_PLAN_JSON_SCHEMA },
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
        campaignData.useAiCopy === false && (campaignData.mainHeadline || campaignData.subheadline || campaignData.ctaText)
          ? [
              "MANDATORY COPY RULE: The copy is CLIENT-APPROVED and LOCKED. Render it VERBATIM in every banner — do NOT paraphrase, rewrite, improve, or shorten any approved text.",
              campaignData.mainHeadline ? `  LOCKED HEADLINE: "${campaignData.mainHeadline}"` : "",
              campaignData.subheadline  ? `  LOCKED SUBHEADLINE: "${campaignData.subheadline}"` : "",
              campaignData.ctaText      ? `  LOCKED CTA: "${campaignData.ctaText}"` : "",
              "  These exact strings must appear in every banner. Zero tolerance for any variation.",
            ].filter(Boolean).join("\n")
          : "MANDATORY COPY RULE: every banner must contain visible human-readable ad copy. Use campaign headline/value prop/offer to write a concise headline, plus the CTA text. Never return a banner with only shapes, logo, or image.",
        "MANDATORY LOGO RULE: if a logo URL exists in campaign facts, every banner must include at least one visible <img class=\"ad-logo\"> that uses the exact original logo URL with object-fit:contain. Reinterpreted logos are NOT logos. Similar marks, generated marks, recolored marks, redrawn symbols, monograms, or decorative logo-like shapes do not count. Never redraw, recolor, filter, mask, crop, replace, or invent a logo. If no logo URL exists, use brand name text only and never invent a fake mark.",
        "MANDATORY ASSET RULE: if PRODUCT or BACKGROUND asset URL exists in campaign facts, every banner must include at least one of those URLs in a visible <img>. Do not replace provided images with abstract blocks.",
        !String(campaignData.productImageUrl || "").trim() && !String(campaignData.backgroundImageUrl || "").trim()
          ? "NO BACKGROUND IMAGE RULE: No product image or background image URL is provided. Do NOT include product/background <img> elements, stock photos, placeholder images, or external image URLs as backgrounds. Use CSS-ONLY backgrounds: solid brand colors, linear/radial CSS gradients using the brand color palette, geometric clip-path shapes, or color panel compositions. This is intentional — the client wants a CSS-styled background."
          : "",
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
        "gemini-2.5-flash",
        agentConfig.temperature ?? 0.8,
        effectiveMaxTokens,
        apiKey,
        undefined,
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
    const msg = error instanceof Error ? error.message : "Unknown error";
    if (msg === "GEMINI_CREDITS_DEPLETED") {
      return new Response(
        JSON.stringify({
          error: "gemini_credits_depleted",
          message: "Créditos da API Gemini esgotados. Recarregue/ative o billing em https://ai.studio/projects e tente de novo.",
        }),
        { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
