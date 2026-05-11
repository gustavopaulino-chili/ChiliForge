import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Eye, Trash2, RotateCcw, Edit3, Loader2, ExternalLink } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { getProjects } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";

type Project = {
  id: number;
  user_id?: number;
  name: string;
  public_url?: string;
  folder_path?: string;
  form_data: any;
  generated_html?: string;
  has_generated_html?: boolean;
  currentStep?: number;
  created_at: string;
};

const toAbsoluteUrl = (value: string) => {
  try {
    return new URL(value, window.location.origin).toString();
  } catch {
    return value;
  }
};

const loadPublishedHtml = async (publicUrl?: string) => {
  const base = (publicUrl || "").trim();
  if (!base) return "";

  const normalizedBase = base.replace(/\/index\.html$/i, "/").replace(/\/?$/, "/");
  const url = toAbsoluteUrl(`${normalizedBase}index.html?cf_history_ts=${Date.now()}`);
  const response = await fetch(url, { credentials: "same-origin", cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Could not load published HTML (${response.status})`);
  }
  return await response.text();
};

function formatProjectDate(dateStr: string): string {
  if (!dateStr) return "-";
  try {
    // MySQL returns "YYYY-MM-DD HH:MM:SS"; replace space with T for ISO 8601
    // so Safari parses it correctly alongside Chrome/Firefox.
    const date = new Date(dateStr.includes("T") ? dateStr : dateStr.replace(" ", "T"));
    if (isNaN(date.getTime())) return dateStr;
    return date.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return dateStr;
  }
}

export default function History() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [restoringId, setRestoringId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const fetchProjects = async () => {
    const resolvedUserId = Number(user?.id);
    const resolvedUserEmail =
      typeof user?.email === "string" ? user.email.trim().toLowerCase() : "";

    if (!user || !Number.isFinite(resolvedUserId) || resolvedUserId <= 0) {
      setProjects([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const data = await getProjects(resolvedUserId, resolvedUserEmail || undefined);
      setProjects(Array.isArray(data) ? data : []);
    } catch {
      toast.error("Error loading projects");
      setProjects([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (authLoading) return;
    fetchProjects();
  }, [authLoading, user?.id, user?.email]);

  const confirmDelete = async () => {
    if (!projectToDelete || !user?.id) return;

    const target = projectToDelete;
    setProjectToDelete(null);
    setDeletingId(target.id);

    try {
      const response = await fetch("/api/deleteProject.php", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: target.id, user_id: target.user_id ?? user.id }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || data?.error) {
        throw new Error(data?.error || `Delete failed (${response.status})`);
      }

      setProjects((prev) => prev.filter((p) => p.id !== target.id));
      toast.success("Project deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete project");
    } finally {
      setDeletingId(null);
    }
  };

  const handleRestoreForm = async (project: Project) => {
    if (!user?.id) {
      toast.error("You must be logged in to restore a project.");
      return;
    }

    setRestoringId(project.id);

    try {
      const response = await fetch("/api/createProject.php", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: user.id,
          name: (project.form_data?.businessName || project.name || "Draft") + " (Copy)",
          public_url: "",
          folder_path: "",
          form_data: project.form_data || {},
          generated_html: "",
          current_step: project.currentStep ?? 0,
          draft_only: true,
        }),
      });

      const saved = await response.json().catch(() => ({}));

      if (saved?.success && saved?.id) {
        try {
          localStorage.setItem("lastEditedProjectId", String(saved.id));
        } catch {}

        navigate(`/?restoreProjectId=${encodeURIComponent(String(saved.id))}`, {
          state: {
            formData: project.form_data,
            currentStep: project.currentStep ?? 0,
            savedProjectId: saved.id,
            projectOwnerId: user.id,
            folderPath: saved.folder_path || "",
          },
        });
      } else {
        toast.warning("Could not pre-create project. A new one will be created when you generate.");
        navigate("/", {
          state: {
            formData: project.form_data,
            currentStep: project.currentStep ?? 0,
          },
        });
      }
    } catch {
      toast.error("Failed to create new project. Please try again.");
    } finally {
      setRestoringId(null);
    }
  };

  const isBusy = (id: number) => restoringId === id || deletingId === id;

  const hasContent = (project: Project) =>
    Boolean((project.public_url || "").trim());

  const handleViewProject = async (project: Project) => {
    const publishedUrl = (project.public_url || "").trim();
    if (!publishedUrl) {
      toast.error("This project does not have a published folder yet.");
      return;
    }

    try {
      const publishedHtml = await loadPublishedHtml(publishedUrl);
      navigate("/", {
        state: {
          formData: project.form_data,
          currentStep: project.currentStep ?? 0,
          generatedHtml: publishedHtml,
          savedProjectId: project.id,
          projectOwnerId: project.user_id,
          generatedLandingUrl: project.public_url ?? "",
          folderPath: project.folder_path ?? "",
        },
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not open published project.");
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b px-6 py-4 flex items-center justify-between">
        <Button variant="ghost" onClick={() => navigate("/")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <h1 className="font-bold">Your Projects</h1>
      </header>

      <main className="max-w-4xl mx-auto p-6">
        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground py-8">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Loading projects...</span>
          </div>
        ) : projects.length === 0 ? (
          <p className="text-muted-foreground py-8">No projects found.</p>
        ) : (
          <div className="grid gap-4">
            {projects.map((project) => {
              const busy = isBusy(project.id);
              const canView = hasContent(project);

              return (
                <div
                  key={project.id}
                  className="border rounded-lg p-4 flex items-center justify-between gap-4"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="font-semibold truncate">
                        {project.name || "Untitled Project"}
                      </h2>
                      {project.public_url || project.has_generated_html || project.generated_html ? (
                        <span className="text-xs font-medium text-green-600 bg-green-50 border border-green-200 rounded px-1.5 py-0.5 shrink-0">
                          Published
                        </span>
                      ) : project.form_data && Object.keys(project.form_data).length > 0 ? (
                        <span className="text-xs font-medium text-muted-foreground bg-muted border border-border/60 rounded px-1.5 py-0.5 shrink-0">
                          Draft
                        </span>
                      ) : null}
                    </div>

                    <p className="text-xs text-muted-foreground mt-0.5">
                      {formatProjectDate(project.created_at)}
                    </p>

                    {project.public_url && (
                      <a
                        href={project.public_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-primary hover:underline flex items-center gap-1 mt-1 w-fit"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <ExternalLink className="h-3 w-3" />
                        {project.public_url}
                      </a>
                    )}
                  </div>

                  <div className="flex gap-2 shrink-0">
                    {/* View generated site in wizard */}
                    <Button
                      variant="default"
                      size="sm"
                      disabled={busy || !canView}
                      title={canView ? "Open generated site" : "No generated site yet"}
                      onClick={() => handleViewProject(project)}
                    >
                      <Eye className="h-4 w-4" />
                    </Button>

                    {/* Open Visual Editor */}
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy || !canView}
                      title={canView ? "Open visual editor" : "No generated site yet"}
                      onClick={() => navigate(`/visual-editor?projectId=${project.id}`)}
                    >
                      <Edit3 className="h-4 w-4" />
                    </Button>

                    {/* Restore form as NEW project */}
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      title="Restore form as a new project (original is kept)"
                      onClick={() => handleRestoreForm(project)}
                    >
                      {restoringId === project.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RotateCcw className="h-4 w-4" />
                      )}
                    </Button>

                    {/* Delete */}
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={busy}
                      onClick={() => setProjectToDelete(project)}
                    >
                      {deletingId === project.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      <AlertDialog
        open={Boolean(projectToDelete)}
        onOpenChange={(open) => !open && setProjectToDelete(null)}
      >
        <AlertDialogContent className="border-border/60 bg-background/95 backdrop-blur-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Project</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove{" "}
              <strong>{projectToDelete?.name}</strong>, including the hosted
              Forge site and saved history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="rounded-lg border border-border/60 bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
            Forge will remove the published files and this action cannot be
            undone.
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Project</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmDelete}
            >
              Delete from Forge
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
