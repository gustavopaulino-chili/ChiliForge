import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { AdsEditor, stripEditorBridge } from '@/components/editor/AdsEditor';
import { getAdCreative, getProjectById, updateAdCampaignBoard, updateAdCreativeContent } from '@/services/api';
import { toast } from 'sonner';

type Project = {
  id: number;
  user_id?: number;
  name: string;
  public_url?: string;
  ad_public_url?: string;
  folder_path?: string;
  generated_html?: string;
  project_type?: string;
  form_data?: {
    primaryColor?: string;
    secondaryColor?: string;
    accentColor?: string;
    textColor?: string;
    backgroundColor?: string;
  } | null;
};

type EditorBrandColors = {
  primary?: string;
  secondary?: string;
  accent?: string;
  text?: string;
  background?: string;
};

const normalizeHexColor = (value?: string) => {
  const raw = (value || '').trim();
  const match = raw.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) return '';
  const body = match[1];
  const full = body.length === 3
    ? body.split('').map((char) => char + char).join('')
    : body;
  return `#${full.toLowerCase()}`;
};

const toAbsoluteUrl = (value: string) => {
  try {
    return new URL(value, window.location.origin).toString();
  } catch {
    return value;
  }
};

const fetchTextIfOk = async (url: string) => {
  const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) return '';
  return await response.text();
};

const loadPublishedDocument = async (publicUrl?: string, fallbackHtml?: string) => {
  const base = (publicUrl || '').trim();
  if (!base) return stripEditorBridge(fallbackHtml || '');

  const normalizedBase = base.replace(/\/index\.html$/i, '/').replace(/\/?$/, '/');
  const cacheBustedIndexUrl = toAbsoluteUrl(`${normalizedBase}index.html?cf_ads_editor_ts=${Date.now()}`);
  const indexHtml = await fetchTextIfOk(cacheBustedIndexUrl);

  return stripEditorBridge(indexHtml || fallbackHtml || '');
};

export default function AdsEditorPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const user = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem('user') || 'null');
    } catch {
      return null;
    }
  }, []);

  const projectId = Number(params.get('projectId') || 0);
  const creativeId = Number(params.get('creativeId') || 0);
  const isCreativeMode = creativeId > 0;
  const [project, setProject] = useState<Project | null>(null);
  const [html, setHtml] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const [unsaved, setUnsaved] = useState(false);
  const originalHtmlRef = useRef('');

  const hasSameOriginReferrer = () => {
    try {
      if (!document.referrer) return false;
      const referrer = new URL(document.referrer);
      return referrer.origin === window.location.origin && referrer.href !== window.location.href;
    } catch {
      return false;
    }
  };

  const navigateBackSafely = () => {
    if (window.history.length > 1 && hasSameOriginReferrer()) {
      navigate(-1);
      return;
    }
    navigate('/projects');
  };

  useEffect(() => {
    let mounted = true;
    setLoadError(null);

    const run = async () => {
      if (!projectId && !creativeId) {
        setLoadError('No project or creative ID specified.');
        setLoading(false);
        return;
      }
      if (!user?.id) {
        setLoadError('You must be logged in to edit an ad creative.');
        setLoading(false);
        return;
      }

      try {
        if (creativeId) {
          const creative = await getAdCreative(creativeId, user.id);
          if (!mounted) return;

          const finalHtml = await loadPublishedDocument(creative.public_url, creative.html || '');
          if (!mounted) return;

          if (!finalHtml) {
            setLoadError('This creative has no generated HTML yet.');
            setLoading(false);
            return;
          }

          setProject({
            id: creative.project_id,
            user_id: creative.user_id ?? user.id,
            name: creative.name,
            public_url: creative.public_url,
            generated_html: creative.html,
            project_type: 'ad_creative_item',
            form_data: creative.form_data || null,
          });
          setHtml(finalHtml);
          originalHtmlRef.current = finalHtml;
          setUnsaved(false);
          return;
        }

        const found = await getProjectById(projectId, user.id, user.email) as Project | null;
        if (!mounted) return;

        if (!found) {
          setLoadError('Creative not found. It may have been deleted or belong to a different account.');
          setLoading(false);
          return;
        }

        if (found.project_type && !['ad_creative', 'ad_banner', 'project'].includes(found.project_type)) {
          setLoadError('This project is a landing page. Open it in the Visual Editor instead.');
          setLoading(false);
          return;
        }

        const adBoardUrl = found.project_type === 'project' ? (found.ad_public_url || found.public_url) : found.public_url;
        setProject({ ...found, public_url: adBoardUrl });
        const finalHtml = await loadPublishedDocument(adBoardUrl, found.generated_html || '');

        if (!mounted) return;

        if (!finalHtml) {
          setLoadError('This creative has no generated HTML yet. Generate the ad creative first.');
          setLoading(false);
          return;
        }

        setHtml(finalHtml);
        originalHtmlRef.current = finalHtml;
        setUnsaved(false);
      } catch (err) {
        if (mounted) {
          const msg = err instanceof Error ? err.message : 'Unknown error';
          setLoadError(`Failed to load creative: ${msg}`);
          toast.error('Failed to load creative.');
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };

    run();
    return () => { mounted = false; };
  }, [projectId, creativeId, user?.id, user?.email]);

  useEffect(() => {
    if (!originalHtmlRef.current) return;
    setUnsaved(stripEditorBridge(html) !== stripEditorBridge(originalHtmlRef.current));
  }, [html]);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (unsaved) {
        e.preventDefault();
        e.returnValue = '';
        return '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [unsaved]);

  const saveCreative = async () => {
    if (!project?.id || !user?.id) return;
    setSaving(true);
    try {
      if (isCreativeMode) {
        await updateAdCreativeContent({
          id: creativeId,
          user_id: user.id,
          html,
        });
      } else {
        await updateAdCampaignBoard({
          project_id: project.id,
          user_id: project.user_id ?? user.id,
          html,
        });
      }
      originalHtmlRef.current = stripEditorBridge(html);
      setUnsaved(false);
      toast.success('Creative saved!');
    } catch {
      toast.error('Could not save creative.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center gap-3 text-muted-foreground">
        <span className="h-5 w-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
        Loading Ads Editor...
      </div>
    );
  }

  if (loadError || !project || !html) {
    return (
      <div className="min-h-screen bg-background p-6">
        <Button variant="ghost" onClick={navigateBackSafely}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to Projects
        </Button>
        <div className="mt-6 max-w-md">
          <p className="text-sm font-medium text-destructive mb-1">Could not open Ads Editor</p>
          <p className="text-sm text-muted-foreground">
            {loadError || 'This creative does not have generated HTML yet.'}
          </p>
        </div>
      </div>
    );
  }

  const editorBrandColors: EditorBrandColors = {
    primary: normalizeHexColor(project.form_data?.primaryColor),
    secondary: normalizeHexColor(project.form_data?.secondaryColor),
    accent: normalizeHexColor(project.form_data?.accentColor),
    text: normalizeHexColor(project.form_data?.textColor),
    background: normalizeHexColor(project.form_data?.backgroundColor),
  };

  const editorPalette = Object.values(editorBrandColors).filter((value, index, list): value is string => {
    if (!value) return false;
    return list.findIndex((candidate) => candidate === value) === index;
  });

  return (
    <div className="fixed inset-0 flex flex-col bg-background">
      <AlertDialog open={showUnsavedDialog} onOpenChange={setShowUnsavedDialog}>
        <header className="flex-none border-b px-4 py-3 z-10 bg-background">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => {
                if (unsaved) setShowUnsavedDialog(true);
                else navigateBackSafely();
              }}>
                <ArrowLeft className="mr-2 h-4 w-4" /> Back
              </Button>
              <div>
                <p className="text-xs text-muted-foreground">Ads Editor</p>
                <h1 className="text-sm font-semibold">{project.name}</h1>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {unsaved && <span className="text-xs text-yellow-600 font-medium mr-2">Unsaved changes</span>}
              <Button variant="default" size="sm" disabled={!unsaved || saving} onClick={saveCreative}>
                Save Changes
              </Button>
              {project.public_url && (
                <Button variant="outline" size="sm" onClick={() => window.open(project.public_url, '_blank', 'noopener,noreferrer')}>
                  <ExternalLink className="mr-2 h-4 w-4" /> Open Creative
                </Button>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 relative overflow-hidden">
          <AdsEditor
            html={html}
            onChange={setHtml}
            saving={saving}
            projectId={project.id}
            userId={project.user_id ?? user?.id}
            projectPublicUrl={project.public_url || ''}
            brandPalette={editorPalette}
            brandColors={editorBrandColors}
            layout="overlay"
          />
        </main>

        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>You have unsaved changes</AlertDialogTitle>
            <AlertDialogDescription>
              Save your creative to keep your changes, or discard to revert to the last saved version.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => {
              setHtml(originalHtmlRef.current);
              setUnsaved(false);
              setShowUnsavedDialog(false);
              toast.info('Changes discarded.');
              navigateBackSafely();
            }}>
              Discard Changes
            </AlertDialogCancel>
            <AlertDialogAction onClick={async () => {
              await saveCreative();
              setShowUnsavedDialog(false);
              navigateBackSafely();
            }}>
              Save Creative
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
