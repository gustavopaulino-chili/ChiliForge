import { Label } from '@/components/ui/label';
import { BusinessFormData, WEBSITE_TYPES } from '@/types/businessForm';
import { Building2, Rocket, ShoppingCart, Briefcase, Cloud, BookOpen, GraduationCap } from 'lucide-react';

const ICONS: Record<string, React.ReactNode> = {
  corporate: <Building2 className="h-5 w-5" />,
  landing: <Rocket className="h-5 w-5" />,
  ecommerce: <ShoppingCart className="h-5 w-5" />,
  portfolio: <Briefcase className="h-5 w-5" />,
  saas: <Cloud className="h-5 w-5" />,
  blog: <BookOpen className="h-5 w-5" />,
  educational: <GraduationCap className="h-5 w-5" />,
};

interface Props {
  data: BusinessFormData;
  onChange: (updates: Partial<BusinessFormData>) => void;
}

export function StepWebsiteType({ data, onChange }: Props) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="form-section-title">Website Type</h3>
        <p className="form-section-desc">What kind of website do you need?</p>
      </div>
      <div>
        <Label>Select Type *</Label>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-2">
          {WEBSITE_TYPES.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange({ websiteType: opt.value })}
              className={`rounded-lg border p-4 text-left transition-all flex items-start gap-3 ${
                data.websiteType === opt.value
                  ? 'border-primary bg-primary/5 ring-1 ring-primary'
                  : 'border-border hover:border-muted-foreground/30'
              }`}
            >
              <div className="text-primary mt-0.5">{ICONS[opt.value]}</div>
              <div>
                <div className="font-medium text-foreground text-sm">{opt.label}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{opt.desc}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
