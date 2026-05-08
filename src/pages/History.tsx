import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Eye, Trash2, RotateCcw, Edit3, Loader2 } from "lucide-react";
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
  name: string;
  public_url?: string;
  folder_path?: string;
  form_data: any;
  generated_html?: string;
  currentStep?: number;
  created_at: string;
};

export default function History() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [restoringId, setRestoringId] = useState<number | null>(null);

  const fetchProjects = async () => {
    const resolvedUserId = Number(user?.id);
    const resolvedUserEmail = typeof user?.email === 'string' ? user.email.trim().toLowerCase() : '';

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

  const deleteProject = async (id: number) => {
    try {
      await fetch("/api/deleteProject.php", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      setProjects(prev => prev.filter(p => p.id !== id));
      setProjectToDelete(null);
      toast.success("Project deleted");
    } catch {
      toast.error("Failed to delete project");
    }
  };

  // Creates a brand-new draft project in the DB, then navigates to the wizard
  // pre-filled with the original project's form data. The original project is
  // never touched because the new project has its own ID and folder.
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
        }),
      });

      const saved = await response.json();

      if (saved?.success && saved?.id) {
        // Navigate with the NEW project ID — the original is untouched.
        navigate("/", {
          state: {
            formData: project.form_data,
            currentStep: project.currentStep ?? 0,
            savedProjectId: saved.id,
            folderPath: saved.folder_path || "",
          },
        });
      } else {
        // API returned an error — still navigate but without a project ID so
        // the wizard will create a fresh draft automatically on load.
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
          <p>Loading…</p>
        ) : projects.length === 0 ? (
          <p className="text-muted-foreground">No projects found.</p>
        ) : (
          <div className="grid gap-4">
            {projects.map(project => (
              <div
                key={project.id}
                className="border rounded-lg p-4 flex items-center justify-between gap-4"
              >
                <div className="min-w-0">
                  <h2 className="font-semibold truncate">{project.name}</h2>
                  <p className="text-xs text-muted-foreground">
                    {new Date(project.created_at).toLocaleString()}
                  </p>
                  {project.generated_html && (
                    <p className="text-xs text-green-600 mt-1">✓ Generated site saved</p>
                  )}
                </div>

                <div className="flex gap-2 shrink-0">
                  {/* View generated site */}
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => {
                      navigate("/", {
                        state: {
                          formData: project.form_data,
                          currentStep: project.currentStep ?? 0,
                          generatedHtml: project.generated_html ?? "",
                          savedProjectId: project.id,
                          generatedLandingUrl: project.public_url ?? "",
                          folderPath: project.folder_path ?? "",
                        },
                      });
                    }}
                    title="Open generated site"
                  >
                    <Eye className="h-4 w-4" />
                  </Button>

                  {/* Open Visual Editor */}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigate(`/visual-editor?projectId=${project.id}`)}
                    title="Open visual editor"
                    disabled={!project.generated_html && !project.public_url}
                  >
                    <Edit3 className="h-4 w-4" />
                  </Button>

                  {/* Restore form as NEW project */}
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={restoringId === project.id}
                    onClick={() => handleRestoreForm(project)}
                    title="Restore form as a new project (original is kept)"
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
                    onClick={() => setProjectToDelete(project)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      <AlertDialog open={Boolean(projectToDelete)} onOpenChange={(open) => !open && setProjectToDelete(null)}>
        <AlertDialogContent className="border-border/60 bg-background/95 backdrop-blur-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Project</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove <strong>{projectToDelete?.name}</strong>, including the hosted Forge site and saved history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="rounded-lg border border-border/60 bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
            Forge will remove the published files and this action cannot be undone.
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Project</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => projectToDelete && deleteProject(projectToDelete.id)}
            >
              Delete from Forge
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
