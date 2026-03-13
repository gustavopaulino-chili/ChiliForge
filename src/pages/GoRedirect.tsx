import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, AlertCircle, ExternalLink, Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function GoRedirect() {
  const { id } = useParams<{ id: string }>();
  const [status, setStatus] = useState<'loading' | 'redirecting' | 'error'>('loading');
  const [prompt, setPrompt] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!id) {
      setStatus('error');
      return;
    }

    const fetchAndRedirect = async () => {
      const { data, error } = await supabase
        .from('generated_prompts')
        .select('prompt_text')
        .eq('id', id)
        .single();

      if (error || !data) {
        setStatus('error');
        return;
      }

      setPrompt(data.prompt_text);
      setStatus('redirecting');

      const lovableUrl = `https://lovable.dev/projects/create#prompt=${encodeURIComponent(data.prompt_text)}`;
      window.location.href = lovableUrl;
    };

    fetchAndRedirect();
  }, [id]);

  const handleCopy = () => {
    navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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

        {status === 'redirecting' && (
          <>
            <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto" />
            <p className="text-foreground font-medium">Redirecting to Lovable...</p>
            <p className="text-sm text-muted-foreground">If you're not redirected automatically:</p>
            <div className="flex gap-2 justify-center">
              <Button variant="outline" size="sm" onClick={handleCopy} className="gap-2">
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied ? 'Copied!' : 'Copy Prompt'}
              </Button>
              <a
                href={`https://lovable.dev/projects/create#prompt=${encodeURIComponent(prompt)}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button size="sm" className="gap-2">
                  <ExternalLink className="h-4 w-4" /> Open Lovable
                </Button>
              </a>
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
