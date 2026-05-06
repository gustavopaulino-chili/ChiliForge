import { useState, type DragEvent } from 'react';
import { BusinessFormData, PageItem, PageSection, FormFieldConfig, LANDING_PRESETS } from '@/types/businessForm';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Plus, Trash2, ChevronDown, ChevronRight, FileText, Wand2, GripVertical, Loader2, Sparkles, ClipboardList, Code2 } from 'lucide-react';
import { toast } from 'sonner';
import { generateSections } from '@/services/api';

interface Props {
  data: BusinessFormData;
  onChange: (updates: Partial<BusinessFormData>) => void;
}

const LANDING_SECTIONS: string[] = [
  'Hero', 'Problem', 'Solution', 'Benefits', 'How It Works',
  'Testimonials', 'FAQ', 'CTA', 'Pricing', 'Features',
  'About', 'Contact Form', 'Countdown', 'Gallery',
];

function buildDefaultSections(preset: string): PageItem[] {
  const sections: PageItem[] = [
    { name: 'Hero', description: '', required: true, enabled: true, sections: [] },
    { name: 'Benefits', description: '', required: false, enabled: true, sections: [] },
    { name: 'Social Proof', description: '', required: false, enabled: true, sections: [] },
    { name: 'CTA', description: '', required: true, enabled: true, sections: [] },
  ];

  if (preset === 'black-friday') {
    sections.splice(1, 0, { name: 'Countdown Timer', description: 'Countdown to the end of the promotion', required: true, enabled: true, sections: [] });
    sections.splice(2, 0, { name: 'Offers', description: 'List of discounted offers', required: true, enabled: true, sections: [] });
  }
  if (preset === 'webinar') {
    sections.splice(1, 0, { name: 'Event Details', description: 'Date, time, and event information', required: true, enabled: true, sections: [] });
    sections.splice(2, 0, { name: 'Speakers', description: 'Speaker profiles', required: false, enabled: true, sections: [] });
    sections.splice(3, 0, { name: 'Registration Form', description: 'Event registration form', required: true, enabled: true, sections: [] });
  }
  if (preset === 'lead-capture') {
    sections.splice(1, 0, { name: 'Lead Form', description: 'Optimized lead capture form', required: true, enabled: true, sections: [] });
  }
  if (preset === 'launch') {
    sections.splice(1, 0, { name: 'Product Showcase', description: 'Visual product presentation', required: true, enabled: true, sections: [] });
    sections.splice(2, 0, { name: 'Features', description: 'Product features and differentiators', required: false, enabled: true, sections: [] });
  }
  if (preset === 'app-download') {
    sections.splice(1, 0, { name: 'App Screenshots', description: 'App mockups and screenshots', required: true, enabled: true, sections: [] });
    sections.splice(2, 0, { name: 'Download Buttons', description: 'App Store and Google Play buttons', required: true, enabled: true, sections: [] });
  }

  return sections;
}

export function StepPages({ data, onChange }: Props) {
  const [openPages, setOpenPages] = useState<Set<number>>(new Set());
  const [isGeneratingSections, setIsGeneratingSections] = useState(false);
  const [draggedPageIndex, setDraggedPageIndex] = useState<number | null>(null);
  const config = data.pagesConfig || { mode: 'ai', aiSummary: '', pages: [] };
  const aiSummary = typeof config.aiSummary === 'string' ? config.aiSummary : '';

  const pages = config.pages.length > 0
    ? config.pages
    : buildDefaultSections(data.landingPreset);

  if (config.pages.length === 0 && pages.length > 0) {
    onChange({ pagesConfig: { ...config, pages } });
  }

  const updateConfig = (updates: Partial<typeof config>) => {
    onChange({ pagesConfig: { ...config, ...updates } });
  };

  const updatePage = (index: number, updates: Partial<PageItem>) => {
    const newPages = [...pages];
    newPages[index] = { ...newPages[index], ...updates };
    updateConfig({ pages: newPages });
  };

  const addPage = (name?: string) => {
    const newPage: PageItem = {
      name: name || '',
      description: '',
      required: false,
      enabled: true,
      sections: [],
    };
    const newPages = [...pages, newPage];
    updateConfig({ pages: newPages });
    setOpenPages(prev => new Set(prev).add(newPages.length - 1));
  };

  const removePage = (index: number) => {
    if (pages[index].required) return;
    const newPages = pages.filter((_, i) => i !== index);
    updateConfig({ pages: newPages });
  };

  const remapOpenIndexesAfterMove = (from: number, to: number) => {
    setOpenPages((prev) => {
      if (prev.size === 0) return prev;
      const mapped = new Set<number>();
      prev.forEach((idx) => {
        if (idx === from) {
          mapped.add(to);
          return;
        }
        if (from < to && idx > from && idx <= to) {
          mapped.add(idx - 1);
          return;
        }
        if (from > to && idx >= to && idx < from) {
          mapped.add(idx + 1);
          return;
        }
        mapped.add(idx);
      });
      return mapped;
    });
  };

  const movePage = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    if (fromIndex < 0 || toIndex < 0) return;
    if (fromIndex >= pages.length || toIndex >= pages.length) return;

    const reordered = [...pages];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    updateConfig({ pages: reordered });
    remapOpenIndexesAfterMove(fromIndex, toIndex);
  };

  const handleDragStart = (index: number) => (event: DragEvent<HTMLButtonElement>) => {
    setDraggedPageIndex(index);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(index));
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (targetIndex: number) => (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const fallbackFrom = Number.parseInt(event.dataTransfer.getData('text/plain'), 10);
    const fromIndex = draggedPageIndex ?? (Number.isFinite(fallbackFrom) ? fallbackFrom : -1);
    if (fromIndex >= 0) {
      movePage(fromIndex, targetIndex);
    }
    setDraggedPageIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedPageIndex(null);
  };

  const addSection = (pageIndex: number) => {
    const newSections = [...pages[pageIndex].sections, { title: '', description: '' }];
    updatePage(pageIndex, { sections: newSections });
  };

  const updateSection = (pageIndex: number, sectionIndex: number, updates: Partial<PageSection>) => {
    const newSections = [...pages[pageIndex].sections];
    newSections[sectionIndex] = { ...newSections[sectionIndex], ...updates };
    updatePage(pageIndex, { sections: newSections });
  };

  const removeSection = (pageIndex: number, sectionIndex: number) => {
    const newSections = pages[pageIndex].sections.filter((_, i) => i !== sectionIndex);
    updatePage(pageIndex, { sections: newSections });
  };

  const togglePage = (index: number) => {
    setOpenPages(prev => {
      const next = new Set(prev);
      next.has(index) ? next.delete(index) : next.add(index);
      return next;
    });
  };

  const existingNames = pages.map(p => p.name.toLowerCase());
  const availableSuggestions = LANDING_SECTIONS.filter(s => !existingNames.includes(s.toLowerCase()));

  const handleGenerateSections = async () => {
    if (!aiSummary.trim() || aiSummary.trim().length < 10) {
      toast.error('Describe your sections in more detail before generating.');
      return;
    }

    setIsGeneratingSections(true);
    try {
      const presetLabel = LANDING_PRESETS.find((preset) => preset.value === data.landingPreset)?.label || data.landingPreset;
      const description = [
        `Landing preset: ${presetLabel}`,
        data.businessName ? `Business name: ${data.businessName}` : '',
        data.businessCategory ? `Business category: ${data.businessCategory}` : '',
        data.targetAudience ? `Target audience: ${data.targetAudience}` : '',
        data.valueProposition ? `Value proposition: ${data.valueProposition}` : '',
        `Requested sections description: ${aiSummary.trim()}`,
      ].filter(Boolean).join('\n');

      const result = await generateSections(description);
      if (!result.sections?.length) {
        throw new Error('No sections were generated');
      }

      const generatedPages: PageItem[] = result.sections.map((section) => ({
        name: section.name || 'Section',
        description: section.description || '',
        required: !!section.required,
        enabled: true,
        sections: [],
      }));

      updateConfig({ pages: generatedPages, mode: 'ai' });
      setOpenPages(new Set(generatedPages.map((_, index) => index)));
      toast.success(`Generated ${generatedPages.length} sections for review.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to generate sections');
    } finally {
      setIsGeneratingSections(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="form-section-title">Landing Page Sections</h3>
        <p className="form-section-desc">
          Define the sections of your landing page. Sections are pre-configured based on the preset you selected.
        </p>
      </div>

      {pages.length > 0 && (
        <div className="space-y-4">
          <div className="space-y-2">
            {pages.map((page, pageIndex) => (
              <div
                key={pageIndex}
                className="rounded-lg border border-border bg-card overflow-hidden select-none p-4"
                onDragOver={handleDragOver}
                onDrop={handleDrop(pageIndex)}
              >
                <div className="flex items-center gap-3 mb-2">
                  <button
                    type="button"
                    draggable
                    onDragStart={handleDragStart(pageIndex)}
                    onDragEnd={handleDragEnd}
                    className="cursor-grab active:cursor-grabbing"
                    aria-label={`Drag to reorder section ${pageIndex + 1}`}
                  >
                    <GripVertical className="h-4 w-4 text-muted-foreground/50 shrink-0" />
                  </button>
                  <FileText className="h-4 w-4 text-primary shrink-0" />
                  <Input
                    className="font-medium text-sm text-foreground flex-1"
                    value={page.name}
                    placeholder="Section name"
                    onChange={e => updatePage(pageIndex, { name: e.target.value })}
                  />
                  {page.required && (
                    <Badge variant="outline" className="gap-1 text-xs shrink-0">Required</Badge>
                  )}
                  {!page.required && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive shrink-0"
                      onClick={e => { e.stopPropagation(); removePage(pageIndex); }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
                <Textarea
                  className="mb-2"
                  value={page.description}
                  placeholder="Section description or details"
                  onChange={e => updatePage(pageIndex, { description: e.target.value })}
                  rows={2}
                />
              </div>
            ))}
          </div>

          <div className="space-y-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => addPage()}
              className="w-full gap-2"
            >
              <Plus className="h-4 w-4" /> Add Section
            </Button>

            {availableSuggestions.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Add more sections:</p>
                <div className="flex flex-wrap gap-2">
                  {availableSuggestions.map(name => (
                    <Button
                      key={name}
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => addPage(name)}
                      className="gap-1 h-7 text-xs"
                    >
                      <Plus className="h-3 w-3" /> {name}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
