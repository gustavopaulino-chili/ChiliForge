import { useState, useCallback, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AdCreativeFormData, defaultAdCreativeFormData, AD_PLATFORM_LABELS } from '@/types/adCreativeForm';
import { StepIndicator } from '@/components/generator/StepIndicator';
import { StepAdImport } from '@/components/ad-generator/StepAdImport';
import { StepAdObjective } from '@/components/ad-generator/StepAdObjective';
import { StepAdPlatform } from '@/components/ad-generator/StepAdPlatform';
import { StepAdBrand } from '@/components/ad-generator/StepAdBrand';
import { StepAdCopy } from '@/components/ad-generator/StepAdCopy';
import { StepAdStrategy } from '@/components/ad-generator/StepAdStrategy';
import { StepAdFormats } from '@/components/ad-generator/StepAdFormats';
import { StepAdCopyAI } from '@/components/ad-generator/StepAdCopyAI';
import { StepAdImages } from '@/components/ad-generator/StepAdImages';
import { StepAdReview } from '@/components/ad-generator/StepAdReview';
import { BannerLightbox } from '@/components/ad-generator/BannerLightbox';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ArrowLeft, ArrowRight, Zap, FolderOpen, LogOut, Loader2, Wand2, RotateCcw, Check, Edit3, Download, ZoomIn, Image } from 'lucide-react';
import logoResult from '@/assets/logo-result.png';
import { PremiumParticleBackground } from '@/components/landing/PremiumParticleBackground';
import { useAuth } from '@/contexts/AuthContext';
import { createProject, deleteProjectAssetFile, generateAdCreatives, generateAdImages, generateAdsViaAgentTracked, generateImages, interpretBatchesViaAgent, prepareAdsFromCampaignPayload, searchImages, updateProjectFormState, uploadProjectAssets, uploadProjectAssetsFromUrls, type AdImageResult } from '@/services/api';
import { toast } from 'sonner';
import '@/components/landing/HeroLanding.css';

type StepDef = { id: string; label: string };
type GeneratedBanner = {
  id: number;
  creative_id?: number;
  campaign_id?: number;
  project_id?: number;
  url: string;
  platform: string;
  format: string;
  label: string;
  width: number;
  height: number;
  variant?: string;
  html?: string;
  imageUrl?: string;
  is_image_mode?: boolean;
};

const STEPS: StepDef[] = [
  { id: 'import',    label: 'Campaign' },
  { id: 'objective', label: 'Objective' },
  { id: 'platform',  label: 'Platforms' },
  { id: 'brand',     label: 'Brand' },
  { id: 'copy',      label: 'Offer & Audience' },
  { id: 'strategy',  label: 'Strategy' },
  { id: 'formats',   label: 'Formats & A/B' },
  { id: 'ai_copy',   label: 'Ad Copy' },
  { id: 'images',    label: 'Images' },
  { id: 'review',    label: 'Review' },
];

const clampStepIndex = (value?: number) => {
  const step = Number(value ?? 0);
  if (!Number.isFinite(step)) return 0;
  return Math.min(Math.max(step, 0), STEPS.length - 1);
};

function buildAdFormatGroups(data: AdCreativeFormData) {
  const groups = new Map<string, number>();
  data.selectedFormats
    .filter((format) => format.enabled)
    .forEach((format) => {
      const key = `${format.width}x${format.height}`;
      groups.set(key, (groups.get(key) || 0) + 1);
    });

  return Array.from(groups.entries()).map(([dimension, count]) => ({ dimension, count }));
}

function formatAdGroupMessage(group: { dimension: string; count: number }, state: 'queued' | 'created') {
  const suffix = group.count > 1 ? ` (${group.count} creatives)` : '';
  return `${group.dimension} ${state}${suffix}`;
}

const FUNNEL_CREATIVE_GUIDANCE: Record<string, string> = {
  awareness: `FUNNEL STAGE: Top of Funnel (Awareness)
- Communication should feel native, organic, not like a traditional hard-sell ad
- Avoid aggressive selling language and pushy CTAs
- Use CTAs like "Learn more", "Discover", "Explore" — exploratory and light
- Focus on curiosity, pattern interruption, and audience identification
- Hook-first approach: lead with something surprising, relatable, or thought-provoking`,

  consideration: `FUNNEL STAGE: Mid-Funnel (Consideration)
- User already recognizes the problem or interest — be informative and persuasive
- Highlight differentiators, benefits, comparisons, proof, demonstrations
- Communication can be more direct, but without excessive purchase pressure
- Focus on value building and solution consideration`,

  conversion: `FUNNEL STAGE: Bottom of Funnel (Conversion)
- Ads must be action-oriented and decision-driving
- Use strong, clear CTAs: "Buy now", "Claim your spot", "Get started now"
- Exploit urgency, scarcity, offer, trust signals, and objection reduction
- Focus on closing: be direct, commercial, incentive-heavy`,
};

const STRATEGY_GUIDANCE: Record<string, string> = {
  'problem-solution': 'Structure: identify the target pain point first, then position the product as the clear fix.',
  'before-after':     'Show transformation contrast — the miserable before state vs. the desired after state.',
  'testimonial':      'Lead with a real or realistic customer quote/story as the headline or main message.',
  'ugc':              'Raw, organic, user-generated aesthetic — minimal polish, native platform feel.',
  'founder-story':    'Personal narrative from the brand founder — authentic, human, mission-driven.',
  'educational':      'Teach something genuinely useful. Position the brand as the authority on this topic.',
  'emotional':        'Lead with emotion, aspiration, or identity. Sell the feeling, not the feature.',
  'luxury-premium':   'High-end aesthetic: dark backgrounds, gold/silver accents, minimal copy, maximum elegance.',
  'direct-response':  'Strong hook, clear offer, urgency, unambiguous CTA. No fluff, maximum response.',
  'meme-trend':       'Leverage trending visual formats or cultural references. Humor or relatability-first.',
  'comparison':       'Side-by-side or implied contrast vs. competitors or the "old way".',
  'authority':        'Lead with credibility: stats, press mentions, certifications, awards, number of users.',
  'lifestyle':        'Aspirational lifestyle imagery — sell the life the product enables, not the product itself.',
  'product-showcase': 'Product-centric creative — close-up detail, features, quality, design beauty.',
};

function resolveExportUrl(url: string): string {
  const raw = String(url || '').trim();
  if (!raw || raw.startsWith('data:') || raw.startsWith('blob:')) return raw;
  try {
    return new URL(raw, window.location.origin).toString();
  } catch {
    return raw;
  }
}

async function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise<string>(resolve => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
}

async function fetchAsDataUri(url: string): Promise<string | null> {
  const resolved = resolveExportUrl(url);

  // 1. Try direct fetch with CORS
  try {
    const resp = await fetch(resolved, { mode: 'cors', credentials: 'omit' });
    if (resp.ok) return blobToDataUri(await resp.blob());
  } catch {
    // CORS blocked — fall through to server proxy
  }

  // 2. Fallback: server-side proxy bypasses CORS (PHP fetches image server-to-server)
  try {
    const proxyUrl = `/api/proxyImage.php?url=${encodeURIComponent(resolved)}`;
    const resp = await fetch(proxyUrl, { credentials: 'same-origin' });
    if (resp.ok) return blobToDataUri(await resp.blob());
  } catch {
    // proxy also failed
  }

  return null;
}

async function inlineGoogleFontsCss(fontsUrl: string): Promise<string> {
  try {
    const resp = await fetch(fontsUrl, { mode: 'cors', credentials: 'omit' });
    if (!resp.ok) return '';
    let css = await resp.text();
    const fontFileUrls = [...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)].map(m => m[1]);
    await Promise.all(fontFileUrls.map(async (fontUrl) => {
      const dataUri = await fetchAsDataUri(fontUrl);
      if (dataUri) css = css.split(fontUrl).join(dataUri);
    }));
    return css;
  } catch {
    return '';
  }
}

async function makeSelfContainedHtml(html: string): Promise<string> {
  const imgUrls = new Set<string>();
  for (const m of html.matchAll(/src=["']([^"']+)["']/g)) {
    const url = m[1].trim();
    if (url && !url.startsWith('data:') && !url.startsWith('blob:')) imgUrls.add(url);
  }
  for (const m of html.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
    const url = m[1].trim();
    if (url && !url.startsWith('data:') && !url.startsWith('blob:') && !url.includes('fonts.googleapis.com')) imgUrls.add(url);
  }

  const fontImportUrls = new Set<string>();
  for (const m of html.matchAll(/@import\s+url\(["']?(https:\/\/fonts\.googleapis\.com[^"')]+)["']?\)/g)) fontImportUrls.add(m[1]);

  const [imageEntries, fontEntries] = await Promise.all([
    Promise.all([...imgUrls].map(async url => [url, await fetchAsDataUri(url)] as const)),
    Promise.all([...fontImportUrls].map(async url => [url, await inlineGoogleFontsCss(url)] as const)),
  ]);

  let result = html;

  for (const [url, css] of fontEntries) {
    if (!css) continue;
    for (const q of [`'${url}'`, `"${url}"`, url]) {
      const importStr = `@import url(${q})`;
      if (result.includes(importStr + ';')) { result = result.split(importStr + ';').join(css); break; }
      if (result.includes(importStr))       { result = result.split(importStr).join(css);        break; }
    }
  }

  for (const [url, dataUri] of imageEntries) {
    if (dataUri) result = result.split(url).join(dataUri);
  }

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <base href="${window.location.origin}/">
  <style>
    html,body{margin:0!important;padding:0!important;width:100%!important;height:100%!important;background:transparent!important;overflow:hidden!important}
    *{box-sizing:border-box}
  </style>
</head>
<body>${result}</body>
</html>`;
}

async function loadBannerHtmlForExport(banner: GeneratedBanner): Promise<string> {
  if (banner.html?.trim()) return banner.html;
  const baseUrl = String(banner.url || '').trim();
  if (!baseUrl) return '';
  const indexUrl = baseUrl.replace(/\/index\.html$/i, '/').replace(/\/?$/, '/index.html');
  const response = await fetch(resolveExportUrl(indexUrl), { cache: 'no-store', credentials: 'same-origin' });
  if (!response.ok) return '';
  return await response.text();
}

function buildAdCreativePrompt(data: AdCreativeFormData): string {
  const enabledFormats = data.selectedFormats.filter(f => f.enabled);
  const platformNames = [...new Set(enabledFormats.map(f => AD_PLATFORM_LABELS[f.platform]))].join(', ');

  const formatsList = enabledFormats
    .map(f => {
      const noteKey = `${f.platform}-${f.label}`;
      const note = data.formatNotes[noteKey];
      return `  - ${f.label} (${f.width}×${f.height}px)${note ? ` — NOTE: ${note}` : ''}`;
    })
    .join('\n');

  const logoVariantsText = (data.logoVariants || [])
    .filter(v => v.url)
    .map((v, i) => `  ${i + 1}. ${v.label || 'Logo variation'}: ${v.url}${v.usageHint ? ` (${v.usageHint})` : ''}`)
    .join('\n');

  const headlineVarsText = (data.headlineVariants || []).filter(Boolean).join(' | ');
  const ctaVarsText      = (data.ctaVariants      || []).filter(Boolean).join(' | ');

  const abExtras = [
    headlineVarsText && `Headline variants (use one per variant, VERBATIM): ${headlineVarsText}`,
    ctaVarsText      && `CTA variants (use one per variant, VERBATIM): ${ctaVarsText}`,
  ].filter(Boolean).join('\n');

  const abTestingText = data.abTestingEnabled
    ? [
        `Enabled: ${data.abVariantCount} variants/format. Primary focus: ${data.abTestFocus}.`,
        abExtras,
      ].filter(Boolean).join('\n')
    : 'Disabled: one best creative per format.';

  const funnelGuidance = FUNNEL_CREATIVE_GUIDANCE[data.funnelStage] || '';
  const strategyGuidance = data.creativeStrategy && STRATEGY_GUIDANCE[data.creativeStrategy]
    ? `CREATIVE ANGLE: ${data.creativeStrategy.toUpperCase()}\n${STRATEGY_GUIDANCE[data.creativeStrategy]}`
    : data.creativeStrategy === 'other' && data.creativeStrategyOther
    ? `CREATIVE ANGLE: CUSTOM\n${data.creativeStrategyOther}`
    : '';

  const copySection = !data.useAiCopy && (data.mainHeadline || data.subheadline)
    ? `EXACT COPY TO USE (do not deviate):
${data.mainHeadline ? `  Main Headline (max 40 chars): "${data.mainHeadline}"` : ''}
${data.subheadline  ? `  Subheadline (max 50 chars): "${data.subheadline}"` : ''}
${data.ctaText      ? `  CTA: "${data.ctaText}"` : ''}`
    : `COPY DIRECTION (AI-generated):
  CTA: ${data.ctaText || 'choose appropriate CTA for the funnel stage'}
  Value prop to convey: ${data.valueProposition || ''}`;

  const customFontSection = [
    data.customHeadingFont?.name &&
      `★ MANDATORY CUSTOM HEADING FONT: font-family: '${data.customHeadingFont.name}' MUST be applied to ALL h1/h2/h3 elements. DO NOT @import this font from Google Fonts — the @font-face with the actual font file is embedded automatically in the HTML. Using any other font for headings is a critical error.`,
    data.customBodyFont?.name &&
      `★ MANDATORY CUSTOM BODY FONT: font-family: '${data.customBodyFont.name}' MUST be applied to ALL body text (p, span, div, li, a, button). DO NOT @import this font from Google Fonts — the @font-face is embedded automatically. Using any other font for body text is a critical error.`,
  ].filter(Boolean).join('\n');

  return `Generate a dedicated HTML creative board containing ${enabledFormats.length} advertising banner(s) for ${platformNames}.

This must be AD CREATIVE output only. Do not generate a landing page, hero section, website navigation, pricing, FAQ, testimonials, or lead-capture sections.
You are operating an AD CREATIVE ENGINE: the output must feel like paid media, not a website preview.
Every banner needs a strong background visual layer, punchy headline, short support copy, visible CTA, brand/logo presence, and offer/urgency cue when available.
Generate each banner as a fixed ad canvas using absolute-positioned layers. The root .ad-banner must be position:relative, and primary elements (background, logo, product/media, headline, subheadline, CTA, badges, decorative shapes) must use position:absolute with explicit coordinates and sizes. Avoid flex/grid/normal flow for the primary composition.

${customFontSection ? customFontSection + '\n' : ''}${funnelGuidance}
${data.campaignObjective ? `CAMPAIGN OBJECTIVE: ${data.campaignObjective} — optimize messaging and creative direction for this goal.` : ''}
${strategyGuidance}

BRAND: ${data.brandName || 'Brand'}
${data.industry ? `INDUSTRY: ${data.industry}` : ''}
${data.brandKeywords ? `BRAND KEYWORDS (include these in messaging): ${data.brandKeywords}` : ''}
${data.forbiddenWords ? `FORBIDDEN WORDS (never use): ${data.forbiddenWords}` : ''}
STYLE: ${data.preferredStyle}
PRIMARY COLOR: ${data.primaryColor}
SECONDARY COLOR: ${data.secondaryColor}
ACCENT COLOR: ${data.accentColor}
TEXT COLOR: ${data.textColor}
BACKGROUND COLOR: ${data.backgroundColor}
${data.customHeadingFont?.name ? `HEADING FONT: ${data.customHeadingFont.name} (CUSTOM — already embedded as @font-face, do NOT @import from Google Fonts)` : data.headingFont ? `HEADING FONT: ${data.headingFont}` : ''}
${data.customBodyFont?.name ? `BODY FONT: ${data.customBodyFont.name} (CUSTOM — already embedded as @font-face, do NOT @import from Google Fonts)` : data.bodyFont ? `BODY FONT: ${data.bodyFont}` : ''}

PRODUCT / SERVICE: ${data.productName || 'Product'}
${data.offer     ? `OFFER: ${data.offer}` : ''}
${data.pricing   ? `PRICING: ${data.pricing}` : ''}
${data.discount  ? `DISCOUNT: ${data.discount}` : ''}
${data.guarantee ? `GUARANTEE: ${data.guarantee}` : ''}
${data.scarcity  ? `SCARCITY: ${data.scarcity}` : ''}
VALUE PROPOSITION: ${data.valueProposition || ''}

TARGET AUDIENCE: ${data.targetAudience || 'General audience'}
${data.ageRange   ? `AGE RANGE: ${data.ageRange}` : ''}
${data.gender !== 'all' ? `GENDER: ${data.gender}` : ''}
${data.painPoints ? `PAIN POINTS: ${data.painPoints}` : ''}
${data.desires    ? `DESIRES / ASPIRATIONS: ${data.desires}` : ''}

TONE OF VOICE: ${data.toneOfVoice}
URGENCY LEVEL: ${data.urgencyLevel}

${copySection}

LOGO SELECTION STRATEGY: ${data.preferredLogoStrategy}
LOGO VARIATIONS:
${logoVariantsText || '  No logo variations provided. Use primary logo if available.'}

A/B TESTING:
${abTestingText}

BANNERS TO GENERATE:
${formatsList}`;
}

function escapeHtmlAttribute(value: string): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildImageCreativeHtml(image: AdImageResult): string {
  const width = Number(image.width || 1080);
  const height = Number(image.height || 1080);
  const src = escapeHtmlAttribute(image.imageUrl || '');
  const label = escapeHtmlAttribute(image.label || 'Ad image');

  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body{width:${width}px;height:${height}px;overflow:hidden;background:transparent}
</style></head><body><div class="ad-banner" data-platform="${escapeHtmlAttribute(image.platform || 'banner')}" data-format="${escapeHtmlAttribute(image.format || 'ad')}" style="position:relative;width:${width}px;height:${height}px;overflow:hidden;background:#fff;"><img src="${src}" alt="${label}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;"></div></body></html>`;
}

function extractBanners(
  html: string,
  formats: Array<{ platform: string; format: string; label: string; width: number; height: number }>
): Array<{ platform: string; format: string; label: string; width: number; height: number; variant?: string; html: string }> {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const styles = Array.from(doc.querySelectorAll('style'))
      .map(s => s.textContent || '')
      .join('\n');
    // Preserve Google Fonts <link> tags so per-banner HTML files render fonts correctly
    const fontLinks = Array.from(doc.querySelectorAll('link[rel="stylesheet"]'))
      .filter(l => (l as HTMLLinkElement).href?.includes('fonts.googleapis.com'))
      .map(l => (l as HTMLLinkElement).outerHTML)
      .join('\n');
    const bannerEls = Array.from(doc.querySelectorAll('.ad-banner'));
    const totalsByFormat = new Map<string, number>();
    bannerEls.forEach((el, i) => {
      const platform = el.getAttribute('data-platform') || '';
      const format = el.getAttribute('data-format') || '';
      const matched = formats.find(f => f.platform === platform && f.format === format) || formats[i];
      const key = `${matched?.platform || platform || 'banner'}-${matched?.format || format || 'ad'}`;
      totalsByFormat.set(key, (totalsByFormat.get(key) || 0) + 1);
    });
    const seenByFormat = new Map<string, number>();
    return bannerEls.map((el, i) => {
      const platform = el.getAttribute('data-platform') || '';
      const format   = el.getAttribute('data-format')   || '';
      const matched  = formats.find(f => f.platform === platform && f.format === format)
                    || formats[i]
                    || { platform: 'banner', format: 'ad', label: `Banner ${i + 1}`, width: 1080, height: 1080 };
      const occurrenceKey = `${matched.platform}-${matched.format}`;
      const occurrence = seenByFormat.get(occurrenceKey) || 0;
      seenByFormat.set(occurrenceKey, occurrence + 1);
      const variant = el.getAttribute('data-variant') || ((totalsByFormat.get(occurrenceKey) || 0) > 1 ? ['A', 'B', 'C'][occurrence] : '');
      const label = variant ? `${matched.label} - Variant ${variant}` : matched.label;
      const w = matched.width;
      const h = matched.height;
      // Body at exact banner dimensions: Chrome headless screenshots exactly w×h, no extra background
      const bannerHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8">
${fontLinks}
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body{width:${w}px;height:${h}px;overflow:hidden;background:transparent}
${styles}
</style></head><body>${el.outerHTML}</body></html>`;
      return { platform: matched.platform, format: matched.format, label, width: w, height: h, variant: variant || undefined, html: bannerHtml };
    });
  } catch {
    return [];
  }
}

function buildAdCreativeFormDataSnapshot(data: AdCreativeFormData) {
  return {
    theme: {
      style: data.preferredStyle,
      primary: data.primaryColor,
      secondary: data.secondaryColor,
      accent: data.accentColor,
      background: data.backgroundColor,
      text: data.textColor,
      headingFont: data.headingFont || '',
      bodyFont: data.bodyFont || '',
    },
    images: {
      logo: data.logoUrl || '',
      hero: data.productImageUrl || '',
      sections: data.backgroundImageUrl ? [data.backgroundImageUrl] : [],
      about: '',
      team: '',
      products: [],
    },
    services: [data.productName, data.offer].filter(Boolean) as string[],
    differentiators: [data.valueProposition].filter(Boolean) as string[],
    contact: { email: '', phone: '', whatsapp: '' },
    language: 'auto',
    conversionGoal: 'sales',
    guarantee: '',
    urgencyLevel: data.urgencyLevel === 'none' ? 'low' : data.urgencyLevel,
    toneOfVoice: data.toneOfVoice,
    sourceWebsite: data.websiteUrl || undefined,
  };
}

function getRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

function buildProjectAssetBase(publicUrl?: string, folderPath?: string): string {
  const publicPath = String(publicUrl || '').trim();
  if (publicPath) {
    try {
      const url = new URL(publicPath, window.location.origin);
      const pathname = url.pathname.replace(/\/index\.html$/i, '/').replace(/\/?$/, '/');
      if (pathname.includes('/projects/')) return pathname;
    } catch {
      const normalized = publicPath.replace(/\/index\.html$/i, '/').replace(/\/?$/, '/');
      if (normalized.includes('/projects/')) return normalized;
    }
  }

  const normalizedFolder = String(folderPath || '').replace(/\\/g, '/').replace(/\/index\.html$/i, '').replace(/^\/+|\/+$/g, '');
  const parts = normalizedFolder.split('/').filter(Boolean);
  const projectsIndex = parts.findIndex((part) => part.toLowerCase() === 'projects');
  const projectParts = projectsIndex >= 0 ? parts.slice(projectsIndex + 1) : parts.slice(-1);
  const relativePath = projectParts.join('/');
  return relativePath ? `/projects/${relativePath}/` : '';
}

function resolveRestoredAssetUrl(value: unknown, projectBase: string): string {
  const raw = typeof value === 'string' ? value.trim().replace(/\\\//g, '/') : '';
  if (!raw) return '';
  if (/^(?:https?:|data:|blob:|\/projects\/|\/images\/|\/assets\/)/i.test(raw)) return raw;
  if (!projectBase) return raw;

  if (/^(?:\.\/|\.\.\/)*assets\//i.test(raw)) {
    const assetPath = raw.replace(/^(?:\.\/|\.\.\/)*/g, '');
    return `${projectBase.replace(/\/?$/, '/')}${assetPath}`;
  }

  return raw;
}

function normalizeAssetStringArray(value: unknown, projectBase: string): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === 'string') return resolveRestoredAssetUrl(item, projectBase);
      const record = getRecord(item);
      return resolveRestoredAssetUrl(record.url, projectBase);
    })
    .filter(Boolean);
}

function normalizeLogoVariants(value: unknown, projectBase: string): AdCreativeFormData['logoVariants'] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => {
      if (typeof item === 'string') {
        const url = resolveRestoredAssetUrl(item, projectBase);
        return url ? { id: `restored-logo-${index}`, url, label: `Logo ${index + 1}` } : null;
      }

      const record = getRecord(item);
      const url = resolveRestoredAssetUrl(record.url, projectBase);
      if (!url) return null;

      return {
        id: String(record.id || `restored-logo-${index}`),
        url,
        label: String(record.label || `Logo ${index + 1}`),
        usageHint: typeof record.usageHint === 'string' ? record.usageHint : undefined,
      };
    })
    .filter(Boolean) as AdCreativeFormData['logoVariants'];
}

function normalizeRestoredAdFormData(
  rawFormData: unknown,
  projectPublicUrl?: string,
  folderPath?: string,
): AdCreativeFormData {
  const raw = getRecord(rawFormData);
  const images = getRecord(raw.images);
  const projectBase = buildProjectAssetBase(projectPublicUrl, folderPath);
  const merged = {
    ...defaultAdCreativeFormData,
    ...raw,
  } as AdCreativeFormData;

  const logoUrl = firstString(
    raw.logoUrl,
    images.logoUrl,
    images.logo,
    images.brandLogo,
    raw.logo,
  );
  const productImageUrl = firstString(
    raw.productImageUrl,
    images.productImageUrl,
    images.product,
    images.hero,
    images.heroImage,
    images.heroImage1,
    raw.productImage,
  );
  const backgroundImageUrl = firstString(
    raw.backgroundImageUrl,
    images.backgroundImageUrl,
    images.background,
    images.backgroundImage,
    images.brandImage,
    images.sectionImage1,
    Array.isArray(images.sections) ? images.sections[0] : '',
  );

  const productVariants = normalizeAssetStringArray(raw.productImageVariants, projectBase);
  const backgroundVariants = normalizeAssetStringArray(raw.backgroundImageVariants, projectBase);

  merged.logoUrl = resolveRestoredAssetUrl(logoUrl || merged.logoUrl, projectBase);
  merged.productImageUrl = resolveRestoredAssetUrl(productImageUrl || merged.productImageUrl, projectBase);
  merged.backgroundImageUrl = resolveRestoredAssetUrl(backgroundImageUrl || merged.backgroundImageUrl, projectBase);
  merged.logoVariants = normalizeLogoVariants(raw.logoVariants, projectBase);
  merged.productImageVariants = productVariants.length
    ? productVariants
    : normalizeAssetStringArray(images.products || images.productVariants, projectBase);
  merged.backgroundImageVariants = backgroundVariants.length
    ? backgroundVariants
    : normalizeAssetStringArray(images.sections || images.backgroundVariants, projectBase);

  if (merged.logoUrl && !merged.logoVariants.some((variant) => variant.url === merged.logoUrl)) {
    merged.logoVariants = [
      { id: 'restored-logo-primary', url: merged.logoUrl, label: 'Primary logo' },
      ...merged.logoVariants,
    ];
  }

  return merged;
}

function AdHeader({ onLogoClick, onSignOut }: { onLogoClick?: () => void; onSignOut?: () => void }) {
  return (
    <header className="sticky top-0 border-b border-border/40 px-6 py-[13px] z-50 bg-background/25 backdrop-blur-md">
      <div className="mx-auto max-w-6xl flex items-center justify-between">
        <button onClick={onLogoClick} className="flex items-center gap-2 cursor-pointer">
          <img src="/images/logo-small.png" alt="Logo" className="h-8 w-auto" />
          <img src="/images/logo.png" alt="Forge" className="h-7 w-auto" />
        </button>
        <div className="flex items-center gap-2">
          <Link to="/projects">
            <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground hover:text-foreground">
              <FolderOpen className="h-4 w-4" /> Projects
            </Button>
          </Link>
          <Button variant="ghost" size="sm" onClick={onSignOut} className="gap-2 text-muted-foreground hover:text-foreground">
            <LogOut className="h-4 w-4" /> Log out
          </Button>
        </div>
      </div>
    </header>
  );
}

export default function AdCreatives() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, signOut } = useAuth();
  const routeState = location.state as {
    formData?: AdCreativeFormData;
    currentStep?: number;
    savedProjectId?: number | string;
    showResults?: boolean;
    generatedHtml?: string;
    generatedPublicUrl?: string;
    projectPublicUrl?: string;
    folderPath?: string;
    generatedBanners?: GeneratedBanner[];
    companyProjectId?: number;
    campaignId?: number;
  } | null;

  const [currentStep, setCurrentStep] = useState(clampStepIndex(routeState?.currentStep));
  const [maxVisitedStep, setMaxVisitedStep] = useState(clampStepIndex(routeState?.currentStep));
  const [formData, setFormData] = useState<AdCreativeFormData>(() =>
    normalizeRestoredAdFormData(
      routeState?.formData,
      routeState?.projectPublicUrl || routeState?.generatedPublicUrl,
      routeState?.folderPath,
    )
  );
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationStatus, setGenerationStatus] = useState('');
  const [generationProgress, setGenerationProgress] = useState(0);
  const [generationLog, setGenerationLog] = useState<string[]>([]);
  const [genBatches, setGenBatches] = useState<Array<{ label: string; status: 'queued' | 'running' | 'done' | 'failed' }>>([]);
  const [savedProjectId, setSavedProjectId] = useState<number | null>(() => {
    const id = Number(routeState?.savedProjectId ?? 0);
    return id > 0 ? id : null;
  });
  const [showResults, setShowResults] = useState(Boolean(routeState?.showResults));
  const [generateAsImage, setGenerateAsImage] = useState(false);
  const [generatedImages, setGeneratedImages] = useState<AdImageResult[]>([]);
  const [generatedHtml, setGeneratedHtml] = useState(routeState?.generatedHtml || '');
  const [generatedPublicUrl, setGeneratedPublicUrl] = useState(routeState?.generatedPublicUrl || '');
  const [generatedBanners, setGeneratedBanners] = useState<GeneratedBanner[]>(routeState?.generatedBanners || []);
  const [selectedBannerIds, setSelectedBannerIds] = useState<Set<number>>(
    new Set((routeState?.generatedBanners || []).map((banner) => banner.id))
  );
  const [lightboxBanner, setLightboxBanner] = useState<typeof generatedBanners[0] | null>(null);
  const [activePlatform, setActivePlatform] = useState<string>('all');
  const [brandBookFile, setBrandBookFile] = useState<File | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadStatus, setDownloadStatus] = useState('');
  const [downloadLog, setDownloadLog] = useState<string[]>([]);
  const recentPexelsUrlsRef = useRef<string[]>([]);

  const currentStepId = STEPS[currentStep]?.id;

  const resetAndNew = useCallback(() => {
    setShowResults(false);
    setFormData(defaultAdCreativeFormData);
    setCurrentStep(0);
    setMaxVisitedStep(0);
    setSavedProjectId(null);
    setBrandBookFile(null);
    setGeneratedHtml('');
    setGeneratedPublicUrl('');
    setGeneratedBanners([]);
    setGeneratedImages([]);
    setSelectedBannerIds(new Set());
    setLightboxBanner(null);
    setActivePlatform('all');
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      document.documentElement.style.setProperty('--mouse-x', `${e.clientX}px`);
      document.documentElement.style.setProperty('--mouse-y', `${e.clientY}px`);
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  const updateForm = useCallback((updates: Partial<AdCreativeFormData>) => {
    setFormData(prev => ({ ...prev, ...updates }));
  }, []);

  const ensureDraftProject = useCallback(async () => {
    if (savedProjectId) return Number(savedProjectId);
    if (!user?.id) throw new Error('User not authenticated');

    const saved = await createProject({
      user_id: user.id,
      name: (formData.campaignName || formData.brandName || 'AD Creative Draft') + ' (Draft)',
      public_url: '',
      folder_path: '',
      form_data: formData,
      generated_html: '',
      current_step: currentStep,
      project_type: 'ad_creative',
      draft_only: true,
      ...(routeState?.companyProjectId ? { company_project_id: routeState.companyProjectId } : {}),
    });

    if (!saved?.success || !saved?.id) {
      throw new Error(saved?.error || 'Could not create draft project for asset upload');
    }

    const projectId = Number(saved.id);
    setSavedProjectId(projectId);
    return projectId;
  }, [currentStep, formData, savedProjectId, user?.id]);

  const handleUploadAssets = useCallback(async (files: File[]) => {
    if (!user?.id) throw new Error('User not authenticated');
    const projectId = await ensureDraftProject();
    const result = await uploadProjectAssets(projectId, user.id, files);
    const urls = (result.uploaded || []).map((asset) => asset.url).filter(Boolean);
    if (urls.length === 0) throw new Error('No asset URL returned from upload');
    return urls;
  }, [ensureDraftProject, user?.id]);

  const handleRemoveAsset = useCallback(async (url: string) => {
    if (!savedProjectId || !user?.id) return;
    const fileName = decodeURIComponent((url.split('/').pop() || '').split('?')[0]);
    if (!fileName) return;
    await deleteProjectAssetFile(savedProjectId, user.id, fileName);
  }, [savedProjectId, user?.id]);

  const handleGenerateAdImage = useCallback(async (
    slot: 'logo' | 'product' | 'background',
    ctx: { brandName: string; productName: string; valueProposition: string; style: string; primaryColor: string; secondaryColor: string; backgroundColor: string; industry: string; toneOfVoice: string; targetAudience: string; campaignName: string },
    variantIndex?: number
  ): Promise<string | null> => {
    const slotLabel = variantIndex !== undefined
      ? `${slot}-variant-${(['a', 'b', 'c'])[variantIndex] ?? variantIndex}`
      : slot;

    const prompts: Record<string, string> = {
      logo: `Minimal ${ctx.style} logo icon for brand "${ctx.brandName}"${ctx.industry ? ` in the ${ctx.industry} industry` : ''}, flat vector style, transparent background, no text, professional`,
      product: `${ctx.style} product photography for "${ctx.productName || ctx.brandName}"${ctx.valueProposition ? `, ${ctx.valueProposition}` : ''}${ctx.targetAudience ? `, targeting ${ctx.targetAudience}` : ''}, professional advertising image, clean composition, no text`,
      background: `${ctx.style} abstract background for${ctx.industry ? ` ${ctx.industry}` : ''} digital ad creative, dominant colors ${ctx.primaryColor} and ${ctx.secondaryColor}, ${ctx.toneOfVoice || 'professional'} mood, no text, no logos, premium composition`,
    };

    const variationAngles = ['bright and energetic composition', 'dramatic and moody atmosphere', 'minimal and clean aesthetic'];
    const basePrompt = prompts[slot];
    const finalPrompt = variantIndex !== undefined
      ? `${basePrompt}, ${variationAngles[variantIndex] ?? variationAngles[0]}`
      : basePrompt;

    try {
      const result = await generateImages({
        prompt: finalPrompt,
        style: ctx.style,
        businessName: ctx.brandName,
        businessDescription: ctx.valueProposition,
        businessCategory: ctx.industry,
        purpose: slot === 'logo' ? 'logo' : slot === 'product' ? 'product image' : 'background',
        brandPersonality: ctx.toneOfVoice,
        primaryColor: ctx.primaryColor,
        secondaryColor: ctx.secondaryColor,
        valueProposition: ctx.valueProposition,
        targetAudience: ctx.targetAudience,
      });
      if (!result.imageUrl) return null;

      const projectId = await ensureDraftProject();
      if (user?.id && result.imageUrl.startsWith('data:')) {
        const ext = result.imageUrl.split(';')[0].split('/')[1] || 'png';
        const safeBrand = (ctx.brandName || 'brand').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30);
        const fileName = `ad-${slotLabel}-${safeBrand}.${ext}`;
        const blob = await fetch(result.imageUrl).then(r => r.blob());
        const file = new File([blob], fileName, { type: blob.type });
        const uploadResult = await uploadProjectAssets(projectId, user.id, [file]);
        const uploadedUrl = (uploadResult.uploaded || [])[0]?.url;
        if (!uploadedUrl) throw new Error('Generated image could not be saved to project assets.');
        return uploadedUrl;
      }

      if (user?.id && /^https?:\/\//i.test(result.imageUrl)) {
        const safeBrand = (ctx.brandName || 'brand').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30);
        const uploadResult = await uploadProjectAssetsFromUrls(
          projectId,
          user.id,
          [result.imageUrl],
          [`ad-${slotLabel}-${safeBrand}`],
        );
        const uploadedUrl = (uploadResult.uploaded || [])[0]?.url;
        if (uploadedUrl) return uploadedUrl;

        const blob = await fetch(result.imageUrl, { mode: 'cors', credentials: 'omit' }).then(r => {
          if (!r.ok) throw new Error('Generated image URL could not be downloaded.');
          return r.blob();
        });
        const ext = blob.type.split('/')[1] || 'png';
        const file = new File([blob], `ad-${slotLabel}-${safeBrand}.${ext}`, { type: blob.type || 'image/png' });
        const browserUpload = await uploadProjectAssets(projectId, user.id, [file]);
        const browserUploadedUrl = (browserUpload.uploaded || [])[0]?.url;
        if (!browserUploadedUrl) throw new Error('Generated image could not be saved to project assets.');
        return browserUploadedUrl;
      }

      throw new Error('Generated image returned an unsupported URL format.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Image generation failed. Try again or upload manually.');
      return null;
    }
  }, [ensureDraftProject, user?.id]);

  const handleSearchPexelsAdImage = useCallback(async (
    slot: 'logo' | 'product' | 'background',
    ctx: { brandName: string; productName: string; valueProposition: string; style: string; primaryColor: string; secondaryColor: string; backgroundColor: string; industry: string; toneOfVoice: string; targetAudience: string; campaignName: string },
    variantIndex?: number
  ): Promise<string | null> => {
    const query = (ctx.productName || '').replace(/\s+/g, ' ').trim();
    if (!query) {
      toast.error('Fill the Product / Service field before searching Pexels.');
      return null;
    }

    try {
      const result = await searchImages(query, 10);
      const candidates = (result.images || [])
        .map((image) => image?.url)
        .filter((url): url is string => typeof url === 'string' && url.trim() !== '');
      const recentUrls = recentPexelsUrlsRef.current;
      const freshCandidates = candidates.filter((url) => !recentUrls.includes(url));
      const pool = freshCandidates.length ? freshCandidates : candidates;
      const imageUrl = pool.length ? pool[Math.floor(Math.random() * pool.length)] : '';
      if (!imageUrl) {
        toast.error('No Pexels image found for this context.');
        return null;
      }
      recentPexelsUrlsRef.current = [imageUrl, ...recentUrls.filter((url) => url !== imageUrl)].slice(0, 20);

      const projectId = await ensureDraftProject();
      if (user?.id && /^https?:\/\//i.test(imageUrl)) {
        const slotLabel = variantIndex !== undefined
          ? `${slot}-pexels-variant-${(['a', 'b', 'c'])[variantIndex] ?? variantIndex}`
          : `${slot}-pexels`;
        const safeBrand = (ctx.brandName || 'brand').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30);
        const uploadResult = await uploadProjectAssetsFromUrls(projectId, user.id, [imageUrl], [`ad-${slotLabel}-${safeBrand}`]);
        const uploadedUrl = (uploadResult.uploaded || [])[0]?.url;
        if (uploadedUrl) {
          toast.success('Pexels image found and saved to assets.');
          return uploadedUrl;
        }
      }

      toast.success('Pexels image found.');
      return imageUrl;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Pexels search failed. Try another context or upload manually.');
      return null;
    }
  }, [ensureDraftProject, user?.id]);

  const handleDownloadZip = useCallback(async () => {
    const selected = generatedBanners.filter(b => selectedBannerIds.has(b.id));
    if (!selected.length) return;

    setIsDownloading(true);
    setDownloadProgress(0);
    setDownloadLog([]);

    const zipFileName = (formData.campaignName || formData.brandName || 'ad-creatives')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'ad-creatives';

    const triggerDownload = (blob: Blob, name: string) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    };

    // ── Path 1: server-side headless Chrome (pixel-perfect, matches preview) ──
    const creativeIds = selected
      .map(b => b.creative_id)
      .filter((id): id is number => typeof id === 'number' && id > 0);

    if (creativeIds.length === selected.length && user?.id) {
      setDownloadStatus('Preparing your creatives...');
      setDownloadProgress(20);

      try {
        const res = await fetch(
          `/api/downloadAdCreativesZip.php?ids=${creativeIds.join(',')}&user_id=${user.id}`,
          { credentials: 'same-origin' },
        );

        const contentType = res.headers.get('Content-Type') || '';
        if (res.ok && contentType.includes('zip')) {
          setDownloadProgress(90);
          setDownloadStatus('Almost done...');
          const blob = await res.blob();
          triggerDownload(blob, `${zipFileName}.zip`);
          setDownloadProgress(100);
          setDownloadStatus('Done!');
          setDownloadLog([`✓ ${selected.length} creative${selected.length > 1 ? 's' : ''} exported`, '✓ Export created']);
          await new Promise(r => setTimeout(r, 800));
          setIsDownloading(false);
          toast.success(`${selected.length} creative${selected.length > 1 ? 's' : ''} exported successfully!`);
          return;
        }
        // Server unavailable — fall through silently to client-side
      } catch {
        // Server unavailable — fall through silently to client-side
      }

      setDownloadProgress(0);
    }

    // ── Path 2: client-side capture via html-to-image (uses browser's own CSS engine via SVG foreignObject)
    try {
      setDownloadStatus('Preparing your creatives...');
      const [{ default: JSZip }, htmlToImage] = await Promise.all([
        import('jszip'),
        import('html-to-image'),
      ]);

      setDownloadProgress(5);

      const zip = new JSZip();
      const progressPerBanner = 85 / selected.length;

      for (let i = 0; i < selected.length; i++) {
        const banner = selected[i];
        const step = `${i + 1} of ${selected.length}`;
        setDownloadStatus(`Inlining assets ${step}: ${banner.label}`);

        // Inline all external resources (fonts, images) as base64 data URIs so html-to-image has no CORS issues
        const bannerHtml = await loadBannerHtmlForExport(banner);
        if (!bannerHtml.trim()) {
          throw new Error(`Could not load creative HTML for ${banner.label}`);
        }
        const selfContainedHtml = await makeSelfContainedHtml(bannerHtml);
        const htmlBlob = new Blob([selfContainedHtml], { type: 'text/html' });
        const blobUrl = URL.createObjectURL(htmlBlob);

        // Hidden off-screen iframe — body is exact banner dimensions (no centering)
        const iframe = document.createElement('iframe');
        iframe.style.cssText = `position:fixed;left:-${banner.width + 200}px;top:0;width:${banner.width}px;height:${banner.height}px;border:0;pointer-events:none;`;
        iframe.src = blobUrl;
        document.body.appendChild(iframe);

        try {
          await new Promise<void>((resolve, reject) => {
            const t = setTimeout(() => reject(new Error(`Timeout: ${banner.label}`)), 20000);
            iframe.onload = () => { clearTimeout(t); resolve(); };
            iframe.onerror = () => { clearTimeout(t); reject(new Error(`Load error: ${banner.label}`)); };
          });

          // Wait for fonts and images to fully load before capture
          await iframe.contentDocument!.fonts.ready;
          await Promise.all(
            Array.from(iframe.contentDocument!.images).map(img => {
              if (img.complete) return Promise.resolve();
              return new Promise<void>(resolve => {
                img.onload = () => resolve();
                img.onerror = () => resolve();
              });
            }),
          );
          // Extra paint tick so layout is stable
          await new Promise(r => setTimeout(r, 400));

          setDownloadStatus(`Capturing ${step}: ${banner.label}...`);
          const captureEl = iframe.contentDocument!.querySelector<HTMLElement>('.ad-banner, [data-platform][data-format]');
          if (!captureEl) throw new Error(`Creative root not found: ${banner.label}`);

          // html-to-image uses SVG foreignObject → delegates CSS to the browser engine (clip-path, filters, fonts all work)
          const blob = await htmlToImage.toBlob(captureEl, {
            width: banner.width,
            height: banner.height,
            pixelRatio: 1,
            skipAutoScale: true,
            style: { margin: '0', transform: 'none', flexShrink: '0' },
            // All resources are already inlined as data URIs — no CORS filter needed
            filter: () => true,
          });

          if (!blob) throw new Error(`Capture returned empty result for ${banner.label}`);
          const arrayBuffer = await blob.arrayBuffer();

          const safeName = banner.label.replace(/[^a-zA-Z0-9-_. ]/g, '-').trim() || `banner-${banner.id}`;
          let fileName = `${safeName}.png`;
          let suffix = 1;
          while (zip.file(fileName)) { fileName = `${safeName}-${suffix++}.png`; }
          zip.file(fileName, arrayBuffer);

          setDownloadLog(prev => [...prev, `✓ ${banner.label}`]);
        } finally {
          document.body.removeChild(iframe);
          URL.revokeObjectURL(blobUrl);
        }

        setDownloadProgress(Math.round(5 + progressPerBanner * (i + 1)));
      }

      setDownloadStatus('Packaging ZIP...');
      setDownloadProgress(95);

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      triggerDownload(zipBlob, `${zipFileName}.zip`);

      setDownloadProgress(100);
      setDownloadStatus('Done!');
      setDownloadLog(prev => [...prev, `✓ ${selected.length} creative${selected.length > 1 ? 's' : ''} exported`, '✓ Export created']);

      await new Promise(r => setTimeout(r, 800));
      setIsDownloading(false);
      toast.success(`${selected.length} PNG${selected.length > 1 ? 's' : ''} exported successfully!`);
    } catch (err) {
      setIsDownloading(false);
      toast.error(err instanceof Error ? err.message : 'Failed to generate ZIP');
    }
  }, [generatedBanners, selectedBannerIds, formData.campaignName, formData.brandName, user?.id]);

  useEffect(() => {
    if (!savedProjectId || !user?.id) return;
    const timeout = window.setTimeout(() => {
      updateProjectFormState({
        id: savedProjectId,
        user_id: user.id,
        current_step: currentStep,
        form_data: formData,
        project_type: 'ad_creative',
      }).catch(() => undefined);
    }, 700);
    return () => window.clearTimeout(timeout);
  }, [currentStep, formData, savedProjectId, user?.id]);

  const canProceed = (): boolean => {
    if (currentStepId === 'import') {
      return formData.campaignName.trim().length > 0;
    }
    if (currentStepId === 'platform') {
      return formData.selectedFormats.some(f => f.enabled);
    }
    return true;
  };

  const handleNext = () => {
    if (!canProceed()) {
      if (currentStepId === 'import') toast.error('Campaign name is required to continue');
      else toast.error('Please select at least one platform and format to continue');
      return;
    }
    if (currentStep < STEPS.length - 1) {
      const next = currentStep + 1;
      setCurrentStep(next);
      setMaxVisitedStep(prev => Math.max(prev, next));
      // Ensure draft exists so the auto-save useEffect can persist form state
      ensureDraftProject().catch(() => undefined);
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
      return;
    }
    if (routeState?.companyProjectId) {
      navigate(`/projects/${routeState.companyProjectId}`);
      return;
    }
    navigate('/projects');
  };

  const handleClear = () => {
    if (window.confirm('Clear all form data and start over?')) {
      setFormData(defaultAdCreativeFormData);
      setCurrentStep(0);
      setMaxVisitedStep(0);
      setSavedProjectId(null);
      setBrandBookFile(null);
      toast.success('Form cleared');
    }
  };

  const handleGenerate = async () => {
    const warnings: string[] = [];
    if (!formData.campaignName.trim()) warnings.push('Campaign name');
    if (!formData.brandName) warnings.push('Brand name');
    if (!formData.productName) warnings.push('Product / service name');
    if (!formData.valueProposition) warnings.push('Value proposition');
    if (!formData.selectedFormats.some(f => f.enabled)) warnings.push('Ad formats');

    if (warnings.length > 0) {
      toast.error(`Missing required fields: ${warnings.join(', ')}`);
      return;
    }

    if (!user?.id) {
      toast.error('User not authenticated');
      return;
    }

    setIsGenerating(true);
    setGenerationProgress(10);
    setGenerationLog([]);
    setGenBatches([]);

    try {
      const formatGroups = buildAdFormatGroups(formData);
      setGenerationStatus('Building ad creative prompt...');
      setGenerationLog([
        'Analyzing form data and selected formats...',
        ...formatGroups.map((group) => formatAdGroupMessage(group, 'queued')),
      ]);
      const prompt = buildAdCreativePrompt(formData);

      setGenerationProgress(30);
      setGenerationStatus('Generating AD Creatives with AI...');
      setGenerationLog(prev => [...prev, 'Sending request to AI engine...']);

      // Strip base64 font data URIs before sending to edge function (too large for API payload)
      const adDataForApi = {
        ...formData,
        customHeadingFont: undefined as undefined,
        customBodyFont: undefined as undefined,
        customHeadingFontName: formData.customHeadingFont?.name || undefined,
        customBodyFontName: formData.customBodyFont?.name || undefined,
        assetBaseUrl: window.location.origin,
      };

      // IMAGE MODE: generate images via Gemini image model, skip HTML flow.
      // One format per edge function call to stay within the 150s Supabase limit.
      if (generateAsImage && routeState?.companyProjectId && user?.id) {
        const enabledFormats = (adDataForApi.selectedFormats as Record<string, unknown>[] || [])
          .filter((f) => f['enabled'] !== false && f['width'] && f['height']);

        if (!enabledFormats.length) throw new Error('No enabled ad formats selected.');

        // Interpret step — same pipeline as HTML mode, queries stores and produces rich spec per format
        setGenerationStatus('Interpreting brand and campaign design guidelines...');
        const prepared = await prepareAdsFromCampaignPayload({
          user_id: user.id,
          company_project_id: routeState.companyProjectId,
          campaign_id: routeState.campaignId || 0,
          form_overrides: adDataForApi as Record<string, unknown>,
        });
        let batchSpecs: Array<{ label: string; spec: string }> = [];
        try {
          const interpretation = await interpretBatchesViaAgent(prepared.edgePayload, enabledFormats, 'interpret_image');
          batchSpecs = interpretation.batchSpecs || [];
        } catch {
          // non-fatal — image generation proceeds without spec
        }

        const allImages: import('@/services/api').AdImageResult[] = [];

        for (let fi = 0; fi < enabledFormats.length; fi++) {
          const fmt = enabledFormats[fi];
          const fmtLabel = String(fmt['label'] || `${fmt['width']}x${fmt['height']}`);
          setGenerationStatus(`Generating ${fmtLabel} (${fi + 1}/${enabledFormats.length})...`);
          setGenerationLog(prev => [...prev, `Generating format: ${fmtLabel}`]);
          setGenerationProgress(30 + Math.round((fi / enabledFormats.length) * 48));

          const fmtFormData = {
            ...adDataForApi,
            selectedFormats: (adDataForApi.selectedFormats as Record<string, unknown>[] || []).map((f) => ({
              ...f,
              enabled: f['platform'] === fmt['platform'] && f['format'] === fmt['format'] &&
                       Number(f['width']) === Number(fmt['width']) && Number(f['height']) === Number(fmt['height'])
                ? f['enabled'] !== false
                : false,
            })),
          };

          const fmtSpec = batchSpecs.find(s =>
            s.label?.toLowerCase() === fmtLabel.toLowerCase()
          )?.spec || batchSpecs[fi]?.spec || "";

          const imageResult = await generateAdImages({
            user_id: user.id,
            company_project_id: routeState.companyProjectId,
            campaign_id: routeState.campaignId,
            form_data: { ...(fmtFormData as Record<string, unknown>), creative_plan: fmtSpec },
          });
          const fmtImages = (imageResult.images || []).filter((img) => img.imageUrl);
          allImages.push(...fmtImages);
        }

        if (!allImages.length) throw new Error('AI did not return any ad images.');

        setGenerationProgress(82);
        setGenerationStatus('Saving image ads to campaign board...');
        setGenerationLog(prev => [...prev, 'Saving image files as image creatives...']);
        const bannerPayload = allImages.map((img, index) => ({
          platform: img.platform || 'banner',
          format: img.format || 'ad',
          label: img.label || `Image Ad ${index + 1}`,
          width: Number(img.width || 1080),
          height: Number(img.height || 1080),
          html: img.imageUrl || '',
          is_image_mode: true,
        }));

        const slugBase = (formData.campaignName || formData.brandName || 'campaign')
          .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const slug = `ad-${slugBase}-${Date.now()}`;
        const projectIdForPublish = await ensureDraftProject();
        const publishResponse = await fetch('/api/publishAdCreative.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            project_id: projectIdForPublish,
            user_id: user.id,
            name: formData.campaignName || `AD Creative - ${formData.brandName}`,
            slug,
            form_data: { ...formData, generate_as_image: true },
            html: '',
            current_step: STEPS.length - 1,
            banners: bannerPayload,
          }),
        });

        const saved = await publishResponse.json();
        if (!saved?.success || !saved?.id) {
          const msg = [saved?.error, saved?.details].filter(Boolean).join(' - ');
          throw new Error(msg || 'Failed to save image ads');
        }

        const banners = Array.isArray(saved.banners)
          ? saved.banners.map((banner: GeneratedBanner, index: number) => ({
              ...banner,
              imageUrl: banner.imageUrl || allImages[index]?.imageUrl || undefined,
              is_image_mode: true,
            }))
          : [];
        setSavedProjectId(Number(saved.id));
        setGeneratedHtml('');
        setGeneratedPublicUrl(saved.url || '');
        setGeneratedBanners(banners);
        setGeneratedImages([]);
        setSelectedBannerIds(new Set(banners.map((b: { id: number }) => b.id)));
        setIsGenerating(false);
        setShowResults(true);
        toast.success(`${banners.length} ad image${banners.length !== 1 ? 's' : ''} saved to the campaign board!`);
        return;
      }

      const data = (routeState?.companyProjectId && user?.id)
        ? await generateAdsViaAgentTracked(
            {
              user_id: user.id,
              company_project_id: routeState.companyProjectId,
              campaign_id: routeState.campaignId,
              form_data: adDataForApi as Record<string, unknown>,
            },
            (event) => {
              if (event.type === 'plan') {
                setGenerationLog(prev => [...prev, 'Creative strategy planned.']);
                setGenerationProgress(35);
              } else if (event.type === 'batch_start') {
                setGenerationProgress(40 + Math.round((event.batchIndex / Math.max(event.totalBatches, 1)) * 45));
                setGenerationStatus(`Generating ${event.label} (${event.batchIndex + 1}/${event.totalBatches})...`);
                setGenBatches(prev => {
                  const arr = prev.length < event.totalBatches
                    ? [...prev, ...Array(event.totalBatches - prev.length).fill({ label: '', status: 'queued' as const })]
                    : [...prev];
                  arr[event.batchIndex] = { label: event.label, status: 'running' };
                  return arr;
                });
              } else if (event.type === 'batch_done') {
                setGenBatches(prev => prev.map((b, i) => i === event.batchIndex ? { ...b, label: event.label, status: 'done' } : b));
              } else if (event.type === 'batch_fail') {
                setGenBatches(prev => prev.map((b, i) => i === event.batchIndex ? { ...b, label: event.label, status: 'failed' } : b));
              }
            },
          )
        : await generateAdCreatives({
            prompt,
            businessName: formData.brandName || 'AD Creative',
            adData: adDataForApi,
          });

      if (!data?.html) throw new Error('AI did not return HTML');
      setGenerationLog(prev => [
        ...prev,
        ...formatGroups.map((group) => formatAdGroupMessage(group, 'created')),
      ]);

      setGenerationProgress(75);
      setGenerationStatus('Processing generated HTML...');
      setGenerationLog(prev => [...prev, 'HTML received, assembling document...']);

      const rawHtml = data.html.trim();
      const isCompleteDoc = /<!DOCTYPE|<html/i.test(rawHtml);
      let finalHtml = isCompleteDoc
        ? rawHtml
        : `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AD Creatives — ${formData.brandName}</title><style>${data.css || ''}</style></head><body>${rawHtml}<script>${data.js || ''}<\/script></body></html>`;

      // Inject custom @font-face declarations so the custom fonts render in preview and export
      const customFontBlocks: string[] = [];
      if (formData.customHeadingFont?.dataUri) {
        const f = formData.customHeadingFont;
        customFontBlocks.push(`@font-face { font-family: '${f.name}'; src: url(${f.dataUri}) format('${f.format}'); font-weight: 100 900; font-style: normal; }`);
      }
      if (formData.customBodyFont?.dataUri && formData.customBodyFont.name !== formData.customHeadingFont?.name) {
        const f = formData.customBodyFont;
        customFontBlocks.push(`@font-face { font-family: '${f.name}'; src: url(${f.dataUri}) format('${f.format}'); font-weight: 100 900; font-style: normal; }`);
      }
      if (customFontBlocks.length > 0) {
        const fontTag = `<style data-cf-custom-fonts>${customFontBlocks.join('\n')}</style>`;
        finalHtml = /<\/head>/i.test(finalHtml)
          ? finalHtml.replace(/<\/head>/i, `${fontTag}</head>`)
          : fontTag + finalHtml;
      }

      if (!finalHtml || finalHtml.trim().length < 200) {
        throw new Error('AI returned empty or invalid HTML. Please try again.');
      }

      setGenerationProgress(82);
      setGenerationStatus('Separating individual creatives...');
      setGenerationLog(prev => [...prev, 'Separating individual creatives...']);

      const bannerPayload = extractBanners(finalHtml, Array.isArray(data.formats) ? data.formats : []);

      setGenerationProgress(85);
      setGenerationStatus('Saving project...');
      setGenerationLog(prev => [...prev, 'Publishing files to server...']);

      const slugBase = (formData.campaignName || formData.brandName || 'campaign')
        .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const slug = `ad-${slugBase}-${Date.now()}`;
      const projectIdForPublish = await ensureDraftProject();

      const publishResponse = await fetch('/api/publishAdCreative.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectIdForPublish,
          user_id: user.id,
          name: formData.campaignName || `AD Creative — ${formData.brandName}`,
          slug,
          form_data: formData,
          html: finalHtml,
          current_step: STEPS.length - 1,
          banners: bannerPayload,
        }),
      });

      const saved = await publishResponse.json();
      if (!saved?.success || !saved?.id) {
        const msg = [saved?.error, saved?.details].filter(Boolean).join(' — ');
        throw new Error(msg || 'Failed to save project');
      }
      setSavedProjectId(Number(saved.id));

      setGenerationProgress(100);
      setGenerationStatus('Generation created!');
      setGenerationLog(prev => [...prev, `Project saved (ID: ${saved.id})`, 'AD creative generation created']);

      const banners = Array.isArray(saved.banners)
        ? saved.banners.map((banner: GeneratedBanner, index: number) => ({
            ...banner,
            html: bannerPayload[index]?.html || banner.html || '',
          }))
        : [];
      setGeneratedHtml(finalHtml);
      setGeneratedPublicUrl(saved.url || '');
      setGeneratedBanners(banners);
      setSelectedBannerIds(new Set(banners.map((b: { id: number }) => b.id)));
      setIsGenerating(false);
      setShowResults(true);
      toast.success('AD Creatives generated successfully!');
    } catch (err) {
      console.error('AD Creative generation error:', err);
      const msg = err instanceof Error ? err.message : 'Generation failed';
      toast.error(msg);
      setIsGenerating(false);
      setGenerationStatus('');
      setGenerationProgress(0);
    }
  };

  // Generating screen — mirrors LP generation screen style
  if (isGenerating) {
    const doneCount = genBatches.filter(b => b.status === 'done').length;
    const totalCount = genBatches.length;
    return (
      <div className="ad-creatives-theme premium-home min-h-screen bg-background relative flex flex-col overflow-hidden">
        <PremiumParticleBackground activeTone="accent" />
        <AdHeader onLogoClick={() => {}} onSignOut={signOut} />
        <main className="flex-1 flex items-center justify-center relative z-10 px-6">
          <div className="max-w-lg w-full text-center space-y-8">
            <div className="relative inline-flex h-20 w-20 items-center justify-center mx-auto">
              <div className="absolute inset-0 rounded-full bg-primary/20 animate-ping" />
              <div className="relative h-20 w-20 rounded-full bg-primary/10 flex items-center justify-center">
                <Wand2 className="h-9 w-9 text-primary animate-pulse" />
              </div>
            </div>

            <div className="space-y-2">
              <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">
                Generating your AD Creatives...
              </h2>
              <p className="text-muted-foreground text-sm min-h-[1.25rem]">
                {generationStatus}
              </p>
            </div>

            <div className="space-y-2">
              <Progress value={generationProgress} className="h-2" />
              <p className="text-xs text-muted-foreground">{generationProgress}%</p>
            </div>

            {genBatches.length > 0 ? (
              <div className="rounded-lg border border-border bg-card/50 p-4 text-left space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-foreground">Formats</p>
                  <span className="text-xs text-muted-foreground">{doneCount}/{totalCount} generated</span>
                </div>
                <div className="space-y-1.5">
                  {genBatches.map((batch, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full border shrink-0 ${
                        batch.status === 'done'
                          ? 'border-primary bg-primary/15 text-primary'
                          : batch.status === 'failed'
                          ? 'border-destructive bg-destructive/15 text-destructive'
                          : batch.status === 'running'
                          ? 'border-primary/50 bg-primary/5 text-primary'
                          : 'border-border text-muted-foreground'
                      }`}>
                        {batch.status === 'done' && <Check className="h-3 w-3" />}
                        {batch.status === 'failed' && <span className="text-[10px] font-bold leading-none">✕</span>}
                        {batch.status === 'running' && <Loader2 className="h-3 w-3 animate-spin" />}
                        {batch.status === 'queued' && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
                      </span>
                      <p className={`text-xs ${
                        batch.status === 'done' ? 'text-foreground' :
                        batch.status === 'failed' ? 'text-destructive' :
                        batch.status === 'running' ? 'text-foreground font-medium' :
                        'text-muted-foreground'
                      }`}>
                        {batch.label || `Format ${i + 1}`}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ) : generationLog.length > 0 && (
              <div className="rounded-lg border border-border bg-card/50 p-4 text-left space-y-2">
                <p className="text-xs font-medium text-foreground">Generation log</p>
                <div className="space-y-1">
                  {generationLog.map((msg, i) => (
                    <div key={i} className="flex items-start gap-3 text-xs">
                      {(() => {
                        const isDone = generationProgress >= 100 || i < generationLog.length - 1;
                        return (
                          <span className={`mt-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full border shrink-0 ${
                            isDone
                              ? 'border-primary bg-primary/15 text-primary'
                              : 'border-border text-muted-foreground'
                          }`}>
                            {isDone
                              ? <Check className="h-3 w-3" />
                              : <Loader2 className="h-3 w-3 animate-spin opacity-60" />
                            }
                          </span>
                        );
                      })()}
                      <p className="text-muted-foreground">{msg}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    );
  }

  // Download loading screen
  if (isDownloading) {
    return (
      <div className="ad-creatives-theme premium-home min-h-screen bg-background relative flex flex-col overflow-hidden">
        <PremiumParticleBackground activeTone="accent" />
        <AdHeader onLogoClick={() => {}} onSignOut={signOut} />
        <main className="flex-1 flex items-center justify-center relative z-10 px-6">
          <div className="max-w-md w-full text-center space-y-8">
            <div className="relative inline-flex h-20 w-20 items-center justify-center mx-auto">
              <div className="absolute inset-0 rounded-full bg-primary/20 animate-ping" />
              <div className="relative h-20 w-20 rounded-full bg-primary/10 flex items-center justify-center">
                <Download className="h-9 w-9 text-primary animate-pulse" />
              </div>
            </div>

            <div className="space-y-2">
              <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">
                Exporting creatives as PNG...
              </h2>
              <p className="text-muted-foreground text-sm min-h-[1.25rem]">
                {downloadStatus}
              </p>
            </div>

            <div className="space-y-2">
              <Progress value={downloadProgress} className="h-2" />
              <p className="text-xs text-muted-foreground">{downloadProgress}%</p>
            </div>

            {downloadLog.filter(m => m.startsWith('✓')).length > 0 && (
              <div className="rounded-lg border border-border bg-card/50 p-3 text-left space-y-1">
                {downloadLog.filter(m => m.startsWith('✓')).map((msg, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Check className="h-3 w-3 text-primary shrink-0" />
                    <span>{msg.replace(/^✓\s*/, '')}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </main>
      </div>
    );
  }

  // Image results screen
  if (showResults && generatedImages.length > 0) {
    const downloadImage = (img: AdImageResult) => {
      const a = document.createElement('a');
      a.href = img.imageUrl;
      a.download = `${img.label.replace(/\s+/g, '-').toLowerCase()}.png`;
      a.click();
    };
    const downloadAll = () => generatedImages.forEach(downloadImage);

    return (
      <div className="ad-creatives-theme premium-home min-h-screen bg-background relative flex flex-col overflow-hidden">
        <PremiumParticleBackground activeTone="accent" />
        <AdHeader onLogoClick={() => navigate('/')} onSignOut={signOut} />

        <main className="flex-1 flex flex-col mx-auto max-w-6xl w-full px-6 py-6 relative z-10">
          <div className="text-center mb-5">
            <img src={logoResult} alt="ChiliForge" className="h-12 w-auto mx-auto object-contain mb-3" />
            <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">
              Your AD Images are ready!
            </h2>
            <p className="mt-1.5 text-muted-foreground text-sm max-w-xl mx-auto">
              {generatedImages.length} image{generatedImages.length !== 1 ? 's' : ''} generated — download to use.
            </p>
          </div>

          {/* Not-editable notice */}
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 mb-5 flex items-center gap-3">
            <Image className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0" />
            <p className="text-sm text-amber-700 dark:text-amber-400">
              <strong>Image mode:</strong> These ads were generated as images and cannot be edited in the visual editor. To get editable HTML banners, toggle off "Generate as images" and regenerate.
            </p>
          </div>

          {/* Action bar */}
          <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
            <Button variant="outline" size="sm" onClick={resetAndNew} className="gap-2">
              <RotateCcw className="h-4 w-4" /> New generation
            </Button>
            <Button size="sm" onClick={downloadAll} className="gap-2">
              <Download className="h-4 w-4" /> Download all ({generatedImages.length})
            </Button>
          </div>

          {/* Images grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {generatedImages.map((img, i) => (
              <div key={i} className="group rounded-xl border border-border bg-card/40 overflow-hidden flex flex-col">
                <div className="relative bg-muted/50 flex items-center justify-center overflow-hidden" style={{ aspectRatio: `${img.width}/${img.height}`, maxHeight: 280 }}>
                  {img.imageUrl ? (
                    <img
                      src={img.imageUrl}
                      alt={img.label}
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <div className="flex flex-col items-center gap-2 p-4 text-muted-foreground">
                      <Image className="h-8 w-8 opacity-40" />
                      <p className="text-xs">Generation failed</p>
                    </div>
                  )}
                </div>
                <div className="px-3 py-2 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-medium truncate">{img.label}</p>
                    <p className="text-xs text-muted-foreground">{img.width}×{img.height}</p>
                  </div>
                  {img.imageUrl && (
                    <Button size="sm" variant="outline" onClick={() => downloadImage(img)} className="shrink-0 h-7 px-2 text-xs gap-1">
                      <Download className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </main>

      </div>
    );
  }

  // HTML Results screen
  if (showResults) {
    const PREVIEW_MAX_W = 340;
    const PREVIEW_MAX_H = 420;
    const platforms = ['all', ...Array.from(new Set(generatedBanners.map(b => b.platform)))];
    const filteredBanners = activePlatform === 'all'
      ? generatedBanners
      : generatedBanners.filter(b => b.platform === activePlatform);
    const allSelected = filteredBanners.length > 0 && filteredBanners.every(b => selectedBannerIds.has(b.id));
    const boardCampaignId = routeState?.campaignId || generatedBanners.find(b => Number(b.campaign_id) > 0)?.campaign_id;
    const boardCompanyProjectId = routeState?.companyProjectId;

    const openCampaignBoard = () => {
      if (boardCampaignId && boardCompanyProjectId) {
        navigate(`/projects/${boardCompanyProjectId}/campaigns/${boardCampaignId}`);
        return;
      }
      toast.error('Campaign board is not available for this creative yet.');
    };

    const toggleBanner = (id: number) => {
      setSelectedBannerIds(prev => {
        const s = new Set(prev);
        s.has(id) ? s.delete(id) : s.add(id);
        return s;
      });
    };

    return (
      <div className="ad-creatives-theme premium-home min-h-screen bg-background relative flex flex-col overflow-hidden">
        <PremiumParticleBackground activeTone="accent" />
        <AdHeader onLogoClick={() => navigate('/')} onSignOut={signOut} />

        <main className="flex-1 flex flex-col mx-auto max-w-6xl w-full px-6 py-6 relative z-10">

          {/* Header */}
          <div className="text-center mb-5">
            <img src={logoResult} alt="ChiliForge" className="h-12 w-auto mx-auto object-contain mb-3" />
            <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">
              Your AD Creatives are ready!
            </h2>
            <p className="mt-1.5 text-muted-foreground text-sm max-w-xl mx-auto">
              {generatedBanners.length > 0
                ? `${generatedBanners.length} creative${generatedBanners.length > 1 ? 's generated' : ' generated'} — click to zoom, click card to select.`
                : 'Your creatives have been generated. Open in editor to customize.'}
            </p>
          </div>

          {/* Sticky action bar */}
          <div className="sticky top-0 z-20 -mx-6 px-6 py-3 mb-4 bg-background/80 backdrop-blur-md border-b border-border/40">
            <div className="flex flex-wrap items-center justify-between gap-3 max-w-6xl mx-auto">
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={openCampaignBoard}
                  disabled={!boardCampaignId || !boardCompanyProjectId}
                  className="gap-2"
                >
                  <Edit3 className="h-4 w-4" /> Open Campaign Board
                </Button>
                {generatedBanners.length > 0 && (
                  <Button
                    size="sm"
                    disabled={selectedBannerIds.size === 0}
                    onClick={handleDownloadZip}
                    className="gap-2"
                  >
                    <Download className="h-4 w-4" />
                    Download PNG ZIP ({selectedBannerIds.size})
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-3">
                {filteredBanners.length > 0 && (
                  <button
                    type="button"
                    className="text-xs text-primary hover:underline"
                    onClick={() => {
                      if (allSelected) {
                        setSelectedBannerIds(prev => {
                          const s = new Set(prev);
                          filteredBanners.forEach(b => s.delete(b.id));
                          return s;
                        });
                      } else {
                        setSelectedBannerIds(prev => {
                          const s = new Set(prev);
                          filteredBanners.forEach(b => s.add(b.id));
                          return s;
                        });
                      }
                    }}
                  >
                    {allSelected ? 'Deselect all' : 'Select all'}
                  </button>
                )}
                <span className="text-xs text-muted-foreground tabular-nums">
                  {selectedBannerIds.size} of {generatedBanners.length} selected
                </span>
              </div>
            </div>
          </div>

          {/* Platform tabs */}
          {platforms.length > 2 && (
            <div className="flex items-center gap-1.5 flex-wrap mb-4">
              {platforms.map(p => {
                const count = p === 'all' ? generatedBanners.length : generatedBanners.filter(b => b.platform === p).length;
                const label = p === 'all' ? 'All' : (AD_PLATFORM_LABELS[p as keyof typeof AD_PLATFORM_LABELS] || p);
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setActivePlatform(p)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors border ${
                      activePlatform === p
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-card border-border/50 text-muted-foreground hover:text-foreground hover:border-border'
                    }`}
                  >
                    {label}
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${activePlatform === p ? 'bg-white/20' : 'bg-muted'}`}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Banner grid */}
          {filteredBanners.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pb-6">
              {filteredBanners.map(banner => {
                const scale = Math.min(PREVIEW_MAX_W / banner.width, PREVIEW_MAX_H / banner.height, 1);
                const previewW = Math.round(banner.width * scale);
                const previewH = Math.round(banner.height * scale);
                const isSelected = selectedBannerIds.has(banner.id);
                const scaleLabel = `${Math.round(scale * 100)}%`;
                const isSquare = banner.width === banner.height;
                const isPortrait = banner.height > banner.width;
                const bannerSrcDoc = (() => {
                  const raw = banner.html?.trim();
                  if (!raw) return undefined;
                  let baseHref = '';
                  try {
                    const u = new URL(banner.url);
                    baseHref = u.origin + u.pathname.replace(/\/[^/]*$/, '/');
                  } catch { /* no base */ }
                  const stripped = raw.replace(/<base\b[^>]*>/gi, '');
                  return baseHref
                    ? stripped.replace(/(<head\b[^>]*>)/i, `$1\n<base href="${baseHref}">`)
                    : stripped;
                })();

                return (
                  <div
                    key={banner.id}
                    onClick={() => toggleBanner(banner.id)}
                    className={`glass-card rounded-xl border overflow-hidden flex flex-col cursor-pointer transition-all duration-150 group ${
                      isSelected
                        ? 'border-primary/70 ring-2 ring-primary/25 shadow-lg shadow-primary/10'
                        : 'border-border/40 hover:border-primary/40 hover:shadow-md'
                    }`}
                  >
                    {/* Iframe preview area */}
                    <div
                      style={{
                        width: '100%',
                        minHeight: Math.max(previewH, 160),
                        background: isPortrait
                          ? 'linear-gradient(135deg,#0d0d1a 0%,#12102a 100%)'
                          : 'linear-gradient(135deg,#0a0a12 0%,#0f0d20 100%)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        position: 'relative',
                        flexShrink: 0,
                      }}
                      onClick={e => { e.stopPropagation(); setLightboxBanner(banner); }}
                    >
                      {/* Preview container */}
                      <div
                        style={{
                          width: previewW,
                          height: previewH,
                          overflow: 'hidden',
                          borderRadius: 6,
                          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                          flexShrink: 0,
                          background: '#fff',
                        }}
                      >
                        {banner.is_image_mode ? (
                          <img
                            src={banner.imageUrl || banner.url}
                            alt=""
                            style={{ width: previewW, height: previewH, objectFit: 'cover', display: 'block', pointerEvents: 'none' }}
                          />
                        ) : (
                          <iframe
                            {...(bannerSrcDoc ? { srcDoc: bannerSrcDoc } : { src: banner.url })}
                            title={banner.label}
                            style={{
                              width: banner.width,
                              height: banner.height,
                              transform: `scale(${scale.toFixed(4)})`,
                              transformOrigin: 'top left',
                              border: 'none',
                              display: 'block',
                              pointerEvents: 'none',
                            }}
                            scrolling="no"
                            sandbox="allow-same-origin allow-scripts"
                          />
                        )}
                      </div>
                      {/* Zoom overlay */}
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/25 cursor-zoom-in rounded-t-xl">
                        <div className="flex items-center gap-1.5 bg-black/70 text-white text-xs px-3 py-1.5 rounded-full backdrop-blur-sm shadow">
                          <ZoomIn className="h-3.5 w-3.5" /> Preview
                        </div>
                      </div>
                      {/* Scale badge */}
                      <div className="absolute bottom-2 right-2 bg-black/60 text-white/60 text-[10px] px-1.5 py-0.5 rounded-md backdrop-blur-sm tabular-nums">
                        {scaleLabel}
                      </div>
                      {/* Dimension badge */}
                      <div className="absolute bottom-2 left-2 bg-black/60 text-white/50 text-[10px] px-1.5 py-0.5 rounded-md backdrop-blur-sm tabular-nums">
                        {banner.width}×{banner.height}
                      </div>
                      {/* Selection checkmark */}
                      {isSelected && (
                        <div className="absolute top-2 left-2 h-5 w-5 rounded-full bg-primary flex items-center justify-center shadow ring-2 ring-white/20">
                          <Check className="h-3 w-3 text-primary-foreground" />
                        </div>
                      )}
                    </div>

                    {/* Card info */}
                    <div className="px-3 py-2.5 flex items-center justify-between gap-2 bg-card/60">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-sm text-foreground leading-tight truncate">{banner.label}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          <span className="rounded bg-primary/10 text-primary px-1.5 py-0.5 text-[10px] font-medium border border-primary/20">
                            {AD_PLATFORM_LABELS[banner.platform as keyof typeof AD_PLATFORM_LABELS] || banner.platform}
                          </span>
                          {isSquare && <span className="ml-1.5 text-muted-foreground/70">square</span>}
                          {isPortrait && <span className="ml-1.5 text-muted-foreground/70">portrait</span>}
                        </p>
                      </div>
                      {!banner.is_image_mode && (
                        <button
                          type="button"
                          title="Edit in editor"
                          className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary transition-colors shrink-0"
                          onClick={e => { e.stopPropagation(); window.open(`/ads-editor?creativeId=${banner.creative_id || banner.id}`, '_blank', 'noopener,noreferrer'); }}
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                          Edit
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            generatedHtml && (
              <div className="flex-1 min-h-[500px]">
                <div className="rounded-xl border border-border overflow-hidden bg-card shadow-lg">
                  <iframe
                    srcDoc={generatedHtml}
                    className="w-full border-0"
                    style={{ minHeight: '70vh' }}
                    title="AD Creative Board"
                    sandbox="allow-same-origin allow-scripts"
                  />
                </div>
              </div>
            )
          )}

          {/* Bottom actions */}
          <div className="mt-4 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center pb-4">
            <Button
              variant="outline"
              size="lg"
              onClick={() => setShowResults(false)}
              className="gap-2 border-border/70 bg-background/70 px-6"
            >
              <ArrowLeft className="h-4 w-4" /> Back to form
            </Button>
            <Button
              size="lg"
              onClick={resetAndNew}
              className="gap-2 px-8 font-semibold shadow-lg shadow-primary/20"
            >
              <Zap className="h-4 w-4" /> Generate new campaign
            </Button>
          </div>
        </main>

        {/* Lightbox */}
        {lightboxBanner && (
          <BannerLightbox
            banner={lightboxBanner}
            banners={filteredBanners}
            onClose={() => setLightboxBanner(null)}
            onNavigate={setLightboxBanner}
            onEdit={b => { if (!b.is_image_mode) window.open(`/ads-editor?creativeId=${b.creative_id || b.id}`, '_blank', 'noopener,noreferrer'); }}
          />
        )}
      </div>
    );
  }

  // Form view — mirrors LP form view layout exactly
  return (
    <div className="ad-creatives-theme premium-home min-h-screen bg-background relative overflow-hidden">
      <PremiumParticleBackground activeTone="accent" />
      <AdHeader onLogoClick={() => navigate('/')} onSignOut={signOut} />
      <main className="mx-auto max-w-4xl px-6 py-8 relative z-10">
        <div className="mb-10 text-center">
          <h2 className="font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Generate Your AD Creatives
          </h2>
          <p className="mt-3 text-muted-foreground max-w-xl mx-auto">
            Fill in your brand details and we'll generate professional,
            conversion-focused ad banners for your selected platforms.
          </p>
        </div>

        <StepIndicator
          steps={STEPS}
          currentStep={currentStep}
          maxVisitedStep={maxVisitedStep}
          onStepClick={setCurrentStep}
        />

        <div className="mt-8 glass-card rounded-xl p-6 sm:p-8 animate-in-up" key={currentStepId}>
          {currentStepId === 'import' && (
            <StepAdImport
              data={formData}
              onChange={updateForm}
              brandBookFile={brandBookFile}
              onBrandBookFile={setBrandBookFile}
            />
          )}
          {currentStepId === 'objective' && (
            <StepAdObjective data={formData} onChange={updateForm} />
          )}
          {currentStepId === 'platform' && (
            <StepAdPlatform data={formData} onChange={updateForm} />
          )}
          {currentStepId === 'brand' && (
            <StepAdBrand data={formData} onChange={updateForm} />
          )}
          {currentStepId === 'copy' && (
            <StepAdCopy data={formData} onChange={updateForm} />
          )}
          {currentStepId === 'strategy' && (
            <StepAdStrategy data={formData} onChange={updateForm} />
          )}
          {currentStepId === 'formats' && (
            <StepAdFormats data={formData} onChange={updateForm} />
          )}
          {currentStepId === 'ai_copy' && (
            <StepAdCopyAI
              data={formData}
              onChange={updateForm}
              companyProjectId={routeState?.companyProjectId}
              userId={user?.id}
            />
          )}
          {currentStepId === 'images' && (
            <StepAdImages
              data={formData}
              onChange={updateForm}
              onUploadAssets={handleUploadAssets}
              onRemoveAsset={handleRemoveAsset}
              onGenerateImage={handleGenerateAdImage}
              onSearchPexelsImage={handleSearchPexelsAdImage}
              companyProjectId={routeState?.companyProjectId}
              userId={user?.id}
            />
          )}
          {currentStepId === 'review' && (
            <>
              <StepAdReview data={formData} />
              {/* Output format toggle */}
              <div className="mt-5 rounded-xl border border-border bg-card/40 p-4 space-y-3">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2.5">
                    <Image className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div>
                      <p className="text-sm font-medium leading-none">Output format</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {generateAsImage
                          ? 'Image — Gemini generates PNG images (not editable)'
                          : 'HTML — editable banners in the visual editor'}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setGenerateAsImage(v => !v)}
                    className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none cursor-pointer ${
                      generateAsImage ? 'bg-primary' : 'bg-muted-foreground/30'
                    }`}
                    aria-label="Toggle image generation mode"
                  >
                    <span className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transform transition-transform ${generateAsImage ? 'translate-x-5' : 'translate-x-0'}`} />
                  </button>
                </div>
                {generateAsImage && (
                  <div className="rounded-md bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-xs text-amber-700 dark:text-amber-400 font-medium">
                    ⚠ IMAGE MODE: The generated ads cannot be edited or customized after generation. Switch to HTML mode to get editable banners.
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="mt-6 flex justify-between">
          <div className="flex gap-2">
            <Button variant="ghost" onClick={handleBack} className="gap-2">
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
            <Button
              variant="ghost"
              onClick={handleClear}
              className="gap-2 text-destructive hover:text-destructive"
            >
              <RotateCcw className="h-4 w-4" /> Clear
            </Button>
          </div>

          {currentStep < STEPS.length - 1 ? (
            <Button onClick={handleNext} className="gap-2">
              Next <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              variant="gradient"
              size="lg"
              onClick={handleGenerate}
              className="gap-2"
            >
              <Zap className="h-4 w-4" /> Generate AD Creatives
            </Button>
          )}
        </div>
      </main>
    </div>
  );
}
