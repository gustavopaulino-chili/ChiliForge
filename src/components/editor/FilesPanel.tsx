import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Upload, Trash2, FileText, Copy } from 'lucide-react';

interface FilePanelProps {
  files: { name: string; url: string; size?: number }[];
  onUpload: (files: FileList | null) => void;
  onDelete: (name: string) => void;
  // copyPath: (url: string) => void; // Not needed, will use clipboard API directly
  uploading?: boolean;
}

export function FilesPanel({ files, onUpload, onDelete, uploading }: FilePanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onUpload(e.target.files);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    onUpload(e.dataTransfer.files);
  };

  return (
    <div className="space-y-4">
      <div
        className={`relative p-6 rounded-lg border-2 border-dashed transition-all cursor-pointer ${
          isDragging ? 'border-primary bg-primary/5 scale-105' : 'border-muted-foreground/20 bg-muted/30 hover:border-primary/50 hover:bg-muted/50'
        }`}
        onClick={() => fileInputRef.current?.click()}
        onDragEnter={() => setIsDragging(true)}
        onDragLeave={() => setIsDragging(false)}
        onDragOver={e => e.preventDefault()}
        onDrop={handleDrop}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleInputChange}
          disabled={uploading}
        />
        <div className="flex flex-col items-center gap-2">
          <Upload className={`h-6 w-6 transition-colors ${isDragging ? 'text-primary' : 'text-muted-foreground'}`} />
          <p className="font-medium text-sm">Drag files here or click to select</p>
          <p className="text-xs text-muted-foreground mt-1">Any file type (PDF, DOCX, ZIP, etc)</p>
        </div>
      </div>
      {files.length > 0 && (
        <div className="space-y-2">
          {files.map(file => (
            <div key={file.name} className="flex items-center gap-3 p-2 rounded border bg-muted/30">
              <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
              <button
                className="flex-1 text-sm underline text-left truncate bg-transparent border-0 p-0"
                onClick={async () => {
                  try {
                    const idx = (file.url || '').indexOf('/files/');
                    const name = file.name || (file.url || '').split('/').pop() || 'download';
                    // prefer downloading
                    const { downloadFileFromUrl } = await import('@/lib/downloadFile');
                    await downloadFileFromUrl(file.url, name);
                  } catch {
                    try {
                      const input = document.createElement('input');
                      input.value = (file.url || '').indexOf('/files/') !== -1 ? (file.url || '').slice((file.url || '').indexOf('/files/')) : `/files/${file.name}`;
                      document.body.appendChild(input);
                      input.select();
                      document.execCommand('copy');
                      document.body.removeChild(input);
                      alert('Could not download - path copied to clipboard');
                    } catch {
                      // noop
                    }
                  }
                }}
              >
                {file.name}
              </button>
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0 hover:text-primary"
                title="Copy path"
                onClick={async () => {
                  const full = file.url || '';
                  try {
                    // prefer /files/ relative path
                    const idx = full.indexOf('/files/');
                    const rel = idx !== -1 ? full.slice(idx) : `/files/${file.name}`;
                    await navigator.clipboard.writeText(rel);
                  } catch {
                    // fallback: create temp input with relative path
                    const input = document.createElement('input');
                    const idx = full.indexOf('/files/');
                    input.value = idx !== -1 ? full.slice(idx) : `/files/${file.name}`;
                    document.body.appendChild(input);
                    input.select();
                    document.execCommand('copy');
                    document.body.removeChild(input);
                  }
                }}
                disabled={uploading}
              >
                <Copy className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0 text-destructive hover:text-destructive"
                onClick={() => onDelete(file.name)}
                disabled={uploading}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
      {files.length === 0 && <p className="text-xs text-muted-foreground">No files uploaded yet.</p>}
    </div>
  );
}
