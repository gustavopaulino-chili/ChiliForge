import { AdCreativeFormData, CampaignObjective, FunnelStage } from '@/types/adCreativeForm';

interface Props {
  data: AdCreativeFormData;
  onChange: (updates: Partial<AdCreativeFormData>) => void;
}

const OBJECTIVES: { value: CampaignObjective; label: string; icon: string; desc: string }[] = [
  { value: 'awareness',      label: 'Brand Awareness',    icon: '📣', desc: 'Reach new audiences and build recognition' },
  { value: 'lead-generation',label: 'Lead Generation',    icon: '🎯', desc: 'Capture contacts, sign-ups or form fills' },
  { value: 'sales',          label: 'Sales Conversion',   icon: '💰', desc: 'Drive purchases and direct revenue' },
  { value: 'product-launch', label: 'Product Launch',     icon: '🚀', desc: 'Introduce a new product or service' },
  { value: 'retargeting',    label: 'Retargeting',        icon: '🔁', desc: 'Re-engage visitors who didn\'t convert' },
  { value: 'engagement',     label: 'Engagement',         icon: '💬', desc: 'Boost likes, shares, comments and reactions' },
  { value: 'traffic',        label: 'Traffic',            icon: '🌐', desc: 'Send people to a website or landing page' },
  { value: 'app-install',    label: 'App Install',        icon: '📱', desc: 'Drive downloads of a mobile app' },
  { value: 'whatsapp',       label: 'WhatsApp Conversion',icon: '💬', desc: 'Start conversations via WhatsApp' },
  { value: 'event',          label: 'Event Promotion',    icon: '📅', desc: 'Promote a live or online event' },
];

const FUNNEL_STAGES: {
  value: FunnelStage;
  label: string;
  tag: string;
  desc: string;
  approach: string;
  ctaExamples: string;
}[] = [
  {
    value: 'awareness',
    label: 'Top of Funnel',
    tag: 'Awareness',
    desc: 'Generate attention and spark interest without looking like a traditional ad. Native-content communication style.',
    approach: 'Curiosity · Identification · Pattern interrupt',
    ctaExamples: '"Learn more", "Discover", "Explore"',
  },
  {
    value: 'consideration',
    label: 'Mid-Funnel',
    tag: 'Consideration',
    desc: 'The user already recognizes the problem. More informative and persuasive ads without excessive purchase pressure.',
    approach: 'Differentiators · Benefits · Proof · Demonstration',
    ctaExamples: '"See how it works", "Compare", "Start for free"',
  },
  {
    value: 'conversion',
    label: 'Bottom of Funnel',
    tag: 'Conversion',
    desc: 'Action-oriented, final decision-making. Direct messaging, strong CTAs, urgency and objection reduction.',
    approach: 'Urgency · Offer · Trust · Close',
    ctaExamples: '"Buy now", "Secure my spot", "I want in"',
  },
];

export function StepAdObjective({ data, onChange }: Props) {
  return (
    <div className="space-y-8">
      <div>
        <h3 className="form-section-title">Campaign Objective & Funnel Stage</h3>
        <p className="form-section-desc">
          Define the campaign objective and funnel stage — this directly influences the style, approach, and language of the ads.
        </p>
      </div>

      {/* Funnel Stage */}
      <div className="space-y-3">
        <h4 className="text-sm font-semibold text-foreground">Funnel Stage <span className="text-destructive">*</span></h4>
        <div className="grid grid-cols-1 gap-3">
          {FUNNEL_STAGES.map(stage => (
            <button
              key={stage.value}
              type="button"
              onClick={() => onChange({ funnelStage: stage.value })}
              className={`rounded-xl border p-4 text-left transition-all ${
                data.funnelStage === stage.value
                  ? 'border-primary bg-primary/5 ring-1 ring-primary'
                  : 'border-border hover:border-muted-foreground/30 bg-card'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm text-foreground">{stage.label}</span>
                    <span className={`text-xs rounded-full px-2 py-0.5 font-medium ${
                      data.funnelStage === stage.value
                        ? 'bg-primary/20 text-primary'
                        : 'bg-muted text-muted-foreground'
                    }`}>{stage.tag}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{stage.desc}</p>
                  <div className="mt-2 flex flex-col gap-0.5">
                    <span className="text-xs text-foreground/70"><strong>Approach:</strong> {stage.approach}</span>
                    <span className="text-xs text-foreground/70"><strong>CTA:</strong> {stage.ctaExamples}</span>
                  </div>
                </div>
                <div className={`mt-0.5 h-5 w-5 rounded-full border-2 shrink-0 flex items-center justify-center transition-all ${
                  data.funnelStage === stage.value ? 'border-primary bg-primary' : 'border-muted-foreground/40'
                }`}>
                  {data.funnelStage === stage.value && (
                    <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Campaign Objective */}
      <div className="space-y-3">
        <h4 className="text-sm font-semibold text-foreground">Campaign Objective</h4>
        <p className="text-xs text-muted-foreground">The main goal — used to optimize messaging and creative direction.</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {OBJECTIVES.map(obj => (
            <button
              key={obj.value}
              type="button"
              onClick={() => onChange({ campaignObjective: data.campaignObjective === obj.value ? '' : obj.value })}
              className={`rounded-lg border p-3 text-left transition-all ${
                data.campaignObjective === obj.value
                  ? 'border-primary bg-primary/5 ring-1 ring-primary'
                  : 'border-border hover:border-muted-foreground/30 bg-card'
              }`}
            >
              <div className="text-lg mb-1">{obj.icon}</div>
              <div className="font-medium text-xs text-foreground">{obj.label}</div>
              <div className="text-xs text-muted-foreground mt-0.5 leading-tight">{obj.desc}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
