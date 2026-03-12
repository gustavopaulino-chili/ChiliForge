import { useState, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { BusinessFormData, ProductItem, ProductVariant, VariantType, VARIANT_TYPES } from '@/types/businessForm';
import { Plus, X, ShoppingCart, DollarSign, Upload, FileSpreadsheet, Loader2, Sparkles, Check, Tag, Save, BookmarkPlus, Bookmark, Hash, Type, Palette, ToggleLeft } from 'lucide-react';
import { FieldLabel } from './FieldLabel';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import * as XLSX from 'xlsx';

interface Props {
  data: BusinessFormData;
  onChange: (updates: Partial<BusinessFormData>) => void;
}

const emptyProduct: ProductItem = {
  name: '', description: '', price: '', discountPrice: '',
  images: [], sku: '', category: '', variants: [], inputs: [],
};

const SAVED_VARIANTS_KEY = 'saved-product-variants';

function getSavedVariants(): ProductVariant[] {
  try {
    const raw = localStorage.getItem(SAVED_VARIANTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveVariant(variant: ProductVariant) {
  const existing = getSavedVariants();
  const alreadyExists = existing.some(v => v.name.toLowerCase() === variant.name.toLowerCase());
  if (alreadyExists) {
    const updated = existing.map(v => v.name.toLowerCase() === variant.name.toLowerCase() ? variant : v);
    localStorage.setItem(SAVED_VARIANTS_KEY, JSON.stringify(updated));
  } else {
    localStorage.setItem(SAVED_VARIANTS_KEY, JSON.stringify([...existing, variant]));
  }
}

function deleteSavedVariant(name: string) {
  const existing = getSavedVariants().filter(v => v.name !== name);
  localStorage.setItem(SAVED_VARIANTS_KEY, JSON.stringify(existing));
}

export function StepProducts({ data, onChange }: Props) {
  const products = data.products.length > 0 ? data.products : [{ ...emptyProduct }];
  const [showPricing, setShowPricing] = useState(() => products.some(p => p.price || p.discountPrice));
  const [savedVariants, setSavedVariants] = useState<ProductVariant[]>(getSavedVariants);

  const refreshSaved = () => setSavedVariants(getSavedVariants());
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

      <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 p-3">
        <div className="flex items-center gap-2">
          <DollarSign className="h-4 w-4 text-muted-foreground" />
          <FieldLabel hint="Toggle to show price and discount fields for each product. Leave off if prices are not public.">
            Show pricing fields
          </FieldLabel>
        </div>
        <Switch checked={showPricing} onCheckedChange={setShowPricing} />
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
                <FieldLabel className="text-xs text-muted-foreground" required hint="The name of the product as it will appear on the website and product listing.">
                  Product Name
                </FieldLabel>
                <Input value={p.name} onChange={e => update(i, 'name', e.target.value)} placeholder="Product name" className="mt-1" />
              </div>
              <div className="col-span-2">
                <FieldLabel className="text-xs text-muted-foreground" hint="A short description of the product highlighting key features and benefits.">
                  Description
                </FieldLabel>
                <Textarea value={p.description} onChange={e => update(i, 'description', e.target.value)} placeholder="Product description" rows={2} className="mt-1" />
              </div>
              {showPricing && (
                <>
                  <div>
                    <FieldLabel className="text-xs text-muted-foreground" hint="The regular selling price of the product. Include currency symbol.">
                      Price
                    </FieldLabel>
                    <Input value={p.price} onChange={e => update(i, 'price', e.target.value)} placeholder="$99.99" className="mt-1" />
                  </div>
                  <div>
                    <FieldLabel className="text-xs text-muted-foreground" hint="The discounted/sale price. Will be shown alongside the original price with a strikethrough.">
                      Discount Price
                    </FieldLabel>
                    <Input value={p.discountPrice} onChange={e => update(i, 'discountPrice', e.target.value)} placeholder="$79.99" className="mt-1" />
                  </div>
                </>
              )}
              <div>
                <FieldLabel className="text-xs text-muted-foreground" hint="Stock Keeping Unit — a unique code to identify this product in your inventory system.">
                  SKU
                </FieldLabel>
                <Input value={p.sku} onChange={e => update(i, 'sku', e.target.value)} placeholder="SKU-001" className="mt-1" />
              </div>
              <div>
                <FieldLabel className="text-xs text-muted-foreground" hint="The product category for organizing products in the store (e.g. Electronics, Clothing).">
                  Category
                </FieldLabel>
                <Input value={p.category} onChange={e => update(i, 'category', e.target.value)} placeholder="Category" className="mt-1" />
              </div>
              <div className="col-span-2 space-y-3">
                <FieldLabel className="text-xs text-muted-foreground" hint="Add variant types (e.g. Size, Color) and their available options for this product.">
                  Variants
                </FieldLabel>
                {(p.variants.length > 0 ? p.variants : []).map((variant, vIdx) => (
                  <div key={vIdx} className="rounded-md border border-border bg-muted/20 p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <Tag className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <Input
                        value={variant.name}
                        onChange={e => {
                          const newVariants = [...p.variants];
                          newVariants[vIdx] = { ...newVariants[vIdx], name: e.target.value };
                          update(i, 'variants', newVariants);
                        }}
                        placeholder="Variant name (e.g. Size, Color)"
                        className="h-8 text-sm"
                      />
                      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" title="Salvar variante"
                        onClick={() => {
                          if (!variant.name.trim()) { toast.error('Dê um nome à variante antes de salvar'); return; }
                          saveVariant(variant);
                          refreshSaved();
                          toast.success(`Variante "${variant.name}" salva!`);
                        }}>
                        <BookmarkPlus className="h-3.5 w-3.5 text-primary" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => {
                        const newVariants = p.variants.filter((_, idx) => idx !== vIdx);
                        update(i, 'variants', newVariants);
                      }}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                    <div className="pl-5 space-y-1.5">
                      {(variant.values.length > 0 ? variant.values : ['']).map((val, valIdx) => (
                        <div key={valIdx} className="flex items-center gap-2">
                          <Input
                            value={val}
                            onChange={e => {
                              const newVariants = [...p.variants];
                              const newValues = [...variant.values.length > 0 ? variant.values : ['']];
                              newValues[valIdx] = e.target.value;
                              newVariants[vIdx] = { ...newVariants[vIdx], values: newValues };
                              update(i, 'variants', newVariants);
                            }}
                            placeholder="Value (e.g. M, Red, 32)"
                            className="h-7 text-xs"
                          />
                          {variant.values.length > 1 && (
                            <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => {
                              const newVariants = [...p.variants];
                              newVariants[vIdx] = { ...newVariants[vIdx], values: variant.values.filter((_, idx) => idx !== valIdx) };
                              update(i, 'variants', newVariants);
                            }}>
                              <X className="h-2.5 w-2.5" />
                            </Button>
                          )}
                        </div>
                      ))}
                      <Button variant="ghost" size="sm" className="gap-1 text-xs h-6 px-2" onClick={() => {
                        const newVariants = [...p.variants];
                        newVariants[vIdx] = { ...newVariants[vIdx], values: [...variant.values, ''] };
                        update(i, 'variants', newVariants);
                      }}>
                        <Plus className="h-2.5 w-2.5" /> Add value
                      </Button>
                    </div>
                  </div>
                ))}
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" className="gap-1 text-xs" onClick={() => {
                    update(i, 'variants', [...p.variants, { name: '', values: [''] }]);
                  }}>
                    <Plus className="h-3 w-3" /> Nova Variante
                  </Button>
                </div>

                {savedVariants.length > 0 && (
                  <div className="rounded-md border border-dashed border-primary/30 bg-primary/5 p-3 space-y-2">
                    <div className="flex items-center gap-1.5">
                      <Bookmark className="h-3.5 w-3.5 text-primary" />
                      <span className="text-xs font-medium text-primary">Variantes salvas</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {savedVariants.map((sv, svIdx) => (
                        <div key={svIdx} className="flex items-center gap-1">
                          <Button
                            variant="secondary"
                            size="sm"
                            className="gap-1 text-xs h-7"
                            onClick={() => {
                              const alreadyAdded = p.variants.some(v => v.name.toLowerCase() === sv.name.toLowerCase());
                              if (alreadyAdded) { toast.info(`"${sv.name}" já está neste produto`); return; }
                              update(i, 'variants', [...p.variants, { ...sv }]);
                              toast.success(`Variante "${sv.name}" adicionada`);
                            }}
                          >
                            <Plus className="h-2.5 w-2.5" /> {sv.name} ({sv.values.filter(Boolean).length})
                          </Button>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => {
                            deleteSavedVariant(sv.name);
                            refreshSaved();
                            toast.success(`"${sv.name}" removida dos salvos`);
                          }}>
                            <X className="h-2.5 w-2.5" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div className="col-span-2 space-y-2">
                <FieldLabel className="text-xs text-muted-foreground" hint="Add image URLs for this product. These will be used in the product listing and detail pages.">
                  Product Images
                </FieldLabel>
                {(p.images.length > 0 ? p.images : ['']).map((img, imgIdx) => (
                  <div key={imgIdx} className="flex gap-2 items-center">
                    <Input
                      value={img}
                      onChange={e => {
                        const newImages = [...(p.images.length > 0 ? p.images : [''])];
                        newImages[imgIdx] = e.target.value;
                        update(i, 'images', newImages.filter((v, idx) => v || idx === newImages.length - 1));
                      }}
                      placeholder="https://example.com/image.jpg"
                      className="flex-1"
                    />
                    {p.images.length > 1 && (
                      <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => {
                        const newImages = p.images.filter((_, idx) => idx !== imgIdx);
                        update(i, 'images', newImages);
                      }}>
                        <X className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                ))}
                {p.images.length > 0 && p.images[p.images.length - 1] !== '' && (
                  <Button variant="ghost" size="sm" className="gap-1 text-xs" onClick={() => update(i, 'images', [...p.images, ''])}>
                    <Plus className="h-3 w-3" /> Add another image
                  </Button>
                )}
              </div>
            </div>
          </div>
        ))}

        <Button variant="outline" onClick={add} className="gap-1 w-full">
          <Plus className="h-4 w-4" /> Add Product
        </Button>

        <ProductCsvImport products={products} onChange={onChange} />
      </div>
    </div>
  );
}

/* ---- CSV Import sub-component ---- */

function sheetToText(sheet: XLSX.WorkSheet): string {
  return XLSX.utils.sheet_to_csv(sheet, { FS: ' | ', RS: '\n' });
}

function ProductCsvImport({ products, onChange }: { products: ProductItem[]; onChange: Props['onChange'] }) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [importedCount, setImportedCount] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const processSheet = async (wb: XLSX.WorkBook, sheetName: string) => {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) return;

    const sheetText = sheetToText(sheet);
    if (!sheetText.trim()) {
      toast.error(`Sheet "${sheetName}" is empty`);
      return;
    }

    setIsProcessing(true);
    try {
      const { data: result, error } = await supabase.functions.invoke('parse-products-spreadsheet', {
        body: { sheetData: sheetText },
      });

      if (error) throw error;
      if (result?.error) throw new Error(result.error);

      const extracted: any[] = result.products;
      if (!extracted?.length) {
        toast.warning('No products found in the spreadsheet');
        return;
      }

      const newProducts: ProductItem[] = extracted.map(p => ({
        name: p.name || '',
        description: p.description || '',
        price: p.price || '',
        discountPrice: p.discountPrice || '',
        images: [],
        sku: p.sku || '',
        category: p.category || '',
        variants: typeof p.variants === 'string' && p.variants
          ? [{ name: 'Variants', values: p.variants.split(',').map((v: string) => v.trim()) }]
          : [],
        inputs: [],
      }));

      // Remove empty placeholder products, then append imported ones
      const existing = products.filter(p => p.name.trim() !== '');
      onChange({ products: [...existing, ...newProducts] });
      setImportedCount(newProducts.length);
      toast.success(`${newProducts.length} products imported successfully`);
    } catch (err) {
      console.error('Product CSV import error:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to parse products');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFile = (file: File) => {
    const validExts = ['.csv', '.xlsx', '.xls'];
    const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
    if (!validExts.includes(ext)) {
      toast.error('Please upload a CSV or Excel file (.csv, .xlsx, .xls)');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const arr = new Uint8Array(e.target?.result as ArrayBuffer);
        const wb = XLSX.read(arr, { type: 'array' });
        const names = wb.SheetNames;

        if (names.length === 1) {
          processSheet(wb, names[0]);
        } else {
          // Use first sheet by default for simplicity
          processSheet(wb, names[0]);
          toast.info(`Using first sheet "${names[0]}" (${names.length} sheets found)`);
        }
      } catch {
        toast.error('Error reading file. Please check the format.');
      }
    };
    reader.readAsArrayBuffer(file);
  };

  return (
    <div className="space-y-3">
      <div className="relative">
        <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-border" /></div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-background px-2 text-muted-foreground">or import from file</span>
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".csv,.xlsx,.xls"
        className="hidden"
        onChange={e => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          if (fileRef.current) fileRef.current.value = '';
        }}
      />

      <Button
        type="button"
        variant="outline"
        onClick={() => fileRef.current?.click()}
        disabled={isProcessing}
        className="gap-2 w-full h-16 border-dashed"
      >
        {isProcessing ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <div className="text-left">
              <div className="text-sm font-medium">Processing with AI...</div>
              <div className="text-xs text-muted-foreground">Extracting products from spreadsheet</div>
            </div>
          </>
        ) : (
          <>
            <Upload className="h-5 w-5" />
            <div className="text-left">
              <div className="text-sm font-medium">Import Products from CSV / Excel</div>
              <div className="text-xs text-muted-foreground">AI will extract each product automatically</div>
            </div>
          </>
        )}
      </Button>

      {importedCount > 0 && !isProcessing && (
        <div className="rounded-lg bg-success/10 border border-success/20 p-3 flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-success" />
          <span className="text-sm text-success font-medium">
            {importedCount} products imported successfully
          </span>
        </div>
      )}
    </div>
  );
}
