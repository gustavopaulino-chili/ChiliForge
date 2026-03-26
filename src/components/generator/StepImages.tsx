import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { BusinessFormData, ImageUrls } from '@/types/businessForm';
import { Image, Sparkles, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FieldLabel } from './FieldLabel';

interface Props {
  data: BusinessFormData;
  onChange: (updates: Partial<BusinessFormData>) => void;
}

export function StepImages({ data, onChange }: Props) {
  const updateImage = (key: keyof ImageUrls, value: string) => {
    onChange({ images: { ...data.images, [key]: value } });
  };

  const addProductImage = () => {
    onChange({ images: { ...data.images, productImages: [...data.images.productImages, ''] } });
  };

  const removeProductImage = (i: number) => {
    onChange({ images: { ...data.images, productImages: data.images.productImages.filter((_, idx) => idx !== i) } });
  };

  const updateProductImage = (i: number, val: string) => {
    const updated = [...data.images.productImages];
    updated[i] = val;
    onChange({ images: { ...data.images, productImages: updated } });
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="form-section-title">Images</h3>
        <p className="form-section-desc">Add image URLs for your website sections</p>
      </div>

      <div className="space-y-6">
        {/* Hero Images */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Image className="h-4 w-4 text-primary" />
            <FieldLabel className="text-foreground font-medium" hint="Large banner images displayed at the top of the homepage. Use high-resolution landscape images (1920x1080 recommended).">
              Hero Images
            </FieldLabel>
          </div>
          <div className="space-y-3 pl-6">
            <div>
              <FieldLabel htmlFor="heroImage1" className="text-xs text-muted-foreground" hint="Main hero banner image. Should be eye-catching and represent your brand.">
                Hero Image 1 URL
              </FieldLabel>
              <Input
                id="heroImage1"
                value={data.images.heroImage1}
                onChange={e => updateImage('heroImage1', e.target.value)}
                placeholder="https://example.com/hero1.jpg"
                className="mt-1"
              />
            </div>
            <div>
              <FieldLabel htmlFor="heroImage2" className="text-xs text-muted-foreground" hint="Secondary hero image for slideshow or alternate sections.">
                Hero Image 2 URL
              </FieldLabel>
              <Input
                id="heroImage2"
                value={data.images.heroImage2}
                onChange={e => updateImage('heroImage2', e.target.value)}
                placeholder="https://example.com/hero2.jpg"
                className="mt-1"
              />
            </div>
          </div>
        </div>

        {/* Brand / Identity */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Image className="h-4 w-4 text-primary" />
            <FieldLabel className="text-foreground font-medium" hint="Your brand visual assets — logo and brand imagery used across the website.">
              Brand / Identity
            </FieldLabel>
          </div>
          <div className="space-y-3 pl-6">
            <div>
              <FieldLabel htmlFor="logoUrl" className="text-xs text-muted-foreground" hint="Your company logo. PNG with transparent background works best. Used in header and footer.">
                Logo URL
              </FieldLabel>
              <Input
                id="logoUrl"
                value={data.images.logoUrl}
                onChange={e => updateImage('logoUrl', e.target.value)}
                placeholder="https://example.com/logo.png"
                className="mt-1"
              />
            </div>
            <div>
              <FieldLabel htmlFor="brandImage" className="text-xs text-muted-foreground" hint="An image that represents your brand identity — team photo, office, or lifestyle image.">
                Brand Image URL
              </FieldLabel>
              <Input
                id="brandImage"
                value={data.images.brandImage}
                onChange={e => updateImage('brandImage', e.target.value)}
                placeholder="https://example.com/brand.jpg"
                className="mt-1"
              />
            </div>
          </div>
        </div>

        {/* Content Images */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Image className="h-4 w-4 text-primary" />
            <FieldLabel className="text-foreground font-medium" hint="Images used throughout the website content — about section, services, features, etc.">
              Content Images
            </FieldLabel>
          </div>
          <div className="space-y-3 pl-6">
            {(['sectionImage1', 'sectionImage2', 'sectionImage3'] as const).map((key, i) => (
              <div key={key}>
                <FieldLabel htmlFor={key} className="text-xs text-muted-foreground" hint={`Image for content section ${i + 1}. Used alongside text in about, services, or feature sections.`}>
                  Section Image {i + 1}
                </FieldLabel>
                <Input
                  id={key}
                  value={data.images[key]}
                  onChange={e => updateImage(key, e.target.value)}
                  placeholder={`https://example.com/section${i + 1}.jpg`}
                  className="mt-1"
                />
              </div>
            ))}
          </div>
        </div>

        {/* Product Images */}
        {data.images.productImages.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Image className="h-4 w-4 text-primary" />
              <FieldLabel className="text-foreground font-medium" hint="Product photos for your e-commerce store. Use square or consistent aspect ratio images.">
                Product Images
              </FieldLabel>
            </div>
            <div className="space-y-2 pl-6">
              {data.images.productImages.map((img, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    value={img}
                    onChange={e => updateProductImage(i, e.target.value)}
                    placeholder={`Product image ${i + 1} URL`}
                  />
                  <Button variant="ghost" size="icon" onClick={() => removeProductImage(i)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={addProductImage} className="gap-1">
                <Plus className="h-3 w-3" /> Add Product Image
              </Button>
            </div>
          </div>
        )}

        {/* AI Generation Toggle */}
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Sparkles className="h-5 w-5 text-primary" />
              <div>
                <FieldLabel className="text-foreground font-medium" hint="When enabled, AI will use your provided images as reference to generate new professional visuals matching your brand style.">
                  Generate AI Images
                </FieldLabel>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Use provided images as reference to generate new visuals with AI
                </p>
              </div>
            </div>
            <Switch
              checked={data.generateAiImages}
              onCheckedChange={v => onChange({ generateAiImages: v })}
            />
          </div>
          {data.generateAiImages && (
            <p className="text-xs text-muted-foreground mt-3 pl-8">
              AI will generate hero banners, section backgrounds, and marketing visuals matching your brand style.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
