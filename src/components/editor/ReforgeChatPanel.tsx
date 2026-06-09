import { useState, useRef, useEffect } from 'react';
import { Send, Loader2, Wand2, Undo2, Trash2, RefreshCw, Crosshair } from 'lucide-react';
import { reforgeLp, reforgeLpPlan, type ChatMessage } from '@/services/api';
import { toast } from 'sonner';

type Msg = ChatMessage & { cost?: number };

interface Props {
  projectId: number;
  userId: number;
  /** Current editor HTML (already bridge-free; kept in a ref so sends use the latest). */
  html: string;
  /** Apply the edited HTML back into the editor (updates state + re-renders the iframe).
   *  `anchor` is a short text snippet of the change so the editor can scroll to it. */
  onApply: (html: string, anchor?: string) => void;
  /** outerHTML of the element selected in the editor (edit target), if any. */
  focusHtml?: string;
  /** Short label of the selected element for the focus chip (e.g. "h1 · Título"). */
  focusLabel?: string;
}

const PRESETS = [
  'Título do hero mais direto',
  'Botão principal em destaque',
  'Adicionar depoimentos',
  'Mais espaçamento entre seções',
  'Encurtar os textos',
  'Deixar mais minimalista',
];

const fmtUsd = (v: number) => v >= 0.01 ? `$${v.toFixed(2)}` : `$${v.toFixed(5)}`;

// "Chilito" — chat-driven surgical edits, rendered inside the editor's command panel
// (selected via the ReForge tab). Applies ONLY what the user asks, grounded by the
// LP + company stores and the original generation context.
export function ReforgeChatPanel({ projectId, userId, html, onApply, focusHtml, focusLabel }: Props) {
  const storageKey = `cf_reforge_hist_${projectId}`;
  const [history, setHistory] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [undoStack, setUndoStack] = useState<string[]>([]);
  const [pendingTasks, setPendingTasks] = useState<string[]>([]);
  const [taskTotal, setTaskTotal] = useState(0);
  const [taskDone, setTaskDone] = useState(0);
  const [lastInstruction, setLastInstruction] = useState('');
  const [sessionCost, setSessionCost] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const htmlRef = useRef(html);
  const focusRef = useRef<{ html?: string; label?: string }>({});

  useEffect(() => { htmlRef.current = html; }, [html]);
  useEffect(() => { focusRef.current = { html: focusHtml, label: focusLabel }; }, [focusHtml, focusLabel]);
  useEffect(() => { const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight; }, [history, loading]);

  // Persisted conversation per project.
  useEffect(() => {
    try { const s = localStorage.getItem(storageKey); if (s) setHistory(JSON.parse(s)); else setHistory([]); }
    catch { setHistory([]); }
  }, [storageKey]);
  const saveTimer = useRef<number | null>(null);
  useEffect(() => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      try { localStorage.setItem(storageKey, JSON.stringify(history.slice(-60))); } catch { /* quota */ }
    }, 400);
    return () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); };
  }, [history, storageKey]);

  // ── Typing animation for assistant messages ───────────────────────────────
  const animRef = useRef<number | null>(null);
  const pendingFullRef = useRef<string | null>(null);
  useEffect(() => () => { if (animRef.current) window.clearInterval(animRef.current); }, []);
  const finalizeAnim = () => {
    if (animRef.current) { window.clearInterval(animRef.current); animRef.current = null; }
    const full = pendingFullRef.current;
    pendingFullRef.current = null;
    if (full != null) setHistory((prev) => { const n = [...prev]; const l = n.length - 1; if (l >= 0 && n[l].role === 'assistant') n[l] = { ...n[l], content: full }; return n; });
  };
  const appendAssistant = (content: string, cost?: number) => {
    finalizeAnim();
    const full = content || '';
    pendingFullRef.current = full;
    setHistory((prev) => [...prev, { role: 'assistant', content: '', cost }]);
    let i = 0;
    animRef.current = window.setInterval(() => {
      i = Math.min(full.length, i + 3);
      const vis = full.slice(0, i);
      setHistory((prev) => { const n = [...prev]; const l = n.length - 1; if (l >= 0 && n[l].role === 'assistant') n[l] = { ...n[l], content: vis }; return n; });
      if (i >= full.length) { if (animRef.current) window.clearInterval(animRef.current); animRef.current = null; pendingFullRef.current = null; }
    }, 16);
  };

  const runTask = async (instruction: string, label: string, hist: ChatMessage[] = []) => {
    setLoading(true);
    try {
      const res = await reforgeLp({
        user_id: userId, project_id: projectId, instruction,
        html: htmlRef.current, history: hist,
        focusHtml: focusRef.current.html,
      });
      if (res.changed && res.html) { setUndoStack((prev) => [...prev, htmlRef.current]); onApply(res.html, res.anchor); }
      if (typeof res.costUsd === 'number') setSessionCost((c) => c + res.costUsd!);
      let reply = (label ? `${label} ` : '') + (res.reply || (res.changed ? 'Pronto, apliquei a alteração.' : 'Não fiz alterações.'));
      if (res.reverted) reply += '\n\n(⚠️ revertido para não quebrar a página — reformule, por favor.)';
      else if (res.unmatched && res.unmatched.length) reply += `\n\n⚠️ ${res.unmatched.length} trecho(s) não localizado(s) — detalhe melhor e eu refaço.`;
      appendAssistant(reply, res.costUsd);
      return res;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro no ReForge.');
      appendAssistant('Desculpe, algo deu errado. Tente de novo.');
      return null;
    } finally {
      setLoading(false);
    }
  };

  const send = async (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || loading || pendingTasks.length) return;
    setInput('');
    setLastInstruction(msg);
    const priorHistory = history;
    setHistory((prev) => [...prev, { role: 'user', content: msg }]);

    const looksMultiTask = /\n/.test(msg) || msg.length > 160 || (msg.match(/[.!?](\s|$)/g)?.length ?? 0) >= 2;
    if (looksMultiTask) {
      setLoading(true);
      let tasks: string[] = [];
      try { const p = await reforgeLpPlan({ user_id: userId, instruction: msg }); tasks = p.tasks || []; }
      catch { tasks = []; }
      finally { setLoading(false); }

      if (tasks.length > 1) {
        appendAssistant(`Identifiquei ${tasks.length} tarefas:\n${tasks.map((t, i) => `${i + 1}) ${t}`).join('\n')}\n\nVou aplicar a 1ª agora e pedir sua permissão antes de cada próxima.`);
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

  const advance = async () => {
    if (!pendingTasks.length || loading) return;
    const [next, ...rest] = pendingTasks;
    const idx = taskDone + 1;
    await runTask(next, `(${idx}/${taskTotal})`);
    setTaskDone(idx);
    setPendingTasks(rest);
    if (!rest.length) appendAssistant('✅ Todas as tarefas foram aplicadas. Revise e clique em Save Changes.');
  };

  const stopTasks = () => {
    setPendingTasks([]);
    appendAssistant('Ok, parei por aqui. As tarefas já aplicadas continuam no editor.');
  };

  const undo = () => {
    setUndoStack((prev) => {
      if (!prev.length) return prev;
      const next = [...prev];
      const last = next.pop()!;
      onApply(last);
      appendAssistant('↩ Desfiz a última alteração.');
      return next;
    });
  };

  // Re-run the last instruction with a reinforcement to push for a stronger result.
  const retryStronger = () => {
    if (!lastInstruction || loading || pendingTasks.length) return;
    const reinforced = `A alteração anterior não ficou boa o suficiente. Refaça com mais capricho, de forma mais completa e assertiva (sem quebrar o resto da página): ${lastInstruction}`;
    setHistory((prev) => [...prev, { role: 'user', content: '↻ Refazer com mais força' }]);
    runTask(reinforced, '');
  };

  const clearChat = () => {
    setHistory([]); setUndoStack([]); setPendingTasks([]); setSessionCost(0); setLastInstruction('');
    try { localStorage.removeItem(storageKey); } catch { /* ignore */ }
  };

  return (
    <div className="flex h-[calc(100vh-215px)] min-h-[420px] flex-col rounded-md border border-border/60 bg-card/40 overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border/50 px-3 py-2">
        <Wand2 className="h-4 w-4 text-primary" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-foreground leading-tight">Chilito · ReForge</p>
          <p className="text-[10px] text-muted-foreground leading-tight">
            Edições no chat, fiéis à marca{sessionCost > 0 ? ` · ${fmtUsd(sessionCost)} nesta sessão` : ''}
          </p>
        </div>
        {lastInstruction && (
          <button onClick={retryStronger} disabled={loading || pendingTasks.length > 0} className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground disabled:opacity-50" title="Refazer a última alteração com mais força">
            <RefreshCw className="h-3.5 w-3.5" /> Mais força
          </button>
        )}
        {undoStack.length > 0 && (
          <button onClick={undo} disabled={loading} className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground disabled:opacity-50" title="Desfazer última alteração">
            <Undo2 className="h-3.5 w-3.5" /> Desfazer
          </button>
        )}
        {history.length > 0 && (
          <button onClick={clearChat} disabled={loading} className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border/60 text-muted-foreground hover:text-destructive disabled:opacity-50" title="Limpar conversa">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {focusLabel && (
        <div className="flex items-center gap-1.5 border-b border-border/40 bg-primary/5 px-3 py-1.5">
          <Crosshair className="h-3.5 w-3.5 text-primary" />
          <span className="text-[11px] text-muted-foreground">Editando o elemento selecionado: <span className="font-medium text-foreground">{focusLabel}</span></span>
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {history.length === 0 && (
          <p className="py-1 text-xs text-muted-foreground/70">
            Peça uma alteração (ou selecione um elemento na página e diga "mude isto"). Aplico só o que você pedir, mantendo o design e a marca.
          </p>
        )}
        {history.map((m, i) => (
          <div key={i} className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
            <div
              className={`max-w-[88%] rounded-2xl px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap ${m.role === 'user' ? 'text-white rounded-br-sm' : 'bg-muted/60 text-foreground rounded-bl-sm border border-border/30'}`}
              style={m.role === 'user' ? { background: 'linear-gradient(135deg, hsl(var(--accent) / 0.85), hsl(var(--primary) / 0.85))' } : undefined}
            >
              {m.content}
            </div>
            {m.role === 'assistant' && typeof m.cost === 'number' && m.cost > 0 && (
              <span className="mt-0.5 pl-1 text-[9px] text-muted-foreground/60">≈ {fmtUsd(m.cost)}</span>
            )}
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-muted/60 border border-border/30 rounded-2xl rounded-bl-sm px-3 py-2.5 flex gap-1 items-center">
              <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:0ms]" />
              <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:150ms]" />
              <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:300ms]" />
            </div>
          </div>
        )}
      </div>

      {pendingTasks.length > 0 && (
        <div className="border-t border-border/40 bg-primary/5 px-3 py-2.5 space-y-2">
          <p className="text-[11px] text-muted-foreground">
            Próxima ({taskDone + 1}/{taskTotal}): <span className="font-medium text-foreground">{pendingTasks[0]}</span>
          </p>
          <div className="flex gap-2">
            <button onClick={advance} disabled={loading}
              className="flex-1 h-8 rounded-lg text-white text-xs font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, hsl(var(--accent)), hsl(var(--primary)))' }}>
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

      {/* Quick presets */}
      {pendingTasks.length === 0 && (
        <div className="flex flex-wrap gap-1.5 border-t border-border/40 px-3 pt-2.5">
          {PRESETS.map((p) => (
            <button key={p} onClick={() => send(p)} disabled={loading}
              className="rounded-full border border-border/50 bg-background/50 px-2.5 py-1 text-[11px] text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors disabled:opacity-50">
              {p}
            </button>
          ))}
        </div>
      )}

      <div className="px-3 py-3">
        <div className="flex items-end gap-2">
          <textarea
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
  );
}
