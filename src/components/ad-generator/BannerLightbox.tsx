import { useEffect, useCallback } from 'react';
import { X, ChevronLeft, ChevronRight, Edit3 } from 'lucide-react';
import { AD_PLATFORM_LABELS } from '@/types/adCreativeForm';
import { Button } from '@/components/ui/button';

type Banner = {
  id: number;
  creative_id?: number;
  url: string;
  platform: string;
  format: string;
  label: string;
  width: number;
  height: number;
};

type Props = {
  banner: Banner;
  banners: Banner[];
  onClose: () => void;
  onNavigate: (banner: Banner) => void;
  onEdit: (banner: Banner) => void;
};

export function BannerLightbox({ banner, banners, onClose, onNavigate, onEdit }: Props) {
  const currentIndex = banners.findIndex(b => b.id === banner.id);
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < banners.length - 1;

  const prev = useCallback(() => {
    if (hasPrev) onNavigate(banners[currentIndex - 1]);
  }, [hasPrev, banners, currentIndex, onNavigate]);

  const next = useCallback(() => {
    if (hasNext) onNavigate(banners[currentIndex + 1]);
  }, [hasNext, banners, currentIndex, onNavigate]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') prev();
      if (e.key === 'ArrowRight') next();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, prev, next]);

  // Scale to fit 82vw × 80vh
  const maxW = typeof window !== 'undefined' ? window.innerWidth * 0.82 : 900;
  const maxH = typeof window !== 'undefined' ? window.innerHeight * 0.80 : 700;
  const scale = Math.min(maxW / banner.width, maxH / banner.height, 1);
  const displayW = Math.round(banner.width * scale);
  const displayH = Math.round(banner.height * scale);

  const platformLabel = AD_PLATFORM_LABELS[banner.platform as keyof typeof AD_PLATFORM_LABELS] || banner.platform;
  const scalePercent = Math.round(scale * 100);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/85 backdrop-blur-sm" />

      {/* Panel */}
      <div
        className="relative flex flex-col items-center gap-4"
        onClick={e => e.stopPropagation()}
      >
        {/* Top bar */}
        <div className="flex items-center justify-between w-full px-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold rounded-full bg-primary/20 text-primary border border-primary/30 px-2.5 py-0.5">
              {platformLabel}
            </span>
            <span className="text-sm font-medium text-white">{banner.label}</span>
            <span className="text-xs text-white/50">{banner.width}×{banner.height}px</span>
            <span className="text-xs text-white/40 tabular-nums">{scalePercent}%</span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 border-white/20 bg-white/10 hover:bg-white/20 text-white text-xs"
              onClick={() => onEdit(banner)}
            >
              <Edit3 className="h-3.5 w-3.5" /> Editar
            </Button>
            <button
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 transition-colors text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Preview + nav arrows */}
        <div className="flex items-center gap-4">
          <button
            onClick={prev}
            disabled={!hasPrev}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-20 disabled:cursor-not-allowed transition-colors text-white flex-shrink-0"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>

          <div
            style={{ width: displayW, height: displayH, overflow: 'hidden', borderRadius: 12, flexShrink: 0, background: '#111', boxShadow: '0 32px 80px rgba(0,0,0,.6)' }}
          >
            <iframe
              key={banner.id}
              src={banner.url}
              title={banner.label}
              style={{
                width: banner.width,
                height: banner.height,
                transform: `scale(${scale.toFixed(4)})`,
                transformOrigin: 'top left',
                border: 'none',
                display: 'block',
              }}
              scrolling="no"
              sandbox="allow-same-origin allow-scripts"
            />
          </div>

          <button
            onClick={next}
            disabled={!hasNext}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-20 disabled:cursor-not-allowed transition-colors text-white flex-shrink-0"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>

        {/* Dots */}
        {banners.length > 1 && (
          <div className="flex items-center gap-1.5">
            {banners.map((b, i) => (
              <button
                key={b.id}
                onClick={() => onNavigate(b)}
                className={`h-1.5 rounded-full transition-all ${i === currentIndex ? 'w-5 bg-primary' : 'w-1.5 bg-white/30 hover:bg-white/50'}`}
              />
            ))}
          </div>
        )}

        <p className="text-xs text-white/30">ESC para fechar · ← → para navegar</p>
      </div>
    </div>
  );
}
