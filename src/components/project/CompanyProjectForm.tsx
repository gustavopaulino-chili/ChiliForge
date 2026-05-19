import { useRef, useState } from 'react';
import { Loader2, Plus, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FieldLabel } from '@/components/generator/FieldLabel';
import { BUSINESS_CATEGORIES, STYLE_OPTIONS } from '@/types/businessForm';
import { CompanyProjectFormData, slugifyCompanyProject } from '@/types/projectContext';
import { toast } from 'sonner';

interface Props {
  data: CompanyProjectFormData;
  onChange: (updates: Partial<CompanyProjectFormData>) => void;
  section?: 'basics' | 'offer' | 'brand' | 'contact';
  onUploadLogo?: (file: File) => Promise<string>;
}

const TONE_OPTIONS: Array<{ value: CompanyProjectFormData['toneOfVoice']; label: string; desc: string }> = [
  { value: 'conversational', label: 'Conversational', desc: 'Natural and friendly' },
  { value: 'formal', label: 'Formal', desc: 'Polished and serious' },
  { value: 'casual', label: 'Casual', desc: 'Light and approachable' },
  { value: 'authoritative', label: 'Authoritative', desc: 'Expert and direct' },
  { value: 'inspirational', label: 'Inspirational', desc: 'Motivating and aspirational' },
  { value: 'empathetic', label: 'Empathetic', desc: 'Human and reassuring' },
  { value: 'urgent', label: 'Urgent', desc: 'Action focused' },
];

const PERSONALITY_OPTIONS: Array<{ value: CompanyProjectFormData['brandPersonality']; label: string; desc: string }> = [
  { value: 'professional', label: 'Professional', desc: 'Reliable and clear' },
  { value: 'friendly', label: 'Friendly', desc: 'Warm and accessible' },
  { value: 'bold', label: 'Bold', desc: 'Strong and memorable' },
  { value: 'luxury', label: 'Luxury', desc: 'Premium and refined' },
  { value: 'tech', label: 'Tech', desc: 'Modern and efficient' },
  { value: 'creative', label: 'Creative', desc: 'Expressive and original' },
  { value: 'trustworthy', label: 'Trustworthy', desc: 'Stable and secure' },
  { value: 'innovative', label: 'Innovative', desc: 'Fresh and forward-looking' },
];

const COLOR_FIELDS: Array<{ key: keyof CompanyProjectFormData; label: string; hint: string }> = [
  { key: 'primaryColor', label: 'Primary', hint: 'Main LP color for buttons and CTAs.' },
  { key: 'secondaryColor', label: 'Secondary', hint: 'Complementary color for gradients and support areas.' },
  { key: 'accentColor', label: 'Accent', hint: 'Ad and highlight color for visual emphasis.' },
  { key: 'textColor', label: 'Text', hint: 'Main text color.' },
  { key: 'backgroundColor', label: 'Background', hint: 'Main background color.' },
];

function SectionHeader({ title, desc }: { title: string; desc: string }) {
  return (
    <div>
      <h3 className="form-section-title">{title}</h3>
      <p className="form-section-desc">{desc}</p>
    </div>
  );
}

export function CompanyProjectForm({ data, onChange, section, onUploadLogo }: Props) {
  const logoFileRef = useRef<HTMLInputElement>(null);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);

  const handleLogoFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (e.target) e.target.value = '';
    if (!file || !onUploadLogo) return;
    setIsUploadingLogo(true);
    try {
      const url = await onUploadLogo(file);
      onChange({ images: { ...data.images, logoUrl: url } });
      toast.success('Logo uploaded!');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Logo upload failed');
    } finally {
      setIsUploadingLogo(false);
    }
  };

  const updateList = (key: 'services' | 'differentiators', index: number, value: string) => {
    const next = [...data[key]];
    next[index] = value;
    onChange({ [key]: next } as Pick<CompanyProjectFormData, typeof key>);
  };

  const addListItem = (key: 'services' | 'differentiators') => {
    onChange({ [key]: [...data[key], ''] } as Pick<CompanyProjectFormData, typeof key>);
  };

  const removeListItem = (key: 'services' | 'differentiators', index: number) => {
    const next = data[key].filter((_, itemIndex) => itemIndex !== index);
    onChange({ [key]: next.length ? next : [''] } as Pick<CompanyProjectFormData, typeof key>);
  };

  const updateSocialLink = (key: keyof CompanyProjectFormData['socialLinks'], value: string) => {
    onChange({ socialLinks: { ...data.socialLinks, [key]: value } });
  };

  const updateBusinessName = (businessName: string) => {
    const previousAutoSlug = slugifyCompanyProject(data.businessName);
    const nextAutoSlug = slugifyCompanyProject(businessName);
    const shouldAutoUpdateSlug = !data.projectSlug || data.projectSlug === 'project' || data.projectSlug === previousAutoSlug;
    onChange({
      businessName,
      ...(shouldAutoUpdateSlug ? { projectSlug: nextAutoSlug } : {}),
    });
  };

  return (
    <div className="space-y-7">
      {(!section || section === 'basics') && (
        <div className="space-y-6">
          <SectionHeader
            title="Company Basics"
            desc="The reusable company context that feeds both landing pages and ad campaigns."
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <FieldLabel htmlFor="businessName" required>Company / Brand Name</FieldLabel>
              <Input
                id="businessName"
                value={data.businessName}
                onChange={(event) => updateBusinessName(event.target.value)}
                placeholder="e.g. ChiliForge"
              />
            </div>

            <div className="space-y-2">
              <FieldLabel htmlFor="projectSlug" required hint="The folder used to store LPs and Ads for this company.">
                Project Folder
              </FieldLabel>
              <Input
                id="projectSlug"
                value={data.projectSlug}
                onChange={(event) => onChange({ projectSlug: slugifyCompanyProject(event.target.value) })}
                placeholder="e.g. chiliforge"
                className="font-mono text-sm"
              />
            </div>
          </div>

          <div className="space-y-2">
            <FieldLabel htmlFor="businessDescription" required hint="What the business does, who it helps, and the market context.">
              What does this company do?
            </FieldLabel>
            <Textarea
              id="businessDescription"
              value={data.businessDescription}
              onChange={(event) => onChange({ businessDescription: event.target.value })}
              rows={4}
              placeholder="Describe the company, customers, offer, and why it matters."
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <FieldLabel required>Industry / Category</FieldLabel>
              <Select
                value={BUSINESS_CATEGORIES.includes(data.businessCategory) ? data.businessCategory : 'Other'}
                onValueChange={(value) => onChange({ businessCategory: value === 'Other' ? '' : value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select an industry" />
                </SelectTrigger>
                <SelectContent>
                  {BUSINESS_CATEGORIES.map((category) => (
                    <SelectItem key={category} value={category}>{category}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!BUSINESS_CATEGORIES.includes(data.businessCategory) && (
                <Input
                  value={data.businessCategory}
                  onChange={(event) => onChange({ businessCategory: event.target.value })}
                  placeholder="Type the industry"
                />
              )}
            </div>

            <div className="space-y-2">
              <FieldLabel htmlFor="targetAudience" hint="The broad reusable audience for this company. Campaign-specific details can be refined later.">
                Target Audience
              </FieldLabel>
              <Input
                id="targetAudience"
                value={data.targetAudience}
                onChange={(event) => onChange({ targetAudience: event.target.value })}
                placeholder="e.g. Founders, local businesses, parents, B2B teams"
              />
            </div>
          </div>
        </div>
      )}

      {(!section || section === 'offer') && (
        <div className="space-y-6">
          <SectionHeader
            title="Offer & Differentiators"
            desc="The offer foundation reused by LP copy, ad copy, positioning, and layout choices."
          />

          <div className="space-y-2">
            <FieldLabel htmlFor="valueProposition" required hint="The main promise both LPs and Ads should communicate.">
              Main Value Proposition
            </FieldLabel>
            <Textarea
              id="valueProposition"
              value={data.valueProposition}
              onChange={(event) => onChange({ valueProposition: event.target.value })}
              placeholder="What is the main benefit customers get from this company?"
              rows={2}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="space-y-3">
              <FieldLabel hint="Main products or services. These become LP sections and ad offer options.">
                Services / Products
              </FieldLabel>
              {data.services.map((service, index) => (
                <div key={index} className="flex gap-2">
                  <Input
                    value={service}
                    onChange={(event) => updateList('services', index, event.target.value)}
                    placeholder={`Service ${index + 1}`}
                  />
                  {data.services.length > 1 && (
                    <Button variant="ghost" size="icon" onClick={() => removeListItem('services', index)}>
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={() => addListItem('services')} className="gap-1.5">
                <Plus className="h-3.5 w-3.5" /> Add Service
              </Button>
            </div>

            <div className="space-y-3">
              <FieldLabel hint="Proof points, advantages, guarantees, or reasons customers choose the company.">
                Key Differentiators
              </FieldLabel>
              {data.differentiators.map((item, index) => (
                <div key={index} className="flex gap-2">
                  <Input
                    value={item}
                    onChange={(event) => updateList('differentiators', index, event.target.value)}
                    placeholder={`Differentiator ${index + 1}`}
                  />
                  {data.differentiators.length > 1 && (
                    <Button variant="ghost" size="icon" onClick={() => removeListItem('differentiators', index)}>
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={() => addListItem('differentiators')} className="gap-1.5">
                <Plus className="h-3.5 w-3.5" /> Add Differentiator
              </Button>
            </div>
          </div>
        </div>
      )}

      {(!section || section === 'brand') && (
        <div className="space-y-6">
          <SectionHeader
            title="Brand System"
            desc="Visual and verbal rules shared by landing pages, ads, editors, and future campaigns."
          />

          {/* Company Logo */}
          <div className="space-y-2">
            <FieldLabel hint="Automatically applied to all Landing Pages and Ads generated from this company.">
              Company Logo
              <span className="ml-1.5 text-xs font-normal text-primary">(applied to all LPs & Ads)</span>
            </FieldLabel>
            {data.images?.logoUrl ? (
              <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-card/50 p-3">
                <div className="h-14 w-14 rounded-lg border border-border/40 bg-muted/30 flex items-center justify-center shrink-0 overflow-hidden">
                  <img src={data.images.logoUrl} alt="Company logo" className="h-full w-full object-contain" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground">Logo loaded</p>
                  <p className="text-[11px] text-muted-foreground truncate mt-0.5">{data.images.logoUrl}</p>
                </div>
                <Button
                  type="button" variant="ghost" size="icon"
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => onChange({ images: { ...data.images, logoUrl: '' } })}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <div className="flex gap-2">
                <Input
                  placeholder="https://brand.com/logo.png"
                  value={data.images?.logoUrl || ''}
                  onChange={e => onChange({ images: { ...data.images, logoUrl: e.target.value } })}
                />
                {onUploadLogo && (
                  <Button
                    type="button" variant="outline" disabled={isUploadingLogo}
                    onClick={() => logoFileRef.current?.click()}
                    className="gap-2 shrink-0"
                  >
                    {isUploadingLogo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    Upload
                  </Button>
                )}
              </div>
            )}
            <input ref={logoFileRef} type="file" accept="image/*" className="hidden" onChange={handleLogoFileChange} />
          </div>

          <div className="space-y-3">
            <FieldLabel hint="The visual style used as the base for both generators.">Preferred Style</FieldLabel>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {STYLE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => onChange({ preferredStyle: option.value })}
                  className={`rounded-lg border p-4 text-left transition-all ${
                    data.preferredStyle === option.value
                      ? 'border-primary bg-primary/5 ring-1 ring-primary'
                      : 'border-border hover:border-muted-foreground/30'
                  }`}
                >
                  <div className="font-medium text-foreground text-sm">{option.label}</div>
                  <div className="text-xs text-muted-foreground mt-1">{option.desc}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {COLOR_FIELDS.map((field) => (
              <div key={field.key} className="space-y-2">
                <FieldLabel htmlFor={field.key} hint={field.hint}>{field.label}</FieldLabel>
                <div className="flex gap-2">
                  <input
                    id={field.key}
                    type="color"
                    value={String(data[field.key])}
                    onChange={(event) => onChange({ [field.key]: event.target.value } as Partial<CompanyProjectFormData>)}
                    className="h-10 w-12 rounded-md border border-input bg-background cursor-pointer"
                  />
                  <Input
                    value={String(data[field.key])}
                    onChange={(event) => onChange({ [field.key]: event.target.value } as Partial<CompanyProjectFormData>)}
                    className="min-w-0 font-mono text-sm"
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <FieldLabel htmlFor="headingFont" hint="Google Font or brand font used for titles.">
                Heading Font
              </FieldLabel>
              <Input
                id="headingFont"
                value={data.headingFont}
                onChange={(event) => onChange({ headingFont: event.target.value })}
                placeholder="e.g. Montserrat"
              />
            </div>
            <div className="space-y-2">
              <FieldLabel htmlFor="bodyFont" hint="Google Font or brand font used for body text.">
                Body Font
              </FieldLabel>
              <Input
                id="bodyFont"
                value={data.bodyFont}
                onChange={(event) => onChange({ bodyFont: event.target.value })}
                placeholder="e.g. Inter"
              />
            </div>
          </div>

          <div className="space-y-3">
            <FieldLabel hint="Overall brand personality for layouts, copy, and image prompts.">Brand Personality</FieldLabel>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {PERSONALITY_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => onChange({ brandPersonality: option.value })}
                  className={`rounded-lg border p-3 text-left transition-all ${
                    data.brandPersonality === option.value
                      ? 'border-accent bg-accent/10 text-accent ring-1 ring-accent/40'
                      : 'border-border text-muted-foreground hover:border-muted-foreground/30 hover:text-foreground'
                  }`}
                >
                  <div className="font-medium text-xs">{option.label}</div>
                  <div className="text-xs opacity-75 mt-0.5">{option.desc}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <FieldLabel hint="Communication tone reused in LP copy and ad copy.">Tone of Voice</FieldLabel>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {TONE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => onChange({ toneOfVoice: option.value })}
                  className={`rounded-lg border p-3 text-left transition-all ${
                    data.toneOfVoice === option.value
                      ? 'border-primary bg-primary/5 text-primary ring-1 ring-primary'
                      : 'border-border text-muted-foreground hover:border-muted-foreground/30 hover:text-foreground'
                  }`}
                >
                  <div className="font-medium text-xs">{option.label}</div>
                  <div className="text-xs opacity-75 mt-0.5">{option.desc}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <FieldLabel htmlFor="brandKeywords" hint="Reusable brand words, themes, claims, or emotional cues.">
                Brand Keywords
              </FieldLabel>
              <Textarea
                id="brandKeywords"
                value={data.brandKeywords}
                onChange={(event) => onChange({ brandKeywords: event.target.value })}
                placeholder="e.g. fast, premium, local, reliable, no-code"
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <FieldLabel htmlFor="forbiddenWords" hint="Terms or claims the generators should avoid.">
                Forbidden Words
              </FieldLabel>
              <Textarea
                id="forbiddenWords"
                value={data.forbiddenWords}
                onChange={(event) => onChange({ forbiddenWords: event.target.value })}
                placeholder="e.g. guaranteed results, cheapest, medical claims"
                rows={3}
              />
            </div>
          </div>

          <div className="space-y-2">
            <FieldLabel htmlFor="designNotes" hint="Extra reusable design guidance for both generators.">
              Brand / Design Notes
            </FieldLabel>
            <Textarea
              id="designNotes"
              value={data.designNotes}
              onChange={(event) => onChange({ designNotes: event.target.value })}
              rows={3}
              placeholder="Any reusable visual rules, references, layout preferences, or brand constraints."
            />
          </div>
        </div>
      )}

      {(!section || section === 'contact') && (
        <div className="space-y-6">
          <SectionHeader
            title="Contact & Channels"
            desc="Reusable contact, location, website, and social links for LP sections and ad CTAs."
          />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <FieldLabel htmlFor="email">Email</FieldLabel>
              <Input id="email" value={data.email} onChange={(event) => onChange({ email: event.target.value })} placeholder="hello@brand.com" />
            </div>
            <div className="space-y-2">
              <FieldLabel htmlFor="phone">Phone</FieldLabel>
              <Input id="phone" value={data.phone} onChange={(event) => onChange({ phone: event.target.value })} placeholder="+1 555 000 0000" />
            </div>
            <div className="space-y-2">
              <FieldLabel htmlFor="whatsapp">WhatsApp</FieldLabel>
              <Input id="whatsapp" value={data.whatsapp} onChange={(event) => onChange({ whatsapp: event.target.value })} placeholder="+1 555 000 0000" />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <FieldLabel htmlFor="city">City</FieldLabel>
              <Input id="city" value={data.city} onChange={(event) => onChange({ city: event.target.value })} placeholder="City" />
            </div>
            <div className="space-y-2">
              <FieldLabel htmlFor="country">Country</FieldLabel>
              <Input id="country" value={data.country} onChange={(event) => onChange({ country: event.target.value })} placeholder="Country" />
            </div>
            <div className="space-y-2">
              <FieldLabel htmlFor="sourceWebsite">Website</FieldLabel>
              <Input id="sourceWebsite" value={data.sourceWebsite} onChange={(event) => onChange({ sourceWebsite: event.target.value })} placeholder="https://brand.com" />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <FieldLabel htmlFor="instagram">Instagram</FieldLabel>
              <Input id="instagram" value={data.socialLinks.instagram || ''} onChange={(event) => updateSocialLink('instagram', event.target.value)} placeholder="https://instagram.com/brand" />
            </div>
            <div className="space-y-2">
              <FieldLabel htmlFor="linkedin">LinkedIn</FieldLabel>
              <Input id="linkedin" value={data.socialLinks.linkedin || ''} onChange={(event) => updateSocialLink('linkedin', event.target.value)} placeholder="https://linkedin.com/company/brand" />
            </div>
            <div className="space-y-2">
              <FieldLabel htmlFor="facebook">Facebook</FieldLabel>
              <Input id="facebook" value={data.socialLinks.facebook || ''} onChange={(event) => updateSocialLink('facebook', event.target.value)} placeholder="https://facebook.com/brand" />
            </div>
            <div className="space-y-2">
              <FieldLabel htmlFor="youtube">YouTube</FieldLabel>
              <Input id="youtube" value={data.socialLinks.youtube || ''} onChange={(event) => updateSocialLink('youtube', event.target.value)} placeholder="https://youtube.com/@brand" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
