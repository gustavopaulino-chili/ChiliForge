import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Loader2, Mail, AlertTriangle, CheckCircle2, ShieldCheck } from 'lucide-react';
import { getLpMailer, saveLpMailer, type LpMailerLeadCapture } from '@/services/api';
import { toast } from 'sonner';

interface Props {
  projectId: number;
  userId: number;
}

const DEFAULTS: LpMailerLeadCapture = {
  enabled: false,
  mode: 'test',
  smtpHost: '',
  smtpPort: 587,
  smtpSecure: 'tls',
  smtpUser: '',
  smtpPass: '',
  fromEmail: '',
  fromName: '',
  replyTo: '',
  toLive: '',
  toTest: '',
  subjectTemplate: 'Novo lead: {name}',
  whatsappEnabled: false,
  whatsappNumber: '',
};

export function LpEmailPanel({ projectId, userId }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [hasPassword, setHasPassword] = useState(false);
  const [lc, setLc] = useState<LpMailerLeadCapture>(DEFAULTS);

  const set = (patch: Partial<LpMailerLeadCapture>) => setLc(prev => ({ ...prev, ...patch }));

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await getLpMailer(projectId, userId);
        if (!mounted) return;
        setInstalled(!!res.installed);
        setHasPassword(!!res.hasPassword);
        setLc({ ...DEFAULTS, ...(res.leadCapture || {}) });
      } catch (err) {
        if (mounted) toast.error(err instanceof Error ? err.message : 'Falha ao carregar configurações de e-mail.');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [projectId, userId]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await saveLpMailer({ project_id: projectId, user_id: userId, leadCapture: lc });
      setInstalled(!!res.installed);
      if (lc.smtpPass) setHasPassword(true);
      // The password was sent (or kept) — don't keep it in memory after saving.
      setLc(prev => ({ ...prev, smtpPass: '' }));
      toast.success(installed ? 'Configurações de e-mail salvas.' : 'Sistema de e-mail instalado e configurado!');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível salvar.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border/50 bg-muted/20 p-4 text-xs text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando configurações de e-mail…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Mail className="h-4 w-4 text-primary" />
        <p className="text-sm font-semibold">E-mail dos formulários (SMTP)</p>
      </div>

      {/* Install status */}
      {installed ? (
        <div className="flex items-start gap-2 rounded-md border border-success/30 bg-success/10 p-3 text-xs text-success">
          <CheckCircle2 className="h-4 w-4 mt-0.5 flex-none" />
          <span>O sistema de e-mail está instalado nesta LP. Ajuste a configuração abaixo e salve para atualizar.</span>
        </div>
      ) : (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700">
          <AlertTriangle className="h-4 w-4 mt-0.5 flex-none" />
          <span>
            Esta LP <strong>ainda não tem</strong> o sistema de e-mail. Ao salvar abaixo, o kit será
            <strong> adicionado automaticamente</strong> nos arquivos da LP e os formulários passarão a disparar o envio.
          </span>
        </div>
      )}

      {/* Email capture toggle */}
      <div className="rounded-md border border-border/60 bg-muted/20 p-3 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-foreground">Capturar leads por e-mail</p>
            <p className="text-xs text-muted-foreground mt-0.5">A LP envia o conteúdo dos formulários por e-mail (SMTP).</p>
          </div>
          <Switch checked={!!lc.enabled} onCheckedChange={c => set({ enabled: c })} aria-label="Ativar captura por e-mail" />
        </div>

        {lc.enabled && (
          <div className="space-y-3 border-t border-border/60 pt-3">
            {/* Mode */}
            <div>
              <Label className="text-xs text-muted-foreground">Modo de envio</Label>
              <div className="mt-1.5 grid grid-cols-2 gap-2">
                {(['test', 'live'] as const).map(m => (
                  <button key={m} type="button" onClick={() => set({ mode: m })}
                    className={`rounded-lg border px-3 py-2 text-xs font-medium transition-all ${lc.mode === m ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-muted-foreground/40'}`}>
                    {m === 'test' ? 'Teste (sandbox)' : 'Produção (cliente)'}
                  </button>
                ))}
              </div>
            </div>

            {/* Destinations */}
            <div className="space-y-3">
              <div>
                <Label htmlFor="lpm-toLive" className="text-xs text-muted-foreground">Destino (produção)</Label>
                <Input id="lpm-toLive" type="email" value={lc.toLive || ''} onChange={e => set({ toLive: e.target.value })} placeholder="leads@cliente.com" className="mt-1.5 h-9" />
              </div>
              <div>
                <Label htmlFor="lpm-toTest" className="text-xs text-muted-foreground">Destino (teste)</Label>
                <Input id="lpm-toTest" type="email" value={lc.toTest || ''} onChange={e => set({ toTest: e.target.value })} placeholder="voce@suaagencia.com" className="mt-1.5 h-9" />
              </div>
            </div>

            {/* SMTP host/port/secure */}
            <div className="space-y-3">
              <div>
                <Label htmlFor="lpm-host" className="text-xs text-muted-foreground">SMTP host</Label>
                <Input id="lpm-host" value={lc.smtpHost || ''} onChange={e => set({ smtpHost: e.target.value })} placeholder="smtp.hostinger.com" className="mt-1.5 h-9" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label htmlFor="lpm-port" className="text-xs text-muted-foreground">Porta</Label>
                  <Input id="lpm-port" type="number" value={lc.smtpPort ?? 587} onChange={e => {
                    const p = Number(e.target.value) || 587;
                    // Keep security in sync with standard ports (465=SSL, 587=TLS).
                    set(p === 465 ? { smtpPort: p, smtpSecure: 'ssl' } : p === 587 ? { smtpPort: p, smtpSecure: 'tls' } : { smtpPort: p });
                  }} placeholder="587" className="mt-1.5 h-9" />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Segurança</Label>
                  <select value={lc.smtpSecure || 'tls'} onChange={e => set({ smtpSecure: e.target.value as 'ssl' | 'tls', smtpPort: e.target.value === 'ssl' ? 465 : 587 })}
                    className="mt-1.5 flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
                    <option value="tls">TLS (587)</option>
                    <option value="ssl">SSL (465)</option>
                  </select>
                </div>
              </div>
            </div>

            {/* SMTP user/pass */}
            <div className="space-y-3">
              <div>
                <Label htmlFor="lpm-user" className="text-xs text-muted-foreground">SMTP usuário</Label>
                <Input id="lpm-user" value={lc.smtpUser || ''} onChange={e => set({ smtpUser: e.target.value })} placeholder="envio@cliente.com" className="mt-1.5 h-9" />
              </div>
              <div>
                <Label htmlFor="lpm-pass" className="text-xs text-muted-foreground">SMTP senha</Label>
                <Input id="lpm-pass" type="password" value={lc.smtpPass || ''} onChange={e => set({ smtpPass: e.target.value })} placeholder={hasPassword ? '•••• (mantém a atual)' : '••••••••'} className="mt-1.5 h-9" />
              </div>
            </div>

            {/* Envelope */}
            <div className="space-y-3">
              <div>
                <Label htmlFor="lpm-fromEmail" className="text-xs text-muted-foreground">From (e-mail)</Label>
                <Input id="lpm-fromEmail" type="email" value={lc.fromEmail || ''} onChange={e => set({ fromEmail: e.target.value })} placeholder="envio@cliente.com" className="mt-1.5 h-9" />
              </div>
              <div>
                <Label htmlFor="lpm-fromName" className="text-xs text-muted-foreground">From (nome)</Label>
                <Input id="lpm-fromName" value={lc.fromName || ''} onChange={e => set({ fromName: e.target.value })} placeholder="Site do Cliente" className="mt-1.5 h-9" />
              </div>
            </div>
            <div className="space-y-3">
              <div>
                <Label htmlFor="lpm-replyTo" className="text-xs text-muted-foreground">Reply-to</Label>
                <Input id="lpm-replyTo" type="email" value={lc.replyTo || ''} onChange={e => set({ replyTo: e.target.value })} placeholder="(opcional)" className="mt-1.5 h-9" />
              </div>
              <div>
                <Label htmlFor="lpm-subject" className="text-xs text-muted-foreground">Assunto</Label>
                <Input id="lpm-subject" value={lc.subjectTemplate || ''} onChange={e => set({ subjectTemplate: e.target.value })} placeholder="Novo lead: {name}" className="mt-1.5 h-9" />
              </div>
            </div>

            <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5 mt-0.5 flex-none text-primary" />
              As credenciais ficam só no <code>config.php</code> no servidor — nunca no navegador nem no repositório. Use porta 465 (SSL) ou 587 (TLS), nunca 25.
            </p>
          </div>
        )}
      </div>

      {/* WhatsApp */}
      <div className="rounded-md border border-border/60 bg-muted/20 p-3 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-foreground">Enviar lead por WhatsApp</p>
            <p className="text-xs text-muted-foreground mt-0.5">Ao enviar o formulário, abre o WhatsApp (wa.me) com os dados. Junto ou no lugar do e-mail.</p>
          </div>
          <Switch checked={!!lc.whatsappEnabled} onCheckedChange={c => set({ whatsappEnabled: c })} aria-label="Ativar envio por WhatsApp" />
        </div>
        {lc.whatsappEnabled && (
          <div className="border-t border-border/60 pt-3">
            <Label htmlFor="lpm-wa" className="text-xs text-muted-foreground">Número do WhatsApp (DDI + DDD + número)</Label>
            <Input id="lpm-wa" value={lc.whatsappNumber || ''} onChange={e => set({ whatsappNumber: e.target.value.replace(/[^0-9]/g, '') })} placeholder="5511999999999" className="mt-1.5 h-9" />
          </div>
        )}
      </div>

      <Button onClick={handleSave} disabled={saving} className="w-full gap-2">
        {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Salvando…</>
          : installed ? <>Salvar configurações de e-mail</>
          : <><Mail className="h-4 w-4" /> Salvar e instalar sistema de e-mail</>}
      </Button>
      <p className="text-[11px] text-muted-foreground text-center">
        Para testar o disparo, abra o site publicado em uma nova guia e envie um formulário.
      </p>
    </div>
  );
}
