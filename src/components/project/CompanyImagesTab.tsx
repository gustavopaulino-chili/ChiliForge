import { useEffect, useRef, useState } from 'react';
import { getProjectAssets, uploadProjectAssets, type ProjectAsset } from '@/services/api';
import { ImageIcon, Palette, Upload, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  images: Record<string, unknown> | undefined;
  projectId: number;
  userId: number;
}

interface BrandImage { key: string; label: string; url: string }

// Labels for the known brand-image slots stored in company_form_data.images.
const IMAGE_LABELS: { key: string; label: string }[] = [
  { key: 'logoUrl', label: 'Logo' },
  { key: 'brandImage', label: 'Imagem da marca' },
  { key: 'heroImage1', label: 'Hero 1' },
  { key: 'heroImage2', label: 'Hero 2' },
  { key: 'aboutImage', label: 'Sobre' },
  { key: 'teamImage', label: 'Equipe' },
  { key: 'sectionImage1', label: 'Seção 1' },
  { key: 'sectionImage2', label: 'Seção 2' },
  { key: 'sectionImage3', label: 'Seção 3' },
];

function collectBrandImages(images: Record<string, unknown> | undefined): BrandImage[] {
  if (!images) return [];
  const out: BrandImage[] = [];
  for (const { key, label } of IMAGE_LABELS) {
    const url = String(images[key] || '').trim();
    if (url) out.push({ key, label, url });
  }
  const products = Array.isArray(images.productImages) ? (images.productImages as unknown[]) : [];
  products.forEach((p, i) => {
    const url = String(p || '').trim();
    if (url) out.push({ key: `product-${i}`, label: `Produto ${i + 1}`, url });
  });
  return out;
}

function ImageCard({ url, label }: { url: string; label: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="group flex flex-col gap-1.5 rounded-lg border border-border bg-card p-2 transition-colors hover:border-primary/50"
      title={label}
    >
      <div className="relative aspect-square w-full overflow-hidden rounded-md bg-muted">
        <img src={url} alt={label} loading="lazy" className="h-full w-full object-contain" />
      </div>
      <span className="truncate text-xs font-medium text-foreground">{label}</span>
    </a>
  );
}

const isImageAsset = (asset: ProjectAsset) =>
  /\.(png|jpe?g|webp|gif|svg|avif)(\?|$)/i.test(asset.url || '') ||
  /\.(png|jpe?g|webp|gif|svg|avif)$/i.test(asset.name || '');

export function CompanyImagesTab({ images, projectId, userId }: Props) {
  const brandImages = collectBrandImages(images);
  const [designAssets, setDesignAssets] = useState<ProjectAsset[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const loadDesignAssets = () => {
    getProjectAssets(projectId, userId)
      .then((res) => setDesignAssets((res.assets || []).filter(isImageAsset)))
      .catch(() => setDesignAssets([]));
  };

  useEffect(() => { loadDesignAssets(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [projectId, userId]);

  const handleUploadDesignAssets = async (files: File[]) => {
    if (!files.length || !projectId || !userId) return;
    setUploading(true);
    try {
      const res = await uploadProjectAssets(projectId, userId, files);
      const n = res.uploaded?.length ?? 0;
      toast.success(`${n} design asset${n === 1 ? '' : 's'} enviado${n === 1 ? '' : 's'}.`);
      loadDesignAssets();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao enviar design assets.');
    } finally {
      setUploading(false);
    }
  };

  const hasAny = brandImages.length > 0 || designAssets.length > 0;

  return (
    <div className="space-y-6">
      {/* Design assets — public files the AI uses as references for ad backgrounds */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Palette className="h-4 w-4 text-primary" />
            <h4 className="text-sm font-semibold text-foreground">
              Design assets <span className="text-xs font-normal text-muted-foreground">({designAssets.length})</span>
            </h4>
          </div>
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            ref={fileRef}
            onChange={(e) => { handleUploadDesignAssets(Array.from(e.target.files || [])); e.currentTarget.value = ''; }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary/50 disabled:opacity-50"
          >
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            {uploading ? 'Enviando…' : 'Enviar design assets'}
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          Texturas, padrões, fundos e elementos visuais da marca. A IA usa estes arquivos como referência nos fundos
          dos ads (modo "Imagens da empresa" no passo de imagens) — você escolhe quais usar em cada campanha.
        </p>
        {designAssets.length > 0 ? (
          <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 lg:grid-cols-6">
            {designAssets.map((asset) => (
              <ImageCard key={asset.name} url={asset.url} label={asset.name} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Nenhum design asset ainda. Envie texturas/elementos da marca.</p>
        )}
      </div>

      {/* Brand images assimilated to the company */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <ImageIcon className="h-4 w-4 text-primary" />
          <h4 className="text-sm font-semibold text-foreground">
            Imagens da marca <span className="text-xs font-normal text-muted-foreground">({brandImages.length})</span>
          </h4>
        </div>
        {brandImages.length > 0 ? (
          <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 lg:grid-cols-6">
            {brandImages.map((img) => (
              <ImageCard key={img.key} url={img.url} label={img.label} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Nenhuma imagem da marca salva ainda.</p>
        )}
      </div>

      {!hasAny && (
        <p className="text-sm text-muted-foreground text-center py-6">
          Esta empresa ainda não tem imagens salvas.
        </p>
      )}
    </div>
  );
}
