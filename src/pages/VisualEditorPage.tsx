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
  const [saving, setSaving] = useState(false);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const [unsaved, setUnsaved] = useState(false);
  const originalHtmlRef = useRef('');

  useEffect(() => {
    let mounted = true;

    const run = async () => {
      if (!user?.id || !projectId) {
        setLoading(false);
        return;
      }
      try {
        const projects = await getProjects(user.id);
        const found = (projects || []).find((item: any) => Number(item.id) === projectId) as Project | undefined;
        if (!mounted) return;
        if (!found) {
          throw new Error('Project not found.');
        }

        setProject(found);

        const mergedHtml = await loadPublishedDocument(found.public_url, found.generated_html || '');
        if (!mounted) return;
        setHtml(mergedHtml || stripEditorBridge(found.generated_html || ''));
        originalHtmlRef.current = mergedHtml || stripEditorBridge(found.generated_html || '');
        setUnsaved(false);
      } catch {
        if (mounted) toast.error('Failed to load project.');
      } finally {
        if (mounted) setLoading(false);
      }
    };

    run();
    return () => {
      mounted = false;
    };
  }, [projectId, user?.id]);

  // Remove autosave to backend. Only save on explicit action.

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
    return <div className="min-h-screen bg-background p-6">Loading visual editor...</div>;
  }

  if (!project || !html) {
    return (
      <div className="min-h-screen bg-background p-6">
        <Button variant="ghost" onClick={() => navigate('/history')}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back
        </Button>
        <p className="mt-4 text-sm text-muted-foreground">This project does not have generated HTML yet.</p>
      </div>
    );
  }

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
                  navigate(-1);
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
                variant="primary"
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
              navigate(-1);
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
                navigate(-1);
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
