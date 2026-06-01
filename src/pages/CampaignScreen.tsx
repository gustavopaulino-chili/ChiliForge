import { useState, useEffect, useRef, useCallback, type CSSProperties } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft, Sparkles, Download, Star, Send, Loader2, Check,
  ZoomIn, Edit3, MessageSquare, LayoutGrid, FileText, Megaphone, Trash2, ImageIcon, Upload, RotateCcw, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PremiumParticleBackground } from '@/components/landing/PremiumParticleBackground';
import { useAuth } from '@/contexts/AuthContext';
import {
  getCampaign, getAdCreatives, campaignChat, markGoodExamples, removeCampaignExample,
  getCreativesHtml, sendCreativeHtmlToGlobalStore, getProjectAssets, uploadProjectAssets, deleteProjectAssetFile,
  prepareAdsFromCampaignPayload, renderAdsBatchViaAgent, interpretBatchesViaAgent,
  createGenerationJob, updateGenerationJob, getGenerationJob, composeAdBatchViaAgent,
  updateAdCreativeContent, buildCopyLockBlock,
  CampaignData, ChatMessage, CampaignChatResponse, CampaignExampleCreative,
  type ProjectAsset, type GenerationJob, type GenerationJobBatch, type ComposeAdResult,
} from '@/services/api';
import { AD_PLATFORM_LABELS } from '@/types/adCreativeForm';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';

const PREVIEW_MAX_W = 320;
const PREVIEW_MAX_H = 400;

type GeneratedBanner = {
  id: number;
  creative_id?: number;
  url: string;
  platform: string;
  format: string;
  label: string;
  width: number;
  height: number;
  html?: string;
  imageUrl?: string;
  is_image_mode?: boolean;
};

type AdFormatForBatch = {
  platform: string;
  format: string;
  label: string;
  width: number;
  height: number;
  enabled?: boolean;
};

type GenerationBatchState = {
  id: string;
  label: string;
  formats: AdFormatForBatch[];
  status: 'queued' | 'running' | 'saved' | 'failed' | 'cancelled';
  savedCount?: number;
  error?: string;
};

type CampaignGenerationJob = {
  edgePayload: Record<string, unknown> & { accountType?: 'admin' | 'user'; campaignData?: Record<string, unknown> };
  creativePlan: string;
  batchSpecs: Array<{ label: string; spec: string }>;
  formData: Record<string, unknown>;
  projectId: number;
  slugBase: string;
  batches: GenerationBatchState[];
  jobId?: number;
};

function getEnabledFormatsFromData(formData: Record<string, unknown>): AdFormatForBatch[] {
  const selected = Array.isArray(formData.selectedFormats) ? formData.selectedFormats : [];
  return selected
    .filter((format: any) => format && format.enabled !== false && format.width && format.height)
    .map((format: any) => ({
      platform: String(format.platform || 'banner'),
      format: String(format.format || 'ad'),
      label: String(format.label || `${format.width}x${format.height}`),
      width: Number(format.width || 1080),
      height: Number(format.height || 1080),
      enabled: true,
    }));
}

function createFormatBatches(formData: Record<string, unknown>): GenerationBatchState[] {
  return getEnabledFormatsFromData(formData).map((format, index) => ({
    id: `${format.platform}-${format.format}-${format.width}x${format.height}-${index}`,
    label: `${format.label || format.format} (${format.width}x${format.height})`,
    formats: [format],
    status: 'queued',
  }));
}

function formatDate(iso: string) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function normalizeColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const color = value.trim();
  if (!color) return undefined;
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(color)) return color;
  if (/^(rgb|rgba|hsl|hsla)\(/i.test(color)) return color;
  return undefined;
}

function hexToHsl(hex: string | undefined): string | null {
  const clean = (hex || '').trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return null;
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

function colorWithAlpha(color: string | undefined, alpha: number, fallback: string) {
  if (!color) return fallback;
  const hex = color.trim();
  if (/^#[0-9a-f]{3}$/i.test(hex)) {
    const r = parseInt(hex[1] + hex[1], 16);
    const g = parseInt(hex[2] + hex[2], 16);
    const b = parseInt(hex[3] + hex[3], 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  if (/^#[0-9a-f]{6}$/i.test(hex)) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return fallback;
}

function escapeHtmlAttribute(value: string): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function isImageModeBanner(html: string | undefined, is_image_mode?: boolean): boolean {
  if (is_image_mode) return true;
  if (!html) return false;
  const source = html.trim();
  return /src=["']data:image\//.test(source)
    || /<img[^>]+src=["'][^"']+\.(png|jpe?g|webp|gif)(\?[^"']*)?["']/i.test(source)
    || /^data:image\//i.test(source)
    || /^(https?:\/\/|\/).+\.(png|jpe?g|webp|gif)(\?.*)?$/i.test(source);
}

function resolveImageBannerSource(banner: GeneratedBanner): string {
  const candidates = [banner.imageUrl, banner.html, banner.url]
    .map(value => String(value || '').trim())
    .filter(Boolean);

  for (const value of candidates) {
    if (/^data:image\//i.test(value)) return value;
    const srcMatch = value.match(/src=["'](data:image\/[^"']+|[^"']+\.(?:png|jpe?g|webp|gif)(?:\?[^"']*)?)["']/i);
    if (srcMatch) return srcMatch[1];
    if (/^(https?:\/\/|\/).+/i.test(value) && !/<[a-z][\s\S]*>/i.test(value)) return value;
  }

  return '';
}

function isImageBanner(banner: GeneratedBanner): boolean {
  return isImageModeBanner(banner.html, banner.is_image_mode)
    || isImageModeBanner(banner.imageUrl, false)
    || isImageModeBanner(banner.url, false);
}

function extractImageDataFromHtml(raw: string): { base64: string; mimeType: string } | null {
  const trimmed = raw.trim();
  // Raw data URL stored directly (no HTML wrapper)
  const rawMatch = trimmed.match(/^data:(image\/[^;]+);base64,([\s\S]{20,})$/);
  if (rawMatch) return { mimeType: rawMatch[1], base64: rawMatch[2].trim() };
  // Embedded inside HTML: <img src="data:image/...">
  const htmlMatch = trimmed.match(/src=["'](data:(image\/[^;]+);base64,([^"']{20,}))["']/);
  if (htmlMatch) return { mimeType: htmlMatch[2], base64: htmlMatch[3] };
  return null;
}

function fileToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result || ''));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function campaignPalette(formData: Record<string, unknown>) {
  const fd = formData as Record<string, any>;
  const theme = typeof fd.theme === 'object' && fd.theme ? fd.theme as Record<string, unknown> : {};
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const direct = normalizeColor(fd[key]);
      if (direct) return direct;
      const themed = normalizeColor(theme[key]);
      if (themed) return themed;
    }
    return undefined;
  };

  return {
    primary: pick('primaryColor', 'primary') || 'hsl(var(--primary))',
    secondary: pick('secondaryColor', 'secondary') || 'hsl(var(--secondary))',
    accent: pick('accentColor', 'accent') || pick('primaryColor', 'primary') || 'hsl(var(--primary))',
    background: pick('backgroundColor', 'background') || 'hsl(var(--background))',
  };
}

function FormDataDisplay({ formData }: { formData: Record<string, unknown> }) {
  const fields: Array<{ label: string; key: string }> = [
    { label: 'Campaign name', key: 'campaignName' },
    { label: 'Objective', key: 'campaignObjective' },
    { label: 'Funnel', key: 'funnelStage' },
    { label: 'Offer', key: 'offer' },
    { label: 'Pricing', key: 'pricing' },
    { label: 'Discount', key: 'discount' },
    { label: 'Guarantee', key: 'guarantee' },
    { label: 'Audience', key: 'targetAudience' },
    { label: 'Age range', key: 'ageRange' },
    { label: 'Pain points', key: 'painPoints' },
    { label: 'Tone of voice', key: 'toneOfVoice' },
    { label: 'Creative strategy', key: 'creativeStrategy' },
    { label: 'Urgency', key: 'urgencyLevel' },
    { label: 'Visual style', key: 'preferredStyle' },
    { label: 'Logo strategy', key: 'preferredLogoStrategy' },
  ];

  const visible = fields.filter(f => {
    const v = formData[f.key];
    return v && String(v).trim();
  });

  if (!visible.length) return (
    <p className="text-sm text-muted-foreground text-center py-8">Form data is not available.</p>
  );

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {visible.map(f => (
        <div key={f.key} className="rounded-lg border border-border/40 bg-card/40 px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">{f.label}</p>
          <p className="text-sm text-foreground capitalize">{String(formData[f.key])}</p>
        </div>
      ))}
    </div>
  );
}

function ExampleCard({
  example,
  removing,
  onRemove,
}: {
  example: CampaignExampleCreative;
  removing: boolean;
  onRemove: (example: CampaignExampleCreative) => void;
}) {
  const width = example.width || 1080;
  const height = example.height || 1080;
  const scale = Math.min(220 / width, 180 / height, 1);
  const previewW = Math.round(width * scale);
  const previewH = Math.round(height * scale);
  const exampleUrl = example.url || example.public_url || '';
  const exampleImageUrl = example.image_url || '';
  const isImageExample = Boolean(exampleImageUrl) || isImageModeBanner(exampleUrl, false);
  const examplePreviewUrl = isImageExample ? (exampleImageUrl || exampleUrl) : exampleUrl;

  return (
    <div className="rounded-xl border border-border/50 bg-card/50 overflow-hidden">
      <div className="h-48 bg-black/80 flex items-center justify-center relative">
        {examplePreviewUrl ? (
          <div
            style={{
              width: previewW,
              height: previewH,
              overflow: 'hidden',
              borderRadius: 6,
              background: '#fff',
              boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
            }}
          >
            {isImageExample ? (
              <img
                src={examplePreviewUrl}
                alt=""
                style={{ width: previewW, height: previewH, objectFit: 'cover', display: 'block', pointerEvents: 'none' }}
              />
            ) : (
              <iframe
                src={examplePreviewUrl}
                title={example.label || example.name}
                style={{
                  width,
                  height,
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
        ) : (
          <Star className="h-8 w-8 text-white/40" />
        )}
        <div className="absolute top-2 right-2 rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary-foreground">
          Example
        </div>
      </div>
      <div className="p-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold truncate">{example.label || example.name}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {AD_PLATFORM_LABELS[example.platform as keyof typeof AD_PLATFORM_LABELS] || example.platform || 'Ad'} · {width}x{height}
          </p>
          <p className="text-[10px] text-muted-foreground/70 mt-0.5">Added {formatDate(example.created_at)}</p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="shrink-0 text-destructive hover:text-destructive"
          onClick={() => onRemove(example)}
          disabled={removing}
          title="Remove example"
        >
          {removing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </div>
  );
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
      const format = el.getAttribute('data-format') || '';
      const matched = formats.find(f => f.platform === platform && f.format === format)
        || formats[i]
        || { platform: 'banner', format: 'ad', label: `Banner ${i + 1}`, width: 1080, height: 1080 };
      const occurrenceKey = `${matched.platform}-${matched.format}`;
      const occurrence = seenByFormat.get(occurrenceKey) || 0;
      seenByFormat.set(occurrenceKey, occurrence + 1);
      const variant = el.getAttribute('data-variant')
        || ((totalsByFormat.get(occurrenceKey) || 0) > 1 ? ['A', 'B', 'C'][occurrence] : '');
      const label = variant ? `${matched.label} - Variant ${variant}` : matched.label;
      const w = matched.width;
      const h = matched.height;
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

function ImageBannerPreview({ banner, width, height }: { banner: GeneratedBanner; width: number; height: number }) {
  const [src, setSrc] = useState<string | null>(() => resolveImageBannerSource(banner) || null);

  useEffect(() => {
    const directSource = resolveImageBannerSource(banner);
    if (directSource) {
      setSrc(directSource);
      return;
    }
    if (src || !banner.url) return;
    // Direct image file URL — use as-is without fetching content
    if (/\.(png|jpe?g|webp)(\?|$)/i.test(banner.url)) {
      setSrc(banner.url);
      return;
    }
    fetch(banner.url)
      .then(r => r.text())
      .then(text => {
        const trimmed = text.trim();
        if (trimmed.startsWith('data:image/')) { setSrc(trimmed); return; }
        const m = trimmed.match(/src=["'](data:image\/[^"']+)["']/);
        if (m) setSrc(m[1]);
      })
      .catch(() => {});
  }, [banner, src]);

  if (!src) return (
    <div style={{ width, height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Loader2 className="h-5 w-5 animate-spin text-white/30" />
    </div>
  );

  return (
    <img
      src={src}
      alt=""
      style={{ width, height, objectFit: 'cover', display: 'block', pointerEvents: 'none' }}
    />
  );
}

function BannerGrid({
  banners,
  selectedIds,
  newIds,
  onToggle,
  onSeen,
}: {
  banners: GeneratedBanner[];
  selectedIds: Set<number>;
  newIds: Set<number>;
  onToggle: (id: number) => void;
  onSeen: (id: number) => void;
}) {
  const [lightbox, setLightbox] = useState<GeneratedBanner | null>(null);

  if (!banners.length) return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <LayoutGrid className="h-10 w-10 text-muted-foreground/30 mb-3" />
      <p className="text-sm text-muted-foreground">No creatives generated yet.</p>
      <p className="text-xs text-muted-foreground/60 mt-1">Click "Generate More" or use the chat.</p>
    </div>
  );

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pb-6">
        {banners.map(banner => {
          const scale = Math.min(PREVIEW_MAX_W / banner.width, PREVIEW_MAX_H / banner.height, 1);
          const previewW = Math.round(banner.width * scale);
          const previewH = Math.round(banner.height * scale);
          const isSelected = selectedIds.has(banner.id);
          const isPortrait = banner.height > banner.width;
          const isNew = newIds.has(banner.id);

          return (
            <div
              key={banner.id}
              onClick={() => {
                onSeen(banner.id);
                onToggle(banner.id);
              }}
              className={`glass-card rounded-xl border overflow-hidden flex flex-col cursor-pointer transition-all duration-150 group ${
                isSelected
                  ? 'border-primary/70 ring-2 ring-primary/25 shadow-lg shadow-primary/10'
                  : 'border-border/40 hover:border-primary/40 hover:shadow-md'
              }`}
            >
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
                onClick={e => {
                  e.stopPropagation();
                  onSeen(banner.id);
                  setLightbox(banner);
                }}
              >
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
                  {isImageBanner(banner) ? (
                    <ImageBannerPreview banner={banner} width={previewW} height={previewH} />
                  ) : (
                    <iframe
                      src={banner.url}
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
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/25 cursor-zoom-in rounded-t-xl">
                  <div className="flex items-center gap-1.5 bg-black/70 text-white text-xs px-3 py-1.5 rounded-full backdrop-blur-sm shadow">
                    <ZoomIn className="h-3.5 w-3.5" /> Preview
                  </div>
                </div>
                <div className="absolute bottom-2 right-2 bg-black/60 text-white/60 text-[10px] px-1.5 py-0.5 rounded-md backdrop-blur-sm tabular-nums">
                  {Math.round(scale * 100)}%
                </div>
                <div className="absolute bottom-2 left-2 bg-black/60 text-white/50 text-[10px] px-1.5 py-0.5 rounded-md backdrop-blur-sm tabular-nums">
                  {banner.width}×{banner.height}
                </div>
                {isSelected && (
                  <div className="absolute top-2 left-2 h-5 w-5 rounded-full bg-primary flex items-center justify-center shadow ring-2 ring-white/20">
                    <Check className="h-3 w-3 text-primary-foreground" />
                  </div>
                )}
                {isNew && (
                  <div className="absolute top-2 right-2 rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white shadow ring-1 ring-white/20">
                    New
                  </div>
                )}
              </div>
              <div className="px-3 py-2.5 flex items-center justify-between gap-2 bg-card/60">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-sm text-foreground leading-tight truncate">{banner.label}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    <span className="rounded bg-primary/10 text-primary px-1.5 py-0.5 text-[10px] font-medium border border-primary/20">
                      {AD_PLATFORM_LABELS[banner.platform as keyof typeof AD_PLATFORM_LABELS] || banner.platform}
                    </span>
                  </p>
                </div>
                {!isImageBanner(banner) && (
                  <button
                    type="button"
                    title="Edit in editor"
                    className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary transition-colors shrink-0"
                    onClick={e => {
                      e.stopPropagation();
                      onSeen(banner.id);
                      window.open(`/ads-editor?creativeId=${banner.creative_id || banner.id}`, '_blank', 'noopener,noreferrer');
                    }}
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

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <div className="relative max-w-full max-h-full overflow-auto" onClick={e => e.stopPropagation()}>
            {isImageBanner(lightbox) ? (
              <ImageBannerPreview
                banner={lightbox}
                width={Math.min(lightbox.width, window.innerWidth * 0.9)}
                height={Math.min(lightbox.height, window.innerHeight * 0.85)}
              />
            ) : (
              <iframe
                src={lightbox.url}
                title={lightbox.label}
                style={{ width: lightbox.width, height: lightbox.height, border: 'none', display: 'block', maxWidth: '90vw', maxHeight: '85vh' }}
                scrolling="no"
                sandbox="allow-same-origin allow-scripts"
              />
            )}
            <button
              className="absolute top-2 right-2 bg-black/70 text-white rounded-full h-7 w-7 flex items-center justify-center hover:bg-black transition-colors"
              onClick={() => setLightbox(null)}
            >×</button>
          </div>
        </div>
      )}
    </>
  );
}

function AssetCard({
  asset,
  deleting,
  onDelete,
}: {
  asset: ProjectAsset;
  deleting: boolean;
  onDelete: (asset: ProjectAsset) => void;
}) {
  return (
    <div className="group relative overflow-hidden rounded-xl border border-border/50 bg-card/50">
      <div className="aspect-square bg-muted/40">
        <img
          src={asset.url}
          alt={asset.name}
          className="h-full w-full object-cover"
          loading="lazy"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = '0.25'; }}
        />
      </div>
      <div className="p-2.5">
        <p className="truncate text-xs font-medium text-foreground" title={asset.name}>{asset.name}</p>
      </div>
      <button
        type="button"
        className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-white opacity-0 shadow transition-opacity hover:bg-destructive group-hover:opacity-100 disabled:opacity-70"
        onClick={() => onDelete(asset)}
        disabled={deleting}
        title="Delete image"
      >
        {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

export default function CampaignScreen() {
  const { companyId, campaignId } = useParams<{ companyId: string; campaignId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [campaign, setCampaign] = useState<CampaignData | null>(null);
  const [loading, setLoading] = useState(true);
  const [banners, setBanners] = useState<GeneratedBanner[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [newBannerIds, setNewBannerIds] = useState<Set<number>>(new Set());
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [generationStatus, setGenerationStatus] = useState('');
  const [generationBatches, setGenerationBatches] = useState<GenerationBatchState[]>([]);
  const [generationPaused, setGenerationPaused] = useState(false);
  const [generateAsImage, setGenerateAsImage] = useState(false);
  const [resumableJob, setResumableJob] = useState<{ job: GenerationJob; batches: GenerationJobBatch[] } | null>(null);
  const [isMarkingExample, setIsMarkingExample] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isSendingToStore, setIsSendingToStore] = useState(false);
  const [removingExampleId, setRemovingExampleId] = useState<number | null>(null);
  const [activePlatform, setActivePlatform] = useState('all');
  const [assets, setAssets] = useState<ProjectAsset[]>([]);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [uploadingAssets, setUploadingAssets] = useState(false);
  const [deletingAssetName, setDeletingAssetName] = useState<string | null>(null);
  const assetFileRef = useRef<HTMLInputElement>(null);
  const generationCancelRef = useRef(false);
  const generationJobRef = useRef<CampaignGenerationJob | null>(null);

  // Chat
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  const loadAssets = useCallback(async (companyProjectId?: number | null) => {
    const resolvedCompanyProjectId = Number(companyProjectId || companyId || 0);
    if (!user?.id || !resolvedCompanyProjectId) return;
    setLoadingAssets(true);
    try {
      const result = await getProjectAssets(resolvedCompanyProjectId, user.id);
      setAssets(Array.isArray(result.assets) ? result.assets : []);
    } catch {
      setAssets([]);
    } finally {
      setLoadingAssets(false);
    }
  }, [companyId, user?.id]);

  useEffect(() => {
    const scroller = chatScrollRef.current;
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }, [chatHistory, isChatLoading]);

  useEffect(() => {
    if (!user?.id || !campaignId) return;
    setLoading(true);
    getCampaign(Number(campaignId), user.id)
      .then(data => {
        setCampaign(data);
        loadAssets(data.company_project_id);
        // Load existing creatives via getAdCreatives if project_id exists
        if (data.project_id) {
          getAdCreatives(data.project_id, user.id).then((creatives: any[]) => {
            if (Array.isArray(creatives) && creatives.length) {
              setBanners(creatives.map((c: any) => {
                const url = c.public_url || c.url || '';
                const source = c.image_url || c.generated_html || url;
                const isImage = Boolean(c.is_image_mode) || isImageModeBanner(source, false);
                return {
                  id: c.id,
                  creative_id: c.creative_id || c.id,
                  url,
                  platform: c.platform || 'banner',
                  format: c.format || 'ad',
                  label: c.label || c.name || `Creative ${c.id}`,
                  width: c.width || 1080,
                  height: c.height || 1080,
                  is_image_mode: isImage,
                  html: isImage ? (c.generated_html || '') : undefined,
                  imageUrl: isImage ? (source || undefined) : undefined,
                };
              }));
            }
          }).catch(() => {});
        }
      })
      .catch(err => toast.error(err.message || 'Failed to load campaign'))
      .finally(() => setLoading(false));
  }, [user?.id, campaignId, loadAssets]);

  // Check for a resumable in-progress job whenever the campaign loads
  useEffect(() => {
    if (!user?.id || !campaignId || isGenerating) return;
    getGenerationJob({ user_id: user.id, campaign_id: Number(campaignId) })
      .then(({ job, batches }) => {
        if (job && (job.status === 'running' || job.status === 'queued')) {
          const hasUnfinished = batches.some(b => b.status === 'queued' || b.status === 'failed');
          if (hasUnfinished) setResumableJob({ job, batches });
        }
      })
      .catch(() => {});
  }, [user?.id, campaignId, isGenerating]);

  const toggleBanner = useCallback((id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const markBannerSeen = useCallback((id: number) => {
    setNewBannerIds(prev => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const updateGenerationBatch = useCallback((index: number, patch: Partial<GenerationBatchState>) => {
    setGenerationBatches(prev => prev.map((batch, i) => i === index ? { ...batch, ...patch } : batch));
  }, []);

  const publishGeneratedBatch = useCallback(async (
    job: CampaignGenerationJob,
    result: any,
    batchIndex: number,
  ) => {
    if (!user?.id || !campaign) throw new Error('Campaign is not available.');
    if (!result.html?.trim()) throw new Error('AI did not return HTML.');

    const rawHtml = result.html.trim();
    const finalHtml = /<!DOCTYPE|<html/i.test(rawHtml)
      ? rawHtml
      : `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AD Creatives - ${campaign.name}</title><style>${result.css || ''}</style></head><body>${rawHtml}<script>${result.js || ''}<\/script></body></html>`;
    const bannerPayload = extractBanners(finalHtml, Array.isArray(result.formats) ? result.formats : job.batches[batchIndex].formats);
    if (!bannerPayload.length) throw new Error('No banner was found in this batch.');

    const publishResponse = await fetch('/api/publishAdCreative.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: job.projectId,
        user_id: user.id,
        name: campaign.name,
        slug: `ad-${job.slugBase || 'campaign'}-${Date.now()}`,
        form_data: job.formData,
        html: finalHtml,
        current_step: 8,
        banners: bannerPayload,
        append_banners: true,
      }),
    });

    const saved = await publishResponse.json();
    if (!saved?.success) {
      const message = [saved?.error, saved?.details].filter(Boolean).join(' - ');
      throw new Error(message || 'Failed to save creatives.');
    }

    const newBanners: GeneratedBanner[] = Array.isArray(saved.banners)
      ? saved.banners.map((banner: GeneratedBanner, index: number) => ({
          ...banner,
          html: bannerPayload[index]?.html || banner.html || '',
        }))
      : [];

    setBanners(prev => [...newBanners, ...prev]);
    setNewBannerIds(prev => {
      const next = new Set(prev);
      newBanners.forEach((banner) => next.add(banner.id));
      return next;
    });

    return newBanners.length;
  }, [campaign, user?.id]);

  const publishGeneratedComposeBanners = useCallback(async (
    composeBanners: ComposeAdResult[],
    formData: Record<string, unknown>,
  ) => {
    if (!user?.id || !campaign) throw new Error('Campaign is not available.');
    if (!composeBanners.length) throw new Error('AI did not return any compose banners.');

    const bannerPayload = composeBanners.map((b, index) => ({
      platform: b.platform || 'banner',
      format: b.format || 'ad',
      label: b.label || `Compose Ad ${index + 1}`,
      width: Number(b.width || 1080),
      height: Number(b.height || 1080),
      html: b.html || '',
      is_image_mode: false,
    }));

    const slugBase = (campaign.name || 'campaign')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const publishResponse = await fetch('/api/publishAdCreative.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: campaign.project_id,
        user_id: user.id,
        name: campaign.name,
        slug: `ad-${slugBase || 'campaign'}-${Date.now()}`,
        form_data: { ...formData, generate_as_image: true },
        html: '',
        current_step: 8,
        banners: bannerPayload,
        append_banners: true,
      }),
    });

    const saved = await publishResponse.json();
    if (!saved?.success) {
      const message = [saved?.error, saved?.details].filter(Boolean).join(' - ');
      throw new Error(message || 'Failed to save compose creatives.');
    }

    const newBanners: GeneratedBanner[] = Array.isArray(saved.banners)
      ? saved.banners.map((banner: GeneratedBanner, index: number) => ({
          ...banner,
          html: bannerPayload[index]?.html || banner.html || '',
          is_image_mode: false,
        }))
      : [];

    setBanners(prev => [...newBanners, ...prev]);
    setNewBannerIds(prev => {
      const next = new Set(prev);
      newBanners.forEach((banner) => next.add(banner.id));
      return next;
    });

    return newBanners.length;
  }, [campaign, user?.id]);

  const runCampaignGenerationJob = useCallback(async (job: CampaignGenerationJob, onlyBatchIndex?: number) => {
    const indexes = typeof onlyBatchIndex === 'number'
      ? [onlyBatchIndex]
      : job.batches.map((_, index) => index).filter(index => job.batches[index].status !== 'saved');

    setIsGenerating(true);
    setGenerationPaused(false);

    for (const batchIndex of indexes) {
      if (generationCancelRef.current) {
        updateGenerationBatch(batchIndex, { status: 'cancelled' });
        setGenerationStatus('Generation cancelled.');
        setGenerationPaused(true);
        setIsGenerating(false);
        return;
      }

      const batch = job.batches[batchIndex];
      updateGenerationBatch(batchIndex, { status: 'running', error: undefined });
      setGenerationStatus(`Generating ${batch.label}...`);

      try {
        const baseSpec = job.batchSpecs.find((s) => s.label === batch.label)?.spec
          || job.batchSpecs[batchIndex]?.spec
          || "";
        const copyLock = buildCopyLockBlock((job.edgePayload.campaignData || {}) as Record<string, unknown>);
        const spec = copyLock ? `${baseSpec}\n\n${copyLock}` : baseSpec;
        const result = await renderAdsBatchViaAgent(
          job.edgePayload,
          batch.formats,
          spec,
          batchIndex,
          job.batches.length,
          "render",
        );
        const savedCount = await publishGeneratedBatch(job, result, batchIndex);
        job.batches[batchIndex] = { ...job.batches[batchIndex], status: 'saved', savedCount };
        updateGenerationBatch(batchIndex, { status: 'saved', savedCount });

        if (job.jobId && user?.id) {
          void updateGenerationJob({ job_id: job.jobId, user_id: user.id, action: 'save_batch', batch_index: batchIndex, saved_count: savedCount }).catch(() => {});
        }

        const savedTotal = job.batches.filter(item => item.status === 'saved').length;
        setGenerationProgress(Math.round(20 + (savedTotal / job.batches.length) * 80));
      } catch (err: any) {
        const message = err?.message || 'Batch failed.';
        job.batches[batchIndex] = { ...job.batches[batchIndex], status: 'failed', error: message };
        updateGenerationBatch(batchIndex, { status: 'failed', error: message });
        setGenerationStatus(`Batch failed: ${batch.label}`);
        setGenerationPaused(true);
        toast.error(message);

        if (job.jobId && user?.id) {
          void updateGenerationJob({ job_id: job.jobId, user_id: user.id, action: 'fail_batch', batch_index: batchIndex, error: message }).catch(() => {});
        }
        return;
      }
    }

    const failed = job.batches.filter(item => item.status === 'failed').length;
    const saved = job.batches.filter(item => item.status === 'saved').length;
    if (failed === 0 && saved === job.batches.length) {
      setGenerationProgress(100);
      setGenerationStatus('All batches saved.');
      setIsGenerating(false);
      setGenerationPaused(false);
      setResumableJob(null);
      if (job.jobId && user?.id) {
        void updateGenerationJob({ job_id: job.jobId, user_id: user.id, action: 'complete' }).catch(() => {});
      }
      const freshCampaign = user?.id ? await getCampaign(campaign!.id, user.id).catch(() => null) : null;
      if (freshCampaign) setCampaign(freshCampaign);
      toast.success(`${saved} batch${saved > 1 ? 'es' : ''} generated and saved.`);
    }
  }, [campaign, publishGeneratedBatch, updateGenerationBatch, user?.id]);

  const handleRetryBatch = useCallback(async (batchIndex: number) => {
    const job = generationJobRef.current;
    if (!job) return;
    generationCancelRef.current = false;
    job.batches[batchIndex] = { ...job.batches[batchIndex], status: 'queued', error: undefined };
    updateGenerationBatch(batchIndex, { status: 'queued', error: undefined });
    if (job.jobId && user?.id) {
      void updateGenerationJob({ job_id: job.jobId, user_id: user.id, action: 'retry_batch', batch_index: batchIndex }).catch(() => {});
    }
    await runCampaignGenerationJob(job);
  }, [runCampaignGenerationJob, updateGenerationBatch, user?.id]);

  const handleCancelGeneration = useCallback(() => {
    generationCancelRef.current = true;
    setGenerationStatus('Cancelling after the current batch...');
    const job = generationJobRef.current;
    if (job?.jobId && user?.id) {
      void updateGenerationJob({ job_id: job.jobId, user_id: user.id, action: 'cancel' }).catch(() => {});
    }
  }, [user?.id]);

  const handleGenerate = useCallback(async (formOverrides?: Record<string, unknown>) => {
    if (!user?.id || !campaign) return;
    setIsGenerating(true);
    setGenerationPaused(false);
    setGenerationProgress(3);
    setGenerationStatus('Preparing campaign generation...');
    generationCancelRef.current = false;
    generationJobRef.current = null;

    try {
      const resolvedCompanyProjectId = campaign.company_project_id || Number(companyId) || 0;
      const nextFormData = {
        ...campaign.form_data,
        ...(formOverrides || {}),
      };
      const batches = createFormatBatches(nextFormData);
      if (!batches.length) throw new Error('No enabled ad formats found.');
      setGenerationBatches(batches);

      if (generateAsImage) {
        // Generate one batch per edge function call to stay within the 150s Supabase limit.
        const allComposeBanners: ComposeAdResult[] = [];

        // ── Step 1: Prepare (0 → 10%) ──────────────────────────────────────
        setGenerationProgress(5);
        setGenerationStatus('Loading brand guidelines...');
        const prepared = await prepareAdsFromCampaignPayload({
          user_id: user.id,
          company_project_id: resolvedCompanyProjectId,
          campaign_id: campaign.id,
        });
        setGenerationProgress(10);

        // ── Step 2: Per-format compose generation (10 → 85%) ───────────────
        for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
          if (generationCancelRef.current) {
            updateGenerationBatch(batchIndex, { status: 'cancelled' });
            setGenerationStatus('Generation cancelled.');
            setGenerationPaused(true);
            setIsGenerating(false);
            return;
          }

          const batch = batches[batchIndex];
          updateGenerationBatch(batchIndex, { status: 'running' });
          setGenerationStatus(`Generating background + composing ${batch.label}...`);
          setGenerationProgress(10 + Math.round((batchIndex / batches.length) * 75));

          try {
            const result = await composeAdBatchViaAgent(
              prepared.edgePayload,
              batch.formats,
              "",
            );
            const batchBanners = (result.banners || []).filter(b => b.html);
            allComposeBanners.push(...batchBanners);
            updateGenerationBatch(batchIndex, { status: 'saved', savedCount: batchBanners.length });
            setGenerationProgress(10 + Math.round(((batchIndex + 1) / batches.length) * 75));
          } catch (err: any) {
            const message = err?.message || 'Compose generation failed.';
            updateGenerationBatch(batchIndex, { status: 'failed', error: message });
            setGenerationStatus(`Failed: ${batch.label}`);
            setGenerationPaused(true);
            setIsGenerating(false);
            toast.error(`${batch.label}: ${message}`);
            return;
          }
        }

        if (!allComposeBanners.length) {
          toast.error('No ads were generated. Try again.');
          setIsGenerating(false);
          return;
        }

        // ── Step 3: Save (85 → 100%) ───────────────────────────────────────
        setGenerationProgress(85);
        setGenerationStatus('Saving ads to the campaign board...');
        const savedCount = await publishGeneratedComposeBanners(allComposeBanners, nextFormData);
        setGenerationProgress(100);
        setGenerationStatus('Done!');
        setIsGenerating(false);
        setGenerationPaused(false);
        const freshCampaign = await getCampaign(campaign.id, user.id).catch(() => null);
        if (freshCampaign) setCampaign(freshCampaign);
        toast.success(`${savedCount} ad${savedCount !== 1 ? 's' : ''} generated and saved.`);
        return;
      }

      const prepared = await prepareAdsFromCampaignPayload({
        user_id: user.id,
        company_project_id: resolvedCompanyProjectId,
        campaign_id: campaign.id,
        form_overrides: formOverrides,
      });

      setGenerationProgress(10);
      setGenerationStatus('Interpreting brand and design guidelines...');
      let batchSpecs: Array<{ label: string; spec: string }> = [];
      try {
        const allFormats = batches.flatMap(b => b.formats);
        const interpretation = await interpretBatchesViaAgent(prepared.edgePayload, allFormats);
        batchSpecs = interpretation.batchSpecs || [];
      } catch (err: any) {
        const msg = err?.message || '';
        if (/\b(504|546)\b|gateway|timed out|unavailable/i.test(msg)) {
          await new Promise((r) => setTimeout(r, 4000));
          const allFormats = batches.flatMap(b => b.formats);
          const interpretation = await interpretBatchesViaAgent(prepared.edgePayload, allFormats);
          batchSpecs = interpretation.batchSpecs || [];
        } else throw err;
      }

      setGenerationProgress(18);
      setGenerationStatus('Creating generation job...');
      const jobResult = await createGenerationJob({
        user_id: user.id,
        company_project_id: resolvedCompanyProjectId,
        campaign_id: campaign.id,
        project_id: campaign.project_id || undefined,
        batches: batches.map(b => ({ label: b.label, formats: b.formats })),
        creative_plan: batchSpecs.map(s => `[${s.label}]\n${s.spec}`).join('\n\n'),
      });
      setResumableJob(null);

      const slugBase = (campaign.name || 'campaign')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');

      const job: CampaignGenerationJob = {
        edgePayload: prepared.edgePayload,
        creativePlan: batchSpecs.map(s => `[${s.label}]\n${s.spec}`).join('\n\n'),
        batchSpecs,
        formData: prepared.edgePayload.campaignData || nextFormData,
        projectId: campaign.project_id,
        slugBase,
        batches,
        jobId: jobResult.job_id,
      };
      generationJobRef.current = job;
      setGenerationProgress(20);
      await runCampaignGenerationJob(job);
    } catch (err: any) {
      toast.error(err.message || 'Failed to generate creatives');
      setGenerationStatus(err.message || 'Generation failed.');
      setGenerationPaused(true);
      if (!generationJobRef.current) setIsGenerating(false);
    }
  }, [user?.id, campaign, companyId, generateAsImage, runCampaignGenerationJob]);

  const handleResumeJob = useCallback(async () => {
    if (!user?.id || !campaign || !resumableJob) return;
    const { job, batches: dbBatches } = resumableJob;
    setResumableJob(null);
    setIsGenerating(true);
    setGenerationPaused(false);
    setGenerationProgress(5);
    setGenerationStatus('Resuming — re-preparing campaign...');
    generationCancelRef.current = false;

    try {
      const resolvedCompanyProjectId = campaign.company_project_id || Number(companyId) || 0;
      const prepared = await prepareAdsFromCampaignPayload({
        user_id: user.id,
        company_project_id: resolvedCompanyProjectId,
        campaign_id: campaign.id,
      });

      // Map DB batch statuses back to React state
      const restoredBatches: GenerationBatchState[] = dbBatches.map((db, i) => ({
        id: `resume-batch-${i}`,
        label: db.label || `Batch ${i + 1}`,
        formats: db.formats as AdFormatForBatch[],
        status: db.status === 'completed' ? 'saved' : db.status === 'failed' ? 'failed' : 'queued',
        savedCount: db.saved_count || 0,
        error: db.error || undefined,
      }));
      setGenerationBatches(restoredBatches);

      const creativePlan = job.creative_plan || '';
      const slugBase = (campaign.name || 'campaign').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

      const savedSpecs = creativePlan
        ? creativePlan.split(/\n\n(?=\[)/).map((block) => {
            const labelMatch = block.match(/^\[([^\]]+)\]/);
            return { label: labelMatch?.[1] || '', spec: block.replace(/^\[[^\]]+\]\n/, '') };
          })
        : [];
      const resumeJob: CampaignGenerationJob = {
        edgePayload: prepared.edgePayload,
        creativePlan,
        batchSpecs: savedSpecs,
        formData: prepared.edgePayload.campaignData || campaign.form_data || {},
        projectId: job.project_id || campaign.project_id,
        slugBase,
        batches: restoredBatches,
        jobId: job.id,
      };
      generationJobRef.current = resumeJob;
      setGenerationProgress(20);
      await runCampaignGenerationJob(resumeJob);
    } catch (err: any) {
      toast.error(err.message || 'Failed to resume generation');
      setGenerationStatus(err.message || 'Resume failed.');
      setGenerationPaused(true);
      if (!generationJobRef.current) setIsGenerating(false);
    }
  }, [user?.id, campaign, companyId, resumableJob, runCampaignGenerationJob]);

  const handleMarkExample = useCallback(async () => {
    if (!user?.id || !campaign || selectedIds.size === 0) return;
    setIsMarkingExample(true);
    try {
      const selectedBanners = banners.filter(b => selectedIds.has(b.id));
      const adIds = selectedBanners.map(b => b.creative_id || b.id).filter(Boolean) as number[];
      const resolvedCompanyProjectId = campaign.company_project_id || Number(companyId) || 0;
      await markGoodExamples({
        user_id: user.id,
        company_project_id: resolvedCompanyProjectId,
        campaign_id: campaign.id,
        ad_ids: adIds,
      });
      const freshCampaign = await getCampaign(campaign.id, user.id).catch(() => null);
      if (freshCampaign) setCampaign(freshCampaign);
      toast.success(`${adIds.length} creative${adIds.length > 1 ? 's' : ''} marked as example${adIds.length > 1 ? 's' : ''}!`);
      setSelectedIds(new Set());
    } catch (err: any) {
      toast.error(err.message || 'Failed to mark examples');
    } finally {
      setIsMarkingExample(false);
    }
  }, [user?.id, campaign, selectedIds, banners, companyId]);

  const handleRemoveExample = useCallback(async (example: CampaignExampleCreative) => {
    if (!user?.id || !campaign) return;
    setRemovingExampleId(example.id);
    try {
      const resolvedCompanyProjectId = campaign.company_project_id || Number(companyId) || 0;
      await removeCampaignExample({
        user_id: user.id,
        company_project_id: resolvedCompanyProjectId,
        campaign_id: campaign.id,
        example_id: example.id,
      });
      setCampaign(prev => prev ? {
        ...prev,
        example_creatives: prev.example_creatives.filter((item) => item.id !== example.id),
      } : prev);
      toast.success('Example removed');
    } catch (err: any) {
      toast.error(err.message || 'Failed to remove example');
    } finally {
      setRemovingExampleId(null);
    }
  }, [user?.id, campaign, companyId]);

  const handleUploadAssets = useCallback(async (files: FileList | File[]) => {
    const fileList = Array.from(files);
    if (!fileList.length || !user?.id || !campaign) return;
    const resolvedCompanyProjectId = Number(campaign.company_project_id || companyId || 0);
    if (!resolvedCompanyProjectId) {
      toast.error('Company data not found.');
      return;
    }
    setUploadingAssets(true);
    try {
      const result = await uploadProjectAssets(resolvedCompanyProjectId, user.id, fileList);
      const uploaded = Array.isArray(result.uploaded) ? result.uploaded : [];
      if (uploaded.length) {
        setAssets(prev => {
          const uploadedNames = new Set(uploaded.map(asset => asset.name));
          return [...uploaded, ...prev.filter(asset => !uploadedNames.has(asset.name))];
        });
      }
      toast.success(`${uploaded.length || fileList.length} image${(uploaded.length || fileList.length) > 1 ? 's' : ''} uploaded`);
    } catch (err: any) {
      toast.error(err.message || 'Failed to upload images');
    } finally {
      setUploadingAssets(false);
    }
  }, [campaign, companyId, user?.id]);

  const handleDeleteAsset = useCallback(async (asset: ProjectAsset) => {
    if (!user?.id || !campaign) return;
    const resolvedCompanyProjectId = Number(campaign.company_project_id || companyId || 0);
    if (!resolvedCompanyProjectId) return;
    setDeletingAssetName(asset.name);
    try {
      await deleteProjectAssetFile(resolvedCompanyProjectId, user.id, asset.name);
      setAssets(prev => prev.filter(item => item.name !== asset.name));
      toast.success('Image deleted');
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete image');
    } finally {
      setDeletingAssetName(null);
    }
  }, [campaign, companyId, user?.id]);

  const handleDownloadZip = useCallback(async () => {
    if (!user?.id || selectedIds.size === 0) return;
    const selectedBanners = banners.filter(b => selectedIds.has(b.id));
    const creativeIds = selectedBanners
      .map(b => b.creative_id)
      .filter((id): id is number => typeof id === 'number' && id > 0);

    if (creativeIds.length !== selectedBanners.length) {
      toast.error('Some creatives do not have a saved ID. Try generating again.');
      return;
    }

    setIsDownloading(true);
    try {
      const res = await fetch(`/api/downloadAdCreativesZip.php?ids=${creativeIds.join(',')}&user_id=${user.id}`, { credentials: 'same-origin' });
      const contentType = res.headers.get('Content-Type') || '';
      if (res.ok && contentType.includes('zip')) {
        const blob = await res.blob();
        const name = (campaign?.name || 'campaign').toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'creatives';
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `${name}.zip`;
        document.body.appendChild(a); a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast.success('Download started!');
      } else {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || 'Failed to generate ZIP');
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to download ZIP');
    } finally {
      setIsDownloading(false);
    }
  }, [user?.id, selectedIds, banners, campaign]);

  const handleChatSend = useCallback(async () => {
    if (!user?.id || !campaign || !chatInput.trim() || isChatLoading) return;
    const msg = chatInput.trim();
    setChatInput('');
    const newHistory: ChatMessage[] = [...chatHistory, { role: 'user', content: msg }];
    setChatHistory(newHistory);
    setIsChatLoading(true);

    try {
      const res: CampaignChatResponse = await campaignChat({
        user_id: user.id,
        campaign_id: campaign.id,
        message: msg,
        history: chatHistory,
      });

      setChatHistory(prev => [...prev, { role: 'assistant', content: res.message }]);

      if (res.type === 'generate') {
        const overrides = (res as any).formOverrides || {};
        await handleGenerate(Object.keys(overrides).length ? overrides : undefined);
      }
    } catch (err: any) {
      toast.error(err.message || 'Chat error');
      setChatHistory(prev => [...prev, { role: 'assistant', content: 'Sorry, something went wrong. Please try again.' }]);
    } finally {
      setIsChatLoading(false);
    }
  }, [user?.id, campaign, chatInput, chatHistory, isChatLoading, handleGenerate]);

  const handleSendToGlobalStore = useCallback(async () => {
    if (!user?.id || selectedIds.size === 0) return;
    setIsSendingToStore(true);
    try {
      const selectedBanners = banners.filter(b => selectedIds.has(b.id));
      const creativeIds = selectedBanners.map(b => b.creative_id || b.id).filter((id): id is number => id > 0);
      const htmlList = await getCreativesHtml(creativeIds, user.id);
      const valid = htmlList.filter(c => c.html?.trim());
      if (!valid.length) { toast.error('No HTML found for selected creatives.'); return; }
      let sent = 0;
      for (const creative of valid) {
        const label = `${creative.label} — ${creative.width}x${creative.height}`;
        await sendCreativeHtmlToGlobalStore(user.id, creative.html, label);
        sent++;
        toast.success(`Sent to store: ${label} (${sent}/${valid.length})`);
      }
      toast.success(`${sent} creative${sent > 1 ? 's' : ''} added to the global ads store.`);
      setSelectedIds(new Set());
    } catch (err: any) {
      toast.error(err.message || 'Failed to send to global store');
    } finally {
      setIsSendingToStore(false);
    }
  }, [user?.id, selectedIds, banners]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">Campaign not found.</p>
        <Button variant="outline" onClick={() => navigate('/projects')}>Back</Button>
      </div>
    );
  }

  const brandSource = campaign.company_form_data && Object.keys(campaign.company_form_data).length
    ? campaign.company_form_data
    : campaign.form_data;
  const palette = campaignPalette(brandSource);
  const particlePrimary = palette.primary;
  const uiColor = palette.accent;
  const uiHsl = hexToHsl(uiColor);
  const campaignShellStyle: CSSProperties = {
    ...(uiHsl ? { '--primary': uiHsl, '--ring': uiHsl, '--accent': uiHsl } : {}),
    background: [
      `radial-gradient(circle at 12% 8%, ${colorWithAlpha(particlePrimary, 0.30, 'hsl(var(--primary) / 0.22)')} 0, transparent 34%)`,
      `radial-gradient(circle at 86% 18%, ${colorWithAlpha(uiColor, 0.18, 'hsl(var(--primary) / 0.14)')} 0, transparent 32%)`,
      `radial-gradient(circle at 52% 100%, ${colorWithAlpha(palette.secondary, 0.18, 'hsl(var(--secondary) / 0.14)')} 0, transparent 38%)`,
      `linear-gradient(135deg, ${colorWithAlpha(palette.background, 0.96, 'hsl(var(--background))')} 0%, hsl(var(--background)) 62%, ${colorWithAlpha(particlePrimary, 0.08, 'hsl(var(--primary) / 0.08)')} 100%)`,
    ].join(', '),
  } as CSSProperties;
  const platforms = ['all', ...Array.from(new Set(banners.map(b => b.platform)))];
  const filteredBanners = activePlatform === 'all' ? banners : banners.filter(b => b.platform === activePlatform);
  const campaignCompanyProjectId = Number(campaign.company_project_id || companyId || 0);
  const campaignBackTarget = campaignCompanyProjectId > 0 ? `/projects/${campaignCompanyProjectId}` : '/projects';

  return (
    <div className="relative min-h-screen bg-background" style={campaignShellStyle}>
      <PremiumParticleBackground
        activeTone="primary"
        colorOverrides={{ primary: particlePrimary, accent: particlePrimary }}
      />
      <div className="absolute inset-0 pointer-events-none bg-background/35" />
      <div className="relative z-10 max-w-screen-xl mx-auto px-4 py-6">

        {/* Header */}
        <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <Button variant="ghost" size="sm" onClick={() => navigate(campaignBackTarget)} className="shrink-0">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                <Link to={campaignBackTarget} className="hover:text-foreground transition-colors">Company</Link>
                <span>/</span>
                <span className="text-foreground font-medium truncate">{campaign.name}</span>
              </div>
              <div className="flex items-center gap-2">
                <div
                  className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0"
                  style={{ background: colorWithAlpha(uiColor, 0.16, 'hsl(var(--primary) / 0.1)') }}
                >
                  <Megaphone className="h-4 w-4" style={{ color: uiColor || 'hsl(var(--primary))' }} />
                </div>
                <h1 className="text-xl font-bold truncate">{campaign.name}</h1>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <div className="flex items-center gap-2 rounded-lg border border-border/50 bg-card/55 px-3 py-2">
              <ImageIcon className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs font-medium">{generateAsImage ? 'Image' : 'HTML'}</span>
              <Switch
                checked={generateAsImage}
                onCheckedChange={setGenerateAsImage}
                disabled={isGenerating}
                aria-label="Generate as image"
              />
            </div>
            <Button
              onClick={() => handleGenerate()}
              disabled={isGenerating}
              className="shrink-0"
              style={{ background: uiColor, borderColor: uiColor }}
            >
              {isGenerating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
              Generate More
            </Button>
          </div>
        </div>

        {/* Main layout: left panel + chat */}
        <div className="flex gap-5 items-start">

          {/* Left Panel */}
          <div className="flex-1 min-w-0">
            <Tabs defaultValue="creatives">
              <TabsList className="w-full mb-4">
                <TabsTrigger value="creatives" className="flex-1 gap-2">
                  <LayoutGrid className="h-3.5 w-3.5" />
                  Creatives
                  {banners.length > 0 && <span className="ml-1 text-xs opacity-60">({banners.length})</span>}
                </TabsTrigger>
                <TabsTrigger value="examples" className="flex-1 gap-2">
                  <Star className="h-3.5 w-3.5" />
                  Examples
                  {campaign.example_creatives.length > 0 && <span className="ml-1 text-xs opacity-60">({campaign.example_creatives.length})</span>}
                </TabsTrigger>
                <TabsTrigger value="images" className="flex-1 gap-2">
                  <ImageIcon className="h-3.5 w-3.5" />
                  Images
                  {assets.length > 0 && <span className="ml-1 text-xs opacity-60">({assets.length})</span>}
                </TabsTrigger>
                <TabsTrigger value="data" className="flex-1 gap-2">
                  <FileText className="h-3.5 w-3.5" />
                  Data
                </TabsTrigger>
              </TabsList>

              {/* Creatives tab */}
              <TabsContent value="creatives">
                {/* Action bar */}
                {selectedIds.size > 0 && (
                  <div className="flex items-center gap-3 mb-4 p-3 rounded-xl border border-primary/30 bg-primary/5 backdrop-blur-sm">
                    <span className="text-sm font-medium text-primary">{selectedIds.size} selected</span>
                    <div className="flex items-center gap-2 ml-auto">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleMarkExample}
                        disabled={isMarkingExample}
                      >
                        {isMarkingExample ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Star className="h-3.5 w-3.5 mr-1" />}
                        Mark as Example
                      </Button>
                      <Button
                        size="sm"
                        variant="default"
                        onClick={handleDownloadZip}
                        disabled={isDownloading}
                      >
                        {isDownloading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Download className="h-3.5 w-3.5 mr-1" />}
                        Download ZIP
                      </Button>
                      {user?.accountType === 'admin' && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={handleSendToGlobalStore}
                          disabled={isSendingToStore}
                          title="Send HTML to global ads store (admin)"
                        >
                          {isSendingToStore ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Sparkles className="h-3.5 w-3.5 mr-1" />}
                          Send to Store
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setSelectedIds(new Set())}
                      >
                        <span className="text-xs">Clear</span>
                      </Button>
                    </div>
                  </div>
                )}

                {/* Platform filter */}
                {banners.length > 0 && (
                  <div className="flex gap-2 flex-wrap mb-4">
                    {platforms.map(p => {
                      const count = p === 'all' ? banners.length : banners.filter(b => b.platform === p).length;
                      const label = p === 'all' ? 'All' : (AD_PLATFORM_LABELS[p as keyof typeof AD_PLATFORM_LABELS] || p);
                      return (
                        <button
                          key={p}
                          onClick={() => setActivePlatform(p)}
                          className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                            activePlatform === p
                              ? 'bg-primary text-primary-foreground border-primary'
                              : 'border-border/50 text-muted-foreground hover:border-primary/40 hover:text-foreground'
                          }`}
                        >
                          {label} <span className="opacity-60">({count})</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {resumableJob && !isGenerating && (
                  <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 mb-4 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-amber-400">Incomplete generation found</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {resumableJob.batches.filter(b => b.status === 'completed').length}/{resumableJob.batches.length} batches completed — resume from where it stopped.
                      </p>
                    </div>
                    <Button size="sm" variant="outline" className="border-amber-500/50 text-amber-400 hover:bg-amber-500/10" onClick={handleResumeJob}>
                      <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                      Resume
                    </Button>
                  </div>
                )}

                {isGenerating && (
                  <div className="rounded-xl border border-border/50 bg-card/70 p-4 mb-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold">Generating campaign creatives</p>
                        <p className="text-xs text-muted-foreground mt-1">{generationStatus || 'Preparing batches...'}</p>
                      </div>
                      <Button size="sm" variant="outline" onClick={handleCancelGeneration}>
                        <X className="h-3.5 w-3.5 mr-1.5" />
                        Cancel
                      </Button>
                    </div>
                    <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary transition-all"
                        style={{ width: `${Math.max(3, Math.min(100, generationProgress))}%` }}
                      />
                    </div>
                    <p className="mt-1.5 text-[11px] text-muted-foreground">{generationProgress}% complete</p>
                    {generationBatches.length > 0 && (
                      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {generationBatches.map((batch, index) => (
                          <div key={batch.id} className="rounded-lg border border-border/50 bg-background/50 p-3">
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0">
                                <p className="truncate text-xs font-medium">{batch.label}</p>
                                <p className="text-[11px] text-muted-foreground capitalize">
                                  {batch.status === 'saved' && `${batch.savedCount || 0} saved`}
                                  {batch.status === 'running' && 'Generating...'}
                                  {batch.status === 'queued' && 'Queued'}
                                  {batch.status === 'failed' && 'Failed'}
                                  {batch.status === 'cancelled' && 'Cancelled'}
                                </p>
                              </div>
                              {batch.status === 'running' && <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />}
                              {batch.status === 'saved' && <Check className="h-4 w-4 text-primary shrink-0" />}
                              {batch.status === 'failed' && (
                                <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => handleRetryBatch(index)} disabled={!generationPaused}>
                                  <RotateCcw className="h-3.5 w-3.5" />
                                </Button>
                              )}
                            </div>
                            {batch.error && <p className="mt-2 line-clamp-2 text-[11px] text-destructive">{batch.error}</p>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {(!isGenerating || banners.length > 0) && (
                  <BannerGrid
                    banners={filteredBanners}
                    selectedIds={selectedIds}
                    newIds={newBannerIds}
                    onToggle={toggleBanner}
                    onSeen={markBannerSeen}
                  />
                )}
              </TabsContent>

              {/* Examples tab */}
              <TabsContent value="examples">
                {campaign.example_creatives.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <Star className="h-10 w-10 text-muted-foreground/30 mb-3" />
                    <p className="text-sm text-muted-foreground">No example creatives yet.</p>
                    <p className="text-xs text-muted-foreground/60 mt-1">Select winning creatives and mark them as examples.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {campaign.example_creatives.map((example) => (
                      <ExampleCard
                        key={example.id}
                        example={example}
                        removing={removingExampleId === example.id}
                        onRemove={handleRemoveExample}
                      />
                    ))}
                  </div>
                )}
              </TabsContent>

              {/* Images tab */}
              <TabsContent value="images">
                <div className="mb-4 flex flex-col gap-3 rounded-xl border border-border/50 bg-card/50 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold">Company Images</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Assets available for this campaign and future generations.</p>
                  </div>
                  <input
                    ref={assetFileRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      const files = e.currentTarget.files;
                      if (files?.length) void handleUploadAssets(files);
                      e.currentTarget.value = '';
                    }}
                  />
                  <Button
                    type="button"
                    className="gap-2"
                    onClick={() => assetFileRef.current?.click()}
                    disabled={uploadingAssets}
                  >
                    {uploadingAssets ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    Upload
                  </Button>
                </div>

                {loadingAssets ? (
                  <div className="flex items-center justify-center gap-3 py-16 text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                    <span className="text-sm">Loading images...</span>
                  </div>
                ) : assets.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <ImageIcon className="h-10 w-10 text-muted-foreground/30 mb-3" />
                    <p className="text-sm text-muted-foreground">No company images yet.</p>
                    <p className="text-xs text-muted-foreground/60 mt-1">Upload images here or save a scraped company to collect them automatically.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                    {assets.map((asset) => (
                      <AssetCard
                        key={asset.name}
                        asset={asset}
                        deleting={deletingAssetName === asset.name}
                        onDelete={handleDeleteAsset}
                      />
                    ))}
                  </div>
                )}
              </TabsContent>

              {/* Data tab */}
              <TabsContent value="data">
                <FormDataDisplay formData={campaign.form_data} />
              </TabsContent>
            </Tabs>
          </div>

          {/* Chat Panel */}
          <div className="w-80 shrink-0 self-start flex flex-col rounded-2xl border border-border/50 bg-card/60 backdrop-blur-sm overflow-hidden" style={{ height: 'calc(100vh - 140px)', maxHeight: 720, position: 'sticky', top: 24 }}>
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border/40">
              <MessageSquare className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold">Campaign Chat</span>
            </div>

            {/* Messages */}
            <div ref={chatScrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
              {chatHistory.length === 0 && (
                <div className="text-center py-6">
                  <p className="text-xs text-muted-foreground/60">Ask about the campaign or request more creatives.</p>
                  <div className="mt-3 space-y-2">
                    {['Which formats were used?', 'Explain the creative plan', 'Generate more creatives'].map(hint => (
                      <button
                        key={hint}
                        onClick={() => { setChatInput(hint); }}
                        className="block w-full text-left text-xs rounded-lg border border-border/40 bg-background/40 px-3 py-2 hover:border-primary/40 hover:bg-primary/5 transition-colors"
                      >
                        {hint}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {chatHistory.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[80%] rounded-2xl px-3 py-2 text-xs leading-relaxed ${
                      msg.role === 'user'
                        ? 'bg-primary text-primary-foreground rounded-br-sm'
                        : 'bg-muted/60 text-foreground rounded-bl-sm border border-border/30'
                    }`}
                  >
                    {msg.content}
                  </div>
                </div>
              ))}
              {isChatLoading && (
                <div className="flex justify-start">
                  <div className="bg-muted/60 border border-border/30 rounded-2xl rounded-bl-sm px-3 py-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                  </div>
                </div>
              )}
            </div>

            {/* Input */}
            <div className="border-t border-border/40 px-3 py-3">
              <div className="flex items-end gap-2">
                <textarea
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleChatSend(); } }}
                  placeholder="Ask or request creatives..."
                  rows={2}
                  className="flex-1 resize-none rounded-xl border border-border/50 bg-background/60 px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-muted-foreground/50"
                  disabled={isChatLoading}
                />
                <Button
                  size="sm"
                  onClick={handleChatSend}
                  disabled={!chatInput.trim() || isChatLoading}
                  className="shrink-0 h-9 w-9 p-0"
                >
                  <Send className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
