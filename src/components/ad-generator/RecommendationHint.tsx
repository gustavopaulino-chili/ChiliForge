import { useEffect, useState } from 'react';
import { Info, X } from 'lucide-react';
import { RECOMMENDATION_TIP_STORAGE_KEY } from '@/lib/adRecommendations';

export function RecommendationHint({ enabled = true }: { enabled?: boolean }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    try {
      if (window.localStorage.getItem(RECOMMENDATION_TIP_STORAGE_KEY)) return;
      window.localStorage.setItem(RECOMMENDATION_TIP_STORAGE_KEY, '1');
    } catch {
      // Storage can fail in private contexts; still show the hint for this render.
    }
    setVisible(true);
  }, [enabled]);

  if (!visible) return null;

  return (
    <div className="relative overflow-hidden rounded-xl border border-primary/70 bg-gradient-to-br from-primary/20 via-primary/10 to-background px-4 py-4 shadow-[0_0_34px_hsl(var(--primary)/0.28)]">
      <div className="absolute inset-y-0 left-0 w-1 bg-primary" />
      <div className="flex items-start gap-3 pr-8">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/25">
          <Info className="h-5 w-5" />
        </div>
        <div>
          <div className="mb-1 inline-flex rounded-full bg-primary/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">
            Recommendation guide
          </div>
          <p className="text-sm font-bold text-foreground">Glowing options are recommended</p>
          <p className="mt-1 text-xs leading-relaxed text-foreground/80">
            Any field with a soft pulse is recommended for the funnel stage and campaign objective you selected. It is a suggestion only; you can still choose any option that fits the campaign.
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={() => setVisible(false)}
        aria-label="Dismiss recommendation explanation"
        className="absolute right-3 top-3 rounded-md p-1 text-muted-foreground transition-colors hover:bg-background/70 hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
