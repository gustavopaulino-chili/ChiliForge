import { useState } from 'react';
import { BusinessFormData, defaultFormData } from '@/types/businessForm';
import { StepIndicator } from '@/components/generator/StepIndicator';
import { StepBasics } from '@/components/generator/StepBasics';
import { StepServices } from '@/components/generator/StepServices';
import { StepBrand } from '@/components/generator/StepBrand';
import { StepContact } from '@/components/generator/StepContact';
import { StepReview } from '@/components/generator/StepReview';
import { Button } from '@/components/ui/button';
import { ArrowLeft, ArrowRight, Sparkles, Copy, Check, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';

const STEPS = [
  { id: 'basics', label: 'Business Basics' },
  { id: 'services', label: 'Services' },
  { id: 'brand', label: 'Brand' },
  { id: 'contact', label: 'Contact' },
  { id: 'review', label: 'Review' },
];

const Index = () => {
  const [currentStep, setCurrentStep] = useState(0);
  const [formData, setFormData] = useState<BusinessFormData>(defaultFormData);
  const [showResults, setShowResults] = useState(false);
  const [copied, setCopied] = useState(false);

  const updateForm = (updates: Partial<BusinessFormData>) => {
    setFormData(prev => ({ ...prev, ...updates }));
  };

  const next = () => setCurrentStep(s => Math.min(s + 1, STEPS.length - 1));
  const prev = () => setCurrentStep(s => Math.max(s - 1, 0));

  const prompt = generatePrompt(formData);

  const handleCopy = () => {
    navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success('Prompt copied! Paste it into a new Lovable project.');
  };

  const handleGenerate = () => {
    setShowResults(true);
  };

  // Results view
  if (showResults) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="mx-auto max-w-4xl px-6 py-8">
          <div className="text-center mb-8">
            <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-success/10 mb-4">
              <Sparkles className="h-8 w-8 text-success" />
            </div>
            <h2 className="font-display text-3xl font-bold tracking-tight text-foreground">
              Your Prompt is Ready!
            </h2>
            <p className="mt-3 text-muted-foreground max-w-xl mx-auto">
              Copy the generated prompt below and paste it into a new Lovable project to create your website.
            </p>
          </div>

          {/* Prompt section */}
          <div className="glass-card rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="form-section-title">Generated Lovable Prompt</h3>
              <Button variant="outline" size="sm" onClick={handleCopy} className="gap-2">
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied ? 'Copied!' : 'Copy Prompt'}
              </Button>
            </div>
            <pre className="bg-muted rounded-lg p-4 text-sm text-foreground/80 whitespace-pre-wrap overflow-auto max-h-96 font-body leading-relaxed">
              {prompt}
            </pre>
          </div>

          {/* How to use */}
          <div className="glass-card rounded-xl p-6 mt-6">
            <h3 className="form-section-title mb-3">Next Steps</h3>
            <ol className="space-y-2 text-sm text-muted-foreground list-decimal list-inside">
              <li>Copy the prompt above</li>
              <li>Open <a href="https://lovable.dev" target="_blank" rel="noopener" className="text-primary hover:underline">lovable.dev</a> and create a new project</li>
              <li>Paste the prompt — Lovable will generate your full website</li>
              <li>Continue editing and customizing</li>
            </ol>
          </div>

          {/* Actions */}
          <div className="mt-6 flex gap-3">
            <Button variant="ghost" onClick={() => setShowResults(false)} className="gap-2">
              <ArrowLeft className="h-4 w-4" /> Edit Details
            </Button>
            <div className="ml-auto flex gap-3">
              <Button variant="outline" size="lg" onClick={handleCopy} className="gap-2">
                <Copy className="h-4 w-4" /> {copied ? 'Copied!' : 'Copy Prompt'}
              </Button>
              <Button
                variant="gradient"
                size="lg"
                onClick={() => {
                  handleCopy();
                  window.open('https://lovable.dev', '_blank');
                }}
                className="gap-2"
              >
                <ExternalLink className="h-4 w-4" /> Copy & Open Lovable
              </Button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // Form view
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="mx-auto max-w-4xl px-6 py-8">
        <div className="mb-10 text-center">
          <h2 className="font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Generate Your Website
          </h2>
          <p className="mt-3 text-muted-foreground max-w-xl mx-auto">
            Fill in your business details and we'll generate a professional,
            conversion-focused website prompt for Lovable.
          </p>
        </div>

        <StepIndicator steps={STEPS} currentStep={currentStep} />

        <div className="mt-8 glass-card rounded-xl p-6 sm:p-8 animate-in-up" key={currentStep}>
          {currentStep === 0 && <StepBasics data={formData} onChange={updateForm} />}
          {currentStep === 1 && <StepServices data={formData} onChange={updateForm} />}
          {currentStep === 2 && <StepBrand data={formData} onChange={updateForm} />}
          {currentStep === 3 && <StepContact data={formData} onChange={updateForm} />}
          {currentStep === 4 && <StepReview data={formData} />}
        </div>

        <div className="mt-6 flex justify-between">
          <Button variant="ghost" onClick={prev} disabled={currentStep === 0} className="gap-2">
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>

          {currentStep < STEPS.length - 1 ? (
            <Button onClick={next} className="gap-2">
              Next <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              variant="gradient"
              size="lg"
              onClick={handleGenerate}
              className="gap-2"
            >
              <Sparkles className="h-4 w-4" /> Generate Prompt
            </Button>
          )}
        </div>
      </main>
    </div>
  );
};

function Header() {
  return (
    <header className="border-b border-border/50 px-6 py-4">
      <div className="mx-auto max-w-6xl flex items-center gap-3">
        <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
          <Sparkles className="h-4 w-4 text-primary-foreground" />
        </div>
        <h1 className="font-display text-xl font-bold tracking-tight text-foreground">
          Site<span className="gradient-text">Forge</span>
        </h1>
      </div>
    </header>
  );
}

function generatePrompt(data: BusinessFormData): string {
  const servicesText = data.services.filter(Boolean).join(', ');
  const diffsText = data.differentiators.filter(Boolean).join(', ');
  const socialText = Object.entries(data.socialLinks)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');
  const categoryHint = getCategoryLayout(data.businessCategory);

  return `Create a professional, conversion-focused ${data.preferredStyle} website for "${data.businessName}".

## Business Overview
${data.businessDescription}
- Industry: ${data.businessCategory}
- Target Audience: ${data.targetAudience}
- Location: ${data.city}, ${data.country}

## Services/Products
${servicesText}

## Value Proposition
${data.valueProposition}

## Key Differentiators
${diffsText}

## Brand & Design
- Style: ${data.preferredStyle}
- Primary Color: ${data.primaryColor}
- Secondary Color: ${data.secondaryColor}
${data.logoUrl ? `- Logo: ${data.logoUrl}` : ''}

## Contact Information
- Email: ${data.email}
${data.phone ? `- Phone: ${data.phone}` : ''}
${data.whatsapp ? `- WhatsApp: ${data.whatsapp}` : ''}
${socialText ? `- Social: ${socialText}` : ''}

## Website Structure
${categoryHint}

## Requirements
- Fully responsive design
- Strong visual hierarchy with clear CTAs
- Professional, conversion-focused copy
- SEO-optimized with proper heading hierarchy (H1, H2, H3)
- Semantic HTML structure
- Smooth scroll animations
- Mobile-first approach
- Fast loading, clean code

Generate a polished, production-ready website that feels custom-designed.`;
}

function getCategoryLayout(category: string): string {
  if (category.includes('E-commerce') || category.includes('Retail')) {
    return `1. Hero with strong CTA
2. Featured Products / Highlights
3. Benefits / Why Choose Us
4. Product Categories
5. Testimonials
6. CTA Section
7. Contact / Footer`;
  }
  if (category.includes('Restaurant') || category.includes('Food')) {
    return `1. Hero with ambiance imagery
2. About / Our Story
3. Menu Highlights
4. Gallery
5. Location & Hours
6. Reservation CTA
7. Contact / Footer`;
  }
  return `1. Hero Section with headline & CTA
2. About / Who We Are
3. Services / What We Offer
4. Benefits / Why Choose Us
5. Process / How It Works
6. Testimonials / Social Proof
7. Call-to-Action Section
8. Contact Section
9. Footer`;
}

export default Index;
