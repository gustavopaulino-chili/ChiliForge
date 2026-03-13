import { useState } from 'react';
import { BusinessFormData, REQUIRED_PAGES, OPTIONAL_PAGES_SUGGESTIONS, PageItem, PageSection } from '@/types/businessForm';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Lock, Plus, Trash2, ChevronDown, ChevronRight, FileText, Wand2, PenTool, GripVertical } from 'lucide-react';

interface Props {
  data: BusinessFormData;
  onChange: (updates: Partial<BusinessFormData>) => void;
}

function buildDefaultPages(data: BusinessFormData): PageItem[] {
  const required = REQUIRED_PAGES[data.websiteType] || ['Home'];
  return required.map(name => ({
    name,
    required: true,
    enabled: true,
    sections: [],
  }));
}

export function StepPages({ data, onChange }: Props) {
  const [openPages, setOpenPages] = useState<Set<number>>(new Set());
  const config = data.pagesConfig;
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
        <h3 className="form-section-title">Conteúdo & Páginas</h3>
        <p className="form-section-desc">
          Defina quais páginas e seções seu site terá. Páginas obrigatórias são pré-selecionadas de acordo com o tipo de site.
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
          <Wand2 className="h-4 w-4" /> Resumo com IA
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
          <Label>Descreva o conteúdo do seu site</Label>
          <Textarea
            placeholder="Descreva livremente o que você quer no seu site. Exemplo: 'Quero uma página inicial com banner chamativo, uma seção de serviços com 3 cards, uma página de portfólio com galeria, página sobre nós com a história da empresa, e um formulário de contato com mapa integrado...'"
            value={config.aiSummary}
            onChange={e => updateConfig({ aiSummary: e.target.value })}
            className="min-h-[150px]"
          />
          <p className="text-xs text-muted-foreground">
            A IA interpretará seu texto e organizará automaticamente as páginas e seções do site.
          </p>

          {/* Still show required pages as info */}
          <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-2">
            <p className="text-xs font-medium text-foreground flex items-center gap-2">
              <Lock className="h-3.5 w-3.5 text-primary" />
              Páginas obrigatórias (incluídas automaticamente)
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
                        {page.name || 'Nova Página'}
                      </span>
                      {page.required && (
                        <Badge variant="outline" className="gap-1 text-xs shrink-0">
                          <Lock className="h-3 w-3" /> Obrigatória
                        </Badge>
                      )}
                      {page.sections.length > 0 && (
                        <span className="text-xs text-muted-foreground shrink-0">
                          {page.sections.length} {page.sections.length === 1 ? 'seção' : 'seções'}
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
                      {/* Page Name (editable for non-required) */}
                      {!page.required && (
                        <div>
                          <Label className="text-xs">Nome da Página</Label>
                          <Input
                            value={page.name}
                            onChange={e => updatePage(pageIndex, { name: e.target.value })}
                            placeholder="Nome da página..."
                            className="mt-1"
                          />
                        </div>
                      )}

                      {/* Sections */}
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs">Seções desta página</Label>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => addSection(pageIndex)}
                            className="gap-1 h-7 text-xs"
                          >
                            <Plus className="h-3 w-3" /> Adicionar Seção
                          </Button>
                        </div>

                        {page.sections.length === 0 && (
                          <p className="text-xs text-muted-foreground italic py-2">
                            Nenhuma seção adicionada. A IA decidirá as seções automaticamente, ou adicione manualmente.
                          </p>
                        )}

                        {page.sections.map((section, sectionIndex) => (
                          <div key={sectionIndex} className="rounded-md border border-border/60 bg-muted/20 p-3 space-y-2">
                            <div className="flex items-center gap-2">
                              <Input
                                value={section.title}
                                onChange={e => updateSection(pageIndex, sectionIndex, { title: e.target.value })}
                                placeholder="Título da seção (ex: Hero, Sobre, Depoimentos...)"
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
                              placeholder="Descreva o que essa seção deve conter..."
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
              <Plus className="h-4 w-4" /> Adicionar Página
            </Button>

            {/* Suggestions */}
            {availableSuggestions.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Sugestões de páginas:</p>
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
