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
} from "lucide-react";

type StoreType = "lp" | "ads";

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
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-primary/10 text-primary shrink-0">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <h2 className="font-semibold text-base">{label}</h2>
          <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
        </div>
      </div>

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

export default function GlobalStoreAdmin() {
  const { user } = useAuth();
  const navigate = useNavigate();

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

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-xl font-bold">Global Generation Stores</h1>
            <p className="text-sm text-muted-foreground">
              Files added here are used as a knowledge base for all generations.
            </p>
          </div>
        </div>

        <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-4 text-sm text-amber-800 dark:text-amber-300">
          <strong>How it works:</strong> Each uploaded file is permanently indexed in the Gemini store. File content is available during generation. You can add multiple files, such as guidelines, examples, and copywriting rules, and they accumulate in the store.
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <DropZone
            storeType="lp"
            label="Landing Pages"
            description="Guidelines and examples used to generate landing pages. Include layout rules, copywriting, section structure, and examples of strong landing pages."
            icon={Newspaper}
            userId={user.id}
          />
          <DropZone
            storeType="ads"
            label="Ads / Banners"
            description="Guidelines and examples used to generate ads. Include design rules, tone of voice, and examples of high-converting banners."
            icon={ImageIcon}
            userId={user.id}
          />
        </div>

        <p className="text-xs text-muted-foreground text-center">
          Documents indexed in the File Search Store remain persistent until manually deleted.
        </p>
      </div>
    </div>
  );
}
