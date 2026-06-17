import { useState } from 'react';
import { BusinessFormData, LANDING_PRESETS, LandingPreset } from '@/types/businessForm';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Wand2, Loader2, Sparkles, Check, ListChecks } from 'lucide-react';
import { generatePreset, parseSpreadsheet } from '@/services/api';
import { aiDataToFormUpdates } from '@/lib/aiFormMapping';
import { toast } from 'sonner';

interface Props {
  data: BusinessFormData;
  onChange: (updates: Partial<BusinessFormData>) => void;
}

export function StepWebsiteType({ data, onChange }: Props) {
  const [aiDescription, setAiDescription] = useState(data.generationObjective || '');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [isApplyingBriefing, setIsApplyingBriefing] = useState(false);
  const [appliedFields, setAppliedFields] = useState<string[]>([]);

  const handleApplyBriefing = async () => {
    const brief = (data.landingBriefing || '').trim();
    if (brief.length < 20) {
      toast.error('Escreva um briefing mais completo (mín. 20 caracteres) antes de aplicar.');
      return;
    }
    setIsApplyingBriefing(true);
    setAppliedFields([]);
    try {
      const result = await parseSpreadsheet(
        brief,
        'Este texto é o BRIEFING de uma landing page. Extraia dele os campos de negócio/marca/oferta (nome, categoria, público, proposta de valor, serviços, diferenciais, cores, tom, contato, redes) para preencher o formulário.'
      );
      const extracted = result.extracted;
      if (!extracted) throw new Error('Nada foi extraído do briefing.');

      const updates = aiDataToFormUpdates(extracted);
      const matched = Object.keys(updates).filter(k => {
        const v = (updates as any)[k];
        if (Array.isArray(v)) return v.length > 0;
        if (v && typeof v === 'object') return Object.keys(v).length > 0;
        return !!v;
      });

      // Apply the extracted fields, but keep the briefing itself intact.
      onChange({ ...updates, landingBriefing: brief });
      setAppliedFields(matched);
      toast.success(`Briefing aplicado — ${matched.length} campo(s) preenchido(s)`);
    } catch (err) {
      console.error('Apply briefing error:', err);
      toast.error(err instanceof Error ? err.message : 'Falha ao aplicar o briefing');
    } finally {
      setIsApplyingBriefing(false);
    }
  };

  const handleGeneratePreset = async () => {
    if (!aiDescription.trim() || aiDescription.trim().length < 10) {
      toast.error('Please describe your landing page in more detail (at least 10 characters).');
      return;
    }

    setIsGenerating(true);
    setGenerated(false);

    try {
      const result = await generatePreset(aiDescription.trim());

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
        generationObjective: aiDescription.trim(),
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

      {/* LP Briefing — authoritative content source */}
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-amber-500" />
          <p className="text-sm font-medium text-foreground">LP Briefing</p>
          <span className="text-[10px] uppercase tracking-wide font-semibold text-amber-600 bg-amber-500/15 rounded px-1.5 py-0.5">
            dita o conteúdo
          </span>
        </div>
        <p className="text-xs text-muted-foreground -mt-1">
          Escreva o briefing completo da landing page. A IA vai <strong>estudar este texto</strong> e usá-lo como
          fonte de verdade para <strong>todo o conteúdo da página</strong> — headline, copy de cada seção, narrativa,
          ofertas, ordem e ênfase. Quanto mais detalhado (público, dores, proposta de valor, provas, oferta, CTA), melhor.
        </p>
        <Textarea
          value={data.landingBriefing || ''}
          onChange={e => onChange({ landingBriefing: e.target.value })}
          placeholder={"Ex.: Landing para o lançamento do Sérum Glow da Velora Skin.\nPúblico: mulheres 25-45 que querem pele iluminada.\nDor: rotina de skincare complicada e sem resultado.\nProposta: sérum com Vitamina C que renova a pele em 14 dias.\nProvas: +2.000 clientes, dermatologicamente testado, antes/depois.\nOferta: 20% off no lançamento + frete grátis.\nCTA: 'Garanta já o seu'. Tom: premium, confiável, acolhedor."}
          rows={7}
          disabled={isApplyingBriefing}
          className="text-sm"
        />
        <Button
          type="button"
          onClick={handleApplyBriefing}
          disabled={isApplyingBriefing || !(data.landingBriefing || '').trim()}
          className="gap-2 w-full"
        >
          {isApplyingBriefing ? (
            <><Loader2 className="h-4 w-4 animate-spin" /> Analisando briefing e preenchendo o formulário...</>
          ) : appliedFields.length > 0 ? (
            <><Check className="h-4 w-4" /> Formulário preenchido — aplicar novamente</>
          ) : (
            <><ListChecks className="h-4 w-4" /> Aplicar briefing e preencher formulário</>
          )}
        </Button>
        <p className="text-xs text-muted-foreground -mt-1">
          A IA estuda o briefing e preenche os campos do formulário (nome, categoria, público, proposta,
          serviços, diferenciais, cores, tom, contato, redes). Os campos podem ser revisados nos próximos passos.
        </p>
        {appliedFields.length > 0 && !isApplyingBriefing && (
          <div className="rounded-lg bg-success/10 border border-success/20 p-3">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="h-4 w-4 text-success" />
              <span className="text-sm font-medium text-success">
                {appliedFields.length} campo(s) preenchido(s) a partir do briefing:
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {appliedFields.map(f => (
                <span key={f} className="text-xs bg-success/10 text-success rounded px-2 py-0.5">{f}</span>
              ))}
            </div>
          </div>
        )}
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
          onChange={e => {
            const value = e.target.value;
            setAiDescription(value);
            setGenerated(false);
            onChange({ generationObjective: value });
          }}
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
