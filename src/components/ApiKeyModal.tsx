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
  `curl -X POST ${domain}/api/v1/external/generate-ads.php \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "phone": "+5511999999999",
    "gemini_api_key": "AIza...",
    "generate_as_image": false,
    "company": {
      "name": "Marca X",
      "primary_color": "#FF0000",
      "logo_url": "https://example.com/logo.png"
    },
    "campaign": {
      "name": "Campanha Verão",
      "objective": "conversão",
      "offer": "30% off",
      "cta_text": "Comprar Agora",
      "product_image_url": "https://example.com/product.jpg"
    },
    "formats": ["instagram-feed-square", "instagram-story"]
  }'`;

const CODE_JS = (key: string, domain: string) =>
  `// 1. Start the job (returns 202 in <5s)
const res = await fetch('${domain}/api/v1/external/generate-ads.php', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer ${key}', 'Content-Type': 'application/json' },
  body: JSON.stringify({
    phone: '+5511999999999',
    gemini_api_key: 'AIza...',   // your Gemini key — omit to use platform default
    generate_as_image: false,    // true → rendered PNG, false → HTML
    company: { name: 'Marca X', primary_color: '#FF0000' },
    campaign: { name: 'Campanha Verão', offer: '30% off', cta_text: 'Comprar Agora' },
    formats: ['instagram-feed-square', 'instagram-story'],
  }),
});
const { job_id } = await res.json(); // res.status === 202

// 2. Poll until completed
let creatives = [];
while (true) {
  await new Promise(r => setTimeout(r, 8000));
  const poll = await fetch(
    \`${domain}/api/v1/external/job-status.php?api_key=${key}&job_id=\${job_id}\`
  );
  const status = await poll.json();
  if (status.status === 'completed') { creatives = status.creatives; break; }
  if (status.status === 'failed')    { throw new Error(status.error); }
}
console.log(creatives); // creatives[].html_url / image_url`;

const CODE_PYTHON = (key: string, domain: string) =>
  `import requests

response = requests.post(
    '${domain}/api/v1/external/generate-ads.php',
    headers={
        'Authorization': 'Bearer ${key}',
        'Content-Type': 'application/json',
    },
    json={
        'phone': '+5511999999999',
        'gemini_api_key': 'AIza...',    # your Gemini key — omit to use platform default
        'generate_as_image': False,     # True → rendered PNG, False → HTML
        'company': {'name': 'Marca X', 'primary_color': '#FF0000'},
        'campaign': {'name': 'Campanha Verão', 'offer': '30% off', 'cta_text': 'Comprar Agora'},
        'formats': ['instagram-feed-square', 'instagram-story'],
    },
    timeout=300,
)

data = response.json()
job_id = data['job_id']  # poll /api/v1/external/job-status.php?job_id={job_id}
print('Job started:', job_id)`;

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

          {/* Endpoints */}
          <div>
            <p className="text-sm font-medium text-foreground mb-2">Endpoints</p>
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="shrink-0 text-xs font-bold text-primary bg-primary/10 rounded px-1.5 py-0.5">POST</span>
                <code className="flex-1 bg-muted border border-border rounded-lg px-3 py-2 text-xs font-mono truncate">
                  {domain}/api/v1/external/generate-ads.php
                </code>
                <Button size="sm" variant="outline" className="shrink-0 gap-1.5 h-8" onClick={() => copyText(`${domain}/api/v1/external/generate-ads.php`, 'url')}>
                  {copied === 'url' ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <span className="shrink-0 text-xs font-bold text-green-600 bg-green-500/10 rounded px-1.5 py-0.5">GET</span>
                <code className="flex-1 bg-muted border border-border rounded-lg px-3 py-2 text-xs font-mono truncate">
                  {domain}/api/v1/external/job-status.php?api_key=…&job_id=…
                </code>
                <Button size="sm" variant="outline" className="shrink-0 gap-1.5 h-8" onClick={() => copyText(`${domain}/api/v1/external/job-status.php`, 'url2')}>
                  {copied === 'url2' ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">The POST returns <code className="text-foreground">202</code> instantly with a <code className="text-foreground">job_id</code>. Poll the GET endpoint every 5–10 s until <code className="text-foreground">status = "completed"</code> — then read <code className="text-foreground">creatives[]</code>.</p>
            </div>
          </div>

          {/* Request body */}
          <div>
            <p className="text-sm font-medium text-foreground mb-2">Request body</p>
            <div className="bg-muted border border-border rounded-lg p-4 text-xs font-mono text-muted-foreground space-y-1 leading-relaxed">
              <div><span className="text-foreground font-semibold">phone</span> <span className="text-primary">string*</span> — Company phone number. Same phone reuses the existing brand store.</div>
              <div><span className="text-foreground font-semibold">company</span> <span className="text-primary">object*</span> — Brand data: name, industry, description, primary_color, logo_url, tone_of_voice…</div>
              <div><span className="text-foreground font-semibold">campaign</span> <span className="text-primary">object*</span> — Campaign data: name, objective, offer, cta_text, product_image_url, funnel_stage…</div>
              <div><span className="text-foreground font-semibold">formats</span> <span className="text-primary">string[]*</span> — Preset names: instagram-feed-square, instagram-story, facebook-feed-square, tiktok-feed…</div>
              <div><span className="text-foreground font-semibold">gemini_api_key</span> <span className="text-muted-foreground">string</span> — Your Google Gemini API key. When provided, generation uses your key and quota.</div>
              <div><span className="text-foreground font-semibold">generate_as_image</span> <span className="text-muted-foreground">boolean</span> — <code className="text-foreground">true</code> to get rendered PNG images, <code className="text-foreground">false</code> (default) for HTML creatives.</div>
              <div className="pt-1 text-muted-foreground/70">* required fields</div>
            </div>
          </div>

          {/* Response */}
          <div>
            <p className="text-sm font-medium text-foreground mb-2">Response — POST generate-ads</p>
            <div className="bg-muted border border-border rounded-lg p-4 text-xs font-mono text-muted-foreground leading-relaxed">
              <pre className="whitespace-pre-wrap">{`{
  "job_id": 123,
  "status": "completed",
  "company_id": 456,
  "campaign_id": 789,
  "creative_count": 2,
  "creatives": [
    {
      "id": 1,
      "platform": "instagram",
      "format": "square",
      "label": "Instagram Feed Square",
      "width": 1080,
      "height": 1080,
      "html_url":  "${domain}/projects/marca-x/campanha-verao/1/index.html",
      "image_url": "${domain}/projects/marca-x/campanha-verao/1/banner.png"
    }
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
              <p className="text-xs text-muted-foreground mt-2">POST returns 202 in &lt;5 s. Generation takes ~60–300 s. Poll job-status every 5–10 s until <code>status = "completed"</code>.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
