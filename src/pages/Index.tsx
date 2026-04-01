import { useState, useMemo, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import logoResult from '@/assets/logo-result.png';
import { BusinessFormData, defaultFormData, LANDING_PRESETS, LandingPreset } from '@/types/businessForm';
import { StepIndicator } from '@/components/generator/StepIndicator';
import { StepCsvImport } from '@/components/generator/StepCsvImport';
import { StepWebsiteType } from '@/components/generator/StepWebsiteType';
import { StepBasics } from '@/components/generator/StepBasics';
import { StepServices } from '@/components/generator/StepServices';
import { StepBrand } from '@/components/generator/StepBrand';
import { StepImages } from '@/components/generator/StepImages';
import { StepContact } from '@/components/generator/StepContact';
import { StepReview } from '@/components/generator/StepReview';
import { StepPages } from '@/components/generator/StepPages';
import { NicheTemplateSelector } from '@/components/generator/NicheTemplateSelector';
import { PromptPreview } from '@/components/generator/PromptPreview';
import { HeroLanding } from '@/components/landing/HeroLanding';
import { Button } from '@/components/ui/button';
import { ArrowLeft, ArrowRight, Sparkles, Copy, Check, ExternalLink, Loader2, Wand2, Link2, RotateCcw, Clock, Download, Monitor, Smartphone, Tablet, Code } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

type StepDef = { id: string; label: string };

const STEPS: StepDef[] = [
  { id: 'csv', label: 'Import' },
  { id: 'type', label: 'Preset' },
  { id: 'basics', label: 'Basics' },
  { id: 'services', label: 'Services' },
  { id: 'pages', label: 'Sections' },
  { id: 'brand', label: 'Brand' },
  { id: 'images', label: 'Images' },
  { id: 'contact', label: 'Contact' },
  { id: 'review', label: 'Review' },
];

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
  const [showLanding, setShowLanding] = useState(!saved);
  const [isTransitioning, setIsTransitioning] = useState(false);
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
  const [generatedHtml, setGeneratedHtml] = useState('');
  const [isGeneratingLanding, setIsGeneratingLanding] = useState(false);
  const [previewViewport, setPreviewViewport] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');

  const getLovableUrl = useCallback(() => {
    const promptText = generatePrompt(formData, generatedImages);
    return `https://lovable.dev/projects/create#prompt=${encodeURIComponent(promptText)}`;
  }, [formData, generatedImages]);

  const handleStartGenerator = () => {
    setIsTransitioning(true);
    setTimeout(() => {
      setShowLanding(false);
      setIsTransitioning(false);
    }, 500);
  };
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      document.documentElement.style.setProperty('--mouse-x', `${e.clientX}px`);
      document.documentElement.style.setProperty('--mouse-y', `${e.clientY}px`);
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [showLanding]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ currentStep, formData, maxVisitedStep }));
  }, [currentStep, formData]);

  const steps = STEPS;

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

  const invokeWithRetry = async (purpose: string, referenceUrl: string | undefined, retries = 4): Promise<string | null> => {
    for (let attempt = 0; attempt < retries; attempt++) {
      if (attempt > 0) {
        const waitSec = 3 * (attempt + 1);
        setGenerationStatus(`Rate limited — retrying in ${waitSec}s (attempt ${attempt + 1}/${retries})...`);
        await new Promise(r => setTimeout(r, waitSec * 1000));
      }
      const { data, error } = await supabase.functions.invoke('generate-images', {
        body: {
          referenceImageUrl: referenceUrl,
          style: formData.preferredStyle,
          businessName: formData.businessName,
          businessDescription: formData.businessDescription,
          businessCategory: formData.businessCategory,
          websiteType: 'landing',
          purpose,
        },
      });
      if (data?.imageUrl) return data.imageUrl;
      if (error?.message?.includes('429') || data?.error?.includes('Rate limit')) {
        continue;
      }
      break;
    }
    return null;
  };

  const searchPexelsImages = async (): Promise<string[]> => {
    const searchTerms = [
      formData.businessCategory || formData.businessName || 'business',
      formData.services.filter(Boolean)[0] || 'professional',
      formData.preferredStyle || 'modern',
    ];
    const query = `${searchTerms.join(' ')} website`;
    
    try {
      setGenerationStatus('Searching stock images on Pexels...');
      const { data, error } = await supabase.functions.invoke('search-images', {
        body: { query, count: 3 },
      });
      if (error || !data?.images?.length) {
        console.warn('Pexels search returned no results:', error);
        return [];
      }
      return data.images.map((img: any) => img.url).filter(Boolean);
    } catch (err) {
      console.error('Pexels search error:', err);
      return [];
    }
  };

  const hasUserImages = () => {
    const imgs = formData.images;
    return !!(imgs.heroImage1 || imgs.heroImage2 || imgs.brandImage || imgs.sectionImage1 || imgs.sectionImage2 || imgs.sectionImage3);
  };

  const handleGenerate = async () => {
    setIsGenerating(true);
    setGenerationProgress(0);
    setGeneratedHtml('');

    if (formData.generateAiImages) {
      setIsGeneratingImages(true);
      const purposes = ['hero banner', 'about section background', 'services section'];
      const purposeLabels = ['Hero Banner', 'About Section', 'Services Section'];
      const referenceUrl = formData.images.heroImage1 || formData.images.brandImage || formData.images.sectionImage1 || undefined;

      try {
        const images: string[] = [];
        for (let idx = 0; idx < purposes.length; idx++) {
          setGenerationStatus(`Generating image ${idx + 1}/${purposes.length}: ${purposeLabels[idx]}...`);
          setGenerationProgress(Math.round(((idx) / (purposes.length + 3)) * 100));
          const url = await invokeWithRetry(purposes[idx], referenceUrl);
          if (url) images.push(url);
        }
        setGeneratedImages(images);
        if (images.length > 0) toast.success(`${images.length}/${purposes.length} AI images generated`);
      } catch (err) {
        console.error('Image generation error:', err);
        toast.error('Error generating AI images');
      } finally {
        setIsGeneratingImages(false);
      }
    } else if (!hasUserImages()) {
      setGenerationStatus('Searching for relevant stock images...');
      setGenerationProgress(10);
      const pexelsImages = await searchPexelsImages();
      if (pexelsImages.length > 0) {
        setGeneratedImages(pexelsImages);
        toast.success(`Found ${pexelsImages.length} stock images from Pexels`);
      }
    }

    setGenerationStatus('Generating your landing page with AI...');
    setGenerationProgress(50);

    const currentPrompt = generatePrompt(formData, generatedImages.length > 0 ? generatedImages : []);

    try {
      const { data, error } = await supabase.functions.invoke('generate-landing', {
        body: {
          prompt: currentPrompt,
          businessName: formData.businessName,
        },
      });

      if (error) {
        console.error('Generate landing error:', error);
        toast.error('Failed to generate landing page. Please try again.');
        setIsGenerating(false);
        return;
      }

      if (data?.error) {
        toast.error(data.error);
        setIsGenerating(false);
        return;
      }

      if (data?.html) {
        setGeneratedHtml(data.html);
        setGenerationProgress(100);
        setGenerationStatus('Landing page generated!');
        toast.success('Landing page generated successfully!');
        await new Promise(r => setTimeout(r, 500));
        setIsGenerating(false);
        setShowResults(true);
      } else {
        throw new Error('No HTML returned');
      }
    } catch (err) {
      console.error('Generate landing error:', err);
      toast.error('Failed to generate landing page. Please try again.');
      setIsGenerating(false);
    }
  };

  const prompt = generatePrompt(formData, generatedImages);

  const handleCopy = () => {
    navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success('Prompt copied! Paste it into a new Lovable project.');
  };

  // Landing page
  if (showLanding) {
    return (
      <div className={`transition-all duration-500 ${isTransitioning ? 'opacity-0 scale-95' : 'opacity-100 scale-100'}`}>
        <header className="fixed top-0 left-0 right-0 border-b border-border/50 px-6 py-[13px] z-50 bg-background/80 backdrop-blur-md">
          <div className="mx-auto max-w-6xl flex items-center justify-between">
            <button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} className="flex items-center gap-2 cursor-pointer">
              <img src="/images/logo-small.png" alt="Logo" className="h-8 w-auto" />
              <img src="/images/logo.png" alt="Forge" className="h-7 w-auto" />
            </button>
            <Link to="/history">
              <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground hover:text-foreground">
                <Clock className="h-4 w-4" /> History
              </Button>
            </Link>
          </div>
        </header>
        <HeroLanding onStartGenerator={handleStartGenerator} />
      </div>
    );
  }

  // Generating screen
  if (isGenerating) {
    return (
      <div className="min-h-screen bg-background relative flex flex-col">
        <div className="reactive-bg-mouse" />
        <Header onLogoClick={() => setShowLanding(true)} />
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
                Generating your landing page...
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

  // Results view — ZIP download
  if (showResults && generatedHtml) {
    const viewportWidths = { desktop: '100%', tablet: '768px', mobile: '375px' };

    const handleDownloadHtml = () => {
      const projectName = (formData.businessName || 'landing-page')
        .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const blob = new Blob([generatedHtml], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${projectName}.html`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('HTML file downloaded!');
    };

    const handleViewCode = () => {
      const win = window.open('', '_blank');
      if (win) {
        win.document.write(`<pre style="white-space:pre-wrap;word-break:break-word;font-family:monospace;font-size:13px;padding:20px;background:#1a1a2e;color:#e0e0e0;">${generatedHtml.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>`);
        win.document.close();
      }
    };

    return (
      <div className="min-h-screen bg-background relative flex flex-col">
        <div className="reactive-bg-mouse" />
        <Header onLogoClick={() => setShowLanding(true)} />
        <main className="flex-1 flex flex-col mx-auto max-w-7xl w-full px-4 py-6 relative z-10">
          <div className="text-center mb-6">
            <div className="mb-3">
              <img src={logoResult} alt="ChiliForge" className="h-12 w-auto mx-auto object-contain" />
            </div>
            <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">
              Your Landing Page is Ready! 🎉
            </h2>
            <p className="mt-1.5 text-muted-foreground text-sm max-w-xl mx-auto">
              Preview your landing page below. Download the HTML file to use it anywhere — no build step needed.
            </p>
          </div>

          {/* Toolbar */}
          <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
            <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-1">
              <button
                onClick={() => setPreviewViewport('desktop')}
                className={`p-2 rounded-md transition-colors ${previewViewport === 'desktop' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                title="Desktop"
              >
                <Monitor className="h-4 w-4" />
              </button>
              <button
                onClick={() => setPreviewViewport('tablet')}
                className={`p-2 rounded-md transition-colors ${previewViewport === 'tablet' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                title="Tablet"
              >
                <Tablet className="h-4 w-4" />
              </button>
              <button
                onClick={() => setPreviewViewport('mobile')}
                className={`p-2 rounded-md transition-colors ${previewViewport === 'mobile' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                title="Mobile"
              >
                <Smartphone className="h-4 w-4" />
              </button>
            </div>

            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleViewCode} className="gap-2">
                <Code className="h-4 w-4" /> View Code
              </Button>
              <Button variant="outline" size="sm" onClick={handleDownloadHtml} className="gap-2">
                <Download className="h-4 w-4" /> Download HTML
              </Button>
              <Button
                variant="gradient"
                size="sm"
                onClick={() => {
                  const win = window.open('', '_blank');
                  if (win) {
                    win.document.write(generatedHtml);
                    win.document.close();
                  }
                }}
                className="gap-2"
              >
                <ExternalLink className="h-4 w-4" /> Open Full Screen
              </Button>
            </div>
          </div>

          {/* Live Preview */}
          <div className="flex-1 rounded-xl border border-border bg-muted/30 overflow-hidden flex justify-center" style={{ minHeight: '600px' }}>
            <iframe
              srcDoc={generatedHtml}
              className="bg-background rounded-lg shadow-lg transition-all duration-300"
              style={{
                width: viewportWidths[previewViewport],
                maxWidth: '100%',
                height: '100%',
                minHeight: '600px',
                border: 'none',
              }}
              title="Landing Page Preview"
              sandbox="allow-scripts allow-same-origin"
            />
          </div>

          {/* Bottom actions */}
          <div className="mt-4 flex gap-3">
            <Button
              variant="ghost"
              onClick={() => {
                setShowResults(false);
                setGeneratedHtml('');
              }}
              className="gap-2"
            >
              <ArrowLeft className="h-4 w-4" /> Edit & Regenerate
            </Button>
          </div>
        </main>
      </div>
    );
  }

  // Form view
  return (
    <div className="min-h-screen bg-background relative">
      <div className="reactive-bg-mouse" />
      <Header onLogoClick={() => setShowLanding(true)} />
      <main className="mx-auto max-w-4xl px-6 py-8 relative z-10">
        <div className="mb-10 text-center">
          <h2 className="font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Generate Your Landing Page
          </h2>
          <p className="mt-3 text-muted-foreground max-w-xl mx-auto">
            Fill in your business details and we'll generate a professional,
            conversion-focused landing page prompt for Lovable.
          </p>
        </div>

        <StepIndicator steps={steps} currentStep={currentStep} maxVisitedStep={maxVisitedStep} onStepClick={setCurrentStep} />

        <div className="mt-8 glass-card rounded-xl p-6 sm:p-8 animate-in-up" key={currentStepId}>
          {currentStepId === 'csv' && (
            <>
              <StepCsvImport data={formData} onChange={updateForm} />
              <div className="mt-6">
                <NicheTemplateSelector onApply={(updates) => {
                  updateForm(updates);
                  toast.success('Template applied! Review and customize the data.');
                }} />
              </div>
            </>
          )}
          {currentStepId === 'type' && <StepWebsiteType data={formData} onChange={updateForm} />}
          {currentStepId === 'basics' && <StepBasics data={formData} onChange={updateForm} />}
          {currentStepId === 'services' && <StepServices data={formData} onChange={updateForm} />}
          {currentStepId === 'brand' && <StepBrand data={formData} onChange={updateForm} />}
          {currentStepId === 'pages' && <StepPages data={formData} onChange={updateForm} />}
          {currentStepId === 'images' && <StepImages data={formData} onChange={updateForm} />}
          {currentStepId === 'contact' && <StepContact data={formData} onChange={updateForm} />}
          {currentStepId === 'review' && <StepReview data={formData} />}
        </div>

        {/* Live Prompt Preview */}
        <div className="mt-4">
          <PromptPreview prompt={prompt} />
        </div>

        <div className="mt-6 flex justify-between">
          <div className="flex gap-2">
            <Button variant="ghost" onClick={prev} disabled={currentStep === 0} className="gap-2">
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                if (window.confirm('Clear all form data and start over?')) {
                  setFormData(defaultFormData);
                  setCurrentStep(0);
                  setMaxVisitedStep(0);
                  setShowResults(false);
                  setGeneratedHtml('');
                  setGeneratedImages([]);
                  toast.success('Form cleared');
                }
              }}
              className="gap-2 text-destructive hover:text-destructive"
            >
              <RotateCcw className="h-4 w-4" /> Clear
            </Button>
          </div>

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
                <><Sparkles className="h-4 w-4" /> Generate Landing Page</>
              )}
            </Button>
          )}
        </div>
      </main>
    </div>
  );
};

function Header({ onLogoClick }: { onLogoClick?: () => void }) {
  return (
    <header className="sticky top-0 border-b border-border/50 px-6 py-[13px] z-50 bg-background/60 backdrop-blur-md">
      <div className="mx-auto max-w-6xl flex items-center justify-between">
        <button onClick={onLogoClick} className="flex items-center gap-2 cursor-pointer">
          <img src="/images/logo-small.png" alt="Logo" className="h-8 w-auto" />
          <img src="/images/logo.png" alt="Forge" className="h-7 w-auto" />
        </button>
        <Link to="/history">
          <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground hover:text-foreground">
            <Clock className="h-4 w-4" /> History
          </Button>
        </Link>
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

  const imgLines: string[] = [];
  if (data.images.logoUrl) imgLines.push(`Logo: ${data.images.logoUrl}`);
  if (data.images.heroImage1) imgLines.push(`Hero Banner 1: ${data.images.heroImage1}${data.heroImage1Context ? ` (Context: ${data.heroImage1Context})` : ''}`);
  if (data.images.heroImage2) imgLines.push(`Hero Banner 2: ${data.images.heroImage2}${data.heroImage2Context ? ` (Context: ${data.heroImage2Context})` : ''}`);
  if (data.images.brandImage) imgLines.push(`Brand Image: ${data.images.brandImage}${data.brandImageContext ? ` (Context: ${data.brandImageContext})` : ''}`);
  if (data.images.sectionImage1) imgLines.push(`Section Image 1: ${data.images.sectionImage1}${data.sectionImage1Context ? ` (Context: ${data.sectionImage1Context})` : ''}`);
  if (data.images.sectionImage2) imgLines.push(`Section Image 2: ${data.images.sectionImage2}${data.sectionImage2Context ? ` (Context: ${data.sectionImage2Context})` : ''}`);
  if (data.images.sectionImage3) imgLines.push(`Section Image 3: ${data.images.sectionImage3}${data.sectionImage3Context ? ` (Context: ${data.sectionImage3Context})` : ''}`);
  data.images.productImages.filter(Boolean).forEach((img, i) => imgLines.push(`Product Image ${i + 1}: ${img}`));
  if (data.generateAiImages) {
    aiImages.forEach((img, i) => imgLines.push(`AI Generated ${i + 1}: ${img}`));
  } else if (aiImages.length > 0) {
    aiImages.forEach((img, i) => imgLines.push(`Stock Photo (Pexels) ${i + 1}: ${img}`));
  }

  const presetLabel = LANDING_PRESETS.find(p => p.value === data.landingPreset)?.label || 'Landing Page';

  const presetContext: Record<LandingPreset, string> = {
    'general': 'Institutional landing page presenting the company, services, and lead capture.',
    'campaign': 'Marketing campaign page with strong CTA, urgency elements, and conversion focus. Include campaign-specific messaging and promotional content.',
    'black-friday': 'Black Friday / promotional page with countdown timer, discount badges, urgency messaging, limited-time offers, and bold promotional design. Use high-contrast colors and excitement-driven layout.',
    'launch': 'Product launch page with impactful hero, product showcase, features highlight, pre-order/waitlist CTA, and excitement-building sections.',
    'webinar': 'Event/webinar registration page with event details, speaker profiles, agenda, countdown to event, and prominent registration form.',
    'lead-capture': 'Lead generation page with compelling offer (ebook, free trial, consultation), benefit bullets, trust indicators, and optimized form placement above the fold.',
    'app-download': 'App download promotion page with device mockups, feature highlights, app store badges, screenshots/preview, and download CTAs.',
    'seasonal': 'Seasonal/holiday themed landing page with festive design elements, special offers, themed imagery, and celebration-driven messaging.',
  };

  return `You are a senior UX strategist, UI designer and front-end architect building a real production-ready LANDING PAGE inside Lovable.

You must strictly use the structured data provided below.
Do NOT ignore the provided data.
Do NOT generate generic layouts.
Everything must be strategically aligned with the data below.

================================================
STRUCTURED BUSINESS DATA
================================================

LANDING PAGE TYPE: ${presetLabel}
PRESET CONTEXT: ${presetContext[data.landingPreset] || presetContext['general']}
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
Accent Color: ${data.accentColor}
Text Color: ${data.textColor}
Background Color: ${data.backgroundColor}
${data.headingFont ? `Heading Font: ${data.headingFont}` : ''}
${data.bodyFont ? `Body Font: ${data.bodyFont}` : ''}
${data.headingFont || data.bodyFont ? '\nIMPORTANT: Use the specified fonts via Google Fonts import. These are the exact fonts from the original website and MUST be used.' : ''}

CONTACT INFORMATION:
${data.email ? `Email: ${data.email}` : ''}
${data.phone ? `Phone: ${data.phone}` : ''}
${data.whatsapp ? `WhatsApp: ${data.whatsapp}` : ''}
${socialText ? `Social Media: ${socialText}` : ''}
${imgLines.length > 0 ? `\nIMAGE LIBRARY:\n${imgLines.join('\n')}\n\nDownload these images and use them based on context. Study them and use as base for the rest of the design.${data.generateAiImages ? '\nIF THE IMAGES DON\'T LOAD, GENERATE IMAGES BASED ON THE CONTEXT.' : '\nDO NOT generate any AI images. Only use the provided image URLs above. If an image fails to load, use a placeholder or leave blank.'}${!data.generateAiImages && aiImages.length > 0 ? '\nThe Stock Photos from Pexels are professional stock images — use them as hero backgrounds, section backgrounds, or decorative photos. They are free to use (Pexels license).' : ''}` : ''}
${data.generateAiImages ? '\nIMPORTANT: Use AI-generated images as background photos and section images ONLY — never overlay text directly baked into images. These are purely photographic/illustrative assets.' : '\nIMPORTANT: DO NOT generate, create, or use any AI-generated images. Only use images explicitly provided in the IMAGE LIBRARY above. If no images were provided, use only solid colors, gradients, or CSS patterns for backgrounds.'}
${data.sourceWebsite ? `\nSOURCE WEBSITE REFERENCE:\nThis website is based on: ${data.sourceWebsite}\nThe generated landing page MUST follow a similar visual design, layout structure, and aesthetic to the source website.` : ''}
${data.designNotes ? `\nDESIGN ANALYSIS FROM SOURCE WEBSITE:\n${data.designNotes}\n\nCRITICAL: You MUST replicate the design patterns, layout structure, typography choices, spacing, color usage, and visual style described above.` : ''}

SITE STRUCTURE:
${generatePagesSection(data)}

================================================
EXECUTION RULES:
1. This is a SINGLE-PAGE LANDING PAGE — conversion-focused.
2. Adapt layout to the preset type: ${presetLabel}.
3. Follow the Problem → Solution → Benefits → Social Proof → CTA flow.
4. Strong above-the-fold hook with compelling headline and CTA.

================================================
MANDATORY STRUCTURE REQUIREMENTS:

This must be a complete visual landing page built as a SINGLE self-contained HTML file.
Include:
• Real header with logo text/placement, navigation anchors, CTA button, sticky behavior
• Proper responsive mobile hamburger menu with JavaScript toggle
• Hero section aligned with value proposition, background images, CTA with text
• Alternating section backgrounds for visual rhythm
• Clear spacing system and professional layout grid
• Real footer with contact info, legal links, social icons
• Defined CTA placements throughout the page
• Proper visual hierarchy
• Typography structure (H1, H2, H3)

================================================
TECHNOLOGY:
- Single self-contained HTML file
- Tailwind CSS via CDN (https://cdn.tailwindcss.com)
- Google Fonts via <link> tags
- Lucide Icons via CDN (https://unpkg.com/lucide@latest)
- Vanilla JavaScript only for interactivity (mobile menu, scroll animations)
- NO frameworks (no React, Vue, Angular, etc.)
- Must work by opening the HTML file directly in a browser

================================================
VISUAL DESIGN SYSTEM:

Use exact brand colors: Primary (${data.primaryColor}), Secondary (${data.secondaryColor}), Accent (${data.accentColor}), Text (${data.textColor}), Background (${data.backgroundColor}).
Configure these in tailwind.config via the CDN script tag.
Visual consistency across all sections.
Strategic whitespace. Strong hierarchy. Mobile-first. Accessibility (WCAG).
Modern premium aesthetic: "${data.preferredStyle}" style.

RESPONSIVE & ACCESSIBILITY:
- Mobile-first approach with Tailwind breakpoints (sm:, md:, lg:, xl:)
- Semantic HTML5 elements (header, nav, main, section, footer, article)
- WCAG 2.1 AA compliance: proper contrast, focus states, aria labels
- Keyboard navigation support on interactive elements

SEO (MANDATORY):
- Single H1 per page with target keyword (< 60 chars)
- Meta description < 160 chars
- Semantic heading hierarchy (H1 → H2 → H3)
- Alt text on all images
- Lazy loading for images below the fold
- Responsive viewport meta tag

================================================
FINAL REQUIREMENTS:

Responsive, mobile-first, SEO-optimized, semantic HTML, smooth animations, fast loading, strong CTAs, accessibility compliant.
This must feel like a premium agency project. It must not look like a generic AI layout.
Generate a polished, production-ready landing page as a single HTML file.`;
}

function generatePagesSection(data: BusinessFormData): string {
  const config = data.pagesConfig || { mode: 'manual', aiSummary: '', pages: [] };

  if (config.mode === 'ai' && config.aiSummary.trim()) {
    return `The user described the landing page content as follows (AI should interpret and create sections accordingly):\n\"${config.aiSummary.trim()}\"`;
  }

  if (config.pages.length > 0) {
    const enabledPages = config.pages.filter(p => p.enabled);
    if (enabledPages.length > 0) {
      let result = `The landing page should have ${enabledPages.length} section(s):\n`;
      enabledPages.forEach((page, i) => {
        result += `\n### Section ${i + 1}: ${page.name}${page.required ? ' (required)' : ''}`;
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

  return `1. Hero Section with compelling headline & CTA
2. Problem / Pain Points
3. Solution / How It Works
4. Benefits / Why Choose Us
5. Social Proof / Testimonials
6. Final CTA
7. Footer`;
}

export default Index;
