import { useEffect, useRef, useState, DragEvent } from 'react';
import { Switch } from '@/components/ui/switch';
import { BusinessFormData, ImageUrls } from '@/types/businessForm';
import { Image, Sparkles, Plus, X, CheckCircle2, AlertCircle, Loader2, Wand2, Upload, FolderOpen, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FieldLabel } from './FieldLabel';
import { ImageUploadField } from './ImageUploadField';
import { CompanyImagePicker } from './CompanyImagePicker';
import { Progress } from '@/components/ui/progress';
import { getProjectAssets, getProjectById, type ProjectAsset } from '@/services/api';

// Brand images stored in company_form_data.images — offered alongside the assets folder.
const BRAND_IMAGE_KEYS: [string, string][] = [
  ['logoUrl', 'Logo'], ['logo', 'Logo'], ['brandImage', 'Marca'], ['heroImage1', 'Hero 1'], ['heroImage2', 'Hero 2'],
  ['aboutImage', 'Sobre'], ['teamImage', 'Equipe'], ['sectionImage1', 'Seção 1'], ['sectionImage2', 'Seção 2'], ['sectionImage3', 'Seção 3'],
];
function collectBrandAssets(formData: unknown): ProjectAsset[] {
  const images = (formData as { images?: Record<string, unknown> } | null)?.images;
  if (!images || typeof images !== 'object') return [];
  const out: ProjectAsset[] = [];
  const seen = new Set<string>();
  const push = (name: string, raw: unknown) => {
    const url = String(raw || '').trim();
    if (/^https?:\/\//i.test(url) && !seen.has(url)) { seen.add(url); out.push({ name, url, size: 0, modifiedAt: 0 }); }
  };
  for (const [key, label] of BRAND_IMAGE_KEYS) push(label, (images as Record<string, unknown>)[key]);
  const products = (images as Record<string, unknown>).productImages;
  if (Array.isArray(products)) products.forEach((p, i) => push(`Produto ${i + 1}`, p));
  return out;
}
const isImageAsset = (a: ProjectAsset) =>
  /\.(png|jpe?g|webp|gif|svg|avif)(\?|$)/i.test(a.url || '') || /\.(png|jpe?g|webp|gif|svg|avif)$/i.test(a.name || '');

interface AiLogEntry {
  label: string;
  status: 'pending' | 'active' | 'done' | 'error';
}

interface UploadedAsset {
  name: string;
  url: string;
}

interface Props {
  data: BusinessFormData;
  onChange: (updates: Partial<BusinessFormData>) => void;
  onGenerateAiImages?: () => Promise<void>;
  isGeneratingAiImages?: boolean;
  aiPercent?: number;
  aiLog?: AiLogEntry[];
  onUploadImages?: (files: File[]) => Promise<UploadedAsset[]>;
  aiImagesGenerated?: boolean;
  generatedImageUrls?: string[];
  companyProjectId?: number;
  userId?: number;
}

export function StepImages({ data, onChange, onGenerateAiImages, isGeneratingAiImages, aiPercent = 0, aiLog = [], onUploadImages, aiImagesGenerated = false, generatedImageUrls = [], companyProjectId, userId }: Props) {
  const dropRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadedAssets, setUploadedAssets] = useState<UploadedAsset[]>([]);

  // Company images (assets folder + brand images) for the "Empresa" picker.
  const [companyAssets, setCompanyAssets] = useState<ProjectAsset[]>([]);
  const [pickerTarget, setPickerTarget] = useState<{ apply: (url: string) => void } | null>(null);
  const openCompanyPicker = (apply: (url: string) => void) => setPickerTarget({ apply });

  useEffect(() => {
    if (!companyProjectId || !userId) { setCompanyAssets([]); return; }
    let active = true;
    Promise.allSettled([
      getProjectAssets(companyProjectId, userId),
      getProjectById(companyProjectId, userId),
    ]).then(([assetsRes, projRes]) => {
      if (!active) return;
      const folder: ProjectAsset[] = assetsRes.status === 'fulfilled' ? (assetsRes.value.assets || []).filter(isImageAsset) : [];
      const brand: ProjectAsset[] = projRes.status === 'fulfilled' && projRes.value
        ? collectBrandAssets(projRes.value.company_form_data || projRes.value.form_data) : [];
      const seen = new Set<string>();
      const merged: ProjectAsset[] = [];
      for (const a of [...folder, ...brand]) {
        const u = (a.url || '').trim();
        if (!u || seen.has(u)) continue;
        seen.add(u); merged.push(a);
      }
      setCompanyAssets(merged);
    });
    return () => { active = false; };
  }, [companyProjectId, userId]);

  const companyPickerProps = (apply: (url: string) => void) =>
    companyAssets.length > 0 ? () => openCompanyPicker(apply) : undefined;

  const updateImage = (key: keyof ImageUrls, value: string) => {
    onChange({ images: { ...data.images, [key]: value } });
  };

  const addProductImage = () => {
    onChange({ images: { ...data.images, productImages: [...data.images.productImages, ''] } });
  };

  const removeProductImage = (i: number) => {
    onChange({ images: { ...data.images, productImages: data.images.productImages.filter((_, idx) => idx !== i) } });
  };

  const updateProductImage = (i: number, val: string) => {
    const updated = [...data.images.productImages];
    updated[i] = val;
    onChange({ images: { ...data.images, productImages: updated } });
  };

  const handleFiles = async (files: File[]) => {
    const imageFiles = files.filter(f => f.type.startsWith('image/'));
    if (imageFiles.length === 0) return;
    if (!onUploadImages) return;
    setIsUploading(true);
    try {
      const result = await onUploadImages(imageFiles);
      if (result.length > 0) {
        setUploadedAssets(prev => [...result, ...prev]);
      }
    } finally {
      setIsUploading(false);
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    handleFiles(files);
  };

  const isDone = aiPercent === 100 && !isGeneratingAiImages;
  const showProgressPanel = isGeneratingAiImages || (isDone && aiLog.length > 0 && aiLog.some(e => e.status === 'done' || e.status === 'error'));

  return (
    <div className="space-y-6">
      <div>
        <h3 className="form-section-title">Images</h3>
        <p className="form-section-desc">Add image URLs for your website sections</p>
      </div>

      {/* ─── AI Generation (FIRST) ─── */}
      <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Sparkles className="h-5 w-5 text-primary" />
            <div>
              <FieldLabel className="text-foreground font-medium" hint="When enabled, AI will generate professional visuals matching your brand style, then save them directly to the project assets folder.">
                Generate AI Images
              </FieldLabel>
              <p className="text-xs text-muted-foreground mt-0.5">
                AI will generate and save images named after each section
              </p>
            </div>
          </div>
          {aiImagesGenerated ? (
            <span className="flex items-center gap-1.5 text-xs text-green-600 font-medium">
              <CheckCircle2 className="h-4 w-4" /> Generated
            </span>
          ) : (
            <Switch
              checked={data.generateAiImages}
              onCheckedChange={v => onChange({ generateAiImages: v })}
              disabled={isGeneratingAiImages}
            />
          )}
        </div>

        {(data.generateAiImages || aiImagesGenerated) && (
          <div className="space-y-3">
            {/* Progress panel — inline, never replaces the form */}
            {showProgressPanel && (
              <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center h-8 w-8 rounded-full bg-primary/10">
                    {isGeneratingAiImages ? (
                      <Loader2 className="h-4 w-4 text-primary animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                    )}
                  </div>
                  <div>
                    <p className="font-semibold text-sm">
                      {isGeneratingAiImages ? 'Generating AI Images…' : 'AI Images Ready'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {isGeneratingAiImages
                        ? 'Please wait while images are generated and saved.'
                        : 'Images were generated and saved to the assets folder.'}
                    </p>
                  </div>
                </div>

                <div className="space-y-1">
                  <Progress value={aiPercent} className="h-2" />
                  <p className="text-xs text-right text-muted-foreground">{aiPercent}%</p>
                </div>

                <ul className="space-y-1.5">
                  {aiLog.map((entry, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm">
                      {entry.status === 'done' && <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />}
                      {entry.status === 'error' && <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0" />}
                      {entry.status === 'active' && <Loader2 className="h-3.5 w-3.5 text-primary animate-spin shrink-0" />}
                      {entry.status === 'pending' && <span className="h-3.5 w-3.5 rounded-full border border-border shrink-0 inline-block" />}
                      <span className={
                        entry.status === 'done' ? 'text-foreground' :
                        entry.status === 'error' ? 'text-destructive' :
                        entry.status === 'active' ? 'text-primary font-medium' :
                        'text-muted-foreground'
                      }>
                        {entry.label}
                      </span>
                    </li>
                  ))}
                </ul>

                {!isGeneratingAiImages && aiLog.some(e => e.status === 'error') && (
                  <p className="text-xs text-destructive">
                    Some images could not be generated. Provide them manually below or try again.
                  </p>
                )}
              </div>
            )}

            {/* Generated images preview */}
            {aiImagesGenerated && !isGeneratingAiImages && generatedImageUrls.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground pl-2">Generated images saved to assets:</p>
                <div className="grid grid-cols-2 gap-2">
                  {generatedImageUrls.map((url, i) => (
                    <img
                      key={i}
                      src={url}
                      alt={`Generated image ${i + 1}`}
                      className="rounded-md w-full h-20 object-cover border border-border/40"
                      onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Generate / Regenerate button */}
            {onGenerateAiImages && (
              <div className="pl-2 space-y-1.5">
                {!showProgressPanel && !aiImagesGenerated && (
                  <p className="text-xs text-muted-foreground">
                    Images will be named after your configured sections (e.g.{' '}
                    <span className="font-mono">benefits-image.jpg</span>) and saved to the project assets folder.
                  </p>
                )}
                <Button
                  variant={aiImagesGenerated ? 'outline' : 'default'}
                  size="sm"
                  className="gap-2"
                  onClick={onGenerateAiImages}
                  disabled={isGeneratingAiImages}
                >
                  {isGeneratingAiImages ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : aiImagesGenerated ? (
                    <RefreshCw className="h-4 w-4" />
                  ) : (
                    <Wand2 className="h-4 w-4" />
                  )}
                  {isGeneratingAiImages ? 'Generating…' : aiImagesGenerated ? 'Regenerate AI Images' : 'Generate & Save AI Images Now'}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ─── Drag & Drop Upload Zone ─── */}
      {onUploadImages && (
        <div
          ref={dropRef}
          className={`rounded-lg border-2 border-dashed transition-colors p-5 text-center cursor-pointer select-none ${isDragging ? 'border-primary bg-primary/5' : 'border-border/60 hover:border-primary/40 hover:bg-muted/30'}`}
          onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          title="Upload images to the project assets folder for use in the generated site"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={e => { handleFiles(Array.from(e.target.files || [])); if (fileInputRef.current) fileInputRef.current.value = ''; }}
          />
          {isUploading ? (
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <p className="text-sm">Uploading to assets folder…</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <Upload className="h-6 w-6" />
              <p className="text-sm font-medium">Drop images here or click to upload</p>
              <p className="text-xs">Images are saved to the project assets folder for use in your site</p>
            </div>
          )}
        </div>
      )}

      {/* Recently uploaded assets */}
      {uploadedAssets.length > 0 && (
        <div className="rounded-lg border border-border/60 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-foreground flex items-center gap-1.5">
              <FolderOpen className="h-3.5 w-3.5" /> Recently uploaded to assets
            </p>
            <button
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setUploadedAssets([])}
            >
              Clear
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {uploadedAssets.map((a, i) => (
              <div key={i} className="flex items-center gap-2 rounded border border-border/40 p-2 text-xs">
                <img src={a.url} alt={a.name} className="h-8 w-8 rounded object-cover shrink-0" onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                <span className="truncate text-muted-foreground flex-1">{a.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-6">
        {/* Hero Images */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Image className="h-4 w-4 text-primary" />
            <FieldLabel className="text-foreground font-medium" hint="Large banner images displayed at the top of the homepage. Use high-resolution landscape images (1920×1080 recommended).">
              Hero Images
            </FieldLabel>
          </div>
          <div className="space-y-3 pl-6">
            <ImageUploadField
              label="Hero Image 1"
              hint="Main hero banner image. Should be eye-catching and represent your brand."
              value={data.images.heroImage1}
              onChange={v => updateImage('heroImage1', v)}
              onPickCompany={companyPickerProps((url) => updateImage('heroImage1', url))}
              imageType="hero1"
            />
            <ImageUploadField
              label="Hero Image 2"
              hint="Secondary hero image for slideshow or alternate sections."
              value={data.images.heroImage2}
              onChange={v => updateImage('heroImage2', v)}
              onPickCompany={companyPickerProps((url) => updateImage('heroImage2', url))}
              imageType="hero2"
            />
          </div>
        </div>

        {/* Brand / Identity */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Image className="h-4 w-4 text-primary" />
            <FieldLabel className="text-foreground font-medium" hint="Your brand visual assets — logo and brand imagery used across the website.">
              Brand / Identity
            </FieldLabel>
          </div>
          <div className="space-y-3 pl-6">
            <ImageUploadField
              label="Logo"
              hint="Your company logo. PNG or SVG with transparent background works best. Used in header and footer."
              value={data.images.logoUrl}
              onChange={v => updateImage('logoUrl', v)}
              onPickCompany={companyPickerProps((url) => updateImage('logoUrl', url))}
              imageType="logo"
              required
            />
            <ImageUploadField
              label="Brand Image"
              hint="An image that represents your brand identity — team photo, office, or lifestyle image."
              value={data.images.brandImage}
              onChange={v => updateImage('brandImage', v)}
              onPickCompany={companyPickerProps((url) => updateImage('brandImage', url))}
              imageType="brand"
            />
          </div>
        </div>

        {/* Section Images */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Image className="h-4 w-4 text-primary" />
            <FieldLabel className="text-foreground font-medium" hint="Images used in content sections throughout the website to break up text and engage visitors.">
              Section Images
            </FieldLabel>
          </div>
          <div className="space-y-3 pl-6">
            <ImageUploadField
              label="Section Image 1"
              hint="First section image. Used in feature, benefit, or service section."
              value={data.images.sectionImage1}
              onChange={v => updateImage('sectionImage1', v)}
              onPickCompany={companyPickerProps((url) => updateImage('sectionImage1', url))}
              imageType="section1"
            />
            <ImageUploadField
              label="Section Image 2"
              hint="Second section image. Used in another content section."
              value={data.images.sectionImage2}
              onChange={v => updateImage('sectionImage2', v)}
              onPickCompany={companyPickerProps((url) => updateImage('sectionImage2', url))}
              imageType="section2"
            />
            <ImageUploadField
              label="Section Image 3"
              hint="Third section image. Used in additional content section."
              value={data.images.sectionImage3}
              onChange={v => updateImage('sectionImage3', v)}
              onPickCompany={companyPickerProps((url) => updateImage('sectionImage3', url))}
              imageType="section3"
            />
          </div>
        </div>

        {/* About & Team Images */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Image className="h-4 w-4 text-primary" />
            <FieldLabel className="text-foreground font-medium" hint="Images used in about and team sections to add visual interest and personalization.">
              About & Team Images
            </FieldLabel>
          </div>
          <div className="space-y-3 pl-6">
            <ImageUploadField
              label="About Image"
              hint="Image for your about section. It should reflect your company culture or values."
              value={data.images.aboutImage}
              onChange={v => updateImage('aboutImage', v)}
              onPickCompany={companyPickerProps((url) => updateImage('aboutImage', url))}
              imageType="about"
            />
            <ImageUploadField
              label="Team Image"
              hint="Team photo or group image representing your company personnel."
              value={data.images.teamImage}
              onChange={v => updateImage('teamImage', v)}
              onPickCompany={companyPickerProps((url) => updateImage('teamImage', url))}
              imageType="team"
            />
          </div>
        </div>

        {/* Product Images */}
        {data.images.productImages.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Image className="h-4 w-4 text-primary" />
              <FieldLabel className="text-foreground font-medium" hint="Product photos for your e-commerce store. Use square or consistent aspect ratio images.">
                Product Images
              </FieldLabel>
            </div>
            <div className="space-y-2 pl-6">
              {data.images.productImages.map((img, i) => (
                <div key={i} className="flex gap-2 items-end">
                  <div className="flex-1">
                    <ImageUploadField
                      label={`Product Image ${i + 1}`}
                      value={img}
                      onChange={v => updateProductImage(i, v)}
                      imageType={`product-${i}`}
                    />
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => removeProductImage(i)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={addProductImage} className="gap-1">
                <Plus className="h-3 w-3" /> Add Product Image
              </Button>
            </div>
          </div>
        )}
      </div>

      <CompanyImagePicker
        open={pickerTarget !== null}
        onOpenChange={(o) => { if (!o) setPickerTarget(null); }}
        assets={companyAssets}
        onSelect={(url) => { pickerTarget?.apply(url); setPickerTarget(null); }}
      />
    </div>
  );
}
