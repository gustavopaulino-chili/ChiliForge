import { AdCreativeFormData, AD_PLATFORM_LABELS } from '@/types/adCreativeForm';
import { Check, AlertCircle } from 'lucide-react';

interface Props {
  data: AdCreativeFormData;
}

function ReviewRow({ label, value }: { label: string; value: string | undefined | null }) {
  if (!value) return null;
  return (
    <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-4 py-2 border-b border-border/50 last:border-0">
      <dt className="text-xs font-medium text-muted-foreground sm:w-40 shrink-0">{label}</dt>
      <dd className="text-sm text-foreground break-words">{value}</dd>
    </div>
  );
}

function ColorSwatch({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-6 w-6 rounded border border-border shrink-0" style={{ backgroundColor: color }} />
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs font-mono text-foreground">{color}</span>
    </div>
  );
}

const OBJECTIVE_LABELS: Record<string, string> = {
  'lead-generation': 'Lead Generation',
  'sales':           'Sales Conversion',
  'awareness':       'Brand Awareness',
  'product-launch':  'Product Launch',
  'retargeting':     'Retargeting',
  'engagement':      'Engagement',
  'app-install':     'App Install',
  'whatsapp':        'WhatsApp Conversion',
  'traffic':         'Traffic',
  'event':           'Event Promotion',
};

const FUNNEL_LABELS: Record<string, string> = {
  awareness:     'Top of Funnel (Awareness)',
  consideration: 'Mid-Funnel (Consideration)',
  conversion:    'Bottom of Funnel (Conversion)',
};

const STRATEGY_LABELS: Record<string, string> = {
  'problem-solution': 'Problem / Solution',
  'before-after':     'Before / After',
  'testimonial':      'Testimonial',
  'ugc':              'UGC Style',
  'founder-story':    'Founder Story',
  'educational':      'Educational',
  'emotional':        'Emotional',
  'luxury-premium':   'Luxury / Premium',
  'direct-response':  'Direct Response',
  'meme-trend':       'Meme / Trend-Based',
  'comparison':       'Comparison',
  'authority':        'Authority-Based',
  'lifestyle':        'Lifestyle',
  'product-showcase': 'Product Showcase',
  'other':            'Other',
};

export function StepAdReview({ data }: Props) {
  const enabledFormats = data.selectedFormats.filter(f => f.enabled);
  const formatNotes = Object.entries(data.formatNotes || {}).filter(([, note]) => note.trim());
  const headlineVariants = (data.headlineVariants || []).slice(0, data.abVariantCount).filter(Boolean);
  const ctaVariants = (data.ctaVariants || []).slice(0, data.abVariantCount).filter(Boolean);
  const productImageVariants = (data.productImageVariants || []).slice(0, data.abVariantCount).filter(Boolean);
  const backgroundImageVariants = (data.backgroundImageVariants || []).slice(0, data.abVariantCount).filter(Boolean);

  const warnings: string[] = [];
  if (!data.campaignName) warnings.push('Campaign name is missing');
  if (!data.brandName) warnings.push('Brand name is missing');
  if (!data.productName) warnings.push('Product / service name is missing');
  if (!data.valueProposition) warnings.push('Value proposition is missing');
  if (data.selectedPlatforms.length === 0) warnings.push('No platforms selected');
  if (enabledFormats.length === 0) warnings.push('No ad formats selected');

  return (
    <div className="space-y-5">
      <div>
        <h3 className="form-section-title">Review & Generate</h3>
        <p className="form-section-desc">Review everything before generating the creatives</p>
      </div>

      {warnings.length > 0 && (
        <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-4 space-y-2">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-destructive" />
            <span className="text-sm font-medium text-destructive">Missing required fields</span>
          </div>
          <ul className="list-disc list-inside space-y-1">
            {warnings.map(w => <li key={w} className="text-xs text-destructive">{w}</li>)}
          </ul>
        </div>
      )}

      {/* Objective & Funnel */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-3">
        <h4 className="text-sm font-semibold text-foreground">Objective & Funnel</h4>
        <dl className="divide-y-0">
          <ReviewRow label="Funnel Stage"        value={FUNNEL_LABELS[data.funnelStage]} />
          <ReviewRow label="Campaign Objective"  value={data.campaignObjective ? OBJECTIVE_LABELS[data.campaignObjective] : null} />
          <ReviewRow label="Campaign Name"       value={data.campaignName} />
        </dl>
      </div>

      {(data.websiteUrl || data.context || data.brandBookFileName) && (
        <div className="rounded-xl border border-border bg-card p-5 space-y-3">
          <h4 className="text-sm font-semibold text-foreground">Import & Context</h4>
          <dl className="divide-y-0">
            <ReviewRow label="Website URL" value={data.websiteUrl} />
            <ReviewRow label="Brand Book" value={data.brandBookFileName} />
            <ReviewRow label="Extra Context" value={data.context} />
          </dl>
        </div>
      )}

      {/* Platforms & Formats */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-3">
        <h4 className="text-sm font-semibold text-foreground">Platforms & Formats</h4>
        {data.selectedPlatforms.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {data.selectedPlatforms.map(p => (
              <span key={p} className="text-xs bg-primary/10 text-primary rounded-full px-3 py-1">
                {AD_PLATFORM_LABELS[p]}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No platforms selected</p>
        )}
        {enabledFormats.length > 0 && (
          <div className="mt-2 space-y-1">
            {enabledFormats.map(fmt => (
              <div key={`${fmt.platform}-${fmt.label}`} className="flex items-center gap-2">
                <Check className="h-3.5 w-3.5 text-success shrink-0" />
                <span className="text-xs text-foreground">{fmt.label}</span>
                <span className="text-xs text-muted-foreground">({fmt.width}×{fmt.height})</span>
              </div>
            ))}
          </div>
        )}
        {data.abTestingEnabled && (
          <div className="mt-3 rounded-lg bg-primary/10 border border-primary/20 p-3 text-xs text-primary space-y-1.5">
            <p>A/B: {enabledFormats.length} format{enabledFormats.length !== 1 ? 's' : ''} × {data.abVariantCount} variants = <strong>{enabledFormats.length * data.abVariantCount}</strong> creatives. Focus: {data.abTestFocus}.</p>
            {headlineVariants.length > 0 && <p>Headline variants: {headlineVariants.join(' | ')}</p>}
            {ctaVariants.length > 0 && <p>CTA variants: {ctaVariants.join(' | ')}</p>}
            {(productImageVariants.length > 0 || backgroundImageVariants.length > 0) && <p>Visual variants: {productImageVariants.length} product image(s), {backgroundImageVariants.length} background image(s).</p>}
          </div>
        )}
        {formatNotes.length > 0 && (
          <div className="mt-3 space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Format notes sent to AI:</p>
            {formatNotes.map(([key, note]) => (
              <p key={key} className="text-xs text-foreground"><span className="text-muted-foreground">{key}:</span> {note}</p>
            ))}
          </div>
        )}
      </div>

      {/* Brand Identity */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-3">
        <h4 className="text-sm font-semibold text-foreground">Brand Identity</h4>
        <dl className="divide-y-0">
          <ReviewRow label="Brand Name"       value={data.brandName} />
          <ReviewRow label="Industry"         value={data.industry} />
          <ReviewRow label="Style"            value={data.preferredStyle} />
          <ReviewRow label="Heading Font"     value={data.customHeadingFont ? `${data.customHeadingFont.name} (custom upload)` : data.headingFont || 'Not specified'} />
          <ReviewRow label="Body Font"        value={data.customBodyFont ? `${data.customBodyFont.name} (custom upload)` : data.bodyFont || 'Not specified'} />
          <ReviewRow label="Brand Keywords"   value={data.brandKeywords} />
          <ReviewRow label="Forbidden Words"  value={data.forbiddenWords} />
        </dl>
        <div className="flex flex-wrap gap-3 pt-2">
          <ColorSwatch color={data.primaryColor}    label="Primary" />
          <ColorSwatch color={data.secondaryColor}  label="Secondary" />
          <ColorSwatch color={data.accentColor}     label="Accent" />
          <ColorSwatch color={data.textColor}       label="Text" />
          <ColorSwatch color={data.backgroundColor} label="Background" />
        </div>
      </div>

      {/* Strategy */}
      {(data.creativeStrategy || !data.useAiCopy) && (
        <div className="rounded-xl border border-border bg-card p-5 space-y-3">
          <h4 className="text-sm font-semibold text-foreground">Creative Strategy</h4>
          <dl className="divide-y-0">
            <ReviewRow label="Angle" value={data.creativeStrategy ? STRATEGY_LABELS[data.creativeStrategy] : null} />
            <ReviewRow label="Copy Mode" value={data.useAiCopy ? 'AI-generated' : 'User-provided'} />
            {!data.useAiCopy && <ReviewRow label="Headline" value={data.mainHeadline} />}
            {!data.useAiCopy && <ReviewRow label="Subheadline" value={data.subheadline} />}
            <ReviewRow label="CTA Text" value={data.ctaText} />
          </dl>
        </div>
      )}

      {/* Copy & Audience */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-3">
        <h4 className="text-sm font-semibold text-foreground">Copy & Audience</h4>
        <dl className="divide-y-0">
          <ReviewRow label="Product / Service"  value={data.productName} />
          <ReviewRow label="Value Proposition"  value={data.valueProposition} />
          <ReviewRow label="Main Offer"         value={data.offer} />
          <ReviewRow label="Pricing"            value={data.pricing} />
          <ReviewRow label="Discount"           value={data.discount} />
          <ReviewRow label="Guarantee"          value={data.guarantee} />
          <ReviewRow label="Scarcity"           value={data.scarcity} />
          <ReviewRow label="Target Audience"    value={data.targetAudience} />
          <ReviewRow label="Age Range"          value={data.ageRange} />
          <ReviewRow label="Gender"             value={data.gender !== 'all' ? data.gender : null} />
          <ReviewRow label="Pain Points"        value={data.painPoints} />
          <ReviewRow label="Desires"            value={data.desires} />
          <ReviewRow label="Tone of Voice"      value={data.toneOfVoice} />
          <ReviewRow label="Urgency Level"      value={data.urgencyLevel} />
        </dl>
      </div>

      {/* Visual Assets */}
      {(data.logoUrl || data.productImageUrl || data.backgroundImageUrl || data.logoVariants?.length > 0 || productImageVariants.length > 0 || backgroundImageVariants.length > 0) && (
        <div className="rounded-xl border border-border bg-card p-5 space-y-3">
          <h4 className="text-sm font-semibold text-foreground">Visual Assets</h4>
          <div className="flex flex-wrap gap-4">
            {data.logoUrl && (
              <div className="text-center space-y-1">
                <img src={data.logoUrl} alt="Logo" className="h-16 w-16 object-contain rounded border border-border bg-muted/30" />
                <p className="text-xs text-muted-foreground">Primary Logo</p>
              </div>
            )}
            {(data.logoVariants || []).map(variant => (
              <div key={variant.id} className="text-center space-y-1">
                <img src={variant.url} alt={variant.label} className="h-16 w-16 object-contain rounded border border-border bg-muted/30" />
                <p className="text-xs text-muted-foreground">{variant.label || 'Logo Variant'}</p>
              </div>
            ))}
            {data.productImageUrl && (
              <div className="text-center space-y-1">
                <img src={data.productImageUrl} alt="Product" className="h-16 w-16 object-contain rounded border border-border bg-muted/30" />
                <p className="text-xs text-muted-foreground">Product</p>
              </div>
            )}
            {data.backgroundImageUrl && (
              <div className="text-center space-y-1">
                <img src={data.backgroundImageUrl} alt="Background" className="h-16 w-16 object-cover rounded border border-border" />
                <p className="text-xs text-muted-foreground">Background</p>
              </div>
            )}
          </div>
          <dl className="divide-y-0 pt-2">
            <ReviewRow label="Logo Strategy" value={data.preferredLogoStrategy} />
            {productImageVariants.length > 0 && <ReviewRow label="Product A/B Images" value={`${productImageVariants.length} variant image(s) provided`} />}
            {backgroundImageVariants.length > 0 && <ReviewRow label="Background A/B Images" value={`${backgroundImageVariants.length} variant image(s) provided`} />}
          </dl>
        </div>
      )}
    </div>
  );
}
