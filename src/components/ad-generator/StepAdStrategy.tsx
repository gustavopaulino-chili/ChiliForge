import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { AdCreativeFormData, CreativeStrategy } from '@/types/adCreativeForm';
import { FieldLabel } from '@/components/generator/FieldLabel';
import { Sparkles, PenLine } from 'lucide-react';

interface Props {
  data: AdCreativeFormData;
  onChange: (updates: Partial<AdCreativeFormData>) => void;
}

const STRATEGIES: { value: CreativeStrategy; label: string; desc: string }[] = [
  { value: 'problem-solution', label: 'Problem / Solution', desc: 'Present a pain point, then position the product as the fix' },
  { value: 'before-after',     label: 'Before / After',     desc: 'Show transformation — contrast the before state with the after' },
  { value: 'testimonial',      label: 'Testimonial',        desc: 'Use a real customer quote or story as the main message' },
  { value: 'ugc',              label: 'UGC Style',          desc: 'Organic, user-generated look — raw, native, low-polish' },
  { value: 'founder-story',    label: 'Founder Story',      desc: 'Personal narrative from the founder/brand behind the product' },
  { value: 'educational',      label: 'Educational',        desc: 'Teach something useful, position the brand as the authority' },
  { value: 'emotional',        label: 'Emotional',          desc: 'Lead with emotion, aspiration or identity rather than features' },
  { value: 'luxury-premium',   label: 'Luxury / Premium',   desc: 'High-end aesthetic, exclusivity, aspirational positioning' },
  { value: 'direct-response',  label: 'Direct Response',    desc: 'Hard sell — strong hook, offer, urgency, clear CTA' },
  { value: 'meme-trend',       label: 'Meme / Trend-Based', desc: 'Leverage trending formats, pop culture, humor' },
  { value: 'comparison',       label: 'Comparison',         desc: 'Side-by-side or implied comparison vs. competitors' },
  { value: 'authority',        label: 'Authority-Based',    desc: 'Lead with credibility: awards, press, stats, certifications' },
  { value: 'lifestyle',        label: 'Lifestyle',          desc: 'Aspirational lifestyle imagery — sell the life, not the product' },
  { value: 'product-showcase', label: 'Product Showcase',   desc: 'Product-centric: features, design, quality, close-up detail' },
  { value: 'other',            label: 'Other',              desc: 'Describe a custom strategy below' },
];

export function StepAdStrategy({ data, onChange }: Props) {
  const charCount = (str: string) => str.length;

  return (
    <div className="space-y-8">
      <div>
        <h3 className="form-section-title">Creative Strategy</h3>
        <p className="form-section-desc">
          Define the creative angle and base copy — AI will use this to structure the approach for each ad.
        </p>
      </div>

      {/* Creative Strategy */}
      <div className="space-y-3">
        <h4 className="text-sm font-semibold text-foreground">Creative Angle</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {STRATEGIES.map(s => (
            <button
              key={s.value}
              type="button"
              onClick={() => onChange({ creativeStrategy: data.creativeStrategy === s.value ? '' : s.value })}
              className={`rounded-lg border p-3 text-left transition-all ${
                data.creativeStrategy === s.value
                  ? 'border-primary bg-primary/5 ring-1 ring-primary'
                  : 'border-border hover:border-muted-foreground/30 bg-card'
              }`}
            >
              <div className="font-medium text-xs text-foreground">{s.label}</div>
              <div className="text-xs text-muted-foreground mt-0.5 leading-tight">{s.desc}</div>
            </button>
          ))}
        </div>
        {data.creativeStrategy === 'other' && (
          <Textarea
            placeholder="Describe your custom creative strategy..."
            value={data.creativeStrategyOther}
            onChange={e => onChange({ creativeStrategyOther: e.target.value })}
            className="min-h-[72px] text-sm mt-2"
          />
        )}
      </div>

      {/* Copywriting Inputs */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-foreground">Copywriting</h4>
          <div className="flex items-center gap-1 rounded-lg border border-border overflow-hidden text-xs">
            <button
              type="button"
              onClick={() => onChange({ useAiCopy: true })}
              className={`flex items-center gap-1.5 px-3 py-1.5 font-medium transition-colors ${
                data.useAiCopy ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              <Sparkles className="h-3 w-3" /> AI writes
            </button>
            <button
              type="button"
              onClick={() => onChange({ useAiCopy: false })}
              className={`flex items-center gap-1.5 px-3 py-1.5 font-medium transition-colors ${
                !data.useAiCopy ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              <PenLine className="h-3 w-3" /> I provide
            </button>
          </div>
        </div>

        {data.useAiCopy ? (
          <div className="rounded-lg bg-muted/40 border border-border p-4 text-xs text-muted-foreground">
            AI will generate the headline, subheadline, and copy based on the objective, funnel stage, strategy, and other filled fields.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <FieldLabel htmlFor="mainHeadline" hint="Main ad headline. Maximum 40 characters.">
                  Main Headline
                </FieldLabel>
                <span className={`text-xs ${charCount(data.mainHeadline) > 40 ? 'text-destructive' : 'text-muted-foreground'}`}>
                  {charCount(data.mainHeadline)}/40
                </span>
              </div>
              <Input
                id="mainHeadline"
                value={data.mainHeadline}
                onChange={e => onChange({ mainHeadline: e.target.value })}
                placeholder="e.g. Stop wasting time. Automate now."
                maxLength={50}
                className={charCount(data.mainHeadline) > 40 ? 'border-destructive/50' : ''}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <FieldLabel htmlFor="subheadline" hint="Secondary text / subtitle. Maximum 50 characters.">
                  Subheadline
                </FieldLabel>
                <span className={`text-xs ${charCount(data.subheadline) > 50 ? 'text-destructive' : 'text-muted-foreground'}`}>
                  {charCount(data.subheadline)}/50
                </span>
              </div>
              <Input
                id="subheadline"
                value={data.subheadline}
                onChange={e => onChange({ subheadline: e.target.value })}
                placeholder="e.g. Over 5,000 companies already use our platform"
                maxLength={60}
                className={charCount(data.subheadline) > 50 ? 'border-destructive/50' : ''}
              />
            </div>
          </div>
        )}

        {/* CTA text always editable */}
        <div className="space-y-2">
          <FieldLabel htmlFor="ctaText" hint="Call-to-action button text.">
            CTA Text
          </FieldLabel>
          <Input
            id="ctaText"
            value={data.ctaText}
            onChange={e => onChange({ ctaText: e.target.value })}
            placeholder="e.g. Get started, Learn more, Claim now"
          />
        </div>
      </div>
    </div>
  );
}
