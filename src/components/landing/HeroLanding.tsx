import { useState, type PointerEvent } from 'react';
import { Button } from '@/components/ui/button';
import {
  Palette, Code2, ArrowRight, Flame, Check,
  Globe, Brain, Image, FileCode2, LayoutTemplate, Search, Rocket,
} from 'lucide-react';
import { PremiumParticleBackground, type ParticleTone } from './PremiumParticleBackground';
import './HeroLanding.css';

interface HeroLandingProps {
  onStartGenerator: () => void;
  onStartAdCreatives?: () => void;
}

const STEPS_HOW = [
  {
    icon: Globe,
    title: 'Import or Describe',
    description: 'Paste a website URL to scrape data, upload a spreadsheet, or fill in your business details manually.',
  },
  {
    icon: Palette,
    title: 'Customize Everything',
    description: 'Choose your preset, colors, fonts, images, sections — fine-tune every detail of your asset.',
  },
  {
    icon: Code2,
    title: 'Generate & Deploy',
    description: 'Get a production-ready result instantly. Edit visually, deploy to your server, or export as ZIP.',
  },
];

const FEATURES = [
  { icon: Globe, label: 'Website Scraping', desc: 'AI reads any site and auto-fills your form' },
  { icon: Brain, label: 'AI Autofill', desc: 'Smart extraction of colors, fonts, content' },
  { icon: Image, label: 'AI Image Generation', desc: 'Unique images crafted for your brand' },
  { icon: FileCode2, label: 'Visual Editor', desc: 'Edit generated HTML with a drag-and-drop editor' },
  { icon: LayoutTemplate, label: 'Niche Templates', desc: 'Pre-built templates for dozens of industries' },
  { icon: Search, label: 'SEO-Optimized', desc: 'Clean HTML structure ready for search engines' },
];

const PRICING_PLANS = [
  {
    name: 'Starter',
    badge: null as string | null,
    description: 'For freelancers and small projects',
    features: [
      'Landing Page Generator',
      'URL Scraper Autofill',
      '5 Projects / month',
      'Basic Templates',
      'Community Support',
    ],
    cta: 'Get Started',
    highlighted: false,
  },
  {
    name: 'Pro',
    badge: 'Most Popular' as string | null,
    description: 'For agencies and growing teams',
    features: [
      'Everything in Starter',
      'AD Creatives Generator',
      'Brand Book Reader',
      'Unlimited Projects',
      'Visual Editor',
      'Priority Support',
    ],
    cta: 'Get Started',
    highlighted: true,
  },
  {
    name: 'Agency',
    badge: null as string | null,
    description: 'For large teams at scale',
    features: [
      'Everything in Pro',
      'Team Members',
      'White Label',
      'Custom Integrations',
      'Dedicated Manager',
      'SLA Guarantee',
    ],
    cta: 'Contact Us',
    highlighted: false,
  },
];

const TONE_SEQUENCE: ParticleTone[] = ['primary', 'accent', 'success'];

export function HeroLanding({ onStartGenerator, onStartAdCreatives }: HeroLandingProps) {
  const [activeTone, setActiveTone] = useState<ParticleTone | null>(null);

  const getToneFromElement = (target: EventTarget | null): ParticleTone | null => {
    if (!(target instanceof Element)) return null;

    const source = target.closest<HTMLElement>('[data-particle-tone], [data-card-tone]');
    const explicitTone = source?.dataset.particleTone;

    if (explicitTone === 'primary' || explicitTone === 'accent' || explicitTone === 'success') {
      return explicitTone;
    }

    if (source?.dataset.cardTone === 'lp') return 'primary';
    if (source?.dataset.cardTone === 'ad') return 'accent';

    return null;
  };

  const handleTonePointerLeave = (event: PointerEvent<HTMLElement>) => {
    setActiveTone(getToneFromElement(event.relatedTarget));
  };

  const handleHomeButtonPointerOver = (event: PointerEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const button = target.closest('button');
    if (!button || !event.currentTarget.contains(button)) return;

    const tone = getToneFromElement(button);
    if (tone) setActiveTone(tone);
  };

  const handleHomeButtonPointerOut = (event: PointerEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const button = target.closest('button');
    if (!button || !event.currentTarget.contains(button)) return;
    if (event.relatedTarget instanceof Node && button.contains(event.relatedTarget)) return;

    setActiveTone(getToneFromElement(event.relatedTarget));
  };

  const handleCardPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const card = event.currentTarget;
    const rect = card.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width - 0.5) * 8;
    const y = ((event.clientY - rect.top) / rect.height - 0.5) * 8;

    card.style.setProperty('--card-shift-x', `${x.toFixed(2)}px`);
    card.style.setProperty('--card-shift-y', `${y.toFixed(2)}px`);
    card.style.setProperty('--card-glow-x', `${event.clientX - rect.left}px`);
    card.style.setProperty('--card-glow-y', `${event.clientY - rect.top}px`);
  };

  const resetCardMotion = (event: PointerEvent<HTMLDivElement>) => {
    const card = event.currentTarget;
    card.style.setProperty('--card-shift-x', '0px');
    card.style.setProperty('--card-shift-y', '0px');
  };

  return (
    <div className="premium-home min-h-screen bg-background relative overflow-x-hidden">
      <PremiumParticleBackground activeTone={activeTone} />

      {/* ── Page content ── */}
      <div className="relative" style={{ zIndex: 10 }}>

        {/* ════ HERO SECTION ════ */}
        <section className="premium-home-hero min-h-[92vh] px-6 pt-28 pb-16 flex items-center">
          <div className="mx-auto w-full max-w-4xl text-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 mb-8">
              <Flame className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium text-primary">AI-Powered Marketing Generator</span>
            </div>

            <h1 className="font-display text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight text-foreground leading-[1.02] max-w-4xl mx-auto">
              Build stunning marketing{' '}
              <span className="gradient-text">assets with AI</span>
            </h1>

            <p className="mt-6 text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              Chili Forge transforms your business data into production-ready landing pages and ad creatives.
            </p>

            <div className="mt-12 flex justify-center">
              <Button
                variant="gradient"
                size="lg"
                className="gap-3 px-8 py-6 text-base font-semibold"
                onClick={onStartGenerator}
                onPointerEnter={() => setActiveTone('glow')}
                onPointerLeave={() => setActiveTone(null)}
              >
                <Rocket className="h-5 w-5" />
                Começar projeto
                <ArrowRight className="h-5 w-5" />
              </Button>
            </div>
          </div>
        </section>

        {/* ════ FEATURES STRIP ════ */}
        <section className="px-6 py-16 border-t border-border/30">
          <div className="mx-auto max-w-5xl">
            <div className="text-center mb-10">
              <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
                Everything you need to launch faster
              </h2>
              <p className="mt-2 text-muted-foreground text-sm max-w-lg mx-auto">
                Packed with AI tools that save hours of work on every project.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {FEATURES.map((f, index) => (
                <div
                  key={f.label}
                  className="glass-card rounded-xl p-5 flex items-start gap-3 group hover:border-primary/20 transition-all"
                >
                  <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/20 transition-colors">
                    <f.icon className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-foreground">{f.label}</div>
                    <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{f.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ════ HOW IT WORKS ════ */}
        <section className="px-6 py-20 border-t border-border/30">
          <div className="mx-auto max-w-5xl">
            <div className="text-center mb-14">
              <h2 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
                How it works
              </h2>
              <p className="mt-3 text-muted-foreground max-w-lg mx-auto">
                Three simple steps to go from idea to a fully finished marketing asset.
              </p>
            </div>
            <div className="grid md:grid-cols-3 gap-6">
              {STEPS_HOW.map((step, i) => (
                <div
                  key={step.title}
                  className="glass-card rounded-xl p-8 text-center group hover:border-primary/30 transition-all duration-300"
                >
                  <div className="inline-flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10 mb-5 group-hover:bg-primary/20 transition-colors">
                    <step.icon className="h-7 w-7 text-primary" />
                  </div>
                  <div className="text-xs font-bold text-primary/60 uppercase tracking-widest mb-2">
                    Step {i + 1}
                  </div>
                  <h3 className="font-display text-xl font-semibold text-foreground mb-3">
                    {step.title}
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {step.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ════ PRICING ════ */}
        <section className="px-6 py-20 border-t border-border/30">
          <div className="mx-auto max-w-5xl">
            <div className="text-center mb-14">
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 mb-4">
                <span className="text-xs font-medium text-primary">Monthly Plans</span>
              </div>
              <h2 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
                Simple, transparent pricing
              </h2>
              <p className="mt-3 text-muted-foreground max-w-lg mx-auto">
                Choose the plan that fits your workflow. Upgrade or downgrade anytime.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
              {PRICING_PLANS.map((plan, index) => (
                <div
                  key={plan.name}
                  className={`glass-card rounded-2xl p-7 flex flex-col gap-5 transition-all duration-300 ${
                    plan.highlighted
                      ? 'border-primary/40 ring-1 ring-primary/20 shadow-[0_0_40px_-10px_hsl(359_100%_60%/0.2)]'
                      : 'hover:border-border/60'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <h3 className="font-display text-xl font-bold text-foreground">{plan.name}</h3>
                      {plan.badge && (
                        <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-gradient-to-r from-primary to-accent text-white">
                          {plan.badge}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">{plan.description}</p>
                  </div>

                  <div className="h-px bg-border/50" />

                  <ul className="space-y-2.5 flex-1">
                    {plan.features.map(feat => (
                      <li key={feat} className="flex items-start gap-2.5 text-sm text-foreground">
                        <Check className={`h-4 w-4 mt-0.5 shrink-0 ${plan.highlighted ? 'text-primary' : 'text-success'}`} />
                        {feat}
                      </li>
                    ))}
                  </ul>

                  <Button
                    variant={plan.highlighted ? 'gradient' : 'outline'}
                    className="w-full mt-auto"
                    data-particle-tone={plan.highlighted ? 'primary' : TONE_SEQUENCE[index % TONE_SEQUENCE.length]}
                    onClick={plan.name === 'Agency' ? undefined : onStartGenerator}
                    onPointerEnter={() => setActiveTone(plan.highlighted ? 'primary' : TONE_SEQUENCE[index % TONE_SEQUENCE.length])}
                    onPointerLeave={handleTonePointerLeave}
                  >
                    {plan.cta}
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ════ FINAL CTA ════ */}
        <section className="premium-home-cta px-6 py-24 border-t border-border/30">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-foreground mb-4">
              Ready to build something{' '}
              <span className="gradient-text">remarkable?</span>
            </h2>
            <p className="text-muted-foreground text-lg max-w-xl mx-auto mb-10">
              Start generating professional landing pages and ad creatives in minutes —
              no design skills required.
            </p>
            <div className="flex justify-center">
              <Button
                variant="gradient"
                size="xl"
                className="gap-3 px-8"
                onClick={onStartGenerator}
                onPointerEnter={() => setActiveTone('glow')}
                onPointerLeave={() => setActiveTone(null)}
              >
                <Rocket className="h-5 w-5" />
                Começar projeto
                <ArrowRight className="h-5 w-5" />
              </Button>
            </div>
          </div>
        </section>

      </div>
    </div>
  );
}
