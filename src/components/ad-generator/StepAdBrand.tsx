import { useRef } from 'react';
import { Input } from '@/components/ui/input';
import { AdCreativeFormData, AdCustomFont } from '@/types/adCreativeForm';
import { FieldLabel } from '@/components/generator/FieldLabel';
import { Upload, X } from 'lucide-react';

interface Props {
  data: AdCreativeFormData;
  onChange: (updates: Partial<AdCreativeFormData>) => void;
}

const AD_STYLE_OPTIONS: { value: AdCreativeFormData['preferredStyle']; label: string; desc: string }[] = [
  { value: 'modern',       label: 'Modern',       desc: 'Clean lines, contemporary design, tech-forward' },
  { value: 'bold',         label: 'Bold',         desc: 'High contrast, strong typography, energetic' },
  { value: 'minimal',      label: 'Minimal',      desc: 'White space, simplicity, editorial feel' },
  { value: 'premium',      label: 'Premium',      desc: 'Refined, quality-focused, aspirational' },
  { value: 'luxury',       label: 'Luxury',       desc: 'Opulent, dark tones, gold accents, exclusive' },
  { value: 'corporate',    label: 'Corporate',    desc: 'Professional, trustworthy, structured' },
  { value: 'cinematic',    label: 'Cinematic',    desc: 'Film-inspired, dramatic composition, moody' },
  { value: 'futuristic',   label: 'Futuristic',   desc: 'Sci-fi, neon, gradient tech, cyberpunk' },
  { value: 'clean',        label: 'Clean',        desc: 'Airy, light, maximum readability, SaaS style' },
  { value: 'high-contrast',label: 'High Contrast',desc: 'Black/white extremes, maximum visual impact' },
];

const FONT_FORMAT_MAP: Record<string, AdCustomFont['format']> = {
  ttf: 'truetype', otf: 'opentype', woff: 'woff', woff2: 'woff2',
};

function FontRow({
  label,
  hint,
  inputId,
  placeholder,
  googleFontValue,
  customFont,
  onGoogleFontChange,
  onCustomFontChange,
}: {
  label: string;
  hint: string;
  inputId: string;
  placeholder: string;
  googleFontValue: string;
  customFont: AdCustomFont | null;
  onGoogleFontChange: (name: string) => void;
  onCustomFontChange: (font: AdCustomFont | null) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (e.target) e.target.value = '';
    if (!file) return;
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    if (!FONT_FORMAT_MAP[ext]) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUri = reader.result as string;
      const name = file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ').trim();
      onCustomFontChange({ name, fileName: file.name, dataUri, format: FONT_FORMAT_MAP[ext] });
      onGoogleFontChange(name);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div>
      <FieldLabel htmlFor={inputId} className="text-xs text-muted-foreground" hint={hint}>
        {label}
      </FieldLabel>

      {customFont ? (
        <div className="mt-1.5 flex items-center gap-2 rounded-md border border-primary/50 bg-primary/8 px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-primary truncate">{customFont.name}</p>
            <p className="text-[10px] text-muted-foreground truncate">{customFont.fileName}</p>
          </div>
          <button
            type="button"
            onClick={() => { onCustomFontChange(null); onGoogleFontChange(''); }}
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            title="Remove custom font"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <div className="flex gap-2 mt-1">
          <Input
            id={inputId}
            value={googleFontValue}
            onChange={e => onGoogleFontChange(e.target.value)}
            placeholder={placeholder}
            className="text-sm"
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            title="Upload a custom font file (.ttf, .otf, .woff, .woff2)"
            className="shrink-0 flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:border-primary/60 hover:text-primary transition-colors whitespace-nowrap"
          >
            <Upload className="h-3 w-3" /> Upload
          </button>
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept=".ttf,.otf,.woff,.woff2"
        className="hidden"
        onChange={handleFile}
      />

      {!customFont && (
        <p className="text-[10px] text-muted-foreground mt-1 leading-tight">
          Type a Google Fonts name above, or upload a custom font file (.ttf, .otf, .woff, .woff2) — custom fonts override Google Fonts and are embedded directly in the ad.
        </p>
      )}
    </div>
  );
}

export function StepAdBrand({ data, onChange }: Props) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="form-section-title">Brand Identity</h3>
        <p className="form-section-desc">Visual identity and brand positioning for the creatives</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <FieldLabel htmlFor="brandName" required>Brand Name</FieldLabel>
          <Input
            id="brandName"
            value={data.brandName}
            onChange={e => onChange({ brandName: e.target.value })}
            placeholder="e.g. ChiliForge"
          />
        </div>
        <div className="space-y-2">
          <FieldLabel htmlFor="industry" hint="Business sector or niche. Helps AI contextualize the messaging.">
            Industry / Niche
          </FieldLabel>
          <Input
            id="industry"
            value={data.industry}
            onChange={e => onChange({ industry: e.target.value })}
            placeholder="e.g. SaaS, E-commerce, Health & Wellness, Finance"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <FieldLabel htmlFor="brandKeywords" hint="Words that should appear or guide the tone of the ads. Separate by comma.">
            Brand Keywords
          </FieldLabel>
          <Input
            id="brandKeywords"
            value={data.brandKeywords}
            onChange={e => onChange({ brandKeywords: e.target.value })}
            placeholder="e.g. innovation, results, trust, speed"
          />
        </div>
        <div className="space-y-2">
          <FieldLabel htmlFor="forbiddenWords" hint="Words or expressions the AI should NOT use. Separate by comma.">
            Forbidden Words
          </FieldLabel>
          <Input
            id="forbiddenWords"
            value={data.forbiddenWords}
            onChange={e => onChange({ forbiddenWords: e.target.value })}
            placeholder="e.g. cheap, bargain, aggressive discount"
          />
        </div>
      </div>

      {/* Style */}
      <div className="space-y-3">
        <FieldLabel required hint="Visual style that best represents the brand in the ads.">
          Visual Style
        </FieldLabel>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {AD_STYLE_OPTIONS.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange({ preferredStyle: opt.value })}
              className={`rounded-lg border p-3 text-left transition-all ${
                data.preferredStyle === opt.value
                  ? 'border-primary bg-primary/5 ring-1 ring-primary'
                  : 'border-border hover:border-muted-foreground/30'
              }`}
            >
              <div className="font-medium text-foreground text-xs">{opt.label}</div>
              <div className="text-xs text-muted-foreground mt-0.5 leading-tight">{opt.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Colors */}
      <div className="space-y-3">
        <FieldLabel hint="Brand color palette for the banners.">Color Palette</FieldLabel>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {[
            { key: 'primaryColor' as const,    label: 'Primary',    hint: 'Main color — backgrounds, buttons, CTAs.' },
            { key: 'secondaryColor' as const,  label: 'Secondary',  hint: 'Complementary color for accents and gradients.' },
            { key: 'accentColor' as const,     label: 'Accent',     hint: 'Highlight for badges, icons, key elements.' },
            { key: 'textColor' as const,       label: 'Text',       hint: 'Main text color.' },
            { key: 'backgroundColor' as const, label: 'Background', hint: 'Banner background color.' },
          ].map(c => (
            <div key={c.key}>
              <FieldLabel htmlFor={c.key} hint={c.hint}>{c.label}</FieldLabel>
              <div className="flex gap-2 mt-1.5">
                <input
                  type="color"
                  id={c.key}
                  value={data[c.key]}
                  onChange={e => onChange({ [c.key]: e.target.value })}
                  className="h-10 w-12 rounded-md border border-input cursor-pointer"
                />
                <Input
                  value={data[c.key]}
                  onChange={e => onChange({ [c.key]: e.target.value })}
                  className="font-mono text-sm"
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Fonts */}
      <div className="space-y-3">
        <FieldLabel hint="Fonts for the ads. Type a Google Fonts name or upload a custom font file.">
          Typography
        </FieldLabel>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FontRow
            label="Heading Font"
            hint="Applied to all headlines. Google Fonts name (e.g. Montserrat) or upload a custom file."
            inputId="headingFont"
            placeholder="e.g. Montserrat"
            googleFontValue={data.headingFont}
            customFont={data.customHeadingFont ?? null}
            onGoogleFontChange={name => onChange({ headingFont: name })}
            onCustomFontChange={font => onChange({ customHeadingFont: font, headingFont: font?.name ?? '' })}
          />
          <FontRow
            label="Body Font"
            hint="Applied to all body text. Google Fonts name (e.g. Open Sans) or upload a custom file."
            inputId="bodyFont"
            placeholder="e.g. Open Sans"
            googleFontValue={data.bodyFont}
            customFont={data.customBodyFont ?? null}
            onGoogleFontChange={name => onChange({ bodyFont: name })}
            onCustomFontChange={font => onChange({ customBodyFont: font, bodyFont: font?.name ?? '' })}
          />
        </div>
      </div>
    </div>
  );
}
