import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, AlertCircle, ExternalLink, Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

export default function GoRedirect() {
  const { id } = useParams<{ id: string }>();
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [prompt, setPrompt] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!id) {
      setStatus('error');
      return;
    }

    const fetchPrompt = async () => {
      const { data, error } = await (supabase as any)
        .from('generated_prompts')
        .select('prompt_text')
        .eq('id', id)
        .maybeSingle();

      if (error || !data) {
        setStatus('error');
        return;
      }

      setPrompt(data.prompt_text);
      setStatus('ready');

      // Try to redirect automatically
      try {
        const lovableUrl = `https://lovable.dev/projects/create#prompt=${encodeURIComponent(data.prompt_text)}`;
        window.location.href = lovableUrl;
      } catch {
        // If redirect fails, user can use buttons below
      }
    };

    fetchPrompt();
  }, [id]);

  const handleCopy = () => {
    navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success('Prompt copied! Paste it into Lovable.');
  };

  const handleOpen = () => {
    const url = `https://lovable.dev/projects/create#prompt=${encodeURIComponent(prompt)}`;
    const w = window.open('', '_blank');
    if (w) {
      w.location.href = url;
    } else {
      handleCopy();
      toast.info('Popup blocked — prompt copied to clipboard. Paste it into lovable.dev');
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6">
      <div className="max-w-md w-full text-center space-y-6">
        {status === 'loading' && (
          <>
            <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto" />
            <p className="text-foreground font-medium">Loading prompt...</p>
          </>
        )}

        {status === 'ready' && (
          <>
            <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto" />
            <p className="text-foreground font-medium">Redirecting to Lovable...</p>
            <p className="text-sm text-muted-foreground">If you're not redirected automatically:</p>
            <div className="flex gap-2 justify-center">
              <Button variant="outline" size="sm" onClick={handleCopy} className="gap-2">
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied ? 'Copied!' : 'Copy Prompt'}
              </Button>
              <Button size="sm" className="gap-2" onClick={handleOpen}>
                <ExternalLink className="h-4 w-4" /> Open Lovable
              </Button>
            </div>
          </>
        )}

        {status === 'error' && (
          <>
            <AlertCircle className="h-10 w-10 text-destructive mx-auto" />
            <p className="text-foreground font-medium">Prompt not found</p>
            <p className="text-sm text-muted-foreground">This link may have expired or is invalid.</p>
            <a href="/">
              <Button variant="outline">Back to Generator</Button>
            </a>
          </>
        )}
      </div>
    </div>
  );
}
