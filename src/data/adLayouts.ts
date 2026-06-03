// Ad text-layout options shown in the form. The `key` values MUST match the
// LAYOUT_KEYS in supabase/functions/agents-ads/index.ts — the chosen key is sent
// to the compose pipeline (via campaignData.textLayout) and forced there, driving
// both the background prompt (where to leave negative space) and the HTML overlay
// (where our code places the text/logo/CTA).

export type AdTextLayout =
  | 'auto'
  | 'hero-full-bleed'
  | 'top-image-bottom-text'
  | 'bold-headline-first'
  | 'left-panel-right-image'
  | 'centered-minimal'
  | 'diagonal-split'
  | 'top-left-editorial'
  | 'top-right-editorial'
  | 'bottom-right-editorial'
  | 'vertical-story-stack'
  | 'frame-product'
  | 'floating-islands';

export type AspectFamily = 'square' | 'portrait' | 'landscape' | 'wide';

// Text zone (as CSS inset %) used to draw the mini preview. Mirrors LAYOUT_SCRIMS.
export interface TextZone { top: string; right: string; bottom: string; left: string }

export interface AdLayoutOption {
  key: AdTextLayout;
  label: string;
  hint: string;
  zone: TextZone | null;       // null = "auto" (no fixed zone)
  fits: AspectFamily[];        // which aspect families this layout suits well
}

// Classify a format by aspect ratio into a family used for filtering layouts.
export function aspectFamily(width: number, height: number): AspectFamily {
  const r = height > 0 ? width / height : 1;
  if (r >= 2.2) return 'wide';        // leaderboards / very wide banners
  if (r >= 1.25) return 'landscape';  // landscape / 16:9 / 1.91:1
  if (r <= 0.8) return 'portrait';    // stories / 4:5 / 9:16
  return 'square';                    // ~1:1
}

const ALL: AspectFamily[] = ['square', 'portrait', 'landscape', 'wide'];

export const AD_LAYOUT_OPTIONS: AdLayoutOption[] = [
  {
    key: 'auto',
    label: 'Automático',
    hint: 'A IA escolhe e varia o layout entre os formatos',
    zone: null,
    fits: ALL,
  },
  {
    key: 'top-image-bottom-text',
    label: 'Texto embaixo',
    hint: 'Imagem em cima, texto e CTA na faixa inferior',
    zone: { top: '50%', right: '0', bottom: '0', left: '0' },
    fits: ['square', 'portrait', 'landscape'],
  },
  {
    key: 'bold-headline-first',
    label: 'Texto no topo',
    hint: 'Headline forte em cima, imagem embaixo',
    zone: { top: '0', right: '0', bottom: '50%', left: '0' },
    fits: ['square', 'portrait', 'landscape'],
  },
  {
    key: 'left-panel-right-image',
    label: 'Texto à esquerda',
    hint: 'Painel de texto à esquerda, imagem à direita',
    zone: { top: '0', right: '56%', bottom: '0', left: '0' },
    fits: ['square', 'landscape', 'wide'],
  },
  {
    key: 'centered-minimal',
    label: 'Centralizado',
    hint: 'Texto centralizado sobre a imagem',
    zone: { top: '32%', right: '12%', bottom: '32%', left: '12%' },
    fits: ALL,
  },
  {
    key: 'hero-full-bleed',
    label: 'Imagem cheia',
    hint: 'Imagem em tela cheia com texto sobreposto embaixo',
    zone: { top: '55%', right: '8%', bottom: '8%', left: '8%' },
    fits: ALL,
  },
  {
    key: 'diagonal-split',
    label: 'Split diagonal',
    hint: 'Divisão diagonal — texto de um lado, imagem do outro',
    zone: { top: '0', right: '52%', bottom: '0', left: '0' },
    fits: ['square', 'landscape', 'wide'],
  },
  {
    key: 'vertical-story-stack',
    label: 'Story vertical',
    hint: 'Logo no topo, headline ao centro, CTA na base',
    zone: { top: '8%', right: '8%', bottom: '8%', left: '8%' },
    fits: ['portrait', 'square'],
  },
  {
    key: 'top-left-editorial',
    label: 'Canto sup. esquerdo',
    hint: 'Texto no quadrante superior esquerdo',
    zone: { top: '0', right: '50%', bottom: '52%', left: '0' },
    fits: ['square', 'landscape'],
  },
  {
    key: 'top-right-editorial',
    label: 'Canto sup. direito',
    hint: 'Texto no quadrante superior direito',
    zone: { top: '0', right: '0', bottom: '52%', left: '50%' },
    fits: ['square', 'landscape'],
  },
  {
    key: 'bottom-right-editorial',
    label: 'Canto inf. direito',
    hint: 'Texto no quadrante inferior direito',
    zone: { top: '50%', right: '0', bottom: '0', left: '50%' },
    fits: ['square', 'landscape'],
  },
  {
    key: 'frame-product',
    label: 'Produto emoldurado',
    hint: 'Produto ao centro, texto nas bordas',
    zone: { top: '72%', right: '6%', bottom: '6%', left: '6%' },
    fits: ['square', 'landscape'],
  },
  {
    key: 'floating-islands',
    label: 'Elementos espalhados',
    hint: 'Logo, texto e CTA em ilhas separadas',
    zone: { top: '10%', right: '30%', bottom: '10%', left: '10%' },
    fits: ['square', 'landscape'],
  },
];

// Layouts that fit ALL of the given families (so the choice is valid for every
// selected format). Always keeps "auto" first.
export function layoutsForFamilies(families: AspectFamily[]): AdLayoutOption[] {
  if (!families.length) return AD_LAYOUT_OPTIONS;
  return AD_LAYOUT_OPTIONS.filter(
    (opt) => opt.key === 'auto' || families.every((fam) => opt.fits.includes(fam)),
  );
}
