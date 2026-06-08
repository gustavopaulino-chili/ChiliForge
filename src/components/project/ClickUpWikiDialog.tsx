import { useCallback, useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, RefreshCw, Plug, Building2, FileText, X } from 'lucide-react';
import { toast } from 'sonner';
import { clickupWikiCompanies, clickupWikiPage, clickupStartOAuth } from '@/services/api';
import type { ClickUpWikiCompany } from '@/types/clickup';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: number;
  /** Optional Doc id override (defaults to the main "Chili Wiki" on the server). */
  docId?: string;
}

const REGION_LABEL: Record<string, string> = { BR: 'Brasil', INT: 'Internacional' };

// Lists clients/companies parsed from a ClickUp Wiki (Doc subpages titled
// "{Company} - {Service} {Region}") and shows a subpage's content on click.
export function ClickUpWikiDialog({ open, onOpenChange, userId, docId }: Props) {
  const [loading, setLoading] = useState(false);
  const [companies, setCompanies] = useState<ClickUpWikiCompany[]>([]);
  const [error, setError] = useState('');
  const [notConnected, setNotConnected] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<ClickUpWikiCompany | null>(null);
  const [content, setContent] = useState('');
  const [contentLoading, setContentLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setNotConnected(false);
    try {
      const res = await clickupWikiCompanies(userId, docId);
      setCompanies(res.companies || []);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Falha ao carregar o Wiki.';
      if (/connect your clickup|not_connected/i.test(msg)) setNotConnected(true);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [userId, docId]);

  useEffect(() => {
    if (open) { setSelected(null); setContent(''); load(); }
  }, [open, load]);

  const openPage = async (c: ClickUpWikiCompany) => {
    setSelected(c);
    setContent('');
    setContentLoading(true);
    try {
      const res = await clickupWikiPage(userId, c.page_id, c.doc_id);
      setContent(res.content || '_(página sem conteúdo)_');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao carregar a página.');
      setSelected(null);
    } finally {
      setContentLoading(false);
    }
  };

  const connect = async () => {
    try {
      const res = await clickupStartOAuth(userId);
      if (res.authorize_url) window.location.href = res.authorize_url;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não consegui iniciar a conexão.');
    }
  };

  const needle = search.trim().toLowerCase();
  const filtered = needle
    ? companies.filter((c) =>
        c.company.toLowerCase().includes(needle) ||
        c.services.join(' ').toLowerCase().includes(needle) ||
        c.region.toLowerCase().includes(needle))
    : companies;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plug className="h-5 w-5 text-primary" /> Empresas do Wiki (ClickUp)
          </DialogTitle>
          <DialogDescription>
            Clientes lidos das subpages do Wiki. Clique numa empresa para ver o conteúdo da página.
          </DialogDescription>
        </DialogHeader>

        {notConnected ? (
          <div className="py-10 text-center space-y-3">
            <p className="text-sm text-muted-foreground">Conecte sua conta do ClickUp para carregar o Wiki.</p>
            <Button onClick={connect} className="gap-2"><Plug className="h-4 w-4" /> Conectar ClickUp</Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filtrar empresa, serviço ou região…" className="flex-1" />
              <Button variant="outline" size="icon" onClick={load} disabled={loading} title="Recarregar">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              </Button>
            </div>

            {error && !notConnected && <p className="text-sm text-destructive">{error}</p>}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {/* Company list */}
              <div className="max-h-[55vh] overflow-y-auto rounded-lg border border-border/60">
                {loading ? (
                  <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Carregando empresas…
                  </div>
                ) : filtered.length === 0 ? (
                  <p className="p-4 text-sm text-muted-foreground">Nenhuma empresa encontrada no Wiki.</p>
                ) : (
                  <ul className="divide-y divide-border/60">
                    {filtered.map((c) => (
                      <li key={c.page_id}>
                        <button
                          type="button"
                          onClick={() => openPage(c)}
                          className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/40 ${selected?.page_id === c.page_id ? 'bg-primary/5' : ''}`}
                        >
                          <span className="flex items-center gap-2 min-w-0">
                            <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-medium text-foreground">{c.company}</span>
                              <span className="flex flex-wrap items-center gap-1 mt-0.5">
                                {c.services.map((s) => (
                                  <span key={s} className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">{s}</span>
                                ))}
                                {c.region && (
                                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{REGION_LABEL[c.region] || c.region}</span>
                                )}
                              </span>
                            </span>
                          </span>
                          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Page content */}
              <div className="max-h-[55vh] overflow-y-auto rounded-lg border border-border/60 p-3">
                {!selected ? (
                  <p className="text-sm text-muted-foreground">Selecione uma empresa para ver o conteúdo da página.</p>
                ) : contentLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Carregando página…
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-foreground">{selected.title}</p>
                      <button onClick={() => { setSelected(null); setContent(''); }} className="text-muted-foreground hover:text-foreground" title="Fechar">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    <pre className="whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground/90 font-sans">{content}</pre>
                  </div>
                )}
              </div>
            </div>

            <p className="text-[11px] text-muted-foreground">
              {filtered.length} empresa(s){companies.length !== filtered.length ? ` de ${companies.length}` : ''} no Wiki.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
