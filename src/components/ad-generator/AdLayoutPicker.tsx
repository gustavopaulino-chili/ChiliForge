import { AdCreativeFormData } from '@/types/adCreativeForm';
import { AD_LAYOUT_OPTIONS, aspectFamily, layoutsForFamilies, type AdLayoutOption } from '@/data/adLayouts';

interface Props {
  data: AdCreativeFormData;
  onChange: (updates: Partial<AdCreativeFormData>) => void;
}

// Mini preview: a box at the format's aspect ratio showing the "image" plus a
// shaded zone where the text/CTA will sit (driven by the layout's geometry).
function LayoutPreview({ opt, ratio }: { opt: AdLayoutOption; ratio: number }) {
  return (
    <div
      className="relative w-full overflow-hidden rounded-md border border-border bg-gradient-to-br from-primary/25 via-primary/10 to-accent/20"
      style={{ aspectRatio: String(ratio), maxHeight: 96 }}
    >
      {opt.zone === null ? (
        // Auto: convey "varies" with a shuffle hint
        <div className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold text-foreground/70">
          ⟳ varia
        </div>
      ) : (
        <div
          className="absolute flex flex-col justify-center gap-1 rounded-[3px] bg-foreground/72 p-1.5 backdrop-blur-[1px]"
          style={{ top: opt.zone.top, right: opt.zone.right, bottom: opt.zone.bottom, left: opt.zone.left }}
        >
          <span className="block h-[3px] w-[70%] rounded-full bg-background/90" />
          <span className="block h-[3px] w-[45%] rounded-full bg-background/60" />
          <span className="mt-0.5 block h-[6px] w-[40%] rounded-full bg-accent" />
        </div>
      )}
    </div>
  );
}

export function AdLayoutPicker({ data, onChange }: Props) {
  const enabledFormats = data.selectedFormats.filter((f) => f.enabled);
  if (enabledFormats.length === 0) return null;

  const families = Array.from(
    new Set(enabledFormats.map((f) => aspectFamily(f.width, f.height))),
  );
  const options = layoutsForFamilies(families);

  // Representative ratio for the previews: use a landscape/square format when
  // available so the shaded text zone reads clearly; fall back to the first.
  const repFormat =
    enabledFormats.find((f) => f.width / f.height >= 1) ?? enabledFormats[0];
  const ratio = repFormat.width / Math.max(1, repFormat.height);

  const selected = (data.textLayout || 'auto');

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div>
        <h4 className="text-sm font-semibold text-foreground">Layout do texto</h4>
        <p className="text-xs text-muted-foreground mt-1">
          Onde o texto vai ficar no anúncio. A IA gera a imagem deixando esse espaço livre
          e nós posicionamos o texto/CTA ali. Opções adaptadas aos formatos escolhidos
          (preview em {repFormat.width}×{repFormat.height}).
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
        {options.map((opt) => {
          const isActive = selected === opt.key;
          return (
            <button
              key={opt.key}
              type="button"
              onClick={() => onChange({ textLayout: opt.key })}
              className={`flex flex-col gap-2 rounded-lg border p-2 text-left transition-all ${
                isActive
                  ? 'border-primary bg-primary/5 ring-1 ring-primary'
                  : 'border-border hover:border-muted-foreground/40'
              }`}
            >
              <LayoutPreview opt={opt} ratio={ratio} />
              <div>
                <div className="text-xs font-medium text-foreground">{opt.label}</div>
                <div className="text-[11px] leading-tight text-muted-foreground">{opt.hint}</div>
              </div>
            </button>
          );
        })}
      </div>

      {options.length < AD_LAYOUT_OPTIONS.length && (
        <p className="text-[11px] text-muted-foreground">
          Mostrando apenas os layouts que funcionam bem em todos os formatos selecionados.
        </p>
      )}
    </div>
  );
}
