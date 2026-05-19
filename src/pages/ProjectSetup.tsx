import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, FileText, Globe2, Megaphone, FolderOpen, Loader2, LogOut, Sparkles } from 'lucide-react';
import logoResult from '@/assets/logo-result.png';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { PremiumParticleBackground, type ParticleTone } from '@/components/landing/PremiumParticleBackground';
import { CompanyProjectForm } from '@/components/project/CompanyProjectForm';
import { StepIndicator } from '@/components/generator/StepIndicator';
import { useAuth } from '@/contexts/AuthContext';
import { createProject, scrapeWebsite, uploadProjectAssets } from '@/services/api';
import {
  buildCompanyContext,
  companyToAdForm,
  companyToLandingForm,
  defaultCompanyProjectFormData,
  normalizeCompanyProjectFormData,
  type CompanyProjectFormData,
} from '@/types/projectContext';
import { toast } from 'sonner';
import '@/components/landing/HeroLanding.css';

const STEPS = [
  { id: 'import', label: 'Import' },
  { id: 'basics', label: 'Basics' },
  { id: 'offer', label: 'Offer' },
  { id: 'brand', label: 'Brand' },
  { id: 'contact', label: 'Contact' },
  { id: 'choose', label: 'Generate' },
] as const;

type ProjectSetupStep = typeof STEPS[number]['id'];

const toStringList = (value: unknown) => {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) {
    return value.split(/[,;\n]/).map((item) => item.trim()).filter(Boolean);
  }
  return [];
};

export default function ProjectSetup() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const [data, setData] = useState<CompanyProjectFormData>(defaultCompanyProjectFormData);
  const [savedProjectId, setSavedProjectId] = useState<number | null>(null);
  const [folderPath, setFolderPath] = useState('');
  const [publicUrl, setPublicUrl] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [activeTone, setActiveTone] = useState<ParticleTone | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [maxVisitedStep, setMaxVisitedStep] = useState(0);
  const [importUrl, setImportUrl] = useState('');
  const [importContext, setImportContext] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [importedFields, setImportedFields] = useState<string[]>([]);

  const companyContext = useMemo(() => buildCompanyContext(data), [data]);
  const canSave = data.businessName.trim() && data.projectSlug.trim() && data.businessDescription.trim() && data.valueProposition.trim();
  const currentStepId = STEPS[currentStep].id as ProjectSetupStep;

  const update = (updates: Partial<CompanyProjectFormData>) => {
    setData((prev) => normalizeCompanyProjectFormData({ ...prev, ...updates }));
  };

  const applyExtractedData = (extracted: Record<string, unknown>, sourceWebsite?: string) => {
    const updates: Partial<CompanyProjectFormData> = {};
    const setString = (target: keyof CompanyProjectFormData, ...keys: string[]) => {
      const value = keys.map((key) => extracted[key]).find((item) => typeof item === 'string' && item.trim());
      if (typeof value === 'string') {
        (updates as Record<string, unknown>)[target] = value.trim();
      }
    };

    setString('businessName', 'businessName', 'brandName', 'name');
    setString('businessDescription', 'businessDescription', 'description', 'about');
    setString('businessCategory', 'businessCategory', 'industry', 'category');
    setString('targetAudience', 'targetAudience', 'audience');
    setString('valueProposition', 'valueProposition', 'uniqueValueProposition', 'offer');
    setString('designNotes', 'designNotes', 'visualStyle', 'brandNotes');
    setString('brandKeywords', 'brandKeywords', 'keywords');
    setString('forbiddenWords', 'forbiddenWords');
    setString('headingFont', 'headingFont');
    setString('bodyFont', 'bodyFont');
    setString('phone', 'phone');
    setString('whatsapp', 'whatsapp');
    setString('email', 'email');
    setString('city', 'city');
    setString('country', 'country');

    const services = toStringList(extracted.services || extracted.products);
    if (services.length) updates.services = services;

    const differentiators = toStringList(extracted.differentiators || extracted.features || extracted.benefits);
    if (differentiators.length) updates.differentiators = differentiators;

    ['primaryColor', 'secondaryColor', 'accentColor', 'textColor', 'backgroundColor'].forEach((key) => {
      const value = extracted[key];
      if (typeof value === 'string' && /^#[0-9a-f]{3,8}$/i.test(value.trim())) {
        (updates as Record<string, unknown>)[key] = value.trim();
      }
    });

    const images = extracted.images;
    const nextImages: Partial<CompanyProjectFormData['images']> = {};
    ['heroImage1', 'heroImage2', 'logoUrl', 'logoAlt', 'brandImage', 'sectionImage1', 'sectionImage2', 'sectionImage3', 'aboutImage', 'teamImage'].forEach((key) => {
      const value = extracted[key];
      if (typeof value === 'string' && value.trim()) {
        (nextImages as Record<string, string>)[key] = value.trim();
      }
    });
    if (Array.isArray(extracted.productImages)) {
      nextImages.productImages = extracted.productImages.map((item) => String(item || '').trim()).filter(Boolean);
    }
    if (images && typeof images === 'object') {
      Object.assign(nextImages, images as Partial<CompanyProjectFormData['images']>);
    }
    if (Object.keys(nextImages).length) {
      updates.images = { ...data.images, ...nextImages };
    }

    const socialLinks = extracted.socialLinks;
    const nextSocialLinks: Partial<CompanyProjectFormData['socialLinks']> = {};
    ['facebook', 'instagram', 'twitter', 'linkedin', 'youtube'].forEach((key) => {
      const value = extracted[key];
      if (typeof value === 'string' && value.trim()) {
        (nextSocialLinks as Record<string, string>)[key] = value.trim();
      }
    });
    if (socialLinks && typeof socialLinks === 'object') {
      Object.assign(nextSocialLinks, socialLinks as Partial<CompanyProjectFormData['socialLinks']>);
    }
    if (Object.keys(nextSocialLinks).length) {
      updates.socialLinks = { ...data.socialLinks, ...nextSocialLinks };
    }

    if (sourceWebsite) {
      updates.sourceWebsite = sourceWebsite;
    }

    if (!data.projectSlug && typeof updates.businessName === 'string') {
      updates.projectSlug = updates.businessName;
    }

    update(updates);
    const matched = Object.keys(updates);
    setImportedFields(matched);
    return matched;
  };

  const handleImportWebsite = async () => {
    if (!importUrl.trim()) {
      toast.error('Enter a website URL to import company data.');
      return;
    }

    setIsImporting(true);
    setImportedFields([]);
    try {
      const result = await scrapeWebsite(importUrl.trim(), false, importContext || undefined);
      const extracted = result.extracted || {};
      const matched = applyExtractedData(extracted, importUrl.trim());
      toast.success(`Imported ${matched.length} company fields.`);
      setCurrentStep(1);
      setMaxVisitedStep((prev) => Math.max(prev, 1));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not import website data.');
    } finally {
      setIsImporting(false);
    }
  };

  const next = () => {
    const nextStep = Math.min(currentStep + 1, STEPS.length - 1);
    setCurrentStep(nextStep);
    setMaxVisitedStep((prev) => Math.max(prev, nextStep));
  };

  const back = () => {
    setCurrentStep((prev) => Math.max(0, prev - 1));
  };

  const ensureProject = async () => {
    if (savedProjectId) return { id: savedProjectId, folderPath, publicUrl };
    if (!user?.id) throw new Error('User not authenticated');
    if (!canSave) throw new Error('Fill company name, folder, description and value proposition first.');

    setIsSaving(true);
    try {
      const saved = await createProject({
        user_id: user.id,
        name: data.businessName,
        form_data: data,
        context: companyContext,
        generated_html: '',
        current_step: 0,
        project_type: 'project',
      });

      if (!saved?.success || !saved?.id) {
        throw new Error(saved?.error || saved?.details || 'Could not save project.');
      }

      setSavedProjectId(Number(saved.id));
      const nextFolderPath = String(saved.folder_path || '');
      const nextPublicUrl = String(saved.public_url || '');
      setFolderPath(nextFolderPath);
      setPublicUrl(nextPublicUrl);
      toast.success('Project context saved.');
      return { id: Number(saved.id), folderPath: nextFolderPath, publicUrl: nextPublicUrl };
    } finally {
      setIsSaving(false);
    }
  };

  const handleUploadLogo = async (file: File): Promise<string> => {
    if (!user?.id) throw new Error('Not authenticated');
    const project = await ensureProject();
    const result = await uploadProjectAssets(project.id, user.id, [file]);
    const url = result.uploaded?.[0]?.url;
    if (!url) throw new Error('Logo upload failed');
    update({ images: { ...data.images, logoUrl: url } });
    return url;
  };

  const continueToLanding = async () => {
    try {
      const project = await ensureProject();
      navigate('/', {
        state: {
          formData: companyToLandingForm(data),
          currentStep: 0,
          projectOwnerId: user?.id,
          companyProjectId: project.id,
        },
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not continue.');
    }
  };

  const continueToAds = async () => {
    try {
      const project = await ensureProject();
      navigate('/ad-creatives', {
        state: {
          formData: companyToAdForm(data),
          currentStep: 0,
          companyProjectId: project.id,
        },
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not continue.');
    }
  };

  return (
    <div className="premium-home min-h-screen bg-background relative overflow-hidden" onPointerLeave={() => setActiveTone(null)}>
      <PremiumParticleBackground activeTone={activeTone} />
      <header className="relative z-10 border-b border-border/40 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <button type="button" onClick={() => navigate('/projects')} className="flex items-center gap-3">
            <img src={logoResult} alt="ChiliForge" className="h-9 w-auto object-contain" />
          </button>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => navigate('/projects')} className="gap-2">
              <FolderOpen className="h-4 w-4" /> Projects
            </Button>
            <Button variant="ghost" size="sm" onClick={signOut} className="gap-2">
              <LogOut className="h-4 w-4" /> Log out
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-8 relative z-10">
        <div className="mb-10 text-center">
          <h2 className="font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Company <span className="gradient-text">project</span>
          </h2>
          <p className="mt-3 text-muted-foreground max-w-xl mx-auto">
            Save the reusable company context once, then generate landing pages or ad campaigns from the same project folder.
          </p>
        </div>

        <StepIndicator
          steps={STEPS}
          currentStep={currentStep}
          maxVisitedStep={maxVisitedStep}
          onStepClick={setCurrentStep}
        />

        {currentStepId !== 'choose' && (
          <div
            className="mt-8 glass-card rounded-xl p-6 sm:p-8 animate-in-up"
            style={{ boxShadow: '0 20px 70px -30px hsl(359 100% 60% / 0.25), 0 20px 70px -30px hsl(265 85% 65% / 0.25)' }}
          >
            {currentStepId === 'import' ? (
              <div className="space-y-6">
                <div>
                  <h3 className="form-section-title">Import company data</h3>
                  <p className="form-section-desc">Start with a website URL, then review the company context in the next steps.</p>
                </div>
                <div className="grid gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">Website URL</label>
                    <div className="mt-1.5 flex flex-col sm:flex-row gap-2">
                      <Input
                        value={importUrl}
                        onChange={(event) => setImportUrl(event.target.value)}
                        placeholder="https://example.com"
                      />
                      <Button onClick={handleImportWebsite} disabled={isImporting || !importUrl.trim()} className="gap-2">
                        {isImporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe2 className="h-4 w-4" />}
                        Import
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">Optional context</label>
                    <Textarea
                      value={importContext}
                      onChange={(event) => setImportContext(event.target.value)}
                      rows={4}
                      placeholder="Tell the importer what to prioritize, such as offers, services, audience, or brand tone."
                      className="mt-1.5"
                    />
                  </div>
                </div>
                {importedFields.length > 0 && (
                  <div className="rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-primary">
                    Imported: {importedFields.join(', ')}
                  </div>
                )}
              </div>
            ) : (
              <CompanyProjectForm data={data} onChange={update} section={currentStepId} onUploadLogo={handleUploadLogo} />
            )}
            </div>
        )}

        {currentStepId === 'choose' && <div className="premium-home-products mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div
            className="premium-home-card premium-home-product-card glass-card rounded-xl p-5 flex flex-col gap-4 transition-all duration-500 ease-out group hover:border-primary/50 hover:shadow-[0_0_40px_-8px_hsl(359_100%_60%/0.25)]"
            data-card-tone="lp"
            onPointerEnter={() => setActiveTone('primary')}
            onPointerLeave={() => setActiveTone(null)}
          >
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors duration-500 ease-out">
                <FileText className="h-5 w-5 text-primary" />
              </div>
              <div>
                <div className="font-semibold text-foreground">Landing Page</div>
                <div className="text-xs text-muted-foreground">Conversion-focused page</div>
              </div>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Use this company context to build the landing page form and generate the LP.
            </p>
            <Button
              disabled={!canSave || isSaving}
              onClick={continueToLanding}
              variant="gradient"
              className="mt-auto w-full gap-2"
              onPointerEnter={() => setActiveTone('primary')}
            >
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
              Continue with LP
            </Button>
          </div>

          <div
            className="premium-home-card premium-home-product-card glass-card rounded-xl p-5 flex flex-col gap-4 transition-all duration-500 ease-out group hover:border-accent/50 hover:shadow-[0_0_40px_-8px_hsl(265_85%_65%/0.25)]"
            data-card-tone="ad"
            onPointerEnter={() => setActiveTone('accent')}
            onPointerLeave={() => setActiveTone(null)}
          >
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-accent/10 flex items-center justify-center group-hover:bg-accent/20 transition-colors duration-500 ease-out">
                <Megaphone className="h-5 w-5 text-accent" />
              </div>
              <div>
                <div className="font-semibold text-foreground">AD Creatives</div>
                <div className="text-xs text-muted-foreground">Multi-format campaign</div>
              </div>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Use this company context to create campaign copy, formats, images and ad boards.
            </p>
            <Button
              disabled={!canSave || isSaving}
              onClick={continueToAds}
              variant="outline"
              className="mt-auto w-full gap-2 border-accent/40 hover:bg-accent/5 hover:border-accent/60"
              onPointerEnter={() => setActiveTone('accent')}
            >
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Megaphone className="h-4 w-4 text-accent" />}
              Continue with Ads
            </Button>
          </div>
        </div>}

        <div className="mt-6 flex items-center justify-between">
          <Button variant="ghost" onClick={back} disabled={currentStep === 0} className="gap-2">
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
          {currentStepId !== 'choose' && (
            <Button onClick={next} className="gap-2">
              {currentStepId === 'import' ? <Sparkles className="h-4 w-4" /> : null}
              {currentStepId === 'import' ? 'Skip / Continue' : 'Continue'}
              <ArrowRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      </main>
    </div>
  );
}
