import { useRef, useState } from 'react';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { AdCreativeFormData } from '@/types/adCreativeForm';
import { AlertCircle, BookOpen, Check, Loader2, MessageSquare, Sparkles, Tag, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { analyzeAdBrief, analyzeBrandBook } from '@/services/api';

interface Props {
  data: AdCreativeFormData;
  onChange: (updates: Partial<AdCreativeFormData>) => void;
  brandBookFile: File | null;
  onBrandBookFile: (file: File | null) => void;
}

function normalizeColor(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const v = value.trim();
  const hexMatch = v.match(/#([0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3})(?:[^0-9a-f]|$)/i);
  if (hexMatch) {
    const raw = hexMatch[1].toLowerCase();
    if (raw.length === 3) return '#' + raw[0] + raw[0] + raw[1] + raw[1] + raw[2] + raw[2];
    if (raw.length === 8) return '#' + raw.slice(0, 6);
    return '#' + raw;
  }
  const rgb = v.match(/rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i);
  if (rgb) return '#' + [rgb[1], rgb[2], rgb[3]].map(n => parseInt(n).toString(16).padStart(2, '0')).join('');
  const rgba = v.match(/rgba\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,[^)]+\)/i);
  if (rgba) return '#' + [rgba[1], rgba[2], rgba[3]].map(n => parseInt(n).toString(16).padStart(2, '0')).join('');
  return null;
}

function pickEnum<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  if (typeof value !== 'string') return null;
  const normalized = value.toLowerCase().trim();
  return (allowed as readonly string[]).includes(normalized) ? normalized as T : null;
}

function pickStringArray(value: unknown, max = 3): string[] {
  return Array.isArray(value)
    ? value.map(item => String(item || '').trim()).filter(Boolean).slice(0, max)
    : [];
}

export function briefDataToAdUpdates(extracted: Record<string, unknown>): Partial<AdCreativeFormData> {
  const updates: Partial<AdCreativeFormData> = {};

  if (extracted.campaignName) updates.campaignName = String(extracted.campaignName);
  const objective = pickEnum(extracted.campaignObjective, ['lead-generation', 'sales', 'awareness', 'product-launch', 'retargeting', 'engagement', 'app-install', 'whatsapp', 'traffic', 'event', ''] as const);
  if (objective !== null) updates.campaignObjective = objective;
  const funnelStage = pickEnum(extracted.funnelStage, ['awareness', 'consideration', 'conversion'] as const);
  if (funnelStage) updates.funnelStage = funnelStage;

  if (extracted.businessName) updates.brandName = String(extracted.businessName);
  if (extracted.brandName) updates.brandName = String(extracted.brandName);
  if (extracted.industry) updates.industry = String(extracted.industry);
  if (extracted.brandKeywords) updates.brandKeywords = String(extracted.brandKeywords);
  if (extracted.forbiddenWords) updates.forbiddenWords = String(extracted.forbiddenWords);
  if (!updates.forbiddenWords && extracted.forbiddenUsage) updates.forbiddenWords = String(extracted.forbiddenUsage);
  if (extracted.productName) updates.productName = String(extracted.productName);
  if (extracted.mainHeadline) updates.mainHeadline = String(extracted.mainHeadline);
  if (extracted.subheadline) updates.subheadline = String(extracted.subheadline);
  if (extracted.offer) updates.offer = String(extracted.offer);
  if (extracted.pricing) updates.pricing = String(extracted.pricing);
  if (extracted.discount) updates.discount = String(extracted.discount);
  if (extracted.guarantee) updates.guarantee = String(extracted.guarantee);
  if (extracted.scarcity) updates.scarcity = String(extracted.scarcity);
  if (extracted.valueProposition) updates.valueProposition = String(extracted.valueProposition);
  if (extracted.ctaText) updates.ctaText = String(extracted.ctaText);
  if (extracted.targetAudience) updates.targetAudience = String(extracted.targetAudience);
  if (extracted.ageRange) updates.ageRange = String(extracted.ageRange);

  const gender = pickEnum(extracted.gender, ['all', 'male', 'female'] as const);
  if (gender) updates.gender = gender;
  if (extracted.painPoints) updates.painPoints = String(extracted.painPoints);
  if (extracted.desires) updates.desires = String(extracted.desires);

  const tone = pickEnum(extracted.toneOfVoice, ['formal', 'casual', 'inspirational', 'authoritative', 'conversational', 'urgent', 'empathetic'] as const)
    || pickEnum(extracted.brandVoice, ['formal', 'casual', 'inspirational', 'authoritative', 'conversational', 'urgent', 'empathetic'] as const);
  if (tone) updates.toneOfVoice = tone;
  const urgency = pickEnum(extracted.urgencyLevel, ['none', 'low', 'medium', 'high'] as const);
  if (urgency) updates.urgencyLevel = urgency;
  const strategy = pickEnum(extracted.creativeStrategy, ['problem-solution', 'before-after', 'testimonial', 'ugc', 'founder-story', 'educational', 'emotional', 'luxury-premium', 'direct-response', 'meme-trend', 'comparison', 'authority', 'lifestyle', 'product-showcase', 'other', ''] as const);
  if (strategy !== null) updates.creativeStrategy = strategy;
  if (extracted.creativeStrategyOther) updates.creativeStrategyOther = String(extracted.creativeStrategyOther);

  const validStyles = ['modern', 'corporate', 'minimal', 'bold', 'premium', 'luxury', 'futuristic', 'cinematic', 'clean', 'high-contrast'] as const;
  const styleMap: Record<string, typeof validStyles[number]> = {
    editorial: 'minimal',
    energetic: 'bold',
    saas: 'modern',
    tech: 'modern',
    luxury: 'premium',
    elegant: 'premium',
    'high-end': 'premium',
    dramatic: 'bold',
    creative: 'bold',
    corporate: 'corporate',
  };
  const extractedStyle = extracted.preferredStyle || extracted.visualStyle;
  if (extractedStyle) {
    const raw = String(extractedStyle).toLowerCase().trim();
    updates.preferredStyle = (validStyles as readonly string[]).includes(raw)
      ? (raw as typeof validStyles[number])
      : (styleMap[raw] ?? 'modern');
  }

  const primaryColor = normalizeColor(extracted.primaryColor);
  if (primaryColor) updates.primaryColor = primaryColor;
  const secondaryColor = normalizeColor(extracted.secondaryColor);
  if (secondaryColor) updates.secondaryColor = secondaryColor;
  const accentColor = normalizeColor(extracted.accentColor);
  if (accentColor) updates.accentColor = accentColor;
  const textColor = normalizeColor(extracted.textColor);
  if (textColor) updates.textColor = textColor;
  const backgroundColor = normalizeColor(extracted.backgroundColor);
  if (backgroundColor) updates.backgroundColor = backgroundColor;

  if (extracted.headingFont) updates.headingFont = String(extracted.headingFont);
  if (extracted.bodyFont) updates.bodyFont = String(extracted.bodyFont);
  if (extracted.logoUrl) updates.logoUrl = String(extracted.logoUrl);

  const headlines = pickStringArray(extracted.headlineVariants, 3);
  if (headlines.length) updates.headlineVariants = headlines;
  const ctas = pickStringArray(extracted.ctaVariants, 3);
  if (ctas.length) updates.ctaVariants = ctas;
  if (typeof extracted.abTestingEnabled === 'boolean') updates.abTestingEnabled = extracted.abTestingEnabled;
  const abVariantCount = Number(extracted.abVariantCount);
  if (abVariantCount === 2 || abVariantCount === 3) updates.abVariantCount = abVariantCount;
  const abFocus = pickEnum(extracted.abTestFocus, ['headline', 'cta', 'visual', 'color', 'mixed'] as const);
  if (abFocus) updates.abTestFocus = abFocus;
  if (extracted.context) updates.context = String(extracted.context);

  return updates;
}

export function StepAdImport({ data, onChange, brandBookFile, onBrandBookFile }: Props) {
  const [isAnalyzingBrief, setIsAnalyzingBrief] = useState(false);
  const [briefResult, setBriefResult] = useState<{ fields: string[] } | null>(null);
  const [isAnalyzingBrandBook, setIsAnalyzingBrandBook] = useState(false);
  const [brandBookResult, setBrandBookResult] = useState<{ fields: string[]; pending?: boolean } | null>(null);
  const [brandBookSummary, setBrandBookSummary] = useState('');
  const [brandBookError, setBrandBookError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const getFilledFields = (updates: Partial<AdCreativeFormData>) => Object.keys(updates).filter((key) => {
    const value = (updates as Record<string, unknown>)[key];
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'object' && value !== null) return Object.keys(value).length > 0;
    return value !== '' && value !== null && value !== undefined;
  });

  const handleAnalyzeBrief = async () => {
    if (!data.context.trim() || data.context.trim().length < 20) {
      toast.error('Describe the campaign with at least 20 characters.');
      return;
    }

    setIsAnalyzingBrief(true);
    setBriefResult(null);
    try {
      const result = await analyzeAdBrief(data.context.trim(), data as unknown as Record<string, unknown>);
      const extracted = result.extracted;
      if (!extracted) throw new Error('No data extracted from campaign description');
      const updates = briefDataToAdUpdates(extracted);
      const matched = getFilledFields(updates);
      onChange({ ...updates, context: data.context.trim() });
      setBriefResult({ fields: matched });
      toast.success(`AI filled ${matched.length} campaign field${matched.length === 1 ? '' : 's'} from the brief.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to analyze campaign brief');
    } finally {
      setIsAnalyzingBrief(false);
    }
  };

  const handleBrandBookFile = async (file: File) => {
    onBrandBookFile(file);
    onChange({ brandBookFileName: file.name });
    setBrandBookResult(null);
    setBrandBookSummary('');
    setBrandBookError('');

    if (file.size > 12 * 1024 * 1024) {
      setBrandBookResult({ fields: [], pending: true });
      setBrandBookError('Brand book attached, but this file is too large for browser AI extraction. It will stay saved with the campaign draft; use a smaller PDF/image to extract brand fields now.');
      toast.info(`Brand book "${file.name}" attached. AI extraction was skipped because the file is too large.`);
      return;
    }

    setIsAnalyzingBrandBook(true);
    try {
      const result = await analyzeBrandBook(file, data as unknown as Record<string, unknown>);
      const extracted = result.extracted || {};
      const updates = briefDataToAdUpdates(extracted);
      const matched = getFilledFields(updates);

      onChange({ brandBookFileName: file.name, brandBookExtractedData: extracted });
      setBrandBookSummary(JSON.stringify(extracted, null, 2));
      setBrandBookResult({ fields: matched, pending: Boolean(result.pending) });

      if (result.pending) {
        setBrandBookError(result.message || 'Brand book attached. AI extraction is pending.');
        toast.info(result.message || `Brand book "${file.name}" attached. AI extraction is pending.`);
      } else {
        toast.success(`Brand book analyzed. Review the extraction before applying ${matched.length} field${matched.length === 1 ? '' : 's'}.`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Brand book AI extraction failed';
      setBrandBookResult({ fields: [], pending: true });
      setBrandBookError(`Brand book attached, but AI extraction is unavailable right now: ${message}`);
      toast.error('Brand book attached, but AI extraction failed. You can continue manually.');
    } finally {
      setIsAnalyzingBrandBook(false);
    }
  };

  const removeBrandBook = () => {
    onBrandBookFile(null);
    onChange({ brandBookFileName: '', brandBookExtractedData: {} });
    setBrandBookResult(null);
    setBrandBookSummary('');
    setBrandBookError('');
    if (fileRef.current) fileRef.current.value = '';
    toast.info('Brand book removed');
  };

  const applyBrandBookExtraction = () => {
    try {
      const extracted = JSON.parse(brandBookSummary || '{}') as Record<string, unknown>;
      const updates = briefDataToAdUpdates(extracted);
      const matched = getFilledFields(updates);
      onChange({ ...updates, brandBookExtractedData: extracted });
      setBrandBookResult({ fields: matched });
      toast.success(`Applied ${matched.length} brand field${matched.length === 1 ? '' : 's'} to the campaign.`);
    } catch {
      toast.error('Review summary must be valid JSON before applying.');
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h3 className="form-section-title">Campaign Setup</h3>
        <p className="form-section-desc">
          Name this campaign and optionally describe the specific offer, audience, and creative direction for AI autofill.
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Tag className="h-4 w-4 text-primary" />
          <Label className="text-sm font-semibold text-foreground">Campaign Name</Label>
          <span className="text-xs text-destructive font-medium">*required</span>
        </div>
        <Input
          placeholder="e.g. Summer Sale 2026, Product Launch - Brand"
          value={data.campaignName}
          onChange={e => onChange({ campaignName: e.target.value })}
          className={!data.campaignName.trim() ? 'border-destructive/50 focus-visible:ring-destructive/30' : ''}
        />
        {!data.campaignName.trim() && (
          <p className="text-xs text-destructive/80">This name will be used as the project folder.</p>
        )}
      </div>

      <div className="space-y-3 rounded-lg border border-primary/25 bg-primary/5 p-4">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-primary" />
          <Label className="text-sm font-semibold text-foreground">Campaign Description for AI Autofill</Label>
          <span className="text-xs text-muted-foreground">(optional)</span>
        </div>
        <Textarea
          placeholder="Describe this campaign only. Example: Launch campaign for a premium skincare serum, targeting women 25-40, offer 20% off this week, minimalist luxury visual style, CTA 'Shop now'."
          value={data.context}
          onChange={e => onChange({ context: e.target.value })}
          className="min-h-[110px] text-sm"
        />
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            AI will interpret this brief and fill objective, offer, audience, copy, strategy, and A/B suggestions.
          </p>
          <Button
            type="button"
            onClick={handleAnalyzeBrief}
            disabled={isAnalyzingBrief || data.context.trim().length < 20}
            className="gap-2 shrink-0"
          >
            {isAnalyzingBrief ? (
              <><Loader2 className="h-4 w-4 animate-spin" />Filling...</>
            ) : (
              <><Sparkles className="h-4 w-4" />Fill Campaign with AI</>
            )}
          </Button>
        </div>

        {briefResult && !isAnalyzingBrief && (
          <div className="rounded-lg bg-success/10 border border-success/20 p-4 space-y-2">
            <div className="flex items-center gap-2">
              <Check className="h-4 w-4 text-success" />
              <span className="text-sm font-medium text-success">Campaign brief interpreted successfully!</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {briefResult.fields.map(field => (
                <span key={field} className="text-xs bg-success/10 text-success rounded px-2 py-0.5">{field}</span>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <BookOpen className="h-4 w-4 text-primary" />
          <Label className="text-sm font-semibold text-foreground">Upload Brand Book</Label>
        </div>
        <p className="text-xs text-muted-foreground -mt-2">
          Upload a brand guide. AI extracts colors, fonts, voice, logo guidance, visual rules, and forbidden usage for review before anything is applied.
        </p>

        <input
          ref={fileRef}
          type="file"
          accept="*"
          className="hidden"
          onChange={e => {
            const file = e.target.files?.[0];
            if (file) handleBrandBookFile(file);
          }}
        />

        {brandBookFile || data.brandBookFileName ? (
          <div className="space-y-3">
            <div className="rounded-lg border border-success/30 bg-success/5 p-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                {isAnalyzingBrandBook ? (
                  <Loader2 className="h-5 w-5 text-success shrink-0 animate-spin" />
                ) : (
                  <BookOpen className="h-5 w-5 text-success shrink-0" />
                )}
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground truncate">
                    {brandBookFile?.name || data.brandBookFileName}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {isAnalyzingBrandBook
                      ? 'Analyzing brand book...'
                      : brandBookResult?.pending
                        ? 'Attached - extraction pending/unavailable'
                        : brandBookSummary
                          ? 'Extraction ready for review'
                          : 'Brand book attached'}
                  </div>
                </div>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={removeBrandBook} className="shrink-0 gap-1.5 text-muted-foreground">
                <X className="h-4 w-4" />Remove
              </Button>
            </div>

            {brandBookError && (
              <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-xs text-amber-200">
                {brandBookError}
              </div>
            )}

            {brandBookSummary && (
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-foreground">Review extracted brand guidance</div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Edit the extraction if needed, then apply it to campaign fields.
                    </p>
                  </div>
                  <Button type="button" size="sm" onClick={applyBrandBookExtraction} className="gap-2 shrink-0">
                    <Check className="h-4 w-4" />Apply brand fields
                  </Button>
                </div>

                {brandBookResult?.fields.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {brandBookResult.fields.map(field => (
                      <span key={field} className="text-xs bg-primary/10 text-primary rounded px-2 py-0.5">{field}</span>
                    ))}
                  </div>
                ) : null}

                <Textarea
                  value={brandBookSummary}
                  onChange={e => setBrandBookSummary(e.target.value)}
                  className="min-h-[220px] font-mono text-xs"
                />
              </div>
            )}
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            onClick={() => fileRef.current?.click()}
            className="gap-2 w-full h-20 border-dashed"
          >
            <Upload className="h-5 w-5" />
            <span>Click to upload Brand Book (PDF, image, or any file)</span>
          </Button>
        )}
      </div>

      <div className="rounded-lg bg-muted/50 p-4">
        <div className="flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-muted-foreground mt-0.5" />
          <div className="text-xs text-muted-foreground space-y-1">
            <p><strong>Campaign brief:</strong> Use this only for campaign-specific instructions, not the full company profile.</p>
            <p><strong>Brand Book:</strong> AI extraction is reviewed first. Fields are only changed when you apply the extracted summary.</p>
            <p>All imported fields can be edited in the following steps.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
