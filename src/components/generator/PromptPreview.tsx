import { useState } from 'react';
import { Eye, EyeOff, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  prompt: string;
}

export function PromptPreview({ prompt }: Props) {
  const [expanded, setExpanded] = useState(false);

  const charCount = prompt.length;
  const wordCount = prompt.split(/\s+/).filter(Boolean).length;

  return (
    <div className="rounded-xl border border-border/60 bg-card/30 backdrop-blur-sm overflow-hidden transition-all">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-4 hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <FileText className="h-4 w-4 text-primary" />
          </div>
          <div className="text-left">
            <p className="text-sm font-medium text-foreground">Live Prompt Preview</p>
            <p className="text-xs text-muted-foreground">{wordCount} words · {charCount} chars</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {expanded ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4 text-muted-foreground" />}
          <span className="text-xs text-muted-foreground">{expanded ? 'Hide' : 'Show'}</span>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border/40 p-4">
          <pre className="bg-muted/50 rounded-lg p-4 text-xs text-foreground/70 whitespace-pre-wrap overflow-auto max-h-64 font-mono leading-relaxed">
            {prompt}
          </pre>
        </div>
      )}
    </div>
  );
}
