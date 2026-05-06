export type StructuredSitePayload = {
  html: string;
  css: string;
  js: string;
  assets: string[];
  slug?: string;
};

export function hasInlineCodeViolations(html: string) {
  return /<(script|style)\b/i.test(html)
    || /\sstyle\s*=\s*["']/i.test(html)
    || /\son[a-z]+\s*=\s*["']/i.test(html);
}

function isJavaScriptAsset(value: string) {
  const path = value.toLowerCase();
  return /(^|\/)script\.js(?:[?#].*)?$/i.test(path)
    || /\.js(?:[?#].*)?$/i.test(path);
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

function extractAssets(content: string) {
  const found = new Set<string>();
  const patterns = [
    /(src|data-src)=["'](https?:\/\/[^"']+)["']/gi,
    /srcset=["']([^"']+)["']/gi,
    /url\((["']?)(https?:\/\/[^"')]+)\1\)/gi,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      if (pattern.source.startsWith("srcset")) {
        const entries = match[1].split(',').map((item) => item.trim().split(/\s+/)[0]).filter(Boolean);
        entries.filter((entry) => !isJavaScriptAsset(entry)).forEach((entry) => found.add(entry));
      } else {
        if (!isJavaScriptAsset(match[2])) {
          found.add(match[2]);
        }
      }
    }
  }

  return Array.from(found);
}

export function normalizeStructuredSitePayload(candidate: Partial<StructuredSitePayload>, businessName?: string): StructuredSitePayload {
  const extractedFromHtml = typeof candidate.html === "string" && /<(html|head|body|script|style|link)\b/i.test(candidate.html)
    ? extractStructuredSiteFromHtml(candidate.html, businessName)
    : null;

  const html = extractedFromHtml?.html
    || (typeof candidate.html === "string" && candidate.html.trim() !== "" ? sanitizeHtmlFragment(candidate.html, businessName) : "<div>Fallback</div>");
  const css = (typeof candidate.css === "string" && candidate.css.trim() !== "" ? sanitizeCssContent(candidate.css) : "")
    || extractedFromHtml?.css
    || "body { margin: 0; font-family: Arial; }";
  const js = (typeof candidate.js === "string" ? sanitizeJsContent(candidate.js) : "")
    || extractedFromHtml?.js
    || "";
  const assets = Array.from(new Set([
    ...(Array.isArray(candidate.assets)
      ? candidate.assets.filter((value): value is string => typeof value === "string" && /^https?:\/\//i.test(value.trim()) && !/image\.civitai\.com/i.test(value.trim()) && !isJavaScriptAsset(value.trim())).map((value) => value.trim())
      : []),
    ...((extractedFromHtml?.assets || []).filter((value) => /^https?:\/\//i.test(value.trim()) && !/image\.civitai\.com/i.test(value.trim()) && !isJavaScriptAsset(value.trim()))),
  ]));

  const slug = typeof candidate.slug === "string" && candidate.slug.trim() !== ""
    ? candidate.slug.trim()
    : (businessName || "site").toLowerCase().replace(/[^a-z0-9-]/g, "-");

  return { html, css, js, assets, slug }; 
}

export function extractStructuredSiteFromHtml(rawHtml: string, businessName?: string): StructuredSitePayload {
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

export function parseStructuredSiteText(rawText: string, businessName?: string) {
  const cleaned = stripCodeFences(rawText);
  const jsonCandidate = cleaned.trimStart().startsWith("{") ? findFirstJsonObject(cleaned) : null;

  if (jsonCandidate) {
    try {
      return normalizeStructuredSitePayload(JSON.parse(jsonCandidate), businessName);
    } catch (error) {
      console.warn("Failed to parse structured site JSON", error);
    }
  }

  return extractStructuredSiteFromHtml(cleaned, businessName);
}

export function getStructuredSiteValidationError(sitePayload: StructuredSitePayload | null) {
  if (!sitePayload) {
    return "missing-payload";
  }

  if (!sitePayload.js.trim()) {
    return "missing-js";
  }

  if (hasInlineCodeViolations(sitePayload.html)) {
    return "inline-code-in-html";
  }

  return null;
}