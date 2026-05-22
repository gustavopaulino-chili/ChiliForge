import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { AdCreativeFormData, AdLogoVariant } from '@/types/adCreativeForm';
import { FieldLabel } from '@/components/generator/FieldLabel';
import { getProjectAssets, type ProjectAsset } from '@/services/api';
import { Upload, X, Image, Plus, Sparkles, Loader2, CheckCircle2, AlertCircle, Wand2, RefreshCw, Search } from 'lucide-react';
import { toast } from 'sonner';

interface AdImageGenerateContext {
  brandName: string;
  productName: string;
  valueProposition: string;
  style: string;
  primaryColor: string;
  secondaryColor: string;
  backgroundColor: string;
  industry: string;
  toneOfVoice: string;
  targetAudience: string;
  campaignName: string;
}

interface Props {
  data: AdCreativeFormData;
  onChange: (updates: Partial<AdCreativeFormData>) => void;
  onUploadAssets?: (files: File[]) => Promise<string[]>;
  onRemoveAsset?: (url: string) => Promise<void>;
  onGenerateImage?: (slot: 'logo' | 'product' | 'background', context: AdImageGenerateContext, variantIndex?: number) => Promise<string | null>;
  onSearchPexelsImage?: (slot: 'logo' | 'product' | 'background', context: AdImageGenerateContext, variantIndex?: number) => Promise<string | null>;
  companyProjectId?: number;
  userId?: number;
}

const LOGO_VARIANT_LABELS = ['Full color', 'White', 'Black', 'Monochrome', 'Horizontal', 'Icon only'];
const VARIANT_LABELS = ['A', 'B', 'C'];

type AiLogEntry = {
  label: string;
  status: 'pending' | 'active' | 'done' | 'error';
};

const makeLogoVariant = (url = '', label = 'Full color'): AdLogoVariant => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  url,
  label,
  usageHint: '',
});

function ImageInput({
  id,
  value,
  placeholder,
  onUrlChange,
  onUpload,
  onGenerate,
  onSearchPexels,
  onRemove,
  isGenerating,
  isSearching,
  anyGenerating,
}: {
  id?: string;
  value: string;
  placeholder: string;
  onUrlChange: (url: string) => void;
  onUpload: () => void;
  onGenerate?: () => void;
  onSearchPexels?: () => void;
  onRemove: () => void;
  isGenerating: boolean;
  isSearching: boolean;
  anyGenerating: boolean;
}) {
  return (
    <div className="flex gap-2">
      <Input
        id={id}
        value={value}
        onChange={e => onUrlChange(e.target.value)}
        placeholder={placeholder}
        className="flex-1 text-sm"
      />
      <Button type="button" variant="outline" size="icon" onClick={onUpload} title="Upload image">
        <Upload className="h-4 w-4" />
      </Button>
      {onGenerate && (
        <Button
          type="button"
          variant="outline"
          size="icon"
          disabled={anyGenerating}
          onClick={onGenerate}
          title="Generate with AI"
        >
          {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        </Button>
      )}
      {onSearchPexels && (
        <Button
          type="button"
          variant="outline"
          size="icon"
          disabled={anyGenerating}
          onClick={onSearchPexels}
          title="Search Pexels with this image context"
        >
          {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
        </Button>
      )}
      {value && (
        <Button type="button" variant="outline" size="icon" onClick={onRemove} title="Remove image">
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

function ImagePreview({ url, alt }: { url: string; alt: string }) {
  if (!url) return null;
  return (
    <div className="relative rounded-lg overflow-hidden border border-border bg-muted/30 h-24 flex items-center justify-center">
      <img
        src={url}
        alt={alt}
        className="max-h-full max-w-full object-contain"
        onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
      />
    </div>
  );
}

function AssetPickerRow({
  assets,
  onSelect,
}: {
  assets: ProjectAsset[];
  onSelect: (url: string) => void;
}) {
  if (!assets.length) return null;
  return (
    <div className="mt-1 space-y-1.5">
      <p className="text-[11px] font-medium text-muted-foreground">Company images</p>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {assets.map(asset => (
          <button
            key={asset.name}
            type="button"
            onClick={() => onSelect(asset.url)}
            className="h-12 w-12 shrink-0 overflow-hidden rounded-md border-2 border-transparent bg-muted/40 transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            title={asset.name}
          >
            <img
              src={asset.url}
              alt={asset.name}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          </button>
        ))}
      </div>
    </div>
  );
}

const isImageAsset = (asset: ProjectAsset) =>
  /\.(png|jpe?g|webp|gif|svg|avif)(\?|$)/i.test(asset.url || '') ||
  /\.(png|jpe?g|webp|gif|svg|avif)$/i.test(asset.name || '');

export function StepAdImages({
  data,
  onChange,
  onUploadAssets,
  onRemoveAsset,
  onGenerateImage,
  onSearchPexelsImage,
  companyProjectId,
  userId,
}: Props) {
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const logoVariantFileRef = useRef<HTMLInputElement | null>(null);
  const [generatingKey, setGeneratingKey] = useState<string | null>(null);
  const [searchingKey, setSearchingKey] = useState<string | null>(null);
  const [bulkGenerating, setBulkGenerating] = useState(false);
  const [bulkPercent, setBulkPercent] = useState(0);
  const [bulkLog, setBulkLog] = useState<AiLogEntry[]>([]);
  const [bulkGeneratedUrls, setBulkGeneratedUrls] = useState<string[]>([]);
  const [bulkHasRun, setBulkHasRun] = useState(false);
  const [companyAssets, setCompanyAssets] = useState<ProjectAsset[]>([]);

  useEffect(() => {
    if (!companyProjectId || !userId) {
      setCompanyAssets([]);
      return;
    }
    getProjectAssets(companyProjectId, userId)
      .then(result => setCompanyAssets((result.assets || []).filter(isImageAsset)))
      .catch(() => setCompanyAssets([]));
  }, [companyProjectId, userId]);

  const buildCtx = (): AdImageGenerateContext => ({
    brandName: data.brandName,
    productName: data.productName,
    valueProposition: data.valueProposition,
    style: data.preferredStyle,
    primaryColor: data.primaryColor,
    secondaryColor: data.secondaryColor,
    backgroundColor: data.backgroundColor,
    industry: data.industry,
    toneOfVoice: data.toneOfVoice,
    targetAudience: data.targetAudience,
    campaignName: data.campaignName,
  });

  const uploadFiles = async (files: File[]) => {
    if (!files.length) return [];
    if (onUploadAssets) return await onUploadAssets(files);
    return files.map(f => URL.createObjectURL(f));
  };

  const handleFileUpload = (_key: string, file: File, onDone: (url: string) => void) => {
    uploadFiles([file])
      .then(([url]) => { if (url) { onDone(url); toast.success(`"${file.name}" uploaded`); } })
      .catch(err => toast.error(err instanceof Error ? err.message : 'Upload failed'));
  };

  const removeImage = (url: string, _key: string, onDone: () => void) => {
    onDone();
    if (onRemoveAsset && !url.startsWith('blob:')) onRemoveAsset(url).catch(() => undefined);
  };

  const handleGenerate = async (slot: 'logo' | 'product' | 'background', key: string, onDone: (url: string) => void, variantIndex?: number) => {
    if (!onGenerateImage) return;
    setGeneratingKey(key);
    try {
      const url = await onGenerateImage(slot, buildCtx(), variantIndex);
      if (url) onDone(url);
    } finally {
      setGeneratingKey(null);
    }
  };

  const handleSearchPexels = async (slot: 'logo' | 'product' | 'background', key: string, onDone: (url: string) => void, variantIndex?: number) => {
    if (!onSearchPexelsImage) return;
    setSearchingKey(key);
    try {
      const url = await onSearchPexelsImage(slot, buildCtx(), variantIndex);
      if (url) onDone(url);
    } finally {
      setSearchingKey(null);
    }
  };

  const updateLogoVariant = (id: string, updates: Partial<AdLogoVariant>) =>
    onChange({ logoVariants: (data.logoVariants || []).map(v => v.id === id ? { ...v, ...updates } : v) });

  const addLogoVariant = (variant?: AdLogoVariant) =>
    onChange({ logoVariants: [...(data.logoVariants || []), variant || makeLogoVariant()] });

  const removeLogoVariant = (variant: AdLogoVariant) => {
    onChange({ logoVariants: (data.logoVariants || []).filter(v => v.id !== variant.id) });
    if (onRemoveAsset && !variant.url.startsWith('blob:')) onRemoveAsset(variant.url).catch(() => undefined);
  };

  const handleLogoVariantFiles = (files: File[]) => {
    uploadFiles(files)
      .then(urls => {
        const variants = urls.map((url, i) => makeLogoVariant(url, LOGO_VARIANT_LABELS[i % LOGO_VARIANT_LABELS.length]));
        if (!variants.length) return;
        onChange({ logoVariants: [...(data.logoVariants || []), ...variants] });
        toast.success(`${variants.length} logo variation${variants.length === 1 ? '' : 's'} uploaded`);
      })
      .catch(err => toast.error(err instanceof Error ? err.message : 'Logo upload failed'));
  };

  const showAbVariants = data.abTestingEnabled;
  const variantCount = data.abVariantCount || 2;
  const variantLabels = VARIANT_LABELS.slice(0, variantCount);

  const productVariants = data.productImageVariants || [];
  const bgVariants = data.backgroundImageVariants || [];

  const updateProductVariant = (i: number, url: string) => {
    const next = [...productVariants];
    next[i] = url;
    onChange({ productImageVariants: next });
  };

  const updateBgVariant = (i: number, url: string) => {
    const next = [...bgVariants];
    next[i] = url;
    onChange({ backgroundImageVariants: next });
  };

  const buildBulkJobs = () => {
    const jobs: Array<{
      key: string;
      label: string;
      slot: 'logo' | 'product' | 'background';
      variantIndex?: number;
      apply: (url: string, draft: Partial<AdCreativeFormData>) => void;
    }> = [];

    if (!data.logoUrl) {
      jobs.push({
        key: 'logoUrl',
        label: 'Primary logo',
        slot: 'logo',
        apply: (url, draft) => { draft.logoUrl = url; },
      });
    }

    if (!data.productImageUrl) {
      jobs.push({
        key: 'productImageUrl',
        label: 'Product / hero image',
        slot: 'product',
        apply: (url, draft) => { draft.productImageUrl = url; },
      });
    }

    if (!data.backgroundImageUrl) {
      jobs.push({
        key: 'backgroundImageUrl',
        label: 'Background image',
        slot: 'background',
        apply: (url, draft) => { draft.backgroundImageUrl = url; },
      });
    }

    if (data.abTestingEnabled) {
      variantLabels.forEach((label, i) => {
        if (!productVariants[i]) {
          jobs.push({
            key: `product-variant-${i}`,
            label: `Variant ${label} product image`,
            slot: 'product',
            variantIndex: i,
            apply: (url, draft) => {
              const next = [...(draft.productImageVariants || data.productImageVariants || [])];
              next[i] = url;
              draft.productImageVariants = next;
            },
          });
        }

        if (!bgVariants[i]) {
          jobs.push({
            key: `background-variant-${i}`,
            label: `Variant ${label} background image`,
            slot: 'background',
            variantIndex: i,
            apply: (url, draft) => {
              const next = [...(draft.backgroundImageVariants || data.backgroundImageVariants || [])];
              next[i] = url;
              draft.backgroundImageVariants = next;
            },
          });
        }
      });
    }

    return jobs;
  };

  const handleGenerateMissingImages = async () => {
    if (!onGenerateImage || bulkGenerating) return;
    const jobs = buildBulkJobs();
    if (jobs.length === 0) {
      toast.info('All image fields are already filled.');
      return;
    }

    setBulkGenerating(true);
    setBulkPercent(0);
    setBulkGeneratedUrls([]);
    setBulkLog(jobs.map(job => ({ label: job.label, status: 'pending' })));

    const draft: Partial<AdCreativeFormData> = {
      productImageVariants: [...(data.productImageVariants || [])],
      backgroundImageVariants: [...(data.backgroundImageVariants || [])],
    };
    const generatedUrls: string[] = [];
    let successCount = 0;

    try {
      for (let i = 0; i < jobs.length; i++) {
        const job = jobs[i];
        setGeneratingKey(job.key);
        setBulkLog(prev => prev.map((entry, idx) => idx === i ? { ...entry, status: 'active' } : entry));

        try {
          const url = await onGenerateImage(job.slot, buildCtx(), job.variantIndex);
          if (!url) throw new Error('No image URL returned');
          job.apply(url, draft);
          generatedUrls.push(url);
          successCount++;
          setBulkGeneratedUrls([...generatedUrls]);
          setBulkLog(prev => prev.map((entry, idx) => idx === i ? { ...entry, status: 'done' } : entry));
        } catch {
          setBulkLog(prev => prev.map((entry, idx) => idx === i ? { ...entry, status: 'error' } : entry));
        } finally {
          setBulkPercent(Math.round(((i + 1) / jobs.length) * 100));
        }
      }

      onChange(draft);
      setBulkHasRun(true);
      if (successCount === jobs.length) {
        toast.success(`${successCount} AI image${successCount === 1 ? '' : 's'} generated and saved.`);
      } else if (successCount > 0) {
        toast.warning(`${successCount} of ${jobs.length} images generated. Fill the remaining fields manually or try again.`);
      } else {
        toast.error('Could not generate images. Try again or upload manually.');
      }
    } finally {
      setGeneratingKey(null);
      setBulkGenerating(false);
    }
  };

  const bulkJobsCount = buildBulkJobs().length;
  const bulkDone = bulkHasRun && !bulkGenerating && bulkLog.some(entry => entry.status === 'done' || entry.status === 'error');

  return (
    <div className="space-y-6">
      <div>
        <h3 className="form-section-title">Visual Assets</h3>
        <p className="form-section-desc">
          Provide images that will appear in your ad creatives. You can upload files, paste URLs, or generate with AI.
        </p>
      </div>

      {onGenerateImage && (
        <div className="rounded-lg border border-primary/40 bg-primary/10 p-4 space-y-3 shadow-sm shadow-primary/10">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3">
              <Sparkles className="mt-0.5 h-5 w-5 text-primary" />
              <div>
                <FieldLabel className="text-foreground font-medium" hint="Generates AI images only for empty Ads image fields, then saves them directly to the project assets folder.">
                  Generate Missing AI Images
                </FieldLabel>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Fill every empty logo, product, background, and A/B image slot in one run.
                </p>
              </div>
            </div>
            {bulkDone && bulkLog.every(entry => entry.status === 'done') && (
              <span className="flex items-center gap-1.5 text-xs text-green-600 font-medium">
                <CheckCircle2 className="h-4 w-4" /> Generated
              </span>
            )}
          </div>

          {(bulkGenerating || bulkDone) && (
            <div className="rounded-xl border border-primary/40 bg-primary/10 p-4 space-y-4">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
                  {bulkGenerating ? (
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                  )}
                </div>
                <div>
                  <p className="text-sm font-semibold">
                    {bulkGenerating ? 'Generating Ads Images...' : 'AI Images Ready'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {bulkGenerating ? 'Images are being generated and saved to assets.' : 'Generated images were saved to the project assets folder.'}
                  </p>
                </div>
              </div>

              <div className="space-y-1">
                <Progress value={bulkPercent} className="h-2" />
                <p className="text-right text-xs text-muted-foreground">{bulkPercent}%</p>
              </div>

              <ul className="space-y-1.5">
                {bulkLog.map((entry, i) => (
                  <li key={`${entry.label}-${i}`} className="flex items-center gap-2 text-sm">
                    {entry.status === 'done' && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-500" />}
                    {entry.status === 'error' && <AlertCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />}
                    {entry.status === 'active' && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />}
                    {entry.status === 'pending' && <span className="inline-block h-3.5 w-3.5 shrink-0 rounded-full border border-border" />}
                    <span className={
                      entry.status === 'done' ? 'text-foreground' :
                      entry.status === 'error' ? 'text-destructive' :
                      entry.status === 'active' ? 'font-medium text-primary' :
                      'text-muted-foreground'
                    }>
                      {entry.label}
                    </span>
                  </li>
                ))}
              </ul>

              {!bulkGenerating && bulkLog.some(entry => entry.status === 'error') && (
                <p className="text-xs text-destructive">
                  Some images could not be generated. Provide them manually below or try again.
                </p>
              )}
            </div>
          )}

          {bulkGeneratedUrls.length > 0 && !bulkGenerating && (
            <div className="space-y-1.5">
              <p className="pl-2 text-xs font-medium text-muted-foreground">Generated images saved to assets:</p>
              <div className="grid grid-cols-2 gap-2">
                {bulkGeneratedUrls.map((url, i) => (
                  <img
                    key={`${url}-${i}`}
                    src={url}
                    alt={`Generated ad image ${i + 1}`}
                    className="h-20 w-full rounded-md border border-border/40 object-cover"
                    onError={e => { e.currentTarget.style.display = 'none'; }}
                  />
                ))}
              </div>
            </div>
          )}

          <div className="pl-2 space-y-1.5">
            {bulkJobsCount > 0 && !bulkGenerating && (
              <p className="text-xs text-muted-foreground">
                {bulkJobsCount} empty image field{bulkJobsCount === 1 ? '' : 's'} will be generated.
              </p>
            )}
            <Button
              type="button"
              variant="default"
              size="sm"
              className="gap-2 border border-primary bg-primary text-primary-foreground shadow-sm shadow-primary/20 hover:bg-primary/90"
              onClick={handleGenerateMissingImages}
              disabled={bulkGenerating || generatingKey !== null}
            >
              {bulkGenerating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : bulkHasRun ? (
                <RefreshCw className="h-4 w-4" />
              ) : (
                <Wand2 className="h-4 w-4" />
              )}
              {bulkGenerating ? 'Generating...' : bulkHasRun ? 'Generate Missing Again' : 'Generate & Save Missing Images'}
            </Button>
          </div>
        </div>
      )}

      {/* Section 1 — Brand Logo */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div>
          <h4 className="text-sm font-semibold text-foreground">Brand Logo</h4>
          <p className="text-xs text-muted-foreground mt-1">Your logo will appear in every ad. Upload the highest-quality version available.</p>
        </div>

        <div className="space-y-2">
          <FieldLabel htmlFor="logoUrl">Primary Logo</FieldLabel>
          <input
            type="file"
            accept="image/*"
            className="hidden"
            ref={el => { fileRefs.current['logoUrl'] = el; }}
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFileUpload('logoUrl', f, url => onChange({ logoUrl: url })); e.currentTarget.value = ''; }}
          />
          <ImageInput
            id="logoUrl"
            value={data.logoUrl}
            placeholder="https://... or upload / generate"
            onUrlChange={url => onChange({ logoUrl: url })}
            onUpload={() => fileRefs.current['logoUrl']?.click()}
            onGenerate={onGenerateImage ? () => handleGenerate('logo', 'logoUrl', url => onChange({ logoUrl: url })) : undefined}
            onSearchPexels={onSearchPexelsImage ? () => handleSearchPexels('logo', 'logoUrl', url => onChange({ logoUrl: url })) : undefined}
            onRemove={() => removeImage(data.logoUrl, 'logoUrl', () => onChange({ logoUrl: '' }))}
            isGenerating={generatingKey === 'logoUrl'}
            isSearching={searchingKey === 'logoUrl'}
            anyGenerating={generatingKey !== null || searchingKey !== null}
          />
          <AssetPickerRow assets={companyAssets} onSelect={url => onChange({ logoUrl: url })} />
          <ImagePreview url={data.logoUrl} alt="Brand logo" />
          {!data.logoUrl && (
            <button
              type="button"
              onClick={() => fileRefs.current['logoUrl']?.click()}
              className="w-full h-16 rounded-lg border-2 border-dashed border-border hover:border-primary/50 flex items-center justify-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
            >
              <Image className="h-4 w-4" />
              <span className="text-sm">Drop logo here or click to upload</span>
            </button>
          )}
        </div>

        {/* Logo Selection Strategy */}
        <div className="space-y-2">
          <FieldLabel hint="Let the AI decide which logo version to use, or lock it to a specific style.">Logo Strategy</FieldLabel>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {([['auto', 'Auto'], ['full-color', 'Full color'], ['light', 'Light'], ['dark', 'Dark'], ['monochrome', 'Mono']] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => onChange({ preferredLogoStrategy: value })}
                className={`rounded-lg border px-3 py-2 text-xs font-medium transition-all ${
                  data.preferredLogoStrategy === value
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:border-muted-foreground/40'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Logo Variations */}
        <div className="space-y-3 pt-2 border-t border-border/50">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h5 className="text-xs font-semibold text-foreground">Logo Variations <span className="text-muted-foreground font-normal">(optional)</span></h5>
              <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                Upload each official version (white, dark, icon-only). The AI picks the best match per ad background.
              </p>
            </div>
            <div className="flex gap-2 shrink-0">
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                ref={logoVariantFileRef}
                onChange={e => { handleLogoVariantFiles(Array.from(e.target.files || [])); e.currentTarget.value = ''; }}
              />
              <Button type="button" variant="outline" size="sm" className="gap-1.5 text-xs h-8" onClick={() => logoVariantFileRef.current?.click()}>
                <Upload className="h-3.5 w-3.5" /> Upload
              </Button>
              <Button type="button" variant="outline" size="sm" className="gap-1.5 text-xs h-8" onClick={() => addLogoVariant()}>
                <Plus className="h-3.5 w-3.5" /> Add URL
              </Button>
            </div>
          </div>

          {(data.logoVariants || []).length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {(data.logoVariants || []).map(variant => (
                <div key={variant.id} className="rounded-lg border border-border bg-background/50 p-3 space-y-2">
                  <div className="flex gap-2">
                    <Input value={variant.url} onChange={e => updateLogoVariant(variant.id, { url: e.target.value })} placeholder="https://... logo variation" className="flex-1 text-sm" />
                    <Button type="button" variant="outline" size="icon" onClick={() => removeLogoVariant(variant)} title="Remove">
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Input value={variant.label} onChange={e => updateLogoVariant(variant.id, { label: e.target.value })} placeholder="White logo" className="text-sm" />
                    <Input value={variant.usageHint || ''} onChange={e => updateLogoVariant(variant.id, { usageHint: e.target.value })} placeholder="Best on dark bg" className="text-sm" />
                  </div>
                  {variant.url && (
                    <div className="h-16 rounded border border-border bg-muted/30 flex items-center justify-center p-2">
                      <img src={variant.url} alt={variant.label || 'Logo variation'} className="max-h-full max-w-full object-contain" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => logoVariantFileRef.current?.click()}
              className="w-full h-14 rounded-lg border-2 border-dashed border-border hover:border-primary/50 flex items-center justify-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
            >
              <Image className="h-4 w-4" />
              <span className="text-xs">Upload logo variations (optional)</span>
            </button>
          )}
        </div>
      </div>

      {/* Section 2 — Creative Images */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-5">
        <div>
          <h4 className="text-sm font-semibold text-foreground">Creative Images</h4>
          <p className="text-xs text-muted-foreground mt-1">Product and background images used inside the ads. Empty fields stay empty unless you upload or generate an image.</p>
        </div>

        {/* Product Image */}
        <div className="space-y-2">
          <FieldLabel htmlFor="productImageUrl" hint="Main product or hero image shown inside the ad. Works best with a clean background.">
            Product / Hero Image
          </FieldLabel>
          <input type="file" accept="image/*" className="hidden" ref={el => { fileRefs.current['productImageUrl'] = el; }}
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFileUpload('productImageUrl', f, url => onChange({ productImageUrl: url })); e.currentTarget.value = ''; }} />
          <ImageInput
            id="productImageUrl"
            value={data.productImageUrl}
            placeholder="https://... or upload / generate"
            onUrlChange={url => onChange({ productImageUrl: url })}
            onUpload={() => fileRefs.current['productImageUrl']?.click()}
            onGenerate={onGenerateImage ? () => handleGenerate('product', 'productImageUrl', url => onChange({ productImageUrl: url })) : undefined}
            onSearchPexels={onSearchPexelsImage ? () => handleSearchPexels('product', 'productImageUrl', url => onChange({ productImageUrl: url })) : undefined}
            onRemove={() => removeImage(data.productImageUrl, 'productImageUrl', () => onChange({ productImageUrl: '' }))}
            isGenerating={generatingKey === 'productImageUrl'}
            isSearching={searchingKey === 'productImageUrl'}
            anyGenerating={generatingKey !== null || searchingKey !== null}
          />
          <AssetPickerRow assets={companyAssets} onSelect={url => onChange({ productImageUrl: url })} />
          {data.productImageUrl
            ? <ImagePreview url={data.productImageUrl} alt="Product image" />
            : (
              <button type="button" onClick={() => fileRefs.current['productImageUrl']?.click()}
                className="w-full h-16 rounded-lg border-2 border-dashed border-border hover:border-primary/50 flex items-center justify-center gap-2 text-muted-foreground hover:text-foreground transition-colors">
                <Image className="h-4 w-4" /><span className="text-sm">Drop image here or click to upload</span>
              </button>
            )}
        </div>

        {/* Background Image */}
        <div className="space-y-2">
          <FieldLabel htmlFor="backgroundImageUrl" hint="Optional background image for the ads. A dark overlay is applied automatically so text stays readable.">
            Background Image
          </FieldLabel>
          <input type="file" accept="image/*" className="hidden" ref={el => { fileRefs.current['backgroundImageUrl'] = el; }}
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFileUpload('backgroundImageUrl', f, url => onChange({ backgroundImageUrl: url })); e.currentTarget.value = ''; }} />
          <ImageInput
            id="backgroundImageUrl"
            value={data.backgroundImageUrl}
            placeholder="https://... or upload / generate"
            onUrlChange={url => onChange({ backgroundImageUrl: url })}
            onUpload={() => fileRefs.current['backgroundImageUrl']?.click()}
            onGenerate={onGenerateImage ? () => handleGenerate('background', 'backgroundImageUrl', url => onChange({ backgroundImageUrl: url })) : undefined}
            onSearchPexels={onSearchPexelsImage ? () => handleSearchPexels('background', 'backgroundImageUrl', url => onChange({ backgroundImageUrl: url })) : undefined}
            onRemove={() => removeImage(data.backgroundImageUrl, 'backgroundImageUrl', () => onChange({ backgroundImageUrl: '' }))}
            isGenerating={generatingKey === 'backgroundImageUrl'}
            isSearching={searchingKey === 'backgroundImageUrl'}
            anyGenerating={generatingKey !== null || searchingKey !== null}
          />
          <AssetPickerRow assets={companyAssets} onSelect={url => onChange({ backgroundImageUrl: url })} />
          {data.backgroundImageUrl
            ? <ImagePreview url={data.backgroundImageUrl} alt="Background image" />
            : (
              <button type="button" onClick={() => fileRefs.current['backgroundImageUrl']?.click()}
                className="w-full h-16 rounded-lg border-2 border-dashed border-border hover:border-primary/50 flex items-center justify-center gap-2 text-muted-foreground hover:text-foreground transition-colors">
                <Image className="h-4 w-4" /><span className="text-sm">Drop image here or click to upload</span>
              </button>
            )}
        </div>
      </div>

      {/* Section 3 — A/B Image Variants */}
      {showAbVariants && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-5 space-y-5">
          <div>
            <h4 className="text-sm font-semibold text-foreground">A/B Image Variants</h4>
            <p className="text-xs text-muted-foreground mt-1">
              Provide a different image per variant when you want the generated creatives to use specific visual assets for A, B, and C. These images are sent even when the main A/B focus is headline, CTA, or color.
            </p>
          </div>

          {/* Product variants */}
          <div className="space-y-3">
            <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Product Image — per Variant</h5>
            {variantLabels.map((label, i) => {
              const varKey = `product-variant-${i}`;
              const fileRefKey = `productVariant-${i}`;
              return (
                <div key={label} className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-bold text-primary w-5 shrink-0">{label}</span>
                    <input type="file" accept="image/*" className="hidden" ref={el => { fileRefs.current[fileRefKey] = el; }}
                      onChange={e => { const f = e.target.files?.[0]; if (f) handleFileUpload(fileRefKey, f, url => updateProductVariant(i, url)); e.currentTarget.value = ''; }} />
                    <div className="flex-1 flex gap-2">
                      <Input
                        value={productVariants[i] || ''}
                        onChange={e => updateProductVariant(i, e.target.value)}
                        placeholder={`Product image for variant ${label}`}
                        className="flex-1 text-sm"
                      />
                      <Button type="button" variant="outline" size="icon" onClick={() => fileRefs.current[fileRefKey]?.click()} title="Upload">
                        <Upload className="h-4 w-4" />
                      </Button>
                      {onGenerateImage && (
                        <Button type="button" variant="outline" size="icon" disabled={generatingKey !== null}
                          onClick={() => handleGenerate('product', varKey, url => updateProductVariant(i, url), i)}
                          title={`Generate variant ${label} image`}>
                          {generatingKey === varKey ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                        </Button>
                      )}
                      {onSearchPexelsImage && (
                        <Button type="button" variant="outline" size="icon" disabled={generatingKey !== null || searchingKey !== null}
                          onClick={() => handleSearchPexels('product', varKey, url => updateProductVariant(i, url), i)}
                          title={`Search Pexels for variant ${label}`}>
                          {searchingKey === varKey ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                        </Button>
                      )}
                      {productVariants[i] && (
                        <Button type="button" variant="outline" size="icon" onClick={() => updateProductVariant(i, '')} title="Remove">
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                  {productVariants[i] && <ImagePreview url={productVariants[i]} alt={`Product variant ${label}`} />}
                </div>
              );
            })}
          </div>

          {/* Background variants */}
          <div className="space-y-3">
            <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Background Image — per Variant</h5>
            {variantLabels.map((label, i) => {
              const varKey = `background-variant-${i}`;
              const fileRefKey = `bgVariant-${i}`;
              return (
                <div key={label} className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-bold text-primary w-5 shrink-0">{label}</span>
                    <input type="file" accept="image/*" className="hidden" ref={el => { fileRefs.current[fileRefKey] = el; }}
                      onChange={e => { const f = e.target.files?.[0]; if (f) handleFileUpload(fileRefKey, f, url => updateBgVariant(i, url)); e.currentTarget.value = ''; }} />
                    <div className="flex-1 flex gap-2">
                      <Input
                        value={bgVariants[i] || ''}
                        onChange={e => updateBgVariant(i, e.target.value)}
                        placeholder={`Background image for variant ${label}`}
                        className="flex-1 text-sm"
                      />
                      <Button type="button" variant="outline" size="icon" onClick={() => fileRefs.current[fileRefKey]?.click()} title="Upload">
                        <Upload className="h-4 w-4" />
                      </Button>
                      {onGenerateImage && (
                        <Button type="button" variant="outline" size="icon" disabled={generatingKey !== null}
                          onClick={() => handleGenerate('background', varKey, url => updateBgVariant(i, url), i)}
                          title={`Generate variant ${label} background`}>
                          {generatingKey === varKey ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                        </Button>
                      )}
                      {onSearchPexelsImage && (
                        <Button type="button" variant="outline" size="icon" disabled={generatingKey !== null || searchingKey !== null}
                          onClick={() => handleSearchPexels('background', varKey, url => updateBgVariant(i, url), i)}
                          title={`Search Pexels for variant ${label} background`}>
                          {searchingKey === varKey ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                        </Button>
                      )}
                      {bgVariants[i] && (
                        <Button type="button" variant="outline" size="icon" onClick={() => updateBgVariant(i, '')} title="Remove">
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                  {bgVariants[i] && <ImagePreview url={bgVariants[i]} alt={`Background variant ${label}`} />}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
        Images uploaded here are saved to this project's assets folder.
        {onGenerateImage && <> Click <Sparkles className="inline h-3 w-3 mx-0.5" /> to generate any image with AI using your brand context.</>}
        {onSearchPexelsImage && <> Click <Search className="inline h-3 w-3 mx-0.5" /> to search Pexels with the same context.</>}
      </div>
    </div>
  );
}
