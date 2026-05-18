import { AdCreativeFormData, AdFormatDimension, ALL_AD_FORMATS, AD_PLATFORM_LABELS, AdPlatform } from '@/types/adCreativeForm';
import { Monitor, Smartphone, Mail, Layout } from 'lucide-react';

interface Props {
  data: AdCreativeFormData;
  onChange: (updates: Partial<AdCreativeFormData>) => void;
}

const GROUP_ICONS: Record<AdPlatform, React.ComponentType<{ className?: string }>> = {
  social:  Smartphone,
  video:   Monitor,
  display: Layout,
  email:   Mail,
};

const GROUP_DESCS: Record<AdPlatform, string> = {
  social:  'Facebook, Instagram, TikTok, LinkedIn, Pinterest',
  video:   'YouTube thumbnails, video pre-roll, display ads',
  display: 'Google Display Network, programmatic, websites',
  email:   'Email marketing headers and inline banners',
};

const PREVIEW_W = 52;
const PREVIEW_H = 40;

function AspectPreview({ width, height, enabled }: { width: number; height: number; enabled: boolean }) {
  const ratio = width / height;
  let w: number, h: number;
  if (ratio >= 1) {
    w = PREVIEW_W;
    h = Math.max(Math.round(PREVIEW_W / ratio), 4);
    if (h > PREVIEW_H) { h = PREVIEW_H; w = Math.round(PREVIEW_H * ratio); }
  } else {
    h = PREVIEW_H;
    w = Math.max(Math.round(PREVIEW_H * ratio), 4);
    if (w > PREVIEW_W) { w = PREVIEW_W; h = Math.round(PREVIEW_W / ratio); }
  }
  return (
    <div className="flex items-center justify-center shrink-0" style={{ width: PREVIEW_W, height: PREVIEW_H }}>
      <div
        className={`rounded transition-colors ${enabled ? 'bg-primary/20 border-2 border-primary' : 'bg-muted border-2 border-border'}`}
        style={{ width: w, height: h }}
      />
    </div>
  );
}

// Group ALL_AD_FORMATS by platform, preserving order
const GROUPS = (['social', 'video', 'display', 'email'] as AdPlatform[]).map(platform => ({
  platform,
  formats: ALL_AD_FORMATS.filter(f => f.platform === platform),
}));

export function StepAdPlatform({ data, onChange }: Props) {
  const isEnabled = (fmt: Omit<AdFormatDimension, 'enabled'>) =>
    data.selectedFormats.some(f => f.platform === fmt.platform && f.format === fmt.format && f.enabled);

  const toggleFormat = (fmt: Omit<AdFormatDimension, 'enabled'>) => {
    const exists = data.selectedFormats.find(f => f.platform === fmt.platform && f.format === fmt.format);
    let newFormats: AdFormatDimension[];
    if (exists) {
      newFormats = data.selectedFormats.map(f =>
        f.platform === fmt.platform && f.format === fmt.format ? { ...f, enabled: !f.enabled } : f
      );
    } else {
      newFormats = [...data.selectedFormats, { ...fmt, enabled: true }];
    }
    const activePlatforms = [...new Set(newFormats.filter(f => f.enabled).map(f => f.platform))] as AdPlatform[];
    onChange({ selectedFormats: newFormats, selectedPlatforms: activePlatforms });
  };

  const toggleGroup = (platform: AdPlatform) => {
    const groupFmts = ALL_AD_FORMATS.filter(f => f.platform === platform);
    const allEnabled = groupFmts.every(gf => isEnabled(gf));
    let newFormats = [...data.selectedFormats];
    for (const gf of groupFmts) {
      const exists = newFormats.find(f => f.platform === gf.platform && f.format === gf.format);
      if (exists) {
        newFormats = newFormats.map(f =>
          f.platform === gf.platform && f.format === gf.format ? { ...f, enabled: !allEnabled } : f
        );
      } else if (!allEnabled) {
        newFormats = [...newFormats, { ...gf, enabled: true }];
      }
    }
    const activePlatforms = [...new Set(newFormats.filter(f => f.enabled).map(f => f.platform))] as AdPlatform[];
    onChange({ selectedFormats: newFormats, selectedPlatforms: activePlatforms });
  };

  const enabledCount = data.selectedFormats.filter(f => f.enabled).length;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="form-section-title">Ad Formats</h3>
        <p className="form-section-desc">
          Select the dimensions you want to generate. Each unique size is one creative.
        </p>
      </div>

      <div className="space-y-5">
        {GROUPS.map(({ platform, formats }) => {
          const Icon = GROUP_ICONS[platform];
          const allEnabled = formats.every(f => isEnabled(f));
          const someEnabled = formats.some(f => isEnabled(f));

          return (
            <div key={platform} className="rounded-xl border border-border bg-card overflow-hidden">
              {/* Group header */}
              <button
                type="button"
                onClick={() => toggleGroup(platform)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors text-left"
              >
                <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                  someEnabled ? 'bg-primary/15' : 'bg-muted'
                }`}>
                  <Icon className={`h-4 w-4 ${someEnabled ? 'text-primary' : 'text-muted-foreground'}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className={`font-semibold text-sm ${someEnabled ? 'text-foreground' : 'text-muted-foreground'}`}>
                    {AD_PLATFORM_LABELS[platform]}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">{GROUP_DESCS[platform]}</div>
                </div>
                <div className={`h-4 w-4 rounded border-2 shrink-0 flex items-center justify-center transition-all ${
                  allEnabled ? 'border-primary bg-primary' : someEnabled ? 'border-primary bg-primary/30' : 'border-muted-foreground/40'
                }`}>
                  {allEnabled && (
                    <svg className="h-2.5 w-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                  {someEnabled && !allEnabled && (
                    <div className="h-1.5 w-1.5 rounded-sm bg-primary" />
                  )}
                </div>
              </button>

              {/* Format cards */}
              <div className="border-t border-border px-4 pb-4 pt-3">
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                  {formats.map(fmt => {
                    const enabled = isEnabled(fmt);
                    return (
                      <button
                        key={`${fmt.format}-${fmt.width}x${fmt.height}`}
                        type="button"
                        onClick={() => toggleFormat(fmt)}
                        className={`flex flex-col items-center gap-2 rounded-xl border px-3 py-3 text-center transition-all ${
                          enabled
                            ? 'border-primary/50 bg-primary/5 ring-1 ring-primary/20'
                            : 'border-border hover:border-muted-foreground/30 hover:bg-muted/30'
                        }`}
                      >
                        <AspectPreview width={fmt.width} height={fmt.height} enabled={enabled} />
                        <div>
                          <div className={`text-xs font-semibold leading-tight ${enabled ? 'text-foreground' : 'text-muted-foreground'}`}>
                            {fmt.label.replace(/\s*\(\d+×\d+\)$/, '')}
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5 font-mono">
                            {fmt.width}×{fmt.height}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {enabledCount === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-2">
          Select at least one format to continue
        </p>
      ) : (
        <p className="text-sm text-muted-foreground text-center py-2">
          <span className="font-semibold text-foreground">{enabledCount}</span> format{enabledCount !== 1 ? 's' : ''} selected
        </p>
      )}
    </div>
  );
}
