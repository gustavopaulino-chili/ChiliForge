import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { AdCreativeFormData, AD_PLATFORM_LABELS, AdPlatform } from '@/types/adCreativeForm';

interface Props {
  data: AdCreativeFormData;
  onChange: (updates: Partial<AdCreativeFormData>) => void;
}

const AB_FOCUS_OPTIONS: { value: AdCreativeFormData['abTestFocus']; label: string; desc: string }[] = [
  { value: 'headline', label: 'Headline',  desc: 'Test different headline hooks and copy angles' },
  { value: 'cta',      label: 'CTA',       desc: 'Test different call-to-action texts and tones' },
  { value: 'visual',   label: 'Visual',    desc: 'Test different layout, imagery and composition' },
  { value: 'color',    label: 'Color',     desc: 'Test dark vs light theme or alternate palette' },
  { value: 'mixed',    label: 'Mixed',     desc: 'Test multiple elements across variants' },
];

const AB_FOCUS_IMPACT: Record<AdCreativeFormData['abTestFocus'], string> = {
  headline: 'Each variant keeps the same visual system and changes the main hook/headline.',
  cta: 'Each variant keeps the same concept and changes CTA wording and emphasis.',
  visual: 'Each variant changes layout, image use, crop, and composition. Add per-variant images in the Images step for stronger impact.',
  color: 'Each variant rotates the provided brand palette, testing light/dark and primary/accent emphasis.',
  mixed: 'Each variant changes a controlled mix of hook, CTA, visual hierarchy, and palette for broader exploration.',
};

export function StepAdFormats({ data, onChange }: Props) {
  const enabledFormats = data.selectedFormats.filter(f => f.enabled);

  const updateNote = (key: string, note: string) => {
    onChange({ formatNotes: { ...data.formatNotes, [key]: note } });
  };

  const updateHeadlineVariant = (index: number, value: string) => {
    const next = [...(data.headlineVariants || [])];
    next[index] = value;
    onChange({ headlineVariants: next });
  };

  const updateCtaVariant = (index: number, value: string) => {
    const next = [...(data.ctaVariants || [])];
    next[index] = value;
    onChange({ ctaVariants: next });
  };

  if (enabledFormats.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h3 className="form-section-title">Format Details & A/B Testing</h3>
          <p className="form-section-desc">No formats selected. Go back and choose platforms.</p>
        </div>
      </div>
    );
  }

  const grouped = enabledFormats.reduce<Record<string, typeof enabledFormats>>((acc, fmt) => {
    const key = fmt.platform;
    if (!acc[key]) acc[key] = [];
    acc[key].push(fmt);
    return acc;
  }, {});

  const showHeadlineInputs = data.abTestingEnabled && (data.abTestFocus === 'headline' || data.abTestFocus === 'mixed');
  const showCtaInputs = data.abTestingEnabled && (data.abTestFocus === 'cta' || data.abTestFocus === 'mixed');
  const variantLabels = ['A', 'B', 'C'].slice(0, data.abVariantCount);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="form-section-title">Format Details & A/B Testing</h3>
        <p className="form-section-desc">
          Format notes and variant configuration for testing
        </p>
      </div>

      {/* A/B Testing */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h4 className="text-sm font-semibold text-foreground">A/B Testing</h4>
            <p className="text-xs text-muted-foreground mt-1">
              Generate controlled creative variants for each selected format.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onChange({ abTestingEnabled: !data.abTestingEnabled })}
            className={`rounded-lg border px-3 py-2 text-xs font-semibold transition-all shrink-0 ${
              data.abTestingEnabled
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:border-muted-foreground/40'
            }`}
          >
            {data.abTestingEnabled ? 'Enabled' : 'Disabled'}
          </button>
        </div>

        {data.abTestingEnabled && (
          <div className="space-y-5">
            {/* Variants count */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Variants per format</label>
              <div className="flex gap-2">
                {([2, 3] as const).map(count => (
                  <button
                    key={count}
                    type="button"
                    onClick={() => onChange({ abVariantCount: count })}
                    className={`rounded-lg border px-5 py-2 text-sm font-medium ${
                      data.abVariantCount === count
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground'
                    }`}
                  >
                    {count}
                  </button>
                ))}
              </div>
            </div>

            {/* Test focus */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Test Focus</label>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {AB_FOCUS_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => onChange({ abTestFocus: opt.value })}
                    className={`rounded-lg border p-2.5 text-left transition-all ${
                      data.abTestFocus === opt.value
                        ? 'border-primary bg-primary/5 text-foreground'
                        : 'border-border text-muted-foreground hover:border-muted-foreground/30'
                    }`}
                  >
                    <div className="font-medium text-xs text-foreground">{opt.label}</div>
                    <div className="text-xs text-muted-foreground mt-0.5 leading-tight">{opt.desc}</div>
                  </button>
                ))}
              </div>
              <p className="text-xs text-primary leading-relaxed rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
                {AB_FOCUS_IMPACT[data.abTestFocus]}
              </p>
            </div>

            {/* Headline variant inputs */}
            {showHeadlineInputs && (
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">
                  Headline Variants <span className="text-muted-foreground/60">(optional — leave blank for AI-generated)</span>
                </label>
                <div className="space-y-2">
                  {variantLabels.map((label, i) => (
                    <div key={label} className="flex items-center gap-2">
                      <span className="text-xs font-mono font-bold text-primary w-5 shrink-0">{label}</span>
                      <Input
                        value={data.headlineVariants[i] || ''}
                        onChange={e => updateHeadlineVariant(i, e.target.value)}
                        placeholder={`Variant ${label} headline — e.g. "Stop Guessing. Start Growing."`}
                        className="text-sm"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* CTA variant inputs */}
            {showCtaInputs && (
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">
                  CTA Variants <span className="text-muted-foreground/60">(optional — leave blank for AI-generated)</span>
                </label>
                <div className="space-y-2">
                  {variantLabels.map((label, i) => (
                    <div key={label} className="flex items-center gap-2">
                      <span className="text-xs font-mono font-bold text-primary w-5 shrink-0">{label}</span>
                      <Input
                        value={data.ctaVariants[i] || ''}
                        onChange={e => updateCtaVariant(i, e.target.value)}
                        placeholder={`Variant ${label} CTA — e.g. "Get Started Free"`}
                        className="text-sm"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Per-format notes */}
      {Object.entries(grouped).map(([platform, formats]) => (
        <div key={platform} className="space-y-3">
          <h4 className="text-sm font-semibold text-foreground">
            {AD_PLATFORM_LABELS[platform as AdPlatform] ?? platform}
          </h4>
          <div className="space-y-3">
            {formats.map(fmt => {
              const noteKey = `${fmt.platform}-${fmt.label}`;
              return (
                <div key={noteKey} className="rounded-lg border border-border bg-card p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium text-sm text-foreground">{fmt.label}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{fmt.width}×{fmt.height}px</div>
                    </div>
                    <div className="text-xs bg-primary/10 text-primary rounded px-2 py-1 font-mono">
                      {fmt.width}×{fmt.height}
                    </div>
                  </div>
                  <Textarea
                    placeholder={`Optional notes (e.g. "use product image as background", "focus on discount offer")`}
                    value={data.formatNotes[noteKey] || ''}
                    onChange={e => updateNote(noteKey, e.target.value)}
                    className="min-h-[56px] text-sm"
                  />
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
        <strong>{enabledFormats.length}</strong> format{enabledFormats.length !== 1 ? 's' : ''} across{' '}
        <strong>{Object.keys(grouped).length}</strong> platform(s).
        {data.abTestingEnabled && (
          <> A/B enabled: <strong>{enabledFormats.length * data.abVariantCount}</strong> creatives total.</>
        )}
      </div>
    </div>
  );
}
