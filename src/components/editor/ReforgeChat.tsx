import { useState, useRef, useEffect } from 'react';
import { Wand2, X, Send, Loader2, Sparkles, Undo2 } from 'lucide-react';
import { reforgeLp, reforgeLpPlan, type ChatMessage } from '@/services/api';
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
  const [undoStack, setUndoStack] = useState<string[]>([]);
  const [pendingTasks, setPendingTasks] = useState<string[]>([]);
  const [taskTotal, setTaskTotal] = useState(0);
  const [taskDone, setTaskDone] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const htmlRef = useRef(html);

  useEffect(() => { htmlRef.current = html; }, [html]);
  useEffect(() => { const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight; }, [history, loading]);
  useEffect(() => { if (isOpen) setTimeout(() => inputRef.current?.focus(), 80); }, [isOpen]);

  // Apply ONE instruction surgically and report the result in the chat.
  const runTask = async (instruction: string, label: string, hist: ChatMessage[] = []) => {
    setLoading(true);
    try {
      const res = await reforgeLp({
        user_id: userId,
        project_id: projectId,
        instruction,
        html: stripEditorBridge(htmlRef.current),
        history: hist,
      });
      if (res.changed && res.html) {
        setUndoStack((prev) => [...prev, htmlRef.current]); // snapshot BEFORE applying
        onApply(res.html);
      }
      let reply = (label ? `${label} ` : '') + (res.reply || (res.changed ? 'Pronto, apliquei a alteração.' : 'Não fiz alterações.'));
      if (res.reverted) reply += '\n\n(⚠️ revertido para não quebrar a página — reformule, por favor.)';
      else if (res.unmatched && res.unmatched.length) reply += `\n\n⚠️ ${res.unmatched.length} trecho(s) não localizado(s) — detalhe melhor e eu refaço.`;
      setHistory((prev) => [...prev, { role: 'assistant', content: reply }]);
      return res;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro no ReForge.');
      setHistory((prev) => [...prev, { role: 'assistant', content: 'Desculpe, algo deu errado. Tente de novo.' }]);
      return null;
    } finally {
      setLoading(false);
    }
  };

  const send = async (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || loading || pendingTasks.length) return;
    setInput('');
    const priorHistory = history;
    setHistory((prev) => [...prev, { role: 'user', content: msg }]);

    // Multi-task feedback? Split it into tasks and apply one at a time (with permission).
    const looksMultiTask = /\n/.test(msg) || msg.length > 160 || (msg.match(/[.!?](\s|$)/g)?.length ?? 0) >= 2;
    if (looksMultiTask) {
      setLoading(true);
      let tasks: string[] = [];
      try { const p = await reforgeLpPlan({ user_id: userId, instruction: msg }); tasks = p.tasks || []; }
      catch { tasks = []; }
      finally { setLoading(false); }

      if (tasks.length > 1) {
        setHistory((prev) => [...prev, {
          role: 'assistant',
          content: `Identifiquei ${tasks.length} tarefas:\n${tasks.map((t, i) => `${i + 1}) ${t}`).join('\n')}\n\nVou aplicar a 1ª agora e pedir sua permissão antes de cada próxima.`,
        }]);
        setTaskTotal(tasks.length);
        setTaskDone(0);
        await runTask(tasks[0], `(1/${tasks.length})`);
        setTaskDone(1);
        setPendingTasks(tasks.slice(1));
        return;
      }
      await runTask(tasks[0] || msg, '');
      return;
    }

    await runTask(msg, '', priorHistory);
  };

  // Apply the next queued task (user pressed "Avançar").
  const advance = async () => {
    if (!pendingTasks.length || loading) return;
    const [next, ...rest] = pendingTasks;
    const idx = taskDone + 1;
    await runTask(next, `(${idx}/${taskTotal})`);
    setTaskDone(idx);
    setPendingTasks(rest);
    if (!rest.length) setHistory((prev) => [...prev, { role: 'assistant', content: '✅ Todas as tarefas foram aplicadas. Revise e clique em Save Changes.' }]);
  };

  const stopTasks = () => {
    setPendingTasks([]);
    setHistory((prev) => [...prev, { role: 'assistant', content: 'Ok, parei por aqui. As tarefas já aplicadas continuam no editor.' }]);
  };

  const undo = () => {
    setUndoStack((prev) => {
      if (!prev.length) return prev;
      const next = [...prev];
      const last = next.pop()!;
      onApply(last);
      setHistory((h) => [...h, { role: 'assistant', content: '↩ Desfiz a última alteração.' }]);
      return next;
    });
  };

  return (
    <>
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          aria-label="Abrir ReForge"
          className="group fixed right-0 top-1/2 z-50 flex -translate-y-1/2 flex-col items-center gap-1.5 rounded-l-xl py-4 px-2.5 text-white shadow-xl transition-all duration-200 hover:px-3.5 cf-reforge-pulse"
          style={{ background: 'linear-gradient(135deg, hsl(var(--accent)), hsl(var(--primary)))' }}
        >
          <Wand2 className="relative h-5 w-5" />
          <span className="relative text-[11px] font-bold tracking-wide [writing-mode:vertical-rl] rotate-180">ReForge</span>
        </button>
      )}
      <style>{`
        @keyframes cfReforgePulse {
          0%, 100% { box-shadow: 0 0 0 0 hsl(var(--primary) / 0.55), -6px 0 18px -4px hsl(var(--primary) / 0.5); transform: translateY(-50%) translateX(0); }
          50%      { box-shadow: 0 0 0 10px hsl(var(--primary) / 0), -10px 0 26px -2px hsl(var(--accent) / 0.7); transform: translateY(-50%) translateX(-3px); }
        }
        .cf-reforge-pulse { animation: cfReforgePulse 1.8s ease-in-out infinite; }
        .cf-reforge-pulse:hover { animation: none; }
      `}</style>

      {isOpen && (
        <div className="fixed bottom-6 right-3 sm:right-6 z-50 flex flex-col rounded-2xl border border-border/50 bg-card/95 backdrop-blur-md shadow-2xl overflow-hidden w-[min(380px,calc(100vw-1.5rem))] h-[560px] max-h-[calc(100dvh-2rem)]">
          <div className="flex items-center gap-2.5 px-4 py-3 text-white shrink-0" style={{ background: 'linear-gradient(135deg, hsl(var(--accent) / 0.9), hsl(var(--primary) / 0.9))' }}>
            <Sparkles className="h-4 w-4 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold leading-tight">Chilito · ReForge</p>
              <p className="text-[10px] opacity-75 leading-tight">Edições no chat, fiéis à marca</p>
            </div>
            {undoStack.length > 0 && (
              <button onClick={undo} disabled={loading} className="shrink-0 h-7 px-2 rounded-full flex items-center gap-1 bg-white/10 hover:bg-white/25 transition-colors text-[11px] font-medium disabled:opacity-50" title="Desfazer última alteração">
                <Undo2 className="h-3.5 w-3.5" /> Desfazer
              </button>
            )}
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

          {pendingTasks.length > 0 && (
            <div className="border-t border-border/40 bg-primary/5 px-3 py-2.5 shrink-0 space-y-2">
              <p className="text-[11px] text-muted-foreground">
                Próxima ({taskDone + 1}/{taskTotal}): <span className="font-medium text-foreground">{pendingTasks[0]}</span>
              </p>
              <div className="flex gap-2">
                <button
                  onClick={advance}
                  disabled={loading}
                  className="flex-1 h-8 rounded-lg text-white text-xs font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg, hsl(var(--accent)), hsl(var(--primary)))' }}
                >
                  {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                  Avançar
                </button>
                <button onClick={stopTasks} disabled={loading}
                  className="h-8 px-3 rounded-lg border border-border/60 text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-50">
                  Parar
                </button>
              </div>
            </div>
          )}

          <div className="border-t border-border/40 px-3 py-3 shrink-0">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                placeholder={pendingTasks.length ? 'Conclua ou pare a fila de tarefas…' : 'Descreva a alteração (ou cole um feedback com vários pedidos)…'}
                rows={2}
                disabled={loading || pendingTasks.length > 0}
                className="flex-1 resize-none rounded-xl border border-border/50 bg-background/60 px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-muted-foreground/50 disabled:opacity-60"
              />
              <button
                onClick={() => send()}
                disabled={!input.trim() || loading || pendingTasks.length > 0}
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
