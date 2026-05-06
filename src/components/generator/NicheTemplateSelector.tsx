import { NicheTemplate, NICHE_TEMPLATES } from '@/data/nicheTemplates';
import { BusinessFormData } from '@/types/businessForm';
import { Lightbulb } from 'lucide-react';

interface Props {
  onApply: (updates: Partial<BusinessFormData>) => void;
}

export function NicheTemplateSelector({ onApply }: Props) {
  return (
    <div className="rounded-xl border border-primary/20 bg-primary/5 p-5">
      <div className="flex items-center gap-2 mb-3">
        <Lightbulb className="h-4 w-4 text-primary" />
        <p className="text-sm font-medium text-foreground">Quick Start Templates</p>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Choose a template to pre-fill the form with example data for your niche
      </p>
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
        {NICHE_TEMPLATES.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => onApply(t.data)}
            className="rounded-lg border border-border hover:border-primary/40 hover:bg-primary/5 p-2.5 text-center transition-all group"
          >
            <div className="text-xl mb-1">{t.emoji}</div>
            <div className="text-xs font-medium text-foreground group-hover:text-primary transition-colors leading-tight">{t.label}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
