import { useState } from 'react';
import { BusinessFormData, PageItem, PageSection, LANDING_PRESETS } from '@/types/businessForm';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Plus, Trash2, ChevronDown, ChevronRight, FileText, Wand2, PenTool, GripVertical } from 'lucide-react';

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
    sections.splice(1, 0, { name: 'Lead Form', description: 'Formulário otimizado para captura de leads', required: true, enabled: true, sections: [] });
  }
  if (preset === 'launch') {
    sections.splice(1, 0, { name: 'Product Showcase', description: 'Apresentação visual do produto', required: true, enabled: true, sections: [] });
    sections.splice(2, 0, { name: 'Features', description: 'Funcionalidades e diferenciais do produto', required: false, enabled: true, sections: [] });
  }
  if (preset === 'app-download') {
    sections.splice(1, 0, { name: 'App Screenshots', description: 'Mockups e capturas de tela do app', required: true, enabled: true, sections: [] });
    sections.splice(2, 0, { name: 'Download Buttons', description: 'Botões App Store e Google Play', required: true, enabled: true, sections: [] });
  }

  return sections;
}

export function StepPages({ data, onChange }: Props) {
  const [openPages, setOpenPages] = useState<Set<number>>(new Set());
  const config = data.pagesConfig || { mode: 'manual', aiSummary: '', pages: [] };

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

  return (
    <div className="space-y-6">
      <div>
        <h3 className="form-section-title">Landing Page Sections</h3>
        <p className="form-section-desc">
          Define the sections of your landing page. Sections are pre-configured based on the preset you selected.
        </p>
      </div>

      {/* Mode Toggle */}
      <div className="flex gap-2">
        <Button
          type="button"
          variant={config.mode === 'ai' ? 'default' : 'outline'}
          size="sm"
          onClick={() => updateConfig({ mode: 'ai' })}
          className="gap-2"
        >
          <Wand2 className="h-4 w-4" /> AI Summary
        </Button>
        <Button
          type="button"
          variant={config.mode === 'manual' ? 'default' : 'outline'}
          size="sm"
          onClick={() => updateConfig({ mode: 'manual' })}
          className="gap-2"
        >
          <PenTool className="h-4 w-4" /> Manual
        </Button>
      </div>

      {config.mode === 'ai' ? (
        <div className="space-y-3">
          <Label>Describe your landing page content</Label>
          <Textarea
            placeholder="Describe freely what you want on your landing page. Example: 'I want a bold hero with a countdown timer, a section showing 3 key benefits with icons, customer testimonials in a carousel, and a final CTA with a contact form...'"
            value={config.aiSummary}
            onChange={e => updateConfig({ aiSummary: e.target.value })}
            className="min-h-[150px]"
          />
          <p className="text-xs text-muted-foreground">
            AI will interpret your description and organize the landing page sections automatically.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-2">
            {pages.map((page, pageIndex) => (
              <Collapsible key={pageIndex} open={openPages.has(pageIndex)}>
                <div className="rounded-lg border border-border bg-card overflow-hidden">
                  <CollapsibleTrigger asChild>
                    <button
                      type="button"
                      onClick={() => togglePage(pageIndex)}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/50 transition-colors"
                    >
                      <GripVertical className="h-4 w-4 text-muted-foreground/50 shrink-0" />
                      {openPages.has(pageIndex)
                        ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                        : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                      }
                      <FileText className="h-4 w-4 text-primary shrink-0" />
                      <span className="font-medium text-sm text-foreground flex-1">
                        {page.name || 'New Section'}
                      </span>
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
                    </button>
                  </CollapsibleTrigger>

                  <CollapsibleContent>
                    <div className="px-4 pb-4 space-y-4 border-t border-border pt-4">
                      <div>
                        <Label className="text-xs">Section Description (optional)</Label>
                        <Textarea
                          value={page.description || ''}
                          onChange={e => updatePage(pageIndex, { description: e.target.value })}
                          placeholder="Describe what this section should contain..."
                          className="mt-1 min-h-[70px] text-sm"
                        />
                      </div>

                      {!page.required && (
                        <div>
                          <Label className="text-xs">Section Name</Label>
                          <Input
                            value={page.name}
                            onChange={e => updatePage(pageIndex, { name: e.target.value })}
                            placeholder="Section name..."
                            className="mt-1"
                          />
                        </div>
                      )}

                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs">Sub-sections</Label>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => addSection(pageIndex)}
                            className="gap-1 h-7 text-xs"
                          >
                            <Plus className="h-3 w-3" /> Add
                          </Button>
                        </div>

                        {page.sections.length === 0 && (
                          <p className="text-xs text-muted-foreground italic py-2">
                            No sub-sections. AI will decide automatically, or add them manually.
                          </p>
                        )}

                        {page.sections.map((section, sectionIndex) => (
                          <div key={sectionIndex} className="rounded-md border border-border/60 bg-muted/20 p-3 space-y-2">
                            <div className="flex items-center gap-2">
                              <Input
                                value={section.title}
                                onChange={e => updateSection(pageIndex, sectionIndex, { title: e.target.value })}
                                placeholder="Sub-section title..."
                                className="text-sm h-8"
                              />
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive shrink-0"
                                onClick={() => removeSection(pageIndex, sectionIndex)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                            <Textarea
                              value={section.description}
                              onChange={e => updateSection(pageIndex, sectionIndex, { description: e.target.value })}
                              placeholder="Describe what this sub-section should contain..."
                              className="min-h-[60px] text-sm"
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  </CollapsibleContent>
                </div>
              </Collapsible>
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
                <p className="text-xs text-muted-foreground">Section suggestions:</p>
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
