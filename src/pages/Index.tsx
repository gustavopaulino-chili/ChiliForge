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
  } catch { }
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
  const [generatedImages, setGeneratedImages] = useState<{ url: string; purpose: string }[]>([]);
  const [generationStatus, setGenerationStatus] = useState('');
  const [generationProgress, setGenerationProgress] = useState(0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  const getLovableUrl = useCallback(() => {
    const promptText = generatePrompt(formData, generatedImages);
    return `https://lovable.dev/projects/create#prompt=${encodeURIComponent(promptText)}`;
  }, [formData, generatedImages]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      document.documentElement.style.setProperty('--mouse-x', `${e.clientX}px`);
      document.documentElement.style.setProperty('--mouse-y', `${e.clientY}px`);
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

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
      if (error?.message?.includes('429') || data?.error?.includes('Rate limit')) {
        const delay = 3000 * (attempt + 1);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      break;
    }
    return null;
  };

  const handleGenerate = async () => {
    setIsGenerating(true);
    setGenerationProgress(0);

    if (formData.generateAiImages) {
      setIsGeneratingImages(true);
      const purposes = ['hero banner', 'about section background', 'services section'];
      const purposeLabels = ['Hero Banner', 'About Section', 'Services Section'];
      const referenceUrl = formData.images.heroImage1 || formData.images.brandImage || formData.images.sectionImage1 || undefined;

      try {
        const images: { url: string; purpose: string }[] = [];
        for (let idx = 0; idx < purposes.length; idx++) {
          setGenerationStatus(`Generating image ${idx + 1}/${purposes.length}: ${purposeLabels[idx]}...`);
          setGenerationProgress(Math.round(((idx) / (purposes.length + 1)) * 100));
          const url = await invokeWithRetry(purposes[idx], referenceUrl);
          if (url) images.push({ url, purpose: purposeLabels[idx] });
        }

        setGeneratedImages(images);
        setGenerationStatus('Building final prompt...');
        setGenerationProgress(90);

        if (images.length > 0) {
          toast.success(`${images.length} AI images generated successfully`);
        } else {
          toast.error('Could not generate images. Try again.');
        }
      } catch (err) {
        console.error('Image generation error:', err);
        toast.error('Error generating AI images');
      } finally {
        setIsGeneratingImages(false);
      }
    } else {
      setGenerationStatus('Building prompt...');
      setGenerationProgress(50);
    }

    await new Promise(r => setTimeout(r, 600));
    setGenerationProgress(100);
    setGenerationStatus('Done!');
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
                Generating your prompt...
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
                  AI image generation active
                </p>
                <p className="text-xs text-muted-foreground">
                  Creating exclusive images based on your business. This may take a few seconds...
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
                  <img key={i} src={img.url} alt={img.purpose} className="rounded-lg w-full h-32 object-cover" />
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
                <Copy className="h-4 w-4" /> {copied ? 'Copied!' : 'Copy Prompt'}
              </Button>
              <Button variant="outline" size="lg" onClick={() => {
                navigator.clipboard.writeText(getLovableUrl());
                setCopiedLink(true);
                setTimeout(() => setCopiedLink(false), 2000);
                toast.success('Link copied!');
              }} className="gap-2">
                {copiedLink ? <Check className="h-4 w-4" /> : <Link2 className="h-4 w-4" />}
                {copiedLink ? 'Copied!' : 'Copy Link'}
              </Button>
              <Button variant="gradient" size="lg" className="gap-2" onClick={() => {
                const url = getLovableUrl();
                const w = window.open('', '_blank');
                if (w) {
                  w.location.href = url;
                } else {
                  navigator.clipboard.writeText(url);
                  toast.error('Popup blocked. Link copied to clipboard instead.');
                }
              }}>
                <ExternalLink className="h-4 w-4" /> Open in Lovable
              </Button>
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

function generatePrompt(data: BusinessFormData, aiImages: { url: string; purpose: string }[]): string {
  const servicesText = data.services.filter(Boolean).join(', ');
  const diffsText = data.differentiators.filter(Boolean).join(', ');
  const socialText = Object.entries(data.socialLinks)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');

  const imgLines: string[] = [];
  if (data.images.logoUrl) imgLines.push(`Logo: ${data.images.logoUrl}`);
  if (data.images.heroImage1) imgLines.push(`Hero Banner 1: ${data.images.heroImage1}`);
  if (data.images.heroImage2) imgLines.push(`Hero Banner 2: ${data.images.heroImage2}`);
  if (data.images.brandImage) imgLines.push(`Brand Image: ${data.images.brandImage}`);
  if (data.images.sectionImage1) imgLines.push(`Section Image 1: ${data.images.sectionImage1}`);
  if (data.images.sectionImage2) imgLines.push(`Section Image 2: ${data.images.sectionImage2}`);
  if (data.images.sectionImage3) imgLines.push(`Section Image 3: ${data.images.sectionImage3}`);
  data.images.productImages.filter(Boolean).forEach((img, i) => imgLines.push(`Product Image ${i + 1}: ${img}`));
  aiImages.forEach(img => imgLines.push(`${img.purpose} (AI Generated): ${img.url}`));

  let typeSpecific = '';

  if (data.websiteType === 'ecommerce' && data.products.length > 0) {
    const prods = data.products.filter(p => p.name);
    if (prods.length > 0) {
      typeSpecific += `\nPRODUCT CATALOG:\n`;
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
    }
  }

  if (data.websiteType === 'saas') {
    const feats = data.features.filter(f => f.name);
    if (feats.length > 0) {
      typeSpecific += `\nFEATURES:\n`;
      feats.forEach(f => {
        typeSpecific += `- ${f.icon ? f.icon + ' ' : ''}${f.name}: ${f.description}\n`;
      });
    }
    const plans = data.pricingPlans.filter(p => p.name);
    if (plans.length > 0) {
      typeSpecific += `\nPRICING PLANS:\n`;
      plans.forEach(p => {
        typeSpecific += `${p.name} — ${p.price}: ${p.features.filter(Boolean).join(', ')}\n`;
      });
    }
  }

  if (data.websiteType === 'educational') {
    const courses = data.courses.filter(c => c.title);
    if (courses.length > 0) {
      typeSpecific += `\nCOURSE CATALOG:\n`;
      courses.forEach(c => {
        typeSpecific += `- ${c.title}${c.instructor ? ` by ${c.instructor}` : ''}${c.price ? ` | ${c.price}` : ''}${c.description ? ` — ${c.description}` : ''}\n`;
      });
    }
  }

  const websiteTypeLabel = data.websiteType === 'landing' ? 'Landing Page' :
    data.websiteType === 'ecommerce' ? 'E-commerce Website' :
    data.websiteType === 'educational' ? 'Educational / Course Platform' :
    data.websiteType === 'saas' ? 'SaaS Website' :
    data.websiteType === 'portfolio' ? 'Portfolio Website' :
    data.websiteType === 'blog' ? 'Blog Website' :
    'Corporate Website';

  const adaptationLogic = data.websiteType === 'ecommerce'
    ? `Ecommerce: Homepage prioritizes product visibility. Include featured products, product grid, category navigation, product page template, cart behavior, checkout flow.`
    : data.websiteType === 'saas'
    ? `SaaS: Hero with clear value prop & CTA. Features overview with deep dives. Pricing with plan comparison. Social proof. FAQ.`
    : data.websiteType === 'educational'
    ? `Educational: Featured courses, course catalog with filtering, course detail template, instructor profiles, enrollment CTA.`
    : data.websiteType === 'landing'
    ? `Landing Page: Single-page conversion-focused. Problem → Solution → Benefits → Social Proof → CTA flow. Strong above-the-fold hook.`
    : data.websiteType === 'portfolio'
    ? `Portfolio: Visual-first project showcase, case study layout, skills/expertise section, clean minimal aesthetic.`
    : data.websiteType === 'blog'
    ? `Blog: Featured post hero, article grid with categories, newsletter signup, clean reading experience.`
    : `Corporate: Authority and trust emphasis, services sections, team/about, testimonials and trust indicators.`;

  return `You are a senior UX strategist, UI designer and front-end architect building a real production-ready website inside Lovable.

You must strictly use the structured data provided below.
Do NOT ignore the provided data.
Do NOT generate generic layouts.
Everything must be strategically aligned with the data below.

================================================
STRUCTURED BUSINESS DATA
================================================

WEBSITE TYPE: ${websiteTypeLabel}
STYLE: ${data.preferredStyle}

COMPANY DESCRIPTION:
Name: ${data.businessName}
${data.businessDescription}
Industry: ${data.businessCategory}
Target Audience: ${data.targetAudience}
${data.valueProposition ? `Value Proposition: ${data.valueProposition}` : ''}
Location: ${[data.city, data.country].filter(Boolean).join(', ')}

SERVICES & DIFFERENTIATORS:
${servicesText || 'Not specified'}
${diffsText ? `Key Differentiators: ${diffsText}` : ''}

DESIGN FOUNDATION:
Style: ${data.preferredStyle}
Primary Color: ${data.primaryColor}
Secondary Color: ${data.secondaryColor}

CONTACT INFORMATION:
${data.email ? `Email: ${data.email}` : ''}
${data.phone ? `Phone: ${data.phone}` : ''}
${data.whatsapp ? `WhatsApp: ${data.whatsapp}` : ''}
${socialText ? `Social Media: ${socialText}` : ''}
${imgLines.length > 0 ? `\nIMAGE LIBRARY:\n${imgLines.join('\n')}\n\nDownload these images and use them based on context. Study them and use as base for the rest of the design.\nIF THE IMAGES DON'T LOAD, GENERATE IMAGES BASED ON THE CONTEXT.` : ''}
${aiImages.length > 0 ? `\nAI-GENERATED IMAGES INSTRUCTIONS:
The following images were specifically generated for this website. You MUST download and use each one in its designated section:
${aiImages.map(img => `- Use "${img.purpose}" image (${img.url}) as the background/visual for the ${img.purpose.toLowerCase()} section`).join('\n')}
These are photographic/illustrative assets ONLY — never overlay text directly baked into them. Place text as HTML overlays on top of these images.
If any image URL fails to load, generate a replacement image matching the same purpose and style.` : ''}
${typeSpecific}
SITE STRUCTURE:
${generatePagesSection(data)}

================================================
EXECUTION RULES:
1. Analyze the business data first.
2. Detect automatically:
   - Website type and adapt layout
   - UX weaknesses to avoid
   - Competitive gaps to exploit
3. Adapt the structure accordingly.

================================================
MANDATORY STRUCTURE REQUIREMENTS:

This must be a complete visual website, not a conceptual blueprint.
Include:
• Real header with logo placement, navigation menu, CTA button, sticky behavior
• Proper responsive mobile menu
• Hero section aligned with value proposition, background images, CTA with text
• Alternating section backgrounds
• Clear spacing system and professional layout grid
• Real footer with navigation columns, contact info, legal links, social icons
• Defined CTA placements
• Proper visual hierarchy
• Typography structure (H1, H2, H3)

================================================
ADAPTATION LOGIC:

${adaptationLogic}

================================================
DESIGN SYSTEM:

Use exact brand colors (${data.primaryColor}, ${data.secondaryColor}).
Visual consistency across all pages.
Strategic whitespace. Strong hierarchy. Mobile-first. Accessibility (WCAG).
Modern premium aesthetic: "${data.preferredStyle}" style.

================================================
SEO REQUIREMENTS (MANDATORY):

Every page: H1-H3 hierarchy, meta title & description, keyword strategy, internal linking, SEO-friendly URLs, image alt-text, semantic HTML, performance optimized.

================================================
FINAL REQUIREMENTS:

Responsive, mobile-first, SEO-optimized, semantic HTML, smooth animations (framer-motion), fast loading, strong CTAs, accessibility compliant.
This must feel like a premium agency project. It must not look like a generic AI layout.
Generate a polished, production-ready website.`;
}

function generatePagesSection(data: BusinessFormData): string {
  const config = data.pagesConfig || { mode: 'manual', aiSummary: '', pages: [] };

  if (config.mode === 'ai' && config.aiSummary.trim()) {
    return `The user described the site content as follows (AI should interpret and create pages/sections accordingly):\n\"${config.aiSummary.trim()}\"`;
  }

  if (config.pages.length > 0) {
    const enabledPages = config.pages.filter(p => p.enabled);
    if (enabledPages.length > 0) {
      let result = `The site should have ${enabledPages.length} page(s):\n`;
      enabledPages.forEach((page, i) => {
        result += `\n### Page ${i + 1}: ${page.name}${page.required ? ' (required)' : ''}`;
        if (page.description) {
          result += `\nDescription: ${page.description}`;
        }
        if (page.sections.length > 0) {
          page.sections.forEach(s => {
            result += `\n- **${s.title || 'Section'}**: ${s.description || '(content to be defined)'}`;
          });
        }
      });
      return result;
    }
  }

  return getCategoryLayout(data.websiteType, data.businessCategory);
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
