import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AUX_TEXT_MODELS = (Deno.env.get("GEMINI_AUX_MODELS") || "gemini-2.5-flash-lite,gemini-2.5-flash")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const FETCH_TIMEOUT_MS = 12000;
const AI_TIMEOUT_MS = 25000;

// PHP proxy — set SCRAPER_PHP_PROXY_URL to e.g. "https://yoursite.com/api/fetchHtml.php"
// and SCRAPER_PROXY_TOKEN to match the token in fetchHtml.php.
// Leave unset to skip the proxy and fall back to direct fetch.
const PHP_PROXY_URL = Deno.env.get("SCRAPER_PHP_PROXY_URL") || "";
const PHP_PROXY_TOKEN = Deno.env.get("SCRAPER_PROXY_TOKEN") || "";
const CACHE_TTL_MS = 5 * 60 * 1000;
const scrapeCache = new Map<string, { expiresAt: number; extracted: Record<string, unknown> }>();

function normalizeAccountType(value: unknown) {
  return value === "admin" ? "admin" : "testing";
}

function getGeminiApiKeyForAccountType(accountType: unknown) {
  const productionKey = Deno.env.get("GEMINI_API_KEY_PRODUCTION") || Deno.env.get("GEMINI_API_KEY");
  const testingKey = Deno.env.get("GEMINI_API_KEY_TESTING");

  if (normalizeAccountType(accountType) === "admin") {
    if (!productionKey) throw new Error("GEMINI_API_KEY_PRODUCTION is not configured");
    return productionKey;
  }

  if (!testingKey) throw new Error("GEMINI_API_KEY_TESTING is not configured");
  return testingKey;
}

function buildAiUrl(model: string) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

function extractModelText(payload: any) {
  return payload?.candidates?.[0]?.content?.parts
    ?.filter((part: any) => part?.text && !part?.thought)
    .map((part: any) => part.text)
    .join("\n")
    .trim() || null;
}

async function requestAiPayload(body: string, apiKey: string) {
  let sawRateLimit = false;
  let lastUnavailableError: string | null = null;
  const maxRetriesPerModel = 2;
  const maxRounds = 2;

  for (let round = 0; round < maxRounds; round++) {
    let sawRateLimitThisRound = false;

    for (const model of AUX_TEXT_MODELS) {
      for (let attempt = 0; attempt < maxRetriesPerModel; attempt++) {
        console.log(`Scraper AI request model=${model} round=${round + 1}/${maxRounds} attempt=${attempt + 1}/${maxRetriesPerModel}`);
        const response = await fetchWithTimeout(`${buildAiUrl(model)}?key=${apiKey}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body,
        }, AI_TIMEOUT_MS);

        if (response.ok) {
          return await response.json();
        }

        if (response.status === 429) {
          sawRateLimit = true;
          sawRateLimitThisRound = true;
          const text = await response.text();
          console.warn(`AI model ${model} rate limited (round ${round + 1}, attempt ${attempt + 1}):`, text);
          await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
          break; // try next model
        }

        if (response.status === 402) {
          throw new Error("AI usage limit reached. Please add credits.");
        }

        if ([404, 502, 503, 504].includes(response.status)) {
          const text = await response.text();
          lastUnavailableError = `AI model ${model} unavailable (${response.status})`;
          console.warn(`AI model ${model} unavailable (round ${round + 1}, attempt ${attempt + 1}):`, response.status, text.slice(0, 200));

          if (attempt < maxRetriesPerModel - 1) {
            const delay = 800 * (attempt + 1);
            console.warn(`Retrying ${model} in ${delay}ms...`);
            await new Promise((resolve) => setTimeout(resolve, delay));
            continue;
          }
          // exhausted retries for this model — try next
          break;
        }

        const text = await response.text();
        console.error(`AI gateway error from ${model}:`, response.status, text);
        throw new Error(`AI gateway error from ${model}: ${response.status}`);
      }
    }

    if (sawRateLimitThisRound && round < maxRounds - 1) {
      const roundDelay = 1000;
      console.warn(`All configured scrape models were rate limited in round ${round + 1}/${maxRounds}. Waiting ${roundDelay}ms before another full retry cycle.`);
      await new Promise((resolve) => setTimeout(resolve, roundDelay));
    }
  }

  if (sawRateLimit) {
    throw new Error("Rate limit exceeded. Please try again in a moment.");
  }

  if (lastUnavailableError) {
    throw new Error(lastUnavailableError);
  }

  throw new Error("AI gateway failed for all configured models.");
}

async function fetchWithTimeout(input: string | URL, init: RequestInit = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function tryFetchHtml(formattedUrl: string, init: RequestInit) {
  try {
    const response = await fetchWithTimeout(formattedUrl, {
      ...init,
      redirect: "follow",
    });

    const text = await response.text();
    return { ok: response.ok, status: response.status, text };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      text: error instanceof Error ? error.message : "Unknown fetch error",
    };
  }
}

function looksLikeHtmlDocument(content: string) {
  return /<html[\s>]|<!doctype html|<body[\s>]|<head[\s>]/i.test(content);
}

async function fetchViaPhpProxy(targetUrl: string): Promise<string> {
  if (!PHP_PROXY_URL || !PHP_PROXY_TOKEN) {
    throw new Error("PHP proxy not configured");
  }
  const proxyEndpoint = `${PHP_PROXY_URL}?url=${encodeURIComponent(targetUrl)}&token=${encodeURIComponent(PHP_PROXY_TOKEN)}`;
  const response = await fetchWithTimeout(proxyEndpoint, {
    headers: { "Accept": "application/json" },
  }, 25000); // longer timeout — proxy does the heavy lifting

  const json = await response.json() as { html?: string; error?: string; status?: number; finalUrl?: string };
  if (json.error) throw new Error(`PHP proxy error: ${json.error}`);
  if (!json.html || !json.html.trim()) throw new Error("PHP proxy returned empty HTML");
  return json.html;
}

async function fetchWebsiteHtml(formattedUrl: string) {
  // 1. PHP proxy — uses the client's server IP, bypasses most anti-bot restrictions
  if (PHP_PROXY_URL && PHP_PROXY_TOKEN) {
    try {
      const html = await fetchViaPhpProxy(formattedUrl);
      if (html.trim() && looksLikeHtmlDocument(html)) {
        console.log(`Fetched via PHP proxy: ${html.length} chars`);
        return html;
      }
      console.warn("PHP proxy returned non-HTML content, falling back to direct fetch");
    } catch (e) {
      console.warn("PHP proxy failed:", e instanceof Error ? e.message : e);
      // fall through to direct fetch
    }
  }

  // 2. Direct fetch from edge function (works for many sites)
  const browserLikeHeaders = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
    "Referer": new URL(formattedUrl).origin,
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
    "Cache-Control": "max-age=0",
  };

  const fetchAttempts = [
    { name: "browser-like", init: { headers: browserLikeHeaders } },
    { name: "simple", init: { headers: { "User-Agent": browserLikeHeaders["User-Agent"], "Accept": "text/html,*/*;q=0.8" } } },
  ];

  let lastFailure = "Unknown error";

  for (const attempt of fetchAttempts) {
    const result = await tryFetchHtml(formattedUrl, attempt.init);
    if (result.ok && result.text.trim()) {
      return result.text;
    }

    lastFailure = `${attempt.name}:${result.status || "fetch-error"}`;
    console.warn(`Website fetch attempt failed`, { url: formattedUrl, attempt: attempt.name, status: result.status, preview: result.text.slice(0, 200) });

    if (result.status === 403 || result.status === 406 || result.status === 429 || result.status >= 500 || result.status === 0) {
      continue;
    }
  }

  throw new Error(`Failed to fetch website content. Last attempt: ${lastFailure}`);
}

async function tryFetchLinkedCss(html: string, baseUrl: string): Promise<string> {
  // Collect <link rel="stylesheet"> hrefs
  const linkPattern = /<link[^>]+>/gi;
  const linkedHrefs: string[] = [];
  let linkMatch: RegExpExecArray | null;
  while ((linkMatch = linkPattern.exec(html)) !== null) {
    const tag = linkMatch[0];
    if (!/rel=["']stylesheet["']/i.test(tag)) continue;
    const hrefM = tag.match(/href=["']([^"']+)["']/i);
    if (!hrefM) continue;
    linkedHrefs.push(hrefM[1]);
  }

  // Also pick up <style> @import urls
  const importMatches = html.match(/@import\s+url\(["']?([^"')]+)["']?\)/gi) || [];
  for (const m of importMatches) {
    const u = m.match(/url\(["']?([^"')]+)["']?\)/i);
    if (u) linkedHrefs.push(u[1]);
  }

  const base = new URL(baseUrl);
  const collected: string[] = [];

  for (const rawHref of linkedHrefs.slice(0, 6)) {
    // Skip external CDNs (fonts, icon libraries, etc.)
    if (/fonts\.googleapis|fonts\.gstatic|cdn\.|cloudflare|jsdelivr|unpkg|bootstrap\.min|font-awesome|animate\.css/i.test(rawHref)) continue;

    let cssUrl: string;
    try {
      if (rawHref.startsWith("//")) cssUrl = `${base.protocol}${rawHref}`;
      else if (rawHref.startsWith("http")) cssUrl = rawHref;
      else cssUrl = new URL(rawHref, baseUrl).href;
    } catch { continue; }

    try {
      // Try PHP proxy first for same-origin CSS (same anti-bot benefit)
      let css = "";
      if (PHP_PROXY_URL && PHP_PROXY_TOKEN) {
        try {
          css = await fetchViaPhpProxy(cssUrl);
        } catch { /* fall through to direct */ }
      }
      if (!css) {
        const resp = await fetchWithTimeout(cssUrl, { headers: { "Accept": "text/css,*/*;q=0.8" } }, 7000);
        if (!resp.ok) continue;
        css = await resp.text();
      }
      if (css.length < 50) continue;
      collected.push(css.slice(0, 40000));
      if (collected.join("").length > 80000) break; // cap at ~80 KB total
    } catch { continue; }
  }

  return collected.join("\n");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { url, accountType, debug, context } = await req.json();
    const debugMode = Boolean(debug);
    if (!url) throw new Error("URL is required");

    const GEMINI_API_KEY = getGeminiApiKeyForAccountType(accountType);

    let formattedUrl = url.trim();
    if (!formattedUrl.startsWith("http://") && !formattedUrl.startsWith("https://")) {
      formattedUrl = `https://${formattedUrl}`;
    }

    const cacheKey = `${normalizeAccountType(accountType)}::${formattedUrl.toLowerCase()}`;
    const now = Date.now();
    const cached = scrapeCache.get(cacheKey);
    if (!debugMode && cached && cached.expiresAt > now) {
      return new Response(JSON.stringify({ extracted: cached.extracted, cached: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("Fetching website:", formattedUrl);

    const html = await fetchWebsiteHtml(formattedUrl);
    if (!looksLikeHtmlDocument(html)) {
      throw new Error("Fetched content is not recognizable HTML");
    }

    // Pre-extract fonts from HTML for better accuracy
    const googleFontsMatches = html.match(/fonts\.googleapis\.com\/css2?\?[^"'\s)]+/g) || [];
    const fontFamiliesFromGoogle = googleFontsMatches
      .flatMap((url: string) => {
        const families = url.match(/family=([^&"']+)/g) || [];
        return families.map((f: string) => decodeURIComponent(f.replace('family=', '').split(':')[0].replace(/\+/g, ' ')));
      })
      .filter(Boolean);

    const fontFaceMatches = html.match(/@font-face\s*\{[^}]*font-family:\s*['"]?([^'";}\n]+)['"]?/gi) || [];
    const fontFamiliesFromFontFace = fontFaceMatches.map((m: string) => {
      const match = m.match(/font-family:\s*['"]?([^'";}\n]+)['"]?/i);
      return match ? match[1].trim() : '';
    }).filter(Boolean);

    const cssVarFonts = html.match(/--[a-z-]*font[a-z-]*:\s*['"]?([^'";}\n]+)['"]?/gi) || [];
    const fontFamiliesFromVars = cssVarFonts.map((m: string) => {
      const match = m.match(/:\s*['"]?([^'";}\n]+)['"]?/);
      return match ? match[1].trim().split(',')[0].trim().replace(/['"]/g, '') : '';
    }).filter(Boolean);

    const allDetectedFonts: string[] = []; // populated below after linked CSS is fetched

    // ── Pre-extract colors from HTML + linked CSS ─────────────────────────────

    // Fetch linked CSS files (where modern sites store CSS variables)
    let linkedCssText = "";
    try {
      linkedCssText = await tryFetchLinkedCss(html, formattedUrl);
      if (linkedCssText) console.log(`Fetched linked CSS: ${linkedCssText.length} chars`);
    } catch (e) {
      console.warn("Could not fetch linked CSS:", e instanceof Error ? e.message : e);
    }

    // If no meaningful external CSS was found (Tailwind inline, single-file sites, etc.),
    // use a larger HTML slice so the AI sees more class attributes with color/font info.
    const hasMeaningfulLinkedCss = linkedCssText.length > 5000;
    const htmlLimit = hasMeaningfulLinkedCss ? 160000 : 300000;
    const truncatedHtml = html.length > htmlLimit ? html.substring(0, htmlLimit) : html;

    // Augment font detection with linked CSS
    if (linkedCssText) {
      const linkedFontFaceMatches = linkedCssText.match(/@font-face\s*\{[^}]*font-family:\s*['"]?([^'";}\n]+)['"]?/gi) || [];
      for (const m of linkedFontFaceMatches) {
        const match = m.match(/font-family:\s*['"]?([^'";}\n]+)['"]?/i);
        if (match) fontFamiliesFromFontFace.push(match[1].trim());
      }
      const linkedCssVarFonts = linkedCssText.match(/--[a-z-]*font[a-z-]*:\s*['"]?([^'";}\n]+)['"]?/gi) || [];
      for (const m of linkedCssVarFonts) {
        const match = m.match(/:\s*['"]?([^'";}\n]+)['"]?/);
        if (match) fontFamiliesFromVars.push(match[1].trim().split(',')[0].trim().replace(/['"]/g, ''));
      }
    }
    allDetectedFonts.push(...new Set([...fontFamiliesFromGoogle, ...fontFamiliesFromFontFace, ...fontFamiliesFromVars]));
    const fontHint = allDetectedFonts.length > 0
      ? `\n\nPRE-DETECTED FONTS: ${allDetectedFonts.join(', ')}\nUse as headingFont/bodyFont.`
      : '';

    // ═══════════════════════════════════════════════════════════════════════════
    // DETERMINISTIC COLOR EXTRACTION — covers every common pattern
    // Colors extracted here OVERRIDE anything the AI guesses.
    // ═══════════════════════════════════════════════════════════════════════════
    const styleBlocks = html.match(/<style[^>]*>([\s\S]*?)<\/style>/gi) || [];
    const inlineCss = styleBlocks.map((b: string) => b.replace(/<\/?style[^>]*>/gi, '')).join('\n');
    const allCss = inlineCss + "\n" + linkedCssText;

    /** normalize any supported color format -> "#rrggbb" or null */
    function normalizeColor(raw: string): string | null {
      const v = raw.trim().toLowerCase();
      // 8-digit hex (with alpha) → drop alpha
      if (/^#[0-9a-f]{8}$/.test(v)) return '#' + v.slice(1, 7);
      if (/^#[0-9a-f]{6}$/.test(v)) return v;
      // 4-digit hex (with alpha shorthand)
      if (/^#[0-9a-f]{4}$/.test(v)) return '#' + v[1]+v[1]+v[2]+v[2]+v[3]+v[3];
      // 3-digit shorthand
      if (/^#[0-9a-f]{3}$/.test(v)) return '#' + v[1]+v[1]+v[2]+v[2]+v[3]+v[3];
      // rgb(r,g,b) and rgb(r g b) space-separated, also rgb(r%,g%,b%)
      const rgb = v.match(/^rgba?\(\s*([\d.]+%?)\s*[, ]\s*([\d.]+%?)\s*[, ]\s*([\d.]+%?)\s*(?:[,\/]\s*[\d.]+%?)?\s*\)$/);
      if (rgb) {
        const toInt = (s: string) => s.endsWith('%') ? Math.round(parseFloat(s)/100*255) : Math.round(parseFloat(s));
        return '#' + [rgb[1],rgb[2],rgb[3]].map(n=>Math.max(0,Math.min(255,toInt(n))).toString(16).padStart(2,'0')).join('');
      }
      // oklch(l c h) — approximate: extract lightness+chroma to estimate a mid-tone hue approximation
      // We do a rough conversion: treat as hsl-like via hue angle for a visual match
      const oklch = v.match(/^oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)\s*(?:\/[\d.]+%?)?\s*\)$/);
      if (oklch) {
        // Convert oklch to approximate rgb via hsl heuristic (good enough for brand color extraction)
        const L = oklch[1].includes('%') ? parseFloat(oklch[1])/100 : parseFloat(oklch[1]);
        const C = parseFloat(oklch[2]);
        const H = parseFloat(oklch[3]);
        // Very rough: map oklch to hsl-ish for display purposes
        const h = H/360, s = Math.min(1, C * 4), l = Math.max(0.05, Math.min(0.95, L));
        const q = l<0.5?l*(1+s):l+s-l*s, p=2*l-q;
        const t2c=(t:number)=>{if(t<0)t+=1;if(t>1)t-=1;if(t<1/6)return p+(q-p)*6*t;if(t<1/2)return q;if(t<2/3)return p+(q-p)*(2/3-t)*6;return p;};
        return '#'+[h+1/3,h,h-1/3].map(t=>Math.round(t2c(t)*255).toString(16).padStart(2,'0')).join('');
      }
      // lch(l c h)
      const lch = v.match(/^lch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)\s*(?:\/[\d.]+%?)?\s*\)$/);
      if (lch) {
        const L = lch[1].includes('%') ? parseFloat(lch[1])/100 : parseFloat(lch[1])/100;
        const C = parseFloat(lch[2]);
        const H = parseFloat(lch[3]);
        const h = H/360, s = Math.min(1, C/50), l2 = Math.max(0.05, Math.min(0.95, L));
        const q = l2<0.5?l2*(1+s):l2+s-l2*s, p=2*l2-q;
        const t2c=(t:number)=>{if(t<0)t+=1;if(t>1)t-=1;if(t<1/6)return p+(q-p)*6*t;if(t<1/2)return q;if(t<2/3)return p+(q-p)*(2/3-t)*6;return p;};
        return '#'+[h+1/3,h,h-1/3].map(t=>Math.round(t2c(t)*255).toString(16).padStart(2,'0')).join('');
      }
      // color(srgb r g b) — modern
      const colorFn = v.match(/^color\(\s*(?:srgb|display-p3|a98-rgb)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/[\d.]+)?\s*\)$/);
      if (colorFn) return '#' + [colorFn[1],colorFn[2],colorFn[3]].map(n=>Math.round(Math.min(1,parseFloat(n))*255).toString(16).padStart(2,'0')).join('');
      // hsl(h,s%,l%) and hsl(h s% l%) and hsla variants — comma or space separated
      const hsl = v.match(/^hsla?\(\s*([\d.]+(?:deg|rad|turn)?)\s*[, ]\s*([\d.]+)%?\s*[, ]\s*([\d.]+)%?\s*(?:[,\/]\s*[\d.]+%?)?\s*\)$/);
      if (hsl) {
        let hDeg = parseFloat(hsl[1]);
        if (hsl[1].endsWith('rad')) hDeg = hDeg * 180 / Math.PI;
        else if (hsl[1].endsWith('turn')) hDeg = hDeg * 360;
        const h=hDeg/360, s=parseFloat(hsl[2])/100, l=parseFloat(hsl[3])/100;
        const q=l<0.5?l*(1+s):l+s-l*s, p=2*l-q;
        const t2c=(t:number)=>{if(t<0)t+=1;if(t>1)t-=1;if(t<1/6)return p+(q-p)*6*t;if(t<1/2)return q;if(t<2/3)return p+(q-p)*(2/3-t)*6;return p;};
        return '#'+[h+1/3,h,h-1/3].map(t=>Math.round(t2c(t)*255).toString(16).padStart(2,'0')).join('');
      }
      return null;
    }

    /** is this color a neutral (white, black, near-gray)? if so, it's not a brand color */
    function isNeutral(hex: string): boolean {
      if (!/^#[0-9a-f]{6}$/.test(hex)) return true;
      const r=parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16);
      if (r>240&&g>240&&b>240) return true; // near-white
      if (r<15&&g<15&&b<15) return true; // near-black
      const max=Math.max(r,g,b), min=Math.min(r,g,b);
      const saturation=(max-min)/(max||1);
      return saturation < 0.12; // near-gray (low saturation)
    }

    // ── 1. meta[name="theme-color"] — mobile chrome bar, strong brand signal ──
    const themeColorMeta = html.match(/<meta[^>]+name=["']theme-color["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']theme-color["']/i);
    const themeColor = themeColorMeta ? normalizeColor(themeColorMeta[1]) : null;

    // ── 2. Pre-scan ALL CSS variables into cssVarRawValues for full chain resolution ──
    // This first pass captures every --name: value pair regardless of naming so resolveColorToken
    // can follow any chain (e.g. --primary: var(--blue-500); --blue-500: #3b82f6)
    const cssVarRawValues: Record<string,string> = {};
    const allCssVarPattern = /--([a-zA-Z0-9_-]+):\s*([^;}\n]+)/g;
    let allCssVarMatch: RegExpExecArray | null;
    while ((allCssVarMatch = allCssVarPattern.exec(allCss)) !== null) {
      const varName = allCssVarMatch[1].toLowerCase();
      const rawValue = allCssVarMatch[2].replace(/!\ ?important/gi, '').trim();
      if (rawValue && rawValue.length < 200) {
        if (!cssVarRawValues[varName]) cssVarRawValues[varName] = rawValue;
      }
    }

    // ── 2b. Color-named CSS variables (semantic pass — builds the prioritized cssVarColors map) ──
    const cssVarColorPattern = /--([a-zA-Z0-9_-]*(?:color|colour|primary|secondary|accent|brand|main|cor|tema|base|highlight|cta|link|btn|button|header|nav|hero|bg|background)[a-zA-Z0-9_-]*):\s*([^;}\n]+)/gi;
    const cssVarColors: Record<string,string> = {};
    let cvMatch: RegExpExecArray | null;
    while ((cvMatch = cssVarColorPattern.exec(allCss)) !== null) {
      const varName = cvMatch[1].toLowerCase();
      const rawValue = cvMatch[2].replace(/!important/gi, '').trim();
      cssVarRawValues[varName] = rawValue;
      const normalized = normalizeColor(rawValue);
      if (normalized && !isNeutral(normalized)) cssVarColors[varName] = normalized;
    }

    // Also resolve any raw CSS variable that directly holds a color value (catches --blue-500: #3b82f6 etc.)
    for (const [varName, rawValue] of Object.entries(cssVarRawValues)) {
      if (cssVarColors[varName]) continue; // already captured
      const resolved = (() => { try { return resolveColorTokenEarly(rawValue); } catch { return null; } })();
      if (resolved && !isNeutral(resolved)) cssVarColors[varName] = resolved;
    }
    // Early resolver without visited tracking (used only in the above pass to avoid forward reference)
    function resolveColorTokenEarly(raw: string, depth = 0): string | null {
      if (depth > 5) return null;
      const cleaned = String(raw || '').replace(/!\ ?important/gi, '').trim();
      if (!cleaned) return null;
      const direct = normalizeColor(cleaned);
      if (direct) return direct;
      const varMatch = cleaned.match(/var\(\s*--([a-zA-Z0-9_-]+)(?:\s*,\s*([^)]+))?\s*\)/i);
      if (varMatch) {
        const nested = cssVarRawValues[varMatch[1].toLowerCase()];
        if (nested) { const r = resolveColorTokenEarly(nested, depth + 1); if (r) return r; }
        const fb = (varMatch[2] || '').trim();
        if (fb) return resolveColorTokenEarly(fb, depth + 1);
      }
      const firstHex = cleaned.match(/#[0-9a-f]{3,8}\b/i)?.[0];
      return firstHex ? normalizeColor(firstHex) : null;
    }

    // Also check WordPress preset colors: --wp--preset--color--*
    const wpColorPattern = /--wp--preset--color--([a-z0-9-]+):\s*([^;}\n]+)/gi;
    let wpMatch: RegExpExecArray | null;
    while ((wpMatch = wpColorPattern.exec(allCss)) !== null) {
      const varName = `wp-${wpMatch[1]}`;
      const rawValue = wpMatch[2].replace(/!important/gi, '').trim();
      cssVarRawValues[varName] = rawValue;
      const normalized = normalizeColor(rawValue);
      if (normalized && !isNeutral(normalized)) cssVarColors[varName] = normalized;
    }

    const resolveColorToken = (raw: string, visited = new Set<string>()): string | null => {
      const cleaned = String(raw || '').replace(/!important/gi, '').trim();
      if (!cleaned) return null;

      const directFull = normalizeColor(cleaned);
      if (directFull) return directFull;

      const varMatch = cleaned.match(/var\(\s*--([a-zA-Z0-9_-]+)(?:\s*,\s*([^\)]+))?\s*\)/i);
      if (varMatch) {
        const varName = varMatch[1].toLowerCase();
        if (visited.has(varName)) {
          const loopFallback = (varMatch[2] || '').trim();
          return loopFallback ? resolveColorToken(loopFallback, visited) : null;
        }

        visited.add(varName);

        const rawVarValue = cssVarRawValues[varName];
        if (rawVarValue) {
          const resolvedFromRaw = resolveColorToken(rawVarValue, visited);
          if (resolvedFromRaw) return resolvedFromRaw;
        }

        if (cssVarColors[varName]) return cssVarColors[varName];

        const fallback = (varMatch[2] || '').trim();
        if (fallback) {
          const fallbackHex = resolveColorToken(fallback, visited);
          if (fallbackHex) return fallbackHex;
        }
      }

      const direct = normalizeColor(cleaned.split(/\s+/)[0]);
      if (direct) return direct;

      const firstHex = cleaned.match(/#[0-9a-f]{3,8}\b/i)?.[0];
      return firstHex ? normalizeColor(firstHex) : null;
    };

    const pickVarColor = (patterns: RegExp[]): string => {
      for (const [name, value] of Object.entries(cssVarColors)) {
        if (patterns.some((p) => p.test(name))) return value;
      }
      for (const [name, rawValue] of Object.entries(cssVarRawValues)) {
        if (patterns.some((p) => p.test(name))) {
          const resolved = resolveColorToken(rawValue);
          if (resolved) return resolved;
        }
      }
      return '';
    };

    // ── 3. Semantic element colors (nav bg, header bg, links, headings) ──
    const semanticColorMap: Record<string,string> = {};
    const semanticPatterns: [RegExp, string][] = [
      [/(?:nav|\.navbar|\.nav|header|\.header)\s*(?:[,{]|[^{]+\{)[^}]*background(?:-color)?:\s*([^;}\n]+)/gi, 'nav-background'],
      [/(?:a(?:\s*:link)?|\.nav-link|\.menu-item)\s*(?:[,{]|[^{]+\{)[^}]*color:\s*([^;}\n]+)/gi, 'link-color'],
      [/(?:h1|h2|\.h1|\.h2|\.heading)\s*(?:[,{]|[^{]+\{)[^}]*color:\s*([^;}\n]+)/gi, 'heading-color'],
      [/(?:\.btn-primary|\.wp-block-button__link|\.elementor-button|input\[type=submit\]|button(?:\[type])?|\.btn)\s*(?:[,{]|[^{]+\{)[^}]*background(?:-color)?:\s*([^;}\n]+)/gi, 'button-bg'],
      [/(?:\.btn-primary|\.wp-block-button__link)\s*(?:[,{]|[^{]+\{)[^}]*background(?:-color)?:\s*([^;}\n]+)/gi, 'primary-button-bg'],
    ];
    for (const [pattern, key] of semanticPatterns) {
      pattern.lastIndex = 0;
      const m = pattern.exec(allCss);
      if (m) {
        const normalized = resolveColorToken(m[1]);
        if (normalized && !isNeutral(normalized)) semanticColorMap[key] = normalized;
      }
    }

    // ── 4. All hex colors in CSS — frequency ranking (with expanded 3-digit) ──
    const allHexInCss = allCss.match(/#[0-9a-f]{3,8}\b/gi) || [];
    const hexFrequency: Record<string,number> = {};
    for (const hex of allHexInCss) {
      const norm = normalizeColor(hex);
      if (!norm) continue;
      const full = norm.toLowerCase();
      if (isNeutral(full)) continue;
      hexFrequency[full] = (hexFrequency[full] || 0) + 1;
    }
    const topColors = Object.entries(hexFrequency).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([c])=>c);

    // ── 5. Tailwind arbitrary colors in class attributes (highest-frequency first) ──
    const twFreq: Record<string,number> = {};
    const twPat = /(?:bg|text|border|ring|fill|stroke|from|to|via|accent|decoration)-\[#([0-9a-fA-F]{3,8})\]/g;
    let twM: RegExpExecArray | null;
    while ((twM = twPat.exec(html)) !== null) {
      const n = normalizeColor('#'+twM[1]);
      if (n && !isNeutral(n)) twFreq[n] = (twFreq[n]||0)+1;
    }
    const twColors = Object.entries(twFreq).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([c])=>c);

    // ── 6. Inline style attribute colors ──
    const inlineColorPat = /style=["'][^"']*(?:background(?:-color)?|(?:^|[;\s])color)\s*:\s*([^;'"}\s][^;'"]*)/gi;
    const inlineColors: string[] = [];
    let icM: RegExpExecArray | null;
    while ((icM = inlineColorPat.exec(html)) !== null) {
      const norm = resolveColorToken(icM[1]);
      if (norm && !isNeutral(norm)) inlineColors.push(norm);
    }
    const uniqueInlineColors = [...new Set(inlineColors)].slice(0,6);

    // ── SVG fill/stroke colors ──
    const svgColors: string[] = [];
    const svgAttrPattern = /(?:fill|stroke)=["']([^"']+)["']/gi;
    let svgM: RegExpExecArray | null;
    while ((svgM = svgAttrPattern.exec(html)) !== null) {
      const v = svgM[1].trim();
      if (v === 'none' || v === 'currentColor' || v === 'transparent') continue;
      const norm = normalizeColor(v);
      if (norm && !isNeutral(norm) && !svgColors.includes(norm)) svgColors.push(norm);
      if (svgColors.length >= 8) break;
    }

    // ── Build ranked color list for deterministic extraction ──
    // Priority: CSS-var brand > semantic button-bg > semantic nav/link/heading > frequent CSS > Tailwind > inline
    const colorSignals: { value: string; source: string; weight: number }[] = [];
    for (const [k,v] of Object.entries(cssVarColors)) {
      const isPrimary = /primary|main|brand|cor|cta|btn|button|link/i.test(k);
      // Penalize numeric scale vars (--blue-500, --gray-200, etc.) — they're design tokens, not brand colors
      const isScaleStep = /(?:^|-)\d{2,3}$/.test(k);
      const weight = isPrimary ? 100 : isScaleStep ? 18 : 60;
      colorSignals.push({ value: v, source: `--${k}`, weight });
    }
    if (semanticColorMap['primary-button-bg']) colorSignals.push({ value: semanticColorMap['primary-button-bg'], source: 'primary-button', weight: 90 });
    if (semanticColorMap['button-bg']) colorSignals.push({ value: semanticColorMap['button-bg'], source: 'button', weight: 75 });
    if (semanticColorMap['nav-background']) colorSignals.push({ value: semanticColorMap['nav-background'], source: 'nav-bg', weight: 70 });
    if (semanticColorMap['link-color']) colorSignals.push({ value: semanticColorMap['link-color'], source: 'link-color', weight: 65 });
    if (semanticColorMap['heading-color']) colorSignals.push({ value: semanticColorMap['heading-color'], source: 'heading-color', weight: 55 });
    if (themeColor && !isNeutral(themeColor)) colorSignals.push({ value: themeColor, source: 'theme-meta', weight: 88 });
    topColors.forEach((c,i) => colorSignals.push({ value: c, source: `css-freq-${i+1}`, weight: 40-(i*3) }));
    twColors.forEach((c,i) => colorSignals.push({ value: c, source: `tailwind-${i+1}`, weight: 35-(i*3) }));
    uniqueInlineColors.forEach((c,i) => colorSignals.push({ value: c, source: `inline-${i+1}`, weight: 25-(i*2) }));
    svgColors.forEach((c,i) => colorSignals.push({ value: c, source: `svg-${i+1}`, weight: 50-(i*5) }));

    // De-duplicate by color value, keep highest weight
    const dedupedSignals = new Map<string, { source: string; weight: number }>();
    for (const s of colorSignals) {
      const existing = dedupedSignals.get(s.value);
      if (!existing || s.weight > existing.weight) dedupedSignals.set(s.value, { source: s.source, weight: s.weight });
    }
    const rankedColors = [...dedupedSignals.entries()]
      .sort((a,b) => b[1].weight - a[1].weight)
      .map(([color, meta]) => ({ color, ...meta }));

    // Best brand colors to pass to AI (top 8)
    const top8BrandColors = rankedColors.slice(0, 8);

    // Build deterministic best-guess for primary/secondary/accent
    const preferredPrimaryFromVars = pickVarColor([/primary/, /brand/, /main/, /cta/, /btn/, /button/, /link/]);
    const preferredSecondaryFromVars = pickVarColor([/secondary/, /accent/, /alt/, /surface/, /background/]);
    const detPrimary = preferredPrimaryFromVars || semanticColorMap['primary-button-bg'] || semanticColorMap['button-bg'] || rankedColors[0]?.color || '';
    const detSecondary = preferredSecondaryFromVars || rankedColors.find(c => c.color !== detPrimary)?.color || '';
    const detAccent = rankedColors.find(c => c.color !== detPrimary && c.color !== detSecondary)?.color || '';

    // Text/background should include neutrals, so extract them separately from semantic selectors.
    const parseColorFromCssRule = (pattern: RegExp) => {
      pattern.lastIndex = 0;
      const match = pattern.exec(allCss);
      if (!match) return '';
      return resolveColorToken(match[1]) || '';
    };

    const detBackground =
      parseColorFromCssRule(/(?:body|html|main|\.site|\.page|\.wrapper)\s*(?:[,{]|[^\{]+\{)[^}]*background(?:-color)?:\s*([^;}\n]+)/gi)
      || '';
    const detText =
      parseColorFromCssRule(/(?:body|html|main|\.site|\.page|\.wrapper)\s*(?:[,{]|[^\{]+\{)[^}]*color:\s*([^;}\n]+)/gi)
      || '';

    const debugPayload: Record<string, unknown> | null = debugMode
      ? {
          request: {
            url: formattedUrl,
            accountType: normalizeAccountType(accountType),
            htmlLength: html.length,
            truncatedHtmlLength: truncatedHtml.length,
            linkedCssLength: linkedCssText.length,
            usedLinkedCss: linkedCssText.length > 0,
          },
          colors: {
            themeColor,
            cssVarColors: Object.fromEntries(Object.entries(cssVarColors).slice(0, 20)),
            semanticColorMap,
            topCssColors: topColors.slice(0, 10),
            tailwindColors: twColors.slice(0, 8),
            inlineColors: uniqueInlineColors.slice(0, 8),
            rankedSignals: rankedColors.slice(0, 12),
            detected: {
              primary: detPrimary,
              secondary: detSecondary,
              accent: detAccent,
              text: detText,
              background: detBackground,
            },
          },
          fonts: {
            detected: allDetectedFonts.slice(0, 12),
          },
          logo: {
            bestLogo,
            candidates: uniqueLogoCandidates.slice(0, 10),
            rankedCandidates: Array.from(logoCandidateScoreMap.entries()).slice(0, 10).map(([url, meta]) => ({ url, score: meta.score, source: meta.source })),
            hasInlineSvgLogo,
            ogImage,
          },
        }
      : null;

    const colorHintParts: string[] = [];
    if (themeColor && !isNeutral(themeColor)) colorHintParts.push(`theme-color (mobile browser bar): ${themeColor}`);
    if (Object.keys(cssVarColors).length > 0) colorHintParts.push(`CSS custom properties (HIGHEST CONFIDENCE): ${Object.entries(cssVarColors).map(([k,v])=>`--${k}: ${v}`).join(', ')}`);
    if (semanticColorMap['primary-button-bg']) colorHintParts.push(`Primary button background: ${semanticColorMap['primary-button-bg']}`);
    if (semanticColorMap['button-bg']) colorHintParts.push(`Button background: ${semanticColorMap['button-bg']}`);
    if (semanticColorMap['nav-background']) colorHintParts.push(`Nav/header background: ${semanticColorMap['nav-background']}`);
    if (semanticColorMap['link-color']) colorHintParts.push(`Link/anchor color: ${semanticColorMap['link-color']}`);
    if (semanticColorMap['heading-color']) colorHintParts.push(`Heading color: ${semanticColorMap['heading-color']}`);
    if (topColors.length) colorHintParts.push(`Most frequent non-neutral colors in CSS: ${topColors.join(', ')}`);
    if (twColors.length) colorHintParts.push(`Tailwind arbitrary palette: ${twColors.join(', ')}`);
    if (uniqueInlineColors.length) colorHintParts.push(`Inline style colors: ${uniqueInlineColors.join(', ')}`);

    const colorHint = colorHintParts.length > 0
      ? `\n\nCOLOR EXTRACTION RESULTS (pre-analyzed from HTML + all CSS files):\n${colorHintParts.join('\n')}\n\nAUTO-DETECTED PRIMARY COLOR: ${detPrimary || '(not found)'}\nAUTO-DETECTED SECONDARY: ${detSecondary || ''}\nAUTO-DETECTED ACCENT: ${detAccent || ''}\n\nINSTRUCTION: These are real colors extracted directly from the site's code. Use them as the ABSOLUTE SOURCE OF TRUTH. If AUTO-DETECTED PRIMARY COLOR is given, it MUST become primaryColor — override anything else. Format all colors as #rrggbb.`
      : '';

    // ═══════════════════════════════════════════════════════════════════════════
    // DETERMINISTIC LOGO EXTRACTION
    // ═══════════════════════════════════════════════════════════════════════════
    const base = new URL(formattedUrl);
    function toAbsolute(src: string): string {
      try {
        if (!src || src.startsWith('data:')) return src;
        if (src.startsWith("//")) return `${base.protocol}${src}`;
        if (src.startsWith("http")) return src;
        return new URL(src, formattedUrl).href;
      } catch { return src; }
    }

    const logoHintCandidates: Array<{ url: string; source: string; score: number }> = [];

    const readAttr = (tag: string, name: string) => tag.match(new RegExp(`${name}=["']([^"']+)["']`, 'i'))?.[1] || '';
    const addLogoCandidate = (rawUrl: string, source: string, bonus = 0) => {
      const absoluteUrl = toAbsolute(String(rawUrl || '').trim());
      if (!absoluteUrl || absoluteUrl.startsWith('data:')) return;

      let score = bonus;
      if (/\.svg(?:$|\?)/i.test(absoluteUrl)) score += 90;
      else if (/\.(?:png|webp)(?:$|\?)/i.test(absoluteUrl)) score += 65;
      else if (/\.(?:jpg|jpeg|gif|avif)(?:$|\?)/i.test(absoluteUrl)) score += 30;

      if (/logo|logotipo|marca|brand|navbar-brand|custom-logo|site-logo/i.test(`${absoluteUrl} ${source}`)) score += 55;
      if (/apple-touch-icon|mask-icon/i.test(source)) score += 40;
      if (/jsonld/i.test(source)) score += 32;
      if (/header|nav|brand-container|brand-link/i.test(source)) score += 26;
      if (/itemprop-logo|schema-logo/i.test(source)) score += 24;

      if (/hero|banner|cover|background|slide|carousel|testimonial|avatar|person|team|product|gallery/i.test(`${absoluteUrl} ${source}`)) score -= 70;
      if (/favicon|sprite|placeholder|loader|blank|pixel/i.test(`${absoluteUrl} ${source}`)) score -= 45;
      if (/\.ico(?:$|\?)/i.test(absoluteUrl)) score -= 90;

      logoHintCandidates.push({ url: absoluteUrl, source, score });
    };

    const addSrcsetCandidates = (rawSrcset: string, source: string, bonus = 0) => {
      const entries = String(rawSrcset || '')
        .split(',')
        .map((part) => part.trim().split(/\s+/)[0])
        .filter(Boolean);
      entries.forEach((entry, index) => addLogoCandidate(entry, `${source}:srcset:${index + 1}`, bonus - index));
    };

    const collectLogoUrlsFromJsonLd = (value: unknown, path = 'jsonld'): string[] => {
      if (!value) return [];
      if (typeof value === 'string') {
        return /^(?:https?:|\/|\.\/|\.\.\/|\/\/)/i.test(value.trim()) ? [value.trim()] : [];
      }
      if (Array.isArray(value)) {
        return value.flatMap((entry, index) => collectLogoUrlsFromJsonLd(entry, `${path}[${index}]`));
      }
      if (typeof value === 'object') {
        const obj = value as Record<string, unknown>;
        const direct = [obj.logo, obj.image, obj.url, obj.contentUrl].flatMap((entry, index) => collectLogoUrlsFromJsonLd(entry, `${path}:${index}`));
        const nested = Object.entries(obj)
          .filter(([key]) => /logo|image|brand|publisher|organization/i.test(key))
          .flatMap(([key, entry]) => collectLogoUrlsFromJsonLd(entry, `${path}.${key}`));
        return [...direct, ...nested];
      }
      return [];
    };

    // 1. JSON-LD logo (most authoritative — structured data)
    const jsonLdBlocks = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
    for (const block of jsonLdBlocks.slice(0, 8)) {
      try {
        const parsed = JSON.parse(block.replace(/<\/?script[^>]*>/gi, ''));
        collectLogoUrlsFromJsonLd(parsed).forEach((url) => addLogoCandidate(url, 'jsonld', 65));
      } catch { /* ignore */ }
    }

    // 1b. Meta/link schema hints commonly used by CMS/theme plugins
    const schemaLogoMeta = html.match(/<meta[^>]+(?:itemprop=["']logo["'][^>]+content=["']([^"']+)["']|content=["']([^"']+)["'][^>]+itemprop=["']logo["'])/i);
    if (schemaLogoMeta) addLogoCandidate(schemaLogoMeta[1] || schemaLogoMeta[2], 'itemprop-logo', 72);
    const msTileImage = html.match(/<meta[^>]+(?:name=["']msapplication-TileImage["'][^>]+content=["']([^"']+)["']|content=["']([^"']+)["'][^>]+name=["']msapplication-TileImage["'])/i);
    if (msTileImage) addLogoCandidate(msTileImage[1] || msTileImage[2], 'msapplication-TileImage', 18);

    // 2. <img> with logo/brand/marca/logotipo anywhere in the tag (class, id, alt, src, data-src)
    const imgTags = html.match(/<img[^>]+>/gi) || [];
    for (const tag of imgTags) {
      const tagSource = /logo|marca|brand|logotipo|custom-logo|navbar-brand|site-logo/i.test(tag)
        ? 'img:logo-hint'
        : /itemprop=["']logo["']/i.test(tag)
        ? 'img:itemprop-logo'
        : '';
      if (!tagSource) continue;

      ['src', 'data-src', 'data-lazy-src', 'data-logo', 'data-srcset'].forEach((attr) => {
        const value = readAttr(tag, attr);
        if (!value) return;
        if (/srcset/i.test(attr)) addSrcsetCandidates(value, `${tagSource}:${attr}`, 42);
        else addLogoCandidate(value, `${tagSource}:${attr}`, 48);
      });

      const srcset = readAttr(tag, 'srcset');
      if (srcset) addSrcsetCandidates(srcset, `${tagSource}:srcset`, 44);
    }

    // 3. First <img> inside <header> or <nav> — most reliable positional heuristic
    const headerChunk = html.match(/<(?:header|nav)\b[^>]*>[\s\S]{0,3000}/i)?.[0] || '';
    if (headerChunk) {
      const headerImgTags = headerChunk.match(/<img[^>]+>/gi) || [];
      for (const tag of headerImgTags.slice(0, 6)) {
        ['src', 'data-src', 'data-lazy-src'].forEach((attr) => {
          const value = readAttr(tag, attr);
          if (value) addLogoCandidate(value, `header-img:${attr}`, /logo|brand|marca/i.test(tag) ? 55 : 18);
        });
        const srcset = readAttr(tag, 'srcset');
        if (srcset) addSrcsetCandidates(srcset, 'header-img:srcset', /logo|brand|marca/i.test(tag) ? 54 : 18);
      }

      const headerSvgRefs = headerChunk.match(/<(?:svg|use|image)[^>]+(?:href|xlink:href)=["']([^"'#]+(?:svg|png|webp|jpg|jpeg)[^"']*)["']/gi) || [];
      for (const ref of headerSvgRefs) {
        const href = ref.match(/(?:href|xlink:href)=["']([^"']+)["']/i)?.[1];
        if (href) addLogoCandidate(href, 'header-svg-ref', 58);
      }

      const headerBgTags = headerChunk.match(/<[^>]+(?:logo|brand|navbar-brand|site-logo)[^>]*style=["'][^"']*url\(([^)]+)\)[^"']*["'][^>]*>/gi) || [];
      for (const tag of headerBgTags) {
        const bgUrl = tag.match(/url\((['"]?)([^)'"\s]+)\1\)/i)?.[2];
        if (bgUrl) addLogoCandidate(bgUrl, 'header-background-logo', 60);
      }
    }

    // 4. Inline SVG logo — look for <svg> inside elements with logo/brand class or inside nav/header
    const hasInlineSvgLogo = /<svg[\s>]/i.test(headerChunk) && (
      /class=["'][^"']*(?:logo|brand|marca)[^"']*["']/i.test(headerChunk) || headerChunk.length > 50
    );

    // 5. <link rel="apple-touch-icon"> — reliable 180×180 brand icon
    const linkTags = html.match(/<link[^>]+>/gi) || [];
    for (const tag of linkTags) {
      if (!/apple-touch-icon/i.test(tag)) continue;
      const hrefM = tag.match(/href=["']([^"']+)["']/i);
      if (hrefM) addLogoCandidate(hrefM[1], 'apple-touch-icon', 70);
    }
    // mask-icon (SVG pinned tab icon — very clean SVG logo)
    for (const tag of linkTags) {
      if (!/mask-icon/i.test(tag)) continue;
      const hrefM = tag.match(/href=["']([^"']+)["']/i);
      if (hrefM) addLogoCandidate(hrefM[1], 'mask-icon', 74);
    }

    // 6. og:image (used as heroImage hint, not primary logo)
    const ogImageM = html.match(/<meta[^>]+(?:property=["']og:image["'][^>]+content=["']([^"']+)["']|content=["']([^"']+)["'][^>]+property=["']og:image["'])/i);
    const ogImage = ogImageM ? toAbsolute(ogImageM[1] || ogImageM[2]) : '';

    // 7. Favicon as last resort
    for (const tag of linkTags) {
      if (!/\bshortcut icon\b|\bicon\b/i.test(tag) || /apple-touch|mask/i.test(tag)) continue;
      const hrefM = tag.match(/href=["']([^"']+)["']/i);
      if (hrefM && !/\.ico$/i.test(hrefM[1])) addLogoCandidate(hrefM[1], 'icon-link', 8);
    }

    // Rank candidates by source/context instead of first-match order.
    const logoCandidateScoreMap = new Map<string, { score: number; source: string }>();
    for (const candidate of logoHintCandidates) {
      const existing = logoCandidateScoreMap.get(candidate.url);
      if (!existing || candidate.score > existing.score) {
        logoCandidateScoreMap.set(candidate.url, { score: candidate.score, source: candidate.source });
      }
    }
    const rankedLogoCandidates = Array.from(logoCandidateScoreMap.entries())
      .sort((a, b) => b[1].score - a[1].score)
      .map(([url]) => url);
    const uniqueLogoCandidates = rankedLogoCandidates;
    const bestLogo = uniqueLogoCandidates[0] || '';

    const logoHintLines: string[] = [];
    if (bestLogo) logoHintLines.push(`PRE-DETECTED LOGO URL: ${bestLogo} ← use this as logoUrl`);
    if (ogImage && ogImage !== bestLogo) logoHintLines.push(`og:image (use as heroImage1 if appropriate): ${ogImage}`);
    if (hasInlineSvgLogo && !bestLogo) logoHintLines.push(`INLINE SVG LOGO in header/nav (no external URL available). Leave logoUrl empty.`);
    if (uniqueLogoCandidates.length > 1) logoHintLines.push(`Other candidates: ${uniqueLogoCandidates.slice(1, 4).join(', ')}`);

    const logoHint = logoHintLines.length > 0
      ? `\n\nLOGO DETECTION:\n${logoHintLines.join('\n')}\nINSTRUCTION: Always prefer JSON-LD > apple-touch-icon > header img position. If a clear logo URL is given, use it verbatim — do not invent URLs.`
      : '';

    // ── image discovery hints ─────────────────────────────────────────────────
    const pictureSources: string[] = [];
    for (const src of (html.match(/<source[^>]+srcset=["']([^"']+)["']/gi) || []).slice(0, 12)) {
      const srcsetVal = src.match(/srcset=["']([^"']+)["']/i)?.[1] || '';
      const firstUrl = srcsetVal.split(',')[0].trim().split(' ')[0];
      if (firstUrl && /\.(jpg|jpeg|png|webp|avif|svg|gif)(\?[^\s"']*)?$/i.test(firstUrl)) pictureSources.push(toAbsolute(firstUrl));
    }
    // Also collect additional img[src] that are large/content images (not logos)
    const contentImgUrls: string[] = [];
    for (const tag of (html.match(/<img[^>]+>/gi) || []).slice(0, 30)) {
      const src = tag.match(/(?:src|data-src|data-lazy-src)=["']([^"']+)["']/i)?.[1] || '';
      if (!src || /logo|brand|marca|icon|favicon|sprite|pixel|avatar|thumb|1x1/i.test(`${src} ${tag}`)) continue;
      if (/\.(jpg|jpeg|png|webp|avif|svg|gif)(\?[^\s"']*)?$/i.test(src) || /\/images?\//i.test(src)) {
        contentImgUrls.push(toAbsolute(src));
      }
      if (contentImgUrls.length >= 10) break;
    }
    const bgImages: string[] = (html.match(/background(?:-image)?:\s*url\(["']?([^"')]+)["']?\)/gi) || [])
      .map((m: string) => { const u = m.match(/url\(["']?([^"')]+)["']?\)/i); return u ? toAbsolute(u[1]) : ''; })
      .filter((u: string) => u && /\.(jpg|jpeg|png|webp|svg|avif|gif)(\?[^\s"']*)?$/i.test(u))
      .slice(0, 5);
    const allExtraImages = [...new Set([...pictureSources, ...bgImages, ...contentImgUrls])].slice(0, 12);
    const extraImageHint = allExtraImages.length > 0
      ? `\n\nADDITIONAL IMAGES (srcset + css backgrounds + content imgs): ${allExtraImages.join(', ')}`
      : '';

    console.log(`HTML ${html.length}ch | CSS ${allCss.length}ch | Fonts: ${allDetectedFonts.join(',') || 'none'} | Colors: ${colorSignals.length} signals | Top: ${detPrimary||'?'} | Logo: ${bestLogo || 'none'}`);


    const systemPrompt = `You are a website analyzer. Extract business information and visual design data from the HTML.

Return a JSON object with EXACTLY these fields (use "" for missing values, never omit fields):

{
  "websiteType": "corporate|landing|ecommerce|portfolio|saas|blog|educational|restaurant|medical|fitness|legal",
  "businessName": "string",
  "businessDescription": "2-3 sentence description",
  "businessCategory": "string",
  "targetAudience": "string",
  "services": ["service1", "service2"],
  "valueProposition": "string",
  "differentiators": ["diff1", "diff2"],
  "primaryColor": "#rrggbb",
  "secondaryColor": "#rrggbb",
  "accentColor": "#rrggbb",
  "textColor": "#rrggbb",
  "backgroundColor": "#rrggbb",
  "preferredStyle": "modern|editorial|bold|premium|energetic|minimal",
  "logoUrl": "absolute URL",
  "heroImage1": "absolute URL to main hero/banner image",
  "heroImage1Context": "what this image shows",
  "heroImage2": "absolute URL",
  "heroImage2Context": "context",
  "brandImage": "absolute URL",
  "brandImageContext": "context",
  "sectionImage1": "absolute URL",
  "sectionImage1Context": "context",
  "sectionImage2": "absolute URL",
  "sectionImage2Context": "context",
  "sectionImage3": "absolute URL",
  "sectionImage3Context": "context",
  "city": "string",
  "country": "string",
  "phone": "string",
  "whatsapp": "string",
  "email": "string",
  "facebook": "URL",
  "instagram": "URL",
  "twitter": "URL",
  "linkedin": "URL",
  "youtube": "URL",
  "designNotes": "describe layout, color mood, visual weight, spacing, typography personality",
  "headingFont": "font family name for headings (e.g. 'Montserrat')",
  "bodyFont": "font family name for body text (e.g. 'Open Sans')"
}

═══ COLOR RULES ═══
- All color values MUST be plain 6-digit hex (#rrggbb). No rgb(), no descriptions.
- If PRE-DETECTED COLORS are listed below → USE THEM DIRECTLY. Do not override with guesses.
- CSS brand variables (--primary, --color-brand) = strongest signal → always prefer.
- primaryColor = main brand color on buttons/CTAs/links. Never use white/near-white/gray as primary.
- backgroundColor = page background. textColor = main body text color.
- If no color found: use #1a1a2e (secondary), #f8fafc (background), #0f172a (text).

═══ STYLE RULES ═══
preferredStyle MUST be exactly one of: modern | editorial | bold | premium | energetic | minimal
- modern: clean SaaS/tech, professional, gradient accents, balanced layout
- editorial: serif fonts, high contrast, magazine/newspaper aesthetic, content-first
- bold: dark/high-contrast, dramatic type, agencies/studios/creative businesses
- premium: luxury/upscale, gold or dark palette, refined spacing, real estate/fashion/finance
- energetic: vibrant saturated colors, movement/excitement, fitness/sports/events/youth
- minimal: whitespace-dominant, near-white palette, law/consulting/finance/architecture

═══ IMAGE RULES ═══
- Make ALL URLs absolute using base: ${formattedUrl}
- heroImage1 = the main above-the-fold visual (wide banner, hero bg, or first large img)
- sectionImage1/2/3 = images inside content sections (team, product, illustration)
- brandImage = secondary brand photo (portrait, office, about page)
- logoUrl: if a PRE-DETECTED LOGO URL is provided, use it exactly — do not invent URLs
- Only include valid image extensions: .jpg .jpeg .png .webp .svg .avif .gif or CDN paths

═══ FONT RULES ═══
- If PRE-DETECTED FONTS are listed below, use them as headingFont/bodyFont
- headingFont: the display/title font. bodyFont: the paragraph/UI font
- Return just the family name: "Inter", "Playfair Display", etc.

═══ CONTACT RULES ═══
- Search footer, floating buttons, header CTAs for contact info
- WhatsApp: wa.me/, api.whatsapp.com/, +55 or other country-code numbers near WhatsApp links
- Phone: extract from tel: links or visible phone numbers in footer/header

Return ONLY valid JSON. No markdown fences, no extra text.
`;

    const data = await requestAiPayload(JSON.stringify({
      contents: [{
        parts: [{
          text: `${systemPrompt}${fontHint}${colorHint}${logoHint}${extraImageHint}${context?.trim() ? `\n\n═══ CONTEXT FROM USER ═══\n${context.trim()}\nUse this context to clarify ambiguous information and fill in gaps.` : ''}\n\nAnalyze this website HTML and extract all business information.\n\n${truncatedHtml}\n\nReturn ONLY valid JSON with the exact structure specified.`
        }]
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 4000,
      }
    }), GEMINI_API_KEY);
    const content = extractModelText(data);
    if (!content) throw new Error("No content in AI response");
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found in AI response");
    const aiExtracted = JSON.parse(jsonMatch[0]);

    // ── DETERMINISTIC OVERRIDE — colors/fonts/logo extracted from code win over AI guesses ──
    // The AI is used for business copy only. For visual identity we trust our code extraction.
    /** convert any color string → #rrggbb, or return fallback */
    function toHex(raw: unknown, fallback: string): string {
      if (typeof raw === 'string') { const n = normalizeColor(raw); if (n) return n; }
      return fallback;
    }
    // Build the final merged extracted object
    const extracted: Record<string, unknown> = { ...aiExtracted };

    // Colors: deterministic extraction from site code is preferred over AI guesses.
    const normalizeAiColor = (raw: unknown) => (typeof raw === 'string' ? (normalizeColor(raw) || '') : '');
    const aiPrimary = normalizeAiColor((aiExtracted as any)?.primaryColor);
    const aiSecondary = normalizeAiColor((aiExtracted as any)?.secondaryColor);
    const aiAccent = normalizeAiColor((aiExtracted as any)?.accentColor);
    const aiText = normalizeAiColor((aiExtracted as any)?.textColor);
    const aiBackground = normalizeAiColor((aiExtracted as any)?.backgroundColor);

    const primaryColor = detPrimary || (!isNeutral(aiPrimary) ? aiPrimary : '');
    const secondaryColor = detSecondary || (!isNeutral(aiSecondary) ? aiSecondary : '');
    const accentColor = detAccent || (!isNeutral(aiAccent) ? aiAccent : '');
    const textColor = detText || aiText || '#0f172a';
    const backgroundColor = detBackground || aiBackground || '#ffffff';

    extracted.primaryColor = primaryColor;
    extracted.secondaryColor = secondaryColor && secondaryColor !== primaryColor ? secondaryColor : '';
    extracted.accentColor = accentColor && accentColor !== primaryColor && accentColor !== secondaryColor ? accentColor : '';
    extracted.textColor = textColor;
    extracted.backgroundColor = backgroundColor;

    // Logo: use deterministic value when available
    if (bestLogo) extracted.logoUrl = bestLogo;

    // Fonts: use pre-detected when available
    if (allDetectedFonts.length > 0) {
      if (!extracted.headingFont || extracted.headingFont === '') extracted.headingFont = allDetectedFonts[0];
      if (!extracted.bodyFont || extracted.bodyFont === '') extracted.bodyFont = allDetectedFonts[allDetectedFonts.length > 1 ? 1 : 0];
    }

    console.log(`Scrape done — logo:${extracted.logoUrl} fonts:${extracted.headingFont}/${extracted.bodyFont} colors:${extracted.primaryColor}/${extracted.secondaryColor}/${extracted.accentColor} text:${extracted.textColor} bg:${extracted.backgroundColor}`);

    scrapeCache.set(cacheKey, {
      extracted,
      expiresAt: now + CACHE_TTL_MS,
    });

    const responsePayload: Record<string, unknown> = { extracted };
    if (debugMode && debugPayload) {
      responsePayload.debug = {
        ...debugPayload,
        finalApplied: {
          primaryColor: extracted.primaryColor,
          secondaryColor: extracted.secondaryColor,
          accentColor: extracted.accentColor,
          textColor: extracted.textColor,
          backgroundColor: extracted.backgroundColor,
          headingFont: extracted.headingFont,
          bodyFont: extracted.bodyFont,
          logoUrl: extracted.logoUrl,
        },
      };
    }

    return new Response(JSON.stringify(responsePayload), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    const status = message.includes("Rate limit exceeded")
      ? 429
      : message.includes("credits") || message.includes("usage limit")
        ? 402
        : message.includes("blocks automated access") || message.includes("Failed to fetch website content") || message.includes("not recognizable HTML")
          ? 502
          : 500;

    console.error("scrape-website error:", e);
    return new Response(JSON.stringify({ error: message }), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
