import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function parseGeminiModelList(raw: string | undefined | null) {
  if (!raw) return [];
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter((model) => model.startsWith("gemini-"));
}

function uniqueModels(models: string[]) {
  return models.filter((value, index, array) => array.indexOf(value) === index);
}

const env = (globalThis as any).Deno?.env;

// Testing chain: start with flash for quality parity with admin, fall back to lite then pro.
const TESTING_HARDCODED_MODELS = ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.5-flash-lite"];
const TESTING_SITE_MODELS = (() => {
  const fromFullList = parseGeminiModelList(env?.get("GEMINI_SITE_MODELS_TESTING"));
  if (fromFullList.length > 0) return uniqueModels(fromFullList);

  const primary = env?.get("GEMINI_SITE_MODEL_TESTING") || TESTING_HARDCODED_MODELS[0];
  const fromFallback = parseGeminiModelList(env?.get("GEMINI_SITE_FALLBACK_MODELS_TESTING"));
  return uniqueModels([primary, ...fromFallback, ...TESTING_HARDCODED_MODELS]);
})();

// Admin chain: latency first, then quality, then high-availability fallback.
const ADMIN_HARDCODED_MODELS = ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.5-flash-lite"];
const SITE_GENERATION_MODELS = (() => {
  const fromFullList = parseGeminiModelList(env?.get("GEMINI_SITE_MODELS"));
  if (fromFullList.length > 0) return uniqueModels(fromFullList);

  const primary = env?.get("GEMINI_SITE_MODEL") || ADMIN_HARDCODED_MODELS[0];
  const fromFallback = parseGeminiModelList(env?.get("GEMINI_SITE_FALLBACK_MODELS"));
  return uniqueModels([primary, ...fromFallback, ...ADMIN_HARDCODED_MODELS]);
})();
// Token limits for direct HTML/CSS/JS generation.
// Raised to reduce incomplete/truncated pages for both admin and testing keys.
const STANDARD_MAX_TOKENS = 24000;
const COMPACT_MAX_TOKENS = 18000;
const TESTING_MAX_TOKENS = 24000;
const TESTING_COMPACT_TOKENS = 18000;

// JSON Schema enforced via responseSchema � API guarantees structure, eliminates fragile text parsing.
// All fields in `required` are always present; normalizeLandingPlan still applies defensive defaults.
const LANDING_PLAN_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    slug:    { type: "string" },
    logoUrl: { type: "string" },
    theme: {
      type: "object",
      properties: {
        style:          { type: "string", enum: ["modern","editorial","bold","premium","energetic","minimal"] },
        primary:        { type: "string" },
        secondary:      { type: "string" },
        accent:         { type: "string" },
        background:     { type: "string" },
        surface:        { type: "string" },
        text:           { type: "string" },
        mutedText:      { type: "string" },
        headingFont:    { type: "string" },
        bodyFont:       { type: "string" },
        cardStyle:      { type: "string", enum: ["elevated","glass","flat","outlined"] },
        spacingDensity: { type: "string", enum: ["compact","normal","spacious"] },
      },
      required: ["style","primary","secondary","accent","background","surface","text","mutedText","headingFont","bodyFont","cardStyle","spacingDensity"],
    },
    hero: {
      type: "object",
      properties: {
        eyebrow:           { type: "string" },
        title:             { type: "string" },
        subtitle:          { type: "string" },
        primaryCtaLabel:   { type: "string" },
        primaryCtaHref:    { type: "string" },
        secondaryCtaLabel: { type: "string" },
        secondaryCtaHref:  { type: "string" },
        imageUrl:          { type: "string" },
        heroLayout:        { type: "string", enum: ["fullscreen","split","centered","minimal"] },
      },
      required: ["eyebrow","title","subtitle","primaryCtaLabel","primaryCtaHref","secondaryCtaLabel","secondaryCtaHref","imageUrl","heroLayout"],
    },
    socialProofBar: { type: "array", items: { type: "string" } },
    sections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind:       { type: "string", enum: ["benefits","services","proof","story","steps","cta","results","form","embed"] },
          eyebrow:    { type: "string" },
          title:      { type: "string" },
          body:       { type: "string" },
          bullets:    { type: "array", items: { type: "string" } },
          layout:     { type: "string", enum: ["layout-split","layout-split-reverse","layout-cards","layout-copy-heavy","layout-mosaic","layout-featured","layout-wide-copy"] },
          embedCode:  { type: "string" },
          formFields: {
            type: "array",
            items: {
              type: "object",
              properties: {
                label:       { type: "string" },
                type:        { type: "string", enum: ["text","email","tel","textarea","select","checkbox","number","date"] },
                placeholder: { type: "string" },
                required:    { type: "boolean" },
                options:     { type: "array", items: { type: "string" } },
              },
              required: ["label","type"],
            },
          },
          formAction:  { type: "string" },
          formButton:  { type: "string" },
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title:       { type: "string" },
                description: { type: "string" },
                meta:        { type: "string" },
              },
              required: ["title","description"],
            },
          },
          imageUrl: { type: "string" },
        },
        required: ["kind","eyebrow","title","body"],
      },
    },
    faq: {
      type: "array",
      items: {
        type: "object",
        properties: {
          question: { type: "string" },
          answer:   { type: "string" },
        },
        required: ["question","answer"],
      },
    },
    faqSection: {
      type: "object",
      properties: {
        eyebrow:  { type: "string" },
        title:    { type: "string" },
        subtitle: { type: "string" },
      },
      required: ["eyebrow","title","subtitle"],
    },
    finalCta: {
      type: "object",
      properties: {
        eyebrow:         { type: "string" },
        title:           { type: "string" },
        body:            { type: "string" },
        primaryCtaLabel: { type: "string" },
        primaryCtaHref:  { type: "string" },
      },
      required: ["eyebrow","title","body","primaryCtaLabel","primaryCtaHref"],
    },
    footer: {
      type: "object",
      properties: { tagline: { type: "string" } },
      required: ["tagline"],
    },
    assets: { type: "array", items: { type: "string" } },
  },
  required: ["slug","logoUrl","theme","hero","socialProofBar","sections","faqSection","faq","finalCta","footer","assets"],
};

function buildAiUrl(model: string) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

type StructuredSitePayload = {
  html: string;
  css: string;
  js: string;
  assets: string[];
  slug?: string;
};

type LandingPlanTheme = {
  style: string;
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  surface: string;
  text: string;
  mutedText: string;
  headingFont: string;
  bodyFont: string;
  cardStyle?: string;
  spacingDensity?: string;
};

type LandingPlanSectionItem = {
  title: string;
  description: string;
  meta?: string;
  avatarUrl?: string;
};

type LandingPlanFormField = {
  label: string;
  type: string;
  placeholder?: string;
  required?: boolean;
  options?: string[];
};

type LandingPlanSection = {
  kind: string;
  layout?: string;
  eyebrow: string;
  title: string;
  body: string;
  bullets: string[];
  items: LandingPlanSectionItem[];
  imageUrl?: string;
  embedCode?: string;
  formFields?: LandingPlanFormField[];
  formAction?: string;
  formButton?: string;
};

type LandingPlanFaq = {
  question: string;
  answer: string;
};

type LandingPlan = {
  slug: string;
  logoUrl: string;
  theme: LandingPlanTheme;
  hero: {
    eyebrow: string;
    title: string;
    subtitle: string;
    primaryCtaLabel: string;
    primaryCtaHref: string;
    secondaryCtaLabel: string;
    secondaryCtaHref: string;
    imageUrl: string;
    heroLayout: string;
  };
  sections: LandingPlanSection[];
  faq: LandingPlanFaq[];
  faqSection: {
    eyebrow: string;
    title: string;
    subtitle: string;
  };
  finalCta: {
    eyebrow: string;
    title: string;
    body: string;
    primaryCtaLabel: string;
    primaryCtaHref: string;
  };
  footer: {
    tagline: string;
  };
  assets: string[];
};

/** Returns the perceived luminance (0�255) of a hex color string like "#1a2b3c". */
function hexLuminance(hex: string): number {
  const clean = hex.replace(/^#/, "");
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16);
    const g = parseInt(clean[1] + clean[1], 16);
    const b = parseInt(clean[2] + clean[2], 16);
    return 0.299 * r + 0.587 * g + 0.114 * b;
  }
  if (clean.length >= 6) {
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    return 0.299 * r + 0.587 * g + 0.114 * b;
  }
  return 128; // neutral fallback
}

function isLikelyLogoOrIconUrl(url: string): boolean {
  const value = String(url || "").toLowerCase();
  if (!value) return false;
  return /favicon|apple-touch-icon|mask-icon|site-icon|logo|\/icon|icon-|\.ico($|\?)/i.test(value);
}

/** Heuristically detect if a URL likely points to a person/face/portrait photo.
 * Used to prevent person images being misused as company logos.
 */
function isLikelyPersonImage(url: string): boolean {
  if (!url) return false;
  const value = String(url || "").toLowerCase();
  // Only flag URLs that have explicit person/portrait path hints — NOT Pexels hosts (Pexels serves all kinds of images)
  return /\/person[s]?\/|\/portrait[s]?\/|\/face[s]?\/|\/headshot[s]?\/|\/profile-photo|\/people\/|\/team-member|\/testimonial[s]?\/|\/staff\/|\/employee[s]?\/|\/crew\/|headshot|mugshot/i.test(value);
}

function normalizeThemeContrast(theme: LandingPlanTheme): LandingPlanTheme {
  const bgLum = hexLuminance(theme.background || "#f8fafc");
  const textLum = hexLuminance(theme.text || "#0f172a");
  const mutedLum = hexLuminance(theme.mutedText || "#475569");

  const contrastGap = Math.abs(bgLum - textLum);
  const mutedGap = Math.abs(bgLum - mutedLum);
  const useLightText = bgLum < 120;

  const safeText = contrastGap < 95
    ? (useLightText ? "#f8fafc" : "#0f172a")
    : (theme.text || (useLightText ? "#f8fafc" : "#0f172a"));

  const safeMuted = mutedGap < 55
    ? (useLightText ? "#cbd5e1" : "#475569")
    : (theme.mutedText || (useLightText ? "#cbd5e1" : "#475569"));

  return {
    ...theme,
    text: safeText,
    mutedText: safeMuted,
  };
}

/**
 * Picks a nav background and text color that match the brand's secondary color.
 * If secondary is dark we use it as the nav bg with white text.
 * If secondary is light we fall back to using the page background with body text.
 */
function resolveNavColors(theme: LandingPlanTheme): { navBg: string; navBgScrolled: string; navText: string; navBorder: string } {
  const secLuminance = hexLuminance(theme.secondary);
  const isDark = secLuminance < 140;

  if (isDark) {
    return {
      navBg: `${theme.secondary}cc`,        // ~80% opacity
      navBgScrolled: `${theme.secondary}f0`, // ~94% opacity
      navText: "#ffffff",
      navBorder: "rgba(255,255,255,0.12)",
    };
  }

  // Light secondary � use background color instead
  const bgLuminance = hexLuminance(theme.background);
  const bgIsDark = bgLuminance < 140;
  if (bgIsDark) {
    return {
      navBg: `${theme.background}cc`,
      navBgScrolled: `${theme.background}f0`,
      navText: "#ffffff",
      navBorder: "rgba(255,255,255,0.12)",
    };
  }

  // Both light � use a near-white translucent header with body text
  return {
    navBg: "rgba(255,255,255,0.72)",
    navBgScrolled: "rgba(255,255,255,0.92)",
    navText: theme.text || "#0f172a",
    navBorder: "rgba(148,163,184,0.18)",
  };
}

function slugify(value: string) {
  return (value || "site")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "site";
}

function toDataUriSvg(svg: string) {
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function buildMonogramLogoDataUri(name: string, theme: LandingPlanTheme) {
  const initials = (name || "Brand")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("") || "B";

  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='220' height='72' viewBox='0 0 220 72'>
  <defs>
    <linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>
      <stop offset='0%' stop-color='${theme.primary}' />
      <stop offset='100%' stop-color='${theme.accent}' />
    </linearGradient>
  </defs>
  <rect x='1' y='1' width='218' height='70' rx='16' fill='url(#g)' opacity='0.94' />
  <text x='110' y='46' fill='white' font-size='30' font-family='Arial, sans-serif' font-weight='700' text-anchor='middle'>${initials}</text>
  </svg>`;

  return toDataUriSvg(svg);
}

function buildFallbackHeroDataUri(theme: LandingPlanTheme) {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='1600' height='900' viewBox='0 0 1600 900'>
  <defs>
    <linearGradient id='bg' x1='0' y1='0' x2='1' y2='1'>
      <stop offset='0%' stop-color='${theme.secondary}' />
      <stop offset='100%' stop-color='${theme.primary}' />
    </linearGradient>
    <radialGradient id='orb1' cx='20%' cy='30%' r='40%'>
      <stop offset='0%' stop-color='${theme.accent}' stop-opacity='0.35' />
      <stop offset='100%' stop-color='${theme.accent}' stop-opacity='0' />
    </radialGradient>
    <radialGradient id='orb2' cx='80%' cy='20%' r='35%'>
      <stop offset='0%' stop-color='white' stop-opacity='0.18' />
      <stop offset='100%' stop-color='white' stop-opacity='0' />
    </radialGradient>
  </defs>
  <rect width='1600' height='900' fill='url(#bg)'/>
  <rect width='1600' height='900' fill='url(#orb1)'/>
  <rect width='1600' height='900' fill='url(#orb2)'/>
  </svg>`;

  return toDataUriSvg(svg);
}

function extractPromptAssetHints(promptText: string) {
  const getMatch = (patterns: RegExp[]) => {
    for (const pattern of patterns) {
      const match = promptText.match(pattern);
      if (match?.[1]) return match[1].trim();
    }
    return "";
  };

  const logoUrl = getMatch([
    /Logo:\s*(https?:\/\/[^\s\n\r]+)/i,
    /logo[^:\n]{0,30}:\s*(https?:\/\/[^\s\n\r]+)/i,
  ]);

  const heroUrl = getMatch([
    /AI Hero Image[^:]*:\s*(https?:\/\/[^\s\n\r]+)/i,
    /Hero image[^:]*:\s*(https?:\/\/[^\s\n\r]+)/i,
    /Hero image should use this URL only:\s*(https?:\/\/[^\s\n\r]+)/i,
  ]);

  return { logoUrl, heroUrl };
}

function escapeHtml(value: string) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Safe URL for HTML attributes � encodes < > & ' " but preserves percent-encoded data URIs intact. */
function safeUrl(value: string): string {
  const str = String(value || "");
  // Data URIs: ensure SVG content is properly percent-encoded so escapeHtml doesn't break them
  if (/^data:image\/svg\+xml/i.test(str)) {
    // If the SVG data URI happens to contain raw (un-encoded) HTML special chars, encode the whole URI path
    const commaIdx = str.indexOf(",");
    if (commaIdx !== -1) {
      const head = str.slice(0, commaIdx + 1);
      const body = str.slice(commaIdx + 1);
      // If already percent-encoded (e.g. from encodeURIComponent), leave as-is; otherwise encode
      const needsEncoding = /[<>&"']/.test(body);
      const safebody = needsEncoding ? encodeURIComponent(body) : body;
      return head + safebody;
    }
  }
  return escapeHtml(str);
}

function normalizeStringList(value: unknown, fallback: string[] = []) {
  if (!Array.isArray(value)) return fallback;
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

type PexelsPhoto = { id: string; url: string };

async function searchPexelsPhotos(
  query: string,
  apiKey: string,
  orientation: "portrait" | "landscape" = "portrait",
  perPage = 8,
): Promise<PexelsPhoto[]> {
  if (!apiKey || !query) return [];
  try {
    const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${Math.max(1, Math.min(perPage, 20))}&orientation=${orientation}`;
    const resp = await fetch(url, { headers: { Authorization: apiKey } });
    if (!resp.ok) return [];
    const data = await resp.json();
    const photos = Array.isArray(data?.photos) ? data.photos : [];
    return photos
      .map((photo: any) => ({
        id: String(photo?.id || "").trim(),
        url: String(photo?.src?.large2x || photo?.src?.large || photo?.src?.medium || "").trim(),
      }))
      .filter((item: PexelsPhoto) => item.id && item.url);
  } catch {
    return [];
  }
}

async function pickUniquePexelsPhoto(
  queries: string[],
  apiKey: string,
  usedPhotoIds: Set<string>,
  orientation: "portrait" | "landscape" = "portrait",
): Promise<string> {
  for (const rawQuery of queries) {
    const query = String(rawQuery || "").trim();
    if (!query) continue;
    const photos = await searchPexelsPhotos(query, apiKey, orientation, 10);
    const candidate = photos.find((photo) => !usedPhotoIds.has(photo.id));
    if (candidate?.url) {
      usedPhotoIds.add(candidate.id);
      return candidate.url;
    }
  }
  return "";
}

function normalizeSectionItems(value: unknown) {
  if (!Array.isArray(value)) return [] as LandingPlanSectionItem[];
  return value
    .map((item) => ({
      title: typeof item?.title === "string" ? item.title.trim() : "",
      description: typeof item?.description === "string" ? item.description.trim() : "",
      meta: typeof item?.meta === "string" ? item.meta.trim() : "",
      avatarUrl: typeof item?.avatarUrl === "string" ? item.avatarUrl.trim() : "",
    }))
    .filter((item) => item.title || item.description);
}

/** Enriches testimonial section items with avatar photos from Pexels.
 * Builds a search query from item.meta (role) or item.title and fetches
 * a portrait-oriented photo for each testimonial item. */
async function fetchTestimonialAvatars(plan: LandingPlan, pexelsKey: string): Promise<LandingPlan> {
  const updatedSections = [...plan.sections];
  const usedPhotoIds = new Set<string>();

  for (let si = 0; si < updatedSections.length; si++) {
    const section = updatedSections[si];
    if (section.kind !== "proof" || section.items.length === 0) continue;

    const updatedItems = [...section.items];
    for (let ii = 0; ii < Math.min(updatedItems.length, 4); ii++) {
      const item = updatedItems[ii];
      const roleSource = item.meta || item.title || "";
      const roleKeywords = roleSource
        .replace(/[^a-zA-Z\s]/g, " ")
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 4)
        .join(" ");
      const queries = [
        `professional ${roleKeywords || "business"} headshot`,
        `${roleKeywords || "business"} portrait`,
        "professional portrait",
      ];
      const url = await pickUniquePexelsPhoto(queries, pexelsKey, usedPhotoIds, "portrait");
      if (url) {
        updatedItems[ii] = { ...updatedItems[ii], avatarUrl: url };
      }
    }
    updatedSections[si] = { ...section, items: updatedItems };
  }

  const allAvatars = updatedSections
    .flatMap((s) => (s.kind === "proof" ? s.items.map((item) => item.avatarUrl || "") : []))
    .filter(Boolean);

  return {
    ...plan,
    sections: updatedSections,
    assets: Array.from(new Set([...plan.assets, ...allAvatars])),
  };
}

function normalizeLandingPlan(candidate: any, businessName?: string, promptAssetHints?: { logoUrl?: string; heroUrl?: string }, contractSections?: ContractSection[], formData?: FormDataSnapshot): LandingPlan {
  const slug = slugify(typeof candidate?.slug === "string" ? candidate.slug : businessName || "site");
  const theme = {
    style: typeof candidate?.theme?.style === "string" ? candidate.theme.style.trim() : "modern",
    primary: typeof candidate?.theme?.primary === "string" ? candidate.theme.primary.trim() : "#2563eb",
    secondary: typeof candidate?.theme?.secondary === "string" ? candidate.theme.secondary.trim() : "#0f172a",
    accent: typeof candidate?.theme?.accent === "string" ? candidate.theme.accent.trim() : "#f59e0b",
    background: typeof candidate?.theme?.background === "string" ? candidate.theme.background.trim() : "#f8fafc",
    surface: typeof candidate?.theme?.surface === "string" ? candidate.theme.surface.trim() : "#ffffff",
    text: typeof candidate?.theme?.text === "string" ? candidate.theme.text.trim() : "#0f172a",
    mutedText: typeof candidate?.theme?.mutedText === "string" ? candidate.theme.mutedText.trim() : "#475569",
    headingFont: typeof candidate?.theme?.headingFont === "string" ? candidate.theme.headingFont.trim() : "Inter",
    bodyFont: typeof candidate?.theme?.bodyFont === "string" ? candidate.theme.bodyFont.trim() : "Inter",
    cardStyle: typeof candidate?.theme?.cardStyle === "string" ? candidate.theme.cardStyle.trim() : "elevated",
    spacingDensity: typeof candidate?.theme?.spacingDensity === "string" ? candidate.theme.spacingDensity.trim() : "normal",
  };

  const hero = {
    eyebrow: typeof candidate?.hero?.eyebrow === "string" ? candidate.hero.eyebrow.trim() : "Premium solution",
    title: typeof candidate?.hero?.title === "string" ? candidate.hero.title.trim() : `${businessName || "Your business"} that converts with clarity`,
    subtitle: typeof candidate?.hero?.subtitle === "string" ? candidate.hero.subtitle.trim() : "A high-converting landing page with strong positioning, clear proof, and a persuasive CTA path.",
    primaryCtaLabel: typeof candidate?.hero?.primaryCtaLabel === "string" ? candidate.hero.primaryCtaLabel.trim() : "Get started",
    primaryCtaHref: typeof candidate?.hero?.primaryCtaHref === "string" ? candidate.hero.primaryCtaHref.trim() : "#final-cta",
    secondaryCtaLabel: typeof candidate?.hero?.secondaryCtaLabel === "string" ? candidate.hero.secondaryCtaLabel.trim() : "Learn more",
    secondaryCtaHref: typeof candidate?.hero?.secondaryCtaHref === "string" ? candidate.hero.secondaryCtaHref.trim() : "#sections",
    imageUrl: typeof candidate?.hero?.imageUrl === "string" ? candidate.hero.imageUrl.trim() : "",
    heroLayout: typeof candidate?.hero?.heroLayout === "string" ? candidate.hero.heroLayout.trim() : "fullscreen",
  };

  const candidateAssets = normalizeStringList(candidate?.assets);
  // Logo: ONLY use the URL explicitly provided by the user (via formData or promptAssetHints).
  // Never pick a logo from AI response fields, brandImage, or asset list — those can be person photos.
  // Priority: formData.images.logo (user-provided) > promptAssetHints.logoUrl (from prompt)
  const logoUrl = (formData?.images?.logo || promptAssetHints?.logoUrl || "").trim();

  const heroFromAssets = candidateAssets.find((asset) => !/logo|brand|icon|mark/i.test(asset) && !isLikelyLogoOrIconUrl(asset));
  const heroInputImage = hero.imageUrl && !isLikelyLogoOrIconUrl(hero.imageUrl) ? hero.imageUrl : "";
  const hintedHero = (promptAssetHints?.heroUrl && !isLikelyLogoOrIconUrl(promptAssetHints.heroUrl)) ? promptAssetHints.heroUrl : "";
  const resolvedHeroImage = heroInputImage || hintedHero || heroFromAssets || "";

  const sections = (Array.isArray(candidate?.sections) ? candidate.sections : [])
    .map((section: any, index: number) => ({
      kind: typeof section?.kind === "string" ? section.kind.trim() : (index % 2 === 0 ? "benefits" : "services"),
      layout: typeof section?.layout === "string" ? section.layout.trim() : "",
      eyebrow: typeof section?.eyebrow === "string" ? section.eyebrow.trim() : "",
      title: typeof section?.title === "string" ? section.title.trim() : "",
      body: typeof section?.body === "string" ? section.body.trim() : "",
      bullets: normalizeStringList(section?.bullets),
      items: normalizeSectionItems(section?.items),
      imageUrl: typeof section?.imageUrl === "string" && !/^(steps|results|proof|cta)$/i.test(typeof section?.kind === "string" ? section.kind.trim() : "") ? section.imageUrl.trim() : "",
      embedCode: typeof section?.embedCode === "string" ? section.embedCode.trim() : "",
      formFields: Array.isArray(section?.formFields)
        ? section.formFields.map((f: any) => ({
            label: typeof f?.label === "string" ? f.label.trim() : "",
            type: typeof f?.type === "string" ? f.type.trim() : "text",
            placeholder: typeof f?.placeholder === "string" ? f.placeholder.trim() : "",
            required: Boolean(f?.required),
            options: Array.isArray(f?.options) ? f.options.map((o: unknown) => String(o)).filter(Boolean) : [],
          })).filter((f: LandingPlanFormField) => f.label)
        : [],
      formAction: typeof section?.formAction === "string" ? section.formAction.trim() : "",
      formButton: typeof section?.formButton === "string" ? section.formButton.trim() : "",
    }))
    // faq content belongs in plan.faq[], not in sections � exclude to avoid double FAQ blocks
    .filter((section: LandingPlanSection) =>
      // Never drop form or embed sections � the contract enforcer may still inject embedCode/formFields
      /^(form|embed)$/i.test(section.kind)
      || (section.title || section.body || section.items.length > 0 || section.bullets.length > 0 || section.embedCode || section.formFields?.length)
      && !/^faq$/i.test(section.kind));

  // -- Contract enforcement (deterministic layer) --------------------------
  // When the user configured explicit sections, enforce them now regardless of
  // what the AI produced. This guarantees order, count, and kind values.
  // Falls back to the 4-section default only when no contract is provided.
  const contractBinding = Array.isArray(contractSections) ? contractSections : [];
  const hasContract = contractBinding.length > 0;

  const resolvedSections: LandingPlanSection[] = hasContract
    ? enforceContractSections(sections, contractBinding)
    : (sections.length >= 4 ? sections : undefined as any);

  // Legacy fallback � only used when there is no contract and AI returned < 4 sections
  const fallbackSections: LandingPlanSection[] = resolvedSections ?? [
    {
      kind: "benefits",
      eyebrow: "Why it matters",
      title: "Clear benefits that make the offer easy to understand",
      body: "Show the strongest business outcomes first so the page earns attention quickly.",
      bullets: ["Fast comprehension", "Strong positioning", "Visible value"],
      items: [],
      imageUrl: "",
    },
    {
      kind: "services",
      eyebrow: "What you get",
      title: "A focused solution explained with practical detail",
      body: "Translate the offer into concrete deliverables, differentiators, and use cases.",
      bullets: [],
      items: [
        { title: "Structured offer", description: "Explain what is delivered and why it matters." },
        { title: "Confident positioning", description: "State what makes the business distinct." },
        { title: "Clear CTA path", description: "Move the visitor toward the next step." },
      ],
      imageUrl: "",
    },
    {
      kind: "proof",
      eyebrow: "Proof",
      title: "Trust signals that reduce hesitation",
      body: "Use proof, testimonials, outcomes, or credibility markers before the final CTA.",
      bullets: [],
      items: [
        { title: "Trusted process", description: "Show confidence with proof-oriented messaging." },
        { title: "Real outcomes", description: "Keep the claims believable and specific." },
      ],
      imageUrl: "",
    },
    {
      kind: "cta",
      eyebrow: "Ready",
      title: "A final call to action with minimal friction",
      body: "Close with a clear next step, strong CTA label, and concise reassurance.",
      bullets: ["Clear next step", "Low friction", "Strong CTA copy"],
      items: [],
      imageUrl: "",
    },
  ];

  const faq = (Array.isArray(candidate?.faq) ? candidate.faq : [])
    .map((item: any) => ({
      question: typeof item?.question === "string" ? item.question.trim() : "",
      answer: typeof item?.answer === "string" ? item.answer.trim() : "",
    }))
    .filter((item: LandingPlanFaq) => item.question && item.answer)
    .slice(0, 5);

  const socialProofBar = normalizeStringList(candidate?.socialProofBar, ["Trusted teams", "High-conviction messaging", "Conversion-focused structure"]).slice(0, 5);

  const faqSection = {
    eyebrow: typeof candidate?.faqSection?.eyebrow === "string" ? candidate.faqSection.eyebrow.trim() : "FAQ",
    title: typeof candidate?.faqSection?.title === "string" ? candidate.faqSection.title.trim() : "Frequently Asked Questions",
    subtitle: typeof candidate?.faqSection?.subtitle === "string" ? candidate.faqSection.subtitle.trim() : (typeof candidate?.footer?.tagline === "string" ? candidate.footer.tagline.trim() : "Everything you need to know."),
  };

  const finalCta = {
    eyebrow: typeof candidate?.finalCta?.eyebrow === "string" ? candidate.finalCta.eyebrow.trim() : "Next step",
    title: typeof candidate?.finalCta?.title === "string" ? candidate.finalCta.title.trim() : "Ready to move forward?",
    body: typeof candidate?.finalCta?.body === "string" ? candidate.finalCta.body.trim() : "Take the next step with a clear, high-confidence CTA.",
    primaryCtaLabel: typeof candidate?.finalCta?.primaryCtaLabel === "string" ? candidate.finalCta.primaryCtaLabel.trim() : hero.primaryCtaLabel,
    primaryCtaHref: typeof candidate?.finalCta?.primaryCtaHref === "string" ? candidate.finalCta.primaryCtaHref.trim() : hero.primaryCtaHref,
  };

  const footer = {
    tagline: typeof candidate?.footer?.tagline === "string" ? candidate.footer.tagline.trim() : `${businessName || "This brand"} built for clarity, trust, and conversion.`,
  };

  const finalSections = resolvedSections ?? fallbackSections;

  const assets = Array.from(new Set([
    logoUrl,
    resolvedHeroImage,
    ...finalSections.map((section) => section.imageUrl),
    ...candidateAssets,
  ].filter((value) => typeof value === "string" && value.trim() !== "")));

  const resolvedTheme = normalizeThemeContrast(theme);
  const finalLogoUrl = logoUrl;
  const finalHeroImage = resolvedHeroImage || buildFallbackHeroDataUri(resolvedTheme);

  return {
    slug,
    logoUrl: finalLogoUrl,
    theme: resolvedTheme,
    hero,
    socialProofBar,
    sections: finalSections,
    faq,
    faqSection,
    finalCta,
    footer,
    assets: Array.from(new Set([finalLogoUrl, finalHeroImage, ...assets].filter(Boolean))),
  };
}

function getLandingPlanValidationError(plan: LandingPlan | null, hasContract = false) {
  if (!plan) return "missing-plan";
  if (!plan.hero.title || plan.hero.title.length < 12) return "weak-hero-title";
  if (!plan.hero.primaryCtaLabel) return "missing-hero-cta";
  // When a section contract is active the minimum is 1 (user decides the count);
  // without a contract require at least 4 AI-generated sections.
  if (plan.sections.length < (hasContract ? 1 : 4)) return "too-few-sections";
  // Skip proof-strategy check when the user's contract governs the sections
  // (the user may legitimately not include a proof section).
  if (!hasContract && !plan.sections.some((section) => /proof|testimonial|review|results|trust|faq/i.test(section.kind) || /proof|trust|testimonial|result/i.test(`${section.title} ${section.body}`))) {
    return "missing-proof-strategy";
  }
  return null;
}

function parseLandingPlanText(rawText: string, businessName?: string, promptAssetHints?: { logoUrl?: string; heroUrl?: string }, contractSections?: ContractSection[], formData?: FormDataSnapshot) {
  if (!rawText || !rawText.trim()) return null;
  try {
    // responseSchema guarantees valid JSON � direct parse is the primary path
  return normalizeLandingPlan(JSON.parse(rawText.trim()), businessName, promptAssetHints, contractSections, formData);
  } catch {
    // Fallback: extract JSON if model somehow wrapped output despite responseSchema (defensive)
    const jsonCandidate = findFirstJsonObject(stripCodeFences(rawText));
    if (!jsonCandidate) return null;
    try {
      return normalizeLandingPlan(JSON.parse(jsonCandidate), businessName, promptAssetHints, contractSections, formData);
    } catch (error) {
      console.warn("Failed to parse landing plan JSON", error);
      return null;
    }
  }
}

// -----------------------------------------------------------------
// Section contract enforcement � runs AFTER the AI response is parsed
// This is the deterministic layer: regardless of what the AI returned,
// the user-configured section order, count, and kinds are guaranteed.
// -----------------------------------------------------------------
type ContractSection = {
  name: string;
  kind: string;
  required: boolean;
  description: string;
  embedCode?: string;
  formAction?: string;
  formButton?: string;
  formFields?: Array<{ label: string; type: string; placeholder?: string; required?: boolean }>;
};

// -----------------------------------------------------------------
// Structured form data snapshot � sent by the frontend alongside the
// text prompt. Used to build a deterministic plan skeleton so that
// theme colors, fonts, image URLs, and service items are ALWAYS
// correct regardless of what the AI writes back.
// -----------------------------------------------------------------
type FormDataSnapshot = {
  landingPreset?: string;
  generationObjective?: string;
  sessionsObjectiveContext?: string;
  theme: {
    style: string;
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    text: string;
    headingFont: string;
    bodyFont: string;
  };
  images: {
    logo: string;
    hero: string;
    sections: string[];
    about: string;
    team: string;
    products: string[];
  };
  services: string[];
  differentiators: string[];
  contact: {
    email: string;
    phone: string;
    whatsapp: string;
  };
  socialLinks?: {
    facebook?: string;
    instagram?: string;
    twitter?: string;
    linkedin?: string;
    youtube?: string;
  };
  language: string;
  conversionGoal: string;
  guarantee: string;
  urgencyLevel?: string;
  countdownTimer?: boolean;
  brandPersonality?: string;
  toneOfVoice?: string;
  useCarousel?: boolean;
  useAiImages?: boolean;
  imageContexts?: {
    heroImage1?: string;
    heroImage2?: string;
    sectionImage1?: string;
    sectionImage2?: string;
    sectionImage3?: string;
    aboutImage?: string;
    teamImage?: string;
    brandImage?: string;
  };
  location?: {
    city?: string;
    country?: string;
  };
  socialProofConfig?: {
    socialProof?: boolean;
    testimonials?: boolean;
    trustBadges?: boolean;
  };
  sourceWebsite?: string;
  designNotes?: string;
  businessCategory?: string;
  downloadFiles?: Array<{ name: string; label?: string; context?: string; url: string; mime?: string }>;
  imageDimensions?: {
    logo?: string;       // e.g. "200x80 (landscape)" or "100x100 (square)"
    hero?: string;       // e.g. "1920x1080 (landscape)"
    sections?: string[]; // per-slot dimension hint
    about?: string;
    team?: string;
  };
  imagePolicy?: {
    forceUseUploaded?: boolean;
    mustUse?: string[];
  };
};

function enforceContractSections(
  aiSections: LandingPlanSection[],
  contract: ContractSection[],
): LandingPlanSection[] {
  // Filter to only sections[] entries (hero ? plan.hero, faq ? plan.faq[])
  const binding = contract.filter((s) => s.kind && s.kind.length > 0 && !/^faq$/i.test(s.kind));
  if (binding.length === 0) return aiSections;

  // Try to match AI sections by kind first (better than pure positional matching)
  // Build a pool of AI sections indexed by kind for greedy matching
  const aiPool: (LandingPlanSection | null)[] = [...aiSections];
  const consumeAiByKind = (kind: string): LandingPlanSection | null => {
    const idx = aiPool.findIndex((s) => s !== null && s.kind === kind);
    if (idx !== -1) { const s = aiPool[idx]; aiPool[idx] = null; return s; }
    // Fallback: use any unconsumed section from corresponding position
    return null;
  };
  let positionalIdx = 0;
  const consumeAiPositional = (): LandingPlanSection | null => {
    while (positionalIdx < aiPool.length) {
      const s = aiPool[positionalIdx];
      positionalIdx++;
      if (s !== null) return s;
    }
    return null;
  };

  return binding.map((entry) => {
    // Prefer an AI section that already has the correct kind; fall back to positional
    const ai = consumeAiByKind(entry.kind) || consumeAiPositional();
    if (ai) {
      // Keep AI-generated content but force the correct kind and label to match contract
      // For embed sections, always override embedCode from the contract (user-provided, not AI-generated)
      // For form sections, override formAction/formButton/formFields when user provided them
      return {
        ...ai,
        kind: entry.kind as LandingPlanSection["kind"],
        ...(entry.kind === "embed" && entry.embedCode ? { embedCode: entry.embedCode } : {}),
        ...(entry.kind === "form" && entry.formAction !== undefined ? { formAction: entry.formAction } : {}),
        ...(entry.kind === "form" && entry.formButton ? { formButton: entry.formButton } : {}),
        ...(entry.kind === "form" && entry.formFields?.length ? { formFields: entry.formFields as LandingPlanFormField[] } : {}),
      };
    }
    // Se o contrato exigir embed e a IA não gerar, injeta a seção embed com o embedCode do usuário, sem placeholder de texto
    if (entry.kind === 'embed' && entry.embedCode) {
      return {
        kind: 'embed',
        eyebrow: '',
        title: entry.name,
        body: '',
        bullets: [],
        items: [],
        imageUrl: '',
        embedCode: entry.embedCode,
      };
    }
    // Para outros casos, injeta placeholder minimalista
    return {
      kind: entry.kind as LandingPlanSection["kind"],
      eyebrow: "",
      title: entry.name,
      body: entry.description || "",
      bullets: [],
      items: [],
      imageUrl: "",
      embedCode: entry.embedCode || "",
      formAction: entry.formAction,
      formButton: entry.formButton,
      formFields: entry.formFields as LandingPlanFormField[] | undefined,
    };
  });
}

function enforceRequiredVisualAssets(plan: LandingPlan, businessName?: string): LandingPlan {
  const ensuredLogoUrl = (plan.logoUrl || "").trim();
  const ensuredHeroImage = (plan.hero.imageUrl || "").trim() || buildFallbackHeroDataUri(plan.theme);

  return {
    ...plan,
    logoUrl: ensuredLogoUrl,
    hero: {
      ...plan.hero,
      imageUrl: ensuredHeroImage,
    },
    assets: Array.from(new Set([ensuredLogoUrl, ensuredHeroImage, ...plan.assets].filter(Boolean))),
  };
}

// -----------------------------------------------------------------
// Skeleton pre-population � builds a partial LandingPlan from the
// structured FormDataSnapshot, guaranteeing correct theme, images,
// and service-item titles without relying on AI text parsing.
// -----------------------------------------------------------------
function buildPlanSkeleton(
  formData: FormDataSnapshot,
  contractSections: ContractSection[],
  businessName: string,
): Partial<LandingPlan> {
  // Map landing preset to appropriate visual style when user hasn't explicitly overridden style
  const presetStyleMap: Record<string, string> = {
    "black-friday": "bold",
    "launch": "energetic",
    "webinar": "modern",
    "lead-capture": "minimal",
    "app-download": "modern",
    "seasonal": "bold",
    "campaign": "energetic",
    "general": "modern",
  };
  const baseStyle = (formData.theme.style || "modern").trim();
  // Only apply preset style override if the user left style as "modern" (default)
  // If user explicitly chose a style, respect it
  const resolvedStyle = baseStyle === "modern" && formData.landingPreset && presetStyleMap[formData.landingPreset]
    ? presetStyleMap[formData.landingPreset]
    : baseStyle;

  const theme: LandingPlanTheme = normalizeThemeContrast({
    style: resolvedStyle,
    primary: formData.theme.primary || "#2563eb",
    secondary: formData.theme.secondary || "#0f172a",
    accent: formData.theme.accent || "#f59e0b",
    background: formData.theme.background || "#f8fafc",
    surface: "#ffffff",
    text: formData.theme.text || "#0f172a",
    mutedText: "#475569",
    headingFont: formData.theme.headingFont || "Inter",
    bodyFont: formData.theme.bodyFont || "Inter",
  });

  // Build a CTA href from contact info (preferred: WhatsApp ? email ? anchor)
  const ctaHref = formData.contact.whatsapp
    ? `https://wa.me/${formData.contact.whatsapp.replace(/\D/g, "")}`
    : formData.contact.email
    ? `mailto:${formData.contact.email}`
    : "#final-cta";

  // Pre-assign section images from the available pool
  // Deduplicate so the same photo never appears in two different sections.
  const safeHeroImage = !isLikelyLogoOrIconUrl(formData.images.hero) ? formData.images.hero : "";
  const safeSectionImages = (formData.images.sections || []).filter((img) => !isLikelyLogoOrIconUrl(img));
  const usedImageUrls = new Set<string>([safeHeroImage, formData.images.logo].filter(Boolean));
  const imagePool = safeSectionImages.filter(img => {
    if (!img || usedImageUrls.has(img)) return false;
    usedImageUrls.add(img);
    return true;
  });
  // Only assign images to section kinds that visually benefit from a supporting image
  // steps ? grid layout, results ? stats grid � images look wrong in those
  const SECTION_KINDS_WITH_IMAGE = /^(story|benefits|services)$/i;
  let imagePoolIndex = 0;
  const binding = contractSections.filter((s) => s.kind && !/^faq$/i.test(s.kind));
  const sectionSkeletons: LandingPlanSection[] = binding.map((cs) => {
    let imageUrl = "";
    // Route about/team images to the semantically matching section kind
    if (/^story$|about/i.test(cs.kind) && formData.images.about) {
      imageUrl = isLikelyLogoOrIconUrl(formData.images.about) ? "" : formData.images.about;
    } else if (/^team/i.test(cs.kind) && formData.images.team) {
      imageUrl = isLikelyLogoOrIconUrl(formData.images.team) ? "" : formData.images.team;
    } else if (SECTION_KINDS_WITH_IMAGE.test(cs.kind) && imagePool[imagePoolIndex]) {
      // Only consume an imagePool slot for visual-friendly sections
      imageUrl = imagePool[imagePoolIndex++];
    }
    // cta, proof, results sections typically look better without a section image �
    // let AI decide by leaving imageUrl blank; the skeleton won't override with a wrong image

    // Pre-seed items for service sections from the user's services list.
    // AI fills in the descriptions; we guarantee the service names are exact.
    const items: LandingPlanSectionItem[] = [];
    if (/^services$/i.test(cs.kind) && formData.services.length > 0) {
      formData.services.forEach((svc) => items.push({ title: svc, description: "", meta: "" }));
    }

    return { kind: cs.kind, eyebrow: "", title: "", body: "", bullets: [], items, imageUrl };
  });

  return {
    theme,
    logoUrl: formData.images.logo || "",
    hero: {
      eyebrow: "",
      title: "",
      subtitle: "",
      primaryCtaLabel: "",
      primaryCtaHref: ctaHref,
      secondaryCtaLabel: "",
      secondaryCtaHref: "#sections",
      imageUrl: safeHeroImage || "",
    },
    sections: sectionSkeletons,
    finalCta: { title: "", body: "", primaryCtaLabel: "", primaryCtaHref: ctaHref },
    footer: { tagline: "" },
  };
}

// Overlay skeleton values on the AI-generated plan.
// Skeleton wins for deterministic fields (theme, images, service item titles, CTA hrefs).
// AI wins for all creative text (headline, body, bullets, descriptions).
function mergeSkeletonIntoPlan(plan: LandingPlan, skeleton: Partial<LandingPlan>): LandingPlan {
  const mergedTheme = skeleton.theme ? {
    ...plan.theme,
    ...skeleton.theme,
    // Always keep AI-chosen layout fields � skeleton doesn't know business context
    cardStyle: plan.theme.cardStyle || skeleton.theme.cardStyle,
    spacingDensity: plan.theme.spacingDensity || skeleton.theme.spacingDensity,
  } : plan.theme;

  return {
    ...plan,
    // Merge theme: skeleton controls colors/fonts/style (deterministic),
    // but AI's choices for cardStyle/spacingDensity are preserved since skeleton doesn't set them.
    theme: normalizeThemeContrast(mergedTheme),
    logoUrl: (skeleton.logoUrl && skeleton.logoUrl.trim()) ? skeleton.logoUrl : plan.logoUrl,
    hero: {
      ...plan.hero,
      imageUrl: (skeleton.hero?.imageUrl && skeleton.hero.imageUrl.trim()) ? skeleton.hero.imageUrl : plan.hero.imageUrl,
      primaryCtaHref: skeleton.hero?.primaryCtaHref || plan.hero.primaryCtaHref,
      secondaryCtaHref: skeleton.hero?.secondaryCtaHref || plan.hero.secondaryCtaHref,
      // AI-chosen heroLayout is always preserved � skeleton never overrides it
      heroLayout: plan.hero.heroLayout || "fullscreen",
    },
    sections: plan.sections.map((aiSection, i) => {
      const sk = skeleton.sections?.[i];
      if (!sk) return aiSection;
      // Merge items: skeleton provides exact service names, AI provides descriptions
      const items: LandingPlanSectionItem[] = sk.items.length > 0
        ? sk.items.map((skItem, j) => ({
            title: skItem.title,
            description: aiSection.items[j]?.description || "",
            meta: aiSection.items[j]?.meta || "",
          }))
        : aiSection.items;
      // Sections where images look wrong (steps/results/proof/cta) should never have one,
      // even if the AI hallucinated an imageUrl for them.
      const NO_IMAGE_KINDS = /^(steps|results|proof|cta)$/i;
      const resolvedImageUrl = NO_IMAGE_KINDS.test(aiSection.kind)
        ? ""
        : (sk.imageUrl && sk.imageUrl.trim()) ? sk.imageUrl : aiSection.imageUrl;
      return {
        ...aiSection,
        imageUrl: resolvedImageUrl,
        items,
      };
    }),
    finalCta: {
      ...plan.finalCta,
      primaryCtaHref: skeleton.finalCta?.primaryCtaHref || plan.finalCta.primaryCtaHref,
    },
  };
}

function getFontStack(fontName: string, fallback: string) {
  const normalized = fontName.trim().toLowerCase();
  const knownStacks: Record<string, string> = {
    inter: 'Inter, "Segoe UI", sans-serif',
    syne: 'Syne, "Arial Black", sans-serif',
    sora: 'Sora, "Trebuchet MS", sans-serif',
    manrope: 'Manrope, "Segoe UI", sans-serif',
    montserrat: 'Montserrat, "Trebuchet MS", sans-serif',
    outfit: 'Outfit, "Segoe UI", sans-serif',
    fraunces: 'Fraunces, Georgia, serif',
    georgia: 'Georgia, "Times New Roman", serif',
    merriweather: 'Merriweather, Georgia, serif',
    playfair: '"Playfair Display", Georgia, serif',
    lora: 'Lora, Georgia, serif',
    dmserif: '"DM Serif Display", Georgia, serif',
  };

  return knownStacks[normalized] || `${fontName}, ${fallback}`;
}

function getStylePreset(style: string) {
  const normalized = style.trim().toLowerCase();
  const presets: Record<string, {
    bodyClass: string;
    heroClass: string;
    sectionPattern: string[];
    heroGlow: string;
    surfaceGlow: string;
    proofClass: string;
    headingFallback: string;
    bodyFallback: string;
  }> = {
    editorial: {
      bodyClass: "theme-editorial",
      heroClass: "hero-editorial",
      sectionPattern: ["layout-copy-heavy", "layout-split-reverse", "layout-cards", "layout-split", "layout-wide-copy"],
      heroGlow: "linear-gradient(135deg, rgba(127, 29, 29, 0.24), rgba(15, 23, 42, 0.9))",
      surfaceGlow: "radial-gradient(circle at top right, rgba(245, 158, 11, 0.18), transparent 38%)",
      proofClass: "proof-editorial",
      headingFallback: 'Georgia, serif',
      bodyFallback: '"Trebuchet MS", sans-serif',
    },
    bold: {
      bodyClass: "theme-bold",
      heroClass: "hero-bold",
      sectionPattern: ["layout-split", "layout-cards", "layout-mosaic", "layout-copy-heavy", "layout-featured"],
      heroGlow: "linear-gradient(135deg, rgba(37, 99, 235, 0.22), rgba(15, 23, 42, 0.94))",
      surfaceGlow: "radial-gradient(circle at 10% 20%, rgba(99, 102, 241, 0.2), transparent 28%)",
      proofClass: "proof-bold",
      headingFallback: '"Arial Black", sans-serif',
      bodyFallback: '"Segoe UI", sans-serif',
    },
    premium: {
      bodyClass: "theme-premium",
      heroClass: "hero-premium",
      sectionPattern: ["layout-split", "layout-copy-heavy", "layout-split-reverse", "layout-cards", "layout-featured"],
      heroGlow: "linear-gradient(135deg, rgba(180, 83, 9, 0.18), rgba(15, 23, 42, 0.96))",
      surfaceGlow: "radial-gradient(circle at top left, rgba(245, 158, 11, 0.16), transparent 32%)",
      proofClass: "proof-premium",
      headingFallback: 'Georgia, serif',
      bodyFallback: '"Segoe UI", sans-serif',
    },
    energetic: {
      bodyClass: "theme-energetic",
      heroClass: "hero-energetic",
      sectionPattern: ["layout-mosaic", "layout-split", "layout-cards", "layout-split-reverse", "layout-wide-copy"],
      heroGlow: "linear-gradient(135deg, rgba(190, 24, 93, 0.24), rgba(30, 41, 59, 0.92))",
      surfaceGlow: "radial-gradient(circle at 85% 12%, rgba(244, 63, 94, 0.22), transparent 34%)",
      proofClass: "proof-energetic",
      headingFallback: '"Trebuchet MS", sans-serif',
      bodyFallback: '"Segoe UI", sans-serif',
    },
    minimal: {
      bodyClass: "theme-minimal",
      heroClass: "hero-minimal",
      sectionPattern: ["layout-copy-heavy", "layout-split", "layout-wide-copy", "layout-cards"],
      heroGlow: "linear-gradient(135deg, rgba(15, 23, 42, 0.08), rgba(15, 23, 42, 0.84))",
      surfaceGlow: "radial-gradient(circle at top right, rgba(15, 23, 42, 0.08), transparent 36%)",
      proofClass: "proof-minimal",
      headingFallback: '"Segoe UI", sans-serif',
      bodyFallback: '"Segoe UI", sans-serif',
    },
    modern: {
      bodyClass: "theme-modern",
      heroClass: "hero-modern",
      sectionPattern: ["layout-split", "layout-cards", "layout-copy-heavy", "layout-mosaic", "layout-featured"],
      heroGlow: "linear-gradient(135deg, rgba(37, 99, 235, 0.22), rgba(15, 23, 42, 0.92))",
      surfaceGlow: "radial-gradient(circle at top right, rgba(37, 99, 235, 0.14), transparent 34%)",
      proofClass: "proof-modern",
      headingFallback: '"Segoe UI", sans-serif',
      bodyFallback: '"Segoe UI", sans-serif',
    },
  };

  return presets[normalized] || presets.modern;
}

function renderSection(section: LandingPlanSection, index: number, layout: string) {
  const safeEyebrow = escapeHtml(section.eyebrow);
  const safeTitle = escapeHtml(section.title);
  const safeBody = escapeHtml(section.body);
  const isReversed = layout === "layout-split-reverse";
  const kind = section.kind || "benefits";
  const bg = index % 2 === 0 ? "section-light" : "section-dark";

  // Suppress section image when the section kind renders a card grid or has many items
  // (image would collide with the dense grid layout and look broken).
  const SUPPRESS_IMAGE_KINDS = /^(steps|results|proof|cta|form|embed)$/i;
  const hasManyCards = section.items.length >= 4;
  const imageHtml = (!SUPPRESS_IMAGE_KINDS.test(kind) && !hasManyCards && section.imageUrl)
    ? `<div class="section-media" data-reveal="zoom"><img src="${safeUrl(section.imageUrl)}" alt="${safeEyebrow || safeTitle}" loading="lazy"></div>`
    : "";

  // -- kind: proof / testimonials ----------------------------------------------
  if (kind === "proof") {
    const testimonialCards = section.items.length > 0
      ? section.items.map((item, i) => `
          <figure class="testimonial-card" style="--stagger:${i};" data-reveal="slide-up">
            <blockquote><p>${escapeHtml(item.description)}</p></blockquote>
            <figcaption class="testimonial-meta">
              ${item.avatarUrl ? `<img class="testimonial-avatar" src="${safeUrl(item.avatarUrl)}" alt="${escapeHtml(item.title)}" loading="lazy">` : ""}
              <div class="testimonial-meta-text">
                <strong>${escapeHtml(item.title)}</strong>
                ${item.meta ? `<span>${escapeHtml(item.meta)}</span>` : ""}
              </div>
            </figcaption>
          </figure>`).join("")
      : section.bullets.map((b, i) => `
          <figure class="testimonial-card" style="--stagger:${i};" data-reveal="slide-up">
            <blockquote><p>${escapeHtml(b)}</p></blockquote>
          </figure>`).join("");
    return `
    <section class="content-section ${bg} layout-proof" id="section-${index + 1}">
      <div class="section-orb orb-${(index % 3) + 1}"></div>
      <div class="container">
        <div class="section-copy centered" data-reveal="slide-up">
          ${safeEyebrow ? `<p class="eyebrow">${safeEyebrow}</p>` : ""}
          <h2>${safeTitle}</h2>
          <p class="section-body">${safeBody}</p>
        </div>
        <div class="testimonial-grid">${testimonialCards}</div>
      </div>
    </section>`;
  }

  // -- kind: steps -------------------------------------------------------------
  if (kind === "steps") {
    const steps = section.items.length > 0 ? section.items : section.bullets.map(b => ({ title: "", description: b, meta: "" }));
    const stepsHtml = steps.map((step, i) => `
      <div class="step-item" style="--stagger:${i};" data-reveal="slide-up">
        <div class="step-number">${String(i + 1).padStart(2, "0")}</div>
        <div class="step-content">
          ${step.title ? `<h3>${escapeHtml(step.title)}</h3>` : ""}
          <p>${escapeHtml(step.description)}</p>
          ${step.meta ? `<span class="step-meta">${escapeHtml(step.meta)}</span>` : ""}
        </div>
      </div>`).join("");
    return `
    <section class="content-section ${bg} layout-steps" id="section-${index + 1}">
      <div class="section-orb orb-${(index % 3) + 1}"></div>
      <div class="container">
        <div class="section-copy centered" data-reveal="slide-up">
          ${safeEyebrow ? `<p class="eyebrow">${safeEyebrow}</p>` : ""}
          <h2>${safeTitle}</h2>
          <p class="section-body">${safeBody}</p>
        </div>
        <div class="steps-grid">${stepsHtml}</div>
        ${imageHtml}
      </div>
    </section>`;
  }

  // -- kind: results / metrics -------------------------------------------------
  if (kind === "results") {
    const statsHtml = section.items.length > 0
      ? section.items.map((item, i) => `
          <div class="stat-chip" style="--stagger:${i};" data-reveal="slide-up">
            <strong>${escapeHtml(item.title)}</strong>
            <span>${escapeHtml(item.description)}</span>
            ${item.meta ? `<em>${escapeHtml(item.meta)}</em>` : ""}
          </div>`).join("")
      : section.bullets.map((b, i) => `<div class="stat-chip" style="--stagger:${i};" data-reveal="slide-up"><span>${escapeHtml(b)}</span></div>`).join("");
    return `
    <section class="content-section ${bg} layout-results" id="section-${index + 1}">
      <div class="section-orb orb-${(index % 3) + 1}"></div>
      <div class="container">
        <div class="section-copy centered" data-reveal="slide-up">
          ${safeEyebrow ? `<p class="eyebrow">${safeEyebrow}</p>` : ""}
          <h2>${safeTitle}</h2>
          <p class="section-body">${safeBody}</p>
        </div>
        <div class="stats-grid">${statsHtml}</div>
        ${imageHtml}
      </div>
    </section>`;
  }

  // -- kind: story / about -----------------------------------------------------
  if (kind === "story") {
    const bodyContentHtml = section.bullets.length > 0
      ? `<ul class="bullet-list" data-reveal="slide-up">${section.bullets.map((b, i) => `<li style="--stagger:${i};">${escapeHtml(b)}</li>`).join("")}</ul>`
      : "";
    const copyMarkup = `
      <div class="section-copy story-copy" data-reveal="slide-up">
        ${safeEyebrow ? `<p class="eyebrow">${safeEyebrow}</p>` : ""}
        <h2>${safeTitle}</h2>
        <p class="section-body">${safeBody}</p>
        ${bodyContentHtml}
      </div>`;
    const shellContent = imageHtml && isReversed ? `${imageHtml}${copyMarkup}` : `${copyMarkup}${imageHtml}`;
    return `
    <section class="content-section ${bg} layout-story" id="section-${index + 1}">
      <div class="section-orb orb-${(index % 3) + 1}"></div>
      <div class="container section-shell ${imageHtml ? "section-split" : ""}">
        ${shellContent}
      </div>
    </section>`;
  }

  // -- kind: cta ---------------------------------------------------------------
  if (kind === "cta") {
    const ctaItems = section.items.map((item, i) => `
      <div class="cta-feature" style="--stagger:${i};" data-reveal="slide-up">
        <strong>${escapeHtml(item.title)}</strong>
        <p>${escapeHtml(item.description)}</p>
      </div>`).join("");
    // Extract CTA href from items (first item with a meta that looks like a URL) or fall back to #final-cta
    const ctaHref = section.items.find(it => it.meta && (it.meta.startsWith('http') || it.meta.startsWith('#') || it.meta.startsWith('mailto') || it.meta.startsWith('tel')))?.meta || "#final-cta";
    // Use section title as the headline; derive a proper action label from items[0].title or a generic fallback
    const ctaLabel = escapeHtml(section.items[0]?.title || section.title || "Get Started");
    return `
    <section class="content-section layout-cta-band" id="section-${index + 1}">
      <div class="section-orb orb-2"></div>
      <div class="container">
        <div class="cta-band-inner" data-reveal="slide-up">
          ${safeEyebrow ? `<p class="eyebrow">${safeEyebrow}</p>` : ""}
          <h2>${safeTitle}</h2>
          <p class="section-body">${safeBody}</p>
          ${ctaItems ? `<div class="cta-features-grid">${ctaItems}</div>` : ""}
          <a class="btn btn-primary" href="${escapeHtml(ctaHref)}">${ctaLabel}</a>
        </div>
      </div>
    </section>`;
  }

  // -- kind: services ----------------------------------------------------------
  if (kind === "services") {
    const serviceCards = section.items.length > 0
      ? section.items.map((item, i) => `
          <article class="service-card" style="--stagger:${i};" data-reveal="slide-up">
            <h3>${escapeHtml(item.title)}</h3>
            <p>${escapeHtml(item.description)}</p>
            ${item.meta ? `<span class="service-meta">${escapeHtml(item.meta)}</span>` : ""}
          </article>`).join("")
      : section.bullets.map((b, i) => `
          <article class="service-card" style="--stagger:${i};" data-reveal="slide-up">
            <p>${escapeHtml(b)}</p>
          </article>`).join("");
    // When layout is explicitly split and an image exists, render side-by-side instead of stacked
    if (imageHtml && (layout === "layout-split" || layout === "layout-split-reverse")) {
      const copyMarkupSvc = `
        <div class="section-copy" data-reveal="slide-up">
          ${safeEyebrow ? `<p class="eyebrow">${safeEyebrow}</p>` : ""}
          <h2>${safeTitle}</h2>
          <p class="section-body">${safeBody}</p>
          <div class="services-grid services-grid-inline">${serviceCards}</div>
        </div>`;
      const shellSvc = isReversed ? `${imageHtml}${copyMarkupSvc}` : `${copyMarkupSvc}${imageHtml}`;
      return `
      <section class="content-section ${bg} layout-services ${layout}" id="section-${index + 1}">
        <div class="section-orb orb-${(index % 3) + 1}"></div>
        <div class="container section-shell section-split">
          ${shellSvc}
        </div>
      </section>`;
    }
    return `
    <section class="content-section ${bg} layout-services" id="section-${index + 1}">
      <div class="section-orb orb-${(index % 3) + 1}"></div>
      <div class="container">
        <div class="section-copy centered" data-reveal="slide-up">
          ${safeEyebrow ? `<p class="eyebrow">${safeEyebrow}</p>` : ""}
          <h2>${safeTitle}</h2>
          <p class="section-body">${safeBody}</p>
        </div>
        <div class="services-grid">${serviceCards}</div>
      </div>
    </section>`;
  }

  // -- kind: embed -------------------------------------------------------------
  if (kind === "embed") {
    // embedCode is kept as raw HTML (trusted user embed content).
    // Preserve <script src="..."> (external widget loaders like Calendly, Typeform, Hotmart).
    // Strip only inline scripts that have content, and block javascript: URLs.
    const safeEmbed = (section.embedCode || "")
      .replace(/<script\b(?![^>]*\bsrc\s*=)[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/javascript:/gi, "");
    return `
    <section class="content-section ${bg} layout-embed" id="section-${index + 1}">
      <div class="section-orb orb-${(index % 3) + 1}"></div>
      <div class="container">
        <div class="section-copy centered" data-reveal="slide-up">
          ${safeEyebrow ? `<p class="eyebrow">${safeEyebrow}</p>` : ""}
          ${safeTitle ? `<h2>${safeTitle}</h2>` : ""}
          ${safeBody ? `<p class="section-body">${safeBody}</p>` : ""}
        </div>
        <div class="embed-wrapper" data-reveal="slide-up">
          ${safeEmbed || `<p class="section-body" style="text-align:center;color:var(--muted);">[Embedded content will appear here]</p>`}
        </div>
      </div>
    </section>`;
  }

  // -- kind: form ---------------------------------------------------------------
  if (kind === "form") {
    const fields = section.formFields && section.formFields.length > 0 ? section.formFields : [];
    const formAction = section.formAction || "";
    const submitLabel = escapeHtml(section.formButton || "Send Message");

    const fieldsHtml = fields.map((f, fi) => {
      const id = `field-${index}-${fi}`;
      // Derive a meaningful name from the field label (e.g. "Full Name" ? "full_name")
      const fieldName = f.label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || id;
      const labelHtml = `<label class="form-label" for="${id}">${escapeHtml(f.label)}${f.required ? ' <span class="form-required">*</span>' : ""}</label>`;
      const attrs = `id="${id}" name="${escapeHtml(fieldName)}" class="form-control"${f.placeholder ? ` placeholder="${escapeHtml(f.placeholder)}"` : ""}${f.required ? " required" : ""}`;

      if (f.type === "textarea") {
        return `<div class="form-group" style="--stagger:${fi};" data-reveal="slide-up">${labelHtml}<textarea ${attrs} rows="4"></textarea></div>`;
      }
      if (f.type === "select" && f.options && f.options.length > 0) {
        const optHtml = f.options.map(o => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join("");
        return `<div class="form-group" style="--stagger:${fi};" data-reveal="slide-up">${labelHtml}<select ${attrs}><option value="">� select �</option>${optHtml}</select></div>`;
      }
      if (f.type === "checkbox") {
        return `<div class="form-group form-group-check" style="--stagger:${fi};" data-reveal="slide-up"><label class="form-check-label"><input type="checkbox" name="${escapeHtml(fieldName)}"${f.required ? " required" : ""}> ${escapeHtml(f.label)}${f.required ? ' <span class="form-required">*</span>' : ""}</label></div>`;
      }
      return `<div class="form-group" style="--stagger:${fi};" data-reveal="slide-up">${labelHtml}<input type="${escapeHtml(f.type || "text")}" ${attrs}></div>`;
    }).join("");

    return `
    <section class="content-section ${bg} layout-form" id="section-${index + 1}">
      <div class="section-orb orb-${(index % 3) + 1}"></div>
      <div class="container">
        <div class="section-copy centered" data-reveal="slide-up">
          ${safeEyebrow ? `<p class="eyebrow">${safeEyebrow}</p>` : ""}
          ${safeTitle ? `<h2>${safeTitle}</h2>` : ""}
          ${safeBody ? `<p class="section-body">${safeBody}</p>` : ""}
        </div>
        <form class="lead-form" action="${escapeHtml(formAction)}" method="post" novalidate data-reveal="slide-up">
          <div class="form-grid">
            ${fieldsHtml || `<div class="form-group"><label class="form-label" for="name-${index}">Name <span class="form-required">*</span></label><input type="text" id="name-${index}" class="form-control" placeholder="Your name" required></div>
            <div class="form-group"><label class="form-label" for="email-${index}">Email <span class="form-required">*</span></label><input type="email" id="email-${index}" class="form-control" placeholder="your@email.com" required></div>
            <div class="form-group"><label class="form-label" for="message-${index}">Message</label><textarea id="message-${index}" class="form-control" rows="4" placeholder="How can we help?"></textarea></div>`}
          </div>
          <div class="form-submit-row">
            <button type="submit" class="btn btn-primary">${submitLabel}</button>
          </div>
        </form>
      </div>
    </section>`;
  }

  // -- kind: benefits (default) -------------------------------------------------
  const isFeatured = layout === "layout-featured";
  const isWideCopy = layout === "layout-wide-copy";

  const itemsHtml = section.items.length > 0
    ? `<div class="feature-grid">${section.items.map((item, itemIndex) => `
        <article class="feature-card" style="--stagger:${itemIndex};" data-reveal="slide-up">
          <h3>${escapeHtml(item.title)}</h3>
          <p>${escapeHtml(item.description)}</p>
          ${item.meta ? `<span>${escapeHtml(item.meta)}</span>` : ""}
        </article>
      `).join("")}</div>`
    : "";

  const bulletsHtml = section.items.length === 0 && section.bullets.length > 0
    ? `<ul class="bullet-list" data-reveal="slide-up">${section.bullets.map((bullet, bulletIndex) => `<li style="--stagger:${bulletIndex};">${escapeHtml(bullet)}</li>`).join("")}</ul>`
    : "";

  if (isFeatured) {
    // layout-featured: large headline left, content right (image or cards)
    const rightContent = imageHtml || (itemsHtml || bulletsHtml ? `<div>${itemsHtml}${bulletsHtml}</div>` : "");
    return `
    <section class="content-section ${bg} layout-featured" id="section-${index + 1}">
      <div class="section-orb orb-${(index % 3) + 1}"></div>
      <div class="container">
        <div class="section-shell section-split">
          <div class="section-copy" data-reveal="slide-up">
            ${safeEyebrow ? `<p class="eyebrow">${safeEyebrow}</p>` : ""}
            <h2>${safeTitle}</h2>
            <p class="section-body">${safeBody}</p>
          </div>
          <div data-reveal="zoom">${rightContent}</div>
        </div>
      </div>
    </section>`;
  }

  // For card/wide-copy layouts, always stack vertically (copy on top, cards below)
  // Only use the 2-column split shell for explicit split layouts WITH an image
  const isCardLayout = /^(layout-cards|layout-copy-heavy|layout-wide-copy|layout-mosaic)$/.test(layout);
  const useSplitShell = imageHtml && !isCardLayout && (layout === "layout-split" || layout === "layout-split-reverse");

  if (isCardLayout) {
    // Stacked: copy on top, optional image below, then items/bullets at full width
    return `
    <section class="content-section ${bg} ${layout}" id="section-${index + 1}">
      <div class="section-orb orb-${(index % 3) + 1}"></div>
      <div class="container">
        <div class="section-copy${isWideCopy ? " wide" : ""} centered" data-reveal="slide-up">
          ${safeEyebrow ? `<p class="eyebrow">${safeEyebrow}</p>` : ""}
          <h2>${safeTitle}</h2>
          <p class="section-body">${safeBody}</p>
          ${bulletsHtml}
        </div>
        ${itemsHtml}
        ${imageHtml}
      </div>
    </section>`;
  }

  const copyMarkup = `
    <div class="section-copy" data-reveal="slide-up">
      ${safeEyebrow ? `<p class="eyebrow">${safeEyebrow}</p>` : ""}
      <h2>${safeTitle}</h2>
      <p class="section-body">${safeBody}</p>
      ${bulletsHtml}
      ${itemsHtml}
    </div>`;

  const shellContent = useSplitShell && isReversed
    ? `${imageHtml}${copyMarkup}`
    : `${copyMarkup}${useSplitShell ? imageHtml : ""}`;

  return `
    <section class="content-section ${bg} ${layout}" id="section-${index + 1}">
      <div class="section-orb orb-${(index % 3) + 1}"></div>
      <div class="container section-shell ${useSplitShell ? "section-split" : ""}">
        ${shellContent}
      </div>
    </section>
  `;
}

function renderLandingPlan(plan: LandingPlan, options?: {
  useCarousel?: boolean;
  carouselImages?: string[];
  socialLinks?: { facebook?: string; instagram?: string; twitter?: string; linkedin?: string; youtube?: string; };
  language?: string;
  floatingCta?: { href: string; type: 'whatsapp' | 'phone'; label?: string };
}): StructuredSitePayload {
  const enforcedPlan = enforceRequiredVisualAssets(plan);
  const preset = getStylePreset(plan.theme.style);
  const headingFont = getFontStack(enforcedPlan.theme.headingFont, preset.headingFallback);
  const bodyFont = getFontStack(enforcedPlan.theme.bodyFont, preset.bodyFallback);
  const navColors = resolveNavColors(enforcedPlan.theme);
  const useCarousel = options?.useCarousel ?? false;
  const socialLinks = options?.socialLinks ?? {};
  const floatingCta = options?.floatingCta ?? null;
  // pageLang is resolved in the frontend buildGeneratedDocument; the edge function only returns the body fragment

  // Deduplicate: strip hero image URL from section images to prevent the same photo appearing
  // in both the hero background and a content section.
  const heroImageUrl = enforcedPlan.hero.imageUrl;
  const dedupedSections = enforcedPlan.sections.map((s) =>
    s.imageUrl && s.imageUrl === heroImageUrl ? { ...s, imageUrl: "" } : s
  );
  // Build carousel images, deduplicating against each other; hero image is always slide 1 in carousel mode
  // so we do NOT filter it out here � in non-carousel mode the carousel HTML is never rendered anyway.
  const rawCarouselImages = options?.carouselImages ?? [];
  const carouselImages = Array.from(new Set(rawCarouselImages.filter(Boolean)));
  const socialIconsHtml = (() => {
    const entries = [
      { key: 'instagram', href: socialLinks.instagram, label: 'Instagram', svg: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg>' },
      { key: 'facebook', href: socialLinks.facebook, label: 'Facebook', svg: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>' },
      { key: 'linkedin', href: socialLinks.linkedin, label: 'LinkedIn', svg: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>' },
      { key: 'twitter', href: socialLinks.twitter, label: 'Twitter / X', svg: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.737-8.835L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>' },
      { key: 'youtube', href: socialLinks.youtube, label: 'YouTube', svg: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>' },
    ].filter(e => e.href && e.href.trim() !== '');
    if (!entries.length) return '';
    return `<div class="footer-social">${entries.map(e => `<a href="${escapeHtml(e.href!)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(e.label)}">${e.svg}</a>`).join('')}</div>`;
  })();
  const sectionMarkup = dedupedSections
    .map((section, index) => {
      // AI picks section.layout based on business content � fall back to preset pattern if not set
      const VALID_LAYOUTS = new Set(["layout-split","layout-split-reverse","layout-cards","layout-copy-heavy","layout-mosaic","layout-featured","layout-wide-copy"]);
      const layout = (section.layout && VALID_LAYOUTS.has(section.layout))
        ? section.layout
        : preset.sectionPattern[index % preset.sectionPattern.length];
      return renderSection(section, index, layout);
    })
    .join("\n");
  const proofMarkup = enforcedPlan.socialProofBar.length > 0
    ? `<section class="proof-strip ${preset.proofClass}" data-reveal="fade"><div class="container proof-strip-inner">${enforcedPlan.socialProofBar.map((item, index) => `<span style="--stagger:${index};">${escapeHtml(item)}</span>`).join("")}</div></section>`
    : "";
  const faqMarkup = enforcedPlan.faq.length > 0
    ? `<section class="content-section section-light layout-copy-heavy" id="faq"><div class="section-orb orb-2"></div><div class="container"><div class="section-copy centered" data-reveal="slide-up"><p class="eyebrow">${escapeHtml(enforcedPlan.faqSection.eyebrow)}</p><h2>${escapeHtml(enforcedPlan.faqSection.title)}</h2><p class="section-body">${escapeHtml(enforcedPlan.faqSection.subtitle)}</p></div><div class="faq-list">${enforcedPlan.faq.map((item, index) => `
      <article class="faq-item">
        <button class="faq-trigger" type="button" aria-expanded="false" aria-controls="faq-panel-${index}">
          <span>${escapeHtml(item.question)}</span>
          <span class="faq-icon">+</span>
        </button>
        <div class="faq-panel" id="faq-panel-${index}">
          <p>${escapeHtml(item.answer)}</p>
        </div>
      </article>
    `).join("")}</div></div></section>`
    : "";

  // AI-driven heroLayout takes precedence over preset-based inference
  const aiHeroLayout = (enforcedPlan.hero as any).heroLayout || "";
  const heroCentered = aiHeroLayout === "centered"
    || (!aiHeroLayout && ["editorial", "premium", "minimal"].includes(plan.theme.style));
  const heroHtml = heroCentered
    ? `
      <div class="hero-copy hero-copy-centered" data-reveal="slide-up">
        <p class="eyebrow">${escapeHtml(enforcedPlan.hero.eyebrow)}</p>
        <h1>${escapeHtml(enforcedPlan.hero.title)}</h1>
        <p class="hero-subtitle">${escapeHtml(enforcedPlan.hero.subtitle)}</p>
        <div class="hero-actions hero-actions-centered">
          <a class="btn btn-primary" href="${escapeHtml(enforcedPlan.hero.primaryCtaHref)}">${escapeHtml(enforcedPlan.hero.primaryCtaLabel)}</a>
          <a class="btn btn-secondary" href="${escapeHtml(enforcedPlan.hero.secondaryCtaHref)}">${escapeHtml(enforcedPlan.hero.secondaryCtaLabel)}</a>
        </div>
      </div>`
    : `
      <div class="hero-copy" data-reveal="slide-up">
        <p class="eyebrow">${escapeHtml(enforcedPlan.hero.eyebrow)}</p>
        <h1>${escapeHtml(enforcedPlan.hero.title)}</h1>
        <p class="hero-subtitle">${escapeHtml(enforcedPlan.hero.subtitle)}</p>
        <div class="hero-actions">
          <a class="btn btn-primary" href="${escapeHtml(enforcedPlan.hero.primaryCtaHref)}">${escapeHtml(enforcedPlan.hero.primaryCtaLabel)}</a>
          <a class="btn btn-secondary" href="${escapeHtml(enforcedPlan.hero.secondaryCtaHref)}">${escapeHtml(enforcedPlan.hero.secondaryCtaLabel)}</a>
        </div>
      </div>`;

  // Build carousel slides from provided images (fallback to heroImageUrl if none)
  const allCarouselImages = carouselImages.length > 0
    ? carouselImages
    : [enforcedPlan.hero.imageUrl].filter(Boolean);

  const carouselSlidesHtml = allCarouselImages.map((imgUrl, i) => `
    <div class="carousel-slide${i === 0 ? " is-active" : ""}" data-index="${i}" style="background-image: url('${safeUrl(imgUrl)}');">
      <div class="carousel-overlay"></div>
      <div class="container carousel-content${heroCentered ? " carousel-content-centered" : ""}">
        ${heroHtml}
      </div>
    </div>`).join("");

  const carouselDotsHtml = allCarouselImages.length > 1
    ? `<div class="carousel-dots">${allCarouselImages.map((_, i) => `<button class="carousel-dot${i === 0 ? " is-active" : ""}" data-target="${i}" aria-label="Slide ${i + 1}"></button>`).join("")}</div>`
    : "";

  const carouselHtml = `
    <section class="hero-carousel" id="top">
      <div class="carousel-track">${carouselSlidesHtml}</div>
      ${allCarouselImages.length > 1 ? `
      <button class="carousel-btn carousel-prev" aria-label="Previous slide">&#8592;</button>
      <button class="carousel-btn carousel-next" aria-label="Next slide">&#8594;</button>
      ${carouselDotsHtml}
      ` : ""}
    </section>`;

  // Bold and energetic themes OR AI choosing "split" get split-hero layout
  // "minimal" heroLayout ? no image, solid bg hero
  const heroIsSplit = aiHeroLayout === "split"
    || (!aiHeroLayout && ["bold", "energetic"].includes(plan.theme.style) && heroImageUrl);
  const heroIsMinimal = aiHeroLayout === "minimal";
  const standardHeroHtml = heroIsMinimal
    ? `
    <section class="hero-section hero-section-minimal ${preset.heroClass}">
      <div class="container hero-grid">
        ${heroHtml}
      </div>
    </section>`
    : heroIsSplit
    ? `
    <section class="hero-section hero-section-split ${preset.heroClass}">
      <div class="hero-split-overlay"></div>
      <div class="container hero-split-grid">
        <div class="hero-copy hero-split-copy" data-reveal="slide-up">
          <p class="eyebrow">${escapeHtml(enforcedPlan.hero.eyebrow)}</p>
          <h1>${escapeHtml(enforcedPlan.hero.title)}</h1>
          <p class="hero-subtitle">${escapeHtml(enforcedPlan.hero.subtitle)}</p>
          <div class="hero-actions">
            <a class="btn btn-primary" href="${escapeHtml(enforcedPlan.hero.primaryCtaHref)}">${escapeHtml(enforcedPlan.hero.primaryCtaLabel)}</a>
            <a class="btn btn-secondary hero-btn-secondary" href="${escapeHtml(enforcedPlan.hero.secondaryCtaHref)}">${escapeHtml(enforcedPlan.hero.secondaryCtaLabel)}</a>
          </div>
        </div>
        <div class="hero-split-image" data-reveal="zoom">
          <img src="${safeUrl(heroImageUrl)}" alt="${escapeHtml(enforcedPlan.hero.title)}" loading="eager">
        </div>
      </div>
    </section>`
    : `
    <section class="hero-section ${preset.heroClass}" style="--hero-image: url('${safeUrl(heroImageUrl)}');">
      <div class="hero-backdrop"></div>
      <div class="hero-noise"></div>
      <div class="container hero-grid ${heroCentered ? "hero-grid-centered" : ""}">
        ${heroHtml}
      </div>
    </section>`;
  const cardStyleClass = `card-style-${["elevated","glass","flat","outlined"].includes(enforcedPlan.theme.cardStyle || "") ? enforcedPlan.theme.cardStyle : "elevated"}`;

  const floatingCtaHtml = floatingCta
    ? `<a class="floating-cta-btn" href="${escapeHtml(floatingCta.href)}" target="${floatingCta.type === 'whatsapp' ? '_blank' : '_self'}" rel="${floatingCta.type === 'whatsapp' ? 'noopener noreferrer' : ''}" aria-label="${escapeHtml(floatingCta.label || 'Contact us')}">${floatingCta.type === 'whatsapp' ? '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>' : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81a19.79 19.79 0 01-3.07-8.63A2 2 0 012 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.91 7.91a16 16 0 006.16 6.16l.89-.89a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>'}</a>`
    : "";

  const brandDisplayName = escapeHtml(businessName || enforcedPlan.slug || "Brand");
  const brandMarkup = enforcedPlan.logoUrl
    ? `<img class="brand-logo" src="${safeUrl(enforcedPlan.logoUrl)}" alt="${escapeHtml(enforcedPlan.slug)} logo" loading="eager">`
    : `<span class="brand-text" aria-label="${brandDisplayName}">${brandDisplayName}</span>`;

  const html = `
    <div class="page-shell ${preset.bodyClass} ${cardStyleClass}">
    <header class="site-header" data-reveal="fade">
      <div class="container nav-shell">
        <a class="brand-mark" href="#top" aria-label="${escapeHtml(enforcedPlan.slug)} home">
          ${brandMarkup}
        </a>
        <nav class="top-nav">
          <a href="#sections">${dedupedSections.length > 0 ? escapeHtml(dedupedSections[0].title.split(" ").slice(0, 2).join(" ")) : "Sections"}</a>
          <a href="#faq">FAQ</a>
          <a href="#final-cta" class="nav-cta">${escapeHtml(enforcedPlan.hero.primaryCtaLabel)}</a>
        </nav>
        <button class="nav-mobile-toggle" id="nav-toggle" aria-label="Toggle navigation" aria-expanded="false">
          <span></span><span></span><span></span>
        </button>
      </div>
    </header>
    <nav class="mobile-nav-overlay" id="mobile-nav" aria-hidden="true">
      <a href="#sections">${dedupedSections.length > 0 ? escapeHtml(dedupedSections[0].eyebrow || dedupedSections[0].title.split(" ").slice(0, 3).join(" ")) : "Sections"}</a>
      <a href="#faq">FAQ</a>
      <a href="#final-cta" class="btn btn-primary mobile-nav-cta">${escapeHtml(enforcedPlan.hero.primaryCtaLabel)}</a>
    </nav>
    <main id="top">
      ${useCarousel ? carouselHtml : standardHeroHtml}
      ${proofMarkup}
      <div id="sections">${sectionMarkup}</div>
      ${faqMarkup}
      <section class="final-cta-section" id="final-cta">
        <div class="container final-cta-card" data-reveal="slide-up">
          <p class="eyebrow">${escapeHtml(enforcedPlan.finalCta.eyebrow)}</p>
          <h2>${escapeHtml(enforcedPlan.finalCta.title)}</h2>
          <p>${escapeHtml(enforcedPlan.finalCta.body)}</p>
          <a class="btn btn-primary" href="${escapeHtml(enforcedPlan.finalCta.primaryCtaHref)}">${escapeHtml(enforcedPlan.finalCta.primaryCtaLabel)}</a>
        </div>
      </section>
    </main>
    <footer class="site-footer">
      <div class="container footer-shell">
        <a class="footer-brand" href="#top" aria-label="${brandDisplayName} home">${brandMarkup}</a>
        <p>${escapeHtml(enforcedPlan.footer.tagline)}</p>
        ${socialIconsHtml}
      </div>
    </footer>
    ${floatingCtaHtml}
    </div>
  `.trim();

  const css = `
    :root {
      --primary: ${enforcedPlan.theme.primary};
      --secondary: ${enforcedPlan.theme.secondary};
      --accent: ${enforcedPlan.theme.accent};
      --bg: ${enforcedPlan.theme.background};
      --surface: ${enforcedPlan.theme.surface};
      --text: ${enforcedPlan.theme.text};
      --muted: ${enforcedPlan.theme.mutedText};
      --heading-font: ${headingFont};
      --body-font: ${bodyFont};
      --shadow: 0 20px 60px rgba(15, 23, 42, 0.14);
      --shadow-strong: 0 26px 80px rgba(15, 23, 42, 0.24);
      --border: rgba(148, 163, 184, 0.18);
      --radius-xl: 28px;
      --radius-lg: 22px;
      --radius-md: 16px;
      --container: min(1180px, calc(100vw - 40px));
      --hero-overlay: ${preset.heroGlow};
      --surface-glow: ${preset.surfaceGlow};
      --nav-bg: ${navColors.navBg};
      --nav-bg-scrolled: ${navColors.navBgScrolled};
      --nav-text: ${navColors.navText};
      --nav-border: ${navColors.navBorder};
      --section-padding: ${enforcedPlan.theme.spacingDensity === "compact" ? "64px 0" : enforcedPlan.theme.spacingDensity === "spacious" ? "120px 0" : "88px 0"};
    }
    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body { margin: 0; font-family: var(--body-font); background: linear-gradient(180deg, rgba(255,255,255,0.08), transparent 12%), var(--bg); color: var(--text); line-height: 1.65; }
    img { max-width: 100%; display: block; }
    a { color: inherit; text-decoration: none; }
    .container { width: var(--container); margin: 0 auto; }
    .page-shell { position: relative; overflow: clip; }
    .eyebrow { margin: 0 0 14px; text-transform: uppercase; letter-spacing: 0.18em; font-size: 0.78rem; font-weight: 700; color: var(--accent); }
    .site-header { position: sticky; top: 0; z-index: 20; backdrop-filter: blur(18px); background: var(--nav-bg); border-bottom: 1px solid transparent; transition: background .3s ease, border-color .3s ease, box-shadow .3s ease; color: var(--nav-text); }
    .site-header.is-scrolled { background: var(--nav-bg-scrolled); border-color: var(--nav-border); box-shadow: 0 14px 30px rgba(15, 23, 42, 0.08); }
    .nav-shell { display: flex; align-items: center; justify-content: space-between; padding: 16px 0; gap: 20px; }
    .brand-mark { display: inline-flex; align-items: center; gap: 10px; font-family: var(--heading-font); font-weight: 800; letter-spacing: 0.04em; color: var(--nav-text); min-width: 0; }
    .brand-logo { width: auto; height: 40px; max-width: 180px; object-fit: contain; filter: drop-shadow(0 3px 10px rgba(15, 23, 42, 0.18)); }
    .brand-text { display: inline-block; max-width: min(40vw, 240px); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--heading-font); font-size: clamp(1.1rem, 1rem + 0.5vw, 1.5rem); font-weight: 900; letter-spacing: 0.02em; color: var(--primary); line-height: 1; }
    .top-nav { display: flex; align-items: center; gap: 18px; color: var(--nav-text); opacity: 0.84; }
    .top-nav a { position: relative; }
    .top-nav a::after { content: ""; position: absolute; left: 0; bottom: -6px; width: 100%; height: 2px; background: var(--nav-text); transform: scaleX(0); transform-origin: left; transition: transform .22s ease; }
    .top-nav a:hover::after { transform: scaleX(1); }
    .nav-cta { padding: 10px 16px; border-radius: 999px; background: linear-gradient(135deg, color-mix(in srgb, var(--primary) 18%, transparent), color-mix(in srgb, var(--accent) 14%, transparent)); color: var(--nav-text); font-weight: 700; opacity: 1; }
    .hero-section { position: relative; overflow: hidden; padding: 88px 0 64px; background-image: radial-gradient(circle at top left, rgba(37, 99, 235, 0.14), transparent 30%), linear-gradient(180deg, rgba(15,23,42,0.36), rgba(15,23,42,0.7)), var(--hero-image), var(--hero-overlay); background-size: cover, cover, cover, cover; background-position: center center, center center, center center, center center; color: #fff; }
    .hero-backdrop { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(15,23,42,0.24), rgba(15,23,42,0.68)); pointer-events: none; }
    .hero-noise { position: absolute; inset: 0; opacity: 0.32; background-image: radial-gradient(circle at 20% 20%, rgba(255,255,255,0.12) 0, transparent 22%), radial-gradient(circle at 80% 30%, rgba(255,255,255,0.08) 0, transparent 18%), radial-gradient(circle at 60% 80%, rgba(245, 158, 11, 0.12) 0, transparent 24%); pointer-events: none; }
    .hero-grid { position: relative; z-index: 1; display: grid; grid-template-columns: 1fr; gap: 18px; align-items: center; }
    .hero-copy h1 { margin: 0 0 18px; font-family: var(--heading-font); font-size: clamp(2rem, 4.5vw, 3.8rem); line-height: 1.04; letter-spacing: -0.03em; max-width: 16ch; }
    .hero-subtitle { max-width: 58ch; color: rgba(255,255,255,0.82); font-size: 1.08rem; line-height: 1.65; margin: 0; }
    .theme-minimal .hero-subtitle { color: var(--muted); }
    .theme-minimal .hero-copy h1 { color: var(--text); -webkit-text-fill-color: var(--text); }
    .hero-actions { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 28px; align-items: center; }
    .btn { display: inline-flex; align-items: center; justify-content: center; min-height: 48px; padding: 0 20px; border-radius: 999px; font-weight: 700; transition: transform .2s ease, box-shadow .2s ease, background .2s ease; }
    .btn:hover { transform: translateY(-1px); }
    .btn-primary { background: linear-gradient(135deg, var(--primary), color-mix(in srgb, var(--accent) 32%, var(--primary) 68%)); color: #fff; box-shadow: 0 16px 36px rgba(37, 99, 235, 0.28); }
    .btn-secondary { background: rgba(255,255,255,0.12); color: #fff; border: 1px solid rgba(255,255,255,0.18); }
    .hero-media { display: none; }
    .proof-strip { position: relative; background: rgba(255,255,255,0.88); border-bottom: 1px solid var(--border); overflow: hidden; }
    .proof-strip-inner { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 18px; padding: 18px 0; font-size: 0.92rem; color: var(--muted); }
    .proof-strip-inner span { padding: 12px 14px; border-radius: 999px; background: rgba(148,163,184,0.08); text-align: center; border: 1px solid rgba(148, 163, 184, 0.12); }
    .content-section { position: relative; padding: var(--section-padding, 88px 0); }
    .section-light { background: var(--bg); }
    .section-dark { background: linear-gradient(160deg, color-mix(in srgb, var(--primary) 9%, var(--bg)), color-mix(in srgb, var(--accent) 6%, var(--bg)) 60%, color-mix(in srgb, var(--secondary) 8%, var(--bg))); }
    .section-orb { position: absolute; width: 340px; height: 340px; border-radius: 999px; filter: blur(72px); opacity: 0.38; pointer-events: none; }
    .orb-1 { top: 5%; left: -100px; background: radial-gradient(circle, color-mix(in srgb, var(--primary) 60%, transparent), transparent 70%); }
    .orb-2 { top: 15%; right: -120px; background: radial-gradient(circle, color-mix(in srgb, var(--accent) 55%, transparent), transparent 70%); }
    .orb-3 { bottom: 8%; left: 8%; background: radial-gradient(circle, color-mix(in srgb, var(--secondary) 45%, transparent), transparent 70%); }
    .section-shell { display: grid; gap: 52px; }
    .section-split { display: grid; align-items: center; gap: 60px; }
    .layout-copy-heavy .section-copy { max-width: 760px; }
    .layout-cards .feature-grid { grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
    .layout-mosaic .section-shell { gap: 28px; }
    .layout-wide-copy .section-copy { max-width: 900px; margin-left: 0; }
    .layout-wide-copy .section-copy h2 { font-size: clamp(1.7rem, 2.5vw, 2.6rem); max-width: 100%; }
    .layout-featured .section-shell { display: grid; grid-template-columns: 1fr 1fr; gap: 60px; align-items: center; }
    /* Only apply 2-column grid for explicit split layouts; card/wide-copy layouts stack vertically */
    .layout-split .section-split, .layout-split-reverse .section-split, .layout-story .section-split { grid-template-columns: minmax(0, 1.1fr) minmax(300px, 0.9fr); }
    .layout-split-reverse .section-split { grid-template-columns: minmax(300px, 0.9fr) minmax(0, 1.1fr); }
    /* Inline services grid when used within a split layout */
    .services-grid-inline { grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); margin-top: 20px; }
    .section-copy.centered { max-width: 760px; margin: 0 auto 36px; text-align: center; }
    .section-copy.centered .section-body { margin: 0 auto; text-align: center; }
    .section-copy.centered .eyebrow { text-align: center; }
    .section-copy h2 { margin: 0 0 16px; font-family: var(--heading-font); font-size: clamp(1.7rem, 2.5vw, 2.6rem); line-height: 1.1; letter-spacing: -0.025em; }
    .section-body { margin: 0; color: var(--muted); max-width: 64ch; line-height: 1.7; }
    .section-media img { border-radius: var(--radius-xl); box-shadow: var(--shadow); min-height: 320px; object-fit: cover; }
    .section-stats { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 24px; }
    .stat-chip { padding: 14px 16px; border-radius: var(--radius-md); background: linear-gradient(135deg, rgba(255,255,255,0.84), rgba(255,255,255,0.56)); border: 1px solid var(--border); min-width: 170px; box-shadow: 0 14px 28px rgba(15,23,42,0.06); }
    .stat-chip strong { display: block; font-family: var(--heading-font); margin-bottom: 6px; }
    .stat-chip span { color: var(--muted); font-size: 0.92rem; }
    .bullet-list { list-style: none; padding: 0; margin: 24px 0 0; display: grid; gap: 12px; }
    .bullet-list li { display: flex; gap: 12px; align-items: start; padding: 14px 16px; border-radius: var(--radius-md); background: rgba(255,255,255,0.66); border: 1px solid var(--border); }
    .bullet-list li::before { content: ""; width: 10px; height: 10px; margin-top: 8px; border-radius: 999px; background: linear-gradient(135deg, var(--primary), var(--accent)); flex: 0 0 auto; }
    .feature-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 18px; margin-top: 26px; }
    .feature-card { position: relative; padding: 24px; border-radius: var(--radius-lg); background: linear-gradient(180deg, rgba(255,255,255,0.96), rgba(255,255,255,0.82)); border: 1px solid var(--border); box-shadow: 0 16px 40px rgba(15,23,42,0.06); overflow: hidden; }
    .feature-card::before { content: ""; position: absolute; inset: 0 0 auto; height: 4px; background: linear-gradient(90deg, var(--primary), var(--accent)); opacity: 0.88; }
    .feature-card h3 { margin: 0 0 10px; font-family: var(--heading-font); font-size: 1.12rem; }
    .feature-card p { margin: 0; color: var(--muted); }
    .feature-card span { display: inline-block; margin-top: 12px; color: var(--primary); font-size: 0.9rem; font-weight: 600; }
    .faq-list { display: grid; gap: 14px; }
    .faq-item { border: 1px solid var(--border); background: linear-gradient(180deg, rgba(255,255,255,0.94), rgba(255,255,255,0.84)); border-radius: var(--radius-lg); overflow: hidden; box-shadow: 0 14px 28px rgba(15,23,42,0.05); }
    .faq-trigger { width: 100%; border: 0; background: transparent; color: var(--text); display: flex; justify-content: space-between; align-items: center; padding: 20px 22px; font: inherit; text-align: left; cursor: pointer; }
    .faq-panel { display: none; padding: 0 22px 20px; color: var(--muted); }
    .faq-item.open .faq-panel { display: block; }
    .faq-item.open .faq-icon { transform: rotate(45deg); }
    .faq-icon { transition: transform .2s ease; font-size: 1.2rem; }
    .final-cta-section { padding: 88px 0 110px; background: linear-gradient(180deg, rgba(37,99,235,0.08), rgba(245,158,11,0.08)); }
    .final-cta-card { position: relative; overflow: hidden; background: linear-gradient(135deg, rgba(15,23,42,0.98), rgba(30,41,59,0.92)); color: #fff; border-radius: calc(var(--radius-xl) + 4px); padding: 48px; text-align: center; box-shadow: var(--shadow-strong); }
    .final-cta-card::before { content: ""; position: absolute; inset: auto -10% -40% auto; width: 280px; height: 280px; background: radial-gradient(circle, rgba(245,158,11,0.24), transparent 60%); }
    .final-cta-card h2 { margin: 0 0 16px; font-family: var(--heading-font); font-size: clamp(1.8rem, 3vw, 2.8rem); line-height: 1.06; }
    .final-cta-card p { margin: 0 auto 26px; max-width: 60ch; color: rgba(255,255,255,0.78); }
    .site-footer { padding: 28px 0 44px; background: #0f172a; color: rgba(255,255,255,0.68); }
    .footer-shell { text-align: center; }
    .footer-brand { display: inline-flex; align-items: center; justify-content: center; margin-bottom: 14px; text-decoration: none; }
    .site-footer .brand-text { color: var(--primary); max-width: min(80vw, 360px); }
    [data-reveal] { opacity: 0; transform: translateY(26px); transition: opacity .8s ease, transform .8s cubic-bezier(.22,1,.36,1); transition-delay: calc(var(--stagger, 0) * 70ms); }
    [data-reveal="zoom"] { transform: translateY(18px) scale(.96); }
    [data-reveal="fade"] { transform: none; }
    [data-reveal].is-visible { opacity: 1; transform: none; }
    /* -- hero centered layout -- */
    .hero-grid-centered { justify-items: center; text-align: center; }
    /* -- split hero (bold/energetic presets) -- */
    .hero-section-split { position: relative; overflow: hidden; min-height: 560px; background: linear-gradient(135deg, var(--secondary) 0%, color-mix(in srgb, var(--primary) 22%, var(--secondary)) 100%); color: #fff; }
    .hero-split-overlay { position: absolute; inset: 0; background: linear-gradient(120deg, rgba(0,0,0,0.45) 40%, rgba(0,0,0,0.08) 100%); pointer-events: none; }
    .hero-split-grid { position: relative; z-index: 1; display: grid; grid-template-columns: 1fr 1fr; gap: 40px; align-items: center; min-height: 560px; padding: 80px 0; }
    .hero-split-copy { max-width: 560px; }
    .hero-split-image { border-radius: var(--radius-xl); overflow: hidden; box-shadow: 0 32px 80px rgba(0,0,0,0.38); aspect-ratio: 4/3; }
    .hero-split-image img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .hero-btn-secondary { background: rgba(255,255,255,0.14); border: 2px solid rgba(255,255,255,0.28); color: #fff; }
    @media (max-width: 860px) {
      .hero-split-grid { grid-template-columns: 1fr; }
      .hero-split-image { display: none; }
    }
    .hero-copy-centered { max-width: 820px; }
    .hero-copy-centered h1 { max-width: 100%; }
    .hero-actions-centered { justify-content: center; }
    /* -- gradient headings -- */
    .theme-bold .section-copy h2, .theme-energetic .section-copy h2, .theme-bold .hero-copy h1, .theme-energetic .hero-copy h1 { color: var(--text); }
    .theme-modern .section-copy h2, .theme-editorial .section-copy h2 { color: var(--text); }
    .theme-premium .final-cta-card h2, .theme-premium .hero-copy h1 { color: #fff; }
    @supports (-webkit-background-clip: text) or (background-clip: text) {
      .theme-bold .section-copy h2, .theme-energetic .section-copy h2, .theme-bold .hero-copy h1, .theme-energetic .hero-copy h1 { background: linear-gradient(135deg, var(--primary), var(--accent)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
      .theme-modern .section-copy h2, .theme-editorial .section-copy h2 { background: linear-gradient(120deg, var(--primary) 30%, color-mix(in srgb, var(--primary) 60%, var(--accent))); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
      .theme-premium .final-cta-card h2, .theme-premium .hero-copy h1 { background: linear-gradient(135deg, #fff, color-mix(in srgb, var(--accent) 80%, #fff)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
    }
    /* -- gradient buttons -- */
    .btn-primary { background: linear-gradient(135deg, var(--primary), color-mix(in srgb, var(--accent) 38%, var(--primary) 62%)); color: #fff; box-shadow: 0 16px 36px color-mix(in srgb, var(--primary) 32%, transparent); }
    .btn-primary:hover { background: linear-gradient(135deg, color-mix(in srgb, var(--primary) 86%, #000), var(--accent)); transform: translateY(-2px); box-shadow: 0 22px 44px color-mix(in srgb, var(--primary) 38%, transparent); }
    /* -- hero carousel -- */
    .hero-carousel { position: relative; width: 100%; height: 100vh; min-height: 500px; max-height: 900px; overflow: hidden; }
    .carousel-track { position: relative; width: 100%; height: 100%; }
    .carousel-slide { position: absolute; inset: 0; background-size: cover; background-position: center; background-repeat: no-repeat; opacity: 0; transition: opacity 0.8s ease; }
    .carousel-slide.is-active { opacity: 1; }
    .carousel-overlay { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(15,23,42,0.22), rgba(15,23,42,0.68)); }
    .carousel-content { position: relative; z-index: 2; display: flex; flex-direction: column; justify-content: center; align-items: flex-start; height: 100%; padding: 80px 0 60px; color: #fff; }
    .carousel-content-centered { align-items: center; text-align: center; }
    .carousel-content-centered .hero-actions { justify-content: center; }
    .carousel-btn { position: absolute; top: 50%; transform: translateY(-50%); z-index: 10; background: rgba(255,255,255,0.14); border: 1px solid rgba(255,255,255,0.22); color: #fff; width: 48px; height: 48px; border-radius: 999px; font-size: 1.2rem; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: background .2s ease; }
    .carousel-btn:hover { background: rgba(255,255,255,0.26); }
    .carousel-prev { left: 20px; }
    .carousel-next { right: 20px; }
    .carousel-dots { position: absolute; bottom: 24px; left: 50%; transform: translateX(-50%); z-index: 10; display: flex; gap: 8px; }
    .carousel-dot { width: 10px; height: 10px; border-radius: 999px; background: rgba(255,255,255,0.38); border: none; cursor: pointer; transition: background .2s, width .2s; padding: 0; }
    .carousel-dot.is-active { background: #fff; width: 24px; }
    /* -- testimonials -- */
    .testimonial-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 20px; margin-top: 32px; }
    .testimonial-card { margin: 0; padding: 28px; border-radius: var(--radius-lg); background: linear-gradient(180deg, rgba(255,255,255,0.96), rgba(255,255,255,0.82)); border: 1px solid var(--border); box-shadow: 0 16px 40px rgba(15,23,42,0.06); }
    .testimonial-card blockquote { margin: 0 0 16px; font-size: 1.02rem; line-height: 1.6; color: var(--text); }
    .testimonial-card blockquote::before { content: "\u201C"; font-size: 2.4rem; line-height: 0; vertical-align: -0.6rem; color: var(--accent); margin-right: 4px; }
    .testimonial-meta { display: flex; align-items: center; gap: 12px; margin-top: 16px; }
    .testimonial-avatar { width: 48px; height: 48px; border-radius: 999px; object-fit: cover; flex-shrink: 0; border: 2px solid var(--border); }
    .testimonial-meta-text { display: flex; flex-direction: column; gap: 3px; }
    .testimonial-meta strong { font-size: 0.94rem; color: var(--text); }
    .testimonial-meta span { font-size: 0.82rem; color: var(--muted); }
    /* -- steps -- */
    .steps-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 24px; margin-top: 36px; position: relative; }
    .steps-grid::before { content: ""; position: absolute; top: 32px; left: 0; right: 0; height: 2px; background: linear-gradient(90deg, var(--primary), var(--accent)); opacity: 0.22; pointer-events: none; }
    .step-item { display: flex; flex-direction: column; gap: 14px; padding: 24px; border-radius: var(--radius-lg); background: rgba(255,255,255,0.72); border: 1px solid var(--border); }
    .step-number { width: 52px; height: 52px; border-radius: 999px; display: flex; align-items: center; justify-content: center; font-family: var(--heading-font); font-size: 1.1rem; font-weight: 800; background: linear-gradient(135deg, var(--primary), var(--accent)); color: #fff; flex-shrink: 0; }
    .step-content h3 { margin: 0 0 8px; font-family: var(--heading-font); font-size: 1.08rem; }
    .step-content p { margin: 0; color: var(--muted); }
    .step-meta { display: inline-block; margin-top: 10px; font-size: 0.84rem; color: var(--primary); font-weight: 600; }
    /* -- results/stats -- */
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 16px; margin-top: 32px; }
    /* -- story -- */
    .story-copy { max-width: 600px; }
    /* -- cta band -- */
    .layout-cta-band { background: linear-gradient(135deg, color-mix(in srgb, var(--primary) 14%, transparent), color-mix(in srgb, var(--accent) 10%, transparent)); }
    .cta-band-inner { text-align: center; max-width: 720px; margin: 0 auto; }
    .cta-band-inner h2 { font-family: var(--heading-font); font-size: clamp(1.6rem, 2.5vw, 2.6rem); margin: 0 0 16px; }
    .cta-features-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-top: 28px; text-align: left; }
    .cta-feature { padding: 18px; border-radius: var(--radius-md); background: rgba(255,255,255,0.72); border: 1px solid var(--border); }
    .cta-feature strong { display: block; margin-bottom: 6px; font-size: 0.96rem; }
    .cta-feature p { margin: 0; font-size: 0.88rem; color: var(--muted); }
    /* -- services -- */
    .services-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 20px; margin-top: 28px; }
    .service-card { padding: 28px; border-radius: var(--radius-lg); background: linear-gradient(180deg, rgba(255,255,255,0.96), rgba(255,255,255,0.82)); border: 1px solid var(--border); box-shadow: 0 16px 40px rgba(15,23,42,0.06); transition: transform .2s ease, box-shadow .2s ease; }
    .service-card:hover { transform: translateY(-3px); box-shadow: var(--shadow); }
    .service-card h3 { margin: 0 0 10px; font-family: var(--heading-font); font-size: 1.12rem; }
    .service-card p { margin: 0; color: var(--muted); }
    .service-meta { display: inline-block; margin-top: 12px; padding: 4px 12px; border-radius: 999px; background: linear-gradient(135deg, color-mix(in srgb, var(--primary) 12%, transparent), color-mix(in srgb, var(--accent) 10%, transparent)); color: var(--primary); font-size: 0.82rem; font-weight: 700; }
    /* -- per-style theme overrides -- */
    /* editorial */
    .theme-editorial { --radius-xl: 4px; --radius-lg: 4px; --radius-md: 4px; }
    .theme-editorial .hero-copy h1 { max-width: 10ch; letter-spacing: -0.055em; }
    .theme-editorial .section-copy h2 { letter-spacing: -0.05em; max-width: 14ch; }
    .theme-editorial .feature-card, .theme-editorial .testimonial-card, .theme-editorial .service-card { border-radius: 4px; }
    .theme-editorial .feature-card::before { display: none; }
    .theme-editorial .section-copy h2, .theme-editorial .hero-copy h1 { font-style: italic; }
    /* bold */
    .theme-bold { --radius-xl: 32px; --radius-lg: 24px; }
    .theme-bold .hero-copy h1 { text-transform: uppercase; letter-spacing: -0.02em; font-size: clamp(2.2rem, 5vw, 4.2rem); }
    .theme-bold .section-copy h2 { text-transform: uppercase; font-size: clamp(1.6rem, 2.8vw, 2.6rem); }
    .theme-bold .feature-card { border-left: 4px solid var(--accent); border-top: none; }
    .theme-bold .feature-card::before { display: none; }
    .theme-bold .eyebrow { color: var(--accent); font-size: 0.85rem; letter-spacing: 0.26em; }
    .theme-bold .btn-primary { border-radius: 4px; letter-spacing: 0.06em; text-transform: uppercase; font-size: 0.9rem; }
    /* bold: dark alternating sections */
    .theme-bold .content-section.section-dark { background: linear-gradient(160deg, var(--secondary), color-mix(in srgb, var(--primary) 18%, var(--secondary))); color: #f8fafc; }
    .theme-bold .content-section.section-dark .section-copy h2 { color: #f8fafc; -webkit-text-fill-color: #f8fafc; background: none; -webkit-background-clip: unset; background-clip: unset; }
    .theme-bold .content-section.section-dark .section-body { color: rgba(248,250,252,0.72); }
    .theme-bold .content-section.section-dark h3 { color: #f3f4f6; }
    .theme-bold .content-section.section-dark .feature-card { background: rgba(255,255,255,0.07); border-color: rgba(255,255,255,0.14); color: #f8fafc; }
    .theme-bold .content-section.section-dark .feature-card h3 { color: #fff; }
    .theme-bold .content-section.section-dark .service-card { background: rgba(255,255,255,0.07); border-color: rgba(255,255,255,0.14); color: #f8fafc; }
    .theme-bold .content-section.section-dark .step-item { background: rgba(255,255,255,0.07); border-color: rgba(255,255,255,0.12); color: #f8fafc; }
    .theme-bold .content-section.section-dark .testimonial-card { background: rgba(255,255,255,0.07); border-color: rgba(255,255,255,0.14); color: #f8fafc; }
    .theme-bold .content-section.section-dark .testimonial-card blockquote { color: rgba(248,250,252,0.82); }
    .theme-bold .content-section.section-dark .testimonial-meta strong { color: #fff; }
    .theme-bold .content-section.section-dark .testimonial-meta span { color: rgba(248,250,252,0.6); }
    .theme-bold .content-section.section-dark .eyebrow { color: var(--accent); }
    /* premium � entirely dark site */
    .theme-premium { --shadow: 0 24px 64px rgba(0,0,0,0.22); --shadow-strong: 0 32px 80px rgba(0,0,0,0.34); --bg: #0d0d10; }
    .theme-premium body, .theme-premium .page-shell { background: #0d0d10 !important; }
    .theme-premium .hero-section { background-color: #0d0d0d; }
    .theme-premium .content-section { background: linear-gradient(180deg, #0f0f10, #111215); color: #e5e7eb; }
    .theme-premium .content-section.section-dark { background: linear-gradient(180deg, #0f0f10, #111215); }
    .theme-premium .content-section.section-light { background: #111318; color: #f8fafc; }
    .theme-premium .section-copy h2, .theme-premium .section-copy .eyebrow { color: #f8fafc; -webkit-text-fill-color: #f8fafc; background: none; }
    .theme-premium .section-body { color: rgba(229,231,235,0.75); }
    .theme-premium .feature-card, .theme-premium .testimonial-card, .theme-premium .service-card { background: linear-gradient(180deg, rgba(28,28,32,0.96), rgba(20,20,24,0.9)); border-color: rgba(255,255,255,0.1); color: #e5e7eb; }
    .theme-premium .testimonial-card blockquote { color: rgba(229,231,235,0.78); }
    .theme-premium .feature-card h3, .theme-premium .service-card h3, .theme-premium .testimonial-meta strong { color: #f8fafc; }
    .theme-premium .testimonial-meta span { color: rgba(229,231,235,0.58); }
    .theme-premium .step-item { background: rgba(28,28,32,0.88); border-color: rgba(255,255,255,0.08); color: #e5e7eb; }
    .theme-premium .faq-item { background: linear-gradient(180deg, rgba(28,28,32,0.96), rgba(20,20,24,0.9)); border-color: rgba(255,255,255,0.1); }
    .theme-premium .faq-trigger { color: #f8fafc; }
    .theme-premium .faq-panel { color: rgba(229,231,235,0.78); }
    .theme-premium .proof-strip { background: rgba(15,15,18,0.96); border-color: rgba(255,255,255,0.08); }
    .theme-premium .proof-strip-inner span { background: rgba(255,255,255,0.06); border-color: rgba(255,255,255,0.1); color: rgba(229,231,235,0.72); }
    .theme-premium .final-cta-section { background: #0d0d10; }
    .theme-premium .site-footer { background: #08080a; }
    /* energetic */
    .theme-energetic .hero-copy h1 { text-transform: uppercase; font-size: clamp(2rem, 4.5vw, 3.8rem); letter-spacing: -0.01em; }
    .theme-energetic .content-section.section-dark { background: linear-gradient(135deg, color-mix(in srgb, var(--primary) 14%, var(--bg)), color-mix(in srgb, var(--accent) 12%, var(--bg))); }
    .theme-energetic .feature-card { border: 2px solid transparent; background-clip: padding-box; position: relative; }
    .theme-energetic .feature-card::after { content: ""; position: absolute; inset: -2px; border-radius: inherit; background: linear-gradient(135deg, var(--primary), var(--accent)); z-index: -1; opacity: 0; transition: opacity .2s ease; }
    .theme-energetic .feature-card:hover::after { opacity: 0.7; }
    .theme-energetic .step-number { background: linear-gradient(135deg, var(--accent), var(--primary)); }
    .theme-energetic .eyebrow { letter-spacing: 0.22em; color: var(--accent); }
    /* minimal � clean, light, no-shadow */
    .theme-minimal { --shadow: none; --shadow-strong: 0 4px 16px rgba(15,23,42,0.08); --radius-xl: 12px; --radius-lg: 10px; --radius-md: 8px; }
    .theme-minimal .hero-section { background: var(--bg) !important; --hero-image: none; padding: 100px 0 72px; }
    .theme-minimal .hero-backdrop, .theme-minimal .hero-noise { display: none !important; }
    .theme-minimal .hero-copy h1 { color: var(--text); }
    .theme-minimal .hero-subtitle { color: var(--muted); }
    .theme-minimal .btn-primary { background: var(--primary); box-shadow: none; }
    .theme-minimal .btn-secondary { background: transparent; color: var(--primary); border: 1.5px solid var(--primary); }
    .theme-minimal .feature-card, .theme-minimal .testimonial-card, .theme-minimal .service-card, .theme-minimal .faq-item { box-shadow: none; border: 1px solid color-mix(in srgb, currentColor 14%, transparent); background: transparent; }
    .theme-minimal .feature-card::before { display: none; }
    .theme-minimal .section-orb { display: none; }
    .theme-minimal .content-section { padding: var(--section-padding, 100px 0); }
    .theme-minimal .step-number { background: var(--text); }
    .theme-minimal .final-cta-card { background: var(--text); }
    .theme-minimal .content-section.section-dark { background: #f1f5f9; }
    .theme-minimal .content-section.section-light { background: #ffffff; }
    /* editorial */
    .theme-editorial .content-section { padding: var(--section-padding, 96px 0); }
    .theme-editorial .hero-copy h1 { font-style: italic; letter-spacing: -0.04em; }
    .theme-editorial .section-copy h2 { font-style: italic; letter-spacing: -0.05em; max-width: 16ch; }
    .theme-editorial .feature-card, .theme-editorial .testimonial-card, .theme-editorial .service-card { border-radius: 4px; box-shadow: none; }
    .theme-editorial .feature-card::before { display: none; }
    .theme-editorial .testimonial-card { border-left: 3px solid var(--accent); border-radius: 0; background: transparent; box-shadow: none; }
    .theme-editorial .proof-strip-inner span { background: transparent; border: none; font-style: italic; }
    /* -- end theme overrides -- */
    /* -- form layout -- */
    .layout-form .lead-form { max-width: 640px; margin: 0 auto; }
    .form-grid { display: grid; gap: 18px; }
    .form-group { display: flex; flex-direction: column; gap: 7px; }
    .form-group-check { flex-direction: row; align-items: center; gap: 10px; }
    .form-label { font-size: 0.9rem; font-weight: 600; color: var(--text); }
    .form-required { color: var(--accent); }
    .form-check-label { display: flex; align-items: center; gap: 9px; font-size: 0.9rem; cursor: pointer; }
    .form-control { width: 100%; padding: 13px 16px; border-radius: var(--radius-md); border: 1.5px solid var(--border); background: rgba(255,255,255,0.92); color: var(--text); font: inherit; font-size: 0.96rem; transition: border-color .2s ease, box-shadow .2s ease; }
    .form-control:focus { outline: none; border-color: var(--primary); box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary) 16%, transparent); }
    textarea.form-control { resize: vertical; min-height: 110px; }
    select.form-control { cursor: pointer; }
    .form-submit-row { margin-top: 12px; display: flex; justify-content: center; }
    /* -- embed layout -- */
    .embed-wrapper { max-width: 900px; margin: 0 auto; border-radius: var(--radius-xl); overflow: hidden; }
    .embed-wrapper iframe, .embed-wrapper video, .embed-wrapper embed { width: 100%; display: block; border: 0; }
    /* -- footer social -- */
    .footer-social { display: flex; gap: 16px; justify-content: center; margin-top: 12px; flex-wrap: wrap; }
    .footer-social a { color: var(--muted); transition: color .2s, transform .2s; display: inline-flex; align-items: center; }
    .footer-social a:hover { color: var(--primary); transform: translateY(-2px); }
    .footer-social svg { width: 22px; height: 22px; fill: currentColor; }
    .theme-editorial .hero-copy h1, .theme-premium .hero-copy h1 { max-width: 10ch; }
    .theme-editorial .section-copy h2, .theme-premium .section-copy h2 { letter-spacing: -0.045em; }
    .proof-editorial .proof-strip-inner span, .proof-premium .proof-strip-inner span { background: linear-gradient(135deg, rgba(255,255,255,0.96), rgba(255,248,235,0.88)); }
    .proof-bold .proof-strip-inner span, .proof-energetic .proof-strip-inner span { background: linear-gradient(135deg, rgba(219,234,254,0.72), rgba(254,242,242,0.66)); }
    /* -- testimonial avatar � dark section adaptations -- */
    .theme-bold .content-section.section-dark .testimonial-avatar { border-color: rgba(255,255,255,0.28); }
    .theme-premium .testimonial-avatar { border-color: rgba(255,255,255,0.22); }
    .theme-premium .testimonial-meta strong { color: #f8fafc; }
    .theme-premium .testimonial-meta span { color: rgba(229,231,235,0.55); }
    .theme-energetic .content-section.section-dark .testimonial-avatar { border-color: rgba(255,255,255,0.28); }
    .theme-energetic .content-section.section-dark .testimonial-card { background: rgba(255,255,255,0.07); border-color: rgba(255,255,255,0.14); color: #f8fafc; }
    .theme-energetic .content-section.section-dark .testimonial-card blockquote { color: rgba(248,250,252,0.82); }
    .theme-energetic .content-section.section-dark .testimonial-meta strong { color: #fff; }
    .theme-energetic .content-section.section-dark .testimonial-meta span { color: rgba(248,250,252,0.6); }
    /* -- form controls � dark theme adaptations -- */
    .theme-premium .form-control { background: rgba(255,255,255,0.06); border-color: rgba(255,255,255,0.16); color: #f8fafc; }
    .theme-premium .form-control:focus { border-color: var(--primary); box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary) 24%, transparent); }
    .theme-premium .form-control::placeholder { color: rgba(229,231,235,0.38); }
    .theme-premium .form-label { color: #e5e7eb; }
    .theme-premium .form-check-label { color: #e5e7eb; }
    .theme-premium select.form-control option { background: #1c1c20; color: #e5e7eb; }
    .theme-bold .content-section.section-dark .form-control { background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.2); color: #f8fafc; }
    .theme-bold .content-section.section-dark .form-control:focus { border-color: var(--accent); }
    .theme-bold .content-section.section-dark .form-control::placeholder { color: rgba(248,250,252,0.36); }
    .theme-bold .content-section.section-dark .form-label { color: #f8fafc; }
    .theme-bold .content-section.section-dark .form-check-label { color: #f8fafc; }
    .theme-energetic .content-section.section-dark .form-control { background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.2); color: #f8fafc; }
    .theme-energetic .content-section.section-dark .form-control:focus { border-color: var(--accent); }
    .theme-energetic .content-section.section-dark .form-control::placeholder { color: rgba(248,250,252,0.36); }
    .theme-energetic .content-section.section-dark .form-label { color: #f8fafc; }
    .theme-energetic .content-section.section-dark .form-check-label { color: #f8fafc; }
    /* -- embed wrapper � themed borders -- */
    .theme-premium .embed-wrapper { border: 1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.03); }
    .theme-bold .embed-wrapper { border: 2px solid rgba(255,255,255,0.12); }
    .theme-minimal .embed-wrapper { border: 1px solid color-mix(in srgb, var(--text) 12%, transparent); }
    .theme-editorial .embed-wrapper { border: 1px solid var(--border); border-radius: 4px; }
    /* -- hero-section-minimal -- */
    .hero-section-minimal { background: var(--secondary); color: #fff; padding: 100px 0 80px; min-height: unset; }
    .hero-section-minimal .hero-backdrop, .hero-section-minimal .hero-noise { display: none; }
    .hero-section-minimal .hero-copy { text-align: left; max-width: 680px; }
    /* -- card style variants -- */
    .card-style-glass .feature-card, .card-style-glass .service-card, .card-style-glass .testimonial-card { background: rgba(255,255,255,0.12); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); border: 1px solid rgba(255,255,255,0.2); box-shadow: none; }
    .card-style-flat .feature-card, .card-style-flat .service-card, .card-style-flat .testimonial-card { background: var(--surface); box-shadow: none; border: none; }
    .card-style-outlined .feature-card, .card-style-outlined .service-card, .card-style-outlined .testimonial-card { background: transparent; border: 1.5px solid var(--primary); box-shadow: none; }
    /* -- floating CTA button -- */
    .floating-cta-btn { position: fixed; bottom: 24px; right: 24px; z-index: 9000; display: inline-flex; align-items: center; justify-content: center; width: 60px; height: 60px; border-radius: 50%; background: var(--primary); color: #fff; box-shadow: 0 4px 16px rgba(0,0,0,0.28); transition: transform 0.18s ease, box-shadow 0.18s ease; text-decoration: none; }
    .floating-cta-btn:hover { transform: scale(1.08); box-shadow: 0 8px 24px rgba(0,0,0,0.36); }
    .floating-cta-btn svg { display: block; }
    /* -- mobile hamburger nav -- */
    .nav-mobile-toggle { display: none; flex-direction: column; gap: 5px; width: 38px; height: 38px; align-items: center; justify-content: center; cursor: pointer; background: transparent; border: 0; padding: 4px; border-radius: 8px; color: var(--nav-text); transition: background .2s; }
    .nav-mobile-toggle:hover { background: rgba(128,128,128,0.12); }
    .nav-mobile-toggle span { display: block; width: 22px; height: 2px; background: currentColor; border-radius: 2px; transition: transform .25s ease, opacity .25s ease; transform-origin: center; }
    .nav-mobile-toggle.is-active span:nth-child(1) { transform: translateY(7px) rotate(45deg); }
    .nav-mobile-toggle.is-active span:nth-child(2) { opacity: 0; transform: scaleX(0); }
    .nav-mobile-toggle.is-active span:nth-child(3) { transform: translateY(-7px) rotate(-45deg); }
    .mobile-nav-overlay { display: none; position: fixed; inset: 64px 0 0; z-index: 19; background: var(--nav-bg-scrolled); backdrop-filter: blur(20px); padding: 24px 20px; flex-direction: column; gap: 12px; border-top: 1px solid var(--nav-border); }
    .mobile-nav-overlay.is-open { display: flex; }
    .mobile-nav-overlay a { padding: 14px 16px; border-radius: var(--radius-md); font-weight: 600; color: var(--nav-text); transition: background .15s; font-size: 1.05rem; }
    .mobile-nav-overlay a:hover { background: rgba(128,128,128,0.1); }
    .mobile-nav-cta { background: linear-gradient(135deg, var(--primary), color-mix(in srgb, var(--accent) 38%, var(--primary) 62%)) !important; color: #fff !important; text-align: center; margin-top: 8px; }
    @media (max-width: 960px) {
      .hero-grid, .section-split, .layout-featured .section-shell { grid-template-columns: 1fr; }
      .top-nav { display: none; }
      .nav-mobile-toggle { display: flex; }
      .hero-section { padding-top: 64px; }
      .section-split { gap: 36px; }
    }
    @media (max-width: 640px) {
      .content-section, .final-cta-section { padding: 72px 0; }
      .final-cta-card { padding: 32px 24px; }
      .hero-copy h1 { max-width: 100%; }
      .btn { width: 100%; }
      .hero-actions { flex-direction: column; align-items: stretch; }
      .section-stats { flex-direction: column; }
      .steps-grid { grid-template-columns: 1fr; }
      .stats-grid { grid-template-columns: repeat(2, 1fr); }
    }
  `.trim();

  const js = `
    document.addEventListener('DOMContentLoaded', () => {
      const header = document.querySelector('.site-header');
      const revealElements = document.querySelectorAll('[data-reveal]');

      const setHeaderState = () => {
        if (!header) return;
        header.classList.toggle('is-scrolled', window.scrollY > 18);
      };

      setHeaderState();
      window.addEventListener('scroll', setHeaderState, { passive: true });

      if ('IntersectionObserver' in window) {
        const observer = new IntersectionObserver((entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              entry.target.classList.add('is-visible');
              observer.unobserve(entry.target);
            }
          });
        }, { threshold: 0.16, rootMargin: '0px 0px -8% 0px' });

        revealElements.forEach((element) => observer.observe(element));
      } else {
        revealElements.forEach((element) => element.classList.add('is-visible'));
      }

      document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
        anchor.addEventListener('click', (event) => {
          const href = anchor.getAttribute('href');
          if (!href || href === '#') return;
          const target = document.querySelector(href);
          if (!target) return;
          event.preventDefault();
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      });

      document.querySelectorAll('.faq-item').forEach((item) => {
        const trigger = item.querySelector('.faq-trigger');
        if (!trigger) return;
        trigger.addEventListener('click', () => {
          const isOpen = item.classList.toggle('open');
          trigger.setAttribute('aria-expanded', String(isOpen));
        });
      });

      // -- Prevent native form reload when no action URL is set --
      document.querySelectorAll('.lead-form').forEach(function(form) {
        if (!form.getAttribute('action')) {
          form.addEventListener('submit', function(e) { e.preventDefault(); });
        }
      });

      // -- Mobile nav hamburger --
      var navToggle = document.getElementById('nav-toggle');
      var mobileNav = document.getElementById('mobile-nav');
      if (navToggle && mobileNav) {
        navToggle.addEventListener('click', function() {
          var isOpen = mobileNav.classList.toggle('is-open');
          navToggle.setAttribute('aria-expanded', String(isOpen));
          navToggle.classList.toggle('is-active', isOpen);
          mobileNav.setAttribute('aria-hidden', String(!isOpen));
          document.body.style.overflow = isOpen ? 'hidden' : '';
        });
        mobileNav.querySelectorAll('a').forEach(function(link) {
          link.addEventListener('click', function() {
            mobileNav.classList.remove('is-open');
            navToggle.setAttribute('aria-expanded', 'false');
            navToggle.classList.remove('is-active');
            mobileNav.setAttribute('aria-hidden', 'true');
            document.body.style.overflow = '';
          });
        });
      }

      // -- Hero carousel --
      var carouselSlides = document.querySelectorAll('.carousel-slide');
      var carouselDots = document.querySelectorAll('.carousel-dot');
      if (carouselSlides.length > 1) {
        var currentSlide = 0;
        var autoTimer = null;

        var goToSlide = function(index) {
          carouselSlides[currentSlide] && carouselSlides[currentSlide].classList.remove('is-active');
          carouselDots[currentSlide] && carouselDots[currentSlide].classList.remove('is-active');
          currentSlide = (index + carouselSlides.length) % carouselSlides.length;
          carouselSlides[currentSlide] && carouselSlides[currentSlide].classList.add('is-active');
          carouselDots[currentSlide] && carouselDots[currentSlide].classList.add('is-active');
        };

        var resetTimer = function() {
          if (autoTimer) clearInterval(autoTimer);
          autoTimer = setInterval(function() { goToSlide(currentSlide + 1); }, 4500);
        };

        var prevBtn = document.querySelector('.carousel-prev');
        var nextBtn = document.querySelector('.carousel-next');
        if (prevBtn) prevBtn.addEventListener('click', function() { goToSlide(currentSlide - 1); resetTimer(); });
        if (nextBtn) nextBtn.addEventListener('click', function() { goToSlide(currentSlide + 1); resetTimer(); });
        carouselDots.forEach(function(dot, i) {
          dot.addEventListener('click', function() { goToSlide(i); resetTimer(); });
        });
        resetTimer();
      }
    });
  `.trim();

  return normalizeStructuredSitePayload({
    html,
    css,
    js,
    assets: enforcedPlan.assets,
    slug: enforcedPlan.slug,
  }, enforcedPlan.slug);
}

function stripDisallowedExternalResources(content: string) {
  return content
    .replace(/<script[^>]*src=["'][^"']*cdn\.tailwindcss\.com[^"']*["'][^>]*><\/script>/gi, "")
    .replace(/<link[^>]*href=["'][^"']*font-awesome[^"']*["'][^>]*>/gi, "")
    .replace(/<link[^>]*href=["'][^"']*all\.min\.css[^"']*["'][^>]*>/gi, "")
    .replace(/\sintegrity=["'][^"']*["']/gi, "")
    .replace(/\scrossorigin=["'][^"']*["']/gi, "");
}

function sanitizeBrokenImageUrls(content: string) {
  return content.replace(/https?:\/\/image\.civitai\.com\/[^"')\s]+/gi, "https://placehold.co/1200x800/1f2937/FFFFFF?text=Image");
}

function sanitizeHtmlFragment(content: string, businessName?: string) {
  const cleaned = sanitizeBrokenImageUrls(stripDisallowedExternalResources(content));
  if (/<(html|head|body|script|style|link)\b/i.test(cleaned)) {
    return extractStructuredSiteFromHtml(cleaned, businessName).html;
  }
  return cleaned.trim();
}

function sanitizeCssContent(content: string) {
  return sanitizeBrokenImageUrls(stripDisallowedExternalResources(content)).trim();
}

function sanitizeJsContent(content: string) {
  return stripDisallowedExternalResources(content).trim();
}

function stripCodeFences(content: string) {
  let cleaned = content.trim();
  if (cleaned.startsWith("```html")) cleaned = cleaned.slice(7);
  else if (cleaned.startsWith("```")) cleaned = cleaned.slice(3);
  if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3);
  return cleaned.trim();
}

function findFirstJsonObject(content: string) {
  const start = content.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < content.length; index++) {
    const char = content[index];

    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") depth++;
    if (char === "}") {
      depth--;
      if (depth === 0) {
        return content.slice(start, index + 1);
      }
    }
  }

  return null;
}

function extractModelText(payload: any) {
  const candidate = payload?.candidates?.[0];
  if (candidate?.finishReason && candidate.finishReason !== "STOP") {
    console.warn(`Model finishReason: ${candidate.finishReason} � output may be truncated or blocked`);
  }
  return candidate?.content?.parts
    ?.filter((part: any) => part?.text && !part?.thought)
    .map((part: any) => part.text)
    .join("\n")
    .trim() || null;
}

function normalizeStructuredSitePayload(candidate: Partial<StructuredSitePayload>, businessName?: string): StructuredSitePayload {
  const html = typeof candidate.html === "string" && candidate.html.trim() !== "" ? sanitizeHtmlFragment(candidate.html, businessName) : "<div>Fallback</div>";
  const css = typeof candidate.css === "string" && candidate.css.trim() !== "" ? sanitizeCssContent(candidate.css) : "body { margin: 0; font-family: Arial; }";
  const js = typeof candidate.js === "string" && candidate.js.trim() !== ""
    ? sanitizeJsContent(candidate.js)
    : "document.addEventListener('DOMContentLoaded', () => {});";
  const assets = Array.isArray(candidate.assets)
    ? candidate.assets
      .filter((value): value is string => {
        if (typeof value !== "string") return false;
        const normalized = value.trim();
        return (/^https?:\/\//i.test(normalized) || /^data:image\//i.test(normalized))
          && !/image\.civitai\.com/i.test(normalized);
      })
      .map((value) => value.trim())
    : [];

  const slug = typeof candidate.slug === "string" && candidate.slug.trim() !== ""
    ? candidate.slug.trim()
    : (businessName || "site").toLowerCase().replace(/[^a-z0-9-]/g, "-");

  return { html, css, js, assets, slug };
}

function countSemanticSections(html: string) {
  const semanticMatches = html.match(/<(section|header|footer|main|article|aside)\b/gi) || [];
  return semanticMatches.length;
}

function hasMeaningfulCta(html: string) {
  // English + broad Portuguese CTA phrases
  return /(get started|book|schedule|contact|start now|request|download|try now|sign up|fale|agende|solicite|comece|saiba mais|entre em contato|pe�a|peca|compre|cadastre|acesse|envie|reserve|baixe|quero|clique|experimente|assine|inscreva|ligue|chame|whatsapp|or�amento|orcamento|contratar|obter|garantir|ver planos|ver pre�os|ver precos|converse|falar)/i.test(html);
}

function hasHeroStructure(html: string) {
  const normalized = html.replace(/\s+/g, " ");
  return /hero|banner|headline|main-title|above-the-fold/i.test(normalized)
    || /<h1\b/i.test(normalized);
}

function hasSocialProofOrTrust(html: string) {
  return /(testimonial|review|client|customer|trusted|proof|depoimento|clientes|resultados|trusted by|case study)/i.test(html);
}

function hasInteractionLogic(js: string) {
  return /(addEventListener\(|querySelector\(|scrollTo\(|classList\.|toggle\(|accordion|faq|menu|click)/i.test(js);
}

function getStructuredSiteValidationError(payload: StructuredSitePayload | null) {
  if (!payload) return "missing-payload";
  if (countSemanticSections(payload.html) < 4) return "weak-structure";
  if (!hasHeroStructure(payload.html)) return "missing-hero";
  if (!hasMeaningfulCta(payload.html)) return "missing-cta";
  if (!hasSocialProofOrTrust(payload.html)) return "missing-proof";
  if (payload.css.trim().length < 600) return "weak-css";
  if (!/DOMContentLoaded/.test(payload.js) || !hasInteractionLogic(payload.js) || payload.js.trim().length < 80) return "weak-js";
  return null;
}

function extractAssets(content: string) {
  const found = new Set<string>();
  const patterns = [
    /(src|data-src)=["'](https?:\/\/[^"']+)["']/gi,
    /poster=["'](https?:\/\/[^"']+)["']/gi,
    /srcset=["']([^"']+)["']/gi,
    /url\((["']?)(https?:\/\/[^"')]+)\1\)/gi,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      if (pattern.source.startsWith('srcset')) {
        const entries = match[1].split(',').map((item) => item.trim().split(/\s+/)[0]).filter(Boolean);
        entries.forEach((entry) => found.add(entry));
      } else {
        found.add(match[2]);
      }
    }
  }

  return Array.from(found);
}

function extractStructuredSiteFromHtml(rawHtml: string, businessName?: string): StructuredSitePayload {
  const cleaned = sanitizeBrokenImageUrls(stripDisallowedExternalResources(stripCodeFences(rawHtml)));
  const styleMatches = Array.from(cleaned.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi));
  const scriptMatches = Array.from(cleaned.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi));
  const bodyMatch = cleaned.match(/<body[^>]*>([\s\S]*?)<\/body>/i);

  const htmlWithoutStyles = cleaned.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
  const htmlWithoutScripts = htmlWithoutStyles.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  const bodyHtml = bodyMatch ? bodyMatch[1].trim() : htmlWithoutScripts.trim();
  const css = sanitizeCssContent(styleMatches.map((match) => match[1].trim()).filter(Boolean).join("\n\n"));
  const js = sanitizeJsContent(scriptMatches.map((match) => match[1].trim()).filter(Boolean).join("\n\n"));
  const assets = extractAssets(cleaned).filter((value) => !/image\.civitai\.com/i.test(value));

  return normalizeStructuredSitePayload({ html: bodyHtml, css, js, assets }, businessName);
}

function parseStructuredSiteText(rawText: string, businessName?: string) {
  const cleaned = stripCodeFences(rawText);
  const jsonCandidate = findFirstJsonObject(cleaned);

  if (jsonCandidate) {
    try {
      return normalizeStructuredSitePayload(JSON.parse(jsonCandidate), businessName);
    } catch (error) {
      console.warn("Failed to parse structured site JSON", error);
    }
  }

  return extractStructuredSiteFromHtml(cleaned, businessName);
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

    return null;
  }
}

function clampPromptSize(prompt: string, _accountType: unknown) {
  // Character truncation disabled for both keys (admin/testing).
  // Keep full prompt context to avoid partial/incomplete site output.
  return { text: prompt, truncated: false };
}

function injectBeforeClosingTag(html: string, tagName: string, snippet: string) {
  const closingTag = new RegExp(`</${tagName}>`, "i");
  if (!closingTag.test(html)) return html + snippet;
  return html.replace(closingTag, `${snippet}\n</${tagName}>`);
}

function extractRoleFromContext(rawContext: string) {
  const text = String(rawContext || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const roleMatches = text.match(/\b(ceo|founder|owner|manager|director|dentist|doctor|attorney|advogado|engenheiro|designer|consultant|coach|developer|architect|broker|realtor|nutritionist|professor|teacher|therapist|sales|marketing|cto|cfo|coo|head of [a-z\s]+)\b/i);
  if (roleMatches?.[0]) return roleMatches[0];
  const metaHint = text.match(/[-,|]\s*([A-Za-z][A-Za-z\s]{2,40})$/);
  if (metaHint?.[1]) return metaHint[1].trim();
  return "";
}

function setOrReplaceAttribute(tag: string, attribute: string, value: string) {
  const attrPattern = new RegExp(`\\b${escapeRegExp(attribute)}\\s*=\\s*(["']).*?\\1`, "i");
  if (attrPattern.test(tag)) {
    return tag.replace(attrPattern, `${attribute}="${escapeHtml(value)}"`);
  }
  return tag.replace(/<img\b/i, `<img ${attribute}="${escapeHtml(value)}"`);
}

async function enforcePexelsTestimonialAvatarsInHtml(
  html: string,
  pexelsKey: string,
  businessHint: string,
): Promise<string> {
  if (!pexelsKey) return html;

  let out = html;
  const usedPhotoIds = new Set<string>();
  const imgRegex = /<img\b[^>]*>/gi;
  const matches = Array.from(out.matchAll(imgRegex));

  for (let i = matches.length - 1; i >= 0; i--) {
    const match = matches[i];
    const tag = match[0];
    const start = match.index ?? -1;
    if (start < 0) continue;

    const classMatch = tag.match(/class\s*=\s*(["'])(.*?)\1/i);
    const altMatch = tag.match(/alt\s*=\s*(["'])(.*?)\1/i);
    const classText = (classMatch?.[2] || "").toLowerCase();
    const altText = (altMatch?.[2] || "").toLowerCase();

    const contextSlice = out.slice(Math.max(0, start - 600), Math.min(out.length, start + tag.length + 600));
    const testimonialContext = /testimonial|depoimento|review|customer|client|case-study|social-proof/i.test(contextSlice);
    const isAvatar = /avatar|testimonial|review|client|depoimento/.test(classText) || /testimonial|depoimento|cliente|client|review/.test(altText);
    if (!testimonialContext && !isAvatar) continue;

    const role = extractRoleFromContext(contextSlice);
    const queryBase = role || businessHint || "business";
    const avatarUrl = await pickUniquePexelsPhoto([
      `professional ${queryBase} headshot`,
      `${queryBase} portrait`,
      "professional portrait",
    ], pexelsKey, usedPhotoIds, "portrait");

    if (!avatarUrl) continue;

    let patchedTag = setOrReplaceAttribute(tag, "src", avatarUrl);
    patchedTag = setOrReplaceAttribute(patchedTag, "loading", "lazy");
    if (!/class\s*=\s*["'][^"']*testimonial-avatar[^"']*["']/i.test(patchedTag)) {
      patchedTag = /class\s*=\s*(["'])(.*?)\1/i.test(patchedTag)
        ? patchedTag.replace(/class\s*=\s*(["'])(.*?)\1/i, (_m, q, c) => `class=${q}${c} testimonial-avatar${q}`)
        : patchedTag.replace(/<img\b/i, '<img class="testimonial-avatar"');
    }

    out = out.slice(0, start) + patchedTag + out.slice(start + tag.length);
  }

  return out;
}

function enforceSeoAndCroFoundation(
  html: string,
  options: { businessName?: string; language?: string; slug?: string },
) {
  let out = html;
  const pageLang = String(options.language || "en").slice(0, 5);
  const fallbackTitle = String(options.businessName || "Landing Page").trim() || "Landing Page";
  const h1Match = out.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const plainH1 = (h1Match?.[1] || fallbackTitle).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const pMatch = out.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
  const plainP = (pMatch?.[1] || "High-converting page built for performance and clarity.")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const desc = plainP.length > 160 ? `${plainP.slice(0, 157)}...` : plainP;
  const canonical = options.slug ? `/${String(options.slug).replace(/^\/+/, "")}` : "/";

  if (!/\slang\s*=\s*["']/i.test(out)) {
    out = out.replace(/<html\b/i, `<html lang="${escapeHtml(pageLang)}"`);
  }
  if (!/<title>/i.test(out)) {
    out = injectBeforeClosingTag(out, "head", `<title>${escapeHtml(plainH1 || fallbackTitle)}</title>`);
  }

  const seoSnippets: string[] = [];
  if (!/name\s*=\s*["']description["']/i.test(out)) seoSnippets.push(`<meta name="description" content="${escapeHtml(desc)}">`);
  if (!/name\s*=\s*["']robots["']/i.test(out)) seoSnippets.push(`<meta name="robots" content="index,follow,max-image-preview:large">`);
  if (!/rel\s*=\s*["']canonical["']/i.test(out)) seoSnippets.push(`<link rel="canonical" href="${escapeHtml(canonical)}">`);
  if (!/property\s*=\s*["']og:title["']/i.test(out)) seoSnippets.push(`<meta property="og:title" content="${escapeHtml(plainH1 || fallbackTitle)}">`);
  if (!/property\s*=\s*["']og:description["']/i.test(out)) seoSnippets.push(`<meta property="og:description" content="${escapeHtml(desc)}">`);
  if (!/name\s*=\s*["']twitter:card["']/i.test(out)) seoSnippets.push(`<meta name="twitter:card" content="summary_large_image">`);

  const schema = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: fallbackTitle,
    description: desc,
    url: canonical,
  };

  if (!/application\/ld\+json/i.test(out)) {
    seoSnippets.push(`<script type="application/ld+json" id="cf-seo-schema">${JSON.stringify(schema)}</script>`);
  }

  if (seoSnippets.length > 0) {
    out = injectBeforeClosingTag(out, "head", seoSnippets.join("\n"));
  }

  const ctaMatch = out.match(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]{1,80}?)<\/a>/i);
  if (ctaMatch && !/cf-mobile-cta-bar/i.test(out)) {
    const href = String(ctaMatch[1] || "#cta").trim() || "#cta";
    const label = String(ctaMatch[2] || "Get Started").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || "Get Started";
    const croStyle = `
  <style id="cf-mobile-cta-style">
    .cf-mobile-cta-bar{position:fixed;left:12px;right:12px;bottom:12px;z-index:9999;display:none;}
    .cf-mobile-cta-bar a{display:flex;justify-content:center;align-items:center;padding:14px 16px;border-radius:999px;background:#0f172a;color:#fff;text-decoration:none;font-weight:700;box-shadow:0 12px 26px rgba(2,6,23,.28);}
    @media (max-width: 960px){.cf-mobile-cta-bar{display:block;}}
  </style>`;
    const croBar = `<div class="cf-mobile-cta-bar"><a href="${safeUrl(href)}">${escapeHtml(label)}</a></div>`;
    out = injectBeforeClosingTag(out, "head", croStyle);
    out = injectBeforeClosingTag(out, "body", croBar);
  }

  return out;
}

function enforceHeroFallbackImage(html: string, fallbackUrl: string, primaryHeroUrl = "") {
  // Pick the best image URL to enforce: prefer the primary hero (from form/Pexels), fall back to fallback
  const imageUrl = (primaryHeroUrl || "").trim() || (fallbackUrl || "").trim();
  if (!imageUrl) return html;

  // Already used somewhere in the HTML — nothing to do
  if (html.includes(imageUrl)) return html;

  // Check whether the hero section already has a real image (background-image with url() containing http/data,
  // or an <img src="http..."> tag) — deliberately strict so CSS gradients don't count as "has visual"
  const heroChunkMatch = html.match(/<header[^>]*id=["']hero["'][^>]*>[\s\S]{0,3000}/i)
    || html.match(/<section[^>]*(?:id=["']hero["']|class=["'][^"']*hero[^"']*["'])[^>]*>[\s\S]{0,3000}/i);
  const heroChunk = heroChunkMatch ? heroChunkMatch[0] : "";

  const hasRealHeroImage = heroChunk
    ? /background-image\s*:[^;]*url\s*\(\s*["']?\s*https?:\/\//i.test(heroChunk)
      || /background-image\s*:[^;]*url\s*\(\s*["']?\s*data:image/i.test(heroChunk)
      || /<img[^>]+src=["']\s*https?:\/\//i.test(heroChunk)
    : false;

  if (hasRealHeroImage) return html;

  const style = `
  <style id="cf-hero-fallback-style">
    #hero, header#hero, .hero, .hero-section, [id="hero"] {
      background-image: linear-gradient(rgba(0,0,0,.45), rgba(0,0,0,.45)), url('${safeUrl(imageUrl)}') !important;
      background-size: cover !important;
      background-position: center top !important;
      background-repeat: no-repeat !important;
    }
  </style>`;

  return injectBeforeClosingTag(html, "head", style);
}

/**
 * Post-processing: fix two common AI mistakes in the generated HTML.
 *
 * 1. LOGO MISUSE: if the AI placed a section/person/landscape image as the logo
 *    (brand-logo src), replace it with the correct logoUrl, or remove the img
 *    so the brand-text fallback renders.
 *
 * 2. IMAGE REPETITION: each provided image URL should appear at most once in the
 *    visible content (hero + sections). If the same URL is used in multiple places,
 *    keep the first occurrence and remove duplicates.
 *
 * 3. PERSON/PORTRAIT: Never use a portrait photo as a logo. Replace or blank it.
 */
function enforceImageRoles(
  html: string,
  logoUrl: string,
  heroUrl: string,
  sectionUrls: string[],
  mustUseUrls: string[] = [],
): string {
  let out = html;

  // -- 1. Fix logo: ensure brand-logo img uses the real logoUrl ---------
  // CRITICAL: if logoUrl is a person image, don't use it as logo — remove the img instead
  const isLogoAPerson = logoUrl && isLikelyPersonImage(logoUrl);

  if (logoUrl && !isLogoAPerson) {
    // Always enforce the user-provided logoUrl — replace whatever the AI put in <img class="brand-logo">
    out = out.replace(
      /(<img[^>]*class=["'][^"']*brand-logo[^"']*["'][^>]*)\bsrc=["']([^"']+)["']/gi,
      (match, prefix, src) => {
        if (src === logoUrl) return match;
        // Always replace — AI may have hallucinated any random URL (person photo, Pexels, etc.)
        return `${prefix}src="${safeUrl(logoUrl)}"`;
      },
    );
    // If AI omitted the logo image entirely and only rendered text, inject the logo into brand-mark.
    if (!/<img[^>]*class=["'][^"']*brand-logo[^"']*["'][^>]*>/i.test(out)) {
      out = out.replace(
        /(<(?:a|div)[^>]*class=["'][^"']*brand-mark[^"']*["'][^>]*>)([\s\S]*?)(<\/(?:a|div)>)/i,
        (match, open, inner, close) => {
          if (/<img[^>]*class=["'][^"']*brand-logo[^"']*["'][^>]*>/i.test(inner)) return match;
          const altText = /aria-label=["']([^"']+)["']/i.exec(open)?.[1] || "Brand logo";
          const logoTag = `<img class="brand-logo" src="${safeUrl(logoUrl)}" alt="${escapeHtml(altText)}" loading="eager">`;
          return `${open}${logoTag}${inner}${close}`;
        },
      );
    }
    // When logo image exists, mark its text-sibling spans for hiding via CSS.
    // The CSS in cf-readability-style already hides them with :has(img) selectors.
    // Belt-and-suspenders: also add data-logo-text attr so they can be targeted precisely.
    out = out.replace(
      /(<(?:a|div)[^>]*class=["'][^"']*brand-mark[^"']*["'][^>]*>)([\s\S]*?)(<\/(?:a|div)>)/gi,
      (match, open, inner, close) => {
        // If the brand-mark already contains a logo img, hide any text spans inside it
        if (/<img[^>]*brand-logo/i.test(inner)) {
          return open + inner.replace(
            /(<span(?:[^>]*)>)((?!<img)[^<]*?)(<\/span>)/gi,
            (m: string, _so: string, text: string, sc: string) => text.trim() ? `<span style="display:none">${text}${sc}` : m,
          ) + close;
        }
        return match;
      },
    );
  } else {
    // No logo provided by user — remove brand-logo img entirely so text fallback renders
    out = out.replace(
      /<img[^>]*class=["'][^"']*brand-logo[^"']*["'][^>]*>/gi,
      "",
    );
  }

  // -- 2.5. Force-use uploaded images -----------------------------------
  // Uploaded assets listed in mustUseUrls must appear in final HTML at least once.
  const requiredUrls = Array.from(new Set(mustUseUrls.map((u) => String(u || "").trim()).filter(Boolean)));
  if (requiredUrls.length > 0) {
    const requiredWithoutLogo = requiredUrls.filter((u) => u !== logoUrl);
    for (const requiredUrl of requiredWithoutLogo) {
      if (out.includes(requiredUrl)) continue;

      // First, try to replace any existing non-logo image source so usage is visible.
      let replaced = false;
      out = out.replace(/<img\b[^>]*>/gi, (imgTag) => {
        if (replaced) return imgTag;
        if (/brand-logo/i.test(imgTag)) return imgTag;
        if (!/\bsrc=["'][^"']+["']/i.test(imgTag)) return imgTag;
        replaced = true;
        return setOrReplaceAttribute(imgTag, "src", requiredUrl);
      });

      // If no image tags were available, inject a visible image block near the end of main content.
      if (!replaced) {
        const forcedBlock = `\n<section class="cf-forced-image" aria-label="Visual asset">\n  <img src="${safeUrl(requiredUrl)}" alt="Brand visual" loading="lazy">\n</section>\n`;
        out = injectBeforeClosingTag(out, "main", forcedBlock);
      }
    }
  }

  // -- 2. Fix image repetition: each URL may appear at most once ----------
  // Collect all candidate URLs to deduplicate (hero + sections, non-empty)
  const tracked = [heroUrl, ...sectionUrls].filter(Boolean);
  const seenUrls = new Set<string>();

  for (const url of tracked) {
    if (!url || seenUrls.has(url)) continue;
    const isVeryLongUrl = url.length > 600;
    let shouldUseStringFallback = isVeryLongUrl;
    // Count occurrences in src= and url(...) attributes
    const escapedUrl = url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Try building a regex safely; very long data URLs or unusual chars can cause RegExp construction to fail.
    // For very long URLs, skip regex entirely and use the string-search fallback path.
    if (!isVeryLongUrl) {
      try {
        const occurrencePattern = new RegExp(
          `(src=["']${escapedUrl}["']|url\\(["']?${escapedUrl}["']?\\))`,
          "g",
        );
        const matches = out.match(occurrencePattern);
        if (matches && matches.length > 1) {
          // Keep the first occurrence; blank subsequent ones
          let firstFound = false;
          out = out.replace(occurrencePattern, (m) => {
            if (!firstFound) { firstFound = true; return m; }
            // Hide duplicate image tag rather than blanking src (blank src causes broken image icons)
            if (m.startsWith("src=")) return `src="" style="display:none"`;
            return `url('')`;
          });
        }
      } catch (_e) {
        shouldUseStringFallback = true;
      }
    }

    if (shouldUseStringFallback) {
      // Fallback: avoid regex for pathological URLs (data URLs). Use simple string search/replace for duplicates.
      let firstFound = false;

      // replace src="..." and src='...'
      const replaceSrcOccurrences = (quote: string) => {
        const needle = `src=${quote}${url}${quote}`;
        let idx = out.indexOf(needle);
        while (idx !== -1) {
          if (!firstFound) { firstFound = true; idx = out.indexOf(needle, idx + needle.length); continue; }
          out = out.slice(0, idx) + `src=${quote}${''}${quote} style="display:none"` + out.slice(idx + needle.length);
          idx = out.indexOf(needle, idx + 1);
        }
      };

      replaceSrcOccurrences('"');
      replaceSrcOccurrences("'");

      // replace url('...'), url("..."), url(...)
      const urlForms = [`url('${url}')`, `url("${url}")`, `url(${url})`];
      for (const form of urlForms) {
        let idx = out.indexOf(form);
        while (idx !== -1) {
          if (!firstFound) { firstFound = true; idx = out.indexOf(form, idx + form.length); continue; }
          out = out.slice(0, idx) + `url('')` + out.slice(idx + form.length);
          idx = out.indexOf(form, idx + 1);
        }
      }
    }
    seenUrls.add(url);
  }

  return out;
}

/**
 * Replaces <!-- INJECT_EMBED_N --> placeholders with the real embed code from the
 * corresponding embed-kind contract section. If a placeholder is not found in the
 * AI-generated HTML, the section is force-injected before </footer> or </body> to
 * guarantee the form always appears on the page.
 */
function injectEmbeddedForms(html: string, contractSections: Array<{ name: string; kind: string; required?: boolean; embedCode?: string }>): string {
  const embedEntries = contractSections
    .filter((s) => s.kind === "embed" && s.embedCode && s.embedCode.trim())
    .map((s, idx) => ({ idx, name: s.name, code: s.embedCode!.trim() }));

  if (embedEntries.length === 0) return html;

  let out = html;

  for (const entry of embedEntries) {
    const placeholder = `<!-- INJECT_EMBED_${entry.idx} -->`;
    // Sanitize embed: strip inline scripts (keep external src= scripts like Typeform/Calendly/HubSpot)
    const safeCode = entry.code
      .replace(/<script\b(?![^>]*\bsrc\s*=)[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/javascript:/gi, "");

    if (out.includes(placeholder)) {
      // AI placed the placeholder — replace it in-place
      out = out.split(placeholder).join(`<div class="cf-embed-form-wrapper" style="width:100%;overflow-x:auto;">${safeCode}</div>`);
    } else {
      // AI missed the placeholder — force-inject a complete section before </footer> or </body>
      const sectionName = entry.name || "Formulário";
      const sectionHtml = `
<section id="section-embed-${entry.idx}" class="py-16 bg-white" data-cf-embed-form="${entry.idx}">
  <div class="max-w-3xl mx-auto px-6 text-center">
    <h2 class="text-2xl font-bold mb-4">${sectionName}</h2>
    <p class="text-gray-600 mb-8">Preencha o formulário abaixo e entraremos em contato.</p>
    <div class="cf-embed-form-wrapper" style="width:100%;overflow-x:auto;">${safeCode}</div>
  </div>
</section>`;
      const footerIdx = out.lastIndexOf("</footer>");
      if (footerIdx !== -1) {
        out = out.slice(0, footerIdx) + sectionHtml + "\n" + out.slice(footerIdx);
      } else {
        out = out.replace(/<\/body>/i, sectionHtml + "\n</body>");
      }
    }
  }

  return out;
}

function enforceReadableTextAndHeader(html: string, primaryColor = "#2563eb") {
  let out = html;

  // Prevent common invisible text patterns from AI output.
  out = out
    .replace(/-webkit-text-fill-color\s*:\s*transparent\s*;?/gi, "-webkit-text-fill-color: currentColor;")
    .replace(/\bcolor\s*:\s*transparent\s*;?/gi, "color: currentColor;");

  const readabilityStyle = `
  <style id="cf-readability-style">
    :root { --cf-primary: ${escapeHtml(primaryColor || "#2563eb")}; }
    body { color: #0f172a; }
    h1,h2,h3,h4,h5,h6,p,li,span,small,strong,em,a,button,label,dt,dd { color: inherit; }
    [style*="-webkit-text-fill-color: transparent"],
    [style*="color: transparent"] {
      -webkit-text-fill-color: currentColor !important;
      color: currentColor !important;
    }
    /* If animations/scripts fail, text should still be visible */
    [data-animate], [data-reveal] {
      opacity: 1 !important;
      transform: none !important;
    }
    /* Logo/text mutual exclusivity: hide text when logo image is present */
    nav img.brand-logo ~ span,
    nav img.brand-logo ~ a:not([href="#"]):not([href="#top"]):not([href]),
    .brand-mark img.brand-logo ~ span,
    .brand-mark img.brand-logo ~ a:not([href="#"]):not([href="#top"]):not([href]),
    header img ~ span.brand-name,
    header img ~ span.site-name,
    a.brand-mark:has(img) span,
    a.brand-mark:has(img) div:not(:has(img)) { display: none !important; }
    /* Hero heading size cap — prevent AI from using oversized headings */
    #hero h1, [id*="hero"] h1, section.hero h1, header h1,
    .hero-copy h1, .hero-content h1, .hero-section h1 {
      font-size: clamp(1.8rem, 4vw, 3.2rem) !important;
      line-height: 1.1 !important;
    }
    #hero p, [id*="hero"] p.subtitle, [id*="hero"] p.subheadline,
    .hero-copy p, .hero-content p, .hero-subtitle, .hero-subheadline {
      font-size: clamp(0.95rem, 1.5vw, 1.15rem) !important;
      line-height: 1.6 !important;
    }
    .cf-force-primary-header {
      background: var(--cf-primary) !important;
      border-bottom-color: transparent !important;
      box-shadow: 0 10px 28px rgba(0,0,0,0.18) !important;
      backdrop-filter: none !important;
      -webkit-backdrop-filter: none !important;
    }
    .cf-force-primary-header,
    .cf-force-primary-header a,
    .cf-force-primary-header button,
    .cf-force-primary-header .brand-mark,
    .cf-force-primary-header .top-nav,
    .cf-force-primary-header .nav-cta,
    .cf-force-primary-header .nav-mobile-toggle {
      color: #fff !important;
      fill: #fff !important;
    }
  </style>`;

  if (!/cf-readability-style/i.test(out)) {
    out = injectBeforeClosingTag(out, "head", readabilityStyle);
  }

  const headerReadabilityScript = `
  <script id="cf-header-readability-script">
    (function() {
      const run = () => {
        const header = document.querySelector('.site-header') || document.querySelector('header') || document.querySelector('nav');
        if (!header) return;

        const logo = document.querySelector('.brand-logo')
          || document.querySelector('.brand-mark img')
          || document.querySelector('img[alt*="logo" i]')
          || document.querySelector('header img')
          || document.querySelector('nav img');

        if (!logo) return;

        const forcePrimary = () => header.classList.add('cf-force-primary-header');

        const src = String(logo.getAttribute('src') || '').toLowerCase();
        if (/white|branca|branco|light|clara/.test(src)) {
          forcePrimary();
          return;
        }

        const detectBrightness = () => {
          try {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            if (!ctx) return;
            const w = 32, h = 32;
            canvas.width = w;
            canvas.height = h;
            ctx.drawImage(logo, 0, 0, w, h);
            const data = ctx.getImageData(0, 0, w, h).data;
            let total = 0;
            let count = 0;
            for (let i = 0; i < data.length; i += 4) {
              const alpha = data[i + 3];
              if (alpha < 16) continue;
              const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
              total += lum;
              count++;
            }
            if (!count) return;
            const avg = total / count;
            if (avg >= 212) {
              forcePrimary();
            }
          } catch (_) {
            // Cross-origin canvas restrictions can happen; keep heuristic-only path.
          }
        };

        if (logo.complete) {
          detectBrightness();
        } else {
          logo.addEventListener('load', detectBrightness, { once: true });
        }
      };

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', run, { once: true });
      } else {
        run();
      }
    })();
  </script>`;

  if (!/cf-header-readability-script/i.test(out)) {
    out = injectBeforeClosingTag(out, "body", headerReadabilityScript);
  }

  return out;
}

function escapeRegExp(value: string) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizePlainText(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function tokenizeContext(value: string) {
  const stop = new Set(["de","da","do","das","dos","the","and","for","com","para","button","botao","cta","link","no","na","em","section","secao","area","bloco","um","uma","download","arquivo","file","pdf","doc","planilha"]);
  return normalizePlainText(value)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !stop.has(t));
}

function humanizeFileName(fileName: string) {
  return String(fileName || "")
    .replace(/\.[^/.]+$/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function deriveDownloadLabel(file: { name?: string; label?: string; context?: string; mime?: string }) {
  const explicitLabel = String(file.label || "").trim();
  if (explicitLabel) return explicitLabel;

  const context = String(file.context || "").trim();
  const fileName = humanizeFileName(String(file.name || "").trim());
  const lowerContext = normalizePlainText(context);
  const fileDescriptor = fileName || "document";

  if (/catalog|catalogo/.test(lowerContext)) return `Download ${fileDescriptor}`;
  if (/pricing|preco|price|planos|proposal|proposta|quote|orcamento/.test(lowerContext)) return `View ${fileDescriptor}`;
  if (/presentation|apresentacao|deck|company/.test(lowerContext)) return `Open ${fileDescriptor}`;
  if (/brochure|folder|guide|guia|manual/.test(lowerContext)) return `Download ${fileDescriptor}`;
  if (/case study|portfolio|portifolio/.test(lowerContext)) return `View ${fileDescriptor}`;
  if (/menu/.test(lowerContext)) return `View ${fileDescriptor}`;

  return fileDescriptor ? `Download ${fileDescriptor}` : "Download file";
}

function scoreByTokens(haystack: string, tokens: string[]) {
  if (tokens.length === 0) return 0;
  const normalized = normalizePlainText(haystack);
  let score = 0;
  for (const token of tokens) {
    if (normalized.includes(token)) score++;
  }
  return score;
}

function applyContextualDownloadLinks(
  html: string,
  downloadFiles: Array<{ name?: string; label?: string; context?: string; url: string; mime?: string }> = [],
) {
  let out = html;
  const files = (downloadFiles || [])
    .map((f) => ({
      name: String(f.name || "").trim(),
      label: String(f.label || "").trim(),
      context: String(f.context || "").trim(),
      url: String(f.url || "").trim(),
      mime: String(f.mime || "").trim(),
    }))
    .filter((f) => f.url && f.context);

  if (files.length === 0) return out;

  const sectionRegex = /<section\b[\s\S]*?<\/section>/gi;

  for (const file of files) {
    if (isDownloadFileLinked(out, file.url)) continue;
    const tokens = tokenizeContext(file.context);
    if (tokens.length === 0) continue;

    // 1) Try to replace the most relevant existing anchor href.
    const anchorRegex = /<a\b[^>]*href\s*=\s*(["'])([^"']*)\1[^>]*>[\s\S]*?<\/a>/gi;
    let bestAnchor: { start: number; end: number; text: string; score: number } | null = null;
    let anchorMatch: RegExpExecArray | null;
    while ((anchorMatch = anchorRegex.exec(out)) !== null) {
      const full = anchorMatch[0];
      const href = String(anchorMatch[2] || "").trim();
      const candidateText = full.replace(/<[^>]+>/g, " ");
      const ariaLabel = /aria-label\s*=\s*(["'])(.*?)\1/i.exec(full)?.[2] || "";
      const titleAttr = /title\s*=\s*(["'])(.*?)\1/i.exec(full)?.[2] || "";
      const localScore = scoreByTokens(`${candidateText} ${ariaLabel} ${titleAttr}`, tokens);
      const isActionTarget = href === "#" || href.startsWith("#") || /^javascript:/i.test(href) || href === "";
      const score = localScore + (isActionTarget ? 1 : 0);
      if (score > 0 && (!bestAnchor || score > bestAnchor.score)) {
        bestAnchor = {
          start: anchorMatch.index,
          end: anchorMatch.index + full.length,
          text: full,
          score,
        };
      }
    }

    if (bestAnchor) {
      const newAnchor = bestAnchor.text
        .replace(/href\s*=\s*(["'])[^"']*\1/i, `href=\"${safeUrl(file.url)}\"`)
        .replace(/<a\b/i, `<a download${file.mime ? ` type=\"${escapeHtml(file.mime)}\"` : ""}`);
      out = out.slice(0, bestAnchor.start) + newAnchor + out.slice(bestAnchor.end);
      continue;
    }

    // 2) Insert contextual download link in the best matching section.
    let bestSection: { start: number; end: number; text: string; score: number } | null = null;
    let sectionMatch: RegExpExecArray | null;
    sectionRegex.lastIndex = 0; // reset after anchor search modified the string
    while ((sectionMatch = sectionRegex.exec(out)) !== null) {
      const full = sectionMatch[0];
      const sectionHeading = (full.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i)?.[1] || "").replace(/<[^>]+>/g, " ");
      const attrs = (full.match(/^<section\b([^>]*)>/i)?.[1] || "").replace(/<[^>]+>/g, " ");
      const plain = full.replace(/<[^>]+>/g, " ");
      const weightedSectionText = `${sectionHeading} ${sectionHeading} ${attrs} ${plain}`;
      const score = scoreByTokens(weightedSectionText, tokens);
      if (score > 0 && (!bestSection || score > bestSection.score)) {
        bestSection = {
          start: sectionMatch.index,
          end: sectionMatch.index + full.length,
          text: full,
          score,
        };
      }
    }

    if (bestSection) {
      const fallbackLabel = deriveDownloadLabel(file);
      const contextLink = `<a class="cf-context-download-btn" href="${safeUrl(file.url)}" download${file.mime ? ` type="${escapeHtml(file.mime)}"` : ""}>⬇ ${escapeHtml(fallbackLabel)}</a>`;
      const injectedSection = bestSection.text.replace(/<\/section>$/i, `<div class="cf-context-download">${contextLink}</div></section>`);
      out = out.slice(0, bestSection.start) + injectedSection + out.slice(bestSection.end);
      continue;
    }
  }

  // Ensure style for contextual links exists when used.
  if (/cf-context-download-btn/i.test(out) && !/cf-context-download-style/i.test(out)) {
    const style = `
  <style id=\"cf-context-download-style\">
    .cf-context-download{margin-top:16px;display:flex;flex-wrap:wrap;gap:10px;}
    .cf-context-download-btn{display:inline-flex;align-items:center;gap:8px;padding:10px 14px;border-radius:999px;background:#111827;color:#fff;font-weight:600;text-decoration:none;}
  </style>`;
    out = injectBeforeClosingTag(out, "head", style);
  }

  return out;
}

function isDownloadFileLinked(html: string, fileUrl: string) {
  if (!fileUrl) return false;
  if (html.includes(fileUrl)) return true;

  try {
    const parsed = new URL(fileUrl, "https://example.local");
    const fileName = decodeURIComponent((parsed.pathname.split("/").pop() || "").trim());
    if (!fileName) return false;
    const encoded = escapeRegExp(encodeURIComponent(fileName));
    const decoded = escapeRegExp(fileName);
    const relPattern = new RegExp(`(?:^|["'()\\s])(?:\\.?/)?files/(?:${encoded}|${decoded})(?:$|["'()\\s])`, "i");
    return relPattern.test(html);
  } catch {
    return false;
  }
}

function enforceDownloadButtons(html: string, downloadFiles: Array<{ name?: string; label?: string; context?: string; url: string; mime?: string }> = []) {
  const files = (downloadFiles || [])
    .filter((f) => typeof f?.url === "string")
    .map((f) => ({
      label: deriveDownloadLabel(f),
      url: String(f.url || "").trim(),
      mime: String(f.mime || "").trim(),
    }))
    .filter((f) => f.label && f.url);

  if (files.length === 0) return html;

  const missingFiles = files.filter((f) => !isDownloadFileLinked(html, f.url));
  if (missingFiles.length === 0) return html;

  const buttons = missingFiles
    .map((f) => `<a class="cf-download-btn" href="${safeUrl(f.url)}" download${f.mime ? ` type="${escapeHtml(f.mime)}"` : ""}>⬇ ${escapeHtml(f.label)}</a>`)
    .join("");

  const sectionHtml = `
  <section class="cf-download-section" id="downloads">
    <div class="cf-download-shell">
      <h2>Downloads</h2>
      <div class="cf-download-list">${buttons}</div>
    </div>
  </section>`;

  const styleHtml = `
  <style id="cf-download-style">
    .cf-download-section{padding:48px 20px;background:linear-gradient(180deg,rgba(15,23,42,.04),rgba(15,23,42,.01));}
    .cf-download-shell{max-width:980px;margin:0 auto;}
    .cf-download-shell h2{margin:0 0 16px;font-size:clamp(1.4rem,2.8vw,2rem);}
    .cf-download-list{display:flex;flex-wrap:wrap;gap:12px;}
    .cf-download-btn{display:inline-flex;align-items:center;gap:8px;padding:12px 16px;border-radius:999px;background:#111827;color:#fff;font-weight:600;text-decoration:none;}
  </style>`;

  let out = html;
  if (!/cf-download-style/i.test(out)) {
    out = injectBeforeClosingTag(out, "head", styleHtml);
  }
  if (/<\/main>/i.test(out)) {
    out = out.replace(/<\/main>/i, `${sectionHtml}\n</main>`);
  } else {
    out = injectBeforeClosingTag(out, "body", sectionHtml);
  }
  return out;
}

function normalizeAccountType(value: unknown) {
  return value === "admin" ? "admin" : "testing";
}

function getSiteGenerationModels(accountType: unknown, compact: boolean) {
  const normalized = normalizeAccountType(accountType);
  // Testing (free key): prefer lower-cost models first.
  if (normalized === "testing") {
    return TESTING_SITE_MODELS;
  }
  // Admin (billing key): stable model chain with availability fallback.
  return SITE_GENERATION_MODELS;
}

function getGeminiApiKeysForAccountType(accountType: unknown) {
  const env = (globalThis as any).Deno?.env;
  const productionKey = env?.get("GEMINI_API_KEY_PRODUCTION") || env?.get("GEMINI_API_KEY");
  const testingKey = env?.get("GEMINI_API_KEY_TESTING");

  if (normalizeAccountType(accountType) === "admin") {
    const keys = [productionKey, testingKey].filter((k): k is string => Boolean(k));
    if (!keys.length) throw new Error("GEMINI_API_KEY_PRODUCTION/GEMINI_API_KEY_TESTING are not configured");
    return keys;
  }

  const keys = [testingKey, productionKey].filter((k): k is string => Boolean(k));
  if (!keys.length) throw new Error("GEMINI_API_KEY_TESTING/GEMINI_API_KEY_PRODUCTION are not configured");
  return keys;
}

// Schema for direct HTML/CSS/JS generation � AI returns complete site files.
// AI returns a single complete self-contained HTML document (inline <style> + <script>).
const DIRECT_HTML_SCHEMA = {
  type: "object",
  properties: {
    html: { type: "string" },
    slug: { type: "string" },
  },
  required: ["html", "slug"],
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { prompt, businessName, customSlug, userId, accountType, mandatorySections, formData } = await req.json();

    const contractSections: ContractSection[] = Array.isArray(mandatorySections)
      ? (mandatorySections as any[])
          .filter((s) => s && typeof s.kind === "string" && s.kind.trim().length > 0)
          .map((s) => ({
            name: typeof s.name === "string" ? s.name.trim() : "",
            kind: s.kind.trim(),
            required: Boolean(s.required),
            description: typeof s.description === "string" ? s.description.trim() : "",
            embedCode: typeof s.embedCode === "string" ? s.embedCode.trim() : "",
            formAction: typeof s.formAction === "string" ? s.formAction.trim() : undefined,
            formButton: typeof s.formButton === "string" ? s.formButton.trim() : undefined,
            formFields: Array.isArray(s.formFields)
              ? (s.formFields as any[]).map((f) => ({
                  label: String(f.label || ""),
                  type: String(f.type || "text"),
                  placeholder: typeof f.placeholder === "string" ? f.placeholder : undefined,
                  required: Boolean(f.required),
                }))
              : undefined,
          }))
      : [];
    const hasContract = contractSections.length > 0;

    // Parse structured form data snapshot � injected as a structured context block before the prompt.
    const formDataSnapshot: FormDataSnapshot | null = (() => {
      if (!formData || typeof formData !== "object") return null;
      try {
        return {
          landingPreset: String(formData.landingPreset || "general"),
          generationObjective: String(formData.generationObjective || ""),
          sessionsObjectiveContext: String(formData.sessionsObjectiveContext || ""),
          theme: {
            style: String(formData.theme?.style || "modern"),
            primary: String(formData.theme?.primary || "#2563eb"),
            secondary: String(formData.theme?.secondary || "#0f172a"),
            accent: String(formData.theme?.accent || "#f59e0b"),
            background: String(formData.theme?.background || "#f8fafc"),
            text: String(formData.theme?.text || "#0f172a"),
            headingFont: String(formData.theme?.headingFont || "Inter"),
            bodyFont: String(formData.theme?.bodyFont || "Inter"),
          },
          images: {
            logo: String(formData.images?.logo || ""),
            hero: String(formData.images?.hero || ""),
            sections: Array.isArray(formData.images?.sections)
              ? (formData.images.sections as unknown[]).map(String)
              : [],
            about: String(formData.images?.about || ""),
            team: String(formData.images?.team || ""),
            products: Array.isArray(formData.images?.products)
              ? (formData.images.products as unknown[]).map(String).filter(Boolean)
              : [],
          },
          services: Array.isArray(formData.services)
            ? (formData.services as unknown[]).map(String).filter(Boolean)
            : [],
          differentiators: Array.isArray(formData.differentiators)
            ? (formData.differentiators as unknown[]).map(String).filter(Boolean)
            : [],
          contact: {
            email: String(formData.contact?.email || ""),
            phone: String(formData.contact?.phone || ""),
            whatsapp: String(formData.contact?.whatsapp || ""),
          },
          location: {
            city: String(formData.location?.city || ""),
            country: String(formData.location?.country || ""),
          },
          imageContexts: {
            heroImage1: String(formData.imageContexts?.heroImage1 || ""),
            heroImage2: String(formData.imageContexts?.heroImage2 || ""),
            sectionImage1: String(formData.imageContexts?.sectionImage1 || ""),
            sectionImage2: String(formData.imageContexts?.sectionImage2 || ""),
            sectionImage3: String(formData.imageContexts?.sectionImage3 || ""),
            aboutImage: String(formData.imageContexts?.aboutImage || ""),
            teamImage: String(formData.imageContexts?.teamImage || ""),
            brandImage: String(formData.imageContexts?.brandImage || ""),
          },
          language: String(formData.language || "en"),
          conversionGoal: String(formData.conversionGoal || "lead-generation"),
          guarantee: String(formData.guarantee || ""),
          urgencyLevel: String(formData.urgencyLevel || "medium"),
          countdownTimer: Boolean(formData.countdownTimer),
          brandPersonality: String(formData.brandPersonality || "professional"),
          toneOfVoice: String(formData.toneOfVoice || "conversational"),
          useCarousel: false,
          useAiImages: Boolean(formData.useAiImages),
          socialLinks: {
            facebook: String(formData.socialLinks?.facebook || ""),
            instagram: String(formData.socialLinks?.instagram || ""),
            twitter: String(formData.socialLinks?.twitter || ""),
            linkedin: String(formData.socialLinks?.linkedin || ""),
            youtube: String(formData.socialLinks?.youtube || ""),
          },
          socialProofConfig: {
            socialProof: Boolean(formData.socialProofConfig?.socialProof ?? true),
            testimonials: Boolean(formData.socialProofConfig?.testimonials ?? true),
            trustBadges: Boolean(formData.socialProofConfig?.trustBadges ?? true),
          },
          imagePolicy: {
            forceUseUploaded: Boolean(formData.imagePolicy?.forceUseUploaded),
            mustUse: Array.isArray(formData.imagePolicy?.mustUse)
              ? (formData.imagePolicy.mustUse as unknown[]).map(String).filter(Boolean)
              : [],
          },
          sourceWebsite: String(formData.sourceWebsite || ""),
          designNotes: String(formData.designNotes || ""),
          downloadFiles: Array.isArray(formData.downloadFiles)
            ? (formData.downloadFiles as any[]).map((f) => ({
                name: String(f.name || ""),
                label: String(f.label || ""),
              context: String(f.context || ""),
                url: String(f.url || ""),
                mime: String(f.mime || ""),
              }))
            : [],
        };
      } catch {
        return null;
      }
    })();

    if (!prompt || typeof prompt !== "string" || prompt.length < 50) {
      return new Response(JSON.stringify({ error: "Invalid prompt provided." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const GEMINI_API_KEYS = getGeminiApiKeysForAccountType(accountType);
    const isTesting = normalizeAccountType(accountType) === "testing";
    const { text: safePrompt, truncated: wasPromptTruncated } = clampPromptSize(prompt, accountType);

    // Carousel generation has been disabled for runtime stability.
    const preBuiltCarouselImages: string[] = [];

    // Build structured context block injected before the business brief
    // Map of synthetic HTTPS marker → real URI (substituted in prompt context)
    // to avoid prompt bloat for very long URLs/data URIs and then reinjected after AI generation.
    const dataUriMarkerMap = new Map<string, string>();
    let dataUriMarkerCount = 0;

    const shouldAliasImageRefInPrompt = (uri: string) => {
      const value = String(uri || '').trim();
      if (!value) return false;
      if (/^data:image\//i.test(value)) return true;
      // Pollinations URLs encode the whole prompt in path and can get very long.
      if (/image\.pollinations\.ai\/prompt\//i.test(value)) return true;
      // Generic safeguard for large image URLs that inflate prompt/token usage.
      return value.length > 220;
    };

    const inferImageExtFromUri = (uri: string) => {
      const value = String(uri || '').toLowerCase();
      if (value.includes('.png')) return 'png';
      if (value.includes('.webp')) return 'webp';
      if (value.includes('.gif')) return 'gif';
      if (value.includes('.svg')) return 'svg';
      if (value.includes('.avif')) return 'avif';
      return 'jpg';
    };

    const imgRef = (uri: string, slot: string): string => {
      if (!uri) return "";
      if (shouldAliasImageRefInPrompt(uri)) {
        const marker = `https://img.chiliforge.io/${slot}-${++dataUriMarkerCount}.${inferImageExtFromUri(uri)}`;
        dataUriMarkerMap.set(marker, uri);
        return marker;
      }
      return uri;
    };

    const pexelsApiKey = String((globalThis as any).Deno?.env?.get("PEXELS_API_KEY") || "").trim();
    const heroFallbackFromPexels = (() => {
      if (!formDataSnapshot || !pexelsApiKey) return Promise.resolve("");
      if ((formDataSnapshot.images?.hero || "").trim()) return Promise.resolve("");
      const industry = String(formDataSnapshot.landingPreset || "business").replace(/[-_]/g, " ");
      const service = String(formDataSnapshot.services?.[0] || "").trim();
      const service2 = String(formDataSnapshot.services?.[1] || "").trim();
      const category = String((formDataSnapshot as any).businessCategory || "").trim();
      const queryStem = [businessName, category || industry, service].filter(Boolean).join(" ").trim() || "business";
      const queryStem2 = [industry, service2 || service].filter(Boolean).join(" ").trim() || "professional";
      return pickUniquePexelsPhoto([
        `${queryStem} professional wide banner`,
        `${queryStem2} business team office landscape`,
        `${industry} professional modern workspace`,
        "business professional modern office banner",
      ], pexelsApiKey, new Set<string>(), "landscape");
    })();

    // Fetch Pexels fallback images for section slots the user left empty.
    // We target up to 4 extra landscape images so sections always have visuals.
    const sectionFallbacksFromPexels = (() => {
      if (!formDataSnapshot || !pexelsApiKey) return Promise.resolve([] as string[]);
      const existingCount = (formDataSnapshot.images?.sections || []).filter(Boolean).length;
      const needed = Math.max(0, 4 - existingCount);
      if (needed === 0) return Promise.resolve([] as string[]);
      const industry = String(formDataSnapshot.landingPreset || "business").replace(/[-_]/g, " ");
      const service = String(formDataSnapshot.services?.[0] || "").trim();
      const service2 = String(formDataSnapshot.services?.[1] || "").trim();
      const category = String((formDataSnapshot as any).businessCategory || "").trim();
      const usedIds = new Set<string>();
      const queries = [
        `${[category || industry, service].filter(Boolean).join(" ")} professional`,
        `${[industry, service2 || service].filter(Boolean).join(" ")} modern`,
        `${industry} team workspace`,
        `${service || industry} business landscape`,
      ];
      return Promise.all(
        Array.from({ length: needed }, (_, i) =>
          pickUniquePexelsPhoto([queries[i % queries.length]], pexelsApiKey, usedIds, "landscape")
        )
      ).then((urls) => urls.filter(Boolean) as string[]);
    })();

    const buildContextBlock = (heroFallbackUrl: string, sectionFallbackUrls: string[]): string => {
      if (!formDataSnapshot) return "";
      const f = formDataSnapshot;
      const lines: string[] = ["=== DESIGN TOKENS ==="];
      lines.push(`Visual style: ${f.theme.style}`);
      lines.push(`Primary: ${f.theme.primary} | Secondary: ${f.theme.secondary} | Accent: ${f.theme.accent}`);
      lines.push(`Background: ${f.theme.background} | Text: ${f.theme.text}`);
      lines.push(`Heading font: ${f.theme.headingFont} | Body font: ${f.theme.bodyFont}`);

      // Per-style design DNA — gives AI concrete visual rules for each style
      const styleDNA: Record<string, string> = {
        modern: `STYLE=modern: Clean, professional, conversion-focused. White/light-grey sections alternating with one dark section. Cards with subtle shadow (shadow-md) and rounded-2xl. Hero: centered headline with gradient text + solid CTA button. Typography: large bold h1 (text-5xl lg:text-7xl font-extrabold), h2 text-3xl font-bold. Spacing: generous (py-20 lg:py-32). Animations: fadeInUp with stagger on feature cards. Accent used for CTA buttons and highlighted spans. Section dividers: none (use background color alternation). Nav: white bg with accent CTA button.`,
        editorial: `STYLE=editorial: Magazine-like, typographic, story-driven. Use large display serif (CSS font-size: clamp(3rem,8vw,7rem)) for h1 with tight tracking (letter-spacing:-0.04em). Sections split into asymmetric 2-col grids: text left, image right (alternate per section). Color palette: mostly off-white/cream (#fafaf7) + near-black (#111) + single accent. NO card boxes — use open typographic layouts. Hero: full-bleed image, bold white H1 overlaid. Features listed with large numbers (01, 02, 03) as decorative labels. Animations: fade-in + slide from side (translateX -60px → 0). Dividers: thin 1px lines, no drop shadows.`,
        bold: `STYLE=bold: High contrast, statement-making, assertive. Dark backgrounds (#0a0a0a or #0f172a) with vivid accent highlights. Hero: full-bleed dark with hero image, huge H1 in all-caps or extra-bold (tracking-tight text-6xl lg:text-8xl). CTA buttons: large pill, accent color bg-accent text-black font-black. Section headers: oversized, accent color underline or text-accent. Cards: dark surface (#1a1a2e or surface) with left accent border (border-l-4 border-accent). Animations: bold scale-in (scale 0.85→1) + fast fadeIn (300ms). Use high-contrast white text on dark for all sections. Dividers: thick 2px accent lines or bg gradients. Typography: tight tracking, extra-bold weights throughout.`,
        premium: `STYLE=premium: Luxury, refined, sophisticated. Backgrounds: deep navy (#0a1628) or charcoal (#141414) with gold/warm accent. Glassmorphism cards: backdrop-blur-md bg-white/5 border border-white/10 rounded-2xl. Hero: dark cinematic with subtle grain texture (CSS noise filter or SVG noise), headline in thin weight serif or light sans + gold accent. Typography: elegant, mixed-weight (h1 font-thin text-7xl + bold accent word). Spacing: ultra-generous (py-32 lg:py-40). Animations: slow elegant fade (duration-1000) + subtle parallax on hero image (JS: translate Y on scroll). Decorative: thin gold lines, minimal iconography. CTAs: outlined ghost style or gold filled. Section breaks: full-bleed dark image sections with overlay text.`,
        energetic: `STYLE=energetic: Dynamic, action-packed, sporty. Diagonal section dividers using CSS clip-path (clip-path: polygon(0 0, 100% 0, 100% 90%, 0 100%)). Hero: gradient background (from-primary to-secondary) with image, bold italic headline. Colors: vibrant primary with bright accent. Typography: condensed bold if available, otherwise font-extrabold font-condensed. Cards: bright colored icon backgrounds, hard drop shadows (shadow-xl). CTA buttons: rounded-full with animated pulse ring (before:absolute before:inset-0 before:rounded-full before:animate-ping). Animations: bounce-in icons, slide from sides on sections, quick 200ms transitions. Decorative: zigzag or wave SVG dividers between sections. Numbers/stats: large bold counter animations.`,
        minimal: `STYLE=minimal: Stripped-back, refined, whitespace-forward. Maximum whitespace (py-32 lg:py-48). Monochrome palette: near-white bg, very dark text, single accent. No card boxes — layout items using generous whitespace-separated rows. Hero: full white or off-white background, left-aligned headline, minimal copy. Typography: large h1 (text-6xl font-light tracking-wide) with one bold accent word. Buttons: rectangular border-only style (border-2 border-primary text-primary hover:bg-primary hover:text-white). Images: edge-to-edge or precise half-width columns, no decorative elements. Animations: slow fade only (duration-1000 ease-out), no motion for motion's sake. Icons: thin-line only (Font Awesome regular/thin). No gradients, no shadows, no decorative dividers.`,
      };
      const styleDNAEntry = styleDNA[f.theme.style] || styleDNA["modern"];
      lines.push(`\nDESIGN STYLE RULES (MANDATORY — implement exactly this visual language):\n${styleDNAEntry}`);
      lines.push("\n=== ASSETS & IMAGE CONTEXT ===");
     if (f.images.logo) {
       lines.push(`Logo [header/footer only]: ${imgRef(f.images.logo, "logo")}${(f.imageDimensions as any)?.logo ? ` [dims: ${(f.imageDimensions as any).logo}]` : ""}`);
     } else {
       lines.push(`Logo: NOT PROVIDED — use only the business name as text in the header/nav and footer. DO NOT use any image as a logo.`);
     }
     if (f.images.hero) {
       const heroDim = (f.imageDimensions as any)?.hero ? ` [dims: ${(f.imageDimensions as any).hero}]` : "";
       lines.push(`Hero image [hero section only]: ${imgRef(f.images.hero, "hero")}${heroDim}${f.imageContexts?.heroImage1 ? ` (Purpose: ${f.imageContexts.heroImage1})` : ""}`);
     }
     if (!f.images.hero && heroFallbackUrl) {
       lines.push(`Hero image [hero section only, Pexels fallback]: ${heroFallbackUrl}`);
     }
     const sectionImgs = f.images.sections.filter(Boolean);
     const allSectionImgs = [
       ...sectionImgs,
       ...sectionFallbackUrls.filter((u) => !sectionImgs.includes(u)),
     ];
     if (allSectionImgs.length > 0) {
       const sectionContexts = [f.imageContexts?.sectionImage1, f.imageContexts?.sectionImage2, f.imageContexts?.sectionImage3, f.imageContexts?.brandImage].filter(Boolean);
       const sectionDims = (f.imageDimensions as any)?.sections || [];
       lines.push(`Section images [content sections only — NOT hero, NOT logo]: ${allSectionImgs.map((u: string, i: number) => {
         const isUser = i < sectionImgs.length;
         const ctx = isUser && sectionContexts[i] ? ` (Purpose: ${sectionContexts[i]})` : (isUser ? "" : " (Pexels fallback)");
         const dim = isUser && sectionDims[i] ? ` [dims: ${sectionDims[i]}]` : "";
         return `${imgRef(u, `section-${i + 1}`)}${dim}${ctx}`;
       }).join(", ")}`);
     }
     if (f.images.about) {
       lines.push(`About image: ${imgRef(f.images.about, "about")}${f.imageContexts?.aboutImage ? ` (Purpose: ${f.imageContexts.aboutImage})` : ""}`);
     }
     if (f.images.team) {
       lines.push(`Team image: ${imgRef(f.images.team, "team")}${f.imageContexts?.teamImage ? ` (Purpose: ${f.imageContexts.teamImage})` : ""}`);
     }
     if (f.imagePolicy?.forceUseUploaded && (f.imagePolicy.mustUse || []).length > 0) {
       lines.push(`Uploaded MUST-USE images (do not drop or replace): ${(f.imagePolicy.mustUse || []).map((u, i) => `${i + 1}) ${imgRef(u, `must-use-${i + 1}`)}`).join(", ")}`);
     }
      lines.push("\n=== IMAGE ROLE RULES (CRITICAL — ENFORCED) ===");
      lines.push("IMAGE SLOT MAPPING (NON-NEGOTIABLE):");
      lines.push("- Logo [header/footer ONLY]: MUST be the exact URL provided above. If no logo URL is listed, use ONLY the business name as text — NEVER use any other image as a logo.");
      lines.push("- Hero [hero section background ONLY]: MUST be a landscape image (1920x1024+). NEVER reuse in sections. NEVER use as logo.");
      lines.push("- Section 1, 2, 3 [content sections ONLY]: Each image in its exact designated section. Do NOT reorder, duplicate, or move to other sections.");
      lines.push("- About [about/story section ONLY]: Use for company story or founder image — if it's a person photo, it's correct for 'about'. Otherwise use landscape.");
      lines.push("- Team [team/people section ONLY]: Professional headshots or team photos. NEVER use in logo or hero.");
      lines.push("CRITICAL RULES:");
      lines.push("LOGO: Use the logo URL ONLY in the header/nav <img> and the footer — NEVER as a section image, hero background, or content photo.");
      lines.push("HERO IMAGE: Use the hero image URL ONLY as the hero section's background-image or primary <img> — NEVER reuse it in cards, sections, or testimonials.");
      lines.push("SECTION IMAGES (section-1, section-2, ...): Place each in a distinct content section (benefits, services, story, about). Do NOT put them in the hero. Do NOT reuse the same URL twice.");
      lines.push("PERSON/PORTRAIT IMAGES: Those labeled 'about' or 'team' belong ONLY there. Hero and sections must be landscapes. Logo must NEVER be a person.");
      lines.push("GENERAL URL RULE: Use every provided image URL EXACTLY as-is. Do NOT substitute, invent, or replace URLs. Never use placehold.co, picsum.photos, unsplash.com, or any placeholder service.");
      lines.push("TESTIMONIAL AVATARS: testimonial/review customer photos must be real Pexels portrait URLs, matched to each testimonial's role. Do not reuse the same photo.");
      lines.push("HERO FALLBACK: When no hero image is provided, use the Pexels fallback URL from the assets block — do NOT invent or omit it.");
      // Inject download file hints so the AI places them contextually in the page
      const downloadFiles = (f as any).downloadFiles as Array<{ name?: string; label?: string; context?: string; url: string; mime?: string }> | undefined;
      if (Array.isArray(downloadFiles) && downloadFiles.length > 0) {
        const validFiles = downloadFiles.filter((df) => df.url);
        if (validFiles.length > 0) {
          lines.push("\n=== DOWNLOAD FILES (MANDATORY — place ALL of these in the page) ===");
          lines.push("RULE: Each download file below MUST appear in the page as a styled <a href='URL' download> button.");
          lines.push("RULE: Place each file near the section most relevant to its context description.");
          lines.push("RULE: Do NOT omit any file. This is non-negotiable.");
          validFiles.forEach((df, i) => {
            const label = df.label || df.name || `File ${i + 1}`;
            const ctx = df.context ? ` — Context: ${df.context}` : "";
            lines.push(`  ${i + 1}. "${label}" → URL: ${df.url}${ctx}`);
          });
        }
      }
     lines.push("\n=== LOCATION ===");
     if (f.location?.city || f.location?.country) {
       lines.push(`City/Country: ${[f.location?.city, f.location?.country].filter(Boolean).join(", ")}`);
     }
     lines.push("\n=== CONTACT & SOCIAL ===");
      if (f.contact.email) lines.push(`Email: ${f.contact.email}`);
      if (f.contact.phone) lines.push(`Phone: ${f.contact.phone}`);
      if (f.contact.whatsapp) lines.push(`WhatsApp: https://wa.me/${f.contact.whatsapp.replace(/\D/g, "")}`);
      const socials = Object.entries(f.socialLinks || {}).filter(([, v]) => v);
      if (socials.length > 0) lines.push(`Social: ${socials.map(([k, v]) => `${k}=${v}`).join(", ")}`);
      lines.push("\n=== BUSINESS DETAILS ===");
      if (f.generationObjective || f.sessionsObjectiveContext) {
        lines.push("\n=== USER OBJECTIVE CONTEXT (HIGH PRIORITY) ===");
        if (f.generationObjective) lines.push(`Step 2 mission / objective: ${f.generationObjective}`);
        if (f.sessionsObjectiveContext) lines.push(`Sessions step user descriptions: ${f.sessionsObjectiveContext}`);
        lines.push("RULE: Use this objective context as the narrative base of the page, but do NOT replace or ignore structured fields, section contract, services, differentiators, or contact data.");
      }
      if (f.services.length > 0) lines.push(`Services: ${f.services.join(", ")}`);
      if (f.differentiators.length > 0) lines.push(`Differentiators: ${f.differentiators.join(", ")}`);
      lines.push(`Conversion goal: ${f.conversionGoal} | Urgency: ${f.urgencyLevel}`);
      lines.push(`Brand personality: ${f.brandPersonality} | Tone: ${f.toneOfVoice}`);
      if (f.guarantee) lines.push(`Guarantee: ${f.guarantee}`);
      lines.push(`Language: ${f.language}`);
      lines.push(`AI image generation enabled: ${f.useAiImages ? "yes" : "no"}`);
      lines.push(f.useAiImages
        ? "IMAGE SOURCE POLICY: Use provided image URLs as primary visual assets. You may derive style-consistent compositions, but never ignore provided assets."
        : "IMAGE SOURCE POLICY: Do NOT generate new AI imagery. Use only provided image URLs from ASSETS and optional stock fallbacks.");
      if (f.countdownTimer) lines.push("Include countdown timer: yes");
      lines.push("Include image carousel: no");
      lines.push("\n=== SEO & CRO BASELINE (MANDATORY) ===");
      lines.push("SEO: include one clear <title>, meta description, canonical, Open Graph title/description, and JSON-LD LocalBusiness schema.");
      lines.push("SEO: use semantic landmarks (nav, header hero, main, section, footer), one H1 only, logical H2 hierarchy, and concise, benefit-first copy.");
      lines.push("CRO: above-the-fold must contain one dominant CTA + one trust signal + clear value proposition.");
      lines.push("CRO: repeat CTA near middle and final sections, include objection handling (FAQ/testimonials), and visible contact options.");
      lines.push("\n=== TRUST & SOCIAL PROOF ===");
      lines.push(`Social proof elements enabled: ${f.socialProofConfig?.socialProof ?? true ? "yes" : "no"}`);
      lines.push(`Testimonials section enabled: ${f.socialProofConfig?.testimonials ?? true ? "yes" : "no"}`);
      lines.push(`Trust badges enabled: ${f.socialProofConfig?.trustBadges ?? true ? "yes" : "no"}`);
      if (f.sourceWebsite) lines.push(`\n=== SOURCE WEBSITE REFERENCE ===\nSource: ${f.sourceWebsite}\nUse for visual/tonal inspiration only — do NOT clone copy or section order.`);
      if (f.designNotes) lines.push(`\n=== SCRAPER VISUAL DNA (HIGH PRIORITY) ===\n${f.designNotes}`);
      if (hasContract) {
        lines.push("\n=== SECTION CONTRACT (MANDATORY — follow exact order) ===");
        const embedSections: Array<{ index: number; name: string }> = [];
        contractSections.forEach((s: { name: string; kind: string; required?: boolean; description?: string; embedCode?: string }, i: number) => {
          if (s.kind === "embed" && s.embedCode) {
            embedSections.push({ index: embedSections.length, name: s.name });
            const embedIdx = embedSections.length - 1;
            lines.push(`${i + 1}. ${s.name} [kind: embed]${s.required ? " [REQUIRED]" : ""} — MANDATORY EMBEDDED FORM`);
            lines.push(`   → Write an <h2> heading and <p> intro paragraph for this section that encourages the user to fill in the form.`);
            lines.push(`   → Then insert EXACTLY this HTML comment on its own line: <!-- INJECT_EMBED_${embedIdx} -->`);
            lines.push(`   → DO NOT write any <form>, <iframe>, or <script> tags yourself. The comment will be replaced with the real embed code automatically.`);
          } else {
            lines.push(`${i + 1}. ${s.name} [kind: ${s.kind}]${s.required ? " [REQUIRED]" : ""}${s.description ? " — " + s.description : ""}`);
          }
        });
        if (embedSections.length > 0) {
          lines.push(`\nEMBED FORMS RULE: For each "MANDATORY EMBEDDED FORM" section above, you MUST output the <!-- INJECT_EMBED_N --> placeholder EXACTLY as shown. It will be replaced with the real form code post-generation. Missing this placeholder will cause the form to appear anyway but without the surrounding section layout you write.`);
        }
      }
      return lines.join("\n") + "\n\n=== BUSINESS BRIEF ===\n";
    };

    const adminSystemPrompt = `You are a world-class front-end developer and conversion designer. Generate a complete standalone landing page.

OUTPUT FORMAT (MANDATORY): Return ONLY the raw HTML document. Start with <!DOCTYPE html> and end with </html>. No markdown, no code fences, no JSON, no extra text.

TECH STACK:
- Tailwind CSS CDN: <script src="https://cdn.tailwindcss.com"></script>
- Configure brand colors/fonts right after: <script>tailwind.config={theme:{extend:{colors:{primary:'#...',secondary:'#...',accent:'#...'},fontFamily:{heading:['FontName','serif'],body:['FontName','sans-serif']}}}}</script>
- Google Fonts: <link> in <head> before Tailwind CDN
- Font Awesome 6 CDN: <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">
- A small <style> block in <head> ONLY for: @keyframes, custom bg-image overlays, animation transitions for [data-animate], and anything Tailwind can't express
- One <script> block before </body> for all JS

LAYOUT & ALIGNMENT (CRITICAL — must be followed or the page will look broken):
- Every section content wrapper: <div class="max-w-6xl mx-auto px-6 lg:px-8">
- All sections must have vertical padding: py-16 lg:py-24
- Grid columns MUST be responsive: grid-cols-1 md:grid-cols-2 lg:grid-cols-3 (never bare grid-cols-N)
- All grid gaps: gap-8 (never omit gap)
- Text alignment: use text-center only for hero headlines and section titles; body text is prose (text-left)
- Cards: flex flex-col h-full inside a grid — never bare divs without flex structure
- Images inside cards: w-full h-48 object-cover rounded-lg (never unconstrained)
- Hero image: cover the full header with object-fit:cover; use relative + absolute positioning or bg-image pattern
- Nav: h-16, flex items-center justify-between, px-6 (never bare nav without height)
- Footer: py-12, grid grid-cols-1 md:grid-cols-3 gap-8 (never bare flex without wrapping)
- Avoid mixing margin hacks (mt-[100px]) — use padding on the parent section instead
- All interactive elements (buttons, links) must have focus-visible:ring styles for accessibility

VISUAL QUALITY RULES (mandatory — produce beautiful pages):
- Alternate section backgrounds: white / light-gray (#f8fafc) / dark — never all-white
- Section headers: centered h2 + short lead paragraph (max 2 lines) before content grid — always add a bottom-border accent line or decorative element under the h2 (e.g. w-16 h-1 bg-accent mx-auto mt-3 rounded-full)
- Feature/service cards: icon at top (Font Awesome, text-accent text-3xl), bold title h3, description text-sm text-gray-500, and optional CTA link with arrow
- Stats/counter section: large bold numbers (text-5xl font-black text-primary) + label text-sm uppercase tracking-widest + [data-count] attribute
- Testimonials: card with quote mark decoration (Font Awesome fa-quote-left text-4xl text-accent/20), body quote text, avatar img + name/role below — use real Pexels portrait URLs
- Proof bar: flex justify-center gap-10 flex-wrap, each item: icon + text, muted color, small font
- CTA sections: full-width bg-primary or bg-gradient with white headline + ghost + solid button pair
- Process/steps: numbered steps with large circle numbers (w-12 h-12 rounded-full bg-accent text-white flex items-center justify-center font-black) + connecting line on desktop (absolute h-0.5 bg-accent/30)
- Visual hierarchy: every section should feel distinct — vary column count (1, 2, 3 col), image left/right alternation, background color, and typography weight

NAV: Fixed top, bg-white/90 backdrop-blur-xl border-b, logo name left + primary CTA button right. Mobile hamburger (id="menu-btn") toggles (id="mobile-menu").

HERO: min-h-screen, background-image with bg-black/50 overlay, headline clamp(1.8rem,4vw,3.2rem), subheadline font-size clamp(0.95rem,1.5vw,1.15rem), 2 CTA buttons (primary + ghost). Always include the hero image in the section background.

ANIMATIONS (CRITICAL — implement ALL of the following):
Define these @keyframes in <style>:
  @keyframes fadeInUp { from { opacity:0; transform: translateY(2.5rem); } to { opacity:1; transform: translateY(0); } }
  @keyframes fadeInLeft { from { opacity:0; transform: translateX(-3rem); } to { opacity:1; transform: translateX(0); } }
  @keyframes fadeInRight { from { opacity:0; transform: translateX(3rem); } to { opacity:1; transform: translateX(0); } }
  @keyframes scaleIn { from { opacity:0; transform: scale(0.88); } to { opacity:1; transform: scale(1); } }
  @keyframes fadeIn { from { opacity:0; } to { opacity:1; } }

Element animation rules:
  - [data-animate="up"] → fadeInUp, starts with opacity:0 translateY(2.5rem)
  - [data-animate="left"] → fadeInLeft, starts with opacity:0 translateX(-3rem)
  - [data-animate="right"] → fadeInRight, starts with opacity:0 translateX(3rem)
  - [data-animate="scale"] → scaleIn, starts with opacity:0 scale(0.88)
  - [data-animate="fade"] → fadeIn, starts with opacity:0

Apply to: section headings (up), feature cards in grids (up, staggered via data-delay), images on left col (left), images on right col (right), stat blocks (scale), hero content (fade with 0.2s delay).
IntersectionObserver (threshold 0.12): once visible, add animation CSS (animation: [name] 0.65s cubic-bezier(.22,.68,0,1.2) var(--delay,0s) forwards).
Stagger: set --delay inline on each child: style="--delay:0.1s", 0.2s, 0.3s, 0.4s etc.

PARALLAX HERO: In JS, on scroll event: document.getElementById('hero').style.backgroundPositionY = (scrollY * 0.35) + 'px' — creates subtle parallax depth on hero background-image.

COUNTER ANIMATION: Elements with [data-count] animate from 0 to target value over 1.5s using requestAnimationFrame (easeOutQuad easing) when they enter viewport.

NAV SCROLL: on scrollY > 60, nav adds classes: shadow-lg bg-white/95 (or dark bg/95 for dark themes). Use transition-all duration-300 on nav.

JS (DOMContentLoaded): hamburger toggle, sticky nav scroll detection, FAQ accordion (.faq-item click toggles .faq-answer visibility with slide transition), smooth scroll for all anchor links, counter [data-count] animate (requestAnimationFrame easeOutQuad), floating WhatsApp/phone button if contact provided, hero parallax, IntersectionObserver for all [data-animate] elements.

HTML STRUCTURE: <nav> → <header id="hero"> → proof-bar (4-5 trust badges) → 4+ <section> blocks → <section id="faq"> → <section id="cta"> → <footer>

IMAGES (CRITICAL — follow exactly):
- Use ALL image URLs provided in ASSETS. Do not invent or omit any.
- Hero image: MUST appear as background-image of the hero section. If also an <img>, set it to fill the hero (w-full h-full object-cover absolute inset-0).
- Section images: each goes in its designated section as a visible <img>, with classes w-full h-64 md:h-80 object-cover rounded-xl shadow-md.
- Logo: img.brand-logo in nav — use EXACTLY the provided URL, no substitutions.
- Every <img> MUST have a descriptive alt= attribute.
- Every <img> for a content section MUST be visible (no hidden, no opacity-0, no display:none).

DOWNLOAD FILES (MANDATORY — cannot be omitted):
- If the context includes DOWNLOAD FILES, each file MUST appear in the page as a clickable <a href="URL" download> button.
- Embed the download links inside the section they are contextually relevant to (use the context description as a guide). Do NOT group all downloads together in a single section unless there is no relevant context for any of them.
- Preferred placement: inside a "Resources", "Materials", or "Downloads" card box placed within the most relevant section, OR as a prominent pill button directly under the section headline.
- Style download links as pill buttons: class="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-gray-900 text-white font-semibold text-sm no-underline hover:bg-gray-700 transition-colors" — add a Font Awesome icon before the label (fa-file-pdf, fa-file-alt, fa-download based on file type).
- DO NOT leave download files out of the page. This is mandatory.

EMBEDDED FORMS (MANDATORY — cannot be omitted):
- If the section contract includes kind="embed" sections, output the HTML comment <!-- INJECT_EMBED_N --> placeholder on its own line inside the section.
- Write a compelling <h2> and introductory <p> before the placeholder that encourages the user to fill in the form.
- DO NOT write any <form>, <iframe>, or embed code yourself — only the placeholder comment.
- Missing this placeholder means the embedded form will be force-injected at the bottom of the page instead.

CONTENT RULES:
- html lang from context language
- Use EXACT colors, fonts, images, services, contacts from context
- Write ALL copy in the language from context
- VARIABILITY: avoid template repetition. Choose section sequencing, rhythm, and layout blocks according to the business and scraped visual DNA; do not reuse the same hero/section formula across requests.
- SCRAPER IDENTITY: when scraper visual notes are present, replicate their design energy (contrast, spacing density, typography mood, CTA style) while keeping copy and offer adapted to current form data.
- SEO: include unique <title>, meta description, canonical, OG tags, and JSON-LD (LocalBusiness or Organization) using business data.
- SEO: preserve semantic heading hierarchy with one H1 and section H2s; include descriptive alt text.
- CRO: ensure at least 3 strategically placed CTAs (hero, mid-page, final), each specific and action-oriented.
- TESTIMONIAL AVATARS: when testimonials exist, avatar images must be Pexels portraits of people matching each role/cargo; never reuse the same image.
- Hero h1: outcome-first, max 12 words
- CTA labels: specific ("Solicitar Orçamento Grátis"), never "Learn More" alone
- No filler: no world-class, seamlessly, robust, leveraging
- WhatsApp → floating fixed bottom-right button (z-index:999)
- Footer: Font Awesome social icons + address + copyright
- Section contract: if present in context, build sections in EXACT listed order
- Never generate image carousels/sliders (no swiper/splide/glide/custom carousel)
- BRAND FIDELITY: study every detail — colors, tone, audience — and reflect it throughout`;

    // Testing now uses the same high-quality system prompt as admin for generation parity.

    const buildUserPrompt = async (compact = false): Promise<string> => {
      const compactNote = compact
        ? "\n\nOUTPUT RECOVERY: Previous response was cut off. Regenerate the SAME page, keeping all sections but with more concise copy to fit. Do NOT drop nav, faq, footer, or JS."
        : "";
      const [fallbackHero, sectionFallbacks] = await Promise.all([heroFallbackFromPexels, sectionFallbacksFromPexels]);
      return `${buildContextBlock(fallbackHero, sectionFallbacks)}${safePrompt}${compactNote}`;
    };

    const requestAiResponse = async (compact = false) => {
      const activeSystemPrompt = adminSystemPrompt;
      const isTestingAccount = normalizeAccountType(accountType) === "testing";
      const maxRetries = isTestingAccount ? 3 : 2;
      const maxRounds = isTestingAccount ? 4 : 2;
      const roundBackoffMs = isTestingAccount
        ? [2500, 7000, 15000]
        : [2500];
      let sawRateLimit = false;
      let retryAfterSeconds = 8;
      let lastUnavailableError: string | null = null;
      const geminiApiKeys = GEMINI_API_KEYS;

      for (let round = 0; round < maxRounds; round++) {
        let roundSawRateLimit = false;

        for (const geminiApiKey of geminiApiKeys) {
          for (const model of getSiteGenerationModels(accountType, compact)) {
            for (let attempt = 0; attempt < maxRetries; attempt++) {
            const effectiveCompact = compact;
            const baseMaxTokens = isTesting
              ? (effectiveCompact ? TESTING_COMPACT_TOKENS : TESTING_MAX_TOKENS)
              : (effectiveCompact ? COMPACT_MAX_TOKENS : STANDARD_MAX_TOKENS);
            const tokenBudget = baseMaxTokens;
            const promptText = await buildUserPrompt(effectiveCompact);
            const aiBody = JSON.stringify({
              systemInstruction: { parts: [{ text: activeSystemPrompt }] },
              contents: [{ parts: [{ text: promptText }] }],
              generationConfig: {
                temperature: effectiveCompact ? 0.7 : 0.9,
                maxOutputTokens: tokenBudget,
                thinkingConfig: { thinkingBudget: effectiveCompact ? 512 : 1024 },
              },
            });

            console.log(`AI request model=${model} attempt=${attempt + 1}/${maxRetries}${effectiveCompact ? " (compact)" : ""} round=${round + 1}/${maxRounds} tokens=${tokenBudget}`);
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 120000);
            let response: Response;
            try {
              response = await fetch(buildAiUrl(model), {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-goog-api-key": geminiApiKey },
                body: aiBody,
                signal: controller.signal,
              });
            } catch (fetchErr: any) {
              clearTimeout(timeoutId);
              if (fetchErr?.name === "AbortError") {
                lastUnavailableError = `AI model ${model} timed out`;
                break;
              }
              throw fetchErr;
            }
            clearTimeout(timeoutId);

            if (response.ok) {
              const responseText = await response.text();
              try {
                const parsed = parseAiPayload(responseText);
                const finishReason = parsed?.candidates?.[0]?.finishReason;
                if (finishReason && finishReason !== "STOP") {
                  console.warn(`Model ${model} finishReason=${finishReason} (attempt ${attempt + 1}/${maxRetries})`);
                  // If generation was cut/blocked, try next attempt/model instead of accepting partial output.
                  if (attempt < maxRetries - 1) {
                    continue;
                  }
                }
              } catch {
                // If parsing envelope fails, keep fallback behavior and validate downstream.
              }
              return { kind: "ok" as const, text: responseText, model };
            }
            if (response.status === 402) return { kind: "credits" as const };

            if (response.status === 429) {
              const txt = await response.text();
              const retryAfterRaw = Number(response.headers.get("retry-after"));
              if (Number.isFinite(retryAfterRaw) && retryAfterRaw > 0) {
                retryAfterSeconds = Math.max(retryAfterSeconds, Math.ceil(retryAfterRaw));
              }
              console.warn(`Rate limited on ${model}:`, txt);
              sawRateLimit = true;
              roundSawRateLimit = true;
              // Move to next model immediately; after all models, run one extra delayed round.
              break;
            }

            if (response.status === 503) {
              console.warn(`${model} overloaded (503), attempt ${attempt + 1}`);
              if (attempt < maxRetries - 1) {
                await new Promise((r) => setTimeout(r, attempt === 0 ? 8000 : 15000));
                continue;
              }
              lastUnavailableError = `Model ${model} overloaded`;
              break;
            }

            if ([502, 504].includes(response.status)) {
              lastUnavailableError = `Model ${model} unavailable (${response.status})`;
              if (attempt < maxRetries - 1) {
                await new Promise((r) => setTimeout(r, attempt === 0 ? 3000 : 8000));
                continue;
              }
              break;
            }

            // Testing key can receive provider-specific nonstandard statuses (e.g. 546)
            // or model/key availability errors that should not abort the whole chain.
            if (isTestingAccount && [400, 401, 403, 404, 408, 409, 422, 500, 530, 546].includes(response.status)) {
              const providerBody = await response.text();
              console.warn(`Testing model/key fallback on ${model} (${response.status})`, providerBody.slice(0, 400));
              lastUnavailableError = `Model ${model} unavailable (${response.status})`;
              // Move forward to next model/key immediately for testing flow.
              break;
            }

            const errText = await response.text();
            throw new Error(`AI gateway error ${response.status}: ${errText}`);
            }
          }
        }

        if (!roundSawRateLimit) {
          break;
        }

        if (round < maxRounds - 1) {
          const backoffMs = roundBackoffMs[Math.min(round, roundBackoffMs.length - 1)] || 2500;
          console.warn(`All models rate-limited in round ${round + 1}. Waiting ${backoffMs}ms before one final round.`);
          await new Promise((r) => setTimeout(r, backoffMs));
        }
      }

      if (sawRateLimit) return { kind: "rate_limit" as const, retryAfterSeconds };
      if (lastUnavailableError) throw new Error(lastUnavailableError);
      throw new Error("AI gateway failed after all retries");
    };

    console.log("Generating landing page directly...", {
      promptLength: prompt.length,
      safePromptLength: safePrompt.length,
      truncated: wasPromptTruncated,
      carouselImages: 0,
      hasContract,
      isTesting,
    });

    // Parse AI response: primary path is raw HTML from Gemini candidates envelope.
    // Fallback handles JSON-wrapped HTML (legacy) and fenced code blocks (defensive).
    const parseDirectSite = (raw: string): { html: string; css: string; js: string; slug: string } | null => {
      const fallbackSlug = String(businessName?.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "site");
      const makeResult = (html: string) => ({ html, css: "", js: "", slug: fallbackSlug });

      // Primary: Gemini wraps response in candidates envelope
      try {
        const envelope = parseAiPayload(raw);
        const text = envelope ? extractModelText(envelope) : null;
        if (text) {
          const cleaned = stripCodeFences(text);
          if (/<!DOCTYPE|<html/i.test(cleaned)) return makeResult(cleaned);
          // Defensive: model returned JSON despite instructions
          const jsonStr = findFirstJsonObject(cleaned);
          if (jsonStr) {
            const obj = JSON.parse(jsonStr);
            if (typeof obj?.html === "string" && /<!DOCTYPE|<html/i.test(obj.html)) return makeResult(obj.html);
          }
        }
      } catch (error) {
        console.warn("Failed to extract text from Gemini envelope", error);
      }

      // Fallback: raw string is already HTML (no envelope)
      const cleanedRaw = stripCodeFences(raw);
      if (/<!DOCTYPE|<html/i.test(cleanedRaw)) return makeResult(cleanedRaw);

      // Last resort: JSON object somewhere in the raw string
      const rawJson = findFirstJsonObject(cleanedRaw);
      if (rawJson) {
        try {
          const obj = JSON.parse(rawJson);
          if (typeof obj?.html === "string" && /<!DOCTYPE|<html/i.test(obj.html)) return makeResult(obj.html);
        } catch { /* ignore */ }
      }

      return null;
    };

    const getDirectSiteValidationError = (site: ReturnType<typeof parseDirectSite>): string | null => {
      if (!site) return "no site payload";
      if (!site.html || site.html.length < 1500) return "html too short";
      if (!/<html|<!DOCTYPE/i.test(site.html)) return "missing document structure (no <!DOCTYPE/html>)";
      if (!/<\/body>/i.test(site.html) || !/<\/html>/i.test(site.html)) return "incomplete html (missing </body> or </html>)";
      // CDN approach uses tailwindcss CDN instead of large inline <style> blocks
      const hasStyle = /<style[\s>]/i.test(site.html);
      const hasTailwind = /tailwindcss\.com/i.test(site.html);
      if (!hasStyle && !hasTailwind) return "missing styles (no <style> and no Tailwind CDN)";
      if (!/<script[\s>]/i.test(site.html)) return "missing inline <script>";
      if (!/<header|<section|<footer/i.test(site.html)) return "missing structural elements";
      const sectionCount = (site.html.match(/<section\b/gi) || []).length;
      if (sectionCount < 4) return "too few sections";
      if (!/<footer\b/i.test(site.html)) return "missing footer";
      return null;
    };

    const tryRecoverCompleteSite = async (
      partialSite: ReturnType<typeof parseDirectSite>,
      reason: string,
    ): Promise<ReturnType<typeof parseDirectSite>> => {
      if (!partialSite?.html) return null;

      const recoverySystemPrompt = `You are an expert HTML recovery engine.
Given a partially generated landing page, rebuild and return a COMPLETE standalone HTML document.

MANDATORY OUTPUT RULES:
- Return ONLY raw HTML document
- Start with <!DOCTYPE html>
- End with </html>
- Keep all existing valid content and complete missing sections
- Preserve visual style, branding, images, contact data, and CTA intent
- Ensure nav, hero, at least 4 sections, FAQ (if applicable), CTA, and footer are present
- Keep JavaScript functional and include closing tags
- Do not output markdown or explanations`;

      const recoveryPrompt = `Recovery reason: ${reason}

Original brief (for fidelity):
${safePrompt}

Partially generated HTML to recover:
${partialSite.html}

Return a fully reconstructed and complete HTML page now.`;

      const recoveryBudget = isTesting ? TESTING_MAX_TOKENS : STANDARD_MAX_TOKENS;
      for (const geminiApiKey of GEMINI_API_KEYS) {
        for (const model of getSiteGenerationModels(accountType, false)) {
          console.warn(`Attempting completion recovery with model=${model} reason=${reason}`);
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 120000);
          try {
            const response = await fetch(buildAiUrl(model), {
              method: "POST",
              headers: { "Content-Type": "application/json", "x-goog-api-key": geminiApiKey },
              body: JSON.stringify({
                systemInstruction: { parts: [{ text: recoverySystemPrompt }] },
                contents: [{ parts: [{ text: recoveryPrompt }] }],
                generationConfig: {
                  temperature: 0.4,
                  maxOutputTokens: recoveryBudget,
                  thinkingConfig: { thinkingBudget: 1024 },
                },
              }),
              signal: controller.signal,
            });
            clearTimeout(timeoutId);

            if (!response.ok) {
              console.warn(`Recovery failed on ${model} with status ${response.status}`);
              continue;
            }

            const recoveredRaw = await response.text();
            const recoveredSite = parseDirectSite(recoveredRaw);
            const recoveredError = getDirectSiteValidationError(recoveredSite);
            if (!recoveredError && recoveredSite) {
              console.warn(`Recovery successful with model=${model}`);
              return recoveredSite;
            }
            console.warn(`Recovery output invalid on ${model}: ${recoveredError || "unknown"}`);
          } catch (error: any) {
            clearTimeout(timeoutId);
            if (error?.name === "AbortError") {
              console.warn(`Recovery timed out on model ${model}`);
            } else {
              console.warn(`Recovery error on model ${model}:`, error);
            }
          }
        }
      }

      return null;
    };

    const primaryResult = await requestAiResponse(false);
    console.log("Primary result:", primaryResult.kind === "ok"
      ? { model: primaryResult.model, len: primaryResult.text.length }
      : primaryResult.kind);

    if (primaryResult.kind === "rate_limit") {
      // Retry once more with full mode (no compact degradation) before returning 429.
      console.warn("Primary request rate-limited. Retrying once in full mode before returning 429.");
      const compactOnRateLimit = await requestAiResponse(false);
      if (compactOnRateLimit.kind === "ok") {
        let site = parseDirectSite(compactOnRateLimit.text);
        const validationError = getDirectSiteValidationError(site);
        if (!validationError && site) {
          const resolvedSlug = (typeof customSlug === "string" && customSlug.trim())
            ? customSlug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-")
            : site.slug;
          const allContent = site.html + "\n" + site.css;
          const assets = extractAssets(allContent);
          return new Response(
            JSON.stringify({ html: site.html, assets, slug: resolvedSlug }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        const recovered = await tryRecoverCompleteSite(site, `rate-limit recovery invalid: ${validationError || "unknown"}`);
        if (recovered) {
          const resolvedSlug = (typeof customSlug === "string" && customSlug.trim())
            ? customSlug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-")
            : recovered.slug;
          const allContent = recovered.html + "\n" + recovered.css;
          const assets = extractAssets(allContent);
          return new Response(
            JSON.stringify({ html: recovered.html, assets, slug: resolvedSlug }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }
      if (compactOnRateLimit.kind === "credits") {
        return new Response(JSON.stringify({ error: "AI credits exhausted." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const retryAfterSeconds = compactOnRateLimit.kind === "rate_limit"
        ? compactOnRateLimit.retryAfterSeconds
        : primaryResult.retryAfterSeconds;
      return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment.", retryAfterSeconds }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (primaryResult.kind === "credits") {
      return new Response(JSON.stringify({ error: "AI credits exhausted." }), {
        status: 402,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let site = parseDirectSite(primaryResult.text);
    let validationError = getDirectSiteValidationError(site);

    if (validationError) {
      console.warn(`Primary invalid (${validationError}), retrying in full mode`);
      const compactResult = await requestAiResponse(false);
      if (compactResult.kind === "rate_limit") {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again.", retryAfterSeconds: compactResult.retryAfterSeconds }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (compactResult.kind === "credits") {
        return new Response(JSON.stringify({ error: "AI credits exhausted." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (compactResult.kind === "ok") {
        site = parseDirectSite(compactResult.text);
        validationError = getDirectSiteValidationError(site);
      }
    }

    if (validationError && site) {
      const recovered = await tryRecoverCompleteSite(site, `post-retry validation failure: ${validationError}`);
      if (recovered) {
        site = recovered;
        validationError = null;
      }
    }

    if (validationError || !site) {
      throw new Error(`Landing page generation failed: ${validationError || "empty result"}. Please try again.`);
    }

    // Apply custom slug
    const resolvedSlug = (typeof customSlug === "string" && customSlug.trim())
      ? customSlug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-")
      : site.slug;

    // Extract asset URLs from generated HTML+CSS
    const allContent = site.html + "\n" + site.css;
    const assets = extractAssets(allContent);

     // Reinject data: URI markers: replace synthetic https://img.chiliforge.io/... URLs
     // back with the real data: URIs so PHP can mirror them into the assets/ folder.
     let finalHtml = site.html;
     if (dataUriMarkerMap.size > 0) {
       for (const [marker, realUri] of dataUriMarkerMap) {
         // Use split/join to replace ALL occurrences (handles both src= and url(...) contexts)
         finalHtml = finalHtml.split(marker).join(realUri);
       }
     }

     const normalizedDownloads = (formDataSnapshot?.downloadFiles || []).map((f) => ({
       name: String((f as any).name || ""),
       label: String((f as any).label || ""),
       context: String((f as any).context || ""),
       url: String(f.url || ""),
       mime: String(f.mime || ""),
     }));

     const fallbackHero = await heroFallbackFromPexels;
     const primaryHeroUrl = String((formDataSnapshot?.images as any)?.hero || "").trim();

     if (pexelsApiKey) {
       finalHtml = await enforcePexelsTestimonialAvatarsInHtml(finalHtml, pexelsApiKey, String(businessName || "business"));
     }

     finalHtml = enforceHeroFallbackImage(finalHtml, fallbackHero, primaryHeroUrl);

     finalHtml = enforceImageRoles(
       finalHtml,
       String((formDataSnapshot?.images as any)?.logo || "").trim(),
       primaryHeroUrl || fallbackHero,
       ((formDataSnapshot?.images as any)?.sections as string[] || []).filter(Boolean),
       (formDataSnapshot?.imagePolicy?.mustUse || []).filter(Boolean),
     );
     finalHtml = enforceSeoAndCroFoundation(finalHtml, {
       businessName: String(businessName || "Landing Page"),
       language: String(formDataSnapshot?.language || "en"),
       slug: resolvedSlug,
     });

     finalHtml = applyContextualDownloadLinks(finalHtml, normalizedDownloads);
     finalHtml = enforceDownloadButtons(finalHtml, normalizedDownloads);

     finalHtml = injectEmbeddedForms(finalHtml, contractSections);

     finalHtml = enforceReadableTextAndHeader(finalHtml, String(formDataSnapshot?.theme?.primary || "#2563eb"));

     // Also add marker→realUri mappings to assets so PHP can save them even if the
     // AI didn't embed them in the HTML (conservative: ensures no form image is lost)
     const markerAndOriginalAssets = [
       ...Array.from(dataUriMarkerMap.values()),
       ...assets,
       ...extractAssets(finalHtml),
     ].filter((v, i, arr) => arr.indexOf(v) === i);

     return new Response(
       JSON.stringify({ html: finalHtml, assets: markerAndOriginalAssets, slug: resolvedSlug }),
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
