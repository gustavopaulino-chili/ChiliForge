import { Input } from '@/components/ui/input';
import { BusinessFormData, STYLE_OPTIONS } from '@/types/businessForm';
import { FieldLabel } from './FieldLabel';

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
        <div>
          <FieldLabel required hint="Choose the visual style that best represents your brand. This affects typography, spacing, colors, and overall layout feel.">
            Preferred Style
          </FieldLabel>
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

        <div className="grid grid-cols-2 gap-4">
          <div>
            <FieldLabel htmlFor="primaryColor" hint="The main brand color used for buttons, links, and key UI elements. Pick a color that represents your brand identity.">
              Primary Color
            </FieldLabel>
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
            <FieldLabel htmlFor="secondaryColor" hint="A complementary color used for accents, gradients, and secondary elements. Should pair well with the primary color.">
              Secondary Color
            </FieldLabel>
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
