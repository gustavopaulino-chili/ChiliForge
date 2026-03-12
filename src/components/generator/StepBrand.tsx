import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { BusinessFormData, STYLE_OPTIONS } from '@/types/businessForm';

interface Props {
  data: BusinessFormData;
  onChange: (updates: Partial<BusinessFormData>) => void;
}

export function StepBrand({ data, onChange }: Props) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="form-section-title">Brand Identity</h3>
        <p className="form-section-desc">Define your visual style</p>
      </div>

      <div className="space-y-4">
        {/* Style selection */}
        <div>
          <Label>Preferred Style *</Label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-2">
            {STYLE_OPTIONS.map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => onChange({ preferredStyle: opt.value })}
                className={`rounded-lg border p-4 text-left transition-all ${
                  data.preferredStyle === opt.value
                    ? 'border-primary bg-primary/5 ring-1 ring-primary'
                    : 'border-border hover:border-muted-foreground/30'
                }`}
              >
                <div className="font-medium text-foreground text-sm">{opt.label}</div>
                <div className="text-xs text-muted-foreground mt-1">{opt.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Colors */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="primaryColor">Primary Color</Label>
            <div className="flex gap-2 mt-1.5">
              <input
                type="color"
                id="primaryColor"
                value={data.primaryColor}
                onChange={e => onChange({ primaryColor: e.target.value })}
                className="h-10 w-12 rounded-md border border-input cursor-pointer"
              />
              <Input
                value={data.primaryColor}
                onChange={e => onChange({ primaryColor: e.target.value })}
                className="font-mono"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="secondaryColor">Secondary Color</Label>
            <div className="flex gap-2 mt-1.5">
              <input
                type="color"
                id="secondaryColor"
                value={data.secondaryColor}
                onChange={e => onChange({ secondaryColor: e.target.value })}
                className="h-10 w-12 rounded-md border border-input cursor-pointer"
              />
              <Input
                value={data.secondaryColor}
                onChange={e => onChange({ secondaryColor: e.target.value })}
                className="font-mono"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
