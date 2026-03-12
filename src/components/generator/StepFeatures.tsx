import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { BusinessFormData, FeatureItem, PricingPlan } from '@/types/businessForm';
import { Plus, X, Zap, CreditCard } from 'lucide-react';
import { FieldLabel } from './FieldLabel';

interface Props {
  data: BusinessFormData;
  onChange: (updates: Partial<BusinessFormData>) => void;
}

const emptyFeature: FeatureItem = { name: '', description: '', icon: '' };
const emptyPlan: PricingPlan = { name: '', price: '', features: [''] };

export function StepFeatures({ data, onChange }: Props) {
  const features = data.features.length > 0 ? data.features : [{ ...emptyFeature }];
  const plans = data.pricingPlans.length > 0 ? data.pricingPlans : [{ ...emptyPlan }];

  const updateFeature = (i: number, field: keyof FeatureItem, value: string) => {
    const updated = [...features];
    updated[i] = { ...updated[i], [field]: value };
    onChange({ features: updated });
  };

  const updatePlan = (i: number, field: keyof PricingPlan, value: any) => {
    const updated = [...plans];
    updated[i] = { ...updated[i], [field]: value };
    onChange({ pricingPlans: updated });
  };

  const updatePlanFeature = (planIdx: number, featIdx: number, value: string) => {
    const updated = [...plans];
    const feats = [...updated[planIdx].features];
    feats[featIdx] = value;
    updated[planIdx] = { ...updated[planIdx], features: feats };
    onChange({ pricingPlans: updated });
  };

  return (
    <div className="space-y-8">
      {/* Features */}
      <div className="space-y-4">
        <div>
          <h3 className="form-section-title">Features</h3>
          <p className="form-section-desc">What does your software do?</p>
        </div>

        {features.map((f, i) => (
          <div key={i} className="rounded-lg border border-border bg-card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium text-foreground">Feature {i + 1}</span>
              </div>
              {features.length > 1 && (
                <Button variant="ghost" size="icon" onClick={() => onChange({ features: features.filter((_, idx) => idx !== i) })} className="h-7 w-7">
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <FieldLabel className="text-xs text-muted-foreground" required hint="A short, catchy name for this feature (e.g. 'Real-time Analytics', 'Team Collaboration').">
                  Feature Name
                </FieldLabel>
                <Input value={f.name} onChange={e => updateFeature(i, 'name', e.target.value)} placeholder="Feature name" className="mt-1" />
              </div>
              <div>
                <FieldLabel className="text-xs text-muted-foreground" hint="An emoji or icon name to visually represent this feature (e.g. 🚀, 📊, ⚡).">
                  Icon (emoji or name)
                </FieldLabel>
                <Input value={f.icon} onChange={e => updateFeature(i, 'icon', e.target.value)} placeholder="🚀 or icon-name" className="mt-1" />
              </div>
              <div className="col-span-2">
                <FieldLabel className="text-xs text-muted-foreground" hint="A 1-2 sentence explanation of what this feature does and how it benefits the user.">
                  Description
                </FieldLabel>
                <Textarea value={f.description} onChange={e => updateFeature(i, 'description', e.target.value)} placeholder="Feature description" rows={2} className="mt-1" />
              </div>
            </div>
          </div>
        ))}

        <Button variant="outline" onClick={() => onChange({ features: [...features, { ...emptyFeature }] })} className="gap-1">
          <Plus className="h-4 w-4" /> Add Feature
        </Button>
      </div>

      {/* Pricing */}
      <div className="space-y-4">
        <div>
          <h3 className="form-section-title">Pricing Plans</h3>
          <p className="form-section-desc">Define your pricing tiers</p>
        </div>

        {plans.map((plan, i) => (
          <div key={i} className="rounded-lg border border-border bg-card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium text-foreground">Plan {i + 1}</span>
              </div>
              {plans.length > 1 && (
                <Button variant="ghost" size="icon" onClick={() => onChange({ pricingPlans: plans.filter((_, idx) => idx !== i) })} className="h-7 w-7">
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <FieldLabel className="text-xs text-muted-foreground" required hint="The name of this pricing tier (e.g. 'Free', 'Pro', 'Enterprise').">
                  Plan Name
                </FieldLabel>
                <Input value={plan.name} onChange={e => updatePlan(i, 'name', e.target.value)} placeholder="e.g. Pro" className="mt-1" />
              </div>
              <div>
                <FieldLabel className="text-xs text-muted-foreground" required hint="The price for this plan including billing period (e.g. '$29/mo', '$299/year', 'Free').">
                  Price
                </FieldLabel>
                <Input value={plan.price} onChange={e => updatePlan(i, 'price', e.target.value)} placeholder="$29/mo" className="mt-1" />
              </div>
            </div>
            <div>
              <FieldLabel className="text-xs text-muted-foreground" hint="List what's included in this plan. Each feature appears as a bullet point on the pricing card.">
                Features List
              </FieldLabel>
              <div className="space-y-2 mt-1">
                {plan.features.map((feat, fi) => (
                  <div key={fi} className="flex gap-2">
                    <Input
                      value={feat}
                      onChange={e => updatePlanFeature(i, fi, e.target.value)}
                      placeholder={`Feature ${fi + 1}`}
                    />
                    {plan.features.length > 1 && (
                      <Button variant="ghost" size="icon" onClick={() => {
                        const updated = [...plans];
                        updated[i] = { ...updated[i], features: plan.features.filter((_, idx) => idx !== fi) };
                        onChange({ pricingPlans: updated });
                      }} className="h-9 w-9">
                        <X className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                ))}
                <Button variant="ghost" size="sm" onClick={() => {
                  const updated = [...plans];
                  updated[i] = { ...updated[i], features: [...plan.features, ''] };
                  onChange({ pricingPlans: updated });
                }} className="gap-1 text-xs">
                  <Plus className="h-3 w-3" /> Add Feature
                </Button>
              </div>
            </div>
          </div>
        ))}

        <Button variant="outline" onClick={() => onChange({ pricingPlans: [...plans, { ...emptyPlan }] })} className="gap-1">
          <Plus className="h-4 w-4" /> Add Plan
        </Button>
      </div>
    </div>
  );
}
