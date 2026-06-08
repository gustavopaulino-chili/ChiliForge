import { Input } from '@/components/ui/input';
import { BusinessFormData } from '@/types/businessForm';
import { FieldLabel } from './FieldLabel';

interface Props {
  data: BusinessFormData;
  onChange: (updates: Partial<BusinessFormData>) => void;
}

// Lead capture by e-mail (SMTP). The generated LP ships a PHP mailer kit that
// receives the form POST and delivers the lead by e-mail (no external CRM form).
export function StepLeads({ data, onChange }: Props) {
  const lc = data.leadCapture;
  const updateLead = (patch: Partial<BusinessFormData['leadCapture']>) =>
    onChange({ leadCapture: { ...data.leadCapture, ...patch } });

  return (
    <div className="space-y-6">
      <div>
        <h3 className="form-section-title">Captura de leads</h3>
        <p className="form-section-desc">
          Receba os envios dos formulários da LP por e-mail (SMTP), sem depender de formulário de CRM externo.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card p-4 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h4 className="text-sm font-semibold text-foreground">Captura de lead por e-mail (SMTP)</h4>
            <p className="text-xs text-muted-foreground mt-1">
              A LP gerada recebe os formulários e envia o lead por e-mail. Ative e configure o SMTP do cliente.
            </p>
          </div>
          <button
            type="button"
            onClick={() => updateLead({ enabled: !lc.enabled })}
            className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors ${lc.enabled ? 'bg-primary' : 'bg-muted-foreground/30'}`}
            aria-label="Ativar captura de lead"
          >
            <span className={`inline-block h-5 w-5 translate-y-0.5 rounded-full bg-white shadow transition-transform ${lc.enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
          </button>
        </div>

        {!lc.enabled && (
          <p className="text-xs text-muted-foreground">
            Desativado: os formulários da LP ficam sem backend de envio. Ative para configurar o disparo por e-mail.
          </p>
        )}

        {lc.enabled && (
          <div className="space-y-4">
            {/* Mode test/live */}
            <div>
              <FieldLabel hint="test: envia para o e-mail de teste (seguro enquanto edita). live: envia para o destino real do cliente.">Modo de envio</FieldLabel>
              <div className="mt-1.5 grid grid-cols-2 gap-2">
                {(['test', 'live'] as const).map(m => (
                  <button key={m} type="button" onClick={() => updateLead({ mode: m })}
                    className={`rounded-lg border px-3 py-2 text-xs font-medium transition-all ${lc.mode === m ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-muted-foreground/40'}`}>
                    {m === 'test' ? 'Teste (sandbox)' : 'Produção (cliente)'}
                  </button>
                ))}
              </div>
            </div>

            {/* Destinos */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <FieldLabel htmlFor="toLive" hint="E-mail real do cliente OU endereço 'email-to-lead' do CRM dele.">Destino (produção)</FieldLabel>
                <Input id="toLive" type="email" value={lc.toLive} onChange={e => updateLead({ toLive: e.target.value })} placeholder="leads@cliente.com" className="mt-1.5" />
              </div>
              <div>
                <FieldLabel htmlFor="toTest" hint="Inbox de teste para validar antes de publicar.">Destino (teste)</FieldLabel>
                <Input id="toTest" type="email" value={lc.toTest} onChange={e => updateLead({ toTest: e.target.value })} placeholder="voce@suaagencia.com" className="mt-1.5" />
              </div>
            </div>

            {/* SMTP */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <FieldLabel htmlFor="smtpHost" hint="Ex.: smtp.hostinger.com (interno funciona liso). Externo exige porta 465/587 liberada.">SMTP host</FieldLabel>
                <Input id="smtpHost" value={lc.smtpHost} onChange={e => updateLead({ smtpHost: e.target.value })} placeholder="smtp.hostinger.com" className="mt-1.5" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <FieldLabel htmlFor="smtpPort">Porta</FieldLabel>
                  <Input id="smtpPort" type="number" value={lc.smtpPort} onChange={e => updateLead({ smtpPort: Number(e.target.value) || 587 })} placeholder="587" className="mt-1.5" />
                </div>
                <div>
                  <FieldLabel>Segurança</FieldLabel>
                  <select value={lc.smtpSecure} onChange={e => updateLead({ smtpSecure: e.target.value as 'ssl' | 'tls', smtpPort: e.target.value === 'ssl' ? 465 : 587 })}
                    className="mt-1.5 flex h-10 w-full rounded-md border border-input bg-background px-2 text-sm">
                    <option value="tls">TLS (587)</option>
                    <option value="ssl">SSL (465)</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <FieldLabel htmlFor="smtpUser">SMTP usuário</FieldLabel>
                <Input id="smtpUser" value={lc.smtpUser} onChange={e => updateLead({ smtpUser: e.target.value })} placeholder="envio@cliente.com" className="mt-1.5" />
              </div>
              <div>
                <FieldLabel htmlFor="smtpPass">SMTP senha</FieldLabel>
                <Input id="smtpPass" type="password" value={lc.smtpPass} onChange={e => updateLead({ smtpPass: e.target.value })} placeholder="••••••••" className="mt-1.5" />
              </div>
            </div>

            {/* Envelope */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <FieldLabel htmlFor="fromEmail" hint="Remetente. Geralmente igual ao usuário SMTP.">From (e-mail)</FieldLabel>
                <Input id="fromEmail" type="email" value={lc.fromEmail} onChange={e => updateLead({ fromEmail: e.target.value })} placeholder="envio@cliente.com" className="mt-1.5" />
              </div>
              <div>
                <FieldLabel htmlFor="fromName">From (nome)</FieldLabel>
                <Input id="fromName" value={lc.fromName} onChange={e => updateLead({ fromName: e.target.value })} placeholder="Site do Cliente" className="mt-1.5" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <FieldLabel htmlFor="replyTo" hint="Opcional. Vazio = responde para o e-mail do próprio lead.">Reply-to</FieldLabel>
                <Input id="replyTo" type="email" value={lc.replyTo} onChange={e => updateLead({ replyTo: e.target.value })} placeholder="(opcional)" className="mt-1.5" />
              </div>
              <div>
                <FieldLabel htmlFor="subjectTemplate" hint="Use {name} e {email} como variáveis dos campos do formulário.">Assunto</FieldLabel>
                <Input id="subjectTemplate" value={lc.subjectTemplate} onChange={e => updateLead({ subjectTemplate: e.target.value })} placeholder="Novo lead: {name}" className="mt-1.5" />
              </div>
            </div>

            <p className="text-[11px] text-muted-foreground">
              As credenciais ficam só no <code>config.php</code> gerado no servidor — nunca no navegador nem no repositório. Use porta 465 (SSL) ou 587 (TLS), nunca 25.
            </p>
          </div>
        )}
      </div>

      {/* WhatsApp */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h4 className="text-sm font-semibold text-foreground">Enviar lead por WhatsApp</h4>
            <p className="text-xs text-muted-foreground mt-1">
              No envio do formulário, abre o WhatsApp com TODOS os dados preenchidos, direcionado ao número da empresa (wa.me). Funciona junto ou no lugar do e-mail.
            </p>
          </div>
          <button
            type="button"
            onClick={() => updateLead({ whatsappEnabled: !lc.whatsappEnabled })}
            className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors ${lc.whatsappEnabled ? 'bg-primary' : 'bg-muted-foreground/30'}`}
            aria-label="Ativar envio por WhatsApp"
          >
            <span className={`inline-block h-5 w-5 translate-y-0.5 rounded-full bg-white shadow transition-transform ${lc.whatsappEnabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
          </button>
        </div>

        {lc.whatsappEnabled && (
          <div>
            <FieldLabel htmlFor="waNumber" hint="Número da empresa com DDI, só dígitos. Ex.: 55 (Brasil) + DDD + número = 5511999999999.">
              Número do WhatsApp da empresa
            </FieldLabel>
            <Input
              id="waNumber"
              value={lc.whatsappNumber}
              onChange={e => updateLead({ whatsappNumber: e.target.value.replace(/[^0-9]/g, '') })}
              placeholder="5511999999999"
              className="mt-1.5"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Só dígitos (DDI + DDD + número). O lead confirma o envio no app do WhatsApp.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
