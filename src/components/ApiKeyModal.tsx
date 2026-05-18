import { useState, useEffect, useCallback } from 'react';
import { Copy, Check, Key, Loader2, X, Code2, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

type ApiKeyData = {
  api_key: string;
  label: string;
  created_at: string;
  requests_count: number;
  last_used_at: string | null;
  created: boolean;
};

type Props = {
  open: boolean;
  onClose: () => void;
};

const CODE_CURL = (key: string, domain: string) =>
  `curl -X POST ${domain}/api/v1/ads/generate.php \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "brief": "Nike Air Max 270 — modern sportswear for young adults"
  }'`;

const CODE_JS = (key: string, domain: string) =>
  `const res = await fetch('${domain}/api/v1/ads/generate.php', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ${key}',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    brief: 'Nike Air Max 270 — modern sportswear for young adults',
  }),
});

const data = await res.json();
// data.banners[].image_url  → PNG ready to use
// data.banners[].html_url   → interactive HTML version
console.log(data.banners);`;

const CODE_PYTHON = (key: string, domain: string) =>
  `import requests

response = requests.post(
    '${domain}/api/v1/ads/generate.php',
    headers={
        'Authorization': 'Bearer ${key}',
        'Content-Type': 'application/json',
    },
    json={
        'brief': 'Nike Air Max 270 — modern sportswear for young adults',
    },
    timeout=120,
)

data = response.json()
for banner in data['banners']:
    print(banner['label'], banner['image_url'])`;

export function ApiKeyModal({ open, onClose }: Props) {
  const { user } = useAuth();
  const [keyData, setKeyData] = useState<ApiKeyData | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [tab, setTab] = useState<'curl' | 'js' | 'python'>('curl');

  const domain = window.location.origin;

  const fetchKey = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const res = await fetch('/api/getApiKey.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: user.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      setKeyData(data);
      if (data.created) toast.success('API key generated!');
    } catch (e: any) {
      toast.error(e.message || 'Could not load API key');
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    if (open && !keyData) fetchKey();
  }, [open, keyData, fetchKey]);

  const copyText = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  if (!open) return null;

  const codeSnippets: Record<typeof tab, string> = {
    curl: keyData ? CODE_CURL(keyData.api_key, domain) : '',
    js:   keyData ? CODE_JS(keyData.api_key, domain) : '',
    python: keyData ? CODE_PYTHON(keyData.api_key, domain) : '',
  };

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
              <Key className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-semibold leading-none">API Key</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Use our AI ad generation in your own projects</p>
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-6 py-5 flex flex-col gap-6">
          {/* Key display */}
          <div>
            <p className="text-sm font-medium text-foreground mb-2">Your API Key</p>
            {loading ? (
              <div className="h-11 rounded-lg border border-border bg-muted flex items-center justify-center">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : keyData ? (
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-muted border border-border rounded-lg px-4 py-2.5 text-sm font-mono truncate select-all">
                  {keyData.api_key}
                </code>
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0 gap-1.5"
                  onClick={() => copyText(keyData.api_key, 'key')}
                >
                  {copied === 'key' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied === 'key' ? 'Copied' : 'Copy'}
                </Button>
              </div>
            ) : (
              <Button onClick={fetchKey} variant="outline" className="gap-2">
                <Zap className="h-4 w-4" /> Generate key
              </Button>
            )}
            {keyData && (
              <p className="text-xs text-muted-foreground mt-1.5">
                {keyData.requests_count} request{keyData.requests_count !== 1 ? 's' : ''} made
                {keyData.last_used_at ? ` · Last used ${new Date(keyData.last_used_at).toLocaleDateString()}` : ''}
              </p>
            )}
          </div>

          {/* Endpoint info */}
          <div>
            <p className="text-sm font-medium text-foreground mb-2">Endpoint</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-muted border border-border rounded-lg px-4 py-2.5 text-sm font-mono truncate">
                POST {domain}/api/v1/ads/generate.php
              </code>
              <Button size="sm" variant="outline" className="shrink-0 gap-1.5" onClick={() => copyText(`${domain}/api/v1/ads/generate.php`, 'url')}>
                {copied === 'url' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied === 'url' ? 'Copied' : 'Copy'}
              </Button>
            </div>
          </div>

          {/* Request body */}
          <div>
            <p className="text-sm font-medium text-foreground mb-2">Request body</p>
            <div className="bg-muted border border-border rounded-lg p-4 text-xs font-mono text-muted-foreground space-y-1 leading-relaxed">
              <div><span className="text-foreground font-semibold">brief</span> <span className="text-primary">string</span> — Text describing the brand, product and audience. The AI extracts all campaign details automatically.</div>
              <div><span className="text-foreground font-semibold">form_data</span> <span className="text-primary">object</span> — Structured fields (brandName, productName, ctaText, logoUrl, brandColors…). Overrides anything extracted from the brief.</div>
              <div className="pt-1 text-muted-foreground/70">At least one of <span className="text-foreground">brief</span> or <span className="text-foreground">form_data</span> is required. Both can be combined.</div>
            </div>
          </div>

          {/* Response */}
          <div>
            <p className="text-sm font-medium text-foreground mb-2">Response</p>
            <div className="bg-muted border border-border rounded-lg p-4 text-xs font-mono text-muted-foreground leading-relaxed">
              <pre className="whitespace-pre-wrap">{`{
  "success": true,
  "campaign_url": "${domain}/projects/my-campaign/",
  "banners": [
    {
      "image_url": "${domain}/projects/my-campaign/images/b0.png",
      "html_url":  "${domain}/projects/my-campaign/b0/",
      "platform":  "instagram",
      "format":    "square",
      "label":     "Instagram Square 1080x1080",
      "width":     1080,
      "height":    1080
    }
    // ...more banners
  ]
}`}</pre>
            </div>
          </div>

          {/* Code examples */}
          {keyData && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Code2 className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm font-medium text-foreground">Code examples</p>
              </div>
              <div className="flex gap-1 mb-2">
                {(['curl', 'js', 'python'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                      tab === t
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {t === 'js' ? 'JavaScript' : t === 'python' ? 'Python' : 'cURL'}
                  </button>
                ))}
              </div>
              <div className="relative">
                <pre className="bg-[#0d1117] text-[#e6edf3] border border-border rounded-lg p-4 text-xs font-mono overflow-x-auto leading-relaxed whitespace-pre">
                  {codeSnippets[tab]}
                </pre>
                <button
                  onClick={() => copyText(codeSnippets[tab], 'code')}
                  className="absolute top-2 right-2 text-muted-foreground hover:text-foreground transition-colors bg-background/80 rounded-md p-1"
                >
                  {copied === 'code' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
              <p className="text-xs text-muted-foreground mt-2">Generation takes ~30–60 s. Set your HTTP client timeout accordingly.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
