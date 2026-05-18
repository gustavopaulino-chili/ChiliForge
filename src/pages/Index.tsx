import { useState, useMemo, useEffect, useCallback } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import logoResult from '@/assets/logo-result.png';
import { BusinessFormData, ImageUrls, defaultFormData, LANDING_PRESETS, LandingPreset } from '@/types/businessForm';
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
import { PremiumParticleBackground } from '@/components/landing/PremiumParticleBackground';
import { VisualEditor } from '@/components/editor/VisualEditor';
import { Button } from '@/components/ui/button';
import { ArrowLeft, ArrowRight, Sparkles, Copy, Check, ExternalLink, Loader2, Wand2, Link2, RotateCcw, Clock, LogOut, User, Server, Edit3, Key } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { downloadProjectZip, generateImages, generateLanding, searchImages, updateProjectContent, updateProjectFormState, getProjectById, uploadProjectAssetsFromUrls, uploadProjectAssets } from '@/services/api';
import { isUploadedImage } from '@/services/imageUpload';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { safeGetJSON, safeSetJSON, safeRemove } from '@/lib/safeStorage';
import { FtpDeployModal } from '@/components/generator/FtpDeployModal';
import { ApiKeyModal } from '@/components/ApiKeyModal';

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

const LEGACY_STORAGE_KEY = 'siteforge_progress';
const STORAGE_KEY_PREFIX = 'siteforge_progress_v2';

type SavedProgress = {
  currentStep: number;
  maxVisitedStep: number;
  formData: BusinessFormData;
  user_id?: number;
  folder_path?: string;
};

const normalizeFolderPathKey = (value?: string) => {
  const raw = (value || '').trim().toLowerCase();
  if (!raw) return 'draft';
  return raw.replace(/[^a-z0-9/_-]/g, '').replace(/\/+$/, '') || 'draft';
};

const buildProgressStorageKey = (userId?: number, folderPath?: string) => {
  const safeUserId = Number.isFinite(userId) && (userId || 0) > 0 ? String(userId) : 'guest';
  const safeFolder = normalizeFolderPathKey(folderPath);
  return `${STORAGE_KEY_PREFIX}:${safeUserId}:${safeFolder}`;
};

const deriveFolderPathFromPublicUrl = (url?: string) => {
  const raw = (url || '').trim();
  if (!raw) return '';
  try {
    const absolute = raw.startsWith('http://') || raw.startsWith('https://')
      ? new URL(raw)
      : new URL(raw.startsWith('/') ? raw : `/${raw}`, window.location.origin);
    const match = absolute.pathname.match(/\/projects\/([^/]+)\/?$/i);
    if (!match?.[1]) return '';
    return `/public/projects/${match[1]}`;
  } catch {
    const match = raw.match(/\/projects\/([^/]+)\/?$/i);
    if (!match?.[1]) return '';
    return `/public/projects/${match[1]}`;
  }
};

const hasMeaningfulProgress = (progress: Partial<SavedProgress> | null | undefined) => {
  if (!progress || !progress.formData) return false;
  const fd = progress.formData as Partial<BusinessFormData>;
  const hasNonEmptyService = Array.isArray(fd.services) && fd.services.some((item) => typeof item === 'string' && item.trim() !== '');
  const hasNonEmptyDifferentiator = Array.isArray(fd.differentiators) && fd.differentiators.some((item) => typeof item === 'string' && item.trim() !== '');
  const hasCoreText = [fd.businessName, fd.businessDescription, fd.valueProposition, fd.targetAudience, fd.businessCategory]
    .some((item) => typeof item === 'string' && item.trim() !== '');
  const hasProgress = Number(progress.currentStep || 0) > 0 || Number(progress.maxVisitedStep || 0) > 0;
  return hasCoreText || hasNonEmptyService || hasNonEmptyDifferentiator || hasProgress;
};

const loadSavedProgress = (storageKey: string) => {
  try {
    return safeGetJSON(storageKey) as SavedProgress | null;
  } catch { }
  return null;
};

const normalizeFormData = (candidate?: Partial<BusinessFormData> | null): BusinessFormData => {
  const incoming = candidate || {};
  return {
    ...defaultFormData,
    ...incoming,
    images: {
      ...defaultFormData.images,
      ...(incoming.images || {}),
      productImages: Array.isArray(incoming.images?.productImages)
        ? incoming.images.productImages.filter((value): value is string => typeof value === 'string')
        : defaultFormData.images.productImages,
    },
    socialLinks: {
      ...defaultFormData.socialLinks,
      ...(incoming.socialLinks || {}),
    },
    pagesConfig: {
      ...defaultFormData.pagesConfig,
      ...(incoming.pagesConfig || {}),
      aiSummary: typeof incoming.pagesConfig?.aiSummary === 'string' ? incoming.pagesConfig.aiSummary : defaultFormData.pagesConfig.aiSummary,
      pages: Array.isArray(incoming.pagesConfig?.pages) ? incoming.pagesConfig.pages : defaultFormData.pagesConfig.pages,
    },
    services: Array.isArray(incoming.services) ? incoming.services : defaultFormData.services,
    differentiators: Array.isArray(incoming.differentiators) ? incoming.differentiators : defaultFormData.differentiators,
    generationObjective: typeof incoming.generationObjective === 'string' ? incoming.generationObjective : defaultFormData.generationObjective,
    designNotes: typeof incoming.designNotes === 'string' ? incoming.designNotes : defaultFormData.designNotes,
    sourceWebsite: typeof incoming.sourceWebsite === 'string' ? incoming.sourceWebsite : defaultFormData.sourceWebsite,
    headingFont: typeof incoming.headingFont === 'string' ? incoming.headingFont : defaultFormData.headingFont,
    bodyFont: typeof incoming.bodyFont === 'string' ? incoming.bodyFont : defaultFormData.bodyFont,
    downloadFiles: Array.isArray(incoming.downloadFiles) ? incoming.downloadFiles : defaultFormData.downloadFiles,
  };
};

const slugifyProjectName = (value: string) =>
  (value || 'site')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'site';

const resolveProjectSlug = (data: BusinessFormData) =>
  slugifyProjectName(data.customSlug || data.businessName || 'site');

const normalizeHostedPreviewUrl = (url: string) => {
  const raw = (url || '').trim();
  if (!raw) return '';

  try {
    const absolute = raw.startsWith('http://') || raw.startsWith('https://')
      ? new URL(raw)
      : new URL(raw.startsWith('/') ? raw : `/${raw}`, window.location.origin);

    absolute.pathname = absolute.pathname.replace(/\/index\.html$/i, '/');

    if (!/\.[a-z0-9]+$/i.test(absolute.pathname)) {
      absolute.pathname = absolute.pathname.replace(/\/+$/, '') + '/';
    }

    return absolute.toString();
  } catch {
    return raw;
  }
};

const toAbsoluteUrl = (value: string) => {
  const raw = (value || '').trim();
  if (!raw) return '';
  if (/^(data:|blob:|https?:\/\/)/i.test(raw)) return raw;
  try {
    return new URL(raw.startsWith('/') ? raw : `/${raw}`, window.location.origin).toString();
  } catch {
    return raw;
  }
};

type ParsedGeneratedSite = {
  html: string;
  css: string;  // empty when html is already a complete inline document
  js: string;   // empty when html is already a complete inline document
  assets: string[];
};

/** Extracts unique font family names declared as CSS custom properties (--heading-font, --body-font). */
const extractFontNamesFromCss = (css: string): string[] => {
  const matches = [...css.matchAll(/--(?:heading|body)-font:\s*([^;]+)/g)];
  const fonts = new Set<string>();
  for (const m of matches) {
    const primary = m[1].trim().split(',')[0].trim().replace(/^["']|["']$/g, '');
    if (primary && !/^(sans-serif|serif|monospace|inherit|initial|unset)$/i.test(primary)) {
      fonts.add(primary);
    }
  }
  return [...fonts];
};

const buildGoogleFontsUrl = (fonts: string[]): string => {
  if (!fonts.length) return '';
  const families = fonts.map(f => `family=${encodeURIComponent(f).replace(/%20/g, '+')}:wght@400;500;600;700;800`).join('&');
  return `https://fonts.googleapis.com/css2?${families}&display=swap`;
};

const escapeHtmlAttr = (value: string) =>
  String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

type GenerationCheckpoint = {
  key: 'html' | 'css' | 'js' | 'assets' | 'created';
  label: string;
  done: boolean;
  detail: string;
};

const createInitialGenerationCheckpoints = (): GenerationCheckpoint[] => ([
  { key: 'html', label: 'HTML', done: false, detail: 'Waiting for AI response...' },
  { key: 'css', label: 'CSS (inline)', done: false, detail: 'Waiting for AI response...' },
  { key: 'js', label: 'JS (inline)', done: false, detail: 'Waiting for AI response...' },
  { key: 'assets', label: 'Assets', done: false, detail: 'Waiting for asset mapping...' },
  { key: 'created', label: 'Generation created', done: false, detail: 'Waiting for final confirmation...' },
]);

const normalizeGeneratedSite = (payload: any): ParsedGeneratedSite => {
  const rawHtml = typeof payload?.html === 'string' && payload.html.trim() ? payload.html.trim() : '<div>Fallback</div>';
  // If AI returned a complete document, css/js are already inline — keep them empty.
  const isCompleteDoc = /<!DOCTYPE|<html/i.test(rawHtml);
  return {
    html: rawHtml,
    css: isCompleteDoc ? '' : (typeof payload?.css === 'string' && payload.css.trim() ? payload.css.trim() : 'body { margin: 0; font-family: Arial; }'),
    js: isCompleteDoc ? '' : (typeof payload?.js === 'string' && payload.js.trim() ? payload.js.trim() : "document.addEventListener('DOMContentLoaded', () => {});"),
    assets: Array.isArray(payload?.assets) ? payload.assets.filter((asset: unknown) => typeof asset === 'string') : [],
  };
};

const buildGeneratedDocument = (parsed: ParsedGeneratedSite, title: string, lang = 'en') => {
  // If the AI already returned a complete inline document, use it directly.
  if (/<!DOCTYPE|<html/i.test(parsed.html)) {
    return parsed.html;
  }
  // Legacy path: assemble from separate html/css/js parts.
  const fonts = extractFontNamesFromCss(parsed.css);
  const gFontsUrl = buildGoogleFontsUrl(fonts);
  const fontLinks = gFontsUrl
    ? `\n  <link rel="preconnect" href="https://fonts.googleapis.com">\n  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n  <link rel="stylesheet" href="${gFontsUrl}">`
    : '';
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtmlAttr(title || 'Generated Site')}</title>${fontLinks}
  <style>${parsed.css}</style>
</head>
<body>
${parsed.html}
<script>${parsed.js}</script>
</body>
</html>`;
};

const Index = () => {
  const { user, signOut: authSignOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const routeState = location.state as { formData?: BusinessFormData; currentStep?: number; generatedHtml?: string; savedProjectId?: number; projectOwnerId?: number; generatedLandingUrl?: string; folderPath?: string } | null;
  const restoreProjectId = useMemo(() => {
    const raw = new URLSearchParams(location.search).get('restoreProjectId');
    const parsed = raw ? Number(raw) : 0;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }, [location.search]);
  const [currentProjectFolderPath, setCurrentProjectFolderPath] = useState<string>(() => routeState?.folderPath || deriveFolderPathFromPublicUrl(routeState?.generatedLandingUrl));
  const progressStorageKey = useMemo(
    () => buildProgressStorageKey(user?.id, currentProjectFolderPath),
    [user?.id, currentProjectFolderPath],
  );
  const [savedProjectId, setSavedProjectId] = useState<number | null>(routeState?.savedProjectId ?? null);
  const [projectOwnerId, setProjectOwnerId] = useState<number | null>(routeState?.projectOwnerId ?? null);
  const [copied, setCopied] = useState(false);
  const [isGeneratingImages, setIsGeneratingImages] = useState(false);
  const [generatedImages, setGeneratedImages] = useState<string[]>([]);
  const [generationStatus, setGenerationStatus] = useState('');
  const [generationProgress, setGenerationProgress] = useState(0);
  const [stepImagesAiGenerating, setStepImagesAiGenerating] = useState(false);
  const [stepImagesAiPercent, setStepImagesAiPercent] = useState(0);
  const [stepImagesAiLog, setStepImagesAiLog] = useState<{label: string; status: 'pending'|'active'|'done'|'error'}[]>([]);
  const [aiImagesGenerated, setAiImagesGenerated] = useState(false);
  const [aiGeneratedImageUrls, setAiGeneratedImageUrls] = useState<string[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isDownloadingZip, setIsDownloadingZip] = useState(false);
  const [showFtpDeploy, setShowFtpDeploy] = useState(false);
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [generatedLandingUrl, setGeneratedLandingUrl] = useState(routeState?.generatedLandingUrl ?? '');
  const [generatedHtml, setGeneratedHtml] = useState(routeState?.generatedHtml ?? '');
  const [visualEditorEnabled, setVisualEditorEnabled] = useState(false);
  const [isEditorSaving, setIsEditorSaving] = useState(false);
  const [generatedSite, setGeneratedSite] = useState<ParsedGeneratedSite | null>(null);
  const [generationCheckpoints, setGenerationCheckpoints] = useState<GenerationCheckpoint[]>(createInitialGenerationCheckpoints());
  const [generationMessages, setGenerationMessages] = useState<string[]>([]);
  const [showLanding, setShowLanding] = useState(!(routeState?.formData || routeState?.generatedHtml || restoreProjectId));
  const [showRestoreDialog, setShowRestoreDialog] = useState(false);
  const [pendingRestore, setPendingRestore] = useState<SavedProgress | null>(null);
  const [isLoadingRestoredProject, setIsLoadingRestoredProject] = useState(Boolean(restoreProjectId));
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [currentStep, setCurrentStep] = useState(routeState?.currentStep ?? 0);
  const [maxVisitedStep, setMaxVisitedStep] = useState(0);
  const [formData, setFormData] = useState<BusinessFormData>(normalizeFormData(routeState?.formData ?? defaultFormData));
  const [showResults, setShowResults] = useState(Boolean(routeState?.generatedHtml));

  useEffect(() => {
    if (!routeState) return;

    if (routeState?.formData) {
      setFormData(normalizeFormData(routeState.formData));
      setCurrentStep(routeState.currentStep ?? 0);
      setMaxVisitedStep(routeState.currentStep ?? 0);
      setShowLanding(false);
      setShowResults(false);
    }

    if (routeState?.generatedHtml) {
      setGeneratedSite(null);
      setGeneratedHtml(routeState.generatedHtml);
      setShowResults(true);
      setShowLanding(false);
    }

    if (routeState?.savedProjectId) {
      setSavedProjectId(routeState.savedProjectId);
    }

    setProjectOwnerId(routeState?.projectOwnerId ?? null);

    if (routeState?.generatedLandingUrl) {
      setGeneratedLandingUrl(routeState.generatedLandingUrl);
      if (!routeState?.folderPath) {
        const derivedFolder = deriveFolderPathFromPublicUrl(routeState.generatedLandingUrl);
        if (derivedFolder) setCurrentProjectFolderPath(derivedFolder);
      }
    }

    if (routeState?.folderPath) {
      setCurrentProjectFolderPath(routeState.folderPath);
    }
  }, [routeState]);

  useEffect(() => {
    if (!restoreProjectId || !user?.id) return;

    let cancelled = false;
    setIsLoadingRestoredProject(true);

    const loadRestoredProject = async () => {
      try {
        const project = await getProjectById(restoreProjectId, user.id, user.email);
        if (cancelled || !project?.form_data) return;

        const ownerId = project.user_id ?? user.id;
        const restoredFormData = typeof project.form_data === 'string'
          ? JSON.parse(project.form_data)
          : project.form_data;
        const restoredStep = project.currentStep ?? project.current_step ?? 0;

        setSavedProjectId(project.id);
        setProjectOwnerId(ownerId);
        setCurrentProjectFolderPath(project.folder_path || '');
        setFormData(normalizeFormData(restoredFormData));
        setCurrentStep(restoredStep);
        setMaxVisitedStep(restoredStep);
        setGeneratedSite(null);
        setGeneratedHtml('');
        setGeneratedLandingUrl(project.public_url || '');
        setShowResults(false);
        setShowLanding(false);
        setShowRestoreDialog(false);
        setPendingRestore(null);

        try {
          localStorage.setItem('lastEditedProjectId', String(project.id));
        } catch {}

        setIsLoadingRestoredProject(false);
        navigate('/', { replace: true, state: null });
      } catch (error) {
        console.error('Failed to restore project by ID:', error);
        toast.error('Could not restore this project. Please try again from History.');
        setShowLanding(true);
      } finally {
        if (!cancelled) setIsLoadingRestoredProject(false);
      }
    };

    loadRestoredProject();

    return () => {
      cancelled = true;
    };
  }, [restoreProjectId, user?.id, user?.email, navigate]);

  // Note: When restoring from History, the new project ID is passed via routeState.savedProjectId
  // (History.tsx creates the draft before navigating). No auto-draft needed here.

  useEffect(() => {
    if (!generatedHtml || !savedProjectId || !user?.id) return;

    setIsEditorSaving(true);
    const timeout = window.setTimeout(async () => {
      try {
        await updateProjectContent({
          id: savedProjectId,
          user_id: projectOwnerId ?? user.id,
          generated_html: generatedHtml,
        });
      } catch (error) {
        console.error('Visual editor autosave failed:', error);
      } finally {
        setIsEditorSaving(false);
      }
    }, 700);

    return () => window.clearTimeout(timeout);
  }, [generatedHtml, savedProjectId, projectOwnerId, user?.id]);

  const [isGeneratingLanding, setIsGeneratingLanding] = useState(false);

  const GENERATION_LEAVE_WARNING = 'Leaving now will cancel your landing page generation and progress will be lost. Do you want to leave?';

  const confirmLeaveGeneration = useCallback(() => {
    if (!isGenerating) return true;
    return window.confirm(GENERATION_LEAVE_WARNING);
  }, [isGenerating]);

  useEffect(() => {
    if (!isGenerating) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = GENERATION_LEAVE_WARNING;
      return GENERATION_LEAVE_WARNING;
    };

    const handlePopState = () => {
      const shouldLeave = window.confirm(GENERATION_LEAVE_WARNING);
      if (shouldLeave) {
        window.removeEventListener('popstate', handlePopState);
        window.history.back();
      } else {
        window.history.pushState({ cfGenerationGuard: true }, '', window.location.href);
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    window.history.pushState({ cfGenerationGuard: true }, '', window.location.href);
    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('popstate', handlePopState);
    };
  }, [isGenerating, GENERATION_LEAVE_WARNING]);

  const signOut = () => {
    if (!confirmLeaveGeneration()) return;
    authSignOut();
    navigate("/auth");
  };

  const resetGenerationTracking = () => {
    setGenerationCheckpoints(createInitialGenerationCheckpoints());
    setGenerationMessages([]);
  };

  const pushGenerationMessage = (message: string) => {
    setGenerationMessages((current) => (current[current.length - 1] === message ? current : [...current, message]));
  };

  const markGenerationCheckpoint = (key: GenerationCheckpoint['key'], done: boolean, detail: string) => {
    setGenerationCheckpoints((current) => current.map((checkpoint) => checkpoint.key === key
      ? { ...checkpoint, done, detail }
      : checkpoint));
  };


  const createDraftProject = async () => {
    if (!user?.id) return;
    try {
      const response = await fetch('/api/createProject.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: user.id,
          name: 'Draft',
          public_url: '',
          folder_path: '',
          form_data: defaultFormData,
          generated_html: '',
          current_step: 0,
        }),
      });
      const saved = await response.json();
      if (saved?.success && saved?.id) {
        setSavedProjectId(saved.id);
        setProjectOwnerId(user.id);
        if (saved?.folder_path) {
          setCurrentProjectFolderPath(String(saved.folder_path));
        }
        try { localStorage.setItem('lastEditedProjectId', String(saved.id)); } catch {}
      }
    } catch (err) {
      console.error('Failed to create draft project:', err);
    }
  };

  const handleStartGenerator = async () => {
    setIsTransitioning(true);
    await Promise.all([createDraftProject(), new Promise(r => setTimeout(r, 500))]);
    setShowLanding(false);
    setIsTransitioning(false);
  };

  // Check for saved progress on mount and prompt user
  useEffect(() => {
    if (restoreProjectId || routeState?.formData || routeState?.generatedHtml) return;
    const progress = loadSavedProgress(progressStorageKey);
    if (!progress) return;
    if (hasMeaningfulProgress(progress)) {
      setPendingRestore(progress);
      setShowRestoreDialog(true);
    }
  }, [restoreProjectId, routeState?.formData, routeState?.generatedHtml, progressStorageKey]);

  // Try to load from database if no localStorage and user is logged in
  useEffect(() => {
    if (restoreProjectId || routeState?.formData || routeState?.generatedHtml || !user?.id) return;
    if (showRestoreDialog || pendingRestore) return; // Already showing restore dialog
    
    const lastProjectId = (() => {
      try {
        const stored = localStorage.getItem('lastEditedProjectId');
        return stored ? parseInt(stored, 10) : null;
      } catch {
        return null;
      }
    })();

    if (!lastProjectId) return;

    const loadProject = async () => {
      try {
        const project = await getProjectById(lastProjectId, user.id, user.email);
        if (!project || !project.form_data) return;
        const ownerId = project.user_id ?? user.id;

        const projectData: SavedProgress = {
          currentStep: project.currentStep ?? project.current_step ?? 0,
          maxVisitedStep: project.currentStep ?? project.current_step ?? 0,
          formData: typeof project.form_data === 'string' ? JSON.parse(project.form_data) : project.form_data,
          user_id: ownerId,
          folder_path: project.folder_path || undefined,
        };

        if (hasMeaningfulProgress(projectData)) {
          setSavedProjectId(lastProjectId);
          setProjectOwnerId(ownerId);
          setCurrentProjectFolderPath(project.folder_path || '');
          setPendingRestore(projectData);
          setShowRestoreDialog(true);
        }
      } catch (error) {
        console.error('Failed to load project from database:', error);
      }
    };

    loadProject();
  }, [restoreProjectId, user?.id, user?.email, routeState?.formData, routeState?.generatedHtml, showRestoreDialog, pendingRestore]);

  const handleRestoreSession = () => {
    if (!pendingRestore) return;
    setFormData(normalizeFormData(pendingRestore.formData));
    setCurrentStep(pendingRestore.currentStep ?? 0);
    setMaxVisitedStep(pendingRestore.maxVisitedStep ?? 0);
    setProjectOwnerId(pendingRestore.user_id ?? null);
    setShowRestoreDialog(false);
    setPendingRestore(null);
    setIsTransitioning(true);
    setTimeout(() => { setShowLanding(false); setIsTransitioning(false); }, 300);
  };

  const handleDiscardSession = () => {
    safeRemove(progressStorageKey);
    safeRemove(LEGACY_STORAGE_KEY);
    try { localStorage.removeItem('lastEditedProjectId'); } catch {}
    setShowRestoreDialog(false);
    setPendingRestore(null);
    setSavedProjectId(null);
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
    const snapshot: SavedProgress = {
      currentStep,
      formData,
      maxVisitedStep,
      user_id: projectOwnerId ?? user?.id,
      folder_path: currentProjectFolderPath || undefined,
    };

    if (hasMeaningfulProgress(snapshot)) {
      safeSetJSON(progressStorageKey, snapshot);
    } else {
      safeRemove(progressStorageKey);
    }
  }, [currentStep, formData, maxVisitedStep, projectOwnerId, user?.id, currentProjectFolderPath, progressStorageKey]);

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

  const invokeWithRetry = async (purpose: string, referenceUrl: string | undefined, retries = 3): Promise<string | null> => {
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        if (attempt > 0) {
          const waitSec = 2 * attempt; // Shorter wait time
          setGenerationStatus(`Rate limited — retrying in ${waitSec}s (attempt ${attempt + 1}/${retries})...`);
          await new Promise(r => setTimeout(r, waitSec * 1000));
        }

        const data = await generateImages({
          referenceImageUrl: referenceUrl,
          style: formData.preferredStyle,
          businessName: formData.businessName,
          businessDescription: formData.businessDescription,
          businessCategory: formData.businessCategory,
          websiteType: 'landing',
          purpose,
          brandPersonality: formData.brandPersonality,
          primaryColor: formData.primaryColor,
          secondaryColor: formData.secondaryColor,
          valueProposition: formData.valueProposition,
          targetAudience: formData.targetAudience,
          services: formData.services.filter(Boolean),
          differentiators: formData.differentiators.filter(Boolean),
        });

        // Accept non-fallback responses, and also accept AI fallback providers (e.g., pollinations)
        // so we only fall back to Pexels when the provider is explicitly Pexels or no image is returned.
        if (data?.imageUrl && (!data?.fallback || (data?.provider && data.provider !== 'pexels'))) {
          return data.imageUrl;
        }

        // Rate limited — retry
        if (data?.reason && String(data.reason).toLowerCase().includes('rate limit')) {
          console.warn(`Image generation rate limited for "${purpose}", retrying...`);
          continue;
        }

        // Pexels fallback URL from edge function — accept it (real contextual photo, not AI)
        if (data?.fallback && data?.imageUrl && data?.provider === 'pexels') {
          console.info(`Using Pexels fallback for "${purpose}" (AI unavailable: ${data.reason || 'provider-fallback'})`);
          return data.imageUrl;
        }

        // Placeholder image — skip and let caller handle
        if (data?.fallback) {
          console.warn(`AI image generation unavailable for "${purpose}": ${data.reason || 'fallback used'}`);
          // Try Pexels inline before giving up
          try {
            const pexelsFallback = await searchPexelsImages();
            if (pexelsFallback[0]) return pexelsFallback[0];
          } catch { /* ignore */ }
          return null;
        }

        // No image returned at all
        console.warn(`Image generation returned no result for "${purpose}":`, data);
        break;

      } catch (err) {
        console.error(`Error generating image for "${purpose}" (attempt ${attempt + 1}):`, err);
        if (err instanceof Error && err.message.includes('Rate limit')) {
          continue;
        }
        if (attempt === retries - 1) {
          break;
        }
      }
    }
    return null;
  };

  const searchPexelsImages = async (purposeHint?: string): Promise<string[]> => {
    const searchTerms = [
      formData.businessCategory || formData.businessName || 'business',
      purposeHint || '',
      formData.services.filter(Boolean)[0] || 'professional',
      formData.preferredStyle || 'modern',
    ];
    const query = `${searchTerms.join(' ')} website`;

    try {
      setGenerationStatus('Searching stock images on Pexels...');
      const data = await searchImages(query, 3);

      if (!data?.images?.length) {
        console.warn('Pexels search returned no results');
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

    // Accept SVG data URIs directly — no network validation needed
    if (/^data:image\/(svg\+xml|png|jpeg|webp|gif)/i.test(trimmedUrl)) return Promise.resolve(true);

    // Accept project-relative assets/files paths produced by uploader or editor flows.
    if (/^(\/|\.\/|\.\.\/)(assets|files)\//i.test(trimmedUrl)) return Promise.resolve(true);
    if (/^(\/assets\/|\/files\/)/i.test(trimmedUrl)) return Promise.resolve(true);

    // Basic URL validation
    try {
      new URL(trimmedUrl);
    } catch {
      return Promise.resolve(false);
    }

    // For now, accept all valid URLs to avoid blocking generation
    // The actual validation will happen during generation
    return Promise.resolve(true);
  };

  const getImageDimensions = (images: BusinessFormData['images'], key: keyof ImageUrls): { width?: number; height?: number } => {
    const map: Partial<Record<keyof ImageUrls, [keyof ImageUrls, keyof ImageUrls]>> = {
      heroImage1: ['heroImage1Width', 'heroImage1Height'],
      heroImage2: ['heroImage2Width', 'heroImage2Height'],
      brandImage: ['brandImageWidth', 'brandImageHeight'],
      sectionImage1: ['sectionImage1Width', 'sectionImage1Height'],
      sectionImage2: ['sectionImage2Width', 'sectionImage2Height'],
      sectionImage3: ['sectionImage3Width', 'sectionImage3Height'],
      logoUrl: ['logoWidth', 'logoHeight'],
    };

    const pair = map[key];
    if (!pair) return {};
    const [wKey, hKey] = pair;
    return {
      width: typeof images[wKey] === 'number' ? images[wKey] as number : undefined,
      height: typeof images[hKey] === 'number' ? images[hKey] as number : undefined,
    };
  };

  const isLikelyIconAsset = (url: string, hint = '', width?: number, height?: number) => {
    const source = `${url} ${hint}`.toLowerCase();
    const looksLikeIconPath = /favicon|apple-touch-icon|mask-icon|site-icon|\/icon|icon-|logo|sprite|\.ico($|\?)/i.test(source);
    const tinyByDimensions = typeof width === 'number' && typeof height === 'number' && width <= 256 && height <= 256;
    return looksLikeIconPath || tinyByDimensions;
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
        url: (data.images[key] || '').trim(),
        valid: data.images[key] ? await validateImageUrl(data.images[key]) : false,
      }))
    );

    const validUrlSet = new Set(validityEntries.filter((entry) => entry.valid).map((entry) => entry.url));
    const sanitizedImages = { ...data.images, productImages: [] as string[] };
    const invalidLabels: string[] = [];

    validityEntries.forEach(({ key, url, valid }) => {
      if (url && !valid) invalidLabels.push(imageLabels[key]);
      const { width, height } = getImageDimensions(data.images, key);
      const contextHint = key === 'heroImage1'
        ? data.heroImage1Context
        : key === 'heroImage2'
        ? data.heroImage2Context
        : key === 'brandImage'
        ? data.brandImageContext
        : key === 'sectionImage1'
        ? data.sectionImage1Context
        : key === 'sectionImage2'
        ? data.sectionImage2Context
        : key === 'sectionImage3'
        ? data.sectionImage3Context
        : '';

      const rejectAsVisual = key !== 'logoUrl' && url && isLikelyIconAsset(url, contextHint || '', width, height);
      if (rejectAsVisual) {
        invalidLabels.push(`${imageLabels[key]} (icon/logo detected)`);
      }

      sanitizedImages[key] = valid && !rejectAsVisual ? (url || '').trim() : '';
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

    // Logo: ONLY use the user-provided logoUrl. No fallback to brand image, hero, or any other asset.
    // If no logo URL was provided, leave it empty — the page will use the business name as text.

    if (!sanitizedImages.brandImage) {
      const brandCandidates = [sanitizedImages.sectionImage3, sanitizedImages.sectionImage2]
        .filter(Boolean)
        .filter((candidate) => !isLikelyIconAsset(candidate as string));
      sanitizedImages.brandImage = brandCandidates[0] || '';
    }

    // Do NOT auto-promote section images to hero. If no hero image is provided, leave it empty
    // so the backend can generate/fetch a contextual Pexels hero instead of misusing a section photo.
    // heroImage1 stays empty if the user didn't provide one.

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

  const hasAdequateImages = (data: BusinessFormData = formData) => {
    const imgs = data.images;
    // Check if we have images with proper dimensions for key sections
    const hasLogo = imgs.logoUrl && imgs.logoWidth && imgs.logoHeight;
    const hasHero = (imgs.heroImage1 && imgs.heroImage1Width && imgs.heroImage1Height) ||
                   (imgs.heroImage2 && imgs.heroImage2Width && imgs.heroImage2Height);
    const hasSections = (imgs.sectionImage1 && imgs.sectionImage1Width && imgs.sectionImage1Height) ||
                       (imgs.sectionImage2 && imgs.sectionImage2Width && imgs.sectionImage2Height) ||
                       (imgs.sectionImage3 && imgs.sectionImage3Width && imgs.sectionImage3Height);

    return hasLogo && hasHero && hasSections;
  };

  const extractReferencedMediaUrls = (content: string): string[] => {
    if (!content?.trim()) return [];

    const urls = new Set<string>();
    const knownMediaHosts = [
      'datocms-assets.com',
      'images.ctfassets.net',
      'cdn.sanity.io',
      'res.cloudinary.com',
      'assets.imgix.net',
      'cdn.shopify.com',
      'images.squarespace-cdn.com',
      'static.wixstatic.com',
      'storage.googleapis.com',
      'amazonaws.com',
      's3.amazonaws.com',
      'cdn.prod.website-files.com',
      'framerusercontent.com',
      'media.graphassets.com',
      'media.graphcms.com',
      'images.pexels.com',
    ];

    const isLikelyMediaUrl = (value: string) => {
      if (!/^https?:\/\//i.test(value)) return false;
      if (/\.(js|html?)(?:[?#]|$)/i.test(value)) return false;
      if (/\.(jpg|jpeg|png|gif|webp|svg|avif|mp4|webm|ogg|mp3|wav|pdf|woff2?|ttf|otf|eot|ico)(?:[?#]|$)/i.test(value)) return true;
      return knownMediaHosts.some((host) => value.includes(host));
    };

    const directMatches = content.match(/https?:\/\/[^"'\s)]+/gi) || [];
    directMatches.forEach((url) => {
      const clean = url.trim();
      if (isLikelyMediaUrl(clean)) urls.add(clean);
    });

    const srcsetMatches = content.match(/srcset=["']([^"']+)["']/gi) || [];
    srcsetMatches.forEach((srcsetBlock) => {
      const parts = srcsetBlock.split('=')[1]?.replace(/^['"]|['"]$/g, '')?.split(',') || [];
      parts.forEach((entry) => {
        const candidate = entry.trim().split(/\s+/)[0] || '';
        if (isLikelyMediaUrl(candidate)) urls.add(candidate);
      });
    });

    return Array.from(urls);
  };

  const buildInlineFallbackImage = (label: string, color = '#1a1a2e') => {
    const safeColor = /^#?[0-9a-f]{6}$/i.test(color) ? (color.startsWith('#') ? color : `#${color}`) : '#1a1a2e';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1792" height="1024" viewBox="0 0 1792 1024"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${safeColor}"/><stop offset="100%" stop-color="#0f172a"/></linearGradient></defs><rect width="1792" height="1024" fill="url(#g)"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#ffffff" font-size="56" font-family="Arial, sans-serif">${label}</text></svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  };

  const syncStepImagesAssets = async (): Promise<BusinessFormData> => {
    if (!savedProjectId || !user?.id) {
      return formData;
    }
    const ownerId = projectOwnerId ?? user.id;

    let nextImages: BusinessFormData['images'] = {
      ...formData.images,
      productImages: [...formData.images.productImages],
    };

    const referenceUrl = nextImages.heroImage1 || nextImages.brandImage || nextImages.sectionImage1 || undefined;

    if (formData.generateAiImages) {
      if (!nextImages.heroImage1 && !nextImages.heroImage2) {
        const heroAi = await invokeWithRetry('hero banner', referenceUrl);
        if (heroAi) nextImages.heroImage1 = heroAi;
      }

      const sectionSlots = ['sectionImage1', 'sectionImage2', 'sectionImage3'] as const;
      for (let index = 0; index < sectionSlots.length; index++) {
        const key = sectionSlots[index];
        if (nextImages[key]) continue;
        const aiImage = await invokeWithRetry(`section image ${index + 1}`, referenceUrl);
        if (aiImage) nextImages[key] = aiImage;
      }
    }

    const sectionSlots = buildSectionImageSlots(formData);
    const fieldSources: Array<{ key: 'logoUrl' | 'heroImage1' | 'heroImage2' | 'brandImage' | 'sectionImage1' | 'sectionImage2' | 'sectionImage3' | 'aboutImage' | 'teamImage'; source: string; fileStem: string }> = [
      { key: 'logoUrl', source: nextImages.logoUrl, fileStem: 'logo' },
      { key: 'heroImage1', source: nextImages.heroImage1, fileStem: 'hero-image' },
      { key: 'heroImage2', source: nextImages.heroImage2, fileStem: 'hero-image-2' },
      { key: 'brandImage', source: nextImages.brandImage, fileStem: 'brand-image' },
      { key: 'sectionImage1', source: nextImages.sectionImage1, fileStem: sectionSlots[0].fileStem },
      { key: 'sectionImage2', source: nextImages.sectionImage2, fileStem: sectionSlots[1].fileStem },
      { key: 'sectionImage3', source: nextImages.sectionImage3, fileStem: sectionSlots[2].fileStem },
      { key: 'aboutImage', source: nextImages.aboutImage, fileStem: 'about-image' },
      { key: 'teamImage', source: nextImages.teamImage, fileStem: 'team-image' },
    ];

    for (const field of fieldSources) {
      const source = (field.source || '').trim();
      // Skip data URIs and URLs already saved inside this project's assets folder
      if (!source || /^data:image\//i.test(source) || /\/projects\/[^/]+\/assets\//.test(source)) continue;
      try {
        const result = await uploadProjectAssetsFromUrls(savedProjectId, ownerId, [source], [field.fileStem], { overwriteExisting: true });
        const uploaded = result.uploaded?.[0];
        if (uploaded?.url) {
          nextImages[field.key] = toAbsoluteUrl(uploaded.url);
        }
      } catch (error) {
        console.error(`Failed to sync ${field.fileStem}:`, error);
      }
    }

    const nextProductImages: string[] = [];
    for (let index = 0; index < nextImages.productImages.length; index++) {
      const source = (nextImages.productImages[index] || '').trim();
      if (!source || /^data:image\//i.test(source)) {
        if (source) nextProductImages.push(source);
        continue;
      }
      try {
        const result = await uploadProjectAssetsFromUrls(savedProjectId, ownerId, [source], [`product-image-${index + 1}`], { overwriteExisting: true });
        const uploaded = result.uploaded?.[0];
        nextProductImages.push(uploaded?.url ? toAbsoluteUrl(uploaded.url) : source);
      } catch (error) {
        console.error(`Failed to sync product image ${index + 1}:`, error);
        nextProductImages.push(source);
      }
    }
    nextImages.productImages = nextProductImages;

    const nextFormData: BusinessFormData = {
      ...formData,
      images: nextImages,
    };

    setFormData(nextFormData);
    await updateProjectFormState({
      id: savedProjectId,
      user_id: ownerId,
      current_step: currentStep,
      form_data: nextFormData,
    });

    return nextFormData;
  };

  const handleAiImagesGenerate = async () => {
    if (!savedProjectId || !user?.id) {
      toast.error('Save a project first before generating AI images.');
      return;
    }

    const slots = buildSectionImageSlots(formData);
    const initialLog: {label: string; status: 'pending'|'active'|'done'|'error'}[] = [
      { label: 'Initializing project folder', status: 'pending' },
      { label: 'Generating hero image', status: 'pending' },
      ...slots.map(s => ({ label: `Generating image: "${s.name}"`, status: 'pending' as const })),
      { label: 'Uploading to assets folder', status: 'pending' },
    ];

    setStepImagesAiGenerating(true);
    setStepImagesAiPercent(0);
    setStepImagesAiLog(initialLog);
    const ownerId = projectOwnerId ?? user.id;

    const updateLog = (index: number, status: 'active'|'done'|'error') => {
      setStepImagesAiLog(prev => prev.map((e, i) => i === index ? { ...e, status } : e));
    };

    let nextImages: BusinessFormData['images'] = {
      ...formData.images,
      productImages: [...formData.images.productImages],
    };

    try {
      // Step 0: folder already exists (created on project save)
      updateLog(0, 'done');
      setStepImagesAiPercent(5);

      const referenceUrl = nextImages.heroImage1 || nextImages.brandImage || nextImages.sectionImage1 || undefined;
      const sectionKeys = ['sectionImage1', 'sectionImage2', 'sectionImage3'] as const;

      // Generate all images in parallel — each slot updates its own log entry as it completes
      const needsHero = !nextImages.heroImage1 && !nextImages.heroImage2;
      const slotsToGenerate = sectionKeys.map((key, i) => ({
        key,
        logIdx: 2 + i,
        name: slots[i]?.name ?? `section ${i + 1}`,
        skip: !!nextImages[key],
      }));

      // Mark all active immediately so user sees parallel activity
      if (needsHero) updateLog(1, 'active');
      slotsToGenerate.forEach(s => updateLog(s.logIdx, s.skip ? 'done' : 'active'));

      let doneCount = 1;
      const totalGen = 1 + slotsToGenerate.filter(s => !s.skip).length;
      const bumpProgress = () => {
        doneCount++;
        setStepImagesAiPercent(Math.round((doneCount / (totalGen + 1)) * 75));
      };

      const [heroResult, ...sectionResults] = await Promise.all([
        needsHero
          ? invokeWithRetry('hero banner', referenceUrl).then(url => { updateLog(1, url ? 'done' : 'error'); bumpProgress(); return url; })
          : Promise.resolve(null).then(() => { updateLog(1, 'done'); return null; }),
        ...slotsToGenerate.map(s =>
          s.skip
            ? Promise.resolve(null)
            : invokeWithRetry(s.name, referenceUrl).then(url => { updateLog(s.logIdx, url ? 'done' : 'error'); bumpProgress(); return url; })
        ),
      ]);

      if (heroResult) nextImages.heroImage1 = heroResult;
      slotsToGenerate.forEach((s, i) => {
        const url = sectionResults[i];
        if (url) nextImages[s.key] = url;
      });

      // Upload all to assets in parallel
      const uploadLogIdx = 2 + slots.length;
      updateLog(uploadLogIdx, 'active');
      setStepImagesAiPercent(80);

      type UploadField = { key: typeof sectionKeys[number] | 'logoUrl' | 'heroImage1' | 'heroImage2' | 'brandImage' | 'aboutImage' | 'teamImage'; source: string; fileStem: string };
      const fieldSourcesToUpload: UploadField[] = [
        { key: 'logoUrl', source: nextImages.logoUrl, fileStem: 'logo' },
        { key: 'heroImage1', source: nextImages.heroImage1, fileStem: 'hero-image' },
        { key: 'heroImage2', source: nextImages.heroImage2, fileStem: 'hero-image-2' },
        { key: 'brandImage', source: nextImages.brandImage, fileStem: 'brand-image' },
        { key: 'sectionImage1', source: nextImages.sectionImage1, fileStem: slots[0]?.fileStem ?? 'section-1' },
        { key: 'sectionImage2', source: nextImages.sectionImage2, fileStem: slots[1]?.fileStem ?? 'section-2' },
        { key: 'sectionImage3', source: nextImages.sectionImage3, fileStem: slots[2]?.fileStem ?? 'section-3' },
        { key: 'aboutImage', source: nextImages.aboutImage, fileStem: 'about-image' },
        { key: 'teamImage', source: nextImages.teamImage, fileStem: 'team-image' },
      ];

      const uploadOneField = async (field: UploadField) => {
        const src = (field.source || '').trim();
        if (!src || /\/projects\/[^/]+\/assets\//.test(src)) return;
        try {
          let uploaded: { url?: string } | undefined;
          if (/^data:image\//i.test(src)) {
            const mimeMatch = src.match(/^data:(image\/[^;]+);base64,/);
            const mime = mimeMatch?.[1] ?? 'image/jpeg';
            const ext = mime.split('/')[1]?.replace('jpeg', 'jpg') ?? 'jpg';
            const base64 = src.split(',')[1];
            const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
            const file = new File([bytes], `${field.fileStem}.${ext}`, { type: mime });
            const result = await uploadProjectAssets(savedProjectId, ownerId, [file]);
            uploaded = result.uploaded?.[0];
          } else {
            const result = await uploadProjectAssetsFromUrls(savedProjectId, ownerId, [src], [field.fileStem], { overwriteExisting: true });
            uploaded = result.uploaded?.[0];
          }
          if (uploaded?.url) {
            (nextImages as any)[field.key] = toAbsoluteUrl(uploaded.url);
          }
        } catch (err) {
          console.error(`AI gen upload failed for ${field.fileStem}:`, err);
        }
      };

      await Promise.all(fieldSourcesToUpload.map(uploadOneField));

      updateLog(uploadLogIdx, 'done');
      setStepImagesAiPercent(100);

      const previewUrls = [
        nextImages.heroImage1,
        nextImages.sectionImage1,
        nextImages.sectionImage2,
        nextImages.sectionImage3,
      ].filter(Boolean) as string[];
      setAiImagesGenerated(true);
      setAiGeneratedImageUrls(previewUrls);

      // Disable AI generation after running StepImages so LP generation doesn't
      // redundantly invoke AI for the same slots (LP still fills empty slots via Pexels).
      const nextFormData: BusinessFormData = {
        ...formData,
        images: nextImages,
        generateAiImages: false,
      };
      setFormData(nextFormData);
      await updateProjectFormState({
        id: savedProjectId,
        user_id: ownerId,
        current_step: currentStep,
        form_data: nextFormData,
      });

    } catch (err) {
      console.error('AI image generation failed:', err);
      toast.error('Image generation encountered an error. Check the steps above.');
    } finally {
      setStepImagesAiGenerating(false);
    }
  };

  const handleUploadImagesForStep = async (files: File[]): Promise<{ name: string; url: string }[]> => {
    if (!savedProjectId || !user?.id) {
      toast.error('Save a project first to upload assets.');
      return [];
    }
    try {
      const result = await uploadProjectAssets(savedProjectId, projectOwnerId ?? user.id, files);
      return (result.uploaded || []).map((a: any) => ({ name: a.name, url: toAbsoluteUrl(a.url) }));
    } catch {
      toast.error('Failed to upload images to assets.');
      return [];
    }
  };

  const handleNext = async () => {
    if (currentStepId === 'images') {
      try {
        setIsGeneratingImages(true);
        setGenerationStatus('Preparing project assets...');
        await syncStepImagesAssets();
      } catch (error) {
        console.error('StepImages asset preparation failed:', error);
        toast.warning('Some assets could not be prepared yet. Continuing with the current data.');
      } finally {
        setIsGeneratingImages(false);
      }
    }
    next();
  };

  const replaceUrlsInContent = (content: string, replacements: Record<string, string>) => {
    let next = content;
    Object.entries(replacements).forEach(([from, to]) => {
      if (!from || !to || from === to) return;
      const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      next = next.replace(new RegExp(escaped, 'g'), to);
    });
    return next;
  };

  const extractRemainingAssetUrlsFromError = (message: string): string[] => {
    if (!message) return [];
    const match = message.match(/Remaining remote assets:\s*([\s\S]+)/i);
    if (!match?.[1]) return [];
    return match[1]
      .split(',')
      .map((value) => value.trim())
      .filter((value) => /^https?:\/\//i.test(value));
  };

  const handleGenerate = async () => {
    setIsGenerating(true);
    setGenerationProgress(0);
    setGeneratedLandingUrl('');
    setGeneratedHtml('');
    resetGenerationTracking();
    pushGenerationMessage('Generation started. Preparing structured site output...');

    const preparedFormData = await sanitizeImagesForGeneration(formData);
    let generationFormData: BusinessFormData = {
      ...preparedFormData,
      images: {
        ...preparedFormData.images,
        productImages: [...preparedFormData.images.productImages],
      },
    };

    // Collect images locally to avoid React state timing issues
    let collectedImages: string[] = [];

    // Image hierarchy: form images → AI generated → Pexels
    // Only generate AI images for slots the user left empty
    setIsGeneratingImages(true);
    const referenceUrl = preparedFormData.images.heroImage1 || preparedFormData.images.brandImage || preparedFormData.images.sectionImage1 || undefined;

    try {
      // User-provided StepImages hero always has priority over AI/fallback.
      const userHero = preparedFormData.images.heroImage1 || preparedFormData.images.heroImage2;

      if (userHero) {
        // User already has a hero image — use it, skip AI generation for the hero
        collectedImages = [userHero];
        generationFormData = {
          ...generationFormData,
          images: { ...generationFormData.images, heroImage1: userHero },
        };
        toast.success('Using your provided hero image.');
      } else if (formData.generateAiImages) {
        // No form hero image and AI generation is enabled — try AI generation
        setGenerationStatus('Generating AI hero image...');
        setGenerationProgress(20);
        const aiHeroImage = await invokeWithRetry('hero banner', referenceUrl);

        if (aiHeroImage) {
          collectedImages = [aiHeroImage];
          generationFormData = {
            ...generationFormData,
            images: { ...generationFormData.images, heroImage1: aiHeroImage },
          };
          toast.success('AI hero image generated successfully');
        } else {
          // AI failed — fall back to Pexels for hero
          toast.error('AI image generation failed. Using contextual Pexels image for the hero...');
          try {
            const pexelsHeroImages = await searchPexelsImages('hero');
            const pexelsHero = pexelsHeroImages[0] || null;
            if (pexelsHero) {
              collectedImages = [pexelsHero];
              generationFormData = {
                ...generationFormData,
                images: { ...generationFormData.images, heroImage1: pexelsHero },
              };
            } else {
              const inlineHero = buildInlineFallbackImage('Hero image', generationFormData.primaryColor || '#1a1a2e');
              collectedImages = [inlineHero];
              generationFormData = {
                ...generationFormData,
                images: { ...generationFormData.images, heroImage1: inlineHero },
              };
            }
          } catch (pexelsErr) {
            console.error('Pexels hero fallback error:', pexelsErr);
            const inlineHero = buildInlineFallbackImage('Hero image', generationFormData.primaryColor || '#1a1a2e');
            collectedImages = [inlineHero];
            generationFormData = {
              ...generationFormData,
              images: { ...generationFormData.images, heroImage1: inlineHero },
            };
          }
        }
      } else {
        // AI generation is disabled — use Pexels as fallback
        setGenerationStatus('Searching stock images for hero...');
        setGenerationProgress(20);
        try {
          const pexelsHeroImages = await searchPexelsImages('hero');
          const pexelsHero = pexelsHeroImages[0] || null;
          if (pexelsHero) {
            collectedImages = [pexelsHero];
            generationFormData = {
              ...generationFormData,
              images: { ...generationFormData.images, heroImage1: pexelsHero },
            };
            toast.success('Loaded stock image for hero section.');
          } else {
            const inlineHero = buildInlineFallbackImage('Hero image', generationFormData.primaryColor || '#1a1a2e');
            collectedImages = [inlineHero];
            generationFormData = {
              ...generationFormData,
              images: { ...generationFormData.images, heroImage1: inlineHero },
            };
          }
        } catch (pexelsErr) {
          console.error('Pexels hero search error:', pexelsErr);
          const inlineHero = buildInlineFallbackImage('Hero image', generationFormData.primaryColor || '#1a1a2e');
          collectedImages = [inlineHero];
          generationFormData = {
            ...generationFormData,
            images: { ...generationFormData.images, heroImage1: inlineHero },
          };
        }
      }

      setGeneratedImages(collectedImages);
    } catch (err) {
      console.error('Hero image generation error:', err);
      const userHero = preparedFormData.images.heroImage1 || preparedFormData.images.heroImage2;
      if (userHero) {
        collectedImages = [userHero];
      } else {
        toast.error(err instanceof Error ? err.message : 'Error generating hero image. Falling back to Pexels...');
        try {
          const pexelsHeroImages = await searchPexelsImages('hero');
          const pexelsHero = pexelsHeroImages[0] || null;
          if (pexelsHero) {
            collectedImages = [pexelsHero];
            generationFormData = {
              ...generationFormData,
              images: { ...generationFormData.images, heroImage1: pexelsHero },
            };
          } else {
            const inlineHero = buildInlineFallbackImage('Hero image', generationFormData.primaryColor || '#1a1a2e');
            collectedImages = [inlineHero];
            generationFormData = {
              ...generationFormData,
              images: { ...generationFormData.images, heroImage1: inlineHero },
            };
          }
        } catch {
          const inlineHero = buildInlineFallbackImage('Hero image', generationFormData.primaryColor || '#1a1a2e');
          collectedImages = [inlineHero];
          generationFormData = {
            ...generationFormData,
            images: { ...generationFormData.images, heroImage1: inlineHero },
          };
        }
      }
    } finally {
      setIsGeneratingImages(false);
    }


    // Section images: form images → AI generated (if enabled) → Pexels
    setGenerationStatus('Filling section images...');
    setGenerationProgress(40);
    try {
      const sectionSlots = ['sectionImage1', 'sectionImage2', 'sectionImage3'] as const;
      const emptySectionSlots = sectionSlots.filter(k => !generationFormData.images[k]);
      const emptySlotsCount = emptySectionSlots.length;

      if (emptySlotsCount > 0) {
        // Try AI generation for each empty slot first (if enabled)
        const aiSectionImages: (string | null)[] = [];
        if (formData.generateAiImages) {
          for (let i = 0; i < emptySectionSlots.length; i++) {
            const slotKey = emptySectionSlots[i];
            setGenerationStatus(`Generating AI ${slotKey}...`);
            const aiImg = await invokeWithRetry(`section image ${i + 1}`, referenceUrl);
            aiSectionImages.push(aiImg);
          }
        } else {
          // AI generation disabled — pre-fill array with nulls
          aiSectionImages.fill(null, 0, emptySlotsCount);
        }

        const aiFilledSlots = aiSectionImages.filter(Boolean).length;

        // Fill remaining empty slots with Pexels
        let pexelsImages: string[] = [];
        const stillEmptyCount = emptySectionSlots.filter((_, i) => !aiSectionImages[i]).length;
        if (stillEmptyCount > 0) {
          setGenerationStatus('Searching Pexels images for remaining section slots...');
          pexelsImages = await searchPexelsImages('sections').catch(() => []);
        }

        let pexelsIdx = 0;
        const updatedImages = { ...generationFormData.images };
        emptySectionSlots.forEach((k, i) => {
          if (aiSectionImages[i]) {
            updatedImages[k] = aiSectionImages[i]!;
          } else if (pexelsImages[pexelsIdx]) {
            updatedImages[k] = pexelsImages[pexelsIdx++];
          } else {
            updatedImages[k] = buildInlineFallbackImage(`Section ${i + 1}`, generationFormData.primaryColor || '#1a1a2e');
          }
        });
        updatedImages.brandImage = updatedImages.brandImage || updatedImages.sectionImage1 || '';

        generationFormData = { ...generationFormData, images: updatedImages };
        collectedImages = [
          collectedImages[0],
          ...[updatedImages.sectionImage1, updatedImages.sectionImage2, updatedImages.sectionImage3].filter(Boolean) as string[],
        ].filter(Boolean) as string[];

        if (aiFilledSlots > 0) toast.success(`Generated ${aiFilledSlots} AI section image(s)`);
        if (pexelsIdx > 0) toast.success(`Loaded ${pexelsIdx} Pexels image(s) for remaining section slots`);
      } else {
        // All section slots already have form images
        collectedImages = [
          collectedImages[0],
          ...[generationFormData.images.sectionImage1, generationFormData.images.sectionImage2, generationFormData.images.sectionImage3].filter(Boolean) as string[],
        ].filter(Boolean) as string[];
      }
    } catch (err) {
      console.error('Section image error:', err);
      toast.warning('Could not load section images. Continuing with available images.');
    }

    // Final sweep: fill any remaining empty visual slots so no blank white areas appear.
    // Priority: recycle already-collected images → new Pexels search → brand-colored placeholder.
    try {
      const visualSlots = ['heroImage1', 'sectionImage1', 'sectionImage2', 'sectionImage3', 'brandImage'] as const;
      const emptySlots = visualSlots.filter(k => !generationFormData.images[k]);

      if (emptySlots.length > 0) {
        setGenerationStatus('Filling remaining image slots...');

        // First try to recycle collected images across empty slots
        let recycled = 0;
        const finalImages = { ...generationFormData.images };
        const pool = [...collectedImages].filter(Boolean);

        for (const slot of emptySlots) {
          if (pool.length > 0) {
            finalImages[slot] = pool[recycled % pool.length];
            recycled++;
          }
        }

        // If still empty after recycling (no collected images at all), fetch Pexels
        const stillEmpty = emptySlots.filter(k => !finalImages[k]);
        if (stillEmpty.length > 0) {
          setGenerationStatus('Fetching fallback images from Pexels...');
          const fallbackPexels = await searchPexelsImages().catch(() => [] as string[]);
          let pi = 0;
          for (const slot of stillEmpty) {
            const img = fallbackPexels[pi % Math.max(fallbackPexels.length, 1)];
            if (img) { finalImages[slot] = img; pi++; }
          }
        }

        // Ultimate fallback: inline SVG (prevents remote mirror failures)
        for (const slot of visualSlots) {
          if (!finalImages[slot]) {
            finalImages[slot] = buildInlineFallbackImage(`Visual ${slot}`, generationFormData.primaryColor || '#1a1a2e');
          }
        }

        generationFormData = { ...generationFormData, images: finalImages };
        collectedImages = [
          finalImages.heroImage1,
          finalImages.sectionImage1,
          finalImages.sectionImage2,
          finalImages.sectionImage3,
        ].filter(Boolean) as string[];

        if (recycled > 0 || stillEmpty.length > 0) {
          toast.info(`Filled ${emptySlots.length} empty image slot(s) to avoid blank spaces.`);
        }
      }
    } catch (sweepErr) {
      console.error('Final image sweep error:', sweepErr);
    }

    setGeneratedImages(collectedImages);

    setGenerationStatus('Generating your landing page with AI...');
    setGenerationProgress(50);
    pushGenerationMessage('Requesting structured HTML, CSS, JS, and asset list from AI...');

    const currentPrompt = generatePrompt(generationFormData, collectedImages);
    const mandatorySections = buildMandatorySections(generationFormData);
    const formDataSnapshot = buildFormDataSnapshot(generationFormData, collectedImages);

    try {
      const data = await generateLanding({
        prompt: currentPrompt,
        businessName: generationFormData.businessName,
        customSlug: generationFormData.customSlug || undefined,
        formData: formDataSnapshot,
        ...(mandatorySections.length > 0 && { mandatorySections }),
      });

      console.log('Raw AI response:', data);
      let parsed = normalizeGeneratedSite(data);

      // Collect ALL user-provided images from the form so they are sent to publishSite
      // and mirrored into assets/ even if not referenced in generated HTML
      const allFormImages: string[] = [
        generationFormData.images.heroImage1,
        generationFormData.images.heroImage2,
        generationFormData.images.logoUrl,
        generationFormData.images.brandImage,
        generationFormData.images.sectionImage1,
        generationFormData.images.sectionImage2,
        generationFormData.images.sectionImage3,
        generationFormData.images.aboutImage,
        generationFormData.images.teamImage,
        ...generationFormData.images.productImages,
        ...collectedImages,
      ].filter(Boolean) as string[];

      const existingAssets = new Set(parsed.assets);
      const extraAssets = allFormImages.filter(url => !existingAssets.has(url));
      parsed = {
        ...parsed,
        assets: [...extraAssets, ...parsed.assets],
      };
      const previewDocument = buildGeneratedDocument(parsed, generationFormData.businessName || 'Generated Site', generationFormData.language && generationFormData.language !== 'auto' ? generationFormData.language : 'en');
      console.log('Parsed generated site:', parsed);
      setGeneratedSite(parsed);
      setGenerationProgress(65);

      const isInlineDoc = /<!DOCTYPE|<html/i.test(parsed.html);

      if (parsed.html) {
        markGenerationCheckpoint('html', true, isInlineDoc ? 'Complete inline HTML document generated.' : 'HTML generated successfully.');
        pushGenerationMessage(isInlineDoc ? 'Inline HTML document generated.' : 'HTML generation completed.');
      }

      if (isInlineDoc) {
        markGenerationCheckpoint('css', true, 'CSS embedded inline in HTML document.');
        markGenerationCheckpoint('js', true, 'JS embedded inline in HTML document.');
        pushGenerationMessage('CSS and JS embedded inline in the HTML document.');
      } else {
        if (parsed.css) {
          markGenerationCheckpoint('css', true, 'CSS generated successfully.');
          pushGenerationMessage('CSS generation completed.');
        }
        if (parsed.js) {
          markGenerationCheckpoint('js', true, 'script.js generated successfully.');
          pushGenerationMessage('script.js generation completed.');
        }
      }

      markGenerationCheckpoint(
        'assets',
        true,
        parsed.assets.length > 0
          ? `${parsed.assets.length} asset(s) detected for mirroring.`
          : 'No external assets detected in this generation.'
      );
      pushGenerationMessage(
        parsed.assets.length > 0
          ? `${parsed.assets.length} asset(s) queued for assets/ mirroring.`
          : 'No external assets were required for this page.'
      );

      if (parsed.html && user?.id) {
        try {
          setGenerationStatus('Publishing generated files...');
          setGenerationProgress(85);
          pushGenerationMessage(isInlineDoc ? 'Publishing index.html (inline) and assets...' : 'Publishing index.html, style.css, script.js, and assets...');
          const requestedSlug = resolveProjectSlug(generationFormData);
          const basePayload = {
            project_id: savedProjectId,
            user_id: projectOwnerId ?? user.id,
            name: generationFormData.businessName || 'Projeto',
            slug: requestedSlug,
            form_data: generationFormData,
            html: parsed.html,
            css: isInlineDoc ? '' : parsed.css,
            js: isInlineDoc ? '' : parsed.js,
            assets: parsed.assets,
            inline_doc: isInlineDoc,
            current_step: currentStep,
          };

          const publishAttempt = async (payload: typeof basePayload) => {
            const response = await fetch('/api/publishSite.php', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
            return await response.json();
          };

          let saved = await publishAttempt(basePayload);

          // Recovery path for strict mirror errors: replace unresolved remotes and retry once.
          if (!saved?.success && (saved?.details || saved?.error)) {
            const details = String(saved?.details || saved?.error || '');
            const mirrorError = /must be mirrored|remaining remote assets/i.test(details);
            if (mirrorError) {
              const unresolved = extractRemainingAssetUrlsFromError(details);
              const userLogoUrl = (generationFormData.images.logoUrl || '').trim();
              const unresolvedSet = new Set(unresolved);
              const logoIsUnresolved = !!userLogoUrl && unresolvedSet.has(userLogoUrl);
              const fallbackPool = [
                generationFormData.images.heroImage1,
                generationFormData.images.heroImage2,
                generationFormData.images.brandImage,
                generationFormData.images.sectionImage1,
                generationFormData.images.sectionImage2,
                generationFormData.images.sectionImage3,
                ...generationFormData.images.productImages,
                ...collectedImages,
              ].filter(Boolean) as string[];

              const uniqueFallbackPool = Array.from(new Set(fallbackPool));
              const replacementMap: Record<string, string> = {};
              unresolved.forEach((url, index) => {
                // Never replace logo with another image.
                // If user logo cannot be used in publish, keep text fallback instead.
                if (userLogoUrl && url === userLogoUrl) {
                  return;
                }
                const replacement = uniqueFallbackPool[index % Math.max(uniqueFallbackPool.length, 1)]
                  || buildInlineFallbackImage(`Visual ${index + 1}`, generationFormData.primaryColor || '#1a1a2e');
                replacementMap[url] = replacement;
              });

              let patchedHtml = replaceUrlsInContent(basePayload.html, replacementMap);
              const patchedCss = replaceUrlsInContent(basePayload.css, replacementMap);
              const patchedJs = replaceUrlsInContent(basePayload.js, replacementMap);

              if (logoIsUnresolved) {
                const brandName = generationFormData.businessName?.trim() || 'Brand';
                const escapedBrandName = brandName
                  .replace(/&/g, '&amp;')
                  .replace(/</g, '&lt;')
                  .replace(/>/g, '&gt;')
                  .replace(/"/g, '&quot;')
                  .replace(/'/g, '&#39;');
                patchedHtml = patchedHtml
                  .replace(/<img[^>]*class=["'][^"']*brand-logo[^"']*["'][^>]*>/gi, '')
                  .replace(/<span\s+style=["']display:none["']([^>]*)>/gi, '<span$1>')
                  .replace(
                    /(<a[^>]*class=["'][^"']*brand-mark[^"']*["'][^>]*>)([\s\S]*?)(<\/a>)/gi,
                    (_, open, inner, close) => {
                      if (/<span[^>]*class=["'][^"']*brand-text[^"']*["'][^>]*>/i.test(inner)) {
                        return `${open}${inner}${close}`;
                      }
                      return `${open}<span class="brand-text" aria-label="${escapedBrandName}">${escapedBrandName}</span>${close}`;
                    },
                  );
              }

              const discoveredPatchedAssets = Array.from(new Set([
                ...extractReferencedMediaUrls(patchedHtml),
                ...extractReferencedMediaUrls(patchedCss),
                ...extractReferencedMediaUrls(patchedJs),
              ]));

              pushGenerationMessage(`Asset mirror fallback activated: substituting ${unresolved.length} unresolved asset(s) and retrying publish.`);
              toast.warning(`Some remote assets failed to mirror. Substituting ${unresolved.length} item(s) and continuing...`);

              saved = await publishAttempt({
                ...basePayload,
                html: patchedHtml,
                css: patchedCss,
                js: patchedJs,
                assets: discoveredPatchedAssets,
              });
            }
          }

          if (saved?.success && saved?.id) {
            const publishedHtml = saved.html || previewDocument;
            setSavedProjectId(saved.id);
            setProjectOwnerId(basePayload.user_id);
            setGeneratedLandingUrl(saved.url || '');
            if (saved?.folder_path) {
              setCurrentProjectFolderPath(String(saved.folder_path));
            } else {
              const derivedFolder = deriveFolderPathFromPublicUrl(saved?.url || '');
              if (derivedFolder) setCurrentProjectFolderPath(derivedFolder);
            }
            setGeneratedHtml(publishedHtml);
            setGenerationProgress(95);
            pushGenerationMessage('Publishing completed successfully.');
            if (saved?.warning_logo_blocked) {
              toast.warning(saved.warning_message || 'The logo could not be saved locally because the origin site blocks this file.');
            }
            if (saved?.slug && saved.slug !== requestedSlug) {
              toast.warning(`Slug already in use. Forge published this project as "${saved.slug}".`);
            }
          } else if (saved?.error) {
            throw new Error(saved.details || saved.error);
          }
        } catch (saveErr) {
          console.error('Error saving project:', saveErr);
          toast.warning('Could not publish to the server, but generation completed with a local preview.');
          pushGenerationMessage('Publish failed, but generation will continue with local preview and assets fallback.');
          setGeneratedHtml(previewDocument);
          setGeneratedLandingUrl('');
        }
      }

      if (data?.error) {
        toast.error(data.error);
        setIsGenerating(false);
        return;
      }

      if (parsed.html) {
        if (!user?.id) {
          setGeneratedHtml(previewDocument);
          pushGenerationMessage('Preview document assembled from generated HTML, CSS, and script.js.');
        }
        setGenerationProgress(100);
        setGenerationStatus('Generation created!');
        markGenerationCheckpoint('created', true, 'Landing page generated with 100% progress.');
        pushGenerationMessage('Generation created successfully.');
        toast.success('Landing page generated successfully!');
        await new Promise(r => setTimeout(r, 500));
        setIsGenerating(false);
        setShowResults(true);
      } else {
        throw new Error('No generated site content returned');
      }
    } catch (err) {
      console.error('Generate landing error:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to generate landing page. Please try again.');
      setIsGenerating(false);
    }
  };

  const saveCurrentProject = async () => {
    if (!user?.id || savedProjectId) return;

    const generatedDocument = generatedSite
      ? buildGeneratedDocument(generatedSite, formData.businessName || 'Generated Site', formData.language && formData.language !== 'auto' ? formData.language : 'en')
      : generatedHtml;

    try {
      const response = await fetch("/api/createProject.php", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: user.id,
          name: formData.businessName || "Projeto",
          public_url: "",
          folder_path: "",
          form_data: formData,
          generated_html: generatedDocument,
          current_step: currentStep,
        })
      });

      const saved = await response.json();
      if (saved?.success && saved?.id) {
        setSavedProjectId(saved.id);
        setProjectOwnerId(user.id);
        if (saved?.folder_path) {
          setCurrentProjectFolderPath(String(saved.folder_path));
        }
      }
    } catch (saveErr) {
      console.error('Error saving project:', saveErr);
    }
  };

  const resetToNewSession = () => {
    setShowResults(false);
    setGeneratedLandingUrl('');
    setGeneratedHtml('');
    setGeneratedSite(null);
    setFormData(defaultFormData);
    setCurrentStep(0);
    setMaxVisitedStep(0);
    setSavedProjectId(null);
    setProjectOwnerId(null);
    setCurrentProjectFolderPath('');
    setAiImagesGenerated(false);
    setAiGeneratedImageUrls([]);
    setStepImagesAiPercent(0);
    setStepImagesAiLog([]);
    safeRemove(progressStorageKey);
    safeRemove(LEGACY_STORAGE_KEY);
    try { localStorage.removeItem('lastEditedProjectId'); } catch {}
  };

  const handleNewLandingPage = async () => {
    await saveCurrentProject();
    resetToNewSession();
  };

  useEffect(() => {
    if (!savedProjectId || !user?.id) return;

    const timeout = window.setTimeout(async () => {
      try {
        await updateProjectFormState({
          id: savedProjectId,
          user_id: projectOwnerId ?? user.id,
          current_step: currentStep,
          form_data: formData,
        });
      } catch (error) {
        console.error('Form state autosave failed:', error);
      }
    }, 500);

    return () => window.clearTimeout(timeout);
  }, [savedProjectId, projectOwnerId, user?.id, currentStep, formData]);

  // Save last edited project ID to localStorage for recovery on re-open
  useEffect(() => {
    if (savedProjectId) {
      try {
        localStorage.setItem('lastEditedProjectId', String(savedProjectId));
      } catch (error) {
        console.error('Failed to save lastEditedProjectId:', error);
      }
    }
  }, [savedProjectId]);

  const prompt = generatePrompt(formData, generatedImages);

  const handleCopy = () => {
    navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success('Prompt copied! Paste it into a new Lovable project.');
  };

  const handleDownloadZip = async () => {
    if (!savedProjectId || !user?.id) {
      toast.error('Save/publish the project first to download the ZIP.');
      return;
    }

    try {
      setIsDownloadingZip(true);
      await downloadProjectZip(savedProjectId, projectOwnerId ?? user.id, resolveProjectSlug(formData));
      toast.success('Project ZIP download started.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to download project ZIP.');
    } finally {
      setIsDownloadingZip(false);
    }
  };

  if (isLoadingRestoredProject) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex items-center gap-3 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Restoring form...</span>
        </div>
      </div>
    );
  }

  // Landing page
  if (showLanding) {
    return (
      <>
        <div className={`transition-all duration-500 ${isTransitioning ? 'opacity-0 scale-95' : 'opacity-100 scale-100'}`}>
          <header className="fixed top-0 left-0 right-0 border-b border-border/50 px-6 py-[13px] z-50 bg-background/80 backdrop-blur-md">
            <div className="mx-auto max-w-6xl flex items-center justify-between">
              <button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} className="flex items-center gap-2 cursor-pointer">
                <img src="/images/logo-small.png" alt="Logo" className="h-8 w-auto" />
                <img src="/images/logo.png" alt="Forge" className="h-7 w-auto" />
              </button>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => { if (!confirmLeaveGeneration()) return; navigate('/history'); }} className="gap-2 text-muted-foreground hover:text-foreground">
                  <Clock className="h-4 w-4" /> History
                </Button>
                {user?.accountType === 'admin' && (
                  <Button variant="ghost" size="sm" onClick={() => setShowApiKeyModal(true)} className="gap-2 text-muted-foreground hover:text-foreground">
                    <Key className="h-4 w-4" /> API Key
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={signOut} className="gap-2 text-muted-foreground hover:text-foreground">
                  <LogOut className="h-4 w-4" /> Log out
                </Button>
              </div>
            </div>
          </header>
          <HeroLanding onStartGenerator={handleStartGenerator} onStartAdCreatives={() => navigate('/ad-creatives')} />
        </div>
        <ApiKeyModal open={showApiKeyModal} onClose={() => setShowApiKeyModal(false)} />
        {showRestoreDialog && pendingRestore && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-background border border-border rounded-2xl shadow-2xl p-8 max-w-sm w-full mx-4 flex flex-col gap-5">
              <div className="flex flex-col gap-1">
                <h2 className="text-xl font-semibold">Continue where you left off?</h2>
                <p className="text-muted-foreground text-sm">
                  We found a saved session
                  {pendingRestore.formData?.businessName ? ` for "${pendingRestore.formData.businessName}"` : ''}.
                  Would you like to restore the form?
                </p>
              </div>
              <div className="flex gap-3">
                <Button className="flex-1" onClick={handleRestoreSession}>
                  <RotateCcw className="h-4 w-4 mr-2" /> Restore session
                </Button>
                <Button variant="outline" className="flex-1" onClick={handleDiscardSession}>
                  Start fresh
                </Button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  // Generating screen
  if (isGenerating) {
    return (
      <div className="premium-home min-h-screen bg-background relative flex flex-col overflow-hidden">
        <PremiumParticleBackground activeTone="primary" />
        <Header onLogoClick={() => {
          if (!confirmLeaveGeneration()) return;
          setIsGenerating(false);
          setShowLanding(true);
        }} onSignOut={signOut} onHistoryClick={() => {
          if (!confirmLeaveGeneration()) return;
          setIsGenerating(false);
          navigate('/history');
        }} />
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

            <div className="rounded-lg border border-border bg-card/50 p-4 text-left space-y-3">
              <p className="text-xs font-medium text-foreground">Generation tracking</p>
              <div className="space-y-2">
                {generationCheckpoints.map((checkpoint) => (
                  <div key={checkpoint.key} className="flex items-start gap-3 text-xs">
                    <span className={`mt-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full border ${checkpoint.done ? 'border-primary bg-primary/15 text-primary' : 'border-border text-muted-foreground'}`}>
                      {checkpoint.done ? <Check className="h-3 w-3" /> : <Loader2 className="h-3 w-3 animate-spin opacity-60" />}
                    </span>
                    <div>
                      <p className="font-medium text-foreground">{checkpoint.label}</p>
                      <p className="text-muted-foreground">{checkpoint.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
              {generationMessages.length > 0 && (
                <div className="rounded-md bg-background/60 px-3 py-2">
                  <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Messages</p>
                  <div className="space-y-1">
                    {generationMessages.slice(-4).map((message, index) => (
                      <p key={`${index}-${message}`} className="text-xs text-muted-foreground">• {message}</p>
                    ))}
                  </div>
                </div>
              )}
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
    const hostedPreviewUrl = normalizeHostedPreviewUrl(generatedLandingUrl);

    return (
      <div className="premium-home min-h-screen bg-background relative flex flex-col overflow-hidden">
        <PremiumParticleBackground activeTone="primary" />
        <Header onLogoClick={() => setShowLanding(true)} onSignOut={signOut} />
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
            {/* Removed 'Enable Visual Editor' button as requested */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (!savedProjectId) {
                  toast.error('Save the project first to open the visual editor in a new tab.');
                  return;
                }
                const editorUrl = `${window.location.origin}/visual-editor?projectId=${savedProjectId}`;
                window.open(editorUrl, '_blank', 'noopener,noreferrer');
              }}
              disabled={!savedProjectId}
              className="gap-2"
            >
              <Edit3 className="h-4 w-4" /> Open in Editor Tab
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (hostedPreviewUrl) window.open(hostedPreviewUrl, '_blank', 'noopener,noreferrer');
              }}
              disabled={!hostedPreviewUrl}
              className="gap-2"
            >
              <ExternalLink className="h-4 w-4" /> Open Hosted Site
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownloadZip}
              disabled={isDownloadingZip || !savedProjectId || !user?.id}
              className="gap-2"
            >
              {isDownloadingZip ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
              {isDownloadingZip ? 'Preparing ZIP...' : 'Download Project ZIP'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowFtpDeploy(true)}
              disabled={!savedProjectId || !user?.id}
              className="gap-2"
            >
              <Server className="h-4 w-4" />
              Deploy to My Server
            </Button>
          </div>

          <div className="rounded-lg border border-border bg-muted/50 px-4 py-2 mb-4 flex items-center gap-2 max-w-2xl mx-auto w-full">
            <Link2 className="h-4 w-4 text-muted-foreground shrink-0" />
            {hostedPreviewUrl ? (
              <a
                href={hostedPreviewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-primary truncate hover:underline flex-1"
              >
                {hostedPreviewUrl}
              </a>
            ) : (
              <span className="text-sm text-muted-foreground flex-1">
                Published preview URL is not available.
              </span>
            )}
          </div>

          <div className="flex-1 min-h-[500px]">
            {visualEditorEnabled && generatedHtml ? (
              <VisualEditor
                html={generatedHtml}
                onChange={setGeneratedHtml}
                saving={isEditorSaving}
                projectId={savedProjectId}
                userId={projectOwnerId ?? user?.id}
                projectPublicUrl={hostedPreviewUrl}
                brandColors={{
                  primary: formData.primaryColor,
                  secondary: formData.secondaryColor,
                  accent: formData.accentColor,
                  text: formData.textColor,
                  background: formData.backgroundColor,
                }}
              />
            ) : hostedPreviewUrl ? (
              <div className="rounded-xl border border-border overflow-hidden bg-white shadow-lg">
              <iframe
                src={hostedPreviewUrl}
                className="w-full h-full min-h-[500px]"
                style={{ minHeight: '70vh' }}
                title="Landing Page Preview"
                sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-top-navigation-by-user-activation"
              />
              </div>
            ) : generatedHtml ? (
              <div className="rounded-xl border border-border overflow-hidden bg-white shadow-lg">
                <iframe
                  srcDoc={generatedHtml}
                  className="w-full h-full min-h-[500px]"
                  style={{ minHeight: '70vh' }}
                  title="Landing Page Inline Preview"
                  sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-top-navigation-by-user-activation"
                />
              </div>
            ) : (
              <div className="flex h-full min-h-[500px] items-center justify-center rounded-xl border border-border bg-white px-6 text-center text-sm text-muted-foreground" style={{ minHeight: '70vh' }}>
                The preview is available only through the published site URL.
              </div>
            )}
          </div>

          <div className="mt-6 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
            <Button
              variant="outline"
              size="lg"
              onClick={() => {
                setShowResults(false);
                setGeneratedLandingUrl('');
                setGeneratedHtml('');
                setGeneratedSite(null);
              }}
              className="gap-2 border-border/70 bg-background/70 px-6"
            >
              <ArrowLeft className="h-4 w-4" /> Re-edit Form
            </Button>
            <Button
              size="lg"
              onClick={handleNewLandingPage}
              className="gap-2 px-8 font-semibold shadow-lg shadow-primary/20 animate-pulse-glow"
            >
              <Sparkles className="h-4 w-4" /> Generate New Landing Page
            </Button>
          </div>
        </main>

        {/* FTP Deploy Modal — rendered here so it is scoped to the results screen */}
        {savedProjectId && user?.id && (
          <FtpDeployModal
            open={showFtpDeploy}
            onOpenChange={setShowFtpDeploy}
            projectSlug={resolveProjectSlug(formData)}
            projectId={savedProjectId}
            userId={user.id}
          />
        )}
      </div>
    );
  }

  // Form view
  return (
    <div className="premium-home min-h-screen bg-background relative overflow-hidden">
      <PremiumParticleBackground activeTone="primary" />
      <Header onLogoClick={() => setShowLanding(true)} onSignOut={signOut} />
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

        <div className="mt-8 glass-card rounded-xl p-6 sm:p-8" key={currentStepId}>
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
          {currentStepId === 'images' && <StepImages data={formData} onChange={updateForm} onGenerateAiImages={handleAiImagesGenerate} isGeneratingAiImages={stepImagesAiGenerating} aiPercent={stepImagesAiPercent} aiLog={stepImagesAiLog} onUploadImages={handleUploadImagesForStep} aiImagesGenerated={aiImagesGenerated} generatedImageUrls={aiGeneratedImageUrls} />}
          {currentStepId === 'contact' && <StepContact data={formData} onChange={updateForm} />}
          {/* Files step removed: download files will be created automatically from AI references to ./files/ in generated content. */}
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
                  safeRemove(progressStorageKey);
                  safeRemove(LEGACY_STORAGE_KEY);
                  toast.success('Form cleared');
                }
              }}
              className="gap-2 text-destructive hover:text-destructive"
            >
              <RotateCcw className="h-4 w-4" /> Clear
            </Button>
          </div>

          {currentStep < steps.length - 1 ? (
            <Button
              onClick={handleNext}
              disabled={(currentStepId === 'basics' && !formData.customSlug.trim()) || (currentStepId === 'images' && (isGeneratingImages || stepImagesAiGenerating))}
              className="gap-2"
            >
              {currentStepId === 'images' && isGeneratingImages ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Preparing assets...</>
              ) : (
                <>Next <ArrowRight className="h-4 w-4" /></>
              )}
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

function Header({ onLogoClick, onSignOut, onHistoryClick }: { onLogoClick?: () => void; onSignOut?: () => void; onHistoryClick?: () => void; }) {
  return (
    <header className="sticky top-0 border-b border-border/40 px-6 py-[13px] z-50 bg-background/25 backdrop-blur-md">
      <div className="mx-auto max-w-6xl flex items-center justify-between">
        <button onClick={onLogoClick} className="flex items-center gap-2 cursor-pointer">
          <img src="/images/logo-small.png" alt="Logo" className="h-8 w-auto" />
          <img src="/images/logo.png" alt="Forge" className="h-7 w-auto" />
        </button>
        <div className="flex items-center gap-2">
          {onHistoryClick ? (
            <Button variant="ghost" size="sm" onClick={onHistoryClick} className="gap-2 text-muted-foreground hover:text-foreground">
              <Clock className="h-4 w-4" /> History
            </Button>
          ) : (
            <Link to="/history">
              <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground hover:text-foreground">
                <Clock className="h-4 w-4" /> History
              </Button>
            </Link>
          )}
          <Button variant="ghost" size="sm" onClick={onSignOut} className="gap-2 text-muted-foreground hover:text-foreground">
            <LogOut className="h-4 w-4" /> Log out
          </Button>
        </div>
      </div>
    </header>
  );
}

function getLanguageName(lang: string): string {
  const languageMap: Record<string, string> = {
    'pt': 'Portuguese (Brazilian)',
    'en': 'English',
    'es': 'Spanish',
    'fr': 'French',
    'de': 'German',
    'it': 'Italian',
    'ja': 'Japanese',
    'zh': 'Simplified Chinese',
    'auto': 'Auto-detect',
  };
  return languageMap[lang] || 'English';
}

// Builds a compact structured snapshot of the form data to send alongside the text prompt.
// The edge function uses this to pre-populate the plan skeleton deterministically —
// guaranteeing correct theme colors, fonts, image URLs, and service item titles
// regardless of what the AI writes back in its JSON response.
function buildFormDataSnapshot(data: BusinessFormData, aiImages: string[]) {
  // CRITICAL: Each image field from the step MUST go to its exact designated slot.
  // Never mix or reorder them. AI images are fallback-only.

  // Hero: priority is user-provided (heroImage1 > heroImage2), then AI, then Pexels fallback
  const heroUrl = data.images.heroImage1 || data.images.heroImage2 || aiImages[0] || '';

  // Sections: MUST preserve order [sectionImage1, sectionImage2, sectionImage3]
  // Only add Pexels to fill EMPTY slots, preserving user-provided images in their exact positions
  const userSectionImages = [
    data.images.sectionImage1,
    data.images.sectionImage2,
    data.images.sectionImage3,
  ];
  
  // Count how many Pexels images we need as fallback
  const userSectionCount = userSectionImages.filter(Boolean).length;
  const pexelsNeeded = Math.max(0, 3 - userSectionCount);
  
  // Extract Pexels images, accounting for hero offset
  const pexelsOffset = 1; // collectedImages[0] is always the hero; sections start at index 1
  const pexelsSectionImages = aiImages.slice(pexelsOffset).slice(0, pexelsNeeded);

  // Merge: preserve user order, fill empty slots with Pexels in order
  let pexelsIndex = 0;
  const mergedSections = userSectionImages.map((userImg) => {
    if (userImg) return userImg;
    return pexelsSectionImages[pexelsIndex++] || '';
  }).filter(Boolean);

  const sessionsObjectiveContext = (() => {
    const cfg = data.pagesConfig;
    if (!cfg || !Array.isArray(cfg.pages)) return '';
    const enabledPages = cfg.pages.filter((p) => p.enabled);
    if (enabledPages.length === 0) return '';

    return enabledPages
      .map((p, i) => {
        const sectionHints = (p.sections || [])
          .filter((s) => (s.title || s.description))
          .map((s) => `${s.title || 'Item'}${s.description ? `: ${s.description}` : ''}`)
          .join(' | ');
        return `${i + 1}. ${p.name}${p.required ? ' [REQUIRED]' : ''}${p.description ? ` -> ${p.description}` : ''}${sectionHints ? ` | Items: ${sectionHints}` : ''}`;
      })
      .join('\n');
  })();

  const uploadedMustUseImages = Array.from(new Set([
    data.images.logoUrl,
    data.images.heroImage1,
    data.images.heroImage2,
    data.images.sectionImage1,
    data.images.sectionImage2,
    data.images.sectionImage3,
    data.images.aboutImage,
    data.images.teamImage,
    ...data.images.productImages,
  ].map((value) => (value || '').trim()).filter((value) => value && isUploadedImage(value))));

  return {
    landingPreset: data.landingPreset || 'general',
    generationObjective: data.generationObjective || '',
    businessCategory: data.businessCategory || '',
    sessionsObjectiveContext,
    theme: {
      // 'corporate' is a UI label that maps to 'modern' — not in the AI schema enum
      style: (data.preferredStyle === 'corporate' ? 'modern' : data.preferredStyle) || 'modern',
      primary: data.primaryColor || '#2563eb',
      secondary: data.secondaryColor || '#0f172a',
      accent: data.accentColor || '#f59e0b',
      background: data.backgroundColor || '#f8fafc',
      text: data.textColor || '#0f172a',
      headingFont: data.headingFont || 'Inter',
      bodyFont: data.bodyFont || 'Inter',
    },
    images: {
      logo: data.images.logoUrl || '',
      hero: heroUrl || '',
      sections: mergedSections,
      about: data.images.aboutImage || data.images.brandImage || '',
      team: data.images.teamImage || '',
      products: data.images.productImages.filter(Boolean),
    },
    imagePolicy: {
      forceUseUploaded: uploadedMustUseImages.length > 0,
      mustUse: uploadedMustUseImages,
    },
    imageContexts: {
      heroImage1: data.heroImage1Context || '',
      heroImage2: data.heroImage2Context || '',
      sectionImage1: data.sectionImage1Context || '',
      sectionImage2: data.sectionImage2Context || '',
      sectionImage3: data.sectionImage3Context || '',
      aboutImage: data.aboutImageContext || '',
      teamImage: data.teamImageContext || '',
      brandImage: data.brandImageContext || '',
    },
    services: data.services.filter(Boolean),
    differentiators: data.differentiators.filter(Boolean),
    contact: {
      email: data.email || '',
      phone: data.phone || '',
      whatsapp: data.whatsapp || '',
    },
    location: {
      city: data.city || '',
      country: data.country || '',
    },
    language: data.language || 'auto',
    conversionGoal: data.conversionGoal || 'lead-generation',
    guarantee: data.guarantee || '',
    urgencyLevel: data.urgencyLevel || 'medium',
    countdownTimer: data.countdownTimer ?? false,
    brandPersonality: data.brandPersonality || 'professional',
    toneOfVoice: data.toneOfVoice || 'conversational',
    // Carousel generation is intentionally disabled for stability.
    useCarousel: false,
    useAiImages: data.generateAiImages ?? false,
    socialLinks: {
      facebook: data.socialLinks?.facebook || '',
      instagram: data.socialLinks?.instagram || '',
      twitter: data.socialLinks?.twitter || '',
      linkedin: data.socialLinks?.linkedin || '',
      youtube: data.socialLinks?.youtube || '',
    },
    socialProofConfig: {
      socialProof: data.socialProof ?? true,
      testimonials: data.testimonials ?? true,
      trustBadges: data.trustBadges ?? true,
    },
    sourceWebsite: data.sourceWebsite || '',
    designNotes: data.designNotes || '',
    // downloadFiles intentionally omitted from snapshot: file linking is handled by AI-generated references (./files/...) and server-side mirroring.
    imageDimensions: (() => {
      const fmtDim = (w?: number, h?: number): string | undefined => {
        if (!w || !h) return undefined;
        const ratio = w / h;
        const shape = ratio > 1.5 ? 'landscape' : ratio < 0.75 ? 'portrait' : 'square';
        return `${w}x${h} (${shape})`;
      };
      const imgs = data.images;
      return {
        logo: fmtDim(imgs.logoWidth, imgs.logoHeight),
        hero: fmtDim(imgs.heroImage1Width, imgs.heroImage1Height),
        sections: [
          fmtDim(imgs.sectionImage1Width, imgs.sectionImage1Height),
          fmtDim(imgs.sectionImage2Width, imgs.sectionImage2Height),
          fmtDim(imgs.sectionImage3Width, imgs.sectionImage3Height),
        ].filter(Boolean) as string[],
        about: fmtDim(imgs.aboutImageWidth, imgs.aboutImageHeight),
        team: fmtDim(imgs.teamImageWidth, imgs.teamImageHeight),
      };
    })(),
  };
}

function generatePrompt(data: BusinessFormData, aiImages: string[]): string {
  const servicesText = data.services.filter(Boolean).join(', ');
  const diffsText = data.differentiators.filter(Boolean).join(', ');
  const socialText = Object.entries(data.socialLinks)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');

  const heroAiImage = aiImages[0] || '';
  const pexelsSectionImages = aiImages.slice(heroAiImage ? 1 : 0);

  const normalizedObjective = typeof data.generationObjective === 'string' ? data.generationObjective.trim() : '';

  // Build a human-readable section summary for the SECTION/CONTENT DIRECTION block.
  const normalizedSectionSummary = (() => {
    const cfg = data.pagesConfig;
    if (cfg?.mode === 'ai' && typeof cfg.aiSummary === 'string' && cfg.aiSummary.trim()) {
      return cfg.aiSummary.trim();
    }
    const enabled = (cfg?.pages || []).filter(p => p.enabled);
    if (enabled.length > 0) {
      const lines = enabled.map((p, i) => {
        let line = `  ${i + 1}. "${p.name}"${p.required ? ' [REQUIRED]' : ''}`;
        if (p.description) line += ` — ${p.description}`;
        if (p.sections?.length) {
          const items = p.sections.filter(s => s.title || s.description).map(s => `${s.title || ''}${s.description ? ': ' + s.description : ''}`).join(' | ');
          if (items) line += `\n     Items: ${items}`;
        }
        return line;
      });
      return `MANDATORY SECTIONS — full contract below. Page must follow this order exactly:\n${lines.join('\n')}`;
    }
    return '';
  })();

  const hasMandatorySections = (() => {
    const cfg = data.pagesConfig;
    return (cfg?.mode === 'ai' && typeof cfg.aiSummary === 'string' && cfg.aiSummary.trim().length > 0)
      || (Array.isArray(cfg?.pages) && cfg.pages.some(p => p.enabled));
  })();

  const sourceReference = data.sourceWebsite
    ? `SOURCE WEBSITE REFERENCE: ${data.sourceWebsite}
SOURCE WEBSITE ROLE: Reference only for visual cues, market context, and optional inspiration.
DO NOT reproduce the same copy, same section narrative, same offer framing, or same positioning from the source website unless that direction is explicitly repeated in the user objective or form fields.`
    : 'No source website reference provided.';

  const intentPriorityBlock = `
═══════════════════════════════════════════════════════════
INTENT PRIORITY RULES
═══════════════════════════════════════════════════════════

ABSOLUTE PRIORITY ORDER (HIGHEST TO LOWEST):
1. USER GENERATION OBJECTIVE
2. SECTION CONTRACT ${hasMandatorySections ? '◄ ACTIVE — the MANDATORY SECTION CONTRACT in PAGE STRUCTURE is BINDING' : '(no explicit sections — use intelligent defaults)'}
3. USER-EDITED FORM FIELDS (businessDescription, targetAudience, valueProposition, services, differentiators, brandSettings, conversionGoal)
4. SOURCE WEBSITE / SCRAPED CONTENT

NON-NEGOTIABLE RULES:
- The landing page MUST be generated primarily from the user's current objective and current form data.
${hasMandatorySections ? `- ⚠️ SECTION CONTRACT IS BINDING: The MANDATORY SECTION CONTRACT in the PAGE STRUCTURE section MUST be followed exactly — sections must appear in the listed ORDER with the specified kind values and content directives.
- Required sections [REQUIRED] MUST always appear regardless of content sparseness.
- Do NOT add, remove, or reorder sections from the contract.` : ''}
- Scraped website content is reference material only. It must NOT dominate the final messaging if the user has provided a different goal.
- If the user objective conflicts with the scraped site content, FOLLOW THE USER OBJECTIVE.
- If the user changed the form fields after scraping, FOLLOW THE CURRENT FORM FIELDS.
- Do NOT clone the scraped site's copy, section order, or business framing by default.
- The result must feel intentionally adapted to the requested objective, not a rewrite of the scraped site.
`.trim();

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
    'modern': 'Modern: clean, geometric, gradient accents, glassmorphism cards, conversion-focused layouts.',

    'corporate': 'Corporate (rendered as Modern): structured grid layout, professional hierarchy, data-driven trust sections. Use modern theme style.',

    'minimal': 'Minimal: maximum whitespace, monochromatic, large typography as the hero element.',

    'bold': 'Bold: high contrast dark backgrounds, oversized headlines, dramatic gradients, energetic movement.',

    'premium': 'Premium: near-black backgrounds, gold accents, elegant serif headings, refined spacing, cinematic imagery.',
  };

  const tonePersonalityGuide: Record<string, string> = {
    'professional': 'Authoritative, credible, and trustworthy. Use industry-standard language, data-driven claims, and formal structure. Tone: confident without being arrogant.',
    'friendly': 'Warm, approachable, and conversational. Use "you" language, contractions, and personal touches. Tone: like a trusted advisor, not a sales pitch.',
    'bold': 'Confident, energetic, and forward-thinking. Use strong verbs, bold claims, and inspiring language. Tone: motivational and action-driven.',
    'luxury': 'Sophisticated, exclusive, and refined. Use elevated language, nuance, and understatement. Tone: timeless elegance, never trendy or casual.',
    'tech': 'Cutting-edge, precise, and innovation-focused. Use technical terms appropriately, emphasize capabilities and features. Tone: forward-thinking and modern.',
    'creative': 'Imaginative, playful, and expressive. Use storytelling, metaphors, and personality. Tone: distinctive voice, memorable messaging.',
    'trustworthy': 'Transparent, honest, and reliable. Emphasize guarantees, testimonials, and credentials. Tone: dependable and no-nonsense.',
    'innovative': 'Visionary, boundary-pushing, and solution-oriented. Use future-focused language and breakthrough concepts. Tone: inspiring and transformative.',
  };

  const conversionGoalGuide: Record<string, string> = {
    'lead-generation': 'PRIMARY FOCUS: Lead capture via form. Include compelling offer statement above form, trust indicators, minimal form fields (max 3-4), and clear value exchange ("Get your free consultation"). High-contrast form section.',
    'sales': 'PRIMARY FOCUS: Direct sales closing. Emphasize product/service value, pricing transparency, urgency, limited availability, risk-free guarantee, money-back promise, and visible cart/checkout CTA.',
    'newsletter-signup': 'PRIMARY FOCUS: Email list building. Highlight benefits of subscription, exclusive content offer, social proof (subscriber count), minimal friction signup, and optional secondary CTAs.',
    'app-download': 'PRIMARY FOCUS: App downloads. Showcase app features, screenshots, user reviews, download badges (Apple App Store + Google Play), and prominent download CTAs with QR codes.',
    'webinar-registration': 'PRIMARY FOCUS: Event registration. Display speaker profiles, agenda, benefits/outcomes, countdown timer, limited seats messaging, and registration form above fold with minimal fields.',
    'contact-form': 'PRIMARY FOCUS: Direct contact. Include clear contact methods (form + email + phone + WhatsApp), location map, response time guarantee, and multiple contact CTAs.',
    'product-purchase': 'PRIMARY FOCUS: Ecommerce conversion. Showcase product with high-quality images/videos, clear pricing, reviews/ratings, stock availability, one-click purchase option, and payment icons.',
  };

  const urgencyLevelGuide: Record<string, string> = {
    'low': 'Subtle urgency: No countdown timer. Use language like "Be part of growing community", "Join X satisfied customers", soft CTAs. Relaxed pace.',
    'medium': 'Moderate urgency: Optional countdown timer (48-72 hours). Language: "Limited spots", "Early-bird pricing", "Offer valid through [date]". Clear but not aggressive.',
    'high': 'Strong urgency: Countdown timer (24-48 hours). Language: "Only X spots remaining", "Last chance to get [X%] off", "This offer expires soon", "Secure your spot now".',
    'urgent': 'Maximum urgency: Countdown timer (under 24 hours), pulsing badges, stock indicators, red/orange accents. Language: "Ending TODAY", "Last 3 spots available!", "Secure now before its gone". Animated elements.',
  };

  const socialProofGuide = `SOCIAL PROOF: ${data.socialProof ? 'Enabled — include trust stats, client logos, or numbers in socialProofBar[].' : 'Disabled.'}
TESTIMONIALS: ${data.testimonials ? 'Enabled — include a proof section with customer testimonials and star ratings.' : 'Disabled.'}
TRUST BADGES: ${data.trustBadges ? 'Enabled — include security/certification trust signals.' : 'Disabled.'}
COUNTDOWN TIMER: ${data.countdownTimer ? 'Enabled — add urgency copy and a countdown-oriented section.' : 'Disabled.'}`.trim();

  const guaranteeText = data.guarantee ? `CUSTOMER GUARANTEE:
"${data.guarantee}"
- Display prominently near CTA or in a highlighted section
- Use trust-building language and clear benefit statement
- Include icon (checkmark, shield, or guarantee badge)` : '';

  return `═══════════════════════════════════════════════════════════
PREMIUM LANDING PAGE GENERATION SPECIFICATION
═══════════════════════════════════════════════════════════

QUALITY STANDARD: Senior conversion copywriter level — $50k agency output.
Rules: outcome-first headlines (≤12 words), benefit-forward body (2–3 sentences, no filler adjectives),
items with punchy 2–5 word titles + concrete outcome descriptions, specific CTA labels ("Get My Free Audit",
not "Learn More"), socialProofBar with 4–5 trust signals, FAQ addressing real buyer objections.
Every section must earn its place. If context is sparse, extrapolate credibly from the industry.

═══════════════════════════════════════════════════════════
LANGUAGE & LOCALIZATION
═══════════════════════════════════════════════════════════

WEBSITE LANGUAGE: ${data.language === 'auto' ? 'Auto-detect from source website (detected)' : getLanguageName(data.language)}
IMPORTANT: Generate ALL page content in ${data.language === 'pt' ? 'Portuguese (Brazilian)' : data.language === 'en' ? 'English' : data.language === 'es' ? 'Spanish' : data.language === 'fr' ? 'French' : data.language === 'de' ? 'German' : data.language === 'it' ? 'Italian' : data.language === 'ja' ? 'Japanese' : data.language === 'zh' ? 'Simplified Chinese' : 'the same language as the source website'}.

- All headings, body text, button labels, form fields, and CTA text must be in this language
- Maintain consistency with terminology and tone specific to ${data.language === 'pt' ? 'Portuguese-speaking markets' : data.language === 'en' ? 'English-speaking markets' : data.language === 'es' ? 'Spanish-speaking markets' : 'the target market'}.
- Do NOT mix languages on the same page

═══════════════════════════════════════════════════════════
PAGE STRUCTURE & CONTENT SECTIONS  ◄ READ THIS FIRST
═══════════════════════════════════════════════════════════

${generatePagesSection(data)}

═══════════════════════════════════════════════════════════
LANDING PAGE CONFIGURATION
═══════════════════════════════════════════════════════════

LANDING PAGE TYPE: ${presetLabel}
PRESET CONTEXT: ${presetContext[data.landingPreset] || presetContext['general']}

USER GENERATION OBJECTIVE:
${normalizedObjective || 'No explicit preset objective was provided. Infer the page objective from the form data.'}

SECTION / CONTENT DIRECTION:
${normalizedSectionSummary || 'No custom section configuration provided. Use intelligent defaults based on the form data and conversion goal.'}

${intentPriorityBlock}

═══════════════════════════════════════════════════════════
BUSINESS INTELLIGENCE & POSITIONING
═══════════════════════════════════════════════════════════

COMPANY NAME: ${data.businessName}
INDUSTRY/CATEGORY: ${data.businessCategory}
LOCATION: ${[data.city, data.country].filter(Boolean).join(', ') || 'Not specified'}

BUSINESS DESCRIPTION:
${data.businessDescription || 'Generate professional copy based on business name and category.'}

TARGET AUDIENCE PROFILE:
${data.targetAudience || 'Professionals and decision-makers in the ' + data.businessCategory + ' industry.'}

VALUE PROPOSITION (CORE MESSAGE):
${data.valueProposition || 'Craft a compelling, benefit-focused value proposition based on the business description.'}

PRIMARY SERVICES / OFFERINGS:
${servicesText || 'Generate 4-6 relevant services based on the business category and description.'}

KEY DIFFERENTIATORS (WHY CHOOSE US):
${diffsText || 'Generate 3-4 compelling differentiators that set this business apart from competitors.'}

${(() => {
  const imageContexts = [
    data.heroImage1Context && `HERO IMAGE: ${data.heroImage1Context}`,
    data.heroImage2Context && `HERO IMAGE 2: ${data.heroImage2Context}`,
    data.brandImageContext && `BRAND IMAGE: ${data.brandImageContext}`,
    data.sectionImage1Context && `SECTION IMAGE 1: ${data.sectionImage1Context}`,
    data.sectionImage2Context && `SECTION IMAGE 2: ${data.sectionImage2Context}`,
    data.sectionImage3Context && `SECTION IMAGE 3: ${data.sectionImage3Context}`,
    data.aboutImageContext && `ABOUT IMAGE: ${data.aboutImageContext}`,
    data.teamImageContext && `TEAM IMAGE: ${data.teamImageContext}`,
  ].filter(Boolean);
  return imageContexts.length > 0
    ? `IMAGE CONTEXT (user-uploaded images — reference when generating copy for sections that use these images):\n${imageContexts.join('\n')}`
    : '';
})()}

SOURCE CONTENT HANDLING:
${sourceReference}

DESIGN NOTES FROM SITE ANALYSIS:
${typeof data.designNotes === 'string' && data.designNotes.trim() ? data.designNotes.trim() : 'No scraped design notes provided.'}

${typeof data.designNotes === 'string' && data.designNotes.trim() ? `VISUAL DIRECTION (BINDING — these notes define the design aesthetic):
- The design notes above capture the visual identity and aesthetic of the source website. Apply this direction firmly.
- Tone, energy level, sophistication, density, and emotional register of ALL copy MUST mirror that source.
- If the source is dark, luxurious, or bold — the output must feel dark, luxurious, and bold.
- If the source is minimal, airy, and typographic — match that restraint and whitespace.
- The design notes override generic style defaults for tone, messaging register, and visual energy.
- You must not keep the same business promise, copy angle, CTA framing, or section story if the user objective asks for something different.
- Reframe the page around the current form inputs; use the source website only for visual/tonal direction.` : `IMPORTANT SOURCE HANDLING RULES:
- You may borrow visual rhythm, level of polish, or category context from the source website.
- You must not keep the same business promise, copy angle, CTA framing, or section story if the user objective asks for something different.
- Reframe the page around the current form inputs, even when the scrape extracted different content.
- Prefer the explicit value proposition, target audience, and services from the form over any inferred source-website wording.`}

═══════════════════════════════════════════════════════════
ADVANCED BRAND & CONVERSION CONFIGURATION
═══════════════════════════════════════════════════════════

BRAND PERSONALITY: ${data.brandPersonality?.charAt(0).toUpperCase() + data.brandPersonality?.slice(1) || 'Professional'}
${tonePersonalityGuide[data.brandPersonality] || 'Professional and credible brand voice.'}

TONE OF VOICE: ${data.toneOfVoice?.charAt(0).toUpperCase() + data.toneOfVoice?.slice(1) || 'Professional'}
Write all copy in this tone. The entire page should feel cohesive and on-brand.

PRIMARY CONVERSION GOAL: ${data.conversionGoal?.replace(/-/g, ' ').toUpperCase() || 'LEAD GENERATION'}
${conversionGoalGuide[data.conversionGoal] || conversionGoalGuide['lead-generation']}

URGENCY LEVEL: ${data.urgencyLevel?.charAt(0).toUpperCase() + data.urgencyLevel?.slice(1) || 'Medium'}
${urgencyLevelGuide[data.urgencyLevel] || urgencyLevelGuide['medium']}

═══════════════════════════════════════════════════════════
TRUST & SOCIAL PROOF CONFIGURATION
═══════════════════════════════════════════════════════════

${socialProofGuide}

${guaranteeText ? `

${guaranteeText}` : ''}

═══════════════════════════════════════════════════════════
BRAND & VISUAL IDENTITY
═══════════════════════════════════════════════════════════

VISUAL STYLE: ${data.preferredStyle || 'modern'} — ${styleGuide[data.preferredStyle] || styleGuide['modern']}
FONTS: Heading — "${data.headingFont || 'Inter'}" | Body — "${data.bodyFont || 'Inter'}"
BRAND COLORS (pre-applied via skeleton — echo back in theme.* exactly): Primary ${data.primaryColor} · Secondary ${data.secondaryColor} · Accent ${data.accentColor} · Text ${data.textColor} · BG ${data.backgroundColor}
LOGO ENFORCEMENT: ${data.images.logoUrl ? `Use EXACTLY this logo URL in header/footer brand image and do not replace it: ${/^data:image\//i.test(data.images.logoUrl) ? '[logo provided via formData — see images.logo field]' : data.images.logoUrl}` : 'No logo URL provided. Use business name as text only and do not promote any other image to logo.'}

═══════════════════════════════════════════════════════════
LAYOUT DIRECTION (AI-CONTROLLED — you decide based on the business)
═══════════════════════════════════════════════════════════

You have FULL creative control over the layout. Do NOT default to the same structure for every site.
Choose every layout option based on the specific business type, industry, and emotional context.

hero.heroLayout — required, choose ONE:
- "fullscreen"  → Full-screen background image hero. For: restaurants, hotels, photography, events, real estate, beauty
- "split"       → Text left, large image right. For: SaaS, tech, agencies, consulting, apps, coaching
- "centered"    → Centered text overlay on image. For: luxury, fashion, premium, high-end services
- "minimal"     → Clean solid-color background, no image. For: law firms, finance, B2B, accounting, clinics

theme.cardStyle — required, choose ONE:
- "elevated"    → White cards with strong shadows (polished). For: corporate, SaaS, modern business
- "glass"       → Translucent glass morphism cards. For: premium, bold, dark-themed, nightlife, tech luxury
- "flat"        → Flat solid surface, no shadow. For: editorial, minimal, typographic, law, finance
- "outlined"    → Transparent cards with colored border. For: minimal, startups, clean tech brands

theme.spacingDensity — required, choose ONE:
- "compact"     → Tight (64px sections). For: data-heavy, SaaS, dashboards, many sections
- "normal"      → Standard (88px). For: most general businesses, services, e-commerce
- "spacious"    → Airy (120px). For: luxury, editorial, high-end, photography, architecture

section.layout (set per section) — choose based on the CONTENT of each section:
- "layout-split"          → Two-col: copy left, element right. Use when the section highlights an image
- "layout-split-reverse"  → Reversed. Alternate with layout-split for visual rhythm
- "layout-cards"          → Copy above, card grid below. For features, services, team, benefits
- "layout-copy-heavy"     → Wide single-column narrative. For story, about, manifesto, deep explanation
- "layout-mosaic"         → Asymmetric visual grid. For creative, portfolio, photography businesses
- "layout-featured"       → Large headline left, content right. For hero-style mid-page callouts
- "layout-wide-copy"      → Full-width brief copy. For short explanatory sections

LAYOUT MATCHING GUIDE (follow unless the specific business strongly suggests otherwise):
- Restaurant/Food/Bar:    heroLayout=fullscreen, cardStyle=glass,    spacingDensity=spacious
- SaaS/Tech/App:          heroLayout=split,       cardStyle=elevated, spacingDensity=compact
- Law/Finance/Accounting: heroLayout=centered,    cardStyle=flat,     spacingDensity=normal
- Photography/Creative:   heroLayout=fullscreen, cardStyle=glass,    spacingDensity=spacious
- Fitness/Sports/Gym:     heroLayout=split,       cardStyle=elevated, spacingDensity=compact
- Luxury/Fashion/Beauty:  heroLayout=centered,    cardStyle=glass,    spacingDensity=spacious
- Agency/Consulting:      heroLayout=split,       cardStyle=elevated, spacingDensity=normal
- E-commerce/Product:     heroLayout=split,       cardStyle=elevated, spacingDensity=compact
- Real Estate:            heroLayout=fullscreen, cardStyle=glass,    spacingDensity=spacious
- Medical/Health/Clinic:  heroLayout=centered,    cardStyle=flat,     spacingDensity=normal
- Education/Coaching:     heroLayout=split,       cardStyle=elevated, spacingDensity=normal

═══════════════════════════════════════════════════════════
CONTACT INFORMATION & INTEGRATIONS
═══════════════════════════════════════════════════════════
${data.email ? `Email: ${data.email}` : 'No email provided'}
${data.phone ? `Phone: ${data.phone}` : 'No phone provided'}
${data.whatsapp ? `WhatsApp: ${data.whatsapp}` : 'No WhatsApp configured'}
${socialText ? `Social: ${socialText}` : ''}

''

═══════════════════════════════════════════════════════════
CRO (CONVERSION RATE OPTIMIZATION) — MANDATORY REQUIREMENTS
═══════════════════════════════════════════════════════════

These rules are NON-NEGOTIABLE. Apply them to EVERY page generated.

ABOVE THE FOLD:
- The hero MUST contain a single, dominant primary CTA button above the fold.
- The headline must state the PRIMARY benefit in under 10 words. No vague taglines.
- Add at least one trust signal inside the hero (stars, count, logo, guarantee badge).

CTA RULES:
- Each section may have AT MOST ONE primary action (primary-colored button).
- Every CTA button label must be action-oriented and specific ("Get My Free Quote", "Start Free Trial", "Book a Call") — NEVER "Click Here", "Submit", or "Learn More" as a primary CTA.
- Place a CTA within the first screenful AND again at the end of the page.

COPY HIERARCHY (apply to every section):
- Lead with BENEFITS, not features. Explain WHAT the user gains before HOW it works.
- Use proof-first framing: claims must be backed by numbers, credentials, or testimonials.
- Form fields MUST have placeholder text and labels. Minimize friction (max 4 fields by default unless formFields are explicitly specified).

SOCIAL PROOF POSITIONING:
- At least one social-proof element (testimonial, stat, logo bar, rating) MUST appear BEFORE the final CTA section.
- If testimonials are enabled: include star ratings, full name, photo placeholder, and a quoted result ("I went from X to Y in Z days").

URGENCY & SCARCITY (apply based on urgencyLevel setting):
- If urgencyLevel is "medium" or higher: add at least one urgency micro-copy element ("Limited availability", "Booking fast") near the primary CTA.
- If urgencyLevel is "high" or "urgent": add a countdown element and scarcity badge.

FORM OPTIMIZATION:
- Lead forms must have a value-exchange headline ("Get Your Free [X]" or "Claim Your Spot").
- Required fields should use visual asterisk (*) or "(required)" suffix.
- Submit button must be full-width and high-contrast with a specific label (not "Submit").

DESIGN CONTRAST:
- Primary CTA button must have a luminance contrast ratio ≥ 4.5:1 against its background.
- Section backgrounds must alternate (e.g., light, dark, light) to create visual rhythm.
`;
}

function slugifyImageName(name: string): string {
  return (name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 28).replace(/-+$/, '')) || 'image';
}

// Maps each of the 3 section image slots to the corresponding enabled section name/fileStem.
function buildSectionImageSlots(data: BusinessFormData): { name: string; fileStem: string }[] {
  const pages = data.pagesConfig?.pages || [];
  const sections = pages.filter(p => p.enabled && resolveSectionKind(p.name) !== null);
  const defaults = ['section-1', 'section-2', 'section-3'];
  return [0, 1, 2].map(i => {
    const sec = sections[i];
    return sec
      ? { name: sec.name, fileStem: slugifyImageName(sec.name) + '-image' }
      : { name: `Section ${i + 1}`, fileStem: defaults[i] + '-image' };
  });
}

function buildMandatorySections(data: BusinessFormData): Array<{ name: string; kind: string; required: boolean; description: string; embedCode?: string; formAction?: string; formButton?: string; formFields?: Array<{ label: string; type: string; placeholder?: string; required?: boolean }> }> {
  const cfg = data.pagesConfig;
  if (!cfg || !Array.isArray(cfg.pages)) return [];

  return cfg.pages
    .filter(p => p.enabled)
    .map(p => {
      // Explicit kind override takes priority over name-based resolution
      let kind: string | null;
      if (p.kind === 'form') {
        kind = 'form';
      } else {
        kind = resolveSectionKind(p.name);
      }
      if (kind === null) return null; // hero and faq go to dedicated plan fields; all other kinds (including embed without embedCode) pass as sections
      const directives = [
        p.description,
        p.kind === 'form' && p.formAction ? `FORM_ACTION: ${p.formAction}` : '',
        p.kind === 'form' && p.formButton ? `FORM_BUTTON: ${p.formButton}` : '',
        p.kind === 'form' && p.formFields?.length ? `FORM_FIELDS: ${p.formFields.map(f => `${f.label}(${f.type}${f.required ? ',required' : ''})`).join(', ')}` : '',
        ...p.sections.map(s => [s.title, s.description].filter(Boolean).join(': ')),
      ].filter(Boolean).join('; ');
      return {
        name: p.name,
        kind,
        required: p.required,
        description: directives,
        formAction: (p.kind === 'form' ? p.formAction || '' : undefined),
        formButton: (p.kind === 'form' ? p.formButton || '' : undefined),
        formFields: (p.kind === 'form' && p.formFields?.length ? p.formFields : undefined),
      };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);
}

// Maps user-facing section names to generate-landing plan kinds.
// Hero and FAQ are excluded from sections[] (they have dedicated schema fields).
const SECTION_KIND_MAP: Record<string, string> = {
  'hero': '',          // → plan.hero (rendered separately)
  'hero section': '',
  'hero principal': '',
  'secao hero': '',
  'seção hero': '',
  'faq': '',           // → plan.faq[] (accordion, rendered separately)
  'perguntas frequentes': '',
  'duvidas frequentes': '',
  'dúvidas frequentes': '',
  'benefits': 'benefits',
  'beneficios': 'benefits',
  'benefícios': 'benefits',
  'features': 'benefits',
  'solution': 'benefits',
  'how it works': 'steps',
  'como funciona': 'steps',
  'how it works (steps)': 'steps',
  'steps': 'steps',
  'passos': 'steps',
  'etapas': 'steps',
  'process': 'steps',
  'processo': 'steps',
  'services': 'services',
  'servicos': 'services',
  'serviços': 'services',
  'offers': 'services',
  'ofertas': 'services',
  'pricing': 'services',
  'precos': 'services',
  'preços': 'services',
  'products': 'services',
  'produtos': 'services',
  'product showcase': 'services',
  'testimonials': 'proof',
  'depoimentos': 'proof',
  'social proof': 'proof',
  'prova social': 'proof',
  'reviews': 'proof',
  'avaliacoes': 'proof',
  'avaliações': 'proof',
  'trust': 'proof',
  'confianca': 'proof',
  'confiança': 'proof',
  'results': 'results',
  'resultados': 'results',
  'case studies': 'results',
  'estudos de caso': 'results',
  'metrics': 'results',
  'metricas': 'results',
  'métricas': 'results',
  'numbers': 'results',
  'numeros': 'results',
  'números': 'results',
  'about': 'story',
  'sobre': 'story',
  'quem somos': 'story',
  'our story': 'story',
  'team': 'story',
  'time': 'story',
  'problem': 'story',
  'problema': 'story',
  'speakers': 'story',
  'palestrantes': 'story',
  'event details': 'story',
  'detalhes do evento': 'story',
  'cta': 'cta',
  'contact': 'cta',
  'contato': 'cta',
  'contact form': 'form',
  'formulario de contato': 'form',
  'formulário de contato': 'form',
  'lead form': 'form',
  'formulario de lead': 'form',
  'formulário de lead': 'form',
  'registration form': 'form',
  'formulario de cadastro': 'form',
  'formulário de cadastro': 'form',
  'form': 'form',
  'subscribe form': 'form',
  'signup form': 'form',
  'newsletter form': 'form',
  'newsletter': 'form',
  'cadastro newsletter': 'form',
  'embed': 'embed',
  'incorporado': 'embed',
  'embedded content': 'embed',
  'calculator': 'embed',
  'calculadora': 'embed',
  'map': 'embed',
  'mapa': 'embed',
  'video': 'embed',
  'vídeo': 'embed',
  'iframe': 'embed',
  'calendar': 'embed',
  'calendario': 'embed',
  'calendário': 'embed',
  'booking widget': 'embed',
  'widget de agendamento': 'embed',
  'scheduling': 'embed',
  'agendamento': 'embed',
  'countdown': 'cta',
  'contagem regressiva': 'cta',
  'countdown timer': 'cta',
  'download buttons': 'cta',
  'botoes de download': 'cta',
  'botões de download': 'cta',
  'app screenshots': 'benefits',
  'gallery': 'benefits',
  'galeria': 'benefits',
};

function resolveSectionKind(name: string): string | null {
  const key = name.toLowerCase().trim();
  if (key in SECTION_KIND_MAP) return SECTION_KIND_MAP[key] || null;
  if (/\bhero\b|secao hero|seção hero/.test(key)) return null;
  if (/\bfaq\b|perguntas frequentes|duvidas frequentes|dúvidas frequentes/.test(key)) return null;
  // Fuzzy fallback for unknown names
  if (/proof|testimon|review|trust|client|depoiment|prova social|avaliac|avaliaç|confianc|confianç/.test(key)) return 'proof';
  if (/benefit|feature|solution|why|benefici|benefíci|galeria/.test(key)) return 'benefits';
  if (/step|process|how|work|passo|etapa|processo|como funciona/.test(key)) return 'steps';
  if (/service|offer|product|pric|servic|serviç|oferta|produto|preco|preço/.test(key)) return 'services';
  if (/result|metric|number|stat|resultado|metrica|métrica|numero|número/.test(key)) return 'results';
  if (/about|story|team|who|sobre|quem somos|time/.test(key)) return 'story';
  if (/embed|iframe|calculat|^map$|video|agenda|booking|widget/.test(key)) return 'embed';
  if (/\bform\b|lead.form|contact.form|registr|cadastr|newsletter|subscribe|formulario|formulário/.test(key)) return 'form';
  if (/cta|download|schedule|countdown|contagem regressiva|agendamento|contato/.test(key)) return 'cta';
  return 'benefits'; // safe default
}

function generatePagesSection(data: BusinessFormData): string {
  const config = data.pagesConfig || { mode: 'manual', aiSummary: '', pages: [] };
  const aiSummary = typeof config.aiSummary === 'string' ? config.aiSummary.trim() : '';

  if (config.mode === 'ai' && aiSummary) {
    return `⚠️  MANDATORY SECTION REQUIREMENT (AI SUMMARY MODE)
The sections described below are a CONTRACT and MUST be respected exactly.
Generate sections that precisely and completely fulfill this description, in the implied order.
This is NOT optional — treat it as the architectural blueprint for the page.

"${aiSummary}"`;
  }

  const enabledPages = (config.pages || []).filter(p => p.enabled);

  if (enabledPages.length === 0) {
    return `No custom sections configured. Use this optimized conversion arc:
SECTION 1 [REQUIRED]: Hero — Bold outcome-first headline (≤12 words), specific subtitle, primary CTA above the fold + secondary CTA
SECTION 2 [REQUIRED]: Benefits — Use items[] with 4–6 named benefits; title = punchy 2–4 word label, description = one concrete outcome sentence
SECTION 3: How It Works — 3–5 steps using items[]; each step.title = action phrase, step.description = what the user gets after that step
SECTION 4 [REQUIRED]: Social Proof — Testimonials using items[]; each quote must reference a specific outcome or result, not generic praise
SECTION 5: Results / Metrics — Use items[]; item.title = a number or stat, item.description = context that makes it credible
SECTION 6: FAQ — 4–6 buyer-objection Q&As. Populate plan.faq[]. Questions should address price, timeline, risk, support, and alternatives.
SECTION 7 [REQUIRED]: Final CTA — Closing section with urgency copy, a specific CTA label, and a brief reassurance line`;
  }

  const heroItem = enabledPages.find(p => p.name.toLowerCase().trim() === 'hero');
  const faqItem = enabledPages.find(p => p.name.toLowerCase().trim() === 'faq');
  const sectionItems = enabledPages.filter(p => {
    const kind = resolveSectionKind(p.name);
    return kind !== null; // exclude hero and faq (rendered by their dedicated schema fields)
  });

  const requiredList = enabledPages.filter(p => p.required).map(p => `"${p.name}"`).join(', ');

  let result = `⚠️  MANDATORY SECTION CONTRACT — MUST BE RESPECTED EXACTLY
═══════════════════════════════════════════════════════════
BINDING RULES:
  • ALL listed sections MUST appear in this EXACT ORDER — no exceptions.
  • Sections marked [REQUIRED] MUST always be present, even if content is sparse.
  • Do NOT add, remove, reorder, or rename sections.
  • Each section's content directive defines what copy and items it must contain.
  • Map each section to the specified kind value exactly.
═══════════════════════════════════════════════════════════\n\n`;

  if (heroItem) {
    result += `HERO [REQUIRED] → populates plan.hero\n`;
    result += `  Name: "${heroItem.name}"\n`;
    if (heroItem.description) result += `  Content intent (generate hero copy fulfilling this — do NOT copy verbatim): ${heroItem.description}\n`;
    heroItem.sections.forEach(s => {
      if (s.title || s.description) result += `  • ${s.title || 'Item'}${s.description ? ': ' + s.description : ''}\n`;
    });
    result += '\n';
  }

  if (sectionItems.length > 0) {
    result += `SECTIONS ARRAY (populate plan.sections[] in this exact order):\n`;
    sectionItems.forEach((page, i) => {
      const kind = resolveSectionKind(page.name) ?? 'benefits';
      result += `\n  SECTION ${i + 1}${page.required ? ' [REQUIRED]' : ' [ENABLED]'}: "${page.name}"\n`;
      result += `    → kind: "${kind}"\n`;
      if (page.description) result += `    → Content intent (write original marketing copy fulfilling this intent — do NOT copy this text verbatim): ${page.description}\n`;
      if (page.sections.length > 0) {
        result += `    → Item seeds (base items[]/bullets[] on these — write proper marketing copy, do not copy raw text as-is):\n`;
        page.sections.forEach(s => {
          if (s.title || s.description) result += `       • ${s.title || 'Item'}${s.description ? ': ' + s.description : ''}\n`;
        });
      }
    });
    result += '\n';
  }

  if (faqItem) {
    result += `FAQ → populates plan.faq[] (rendered as dedicated accordion):\n`;
    result += `  Name: "${faqItem.name}"${faqItem.required ? ' [REQUIRED]' : ''}\n`;
    if (faqItem.description) result += `  Content intent: ${faqItem.description}\n`;
    result += `  → Generate relevant Q&A pairs and place them in the "faq" array.\n\n`;
  }

  result += `FINAL CTA [REQUIRED] → always populates plan.finalCta with a strong closing call to action.\n`;

  if (requiredList) {
    result += `\nREQUIRED SECTIONS (cannot be omitted): ${requiredList}\n`;
  }

  result += `\nTOTAL: ${enabledPages.length} section(s) configured (${enabledPages.filter(p => p.required).length} required, ${enabledPages.filter(p => !p.required && p.enabled).length} optional-but-enabled).`;

  return result.trim();
}

export default Index;
