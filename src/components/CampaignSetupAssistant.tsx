import { useState, useRef, useEffect } from 'react';
import { Bot, X, Send, Loader2, Check } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { setupWizardChat, ChatMessage, SetupWizardResponse } from '@/services/api';
import { AdCreativeFormData } from '@/types/adCreativeForm';
import { briefDataToAdUpdates } from '@/components/ad-generator/StepAdImport';
import { toast } from 'sonner';

const STARTER_PROMPTS = [
  'Me ajude a montar minha campanha',
  'Qual objetivo devo escolher para meu produto?',
  'Sugira uma estratégia para meu lançamento',
  'Me guie passo a passo',
];

function TypingIndicator() {
  return (
    <div className="flex justify-start">
      <div className="bg-muted/60 border border-border/30 rounded-2xl rounded-bl-sm px-3 py-2.5 flex gap-1 items-center">
        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:0ms]" />
        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:150ms]" />
        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:300ms]" />
      </div>
    </div>
  );
}

interface ConfirmActionsProps {
  onConfirm: () => void;
  onAdjust: () => void;
}

function ConfirmActions({ onConfirm, onAdjust }: ConfirmActionsProps) {
  return (
    <div className="flex gap-2 mt-2">
      <button
        onClick={onConfirm}
        className="flex-1 flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90"
        style={{ background: 'linear-gradient(135deg, hsl(var(--primary)), hsl(var(--accent)))' }}
      >
        <Check className="h-3 w-3" />
        Confirmar
      </button>
      <button
        onClick={onAdjust}
        className="px-3 rounded-lg border border-border/50 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        Ajustar
      </button>
    </div>
  );
}

interface Props {
  formData: AdCreativeFormData;
  companyProjectId?: number;
  onApplySuggestions: (suggestions: Partial<AdCreativeFormData>) => void;
}

export function CampaignSetupAssistant({ formData, companyProjectId, onApplySuggestions }: Props) {
  const { user } = useAuth();
  const [isOpen, setIsOpen]               = useState(false);
  const [chatHistory, setChatHistory]     = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput]         = useState('');
  const [isLoading, setIsLoading]         = useState(false);
  const [isAnimating, setIsAnimating]     = useState(false);
  const [pendingData, setPendingData]     = useState<Record<string, unknown> | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLTextAreaElement>(null);
  const timerRef  = useRef<number | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chatHistory, isLoading]);

  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 80);
  }, [isOpen]);

  useEffect(() => () => { if (timerRef.current) window.clearInterval(timerRef.current); }, []);

  if (!user?.id) return null;

  const animateReply = (text: string) => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    let idx = 0;
    setIsAnimating(true);
    setChatHistory(prev => [...prev, { role: 'assistant', content: '' }]);

    timerRef.current = window.setInterval(() => {
      idx = Math.min(text.length, idx + 4);
      setChatHistory(prev => {
        const next = [...prev];
        const last = next.length - 1;
        if (last >= 0 && next[last].role === 'assistant') {
          next[last] = { ...next[last], content: text.slice(0, idx) };
        }
        return next;
      });
      if (idx >= text.length) {
        window.clearInterval(timerRef.current!);
        timerRef.current = null;
        setIsAnimating(false);
      }
    }, 16);
  };

  const handleSend = async (text?: string) => {
    const msg = (text ?? chatInput).trim();
    if (!msg || isLoading || isAnimating) return;
    setChatInput('');

    const newHistory: ChatMessage[] = [...chatHistory, { role: 'user', content: msg }];
    setChatHistory(newHistory);
    setIsLoading(true);

    try {
      const res: SetupWizardResponse = await setupWizardChat({
        user_id: user.id,
        company_project_id: companyProjectId,
        message: msg,
        history: chatHistory,
        current_form: formData as unknown as Record<string, unknown>,
      });

      if (res.type === 'preview' && res.pending_data) {
        setPendingData(res.pending_data);
      } else {
        // text response — clear pending if model no longer includes data block
        setPendingData(null);
      }

      animateReply(res.message || '...');
    } catch (err: any) {
      animateReply('Algo deu errado. Tente novamente.');
      toast.error(err.message || 'Erro no assistente.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirm = () => {
    if (!pendingData) return;
    const validated = briefDataToAdUpdates(pendingData);
    const count = Object.keys(validated).filter(k => {
      const v = (validated as Record<string, unknown>)[k];
      return v !== '' && v !== null && v !== undefined;
    }).length;
    onApplySuggestions(validated);
    setPendingData(null);
    toast.success(`${count} campo${count === 1 ? '' : 's'} preenchido${count === 1 ? '' : 's'} no formulário`);
    setChatHistory(prev => [...prev, {
      role: 'assistant',
      content: '✅ Pronto! O formulário foi preenchido. Revise os campos e ajuste o que precisar.',
    }]);
  };

  const handleAdjust = () => {
    setPendingData(null);
    setChatHistory(prev => [...prev, {
      role: 'assistant',
      content: 'Claro! O que você gostaria de ajustar?',
    }]);
    setTimeout(() => inputRef.current?.focus(), 80);
  };

  // index of last assistant message — confirm actions attach to it
  const lastAssistantIdx = chatHistory.reduce((acc, msg, i) => msg.role === 'assistant' ? i : acc, -1);

  return (
    <>
      {/* Floating trigger */}
      <button
        onClick={() => setIsOpen(v => !v)}
        aria-label={isOpen ? 'Fechar assistente' : 'Abrir assistente de campanha'}
        className="fixed bottom-6 right-6 z-40 h-14 w-14 rounded-full flex items-center justify-center text-white transition-all duration-200 hover:scale-105 active:scale-95 focus:outline-none"
        style={{ background: 'linear-gradient(135deg, hsl(var(--primary)), hsl(var(--accent)))' }}
      >
        {!isOpen && (
          <>
            <span className="absolute inset-0 rounded-full animate-ping opacity-30" style={{ background: 'linear-gradient(135deg, hsl(var(--primary)), hsl(var(--accent)))' }} />
            <span className="absolute inset-0 rounded-full" style={{ boxShadow: '0 0 18px 4px hsl(var(--accent) / 0.55)' }} />
          </>
        )}
        {isOpen ? <X className="relative h-6 w-6" /> : <Bot className="relative h-6 w-6" />}
      </button>

      {/* Chat panel */}
      {isOpen && (
        <div className="fixed bottom-[5.5rem] right-3 sm:right-6 z-40 flex flex-col rounded-2xl border border-border/50 bg-card/95 backdrop-blur-md shadow-2xl overflow-hidden w-[min(340px,calc(100vw-1.5rem))] h-[520px] max-h-[calc(100dvh-7rem)]">
          {/* Header */}
          <div
            className="flex items-center gap-2.5 px-4 py-3 text-white shrink-0"
            style={{ background: 'linear-gradient(135deg, hsl(var(--primary) / 0.9), hsl(var(--accent) / 0.85))' }}
          >
            <Bot className="h-4 w-4 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold leading-tight">Chilito</p>
              <p className="text-[10px] opacity-75 leading-tight">Especialista em Campanhas</p>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="shrink-0 h-7 w-7 rounded-full flex items-center justify-center bg-white/10 hover:bg-white/25 transition-colors"
              aria-label="Fechar"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3 min-h-0">
            {chatHistory.length === 0 && (
              <div className="py-2 space-y-3">
                <p className="text-xs text-muted-foreground/70 text-center">
                  Vou te guiar na configuração da sua campanha. Conta pra mim sobre o seu produto!
                </p>
                <div className="space-y-1.5">
                  {STARTER_PROMPTS.map(p => (
                    <button
                      key={p}
                      onClick={() => handleSend(p)}
                      disabled={isLoading || isAnimating}
                      className="block w-full text-left text-xs rounded-xl border border-border/40 bg-background/40 px-3 py-2 hover:border-primary/40 hover:bg-primary/5 transition-colors disabled:opacity-50"
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {chatHistory.map((msg, i) => (
              <div key={i} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                <div
                  className={`max-w-[82%] rounded-2xl px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap ${
                    msg.role === 'user'
                      ? 'text-white rounded-br-sm'
                      : 'bg-muted/60 text-foreground rounded-bl-sm border border-border/30'
                  }`}
                  style={msg.role === 'user'
                    ? { background: 'linear-gradient(135deg, hsl(var(--primary) / 0.85), hsl(var(--accent) / 0.85))' }
                    : undefined}
                >
                  {msg.content}
                  {msg.role === 'assistant' && isAnimating && i === chatHistory.length - 1 && (
                    <span className="ml-0.5 inline-block h-3 w-1 translate-y-0.5 animate-pulse rounded-full bg-primary/70" />
                  )}
                </div>

                {/* Confirm actions attached to last assistant message when pending */}
                {msg.role === 'assistant' && i === lastAssistantIdx && pendingData && !isAnimating && !isLoading && (
                  <div className="max-w-[82%] w-full">
                    <ConfirmActions onConfirm={handleConfirm} onAdjust={handleAdjust} />
                  </div>
                )}
              </div>
            ))}

            {isLoading && <TypingIndicator />}
          </div>

          {/* Input */}
          <div className="border-t border-border/40 px-3 py-3 shrink-0">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
                }}
                placeholder="Descreva seu produto ou faça uma pergunta…"
                rows={2}
                disabled={isLoading || isAnimating}
                className="flex-1 resize-none rounded-xl border border-border/50 bg-background/60 px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-muted-foreground/50 disabled:opacity-60"
              />
              <button
                onClick={() => handleSend()}
                disabled={!chatInput.trim() || isLoading || isAnimating}
                className="shrink-0 h-9 w-9 rounded-xl flex items-center justify-center text-white transition-opacity disabled:opacity-40 hover:opacity-90"
                style={{ background: 'linear-gradient(135deg, hsl(var(--primary)), hsl(var(--accent)))' }}
                aria-label="Enviar"
              >
                {isLoading
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <Send className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
