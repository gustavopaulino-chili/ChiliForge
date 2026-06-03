import { useEffect, useState } from 'react';
import { getCreativesHtml } from '@/services/api';
import { ImageIcon, Sparkles } from 'lucide-react';

interface Props {
  formData: Record<string, unknown> | undefined;
  creativeIds: number[];
  userId: number;
}

interface UsedImage { key: string; label: string; url: string }

function asUrl(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (v && typeof v === 'object' && 'url' in (v as any)) return String((v as any).url || '').trim();
  return '';
}

// Input images the user provided for this campaign (from form_data).
function collectInputImages(fd: Record<string, unknown> | undefined): UsedImage[] {
  if (!fd) return [];
  const out: UsedImage[] = [];
  const push = (key: string, label: string, v: unknown) => {
    const url = asUrl(v);
    if (url) out.push({ key, label, url });
  };
  push('logoUrl', 'Logo', fd.logoUrl);
  push('productImageUrl', 'Produto', fd.productImageUrl);
  push('backgroundImageUrl', 'Fundo (enviado)', fd.backgroundImageUrl);
  (Array.isArray(fd.logoVariants) ? fd.logoVariants : []).forEach((v, i) => push(`logo-${i}`, `Logo variante ${i + 1}`, v));
  (Array.isArray(fd.productImageVariants) ? fd.productImageVariants : []).forEach((v, i) => push(`prod-${i}`, `Produto ${i + 2}`, v));
  (Array.isArray(fd.backgroundImageVariants) ? fd.backgroundImageVariants : []).forEach((v, i) => push(`bg-${i}`, `Fundo ${i + 2}`, v));
  return out;
}

// Pull the AI-generated background URLs out of each creative's HTML
// (the compose pipeline injects <img class="ad-bg" src="…ad-images…">).
function extractAdBackgrounds(htmlList: { html?: string }[]): string[] {
  const urls = new Set<string>();
  for (const item of htmlList) {
    const html = String(item?.html || '');
    if (!html) continue;
    // Look at every <img ...> tag that carries the ad-bg class.
    const imgTags = html.split('<img').slice(1);
    for (const frag of imgTags) {
      const tag = frag.slice(0, frag.indexOf('>') + 1 || 400);
      if (!/ad-bg/.test(tag)) continue;
      const m = tag.match(/src\s*=\s*"([^"]+)"/i) || tag.match(/src\s*=\s*'([^']+)'/i);
      const src = m?.[1]?.trim();
      // Only real hosted images (skip leftover base64 if any).
      if (src && /^https?:\/\//i.test(src)) urls.add(src);
    }
  }
  return Array.from(urls);
}

function Card({ url, label }: { url: string; label: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="group flex flex-col gap-1.5 rounded-lg border border-border bg-card p-2 transition-colors hover:border-primary/50"
      title={label}
    >
      <div className="aspect-square w-full overflow-hidden rounded-md bg-muted">
        <img src={url} alt={label} loading="lazy" className="h-full w-full object-contain" />
      </div>
      <span className="truncate text-xs font-medium text-foreground">{label}</span>
    </a>
  );
}

export function CampaignUsedImages({ formData, creativeIds, userId }: Props) {
  const inputs = collectInputImages(formData);
  const [aiBackgrounds, setAiBackgrounds] = useState<string[]>([]);
  const [loading, setLoading] = useState(creativeIds.length > 0);

  useEffect(() => {
    let active = true;
    if (!creativeIds.length || !userId) { setLoading(false); return; }
    setLoading(true);
    getCreativesHtml(creativeIds, userId)
      .then((list: { html?: string }[]) => { if (active) setAiBackgrounds(extractAdBackgrounds(Array.isArray(list) ? list : [])); })
      .catch(() => { if (active) setAiBackgrounds([]); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [creativeIds.join(','), userId]);

  if (inputs.length === 0 && aiBackgrounds.length === 0 && !loading) return null;

  return (
    <div className="mb-6 space-y-5 rounded-xl border border-border/50 bg-card/40 p-4">
      <div>
        <p className="text-sm font-semibold">Imagens usadas nesta campanha</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Assets enviados e os fundos gerados pela IA para esta campanha.
        </p>
      </div>

      {inputs.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <ImageIcon className="h-4 w-4 text-primary" />
            <h4 className="text-xs font-semibold text-foreground">Enviadas (logo, produto, fundo)</h4>
          </div>
          <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 lg:grid-cols-6">
            {inputs.map((img) => <Card key={img.key} url={img.url} label={img.label} />)}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h4 className="text-xs font-semibold text-foreground">
            Fundos gerados pela IA{' '}
            <span className="font-normal text-muted-foreground">({aiBackgrounds.length})</span>
          </h4>
        </div>
        {loading ? (
          <p className="text-sm text-muted-foreground">Carregando fundos…</p>
        ) : aiBackgrounds.length > 0 ? (
          <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 lg:grid-cols-6">
            {aiBackgrounds.map((url, i) => <Card key={url} url={url} label={`Fundo IA ${i + 1}`} />)}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Nenhum fundo gerado pela IA encontrado nesta campanha.</p>
        )}
      </div>
    </div>
  );
}
