import { useState, useRef, useEffect } from 'react';
import { Wand2, X, Send, Loader2, Sparkles } from 'lucide-react';
import { reforgeLp, type ChatMessage } from '@/services/api';
import { stripEditorBridge } from '@/components/editor/VisualEditor';
import { toast } from 'sonner';

interface Props {
  projectId: number;
  userId: number;
  /** Current editor HTML (kept in a ref so sends always use the latest). */
  html: string;
  /** Apply the edited HTML back into the editor (marks unsaved). */
  onApply: (html: string) => void;
}

const STARTERS = [
  'Troque o título do hero para algo mais direto',
  'Deixe o botão principal em destaque',
  'Adicione uma seção de depoimentos',
  'Aumente o espaçamento entre as seções',
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

// "Chilito" inside the LP visual editor: chat-driven surgical edits grounded by the
// LP + company stores and the original generation context. Applies ONLY what the
// user asks and writes the result back into the editor (the user reviews + saves).
export function ReforgeChat({ projectId, userId, html, onApply }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const htmlRef = useRef(html);

  useEffect(() => { htmlRef.current = html; }, [html]);
  useEffect(() => { const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight; }, [history, loading]);
  useEffect(() => { if (isOpen) setTimeout(() => inputRef.current?.focus(), 80); }, [isOpen]);

  const send = async (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || loading) return;
    setInput('');
    const priorHistory = history;
    setHistory((prev) => [...prev, { role: 'user', content: msg }]);
    setLoading(true);
    try {
      const res = await reforgeLp({
        user_id: userId,
        project_id: projectId,
        instruction: msg,
        html: stripEditorBridge(htmlRef.current),
        history: priorHistory,
      });
      let reply = res.reply || (res.changed ? 'Pronto, apliquei a alteração.' : 'Não fiz alterações.');
      if (res.changed && res.html) onApply(res.html);
      if (res.unmatched && res.unmatched.length) {
        reply += `\n\n⚠️ ${res.unmatched.length} trecho(s) não localizado(s) — descreva o ponto com mais detalhe e eu refaço.`;
      }
      setHistory((prev) => [...prev, { role: 'assistant', content: reply }]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro no ReForge.');
      setHistory((prev) => [...prev, { role: 'assistant', content: 'Desculpe, algo deu errado. Tente de novo.' }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          aria-label="Abrir ReForge"
          className="fixed bottom-6 right-6 z-50 h-14 px-4 rounded-full shadow-xl flex items-center gap-2 text-white transition-all duration-200 hover:scale-105 active:scale-95"
          style={{ background: 'linear-gradient(135deg, hsl(var(--accent)), hsl(var(--primary)))' }}
        >
          <Wand2 className="h-5 w-5" />
          <span className="text-sm font-semibold">ReForge</span>
        </button>
      )}

      {isOpen && (
        <div className="fixed bottom-6 right-3 sm:right-6 z-50 flex flex-col rounded-2xl border border-border/50 bg-card/95 backdrop-blur-md shadow-2xl overflow-hidden w-[min(380px,calc(100vw-1.5rem))] h-[560px] max-h-[calc(100dvh-2rem)]">
          <div className="flex items-center gap-2.5 px-4 py-3 text-white shrink-0" style={{ background: 'linear-gradient(135deg, hsl(var(--accent) / 0.9), hsl(var(--primary) / 0.9))' }}>
            <Sparkles className="h-4 w-4 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold leading-tight">Chilito · ReForge</p>
              <p className="text-[10px] opacity-75 leading-tight">Edições no chat, fiéis à marca</p>
            </div>
            <button onClick={() => setIsOpen(false)} className="shrink-0 h-7 w-7 rounded-full flex items-center justify-center bg-white/10 hover:bg-white/25 transition-colors" aria-label="Fechar">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
            {history.length === 0 && (
              <div className="py-2 space-y-3">
                <p className="text-xs text-muted-foreground/70 text-center">
                  Peça uma alteração. Eu aplico só o que você pedir, mantendo o design e a marca da geração original.
                </p>
                <div className="space-y-1.5">
                  {STARTERS.map((p) => (
                    <button key={p} onClick={() => send(p)} disabled={loading}
                      className="block w-full text-left text-xs rounded-xl border border-border/40 bg-background/40 px-3 py-2 hover:border-primary/40 hover:bg-primary/5 transition-colors disabled:opacity-50">
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {history.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap ${m.role === 'user' ? 'text-white rounded-br-sm' : 'bg-muted/60 text-foreground rounded-bl-sm border border-border/30'}`}
                  style={m.role === 'user' ? { background: 'linear-gradient(135deg, hsl(var(--accent) / 0.85), hsl(var(--primary) / 0.85))' } : undefined}
                >
                  {m.content}
                </div>
              </div>
            ))}

            {loading && <TypingIndicator />}
          </div>

          <div className="border-t border-border/40 px-3 py-3 shrink-0">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                placeholder="Descreva a alteração…"
                rows={2}
                disabled={loading}
                className="flex-1 resize-none rounded-xl border border-border/50 bg-background/60 px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-muted-foreground/50 disabled:opacity-60"
              />
              <button
                onClick={() => send()}
                disabled={!input.trim() || loading}
                className="shrink-0 h-9 w-9 rounded-xl flex items-center justify-center text-white transition-opacity disabled:opacity-40 hover:opacity-90"
                style={{ background: 'linear-gradient(135deg, hsl(var(--accent)), hsl(var(--primary)))' }}
                aria-label="Enviar"
              >
                {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              </button>
            </div>
            <p className="mt-1.5 text-[10px] text-muted-foreground/70">As mudanças entram no editor — revise e clique em <span className="font-medium">Save Changes</span>.</p>
          </div>
        </div>
      )}
    </>
  );
}
