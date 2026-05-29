import { useState, useRef, useEffect } from 'react';
import { Bot, X, Send, Loader2, Check, ChevronDown, ChevronUp } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { setupWizardChat, ChatMessage, SetupWizardResponse } from '@/services/api';
import { AdCreativeFormData } from '@/types/adCreativeForm';
import { toast } from 'sonner';

// Human-readable labels for suggestion fields shown in the preview card
const FIELD_LABELS: Record<string, string> = {
  campaignName:      'Campaign name',
  campaignObjective: 'Objective',
  funnelStage:       'Funnel stage',
  productName:       'Product / Service',
  brandName:         'Brand name',
  industry:          'Industry',
  targetAudience:    'Target audience',
  offer:             'Offer',
  valueProposition:  'Value proposition',
  ctaText:           'CTA text',
  toneOfVoice:       'Tone of voice',
  urgencyLevel:      'Urgency',
  creativeStrategy:  'Creative strategy',
  painPoints:        'Pain points',
  desires:           'Desires',
};

// Starter prompts shown when chat is empty
const STARTER_PROMPTS = [
  "I'm not sure how to set up my campaign",
  'Help me pick the right campaign objective',
  'Suggest a strategy for my product',
  'Guide me step by step',
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

interface SuggestionCardProps {
  suggestions: Record<string, unknown>;
  onApply: () => void;
  onDismiss: () => void;
}

function SuggestionCard({ suggestions, onApply, onDismiss }: SuggestionCardProps) {
  const [expanded, setExpanded] = useState(false);
  const entries = Object.entries(suggestions).filter(([, v]) => v && String(v).trim());
  const preview = entries.slice(0, 3);
  const rest    = entries.slice(3);

  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 text-xs space-y-2">
      <p className="font-semibold text-primary flex items-center gap-1.5">
        <Bot className="h-3.5 w-3.5" />
        Suggested campaign setup
      </p>
      <ul className="space-y-1">
        {preview.map(([k, v]) => (
          <li key={k} className="flex gap-2">
            <span className="text-muted-foreground shrink-0 w-32">{FIELD_LABELS[k] ?? k}:</span>
            <span className="font-medium text-foreground truncate">{String(v)}</span>
          </li>
        ))}
        {expanded && rest.map(([k, v]) => (
          <li key={k} className="flex gap-2">
            <span className="text-muted-foreground shrink-0 w-32">{FIELD_LABELS[k] ?? k}:</span>
            <span className="font-medium text-foreground truncate">{String(v)}</span>
          </li>
        ))}
      </ul>
      {rest.length > 0 && (
        <button
          onClick={() => setExpanded(e => !e)}
          className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
        >
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          {expanded ? 'Show less' : `+${rest.length} more fields`}
        </button>
      )}
      <div className="flex gap-2 pt-1">
        <button
          onClick={onApply}
          className="flex-1 flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90"
          style={{ background: 'linear-gradient(135deg, hsl(var(--accent)), hsl(var(--primary)))' }}
        >
          <Check className="h-3.5 w-3.5" />
          Apply to campaign
        </button>
        <button
          onClick={onDismiss}
          className="px-3 rounded-lg border border-border/50 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

interface Props {
  formData: AdCreativeFormData;
  onApplySuggestions: (suggestions: Partial<AdCreativeFormData>) => void;
}

export function CampaignSetupAssistant({ formData, onApplySuggestions }: Props) {
  const { user } = useAuth();
  const [isOpen, setIsOpen]     = useState(false);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput]     = useState('');
  const [isLoading, setIsLoading]     = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const [pendingSuggestions, setPendingSuggestions] = useState<Record<string, unknown> | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLTextAreaElement>(null);
  const timerRef  = useRef<number | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chatHistory, isLoading, pendingSuggestions]);

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
        message: msg,
        history: chatHistory,
        current_form: formData as unknown as Record<string, unknown>,
      });

      if (res.type === 'suggestions') {
        setPendingSuggestions(res.suggestions);
      }
      animateReply(res.message || 'Done!');
    } catch (err: any) {
      animateReply('Sorry, something went wrong. Please try again.');
      toast.error(err.message || 'Assistant error.');
    } finally {
      setIsLoading(false);
    }
  };

  const applyPending = () => {
    if (!pendingSuggestions) return;
    onApplySuggestions(pendingSuggestions as Partial<AdCreativeFormData>);
    setPendingSuggestions(null);
    toast.success('Campaign fields updated!');
    setChatHistory(prev => [...prev, {
      role: 'assistant',
      content: '✅ Applied! Check and adjust the form fields as needed. What else would you like to refine?',
    }]);
  };

  return (
    <>
      {/* Floating trigger — bottom-left to avoid conflict with global chat */}
      <button
        onClick={() => setIsOpen(v => !v)}
        aria-label="Campaign setup assistant"
        className="fixed bottom-6 left-6 z-40 h-12 w-12 rounded-full shadow-xl flex items-center justify-center text-white transition-all duration-200 hover:scale-105 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
        style={{ background: 'linear-gradient(135deg, hsl(var(--primary)), hsl(var(--accent) / 0.8))' }}
        title="Campaign setup assistant"
      >
        <Bot className="h-5 w-5" />
      </button>

      {/* Chat panel */}
      {isOpen && (
        <div className="fixed bottom-24 left-3 sm:left-6 z-40 flex flex-col rounded-2xl border border-border/50 bg-card/95 backdrop-blur-md shadow-2xl overflow-hidden w-[min(340px,calc(100vw-1.5rem))] h-[520px] max-h-[calc(100dvh-7.5rem)]">
          {/* Header */}
          <div
            className="flex items-center gap-2.5 px-4 py-3 text-white shrink-0"
            style={{ background: 'linear-gradient(135deg, hsl(var(--primary) / 0.9), hsl(var(--accent) / 0.85))' }}
          >
            <Bot className="h-4 w-4 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold leading-tight">Campaign Setup Wizard</p>
              <p className="text-[10px] opacity-75 leading-tight">Powered by Gemini AI</p>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="shrink-0 h-7 w-7 rounded-full flex items-center justify-center bg-white/10 hover:bg-white/25 transition-colors"
              aria-label="Close"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3 min-h-0">
            {chatHistory.length === 0 && (
              <div className="py-2 space-y-3">
                <p className="text-xs text-muted-foreground/70 text-center">
                  I'll guide you through setting up your campaign. Just tell me about your product!
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
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
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
              </div>
            ))}

            {isLoading && <TypingIndicator />}

            {/* Suggestion card — shown after suggestions arrive and animation finishes */}
            {pendingSuggestions && !isAnimating && !isLoading && (
              <SuggestionCard
                suggestions={pendingSuggestions}
                onApply={applyPending}
                onDismiss={() => setPendingSuggestions(null)}
              />
            )}
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
                placeholder="Describe your product or ask anything…"
                rows={2}
                disabled={isLoading || isAnimating}
                className="flex-1 resize-none rounded-xl border border-border/50 bg-background/60 px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-muted-foreground/50 disabled:opacity-60"
              />
              <button
                onClick={() => handleSend()}
                disabled={!chatInput.trim() || isLoading || isAnimating}
                className="shrink-0 h-9 w-9 rounded-xl flex items-center justify-center text-white transition-opacity disabled:opacity-40 hover:opacity-90"
                style={{ background: 'linear-gradient(135deg, hsl(var(--primary)), hsl(var(--accent)))' }}
                aria-label="Send"
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
