import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Sparkles, Zap, Palette, Code2, ArrowRight, Flame, CheckCircle2 } from 'lucide-react';

interface HeroLandingProps {
  onStartGenerator: () => void;
}

const STEPS_HOW = [
  {
    icon: Zap,
    title: 'Import or Describe',
    description: 'Paste a website URL to scrape data, upload a spreadsheet, or fill in your business details manually.',
  },
  {
    icon: Palette,
    title: 'Customize Everything',
    description: 'Choose your preset, colors, fonts, images, sections — fine-tune every detail of your landing page.',
  },
  {
    icon: Code2,
    title: 'Generate & Deploy',
    description: 'Get a production-ready prompt optimized for Lovable. One click to copy and create your site instantly.',
  },
];

const FEATURES = [
  'Website scraping with AI analysis',
  'AI-powered preset generation',
  'Smart color & font extraction',
  'AI image generation',
  'Niche-specific templates',
  'SEO-optimized output',
];

export function HeroLanding({ onStartGenerator }: HeroLandingProps) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div className="min-h-screen bg-background relative">
      <div className="reactive-bg-mouse" />

      {/* Decorative elements */}
      <div className="absolute top-[10%] left-[15%] w-[500px] h-[500px] bg-primary/8 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute top-[50%] right-[10%] w-[400px] h-[400px] bg-accent/8 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute top-[30%] left-[50%] w-[350px] h-[350px] bg-foreground/[0.03] rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute bottom-[15%] left-[20%] w-[450px] h-[450px] bg-foreground/[0.04] rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[40%] right-[30%] w-[300px] h-[300px] bg-primary/5 rounded-full blur-[80px] pointer-events-none" />

      <div className="relative z-10">
        {/* Hero Section */}
        <section className="px-6 pt-32 pb-20">
          <div className="mx-auto max-w-5xl text-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 mb-8">
              <Flame className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium text-primary">AI-Powered Landing Page Generator</span>
            </div>

            <h1 className="font-display text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight text-foreground leading-[1.1]">
              Craft stunning landing pages{' '}
              <span className="gradient-text">in minutes</span>
            </h1>

            <p className="mt-6 text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              Chili Forge transforms your business data into production-ready, 
              conversion-focused landing page prompts for Lovable — no design skills needed.
            </p>

            <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
              <Button
                variant="gradient"
                size="xl"
                className="gap-3 group relative overflow-hidden"
                onClick={onStartGenerator}
                onMouseEnter={() => setIsHovered(true)}
                onMouseLeave={() => setIsHovered(false)}
              >
                <Sparkles className={`h-5 w-5 transition-transform duration-300 ${isHovered ? 'rotate-12 scale-110' : ''}`} />
                Start Building
                <ArrowRight className={`h-5 w-5 transition-transform duration-300 ${isHovered ? 'translate-x-1' : ''}`} />
              </Button>
              <p className="text-sm text-muted-foreground">Free • No account required</p>
            </div>
          </div>
        </section>

        {/* How it Works */}
        <section className="px-6 py-20">
          <div className="mx-auto max-w-5xl">
            <div className="text-center mb-14">
              <h2 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
                How it works
              </h2>
              <p className="mt-3 text-muted-foreground max-w-lg mx-auto">
                Three simple steps to go from idea to a fully designed landing page.
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

        {/* Features Grid */}
        <section className="px-6 py-20">
          <div className="mx-auto max-w-3xl">
            <div className="glass-card rounded-2xl p-10">
              <h2 className="font-display text-2xl font-bold text-foreground text-center mb-8">
                Packed with smart features
              </h2>
              <div className="grid sm:grid-cols-2 gap-4">
                {FEATURES.map((feature) => (
                  <div key={feature} className="flex items-center gap-3">
                    <CheckCircle2 className="h-5 w-5 text-primary shrink-0" />
                    <span className="text-sm text-foreground/80">{feature}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="px-6 py-20 pb-32">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
              Ready to <span className="gradient-text">ignite</span> your next project?
            </h2>
            <p className="mt-4 text-muted-foreground">
              Stop spending hours on landing page copy. Let Chili Forge do the heavy lifting.
            </p>
            <Button
              variant="gradient"
              size="xl"
              className="mt-8 gap-3 animate-pulse-glow"
              onClick={onStartGenerator}
            >
              <Sparkles className="h-5 w-5" />
              Launch the Generator
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
