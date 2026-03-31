import { useState } from 'react';
import { BusinessFormData, LANDING_PRESETS, LandingPreset } from '@/types/businessForm';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Wand2, Loader2, Sparkles, Check } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface Props {
  data: BusinessFormData;
  onChange: (updates: Partial<BusinessFormData>) => void;
}

export function StepWebsiteType({ data, onChange }: Props) {
  const [aiDescription, setAiDescription] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generated, setGenerated] = useState(false);

  const handleGeneratePreset = async () => {
    if (!aiDescription.trim() || aiDescription.trim().length < 10) {
      toast.error('Please describe your landing page in more detail (at least 10 characters).');
      return;
    }

    setIsGenerating(true);
    setGenerated(false);

    try {
      const { data: result, error } = await supabase.functions.invoke('generate-preset', {
        body: { description: aiDescription.trim() },
      });

      if (error) throw error;
      if (result?.error) throw new Error(result.error);

      const preset = result.preset as LandingPreset;
      const sections = result.sections;

      if (!sections?.length) throw new Error('No sections generated');

      // Map AI sections to PageItem format
      const pages = sections.map((s: any) => ({
        name: s.name || 'Section',
        description: s.description || '',
        required: !!s.required,
        enabled: true,
        sections: [],
      }));

      // Apply preset + generated sections
      onChange({
        landingPreset: preset || 'general',
        pagesConfig: {
          mode: 'manual',
          aiSummary: '',
          pages,
        },
      });

      setGenerated(true);
      toast.success(`AI generated ${pages.length} sections with "${LANDING_PRESETS.find(p => p.value === preset)?.label || preset}" preset`);
    } catch (err) {
      console.error('Preset generation error:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to generate preset');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="form-section-title">Landing Page Preset</h3>
        <p className="form-section-desc">Choose a preset or let AI build one from your description</p>
      </div>

      {/* AI Preset Generator */}
      <div className="rounded-xl border border-primary/20 bg-primary/5 p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Wand2 className="h-4 w-4 text-primary" />
          <p className="text-sm font-medium text-foreground">Generate with AI</p>
        </div>
        <p className="text-xs text-muted-foreground -mt-2">
          Describe your landing page goal and AI will pick the best preset and generate optimized sections for you.
        </p>
        <Textarea
          value={aiDescription}
          onChange={e => { setAiDescription(e.target.value); setGenerated(false); }}
          placeholder="e.g. I'm launching a new fitness app that tracks workouts and nutrition. I need a page to drive app downloads with feature highlights, testimonials from beta users, and app store badges..."
          rows={3}
          disabled={isGenerating}
          className="text-sm"
        />
        <div className="flex items-center gap-3">
          <Button
            type="button"
            onClick={handleGeneratePreset}
            disabled={isGenerating || !aiDescription.trim()}
            className="gap-2"
            size="sm"
          >
            {isGenerating ? (
              <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Generating...</>
            ) : generated ? (
              <><Check className="h-3.5 w-3.5" /> Generated!</>
            ) : (
              <><Sparkles className="h-3.5 w-3.5" /> Generate Preset & Sections</>
            )}
          </Button>
          {generated && (
            <span className="text-xs text-muted-foreground">
              Sections were auto-configured. Review them in the "Sections" step.
            </span>
          )}
        </div>
      </div>

      {/* Divider */}
      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-border" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-card px-3 text-muted-foreground">or choose manually</span>
        </div>
      </div>

      {/* Manual presets */}
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
