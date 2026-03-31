import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Copy, Check, ArrowLeft, Clock, Search, Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';

interface PromptRecord {
  id: string;
  business_name: string | null;
  prompt_text: string;
  created_at: string;
}

export default function History() {
  const [prompts, setPrompts] = useState<PromptRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      document.documentElement.style.setProperty('--mouse-x', `${e.clientX}px`);
      document.documentElement.style.setProperty('--mouse-y', `${e.clientY}px`);
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  useEffect(() => {
    loadPrompts();
  }, []);

  const loadPrompts = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('generated_prompts')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      toast.error('Failed to load history');
      console.error(error);
    } else {
      setPrompts(data || []);
    }
    setLoading(false);
  };

  const handleCopy = (prompt: PromptRecord) => {
    navigator.clipboard.writeText(prompt.prompt_text);
    setCopiedId(prompt.id);
    setTimeout(() => setCopiedId(null), 2000);
    toast.success('Prompt copied!');
  };

  const filtered = prompts.filter(p => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (p.business_name?.toLowerCase().includes(q)) || p.prompt_text.toLowerCase().includes(q);
  });

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="min-h-screen bg-background relative">
      <div className="reactive-bg" />
      <header className="border-b border-border/50 px-6 py-[13px] relative z-10">
        <div className="mx-auto max-w-6xl flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src="/images/logo-small.png" alt="Logo" className="h-8 w-auto" />
            <img src="/images/logo.png" alt="Forge" className="h-7 w-auto" />
          </div>
          <Link to="/">
            <Button variant="ghost" size="sm" className="gap-2">
              <ArrowLeft className="h-4 w-4" /> Back to Generator
            </Button>
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-8 relative z-10">
        <div className="mb-8">
          <h1 className="font-display text-3xl font-bold tracking-tight text-foreground">
            Prompt History
          </h1>
          <p className="mt-2 text-muted-foreground">
            Browse and reuse previously generated prompts
          </p>
        </div>

        <div className="mb-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by business name or content..."
              className="pl-10"
            />
          </div>
        </div>

        {loading ? (
          <div className="text-center py-16">
            <div className="h-8 w-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-muted-foreground text-sm">Loading history...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 glass-card rounded-xl">
            <Clock className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
            <p className="text-muted-foreground">
              {search ? 'No prompts match your search' : 'No prompts generated yet'}
            </p>
            {!search && (
              <Link to="/">
                <Button variant="outline" className="mt-4 gap-2">
                  Create your first prompt
                </Button>
              </Link>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {filtered.map(prompt => (
              <div key={prompt.id} className="glass-card rounded-xl p-5 transition-all hover:border-primary/30">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1">
                      <h3 className="font-medium text-foreground text-sm truncate">
                        {prompt.business_name || 'Untitled'}
                      </h3>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {formatDate(prompt.created_at)}
                      </span>
                    </div>
                    <p
                      className={`text-xs text-muted-foreground cursor-pointer ${expandedId === prompt.id ? '' : 'line-clamp-2'}`}
                      onClick={() => setExpandedId(expandedId === prompt.id ? null : prompt.id)}
                    >
                      {prompt.prompt_text}
                    </p>
                    {expandedId !== prompt.id && (
                      <button
                        onClick={() => setExpandedId(prompt.id)}
                        className="text-xs text-primary hover:underline mt-1"
                      >
                        Show full prompt
                      </button>
                    )}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button variant="outline" size="sm" onClick={() => handleCopy(prompt)} className="gap-1.5">
                      {copiedId === prompt.id ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                      {copiedId === prompt.id ? 'Copied' : 'Copy'}
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
