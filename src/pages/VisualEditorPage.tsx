import { useEffect, useMemo, useState, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { VisualEditor, stripEditorBridge } from '@/components/editor/VisualEditor';
import { getProjects, updateProjectContent } from '@/services/api';
import { toast } from 'sonner';

type Project = {
  id: number;
  name: string;
  public_url?: string;
  folder_path?: string;
  generated_html?: string;
  form_data?: {
    primaryColor?: string;
    secondaryColor?: string;
    accentColor?: string;
    textColor?: string;
    backgroundColor?: string;
  } | null;
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
  const cacheBustedIndexUrl = toAbsoluteUrl(`${normalizedBase}${normalizedBase.includes('?') ? '&' : '?'}cf_editor_ts=${Date.now()}`);
  const indexHtml = await fetchTextIfOk(cacheBustedIndexUrl);

  return stripEditorBridge(indexHtml || fallbackHtml || '');
};

export default function VisualEditorPage() {
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
  const editorMode = params.get('mode') === 'hosted' ? 'hosted' : 'standard';
  const [project, setProject] = useState<Project | null>(null);
  const [html, setHtml] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const [unsaved, setUnsaved] = useState(false);
  const originalHtmlRef = useRef('');

  const navigateBackSafely = () => {
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }
    navigate('/history');
  };

  useEffect(() => {
    let mounted = true;
    setLoadError(null);

    const run = async () => {
      if (!projectId) {
        setLoadError('No project ID specified.');
        setLoading(false);
        return;
      }
      if (!user?.id) {
        setLoadError('You must be logged in to edit a project.');
        setLoading(false);
        return;
      }

      try {
        const raw = await getProjects(user.id, user.email);
        // getProjects returns an array; guard against error-object responses
        const list: Project[] = Array.isArray(raw) ? raw : [];
        const found = list.find((item) => Number(item.id) === projectId);
        if (!mounted) return;

        if (!found) {
          setLoadError('Project not found. It may have been deleted or belong to a different account.');
          setLoading(false);
          return;
        }

        setProject(found);

        // Try to load HTML: prefer the live published file, fall back to DB column
        const mergedHtml = await loadPublishedDocument(found.public_url, found.generated_html || '');
        const finalHtml = mergedHtml || stripEditorBridge(found.generated_html || '');

        if (!mounted) return;

        if (!finalHtml) {
          setLoadError('This project has no generated HTML yet. Generate the landing page first.');
          setLoading(false);
          return;
        }

        setHtml(finalHtml);
        originalHtmlRef.current = finalHtml;
        setUnsaved(false);
      } catch (err) {
        if (mounted) {
          const msg = err instanceof Error ? err.message : 'Unknown error';
          setLoadError(`Failed to load project: ${msg}`);
          toast.error('Failed to load project.');
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };

    run();
    return () => { mounted = false; };
  }, [projectId, user?.id]);

  // Track unsaved changes
  useEffect(() => {
    if (!originalHtmlRef.current) return;
    setUnsaved(stripEditorBridge(html) !== stripEditorBridge(originalHtmlRef.current));
  }, [html]);

  // Warn on navigation if unsaved
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

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center gap-3 text-muted-foreground">
        <span className="h-5 w-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
        Loading editor…
      </div>
    );
  }

  if (loadError || !project || !html) {
    return (
      <div className="min-h-screen bg-background p-6">
        <Button variant="ghost" onClick={() => navigate('/history')}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to History
        </Button>
        <div className="mt-6 max-w-md">
          <p className="text-sm font-medium text-destructive mb-1">Could not open editor</p>
          <p className="text-sm text-muted-foreground">
            {loadError || 'This project does not have generated HTML yet.'}
          </p>
        </div>
      </div>
    );
  }

  const editorPalette = [
    project?.form_data?.primaryColor,
    project?.form_data?.secondaryColor,
    project?.form_data?.accentColor,
    project?.form_data?.textColor,
    project?.form_data?.backgroundColor,
  ].filter((value, index, list): value is string => {
    if (typeof value !== 'string') return false;
    const color = value.trim();
    if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(color)) return false;
    return list.findIndex((v) => (v || '').toLowerCase() === color.toLowerCase()) === index;
  });

  return (
    <div className="fixed inset-0 flex flex-col bg-background">
      <AlertDialog open={showUnsavedDialog} onOpenChange={setShowUnsavedDialog}>
        <header className="flex-none border-b px-4 py-3 z-10 bg-background">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => {
                if (unsaved) {
                  setShowUnsavedDialog(true);
                } else {
                  navigateBackSafely();
                }
              }}>
                <ArrowLeft className="mr-2 h-4 w-4" /> Back
              </Button>
              <div>
                <p className="text-xs text-muted-foreground">
                  {editorMode === 'hosted' ? 'Hosted Site Visual Editor' : 'Visual Editor'}
                </p>
                <h1 className="text-sm font-semibold">{project.name}</h1>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {unsaved && (
                <span className="text-xs text-yellow-600 font-medium mr-2">Unsaved changes</span>
              )}
              <Button
                variant="default"
                size="sm"
                disabled={!unsaved || saving}
                onClick={async () => {
                  if (!project?.id || !user?.id) return;
                  setSaving(true);
                  try {
                    await updateProjectContent({
                      id: project.id,
                      user_id: user.id,
                      generated_html: html,
                    });
                    originalHtmlRef.current = stripEditorBridge(html);
                    setUnsaved(false);
                    toast.success('Project saved!');
                  } catch {
                    toast.error('Could not save project.');
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                Save Changes
              </Button>
              {project.public_url && (
                <Button variant="outline" size="sm" onClick={() => window.open(project.public_url, '_blank', 'noopener,noreferrer')}>
                  <ExternalLink className="mr-2 h-4 w-4" /> Open Raw Site
                </Button>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 relative overflow-hidden">
          <VisualEditor
            html={html}
            onChange={setHtml}
            saving={saving}
            projectId={project.id}
            userId={user?.id}
            projectPublicUrl={project.public_url || ''}
            brandPalette={editorPalette}
            layout="overlay"
          />
        </main>

        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>You have unsaved changes</AlertDialogTitle>
            <AlertDialogDescription>
              Save your project to keep your changes, or discard to revert to the last saved version.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => {
              // Discard changes
              setHtml(originalHtmlRef.current);
              setUnsaved(false);
              setShowUnsavedDialog(false);
              toast.info('Changes discarded.');
              navigateBackSafely();
            }}>
              Discard Changes
            </AlertDialogCancel>
            <AlertDialogAction onClick={async () => {
              if (!project?.id || !user?.id) return;
              setSaving(true);
              try {
                await updateProjectContent({
                  id: project.id,
                  user_id: user.id,
                  generated_html: html,
                });
                originalHtmlRef.current = stripEditorBridge(html);
                setUnsaved(false);
                setShowUnsavedDialog(false);
                toast.success('Project saved!');
                navigateBackSafely();
              } catch {
                toast.error('Could not save project.');
              } finally {
                setSaving(false);
              }
            }}>
              Save Project
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
