import { useState, useEffect } from 'react';
import { Key, X, Eye, EyeOff, Loader2, Check, ExternalLink, Trash2, Image } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { getGeminiKey, saveGeminiKey } from '@/services/api';

type Props = {
  open: boolean;
  onClose: () => void;
};

export function GeminiKeyModal({ open, onClose }: Props) {
  const { user } = useAuth();
  const [currentKey, setCurrentKey] = useState<string | null>(null);
  const [inputKey, setInputKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generateAsImage, setGenerateAsImage] = useState(false);
  const [savingMode, setSavingMode] = useState(false);

  useEffect(() => {
    if (!open || !user?.id) return;
    setLoading(true);
    getGeminiKey(user.id)
      .then(({ gemini_api_key, generate_as_image }) => {
        setCurrentKey(gemini_api_key || null);
        setGenerateAsImage(Boolean(generate_as_image));
      })
      .catch(() => setCurrentKey(null))
      .finally(() => setLoading(false));
  }, [open, user?.id]);

  const handleSave = async () => {
    if (!user?.id) return;
    const key = inputKey.trim();
    if (!key) { toast.error('Enter a valid Gemini API key'); return; }
    setSaving(true);
    try {
      await saveGeminiKey(user.id, key, generateAsImage);
      setCurrentKey(key);
      setInputKey('');
      toast.success('Gemini API key saved');
    } catch (e: any) {
      toast.error(e.message || 'Failed to save key');
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    if (!user?.id) return;
    setSaving(true);
    try {
      await saveGeminiKey(user.id, '', generateAsImage);
      setCurrentKey(null);
      toast.success('Gemini API key removed');
    } catch (e: any) {
      toast.error(e.message || 'Failed to remove key');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleImageMode = async (value: boolean) => {
    setGenerateAsImage(value);
    if (!user?.id) return;
    setSavingMode(true);
    try {
      await saveGeminiKey(user.id, currentKey ?? '', value);
    } catch {
      // silent — preference will be picked up on next key save
    } finally {
      setSavingMode(false);
    }
  };

  const maskKey = (key: string) => {
    if (key.length <= 8) return '••••••••';
    return key.slice(0, 6) + '••••••••••••' + key.slice(-4);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-lg flex flex-col">
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
              <Key className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-semibold leading-none">Gemini API Key</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Your key is used for all AI generation</p>
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-6 py-5 flex flex-col gap-5">
          {loading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {currentKey ? (
                <div className="flex flex-col gap-2">
                  <p className="text-sm font-medium text-foreground">Current key</p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 bg-muted border border-border rounded-lg px-4 py-2.5 text-sm font-mono truncate text-green-600 dark:text-green-400">
                      {showKey ? currentKey : maskKey(currentKey)}
                    </code>
                    <button
                      onClick={() => setShowKey(v => !v)}
                      className="p-2 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                    <Button size="sm" variant="outline" onClick={handleRemove} disabled={saving} className="gap-1.5 text-destructive hover:text-destructive">
                      <Trash2 className="h-3.5 w-3.5" /> Remove
                    </Button>
                  </div>
                  <p className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                    <Check className="h-3 w-3" /> Key configured — AI generation is ready
                  </p>
                </div>
              ) : (
                <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-4 py-3">
                  <p className="text-sm text-amber-800 dark:text-amber-300 font-medium">No Gemini API key set</p>
                  <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">You need your own key to use AI generation features.</p>
                </div>
              )}

              <div className="flex flex-col gap-2">
                <p className="text-sm font-medium text-foreground">{currentKey ? 'Replace key' : 'Add your key'}</p>
                <div className="flex gap-2">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={inputKey}
                    onChange={e => setInputKey(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSave()}
                    placeholder="AIza..."
                    className="flex-1 bg-muted border border-border rounded-lg px-4 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                  <Button onClick={handleSave} disabled={saving || !inputKey.trim()} className="shrink-0 gap-1.5">
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                    Save
                  </Button>
                </div>
              </div>

              {/* Generation mode toggle */}
              <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2.5">
                    <Image className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div>
                      <p className="text-sm font-medium leading-none">Generate ads as images</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Gemini generates PNG images instead of editable HTML banners
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleToggleImageMode(!generateAsImage)}
                    disabled={savingMode}
                    className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none ${
                      generateAsImage ? 'bg-primary' : 'bg-muted-foreground/30'
                    } ${savingMode ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                    aria-label="Toggle image mode"
                  >
                    <span
                      className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transform transition-transform ${
                        generateAsImage ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
                {generateAsImage && (
                  <div className="rounded-md bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                    ⚠ Image mode: generated ads cannot be edited in the visual editor. HTML mode allows full customization.
                  </div>
                )}
              </div>

              <div className="border-t border-border pt-4 flex flex-col gap-1">
                <p className="text-xs text-muted-foreground">
                  Get your free key at{' '}
                  <a
                    href="https://aistudio.google.com/app/apikey"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline inline-flex items-center gap-0.5"
                  >
                    aistudio.google.com <ExternalLink className="h-3 w-3" />
                  </a>
                </p>
                <p className="text-xs text-muted-foreground">Your key is stored securely and never shared.</p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
