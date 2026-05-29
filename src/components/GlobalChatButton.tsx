import { useState, useRef, useEffect } from 'react';
import { MessageCircle, X, Send, Loader2, Sparkles } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useLocation } from 'react-router-dom';
import { globalChat, ChatMessage } from '@/services/api';
import { toast } from 'sonner';

const STARTER_PROMPTS = [
  'How do I fill in the Ad form?',
  'What formats should I use for Instagram?',
  "What's the difference between objective and funnel stage?",
  'When should I enable A/B testing?',
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

export function GlobalChatButton() {
  const { user } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const animationTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chatHistory, isLoading, isAnimating]);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [isOpen]);

  useEffect(() => {
    return () => {
      if (animationTimerRef.current) window.clearInterval(animationTimerRef.current);
    };
  }, []);

  const { pathname } = useLocation();
  // On /ad-creatives the CampaignSetupAssistant replaces the global chat
  if (!user?.id || pathname.startsWith('/ad-creatives')) return null;

  const animateAssistantMessage = (content: string) => {
    if (animationTimerRef.current) window.clearInterval(animationTimerRef.current);

    const fullText = content || 'I do not have a response for that yet.';
    let index = 0;
    setIsAnimating(true);
    setChatHistory(prev => [...prev, { role: 'assistant', content: '' }]);

    animationTimerRef.current = window.setInterval(() => {
      index = Math.min(fullText.length, index + 3);
      const visibleText = fullText.slice(0, index);

      setChatHistory(prev => {
        const next = [...prev];
        const lastIndex = next.length - 1;
        if (lastIndex >= 0 && next[lastIndex].role === 'assistant') {
          next[lastIndex] = { ...next[lastIndex], content: visibleText };
        }
        return next;
      });

      if (index >= fullText.length) {
        if (animationTimerRef.current) window.clearInterval(animationTimerRef.current);
        animationTimerRef.current = null;
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
      const res = await globalChat({
        user_id: user.id,
        message: msg,
        history: chatHistory,
      });
      animateAssistantMessage(res.message);
    } catch (err: any) {
      toast.error(err.message || 'Chat error. Please try again.');
      animateAssistantMessage('Sorry, something went wrong. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      {/* Floating toggle button — hidden while panel is open */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          aria-label="Open ChiliForge assistant"
          className="fixed bottom-6 right-6 z-50 h-14 w-14 rounded-full shadow-xl flex items-center justify-center text-white transition-all duration-200 hover:scale-105 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
          style={{ background: 'linear-gradient(135deg, hsl(var(--accent)), hsl(var(--primary)))' }}
        >
          <MessageCircle className="h-6 w-6" />
        </button>
      )}

      {/* Chat panel — sits at bottom-6 since button is hidden when open */}
      {isOpen && (
        <div
          className="fixed bottom-6 right-3 sm:right-6 z-50 flex flex-col rounded-2xl border border-border/50 bg-card/95 backdrop-blur-md shadow-2xl overflow-hidden w-[min(340px,calc(100vw-1.5rem))] h-[520px] max-h-[calc(100dvh-2rem)]"
        >
          {/* Header */}
          <div
            className="flex items-center gap-2.5 px-4 py-3 text-white shrink-0"
            style={{ background: 'linear-gradient(135deg, hsl(var(--accent) / 0.9), hsl(var(--primary) / 0.9))' }}
          >
            <Sparkles className="h-4 w-4 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold leading-tight">Chilito</p>
              <p className="text-[10px] opacity-75 leading-tight">Assistente ChiliForge</p>
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
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
            {chatHistory.length === 0 && (
              <div className="py-2 space-y-3">
                <p className="text-xs text-muted-foreground/70 text-center">
                  Ask me anything about ChiliForge or your campaigns.
                </p>
                <div className="space-y-1.5">
                  {STARTER_PROMPTS.map(prompt => (
                    <button
                      key={prompt}
                      onClick={() => handleSend(prompt)}
                      disabled={isLoading || isAnimating}
                      className="block w-full text-left text-xs rounded-xl border border-border/40 bg-background/40 px-3 py-2 hover:border-primary/40 hover:bg-primary/5 transition-colors disabled:opacity-50"
                    >
                      {prompt}
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
                    ? { background: 'linear-gradient(135deg, hsl(var(--accent) / 0.85), hsl(var(--primary) / 0.85))' }
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
          </div>

          {/* Input */}
          <div className="border-t border-border/40 px-3 py-3 shrink-0">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder="Ask anything…"
                rows={2}
                disabled={isLoading || isAnimating}
                className="flex-1 resize-none rounded-xl border border-border/50 bg-background/60 px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-muted-foreground/50 disabled:opacity-60"
              />
              <button
                onClick={() => handleSend()}
                disabled={!chatInput.trim() || isLoading || isAnimating}
                className="shrink-0 h-9 w-9 rounded-xl flex items-center justify-center text-white transition-opacity disabled:opacity-40 hover:opacity-90"
                style={{ background: 'linear-gradient(135deg, hsl(var(--accent)), hsl(var(--primary)))' }}
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
