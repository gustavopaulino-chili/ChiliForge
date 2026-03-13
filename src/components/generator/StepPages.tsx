import { useState } from 'react';
import { BusinessFormData, REQUIRED_PAGES, OPTIONAL_PAGES_SUGGESTIONS, PageItem, PageSection } from '@/types/businessForm';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Lock, Plus, Trash2, ChevronDown, ChevronRight, FileText, Wand2, PenTool, GripVertical, ShoppingCart } from 'lucide-react';

interface Props {
  data: BusinessFormData;
  onChange: (updates: Partial<BusinessFormData>) => void;
}

function buildDefaultPages(data: BusinessFormData): PageItem[] {
  const required = REQUIRED_PAGES[data.websiteType] || ['Home'];
  return required.map(name => ({
    name,
    description: '',
    required: true,
    enabled: true,
    sections: [],
  }));
}

export function StepPages({ data, onChange }: Props) {
  const [openPages, setOpenPages] = useState<Set<number>>(new Set());
  const config = data.pagesConfig || { mode: 'manual', aiSummary: '', pages: [] };
  const requiredNames = REQUIRED_PAGES[data.websiteType] || ['Home'];
  const suggestions = OPTIONAL_PAGES_SUGGESTIONS[data.websiteType] || [];

  // Initialize pages if empty
  const pages = config.pages.length > 0
    ? config.pages
    : buildDefaultPages(data);

  // Sync if pages were just built
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
  const availableSuggestions = suggestions.filter(s => !existingNames.includes(s.toLowerCase()));

  return (
    <div className="space-y-6">
      <div>
        <h3 className="form-section-title">Content & Pages</h3>
        <p className="form-section-desc">
          Define which pages and sections your site will have. Required pages are pre-selected based on website type.
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
          <Label>Describe your website content</Label>
          <Textarea
            placeholder="Freely describe what you want on your site. Example: 'I want a homepage with a bold banner, a services section with 3 cards, a portfolio page with gallery, an about us page with company history, and a contact form with integrated map...'"
            value={config.aiSummary}
            onChange={e => updateConfig({ aiSummary: e.target.value })}
            className="min-h-[150px]"
          />
          <p className="text-xs text-muted-foreground">
            AI will interpret your text and automatically organize the pages and sections.
          </p>

          {/* Still show required pages as info */}
          <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-2">
            <p className="text-xs font-medium text-foreground flex items-center gap-2">
              <Lock className="h-3.5 w-3.5 text-primary" />
              Required pages (included automatically)
            </p>
            <div className="flex flex-wrap gap-2">
              {requiredNames.map(name => (
                <Badge key={name} variant="secondary" className="gap-1">
                  <Lock className="h-3 w-3" /> {name}
                </Badge>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Pages List */}
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
                        {page.name || 'New Page'}
                      </span>
                      {page.required && (
                        <Badge variant="outline" className="gap-1 text-xs shrink-0">
                          <Lock className="h-3 w-3" /> Required
                        </Badge>
                      )}
                      {page.sections.length > 0 && (
                        <span className="text-xs text-muted-foreground shrink-0">
                          {page.sections.length} {page.sections.length === 1 ? 'section' : 'sections'}
                        </span>
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
                      {/* Show products summary on Products page */}
                      {page.name === 'Products' && data.products && data.products.length > 0 && (
                        <div className="rounded-md border border-border/60 bg-muted/20 p-3 space-y-2">
                          <p className="text-xs font-medium text-foreground flex items-center gap-2">
                            <ShoppingCart className="h-3.5 w-3.5 text-primary" />
                            {data.products.length} {data.products.length === 1 ? 'product added' : 'products added'}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {data.products.filter(p => p.name).map((p, i) => (
                              <Badge key={i} variant="secondary" className="text-xs gap-1">
                                {p.name}
                                {p.price && <span className="text-muted-foreground">${p.price}</span>}
                              </Badge>
                            ))}
                          </div>
                          {data.products.filter(p => p.name).length === 0 && (
                            <p className="text-xs text-muted-foreground italic">
                              No products with a name defined. Go back to the Products tab to add them.
                            </p>
                          )}
                        </div>
                      )}

                      {page.name === 'Products' && (!data.products || data.products.length === 0) && (
                        <div className="rounded-md border border-dashed border-border bg-muted/10 p-3">
                          <p className="text-xs text-muted-foreground italic">
                            No products added yet. Go back to the "Products" tab to add your products.
                          </p>
                        </div>
                      )}

                      {/* Page Description */}
                      <div>
                        <Label className="text-xs">Page Description (optional)</Label>
                        <Textarea
                          value={page.description || ''}
                          onChange={e => updatePage(pageIndex, { description: e.target.value })}
                          placeholder="Describe what you want on this page. E.g. 'A hero banner with background image, a testimonials section with carousel, and a contact form at the bottom...'"
                          className="mt-1 min-h-[70px] text-sm"
                        />
                      </div>

                      {/* Page Name (editable for non-required) */}
                      {!page.required && (
                        <div>
                          <Label className="text-xs">Page Name</Label>
                          <Input
                            value={page.name}
                            onChange={e => updatePage(pageIndex, { name: e.target.value })}
                            placeholder="Page name..."
                            className="mt-1"
                          />
                        </div>
                      )}

                      {/* Sections */}
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs">Page Sections</Label>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => addSection(pageIndex)}
                            className="gap-1 h-7 text-xs"
                          >
                            <Plus className="h-3 w-3" /> Add Section
                          </Button>
                        </div>

                        {page.sections.length === 0 && (
                          <p className="text-xs text-muted-foreground italic py-2">
                            No sections added. AI will decide sections automatically, or add them manually.
                          </p>
                        )}

                        {page.sections.map((section, sectionIndex) => (
                          <div key={sectionIndex} className="rounded-md border border-border/60 bg-muted/20 p-3 space-y-2">
                            <div className="flex items-center gap-2">
                              <Input
                                value={section.title}
                                onChange={e => updateSection(pageIndex, sectionIndex, { title: e.target.value })}
                                placeholder="Section title (e.g. Hero, About, Testimonials...)"
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
                              placeholder="Describe what this section should contain..."
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

          {/* Add page */}
          <div className="space-y-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => addPage()}
              className="w-full gap-2"
            >
              <Plus className="h-4 w-4" /> Add Page
            </Button>

            {/* Suggestions */}
            {availableSuggestions.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Page suggestions:</p>
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