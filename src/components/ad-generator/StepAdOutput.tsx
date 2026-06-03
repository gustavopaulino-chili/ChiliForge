import { AdCreativeFormData, AdOutputMode } from '@/types/adCreativeForm';
import { Layers, Code2, Check, Sparkles, Pencil, Image as ImageIcon } from 'lucide-react';

interface Props {
  data: AdCreativeFormData;
  onChange: (updates: Partial<AdCreativeFormData>) => void;
  /** Compose precisa de uma empresa vinculada (stores + fundo IA). */
  hasCompany?: boolean;
}

type OutputOption = {
  value: AdOutputMode;
  label: string;
  tagline: string;
  icon: typeof Layers;
  bullets: { icon: typeof Check; text: string }[];
  best: string;
};

const OPTIONS: OutputOption[] = [
  {
    value: 'compose',
    label: 'Compose',
    tagline: 'Fundo gerado por IA + textos e logo editáveis',
    icon: Layers,
    bullets: [
      { icon: Sparkles, text: 'A IA cria o fundo (imagem) com a cara da sua marca' },
      { icon: Pencil, text: 'Headline, copy, CTA e logo ficam por cima, 100% editáveis no editor' },
      { icon: ImageIcon, text: 'Visual mais rico e fotográfico, próximo de um anúncio real' },
    ],
    best: 'Melhor qualidade visual. Recomendado para a maioria das campanhas.',
  },
  {
    value: 'html',
    label: 'HTML',
    tagline: 'Anúncio 100% em HTML/CSS, tudo editável',
    icon: Code2,
    bullets: [
      { icon: Pencil, text: 'Todos os elementos (inclusive o fundo) são editáveis no editor visual' },
      { icon: Code2, text: 'Arquivo leve, ideal para banners de display e e-mail' },
      { icon: Check, text: 'Sem geração de imagem — mais rápido e previsível' },
    ],
    best: 'Melhor para controle total e banners simples/leves.',
  },
];

export function StepAdOutput({ data, onChange, hasCompany = true }: Props) {
  const selected = data.outputMode || 'compose';

  return (
    <div className="space-y-6">
      <div>
        <h3 className="form-section-title">Tipo de Anúncio (Output)</h3>
        <p className="form-section-desc">
          Escolha como os criativos serão gerados. Isso muda o resultado final e o que você poderá editar depois.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {OPTIONS.map(opt => {
          const isSelected = selected === opt.value;
          const Icon = opt.icon;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange({ outputMode: opt.value })}
              className={`relative rounded-xl border p-5 text-left transition-all ${
                isSelected
                  ? 'border-primary bg-primary/5 ring-1 ring-primary'
                  : 'border-border hover:border-muted-foreground/30 bg-card'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                    isSelected ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'
                  }`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="font-semibold text-sm text-foreground">{opt.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{opt.tagline}</p>
                  </div>
                </div>
                <div className={`mt-0.5 h-5 w-5 rounded-full border-2 shrink-0 flex items-center justify-center transition-all ${
                  isSelected ? 'border-primary bg-primary' : 'border-muted-foreground/40'
                }`}>
                  {isSelected && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
                </div>
              </div>

              <ul className="mt-4 space-y-2">
                {opt.bullets.map((b, i) => {
                  const BIcon = b.icon;
                  return (
                    <li key={i} className="flex items-start gap-2 text-xs text-foreground/80">
                      <BIcon className="h-3.5 w-3.5 mt-0.5 shrink-0 text-primary/70" />
                      <span>{b.text}</span>
                    </li>
                  );
                })}
              </ul>

              <p className="mt-4 text-[11px] font-medium text-muted-foreground border-t border-border/60 pt-3">
                {opt.best}
              </p>
            </button>
          );
        })}
      </div>

      {/* Diferença rápida */}
      <div className="rounded-lg bg-muted/40 p-4 text-xs text-muted-foreground space-y-1.5">
        <p className="font-medium text-foreground">Qual a diferença?</p>
        <p>
          <strong className="text-foreground">Compose</strong> entrega um fundo de imagem feito por IA com os textos
          editáveis por cima — visual mais sofisticado. O fundo em si não é editável (mas pode ser regerado).
        </p>
        <p>
          <strong className="text-foreground">HTML</strong> monta o anúncio inteiro em HTML/CSS — tudo é editável no
          editor visual, porém o visual é mais "design plano" do que fotográfico.
        </p>
      </div>

      {selected === 'compose' && !hasCompany && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          ⚠ O modo Compose usa as imagens e o conhecimento da empresa para gerar o fundo. Sem uma empresa vinculada,
          a geração pode cair automaticamente para HTML.
        </div>
      )}
    </div>
  );
}
