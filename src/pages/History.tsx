import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, ChevronDown, Edit3, ExternalLink, Eye, FileText, FolderInput, FolderOpen, Loader2, Megaphone, Plus, RotateCcw, Trash2 } from "lucide-react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { deleteAdCreative, getAdCreatives, getProjects, moveProjectToCompany } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { companyToAdForm, companyToLandingForm, normalizeCompanyProjectFormData } from "@/types/projectContext";

type Project = {
  id: number;
  user_id?: number;
  name: string;
  public_url?: string;
  project_public_url?: string;
  lp_public_url?: string;
  ad_public_url?: string;
  folder_path?: string;
  form_data: any;
  generated_html?: string;
  has_generated_html?: boolean;
  currentStep?: number;
  created_at: string;
  project_type?: string;
  company_form_data?: any;
  context?: string;
  company_project_id?: number | null;
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
  const location = useLocation();
  const { user, loading: authLoading } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [restoringId, setRestoringId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [expandedCampaigns, setExpandedCampaigns] = useState<Set<number>>(new Set());
  const [expandedCompanies, setExpandedCompanies] = useState<Set<number>>(new Set());
  const [campaignCreatives, setCampaignCreatives] = useState<Record<number, AdCreativeItem[]>>({});
  const [loadingCreativesId, setLoadingCreativesId] = useState<number | null>(null);
  const [deletingCreativeId, setDeletingCreativeId] = useState<number | null>(null);
  const [projectToMove, setProjectToMove] = useState<Project | null>(null);
  const [movingId, setMovingId] = useState<number | null>(null);

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

        const restoredLpFormData = saved.form_data || project.form_data;
        navigate("/", {
          state: {
            formData: restoredLpFormData,
            currentStep: project.currentStep ?? 0,
            savedProjectId: saved.id,
            projectOwnerId: user.id,
            projectPublicUrl: saved.public_url || project.public_url || "",
            folderPath: saved.folder_path || project.folder_path || "",
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
            projectPublicUrl: project.public_url || "",
            folderPath: project.folder_path || "",
          },
        });
      }
    } catch {
      toast.error("Failed to create new project. Please try again.");
    } finally {
      setRestoringId(null);
    }
  };

  const isBusy = (id: number) => restoringId === id || deletingId === id || movingId === id;
  const companyProjects = projects.filter(p => p.project_type === 'project');

  const isAdCampaign = (project: Project) => project.project_type === "ad_creative";
  const isCompanyProject = (project: Project) => project.project_type === "project";
  const isIndividualAdCreative = (project: Project) =>
    project.project_type === "ad_banner" || project.project_type === "ad_creative_item";
  const hasContent = (project: Project) =>
    isCompanyProject(project)
      ? Boolean((project.lp_public_url || project.ad_public_url || "").trim())
      : Boolean((project.public_url || "").trim());

  const openPublishedUrl = (url?: string) => {
    const target = (url || "").trim();
    if (!target) {
      toast.error("This item does not have a published URL yet.");
      return;
    }
    window.open(target, "_blank", "noopener,noreferrer");
  };

  const continueCompanyProject = (project: Project, target: "lp" | "ads") => {
    const company = normalizeCompanyProjectFormData(project.company_form_data || project.form_data || {});
    if (target === "lp") {
      navigate("/", {
        state: {
          formData: companyToLandingForm(company),
          currentStep: 0,
          projectOwnerId: project.user_id ?? user?.id,
          companyProjectId: project.id,
        },
      });
      return;
    }

    navigate("/ad-creatives", {
      state: {
        formData: companyToAdForm(company),
        currentStep: 0,
        companyProjectId: project.id,
      },
    });
  };

  const handleViewProject = async (project: Project) => {
    if (isCompanyProject(project)) {
      if (project.lp_public_url) {
        openPublishedUrl(project.lp_public_url);
      } else if (project.ad_public_url) {
        openPublishedUrl(project.ad_public_url);
      } else {
        toast.error("This project does not have generated LPs or Ads yet.");
      }
      return;
    }

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

  const handleMoveToCompany = async (companyId: number) => {
    if (!user?.id || !projectToMove) return;

    const targetProject = projectToMove;
    setMovingId(targetProject.id);
    try {
      const result = await moveProjectToCompany({
        project_id: targetProject.id,
        user_id: targetProject.user_id ?? user.id,
        company_project_id: companyId,
      });

      setProjects((prev) => prev.map((project) => project.id === targetProject.id
        ? {
            ...project,
            company_project_id: companyId,
            public_url: result.public_url ?? project.public_url,
            folder_path: result.folder_path ?? project.folder_path,
          }
        : project
      ));
      setProjectToMove(null);
      toast.success("Project moved to company folder");
      fetchProjects().catch(() => {});
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not move project.");
    } finally {
      setMovingId(null);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b px-6 py-4 flex items-center justify-between">
        <Button variant="ghost" onClick={() => navigate("/")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <div className="flex items-center gap-3">
          <h1 className="font-bold">Projects</h1>
          <Button size="sm" onClick={() => navigate("/projects/new")} className="gap-2">
            <FolderOpen className="h-4 w-4" /> New Project
          </Button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-6">
        <Tabs defaultValue={location.pathname === "/history" ? "history" : "projects"}>
          <TabsList className="mb-6">
            <TabsTrigger value="projects">Projects</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>

          <TabsContent value="history">
            {loading ? (
              <div className="flex items-center gap-2 text-muted-foreground py-8">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Loading...</span>
              </div>
            ) : (() => {
              const historyItems = projects.filter(p => p.project_type !== 'project');
              if (historyItems.length === 0) return <p className="text-muted-foreground py-8">No projects found.</p>;
              return (
                <div className="space-y-2">
                  {historyItems.map((project) => {
                    const canView = hasContent(project);
                    const adCampaign = isAdCampaign(project);
                    const formattedDate = new Date(project.created_at).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });
                    return (
                      <div key={project.id} className="flex items-center justify-between border rounded-lg px-4 py-2.5 gap-3 hover:bg-muted/30 transition-colors">
                        <div className="flex items-center gap-2 min-w-0">
                          {adCampaign ? (
                            <span className="text-xs font-medium px-1.5 py-0.5 rounded shrink-0" style={{ background: 'hsl(265 85% 65% / 0.15)', color: 'hsl(265 85% 72%)', border: '1px solid hsl(265 85% 65% / 0.3)' }}>Ads</span>
                          ) : (
                            <span className="text-xs font-medium px-1.5 py-0.5 rounded shrink-0" style={{ background: 'hsl(359 100% 60% / 0.12)', color: 'hsl(359 100% 68%)', border: '1px solid hsl(359 100% 60% / 0.3)' }}>LP</span>
                          )}
                          <span className="font-medium truncate text-sm">{project.name || "Untitled"}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs text-muted-foreground hidden sm:block">{formattedDate}</span>
                          <Button size="icon" variant="ghost" className="h-7 w-7" disabled={!canView} onClick={() => handleViewProject(project)} title="Open">
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                          {!adCampaign && (
                            <Button size="icon" variant="ghost" className="h-7 w-7" disabled={!canView} onClick={() => navigate(`/visual-editor?projectId=${project.id}`)} title="Edit">
                              <Edit3 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleRestoreForm(project)} title="Restore">
                            {restoringId === project.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7" disabled={companyProjects.length === 0 || movingId === project.id} onClick={() => setProjectToMove(project)} title="Move to company">
                            {movingId === project.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderInput className="h-3.5 w-3.5" />}
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => setProjectToDelete(project)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </TabsContent>

          <TabsContent value="projects">
            {loading ? (
              <div className="flex items-center gap-2 text-muted-foreground py-8">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Loading projects...</span>
              </div>
            ) : (() => {
              const childrenByCompany = projects.reduce<Record<number, Project[]>>((acc, p) => {
                if (p.company_project_id) {
                  acc[p.company_project_id] = [...(acc[p.company_project_id] || []), p];
                }
                return acc;
              }, {});
              const standaloneProjects = projects.filter(p => p.project_type !== 'project' && !p.company_project_id);

              if (companyProjects.length === 0 && standaloneProjects.length === 0) {
                return (
                  <div className="text-center py-14 space-y-4">
                    <p className="text-muted-foreground">No projects yet.</p>
                    <div className="flex gap-3 justify-center flex-wrap">
                      <Button onClick={() => navigate('/projects/new')}>New Company</Button>
                      <Button variant="outline" onClick={() => navigate('/')}>New Landing Page</Button>
                    </div>
                  </div>
                );
              }

              return (
                <div className="space-y-10">

                  {/* ── Companies grid ── */}
                  <section>
                    <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">Companies</p>
                    <div className="grid sm:grid-cols-2 gap-3">
                      {companyProjects.map((company) => {
                        const fd = normalizeCompanyProjectFormData(company.company_form_data || company.form_data || {});
                        const kids = childrenByCompany[company.id] || [];
                        const lpCount = kids.filter(k => k.project_type === 'landing_page').length;
                        const adsCount = kids.filter(k => k.project_type === 'ad_creative').length;
                        const busy = isBusy(company.id);
                        const primaryColor = fd.primaryColor || '';
                        const logoUrl = fd.images?.logoUrl || '';
                        return (
                          <div key={company.id} className="border rounded-xl overflow-hidden hover:border-primary/40 transition-all">
                            {/* Top: avatar/logo + name + delete */}
                            <button
                              className="w-full px-4 pt-4 pb-3 flex items-center gap-3 text-left hover:bg-muted/20 transition-colors"
                              onClick={() => navigate(`/projects/${company.id}`)}
                            >
                              <div
                                className="h-11 w-11 rounded-xl flex items-center justify-center text-white font-bold text-lg shrink-0 overflow-hidden"
                                style={{ background: primaryColor || 'hsl(var(--primary))' }}
                              >
                                {logoUrl
                                  ? <img src={logoUrl} alt="logo" className="h-full w-full object-contain" />
                                  : (company.name || '?')[0].toUpperCase()
                                }
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="font-semibold text-sm truncate group-hover:text-primary transition-colors">
                                  {company.name || 'Unnamed'}
                                </p>
                                <p className="text-xs text-muted-foreground truncate">
                                  {fd.businessCategory || formatProjectDate(company.created_at)}
                                </p>
                              </div>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                disabled={busy}
                                onClick={(e) => { e.stopPropagation(); setProjectToDelete(company); }}
                              >
                                {deletingId === company.id
                                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  : <Trash2 className="h-3.5 w-3.5" />
                                }
                              </Button>
                            </button>

                            {/* Middle: stats + colors */}
                            <div className="px-4 pb-3 flex items-center justify-between">
                              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                <span className="flex items-center gap-1">
                                  <FileText className="h-3 w-3" />{lpCount} LP
                                </span>
                                <span className="flex items-center gap-1">
                                  <Megaphone className="h-3 w-3" />{adsCount} Ads
                                </span>
                              </div>
                              <div className="flex gap-1.5">
                                {[fd.primaryColor, fd.secondaryColor, fd.accentColor]
                                  .filter(Boolean)
                                  .map((c, i) => (
                                    <span key={i} className="h-3.5 w-3.5 rounded-full border border-border/50" style={{ background: c }} />
                                  ))}
                              </div>
                            </div>

                            {/* Bottom: Open button */}
                            <div className="px-4 pb-4">
                              <Button
                                variant="outline"
                                size="sm"
                                className="w-full"
                                onClick={() => navigate(`/projects/${company.id}`)}
                              >
                                Open Hub →
                              </Button>
                            </div>
                          </div>
                        );
                      })}

                      <button
                        className="border border-dashed rounded-xl p-4 flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground hover:text-foreground hover:border-primary/40 transition-all min-h-[148px]"
                        onClick={() => navigate('/projects/new')}
                      >
                        <Plus className="h-5 w-5" />
                        New Company
                      </button>
                    </div>
                  </section>

                  {/* ── Standalone projects ── */}
                  {standaloneProjects.length > 0 && (
                    <section>
                      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
                        Standalone Projects
                      </p>
                      <div className="grid gap-4">
                        {standaloneProjects.map((project) => {
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
                                    {adCampaign && <FolderOpen className="h-4 w-4 text-primary shrink-0" />}
                                    <h2 className="font-semibold truncate">{project.name || "Untitled Project"}</h2>
                                    {adCampaign ? (
                                      <span className="text-xs font-medium px-1.5 py-0.5 rounded shrink-0" style={{ background: 'hsl(265 85% 65% / 0.15)', color: 'hsl(265 85% 72%)', border: '1px solid hsl(265 85% 65% / 0.3)' }}>
                                        Ads Campaign
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
                                    <a href={project.public_url} target="_blank" rel="noopener noreferrer"
                                      className="text-xs text-primary hover:underline flex items-center gap-1 mt-1 w-fit"
                                      onClick={(e) => e.stopPropagation()}>
                                      <ExternalLink className="h-3 w-3" />{project.public_url}
                                    </a>
                                  )}
                                </div>

                                <div className="flex gap-2 shrink-0">
                                  {adCampaign && (
                                    <Button variant="outline" size="sm" disabled={busy}
                                      title={expanded ? "Hide creatives" : "Open campaign folder"}
                                      onClick={() => toggleCampaignFolder(project)}>
                                      {loadingCreatives
                                        ? <Loader2 className="h-4 w-4 animate-spin" />
                                        : <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />}
                                    </Button>
                                  )}
                                  <Button variant="default" size="sm" disabled={busy || !canView}
                                    title={canView ? (adCampaign ? "Open campaign board" : "Open landing page") : "No published content yet"}
                                    onClick={() => handleViewProject(project)}>
                                    <Eye className="h-4 w-4" />
                                  </Button>
                                  {!adCampaign && (
                                    <Button variant="outline" size="sm" disabled={busy || !canView}
                                      title={canView ? "Open visual editor" : "No generated content yet"}
                                      onClick={() => navigate(`/visual-editor?projectId=${project.id}`)}>
                                      <Edit3 className="h-4 w-4" />
                                    </Button>
                                  )}
                                  {!individualAdCreative && (
                                    <Button variant="outline" size="sm" disabled={busy}
                                      title={adCampaign ? "Restore as new draft" : "Restore as new project"}
                                      onClick={() => handleRestoreForm(project)}>
                                      {restoringId === project.id
                                        ? <Loader2 className="h-4 w-4 animate-spin" />
                                        : <RotateCcw className="h-4 w-4" />}
                                    </Button>
                                  )}
                                  <Button variant="outline" size="sm" disabled={busy || companyProjects.length === 0}
                                    title={companyProjects.length === 0 ? "Create a company first" : "Move to company"}
                                    onClick={() => setProjectToMove(project)}>
                                    <FolderInput className="h-4 w-4" />
                                  </Button>
                                  <Button variant="destructive" size="sm" disabled={busy}
                                    title={adCampaign ? "Delete campaign" : "Delete project"}
                                    onClick={() => setProjectToDelete(project)}>
                                    {deletingId === project.id
                                      ? <Loader2 className="h-4 w-4 animate-spin" />
                                      : <Trash2 className="h-4 w-4" />}
                                  </Button>
                                </div>
                              </div>

                              {adCampaign && expanded && (
                                <div className="border-t bg-muted/20 px-4 py-3">
                                  {loadingCreatives ? (
                                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />Loading creatives...
                                    </div>
                                  ) : creatives.length === 0 ? (
                                    <p className="text-xs text-muted-foreground">No creatives saved for this campaign yet.</p>
                                  ) : (
                                    <div className="space-y-2">
                                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Creatives</p>
                                      {creatives.map((creative) => (
                                        <div key={creative.id} className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-background px-3 py-2">
                                          <div className="min-w-0">
                                            <div className="flex items-center gap-2">
                                              <span className="text-sm font-medium truncate">{creative.label || creative.name || `Creative ${creative.id}`}</span>
                                              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">Creative</span>
                                            </div>
                                            <p className="mt-0.5 text-xs text-muted-foreground">
                                              {[creative.platform, creative.format].filter(Boolean).join(" / ") || "Ad creative"}
                                              {creative.width && creative.height ? ` · ${creative.width}×${creative.height}px` : ""}
                                            </p>
                                          </div>
                                          <div className="flex shrink-0 items-center gap-2">
                                            <Button variant="default" size="sm" title="Open" onClick={() => openPublishedUrl(creative.public_url || creative.url)}>
                                              <Eye className="h-4 w-4" />
                                            </Button>
                                            <Button variant="outline" size="sm" title="Edit" onClick={() => navigate(`/ads-editor?creativeId=${creative.creative_id || creative.id}`)}>
                                              <Edit3 className="h-4 w-4" />
                                            </Button>
                                            <Button variant="destructive" size="sm" title="Delete" disabled={deletingCreativeId === creative.id} onClick={() => handleDeleteCreative(creative)}>
                                              {deletingCreativeId === creative.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
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
                    </section>
                  )}
                </div>
              );
            })()}
          </TabsContent>
        </Tabs>
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

      <Dialog open={Boolean(projectToMove)} onOpenChange={(open) => !open && setProjectToMove(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move project to company</DialogTitle>
            <DialogDescription>
              This moves the project folder on the server and updates the database links.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            {companyProjects.length === 0 ? (
              <p className="text-sm text-muted-foreground">Create a company first to move this project.</p>
            ) : (
              companyProjects.map((company) => {
                const fd = normalizeCompanyProjectFormData(company.company_form_data || company.form_data || {});
                return (
                  <button
                    key={company.id}
                    className="w-full flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2 text-left hover:border-primary/50 hover:bg-muted/30 transition-colors disabled:opacity-60"
                    disabled={movingId === projectToMove?.id}
                    onClick={() => handleMoveToCompany(company.id)}
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-medium truncate">{company.name || "Unnamed company"}</span>
                      <span className="block text-xs text-muted-foreground truncate">{fd.businessCategory || "Company folder"}</span>
                    </span>
                    {movingId === projectToMove?.id ? (
                      <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                    ) : (
                      <FolderInput className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                  </button>
                );
              })
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
