import { Switch } from '@/components/ui/switch';
import { BusinessFormData, ImageUrls } from '@/types/businessForm';
import { Image, Sparkles, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FieldLabel } from './FieldLabel';
import { ImageUploadField } from './ImageUploadField';

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
            <ImageUploadField
              label="Hero Image 1"
              hint="Main hero banner image. Should be eye-catching and represent your brand."
              value={data.images.heroImage1}
              onChange={v => updateImage('heroImage1', v)}
              imageType="hero1"
            />
            <ImageUploadField
              label="Hero Image 2"
              hint="Secondary hero image for slideshow or alternate sections."
              value={data.images.heroImage2}
              onChange={v => updateImage('heroImage2', v)}
              imageType="hero2"
            />
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
            <ImageUploadField
              label="Logo"
              hint="Your company logo. PNG or SVG with transparent background works best. Used in header and footer."
              value={data.images.logoUrl}
              onChange={v => updateImage('logoUrl', v)}
              imageType="logo"
              required
            />
            <ImageUploadField
              label="Brand Image"
              hint="An image that represents your brand identity — team photo, office, or lifestyle image."
              value={data.images.brandImage}
              onChange={v => updateImage('brandImage', v)}
              imageType="brand"
            />
          </div>
        </div>

        {/* Section Images */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Image className="h-4 w-4 text-primary" />
            <FieldLabel className="text-foreground font-medium" hint="Images used in content sections throughout the website to break up text and engage visitors.">
              Section Images
            </FieldLabel>
          </div>
          <div className="space-y-3 pl-6">
            <ImageUploadField
              label="Section Image 1"
              hint="First section image. Used in feature, benefit, or service section."
              value={data.images.sectionImage1}
              onChange={v => updateImage('sectionImage1', v)}
              imageType="section1"
            />
            <ImageUploadField
              label="Section Image 2"
              hint="Second section image. Used in another content section."
              value={data.images.sectionImage2}
              onChange={v => updateImage('sectionImage2', v)}
              imageType="section2"
            />
            <ImageUploadField
              label="Section Image 3"
              hint="Third section image. Used in additional content section."
              value={data.images.sectionImage3}
              onChange={v => updateImage('sectionImage3', v)}
              imageType="section3"
            />
          </div>
        </div>

        {/* Additional Content Images */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Image className="h-4 w-4 text-primary" />
            <FieldLabel className="text-foreground font-medium" hint="Images used in about and team sections to add visual interest and personalization.">
              About & Team Images
            </FieldLabel>
          </div>
          <div className="space-y-3 pl-6">
            <ImageUploadField
              label="About Image"
              hint="Image for your about section. It should reflect your company culture or values."
              value={data.images.aboutImage}
              onChange={v => updateImage('aboutImage', v)}
              imageType="about"
            />
            <ImageUploadField
              label="Team Image"
              hint="Team photo or group image representing your company personnel."
              value={data.images.teamImage}
              onChange={v => updateImage('teamImage', v)}
              imageType="team"
            />
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
                <div key={i} className="flex gap-2 items-end">
                  <div className="flex-1">
                    <ImageUploadField
                      label={`Product Image ${i + 1}`}
                      value={img}
                      onChange={v => updateProductImage(i, v)}
                      imageType={`product-${i}`}
                    />
                  </div>
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
