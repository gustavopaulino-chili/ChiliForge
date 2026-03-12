import { Input } from '@/components/ui/input';
import { BusinessFormData } from '@/types/businessForm';
import { FieldLabel } from './FieldLabel';

interface Props {
  data: BusinessFormData;
  onChange: (updates: Partial<BusinessFormData>) => void;
}

export function StepContact({ data, onChange }: Props) {
  const updateSocial = (key: string, val: string) => {
    onChange({ socialLinks: { ...data.socialLinks, [key]: val } });
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="form-section-title">Location & Contact</h3>
        <p className="form-section-desc">How can customers reach you?</p>
      </div>

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <FieldLabel htmlFor="city" hint="The city where your business is located. Shown in the footer and used for local SEO.">
              City
            </FieldLabel>
            <Input
              id="city"
              value={data.city}
              onChange={e => onChange({ city: e.target.value })}
              placeholder="e.g. Dubai"
              className="mt-1.5"
            />
          </div>
          <div>
            <FieldLabel htmlFor="country" hint="The country where your business operates. Used for local SEO and contact section.">
              Country
            </FieldLabel>
            <Input
              id="country"
              value={data.country}
              onChange={e => onChange({ country: e.target.value })}
              placeholder="e.g. UAE"
              className="mt-1.5"
            />
          </div>
        </div>

        <div>
          <FieldLabel htmlFor="email" required hint="The main contact email displayed on your website. Visitors will use this to reach you.">
            Email
          </FieldLabel>
          <Input
            id="email"
            type="email"
            value={data.email}
            onChange={e => onChange({ email: e.target.value })}
            placeholder="hello@yourbusiness.com"
            className="mt-1.5"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <FieldLabel htmlFor="phone" hint="Business phone number with country code. Will be shown in the contact section and footer.">
              Phone
            </FieldLabel>
            <Input
              id="phone"
              value={data.phone}
              onChange={e => onChange({ phone: e.target.value })}
              placeholder="+1 234 567 890"
              className="mt-1.5"
            />
          </div>
          <div>
            <FieldLabel htmlFor="whatsapp" hint="WhatsApp number with country code. A click-to-chat button will be added to the website.">
              WhatsApp
            </FieldLabel>
            <Input
              id="whatsapp"
              value={data.whatsapp}
              onChange={e => onChange({ whatsapp: e.target.value })}
              placeholder="+1 234 567 890"
              className="mt-1.5"
            />
          </div>
        </div>

        <div>
          <FieldLabel className="text-foreground" hint="Add your social media profile URLs. These will be shown as icons in the footer.">
            Social Media Links
          </FieldLabel>
          <div className="space-y-3 mt-2">
            {(['facebook', 'instagram', 'twitter', 'linkedin', 'youtube'] as const).map(platform => (
              <div key={platform}>
                <FieldLabel htmlFor={platform} className="text-xs text-muted-foreground capitalize">
                  {platform}
                </FieldLabel>
                <Input
                  id={platform}
                  value={data.socialLinks[platform] || ''}
                  onChange={e => updateSocial(platform, e.target.value)}
                  placeholder={`https://${platform}.com/yourbusiness`}
                  className="mt-1"
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
