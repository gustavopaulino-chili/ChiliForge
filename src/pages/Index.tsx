import { useState, useMemo, useEffect, useCallback } from 'react';
import { BusinessFormData, defaultFormData, WebsiteType } from '@/types/businessForm';
import { StepIndicator } from '@/components/generator/StepIndicator';
import { StepCsvImport } from '@/components/generator/StepCsvImport';
import { StepWebsiteType } from '@/components/generator/StepWebsiteType';
import { StepBasics } from '@/components/generator/StepBasics';
import { StepServices } from '@/components/generator/StepServices';
import { StepBrand } from '@/components/generator/StepBrand';
import { StepImages } from '@/components/generator/StepImages';
import { StepContact } from '@/components/generator/StepContact';
import { StepProducts } from '@/components/generator/StepProducts';
import { StepFeatures } from '@/components/generator/StepFeatures';
import { StepCourses } from '@/components/generator/StepCourses';
import { StepReview } from '@/components/generator/StepReview';
import { StepPages } from '@/components/generator/StepPages';
import { Button } from '@/components/ui/button';
import { ArrowLeft, ArrowRight, Sparkles, Copy, Check, ExternalLink, Loader2, Wand2, Link2 } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

type StepDef = { id: string; label: string };

function getSteps(websiteType: WebsiteType): StepDef[] {
  const base: StepDef[] = [
    { id: 'csv', label: 'Import' },
    { id: 'type', label: 'Type' },
    { id: 'basics', label: 'Basics' },
    { id: 'services', label: 'Services' },
  ];

  // Type-specific steps
  if (websiteType === 'ecommerce') {
    base.push({ id: 'products', label: 'Products' });
  }
  if (websiteType === 'saas') {
    base.push({ id: 'features', label: 'Features & Pricing' });
  }
  if (websiteType === 'educational') {
    base.push({ id: 'courses', label: 'Courses' });
  }

  base.push(
    { id: 'pages', label: 'Pages' },
    { id: 'brand', label: 'Brand' },
    { id: 'images', label: 'Images' },
    { id: 'contact', label: 'Contact' },
    { id: 'review', label: 'Review' },
  );

  return base;
}

const STORAGE_KEY = 'siteforge_progress';

const loadSavedProgress = () => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch {}
  return null;
};

const Index = () => {
  const saved = useMemo(() => loadSavedProgress(), []);
  const [currentStep, setCurrentStep] = useState(saved?.currentStep ?? 0);
  const [maxVisitedStep, setMaxVisitedStep] = useState(saved?.maxVisitedStep ?? 0);
  const [formData, setFormData] = useState<BusinessFormData>(saved?.formData ?? defaultFormData);
  const [showResults, setShowResults] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isGeneratingImages, setIsGeneratingImages] = useState(false);
  const [generatedImages, setGeneratedImages] = useState<string[]>([]);
  const [generationStatus, setGenerationStatus] = useState('');
  const [generationProgress, setGenerationProgress] = useState(0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  const getLovableUrl = useCallback(() => {
    const promptText = generatePrompt(formData, generatedImages);
    return `https://lovable.dev/projects/create#prompt=${encodeURIComponent(promptText)}`;
  }, [formData, generatedImages]);

  // Reactive gradient mouse tracker
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      document.documentElement.style.setProperty('--mouse-x', `${e.clientX}px`);
      document.documentElement.style.setProperty('--mouse-y', `${e.clientY}px`);
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);
  // Persist progress to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ currentStep, formData, maxVisitedStep }));
  }, [currentStep, formData]);

  const steps = useMemo(() => getSteps(formData.websiteType), [formData.websiteType]);

  const updateForm = (updates: Partial<BusinessFormData>) => {
    setFormData(prev => ({
      ...prev,
      ...updates,
      images: updates.images ? { ...prev.images, ...updates.images } : prev.images,
      socialLinks: updates.socialLinks ? { ...prev.socialLinks, ...updates.socialLinks } : prev.socialLinks,
    }));
  };

  const next = () => {
    setCurrentStep(s => {
      const newStep = Math.min(s + 1, steps.length - 1);
      setMaxVisitedStep(prev => Math.max(prev, newStep));
      return newStep;
    });
  };
  const prev = () => setCurrentStep(s => Math.max(s - 1, 0));

  const currentStepId = steps[currentStep]?.id;

  const invokeWithRetry = async (purpose: string, referenceUrl: string | undefined, retries = 3): Promise<string | null> => {
    for (let attempt = 0; attempt < retries; attempt++) {
      const { data, error } = await supabase.functions.invoke('generate-images', {
        body: {
          referenceImageUrl: referenceUrl,
          style: formData.preferredStyle,
          businessName: formData.businessName,
          businessDescription: formData.businessDescription,
          businessCategory: formData.businessCategory,
          websiteType: formData.websiteType,
          purpose,
        },
      });
      if (data?.imageUrl) return data.imageUrl;
      // If rate limited, wait and retry
      if (error?.message?.includes('429') || data?.error?.includes('Rate limit')) {
        const delay = 3000 * (attempt + 1);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      break; // non-retryable error
    }
    return null;
  };

  const handleGenerate = async () => {
    setIsGenerating(true);
    setGenerationProgress(0);

    if (formData.generateAiImages) {
      setIsGeneratingImages(true);
      const purposes = ['hero banner', 'about section background', 'services section'];
      const purposeLabels = ['Banner principal', 'Imagem da seção Sobre', 'Imagem da seção Serviços'];
      const referenceUrl = formData.images.heroImage1 || formData.images.brandImage || formData.images.sectionImage1 || undefined;

      try {
        const images: string[] = [];
        for (let idx = 0; idx < purposes.length; idx++) {
          setGenerationStatus(`Gerando imagem ${idx + 1}/${purposes.length}: ${purposeLabels[idx]}...`);
          setGenerationProgress(Math.round(((idx) / (purposes.length + 1)) * 100));
          const url = await invokeWithRetry(purposes[idx], referenceUrl);
          if (url) images.push(url);
        }

        setGeneratedImages(images);
        setGenerationStatus('Montando o prompt final...');
        setGenerationProgress(90);

        if (images.length > 0) {
          toast.success(`${images.length} imagens AI geradas com sucesso`);
        } else {
          toast.error('Não foi possível gerar imagens. Tente novamente.');
        }
      } catch (err) {
        console.error('Image generation error:', err);
        toast.error('Erro ao gerar imagens AI');
      } finally {
        setIsGeneratingImages(false);
      }
    } else {
      setGenerationStatus('Montando o prompt...');
      setGenerationProgress(50);
    }

    // Small delay for UX
    await new Promise(r => setTimeout(r, 600));
    setGenerationProgress(100);
    setGenerationStatus('Pronto!');
    await new Promise(r => setTimeout(r, 400));

    setIsGenerating(false);
    setShowResults(true);
  };

  const prompt = generatePrompt(formData, generatedImages);

  const handleCopy = () => {
    navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success('Prompt copied! Paste it into a new Lovable project.');
  };

  // Generating screen
  if (isGenerating) {
    return (
      <div className="min-h-screen bg-background relative flex flex-col">
        <div className="reactive-bg" />
        <Header />
        <main className="flex-1 flex items-center justify-center relative z-10 px-6">
          <div className="max-w-md w-full text-center space-y-8">
            <div className="relative inline-flex h-20 w-20 items-center justify-center mx-auto">
              <div className="absolute inset-0 rounded-full bg-primary/20 animate-ping" />
              <div className="relative h-20 w-20 rounded-full bg-primary/10 flex items-center justify-center">
                <Wand2 className="h-9 w-9 text-primary animate-pulse" />
              </div>
            </div>

            <div className="space-y-2">
              <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">
                Gerando seu prompt...
              </h2>
              <p className="text-muted-foreground text-sm min-h-[1.25rem]">
                {generationStatus}
              </p>
            </div>

            <div className="space-y-2">
              <Progress value={generationProgress} className="h-2" />
              <p className="text-xs text-muted-foreground">{generationProgress}%</p>
            </div>

            {formData.generateAiImages && (
              <div className="rounded-lg border border-border bg-card/50 p-4 text-left space-y-2">
                <p className="text-xs font-medium text-foreground flex items-center gap-2">
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                  Geração de imagens AI ativa
                </p>
                <p className="text-xs text-muted-foreground">
                  Criando imagens exclusivas baseadas no seu negócio. Isso pode levar alguns segundos...
                </p>
              </div>
            )}
          </div>
        </main>
      </div>
    );
  }

  // Results view
  if (showResults) {
    return (
      <div className="min-h-screen bg-background relative">
        <div className="reactive-bg" />
        <Header />
        <main className="mx-auto max-w-4xl px-6 py-8 relative z-10">
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

          {generatedImages.length > 0 && (
            <div className="glass-card rounded-xl p-6 mb-6">
              <h3 className="form-section-title mb-3">AI Generated Images</h3>
              <div className="grid grid-cols-3 gap-3">
                {generatedImages.map((img, i) => (
                  <img key={i} src={img} alt={`AI generated ${i + 1}`} className="rounded-lg w-full h-32 object-cover" />
                ))}
              </div>
            </div>
          )}

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

          <div className="glass-card rounded-xl p-6 mt-6">
            <h3 className="form-section-title mb-3">Next Steps</h3>
            <ol className="space-y-2 text-sm text-muted-foreground list-decimal list-inside">
              <li>Copy the prompt above</li>
              <li>Open <a href="https://lovable.dev" target="_blank" rel="noopener" className="text-primary hover:underline">lovable.dev</a> and create a new project</li>
              <li>Paste the prompt — Lovable will generate your full website</li>
              <li>Continue editing and customizing</li>
            </ol>
          </div>

          <div className="mt-6 flex gap-3">
            <Button variant="ghost" onClick={() => setShowResults(false)} className="gap-2">
              <ArrowLeft className="h-4 w-4" /> Edit Details
            </Button>
            <div className="ml-auto flex gap-3">
              <Button variant="outline" size="lg" onClick={handleCopy} className="gap-2">
                <Copy className="h-4 w-4" /> {copied ? 'Copiado!' : 'Copiar Prompt'}
              </Button>
              <Button variant="outline" size="lg" onClick={() => {
                navigator.clipboard.writeText(getLovableUrl());
                setCopiedLink(true);
                setTimeout(() => setCopiedLink(false), 2000);
                toast.success('Link copiado!');
              }} className="gap-2">
                {copiedLink ? <Check className="h-4 w-4" /> : <Link2 className="h-4 w-4" />}
                {copiedLink ? 'Copiado!' : 'Copiar Link'}
              </Button>
              <a
                href={getLovableUrl()}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button variant="gradient" size="lg" className="gap-2">
                  <ExternalLink className="h-4 w-4" /> Abrir no Lovable
                </Button>
              </a>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // Form view
  return (
    <div className="min-h-screen bg-background relative">
      <div className="reactive-bg" />
      <Header />
      <main className="mx-auto max-w-4xl px-6 py-8 relative z-10">
        <div className="mb-10 text-center">
          <h2 className="font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Generate Your Website
          </h2>
          <p className="mt-3 text-muted-foreground max-w-xl mx-auto">
            Fill in your business details and we'll generate a professional,
            conversion-focused website prompt for Lovable.
          </p>
        </div>

        <StepIndicator steps={steps} currentStep={currentStep} maxVisitedStep={maxVisitedStep} onStepClick={setCurrentStep} />

        <div className="mt-8 glass-card rounded-xl p-6 sm:p-8 animate-in-up" key={currentStepId}>
          {currentStepId === 'csv' && <StepCsvImport data={formData} onChange={updateForm} />}
          {currentStepId === 'type' && <StepWebsiteType data={formData} onChange={updateForm} />}
          {currentStepId === 'basics' && <StepBasics data={formData} onChange={updateForm} />}
          {currentStepId === 'services' && <StepServices data={formData} onChange={updateForm} />}
          {currentStepId === 'products' && <StepProducts data={formData} onChange={updateForm} />}
          {currentStepId === 'features' && <StepFeatures data={formData} onChange={updateForm} />}
          {currentStepId === 'courses' && <StepCourses data={formData} onChange={updateForm} />}
          {currentStepId === 'brand' && <StepBrand data={formData} onChange={updateForm} />}
          {currentStepId === 'pages' && <StepPages data={formData} onChange={updateForm} />}
          {currentStepId === 'images' && <StepImages data={formData} onChange={updateForm} />}
          {currentStepId === 'contact' && <StepContact data={formData} onChange={updateForm} />}
          {currentStepId === 'review' && <StepReview data={formData} />}
        </div>

        <div className="mt-6 flex justify-between">
          <Button variant="ghost" onClick={prev} disabled={currentStep === 0} className="gap-2">
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>

          {currentStep < steps.length - 1 ? (
            <Button onClick={next} className="gap-2">
              Next <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              variant="gradient"
              size="lg"
              onClick={handleGenerate}
              disabled={isGeneratingImages}
              className="gap-2"
            >
              {isGeneratingImages ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Generating Images...</>
              ) : (
                <><Sparkles className="h-4 w-4" /> Generate Prompt</>
              )}
            </Button>
          )}
        </div>
      </main>
    </div>
  );
};

function Header() {
  return (
    <header className="border-b border-border/50 px-6 py-[13px] relative z-10">
      <div className="mx-auto max-w-6xl flex items-center">
        <div className="flex items-center gap-2">
          <img src="/images/logo-small.png" alt="Logo" className="h-8 w-auto" />
          <img src="/images/logo.png" alt="Forge" className="h-7 w-auto" />
        </div>
      </div>
    </header>
  );
}

function generatePrompt(data: BusinessFormData, aiImages: string[]): string {
  const servicesText = data.services.filter(Boolean).join(', ');
  const diffsText = data.differentiators.filter(Boolean).join(', ');
  const socialText = Object.entries(data.socialLinks)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');
  const categoryHint = generatePagesSection(data);
  // Images section — keep compact to stay within prompt char limits
  const imgLines: string[] = [];
  if (data.images.logoUrl) imgLines.push(`Logo: ${data.images.logoUrl}`);
  if (data.images.heroImage1) imgLines.push(`Hero1: ${data.images.heroImage1}`);
  if (data.images.heroImage2) imgLines.push(`Hero2: ${data.images.heroImage2}`);
  if (data.images.brandImage) imgLines.push(`Brand: ${data.images.brandImage}`);
  if (data.images.sectionImage1) imgLines.push(`Sec1: ${data.images.sectionImage1}`);
  if (data.images.sectionImage2) imgLines.push(`Sec2: ${data.images.sectionImage2}`);
  if (data.images.sectionImage3) imgLines.push(`Sec3: ${data.images.sectionImage3}`);
  data.images.productImages.filter(Boolean).forEach((img, i) => imgLines.push(`Prod${i + 1}: ${img}`));
  aiImages.forEach((img, i) => imgLines.push(`AI${i + 1}: ${img}`));

  let typeSpecific = '';

  if (data.websiteType === 'ecommerce' && data.products.length > 0) {
    const prods = data.products.filter(p => p.name);
    if (prods.length > 0) {
      typeSpecific += `\n\n## Products\n`;
      prods.forEach(p => {
        const parts = [p.name];
        if (p.description) parts.push(p.description);
        if (p.price) parts.push(p.price);
        if (p.discountPrice) parts.push(`sale:${p.discountPrice}`);
        if (p.category) parts.push(`cat:${p.category}`);
        const variantParts = (p.variants || []).filter(v => v.name).map(v => `${v.name}: ${v.values.filter(Boolean).join(', ')}`);
        if (variantParts.length > 0) parts.push(`var:${variantParts.join(' / ')}`);
        if (p.sku) parts.push(`sku:${p.sku}`);
        const prodImages = p.images.filter(Boolean);
        if (prodImages.length > 0) parts.push(`images:${prodImages.join(', ')}`);
        typeSpecific += `- ${parts.join(' | ')}\n`;
      });
      typeSpecific += `Include: Product Page, Listing, Cart, Checkout.`;
    }
  }

  if (data.websiteType === 'saas') {
    const feats = data.features.filter(f => f.name);
    if (feats.length > 0) {
      typeSpecific += `\n\n## Features\n`;
      feats.forEach(f => {
        typeSpecific += `- ${f.icon ? f.icon + ' ' : ''}**${f.name}**: ${f.description}\n`;
      });
    }
    const plans = data.pricingPlans.filter(p => p.name);
    if (plans.length > 0) {
      typeSpecific += `\n\n## Pricing Plans\n`;
      plans.forEach(p => {
        typeSpecific += `### ${p.name} — ${p.price}\n`;
        p.features.filter(Boolean).forEach(f => { typeSpecific += `- ${f}\n`; });
      });
    }
  }

  if (data.websiteType === 'educational') {
    const courses = data.courses.filter(c => c.title);
    if (courses.length > 0) {
      typeSpecific += `\n\n## Courses\n`;
      courses.forEach(c => {
        typeSpecific += `### ${c.title}\n`;
        if (c.instructor) typeSpecific += `- Instructor: ${c.instructor}\n`;
        if (c.price) typeSpecific += `- Price: ${c.price}\n`;
        if (c.description) typeSpecific += `${c.description}\n`;
        if (c.modules) typeSpecific += `- Modules:\n${c.modules.split('\n').map(m => `  - ${m}`).join('\n')}\n`;
      });
    }
  }

  const websiteTypeLabel = data.websiteType === 'landing' ? 'landing page' :
    data.websiteType === 'ecommerce' ? 'e-commerce website' :
    data.websiteType === 'educational' ? 'educational/course platform' :
    `${data.websiteType} website`;

  return `Create a ${data.preferredStyle} ${websiteTypeLabel} for "${data.businessName}".

## Business
${data.businessDescription}
Industry: ${data.businessCategory} | Audience: ${data.targetAudience} | Location: ${data.city}, ${data.country}

## Services
${servicesText}
${data.valueProposition ? `Value: ${data.valueProposition}` : ''}
${diffsText ? `Differentiators: ${diffsText}` : ''}

## Design
Style: ${data.preferredStyle} | Colors: ${data.primaryColor}, ${data.secondaryColor}
${imgLines.length > 0 ? '\n## Images\n' + imgLines.join('\n') : ''}

## Contact
${data.email}${data.phone ? ` | Phone: ${data.phone}` : ''}${data.whatsapp ? ` | WhatsApp: ${data.whatsapp}` : ''}
${socialText ? `Social: ${socialText}` : ''}
${typeSpecific}

## Structure
${generatePagesSection(data)}

## Requirements
Responsive, mobile-first, SEO-optimized, semantic HTML, smooth animations, fast loading, strong CTAs.
${data.generateAiImages ? 'Use the AI-generated images as background photos and section images ONLY — never overlay text directly baked into images. These are purely photographic/illustrative assets to be used behind text overlays or as standalone photos.' : ''}

Generate a polished, production-ready website.`;
}

function getCategoryLayout(websiteType: WebsiteType, category: string): string {
  if (websiteType === 'ecommerce') {
    return `1. Hero with strong CTA
2. Featured Products / Highlights
3. Product Categories
4. Benefits / Why Choose Us
5. Testimonials
6. CTA Section
7. Product Listing Page
8. Product Detail Page
9. Cart Page
10. Checkout Page
11. Contact / Footer`;
  }
  if (websiteType === 'saas') {
    return `1. Hero Section with headline & CTA
2. Trusted By / Social Proof
3. Features Overview
4. Feature Deep Dives
5. Pricing Section
6. FAQ
7. Testimonials
8. CTA Section
9. Footer`;
  }
  if (websiteType === 'educational') {
    return `1. Hero Section
2. Featured Courses
3. Course Catalog
4. How It Works
5. Instructor Profiles
6. Student Testimonials
7. Pricing / Enrollment CTA
8. FAQ
9. Footer`;
  }
  if (websiteType === 'landing') {
    return `1. Hero with compelling headline & CTA
2. Problem / Pain Points
3. Solution / How It Works
4. Benefits
5. Social Proof / Testimonials
6. Final CTA
7. Footer`;
  }
  if (websiteType === 'portfolio') {
    return `1. Hero / Introduction
2. Selected Work / Projects Gallery
3. About / Bio
4. Skills / Expertise
5. Testimonials
6. Contact
7. Footer`;
  }
  if (websiteType === 'blog') {
    return `1. Hero / Featured Post
2. Recent Articles Grid
3. Categories
4. Newsletter Signup
5. About
6. Footer`;
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
