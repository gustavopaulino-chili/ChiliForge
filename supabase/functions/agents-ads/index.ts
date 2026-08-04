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

// Encode bytes → base64 in 32KB chunks. `btoa(String.fromCharCode(...new Uint8Array(buf)))`
// spreads every byte as a function argument, so a few-hundred-KB image overflows the call
// stack ("Maximum call stack size exceeded") — which silently killed the overlay/calm-zone
// image calls and forced the template fallback on every run. Chunking keeps the arg count safe.
function bytesToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const CHUNK = 0x8000; // 32768 bytes per chunk
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
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
  costAcc?: { usd: number; images: number; jobId?: string };
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

// Feature flags
// DISABLED (2026-07-08): the burned-text detector (gemini-3-pro-preview per banner) + retry loop
// (extra image gens per texty banner) was a real cost drain AND not reliable — text still slipped
// through. Turned off by request: if a rare banner comes with text, the client regenerates it.
// Set back to true to re-enable the backgroundHasText validation + retry + shapes fallback.
const VALIDATE_BACKGROUND = false;  // background text detection + retry
const CRITIQUE_OVERLAY    = true;  // Flash self-reviews its overlay and retries once if poor

// Appended to the bg prompt when a regeneration is triggered because the first attempt leaked
// text. The #1 source of leaked text is the model COPYING copy/captions from the attached brand
// posts — so the reminder calls that out explicitly.
const NO_TEXT_RETRY_REMINDER =
  "\n\n⛔⛔ RETRY REASON — TEXT/GRAPHIC LEAK: your previous attempt rendered VISIBLE TEXT/LETTERS/WORDS or a drawn ICON into the image. This is a hard failure. The attached brand/reference images CONTAIN text, captions, headlines and wordmarks — you MUST NOT copy, trace, paraphrase or invent ANY of it. Output a background with ABSOLUTELY ZERO letters, words, numbers, captions, slogans, logos or wordmarks anywhere — not on walls, screens, props, clothing, signage or as decoration. This also means: do NOT invent a decorative cursive/script flourish, monogram, emblem or stylized mark that READS AS a logo or wordmark; and do NOT draw any flat ICON/PICTOGRAM sticker (megaphone, speech/chat bubble, thumbs-up, heart, star, like/notification badge, envelope, bell, rocket, lightbulb, hashtag, play button) onto the scene — no brand-like or social-media graphic decoration of any kind. Every surface stays completely blank. Keep ONLY the visual subject and the brand colours/lighting.";

// Last-resort reminder for HERO mode when TWO prior attempts both leaked text. Hero mode can't
// fall back to abstract shapes (would erase the hero subject), so this attempt goes further than
// NO_TEXT_RETRY_REMINDER: it explicitly bans the devices/screens/signage that keep tempting the
// model into rendering "content" text (phone/laptop UI mockups, app screens, quote graphics),
// since the theme itself (viral/social content) biases the model toward drawing that kind of text.
const HERO_NO_TEXT_RETRY_REMINDER =
  "\n\n⛔⛔⛔ SECOND TEXT-LEAK RETRY — READ CAREFULLY: your last TWO attempts both rendered visible text into the image. Whatever surface is doing it, remove it. SPECIFICALLY: any phone, tablet, laptop or monitor screen in the scene must show a SOLID BLURRED COLOR or a completely abstract/blurred pattern — never app UI, never icons, never any word, never a simulated social-media interface. Any paper, notebook, whiteboard, poster or sign must be BLANK. Do NOT render any 'quote card', caption graphic, or text-based design element, even faded, ghosted, or semi-transparent — a faint/low-opacity text is STILL a failure. This also covers non-letter offenders: no decorative cursive/script squiggle, monogram, emblem or stylized flourish anywhere that reads as a logo or wordmark even without actual legible letters — that is exactly as much a failure as real text, because it visually clashes with the real logo composited on top afterward. If you are unsure whether something will render as text or a logo-like mark, remove that object from the scene entirely and keep only the hero subject and the environment.";

// Appended to the FIRST-pass bg prompt whenever reference images are attached. Reference/brand
// posts almost always contain text, captions and logos, and the image model's strongest temptation
// is to trace them straight into the background — the exact failure we keep seeing. This states the
// rule up-front (not only on retry), and is worded to be safe even in hero mode (it forbids only
// text/logos, never the subject itself).
// THE #1 rule, prepended to EVERY background prompt so the model reads it first. The single most
// important constraint (a clean, text-free ad background) must never get lost among the creative
// direction. Short and absolute on purpose.
const PRIMARY_BG_RULE =
  "███ RULE #1 — READ THIS FIRST, IT OVERRIDES EVERYTHING BELOW ███\nYou are producing ONLY the BACKGROUND of an advertisement — nothing else. You must NOT draw ANY text, letter, word, number, headline, caption, slogan, price, brand name, wordmark or logo ANYWHERE in the image — ZERO. The real logo and all copy are added by the system in a separate layer ON TOP of your image afterwards. Your whole job is ONE clean, cohesive, on-brand background scene that leaves calm space for that overlay. A background that contains ANY text or logo is a total failure and is discarded.\n⛔ THIS IS A PHOTOGRAPH/ILLUSTRATION, NOT A LAYOUT MOCKUP: do NOT draw any card, chip, banner, badge, callout bubble, sign or panel that CONTAINS text, a title, a label or a logo. Do NOT draw a logo PLACEHOLDER of any kind — no box, frame, circle or label marking where a logo goes, and NEVER write the literal word 'logo'. Do NOT render the product/service/company name or the campaign topic (e.g. an industry phrase like 'SEO and Performance Media') as a heading, title card or sign. ✅ ALLOWED and ENCOURAGED: blank brand-colour shapes, organic blobs, diagonal fields, panels and dot clusters as tasteful background DEVICES that make it look like this brand — as long as they contain ZERO text, letters or logo. The ban is only on TEXT / LOGO / placeholders, NEVER on clean blank brand graphics. If you catch yourself composing a heading, a titled card, or a 'logo here' placeholder, STOP.";

const REF_TEXT_LEAK_GUARD =
  "\n\n⛔⛔ THE ATTACHED REFERENCE IMAGES CONTAIN TEXT, CAPTIONS, WORDMARKS AND LOGOS. Do NOT copy, trace, paraphrase or recreate ANY of that text, nor any logo or wordmark, from them. Reproduce the subject/scene and the brand colours only — but every wall, screen, monitor, poster, sign, product label, paper, prop and surface in your output MUST be completely BLANK: zero letters, zero numbers, zero words, zero logos, zero wordmarks, and zero decorative cursive/script flourishes or emblems that merely LOOK like a brand mark even without legible letters. The real logo and all copy are composited in a separate layer afterwards, so ANY text or logo-like graphic you draw appears twice and ruins the ad. A background with any text or logo-like decoration is a complete render failure.";

/**
 * Asks Gemini Flash to check whether a generated background image contains any visible text or
 * logos. Returns true if text/logo found (image should be rejected/retried), false otherwise.
 * On any error, returns false so the pipeline degrades gracefully.
 */
async function backgroundHasText(
  imageUrl: string,
  apiKey: string,
  opts: { jobId?: number; costAcc?: { usd: number } } = {}
): Promise<boolean> {
  try {
    let b64 = "";
    let mime = "image/jpeg";
    // The generated background is a data: URI (base64). fetch() on data: URLs is unreliable in the
    // edge runtime — it threw, the catch returned false, and validation was SILENTLY SKIPPED. That
    // is the real reason burned text/logos kept slipping through no matter the prompt/model/key.
    // Decode the data: URI directly (no fetch); only fall back to fetch for real http(s) URLs.
    const dataMatch = imageUrl.match(/^data:([^;,]+)?;base64,(.+)$/is);
    if (dataMatch) {
      mime = (dataMatch[1] || "image/jpeg").split(";")[0];
      b64 = dataMatch[2].replace(/\s+/g, "");
    } else {
      let res: Response | null = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          res = await fetch(imageUrl, { signal: AbortSignal.timeout(12000) });
          if (res.ok) break;
        } catch (_e) { /* retry */ }
        res = null;
        if (attempt === 0) await new Promise((r) => setTimeout(r, 800));
      }
      if (!res || !res.ok) {
        console.warn(`[bg-validate] could not fetch bg for validation (skipping) job=${opts.jobId ?? "?"}`);
        return false;
      }
      const buf = await res.arrayBuffer();
      b64 = bytesToBase64(buf);
      mime = (res.headers.get("content-type") || "image/jpeg").split(";")[0];
    }
    if (!b64) { console.warn(`[bg-validate] empty image data (skipping) job=${opts.jobId ?? "?"}`); return false; }
    // RESILIENT detection: validate with the SERVER's key first, then fall back to the CALLER's key
    // if that call throws or returns nothing. Previously a single key was used — if it was throttled
    // (n8n batch) or free-tier, the call 429'd/timed-out, the catch returned "no text" (silent pass)
    // and texty/logo backgrounds slipped through. Trying BOTH keys means a healthy key on either side
    // still produces a real verdict. Only a clean 'no' from a key that ACTUALLY answered = pass.
    // gemini-3-pro-preview is far more reliable at catching burned-in text/logos than 2.5-flash.
    const validatorKey = env?.get("GEMINI_API_KEY_PRODUCTION") || env?.get("GEMINI_API_KEY_TESTING") || "";
    const keyChain = [...new Set([validatorKey, apiKey].filter((k): k is string => Boolean(k)))];
    const VSYS = "You are a strict image quality validator for advertising backgrounds. A background MUST be completely free of any text, logo, wordmark, OR drawn icon/pictogram graphic (megaphone, speech bubble, thumbs-up, heart, etc.) — the real text and logo are added later in a separate layer, and flat icon graphics never belong in a photographic background.";
    const VQ = "Does this image contain ANY visible text, letters, numbers, logos, wordmarks, brand names, UI elements with readable labels, OR any illustrated icon/graphic mark? THIS INCLUDES: a headline or title anywhere, text printed on book covers or spines, magazine/newspaper titles, bottle labels, product package text, screen/monitor text, price tags, captions, signage, or any words or letters anywhere in the image — even lightly rendered or partially cut off. ALSO INCLUDES: any decorative cursive/script squiggle, monogram, emblem, or stylized flourish that reads as a logo or brand mark even though it has no actual legible letters — treat that the same as a real logo. ALSO INCLUDES: any ILLUSTRATED FLAT ICON or PICTOGRAM drawn onto the scene as a graphic/sticker — e.g. a megaphone, speech bubble, chat bubble, thumbs-up, heart, star, like/notification badge, envelope, bell, rocket, lightbulb, hashtag, play button, gear, or any social-media/marketing icon — these are graphic overlays that do NOT belong in a photographic background; treat ANY such drawn icon as a failure. ALSO INCLUDES: the SAME logo appearing more than once, OR a faint, ghosted, low-opacity, blurred, or semi-transparent duplicate/echo of a logo or wordmark anywhere (e.g. behind or near where the real logo will be composited) — treat that the same as a real logo, even if barely visible. If you are unsure, answer 'yes'. Answer with ONLY the single word 'yes' or 'no'.";
    let answer = "";
    for (const k of keyChain) {
      try {
        const result = await callGemini(VSYS, VQ, "gemini-3-pro-preview", 0.0, 10, k, undefined,
          [{ data: b64, mimeType: mime, label: "Ad background" }], { ...opts, thinkingLevel: "low", timeoutMs: 25000 });
        answer = String(result?.text || "").trim().toLowerCase();
        if (answer) break;
      } catch (e) {
        console.warn(`[bg-validate] validation call failed on a key (trying next) job=${opts.jobId ?? "?"}: ${e}`);
      }
    }
    const found = answer.startsWith("yes");
    console.log(`[bg-validate] job=${opts.jobId ?? "?"} answered=${answer || "NONE"} result=${found ? "FAIL (text/logo → retry)" : "PASS (clean)"}`);
    return found;
  } catch (err) {
    console.warn(`[bg-validate] validation error (skipping) job=${opts.jobId ?? "?"}: ${err}`);
    return false;
  }
}

/** Flash self-reviews its generated overlay HTML against the background image.
 * Returns true if layout looks good, false if a significant problem was found.
 * On false the caller should regenerate the overlay once. */
async function critiqueOverlayHtml(
  bgUrl: string,
  html: string,
  apiKey: string,
  opts: { jobId?: number; costAcc?: { usd: number } } = {}
): Promise<boolean> {
  try {
    const res = await fetch(bgUrl, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) return true;
    const buf = await res.arrayBuffer();
    const b64 = bytesToBase64(buf);
    const mime = (res.headers.get("content-type") || "image/jpeg").split(";")[0];
    const result = await callGemini(
      "You are an advertising quality reviewer. Be strict.",
      `Review this HTML overlay that will be composited on the background image.

HTML (trimmed):
${html.slice(0, 2500)}

Check for these problems:
1. Headline or subheadline text placed over a bright/busy/cluttered area of the background (low contrast, hard to read).
2. CTA missing, hidden, or positioned off-screen.
3. Text block so large it covers the product/hero in the image.
4. Obvious visual imbalance (e.g. all text crammed into one tiny corner, or huge empty space with no text).
5. ⛔ ELEMENT OVERLAP — read the top/left/right/bottom % coordinates of the logo <img> and of EVERY text group in the HTML, INCLUDING any accent chip/highlight background, underline bar, or eyebrow line as part of that element's box (a colored chip behind a headline word extends beyond the bare text). If the logo's box overlaps or touches the headline's box (accents included) or the CTA's box (accents included), or if any two of those boxes overlap or touch each other, that is a FAIL — flag "fix" even if the rest of the layout looks fine.

Answer ONLY with the single word "ok" (layout works) or "fix" (clear problem found).`,
      "gemini-2.5-flash", 0.0, 10, apiKey, undefined,
      [{ data: b64, mimeType: mime, label: "Ad background" }],
      { ...opts, timeoutMs: 18000 }
    );
    const answer = String(result?.text || "").trim().toLowerCase();
    const needsFix = answer.startsWith("fix");
    console.log(`[overlay-critique] job=${opts.jobId ?? "?"} ${needsFix ? "FIX → regenerating" : "OK"}`);
    return !needsFix;
  } catch (err) {
    console.warn(`[overlay-critique] error (skipping) job=${opts.jobId ?? "?"}: ${err}`);
    return true;
  }
}

// Deterministic safety net for the #1 recurring bug: the logo sharing a vertical band with a
// text group (headline/subheadline/CTA), which reliably collides because those groups span
// nearly the full width (left:6%;right:6%). Asking the model nicely to "check for overlap"
// keeps failing intermittently — this parses the actual HTML and, if the logo's anchor (top or
// bottom) matches any z-index:25/26 group's anchor, flips the logo to the OPPOSITE band. Cheap,
// deterministic, and doesn't depend on the model's spatial reasoning being right every time.
function enforceLogoOppositeBand(html: string, logoUrl: string): string {
  if (!logoUrl) return html;
  const escapedUrl = logoUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // NOTE: style attributes are always double-quoted by this codebase's HTML generator, but often
  // contain single-quoted values INSIDE them (e.g. font-family:'Raleway'). A char class of
  // [^"'] would stop at that embedded single quote and truncate the match — so these regexes
  // must delimit on " specifically and exclude only " (not ') from the captured content.
  const imgRe = new RegExp(`(<img[^>]*src="${escapedUrl}"[^>]*style=")([^"]*)("[^>]*>)`, "i");
  const imgMatch = html.match(imgRe);
  if (!imgMatch) return html;
  const logoStyle = imgMatch[2];
  const logoTop = logoStyle.match(/(?:^|;)\s*top\s*:\s*([\d.]+)%/);
  const logoBottom = logoStyle.match(/(?:^|;)\s*bottom\s*:\s*([\d.]+)%/);
  if (!logoTop && !logoBottom) return html; // can't determine anchor — leave as-is
  const logoBand: "top" | "bottom" = logoTop ? "top" : "bottom";

  const groupRe = /<div\b[^>]*style="([^"]*z-index\s*:\s*2[56][^"]*)"[^>]*>/gi;
  let m: RegExpExecArray | null;
  let conflict = false;
  while ((m = groupRe.exec(html))) {
    const gs = m[1];
    const hasTop = /(?:^|;)\s*top\s*:\s*[\d.]+%/.test(gs);
    const hasBottom = /(?:^|;)\s*bottom\s*:\s*[\d.]+%/.test(gs);
    if ((logoBand === "top" && hasTop) || (logoBand === "bottom" && hasBottom)) { conflict = true; break; }
  }
  if (!conflict) return html;

  const offset = (logoBand === "top" ? logoTop![1] : logoBottom![1]);
  const newBand = logoBand === "top" ? "bottom" : "top";
  const newLogoStyle = logoStyle.replace(
    logoBand === "top" ? /(?:^|;)\s*top\s*:\s*[\d.]+%/ : /(?:^|;)\s*bottom\s*:\s*[\d.]+%/,
    (mm) => (mm.startsWith(";") ? `;${newBand}:${offset}%` : `${newBand}:${offset}%`)
  );
  console.log(`[overlay-html] logo band conflict detected → flipped logo to ${newBand}`);
  return html.replace(imgRe, `$1${newLogoStyle}$3`);
}

// Deterministic safety net for a second recurring bug: despite the "emit EXACTLY ONE logo
// <img>, never a duplicate" instruction, the model sometimes still emits the logo twice
// (e.g. once near the top, once lower) — producing a visibly duplicated brand mark. This
// strips every occurrence of the logo <img> after the first, keeping only the earliest one.
function dedupeLogo(html: string, logoUrl: string): string {
  if (!logoUrl) return html;
  const escapedUrl = logoUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const imgReGlobal = new RegExp(`<img[^>]*src="${escapedUrl}"[^>]*>`, "gi");
  const matches = html.match(imgReGlobal);
  if (!matches || matches.length < 2) return html;
  console.log(`[overlay-html] duplicate logo detected (${matches.length}x) → keeping first, stripping rest`);
  let seen = false;
  return html.replace(imgReGlobal, (m) => {
    if (!seen) { seen = true; return m; }
    return "";
  });
}

// It has full creative freedom: choose placement, font sizes, line breaks, alignment.
// The returned HTML is authoritative — GD renders it exactly (pixel-faithful translation).
// Returns null on failure — callers fall back to the static TypeScript template.
async function buildOverlayHtmlFromGemini(
  bgDataUrl: string,
  data: AgentsAdsPayload["campaignData"],
  format: AdFormat,
  cssVars: string,
  apiKey: string,
  rec?: ComposeTextRec | null,
  opts: { jobId?: number; costAcc?: { usd: number }; calmZone?: string | null; diag?: { reason?: string }; brandDevices?: boolean } = {}
): Promise<string | null> {
  const setDiag = (r: string) => { if (opts.diag) opts.diag.reason = r; };
  // Accept either a base64 data URL or a public HTTPS URL (e.g. Supabase Storage).
  // Using the already-uploaded HTTPS URL is preferred — avoids sending megabytes of base64.
  let bgRef: ReferenceImage;
  if (bgDataUrl.startsWith("https://") || bgDataUrl.startsWith("http://")) {
    try {
      const imgRes = await fetch(bgDataUrl, { signal: AbortSignal.timeout(12000) });
      if (!imgRes.ok) { console.warn(`[overlay-html] bg fetch failed ${imgRes.status}`); setDiag(`bg-fetch-${imgRes.status}`); return null; }
      const buf = await imgRes.arrayBuffer();
      const b64 = bytesToBase64(buf);
      const mime = (imgRes.headers.get("content-type") || "image/png").split(";")[0];
      bgRef = { data: b64, mimeType: mime, label: "Ad background" };
    } catch (err) { console.warn(`[overlay-html] bg fetch error: ${err}`); setDiag(`bg-fetch-err:${String(err).slice(0, 50)}`); return null; }
  } else {
    const match = bgDataUrl.match(/^data:([^;]+);base64,(.+)$/s);
    if (!match) { setDiag("bg-parse"); return null; }
    bgRef = { data: match[2], mimeType: match[1], label: "Ad background" };
  }

  const W = format.width ?? 1080;
  const H = format.height ?? 1080;
  const headline = String(data.mainHeadline || "").trim();
  const sub      = String(data.subheadline || (data as any).offer || "").trim();
  const ctaRaw   = String((data as any).ctaText || "").trim();
  const primaryColor = extractCssVarColor(cssVars, "--primary") || "#1a1a2e";
  const fontFamily   = extractCssVarFont(cssVars) || "'Inter','Helvetica Neue',Arial,sans-serif";
  // Derive Google Fonts URL so GD can download the TTF for the overlay render.
  const _fontUrlDirect = String((data as any).fontUrl || "").trim();
  const _fontName = data.customHeadingFontName || data.headingFont
    || (_fontUrlDirect ? extractFontFamilyFromUrl(_fontUrlDirect) : null)
    || fontFamily.match(/['"]([^'"]+)['"]/)?.[1]?.trim() || null;
  const _systemFonts = /^(inter|helvetica|arial|georgia|times|verdana|trebuchet|tahoma|courier|impact)$/i;
  const fontImportUrl = _fontUrlDirect
    || (_fontName && !_systemFonts.test(_fontName)
      ? `https://fonts.googleapis.com/css2?family=${encodeURIComponent(_fontName).replace(/%20/g, "+")}:wght@400;700;900&display=swap`
      : "");

  if (!headline && !sub) { setDiag("no-text"); return null; }

  const textLines = [
    headline ? `• Headline: "${headline}"` : "",
    sub ? `• Subheadline: "${sub}"` : "",
    ctaRaw ? `• CTA: "${ctaRaw}"` : "",
  ].filter(Boolean).join("\n");

  // Accent colour(s) for the highlighted word / CTA underline = the BRAND's own colours, taken
  // from the brand palette — NEVER sampled from the background image. Sampling from the image
  // produced off-brand accents (e.g. a blue accent for a red brand because the scene had a blue
  // dashboard). A second brand hex is exposed so highlight chips can use a brand-colour GRADIENT
  // instead of defaulting to a flat white/black chip (which reads as generic, not on-brand).
  const isHex = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-f]{3,8}$/i.test(v);
  const brandHexCandidates = [(data as any).accentColor, (data as any).primaryColor, (data as any).secondaryColor]
    .filter(isHex);
  const hasBrandHex = brandHexCandidates.length > 0;
  const accentHexForSpan = brandHexCandidates[0] || "#ffffff";
  const accentHexSecondary = brandHexCandidates[1] || accentHexForSpan;

  // Style variant, rotated by jobId — see OVERLAY_STYLE_VARIANTS comment. Decorrelated from the
  // layout-hint rotation (different modulus/seed) so layout structure and text-treatment style
  // vary independently across a campaign's generation history instead of always pairing up.
  const styleVariant = OVERLAY_STYLE_VARIANTS[(Number(opts.jobId ?? 0) * 13 + 5) % OVERLAY_STYLE_VARIANTS.length];

  // CTA: always PLAIN TEXT, never any container/border/background — that reads as a button.
  // Editorial/UGC caption style, not UI. This is a HARD rule (unaffected by styleVariant) —
  // the variant only shapes which OPTIONAL technique dresses up the plain text.
  const ctaMenu = ctaRaw
    ? [
        `CTA — "${ctaRaw}" — a clear, stylish action line, rendered as PLAIN TEXT with no visible container of any kind: ⛔ NO pill, NO badge, NO background fill, NO border/outline, NO rounded rectangle, NO box-shadow behind it — any CLOSED shape the eye can trace around the CTA reads as a button, and that is banned. Editorial/UGC caption style only, never app UI. Make it visually interesting through TYPOGRAPHY AND MOTION CUES, not containers:`,
        `   • A trailing or leading arrow "→"/"↓", sized boldly (can be noticeably larger than the CTA text itself, like a real directional cue) and set in the brand accent colour ${accentHexForSpan} (or white) for extra pop — it can sit inline or on its OWN line just under the CTA text. Arrows read as motion/action without ever being a button.`,
        `   • A thin accent-colour underline — but make it feel hand-drawn rather than a corporate rule: a slightly rotated (transform:rotate(-1deg to 2deg)) short accent-colour bar, or two/three short overlapping dash strokes instead of one perfect straight line.`,
        `   • Gradient text-fill on the CTA itself (background:linear-gradient(...); -webkit-background-clip:text; color:transparent) using the brand's accent colours — makes it pop with pure typography, zero container.`,
        `   • A loose hand-drawn-style circle or scribble AROUND one key word of the CTA (an SVG-free CSS trick: a rotated border-radius:40%/60% shape with border ONLY, no fill, sitting behind/around the word) — annotation energy, like a marker circling text, never a solid button shape.`,
        `   Pick ONE that fits the DESIGN DIRECTION below (or plain bold text with nothing extra, if that fits better) — never stack more than one embellishment on the CTA.`,
        `   For any accent colour, default to the brand accent hex ${accentHexForSpan} — or, if a strong vivid colour actually visible in THIS background harmonises better with the photo, use that instead. Either way it should still feel like this brand's palette family, not a random unrelated hue.`,
        `   ⛔ CTA CONTRAST — HARD RULE (overrides the accent choices above): the CTA TEXT must be clearly legible against whatever is DIRECTLY BEHIND it. Default the CTA text to WHITE (#ffffff) with the standard text-shadow on any photographic, dark, or brand-coloured background; use a dark CTA text colour ONLY when it sits on a genuinely light/pale area. NEVER render the CTA text in a hue close to the colour right behind it — e.g. brand-red text on a red scene, or the gradient-text-fill technique when the background already shares that colour — that makes the CTA vanish (a real failure we have seen). When you want the brand accent on the CTA, put it on the UNDERLINE, the ARROW, or ONE word only — never on the whole CTA text unless the contrast against THIS background is unmistakably high.`,
      ].join("\n")
    : "No CTA";

  const designDirectionLine = `🎨 DESIGN DIRECTION FOR THIS AD (style variant "${styleVariant.name}"): ${styleVariant.brief} Use this direction to guide your typography, accent, and composition choices for the headline/subheadline/CTA — you decide the specifics (whether to color/highlight a word, add an eyebrow, use a divider line, etc.), as long as the result clearly reads as THIS direction and never breaks the hard rules below (CTA stays plain text with no container; logo never collides with anything).`;

  // BRAND DESIGN DEVICES as a real OVERLAY LAYER (not baked into the photo). The background is a
  // clean photographic scene; the brand's signature graphic devices (the "bolinhas e formas" of a
  // designed social ad — dot clusters/halftone, organic blobs, diagonal colour fields, rings) are
  // rendered HERE as crisp CSS/SVG shapes in the brand colours, on TOP of the photo but UNDER the
  // logo/text. This makes the devices a distinct DESIGN LAYER of the ad instead of a faint tint in
  // the background. Gated to photographic ads that have a known brand colour + brand posts.
  const brandDevicesLine = (opts.brandDevices && hasBrandHex)
    ? `🔵 BRAND DESIGN DEVICES — OPTIONAL LIGHT ACCENT: the background photo already carries the brand's floating design-asset layer, so here you only OPTIONALLY add ONE small crisp brand-colour device to reinforce it — ONLY if there is a clean, empty corner that does NOT already have a floating brand graphic behind it. If the background corners are already busy with brand elements, ADD NOTHING here. When you do add one, use the brand colours ${accentHexForSpan}${accentHexSecondary !== accentHexForSpan ? ` / ${accentHexSecondary}` : ""} and keep it to ONE small element in an empty corner. Ready-to-paste CSS (adjust position/size, keep z-index:15):
   • DOT GRID (a signature — favour it): \`<div style="position:absolute;bottom:6%;right:5%;width:16%;height:16%;background-image:radial-gradient(${accentHexForSpan} 22%,transparent 23%);background-size:14% 14%;z-index:15;pointer-events:none"></div>\`
   • ORGANIC BLOB bleeding from a corner: \`<div style="position:absolute;top:-6%;right:-6%;width:26%;height:26%;background:${accentHexForSpan};border-radius:47% 53% 60% 40%/50% 45% 55% 50%;opacity:0.9;z-index:15;pointer-events:none"></div>\`
   • OUTLINE RING: \`<div style="position:absolute;top:8%;left:40%;width:8%;height:8%;border:0.5cqw solid ${accentHexForSpan};border-radius:50%;z-index:15;pointer-events:none"></div>\`
   • DIAGONAL COLOUR WEDGE from an edge: \`<div style="position:absolute;bottom:0;left:0;width:22%;height:30%;background:${accentHexForSpan};clip-path:polygon(0 100%,0 20%,100% 100%);opacity:0.85;z-index:15;pointer-events:none"></div>\`
   HARD RULES: (a) restraint — ONE or TWO devices only, small-to-medium, hugging edges/corners, together WELL UNDER ~18% of the canvas; never a busy field, never confetti everywhere; (b) place them ONLY in genuinely EMPTY areas — ⛔ NEVER over the person's face or body, NEVER over any text, the CTA, or the logo, NEVER over the visual hero (if a corner is occupied, pick another); (c) BLANK graphics — ZERO text/letters/logo inside; (d) always z-index:15 (ABOVE the scrim, BELOW the logo z-index:20 and text z-index:25). This layer is what makes the ad feel designed and on-brand — do not skip it.`
    : "";

  const SYSTEM = [
    "You are an expert HTML/CSS advertising compositor.",
    "You receive a background image and output the complete HTML text overlay to be placed ON TOP of it.",
    "Return ONLY raw HTML — no markdown fences, no explanation, no wrapper element.",
  ].join(" ");

  const logoUrl = String(data.logoUrl || "").trim();
  const logoLine = logoUrl
    ? `LOGO — YOU fully art-direct it: place <img src="${logoUrl}"> wherever it best balances THIS specific composition, and size it freely (anywhere from a small ~14% mark to a bold ~38% statement) based on the background and where your text sits. Vary the placement creatively across ads (a top corner, a bottom corner, centred under a top headline, etc.) — do NOT default to the same spot every time. Use position:absolute; object-fit:contain; z-index:20. The logo image is IMMUTABLE — render it exactly as-is, never redraw, recolor or alter it. ⛔ Emit EXACTLY ONE logo <img> element — never two, never a duplicate anywhere in the HTML. ⛔ Do NOT place any solid/opaque white or coloured box, card, panel or filled rectangle behind the logo — set it directly on the background (transparent). If the area behind it is busy and the logo needs separation, use AT MOST a very subtle soft drop-shadow or a faint low-opacity scrim — NEVER a solid filled block. ⛔ Do NOT write the brand name as text anywhere — the img tag is the complete brand identifier.\n⛔⛔ THE ONE RULE THAT OVERRIDES EVERYTHING ABOVE: the logo's rendered footprint (its actual box, at the size/position you chose) must NEVER overlap or touch ANY other element's rendered footprint — not the headline, not the subheadline, not the CTA. This footprint includes every pixel any accent decoration adds: a highlight-chip background behind a word makes that word's box bigger than the bare text — measure the CHIP's edges, not just the letters. Same for an underline bar, an eyebrow line, or any other accent shape: whatever visually extends an element's box counts as part of it. Before finalizing, mentally trace a rectangle around the logo and a rectangle around each text element (including their accents) and confirm none of those rectangles intersect. If two would come close, move the logo further away or shrink it — never let them touch.`
    : "";

  // A dedicated vision model (pickCalmTextZone) already inspected THIS exact background and
  // reported which region is emptiest/flattest. Hand that verdict to the overlay model so it
  // anchors text on the calm zone instead of guessing — guessing routinely landed text on the
  // busy hero. Strong steer, not an absolute lock (the model may still split when it makes sense).
  const calmZone = String(opts.calmZone || "").toLowerCase().trim();
  const calmZoneLine = calmZone
    ? `⭐ CALM-ZONE VERDICT: a dedicated vision model analyzed THIS exact background and found the emptiest, most text-safe region is the **${calmZone.toUpperCase()}**. Anchor the main text block in the ${calmZone} region. Only override this if that region is clearly occupied by the visual hero. If you choose OPTION A (split), keep the HEADLINE group in or next to the ${calmZone} region.`
    : "";

  const USER = [
    `BACKGROUND: The attached image is a ${W}×${H}px advertising background. Study it carefully.`,
    `You will design and return the HTML overlay that renders ON TOP of this image.`,
    "",
    calmZoneLine,
    "TEXT CONTENT — ⛔ COPY THIS TEXT VERBATIM, WORD-FOR-WORD. Do NOT rewrite, rephrase, translate, shorten, expand, or 'improve' the headline, subheadline or CTA. Use the EXACT characters given (you may only add a <br> line break and wrap ONE word in an accent <span> — never change the words themselves):",
    textLines,
    "",
    logoLine,
    "",
    designDirectionLine,
    "",
    brandDevicesLine,
    "",
    "YOUR ROLE: expert social media ad designer. Full creative freedom within the design direction above — make this ad look outstanding.",
    "1. ANALYZE the background image:",
    "   a. LOCATE THE VISUAL HERO — where is the product/main subject positioned? (top / bottom / left / right / center / center-bottom / etc.)",
    "   b. Identify all calm/low-contrast zones available for text.",
    "   c. DECIDE: is there usable calm space BOTH ABOVE AND BELOW the hero → use OPTION A (SPLIT). Otherwise → use OPTION B (SINGLE ZONE).",
    "",
    "2. Scrim: a LIGHT dark gradient covering ALL text zone(s). rgba(0,0,0,0.30–0.45) max. Background must remain visible.",
    "   Direction: zone at bottom → 'to top' | top → 'to bottom' | center → radial. Stretch scrim to cover both zones if OPTION A.",
    "",
    "3. OPTION A — SPLIT LAYOUT (hero in center/middle, calm space above AND below):",
    "   • GROUP 1: position:absolute; display:flex; flex-direction:column; z-index:25 — anchored in the UPPER calm zone → contains HEADLINE ONLY.",
    "   • GROUP 2: position:absolute; display:flex; flex-direction:column; gap:2.5cqh; z-index:25 — anchored in the LOWER calm zone → contains SUBHEADLINE as first child, then CTA as second child.",
    `   • CTA child in GROUP 2: align-self:flex-start; font-size:3cqw — style it EXACTLY as the CTA treatment defined below (plain text, no container/border/background of any kind).`,
    "   • Both groups: left:6%; right:6%; keep ≥6% margin from all edges.",
    "",
    "   OPTION B — SINGLE ZONE (calm space concentrated in one area):",
    "   • ONE flex div (z-index:25): position:absolute; display:flex; flex-direction:column; gap:≥3cqh — contains headline and subheadline.",
    `   • CTA placement — the CTA always ends up at the BOTTOM of the ad, but HOW depends on where the text block sits:`,
    `       – If the headline/subheadline block sits at the BOTTOM: make the CTA the LAST CHILD of that same flex div, directly under the subheadline (the block flows headline → subheadline → CTA). Do NOT also pin it to bottom:x% — that double-places it and overlaps the subheadline.`,
    `       – If the block sits at the TOP or center: DETACH the CTA as a STANDALONE absolute element (z-index:26) pinned near the page bottom (bottom:6–9%).`,
    `     Style it with the CTA treatment below. ⛔ The CTA and the subheadline must NEVER share the same line or overlap — there must ALWAYS be a clear vertical gap between them. Never float the CTA loose in the middle of the image.`,
    "",
    "4. Headline typography:",
    "   • font-size:5.5–8cqw; font-weight:900.",
    "   • LINE BREAK: if headline is longer than 22 chars, add an explicit <br> at the most natural semantic split — after a colon, before a key verb — so both visual lines have roughly equal weight. Never rely on CSS auto-wrap.",
    hasBrandHex
      ? `   • ACCENT TREATMENT (do this — it's what makes the ad feel branded, not generic): give the SINGLE most impactful headline word a branded accent. ROTATE the technique across ads for variety — pick ONE that fits the DESIGN DIRECTION. Use the brand hex ${accentHexForSpan}/${accentHexSecondary}, or a strong vivid colour actually present IN THIS background (a lamp glow, a coloured surface) that harmonises better while staying in the brand family. Repertoire (never stack two on one word):
       – COLOURED WORD: <span style="color:${accentHexForSpan}">word</span> — simplest.
       – ⭐ GRADIENT CHIP (favour this often — it's the signature look you want): a filled rounded chip that HUGS the word, white text on it: <span style="background:linear-gradient(135deg,${accentHexForSpan},${accentHexSecondary});color:#fff;padding:0.15cqh 0.9cqw;border-radius:0.6cqw;box-shadow:0 0.5cqh 1.6cqh rgba(0,0,0,0.22);box-decoration-break:clone;-webkit-box-decoration-break:clone">word</span>. Tight padding, soft radius — it hugs the word, never a big block.
       – HIGHLIGHTER SWEEP: a translucent marker stroke behind the word, text stays white: <span style="background:linear-gradient(180deg,transparent 52%,${accentHexForSpan}A6 52%);padding:0 0.3cqw;box-decoration-break:clone;-webkit-box-decoration-break:clone">word</span> — like a highlighter pen, lighter than a full chip.
       – MARKER UNDERLINE: keep the word white/plain and add a thick rounded accent stroke UNDER it (a child <div style="height:0.55cqh;background:${accentHexForSpan};border-radius:999px;transform:rotate(-1.5deg);margin-top:0.3cqh"></div>).
       – OUTLINE WORD: <span style="color:transparent;-webkit-text-stroke:0.3cqw ${accentHexForSpan}">word</span> — bold editorial stroke.
       Never leave this word plain white/black/grey. Skip a highlighted word only if the brand colour is already prominent elsewhere (eyebrow/underline/bar).`
      : `   • ACCENT TREATMENT: no brand colour was provided — pick a strong, vivid colour actually visible in THIS background (a lamp glow, a coloured surface) for the single most impactful headline word (a coloured word, a translucent highlighter sweep behind it, or a thick underline stroke), or keep it plain white if nothing suitable stands out.`,
    "   • text-align: center or left based on composition.",
    "",
    "5. Subheadline: font-size:2.5–4cqw; font-weight:400. Placed in GROUP 2 (OPTION A) or inside the single flex block (OPTION B).",
    "   • LEGIBILITY: the subheadline must read as easily as the headline — keep it on the calm / scrim-covered zone. If it must cross a busy or light-detailed area, give it its OWN subtle backing so it never goes low-contrast: PREFER extending the main scrim gradient under it, or bumping its text-shadow. If you add a local backing it MUST be a soft gradient that FADES to transparent (e.g. background:linear-gradient(90deg,rgba(0,0,0,0.32),transparent)) hugging the text — ⛔ never a solid/evenly-tinted fill, never a rounded or pill-shaped bar (that reads as a container/button), and ⛔ NEVER extend any backing behind the CTA. The CTA itself always stays completely container-free (see its rule).",
    "",
    "6. " + ctaMenu,
    "",
    "RENDERER CAPABILITY: a real headless Chrome rasterizes your HTML — you have the FULL modern CSS toolkit. Use it tastefully for a premium look: linear/radial/conic gradients, backdrop-filter:blur() for a frosted-glass scrim panel, box-shadow, border-radius, letter-spacing, text-transform, transform, and web-font @import all render faithfully. A subtle frosted-glass or gradient scrim behind the text reads far more premium than a flat dark band — prefer it. (Do NOT, however, change the z-index structure rules below — the compositor keys on them.)",
    "",
    "EYEBROW (optional): a small kicker line above the headline — ~1.8cqw, uppercase, letter-spacing:0.25em, brand-accent colour, 1-3 words derived from the industry/offer — add ONE only if it fits the DESIGN DIRECTION below; skip it otherwise rather than stacking every possible flourish at once.",
    "Keep any polish minimal and legible — it supports the copy, it never crowds it.",
    "",
    "TECHNICAL RULES (do not violate):",
    "• Do NOT output any bracket-notation placeholders [like this] as text content inside any HTML element. Every element must contain only real copy text or real HTML children — never a placeholder annotation.",
    "• For the span accent color: write the ACTUAL hex value (e.g. color:#e63946) — never write 'color:[brand color]' or any bracket form.",
    `• Parent container has container-type:size → 1cqw = ${(W / 100).toFixed(1)}px | 1cqh = ${(H / 100).toFixed(1)}px`,
    "• Positions: % only (no px for top/left/right/bottom). Font sizes: cqw or cqh only. Logo width/max-height: % only.",
    `• Font: ${fontFamily}`,
    "• Text: color:#ffffff | text-shadow:0 2px 10px rgba(0,0,0,0.65),0 1px 3px rgba(0,0,0,0.45)",
    "• Scrim: position:absolute; z-index:1; pointer-events:none",
    brandDevicesLine ? "• Brand design devices: position:absolute; z-index:15; pointer-events:none; blank brand-colour shapes only, in EMPTY areas — never over face/text/logo/hero." : "",
    "• Logo img: position:absolute; object-fit:contain; z-index:20",
    "• Text groups: position:absolute; display:flex; flex-direction:column; z-index:25",
    "• CTA: ends up at the bottom of the ad — but if the text block is already at the bottom, the CTA is the LAST CHILD of that block (below the subheadline); only when the block is at the top/center is the CTA a standalone z-index:26 element pinned to bottom:6–9%. Never both.",
    "• ⛔⛔ THE SINGLE RULE THAT MATTERS MOST: NO element's rendered footprint may ever overlap or touch another's — logo, headline (with its accent chip/span if any), subheadline, eyebrow, and CTA (with its underline if any) must EACH occupy fully separate space, with visible breathing room between every pair. None may cover the visual hero's face. Include any accent decoration (chip background, underline bar, eyebrow) as part of an element's footprint when checking for overlap — a colored chip behind a word is bigger than the word's plain text. The standalone CTA should sit near the BOTTOM in clear space; never leave it floating in the middle of the image. If space is tight, shrink fonts, tighten gaps, or reposition the logo — never let two footprints collide.",
    "",
    "RETURN STRUCTURE:",
    "OPTION A → scrim div" + (logoUrl ? ", logo img," : ",") + " GROUP1 div (headline only), GROUP2 div (sub + CTA child).",
    "OPTION B → scrim div" + (logoUrl ? ", logo img," : ",") + " text-block div (headline + sub), CTA div.",
    "Example OPTION A:",
    "<div style=\"position:absolute;top:0;left:0;width:100%;height:100%;background:linear-gradient(...);z-index:1;pointer-events:none\"></div>",
    brandDevicesLine ? `<div style="position:absolute;bottom:6%;right:5%;width:16%;height:16%;background-image:radial-gradient(${accentHexForSpan} 22%,transparent 23%);background-size:14% 14%;z-index:15;pointer-events:none"></div>` : "",
    logoUrl ? `<img src="${logoUrl}" style="position:absolute;top:4%;left:5%;width:24%;max-height:12%;object-fit:contain;z-index:20" alt="logo" />` : "",
    "<div style=\"position:absolute;top:6%;left:6%;right:6%;display:flex;flex-direction:column;z-index:25\">",
    "  <div style=\"font-size:7cqw;font-weight:900;color:#ffffff;...\">Headline <br> split here</div>",
    "</div>",
    "<div style=\"position:absolute;bottom:7%;left:6%;right:6%;display:flex;flex-direction:column;gap:2.5cqh;z-index:25\">",
    "  <div style=\"font-size:3cqw;font-weight:400;color:#ffffff;...\">Subheadline text</div>",
    ctaRaw ? "  <div style=\"align-self:flex-start;font-size:3.2cqw;font-weight:800;color:#ffffff;text-shadow:0 2px 10px rgba(0,0,0,0.6)\">CTA Text <span>&#8594;</span><div style=\"height:0.4cqh;width:55%;background:#e63946;border-radius:999px;margin-top:0.8cqh\"></div></div>" : "",
    "</div>",
  ].filter(Boolean).join("\n");

  try {
    const res = await callGemini(SYSTEM, USER, "gemini-2.5-flash", 0.35, 2600, apiKey, undefined, [bgRef], { ...opts, thinkingBudget: 0, timeoutMs: 25000 });
    const raw = String(res.text || "").trim()
      .replace(/^```html\n?/, "").replace(/^```\n?/, "").replace(/\n?```$/, "").trim();

    if (!raw) { console.warn(`[overlay-html] empty response job=${opts.jobId ?? "?"}`); setDiag("empty"); return null; }

    // Reject if Gemini echoed bracket placeholders as literal text content (e.g. >[left:5%]<)
    if (/>[^<]*\[[^\]]{3,}\][^<]*</.test(raw)) {
      console.warn(`[overlay-html] bracket placeholder in output job=${opts.jobId ?? "?"}: ${raw.slice(0, 200)}`);
      setDiag("bracket"); return null;
    }
    // Headline must appear in the output — reject only a FULL rewrite, not a light edit. A
    // contiguous substring match was far too brittle: the prompt asks the model to insert <br>
    // and an accent <span> into the headline, and the model also reorders/adds a word, so the
    // exact string rarely survives and the overlay always fell back to the template. Instead,
    // require that ≥65% of the headline's significant words (len ≥3) appear anywhere in the
    // tag-stripped output — robust to <br>/<span>/word inserts, still catches a real paraphrase.
    const stripTags = (s: string): string =>
      s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim().toLowerCase();
    const hlWords = headline.toLowerCase().split(/\s+/).filter((w) => w.replace(/[^\p{L}\p{N}]/gu, "").length >= 3);
    const headlinePresent = (h: string): boolean => {
      if (hlWords.length < 3) return true; // too short to judge — accept
      const low = stripTags(h);
      const hits = hlWords.filter((w) => low.includes(w.replace(/[^\p{L}\p{N}]/gu, ""))).length;
      return hits / hlWords.length >= 0.65;
    };
    if (!headlinePresent(raw)) {
      console.warn(`[overlay-html] headline rewritten job=${opts.jobId ?? "?"} expected≈"${headline.slice(0, 30)}"`);
      const textOnly = stripTags(raw).replace(/https?:\/\/[^\s"')]+/g, " ").replace(/\s+/g, " ").trim();
      setDiag(`hl-rw|raw:${raw.length}|strip:${stripTags(raw).length}|txt:${textOnly.slice(0, 100)}`); return null;
    }
    // Truncation guard: a cut-off overlay (more <div> than </div>) renders broken (missing
    // subheadline/CTA). Reject it so the COMPLETE template is used instead of a half overlay.
    const openDivs = (raw.match(/<div\b/gi) || []).length;
    const closeDivs = (raw.match(/<\/div>/gi) || []).length;
    if (openDivs > closeDivs) {
      console.warn(`[overlay-html] truncated divs=${openDivs}/${closeDivs} job=${opts.jobId ?? "?"}`);
      setDiag(`truncated:${openDivs}/${closeDivs}`); return null;
    }
    // Legibility scrim: a real browser renders everything, so DON'T reject an overlay that lacks
    // the exact z-index:1 scrim (the model now often uses a glass/blur panel instead). Just inject
    // a default gradient scrim when none is present — guarantees legible white text either way.
    const ensureScrim = (h: string): string =>
      /z-index\s*:\s*1\b/.test(h)
        ? h
        : `<div style="position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,0.52) 0%,rgba(0,0,0,0.18) 45%,rgba(0,0,0,0) 75%);z-index:1;pointer-events:none"></div>\n` + h;
    let html = ensureScrim(raw);
    // Autocrítica: Flash reviews its own output against the background image — retry once if poor.
    if (CRITIQUE_OVERLAY && (bgDataUrl.startsWith("http://") || bgDataUrl.startsWith("https://"))) {
      const ok = await critiqueOverlayHtml(bgDataUrl, html, apiKey, opts);
      if (!ok) {
        // Re-run the Gemini call once with a hint to improve placement
        const res2 = await callGemini(SYSTEM, USER + "\n\nIMPORTANT: Your previous layout had a visual problem — text over a busy area, CTA hidden, or the LOGO overlapping/sharing a band with the headline or CTA. Re-check every element's top/left/right/bottom % against every other element before finalizing, then regenerate with corrected placement.", "gemini-2.5-flash", 0.4, 2600, apiKey, undefined, [bgRef], { ...opts, thinkingBudget: 0, timeoutMs: 25000 }).catch(() => null);
        if (res2?.text) {
          const raw2 = String(res2.text).trim()
            .replace(/^```html\n?/, "").replace(/^```\n?/, "").replace(/\n?```$/, "").trim();
          if (raw2 && headlinePresent(raw2)) {
            console.log(`[overlay-critique] retry accepted job=${opts.jobId ?? "?"}`);
            const styleTag2 = fontImportUrl ? `<style>@import url('${fontImportUrl}');</style>` : "";
            setDiag("ok-retry"); return styleTag2 + dedupeLogo(enforceLogoOppositeBand(ensureScrim(raw2), logoUrl), logoUrl);
          }
        }
      }
    }
    html = dedupeLogo(enforceLogoOppositeBand(html, logoUrl), logoUrl);
    console.log(`[overlay-html] ok job=${opts.jobId ?? "?"} len=${html.length} font=${_fontName ?? "none"}`);
    const styleTag = fontImportUrl ? `<style>@import url('${fontImportUrl}');</style>` : "";
    setDiag("ok"); return styleTag + html;
  } catch (err) {
    console.warn(`[overlay-html] failed job=${opts.jobId ?? "?"}: ${err}`);
    setDiag(`exception:${String(err).slice(0, 80)}`); return null;
  }
}

// Maps a calm-region word → a composition layout whose text block sits in that region.
const CALM_ZONE_TO_LAYOUT: Record<string, string> = {
  bottom: "hero-full-bleed",       // full-width band along the bottom
  top:    "bold-headline-first",   // full-width band along the top
  left:   "hero-full-bleed",       // side-panel layouts banned — fall back to full-bleed
  right:  "top-right-editorial",   // right side
  center: "centered-minimal",      // centered
};

// Content-aware text placement: ask the model where the GENERATED background is actually
// calmest, then place the text there. This replaces "pre-assign a zone and hope the image
// model complies" — the image model routinely ignored the reserved zone, so text landed on
// busy areas. A one-word classification is far more reliable than generating the full overlay
// HTML (which failed validation ~100% of the time). Returns a LAYOUT_KEY, or null on failure
// (caller falls back to the rotated layout).
async function pickCalmTextZone(
  bgUrl: string,
  apiKey: string,
  opts: { jobId?: number; costAcc?: { usd: number; images: number; jobId?: string } } = {},
): Promise<{ zone: string; layout: string } | null> {
  let bgRef: ReferenceImage;
  try {
    if (/^https?:\/\//.test(bgUrl)) {
      const r = await fetch(bgUrl, { signal: AbortSignal.timeout(12000) });
      if (!r.ok) return null;
      const buf = await r.arrayBuffer();
      const b64 = bytesToBase64(buf);
      const mime = (r.headers.get("content-type") || "image/png").split(";")[0];
      bgRef = { data: b64, mimeType: mime, label: "Ad background" };
    } else {
      const m = bgUrl.match(/^data:([^;]+);base64,(.+)$/s);
      if (!m) return null;
      bgRef = { data: m[2], mimeType: m[1], label: "Ad background" };
    }
  } catch { return null; }

  const SYSTEM = "You analyze advertising background images to find the best place to overlay text.";
  const USER = [
    "The attached image is an ad BACKGROUND. A white headline + subheadline + CTA will be composited ON TOP of it afterwards.",
    "Find the ONE region that is the EMPTIEST and FLATTEST — a plain wall, shadow, sky, blur or solid color field with the LOWEST detail and NO important content.",
    "HARD RULE: never choose a region occupied by the main subject, a laptop, phone, screen, monitor, person, product, plant, or dense graphics/charts/icons. If one large area is dark/flat/empty while the rest is busy, choose that empty area — even if it is a whole side.",
    "Pick the region with the most breathing room for text. Answer with EXACTLY ONE word, lowercase, no punctuation: top, bottom, left, right, or center.",
  ].join("\n");
  try {
    // Gemini 3 Pro decides placement — best vision/reasoning for finding the calm zone. Reverted
    // from gemini-2.5-flash (2026-07-08): 2.5 read the calm zone poorly and text landed on busy
    // areas / the hero. 3-pro is worth the extra cost for correct text placement. thinkingBudget 0
    // keeps it a fast one-word answer; maxTokens 64 leaves room for the minimal thinking.
    const res = await callGemini(SYSTEM, USER, "gemini-3-pro-preview", 0, 64, apiKey, undefined, [bgRef], { ...opts, thinkingBudget: 0, timeoutMs: 25000 });
    const word = String(res.text || "").toLowerCase().match(/top|bottom|left|right|center/)?.[0];
    const layout = word ? (CALM_ZONE_TO_LAYOUT[word] ?? null) : null;
    if (word && layout) console.log(`[calm-zone] job=${opts.jobId ?? "?"} → ${word} (${layout})`);
    return word && layout ? { zone: word, layout } : null;
  } catch (err) {
    console.warn(`[calm-zone] failed job=${opts.jobId ?? "?"}: ${err}`);
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
  // Reference images come FIRST — when the imagen model sees images before text it treats
  // them as the visual basis to work from. Images after text = ignored context. This order
  // is what makes reference images actually influence the output instead of being decorative.
  const parts: unknown[] = [];
  for (const img of refImages) {
    parts.push({ inline_data: { mime_type: img.mimeType, data: img.data } });
  }
  parts.push({ text: prompt });
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
              const inTok  = Number(u.promptTokenCount ?? u.prompt_token_count ?? 0);
              const outTok = Number(u.candidatesTokenCount ?? u.candidates_token_count ?? 0);
              const inUsd  = (inTok / 1_000_000) * pricingFor(model).in;
              const imgUsd = (outTok / 1_000_000) * imageOutPricePer1M(model);
              const total  = inUsd + imgUsd;
              const job = opts.costAcc?.jobId ? ` job=${opts.costAcc.jobId}` : "";
              console.log(`[cost-estimate]${job} IMAGE model=${model} in=${inTok}tok($${inUsd.toFixed(5)}) image=${outTok}tok($${imgUsd.toFixed(5)}) ~= $${total.toFixed(5)}`);
              if (opts.costAcc) { opts.costAcc.usd += total; opts.costAcc.images += 1; }
              logGeminiUsage("agents-ads-image", model, u, opts.costAcc?.jobId);
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
  return full
    .replace(
      /\nAssets:\n[\s\S]*?(?=\n\n|$)/,
      "\nAssets: Product and background reference images may be attached. The brand logo is NOT attached — do not attempt to draw it. NEVER render any URL, domain name, or file path as visible text.",
    )
    // The shared brand-consistency block tells the model to "use brand name text only" when no
    // logo asset is provided (correct for the HTML-render path, where the model draws real text).
    // In COMPOSE that instruction makes the image model DRAW the brand name into the background —
    // the exact "invented placeholder logo" bug. Compose backgrounds must be text/logo-free; the
    // real logo + copy are composited in a separate HTML layer afterwards. Neutralise the whole
    // logo-lock block for compose so it never asks the image model to render a mark or brand text.
    .replace(
      /- ABSOLUTE LOGO LOCK:[\s\S]*?(?=- CTA SYSTEM LOCK:)/,
      "- LOGO & COPY ARE COMPOSITED LATER: The brand logo and ALL text/copy are added in a separate HTML layer AFTER this background image. Do NOT draw the logo, any wordmark, monogram, symbol, seal, or the brand name as text anywhere in this image. Leave the reserved logo and text zones clean, blank and low-contrast — never fill them with an invented logo or brand-name text.\n",
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

LAYOUT FREEDOM: Choose varied text locations. Do not put every headline/subheadline/CTA in the same area. Prefer the strongest layout from: hero-full-bleed, top-image-bottom-text, centered-minimal, bold-headline-first, frame-product, top-left-editorial, top-right-editorial, bottom-right-editorial, vertical-story-stack, floating-islands. The Layout line should include one of these keys. DO NOT use diagonal-split or left-panel-right-image — those layouts are banned.
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
  "hero-full-bleed: product as full background, gradient overlay bottom 50%, text+CTA stacked bottom",
  "top-image-bottom-text: product image top 55% height, brand color panel bottom 45% with text+CTA",
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
  "top-image-bottom-text",
  "centered-minimal",
  "bold-headline-first",
  "frame-product",
  "top-left-editorial",
  "top-right-editorial",
  "bottom-right-editorial",
  "vertical-story-stack",
  "floating-islands",
] as const;
// Overlay DESIGN DIRECTION, rotated per job so ads don't all converge on the same look. Giving
// the model unstructured "full creative freedom" made it default to the same safe recipe every
// time (white bold text + trailing arrow + underline). Giving it one exact CSS recipe per job
// fixed the sameness but killed actual creativity — every ad became a literal instance of one of
// N templates. This version gives a MOOD/DIRECTION brief instead (like a real art director's
// reference), naming concrete techniques as OPTIONS to draw from rather than a forced recipe —
// the model still decides the specifics, it just isn't reaching for the same default every time.
const OVERLAY_STYLE_VARIANTS = [
  {
    name: "swiss-editorial",
    brief: "Channel Swiss/International Typographic Style: strict alignment (headline, subheadline and CTA all sharing ONE consistent left or right margin), confident bold sans-serif, generous whitespace, at most one thin rule line as the only decorative device, restrained single-accent-colour use. Precise and structured — like a well-designed print poster, not a busy app screen.",
  },
  {
    name: "bold-maximalist",
    brief: "Channel bold, energetic social-ad type: push the headline size toward the larger end of its range, give the single most impactful word real visual punch (colour, a highlight chip, or a scale/weight contrast — your choice), asymmetric confident placement rather than a perfectly centered grid. Still legible and uncluttered — bold, not busy.",
  },
  {
    name: "soft-refined",
    brief: "Channel a soft, refined, premium feel: generous line-height and letter-spacing, a lighter weight contrast between headline and subheadline, ONE understated accent device (a slim line, a muted tint, extra letter-spacing on a kicker) rather than a loud colour pop. Calm, confident, premium-lifestyle-brand energy.",
  },
  {
    name: "glass-digital",
    brief: "Channel a modern digital/glassmorphism feel: a frosted-glass scrim panel behind the text (backdrop-filter:blur + translucent tint), crisp modern sans type, an accent line or glow that feels slightly tech-forward. Fits a digital/social product — precise and current, not decorative.",
  },
  {
    name: "ugc-caption",
    brief: "Channel an authentic social-caption feel: text reads like a genuine creator's caption overlay laid over a photo — casual confident weight, tight natural grouping (not a rigid grid), the CTA reading like a natural sign-off line rather than a designed UI element. Human and premium-casual, not corporate.",
  },
] as const;

const BACKGROUND_DIRECTIONS = [
  "single hero subject in sharp focus on a clean backdrop, generous negative space, soft natural shadow",
  "editorial product scene, one clear subject off-center, gentle side lighting, simple uncluttered surroundings",
  "minimal brand-color backdrop with one strong focal element and a lot of calm empty space",
  "lifestyle detail shot, subject crisp and well-lit, natural negative space, understated tones",
  "macro product-inspired form, crisp focus on the subject, asymmetric composition, clean studio lighting",
  "bold simple composition, one large clear subject against a plain brand-color field, uncluttered",
  "subject with shallow depth-of-field falling off behind it only, clean foreground, calm background",
] as const;

// ── UGC auto-mode (external API, NO reference image) ─────────────────────────
// Builds a Pexels search query for a candid real person that fits the campaign, and fetches one
// person photo as base64. The compose re-lights/re-composes the person into the brand scene, so
// the exact stock photo only needs to provide a believable human subject. Returns null on any
// failure so the caller falls back to an invented-person prompt.
function buildUgcPersonQuery(data: AgentsAdsPayload["campaignData"]): string {
  const industry = String((data as any).businessCategory || "").trim();
  const audience = String((data as any).targetAudience || "").trim();
  const base = [industry, audience].filter(Boolean).join(" ").slice(0, 60);
  return (base ? base + " " : "") + "happy person candid lifestyle portrait";
}

// Context-aware Pexels query: turn the campaign into a short stock-photo search phrase for a REAL
// photograph that fits the topic (a person doing the activity, or the relevant object/scene). A real
// reference photo makes the image model REPRODUCE reality instead of INVENTING — and inventing is
// exactly what burns fake text/buttons/dashboards/logo-icons into the background. Returns '' on error.
async function pexelsQueryForCampaign(
  facts: string,
  apiKey: string,
  opts: { jobId?: number; costAcc?: { usd: number } } = {},
): Promise<string> {
  try {
    const res = await callGemini(
      [
        "You output a SHORT stock-photo search query (2 to 5 words) for a REAL photograph that best represents an advertising campaign's topic.",
        "Name a real, photographable scene: a person doing the relevant activity, or the key object/place. Examples: 'woman applying skincare', 'person holding smartphone', 'barista pouring coffee', 'modern apartment interior', 'runner on track at sunrise', 'bright smile dentist'.",
        "Prefer a REAL PERSON doing the activity when the topic naturally involves people. Keep it concrete and photographable — never abstract concepts, never brand names.",
        "Return ONLY the query words. No quotes, no punctuation, no explanation.",
      ].join("\n"),
      facts.slice(0, 1200),
      "gemini-2.5-flash",
      0.3,
      20,
      apiKey,
      undefined,
      undefined,
      opts,
    );
    return String(res.text || "").trim().replace(/^["']+|["']+$/g, "").replace(/[\r\n]+/g, " ").slice(0, 60);
  } catch (_) {
    return "";
  }
}

// Returns the chosen Pexels image URL (does NOT download it) so the URL can be fed through the
// IDENTICAL caller-reference_image path — set as referenceImageUrl + first in composeCompanyRefs and
// then fetched downstream exactly like any user-sent reference image (Diego etc.).
async function fetchPexelsUrl(query: string, aspectRatio: string): Promise<string | null> {
  try {
    const key = env?.get("PEXELS_API_KEY");
    if (!key) return null;
    const orientation = aspectRatio === "9:16" ? "portrait" : (aspectRatio === "1:1" ? "square" : "landscape");
    const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=20&orientation=${orientation}`;
    const res = await fetch(url, { headers: { Authorization: key }, signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const j = await res.json();
    const srcs = (Array.isArray(j?.photos) ? j.photos : [])
      .map((p: any) => p?.src?.large2x || p?.src?.large || p?.src?.original)
      .filter((s: unknown): s is string => typeof s === "string" && s.length > 0);
    if (!srcs.length) return null;
    return srcs[Math.floor(Math.random() * srcs.length)];
  } catch {
    return null;
  }
}

async function fetchPexelsPerson(
  query: string,
  aspectRatio: string,
): Promise<{ data: string; mimeType: string } | null> {
  try {
    const key = env?.get("PEXELS_API_KEY");
    if (!key) return null;
    const orientation = aspectRatio === "9:16" ? "portrait" : (aspectRatio === "1:1" ? "square" : "landscape");
    const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=20&orientation=${orientation}`;
    const res = await fetch(url, { headers: { Authorization: key }, signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const j = await res.json();
    const srcs = (Array.isArray(j?.photos) ? j.photos : [])
      .map((p: any) => p?.src?.large2x || p?.src?.large || p?.src?.original)
      .filter((s: unknown): s is string => typeof s === "string" && s.length > 0);
    if (!srcs.length) return null;
    const chosen = srcs[Math.floor(Math.random() * srcs.length)];
    const imgRes = await fetch(chosen, { signal: AbortSignal.timeout(12000) });
    if (!imgRes.ok) return null;
    const buf = await imgRes.arrayBuffer();
    if (buf.byteLength < 1000) return null;
    return { data: bytesToBase64(buf), mimeType: (imgRes.headers.get("content-type") || "image/jpeg").split(";")[0] };
  } catch {
    return null;
  }
}

// Extract the first font family name from a Google Fonts URL.
// e.g. "https://fonts.googleapis.com/css2?family=Poppins:wght@400;700" → "Poppins"
function extractFontFamilyFromUrl(url: string): string | null {
  try {
    const m = url.match(/[?&]family=([^:&+%]+(?:[+%20][^:&+%]*)*)/i);
    if (!m) return null;
    return decodeURIComponent(m[1]).replace(/\+/g, " ").trim();
  } catch { return null; }
}

function buildComposeCssVars(data: AgentsAdsPayload["campaignData"]): string {
  const parts: string[] = [];
  if (data.primaryColor) parts.push(`--primary:${data.primaryColor}`);
  const secondary = data.secondaryColor || data.accentColor;
  if (secondary) parts.push(`--secondary:${secondary}`);
  if (data.accentColor) parts.push(`--accent:${data.accentColor}`);
  const fontUrlDirect = String((data as any).fontUrl || "").trim();
  const font = data.customHeadingFontName || data.headingFont
    || (fontUrlDirect ? extractFontFamilyFromUrl(fontUrlDirect) : null);
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

  const fontUrlDirect = String((data as any).fontUrl || "").trim();
  const font = data.customHeadingFontName || data.headingFont;
  const fontUrl = fontUrlDirect
    || (font ? `https://fonts.googleapis.com/css2?family=${encodeURIComponent(String(font)).replace(/%20/g, "+")}:wght@400;700;900&display=swap` : "");

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

// COHESIVE TEXT BLOCK MODEL.
// Earlier each text part (headline / sub / cta) was an independent absolutely-positioned
// element with its own fixed top/bottom anchor — which flung them apart ("title up top,
// CTA at the bottom, sub floating in the middle"). Now a layout only decides WHERE a single
// text block sits (`block` = the anchor rectangle for a flex column) and how it aligns
// (`align`). Headline, sub and CTA always render together inside that block with controlled
// gaps, so they read as one cohesive ad — varied by zone across layouts, never scattered.
type LayoutPosition = {
  logo: string;   // absolute anchor for the logo / brand name
  block: string;  // absolute anchor rectangle for the headline+sub+cta flex column
  align: "left" | "center" | "right";
};

const LAYOUT_POSITIONS: Record<string, LayoutPosition> = {
  // text block sits on the LEFT, vertically centered, product on the right
  "diagonal-split": {
    logo:  "top:6%;left:6%;width:30%;max-height:14%;",
    block: "left:6%;right:50%;top:50%;transform:translateY(-50%);",
    align: "left",
  },
  // text block hugs the BOTTOM edge as one stack
  "hero-full-bleed": {
    logo:  "top:5%;left:5%;width:28%;max-height:12%;",
    block: "left:5%;right:5%;bottom:7%;",
    align: "left",
  },
  // text block hugs the BOTTOM (product fills the top)
  "top-image-bottom-text": {
    logo:  "top:5%;left:5%;width:26%;max-height:11%;",
    block: "left:5%;right:5%;bottom:6%;",
    align: "left",
  },
  // text block on the LEFT panel, vertically centered
  "left-panel-right-image": {
    logo:  "top:6%;left:4%;width:30%;max-height:14%;",
    block: "left:4%;right:54%;top:50%;transform:translateY(-50%);",
    align: "left",
  },
  // text block centered both ways
  "centered-minimal": {
    logo:  "top:6%;left:50%;transform:translateX(-50%);width:26%;max-height:12%;",
    block: "left:8%;right:8%;top:50%;transform:translateY(-50%);",
    align: "center",
  },
  // text block near the TOP, below the logo
  "bold-headline-first": {
    logo:  "top:5%;right:5%;width:22%;max-height:10%;",
    block: "left:5%;right:5%;top:19%;",
    align: "left",
  },
  // text block centered along the BOTTOM inside a framed product
  "frame-product": {
    logo:  "top:6%;left:50%;transform:translateX(-50%);width:28%;max-height:13%;",
    block: "left:6%;right:6%;bottom:6%;",
    align: "center",
  },
  // editorial: text block in the TOP-LEFT quadrant
  "top-left-editorial": {
    logo:  "top:5%;left:5%;width:26%;max-height:11%;",
    block: "left:5%;right:40%;top:21%;",
    align: "left",
  },
  // editorial: text block in the TOP-RIGHT quadrant
  "top-right-editorial": {
    logo:  "top:5%;right:5%;width:24%;max-height:11%;",
    block: "left:42%;right:5%;top:21%;",
    align: "right",
  },
  // editorial: text block in the BOTTOM-RIGHT quadrant
  "bottom-right-editorial": {
    logo:  "top:5%;left:5%;width:24%;max-height:11%;",
    block: "left:42%;right:5%;bottom:7%;",
    align: "right",
  },
  // story: cohesive left stack, vertically centered
  "vertical-story-stack": {
    logo:  "top:5%;left:6%;width:24%;max-height:10%;",
    block: "left:6%;right:10%;top:50%;transform:translateY(-50%);",
    align: "left",
  },
  // text block hugs the BOTTOM-LEFT
  "floating-islands": {
    logo:  "top:5%;left:5%;width:24%;max-height:10%;",
    block: "left:6%;right:6%;bottom:7%;",
    align: "left",
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

// Approximate a hex color with a plain English name so the background prompt can convey
// the brand palette WITHOUT ever feeding a raw "#hex" string the model might render as text.
function describeHexColor(hex: string): string {
  // Accepts #rgb / #rrggbb / #rrggbbaa so the background-prompt scrub can name every hex form
  // it finds in the wild (alpha is dropped — it says nothing about the hue).
  const raw = (hex || "").trim().replace(/^#/, "");
  const m = /^([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(raw);
  if (!m) return "";
  const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw.slice(0, 6);
  const r = parseInt(full.slice(0, 2), 16) / 255, g = parseInt(full.slice(2, 4), 16) / 255, b = parseInt(full.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  let h = 0;
  if (d) { if (max === r) h = ((g - b) / d) % 6; else if (max === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  // A very dark colour reads as black whatever its HSL "saturation" says (#161202 computes as
  // 83% saturated, but the eye just sees near-black — calling it "very dark amber" invited a
  // brown-olive accent that is not what the brand ships).
  if (l < 0.10) return "near-black";
  if (s < 0.12) return l < 0.22 ? "near-black" : l < 0.45 ? "charcoal gray" : l > 0.82 ? "off-white" : "light gray";
  const light = l < 0.22 ? "very dark " : l < 0.4 ? "dark " : l > 0.82 ? "very light " : l > 0.62 ? "light " : "";
  // A brand colour is usually a PURE one. Without this the model renders a tastefully muted
  // version of the right hue and the ad reads off-brand.
  const punch = (!light && s >= 0.85) ? "vivid " : "";
  // YELLOW HAS ITS OWN BAND. Lumping 45°-70° into "amber" is what turned #fee701 (hue 55° —
  // a vivid yellow) into a warm orange-amber grade: the brand was handed to the image model
  // under the wrong colour NAME, which is the only colour channel it gets (hex is scrubbed).
  const hue = (h < 15 || h >= 345) ? "red" : h < 40 ? "orange" : h < 50 ? "amber" : h < 66 ? "yellow" : h < 80 ? "lime" : h < 160 ? "green" : h < 200 ? "teal" : h < 255 ? "blue" : h < 290 ? "violet" : h < 330 ? "magenta" : "pink";
  return (light + punch + hue).trim();
}

// The image model can only paint a brand name it was handed. RULE #1 forbids drawing it, but the
// word still reached the prompt 25 times for one company (theme-scene line + the company-profile
// JSON) and came back burned into the background as a garbled "<Brand> vs aglencies". A background
// never needs the name — the real logo is composited on top afterwards. Nothing brand-specific
// here: the names come from this request's own facts.
function stripBrandNameForBg(text: string, names: (string | undefined)[]): string {
  let out = String(text || "");
  for (const raw of names) {
    const name = String(raw || "").trim();
    // Under 4 chars is too likely to collide with an ordinary word to replace safely.
    if (name.length < 4) continue;
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`\\b${esc}\\b`, "gi"), "the brand");
  }
  return out;
}

// CRC32 (PNG chunk checksums).
const CRC32_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC32_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Builds a flat swatch of the brand's colour as a PNG, to attach as a reference image.
// WHY: the hex is deliberately scrubbed from the prompt text (the model paints "#fee701" as
// characters), so a colour NAME is the only channel the words have — and a name is an
// approximation: #fee701 described as "vivid yellow" landed on the canvas as #dcb744. Pixels are
// exact where prose cannot be. Generic by construction — it renders whatever primaryColor arrived
// in this request, so every brand gets its own colour and none is hard-coded.
// Deliberately tiny (96px, a few hundred bytes) so it adds no meaningful resource pressure to the
// worker — unlike another full-size brand post, which is what the 546 limit reacts to.
async function makeSolidColourPng(hex: string, size = 96): Promise<string> {
  const raw = (hex || "").trim().replace(/^#/, "");
  const m = /^([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(raw);
  if (!m) return "";
  const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
  const r = parseInt(full.slice(0, 2), 16), g = parseInt(full.slice(2, 4), 16), b = parseInt(full.slice(4, 6), 16);

  // Raw scanlines: one filter byte (0 = None) then RGB triplets.
  const stride = size * 3 + 1;
  const rawData = new Uint8Array(stride * size);
  for (let y = 0; y < size; y++) {
    const off = y * stride;
    for (let x = 0; x < size; x++) {
      const p = off + 1 + x * 3;
      rawData[p] = r; rawData[p + 1] = g; rawData[p + 2] = b;
    }
  }
  // CompressionStream("deflate") emits a zlib stream — exactly what PNG's IDAT expects.
  const cs = new CompressionStream("deflate");
  const writer = cs.writable.getWriter();
  writer.write(rawData);
  writer.close();
  const idat = new Uint8Array(await new Response(cs.readable).arrayBuffer());

  const chunk = (type: string, data: Uint8Array): Uint8Array => {
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const idv = new DataView(ihdr.buffer);
  idv.setUint32(0, size);
  idv.setUint32(4, size);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 2;   // colour type 2 = truecolour RGB
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", new Uint8Array(0)),
  ];
  const png = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { png.set(p, o); o += p.length; }
  let bin = "";
  for (let i = 0; i < png.length; i++) bin += String.fromCharCode(png[i]);
  return btoa(bin);
}

// Strip anything the image model could copy verbatim as text into a "zero-text" background:
// hex codes, CSS variable tokens/declarations, var(), URLs, font-URL lines. Used ONLY for the
// background image prompt — the HTML overlay still gets the real hex via cssVars.
function scrubBgPromptText(text: string): string {
  return String(text || "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\bBRAND_FONT_URL\b\s*:?[^\n]*/gi, "")
    .replace(/\bBRAND_CSS_VARS\b\s*:?/gi, "Brand palette:")
    // CSS layout fragments from the creative plan (HTML-oriented) that the image model would
    // otherwise draw as literal text in the background.
    .replace(/clip-path\s*:[^;\n}]*/gi, "")
    .replace(/\b(?:polygon|inset|circle|ellipse|calc|translate[xyz]?|rotate|scale|matrix|linear-gradient|radial-gradient)\s*\([^)]*\)/gi, "")
    .replace(/\brgba?\([^)]*\)/gi, "")
    .replace(/var\(\s*--[a-z0-9-]+\s*\)/gi, "")
    .replace(/--[a-z0-9-]+\s*:/gi, "")
    // Generic CSS declarations carrying units (font-size:48px, top:60px, width:30%, etc.).
    .replace(/\b[a-z-]{3,}\s*:\s*[^;\n}]*?\d(?:px|%|em|rem|deg|vh|vw|fr|cqw|cqh)[^;\n}]*/gi, "")
    // A raw hex must never reach the image model (it paints "#fee701" into the banner as literal
    // text). Deleting it, though, left every structured colour slot EMPTY — "Brand palette: ;;;"
    // and "Colors: primary:  → dominant element" — so the only colour statement with any textual
    // weight left in the prompt was whatever prose the brief carried, and a market reference's
    // navy/coral could out-argue a brand whose colour is amber. Substitute the plain-English NAME
    // instead: the slots keep pointing at the real brand colour and nothing renderable survives.
    .replace(/#[0-9a-f]{3,8}\b/gi, (m) => describeHexColor(m) || "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Hue words that must not survive inside a PROXY brief. Deliberately hue-only: material and
// finish words that double as props in a structural description (stone, slate, sand, sage,
// bronze, copper, brass, silver, jade) are left alone so the layout prose stays intact.
const BRIEF_COLOUR_TERMS = [
  "greyscale", "grayscale", "monochrome", "duotone", "sepia",
  "turquoise", "terracotta", "burgundy", "lavender", "charcoal", "magenta", "fuchsia",
  "mustard", "emerald", "crimson", "scarlet", "apricot", "salmon", "golden", "maroon",
  "indigo", "violet", "purple", "orange", "yellow", "cobalt", "azure", "cyan", "aqua",
  "lilac", "mauve", "blush", "peach", "plum", "coral", "navy", "teal", "olive", "khaki",
  "beige", "taupe", "cream", "ivory", "ochre", "mint", "lime", "green", "brown", "black",
  "grey", "gray", "gold", "amber", "pink", "blue", "red", "tan",
];
const BRIEF_COLOUR_RE = new RegExp(`\\b(?:${BRIEF_COLOUR_TERMS.join("|")})\\b`, "gi");

// Neutralise the colour CLAIMS of a market-reference brief without losing its structure.
//
// A proxy brief profiles COMPETITOR material: its layout is exactly what we want, its colour is
// exactly what we don't. The existing one-line COLOUR CARVE-OUT ("ignore every colour above")
// loses to 300+ words of vivid colour prose — that is how "a deep, sophisticated navy accented
// by a warm, energetic coral" beat a single "the DOMINANT background color is amber" line and
// produced a navy ad for a #fee701 brand. Rather than argue with the prose after the fact, the
// colour is taken out of it: every hue word becomes "brand-coloured", which POINTS AT the BRAND
// COLORS line instead of contradicting it, while "flat, rich … field" and every other structural
// claim survives word for word. This also fixes briefs ALREADY STORED with competitor colour —
// they are neutralised on read, with no regeneration needed.
function stripColourFromBrief(text: string): string {
  const src = String(text || "").trim();
  if (!src) return "";
  return src
    .replace(/#[0-9a-f]{3,8}\b/gi, "brand-coloured")
    .replace(BRIEF_COLOUR_RE, "brand-coloured")
    // "white space" / "whitespace" is a layout term, not a colour claim — leave it alone.
    .replace(/\bwhite\b(?!\s*space)/gi, "brand-coloured")
    // "navy blue", "black and white" → one token, not a stutter.
    .replace(/brand-coloured(?:[\s,]+(?:and\s+|or\s+)?brand-coloured)+/gi, "brand-coloured")
    // The reference's colour ADJECTIVES outlive its colour nouns, and they keep steering the
    // brand's own colour: "a deep, sophisticated navy" became "a deep, sophisticated
    // brand-coloured", which darkened a vivid yellow into a muted amber grade and fought the
    // "do not mute, grey-out or darken it" rule on the BRAND COLORS line. Intensity and mood
    // qualifiers sitting directly on the token describe the COMPETITOR's colour, not this
    // brand's — drop them. Structural words (flat, layered, solid…) are not in this list and
    // survive: "a flat, rich brand-coloured field" → "a flat, brand-coloured field".
    .replace(/(?:\b(?:very\s+)?(?:deep|deeper|dark|darker|rich|richer|muted|dusty|moody|sombre|somber|subdued|desaturated|washed[-\s]out|faded|pale|soft|softer|light|lighter|warm|warmer|cool|cooler|sophisticated|understated|earthy|smoky|dull)\b[,\s]+)+(?=brand-coloured)/gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
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
  visualBrief: string = "",
  heroRef: boolean = false,
  productRef: boolean = false,
  ugcNoRef: boolean = false,
  themeScene: string = "",
  castingRef: boolean = false,
  hasBrandPosts: boolean = false,
  // The images in brand_posts are NOT this brand's — they are market/category reference (used when
  // the client's own Instagram is empty). Use their STRUCTURE, never their IDENTITY. Default false
  // = today's behaviour, unchanged, for every client with a real profile.
  brandPostsAreProxy: boolean = false,
  // Proxy mode only: the leading `siteRefCount` reference images are the client's OWN website —
  // the sole source of brand colour/identity. When set, the colour rule and the company source
  // block point at the site instead of falling back to a neutral (colourless) treatment.
  hasSiteIdentity: boolean = false,
  siteRefCount: number = 0,
  // A flat swatch of this brand's own colour was APPENDED as the LAST reference image. It exists
  // because the hex is scrubbed from this text (the model would paint the characters), leaving a
  // colour NAME as the only channel — and a name is an approximation. The swatch carries the
  // payload's colour as pixels, which the model can match instead of interpret.
  hasColourSwatch: boolean = false,
  // Proxy mode only: whether the competitor post IMAGES are actually attached. They are now
  // withheld from the image model (they are ads — traceable headlines and wordmarks), so the role
  // sentences must stop describing images that are not there. The competitor's STRUCTURE still
  // reaches the model, as prose, via the brief.
  competitorRefsPresent: boolean = true,
): string {
  const layout = resolveCompositionLayout(spec, layoutKey, forceLayout);
  const spaceGuide = CREATIVE_SPACE_GUIDANCE[layout] ?? CREATIVE_SPACE_GUIDANCE["hero-full-bleed"];
  const direction = visualDirection || BACKGROUND_DIRECTIONS[0];
  // Theme scene (derived per-job from the campaign topic): the concrete SETTING/PROPS/ACTION
  // this ad should depict. Placed into the person/subject blocks below so the hero (the
  // reference person, when heroRef) is put INTO a scene that matches THIS ad's theme, instead
  // of defaulting to the same content-creator / ring-light scene for every campaign.
  const scene = String(themeScene || "").trim();

  // ── SHORT PATH: reference mode with actual reference images ─────────────
  // When the caller sent reference images to match, the model needs a SHORT focused prompt —
  // not 600 words of creative direction competing with the visual. The images (sent first in
  // the parts array) ARE the brief. Everything else just defines the text-safe zone and the
  // zero-text rule. Long prompts here cause the model to prioritize text over visuals and
  // produce generic AI-looking output instead of following the reference.
  if (bgSource === "reference" && hasRefImages) {
    const pos = LAYOUT_POSITIONS[layout] ?? LAYOUT_POSITIONS["hero-full-bleed"];
    const overlayLine = `RESERVE TEXT SPACE (composited on top later — keep it calm and contrast-friendly, NOT empty): keep the logo corner and the main text-block area calm and uncluttered. Those areas must stay TEXT-FREE and LOGO-FREE — draw no words, wordmarks, icons, UI, or any bracketed coordinates/CSS/percentages there.`;
    return [
      PRIMARY_BG_RULE,
      "TASK: The image(s) attached are the visual reference. Recreate their aesthetic as a background for an advertising creative — same style, composition, lighting, color temperature, texture, and photographic quality.",
      "Adapt framing to fit the target aspect ratio. Do NOT invent a new scene. Stay in the exact visual world shown.",
      "",
      "MATCH RULES:",
      "• Preserve the photographic realism of the reference — if it's a real photo, keep it photorealistic. Do NOT stylize, paint, or add AI textures.",
      "• Keep the palette and lighting of the reference. Adapt color balance only if needed for legibility.",
      "• Remove any text, logo, watermark or UI from the reference — all surfaces must be clean.",
      "• Reframe/extend to fit the aspect ratio while keeping the visual energy of the original.",
      "",
      overlayLine,
      "",
      "ZERO-TEXT & ZERO-CODE RULE — NO EXCEPTIONS:",
      "❌ No text, letters, numbers, hex codes, URLs, or any alphanumeric character anywhere in the image.",
      "❌ No logo, wordmark, icon, or placeholder. No button shapes or UI elements.",
      "❌ Any product label, package, bottle, or object must have a completely BLANK surface.",
      "",
      `FORMAT: ${format.width}×${format.height}px | Aspect ratio: ${aspectRatio}`,
      "",
      "OUTPUT: Pure visual background — text-free, logo-free, UI-free.",
    ].filter(Boolean).join("\n");
  }

  // Brand visual identity brief — a text description of the brand's design language
  // (motifs, textures, depth treatment, design flourishes) extracted ONCE from the
  // reference images. Drives creative freedom without re-sending raw pixels every time.
  // The brief is written FROM the brand posts. When those posts are a proxy, every identity claim
  // in it (colour above all) describes the reference, not this brand — and the normal framing
  // ("this brand's signature visual DNA", "embody ... color treatment", "absolute precedence")
  // would push the reference's colours into the background hard enough to beat colorLine. So the
  // proxy variant reframes the block as structure-only and carves colour out explicitly, keeping
  // the composition/motif/depth guidance, which is the whole point of using the reference.
  const briefBlock = !String(visualBrief || "").trim()
    ? ""
    : brandPostsAreProxy
    ? [
        "████ MARKET REFERENCE — STRUCTURE ONLY, NOT THIS BRAND'S IDENTITY ████",
        "The following describes the visual design language of MARKET/CATEGORY REFERENCE material. It is NOT this brand's identity — this brand's own profile was unavailable. Use it ONLY for structure: composition, layout, motifs, depth, layering, texture and finish.",
        stripColourFromBrief(visualBrief),
        "⛔ COLOUR CARVE-OUT: the block above has had every colour name REMOVED — each 'brand-coloured' in it is a placeholder meaning 'use the colour from the BRAND COLORS line'. It describes STRUCTURE ONLY. Do not infer, reconstruct or invent what the reference's original colours might have been; there is no colour information in it at all. Colour comes EXCLUSIVELY from the BRAND COLORS line. Any typography, logo or brand-name claim above is reference-only and must never be treated as this brand's identity.",
      ].join("\n")
    : [
        "████ BRAND VISUAL IDENTITY — EMBODY THIS DESIGN LANGUAGE ████",
        "The following describes this brand's signature visual DNA (extracted from its Instagram profile analysis and brand guidelines stored in the company profile). Make the background unmistakably feel like THIS brand:",
        String(visualBrief).trim(),
        "BRAND_DNA takes absolute precedence over any creative instinct — embody these specific design devices (motifs, depth, layers, textures, color treatment) in the background. LAYOUT_INSPIRATION may inform composition structure but must never bleed into brand identity.",
      ].join("\n");

  // Source-specific guidance for HOW to treat (or not) the attached reference images.
  let sourceBlock = "";
  if (bgSource === "reference" && hasRefImages) {
    sourceBlock = [
      "████ BACKGROUND SOURCE: USER REFERENCE — MATCH IT CLOSELY ████",
      "The attached image(s) are the EXACT look the user wants this ad to resemble. Treat them as the authoritative visual basis:",
      "• Match their composition, layout balance, subject placement, color mood, lighting, materials and overall style as closely as possible.",
      "• Adapt only what is needed: reframe/extend for the target aspect ratio and open up the reserved text-safe zone.",
      "• Do NOT invent an unrelated scene and do NOT drift to a generic stock look. The result must clearly read as the same visual world the user provided.",
      "• BUT reproduce only the VISUAL STYLE — never copy any text, headline, price, logo, wordmark or watermark that appears in the reference. Those are added later as a clean overlay. Any surface stays blank.",
    ].join("\n");
  } else if (bgSource === "company" && hasRefImages) {
    sourceBlock = [
      "████ BACKGROUND SOURCE: COMPANY BRAND POSTS — STYLE REFERENCE ONLY ████",
      "The attached image(s) are this brand's own social posts. Use them ONLY to learn the brand's DESIGN STYLE. They are a style guide, NOT a source of subject matter.",
      "",
      "⛔⛔ CRITICAL — NO RECYCLED PEOPLE: if any of these posts shows a specific person (a founder, employee, model, or customer), that person belongs to THAT post's topic and MUST NOT appear in this ad — not their face, not their body, not a recognizable likeness, even partially. This ad needs its OWN subject built specifically for THIS campaign's topic (see CAMPAIGN CONTEXT below), never a face reused from an unrelated post just because it's available. If you are unsure whether a figure would be recognizable as 'the person from that other post', leave people out of the scene entirely and use an object/product/abstract scene instead — that is always safer than recycling someone out of context.",
      "",
      "KEEP THE BRAND IDENTITY (this is what makes the ad feel like theirs):",
      "• Color palette and grading, lighting mood, contrast level",
      "• Photographic / rendering treatment — how subjects are captured or rendered (photoreal, 3D, flat, cutout, etc.)",
      "• Composition language, use of negative space, and overall premium finish",
      "• Their signature brand devices (e.g. a brand-color panel/diagonal field, or a characteristic motif) — these SHOULD appear so the ad is recognizably theirs.",
      "",
      "CALIBRATE THE DECORATION TO MATCH THE POSTS' OWN DENSITY — CAMOUFLAGE, NOT A FIXED RESTRAINT:",
      "• First JUDGE how heavily the brand decorates ITS OWN posts with a graphic design-asset layer (floating dots/particles/halftone, organic blobs, colour panels/diagonal fields, rings, stars, icons, badges, confetti). This ad must land at the SAME point on that density scale. The test: if THIS ad were dropped into the brand's feed, it should blend in as just one more of their posts — that is the goal (CAMOUFLAGE).",
      "• IF the posts are RICHLY decorated with a busy floating design-asset layer → REPRODUCE that same busy layer here: the SAME kinds of devices, the SAME colours, and the SAME abundance/density and placement energy. Do NOT tone it down, do NOT reduce it to a single subtle motif — matching the richness is the whole point; a clean ad sitting next to busy brand posts reads as off-brand and is the failure you are fixing.",
      "• IF the posts are CLEAN / minimal (few or no floating devices) → keep this ad clean too, at most a small brand cue. Never impose a busy design language a brand does not actually use.",
      "• Whatever the density: place devices in EMPTY areas only (never over the face, the hero subject, the reserved text zone or the logo) and put ZERO text/letters/logo inside any device. Density mirrors the posts; legibility is never sacrificed.",
      "",
      "DO NOT TAKE FROM THE REFERENCES:",
      "• Their subject matter, objects, scenes, vehicles, people or props — each post's topic belongs to THAT post, never to this ad.",
      "• ⛔ THE BRAND LOGO / WORDMARK. The reference posts contain the brand's logo — that is NOT a design element for you to reproduce. NEVER draw, redraw, trace, recreate or place the logo, wordmark, brand name or any version of it anywhere in the image (not on the wall, not on a screen, not floating, not as a watermark). The real logo is composited separately on top afterwards. Any logo you draw makes it appear TWICE and ruins the ad. Treat the logo as something to OMIT entirely.",
      "",
      "THE SUBJECT OF THIS AD COMES FROM THE CAMPAIGN — NOT THE REFERENCES:",
      "• Build ONE clear hero subject that visually represents THIS campaign's product/service and topic (see CAMPAIGN CONTEXT below), rendered in the brand's color/lighting/photographic style.",
      "• Example: the brand's posts are about cars but this campaign is social-media management → show a relevant content/social scene (e.g. a laptop with an analytics dashboard, a tidy content workspace) in the brand's style — NOT a car.",
      scene
        ? `• THE SCENE FOR THIS AD (derived from THIS campaign's topic): ${scene} — build exactly this, rendered in the brand's colors/lighting. Do NOT reuse a content-creator / ring-light / phone-filming scene unless the topic is literally about creating social content.`
        : "• Build the ONE concrete scene that makes THIS campaign's specific topic instantly recognizable from the image alone — the real environment, prop and activity of the topic, never a generic desk/office scene that could belong to any industry.",
      "• The subject must be relevant and in sharp focus; the brand style only dictates HOW it looks, not WHAT it is.",
      "",
      "Compose fresh for this format. The image must be ENTIRELY TEXT-FREE and ENTIRELY LOGO-FREE.",
    ].join("\n");
    // PROXY MODE: the attached images are NOT this brand's own posts — the leading ones are the
    // client's own website (identity/colour), the rest are competitor posts (structure only). The
    // generic company block above tells the model to KEEP the posts' palette/identity, which for
    // competitor posts is exactly wrong. Prepend a hard override so the roles are unambiguous.
    if (brandPostsAreProxy) {
      sourceBlock = [
        "████ REFERENCE ROLES — PROXY MODE (READ FIRST, OVERRIDES EVERYTHING BELOW) ████",
        !competitorRefsPresent
          ? `${hasSiteIdentity ? `ALL ${Math.max(1, siteRefCount)} attached reference image(s) are the CLIENT'S OWN WEBSITE — the source of this brand's COLOUR, mood and identity. Colour-grade the WHOLE scene to match them. ` : ""}⛔ NO COMPETITOR IMAGE IS ATTACHED. The market's layout conventions reach you ONLY as the written brief further below — as words, never as pixels. So there is nothing here to copy, trace or echo: no competitor headline, wordmark, logo, caption or colour exists in your inputs. Build THIS brand's own ad from the written structure plus the client's identity.`
          : hasSiteIdentity
          ? `The FIRST ${Math.max(1, siteRefCount)} attached image(s) are the CLIENT'S OWN WEBSITE — the source of this brand's COLOUR, mood and identity. Colour-grade the WHOLE scene to match them. The OTHER attached images are MARKET/COMPETITOR references: draw on their COMPOSITION, LAYOUT and creative energy — INCLUDING design-asset ideas when they make the ad stronger — but REINTERPRET all of it in the CLIENT's OWN identity (the site's colours and feel). Take NONE of the competitor's colour, palette, logo, wordmark or literal identity.`
          : "The attached images are MARKET/COMPETITOR references, NOT this brand's own posts. Draw on their COMPOSITION, LAYOUT and creative energy (including design-asset ideas when they help), but REINTERPRET everything in THIS brand's own colours (from the BRAND COLORS line below). Take NONE of the competitor's colour, palette, logo or literal identity.",
        `⭐ DECORATION — REINTERPRET, DON'T COPY (this is the fix for the 'pasted-on CSS-overlay' look): a graphic design-asset layer (floating dots, halftone, blobs, colour panels, rings, stars, badges) is WELCOME when it strengthens the ad${competitorRefsPresent ? " — the competitor refs are here partly as creative fuel for it" : " — build it from the devices the written brief describes"}. BUT: (1) render every device in the CLIENT's colours (site / BRAND COLORS), NEVER the competitor's; (2) INTEGRATE it into the scene — grade it with the scene's light and depth so it feels native to this image, NOT a flat sticker layer floating disconnected on top; (3) do NOT slavishly 'camouflage into the competitor's feed' or match their exact devices/colours/density — you are building THIS brand's OWN identity, not reproducing the competitor. Keep it tasteful and legible: devices in empty areas only, ZERO text/letters/logo inside them.`,
        `So when the block below says to keep 'the brand's' palette / grading / identity / decoration, that means the CLIENT SITE (or the BRAND COLORS line) — NEVER the competitor${competitorRefsPresent ? " posts" : " described in the brief"}.`,
        "",
        sourceBlock,
      ].join("\n");
    }
  } else if (bgSource === "inspired") {
    sourceBlock = [
      "████ BACKGROUND SOURCE: INSPIRED BY REFERENCE — CREATIVE FREEDOM ████",
      hasRefImages
        ? "The attached image is a creative reference for this ad. You have FULL creative freedom to decide how to use it — you are NOT required to reproduce it:"
        : "You have FULL creative freedom to design the strongest possible background for this ad.",
      hasRefImages ? "• Adopt its color temperature and lighting mood as an emotional anchor" : "",
      hasRefImages ? "• Mirror its compositional energy (depth, subject placement, visual weight)" : "",
      hasRefImages ? "• Extract a texture, material quality, or visual motif and reinterpret it in this brand's language" : "",
      hasRefImages ? "• Or take only its overall atmosphere and invent an original scene that shares that spirit" : "",
      hasRefImages ? "The goal is an ORIGINAL background that carries the energy of the reference while being unmistakably this brand's own creative." : "",
      "Let the brand visual identity (described above in the brand brief) define the brand language; let the reference image define the creative direction for this specific ad.",
    ].filter(Boolean).join("\n");
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

  // HERO REFERENCE OVERRIDE: the caller explicitly sent a reference image they want FEATURED
  // (composeHeroRef). This replaces the default "style only / creative freedom / don't copy"
  // guidance — the FIRST attached image is the hero subject and must visibly appear in the ad.
  if (heroRef && hasRefImages) {
    sourceBlock = [
      castingRef
        ? "████ BACKGROUND SOURCE: CASTING REFERENCE — RE-STAGE THIS PERSON IN A BRAND-DESIGNED SCENE ████"
        : "████ BACKGROUND SOURCE: HERO REFERENCE — FEATURE THIS PERSON IN A UGC SCENE ████",
      castingRef
        ? "The FIRST attached image is a CASTING reference — a stock photo showing the TYPE of person (age, vibe, energy) to feature. Use a similar-looking believable person, but you do NOT need pixel-exact identity, and you MUST NOT reproduce the stock photo's background/setting — that stock scene is casting only, not the ad."
        : "The FIRST attached image is the HERO of this ad — a real person the user chose on purpose. They MUST appear, recognizably, in the final creative. This is NOT style inspiration.",
      "⭐⭐ ONE COHESIVE SCENE ABOUT THE TOPIC — THE MOST IMPORTANT RULE: do NOT take the person and drop them onto a generic or unrelated background. Build a SINGLE, unified photograph where the person, the setting, the props and the brand style all BELONG TOGETHER and all relate to THIS ad's topic (see the CAMPAIGN CONTEXT / THEME SCENE below). The person must be genuinely INSIDE the scene — same light, depth and perspective as the environment, interacting with it — NEVER a cut-out floating on a separate backdrop. ⛔ COLOUR: grade the WHOLE image (person + scene) in the BRAND's colour palette so the brand colour dominates — do NOT let the person's clothing colour or any incidental colour from the reference set the palette (e.g. a teal/blue outfit must NOT turn the ad teal; re-grade it into the brand colour). Every object and surface in the frame should make sense for the campaign's subject. A person + a random office/gradient that ignores the topic, or a person that looks pasted on, is a FAILURE — it must read as one real photo shot for THIS specific campaign.",
      castingRef
        ? "• RE-STAGE, don't reproduce: build a FRESH, premium BRAND-DESIGNED composition around a similar person who is ACTIVELY DOING what THIS campaign is about — the specific activity, props and setting of the topic (see the THEME SCENE / CAMPAIGN CONTEXT below). ⛔ NOT a generic person just sitting or smiling in a plain office; the scene must instantly read as the campaign's actual topic. It's an art-directed brand ad, NOT the reproduced stock photo. The person is believable, well-lit, and visibly engaged in the topic's activity; the environment is newly designed in the brand's visual world."
        : "• PRESERVE THEIR IDENTITY: same face, hair, beard, skin tone, body and overall look as the reference. It must clearly read as the SAME person. Do not swap them for a different model.",
      "• DO NOT paste them as a flat studio cut-out on a plain colour field. Instead, place them inside an AUTHENTIC, DYNAMIC UGC 'SCENE OF SUCCESS' with natural candid energy, real depth and foreground/background layers — like a great UGC ad, not a corporate headshot.",
      scene
        ? `• ⭐⭐ PLACE THIS PERSON INTO THIS EXACT SCENE, built for THIS campaign's topic: ${scene}. Their setting, props, action and body-language must be exactly what THIS scene calls for. The person is CASTING — the believable face performing THIS campaign's topic — NOT a generic 'person looking at a tablet/chart', and NOT the scene from the reference image's own background. A phone/device appears ONLY if THIS scene genuinely calls for one.`
        : "• ⭐⭐ THE PERSON IS CASTING, NOT THE PRODUCT: put them in the ONE specific action/prop/pose that makes THIS campaign's topic (see CAMPAIGN CONTEXT) instantly recognizable — the real activity of the topic, never a generic 'person looking thoughtfully at a tablet/chart' that could illustrate any business. A phone/device is NOT a default prop; most topics have nothing to do with phones. Derive the pose and prop from THIS topic alone.",
      "⛔⛔ DO NOT REUSE THE SAME POSE OR PROP ACROSS DIFFERENT TOPICS: a pose or object that worked for a PREVIOUS campaign (e.g. 'arm extended, holding phone up, filming/selfie' for content-creation) is ONLY correct for that specific kind of topic. If THIS campaign's topic is something else, that exact pose/prop is WRONG regardless of how well it worked before — invent the pose and prop that THIS specific topic actually calls for from scratch. If the topic has no natural connection to a phone or screen at all, there should be NO phone or screen in the scene.",
      "• Light and colour-grade the whole scene in THIS brand's palette so the brand colours clearly dominate the environment.",
      "• The person fills a large part of the frame, sharp and well-lit, as the unmistakable focal point; the scene supports them.",
      castingRef ? "• BRAND-DESIGN the frame so it reads as a designed brand ad, not a stock photo with a logo slapped on. STUDY the attached brand posts (the other images) and match their creative ENERGY — colour grade, composition, boldness — so this ad clearly belongs to the SAME family. Apply a strong on-brand colour grade over the WHOLE scene and give it generous brand-colour negative space. ⭐ DESIGN-ASSET LAYER — ONLY IF THE BRAND USES ONE: judge from the attached brand posts whether the brand decorates its posts with graphic overlays (floating dots/halftone, blobs, colour panels, rings, stars, icons/badges). IF YES, replicate that same layer here in the SAME devices, SAME colours AND SAME DENSITY/ABUNDANCE the posts use — if they are heavily decorated, decorate this ad just as heavily so it CAMOUFLAGES into their feed as one more of their posts; NEVER water a busy layer down to a single subtle motif. Float them over the scene, clearly decorative, in empty areas only (never over the face or text zone), ZERO text/logo inside. IF the brand's posts are clean without such overlays, add NONE. Mirror what the posts actually do — never invent a design language the brand lacks. Be genuinely creative and dynamic — a bold, art-directed composition, NOT a flat centered stock photo." : "",
      "• ⛔⛔ NEVER DRAW THE BRAND LOGO OR A 'LOGO' PLACEHOLDER — IT WOULD APPEAR TWICE: the real brand logo is added by us, ONCE, on top afterwards. If you draw the brand name / wordmark / logo / monogram ANYWHERE in the scene it becomes a DUPLICATE and ruins the ad. Also NEVER render a placeholder like the literal word 'LOGO', 'YOUR LOGO', 'YOUR LOGO HERE', 'BRAND' or an empty logo box (stock scenes often have these — omit them entirely). So draw NO logo/wordmark/placeholder on any laptop screen, TV, monitor, phone, tablet, slide, wall, poster, sign, badge, lanyard, mug, notebook or clothing. This is the #1 failure — a screen must NEVER show a branded slide or a dashboard with a logo header.",
      "• ⛔ ZERO TEXT & ABSTRACT SCREENS: any screen, monitor, TV, phone, tablet, dashboard, graph or chart shows ONLY an abstract wavy line, soft glow or plain coloured shapes — NO slide layout, NO title/header, NO bullet points, NO text, numbers, labels, axis titles, legends or captions. If you can't render a screen without adding a logo or bullet text, make it a blank/off screen or a soft colour glow instead. Also never draw the word 'agency', a tagline or any wordmark on walls or props. The real logo and all copy are composited on top afterwards, so anything you draw appears twice and ruins the ad.",
      "• The OTHER attached images are the brand's OWN posts — STUDY them for the brand's COLOUR GRADE, mood, composition energy AND their signature graphic MOTIFS (dot/halftone clusters, organic blobs, colour panels, the brand's icon/smile/comma shape, rings, stars, social like/heart bubbles). Borrow their STYLE only — NEVER their subjects, people, captions or text.",
      "• ⭐ MATCH THE BRAND'S DESIGN LANGUAGE — READ IT FROM THE BRAND POSTS (do NOT force or invent it): look carefully at the attached brand posts and judge whether this brand DECORATES its posts with GRAPHIC DESIGN-ASSET OVERLAYS — floating dots/halftone clusters, organic blobs, colour panels/diagonal fields, rings, stars, sparkles, badges or icons layered OVER the content. ▶ IF the brand's posts consistently use such overlays: replicate THAT SAME design-asset layer here — the SAME kinds of devices, the SAME colours, AND the SAME DENSITY/ABUNDANCE the posts actually use — floating over the scene like the sticker/icon layer of a designed social ad (catching the scene's light, clearly decorative, NOT physical objects in the room). ⭐ MATCH THEIR RICHNESS: if the posts are heavily decorated with many floating elements, cover this ad with just as many so it CAMOUFLAGES into the brand's feed as one more of their posts — do NOT reduce a busy, element-packed layer to a single subtle motif. Place them ONLY in EMPTY areas (never over the face or the reserved text zone), ZERO text/letters/logo inside. ▶ IF the brand's posts do NOT use graphic overlays (clean photographic ads, minimal or no floating devices): add NONE — keep the scene clean and simply brand-graded. Mirror what the brand ACTUALLY does in its posts; never impose a design language it doesn't have, and never take the device colours from anywhere but the brand's own posts.",
      "• Recompose for this aspect ratio and keep the reserved text-safe zone calm and uncluttered.",
      scene ? `⚠️ SCENE OVERRIDE: the reference image may show this person in an unrelated context (e.g. a studio, a filming/ring-light setup, a desk) — IGNORE that background entirely. Keep ONLY the PERSON (their identity/face/look) from the reference and rebuild everything around them as: ${scene}` : "",
    ].filter(Boolean).join("\n");
  }

  // UGC AUTO-MODE (no reference image): no person was provided, so INVENT a believable one and
  // build the same authentic UGC "scene of success". Used when the external-API auto-mode picked
  // 'ugc' but Pexels was unavailable. Only fires when there is genuinely no hero reference image.
  if (ugcNoRef && !heroRef) {
    sourceBlock = [
      "████ BACKGROUND SOURCE: UGC SCENE — INVENT A REAL PERSON ████",
      "No reference image was provided. Create an AUTHENTIC, candid UGC-style 'scene of success' featuring a REAL, believable person (invent them) who fits the campaign's audience.",
      "• The person is the clear focal point — sharp, well-lit, filling a large part of the frame, with natural candid energy. NOT a stiff corporate headshot and NOT a flat studio cut-out on a plain colour field.",
      "• ⭐ THE SCENE MUST BE ABOUT THE PRODUCT/CAMPAIGN (see CAMPAIGN CONTEXT): show the person actually doing/using/benefiting from what is advertised, in the exact context of the offer — it must instantly read as 'this is about THAT product/service'.",
      "• Real depth with foreground/background layers, natural light, photographic realism.",
      "• Light and colour-grade the whole scene in THIS brand's palette so the brand colours clearly dominate the environment.",
      "• ⛔⛔ NEVER DRAW THE BRAND LOGO OR A 'LOGO' PLACEHOLDER — IT WOULD APPEAR TWICE: the real brand logo is added by us, ONCE, on top afterwards. If you draw the brand name / wordmark / logo / monogram ANYWHERE in the scene it becomes a DUPLICATE and ruins the ad. Also NEVER render a placeholder like the literal word 'LOGO', 'YOUR LOGO', 'YOUR LOGO HERE', 'BRAND' or an empty logo box (stock scenes often have these — omit them entirely). So draw NO logo/wordmark/placeholder on any laptop screen, TV, monitor, phone, tablet, slide, wall, poster, sign, badge, lanyard, mug, notebook or clothing. This is the #1 failure — a screen must NEVER show a branded slide or a dashboard with a logo header.",
      "• ⛔ ZERO TEXT & ABSTRACT SCREENS: any screen, monitor, TV, phone, tablet, dashboard, graph or chart shows ONLY an abstract wavy line, soft glow or plain coloured shapes — NO slide layout, NO title/header, NO bullet points, NO text, numbers, labels, axis titles, legends or captions. If you can't render a screen without adding a logo or bullet text, make it a blank/off screen or a soft colour glow instead. Also never draw the word 'agency', a tagline or any wordmark on walls or props. The real logo and all copy are composited on top afterwards, so anything you draw appears twice and ruins the ad.",
      "• Recompose for this aspect ratio; keep the reserved text-safe zone calm and uncluttered.",
      scene ? `⭐ THE SCENE (derived from THIS campaign's topic) — build exactly this around the invented person, in the brand's colors/lighting: ${scene}` : "",
    ].filter(Boolean).join("\n");
  }

  // Convey the brand palette as color NAMES (never raw hex) and scrub every code/URL/CSS
  // token from the spec + facts so nothing can be copied verbatim into the image as text.
  // The FIRST hex in the spec is the brand's primary color — it must DOMINATE the background as the
  // main brand field. Remaining colors are smaller accents. (Without this the model averaged the
  // whole palette and muted the brand's signature color toward a dull mix.)
  const paletteHexes = [...new Set((spec.match(/#[0-9a-f]{6}\b/gi) || []))].slice(0, 4);
  const primaryName = describeHexColor(paletteHexes[0] || "");
  const accentNames = [...new Set(paletteHexes.slice(1).map(describeHexColor).filter(Boolean))];
  // COLOUR SOURCE OF TRUTH.
  // When brand-post reference images are attached, THEY define the real brand palette — the
  // stored CSS-var hex can be stale/generic/wrong (e.g. a company saved navy+orange but every
  // brand post is actually red). So when posts are present we tell the model to SAMPLE the
  // dominant, recurring brand colours from the brand-post images and grade the whole scene to
  // match THOSE — the stored colour name becomes a weak fallback that the posts override. Only
  // when there are NO brand posts do we lock hard onto the stored hex name.
  // When the posts are a PROXY they are not evidence of anything about this brand, so the
  // "posts win" rule inverts: fall through to the stored-colour LOCK below (which already says
  // attached images give SUBJECT and SHAPE, never colour). If no brand colour is known either,
  // colorLine would otherwise be "" — no colour instruction at all — and the proxy posts would
  // drive the palette by omission, defeating the flag in exactly the case it exists for. Hence
  // the third branch: an explicit prohibition with no colour to lock onto.
  const colorLine = (hasBrandPosts && !brandPostsAreProxy)
    ? `BRAND COLORS — ⛔ SOURCE OF TRUTH = THE BRAND-POST REFERENCE IMAGES: the real brand palette is whatever DOMINANT, RECURRING colours appear across the attached brand Instagram posts. STUDY those posts, identify the brand's signature colour(s), and light + colour-grade the WHOLE scene so those post colours clearly DOMINATE the canvas as the main brand field. Do NOT take the palette from any hero/product/person reference (e.g. that model's clothing colour) and do NOT invent a colour — if the hero image has a different colour, RE-GRADE it into the brand-post palette. ${primaryName ? `(As a rough hint the saved brand colour is around ${primaryName}, but if the brand posts disagree, the BRAND POSTS WIN.)` : ""} Never write any color name, code, hex or # as text.`
    : primaryName
    ? `BRAND COLORS — the DOMINANT background color is ${primaryName}: it should fill MOST of the canvas as the main, vivid brand field (do not mute, grey-out or darken it into a dull mix).${accentNames.length ? ` Use ${accentNames.join(", ")} only as smaller accents and contrast.` : ""} ⛔ COLOUR-SOURCE LOCK: the palette comes ONLY from the brand. Any attached product/reference image is used for its SUBJECT and SHAPE, NEVER its colours — if that image has a different colour (e.g. blue), RE-LIGHT and COLOUR-GRADE the entire scene into ${primaryName} and the brand accents regardless. The product may keep its own material, but the surrounding scene, lighting and overall colour grade MUST be unmistakably the brand's, not the reference image's. Never write any color name, code, hex or # as text.`
    : (hasBrandPosts && brandPostsAreProxy && hasSiteIdentity)
    ? `BRAND COLORS — ⛔ SOURCE OF TRUTH = THE CLIENT'S OWN WEBSITE (the FIRST ${Math.max(1, siteRefCount)} attached image(s)): sample the dominant, recurring colours of the client site and colour-grade the WHOLE scene so THOSE colours clearly dominate the canvas as the main brand field. ${competitorRefsPresent ? "⛔ The OTHER attached images are market/competitor references — take NO colour from them (not their palette, grade, or tint); they inform STRUCTURE only." : "⛔ No competitor image is attached, so no colour in your inputs comes from anyone but this client — and the written brief carries NO colour information at all."} Never write any color name, code, hex or # as text.`
    : (hasBrandPosts && brandPostsAreProxy)
    ? `BRAND COLORS — ⛔ THE ATTACHED BRAND-POST REFERENCE IMAGES ARE NOT THIS BRAND: they are market/category reference material. Do NOT take ANY colour from them — not their palette, not their colour grade, not their background tint. No brand colour is known for this brand yet, so do NOT invent a loud signature colour either: use a restrained, NEUTRAL background treatment (soft neutral tones, natural light, low saturation) that stays out of the way. Never write any color name, code, hex or # as text.`
    : "";
  const safeSpec = scrubBgPromptText(spec);
  // Background-only: drop the verbatim COPY lines (headline, subheadline, CTA, offer, brand and
  // product/service names) from the campaign facts before they reach the image model. These short,
  // quotable phrases are exactly what the model is most tempted to burn into the background as
  // literal text (e.g. rendering the service name as a heading) — and the overlay layer renders
  // all of them on top afterwards anyway, so the background never needs them. The mood-bearing
  // lines (industry, business description, objective, audience, tone, personality, colors) stay.
  const stripBgCopyLines = (facts: string): string =>
    String(facts || "")
      .split("\n")
      .map((ln) => {
        const t = ln.trim();
        if (/^EXACT COPY/i.test(t)) return null;
        // Product/Service is stripped from facts to avoid verbatim text rendering.
        // It is re-injected separately as a "visual mood" hint (see productMoodHint below).
        if (/^Product\/Service\s*:/i.test(t)) return null;
        if (/^(Campaign|Brand|Value prop|CTA|Offer|Price|Discount|Guarantee|Scarcity|headline|subheadline|cta)\s*:/i.test(t)) return null;
        return ln;
      })
      .filter((ln): ln is string => ln !== null)
      .join("\n");
  const safeFacts = scrubBgPromptText(stripBgCopyLines(campaignFactsImg));
  // Extract product name before stripping so it can drive visual mood without being in facts.
  const rawProduct = (campaignFactsImg.match(/^Product\/Service:\s*(.+)$/mi) ?? [])[1]?.trim() ?? "";
  const productMoodHint = heroRef
    // Hero-reference mode: the attached image IS the hero. Don't push a competing "scene of
    // success" idea — defer to the BACKGROUND SOURCE hero block, just lock the brand palette.
    ? `VISUAL HERO — THIS IS THE MOST IMPORTANT INSTRUCTION: the hero of this ad is the SUBJECT of the FIRST attached reference image (see BACKGROUND SOURCE above). Feature that exact subject prominently and faithfully; re-light and color-grade the scene into the brand's palette, but never swap the hero for a generic stock scene. Do NOT render any product name or text in the image.`
    : productRef
    // Product-reference mode: the caller sent a real product image. FEATURE that product as the
    // visible hero of the scene (this overrides the "ebook/digital → don't render an object"
    // rule below — when a product photo is provided, the user wants to SEE the product).
    ? `VISUAL HERO — THIS IS THE MOST IMPORTANT INSTRUCTION: the FIRST attached image is the actual PRODUCT being advertised${rawProduct ? ` ("${scrubBgPromptText(rawProduct)}")` : ""}. FEATURE that exact product as the clear, sharp HERO of the composition — show it prominently (filling a large part of the frame), beautifully lit, unmistakably visible and recognizable as the real product (e.g. an e-reader/tablet/device held in hands or styled on a surface) — NOT merely implied by a person or a vague scene. Build an aspirational lifestyle context around it (hands, desk, soft props), but the PRODUCT itself MUST be the focal point. Re-light and colour-grade everything into the brand's palette. ⛔ Do NOT render any product name, cover text, label or wordmark on the product or anywhere — all surfaces stay blank.`
    : rawProduct
    ? [
        `VISUAL BRIEF — what to photograph/illustrate (the campaign topic is given as internal context in the "Visual subject" line elsewhere in this prompt — those words are for YOUR understanding only, never render them as pixels):`,
        "• Tangible physical product (object you can hold: food, cosmetics, clothing, bottle, packaging, equipment, toy, furniture…): the product itself, large and dramatic, shot in the brand's colors and lighting.",
        "• Digital product, software, platform, SaaS, app, API, documentation, guide, tool, course, ebook: treat it as a SERVICE — never as a physical object you can hold or stack on a desk. Show the SCENE OF SUCCESS instead: the PEOPLE and the moment when this delivers its promise. (Naming a paper object here tends to summon it — so do not picture one at all; picture the outcome.)",
        scene
          ? `• Service or activity: paint the SCENE OF SUCCESS derived from THIS campaign's topic — ${scene} Build exactly that, concretely and literally. Do NOT substitute a content-creation / ring-light / phone-filming scene unless the topic is literally about creating social content.`
          : "• Service or activity (marketing, education, coaching, consulting, events, finance, healthcare…): paint the SCENE OF SUCCESS — the world the moment this service delivers its promise, concretely and literally: the exact environment, prop and activity that THIS specific topic implies, never a generic laptop/desk/office stand-in that could belong to any industry.",
        "⛔ A generic laptop/'tech desk', floating device, or stock photo office is always wrong for a service. The scene must be unmistakably about what THIS campaign delivers — someone should recognize the topic from the image alone, with no text.",
        "• Whichever you choose: the hero subject fills ≥50% of the frame, dramatically lit, in the brand's palette.",
        "• BRAND IDENTITY IS NON-NEGOTIABLE: even in an action scene or photographic composition, the brand's color palette must dominate — use it as the background lighting, color grade, or backdrop. The brand's visual identity elements (textures, patterns, signature colors from the brand facts) must be present. A scene shot in neutral/white/random colors is a brand failure.",
        "• The background should feel like a professional art-directed shot made FOR THIS BRAND — their signature style must be unmistakably present.",
        "⛔ Do NOT render the product name or any text anywhere in the image.",
      ].join(" ")
    : "";

  const themeLockLine = rawProduct
    ? `███ RULE #2 — CAMPAIGN THEME LOCK ███\nThe topic of this campaign (given to you as internal context only, never to be rendered as pixels — see the no-echo reminder below) determines WHAT the scene depicts. This overrides brand-style guidance below on WHAT to depict — the brand identity (colors, lighting, signature motifs) only dictates HOW it looks, never WHAT the scene is about. A hero subject (person, product, or object) related to that topic must occupy a LARGE, unmistakable, in-focus portion of the frame — never a mostly-empty gradient/abstract canvas with the actual subject shrunk into a small corner.${scene ? ` ███ BUILD EXACTLY THIS SCENE (derived from THIS campaign's topic): ${scene} ███` : " Derive the ONE concrete setting, prop and action that makes THIS specific topic instantly recognizable from the image alone."}\n⛔ DO NOT DEFAULT to a content-creation / social-media / filming / ring-light / streaming / 'person holding a phone that shows a chart' scene UNLESS this campaign's topic is literally about creating social content. For finance, health, skincare/beauty, food, retail, education, fitness, real estate, etc., that setup is WRONG — use the real environment of THIS topic instead. Ask yourself: "would someone recognize THIS campaign's topic from this image alone, with no text?" If not, redo it.\n⛔ NO-ECHO REMINDER: the campaign topic is named elsewhere in this prompt in quotes (e.g. in the "Visual subject" line) purely so YOU understand what to depict — those exact words are instructions, never content. Do not render the product/service name, or any word from it, as pixels anywhere in the image.`
    : "";

  const assembled = [
    PRIMARY_BG_RULE,
    themeLockLine,
    "",
    "███ THIS IS AN AD BACKGROUND LAYER — NOT A FINISHED AD ███",
    "Your ONLY job is to produce the BACKGROUND IMAGE of a digital advertisement. The system will composite the brand logo, headline, body copy, and CTA button on top of your image in a separate layer — automatically. You do NOT draw those elements.",
    "Think of yourself as an art director painting the backdrop on a canvas before a photographer places the product and copywriter adds the text. Your canvas must be beautiful, rich, and on-brand — but it is NOT the finished ad.",
    "Critically: the text and logo WILL appear on top of your image. Your background must make them POP, not compete with them. A background that looks stunning as a standalone image but buries overlaid white text is a FAILED background.",
    bgSource === "shapes"
      ? "Your job is purely the visual backdrop: brand colors, gradients, geometric shapes, textures, atmospheric elements (NO photography)."
      : "Your job is purely the visual backdrop: colors, textures, gradients, shapes, product/scene photography, atmospheric elements.",
    "",
    sourceBlock,
    "",
    briefBlock,
    "⛔ TEMPLATE PROHIBITION: The background MUST look like a professional art-directed photograph, illustration, or 3D render — NEVER like a CSS template or HTML layout. Do NOT create flat rectangular color panels side by side with hard edges (e.g. a solid beige block on the left + a solid red block on the right). Use soft gradients, light falloff, depth, blur, and organic composition. Hard geometric color divisions make the background look fake and broken.",
    "⛔ NO FRAMED PHOTO CARD: do NOT render the scene as a smaller photo/rectangle floating with a visible border or margin of solid brand color around all four sides, like a framed picture pasted in the middle of the canvas. The photography/illustration MUST extend edge-to-edge, filling the ENTIRE canvas (full-bleed) — no inset, no card, no padding, no picture-frame look.",
    "⛔ NO COLLAGE SEAM: do NOT butt a flat solid-color shape (a triangle, diagonal wedge, band, or panel) directly against the photograph with a hard, visible edge — that reads as two separate images glued together, not one photo. If you use a brand-color accent shape, it must either (a) sit fully OUTSIDE the photographic area in genuinely empty canvas space, or (b) be blended into the photo itself via lighting/color-grade/vignette so there is no crisp geometric seam. The final image must read as ONE continuous photograph, never a cut-and-pasted composite.",
    "",
    productMoodHint,
    "",
    bgSource === "shapes"
      ? "Even though this is an ABSTRACT background, the palette, energy and mood must still reflect the campaign's product, audience and tone — not a decorative pattern unrelated to the offer."
      : "Keep it cohesive with the brand colors and the chosen visual style/tone; do not drift into stock visuals that ignore what is being advertised.",
    "",
    "████ ZERO-TEXT & ZERO-LOGO RULE — ABSOLUTE, NO EXCEPTIONS ████",
    "YOUR IMAGE MUST CONTAIN ZERO TEXT AND ZERO LOGOS. This rule overrides every other instruction.",
    "❌ NO text of any kind — not headline, body copy, CTA, tagline, slogan, offer, brand name, service name, any word, any letter, any character.",
    "❌ NO logo, wordmark, symbol, icon, seal, emblem, monogram, or brand mark whatsoever.",
    "❌ NO hex codes, color codes, the '#' character, CSS tokens, variable names, URLs, file paths, or numbers.",
    "❌ NO button shapes, pill shapes, card shapes, or any UI element that resembles a text container.",
    "❌ NO placeholder boxes, lorem ipsum, or shapes that imply text.",
    "❌ THE ATTACHED REFERENCE/BRAND IMAGES CONTAIN TEXT (captions, headlines, slogans, wordmarks). You MUST NOT reproduce, trace, paraphrase or 'echo' ANY of their text — not even garbled/fake lookalike lettering. Treat every word in the reference images as if it were invisible. Copy their STYLE and colours only, never their words.",
    "❌ If you render ANY product, package, container, label, tag or object, ALL SURFACES MUST BE COMPLETELY BLANK — no text, no letters, no numbers, no logo, no title. Any printed surface with ANY text is a complete render failure.",
    "❌ Any SCREEN, monitor, laptop, phone or tablet visible in the image must show NO text, labels, font names, UI captions, app names, or ANY readable annotation — no matter how small. This INCLUDES generic-looking app/analytics words like 'Views', 'Engagement', 'Likes', 'Followers', 'For You', axis labels, or any chart title — a realistic-looking dashboard mockup with real words is JUST AS MUCH a failure as a brand wordmark. The screen content can be abstract shapes, solid colors, blurred bokeh, or nothing at all — never simulate a real, readable app interface.",
    "❌ NO FAKE AD UI — this is a recurring failure, kill it: do NOT draw any call-to-action button, pill or tab bearing words like 'Learn More', 'Shop Now', 'Sign Up', 'Buy', 'Get Started', 'Confira', 'Saiba mais' — the REAL button/CTA is composited later in a separate layer, so any button you draw is a duplicate that ruins the ad. If a chart, graph or dashboard appears (e.g. a growth/ROI chart on a screen), it must be ONLY smooth abstract coloured bars or a rising line with ZERO numbers, ZERO percentages (no '100%', '+250%'), ZERO axis labels, ZERO legends, ZERO titles — pure shapes, unreadable as data.",
    "⛔⛔ NOTHING FROM THIS PROMPT IS CONTENT TO DRAW: this whole message is instructions for you, not text to reproduce. The reserved panel/calm area where overlay text will go later must be a completely clean, empty colour/gradient surface — no preview headline, no placeholder copy, no meta-description of the zone, no layout jargon, no coordinate/percentage/measurement-looking numbers, no fabricated slogan or caption of any kind, however faint or decorative it looks. If you want texture that suggests typography or data, make it genuinely illegible abstract marks, never actual words or numbers.",
    "WHY: The system overlays the real logo and copy in a separate HTML layer AFTER your image is generated. Any text or logo you draw will appear TWICE in the final ad, ruined.",
    "A background image with ANY text or logo in it is a complete render failure.",
    "",
    "CREATIVE DIRECTION:",
    direction,
    "Avoid the default centered product-on-plain-background look. Use varied crop, camera angle, depth, lighting, foreground layers, texture, and asymmetry.",
    bgSource === "shapes"
      ? "Compose with shapes, gradients and brand-color fields — no literal objects or photographic scenes."
      : bgSource === "creative"
        ? "Be bold and original — invent a distinctive composition that fits the campaign; avoid generic stock looks."
        : "Do not repeat the same asset placement unless the format absolutely requires it. Reinterpret the reference assets as a brand world, not a template.",
    "",
    "████ ART DIRECTION — CLEAN, FOCUSED, PREMIUM ████",
    "Design a restrained, premium ad background built around ONE clear hero subject in sharp focus. Think modern brand campaign — calm, confident, lots of breathing room. LESS IS MORE.",
    "• Focal subject: a single, clearly defined hero subject (product, object, or scene) that is SHARP and IN FOCUS. Do NOT blur the entire image — shallow depth-of-field is allowed ONLY as a soft falloff directly behind the in-focus subject. A fully blurred, nothing-in-focus image is a FAILED background.",
    "• Decoration density FOLLOWS THE BRAND'S OWN POSTS, not a fixed cap: if the attached brand posts are clean/minimal, use at most ONE subtle brand accent motif (a small dot cluster OR a single brand-color shape) and keep lots of calm space. BUT if the brand's own posts are richly decorated with a busy floating design-asset layer (scattered dots, particles, confetti, halftone, blobs, floating icons/shapes), MATCH that abundance here so the ad camouflages into the brand's feed — see the brand design-language rule above; the 'at most one motif' cap applies ONLY when the brand's posts are clean. Either way, no device may cut through or obscure the logo or the headline/CTA text.",
    "• Color: use the brand color as a tasteful ACCENT and overall mood — NOT a heavy single-color wash or tint flooding the whole frame. Keep the subject's natural colors and realistic lighting. Never lay a translucent colored sheet over the entire image.",
    "• Texture & light: subtle and tasteful only — a gentle gradient or soft natural light, optional fine grain. NO light leaks, lens flares, glow overload, or heavy vignettes.",
    "• Depth comes from a real subject sitting in clean space — not from piling on decorative elements or layers.",
    "WITHIN the text zone: keep it calm, clean and low-contrast so the white overlay text stays perfectly legible. OUTSIDE it: the hero subject, sharp and well-lit, against simple, uncluttered surroundings.",
    "",
    "████ TEXT-SAFE ZONE — KEEP IT CLEAN, DRAW NOTHING HERE ████",
    "The logo and copy are composited ON TOP afterwards in a separate layer — you do NOT draw them. Simply leave the logo corner and the main text zone as calm, low-contrast, uncluttered negative space (see the reserved-zone guidance below). ⛔ Do NOT render any positioning/CSS jargon, bracketed coordinates, or percentage/measurement values as pixels — those are instructions, never content.",
    "⚠️ DOUBLE-TEXT/LOGO WARNING: If you draw ANY text, slogan, wordmark, logo or UI inside those zones, the final ad shows it TWICE and looks broken. Those zones MUST stay completely TEXT-FREE and LOGO-FREE.",
    `In the text-block zone: ${spaceGuide}`,
    "Keep that zone low-contrast and calm — subtle texture, soft gradient or gentle depth only. ZERO text, ZERO numbers, ZERO wordmarks, ZERO slogans, ZERO icons, ZERO UI, ZERO logos.",
    "Place the strongest focal subject and highest-contrast elements OUTSIDE those zones; the zone itself is just a clean surface for white text.",
    "",
    colorLine,
    hasColourSwatch
      ? "⛔ BRAND COLOUR SWATCH — THE LAST ATTACHED IMAGE IS NOT A DESIGN REFERENCE: it is a flat rectangle filled with this brand's EXACT colour, attached purely so you can see the precise value. SAMPLE IT and make the dominant background field that EXACT colour — same hue, same saturation, same brightness. Do not shift it warmer, cooler, darker, duller or more 'tasteful'; do not substitute a neighbouring shade you consider more premium. If your field does not visually match that swatch side by side, it is wrong. Take NOTHING else from that image — no composition, no subject, no layout, no edges; it contributes colour only, and the flat rectangle itself must never appear in your output."
      : "",
    safeSpec
      ? `CREATIVE SPEC (follow for visual style, brand aesthetic, and composition):\n${safeSpec}`
      : "Create a visually compelling backdrop using the brand's colors and visual language.",
    "",
    "CAMPAIGN CONTEXT (for color/style reference only — do NOT render any of this text, and never any code/number/URL it may mention):",
    safeFacts,
    "",
    `FORMAT: ${format.width}×${format.height}px | Aspect ratio: ${aspectRatio}`,
    "",
    bgSource === "shapes"
      ? "OUTPUT: Pure abstract visual — brand colors, gradients, geometric shapes, textures. NO photography. Zero text. Zero UI elements."
      : "OUTPUT: Pure visual — brand colors, gradients, textures, product/scene photography. Zero text. Zero UI elements.",
    "⛔ FINAL CHECK BEFORE OUTPUT: Does your image contain any letter, word, number, logo, icon, slogan, or UI element? If YES — remove it. The overlay layer will add all of that. Any text or logo in your image = immediate render failure.",
    // When brand posts / reference images are attached they almost always contain captions and
    // wordmarks; the model's strongest temptation is to TRACE that text into the bg (e.g. echoing a
    // brand-post caption like a slogan). Append the strong anti-echo guard so the rule is stated
    // emphatically at the very end, not only inline above.
    hasRefImages ? REF_TEXT_LEAK_GUARD : "",
  ].filter(Boolean).join("\n");

  // LAST STEP — take the brand's NAME out of the prompt. RULE #1 already forbids drawing it, yet a
  // banner came back with a garbled "Unica vs aglencies" burned into the background: the word was
  // sitting in this prompt 25 times (the theme-scene line plus the company-profile JSON), and a
  // word the model keeps reading is a word it eventually paints. The name adds nothing to a
  // BACKGROUND — the real logo is composited on top afterwards — so removing it removes the
  // temptation without costing any visual information.
  const brandNamesForBg = [
    (campaignFactsImg.match(/^Brand:\s*(.+)$/mi) ?? [])[1],
    (campaignFactsImg.match(/"businessName"\s*:\s*"([^"]+)"/i) ?? [])[1],
  ];
  return stripBrandNameForBg(assembled, brandNamesForBg);
}

// Gradient scrims positioned over each layout's text zone.
// These sit at z-index:1 (above background, below text) and guarantee white
// text is legible regardless of what the AI generated in that area.
const LAYOUT_SCRIMS: Record<string, string> = {
  "hero-full-bleed":        "inset:auto 0 0 0;height:55%;background:linear-gradient(to top,rgba(0,0,0,0.48) 0%,rgba(0,0,0,0.22) 55%,rgba(0,0,0,0) 100%)",
  "diagonal-split":         "inset:0 52% 0 0;background:linear-gradient(to right,rgba(0,0,0,0.45) 0%,rgba(0,0,0,0.14) 80%,rgba(0,0,0,0) 100%)",
  "top-image-bottom-text":  "inset:48% 0 0 0;background:linear-gradient(to bottom,rgba(0,0,0,0) 0%,rgba(0,0,0,0.42) 35%,rgba(0,0,0,0.52) 100%)",
  "left-panel-right-image": "inset:0 56% 0 0;background:linear-gradient(to right,rgba(0,0,0,0.45) 0%,rgba(0,0,0,0.16) 75%,rgba(0,0,0,0) 100%)",
  "centered-minimal":       "inset:0;background:radial-gradient(ellipse at center,rgba(0,0,0,0.35) 0%,rgba(0,0,0,0.10) 65%,rgba(0,0,0,0) 100%)",
  "bold-headline-first":    "inset:0 0 auto 0;height:64%;background:linear-gradient(to bottom,rgba(0,0,0,0.45) 0%,rgba(0,0,0,0.18) 78%,rgba(0,0,0,0) 100%)",
  "frame-product":          "inset:auto 0 0 0;height:46%;background:linear-gradient(to top,rgba(0,0,0,0.44) 0%,rgba(0,0,0,0.12) 70%,rgba(0,0,0,0) 100%)",
  "top-left-editorial":     "inset:0 42% 32% 0;background:linear-gradient(135deg,rgba(0,0,0,0.45) 0%,rgba(0,0,0,0.06) 70%,rgba(0,0,0,0) 100%)",
  "top-right-editorial":    "inset:0 0 32% 42%;background:linear-gradient(225deg,rgba(0,0,0,0.45) 0%,rgba(0,0,0,0.06) 70%,rgba(0,0,0,0) 100%)",
  "bottom-right-editorial": "inset:42% 0 0 42%;background:linear-gradient(315deg,rgba(0,0,0,0.45) 0%,rgba(0,0,0,0.06) 70%,rgba(0,0,0,0) 100%)",
  "vertical-story-stack":   "inset:0 46% 0 0;background:linear-gradient(to right,rgba(0,0,0,0.42) 0%,rgba(0,0,0,0.12) 70%,rgba(0,0,0,0) 100%)",
  "floating-islands":       "inset:auto 0 0 0;height:50%;background:linear-gradient(to top,rgba(0,0,0,0.44) 0%,rgba(0,0,0,0.12) 65%,rgba(0,0,0,0) 100%)",
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
  overlayHtml?: string | null,
): string {
  const w = format.width ?? 1080;
  const h = format.height ?? 1080;
  const platform = format.platform || "banner";
  const formatName = format.format || "ad";

  const detectedLayout = resolveCompositionLayout(spec, layoutKey, forceLayout);
  const layout = LAYOUT_POSITIONS[detectedLayout] ?? LAYOUT_POSITIONS["hero-full-bleed"];

  const primaryColor = extractCssVarColor(cssVars, "--primary") || "#1a1a2e";
  const fontFamily = extractCssVarFont(cssVars) || "'Inter','Helvetica Neue',Arial,sans-serif";

  // Strip glyphs the GD compositor's TTFs (Raleway/OpenSans, latin subset) cannot render —
  // arrows, dingbats, stars, geometric shapes, emoji. They otherwise paint as a □ tofu box.
  const stripUnsupportedGlyphs = (s: string): string =>
    String(s || "")
      .replace(/[\u{2190}-\u{2BFF}\u{1F000}-\u{1FAFF}\u{FE0F}]/gu, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  const headline = stripUnsupportedGlyphs(String(data.mainHeadline || ""));
  const sub = stripUnsupportedGlyphs(String(data.subheadline || data.offer || ""));
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
  // The layout owns horizontal alignment so the whole block reads as one unit.
  const textAlign = layout.align;
  const alignItems = textAlign === "center" ? "center" : textAlign === "right" ? "flex-end" : "flex-start";

  const fontImport = fontUrl ? `<style>@import url('${fontUrl}');</style>` : "";

  const bgLayer = bgDataUrl
    ? `<img class="ad-bg" src="${bgDataUrl}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0" alt="" />`
    : `<div class="ad-bg" style="position:absolute;inset:0;background:${primaryColor};z-index:0"></div>`;

  // Scrim: semi-transparent gradient over the text zone, ensures white text legibility
  const scrimCss = LAYOUT_SCRIMS[detectedLayout] ?? LAYOUT_SCRIMS["hero-full-bleed"];
  const scrimLayer = `<div style="position:absolute;${scrimCss};z-index:1;pointer-events:none"></div>`;

  // Caller can pin the logo corner (logo_position / logo_strategy) — overrides the layout's
  // default logo placement so e.g. a brand that always wants top-left gets it on any layout.
  const LOGO_POSITIONS: Record<string, string> = {
    "top-left":      "top:5%;left:5%;width:26%;max-height:12%;",
    "top-right":     "top:5%;right:5%;width:26%;max-height:12%;",
    "top-center":    "top:5%;left:50%;transform:translateX(-50%);width:26%;max-height:12%;",
    "bottom-left":   "bottom:6%;left:5%;width:24%;max-height:11%;",
    "bottom-right":  "bottom:6%;right:5%;width:24%;max-height:11%;",
  };
  const logoCss = LOGO_POSITIONS[String((data as any).logoPosition || "").toLowerCase()] || layout.logo;
  const logoLayer = logoUrl
    ? `<img src="${logoUrl}" style="position:absolute;${logoCss}object-fit:contain;z-index:20" alt="logo" />`
    : (data.brandName ? `<div style="position:absolute;${logoCss}font-family:${fontFamily};font-size:${logoFs};font-weight:700;color:${textColor};z-index:20;white-space:nowrap;text-shadow:${textShadow}">${String(data.brandName).trim()}</div>` : "");

  // ── COHESIVE TEXT BLOCK ──────────────────────────────────────────────────
  // headline + sub + CTA render INSIDE one flex column anchored to layout.block,
  // so they always stay grouped (tight gaps) instead of being flung to separate
  // corners of the canvas. The layout only moves the whole block around.
  const headlineEl = headline
    ? `<div style="font-family:${fontFamily};font-size:${headlineFs};font-weight:900;color:${textColor};line-height:1.12;text-align:${textAlign};text-shadow:${textShadow};overflow-wrap:break-word;">${headline}</div>`
    : "";

  const subEl = sub
    ? `<div style="margin-top:1.6cqh;font-family:${fontFamily};font-size:${subFs};font-weight:400;color:${subColor};line-height:1.34;text-align:${textAlign};text-shadow:${textShadow};overflow-wrap:break-word;">${sub}</div>`
    : "";

  // CTA — social formats get organic text gesture, display formats get a button.
  // It is the last child of the block; a slightly larger top margin separates it.
  const ctaRaw = stripUnsupportedGlyphs(String(data.ctaText || ""));
  const isSocialFmt = isSocialFormat(format);
  let ctaEl = "";
  if (ctaRaw) {
    if (isSocialFmt) {
      ctaEl = `<div style="margin-top:2.6cqh;font-family:${fontFamily};font-size:${ctaFs};font-weight:600;color:${textColor};text-shadow:${textShadow};white-space:nowrap;letter-spacing:0.3px;opacity:0.93;">${ctaRaw}</div>`;
    } else {
      const isDark = contrastTextColor(primaryColor).color === "#ffffff";
      const btnBg    = isDark ? "rgba(255,255,255,0.95)" : "rgba(20,20,20,0.88)";
      const btnColor = isDark ? "#111111"                : "#ffffff";
      ctaEl = `<div style="margin-top:2.8cqh;align-self:${alignItems};display:inline-block;background:${btnBg};color:${btnColor};font-family:${fontFamily};font-size:${ctaFs};font-weight:700;padding:0.42em 0.90em;border-radius:0.38em;box-shadow:0 4px 18px rgba(0,0,0,0.22);white-space:nowrap;">${ctaRaw}</div>`;
    }
  }

  const textBlock = (headlineEl || subEl || ctaEl)
    ? `<div style="position:absolute;${layout.block}display:flex;flex-direction:column;align-items:${alignItems};z-index:25;">${headlineEl}${subEl}${ctaEl}</div>`
    : "";

  // When Gemini built the overlay, it already placed the logo at its own size/position.
  // TypeScript only injects logoLayer in the fallback template path.
  const overlayContent = overlayHtml
    ? overlayHtml
    : `${scrimLayer}\n  ${logoLayer}\n  ${textBlock}`;

  return `<!-- BANNER_START -->
<div class="ad-banner" data-platform="${platform}" data-format="${formatName}" style="position:relative;width:${w}px;height:${h}px;overflow:hidden;font-family:${fontFamily};container-type:size">
  ${fontImport}
  ${bgLayer}
  ${overlayContent}
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

function guessMimeType(url: string): string {
  const ext = url.split("?")[0].split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
    webp: "image/webp", gif: "image/gif", avif: "image/avif", bmp: "image/bmp",
  };
  return map[ext] ?? "image/jpeg";
}

async function fetchImageAsBase64(url: string): Promise<{ mimeType: string; data: string } | null> {
  try {
    // 25s — brand_posts come from our own CDN (mirrored by PHP) so network is fast,
    // but images can be large; 10s caused silent failures on all 4 posts at once.
    const res = await fetch(url, { signal: AbortSignal.timeout(25000) });
    if (!res.ok) {
      console.warn(`[fetchImageAsBase64] HTTP ${res.status} for ${url}`);
      return null;
    }
    const mime = res.headers.get("content-type")?.split(";")[0].trim() ?? "image/jpeg";
    if (!mime.startsWith("image/") || mime === "image/svg+xml") {
      console.warn(`[fetchImageAsBase64] non-image content-type="${mime}" for ${url}`);
      return null;
    }
    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    const CHUNK = 8192;
    let bin = "";
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return { mimeType: mime, data: btoa(bin) };
  } catch (e) {
    console.warn(`[fetchImageAsBase64] fetch error for ${url}: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

type GeminiCallOptions = {
  thinkingLevel?: "minimal" | "low" | "medium" | "high";
  thinkingBudget?: number; // gemini-2.5: token budget for thinking. 0 disables it (all of maxTokens → output)
  responseMimeType?: string;
  responseSchema?: Record<string, unknown>;
  jobId?: string; // tags cost/token logs so one generation can be summed in Supabase logs
  timeoutMs?: number; // override the default 130s fetch timeout
  costAcc?: { usd: number; images: number; jobId?: string }; // accumulate this call's $ into the per-request total
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
// Fire-and-forget: POST one Gemini call's RAW usageMetadata to the PHP usage ledger
// (log-gemini-usage.php), which is the single pricing authority and persists it to the
// gemini_usage table. Never blocks or throws — cost logging must never affect generation.
// Requires the Supabase secrets USAGE_LOG_URL + USAGE_LOG_SECRET (no-ops if unset).
function logGeminiUsage(source: string, model: string, usage: unknown, jobId?: number | string): void {
  try {
    const url = env?.get("USAGE_LOG_URL");
    const secret = env?.get("USAGE_LOG_SECRET");
    if (!url || !secret) return;
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, source, model, usage: usage ?? {}, job_id: jobId ? Number(jobId) : null }),
      signal: AbortSignal.timeout(4000),
    }).catch(() => {});
  } catch (_) { /* never break generation */ }
}

const GEMINI_PRICING: Record<string, { in: number; out: number }> = {
  "gemini-2.5-flash":        { in: 0.30, out: 2.50 },
  "gemini-2.5-flash-lite":   { in: 0.10, out: 0.40 },
  "gemini-2.5-pro":          { in: 1.25, out: 10.00 },
  "gemini-3.5-flash":        { in: 1.50, out: 9.00 },
  "gemini-3-flash-preview":  { in: 0.50, out: 3.00 },
  "gemini-3-pro-preview":    { in: 2.00, out: 12.00 },
  "gemini-2.5-flash-image":  { in: 0.30, out: 0.00 }, // image output billed per token, see below
  "gemini-3-pro-image":      { in: 2.00, out: 0.00 }, // image output billed per token, see below
  "gemini-3.1-flash-image":  { in: 0.50, out: 0.00 }, // image output billed per token, see below
};
// Image OUTPUT price per 1M tokens, per model — image models bill the generated image as output
// tokens at a model-specific rate (≈ flat-per-image once you know the token count). Adaptive so
// the cost log reflects the model actually used instead of a hardcoded flash price.
// Confirmed against https://ai.google.dev/gemini-api/docs/pricing (standard paid tier).
const GEMINI_IMAGE_OUT_PER_1M: Record<string, number> = {
  "gemini-2.5-flash-image": 30,   // ≈ $0.039 / image
  "gemini-3-pro-image":     120,  // ≈ $0.134 / image (≤2K)
  "gemini-3.1-flash-image": 60,   // ≈ $0.067 (1K) / $0.101 (2K) per image — NOT a cheap flash tier
};
function imageOutPricePer1M(model: string): number {
  if (GEMINI_IMAGE_OUT_PER_1M[model] !== undefined) return GEMINI_IMAGE_OUT_PER_1M[model];
  const k = Object.keys(GEMINI_IMAGE_OUT_PER_1M).find((key) => model.startsWith(key));
  return k ? GEMINI_IMAGE_OUT_PER_1M[k] : 30; // safe default = flash-image rate
}

function pricingFor(model: string): { in: number; out: number } {
  if (GEMINI_PRICING[model]) return GEMINI_PRICING[model];
  const key = Object.keys(GEMINI_PRICING).find((k) => model.startsWith(k));
  return key ? GEMINI_PRICING[key] : GEMINI_PRICING["gemini-2.5-flash"]; // safe default
}

// Logs an estimated USD cost line for a text/plan generation. Server-side only.
function logCostEstimate(model: string, promptTokens: number, outputTokens: number, label = "", jobId = ""): number {
  try {
    const p = pricingFor(model);
    const inUsd = (promptTokens / 1_000_000) * p.in;
    // Image models bill output as image tokens at a model-specific rate (p.out is 0 for them).
    const isImage = /image/i.test(model);
    const outUsd = isImage
      ? (outputTokens / 1_000_000) * imageOutPricePer1M(model)
      : (outputTokens / 1_000_000) * p.out;
    const total = inUsd + outUsd;
    const job = jobId ? ` job=${jobId}` : "";
    console.log(`[cost-estimate]${job}${label ? ` ${label}` : ""} model=${model} in=${promptTokens}tok($${inUsd.toFixed(5)}) out=${outputTokens}tok($${outUsd.toFixed(5)}) ~= $${total.toFixed(5)}`);
    return total;
  } catch (_) { /* logging must never break generation */ return 0; }
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
  // gemini-2.5 has thinking ON by default and those tokens count against maxOutputTokens —
  // which truncated the overlay HTML mid-element. thinkingBudget:0 disables it so the full
  // token budget goes to the actual HTML output.
  if (typeof options?.thinkingBudget === "number" && /gemini-2\.5/i.test(model)) {
    generationConfig.thinkingConfig = { thinkingBudget: options.thinkingBudget };
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
    signal: AbortSignal.timeout(options?.timeoutMs ?? 130000),
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
    const jobId = options?.jobId ?? "";
    console.log(`[token-usage]${jobId ? ` job=${jobId}` : ""} model=${model} stores=${fileSearchStores?.length ?? 0}(${(fileSearchStores ?? []).join(",")}) refImgs=${referenceImages?.length ?? 0} prompt=${u.promptTokenCount ?? u.prompt_token_count ?? "?"} candidates=${u.candidatesTokenCount ?? u.candidates_token_count ?? "?"} toolUse=${u.toolUsePromptTokenCount ?? u.tool_use_prompt_token_count ?? 0} total=${u.totalTokenCount ?? u.total_token_count ?? "?"}`);
    const callUsd = logCostEstimate(model, promptTok, outTok, "", jobId);
    if (options?.costAcc) options.costAcc.usd += callUsd; // fold every Gemini call into the per-request total
    logGeminiUsage("agents-ads", model, u, options?.jobId); // persist to the central gemini_usage ledger
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

  // thinkingBudget MUST be forwarded: without it, callers on this path cannot disable gemini-2.5
  // thinking, whose tokens eat maxOutputTokens and truncate the answer mid-sentence.
  const geminiOpts = { thinkingLevel: options?.thinkingLevel, thinkingBudget: options?.thinkingBudget, responseMimeType: options?.responseMimeType, responseSchema: options?.responseSchema, jobId: options?.jobId, costAcc: options?.costAcc };

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
    // Tags every cost/token log line so one generation can be filtered & summed in Supabase logs.
    const jobId = String((payload as any).jobId ?? (payload as any).campaignData?.jobId ?? "");

    // ── BRAND_VISUAL MODE: vision → text brand identity brief ──────────────────
    // ONE-TIME extraction per profile: reads brand posts (+ optional competitor posts)
    // and distills the brand's full visual design language into a rich text brief
    // (300-400 words). Cached in company_form_data — never re-run until posts change.
    // Competitor posts are analyzed separately and stored under a distinct section
    // restricted to layout/composition patterns only — identity never bleeds across.
    if (mode === "brand_visual") {
      const visKey = getApiKey(typeof payload.geminiApiKey === "string" ? payload.geminiApiKey : undefined);
      if (!visKey) {
        return new Response(JSON.stringify({ error: "Gemini API key not configured" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // The brand_posts are market reference, not the client's own profile. Two consequences below:
      // the extracted palette is the REFERENCE's and must never become the company's colours, and
      // the brief describes the reference, so it must not be sent to the client as "sua marca".
      const brandPostsAreProxy = Boolean((payload as any).brandPostsAreProxy);

      // Brand posts: deep visual identity analysis (up to 10 images)
      const brandUrls = [
        ...(Array.isArray((payload as any).brandImageUrls) ? (payload as any).brandImageUrls : []),
        // legacy fallback — worker still passes referenceImageUrls
        ...(Array.isArray((payload as any).referenceImageUrls) ? (payload as any).referenceImageUrls : []),
        ...(Array.isArray((payload as any).campaignData?.composeCompanyRefs) ? (payload as any).campaignData.composeCompanyRefs : []),
      ]
        .filter((u: unknown): u is string => typeof u === "string" && u.startsWith("http"))
        .slice(0, 10);

      // Competitor posts: layout patterns only (up to 6 images)
      const competitorUrls = (Array.isArray((payload as any).competitorImageUrls)
        ? (payload as any).competitorImageUrls as unknown[]
        : []
      ).filter((u): u is string => typeof u === "string" && u.startsWith("http")).slice(0, 6);

      if (!brandUrls.length) {
        console.warn(`[brand_visual]${jobId ? ` job=${jobId}` : ""} no brand URLs provided`);
        return new Response(JSON.stringify({ brief: "", reason: "no_brand_urls" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Fetch brand images
      const fetchedBrand = await Promise.all(
        brandUrls.map((url, i) =>
          fetchImageAsBase64(url)
            .then((img) => (img ? { label: `Brand post ${i + 1}`, ...img } as ReferenceImage : null))
            .catch(() => null)
        )
      );
      const brandRefs = fetchedBrand.filter((r): r is ReferenceImage => r !== null);

      if (!brandRefs.length) {
        console.warn(`[brand_visual]${jobId ? ` job=${jobId}` : ""} all ${brandUrls.length} brand image fetches failed (timeout/non-image/404)`);
        return new Response(JSON.stringify({ brief: "", reason: "brand_refs_unfetchable" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Client site images — the client's OWN visual identity (screenshot/hero of their site).
      // Only meaningful in proxy mode: they give the model real material to pull COLOUR/feel from,
      // so the brief becomes the client's identity executed with the competitor's STRUCTURE instead
      // of describing the competitor's colours. Empty → falls back to structure-only colorless.
      const siteUrls = (Array.isArray((payload as any).siteImageUrls) ? (payload as any).siteImageUrls as unknown[] : [])
        .filter((u): u is string => typeof u === "string" && u.startsWith("http")).slice(0, 3);
      const fetchedSite = await Promise.all(
        siteUrls.map((url, i) =>
          fetchImageAsBase64(url)
            .then((img) => (img ? { label: `Client site ${i + 1}`, ...img } as ReferenceImage : null))
            .catch(() => null)
        )
      );
      const siteRefs = fetchedSite.filter((r): r is ReferenceImage => r !== null);
      const hasSiteIdentity = brandPostsAreProxy && siteRefs.length > 0;

      // ── Phase 1: full brand visual identity ────────────────────────────────
      // The brief is written FROM the brand posts. When those posts are a PROXY (market reference,
      // not this client's own profile), any colour/palette/typography the model reads is the
      // REFERENCE's — and this brief flows into the compose background prompt AND the Gemini store.
      // Scrubbing colour at compose time (a carve-out) is fighting 300+ words of vivid colour prose
      // after the fact; the robust fix is to never let colour into the brief. So the proxy variant
      // profiles STRUCTURE ONLY — layout, composition, motif SHAPES, depth, density, finish — and
      // is forbidden from naming any colour, palette, grade or typography. Colour then comes solely
      // from the brand's explicit primaryColor/accentColor downstream.
      const BRAND_IDENTITY_SYSTEM = hasSiteIdentity ? [
        // proxy + client site images: combine the two identities by ROLE.
        "You are a senior art director. You are given TWO image groups with DIFFERENT, non-negotiable roles:",
        "• 'CLIENT SITE' images = THIS client's OWN brand. They are the ONLY source of COLOUR, palette, tones, mood and overall brand feel.",
        "• 'MARKET REFERENCE' images = competitors in the same niche. They are the ONLY source of LAYOUT, composition, decorative devices, density and niche energy — take their STRUCTURE, NEVER their colour or identity.",
        "Write 300-400 words of dense, actionable prose describing the CLIENT'S visual identity (colour + feel, from CLIENT SITE) EXECUTED with this niche's structural conventions (layout + decoration, from MARKET REFERENCE). The result must feel unmistakably like the CLIENT'S brand, arranged like a strong, richly-designed ad in this market — never plain or empty.",
        "",
        // ⚠️ NO EXAMPLE COLOURS HERE, EVER. This line used to read "(warm coral, deep navy — never
        // hex)" and the model simply parroted the sample back: an amber (#fee701) brand got a brief
        // built on "a deep, sophisticated navy accented by a warm, energetic coral". An illustrative
        // palette in the instruction becomes the output palette whenever the CLIENT SITE images are
        // weak — so describe the RULE, never a specimen.
        "COLOUR SYSTEM — from CLIENT SITE ONLY: name, in plain English colour words (never hex), ONLY the colours you can actually SEE in the CLIENT SITE image(s) — say which dominates and which accent. ⛔ NEVER name a colour taken from the MARKET REFERENCE images, and NEVER invent or assume a palette: if the CLIENT SITE images do not show a clear one, write NOTHING about colour at all rather than guessing. Render the market's decorative devices IN THE CLIENT'S colours.",
        "BACKGROUND & DECORATIVE STRUCTURE — from MARKET REFERENCE ONLY: background type (photo/flat/gradient + direction), texture layer, and the signature decorative devices (dots, blobs, shapes, particles, halftone…) with their density and placement. Match the market's RICHNESS — if the references are heavily decorated, decorate just as much.",
        "DEPTH & LAYERING, SUBJECT TREATMENT, COMPOSITION ENERGY — from MARKET REFERENCE.",
        "FINISH & MOOD: the client's mood (from CLIENT SITE) applied over the market's structure.",
        "",
        "Return ONLY the brief — no preamble, no section headers, no bullet points, no markdown, no hex codes.",
      ].join("\n") : brandPostsAreProxy ? [
        "You are a senior art director extracting the STRUCTURAL DESIGN LANGUAGE from a set of MARKET/CATEGORY REFERENCE posts. These are NOT the client's own brand — they are reference material for layout only.",
        "Your output will be used as a creative brief for an AI image generation model to lay out on-brand advertising backgrounds. The brand's OWN colours are supplied separately and are the only colours that matter — so your brief must be COLOUR-BLIND.",
        "Write 220-320 words of dense, specific, actionable prose about STRUCTURE ONLY.",
        "",
        "⛔ ABSOLUTELY FORBIDDEN — do NOT mention any of these, not even once: any colour name or hue (blue, coral, navy, warm, cool, pastel…), any palette/hex/tint/duotone, any colour grade or 'mood' conveyed by colour, and any typography/font/lettering. If you catch yourself about to describe a colour, describe the SHAPE, PLACEMENT or DENSITY instead.",
        "",
        "Cover ONLY the following — be hyper-specific, never generic:",
        "BACKGROUND STRUCTURE: Is the background photography, a flat field, or a gradient (describe the gradient's DIRECTION and softness, never its colours)? Is there a texture layer on top (grain, noise, halftone, paper)?",
        "SIGNATURE DECORATIVE DEVICES (SHAPES ONLY): The recurring motifs — scattered dots/bokeh, floating geometric shapes, confetti, botanical line art, hand-drawn strokes, sticker/emoji overlays, blobs, particle bursts, light leaks, film grain. Name the SHAPES precisely and say how densely they appear and where (corners, full bleed, behind the subject). Never their colour.",
        "DEPTH & LAYERING: Flat (one plane) vs layered (background → decorative mid-layer → subject → text). Foreground blur? Drop shadows? Overlapping translucent elements? 3D separation or flat sticker-on-background?",
        "SUBJECT TREATMENT: How are products or people positioned — centered, off-center, cropped, floating, cutout silhouette, placed on a surface? Any consistent framing device (circle mask, arch, frame line)?",
        "COMPOSITION ENERGY: Symmetric and still vs asymmetric and kinetic. Where does the eye land first? Airy with breathing room, or dense and packed?",
        "FINISH (NON-COLOUR): Matte vs glossy, raw/gritty vs clean digital, sharp vs soft — surface qualities only, never colour or colour-mood.",
        "",
        "Return ONLY the structural brief — no preamble, no section headers, no bullet points, no markdown. Not a single colour word or font name.",
      ].join("\n") : [
        "You are a senior art director profiling a brand's complete VISUAL DESIGN LANGUAGE from its real Instagram posts.",
        "Your output will be used as the authoritative creative brief for an AI image generation model to produce on-brand advertising backgrounds.",
        "Write 300-400 words of dense, specific, actionable prose. Another designer reading this must be able to recreate the EXACT visual feel of this brand on a fresh ad with no other reference.",
        "",
        "Cover ALL of the following — be hyper-specific, never generic:",
        // No example palette here either — see the CLIENT SITE variant above: a sample palette in the
        // instruction gets parroted back as the brand's own.
        "COLOR SYSTEM: Name every color you actually see in use, in plain English colour words (never hex). Identify which is dominant, which is accent, and how they relate (analogous harmony, high contrast, muted pastels, etc.). Note if backgrounds are always pure white/black or always tinted.",
        "BACKGROUND TREATMENT: Is the background always photography, always flat color, always gradient? What is the gradient direction and color transition? Is there always a texture layer on top (grain, noise, halftone)?",
        "SIGNATURE DECORATIVE DEVICES: The specific recurring motifs — scattered dots/bokeh, floating geometric shapes, confetti, botanical line art, hand-drawn strokes, sticker/emoji overlays, gradient blobs, particle bursts, light leaks, film grain, duotone washes. Name them precisely and say how densely they appear and where (corners, full bleed, behind the subject).",
        "DEPTH & LAYERING: Flat (everything on one plane) vs layered (background → decorative mid-layer → subject → text). Is there visible foreground blur? Drop shadows? Overlapping translucent elements? 3D separation or flat sticker-on-background?",
        "SUBJECT TREATMENT: How are products or people positioned — centered, off-center, cropped, floating, cutout silhouette, placed on a surface? Is there a consistent framing device (circle mask, arch, frame line)?",
        "COMPOSITION ENERGY: Symmetric and still vs asymmetric and kinetic. Where does the eye land first? Is the layout airy with lots of breathing room, or dense and packed?",
        "TYPOGRAPHY VIBE (describe the STYLE, not the font name): Weight (ultra-bold, thin, medium), case (all-caps, sentence, mixed), tracking (tight/loose), serif vs sans, editorial vs playful. How does headline size relate to body size?",
        "FINISH & MOOD: Matte paper feel, glossy editorial, raw/gritty, clean digital, warm/nostalgic, cold/clinical, vibrant/saturated, desaturated/editorial.",
        "",
        "Return ONLY the brand identity brief — no preamble, no section headers, no bullet points, no markdown, no hex codes.",
      ].join("\n");

      let brandBrief = "";
      try {
        // In proxy mode brandRefs are the competitor/market posts — relabel so the model reads them
        // as reference, not "the brand". When we also have site images, send BOTH groups (site first
        // so identity leads) with their role labels intact.
        const proxyBrandRefs = brandRefs.map((r, i) => ({ ...r, label: `Market reference ${i + 1}` }));
        const identityImages = hasSiteIdentity
          ? [...siteRefs, ...proxyBrandRefs]
          : brandPostsAreProxy ? proxyBrandRefs : brandRefs;
        const userMsg = hasSiteIdentity
          ? `Combine the two groups by role: take COLOUR and brand feel ONLY from the ${siteRefs.length} CLIENT SITE image(s), and LAYOUT / decoration / structure ONLY from the ${proxyBrandRefs.length} MARKET REFERENCE post(s). Write the client's identity executed with the market's structure — rich and unmistakably on-brand.`
          : brandPostsAreProxy
            ? `Analyze the STRUCTURE of these ${brandRefs.length} market-reference posts and write the structural brief. Describe layout, composition, motif shapes, depth and density ONLY — not a single colour word or font.`
            : `Analyze these ${brandRefs.length} brand posts and write the complete visual identity brief.`;
        const brandVis = await generateWithRetry(
          BRAND_IDENTITY_SYSTEM,
          userMsg,
          "gemini-2.5-flash", 0.4, 1200, visKey, undefined, identityImages, { jobId, thinkingBudget: 0 },
        );
        // Full brief — no char cap. maxOutputTokens 1200 comfortably fits the 300-400 word target
        // (~550 tokens) ONLY with thinkingBudget:0 — gemini-2.5 thinks by default and those tokens
        // come out of the same budget, which was leaving ~240 chars of brief cut mid-sentence.
        brandBrief = String(brandVis.text || "").trim();
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        console.error(`[brand_visual]${jobId ? ` job=${jobId}` : ""} brand identity Gemini error: ${errMsg}`);
        return new Response(JSON.stringify({ brief: "", reason: "gemini_error", gemini_error: errMsg.slice(0, 300) }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (!brandBrief) {
        console.warn(`[brand_visual]${jobId ? ` job=${jobId}` : ""} Gemini returned empty brief after ${brandRefs.length} brand images`);
        return new Response(JSON.stringify({ brief: "", reason: "gemini_empty" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // ── Phase 1b: extract color palette as usable hex values ─────────────
      // Separate call so the prose brief stays clean and PHP gets machine-readable colors
      // to store as primaryColor/secondaryColor/accentColor/backgroundColor/textColor.
      let colorPalette: Record<string, string> = {};
      // Skipped entirely for proxy posts: the palette would be the REFERENCE's, and PHP merges it
      // into the company's colour fields whenever they are empty — which is exactly the state a
      // brand with no site/Instagram is in. That write is sticky (the merge guard is
      // `empty($formData[$colorKey])`, so nothing later overwrites it) and the colour lock would
      // then lock onto the reference's colour forever. Not extracting it also saves the call.
      if (brandPostsAreProxy) {
        console.log(`[brand_visual]${jobId ? ` job=${jobId}` : ""} proxy posts → palette extraction skipped`);
      } else try {
        const COLOR_EXTRACTION_SYSTEM = [
          "You are a color extraction specialist. Analyze these brand Instagram posts and identify the exact brand color palette.",
          "Return ONLY a valid JSON object with exactly these 5 keys (lowercase hex values, no explanation, no markdown):",
          '{"primary":"#hex","secondary":"#hex","accent":"#hex","background":"#hex","text":"#hex"}',
          "primary: the most dominant brand color (used in main elements, CTA buttons, or hero backgrounds)",
          "secondary: the second brand color (supporting elements, gradients, or alternate sections)",
          "accent: the highlight/pop color used sparingly for contrast or calls to action",
          "background: the most common background color of the posts (white, black, or a specific brand color)",
          "text: the primary text/headline color (white, black, or a dark/light brand tone)",
          "If a color is ambiguous, make an educated best guess. Always return all 5 keys. Return ONLY the JSON object.",
        ].join("\n");

        const colorRes = await callGemini(
          COLOR_EXTRACTION_SYSTEM,
          `Extract the 5-color brand palette from these ${brandRefs.length} Instagram posts. Return only the JSON object.`,
          "gemini-2.5-flash", 0.1, 150, visKey, undefined, brandRefs, { jobId },
        );
        const colorText = String(colorRes.text || "").trim();
        const jsonMatch = colorText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          const isHex = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-fA-F]{3,8}$/.test(v.trim());
          if (isHex(parsed.primary))    colorPalette.primaryColor    = parsed.primary.trim();
          if (isHex(parsed.secondary))  colorPalette.secondaryColor  = parsed.secondary.trim();
          if (isHex(parsed.accent))     colorPalette.accentColor     = parsed.accent.trim();
          if (isHex(parsed.background)) colorPalette.backgroundColor = parsed.background.trim();
          if (isHex(parsed.text))       colorPalette.textColor       = parsed.text.trim();
        }
        console.log(`[brand_visual]${jobId ? ` job=${jobId}` : ""} palette extracted: ${JSON.stringify(colorPalette)}`);
      } catch (e) {
        console.warn(`[brand_visual]${jobId ? ` job=${jobId}` : ""} color extraction failed (non-fatal): ${e instanceof Error ? e.message : String(e)}`);
      }

      // ── Phase 2: competitor layout patterns (if provided) ──────────────────
      let competitorSection = "";
      if (competitorUrls.length > 0) {
        const fetchedComp = await Promise.all(
          competitorUrls.map((url, i) =>
            fetchImageAsBase64(url)
              .then((img) => (img ? { label: `Competitor post ${i + 1}`, ...img } as ReferenceImage : null))
              .catch(() => null)
          )
        );
        const compRefs = fetchedComp.filter((r): r is ReferenceImage => r !== null);

        if (compRefs.length > 0) {
          const COMPETITOR_LAYOUT_SYSTEM = [
            "You are analyzing competitor Instagram posts to extract LAYOUT AND COMPOSITION PATTERNS ONLY.",
            "FORBIDDEN: extracting or describing any color scheme, brand colors, logo, typography, brand personality, or any identity element. These belong to the competitor and must NEVER influence this brand's output.",
            "ALLOWED: abstract structural patterns only — where is the text block (top/bottom/left/right/center), what proportion of the frame does imagery occupy vs text zone, how is the CTA positioned, is there a product image and where does it sit, what is the visual hierarchy order.",
            "Write 100-150 words describing only these structural/compositional patterns.",
            "Return ONLY the layout patterns — no preamble, no headers.",
          ].join("\n");

          const compVis = await callGemini(
            COMPETITOR_LAYOUT_SYSTEM,
            `Extract layout and composition patterns from these ${compRefs.length} competitor posts.`,
            "gemini-2.5-flash", 0.3, 400, visKey, undefined, compRefs, { jobId },
          );
          const compText = String(compVis.text || "").trim().slice(0, 600);
          if (compText) {
            competitorSection = `\n\n[COMPETITOR LAYOUT PATTERNS — structure only, no identity]\n${compText}`;
          }
        }
      }

      const brief = (brandBrief + competitorSection).trim();

      // ── Phase 3: pt-BR rendering for the human deliverable ────────────────
      // `brief` MUST stay English: it feeds the image model (compose → buildBackgroundPrompt)
      // and the Gemini store, and those adhere better to English. `briefPt` is a separate,
      // client-facing rendering sent over WhatsApp as the "estudo de design". Translating
      // `brief` itself would silently push pt-BR text into every ad's image prompt.
      // Non-fatal: on failure briefPt is empty and the caller falls back to `brief`.
      //
      // Source is `brandBrief`, NOT `brief`: the competitor section is deliberately excluded.
      // It carries the internal prompt directive "[COMPETITOR LAYOUT PATTERNS — structure only,
      // no identity]" (a rule for Gemini, meaningless to a client and internal machinery we do
      // not expose), and the client asked for a study of THEIR brand — a paragraph on a rival's
      // post structure does not belong in it. The section stays in `brief`, where it usefully
      // gives the generator the niche's layout patterns.
      let briefPt = "";
      // Suppressed for proxy posts: the brief describes the REFERENCE's identity, and the client
      // receives brief_pt under the header "🎨 Análise de design da sua marca" — that would tell
      // them their brand is something it is not. Empty here means n8n's `ready` never fires on a
      // proxy brief and the client is simply not sent a design study, which is the correct outcome
      // until there is a deliverable actually about them.
      if (brandPostsAreProxy) {
        console.log(`[brand_visual]${jobId ? ` job=${jobId}` : ""} proxy posts → brief_pt suppressed`);
      } else try {
        const TRANSLATE_SYSTEM = [
          "You translate brand design briefs from English to Brazilian Portuguese (pt-BR).",
          "This text is read by the brand's owner — a client, not a designer. Translate faithfully:",
          "keep every specific detail (colors, motifs, composition, typography, mood) and the same",
          "paragraph structure. Do not summarize, do not add or drop information, do not add a preamble.",
          "Use natural pt-BR design vocabulary. Keep established English design terms that pt-BR",
          "designers use untranslated (ex.: layout, grid, close-up, bokeh, gradiente, lettering).",
          "Return ONLY the translated text.",
        ].join("\n");

        const ptRes = await generateWithRetry(
          TRANSLATE_SYSTEM,
          `Translate this brand design brief to pt-BR:\n\n${brandBrief.trim()}`,
          "gemini-2.5-flash", 0.2, 2600, visKey, undefined, undefined, { jobId, thinkingBudget: 0 },
        );
        briefPt = String(ptRes.text || "").trim();
      } catch (e) {
        console.warn(`[brand_visual]${jobId ? ` job=${jobId}` : ""} pt-BR translation failed (non-fatal): ${e instanceof Error ? e.message : String(e)}`);
      }

      console.log(`[brand_visual]${jobId ? ` job=${jobId}` : ""} brandRefs=${brandRefs.length} competitorUrls=${competitorUrls.length} briefLen=${brief.length} briefPtLen=${briefPt.length} paletteKeys=${Object.keys(colorPalette).length}`);
      return new Response(JSON.stringify({ brief, brief_pt: briefPt, palette: colorPalette }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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
        { responseMimeType: "application/json", responseSchema: COPY_JSON_SCHEMA, jobId },
      );

      let copyJson: unknown;
      try { copyJson = JSON.parse(copyResult.text); } catch { copyJson = { mainHeadline: "", subheadline: "", ctaText: "" }; }

      return new Response(
        JSON.stringify({ mode: "copy", copy: copyJson }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // HTML modes need both stores. Compose uses brandVisualBrief from campaignData directly —
    // store is optional for compose (falls back to brief-only when company-assets wasn't called yet).
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
    // Logo is never fetched as base64 — it goes into the HTML as <img src="url">.
    // Only product and background images are references for the generation model.
    const imageSpecs = [
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
            fetchImageAsBase64(url).then((img) => (img ? { label, ...img } : null)).catch(() => null)
          )
        )
      : [];
    const referenceImages: ReferenceImage[] = fetchedImages.filter((img): img is ReferenceImage => img !== null);

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

      // Creative spec from interpret step — scrubbed of hex/codes/URLs so the model never
      // renders them as text (the brand palette still reaches it via the reference images).
      const spec = scrubBgPromptText(String(payload.creativePlan || "").trim());
      const costAcc = { usd: 0, images: 0, jobId }; // per-generation cost tracker (this request)

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
      console.log(`[cost-total]${jobId ? ` job=${jobId}` : ""} mode=image images=${costAcc.images} ~= $${costAcc.usd.toFixed(5)}`);
      return new Response(JSON.stringify({ mode: "image", images }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (mode === "compose") {
      const campaignFactsImg = buildCampaignFactsForCompose(campaignData);
      const costAcc = { usd: 0, images: 0, jobId }; // per-generation cost tracker (this request)

      // CRITICAL: never pass the logo to the background image generator.
      // The logo is composited later in HTML (buildCompositionHtml). Passing it as a
      // visual reference causes the model to embed it in the background pixel art.
      const refImagesForGen = referenceImages.map((r) => ({ data: r.data, mimeType: r.mimeType }));

      // Brand visual identity brief (TEXT) — distilled ONCE from the reference images by the
      // worker. When present it carries the brand's design language as words, which lets the
      // image model RE-COMPOSE freely (more creative, less "closed") instead of copying pixels —
      // and means we no longer re-send raw base64 on every generation (cheaper tokens).
      // Set by company-assets.php when the stored brand_posts are market reference rather than the
      // client's own profile (empty Instagram). Gates the colour rules in buildBackgroundPrompt.
      const brandPostsAreProxy = Boolean((campaignData as any).brandPostsAreProxy);
      // How many of the LEADING composeCompanyRefs are the client's OWN website (set by
      // generate-ads-worker.php). In proxy mode the site is the ONLY source of this brand's colour
      // and identity — the trailing refs are competitor posts used for structure only. When present
      // it BOTH suppresses the Pexels/UGC auto-hijack below (so the real site+competitor refs drive
      // the background instead of a random stock person) AND flips the colour/role rules so the
      // scene is graded to the site, never the competitor.
      const siteRefCount = Math.max(0, Number((campaignData as any).composeSiteRefCount) || 0);
      const hasSiteIdentity = brandPostsAreProxy && siteRefCount > 0;
      let visualBrief = String((campaignData as any).brandVisualBrief || "").trim();
      // The COMPLETE 300-400 word brief is the company's stored brand KNOWLEDGE, produced by the
      // company-assets call — it stays full there. But in GENERATION, injecting the whole brief
      // makes the text description dominate the image prompt and drown out the actual reference
      // images + brand posts: every ad ends up looking the same and ignoring the refs (the exact
      // "sem variação / sem influência das refs" regression). Cap the brief to a short digest here
      // so the reference IMAGES drive the visual — the pre-1e37bc1 / banner261 behaviour. The full
      // brief on the company store is untouched.
      const GEN_VISUAL_BRIEF_CAP = 2000; // matches the generation brief length before 1e37bc1
      if (visualBrief.length > GEN_VISUAL_BRIEF_CAP) {
        visualBrief = visualBrief.slice(0, GEN_VISUAL_BRIEF_CAP).trim();
      }
      const briefDriven = visualBrief.length > 0;

      // ── Background source (compose) ────────────────────────────────────────
      //  reference: the user's product/background images ARE the reference (match closely)
      //  shapes   : no photo — abstract geometric/brand-color background (no refs)
      //  company  : derive the background from the company's own images
      //  creative : full freedom — the model invents the best backdrop
      const explicitBgSource = String((campaignData as any).composeBackgroundSource || "").toLowerCase();
      // Caller explicitly sent a reference image to FEATURE (composeHeroRef from PHP). This makes
      // buildBackgroundPrompt reproduce the first reference's subject as the hero, overriding the
      // default style-only/creative-freedom treatment regardless of the resolved bgSource.
      let heroRef = Boolean((campaignData as any).composeHeroRef);
      // Caller sent a real product image (product_image_url) → feature that product in the scene
      // (don't let the "ebook/digital → don't render an object" rule hide it). Not for hero refs.
      const hasProductRef = !heroRef && Boolean(String((campaignData as any).productImageUrl || "").trim());
      // composeCompanyRefs: brand reference images uploaded by the caller (style examples).
      // When present without an explicit bgSource, treat as "company" so the model studies them.
      const hasCompanyRefs = Array.isArray((campaignData as any).composeCompanyRefs) &&
        ((campaignData as any).composeCompanyRefs as unknown[]).some(
          (u): u is string => typeof u === "string" && u.startsWith("http")
        );
      let bgSource = ["reference", "shapes", "company", "creative"].includes(explicitBgSource)
        ? explicitBgSource
        : String(campaignData.backgroundImageUrl || "").startsWith("http")
          ? "reference"
          : hasCompanyRefs
            ? "company"   // study brand refs → derive original background from that world
            : "creative"; // no refs at all → full AI creative freedom
      // With a text brief in hand, prefer creative freedom (guided by the brief) over copying
      // pixels — this is what unlocks the brand's design devices and depth. 'shapes' and
      // 'inspired' are kept as-is ('inspired' already has full freedom + the ref image).
      // When the brand brief exists AND brand reference images are present (e.g. Instagram posts
      // stored via company-assets), keep them working TOGETHER — brief provides the text
      // description of the visual identity, images provide the pixel evidence. Only switch to
      // "creative" when brief exists but there are NO images to reference.
      if (briefDriven && !hasCompanyRefs && bgSource !== "shapes") bgSource = "creative";

      // ── External-API auto-mode: randomise the look when NO reference image was sent ──────────
      // ONLY for EXTERNAL API generations (campaignData.externalApiContract is set by
      // generate-ads.php) that sent NO reference image (no hero ref, no product image, no
      // background image). Randomly route the look (seeded by jobId) so generations don't all look
      // the same. Pool EXCLUDES 'creative' (too generic for the API):
      //   with brand posts → {ugc, company};  without brand posts → {ugc, shapes}.
      // 'ugc' features a real person — pulled from Pexels, or invented in-prompt if Pexels is down.
      // Brand posts are STILL used in every branch (they are NOT a "reference image"). This whole
      // block is skipped whenever the caller sent a reference image — that path stays untouched.
      let ugcNoRef = false;
      // Marks a hero that came from the AUTO-Pexels stock fetch (NOT a caller-chosen reference). A
      // stock full-scene photo must be RE-STAGED creatively in the brand's style (castingRef=true),
      // whereas a caller's own image (Diego) is reproduced faithfully (castingRef=false).
      let pexelsAuto = false;
      const isExternalApi = Boolean(String((campaignData as any).externalApiContract || "").trim());
      const callerSentBgUrl = String(campaignData.backgroundImageUrl || "").startsWith("http");
      // External API with NO reference image → randomly (seeded by jobId) decide whether to feature
      // a REAL PERSON (pulled from Pexels, a different one each time) or a PERSON-FREE brand scene.
      // This variety keeps the API's ads from all looking the same. 'creative' stays OUT of the
      // rotation (too generic); the person-free branch uses the brand's own world ('company') when
      // brand posts exist, else abstract brand shapes. Caller-supplied ref images are untouched.
      // Caller opt-out: if they explicitly asked for a 'creative' (invented) or 'shapes' (abstract)
      // background, DON'T fetch a Pexels photo — honour the request and let the model invent/abstract.
      // hasSiteIdentity opts OUT of Pexels too: in proxy+site mode the client's own site (+ the
      // competitor structure posts) ARE the reference — a random stock hero would throw both away
      // and produce the generic, colourless, site-less background this feature exists to prevent.
      const skipPexels = explicitBgSource === "creative" || explicitBgSource === "shapes" || hasSiteIdentity;
      if (isExternalApi && !heroRef && !hasProductRef && !callerSentBgUrl && !skipPexels) {
        // ALWAYS try to ground the generation in a REAL Pexels photo (no more jobId coin-flip). A
        // real reference scene makes the model REPRODUCE reality instead of INVENTING — the invented
        // path is what burns fake text/buttons/dashboards/logo-icons into the bg. Derive a
        // CONTEXT-aware query (a person with a phone, a coffee cup, a gym…) so the fetched photo
        // actually matches the ad's topic, not a generic portrait. Brand posts still layer in as
        // style below. Fall back to an invented scene only if Pexels has no key / no result.
        const pexQuery = (await pexelsQueryForCampaign(campaignFactsImg, apiKey, { jobId, costAcc }))
          || buildUgcPersonQuery(campaignData);
        const pexUrl = await fetchPexelsUrl(pexQuery, imageAspectRatioForFormat(formats[0]));
        if (pexUrl) {
          // Send the Pexels photo through the IDENTICAL path as a caller-sent reference_image: set it
          // as referenceImageUrl, flag composeHeroRef, and put it FIRST in composeCompanyRefs. The edge
          // then fetches + treats it EXACTLY like any user reference (Diego etc.) — no special base64
          // injection, no divergent handling.
          (campaignData as any).referenceImageUrl = pexUrl;
          (campaignData as any).composeHeroRef = true;
          const existingRefs = Array.isArray((campaignData as any).composeCompanyRefs)
            ? ((campaignData as any).composeCompanyRefs as unknown[]).filter((u): u is string => typeof u === "string" && u.startsWith("http"))
            : [];
          (campaignData as any).composeCompanyRefs = [pexUrl, ...existingRefs.filter((u) => u !== pexUrl)];
          heroRef = true;
          bgSource = "company";
          pexelsAuto = true;      // stock hero → RE-STAGE creatively in the brand's style (not reproduce)
        } else {
          ugcNoRef = true;        // no Pexels → invent a believable scene in the prompt
          if (bgSource === "reference") bgSource = "creative";
        }
        console.log(`[ugc-auto] job=${jobId ?? "?"} pexQuery="${pexQuery}" pexels=${pexUrl ? "as-ref" : "miss->invent"}`);
      }

      // ── Store-derived brand brief (compose) ───────────────────────────────
      // Query the company store for brand visual identity guidelines BEFORE generating the
      // background. This runs even when creativePlan is set — creativePlan carries HTML/layout
      // direction for the text overlay; the store query carries visual DNA for the IMAGE model.
      // Without this, the image model only gets hex colors from campaignData and cannot embody
      // the brand's deeper design language (motifs, layers, depth, Instagram aesthetic, etc.).
      // Does NOT override bgSource: store brief and reference images work together.
      if (!briefDriven && companyStoreName?.trim()) {
        const composeStores = [companyStoreName, globalStoreName]
          .filter((s): s is string => Boolean(s?.trim()));
        try {
          const brandQuery = await callGemini(
            [
              "You are a brand visual identity analyst for advertising image generation.",
              "Query the company store and extract TWO distinct sections:",
              "",
              "SECTION 1 — BRAND VISUAL DNA (from the brand's own Instagram profile analysis):",
              "Extract the brand's CORE visual style in terms of: color palette and grading, lighting approach, photography and subject treatment (how products/subjects are framed, cropped, lit, and where they sit), composition and use of negative space, and overall mood. Favor clean, focused, premium descriptions. Do NOT instruct adding decorative clutter — no 'scattered dots/confetti/sparkles/badges/many geometric shapes/diagonal strips'; keep it restrained and uncluttered. Be specific and concrete about color and lighting (e.g. 'warm peach-to-coral palette, soft daylight, single product centered with generous negative space'), not generic ('uses gradient').",
              "",
              "SECTION 2 — LAYOUT INSPIRATION (from competitor examples, if present in the store):",
              "Extract only composition and layout patterns: subject placement, visual hierarchy structure, text-zone positioning, use of negative space. NEVER extract competitor colors, fonts, brand elements, or visual style.",
              "",
              "Return exactly in this format (no preamble, no extra commentary):",
              "BRAND_DNA: [paragraph describing the brand's specific visual devices — be concrete and specific]",
              "LAYOUT_INSPIRATION: [one or two sentences on effective composition patterns from competitor analysis, or 'none' if not available]",
            ].join("\n"),
            `Brand: ${String(campaignData.businessName || "").trim() || "unknown"}. Industry: ${String(campaignData.businessCategory || "").trim() || "unknown"}.`,
            "gemini-2.5-flash",
            0.2,
            600,
            apiKey,
            composeStores,
            undefined,
            { jobId, costAcc },
          );
          if (brandQuery.text?.trim()) visualBrief = brandQuery.text.trim();
        } catch (_) { /* non-fatal — fall through with existing brief */ }
      }

      // ── Theme scene (compose) ─────────────────────────────────────────────
      // Derive ONE concrete "scene of success" from THIS campaign's topic, so the image model
      // places the hero (the reference person, when heroRef) INTO a setting that matches the
      // ad's theme — instead of defaulting to the same content-creator / ring-light scene for
      // every campaign (the finance/skincare-ad-still-shows-a-creator regression). The person's
      // identity still comes from the reference image; this only dictates the SETTING, PROPS and
      // ACTION around them. Only runs for the photographic person/subject paths (skip abstract
      // 'shapes' and the reference short-path, which don't build a topic scene).
      let themeScene = "";
      const wantsThemeScene = heroRef || ugcNoRef || hasProductRef ||
        bgSource === "creative" || (bgSource === "company" && !heroRef);
      if (wantsThemeScene && campaignFactsImg.trim()) {
        // The hero is a PRODUCT (object) when a product image was sent; otherwise a PERSON
        // (reference person, invented UGC person, or brand scene). The derived scene must keep
        // the correct hero: a product scene FEATURES the object; a person scene places the person.
        const sceneSystem = hasProductRef
          ? [
              "You are an advertising art director. A physical PRODUCT (an object) is the hero of this ad and MUST be featured prominently — large in the frame and in sharp focus. From the campaign facts, describe ONE concrete scene that SHOWCASES THIS product in the real, literal context of the campaign's topic.",
              "STRICT RULES:",
              "• The product itself is the clear focal point (fills a large part of the frame). Around it add ONLY the real environment, surface and props that THIS topic implies (e.g. running shoes resting on a forest trail or being laced up trailside; a coffee bag on a rustic café counter beside a fresh cup; a watch on a marble surface in warm light).",
              "• Derive the context from THIS topic only. Do NOT default to a content-creation / social-media / ring-light / phone-filming setup.",
              "• A person may appear ONLY partially (hands, legs) to interact with the product if the topic calls for it — the PRODUCT stays the hero and is never replaced by a full person or a wide lifestyle scene where the product is small or absent.",
              "• Describe ONLY the product's placement, the setting, props and lighting mood — NO text or logos on any surface.",
              "• Output ONE or TWO sentences, concrete and vivid. No preamble, no lists.",
            ]
          : [
              "You are an advertising art director. From the campaign facts, describe ONE concrete, literal 'scene of success' for the ad's hero — the exact SETTING, PROPS and ACTION/POSE that make THIS campaign's topic instantly recognizable from the image alone, with no text.",
              "STRICT RULES:",
              "• ⭐ DEPICT THE LITERAL WORK/DELIVERABLE OF THE EXACT PRODUCT OR SERVICE NAMED IN THE FACTS — the specific thing the customer is buying, shown being done with its real, correct tools. Read the service name carefully and match the ACTUAL activity, not a loose word-association. (e.g. social-media MANAGEMENT → a marketer at a laptop/desk showing an Instagram feed grid, engagement analytics and a content calendar, phone with the app in hand; SEO → keyword dashboards and search-ranking graphs on a monitor; accounting → spreadsheets and invoices at an organised desk; catering → plated food on a banquet table.)",
              "• ⛔ DO NOT DRIFT TO A TANGENTIAL OR ADJACENT-INDUSTRY CLICHÉ. Words like 'conteúdo', 'redes sociais', 'mídia', 'produção' do NOT mean a DJ booth, a music/audio mixing console, a recording/podcast studio, a soundboard, a radio booth or a film set — use those ONLY if the service is literally audio/video/music production. When in doubt, show the service's real back-office/desk work, not a glamorous creative studio.",
              "• Do NOT default to a generic content-creation / filming / ring-light / streaming setup UNLESS the topic is literally about filming or creating video content. For finance, health, skincare/beauty, food, retail, education, fitness, real estate, etc., a ring light or phone-filming scene is WRONG.",
              "• Name the real environment and the real prop/action (e.g. skincare → bright bathroom vanity, applying cream, dewy skin; a budgeting app → calm kitchen table or café, glancing at a phone at chest height, notebook and coffee; fitness → gym floor mid-exercise with real equipment).",
              "• If the topic has no natural connection to a phone or screen, there must be NO phone/screen in the scene.",
              "• Describe ONLY setting, props, action and lighting mood — NOT the person's identity/appearance (a real person is supplied separately) and NO text or logos.",
              "• Output ONE or TWO sentences, concrete and vivid. No preamble, no lists.",
            ];
        try {
          const sceneRes = await callGemini(
            sceneSystem.join("\n"),
            campaignFactsImg.slice(0, 1600),
            "gemini-2.5-flash",
            0.4,
            220,
            apiKey,
            undefined,
            undefined,
            { jobId, costAcc },
          );
          themeScene = String(sceneRes.text || "").trim().slice(0, 500);
          if (themeScene) console.log(`[theme-scene] job=${jobId ?? "?"} ${themeScene.slice(0, 160)}`);
        } catch (_) { /* non-fatal — fall through with generic theme guidance in the prompt */ }
      }

      // User-uploaded reference images (the ads/visuals the caller wants to look like) arrive
      // in composeCompanyRefs. ONLY fetch+decode them for the sources that actually consume
      // them ('reference'/'company'/'inspired') — 'shapes'/'creative' discard refs, so we skip
      // the work entirely (no wasted base64). Bounded count + image-model-only bytes (never to a text model).
      const usesRefs = bgSource === "reference" || bgSource === "company" || bgSource === "inspired" || heroRef;
      const companyRefUrls = usesRefs && Array.isArray((campaignData as any).composeCompanyRefs)
        ? ((campaignData as any).composeCompanyRefs as unknown[])
            .filter((u): u is string => typeof u === "string" && u.startsWith("http"))
            .slice(0, 5)
        : [];
      // companyRefImages: fetch every composeCompanyRefs URL. When auto-mode set the Pexels photo as
      // referenceImageUrl above, that URL is already FIRST in composeCompanyRefs → it is fetched here
      // as companyRefImages[0], byte-identical to a caller-sent reference_image (no special-casing).
      const companyRefImages = (await Promise.all(
        companyRefUrls.map((url) => fetchImageAsBase64(url).catch(() => null))
      )).filter((r): r is { mimeType: string; data: string } => Boolean(r?.data));

      let bgRefImages: { data: string; mimeType: string }[];
      let brandRefCountInBg = 0; // how many brand-post images are in bgRefImages
      let genRefCountInBg = 0;   // how many generation-specific images are in bgRefImages

      if (!usesRefs) {
        bgRefImages = [];
      } else if (briefDriven && refImagesForGen.length > 0 && companyRefImages.length > 0) {
        // Brand brief + brand post images + generation-specific reference:
        // Reserve the last slot for the generation image so the model can distinguish roles.
        // The text brief already DISTILLS what's consistent across up to 10 posts — sending too
        // many raw posts alongside it invited the model to collage one-off elements from each
        // individual photo (busy, unnatural ads). Cap brand posts at 3: enough for the model
        // to CONFIRM the (sometimes abstract) brief against concrete examples — see what it
        // actually looks like in practice — without turning the generation into a multi-image blend.
        const brandSlice = companyRefImages.slice(0, 3);
        const genSlice = refImagesForGen.slice(0, 1);
        bgRefImages = [...brandSlice, ...genSlice];
        brandRefCountInBg = brandSlice.length;
        genRefCountInBg = genSlice.length;
      } else {
        // Standard: brand images + gen assets fill all slots (up to 5 total = hero + 4 brand posts).
        // Bumped 4→5 so the model has 4 brand-post examples to judge whether the brand uses design
        // assets and, if so, mirror their exact devices + colours (results were too generic / weak
        // on brand identity with only 3).
        bgRefImages = [...companyRefImages, ...refImagesForGen].slice(0, 5);
        brandRefCountInBg = Math.min(companyRefImages.length, bgRefImages.length);
      }

      // ── PROXY MODE: the competitor's PIXELS never reach the image model ──────────────────
      // In proxy mode the "brand posts" are a competitor's marketing posts, and they are declared
      // STRUCTURE ONLY everywhere in the prompt. But they are ADS: one is a headline reading
      // "O que a Conversion faz? — maior agência de SEO do Brasil" over a portrait, another is
      // nothing but a food-delivery wordmark on a flat red field. Handed those at full resolution,
      // the model traced them — a banner came back with "aglencies" burned in, a drawn logotype and
      // that red bleeding into the palette. Downscaling does not save it: a headline occupying a
      // third of the frame is LOW-frequency, so it survives even a blur strong enough to erase the
      // decorative devices we wanted to keep (measured, not assumed).
      //
      // The structure of those posts is already carried into the prompt as PROSE — that is exactly
      // what the proxy brief is for, and words cannot be traced as pixels. So in proxy mode we keep
      // the CLIENT's own site refs (their colour and identity, and they are not ads) and the
      // generation refs (hero/product — the actual subject), and drop the competitor images.
      // Untouched for every client with a real profile: non-proxy brand posts still go through
      // exactly as tuned.
      if (brandPostsAreProxy && brandRefCountInBg > siteRefCount) {
        const keptBrand = companyRefImages.slice(0, siteRefCount);
        const dropped = brandRefCountInBg - keptBrand.length;
        bgRefImages = [...keptBrand, ...refImagesForGen].slice(0, 5);
        brandRefCountInBg = keptBrand.length;
        genRefCountInBg = Math.max(0, bgRefImages.length - keptBrand.length);
        console.log(`[refs] job=${jobId ?? "?"} proxy mode: dropped ${dropped} competitor post image(s) from the image model (structure comes from the brief); kept ${keptBrand.length} client-site ref(s)`);
      }
      // Whether any competitor IMAGE is still attached, so the prompt's role sentences stay true to
      // what the model can actually see. Always true off the proxy path (real brand posts).
      const competitorRefsPresent = !brandPostsAreProxy || brandRefCountInBg > siteRefCount;

      // How many of the reference images actually in bgRefImages are the client's own site. The
      // worker prepends the site refs, so they are the FIRST entries of companyRefImages → the
      // first `siteRefsInBg` of the brand refs in bgRefImages. Drives the colour + role rules so
      // the scene is graded to the SITE and the competitor posts contribute structure only.
      const siteRefsInBg = Math.min(hasSiteIdentity ? siteRefCount : 0, brandRefCountInBg);
      const hasSiteInBg = siteRefsInBg > 0;

      // BRAND COLOUR SWATCH — appended LAST, on purpose. Every role rule above addresses images by
      // position ("the FIRST N attached images are the CLIENT'S OWN WEBSITE"), and those counts are
      // now fixed, so putting the swatch at the END leaves all of them intact. It carries the
      // payload's exact colour as pixels, which is the one thing the prompt text cannot do — the hex
      // is scrubbed from it and a colour name only approximates (#fee701 → "vivid yellow" → #dcb744
      // on the canvas). Non-fatal: if the hex is missing or malformed the swatch is simply skipped.
      let hasColourSwatch = false;
      const swatchHex = String((campaignData as any).primaryColor || "").trim();
      if (swatchHex) {
        try {
          const swatchB64 = await makeSolidColourPng(swatchHex);
          if (swatchB64) {
            bgRefImages = [...bgRefImages, { data: swatchB64, mimeType: "image/png" }];
            hasColourSwatch = true;
          }
        } catch (e) {
          console.warn(`[swatch] job=${jobId ?? "?"} could not build colour swatch: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      // (Pexels hero is already the first companyRefImages entry above, so bgRefImages and the
      // brand-post counts are built identically to a caller reference_image — no special-casing.)

      // Vision-gate heroRef: `reference_image` forces "feature THIS person" mode, but if the
      // caller's reference has NO person (a product, a phone/app screenshot, a scene, a logo),
      // that mode tries to feature a person that isn't there and pulls one from the brand posts —
      // so the caller's reference ends up with ZERO influence (exactly the "usou uma pessoa do
      // brand post" bug). Check the actual reference; when it's not a person, switch to
      // reproduce-the-reference mode with ONLY that image so its real content drives the ad.
      // Person references (the normal skincare/finance/fitness case) classify YES and are untouched.
      let refAsSubject = false;   // set when a non-person reference is featured as a subject (below)
      // Gate runs on companyRefImages[0] — the caller ref OR the Pexels hero (now the same slot), so a
      // non-person hero (product/scene) is featured-as-subject exactly the same way in both paths.
      if (heroRef && companyRefImages.length > 0) {
        let refIsPerson = true;
        try {
          const cls = await callGemini(
            "You classify an image. Answer with exactly one word: YES or NO.",
            "Does the attached image prominently feature a real human PERSON (a visible face or body) who could be the main model/subject of an ad? Hands alone, a product, a phone, an app screenshot/UI, a logo, or a scene with no clear person = NO.",
            "gemini-2.5-flash",
            0,
            5,
            apiKey,
            undefined,
            [{ mimeType: companyRefImages[0].mimeType, data: companyRefImages[0].data }],
            { jobId, costAcc },
          );
          refIsPerson = /\byes\b/i.test(String(cls.text || ""));
        } catch (_) { refIsPerson = true; /* fail open — keep person-hero behavior */ }
        if (!refIsPerson) {
          console.log(`[hero-gate] job=${jobId ?? "?"} reference has NO person → feature-as-subject mode (heroRef off, brand kept)`);
          heroRef = false;
          refAsSubject = true;      // feature the ref as the hero SUBJECT (like a product) — KEEP brand identity
          bgSource = "inspired";    // long path: keeps brand brief + brand colors + brand-post style refs
          // bgRefImages stays [ref, brand posts…]: the ref is FIRST so productMoodHint features it,
          // and the brand posts stay so the ad still looks like the brand's (NOT a bare full-bleed
          // paste of the raw reference, and NOT a person recycled from a brand post).
        }
      }

      // Diagnostic: how many brand-post vs generation refs actually reached the image model.
      const _ccrefs = Array.isArray((campaignData as any).composeCompanyRefs)
        ? ((campaignData as any).composeCompanyRefs as unknown[]).map((u) => String(u)) : [];
      console.log(`[refs] job=${jobId ?? "?"} bgSource=${bgSource} heroRef=${heroRef} productRef=${hasProductRef} composeCompanyRefs=${_ccrefs.length} companyRefImgsFetched=${companyRefImages.length} bgRefImgs=${bgRefImages.length} brandPostsInBg=${brandRefCountInBg} genRefsInBg=${genRefCountInBg} urls=[${_ccrefs.map((u) => u.split("/").slice(-2).join("/")).join(" | ")}]`);

      // When brand posts and the generation reference coexist in bgRefImages, annotate the
      // visual brief so the image model knows which role each image plays. This is what lets
      // the model use the generation image creatively (product, anchor, element) while staying
      // true to the brand's design language from the posts.
      let visualBriefForPrompt = (brandRefCountInBg > 0 && genRefCountInBg > 0)
        ? (visualBrief ? visualBrief + "\n\n" : "") +
          `IMAGE ROLES: The first ${brandRefCountInBg} image(s) are real brand Instagram posts, given ONLY to ground the (necessarily abstract) brief above in concrete examples. Use them to CONFIRM the brief: cross-check what's actually CONSISTENT between the brief's description and these ${brandRefCountInBg} example posts (and, if there is more than one, consistent between the examples themselves) — that shared pattern is the real brand aesthetic. Do NOT treat each example post as a separate source to copy from — a decorative element, layout choice, or composition trick that appears in only ONE of the examples (and isn't backed by the brief) is a one-off, not the brand's language, and must be left out. Apply only the confirmed, recurring pattern. The last image is the creative reference for this specific campaign: incorporate it as you see fit — as the hero product, a background subject, a scene anchor, or a compositional element — while staying firmly within that confirmed brand aesthetic.`
        : visualBrief;

      // PROXY MODE ROLE SPLIT: the leading refs are the client's OWN website (identity/colour), the
      // trailing refs are competitor posts (structure only). Without this the model treats the
      // competitor posts as the brand's own and copies THEIR colour/identity — the exact "saiu com
      // a identidade do concorrente" bug — and ignores the site entirely.
      if (hasSiteInBg) {
        const marketCount = Math.max(0, brandRefCountInBg - siteRefsInBg);
        visualBriefForPrompt = (visualBriefForPrompt ? visualBriefForPrompt + "\n\n" : "") +
          `IMAGE ROLES (CRITICAL — OVERRIDES ANY COLOUR/IDENTITY GUIDANCE ABOVE): the FIRST ${siteRefsInBg} attached image(s) are the CLIENT'S OWN WEBSITE — they are the SOLE source of this brand's COLOUR, mood and visual identity. Colour-grade the WHOLE background to match the client site's palette and feel.${marketCount > 0 ? ` The remaining ${marketCount} attached image(s) are MARKET/COMPETITOR references — borrow ONLY their STRUCTURE (layout, composition, negative-space, density). NEVER take colour, palette, logo, wordmark or identity from those competitor images.` : ""}`;
      }

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
        const bgByVariantRatio = new Map<string, { url: string; rec: ComposeTextRec | null; prompt?: string; refCount?: number; layout: string; overlayHtml?: string | null }>();
        const uniqueVariantRatios = [...new Map(
          imageTasks.map((task) => {
            const aspectRatio = imageAspectRatioForFormat(task.format);
            return [`${task.variantIndex}:${aspectRatio}`, { task, aspectRatio }] as const;
          })
        ).values()];

        for (const { task, aspectRatio } of uniqueVariantRatios) {
          const taskIndex = imageTasks.indexOf(task);
          // A/B VISUAL: keep the SAME layout + visual direction across ALL variants (seed by jobId
          // only, NOT taskIndex) so the variants read as variations of ONE concept — only the
          // model's natural per-render variation differs, not wildly different scenes.
          const layoutHint = userLayout ?? LAYOUT_KEYS[(Number(jobId) || 0) % LAYOUT_KEYS.length];
          const visualDirection = BACKGROUND_DIRECTIONS[(Number(jobId) || 0) % BACKGROUND_DIRECTIONS.length];
          const taskBrandSpec = specForFormat(brandSpec, task.format);

          const bgPrompt = buildBackgroundPrompt(taskBrandSpec, campaignFactsImg, task.format, aspectRatio, layoutHint, visualDirection, Boolean(userLayout), bgSource, bgRefImages.length > 0, visualBriefForPrompt, heroRef, (hasProductRef || refAsSubject), ugcNoRef, (refAsSubject ? "" : themeScene), pexelsAuto, brandRefCountInBg > 0, brandPostsAreProxy, hasSiteInBg, siteRefsInBg, hasColourSwatch, competitorRefsPresent);
          // maxAttempts:1 + outer 500-retry: a 500 from Gemini means the server rejected the
          // request in ~2s (not a slow hang), so retrying once is safe within the wall-clock
          // budget. A timeout (105s hang) is NOT retried here to avoid 105+105s > 150s.
          let gen = await generateAdImage(bgPrompt, bgRefImages, apiKey, aspectRatio, {
            maxAttempts: 1, timeoutMs: 105000, singleConfig: true, costAcc,
          }).catch(async (err) => {
            if (/returned 5\d\d.*INTERNAL|returned 500/i.test(String(err))) {
              console.warn(`[compose-ab] Gemini 500 → retry once job=${jobId ?? "?"}`);
              await new Promise((r) => setTimeout(r, 4000));
              return generateAdImage(bgPrompt, bgRefImages, apiKey, aspectRatio, { maxAttempts: 1, timeoutMs: 105000, singleConfig: true, costAcc });
            }
            throw err;
          });
          // Validate background for text/logos; retry once if detected (VALIDATE_BACKGROUND flag).
          // Also validates the retry — if both fail, uses whichever was cleaner (the retry).
          if (VALIDATE_BACKGROUND && gen?.url) {
            const hasText = await backgroundHasText(gen.url, apiKey, { jobId, costAcc });
            if (hasText) {
              console.warn(`[bg-validate] retrying background generation job=${jobId ?? "?"}`);
              // Retry with shapes-only prompt so abstract geometry can't reproduce the same text artifacts.
              const shapesPrompt = bgPrompt + "\n\nCRITICAL OVERRIDE — previous attempt had text burned into the image. THIS RETRY: use ONLY abstract geometric shapes, brand-color gradients, dots, lines, waves, light bokeh — ZERO photography, ZERO realistic objects, ZERO surfaces that could bear text. Purely abstract.";
              const retry = await generateAdImage(shapesPrompt, [], apiKey, aspectRatio, { maxAttempts: 1, timeoutMs: 105000, singleConfig: true, costAcc }).catch(() => null);
              if (retry) {
                gen = retry;
                const retryHasText = await backgroundHasText(retry.url, apiKey, { jobId, costAcc });
                if (retryHasText) console.warn(`[bg-validate] shapes retry also has text, using it anyway job=${jobId ?? "?"}`);
                else console.log(`[bg-validate] shapes retry clean job=${jobId ?? "?"}`);
              } else console.warn(`[bg-validate] retry failed, using original job=${jobId ?? "?"}`);
            }
          }
          const bgHosted = gen ? (await uploadImageToStorage(gen.url, true, (payload as any).storageKey)) ?? "" : "";
          const bgForZone = bgHosted || gen?.url || "";
          // Sequential, not parallel: detect the calm zone FIRST, then hand it to the overlay
          // generator so the Flash anchors text on the calm region instead of guessing. Costs
          // +1 Gemini round-trip of latency; buys far more accurate text placement.
          const calm = bgForZone ? await pickCalmTextZone(bgForZone, apiKey, { jobId, costAcc }) : null;
          const geminiOverlay = bgForZone
            // brandDevices (CSS overlay device) DISABLED: the overlay model can't see the brand posts,
            // so it rendered off-brand (blue) devices from a stored accent hex. The brand's real design
            // assets are now handled by the image model (which sees the posts and matches their devices +
            // colours), conditional on the brand actually using them. See the heroRef design-asset rule.
            ? await buildOverlayHtmlFromGemini(bgForZone, campaignData, task.format, cssVars, apiKey, gen?.rec ?? null, { jobId, costAcc, calmZone: calm?.zone ?? null, brandDevices: false })
            : null;
          bgByVariantRatio.set(`${task.variantIndex}:${aspectRatio}`, { url: bgHosted, rec: gen?.rec ?? null, prompt: bgPrompt, refCount: bgRefImages.length, layout: calm?.layout ?? layoutHint, overlayHtml: geminiOverlay });
        }

        const abComposeFns = imageTasks.map((task, taskIndex) => async () => {
          const { format, variantLabel } = task;
          const aspectRatio = imageAspectRatioForFormat(format);
          const taskBrandSpec = specForFormat(brandSpec, format);
          const bg = bgByVariantRatio.get(`${task.variantIndex}:${aspectRatio}`) ?? { url: "", rec: null, prompt: "", refCount: 0, layout: userLayout ?? LAYOUT_KEYS[((jobId ?? 0) + taskIndex) % LAYOUT_KEYS.length] };
          // Reuse the exact layout the variant's background reserved space for.
          const layoutHint = bg.layout;

          const bannerHtml = buildCompositionHtml(
            bg.url, campaignData, format, taskBrandSpec, cssVars, fontUrl,
            layoutHint, true, bg.rec, bg.overlayHtml, // bg.rec = model text-size hint; overlayHtml = Gemini-placed overlay
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
            ...(debug ? { debug: { mode: "compose", model: GEMINI_IMAGE_MODELS[0] || null, bgSource, layout: layoutHint, aspectRatio, prompt: bg.prompt || "", bgRefImagesSent: bg.refCount || 0, composeCompanyRefs: ((campaignData as any).composeCompanyRefs || []), refImagesForGenCount: refImagesForGen.length, refs: refDebug, storeBriefUsed: Boolean(visualBrief && !String((campaignData as any).brandVisualBrief || "").trim()), note: "Logo & copy are composited on top afterwards — not drawn by the image model." } } : {}),
          };
        });
        banners = await runWithConcurrency(abComposeFns, 1);
      } else {
        // Standard path: deduplicate backgrounds by aspect ratio (cost saving).
        // ASSORTED LAYOUTS: when the caller didn't pin a layout, each aspect ratio gets a
        // DIFFERENT layout (square / story / landscape look distinct). The chosen layout is
        // STORED per ratio so the HTML overlay reuses the exact same one the background
        // reserved space for — text and background never disagree.
        const bgByRatio = new Map<string, { url: string; rec: ComposeTextRec | null; prompt?: string; refCount?: number; layout: string; overlayHtml?: string | null; overlayDiag?: string }>();
        const uniqueRatios = [...new Set(imageTasks.map((task) => imageAspectRatioForFormat(task.format)))];
        for (const aspectRatio of uniqueRatios) {
          const task = imageTasks.find((candidate) => imageAspectRatioForFormat(candidate.format) === aspectRatio)!;
          const ratioIndex = uniqueRatios.indexOf(aspectRatio);
          const taskIndex = imageTasks.indexOf(task);
          const taskBrandSpec = specForFormat(brandSpec, task.format);
          const layoutHint = userLayout ?? LAYOUT_KEYS[((jobId ?? 0) + taskIndex + ratioIndex) % LAYOUT_KEYS.length];
          const visualDirection = BACKGROUND_DIRECTIONS[((jobId ?? 0) + taskIndex + ratioIndex * 3) % BACKGROUND_DIRECTIONS.length];
          const bgPrompt = buildBackgroundPrompt(taskBrandSpec, campaignFactsImg, task.format, aspectRatio, layoutHint, visualDirection, Boolean(userLayout), bgSource, bgRefImages.length > 0, visualBriefForPrompt, heroRef, (hasProductRef || refAsSubject), ugcNoRef, (refAsSubject ? "" : themeScene), pexelsAuto, brandRefCountInBg > 0, brandPostsAreProxy, hasSiteInBg, siteRefsInBg, hasColourSwatch, competitorRefsPresent);
          // maxAttempts:1 + outer 500-retry: a 500 from Gemini means the server rejected the
          // request in ~2s (not a slow hang), so retrying once is safe within the wall-clock
          // budget. A timeout (105s hang) is NOT retried here to avoid 105+105s > 150s.
          let gen = await generateAdImage(bgPrompt, bgRefImages, apiKey, aspectRatio, {
            maxAttempts: 1, timeoutMs: 105000, singleConfig: true, costAcc,
          }).catch(async (err) => {
            if (/returned 5\d\d.*INTERNAL|returned 500/i.test(String(err))) {
              console.warn(`[compose] Gemini 500 → retry once job=${jobId ?? "?"}`);
              await new Promise((r) => setTimeout(r, 4000));
              return generateAdImage(bgPrompt, bgRefImages, apiKey, aspectRatio, { maxAttempts: 1, timeoutMs: 105000, singleConfig: true, costAcc });
            }
            throw err;
          });
          // Validate background for text/logos; retry once if detected (VALIDATE_BACKGROUND flag).
          // Also validates the retry — if both fail, uses whichever was cleaner (the retry).
          if (VALIDATE_BACKGROUND && gen?.url) {
            const hasText = await backgroundHasText(gen.url, apiKey, { jobId, costAcc });
            if (hasText) {
              console.warn(`[bg-validate] retrying background generation job=${jobId ?? "?"}`);
              const retry = await generateAdImage(bgPrompt + NO_TEXT_RETRY_REMINDER, bgRefImages, apiKey, aspectRatio, { maxAttempts: 1, timeoutMs: 105000, singleConfig: true, costAcc }).catch(() => null);
              if (retry) {
                gen = retry;
                const retryHasText = await backgroundHasText(retry.url, apiKey, { jobId, costAcc });
                if (retryHasText && !heroRef) {
                  // Both photographic attempts leaked text AND there is no hero subject to protect.
                  // Last resort: an ABSTRACT shapes background (no photography/objects/screens)
                  // essentially cannot contain legible text — forced text-free. One extra gen.
                  console.warn(`[bg-validate] retry also has text → shapes fallback job=${jobId ?? "?"}`);
                  const shapesPrompt = buildBackgroundPrompt(taskBrandSpec, campaignFactsImg, task.format, aspectRatio, layoutHint, visualDirection, Boolean(userLayout), "shapes", false, visualBriefForPrompt);
                  const shapes = await generateAdImage(shapesPrompt, [], apiKey, aspectRatio, { maxAttempts: 1, timeoutMs: 105000, singleConfig: true, costAcc }).catch(() => null);
                  if (shapes) { gen = shapes; console.log(`[bg-validate] shapes fallback ok job=${jobId ?? "?"}`); }
                  else console.warn(`[bg-validate] shapes fallback failed, keeping texty bg job=${jobId ?? "?"}`);
                } else if (retryHasText) {
                  // Hero mode: shapes would erase the hero subject. Try ONE more attempt with a
                  // stricter reminder targeting the devices/screens/signage that keep leaking text.
                  // Final attempt: DROP the brand-post images (the usual source of TRACED captions/
                  // slogans) and keep ONLY the hero. This removes the text source while preserving the
                  // person — so a caller ref can still come out clean WITH the subject.
                  console.warn(`[bg-validate] retry still has text, heroRef → final attempt (hero-only refs) job=${jobId ?? "?"}`);
                  const finalRetry = await generateAdImage(bgPrompt + HERO_NO_TEXT_RETRY_REMINDER, bgRefImages.slice(0, 1), apiKey, aspectRatio, { maxAttempts: 1, timeoutMs: 105000, singleConfig: true, costAcc }).catch(() => null);
                  if (finalRetry) {
                    const finalHasText = await backgroundHasText(finalRetry.url, apiKey, { jobId, costAcc });
                    gen = finalRetry;
                    if (finalHasText) {
                      if (pexelsAuto) {
                        // The hero is an auto-fetched STOCK person (expendable — NOT the caller's own
                        // asset), and all 3 photographic attempts leaked text. Fall back to an ABSTRACT
                        // shapes background, which essentially cannot contain legible text → guarantees a
                        // TEXT-FREE ad on the common no-ref production path. One extra gen.
                        console.warn(`[bg-validate] pexels hero still texty after 3 → shapes fallback job=${jobId ?? "?"}`);
                        const shapesPrompt = buildBackgroundPrompt(taskBrandSpec, campaignFactsImg, task.format, aspectRatio, layoutHint, visualDirection, Boolean(userLayout), "shapes", false, visualBriefForPrompt);
                        const shapes = await generateAdImage(shapesPrompt, [], apiKey, aspectRatio, { maxAttempts: 1, timeoutMs: 105000, singleConfig: true, costAcc }).catch(() => null);
                        if (shapes) { gen = shapes; console.log(`[bg-validate] pexels→shapes fallback ok job=${jobId ?? "?"}`); }
                        else console.warn(`[bg-validate] pexels→shapes fallback failed, keeping texty bg job=${jobId ?? "?"}`);
                      } else console.warn(`[bg-validate] hero final-retry still has text (caller ref) → using best-of-3 anyway job=${jobId ?? "?"}`);
                    } else console.log(`[bg-validate] hero final-retry clean job=${jobId ?? "?"}`);
                  } else console.warn(`[bg-validate] hero final-retry failed, keeping previous retry job=${jobId ?? "?"}`);
                } else console.log(`[bg-validate] retry clean job=${jobId ?? "?"}`);
              } else console.warn(`[bg-validate] retry failed, using original job=${jobId ?? "?"}`);
            }
          }
          const bgHosted = gen ? (await uploadImageToStorage(gen.url, true, (payload as any).storageKey)) ?? "" : "";
          const bgForZone = bgHosted || gen?.url || "";
          // Sequential, not parallel: detect the calm zone FIRST, then feed it to the overlay
          // generator so the Flash anchors text on the calm region instead of guessing. Costs
          // +1 Gemini round-trip of latency; buys far more accurate text placement.
          // overlayHtml from Gemini is authoritative when available; TypeScript template is the fallback.
          const calm = bgForZone ? await pickCalmTextZone(bgForZone, apiKey, { jobId, costAcc }) : null;
          const overlayDiag: { reason?: string } = {};
          const geminiOverlay = bgForZone
            // brandDevices (CSS overlay device) DISABLED — see note at the other call site. Design
            // assets now come from the image model, matched to the brand posts, conditional on usage.
            ? await buildOverlayHtmlFromGemini(bgForZone, campaignData, task.format, cssVars, apiKey, gen?.rec ?? null, { jobId, costAcc, calmZone: calm?.zone ?? null, diag: overlayDiag, brandDevices: false })
            : null;
          bgByRatio.set(aspectRatio, { url: bgHosted, rec: gen?.rec ?? null, prompt: bgPrompt, refCount: bgRefImages.length, layout: calm?.layout ?? layoutHint, overlayHtml: geminiOverlay, overlayDiag: overlayDiag.reason });
        }

        const composeFns = imageTasks.map((task, taskIndex) => async () => {
          const { format, variantLabel } = task;
          const aspectRatio = imageAspectRatioForFormat(format);
          const bg = bgByRatio.get(aspectRatio) ?? { url: "", rec: null, prompt: "", refCount: 0, layout: userLayout ?? LAYOUT_KEYS[((jobId ?? 0) + taskIndex) % LAYOUT_KEYS.length] };
          // Use the EXACT layout the background reserved space for (forced), so the text
          // block lands on the calm zone the image model left for it.
          const layoutHint = bg.layout;
          const taskBrandSpec = specForFormat(brandSpec, format);

          const bannerHtml = buildCompositionHtml(
            bg.url, campaignData, format, taskBrandSpec, cssVars, fontUrl, layoutHint, true, bg.rec, bg.overlayHtml,
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
            ...(debug ? { debug: { mode: "compose", model: GEMINI_IMAGE_MODELS[0] || null, bgSource, layout: layoutHint, overlayFromGemini: Boolean(bg.overlayHtml), overlayDiag: bg.overlayDiag ?? null, aspectRatio, prompt: bg.prompt || "", bgRefImagesSent: bg.refCount || 0, composeCompanyRefs: ((campaignData as any).composeCompanyRefs || []), refImagesForGenCount: refImagesForGen.length, refs: refDebug, storeBriefUsed: Boolean(visualBrief && !String((campaignData as any).brandVisualBrief || "").trim()), note: "Logo & copy are composited on top afterwards — not drawn by the image model." } } : {}),
          };
        });
        banners = await runWithConcurrency(composeFns, 4);
      }
      console.log(`[cost-total]${jobId ? ` job=${jobId}` : ""} mode=compose batch=${(payload as any).batchIndex ?? "?"} images=${costAcc.images} banners=${Array.isArray(banners) ? banners.length : 0} bg_validate=${VALIDATE_BACKGROUND ? "on" : "off"} ~= $${costAcc.usd.toFixed(5)} USD`);
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
        { jobId },
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
          { jobId },
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
        { modelChain: PLAN_MODEL_CHAIN, responseMimeType: "application/json", responseSchema: CREATIVE_PLAN_JSON_SCHEMA, jobId },
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
        { modelChain: RENDER_MODEL_CHAIN, jobId },
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
