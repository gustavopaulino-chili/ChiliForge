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
import { ArrowLeft, ArrowRight, Sparkles, Copy, Check, ExternalLink, Loader2, Wand2, Link2, RotateCcw, Clock, LogOut, User } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';

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
  const { user, signOut } = useAuth();
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
  const [generatedLandingUrl, setGeneratedLandingUrl] = useState('');
  const [generatedHtml, setGeneratedHtml] = useState('');
  const [isGeneratingLanding, setIsGeneratingLanding] = useState(false);

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

  const validateImageUrl = (url: string): Promise<boolean> => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) return Promise.resolve(false);

    return new Promise((resolve) => {
      const img = new Image();
      const timeout = window.setTimeout(() => {
        img.onload = null;
        img.onerror = null;
        resolve(false);
      }, 8000);

      img.onload = () => {
        window.clearTimeout(timeout);
        img.onload = null;
        img.onerror = null;
        resolve(true);
      };

      img.onerror = () => {
        window.clearTimeout(timeout);
        img.onload = null;
        img.onerror = null;
        resolve(false);
      };

      img.src = trimmedUrl;
    });
  };

  const sanitizeImagesForGeneration = async (data: BusinessFormData): Promise<BusinessFormData> => {
    const imageLabels: Record<string, string> = {
      logoUrl: 'logo',
      heroImage1: 'hero image 1',
      heroImage2: 'hero image 2',
      brandImage: 'brand image',
      sectionImage1: 'section image 1',
      sectionImage2: 'section image 2',
      sectionImage3: 'section image 3',
    };

    const singleImageKeys = [
      'logoUrl',
      'heroImage1',
      'heroImage2',
      'brandImage',
      'sectionImage1',
      'sectionImage2',
      'sectionImage3',
    ] as const;

    const validityEntries = await Promise.all(
      singleImageKeys.map(async (key) => ({
        key,
        url: data.images[key],
        valid: data.images[key] ? await validateImageUrl(data.images[key]) : false,
      }))
    );

    const validUrlSet = new Set(validityEntries.filter((entry) => entry.valid).map((entry) => entry.url));
    const sanitizedImages = { ...data.images, productImages: [] as string[] };
    const invalidLabels: string[] = [];

    validityEntries.forEach(({ key, url, valid }) => {
      if (url && !valid) invalidLabels.push(imageLabels[key]);
      sanitizedImages[key] = valid ? url : '';
    });

    const productImageEntries = await Promise.all(
      data.images.productImages.map(async (url, index) => ({
        url,
        index,
        valid: url ? await validateImageUrl(url) : false,
      }))
    );

    sanitizedImages.productImages = productImageEntries.filter((entry) => entry.valid).map((entry) => entry.url);
    productImageEntries.forEach(({ url, index, valid }) => {
      if (url && !valid) invalidLabels.push(`product image ${index + 1}`);
    });

    if (!sanitizedImages.logoUrl) {
      const fallbackLogoCandidates = [
        { url: data.images.brandImage, hint: data.brandImageContext },
        { url: data.images.heroImage1, hint: data.heroImage1Context },
        { url: data.images.heroImage2, hint: data.heroImage2Context },
      ].filter((candidate) => candidate.url && validUrlSet.has(candidate.url));

      const logoLikeFallback = fallbackLogoCandidates.find((candidate) =>
        /logo|icon|brand|mark|favicon|marca/i.test(`${candidate.url} ${candidate.hint}`)
      );

      sanitizedImages.logoUrl = logoLikeFallback?.url || fallbackLogoCandidates[0]?.url || '';
    }

    if (!sanitizedImages.brandImage) {
      sanitizedImages.brandImage = sanitizedImages.sectionImage3 || sanitizedImages.heroImage1 || sanitizedImages.logoUrl;
    }

    if (!sanitizedImages.heroImage1) {
      sanitizedImages.heroImage1 = sanitizedImages.sectionImage3 || sanitizedImages.brandImage || sanitizedImages.logoUrl;
    }

    const uniqueInvalidLabels = [...new Set(invalidLabels)];
    if (uniqueInvalidLabels.length > 0) {
      toast.warning(`${uniqueInvalidLabels.length} image(s) were ignored because they are inaccessible from the generated preview.`);
    }

    return {
      ...data,
      images: sanitizedImages,
    };
  };

  const hasUserImages = (data: BusinessFormData = formData) => {
    const imgs = data.images;
    return !!(imgs.heroImage1 || imgs.heroImage2 || imgs.brandImage || imgs.sectionImage1 || imgs.sectionImage2 || imgs.sectionImage3 || imgs.logoUrl);
  };

  const handleGenerate = async () => {
    setIsGenerating(true);
    setGenerationProgress(0);
    setGeneratedLandingUrl('');
    setGeneratedHtml('');

    const preparedFormData = await sanitizeImagesForGeneration(formData);

    // Collect images locally to avoid React state timing issues
    let collectedImages: string[] = [];

    if (preparedFormData.generateAiImages) {
      setIsGeneratingImages(true);
      const purposes = ['hero banner', 'about section background', 'services section'];
      const purposeLabels = ['Hero Banner', 'About Section', 'Services Section'];
      const referenceUrl = preparedFormData.images.heroImage1 || preparedFormData.images.brandImage || preparedFormData.images.sectionImage1 || undefined;

      try {
        for (let idx = 0; idx < purposes.length; idx++) {
          setGenerationStatus(`Generating image ${idx + 1}/${purposes.length}: ${purposeLabels[idx]}...`);
          setGenerationProgress(Math.round(((idx) / (purposes.length + 3)) * 100));
          const url = await invokeWithRetry(purposes[idx], referenceUrl);
          if (url) collectedImages.push(url);
        }
        setGeneratedImages(collectedImages);
        if (collectedImages.length > 0) toast.success(`${collectedImages.length}/${purposes.length} AI images generated`);
      } catch (err) {
        console.error('Image generation error:', err);
        toast.error('Error generating AI images');
      } finally {
        setIsGeneratingImages(false);
      }
    } else if (!hasUserImages(preparedFormData)) {
      setGenerationStatus('Searching for relevant stock images...');
      setGenerationProgress(10);
      const pexelsImages = await searchPexelsImages();
      if (pexelsImages.length > 0) {
        collectedImages = pexelsImages;
        setGeneratedImages(pexelsImages);
        toast.success(`Found ${pexelsImages.length} stock images from Pexels`);
      }
    }

    setGenerationStatus('Generating your landing page with AI...');
    setGenerationProgress(50);

    const currentPrompt = generatePrompt(preparedFormData, collectedImages);

    try {
      const { data, error } = await supabase.functions.invoke('generate-landing', {
        body: {
          prompt: currentPrompt,
          businessName: preparedFormData.businessName,
          userId: user?.id,
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

      if (data?.url) {
        const previewUrl = data.fileName
          ? `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/render-landing-preview?file=${encodeURIComponent(data.fileName)}`
          : data.url;

        setGeneratedLandingUrl(previewUrl);
        if (data.html) setGeneratedHtml(data.html);
        setGenerationProgress(100);
        setGenerationStatus('Landing page generated!');
        toast.success('Landing page generated successfully!');
        await new Promise(r => setTimeout(r, 500));
        setIsGenerating(false);
        setShowResults(true);
      } else {
        throw new Error('No URL returned');
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
            <div className="flex items-center gap-2">
              <Link to="/history">
                <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground hover:text-foreground">
                  <Clock className="h-4 w-4" /> History
                </Button>
              </Link>
              <Button variant="ghost" size="sm" onClick={signOut} className="gap-2 text-muted-foreground hover:text-foreground">
                <LogOut className="h-4 w-4" /> Sair
              </Button>
            </div>
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

  // Results view — iframe preview
  if (showResults && (generatedHtml || generatedLandingUrl)) {
    return (
      <div className="min-h-screen bg-background relative flex flex-col">
        <div className="reactive-bg-mouse" />
        <Header onLogoClick={() => setShowLanding(true)} />
        <main className="flex-1 flex flex-col mx-auto max-w-6xl w-full px-6 py-6 relative z-10">
          <div className="text-center mb-6">
            <div className="mb-4">
              <img src={logoResult} alt="ChiliForge" className="h-14 w-auto mx-auto object-contain" />
            </div>
            <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">
              Your Landing Page is Ready! 🎉
            </h2>
            <p className="mt-2 text-muted-foreground text-sm max-w-xl mx-auto">
              Your AI-generated landing page is live. Preview it below or open in a new tab.
            </p>
          </div>

          {/* Action bar */}
          <div className="flex flex-wrap items-center justify-center gap-3 mb-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                navigator.clipboard.writeText(generatedLandingUrl);
                setCopiedLink(true);
                setTimeout(() => setCopiedLink(false), 2000);
                toast.success('Preview URL copied!');
              }}
              className="gap-2"
            >
              {copiedLink ? <Check className="h-4 w-4" /> : <Link2 className="h-4 w-4" />}
              {copiedLink ? 'Copied!' : 'Copy Preview URL'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (generatedHtml) {
                  const previewBlob = new Blob([generatedHtml], { type: 'text/html' });
                  const previewBlobUrl = URL.createObjectURL(previewBlob);
                  window.open(previewBlobUrl, '_blank', 'noopener,noreferrer');
                  window.setTimeout(() => URL.revokeObjectURL(previewBlobUrl), 60000);
                }
              }}
              className="gap-2"
            >
              <ExternalLink className="h-4 w-4" /> Open in New Tab
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const htmlToDownload = generatedHtml || '';
                const htmlBlob = new Blob([htmlToDownload], { type: 'text/html' });
                const htmlBlobUrl = URL.createObjectURL(htmlBlob);
                const a = document.createElement('a');
                a.href = htmlBlobUrl;
                a.download = `landing-page-${formData.businessName || 'site'}.html`;
                a.click();
                window.setTimeout(() => URL.revokeObjectURL(htmlBlobUrl), 1000);
              }}
              className="gap-2"
            >
              <Copy className="h-4 w-4" /> Download HTML
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowResults(false);
                setGeneratedLandingUrl('');
                setGeneratedHtml('');
              }}
              className="gap-2"
            >
              <ArrowLeft className="h-4 w-4" /> Edit & Regenerate
            </Button>
          </div>

          <div className="rounded-lg border border-border bg-muted/50 px-4 py-2 mb-4 flex items-center gap-2 max-w-2xl mx-auto w-full">
            <Link2 className="h-4 w-4 text-muted-foreground shrink-0" />
            <a
              href={generatedLandingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-primary truncate hover:underline flex-1"
            >
              {generatedLandingUrl}
            </a>
          </div>

          <div className="flex-1 min-h-[500px] rounded-xl border border-border overflow-hidden bg-white shadow-lg">
            <iframe
              srcDoc={generatedHtml || undefined}
              className="w-full h-full min-h-[500px]"
              style={{ minHeight: '70vh' }}
              title="Landing Page Preview"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            />
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
                  setGeneratedImages([]);
                  localStorage.removeItem(STORAGE_KEY);
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
        <div className="flex items-center gap-2">
          <Link to="/history">
            <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground hover:text-foreground">
              <Clock className="h-4 w-4" /> History
            </Button>
          </Link>
          <Button variant="ghost" size="sm" onClick={signOut} className="gap-2 text-muted-foreground hover:text-foreground">
            <LogOut className="h-4 w-4" /> Sair
          </Button>
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
    'general': 'Institutional landing page presenting the company, services, and lead capture. Professional tone with clear value communication.',
    'campaign': 'Marketing campaign page with strong CTA, urgency elements, and conversion focus. Include campaign-specific messaging, promotional banners, and countdown elements.',
    'black-friday': 'Black Friday / promotional page with countdown timer, animated discount badges, urgency messaging ("Only X left!"), limited-time offers, flash deal sections, and bold high-contrast promotional design. Maximum urgency and excitement.',
    'launch': 'Product launch page with cinematic hero, product showcase with parallax effects, features highlight with animated reveals, pre-order/waitlist CTA, and excitement-building countdown sections.',
    'webinar': 'Event/webinar registration page with event details, speaker profiles with photos, detailed agenda timeline, countdown to event, and prominent registration form above the fold.',
    'lead-capture': 'Lead generation page with compelling offer (ebook, free trial, consultation), benefit bullets with checkmarks, trust indicators, and optimized multi-field form placement above the fold with progress indicator.',
    'app-download': 'App download promotion page with 3D device mockups, feature highlights with animations, app store badges (Apple + Google Play), screenshot carousel, download stats, and prominent download CTAs.',
    'seasonal': 'Seasonal/holiday themed landing page with festive design elements (particles, themed colors), special offers with decorative frames, themed imagery, and celebration-driven messaging.',
  };

  const styleGuide: Record<string, string> = {
    'modern': `MODERN STYLE GUIDELINES:
- Clean geometric shapes, generous whitespace
- Gradient accents: linear-gradient overlays, gradient text for headlines
- Subtle glassmorphism: backdrop-blur cards with semi-transparent backgrounds
- Rounded corners: rounded-2xl on cards, rounded-full on badges
- Soft shadows: shadow-xl shadow-primary/10
- Smooth micro-interactions on every interactive element
- Grid-based layouts with asymmetric compositions
- Monochromatic sections with accent color pops`,

    'corporate': `CORPORATE STYLE GUIDELINES:
- Structured, grid-aligned layouts with clear information hierarchy
- Professional color usage: primary for CTAs, muted tones for backgrounds
- Minimal rounded corners: rounded-lg maximum
- Traditional card patterns with borders and subtle shadows
- Data-driven sections: statistics, metrics, ROI numbers
- Trust elements: certifications, awards, partner logos
- Conservative animations: fade-in only, no playful effects
- Formal typography with clear readability`,

    'minimal': `MINIMAL STYLE GUIDELINES:
- Maximum whitespace — let every element breathe
- Monochromatic palette with ONE accent color for CTAs
- Ultra-thin borders or no borders — use spacing for separation
- Large typography as the primary visual element
- No gradients, no shadows — flat and clean
- Full-width sections with centered content
- Elegant serif or thin sans-serif fonts
- Subtle hover states: color change only, no movement`,

    'bold': `BOLD STYLE GUIDELINES:
- High contrast: dark backgrounds with vibrant accent colors
- Extra-large headlines: text-5xl md:text-7xl font-black
- Full-bleed images and bold color blocks
- Dramatic gradients across full sections
- Oversized CTAs with strong hover effects
- Dynamic asymmetric layouts breaking the grid
- Bold iconography and large numbers
- Energetic feel — movement, scale, contrast`,

    'premium': `PREMIUM / LUXURY STYLE GUIDELINES:
- Dark backgrounds (near-black) with gold/cream/champagne accents
- Elegant serif fonts for headings, refined sans-serif for body
- Generous spacing — double the normal padding
- Subtle animations: slow fade-ins (0.8s+), gentle parallax
- Thin gold/accent borders and dividers
- High-end imagery treatment: slight desaturation, cinematic feel
- Minimal UI elements — content speaks for itself
- Glass effects with very subtle opacity (bg-white/5)
- Letter-spacing on headings: tracking-widest uppercase labels`,
  };

  return `═══════════════════════════════════════════════
LANDING PAGE GENERATION SPECIFICATION
═══════════════════════════════════════════════

LANDING PAGE TYPE: ${presetLabel}
PRESET CONTEXT: ${presetContext[data.landingPreset] || presetContext['general']}

═══════════════════════════════════════════════
BUSINESS INTELLIGENCE
═══════════════════════════════════════════════

COMPANY: ${data.businessName}
INDUSTRY: ${data.businessCategory}
LOCATION: ${[data.city, data.country].filter(Boolean).join(', ') || 'Not specified'}

DESCRIPTION:
${data.businessDescription || 'Not provided — generate professional copy based on the business name and category.'}

TARGET AUDIENCE:
${data.targetAudience || 'General consumers interested in this business category.'}

VALUE PROPOSITION:
${data.valueProposition || 'Not specified — craft a compelling value proposition based on the business description and services.'}

SERVICES / OFFERINGS:
${servicesText || 'Not specified — generate 4-6 relevant services based on the business category.'}

KEY DIFFERENTIATORS:
${diffsText || 'Not specified — generate 3 compelling differentiators based on the business description.'}

═══════════════════════════════════════════════
BRAND DESIGN SYSTEM
═══════════════════════════════════════════════

COLOR PALETTE:
- Primary: ${data.primaryColor} — Use for CTAs, active states, key highlights
- Secondary: ${data.secondaryColor} — Use for supporting elements, secondary buttons, gradients
- Accent: ${data.accentColor} — Use for badges, notifications, special callouts
- Text: ${data.textColor} — Main body text color
- Background: ${data.backgroundColor} — Page background

TYPOGRAPHY:
${data.headingFont ? `- Heading Font: "${data.headingFont}" (load via Google Fonts or closest public equivalent)` : '- Heading Font: Choose a premium font that matches the style'}
${data.bodyFont ? `- Body Font: "${data.bodyFont}" (load via Google Fonts or closest public equivalent)` : '- Body Font: Choose a complementary readable font'}
${data.headingFont || data.bodyFont ? '\nIMPORTANT: If the detected brand fonts are proprietary or unavailable on Google Fonts/CDN, choose the closest high-quality public substitutes while preserving the original hierarchy, personality, and visual rhythm.' : ''}

VISUAL STYLE: ${data.preferredStyle}
${styleGuide[data.preferredStyle] || styleGuide['modern']}

═══════════════════════════════════════════════
CONTACT & SOCIAL
═══════════════════════════════════════════════
${data.email ? `Email: ${data.email}` : ''}
${data.phone ? `Phone: ${data.phone}` : ''}
${data.whatsapp ? `WhatsApp: ${data.whatsapp} — Include a floating WhatsApp button (bottom-right, green, with pulse animation)` : ''}
${socialText ? `Social Media: ${socialText}` : ''}

═══════════════════════════════════════════════
IMAGE ASSETS
═══════════════════════════════════════════════
${imgLines.length > 0 ? `Validated image library:\n${imgLines.join('\n')}\n\nIMPORTANT: Use ONLY the validated URLs listed above. Do not invent, guess, or scrape new asset URLs. If a logo image is missing, render a typographic wordmark using the business name instead of a broken image.` : 'No validated images were provided — use gradient backgrounds, CSS patterns, strong typography, and iconography for visual appeal.'}

${data.generateAiImages ? 'AI-generated images are included — use them as backgrounds and section images only, never with text baked in.' : 'DO NOT generate or reference any AI images. Only use the explicitly provided image URLs above.'}
${!data.generateAiImages && aiImages.length > 0 ? 'Stock photos from Pexels are included — use as hero backgrounds, section backgrounds, or decorative imagery. They are royalty-free.' : ''}

IMAGE TREATMENT RULES:
- Hero images: full-width with gradient overlay (from-black/60 to-black/30) and white text on top
- Section images: rounded-2xl with shadow-2xl, positioned alongside text content
- All images: object-cover, lazy loading, descriptive alt text
- If an image slot is empty or unavailable, replace it with gradients, shapes, or typographic compositions — never leave broken image placeholders

${data.sourceWebsite ? `═══════════════════════════════════════════════
SOURCE WEBSITE REFERENCE
═══════════════════════════════════════════════
Original website: ${data.sourceWebsite}
The generated page MUST follow a similar visual design, layout structure, and aesthetic to this source website.` : ''}

${data.designNotes ? `DESIGN ANALYSIS FROM SOURCE:
${data.designNotes}

CRITICAL: Replicate the design patterns, layout structure, typography choices, spacing, color usage, and visual style described above as closely as possible.` : ''}

═══════════════════════════════════════════════
PAGE STRUCTURE & CONTENT
═══════════════════════════════════════════════

${generatePagesSection(data)}

═══════════════════════════════════════════════
CONVERSION OPTIMIZATION REQUIREMENTS
═══════════════════════════════════════════════

CTA STRATEGY:
- Primary CTA appears in: header, hero, mid-page, and final section (minimum 4 placements)
- CTA text must be action-oriented and specific to the business
- Examples: "Schedule Free Consultation", "Start Your Free Trial", "Get Your Quote Now"
- Above-the-fold: always include at least one CTA button
- Use contrasting colors for CTAs — they must visually pop

TRUST ELEMENTS:
- Add 3-5 testimonials with realistic names, roles, and companies
- Include star ratings (★★★★★) where appropriate
- Statistics section: "X+ clients", "Y years experience", "Z% satisfaction"
- Trust badges: "Secure", "Money-back guarantee", "24/7 Support"
- Partner/client logo bar if applicable

URGENCY & SCARCITY (for campaign/promo presets):
- Countdown timers with JS animation
- Limited availability badges
- "X spots remaining" or "Offer ends [date]"

MICRO-COPY:
- Form labels and placeholders must be helpful and specific
- Button states: default, hover (scale + shadow), active (scale down), loading
- Error/success messages on forms
- "No credit card required" type reassurance near CTAs

═══════════════════════════════════════════════
INTERACTIVE ELEMENTS
═══════════════════════════════════════════════

MANDATORY JAVASCRIPT FEATURES:
1. Smooth scroll to sections via anchor links
2. Sticky header with bg change on scroll
3. Mobile hamburger menu with slide animation
4. Scroll-triggered fade-in animations (IntersectionObserver)
5. Staggered children animations with delay
6. Counter animation for statistics (count up from 0)
7. FAQ accordion with smooth height transition
8. Form validation with visual feedback
${data.whatsapp ? '9. Floating WhatsApp button with pulse animation' : ''}

ANIMATION IMPLEMENTATION:
\`\`\`css
.animate-on-scroll {
  opacity: 0;
  transform: translateY(40px);
  transition: opacity 0.7s ease, transform 0.7s ease;
}
.animate-on-scroll.visible {
  opacity: 1;
  transform: translateY(0);
}
.animate-on-scroll:nth-child(2) { transition-delay: 0.1s; }
.animate-on-scroll:nth-child(3) { transition-delay: 0.2s; }
.animate-on-scroll:nth-child(4) { transition-delay: 0.3s; }
\`\`\`

═══════════════════════════════════════════════
QUALITY STANDARD
═══════════════════════════════════════════════

This landing page must look like it was built by a premium agency charging $50,000+.
Every pixel matters. Every interaction must feel polished.
The design must be cohesive, the copy must be compelling, and the UX must be flawless.
This is NOT a template — it's a custom, conversion-optimized masterpiece.`;
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
