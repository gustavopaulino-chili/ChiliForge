import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Copy, Check, ArrowLeft, Clock, Search, ExternalLink, Link2, Download, Eye, Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';

interface PromptRecord {
  id: string;
  business_name: string | null;
  prompt_text: string;
  created_at: string;
  html_file_name: string | null;
}

export default function History() {
  const [prompts, setPrompts] = useState<PromptRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedLinkId, setCopiedLinkId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

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
    const { data, error } = await (supabase
      .from('generated_prompts')
      .select('*') as any)
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

  const handleCopyPrompt = (prompt: PromptRecord) => {
    navigator.clipboard.writeText(prompt.prompt_text);
    setCopiedId(prompt.id);
    setTimeout(() => setCopiedId(null), 2000);
    toast.success('Prompt copied!');
  };

  const getPreviewUrl = (fileName: string) => {
    return `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/render-landing-preview?file=${encodeURIComponent(fileName)}`;
  };

  const handleCopyLink = (prompt: PromptRecord) => {
    if (!prompt.html_file_name) return;
    const url = getPreviewUrl(prompt.html_file_name);
    navigator.clipboard.writeText(url);
    setCopiedLinkId(prompt.id);
    setTimeout(() => setCopiedLinkId(null), 2000);
    toast.success('Preview URL copied!');
  };

  const handleOpenNewTab = (prompt: PromptRecord) => {
    if (!prompt.html_file_name) return;
    if (previewHtml && previewId === prompt.id) {
      const blob = new Blob([previewHtml], { type: 'text/html' });
      const blobUrl = URL.createObjectURL(blob);
      window.open(blobUrl, '_blank', 'noopener,noreferrer');
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
    } else {
      window.open(getPreviewUrl(prompt.html_file_name), '_blank', 'noopener,noreferrer');
    }
  };

  const handleDownload = async (prompt: PromptRecord) => {
    if (!prompt.html_file_name) return;
    try {
      const { data, error } = await supabase.storage.from('landing-pages').download(prompt.html_file_name);
      if (error || !data) {
        toast.error('Failed to download file');
        return;
      }
      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url;
      a.download = prompt.html_file_name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      toast.error('Download failed');
    }
  };

  const handleDelete = async (prompt: PromptRecord) => {
    if (!confirm('Tem certeza que deseja excluir este registro?')) return;
    const { error } = await (supabase.from('generated_prompts').delete() as any).eq('id', prompt.id);
    if (error) {
      toast.error('Falha ao excluir');
    } else {
      setPrompts(prev => prev.filter(p => p.id !== prompt.id));
      if (previewId === prompt.id) { setPreviewId(null); setPreviewHtml(null); }
      toast.success('Registro excluído!');
    }
  };

  const handleTogglePreview = async (prompt: PromptRecord) => {
    if (previewId === prompt.id) {
      setPreviewId(null);
      setPreviewHtml(null);
      return;
    }
    if (!prompt.html_file_name) return;

    setPreviewId(prompt.id);
    setLoadingPreview(true);
    setPreviewHtml(null);

    try {
      const { data, error } = await supabase.storage.from('landing-pages').download(prompt.html_file_name);
      if (error || !data) {
        toast.error('Failed to load preview');
        setPreviewId(null);
      } else {
        const html = await data.text();
        setPreviewHtml(html);
      }
    } catch {
      toast.error('Failed to load preview');
      setPreviewId(null);
    } finally {
      setLoadingPreview(false);
    }
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

  // Full-screen preview mode
  if (previewId && previewHtml) {
    const activePrompt = prompts.find(p => p.id === previewId);
    return (
      <div className="min-h-screen bg-background relative flex flex-col">
        <div className="reactive-bg" />
        <header className="border-b border-border/50 px-6 py-[13px] relative z-10">
          <div className="mx-auto max-w-6xl flex items-center justify-between">
            <div className="flex items-center gap-2">
              <img src="/images/logo-small.png" alt="Logo" className="h-8 w-auto" />
              <img src="/images/logo.png" alt="Forge" className="h-7 w-auto" />
            </div>
            <Button variant="ghost" size="sm" className="gap-2" onClick={() => { setPreviewId(null); setPreviewHtml(null); }}>
              <ArrowLeft className="h-4 w-4" /> Back to History
            </Button>
          </div>
        </header>

        <main className="flex-1 flex flex-col mx-auto max-w-6xl w-full px-6 py-6 relative z-10">
          <div className="text-center mb-4">
            <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">
              {activePrompt?.business_name || 'Landing Page'}
            </h2>
            <p className="mt-1 text-muted-foreground text-sm">
              {activePrompt ? formatDate(activePrompt.created_at) : ''}
            </p>
          </div>

          {/* Action bar — same as generation results */}
          <div className="flex flex-wrap items-center justify-center gap-3 mb-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => activePrompt && handleCopyLink(activePrompt)}
              className="gap-2"
            >
              {copiedLinkId === activePrompt?.id ? <Check className="h-4 w-4" /> : <Link2 className="h-4 w-4" />}
              {copiedLinkId === activePrompt?.id ? 'Copied!' : 'Copy Preview URL'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const blob = new Blob([previewHtml], { type: 'text/html' });
                const blobUrl = URL.createObjectURL(blob);
                window.open(blobUrl, '_blank', 'noopener,noreferrer');
                setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
              }}
              className="gap-2"
            >
              <ExternalLink className="h-4 w-4" /> Open in New Tab
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => activePrompt && handleDownload(activePrompt)}
              className="gap-2"
            >
              <Download className="h-4 w-4" /> Download HTML
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => activePrompt && handleCopyPrompt(activePrompt)}
              className="gap-2"
            >
              {copiedId === activePrompt?.id ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copiedId === activePrompt?.id ? 'Copied!' : 'Copy Prompt'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setPreviewId(null); setPreviewHtml(null); }}
              className="gap-2"
            >
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
          </div>

          {activePrompt?.html_file_name && (
            <div className="rounded-lg border border-border bg-muted/50 px-4 py-2 mb-4 flex items-center gap-2 max-w-2xl mx-auto w-full">
              <Link2 className="h-4 w-4 text-muted-foreground shrink-0" />
              <a
                href={getPreviewUrl(activePrompt.html_file_name)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-primary truncate hover:underline flex-1"
              >
                {getPreviewUrl(activePrompt.html_file_name)}
              </a>
            </div>
          )}

          <div className="flex-1 min-h-[500px] rounded-xl border border-border overflow-hidden bg-white shadow-lg">
            <iframe
              srcDoc={previewHtml}
              className="w-full h-full min-h-[500px]"
              style={{ minHeight: '70vh' }}
              title="Landing Page Preview"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            />
          </div>
        </main>
      </div>
    );
  }

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
            Browse and preview previously generated landing pages
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
                      {prompt.html_file_name && (
                        <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full shrink-0">
                          Has preview
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2">
                      {prompt.prompt_text}
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    {prompt.html_file_name && (
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() => handleTogglePreview(prompt)}
                        className="gap-1.5"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        View Site
                      </Button>
                    )}
                    <Button variant="outline" size="sm" onClick={() => handleCopyPrompt(prompt)} className="gap-1.5">
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
