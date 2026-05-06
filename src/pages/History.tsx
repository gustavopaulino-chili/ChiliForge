import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Eye, ExternalLink, Trash2, RotateCcw, Edit3 } from "lucide-react";
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
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);

  const user = JSON.parse(localStorage.getItem("user") || "null");

  // fetch projects from MySQL for logged-in users
  const fetchProjects = async () => {
    if (!user) {
      setLoading(false);
      return;
    }

    try {
      const data = await getProjects(user.id, user.email);
      setProjects(data || []);
    } catch (err) {
      toast.error("Error loading projects");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProjects();
  }, []);

  // 🗑 delete project
  const deleteProject = async (id: number) => {
    try {
      await fetch("/api/deleteProject.php", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ id })
      });

      setProjects(prev => prev.filter(p => p.id !== id));
      setProjectToDelete(null);
      toast.success("Project deleted");
    } catch {
      toast.error("Erro ao deletar");
    }
  };

  const handleRestoreForm = (project: Project) => {
    navigate("/", {
      state: {
        formData: project.form_data,
        currentStep: project.currentStep ?? 0,
        savedProjectId: project.id,
        generatedLandingUrl: project.public_url ?? '',
      }
    });
  };

  return (
    <div className="min-h-screen bg-background">
      {/* HEADER */}
      <header className="border-b px-6 py-4 flex items-center justify-between">
        <Button variant="ghost" onClick={() => navigate("/")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>

        <h1 className="font-bold">Your Projects</h1>
      </header>

      {/* CONTENT */}
      <main className="max-w-4xl mx-auto p-6">
        {loading ? (
          <p>Loading...</p>
        ) : projects.length === 0 ? (
          <p className="text-muted-foreground">
            No projects found.
          </p>
        ) : (
          <div className="grid gap-4">
            {projects.map(project => (
              <div
                key={project.id}
                className="border rounded-lg p-4 flex items-center justify-between"
              >
                <div>
                  <h2 className="font-semibold">{project.name}</h2>
                  <p className="text-xs text-muted-foreground">
                    {new Date(project.created_at).toLocaleString()}
                  </p>
                  {project.generated_html && (
                    <p className="text-xs text-green-600 mt-1">✓ Site gerado salvo</p>
                  )}
                </div>

                <div className="flex gap-2">
                  {/* Visualizar site gerado */}
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => {
                      navigate("/", {
                        state: {
                          formData: project.form_data,
                          currentStep: project.currentStep ?? 0,
                          generatedHtml: project.generated_html ?? '',
                          savedProjectId: project.id,
                          generatedLandingUrl: project.public_url ?? '',
                        }
                      });
                    }}
                    title="Restaurar e visualizar site gerado"
                  >
                    <Eye className="h-4 w-4" />
                  </Button>

                  {/* Editar formulário */}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigate(`/visual-editor?projectId=${project.id}`)}
                    title="Abrir editor visual"
                    disabled={!project.generated_html && !project.public_url}
                  >
                    <Edit3 className="h-4 w-4" />
                  </Button>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleRestoreForm(project)}
                    title="Editar formulário e regenerar"
                  >
                    <RotateCcw className="h-4 w-4" />
                  </Button>

                  {/* deletar */}
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