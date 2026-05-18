import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ChevronDown, Edit3, ExternalLink, Eye, FolderOpen, Loader2, RotateCcw, Trash2 } from "lucide-react";
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
import { deleteAdCreative, getAdCreatives, getProjects } from "@/services/api";
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
  project_type?: string;
};

type AdCreativeItem = {
  id: number;
  creative_id: number;
  project_id: number;
  campaign_id: number;
  name: string;
  public_url?: string;
  url?: string;
  platform?: string;
  format?: string;
  label?: string;
  width?: number;
  height?: number;
  sort_order?: number;
  created_at?: string;
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
  const [expandedCampaigns, setExpandedCampaigns] = useState<Set<number>>(new Set());
  const [campaignCreatives, setCampaignCreatives] = useState<Record<number, AdCreativeItem[]>>({});
  const [loadingCreativesId, setLoadingCreativesId] = useState<number | null>(null);
  const [deletingCreativeId, setDeletingCreativeId] = useState<number | null>(null);

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
      setExpandedCampaigns(new Set());
      setCampaignCreatives({});
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
          name: (project.form_data?.brandName || project.form_data?.businessName || project.name || "Draft") + " (Copy)",
          public_url: "",
          folder_path: "",
          form_data: project.form_data || {},
          generated_html: "",
          current_step: project.currentStep ?? 0,
          project_type: project.project_type || "landing_page",
          draft_only: true,
          source_project_id: project.id,
        }),
      });

      const saved = await response.json().catch(() => ({}));

      if (saved?.success && saved?.id) {
        try {
          localStorage.setItem("lastEditedProjectId", String(saved.id));
        } catch {}

        if (project.project_type === "ad_creative") {
          const restoredFormData = saved.form_data || project.form_data;
          navigate("/ad-creatives", {
            state: {
              formData: restoredFormData,
              currentStep: project.currentStep ?? 0,
              savedProjectId: saved.id,
              projectOwnerId: user.id,
              projectPublicUrl: saved.public_url || project.public_url || "",
              folderPath: saved.folder_path || project.folder_path || "",
            },
          });
          return;
        }

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
        if (project.project_type === "ad_creative") {
          navigate("/ad-creatives", {
            state: {
              formData: project.form_data,
              currentStep: project.currentStep ?? 0,
              projectPublicUrl: project.public_url || "",
              folderPath: project.folder_path || "",
            },
          });
          return;
        }
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

  const isAdCampaign = (project: Project) => project.project_type === "ad_creative";
  const isIndividualAdCreative = (project: Project) =>
    project.project_type === "ad_banner" || project.project_type === "ad_creative_item";

  const openPublishedUrl = (url?: string) => {
    const target = (url || "").trim();
    if (!target) {
      toast.error("This item does not have a published URL yet.");
      return;
    }
    window.open(target, "_blank", "noopener,noreferrer");
  };

  const handleViewProject = async (project: Project) => {
    if (isAdCampaign(project)) {
      if (!user?.id) return;
      try {
        const creatives = campaignCreatives[project.id] || await getAdCreatives(project.id, user.id);
        if (!campaignCreatives[project.id]) {
          setCampaignCreatives((prev) => ({ ...prev, [project.id]: creatives }));
        }
        navigate("/ad-creatives", {
          state: {
            formData: project.form_data,
            currentStep: project.currentStep ?? 0,
            savedProjectId: project.id,
            showResults: true,
            generatedPublicUrl: project.public_url || "",
            projectPublicUrl: project.public_url || "",
            folderPath: project.folder_path || "",
            generatedBanners: creatives.map((creative) => ({
              id: creative.id,
              creative_id: creative.creative_id || creative.id,
              campaign_id: creative.campaign_id,
              project_id: creative.project_id,
              url: creative.public_url || creative.url || "",
              platform: creative.platform || "banner",
              format: creative.format || "ad",
              label: creative.label || creative.name || `Creative ${creative.id}`,
              width: creative.width || 1080,
              height: creative.height || 1080,
            })),
          },
        });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not open campaign preview.");
      }
      return;
    }

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

  const toggleCampaignFolder = async (project: Project) => {
    if (!user?.id) return;

    const next = new Set(expandedCampaigns);
    if (next.has(project.id)) {
      next.delete(project.id);
      setExpandedCampaigns(next);
      return;
    }

    next.add(project.id);
    setExpandedCampaigns(next);

    if (campaignCreatives[project.id]) return;

    setLoadingCreativesId(project.id);
    try {
      const creatives = await getAdCreatives(project.id, user.id);
      setCampaignCreatives((prev) => ({ ...prev, [project.id]: creatives }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load ad creatives.");
    } finally {
      setLoadingCreativesId(null);
    }
  };

  const handleDeleteCreative = async (creative: AdCreativeItem) => {
    if (!user?.id) return;

    setDeletingCreativeId(creative.id);
    try {
      await deleteAdCreative({ id: creative.id, user_id: user.id });
      setCampaignCreatives((prev) => ({
        ...prev,
        [creative.project_id]: (prev[creative.project_id] || []).filter((item) => item.id !== creative.id),
      }));
      toast.success("Creative deleted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete creative.");
    } finally {
      setDeletingCreativeId(null);
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
              const adCampaign = isAdCampaign(project);
              const individualAdCreative = isIndividualAdCreative(project);
              const expanded = expandedCampaigns.has(project.id);
              const creatives = campaignCreatives[project.id] || [];
              const loadingCreatives = loadingCreativesId === project.id;

              return (
                <div key={project.id} className="border rounded-lg overflow-hidden">
                  <div className="p-4 flex items-center justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        {adCampaign && (
                          <FolderOpen className="h-4 w-4 text-primary shrink-0" />
                        )}
                        <h2 className="font-semibold truncate">
                          {project.name || "Untitled Project"}
                        </h2>
                        {adCampaign ? (
                          <span className="text-xs font-medium px-1.5 py-0.5 rounded shrink-0" style={{ background: 'hsl(265 85% 65% / 0.15)', color: 'hsl(265 85% 72%)', border: '1px solid hsl(265 85% 65% / 0.3)' }}>
                            Ads Campaign Folder
                          </span>
                        ) : (
                          <span className="text-xs font-medium px-1.5 py-0.5 rounded shrink-0" style={{ background: 'hsl(359 100% 60% / 0.12)', color: 'hsl(359 100% 68%)', border: '1px solid hsl(359 100% 60% / 0.3)' }}>
                            Landing Page
                          </span>
                        )}
                      </div>

                      <p className="text-xs text-muted-foreground mt-0.5">
                        {adCampaign ? "Campaign board" : "Landing page"} · {formatProjectDate(project.created_at)}
                      </p>

                      {project.public_url && !adCampaign && (
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
                      {adCampaign && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          title={expanded ? "Hide creatives" : "Open campaign folder"}
                          onClick={() => toggleCampaignFolder(project)}
                        >
                          {loadingCreatives ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                          )}
                        </Button>
                      )}

                      <Button
                        variant="default"
                        size="sm"
                        disabled={busy || !canView}
                        title={canView ? (adCampaign ? "Open campaign board" : "Open generated landing page") : "No published board yet"}
                        onClick={() => handleViewProject(project)}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>

                      {!adCampaign && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy || !canView}
                          title={canView ? "Open visual editor" : "No generated content yet"}
                          onClick={() => navigate(`/visual-editor?projectId=${project.id}`)}
                        >
                          <Edit3 className="h-4 w-4" />
                        </Button>
                      )}

                      {!individualAdCreative && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          title={adCampaign ? "Restore campaign form as a new draft" : "Restore form as a new project"}
                          onClick={() => handleRestoreForm(project)}
                        >
                          {restoringId === project.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <RotateCcw className="h-4 w-4" />
                          )}
                        </Button>
                      )}

                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={busy}
                        title={adCampaign ? "Delete campaign and creatives" : "Delete project"}
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

                  {adCampaign && expanded && (
                    <div className="border-t bg-muted/20 px-4 py-3">
                      {loadingCreatives ? (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Loading creatives...
                        </div>
                      ) : creatives.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No individual creatives saved for this campaign yet.</p>
                      ) : (
                        <div className="space-y-2">
                          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            Creatives in this campaign
                          </p>
                          {creatives.map((creative) => (
                            <div key={creative.id} className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-background px-3 py-2">
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-medium truncate">{creative.label || creative.name || `Creative ${creative.id}`}</span>
                                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                                    Creative
                                  </span>
                                </div>
                                <p className="mt-0.5 text-xs text-muted-foreground">
                                  {[creative.platform, creative.format].filter(Boolean).join(" / ") || "Ad creative"}
                                  {creative.width && creative.height ? ` · ${creative.width}×${creative.height}px` : ""}
                                </p>
                              </div>
                              <div className="flex shrink-0 items-center gap-2">
                                <Button
                                  variant="default"
                                  size="sm"
                                  title="Open published creative"
                                  onClick={() => openPublishedUrl(creative.public_url || creative.url)}
                                >
                                  <Eye className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  title="Edit creative"
                                  onClick={() => navigate(`/ads-editor?creativeId=${creative.creative_id || creative.id}`)}
                                >
                                  <Edit3 className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  title="Delete only this creative"
                                  disabled={deletingCreativeId === creative.id}
                                  onClick={() => handleDeleteCreative(creative)}
                                >
                                  {deletingCreativeId === creative.id ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <Trash2 className="h-4 w-4" />
                                  )}
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
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
            <AlertDialogTitle>
              Delete {projectToDelete?.project_type === "ad_creative" ? "Campaign" : "Project"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove{" "}
              <strong>{projectToDelete?.name}</strong>, including the hosted
              {projectToDelete?.project_type === "ad_creative"
                ? " board. All creatives inside this campaign folder will be deleted with it."
                : " Forge site and saved history."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="rounded-lg border border-border/60 bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
            {projectToDelete?.project_type === "ad_creative"
              ? "Deleting this campaign also deletes every generated creative linked to it. This action cannot be undone."
              : "Forge will remove the published files and this action cannot be undone."}
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
