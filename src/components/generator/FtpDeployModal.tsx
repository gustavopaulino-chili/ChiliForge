import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, Upload, Server, Trash2, ArrowLeft, Plus, FolderOpen, Folder, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';

// ── Types ─────────────────────────────────────────────────────────────────────

type ModalView = 'list' | 'password' | 'new';

interface FtpServer {
  id: number;
  label: string;
  host: string;
  port: number;
  username: string;
  target_dir: string;
  created_at: string;
}

interface FtpDeployModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectSlug: string;
  projectId: number;
  userId: number;
}

interface NewServerForm {
  label: string;
  host: string;
  port: string;
  username: string;
  password: string;
  targetDir: string;
}

const defaultNewForm: NewServerForm = {
  label: '',
  host: '',
  port: '21',
  username: '',
  password: '',
  targetDir: '',
};

// ── Component ─────────────────────────────────────────────────────────────────

export function FtpDeployModal({
  open,
  onOpenChange,
  projectSlug,
  projectId,
  userId,
}: FtpDeployModalProps) {
  const [view, setView] = useState<ModalView>('list');
  const [servers, setServers] = useState<FtpServer[]>([]);
  const [loadingServers, setLoadingServers] = useState(false);
  const [selectedServer, setSelectedServer] = useState<FtpServer | null>(null);
  const [password, setPassword] = useState('');
  const [isDeploying, setIsDeploying] = useState(false);
  const [newForm, setNewForm] = useState<NewServerForm>(defaultNewForm);
  const [saveCredentials, setSaveCredentials] = useState(true);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // Two-step new form
  const [newFormStep, setNewFormStep] = useState<1 | 2>(1);

  // Folder explorer
  const [folderExplorerOpen, setFolderExplorerOpen] = useState(false);
  const [folderItems, setFolderItems] = useState<string[]>([]);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [browsePath, setBrowsePath] = useState('/');
  const [explorerContext, setExplorerContext] = useState<'new' | 'password'>('new');

  // Override target dir when user browses folders for a saved server
  const [deployTargetDir, setDeployTargetDir] = useState('');

  // Fetch saved servers whenever the modal opens
  useEffect(() => {
    if (!open) return;
    setView('list');
    setLoadingServers(true);
    fetch(`/api/getFtpServers.php?user_id=${userId}`)
      .then((r) => r.json())
      .then((data: FtpServer[]) => {
        setServers(Array.isArray(data) ? data : []);
        setView(data.length > 0 ? 'list' : 'new');
      })
      .catch(() => {
        setServers([]);
        setView('new');
      })
      .finally(() => setLoadingServers(false));
  }, [open, userId]);

  // Reset transient state when modal closes
  const handleClose = () => {
    if (isDeploying) return;
    onOpenChange(false);
    setSelectedServer(null);
    setPassword('');
    setNewForm(defaultNewForm);
    setSaveCredentials(true);
    setNewFormStep(1);
    setDeployTargetDir('');
    setFolderExplorerOpen(false);
  };

  // ── Delete server ──────────────────────────────────────────────────────────

  const handleDelete = async (server: FtpServer, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeletingId(server.id);
    try {
      const res = await fetch('/api/deleteFtpServer.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: server.id, user_id: userId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.error) throw new Error(data?.error || 'Delete failed');
      const updated = servers.filter((s) => s.id !== server.id);
      setServers(updated);
      if (updated.length === 0) setView('new');
      toast.success('Server removed.');
    } catch (err: any) {
      toast.error('Could not delete server', { description: err?.message });
    } finally {
      setDeletingId(null);
    }
  };

  // ── Folder explorer ────────────────────────────────────────────────────────

  const browseFolders = async (path: string, host: string, port: number, username: string, pwd: string) => {
    setLoadingFolders(true);
    try {
      const res = await fetch('/api/listFtpFolders.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, port, username, password: pwd, path }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.error) throw new Error(data?.error || 'Could not list folders');
      setFolderItems(Array.isArray(data.folders) ? data.folders : []);
      setBrowsePath(data.path ?? path);
    } catch (err: any) {
      toast.error('Could not list folders', { description: err?.message });
      setFolderExplorerOpen(false);
    } finally {
      setLoadingFolders(false);
    }
  };

  const getExplorerCredentials = () =>
    explorerContext === 'new'
      ? { host: newForm.host.trim(), port: parseInt(newForm.port) || 21, username: newForm.username.trim(), pwd: newForm.password }
      : { host: selectedServer?.host ?? '', port: selectedServer?.port ?? 21, username: selectedServer?.username ?? '', pwd: password };

  const openExplorer = async (context: 'new' | 'password') => {
    const creds = context === 'new'
      ? { host: newForm.host.trim(), port: parseInt(newForm.port) || 21, username: newForm.username.trim(), pwd: newForm.password }
      : { host: selectedServer!.host, port: selectedServer!.port, username: selectedServer!.username, pwd: password };
    if (!creds.pwd.trim()) { toast.error('Enter your password first to browse folders.'); return; }
    const startPath = context === 'new'
      ? (newForm.targetDir || '/')
      : (deployTargetDir || selectedServer!.target_dir || '/');
    setExplorerContext(context);
    setFolderExplorerOpen(true);
    await browseFolders(startPath, creds.host, creds.port, creds.username, creds.pwd);
  };

  const handleSelectFolder = (path: string) => {
    const normalised = path === '/' ? '/' : (path.endsWith('/') ? path : path + '/');
    if (explorerContext === 'new') setNewForm(p => ({ ...p, targetDir: normalised }));
    else setDeployTargetDir(normalised);
    setFolderExplorerOpen(false);
  };

  const navigateInto = (folderName: string) => {
    const newPath = browsePath === '/' ? '/' + folderName : browsePath.replace(/\/$/, '') + '/' + folderName;
    const { host, port, username, pwd } = getExplorerCredentials();
    browseFolders(newPath, host, port, username, pwd);
  };

  const navigateUp = () => {
    if (browsePath === '/' || browsePath === '') return;
    const parts = browsePath.replace(/\/$/, '').split('/').filter(Boolean);
    parts.pop();
    const newPath = parts.length === 0 ? '/' : '/' + parts.join('/');
    const { host, port, username, pwd } = getExplorerCredentials();
    browseFolders(newPath, host, port, username, pwd);
  };

  // ── Deploy via saved server (password view) ────────────────────────────────

  const handleDeployWithServer = async () => {
    if (!password.trim()) { toast.error('Password is required.'); return; }
    setIsDeploying(true);
    try {
      const res = await fetch('/api/deployFtp.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          user_id: userId,
          server_id: selectedServer!.id,
          ftp_password: password,
          project_slug: projectSlug,
          ...(deployTargetDir ? { target_dir_override: deployTargetDir } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.error) throw new Error(data?.error || `Deploy failed (${res.status})`);
      // Persist updated folder choice back to saved server
      if (deployTargetDir && deployTargetDir !== selectedServer!.target_dir) {
        fetch('/api/saveFtpServer.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: userId,
            id: selectedServer!.id,
            label: selectedServer!.label,
            host: selectedServer!.host,
            port: selectedServer!.port,
            username: selectedServer!.username,
            target_dir: deployTargetDir,
          }),
        }).catch(() => {});
      }
      toast.success('Site deployed successfully!', {
        description: data?.deployed_path ? `Uploaded to: ${data.deployed_path}` : undefined,
      });
      handleClose();
    } catch (err: any) {
      toast.error('Deploy failed', { description: err?.message || 'Unknown error' });
    } finally {
      setIsDeploying(false);
    }
  };

  // ── Deploy via new server form ─────────────────────────────────────────────

  const handleDeployNew = async () => {
    if (!newForm.host.trim()) { toast.error('FTP Host is required.'); return; }
    if (!newForm.username.trim()) { toast.error('Username is required.'); return; }
    if (!newForm.password.trim()) { toast.error('Password is required.'); return; }

    setIsDeploying(true);
    try {
      // Optionally save the server first (no password stored)
      if (saveCredentials) {
        const saveRes = await fetch('/api/saveFtpServer.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: userId,
            label: newForm.label.trim() || null,
            host: newForm.host.trim(),
            port: parseInt(newForm.port, 10) || 21,
            username: newForm.username.trim(),
            target_dir: newForm.targetDir.trim() || '/',
          }),
        });
        const saveData = await saveRes.json().catch(() => ({}));
        if (!saveRes.ok || saveData?.error) {
          // Non-fatal: warn but continue with deploy
          toast.warning('Server not saved', { description: saveData?.error || 'Could not save server credentials.' });
        }
      }

      const res = await fetch('/api/deployFtp.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          user_id: userId,
          ftp_host: newForm.host.trim(),
          ftp_port: parseInt(newForm.port, 10) || 21,
          ftp_username: newForm.username.trim(),
          ftp_password: newForm.password,
          target_dir: newForm.targetDir.trim() || '/',
          project_slug: projectSlug,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.error) throw new Error(data?.error || `Deploy failed (${res.status})`);
      toast.success('Site deployed successfully!', {
        description: data?.deployed_path ? `Uploaded to: ${data.deployed_path}` : undefined,
      });
      handleClose();
    } catch (err: any) {
      toast.error('Deploy failed', { description: err?.message || 'Unknown error' });
    } finally {
      setIsDeploying(false);
    }
  };

  // ── Render helpers ─────────────────────────────────────────────────────────

  const renderList = () => (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Server className="h-5 w-5 text-primary" />
          Deploy to My Server
        </DialogTitle>
        <DialogDescription>
          Select a saved server or add a new one.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-2 py-2">
        {loadingServers ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          servers.map((srv) => (
            <button
              key={srv.id}
              onClick={() => { setSelectedServer(srv); setPassword(''); setDeployTargetDir(''); setView('password'); }}
              disabled={isDeploying || deletingId !== null}
              className="flex items-center justify-between rounded-lg border px-4 py-3 text-left hover:bg-accent transition-colors disabled:opacity-50"
            >
              <div className="min-w-0">
                <p className="font-medium truncate">{srv.label || srv.host}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {srv.username}@{srv.host}:{srv.port}
                </p>
              </div>
              <button
                onClick={(e) => handleDelete(srv, e)}
                disabled={deletingId === srv.id}
                aria-label="Remove server"
                className="ml-3 shrink-0 rounded p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
              >
                {deletingId === srv.id
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <Trash2 className="h-4 w-4" />}
              </button>
            </button>
          ))
        )}

        <Button variant="outline" className="mt-1 gap-2 w-full" onClick={() => { setNewFormStep(1); setView('new'); }} disabled={isDeploying}>
          <Plus className="h-4 w-4" />
          Add New Server
        </Button>
      </div>

      <div className="flex justify-end pt-2">
        <Button variant="outline" onClick={handleClose}>Cancel</Button>
      </div>
    </>
  );

  const renderPassword = () => {
    const effectiveDir = deployTargetDir || selectedServer?.target_dir || '/';
    return (
      <>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <button
              onClick={() => { setView('list'); setPassword(''); setDeployTargetDir(''); }}
              disabled={isDeploying}
              className="rounded p-0.5 hover:bg-accent transition-colors disabled:opacity-50"
              aria-label="Back"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            {selectedServer?.label || selectedServer?.host}
          </DialogTitle>
          <DialogDescription>
            {selectedServer?.username}@{selectedServer?.host}:{selectedServer?.port}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="ftp-pw">FTP Password <span className="text-destructive">*</span></Label>
            <Input
              id="ftp-pw"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isDeploying}
              autoComplete="current-password"
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') handleDeployWithServer(); }}
            />
          </div>
          <div className="grid gap-2">
            <Label>Target Folder</Label>
            <div className="flex gap-2">
              <Input value={effectiveDir} readOnly className="flex-1 bg-muted/50" />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => openExplorer('password')}
                disabled={isDeploying}
                title="Browse folders"
              >
                <FolderOpen className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Files will be uploaded to:{' '}
              <code className="bg-muted px-1 rounded">{effectiveDir}{projectSlug}/</code>
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={handleClose} disabled={isDeploying}>Cancel</Button>
          <Button onClick={handleDeployWithServer} disabled={isDeploying} className="gap-2">
            {isDeploying
              ? <><Loader2 className="h-4 w-4 animate-spin" />Deploying…</>
              : <><Upload className="h-4 w-4" />Deploy</>}
          </Button>
        </div>
      </>
    );
  };

  const renderNew = () => (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          {(servers.length > 0 || newFormStep === 2) && (
            <button
              onClick={() => { if (newFormStep === 2) setNewFormStep(1); else setView('list'); }}
              disabled={isDeploying}
              className="rounded p-0.5 hover:bg-accent transition-colors disabled:opacity-50"
              aria-label="Back"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
          )}
          <Server className="h-5 w-5 text-primary" />
          New FTP Server
          <span className="ml-auto text-xs text-muted-foreground font-normal">Step {newFormStep} / 2</span>
        </DialogTitle>
        <DialogDescription>
          {newFormStep === 1 ? 'Enter your FTP connection details.' : 'Choose the destination folder on your server.'}
        </DialogDescription>
      </DialogHeader>

      {newFormStep === 1 ? (
        <div className="grid gap-3 py-2">
          <div className="grid gap-2">
            <Label htmlFor="new-label">Label <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Input
              id="new-label"
              placeholder="My Hosting"
              value={newForm.label}
              onChange={(e) => setNewForm((p) => ({ ...p, label: e.target.value }))}
              disabled={isDeploying}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="new-host">FTP Host <span className="text-destructive">*</span></Label>
            <Input
              id="new-host"
              placeholder="ftp.yourdomain.com"
              value={newForm.host}
              onChange={(e) => setNewForm((p) => ({ ...p, host: e.target.value }))}
              disabled={isDeploying}
              autoComplete="off"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="new-user">Username <span className="text-destructive">*</span></Label>
              <Input
                id="new-user"
                placeholder="ftpuser"
                value={newForm.username}
                onChange={(e) => setNewForm((p) => ({ ...p, username: e.target.value }))}
                disabled={isDeploying}
                autoComplete="username"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="new-port">Port</Label>
              <Input
                id="new-port"
                type="number"
                placeholder="21"
                value={newForm.port}
                onChange={(e) => setNewForm((p) => ({ ...p, port: e.target.value }))}
                disabled={isDeploying}
                min={1}
                max={65535}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="new-pass">Password <span className="text-destructive">*</span></Label>
            <Input
              id="new-pass"
              type="password"
              placeholder="••••••••"
              value={newForm.password}
              onChange={(e) => setNewForm((p) => ({ ...p, password: e.target.value }))}
              disabled={isDeploying}
              autoComplete="current-password"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={handleClose} disabled={isDeploying}>Cancel</Button>
            <Button
              onClick={async () => {
                if (!newForm.host.trim()) { toast.error('FTP Host is required.'); return; }
                if (!newForm.username.trim()) { toast.error('Username is required.'); return; }
                if (!newForm.password.trim()) { toast.error('Password is required.'); return; }
                setNewFormStep(2);
                await browseFolders('/', newForm.host.trim(), parseInt(newForm.port) || 21, newForm.username.trim(), newForm.password);
                setFolderExplorerOpen(true);
                setExplorerContext('new');
              }}
              disabled={isDeploying}
              className="gap-2"
            >
              Next <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-3 py-2">
          <div className="grid gap-2">
            <Label>Target Folder</Label>
            <div className="flex gap-2">
              <Input
                value={newForm.targetDir}
                onChange={(e) => setNewForm((p) => ({ ...p, targetDir: e.target.value }))}
                placeholder="Select a folder…"
                className="flex-1"
                disabled={isDeploying}
                readOnly
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => openExplorer('new')}
                disabled={isDeploying}
                title="Browse folders"
              >
                <FolderOpen className="h-4 w-4" />
              </Button>
            </div>
            {newForm.targetDir && (
              <p className="text-xs text-muted-foreground">
                Files will be uploaded to:{' '}
                <code className="bg-muted px-1 rounded">{newForm.targetDir}{projectSlug}/</code>
              </p>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="save-creds"
              checked={saveCredentials}
              onCheckedChange={(v) => setSaveCredentials(Boolean(v))}
              disabled={isDeploying}
            />
            <Label htmlFor="save-creds" className="text-sm font-normal cursor-pointer">
              Save this server for future deploys (password not stored)
            </Label>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={handleClose} disabled={isDeploying}>Cancel</Button>
            <Button onClick={handleDeployNew} disabled={isDeploying} className="gap-2">
              {isDeploying
                ? <><Loader2 className="h-4 w-4 animate-spin" />Deploying…</>
                : <><Upload className="h-4 w-4" />Deploy</>}
            </Button>
          </div>
        </div>
      )}
    </>
  );

  const renderFolderExplorer = () => (
    <Dialog open={folderExplorerOpen} onOpenChange={(v) => { if (!loadingFolders) setFolderExplorerOpen(v); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5 text-primary" />
            Select Folder
          </DialogTitle>
          <DialogDescription className="font-mono text-xs break-all">{browsePath}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1 py-1">
          <div className="flex items-center gap-2 mb-1">
            {browsePath !== '/' && (
              <Button variant="ghost" size="sm" className="gap-1 h-8" onClick={navigateUp} disabled={loadingFolders}>
                <ArrowLeft className="h-3.5 w-3.5" /> Up
              </Button>
            )}
            <Button size="sm" className="ml-auto gap-1 h-8" onClick={() => handleSelectFolder(browsePath)} disabled={loadingFolders}>
              <FolderOpen className="h-3.5 w-3.5" /> Select this folder
            </Button>
          </div>

          {loadingFolders ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : folderItems.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No subfolders found.</p>
          ) : (
            <div className="flex flex-col gap-0.5 max-h-60 overflow-y-auto">
              {folderItems.map((name) => (
                <button
                  key={name}
                  onClick={() => navigateInto(name)}
                  className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-left hover:bg-accent transition-colors"
                >
                  <Folder className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="truncate">{name}</span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground ml-auto shrink-0" />
                </button>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );

  return (
    <>
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-md">
          {view === 'list' && renderList()}
          {view === 'password' && renderPassword()}
          {view === 'new' && renderNew()}
        </DialogContent>
      </Dialog>
      {renderFolderExplorer()}
    </>
  );
}
