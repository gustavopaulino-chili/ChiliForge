import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Edit3, Save, X, FileText, Megaphone, Plus,
  Eye, ExternalLink, Loader2, Globe, Target, Users, Sparkles,
  Layers, MapPin, Phone, Mail, Building2, RotateCcw, Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PremiumParticleBackground } from '@/components/landing/PremiumParticleBackground';
import { CompanyProjectForm } from '@/components/project/CompanyProjectForm';
import { useAuth } from '@/contexts/AuthContext';
import { createProject, getAdCreatives, getProjectById, getProjects, updateCompanyProject, uploadProjectAssets } from '@/services/api';
import {
  CompanyProjectFormData,
  defaultCompanyProjectFormData,
  normalizeCompanyProjectFormData,
  companyToLandingForm,
  companyToAdForm,
  buildCompanyContext,
} from '@/types/projectContext';
import { toast } from 'sonner';
import '@/components/landing/HeroLanding.css';

type ChildProject = {
  id: number;
  user_id?: number;
  name: string;
  public_url?: string;
  folder_path?: string;
  form_data?: any;
  project_type?: string;
  currentStep?: number;
  current_step?: number;
  created_at: string;
  company_project_id?: number | null;
};

type AdCreativeItem = {
  id: number;
  creative_id?: number;
  project_id: number;
  campaign_id: number;
  public_url?: string;
  url?: string;
  platform?: string;
  format?: string;
  label?: string;
  name?: string;
  width?: number;
  height?: number;
};

function hexToHsl(hex: string): string | null {
  const clean = (hex || '').trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return null;
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '-';
  try {
    const d = new Date(dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T'));
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

const EDIT_SECTIONS = [
  { id: 'basics' as const, label: 'Basics' },
  { id: 'offer' as const, label: 'Offer' },
  { id: 'brand' as const, label: 'Brand' },
  { id: 'contact' as const, label: 'Contact' },
];

export default function CompanyPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const projectId = Number(id);

  const [company, setCompany] = useState<any>(null);
  const [formData, setFormData] = useState<CompanyProjectFormData>(defaultCompanyProjectFormData);
  const [draftForm, setDraftForm] = useState<CompanyProjectFormData>(defaultCompanyProjectFormData);
  const [children, setChildren] = useState<ChildProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editSection, setEditSection] = useState<typeof EDIT_SECTIONS[number]['id']>('basics');
  const [busyChildId, setBusyChildId] = useState<number | null>(null);

  useEffect(() => {
    if (!user?.id || !projectId) return;
    setLoading(true);
    Promise.all([
      getProjectById(projectId, user.id, (user as any).email),
      getProjects(user.id, (user as any).email),
    ])
      .then(([proj, allProjects]) => {
        if (!proj || proj.project_type !== 'project') {
          toast.error('Company not found');
          navigate('/projects');
          return;
        }
        setCompany(proj);
        const normalized = normalizeCompanyProjectFormData(proj.company_form_data || proj.form_data || {});
        setFormData(normalized);
        setDraftForm(normalized);
        const linked = (Array.isArray(allProjects) ? allProjects : []).filter(
          (p: any) => p.company_project_id === projectId,
        );
        setChildren(linked);
      })
      .catch(() => {
        toast.error('Failed to load company');
        navigate('/projects');
      })
      .finally(() => setLoading(false));
  }, [user?.id, projectId]);

  // Inject company brand colors as CSS variables so the whole page (including
  // the particle background, which reads --primary) takes on the brand palette.
  const brandVars = useMemo(() => {
    const primary = hexToHsl(formData.primaryColor);
    const secondary = hexToHsl(formData.secondaryColor || formData.primaryColor);
    return {
      ...(primary ? { '--primary': primary, '--ring': primary } : {}),
      ...(secondary ? { '--accent': secondary } : {}),
    } as React.CSSProperties;
  }, [formData.primaryColor, formData.secondaryColor]);

  const particleColors = useMemo(() => ({
    primary: formData.primaryColor,
    accent: formData.secondaryColor || formData.primaryColor,
  }), [formData.primaryColor, formData.secondaryColor]);

  const lpProjects = children.filter(
    (p) => p.project_type === 'landing_page' || p.project_type === 'lp',
  );
  const adProjects = children.filter((p) => p.project_type === 'ad_creative');

  const startEdit = () => {
    setDraftForm({ ...formData });
    setEditSection('basics');
    setIsEditing(true);
  };

  const cancelEdit = () => {
    setDraftForm({ ...formData });
    setIsEditing(false);
  };

  const saveEdit = async () => {
    if (!user?.id || !company?.id) return;
    setIsSaving(true);
    try {
      const context = buildCompanyContext(draftForm);
      await updateCompanyProject({
        id: company.id,
        user_id: user.id,
        name: draftForm.businessName || company.name,
        company_form_data: draftForm,
        context,
      });
      setFormData({ ...draftForm });
      setIsEditing(false);
      toast.success('Company updated');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setIsSaving(false);
    }
  };

  const handleUploadLogo = async (file: File): Promise<string> => {
    if (!user?.id) throw new Error('Not authenticated');
    const result = await uploadProjectAssets(projectId, user.id, [file]);
    const url = result.uploaded?.[0]?.url;
    if (!url) throw new Error('Logo upload failed');
    setDraftForm(prev => ({ ...prev, images: { ...prev.images, logoUrl: url } }));
    return url;
  };

  const goToLP = () =>
    navigate('/', {
      state: {
        formData: companyToLandingForm(formData),
        currentStep: 0,
        projectOwnerId: user?.id,
        companyProjectId: projectId,
      },
    });

  const goToAds = () =>
    navigate('/ad-creatives', {
      state: {
        formData: companyToAdForm(formData),
        currentStep: 0,
        companyProjectId: projectId,
      },
    });

  const openAdBoard = async (project: ChildProject) => {
    if (!user?.id) return;
    setBusyChildId(project.id);
    try {
      const creatives = await getAdCreatives(project.id, user.id);
      navigate('/ad-creatives', {
        state: {
          formData: project.form_data || {},
          currentStep: project.currentStep ?? project.current_step ?? 0,
          savedProjectId: project.id,
          showResults: true,
          generatedPublicUrl: project.public_url || '',
          projectPublicUrl: project.public_url || '',
          folderPath: project.folder_path || '',
          companyProjectId: projectId,
          generatedBanners: (creatives as AdCreativeItem[]).map((creative) => ({
            id: creative.id,
            creative_id: creative.creative_id || creative.id,
            campaign_id: creative.campaign_id,
            project_id: creative.project_id,
            url: creative.public_url || creative.url || '',
            platform: creative.platform || 'banner',
            format: creative.format || 'ad',
            label: creative.label || creative.name || `Creative ${creative.id}`,
            width: creative.width || 1080,
            height: creative.height || 1080,
          })),
        },
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not open campaign board.');
    } finally {
      setBusyChildId(null);
    }
  };

  const refreshChildren = async () => {
    if (!user?.id) return;
    const allProjects = await getProjects(user.id, (user as any).email);
    const linked = (Array.isArray(allProjects) ? allProjects : []).filter(
      (p: any) => p.company_project_id === projectId,
    );
    setChildren(linked);
  };

  const restoreChild = async (project: ChildProject) => {
    if (!user?.id) {
      toast.error('You must be logged in to restore this project.');
      return;
    }

    setBusyChildId(project.id);
    try {
      const saved = await createProject({
        user_id: user.id,
        name: `${project.name || 'Draft'} (Copy)`,
        public_url: '',
        folder_path: '',
        form_data: project.form_data || {},
        generated_html: '',
        current_step: project.currentStep ?? project.current_step ?? 0,
        project_type: project.project_type || 'landing_page',
        draft_only: true,
        source_project_id: project.id,
        company_project_id: projectId,
      });

      if (saved?.success && saved?.id) {
        if (project.project_type === 'ad_creative') {
          navigate('/ad-creatives', {
            state: {
              formData: saved.form_data || project.form_data || {},
              currentStep: project.currentStep ?? project.current_step ?? 0,
              savedProjectId: saved.id,
              projectOwnerId: user.id,
              projectPublicUrl: saved.public_url || project.public_url || '',
              folderPath: saved.folder_path || project.folder_path || '',
              companyProjectId: projectId,
            },
          });
          return;
        }

        navigate(`/?restoreProjectId=${encodeURIComponent(String(saved.id))}`, {
          state: {
            formData: project.form_data || {},
            currentStep: project.currentStep ?? project.current_step ?? 0,
            savedProjectId: saved.id,
            projectOwnerId: user.id,
            folderPath: saved.folder_path || '',
            companyProjectId: projectId,
          },
        });
        return;
      }

      toast.error(saved?.error || 'Could not restore this project.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not restore this project.');
    } finally {
      setBusyChildId(null);
    }
  };

  const deleteChild = async (project: ChildProject) => {
    if (!user?.id) return;
    const confirmed = window.confirm(`Delete "${project.name || 'this project'}"? This cannot be undone.`);
    if (!confirmed) return;

    setBusyChildId(project.id);
    try {
      const response = await fetch('/api/deleteProject.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: project.id, user_id: project.user_id ?? user.id }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.error) {
        throw new Error(data?.error || `Delete failed (${response.status})`);
      }
      setChildren((prev) => prev.filter((item) => item.id !== project.id));
      toast.success('Project deleted');
      refreshChildren().catch(() => {});
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not delete project.');
    } finally {
      setBusyChildId(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const initial = (formData.businessName || company?.name || '?')[0].toUpperCase();
  const primaryHsl = hexToHsl(formData.primaryColor);
  const secondaryColor = formData.secondaryColor || formData.primaryColor;

  return (
    <div className="min-h-screen bg-background relative overflow-x-hidden" style={brandVars}>
      <PremiumParticleBackground activeTone="primary" colorOverrides={particleColors} />

      <div className="relative" style={{ zIndex: 10 }}>
        {/* ── Header ── */}
        <header className="border-b border-border/40 bg-background/80 backdrop-blur-md px-6 py-4 flex items-center justify-between sticky top-0 z-20">
          <Button variant="ghost" size="sm" onClick={() => navigate('/projects')}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Projects
          </Button>
          <div className="flex items-center gap-2">
            {isEditing ? (
              <>
                <Button variant="ghost" size="sm" onClick={cancelEdit} disabled={isSaving}>
                  <X className="h-4 w-4 mr-1" />
                  Cancel
                </Button>
                <Button size="sm" onClick={saveEdit} disabled={isSaving}>
                  {isSaving ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-1" />
                  ) : (
                    <Save className="h-4 w-4 mr-1" />
                  )}
                  Save
                </Button>
              </>
            ) : (
              <Button variant="outline" size="sm" onClick={startEdit}>
                <Edit3 className="h-4 w-4 mr-1" />
                Edit
              </Button>
            )}
          </div>
        </header>

        <main className="max-w-5xl mx-auto px-6 py-10 space-y-8">

          {/* ── Company identity ── */}
          <div className="flex items-start gap-5">
            <div
              className="h-16 w-16 rounded-2xl flex items-center justify-center shrink-0 text-white font-bold text-2xl shadow-lg overflow-hidden"
              style={{
                background: primaryHsl
                  ? `hsl(${primaryHsl})`
                  : 'hsl(var(--primary))',
              }}
            >
              {formData.images?.logoUrl
                ? <img src={formData.images.logoUrl} alt="logo" className="h-full w-full object-contain" />
                : initial
              }
            </div>
            <div>
              <h1 className="font-display text-3xl font-bold text-foreground leading-tight">
                {formData.businessName || company?.name || 'Unnamed Company'}
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                {[formData.businessCategory, formData.city, formData.country]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              <div className="flex items-center gap-2 mt-2">
                {[
                  { color: formData.primaryColor, label: 'Primary' },
                  { color: formData.secondaryColor, label: 'Secondary' },
                  { color: formData.accentColor, label: 'Accent' },
                ]
                  .filter((c) => c.color?.trim())
                  .map((c) => (
                    <span
                      key={c.label}
                      className="h-5 w-5 rounded-full border-2 border-background shadow-sm"
                      style={{ background: c.color }}
                      title={`${c.label}: ${c.color}`}
                    />
                  ))}
              </div>
            </div>
          </div>

          {/* ── Company info / Edit form ── */}
          {isEditing ? (
            <div className="glass-card rounded-2xl p-6 space-y-5">
              <div className="flex gap-1 border-b border-border/40 pb-3 flex-wrap">
                {EDIT_SECTIONS.map((sec) => (
                  <button
                    key={sec.id}
                    className={`text-sm px-3 py-1.5 rounded-md transition-colors ${
                      editSection === sec.id
                        ? 'bg-primary/15 text-primary font-medium'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
                    }`}
                    onClick={() => setEditSection(sec.id)}
                  >
                    {sec.label}
                  </button>
                ))}
              </div>
              <CompanyProjectForm
                data={draftForm}
                onChange={(updates) => setDraftForm((prev) => ({ ...prev, ...updates }))}
                section={editSection}
                onUploadLogo={handleUploadLogo}
              />
            </div>
          ) : (
            <div className="glass-card rounded-2xl p-6 grid md:grid-cols-2 gap-x-8 gap-y-5">
              <InfoBlock icon={Target} label="Value Proposition" value={formData.valueProposition} />
              <InfoBlock icon={Users} label="Target Audience" value={formData.targetAudience} />
              <InfoBlock
                icon={Building2}
                label="Description"
                value={formData.businessDescription}
                wide
              />

              {formData.services.filter(Boolean).length > 0 && (
                <div className="md:col-span-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">
                    Services / Products
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {formData.services.filter(Boolean).map((s, i) => (
                      <span
                        key={i}
                        className="text-xs px-2.5 py-1 rounded-full border border-border/60 bg-muted/40"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {formData.differentiators.filter(Boolean).length > 0 && (
                <div className="md:col-span-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">
                    Differentiators
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {formData.differentiators.filter(Boolean).map((d, i) => (
                      <span
                        key={i}
                        className="text-xs px-2.5 py-1 rounded-full border bg-primary/5 text-primary"
                        style={{ borderColor: `${formData.primaryColor}50` }}
                      >
                        {d}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="md:col-span-2 grid sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2 border-t border-border/30">
                <InfoPill label="Tone" value={formData.toneOfVoice} />
                <InfoPill label="Style" value={formData.preferredStyle} />
                <InfoPill label="Personality" value={formData.brandPersonality} />
                {formData.headingFont && (
                  <InfoPill label="Fonts" value={`${formData.headingFont} / ${formData.bodyFont || '–'}`} />
                )}
              </div>

              <div className="md:col-span-2 flex flex-wrap gap-x-6 gap-y-2">
                {formData.sourceWebsite && (
                  <a
                    href={formData.sourceWebsite}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-xs text-primary hover:underline"
                  >
                    <Globe className="h-3.5 w-3.5" />
                    {formData.sourceWebsite}
                  </a>
                )}
                {formData.email && (
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Mail className="h-3.5 w-3.5" />
                    {formData.email}
                  </span>
                )}
                {formData.phone && (
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Phone className="h-3.5 w-3.5" />
                    {formData.phone}
                  </span>
                )}
                {(formData.city || formData.country) && (
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <MapPin className="h-3.5 w-3.5" />
                    {[formData.city, formData.country].filter(Boolean).join(', ')}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* ── Children tabs ── */}
          <Tabs defaultValue="lp">
            <TabsList className="mb-5">
              <TabsTrigger value="lp" className="gap-1.5">
                <FileText className="h-4 w-4" />
                Landing Pages
                <span className="ml-1 text-xs opacity-60">({lpProjects.length})</span>
              </TabsTrigger>
              <TabsTrigger value="ads" className="gap-1.5">
                <Megaphone className="h-4 w-4" />
                Ad Campaigns
                <span className="ml-1 text-xs opacity-60">({adProjects.length})</span>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="lp" className="space-y-3">
              <NewProjectCard
                onClick={goToLP}
                label="New Landing Page"
                icon={FileText}
                color={formData.primaryColor}
              />
              {lpProjects.map((p) => (
                <ChildProjectCard
                  key={p.id}
                  project={p}
                  type="lp"
                  accentColor={formData.primaryColor}
                  onOpen={p.public_url ? () => window.open(p.public_url!, '_blank') : undefined}
                  onEditor={() => navigate(`/visual-editor?projectId=${p.id}`)}
                  onRestore={() => restoreChild(p)}
                  onDelete={() => deleteChild(p)}
                  busy={busyChildId === p.id}
                />
              ))}
              {lpProjects.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-10">
                  No landing pages yet for this company.
                </p>
              )}
            </TabsContent>

            <TabsContent value="ads" className="space-y-3">
              <NewProjectCard
                onClick={goToAds}
                label="New Ad Campaign"
                icon={Megaphone}
                color={secondaryColor}
              />
              {adProjects.map((p) => (
                <ChildProjectCard
                  key={p.id}
                  project={p}
                  type="ads"
                  accentColor={secondaryColor}
                  onOpen={() => openAdBoard(p)}
                  onEditor={() => navigate('/ad-creatives', {
                    state: {
                      formData: p.form_data || {},
                      currentStep: p.currentStep ?? p.current_step ?? 0,
                      savedProjectId: p.id,
                      generatedPublicUrl: p.public_url || '',
                      projectPublicUrl: p.public_url || '',
                      folderPath: p.folder_path || '',
                      companyProjectId: projectId,
                    },
                  })}
                  onRestore={() => restoreChild(p)}
                  onDelete={() => deleteChild(p)}
                  busy={busyChildId === p.id}
                />
              ))}
              {adProjects.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-10">
                  No ad campaigns yet for this company.
                </p>
              )}
            </TabsContent>
          </Tabs>
        </main>
      </div>
    </div>
  );
}

function InfoBlock({
  icon: Icon,
  label,
  value,
  wide,
}: {
  icon: React.ElementType;
  label: string;
  value?: string;
  wide?: boolean;
}) {
  if (!value?.trim()) return null;
  return (
    <div className={wide ? 'md:col-span-2' : ''}>
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">{label}</p>
      </div>
      <p className="text-sm text-foreground leading-relaxed">{value}</p>
    </div>
  );
}

function InfoPill({ label, value }: { label: string; value?: string }) {
  if (!value?.trim()) return null;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">{label}</span>
      <span className="text-xs text-foreground capitalize">{value}</span>
    </div>
  );
}

function NewProjectCard({
  onClick,
  label,
  icon: Icon,
  color,
}: {
  onClick: () => void;
  label: string;
  icon: React.ElementType;
  color?: string;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 rounded-xl border border-dashed border-border/60 px-5 py-4 text-sm text-muted-foreground hover:border-primary/50 hover:text-foreground hover:bg-muted/20 transition-all group"
    >
      <div
        className="h-8 w-8 rounded-lg flex items-center justify-center transition-transform group-hover:scale-110"
        style={{ background: color ? `${color}22` : 'hsl(var(--primary) / 0.1)' }}
      >
        <Plus className="h-4 w-4" style={{ color: color || 'hsl(var(--primary))' }} />
      </div>
      {label}
    </button>
  );
}

function ChildProjectCard({
  project,
  type,
  accentColor,
  onOpen,
  onEditor,
  onRestore,
  onDelete,
  busy,
}: {
  project: ChildProject;
  type: 'lp' | 'ads';
  accentColor?: string;
  onOpen?: () => void;
  onEditor?: () => void;
  onRestore?: () => void;
  onDelete?: () => void;
  busy?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-background/60 px-4 py-3.5 hover:border-primary/30 transition-colors">
      <div className="flex items-center gap-3 min-w-0">
        <div
          className="h-9 w-9 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: accentColor ? `${accentColor}22` : 'hsl(var(--primary) / 0.1)' }}
        >
          {type === 'lp' ? (
            <FileText className="h-4 w-4" style={{ color: accentColor || 'hsl(var(--primary))' }} />
          ) : (
            <Megaphone className="h-4 w-4" style={{ color: accentColor || 'hsl(var(--primary))' }} />
          )}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{project.name || 'Untitled'}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {type === 'lp' ? 'Landing Page' : 'Ad Campaign'} · {formatDate(project.created_at)}
          </p>
          {project.public_url && (
            <a
              href={project.public_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary hover:underline flex items-center gap-1 mt-0.5 w-fit"
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLink className="h-2.5 w-2.5" />
              {project.public_url}
            </a>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {onOpen && (
          <Button size="sm" variant="default" onClick={onOpen} title="Open published" disabled={busy}>
            <Eye className="h-4 w-4" />
          </Button>
        )}
        {onEditor && (
          <Button size="sm" variant="outline" onClick={onEditor} title={type === 'lp' ? 'Visual editor' : 'Edit campaign'} disabled={busy}>
            <Edit3 className="h-4 w-4" />
          </Button>
        )}
        {onRestore && (
          <Button size="sm" variant="outline" onClick={onRestore} title="Restore as new draft" disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
          </Button>
        )}
        {onDelete && (
          <Button size="sm" variant="destructive" onClick={onDelete} title="Delete" disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          </Button>
        )}
      </div>
    </div>
  );
}
