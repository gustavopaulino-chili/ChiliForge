import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { deleteGlobalStoreFile, GlobalStoreFile, listGlobalStoreFiles, syncGlobalStore } from "@/services/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  Upload,
  FileText,
  CheckCircle,
  AlertCircle,
  Newspaper,
  Image as ImageIcon,
  Loader2,
  ArrowLeft,
  Trash2,
  Code,
  Copy,
  Check,
} from "lucide-react";

type StoreType = "lp" | "ads" | "ads_reference" | "ads_image_reference";
type ActiveTab = "stores" | "api";

type ApiKeyData = {
  api_key: string;
  label: string;
  created_at: string;
  requests_count: number;
  last_used_at: string | null;
  created?: boolean;
};

interface UploadState {
  uploading: boolean;
  progress: string | null;
  lastFile: string | null;
  error: string | null;
}

const ACCEPT = ".pdf,.txt,.html,.htm,.jpg,.jpeg,.png";
const MIME_LABELS: Record<string, string> = {
  "application/pdf": "PDF",
  "text/plain": "TXT",
  "text/html": "HTML",
  "image/jpeg": "JPEG",
  "image/png": "PNG",
};

function formatBytes(value: number | null) {
  if (!value) return "0 KB";
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

function DropZone({
  storeType,
  label,
  description,
  icon: Icon,
  userId,
}: {
  storeType: StoreType;
  label: string;
  description: string;
  icon: React.ElementType;
  userId: number;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [textContent, setTextContent] = useState("");
  const [mode, setMode] = useState<"file" | "text">("file");
  const [state, setState] = useState<UploadState>({
    uploading: false,
    progress: null,
    lastFile: null,
    error: null,
  });
  const [files, setFiles] = useState<GlobalStoreFile[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const { toast } = useToast();

  const loadFiles = async () => {
    setLoadingFiles(true);
    try {
      const result = await listGlobalStoreFiles({ user_id: userId, store_type: storeType });
      setFiles(result.files || []);
    } catch (e: any) {
      toast({ title: "Error listing files", description: e?.message ?? "Failed to load files", variant: "destructive" });
    } finally {
      setLoadingFiles(false);
    }
  };

  useEffect(() => {
    loadFiles();
  }, [storeType, userId]);

  const handleUpload = async (filesToUpload?: File[]) => {
    if (mode === "file" && (!filesToUpload?.length)) return;
    if (mode === "text" && !textContent.trim()) {
      toast({ title: "Enter content before uploading", variant: "destructive" });
      return;
    }

    setState({ uploading: true, progress: null, lastFile: null, error: null });

    try {
      if (mode === "text") {
        const fd = new FormData();
        fd.append("user_id", String(userId));
        fd.append("store_type", storeType);
        if (displayName.trim()) fd.append("display_name", displayName.trim());
        fd.append("text", textContent.trim());
        const res = await syncGlobalStore(fd);
        if (!res.success) throw new Error((res as any).error ?? "Unknown error");
        setState({ uploading: false, progress: null, lastFile: "text content", error: null });
        setDisplayName("");
        setTextContent("");
        loadFiles();
        toast({ title: `Text added to the ${label} store` });
        return;
      }

      const files = filesToUpload!;
      let lastUploaded = "";
      const errors: string[] = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setState((prev) => ({
          ...prev,
          progress: files.length > 1 ? `Uploading ${i + 1} of ${files.length}: ${file.name}` : `Uploading ${file.name}…`,
        }));

        try {
          const fd = new FormData();
          fd.append("user_id", String(userId));
          fd.append("store_type", storeType);
          fd.append("file", file);
          const res = await syncGlobalStore(fd);
          if (!res.success) throw new Error((res as any).error ?? "Unknown error");
          lastUploaded = file.name;
        } catch (e: any) {
          errors.push(`${file.name}: ${e?.message ?? "failed"}`);
        }
      }

      await loadFiles();

      if (errors.length === files.length) {
        throw new Error(errors.join("; "));
      }

      const successCount = files.length - errors.length;
      const summary = files.length === 1
        ? `"${lastUploaded}" added to the ${label} store`
        : `${successCount} of ${files.length} files added to the ${label} store`;

      setState({ uploading: false, progress: null, lastFile: files.length === 1 ? lastUploaded : `${successCount} files`, error: errors.length ? errors.join("; ") : null });
      toast({ title: summary, variant: errors.length ? "destructive" : "default" });
    } catch (e: any) {
      const msg = e?.message ?? "Upload failed";
      setState({ uploading: false, progress: null, lastFile: null, error: msg });
      toast({ title: "Error", description: msg, variant: "destructive" });
    }
  };

  const ACCEPTED_EXTS = [".pdf", ".txt", ".html", ".htm", ".jpg", ".jpeg", ".png"];

  const filterAccepted = (files: File[]) =>
    files.filter((f) => ACCEPTED_EXTS.some((ext) => f.name.toLowerCase().endsWith(ext)));

  async function readEntryFiles(entry: FileSystemEntry): Promise<File[]> {
    if (entry.isFile) {
      return new Promise((resolve) => {
        (entry as FileSystemFileEntry).file((f) => resolve([f]), () => resolve([]));
      });
    }
    if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      const entries = await new Promise<FileSystemEntry[]>((resolve) => {
        reader.readEntries(resolve, () => resolve([]));
      });
      const nested = await Promise.all(entries.map(readEntryFiles));
      return nested.flat();
    }
    return [];
  }

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = filterAccepted(Array.from(e.target.files ?? []));
    if (files.length) handleUpload(files);
    e.target.value = "";
  };

  const onFolderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = filterAccepted(Array.from(e.target.files ?? []));
    if (files.length) handleUpload(files);
    e.target.value = "";
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    setMode("file");

    const items = Array.from(e.dataTransfer.items);
    const entries = items.map((item) => item.webkitGetAsEntry?.()).filter((entry): entry is FileSystemEntry => Boolean(entry));

    if (entries.length) {
      const allFiles = (await Promise.all(entries.map(readEntryFiles))).flat();
      const accepted = filterAccepted(allFiles);
      if (accepted.length) handleUpload(accepted);
    } else {
      const files = filterAccepted(Array.from(e.dataTransfer.files));
      if (files.length) handleUpload(files);
    }
  };

  const handleDelete = async (file: GlobalStoreFile) => {
    setDeletingId(file.id);
    try {
      await deleteGlobalStoreFile({ user_id: userId, store_type: storeType, file_id: file.id });
      setFiles((current) => current.filter((item) => item.id !== file.id));
      toast({ title: `"${file.display_name}" removed from the ${label} store` });
    } catch (e: any) {
      toast({ title: "Removal failed", description: e?.message ?? "Failed to remove file", variant: "destructive" });
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="bg-card border rounded-xl p-6 space-y-5 flex flex-col">
      {/* Mode toggle */}
      <div className="flex gap-2">
        <button
          onClick={() => setMode("file")}
          className={`text-xs px-3 py-1 rounded-full border transition-colors ${
            mode === "file"
              ? "bg-primary text-primary-foreground border-primary"
              : "border-border text-muted-foreground hover:border-primary/50"
          }`}
        >
          File
        </button>
        <button
          onClick={() => setMode("text")}
          className={`text-xs px-3 py-1 rounded-full border transition-colors ${
            mode === "text"
              ? "bg-primary text-primary-foreground border-primary"
              : "border-border text-muted-foreground hover:border-primary/50"
          }`}
        >
          Text
        </button>
      </div>

      {/* Display name */}
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Display name (optional)</Label>
        <Input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder={`Example: ${label} guidelines v2`}
          className="h-8 text-sm"
          disabled={state.uploading}
        />
      </div>

      {mode === "file" ? (
        <>
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT}
            multiple
            className="hidden"
            onChange={onFileChange}
            disabled={state.uploading}
          />
          <input
            ref={folderRef}
            type="file"
            className="hidden"
            onChange={onFolderChange}
            disabled={state.uploading}
            {...({ webkitdirectory: "true", directory: "true" } as React.InputHTMLAttributes<HTMLInputElement>)}
          />
          <div
            className={`relative rounded-lg border-2 border-dashed p-8 flex flex-col items-center gap-3 cursor-pointer transition-all ${
              isDragging
                ? "border-primary bg-primary/5 scale-[1.02]"
                : state.uploading
                ? "border-muted cursor-default"
                : "border-muted-foreground/20 hover:border-primary/50 hover:bg-muted/30"
            }`}
            onClick={() => !state.uploading && fileRef.current?.click()}
            onDragEnter={() => setIsDragging(true)}
            onDragLeave={() => setIsDragging(false)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
          >
            {state.uploading ? (
              <Loader2 className="h-7 w-7 animate-spin text-primary" />
            ) : (
              <Upload className={`h-7 w-7 transition-colors ${isDragging ? "text-primary" : "text-muted-foreground"}`} />
            )}
            <div className="text-center">
              <p className="text-sm font-medium">
                {state.progress ?? (state.uploading ? "Uploading to store..." : "Drag or click to select files")}
              </p>
              <p className="text-xs text-muted-foreground mt-1">PDF · TXT · HTML · JPG · PNG · drag a folder to upload all at once</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => !state.uploading && folderRef.current?.click()}
            disabled={state.uploading}
            className="text-xs text-muted-foreground hover:text-primary transition-colors underline underline-offset-2 self-start disabled:opacity-40"
          >
            Or select a folder
          </button>
        </>
      ) : (
        <div className="space-y-2">
          <Textarea
            value={textContent}
            onChange={(e) => setTextContent(e.target.value)}
            placeholder="Paste guidelines, examples, or generation instructions here..."
            rows={6}
            className="text-sm resize-none"
            disabled={state.uploading}
          />
          <Button
            onClick={() => handleUpload()}
            disabled={state.uploading || !textContent.trim()}
            className="w-full"
            size="sm"
          >
            {state.uploading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Uploading...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4 mr-2" />
                Add to store
              </>
            )}
          </Button>
        </div>
      )}

      {/* Status */}
      {state.lastFile && (
        <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
          <CheckCircle className="h-4 w-4 shrink-0" />
          <span>
            <strong>{state.lastFile}</strong> added successfully
          </span>
        </div>
      )}
      {state.error && (
        <div className="flex items-start gap-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{state.error}</span>
        </div>
      )}

      <div className="border-t pt-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-medium">Uploaded files</h3>
          {loadingFiles && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>

        {!loadingFiles && files.length === 0 && (
          <p className="text-xs text-muted-foreground">No files in this store yet.</p>
        )}

        <div className="space-y-2">
          {files.map((file) => (
            <div key={file.id} className="flex items-center gap-3 rounded-lg border p-3">
              <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{file.display_name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {MIME_LABELS[file.mime_type] || file.mime_type} · {formatBytes(file.file_size_bytes)} · {formatDate(file.created_at)}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                onClick={() => handleDelete(file)}
                disabled={deletingId === file.id}
                title="Remove file"
              >
                {deletingId === file.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              </Button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CopyBlock({ code, language = "json" }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <div className="relative rounded-lg bg-muted/60 border text-xs font-mono overflow-x-auto">
      <button
        onClick={handleCopy}
        className="absolute top-2 right-2 p-1.5 rounded bg-background/80 hover:bg-background border text-muted-foreground hover:text-foreground transition-colors"
        title="Copy"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
      <pre className="p-4 pr-10 whitespace-pre-wrap break-all leading-relaxed text-foreground/90">{code}</pre>
    </div>
  );
}

const FORMAT_PRESETS = [
  { key: "instagram-feed-square",    label: "Instagram Feed Square",    dim: "1080×1080" },
  { key: "instagram-feed-landscape", label: "Instagram Feed Landscape", dim: "1080×566"  },
  { key: "instagram-story",          label: "Instagram Story",          dim: "1080×1920" },
  { key: "facebook-feed-square",     label: "Facebook Feed Square",     dim: "1080×1080" },
  { key: "facebook-story",           label: "Facebook Story",           dim: "1080×1920" },
  { key: "google-leaderboard",       label: "Google Leaderboard",       dim: "728×90"    },
  { key: "google-medium-rectangle",  label: "Google Medium Rectangle",  dim: "300×250"   },
  { key: "tiktok-feed",              label: "TikTok Feed",              dim: "1080×1920" },
];

function ApiAccessPanel({ userId }: { userId: number }) {
  const { toast } = useToast();
  const [keyData, setKeyData] = useState<ApiKeyData | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const loadKey = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/getApiKey.php", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to load API key");
      setKeyData(data);
      if (data?.created) toast({ title: "External API key generated" });
    } catch (e: any) {
      toast({
        title: "Could not load API key",
        description: e?.message || "Try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadKey();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const copyKey = async () => {
    if (!keyData?.api_key) return;
    await navigator.clipboard.writeText(keyData.api_key);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">Chave da API externa</h2>
          <p className="text-sm text-muted-foreground">
            Esta chave autentica a chamada na ChiliForge. A geracao de Ads pela API externa usa obrigatoriamente a
            <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">gemini_api_key</code>
            enviada no body, consumindo a cota Gemini do usuario da API.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={loadKey} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Atualizar"}
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <code className="flex-1 rounded-lg border bg-muted px-3 py-2 text-xs font-mono truncate">
          {loading ? "Carregando..." : keyData?.api_key || "Nenhuma chave encontrada"}
        </code>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={copyKey} disabled={!keyData?.api_key}>
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copiada" : "Copiar"}
        </Button>
      </div>

      {keyData && (
        <p className="text-xs text-muted-foreground">
          Requests: {keyData.requests_count}
          {keyData.last_used_at ? ` | Ultimo uso: ${formatDate(keyData.last_used_at)}` : ""}
        </p>
      )}
    </section>
  );
}

function ApiDocs() {
  const baseUrl = window.location.origin;
  const generateEndpoint = `${baseUrl}/api/v1/external/generate-ads.php`;
  const statusEndpoint   = `${baseUrl}/api/v1/external/job-status.php`;

  const generateExample = JSON.stringify({
    api_key: "cf_sua_chave_chiliforge",
    gemini_api_key: "AIza_sua_chave_gemini",
    generation_type: "image",
    phone: "+5511999999999",
    company: {
      name: "Velora Skin",
      industry: "Skincare",
      description: "Loja de roupas contemporâneas",
      primary_color: "#2563EB",
      secondary_color: "#111827",
      accent_color: "#F59E0B",
      logo_url: "https://exemplo.com/logo.png",
      brand_personality: "premium, confiavel, moderno",
      tone_of_voice: "jovem, direto e inspirador",
      target_audience: "Mulheres 20-35 anos",
      value_proposition: "Moda acessível com estilo",
    },
    campaign: {
      name: "Coleção Verão 2026",
      objective: "conversão",
      funnel_stage: "bottom",
      offer: "30% de desconto",
      cta_text: "Comprar Agora",
      product_image_url: "https://exemplo.com/produto.jpg",
      background_image_url: "https://exemplo.com/background.jpg",
      use_ai_copy: true,
      urgency_level: "high",
      preferred_style: "premium",
      creative_strategy: "offer-led",
      pain_points: "Pele opaca, rotina longa, medo de irritacao",
      desires: "Pele luminosa, compra segura, praticidade",
    },
    formats: ["instagram-feed-square", "instagram-story", "google-medium-rectangle"],
    source: "agency-dashboard",
    request_id: "req-uuid-001",
  }, null, 2);

  const curlExample = `curl -X POST ${generateEndpoint} \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer cf_sua_chave_chiliforge" \\
  -d '${JSON.stringify({ phone: "+5511999999999", company: { name: "Marca X" }, campaign: { name: "Camp", objective: "conversão", use_ai_copy: true }, formats: ["instagram-feed-square"] })}'`;

  const testCurlExample = `curl -X POST ${generateEndpoint} \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer cf_sua_chave_chiliforge" \\
  -d '${JSON.stringify({
    gemini_api_key: "AIza_sua_chave_gemini",
    generation_type: "image",
    phone: "+5511999999999",
    company: { name: "Velora Skin", industry: "Skincare", logo_url: "https://exemplo.com/logo.png" },
    campaign: { name: "Serum Glow Launch", objective: "conversao", offer: "20% off", cta_text: "Comprar Kit", product_image_url: "https://exemplo.com/produto.jpg", use_ai_copy: true },
    formats: ["instagram-feed-square", "instagram-story"]
  })}'`;

  const statusExample = `GET ${statusEndpoint}?api_key=cf_sua_chave_chiliforge&job_id=123`;

  const responseExample = JSON.stringify({
    job_id: 123,
    status: "running",
    status_url: `${statusEndpoint}?api_key=cf_sua_chave_chiliforge&job_id=123`,
    generation_type: "image",
    company_id: 456,
    campaign_id: 789,
    total_batches: 3,
  }, null, 2);

  const statusResponseExample = JSON.stringify({
    job_id: 123,
    status: "completed",
    generation_type: "image",
    company_id: 456,
    campaign_id: 789,
    creative_count: 2,
    creatives: [
      {
        id: 1,
        platform: "instagram",
        format: "square",
        label: "Instagram Feed Square",
        width: 1080,
        height: 1080,
        image_url: `${baseUrl}/projects/velora-skin/serum-glow-launch/1/banner.png`,
        html_url: `${baseUrl}/projects/velora-skin/serum-glow-launch/1/index.html`,
      },
    ],
    failed_batches: 0,
  }, null, 2);

  return (
    <div className="space-y-8">
      {/* Authentication */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold flex items-center gap-2">
          <span className="px-2 py-0.5 rounded bg-primary/10 text-primary text-xs font-mono">AUTH</span>
          Autenticação
        </h2>
        <p className="text-sm text-muted-foreground">
          A chave da API externa fica nesta aba. Envie no header ou no body.
        </p>
        <CopyBlock code={`Authorization: Bearer cf_sua_chave_chiliforge\n\n// Alternativa (no body):\n{ "api_key": "cf_sua_chave_chiliforge", "gemini_api_key": "AIza_sua_chave_gemini", ... }`} language="http" />
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
          <strong>Importante:</strong> a API externa nao usa mais nossa chave Gemini para gerar Ads. O cliente da API deve enviar
          <code className="mx-1 rounded bg-background/70 px-1 py-0.5 text-xs">gemini_api_key</code>
          e tambem escolher
          <code className="mx-1 rounded bg-background/70 px-1 py-0.5 text-xs">generation_type</code>
          como <code className="rounded bg-background/70 px-1 py-0.5 text-xs">html</code> ou
          <code className="ml-1 rounded bg-background/70 px-1 py-0.5 text-xs">image</code>.
        </div>
      </section>

      {/* Generate Ads */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold flex items-center gap-2">
          <span className="px-2 py-0.5 rounded bg-green-500/10 text-green-600 dark:text-green-400 text-xs font-mono">POST</span>
          Gerar Ads
        </h2>
        <CopyBlock code={generateEndpoint} language="text" />
        <p className="text-sm text-muted-foreground">
          Cria ou reutiliza a empresa pelo <code className="text-xs bg-muted px-1 rounded">phone</code>, cria nova campanha, executa o fluxo
          <strong> interpret → render</strong> e retorna os criativos prontos.
          Segunda chamada com o mesmo <code className="text-xs bg-muted px-1 rounded">phone</code> reutiliza a empresa e a store — apenas cria nova campanha.
        </p>
        <CopyBlock code={generateExample} />
        <div className="rounded-lg border p-4 space-y-2 text-sm">
          <p className="font-medium text-xs text-muted-foreground uppercase tracking-wide">Campos extras</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
            <div><code className="text-xs bg-muted px-1 rounded">gemini_api_key</code> — obrigatorio; usa a chave e a cota Gemini do usuario da API</div>
            <div><code className="text-xs bg-muted px-1 rounded">generation_type</code> — obrigatorio: <code>html</code> para criativos editaveis ou <code>image</code> para priorizar PNG</div>
            <div><code className="text-xs bg-muted px-1 rounded">force_sync: true</code> — força re-sync da store mesmo que a empresa já exista</div>
            <div><code className="text-xs bg-muted px-1 rounded">source</code> — identifica o app de origem (ex: "instagram-feed-agency")</div>
            <div><code className="text-xs bg-muted px-1 rounded">request_id</code> — ID idempotência do lado do cliente</div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Curl rápido:</p>
        <CopyBlock code={testCurlExample} language="bash" />
      </section>

      {/* Response */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold">Resposta</h2>
        <CopyBlock code={responseExample} />
        <p className="text-xs text-muted-foreground">
          O POST responde <code className="bg-muted px-1 rounded">202</code> com <code className="bg-muted px-1 rounded">job_id</code>.
          Depois consulte o endpoint de status para receber <code className="bg-muted px-1 rounded">creatives[]</code>.
        </p>
      </section>

      {/* Job Status */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold flex items-center gap-2">
          <span className="px-2 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 text-xs font-mono">GET</span>
          Status do Job (polling opcional)
        </h2>
        <p className="text-sm text-muted-foreground">
          Consulte a cada 5-10 segundos ate <code className="bg-muted px-1 rounded">status = completed</code>.
          Use <code className="bg-muted px-1 rounded">image_url</code> quando <code className="bg-muted px-1 rounded">generation_type=image</code>
          e <code className="bg-muted px-1 rounded">html_url</code> quando <code className="bg-muted px-1 rounded">generation_type=html</code>.
        </p>
        <CopyBlock code={statusExample} language="text" />
        <CopyBlock code={statusResponseExample} />
      </section>

      {/* Format Presets */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold">Presets de Formato</h2>
        <p className="text-sm text-muted-foreground">
          Envie strings em <code className="bg-muted px-1 rounded">formats[]</code> ou objetos customizados{" "}
          <code className="bg-muted px-1 rounded">{"{ platform, format, width, height, label }"}</code>.
        </p>
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-2 font-medium text-xs text-muted-foreground">Preset</th>
                <th className="text-left px-4 py-2 font-medium text-xs text-muted-foreground">Label</th>
                <th className="text-left px-4 py-2 font-medium text-xs text-muted-foreground">Dimensões</th>
              </tr>
            </thead>
            <tbody>
              {FORMAT_PRESETS.map((p, i) => (
                <tr key={p.key} className={i % 2 === 0 ? "" : "bg-muted/20"}>
                  <td className="px-4 py-2 font-mono text-xs text-primary">{p.key}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{p.label}</td>
                  <td className="px-4 py-2 font-mono text-xs">{p.dim}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Company fields */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold">Campos de Empresa (<code className="text-sm font-mono">company</code>)</h2>
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-2 font-medium text-muted-foreground">Campo</th>
                <th className="text-left px-4 py-2 font-medium text-muted-foreground">Tipo</th>
                <th className="text-left px-4 py-2 font-medium text-muted-foreground">Descrição</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["name *",           "string",   "Nome da marca"],
                ["industry",         "string",   "Setor (ex: Moda, Tecnologia)"],
                ["description",      "string",   "Descrição da empresa"],
                ["primary_color",    "hex",      "Cor principal (#RRGGBB)"],
                ["secondary_color",  "hex",      "Cor secundária"],
                ["accent_color",     "hex",      "Cor de destaque / CTA"],
                ["background_color", "hex",      "Cor de fundo padrão"],
                ["logo_url",         "url",      "URL do logo (PNG/SVG)"],
                ["hero_image_url",   "url",      "URL da imagem hero"],
                ["product_images",   "url[]",    "Array de URLs de produtos"],
                ["heading_font",     "string",   "Fonte de título (ex: Montserrat)"],
                ["body_font",        "string",   "Fonte de texto"],
                ["tone_of_voice",    "string",   "Tom de voz da marca"],
                ["target_audience",  "string",   "Público-alvo"],
                ["value_proposition","string",   "Proposta de valor"],
                ["services",         "string[]", "Lista de serviços/produtos"],
                ["forbidden_words",  "string",   "Palavras proibidas na copy"],
                ["website",          "url",      "URL do site"],
              ].map(([field, type, desc], i) => (
                <tr key={field} className={i % 2 === 0 ? "" : "bg-muted/20"}>
                  <td className="px-4 py-1.5 font-mono text-primary">{field}</td>
                  <td className="px-4 py-1.5 text-muted-foreground">{type}</td>
                  <td className="px-4 py-1.5">{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Campaign fields */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold">Campos de Campanha (<code className="text-sm font-mono">campaign</code>)</h2>
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-2 font-medium text-muted-foreground">Campo</th>
                <th className="text-left px-4 py-2 font-medium text-muted-foreground">Tipo</th>
                <th className="text-left px-4 py-2 font-medium text-muted-foreground">Descrição</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["name",              "string",  "Nome da campanha"],
                ["objective",         "string",  "Objetivo: conversão, alcance, engajamento, tráfego"],
                ["funnel_stage",      "string",  "Funil: top, mid, bottom"],
                ["offer",             "string",  "Oferta (ex: 30% off, Frete grátis)"],
                ["pricing",           "string",  "Preço exibido"],
                ["discount",          "string",  "Porcentagem de desconto"],
                ["guarantee",         "string",  "Garantia (ex: 7 dias)"],
                ["scarcity",          "string",  "Escassez (ex: Últimas unidades)"],
                ["cta_text",          "string",  "Texto do botão CTA"],
                ["main_headline",     "string",  "Headline principal (override da IA)"],
                ["subheadline",       "string",  "Subheadline (override)"],
                ["use_ai_copy",       "boolean", "true = IA escreve a copy. false = usa main_headline/subheadline"],
                ["product_image_url", "url",     "Imagem do produto para a campanha"],
                ["background_image_url","url",   "Imagem de fundo"],
                ["target_audience",   "string",  "Público-alvo (override do perfil da empresa)"],
                ["pain_points",       "string",  "Dores do público"],
                ["desires",           "string",  "Desejos do público"],
                ["urgency_level",     "string",  "Urgência: low, medium, high"],
                ["creative_strategy", "string",  "Estratégia criativa"],
                ["preferred_style",   "string",  "Estilo visual preferido"],
              ].map(([field, type, desc], i) => (
                <tr key={field} className={i % 2 === 0 ? "" : "bg-muted/20"}>
                  <td className="px-4 py-1.5 font-mono text-primary">{field}</td>
                  <td className="px-4 py-1.5 text-muted-foreground">{type}</td>
                  <td className="px-4 py-1.5">{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Instagram use case */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold">Caso de Uso: Agência Instagram (WhatsApp)</h2>
        <p className="text-sm text-muted-foreground">
          O bot recebe dados do feed do cliente via WhatsApp, mapeia para o request e chama a API.
          O número do WhatsApp do cliente é o <code className="bg-muted px-1 rounded">phone</code> — a empresa é criada automaticamente na primeira chamada e reutilizada nas seguintes.
        </p>
        <CopyBlock code={`// Mapeamento: Instagram feed → API
const instagramData = {
  username: "@marcax",
  bio: "Moda contemporânea | Entregas para todo Brasil",
  profilePicUrl: "https://...",
  recentPosts: [{ imageUrl: "https://...", caption: "Nova coleção!" }],
};

const request = {
  phone: whatsappNumber,         // identifica a empresa
  company: {
    name: instagramData.username.replace("@", ""),
    description: instagramData.bio,
    logo_url: instagramData.profilePicUrl,
    product_images: instagramData.recentPosts.map(p => p.imageUrl),
    tone_of_voice: "jovem e inspirador",
  },
  campaign: {
    name: "Campanha via WhatsApp",
    objective: "conversão",
    use_ai_copy: true,
    product_image_url: instagramData.recentPosts[0]?.imageUrl,
  },
  formats: ["instagram-feed-square", "instagram-story"],
  source: "instagram-feed-agency",
};`} language="javascript" />
      </section>

      {/* Error codes */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold">Códigos de Erro</h2>
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-2 font-medium text-xs text-muted-foreground">HTTP</th>
                <th className="text-left px-4 py-2 font-medium text-xs text-muted-foreground">Causa</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["401", "API key inválida ou inativa"],
                ["400", "Campo obrigatório ausente ou formato inválido"],
                ["405", "Método HTTP incorreto"],
                ["500", "Erro interno (store não configurada, edge function falhou, etc.)"],
                ["207", "Geração parcial — alguns batches falharam, creatives[] contém o que foi gerado"],
              ].map(([code, desc], i) => (
                <tr key={code} className={i % 2 === 0 ? "" : "bg-muted/20"}>
                  <td className="px-4 py-2 font-mono text-xs font-semibold">{code}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

const STORE_TABS: { type: StoreType; label: string; shortLabel: string; description: string; icon: React.ElementType }[] = [
  {
    type: "lp",
    label: "Landing Pages",
    shortLabel: "LP",
    description: "Guidelines and examples used to generate landing pages. Include layout rules, copywriting, section structure, and examples of strong landing pages.",
    icon: Newspaper,
  },
  {
    type: "ads",
    label: "Ads / Banners",
    shortLabel: "Ads",
    description: "Technical rules and guidelines only: HTML standards, format specs, copy principles, quality checklists. To send creative examples, use the reference stores.",
    icon: ImageIcon,
  },
  {
    type: "ads_reference",
    label: "HTML References",
    shortLabel: "HTML Refs",
    description: "Reference examples for HTML generation. Upload generated banner HTML files. Gemini extracts layout, CTA zone, and spacing patterns only — brand identity is never copied.",
    icon: FileText,
  },
  {
    type: "ads_image_reference",
    label: "Image References",
    shortLabel: "Img Refs",
    description: "Reference examples for image generation. Upload ad screenshots (PNG/JPG). Gemini draws visual composition, palette mood, and energy inspiration — never copies logos or copy text.",
    icon: ImageIcon,
  },
];

export default function GlobalStoreAdmin() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<ActiveTab>("stores");
  const [activeStore, setActiveStore] = useState<StoreType>("lp");

  if (!user || user.accountType !== "admin") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-3">
          <AlertCircle className="h-12 w-12 text-destructive mx-auto" />
          <p className="text-lg font-semibold">Restricted access</p>
          <p className="text-sm text-muted-foreground">This area is only available to administrators.</p>
          <Button variant="outline" onClick={() => navigate("/")}>
            Back to home
          </Button>
        </div>
      </div>
    );
  }

  const currentStore = STORE_TABS.find(s => s.type === activeStore)!;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">

        {/* Page header */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-xl font-bold">Admin</h1>
            <p className="text-sm text-muted-foreground">Stores de geração e documentação da API externa.</p>
          </div>
        </div>

        {/* Primary tab switcher */}
        <div className="flex gap-1 p-1 rounded-lg bg-muted/50 border w-fit">
          <button
            onClick={() => setActiveTab("stores")}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              activeTab === "stores" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <FileText className="h-4 w-4" />
            Stores
          </button>
          <button
            onClick={() => setActiveTab("api")}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              activeTab === "api" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Code className="h-4 w-4" />
            API Externa
          </button>
        </div>

        {/* ── STORES TAB ── */}
        {activeTab === "stores" && (
          <div className="space-y-5">
            <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-4 text-sm text-amber-800 dark:text-amber-300">
              <strong>How it works:</strong> Guidelines and references are indexed in separate Gemini stores. Ad References are inspiration only — they teach layout, hierarchy, and CTA treatment, not brand identity.
            </div>

            {/* Store selector */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {STORE_TABS.map(store => {
                const Icon = store.icon;
                const isActive = activeStore === store.type;
                return (
                  <button
                    key={store.type}
                    onClick={() => setActiveStore(store.type)}
                    className={`flex flex-col items-start gap-1.5 rounded-xl border p-3 text-left transition-all ${
                      isActive
                        ? "border-primary bg-primary/5 text-foreground shadow-sm"
                        : "border-border bg-card/50 text-muted-foreground hover:border-primary/40 hover:text-foreground"
                    }`}
                  >
                    <Icon className={`h-4 w-4 ${isActive ? "text-primary" : ""}`} />
                    <span className="text-xs font-semibold leading-tight">{store.shortLabel}</span>
                  </button>
                );
              })}
            </div>

            {/* Active store description */}
            <div className="flex items-start gap-3 rounded-xl border border-border/50 bg-card/50 p-4">
              <div className="p-2 rounded-lg bg-primary/10 text-primary shrink-0">
                <currentStore.icon className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-semibold">{currentStore.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{currentStore.description}</p>
              </div>
            </div>

            {/* DropZone — full width, one at a time */}
            <DropZone
              key={activeStore}
              storeType={activeStore}
              label={currentStore.label}
              description={currentStore.description}
              icon={currentStore.icon}
              userId={user.id}
            />

            <p className="text-xs text-muted-foreground text-center">
              Documents indexed in the File Search Store remain persistent until manually deleted.
            </p>
          </div>
        )}

        {/* ── API TAB ── */}
        {activeTab === "api" && (
          <div className="space-y-4">
            <div className="rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 p-4 text-sm text-blue-800 dark:text-blue-300">
              <strong>API Externa:</strong> Permite que aplicações de terceiros gerem ads via HTTP.
              Cada empresa é identificada pelo número de telefone — na primeira chamada a empresa é criada automaticamente;
              nas chamadas seguintes com o mesmo número, a store é reutilizada e apenas uma nova campanha é criada.
            </div>
            <ApiAccessPanel userId={user.id} />
            <ApiDocs />
          </div>
        )}
      </div>
    </div>
  );
}
