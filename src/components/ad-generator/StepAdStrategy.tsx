import { Textarea } from '@/components/ui/textarea';
import { AdCreativeFormData, CreativeStrategy } from '@/types/adCreativeForm';
import { RecommendationHint } from './RecommendationHint';
import { getRecommendedStrategies, recommendedOptionClass } from '@/lib/adRecommendations';

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
  const recommendedStrategies = getRecommendedStrategies(data);

  return (
    <div className="space-y-8">
      <div>
        <h3 className="form-section-title">Creative Strategy</h3>
        <p className="form-section-desc">
          Choose the creative angle that best fits your campaign — AI will use this to structure the approach for each ad.
        </p>
      </div>

      <div className="space-y-3">
        <h4 className="text-sm font-semibold text-foreground">Creative Angle</h4>
        <RecommendationHint enabled={recommendedStrategies.size > 0} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {STRATEGIES.map(s => {
            const selected = data.creativeStrategy === s.value;
            const recommended = !selected && recommendedStrategies.has(s.value);

            return (
              <button
                key={s.value}
                type="button"
                onClick={() => onChange({ creativeStrategy: selected ? '' : s.value })}
                className={`rounded-lg border p-3 text-left transition-all ${
                  selected
                    ? 'border-primary bg-primary/5 ring-1 ring-primary'
                    : recommended
                      ? recommendedOptionClass
                      : 'border-border hover:border-muted-foreground/30 bg-card'
                }`}
              >
                <div className="font-medium text-xs text-foreground">{s.label}</div>
                <div className="text-xs text-muted-foreground mt-0.5 leading-tight">{s.desc}</div>
                {recommended && (
                  <div className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-primary">
                    Recommended
                  </div>
                )}
              </button>
            );
          })}
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
    </div>
  );
}
