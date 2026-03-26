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

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {[
            { key: 'primaryColor' as const, label: 'Primary', hint: 'Main brand color for buttons, links, and CTAs.' },
            { key: 'secondaryColor' as const, label: 'Secondary', hint: 'Complementary color for accents and gradients.' },
            { key: 'accentColor' as const, label: 'Accent', hint: 'Highlight color for badges, icons, and special elements.' },
            { key: 'textColor' as const, label: 'Text', hint: 'Main text color used for headings and body copy.' },
            { key: 'backgroundColor' as const, label: 'Background', hint: 'Page background color.' },
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
    </div>
  );
}
