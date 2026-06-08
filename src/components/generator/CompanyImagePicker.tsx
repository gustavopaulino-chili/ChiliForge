import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { ProjectAsset } from '@/services/api';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assets: ProjectAsset[];
  onSelect: (url: string) => void;
}

// Modal grid to browse the company's saved images (assets folder + brand images)
// and pick one for an image field. Shared by the LP image step.
export function CompanyImagePicker({ open, onOpenChange, assets, onSelect }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Imagens da empresa</DialogTitle>
        </DialogHeader>
        {assets.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Esta empresa ainda não tem imagens salvas.
          </p>
        ) : (
          <div className="grid max-h-[60vh] grid-cols-3 gap-3 overflow-y-auto p-1 sm:grid-cols-4 md:grid-cols-5">
            {assets.map((asset) => (
              <button
                key={asset.name + asset.url}
                type="button"
                onClick={() => onSelect(asset.url)}
                title={asset.name}
                className="group flex flex-col gap-1 rounded-lg border border-border bg-card p-1.5 text-left transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <div className="aspect-square w-full overflow-hidden rounded-md bg-muted/40">
                  <img
                    src={asset.url}
                    alt={asset.name}
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform group-hover:scale-105"
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                  />
                </div>
                <span className="truncate text-[10px] text-muted-foreground">{asset.name}</span>
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
