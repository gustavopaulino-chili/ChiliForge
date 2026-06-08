import { useCallback, useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, Plug, RefreshCw, CheckCircle2, AlertCircle, Building2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  clickupStatus, clickupStartOAuth, clickupConnectToken, clickupListSpaces, clickupListFolders, clickupListCompanies, clickupImportCompanies, scrapeWebsite,
} from '@/services/api';
import type { ClickUpSpace, ClickUpFolder, ClickUpCompany } from '@/types/clickup';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: number;
  onImported?: () => void;
}

type Row = ClickUpCompany & { selected: boolean; url: string; status?: 'scraping' | 'importing' | 'done' | 'error'; note?: string; form?: Record<string, unknown> };

// Pull a few human-readable fields from the scraped profile for the review gate.
function previewFields(form?: Record<string, unknown>): { description: string; primary: string; logo: string; services: number } {
  const f = form || {};
  const images = (f.images && typeof f.images === 'object') ? f.images as Record<string, unknown> : {};
  const theme = (f.theme && typeof f.theme === 'object') ? f.theme as Record<string, unknown> : {};
  const services = Array.isArray(f.services) ? f.services.length : (Array.isArray(f.products) ? (f.products as unknown[]).length : 0);
  return {
    description: String(f.businessDescription || f.valueProposition || '').slice(0, 220),
    primary: String(theme.primary || f.primaryColor || ''),
    logo: String(images.logo || images.logoUrl || f.logoUrl || ''),
    services,
  };
}

export function ClickUpImportDialog({ open, onOpenChange, userId, onImported }: Props) {
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(true);
  const [connected, setConnected] = useState(false);
  const [spaces, setSpaces] = useState<ClickUpSpace[]>([]);
  const [spaceId, setSpaceId] = useState('');
  const [folders, setFolders] = useState<ClickUpFolder[]>([]);
  const [folderId, setFolderId] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [apiToken, setApiToken] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [phase, setPhase] = useState<'select' | 'review'>('select');

  const refreshStatus = useCallback(async () => {
    setLoading(true);
    try {
      const s = await clickupStatus(userId);
      setConfigured(s.configured);
      setConnected(s.connected);
      if (s.connected) {
        const res = await clickupListSpaces(userId);
        if (res.mode === 'spaces') {
          setSpaces(res.spaces);
          setFolders([]); setSpaceId('');
        } else if (res.mode === 'folders') {
          // server pinned a space → skip the space picker
          setSpaces([]); setSpaceId(res.space_id); setFolders(res.folders);
        }
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load ClickUp status');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { if (open && userId > 0) refreshStatus(); }, [open, userId, refreshStatus]);

  const handleConnect = async () => {
    try {
      const { authorize_url } = await clickupStartOAuth(userId);
      window.location.href = authorize_url; // ClickUp redirects back to /projects?clickup=connected
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not start ClickUp connection');
    }
  };

  const handleConnectToken = async () => {
    const t = apiToken.trim();
    if (!t) { toast.error('Cole a API key do ClickUp (pk_...).'); return; }
    setConnecting(true);
    try {
      await clickupConnectToken(userId, t);
      setApiToken('');
      toast.success('ClickUp conectado!');
      await refreshStatus();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível conectar com a API key');
    } finally {
      setConnecting(false);
    }
  };

  const loadFolders = async (sid: string) => {
    setSpaceId(sid);
    setFolders([]); setFolderId(''); setRows([]); setPhase('select');
    if (!sid) return;
    setBusy(true);
    try {
      const res = await clickupListFolders(userId, sid);
      if (res.mode === 'folders') setFolders(res.folders);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not list folders');
    } finally {
      setBusy(false);
    }
  };

  const loadCompanies = async (fid: string) => {
    setFolderId(fid);
    setRows([]);
    setPhase('select');
    if (!fid) return;
    setBusy(true);
    try {
      const res = await clickupListCompanies(userId, fid);
      if (res.mode === 'companies') {
        setRows(res.companies.map((c) => ({ ...c, selected: !c.already_imported, url: c.detected_url || '' })));
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not list companies');
    } finally {
      setBusy(false);
    }
  };

  const setRow = (i: number, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  // PORTÃO 1: confirma URLs → scrape → mostra o perfil pra revisão (não cria nada ainda).
  const handlePrepare = async () => {
    const selected = rows.map((r, i) => ({ r, i })).filter(({ r }) => r.selected);
    if (!selected.length) { toast.info('Selecione ao menos uma empresa.'); return; }
    const missingUrl = selected.find(({ r }) => !r.url.trim());
    if (missingUrl) { toast.error(`Confirme a URL do site de "${missingUrl.r.company}".`); return; }

    setImporting(true);
    try {
      for (const { r, i } of selected) {
        setRow(i, { status: 'scraping', note: '' });
        let form: Record<string, unknown> = { businessName: r.company, sourceWebsite: r.url.trim() };
        try {
          const scraped = await scrapeWebsite(r.url.trim());
          form = { ...(scraped.extracted || {}), businessName: r.company, sourceWebsite: r.url.trim() };
          setRow(i, { status: undefined, note: '' });
        } catch {
          setRow(i, { status: undefined, note: 'não consegui ler o site — vai importar com dados básicos' });
        }
        setRow(i, { form });
      }
      setPhase('review');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao preparar a importação');
    } finally {
      setImporting(false);
    }
  };

  // PORTÃO 2: usuário revisou os perfis → cria/atualiza as empresas.
  const handleConfirmImport = async () => {
    const selected = rows.filter((r) => r.selected);
    if (!selected.length) { setPhase('select'); return; }
    setImporting(true);
    try {
      const payload = selected.map((r) => ({
        company: r.company, channels: r.channels, list_ids: r.list_ids,
        website_url: r.url.trim(),
        form_data: r.form || { businessName: r.company, sourceWebsite: r.url.trim() },
      }));
      const res = await clickupImportCompanies(userId, payload);
      const byName = new Map(res.results.map((x) => [x.company, x]));
      setRows((prev) => prev.map((r) => {
        const out = byName.get(r.company);
        if (!out) return r;
        return { ...r, status: out.status === 'error' ? 'error' : 'done', note: out.status === 'error' ? out.reason : out.status, already_imported: out.status !== 'error' };
      }));
      const ok = res.results.filter((x) => x.status === 'created' || x.status === 'updated').length;
      toast.success(`${ok} empresa(s) importada(s) do ClickUp.`);
      setPhase('select');
      onImported?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Plug className="h-4 w-4 text-primary" /> Importar do ClickUp</DialogTitle>
          <DialogDescription>Conecte sua conta e importe empresas detectadas para a aba Projects.</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center gap-2 py-8 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</div>
        ) : !connected ? (
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">Conectar com API key</p>
              <p className="text-xs text-muted-foreground">
                Cole sua API key pessoal do ClickUp. Em ClickUp: Settings → Apps → API Token (começa com <code>pk_</code>).
              </p>
              <div className="flex gap-2">
                <Input
                  type="password"
                  value={apiToken}
                  onChange={(e) => setApiToken(e.target.value)}
                  placeholder="pk_..."
                  className="flex-1 text-sm"
                  onKeyDown={(e) => { if (e.key === 'Enter') handleConnectToken(); }}
                />
                <Button onClick={handleConnectToken} disabled={connecting} className="gap-2">
                  {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />} Conectar
                </Button>
              </div>
            </div>
            {configured && (
              <div className="border-t border-border/60 pt-3">
                <p className="mb-2 text-xs text-muted-foreground">ou conecte via OAuth (login na conta ClickUp):</p>
                <Button variant="outline" onClick={handleConnect} className="gap-2"><Plug className="h-4 w-4" /> Conectar via OAuth</Button>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              {spaces.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="w-12 text-xs font-medium text-muted-foreground">Space:</span>
                  <select
                    className="flex h-9 flex-1 rounded-md border border-input bg-background px-2 text-sm"
                    value={spaceId}
                    onChange={(e) => loadFolders(e.target.value)}
                  >
                    <option value="">Selecione o space…</option>
                    {spaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  <Button variant="outline" size="icon" onClick={refreshStatus} title="Atualizar"><RefreshCw className="h-4 w-4" /></Button>
                </div>
              )}
              <div className="flex items-center gap-2">
                <span className="w-12 text-xs font-medium text-muted-foreground">Folder:</span>
                <select
                  className="flex h-9 flex-1 rounded-md border border-input bg-background px-2 text-sm"
                  value={folderId}
                  disabled={spaces.length > 0 && !spaceId}
                  onChange={(e) => loadCompanies(e.target.value)}
                >
                  <option value="">{spaces.length > 0 && !spaceId ? 'Escolha o space primeiro…' : 'Selecione a pasta…'}</option>
                  {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
                {spaces.length === 0 && (
                  <Button variant="outline" size="icon" onClick={refreshStatus} title="Atualizar"><RefreshCw className="h-4 w-4" /></Button>
                )}
              </div>
            </div>

            {busy ? (
              <div className="flex items-center gap-2 py-6 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Detectando empresas…</div>
            ) : rows.length > 0 ? (
              <>
                {phase === 'review' && (
                  <p className="text-xs text-muted-foreground">Revise o perfil lido de cada site antes de criar as empresas. Nada é criado até confirmar.</p>
                )}
                <div className="max-h-[46vh] space-y-2 overflow-y-auto pr-1">
                  {rows.map((r, i) => {
                    if (phase === 'review' && !r.selected) return null;
                    const pv = phase === 'review' ? previewFields(r.form) : null;
                    return (
                    <div key={r.company + i} className="rounded-lg border border-border p-3 space-y-2">
                      <div className="flex items-start gap-2">
                        <Checkbox checked={r.selected} disabled={phase === 'review'} onCheckedChange={(v) => setRow(i, { selected: Boolean(v) })} className="mt-1" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="text-sm font-medium text-foreground">{r.company}</span>
                            {r.channels.map((c) => <span key={c} className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">{c}</span>)}
                            {r.already_imported && <span className="rounded-full bg-green-500/10 px-2 py-0.5 text-[10px] font-medium text-green-600">já importada</span>}
                          </div>
                          <Input
                            value={r.url}
                            disabled={phase === 'review'}
                            onChange={(e) => setRow(i, { url: e.target.value })}
                            placeholder="https://site-da-empresa.com (confirme a URL)"
                            className="mt-2 h-8 text-sm"
                          />
                          {pv && (
                            <div className="mt-2 rounded-md bg-muted/40 p-2 space-y-1.5">
                              <div className="flex items-center gap-2">
                                {pv.logo ? <img src={pv.logo} alt="" className="h-6 w-6 rounded object-contain bg-background" onError={(e) => { e.currentTarget.style.display = 'none'; }} /> : null}
                                {pv.primary ? <span className="inline-block h-4 w-4 rounded-full border border-border" style={{ background: pv.primary }} title={pv.primary} /> : null}
                                <span className="text-[11px] text-muted-foreground">{pv.services > 0 ? `${pv.services} serviço(s)/produto(s)` : 'sem serviços detectados'}</span>
                              </div>
                              {pv.description ? <p className="text-[11px] text-foreground/80 leading-snug">{pv.description}{pv.description.length >= 220 ? '…' : ''}</p> : <p className="text-[11px] text-muted-foreground">Sem descrição lida do site.</p>}
                            </div>
                          )}
                          {r.status && (
                            <p className={`mt-1 text-[11px] flex items-center gap-1 ${r.status === 'error' ? 'text-destructive' : r.status === 'done' ? 'text-green-600' : 'text-muted-foreground'}`}>
                              {r.status === 'done' && <CheckCircle2 className="h-3 w-3" />}
                              {r.status === 'error' && <AlertCircle className="h-3 w-3" />}
                              {(r.status === 'scraping' || r.status === 'importing') && <Loader2 className="h-3 w-3 animate-spin" />}
                              {r.status === 'scraping' ? 'lendo o site…' : r.status === 'importing' ? 'importando…' : r.note || r.status}
                            </p>
                          )}
                          {!r.status && r.note && <p className="mt-1 text-[11px] text-amber-600">{r.note}</p>}
                        </div>
                      </div>
                    </div>
                    );
                  })}
                </div>
                <div className="flex justify-end gap-2">
                  {phase === 'review' && (
                    <Button variant="outline" onClick={() => setPhase('select')} disabled={importing}>Voltar</Button>
                  )}
                  <Button onClick={phase === 'review' ? handleConfirmImport : handlePrepare} disabled={importing} className="gap-2">
                    {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    {phase === 'review' ? 'Confirmar e importar' : 'Revisar selecionadas'}
                  </Button>
                </div>
              </>
            ) : folderId ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma empresa no padrão "Canal - Empresa" nesta pasta.</p>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
