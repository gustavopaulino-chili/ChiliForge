import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { BusinessFormData, ProductItem } from '@/types/businessForm';
import { Plus, X, ShoppingCart, DollarSign } from 'lucide-react';

interface Props {
  data: BusinessFormData;
  onChange: (updates: Partial<BusinessFormData>) => void;
}

const emptyProduct: ProductItem = {
  name: '', description: '', price: '', discountPrice: '',
  images: [], sku: '', category: '', variants: '',
};

export function StepProducts({ data, onChange }: Props) {
  const products = data.products.length > 0 ? data.products : [{ ...emptyProduct }];

  const update = (i: number, field: keyof ProductItem, value: any) => {
    const updated = [...products];
    updated[i] = { ...updated[i], [field]: value };
    onChange({ products: updated });
  };

  const add = () => onChange({ products: [...products, { ...emptyProduct }] });
  const remove = (i: number) => onChange({ products: products.filter((_, idx) => idx !== i) });

  return (
    <div className="space-y-6">
      <div>
        <h3 className="form-section-title">Products</h3>
        <p className="form-section-desc">Add your products for the online store</p>
      </div>

      <div className="space-y-6">
        {products.map((p, i) => (
          <div key={i} className="rounded-lg border border-border bg-card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShoppingCart className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium text-foreground">Product {i + 1}</span>
              </div>
              {products.length > 1 && (
                <Button variant="ghost" size="icon" onClick={() => remove(i)} className="h-7 w-7">
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label className="text-xs text-muted-foreground">Product Name *</Label>
                <Input value={p.name} onChange={e => update(i, 'name', e.target.value)} placeholder="Product name" className="mt-1" />
              </div>
              <div className="col-span-2">
                <Label className="text-xs text-muted-foreground">Description</Label>
                <Textarea value={p.description} onChange={e => update(i, 'description', e.target.value)} placeholder="Product description" rows={2} className="mt-1" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Price</Label>
                <Input value={p.price} onChange={e => update(i, 'price', e.target.value)} placeholder="$99.99" className="mt-1" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Discount Price</Label>
                <Input value={p.discountPrice} onChange={e => update(i, 'discountPrice', e.target.value)} placeholder="$79.99" className="mt-1" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">SKU</Label>
                <Input value={p.sku} onChange={e => update(i, 'sku', e.target.value)} placeholder="SKU-001" className="mt-1" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Category</Label>
                <Input value={p.category} onChange={e => update(i, 'category', e.target.value)} placeholder="Category" className="mt-1" />
              </div>
              <div className="col-span-2">
                <Label className="text-xs text-muted-foreground">Variants (size, color, etc.)</Label>
                <Input value={p.variants} onChange={e => update(i, 'variants', e.target.value)} placeholder="S, M, L, XL / Red, Blue" className="mt-1" />
              </div>
            </div>
          </div>
        ))}

        <Button variant="outline" onClick={add} className="gap-1 w-full">
          <Plus className="h-4 w-4" /> Add Product
        </Button>
      </div>
    </div>
  );
}
