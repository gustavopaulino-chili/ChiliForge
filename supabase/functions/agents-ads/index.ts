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
  agentConfig: AgentConfig;
  globalStoreName?: string;
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
  accountType?: "admin" | "user";
  useCampaignMemory?: boolean;
};

const env = (globalThis as any).Deno?.env;
const MODEL_CHAIN = ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.5-flash-lite"];

function asList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
}

function getApiKey(): string {
  return env?.get("GEMINI_API_KEY_PRODUCTION") || env?.get("GEMINI_API_KEY_TESTING") || "";
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
  return (payload.campaignData?.selectedFormats || []).filter((f) => f.enabled !== false && f.width && f.height);
}

function buildCampaignFacts(data: AgentsAdsPayload["campaignData"]): string {
  const lines: string[] = [];

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

  // — A/B —
  if (data.abTestingEnabled) {
    lines.push("");
    lines.push(`A/B: ${data.abVariantCount || 2} variants | Focus: ${data.abTestFocus || "mixed"}`);
    if (data.headlineVariants?.length) lines.push(`  Headline variants: ${data.headlineVariants.join(" | ")}`);
    if (data.ctaVariants?.length) lines.push(`  CTA variants: ${data.ctaVariants.join(" | ")}`);
  }

  return lines.filter((l) => l !== undefined).join("\n");
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

function buildPlanPrompt(campaignFacts: string, formatGroups: AdFormat[][], layoutSeed: string, formatNotes?: Record<string, string>, hasApprovedExamples = false): string {
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
</style>`;
  return html.replace(/<\/head>/i, `${safetyCss}\n</head>`);
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
};

async function fetchImageBase64(url: string): Promise<{ mimeType: string; data: string } | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const mime = res.headers.get("content-type")?.split(";")[0].trim() ?? "image/jpeg";
    if (!mime.startsWith("image/")) return null;
    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let bin = "";
    for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
    return { mimeType: mime, data: btoa(bin) };
  } catch {
    return null;
  }
}

async function callGemini(
  systemPrompt: string,
  userMessage: string,
  model: string,
  temperature: number,
  maxTokens: number,
  apiKey: string,
  fileSearchStores?: string[],
  referenceImages?: ReferenceImage[]
): Promise<GeminiResult> {
  const effectiveSystemPrompt = [
    systemPrompt,
    fileSearchStores?.length
      ? "MANDATORY: You MUST query the File Search stores in order before generating any output: first the global ads store for design rules, HTML technical standards, and copy principles; then the company store for brand identity, logo URL, colors, and image assets; then any campaign stores for campaign memory, previous creative plans, and approved examples. Campaign facts override company guidance when they conflict, and company guidance overrides global rules."
      : "",
    fileSearchStores?.length
      ? "For every non-empty form option in the mandatory guideline lookup checklist, retrieve the matching global guideline and visibly apply it in the plan and HTML. If a field has no exact rule, infer from the closest global rule and state the adaptation in the plan."
      : "",
    fileSearchStores?.length
      ? "If approved campaign examples are available, treat them as performance references: infer their winning layout principles, CTA treatment, hierarchy, and visual hooks. Do not clone them; create a new composition that preserves what worked."
      : "",
  ].filter(Boolean).join("\n\n");

  const parts: unknown[] = [];
  if (referenceImages?.length) {
    for (const img of referenceImages) {
      parts.push({ text: `VISUAL REFERENCE — ${img.label} (use this image in the ad as instructed):` });
      parts.push({ inline_data: { mime_type: img.mimeType, data: img.data } });
    }
  }
  parts.push({ text: userMessage });

  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: effectiveSystemPrompt }] },
    contents: [{ parts }],
    generationConfig: { temperature, maxOutputTokens: maxTokens },
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
  referenceImages?: ReferenceImage[]
): Promise<GeminiResult> {
  const chain = [preferredModel, ...MODEL_CHAIN.filter((m) => m !== preferredModel)];
  let lastError: Error | null = null;

  for (const model of chain) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await callGemini(systemPrompt, userMessage, model, temperature, maxTokens, apiKey, fileSearchStores, referenceImages);
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        const status = lastError.message.match(/returned (\d+)/)?.[1];
        if (status === "429" || status === "503") {
          await new Promise((r) => setTimeout(r, attempt === 0 ? 3000 : 8000));
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

    const { agentConfig, globalStoreName, companyStoreName, campaignGoodExamplesStore, campaignMemoryStore, campaignData, useCampaignMemory } = payload;
    const apiKey = getApiKey();

    if (!apiKey) {
      return new Response(JSON.stringify({ error: "Gemini API key not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const fileSearchStores = [
      globalStoreName,
      companyStoreName,
      ...(useCampaignMemory && campaignMemoryStore ? [campaignMemoryStore] : []),
      campaignGoodExamplesStore,
    ].filter((s): s is string => Boolean(s?.trim()));

    if (!companyStoreName?.trim()) {
      return new Response(JSON.stringify({ error: "companyStoreName is required. Sync the company store before generation." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!globalStoreName?.trim()) {
      return new Response(JSON.stringify({ error: "globalStoreName is required. Upload the global ads store first in the admin panel." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const hasApprovedExamples = Boolean(campaignGoodExamplesStore?.trim());
    const formatsList = buildFormatsList(formats, campaignData.formatNotes);
    const campaignFacts = buildCampaignFacts(campaignData);
    const sourceOrchestration = buildSourceOrchestration(hasApprovedExamples);
    const layoutSeed = getLayoutSeed();
    const storeNotice = fileSearchStores.length
      ? "Consult the File Search stores before designing. Retrieve rules for every design parameter listed in the campaign facts."
      : "";

    // Group formats by category early — used in both plan and generation
    const formatGroups = groupFormatsByCategory(formats);

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

    // Plan is text-only — images not needed and waste bandwidth/tokens
    const planResult = await generateWithRetry(
      "You are a senior performance ad creative director. Create concise planning notes only. Do not generate HTML.",
      buildPlanPrompt(campaignFacts, formatGroups, layoutSeed, campaignData.formatNotes, hasApprovedExamples),
      agentConfig.model || "gemini-2.5-flash",
      0.65,
      8000,
      apiKey,
      fileSearchStores.length ? fileSearchStores : undefined,
      undefined
    );
    const creativePlan = planResult.text.trim().slice(0, 12000);

    const isAbTest = Boolean(campaignData.abTestingEnabled) && (campaignData.abVariantCount ?? 2) > 1;
    const variantCount = isAbTest ? (campaignData.abVariantCount ?? 2) : 1;
    const abTestFocus = campaignData.abTestFocus || "mixed";
    const snippets: string[] = [];
    const groundingMetadata: unknown[] = [planResult.groundingMetadata].filter(Boolean);

    const groupResults = await Promise.all(formatGroups.map(async (group, groupIndex) => {
      const groupFormatsList = buildFormatsList(group, campaignData.formatNotes);
      const totalBannersInGroup = group.length * variantCount;
      const groupCategory = deriveFormatCategory(group[0]);

      const outputInstruction = isAbTest
        ? [
            "",
            `A/B TESTING — For EACH format in this group, produce ${variantCount} distinct variants.`,
            `Variation focus: ${abTestFocus} — ${getAbFocusDescription(abTestFocus)}`,
            "Variants of the same format must differ meaningfully in the focus area, not just minor tweaks.",
            `Total output: ${totalBannersInGroup} banners (${group.length} format${group.length > 1 ? "s" : ""} × ${variantCount} variants).`,
            `Wrap EACH banner with: <!-- BANNER_START --> (complete banner HTML) <!-- BANNER_END -->`,
          ].join("\n")
        : [
            `Total output: ${group.length} banner${group.length > 1 ? "s" : ""} — one per format listed.`,
            `Wrap EACH banner with: <!-- BANNER_START --> (complete banner HTML) <!-- BANNER_END -->`,
          ].join("\n");

      const planSection = extractPlanSection(creativePlan, groupCategory);

      const groupMessage = [
        storeNotice,
        sourceOrchestration,
        "",
        "=== CAMPAIGN ===",
        campaignFacts,
        "",
        `=== CREATIVE PLAN — ${groupCategory.toUpperCase()} ===`,
        planSection,
        "",
        `=== FORMAT GROUP ${groupIndex + 1}/${formatGroups.length}: ${groupCategory} ===`,
        groupFormatsList,
        hasApprovedExamples ? "Before writing HTML, retrieve and analyze the approved examples for this campaign. Use their winning principles as references, but do not copy their exact layout, dimensions, or element positions." : "",
        "Generate one banner per format listed above. Same campaign concept, but a distinct composition recipe for each exact size. Do not reuse the same logo/headline/product/CTA positions across ratios.",
        "Mandatory variation axes across formats: focal point, image crop, copy block shape, CTA placement, and background treatment. At least three of these must change between square, story, landscape, leaderboard, and rectangle.",
        groupIndex > 0 ? `Vary the visual composition from earlier groups — different focal point, crop, panel shape, or layout rhythm.` : "",
        outputInstruction,
      ].filter(Boolean).join("\n");

      // Scale max tokens: base per format × formats in group × variants
      const baseTokens = agentConfig.maxTokens ?? 16000;
      const effectiveMaxTokens = Math.min(baseTokens * group.length * variantCount, 65536);

      const result = await generateWithRetry(
        agentConfig.systemPrompt,
        groupMessage,
        agentConfig.model || "gemini-2.5-flash",
        agentConfig.temperature ?? 0.8,
        effectiveMaxTokens,
        apiKey,
        fileSearchStores.length ? fileSearchStores : undefined,
        referenceImages.length ? referenceImages : undefined
      );

      return {
        snippets: enforceAllBannerDimensions(extractBannerSnippets(result.text), group),
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
        assets: extractAssets(finalHtml),
        slug: `ad-${slugify(brandName)}`,
        creativeCount: snippets.length,
        formats,
        usedStores: fileSearchStores,
        groundingMetadata: groundingMetadata.length ? groundingMetadata : null,
        creativePlan,
        generationMode: "planned_per_format",
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
