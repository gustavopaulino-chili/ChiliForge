import { BusinessFormData, LANDING_PRESETS } from '@/types/businessForm';

interface Props {
  data: BusinessFormData;
  onChange: (updates: Partial<BusinessFormData>) => void;
}

export function StepWebsiteType({ data, onChange }: Props) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="form-section-title">Landing Page Preset</h3>
        <p className="form-section-desc">Choose the type of landing page you need</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {LANDING_PRESETS.map(opt => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange({ landingPreset: opt.value })}
            className={`rounded-lg border p-4 text-left transition-all flex items-start gap-3 ${
              data.landingPreset === opt.value
                ? 'border-primary bg-primary/5 ring-1 ring-primary'
                : 'border-border hover:border-muted-foreground/30'
            }`}
          >
            <div className="text-2xl mt-0.5">{opt.emoji}</div>
            <div>
              <div className="font-medium text-foreground text-sm">{opt.label}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{opt.desc}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
