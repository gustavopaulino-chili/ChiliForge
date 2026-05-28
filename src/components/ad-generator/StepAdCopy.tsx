import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { AdCreativeFormData } from '@/types/adCreativeForm';
import { FieldLabel } from '@/components/generator/FieldLabel';
import { RecommendationHint } from './RecommendationHint';
import { getRecommendedToneOfVoice, getRecommendedUrgencyLevels, recommendedOptionClass } from '@/lib/adRecommendations';

interface Props {
  data: AdCreativeFormData;
  onChange: (updates: Partial<AdCreativeFormData>) => void;
}

const TONE_OPTIONS: { value: AdCreativeFormData['toneOfVoice']; label: string; desc: string }[] = [
  { value: 'conversational', label: 'Conversational', desc: 'Friendly, natural' },
  { value: 'casual',         label: 'Casual',         desc: 'Relaxed, approachable' },
  { value: 'inspirational',  label: 'Inspirational',  desc: 'Motivating, uplifting' },
  { value: 'authoritative',  label: 'Authoritative',  desc: 'Expert, confident' },
  { value: 'formal',         label: 'Formal',         desc: 'Professional, polished' },
  { value: 'urgent',         label: 'Urgent',         desc: 'Time-sensitive, action-driven' },
  { value: 'empathetic',     label: 'Empathetic',     desc: 'Understanding, caring' },
];

const URGENCY_OPTIONS: { value: AdCreativeFormData['urgencyLevel']; label: string }[] = [
  { value: 'none',   label: 'None' },
  { value: 'low',    label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high',   label: 'High' },
];

const GENDER_OPTIONS: { value: AdCreativeFormData['gender']; label: string }[] = [
  { value: 'all',    label: 'All' },
  { value: 'female', label: 'Female' },
  { value: 'male',   label: 'Male' },
];

export function StepAdCopy({ data, onChange }: Props) {
  const recommendedTones = getRecommendedToneOfVoice(data);
  const recommendedUrgencies = getRecommendedUrgencyLevels(data);

  return (
    <div className="space-y-7">
      <div>
        <h3 className="form-section-title">Offer & Audience</h3>
        <p className="form-section-desc">Offer details, messaging direction, and target audience profile</p>
      </div>

      {/* Product & Offer */}
      <div className="space-y-4">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Product & Offer</h4>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <FieldLabel htmlFor="productName" required hint="Name of the product, service or offer being advertised.">
              Product / Service Name
            </FieldLabel>
            <Input
              id="productName"
              value={data.productName}
              onChange={e => onChange({ productName: e.target.value })}
              placeholder="e.g. Premium Membership, Summer Collection"
            />
          </div>
          <div className="space-y-2">
            <FieldLabel htmlFor="pricing" hint="Price, range or pricing model. E.g. $297/mo, starting at $99">
              Pricing
            </FieldLabel>
            <Input
              id="pricing"
              value={data.pricing}
              onChange={e => onChange({ pricing: e.target.value })}
              placeholder="e.g. $297/mo, Starting at $99"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <FieldLabel htmlFor="offer" hint="Main promotion or offer. E.g. 50% off, Free shipping, Exclusive bonus">
              Main Offer / Promotion
            </FieldLabel>
            <Input
              id="offer"
              value={data.offer}
              onChange={e => onChange({ offer: e.target.value })}
              placeholder="e.g. 50% off this weekend only"
            />
          </div>
          <div className="space-y-2">
            <FieldLabel htmlFor="discount" hint="Specific discount to highlight in the ad.">
              Discount
            </FieldLabel>
            <Input
              id="discount"
              value={data.discount}
              onChange={e => onChange({ discount: e.target.value })}
              placeholder="e.g. 30% OFF, Save $200"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <FieldLabel htmlFor="guarantee" hint="Guarantee offered. Reduces objections and builds trust.">
              Guarantee
            </FieldLabel>
            <Input
              id="guarantee"
              value={data.guarantee}
              onChange={e => onChange({ guarantee: e.target.value })}
              placeholder="e.g. 7-day guarantee, Money-back guaranteed"
            />
          </div>
          <div className="space-y-2">
            <FieldLabel htmlFor="scarcity" hint="Time or quantity scarcity. Creates real urgency.">
              Scarcity
            </FieldLabel>
            <Input
              id="scarcity"
              value={data.scarcity}
              onChange={e => onChange({ scarcity: e.target.value })}
              placeholder="e.g. Only 50 spots, Offer ends Sunday"
            />
          </div>
        </div>

        <div className="space-y-2">
          <FieldLabel htmlFor="valueProposition" required hint="The main benefit — what makes this product special for the audience.">
            Value Proposition
          </FieldLabel>
          <Textarea
            id="valueProposition"
            value={data.valueProposition}
            onChange={e => onChange({ valueProposition: e.target.value })}
            placeholder="e.g. The fastest way to create professional landing pages without code"
            className="min-h-[72px]"
          />
        </div>
      </div>

      {/* Audience */}
      <div className="space-y-4">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Target Audience</h4>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <FieldLabel htmlFor="targetAudience" hint="General audience description: interests, behaviors, profile.">
              Audience Description
            </FieldLabel>
            <Input
              id="targetAudience"
              value={data.targetAudience}
              onChange={e => onChange({ targetAudience: e.target.value })}
              placeholder="e.g. Digital entrepreneurs 25-40, interested in marketing"
            />
          </div>
          <div className="space-y-2">
            <FieldLabel htmlFor="ageRange" hint="Primary age range of the audience.">
              Age Range
            </FieldLabel>
            <Input
              id="ageRange"
              value={data.ageRange}
              onChange={e => onChange({ ageRange: e.target.value })}
              placeholder="e.g. 25-40, 18-35, 30+"
            />
          </div>
        </div>

        <div className="space-y-2">
          <FieldLabel hint="Primary gender of the target audience.">Gender</FieldLabel>
          <div className="flex gap-2">
            {GENDER_OPTIONS.map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => onChange({ gender: opt.value })}
                className={`flex-1 rounded-lg border py-2 text-sm font-medium transition-all ${
                  data.gender === opt.value
                    ? 'border-primary bg-primary/5 text-primary ring-1 ring-primary'
                    : 'border-border text-muted-foreground hover:border-muted-foreground/30'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <FieldLabel htmlFor="painPoints" hint="Pain points, problems or frustrations the product solves.">
              Pain Points
            </FieldLabel>
            <Textarea
              id="painPoints"
              value={data.painPoints}
              onChange={e => onChange({ painPoints: e.target.value })}
              placeholder="e.g. Wastes hours creating content manually, doesn't know how to make converting ads"
              className="min-h-[64px] text-sm"
            />
          </div>
          <div className="space-y-2">
            <FieldLabel htmlFor="desires" hint="What the audience wants to achieve or feel. What do they aspire to be or have?">
              Desires / Aspirations
            </FieldLabel>
            <Textarea
              id="desires"
              value={data.desires}
              onChange={e => onChange({ desires: e.target.value })}
              placeholder="e.g. A scalable business, more free time, market recognition"
              className="min-h-[64px] text-sm"
            />
          </div>
        </div>
      </div>

      {/* Tone & Urgency */}
      <div className="space-y-4">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tone & Urgency</h4>
        <RecommendationHint enabled={recommendedTones.size > 0 || recommendedUrgencies.size > 0} />

        <div className="space-y-3">
          <FieldLabel hint="Communication tone in the ads.">Tone of Voice</FieldLabel>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {TONE_OPTIONS.map(opt => {
              const selected = data.toneOfVoice === opt.value;
              const recommended = !selected && recommendedTones.has(opt.value);

              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onChange({ toneOfVoice: opt.value })}
                  className={`rounded-lg border p-3 text-left transition-all ${
                    selected
                      ? 'border-primary bg-primary/5 ring-1 ring-primary'
                      : recommended
                        ? recommendedOptionClass
                        : 'border-border hover:border-muted-foreground/30'
                  }`}
                >
                  <div className="font-medium text-foreground text-xs">{opt.label}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{opt.desc}</div>
                  {recommended && (
                    <div className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-primary">
                      Recommended
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-3">
          <FieldLabel hint="Urgency level — influences FOMO and conversion.">Urgency Level</FieldLabel>
          <div className="flex gap-2">
            {URGENCY_OPTIONS.map(opt => {
              const selected = data.urgencyLevel === opt.value;
              const recommended = !selected && recommendedUrgencies.has(opt.value);

              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onChange({ urgencyLevel: opt.value })}
                  className={`flex-1 rounded-lg border py-2.5 text-sm font-medium transition-all ${
                    selected
                      ? 'border-primary bg-primary/5 text-primary ring-1 ring-primary'
                      : recommended
                        ? recommendedOptionClass
                        : 'border-border text-muted-foreground hover:border-muted-foreground/30'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
