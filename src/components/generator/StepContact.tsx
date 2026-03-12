import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { BusinessFormData } from '@/types/businessForm';

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
            <Label htmlFor="city">City</Label>
            <Input
              id="city"
              value={data.city}
              onChange={e => onChange({ city: e.target.value })}
              placeholder="e.g. Dubai"
              className="mt-1.5"
            />
          </div>
          <div>
            <Label htmlFor="country">Country</Label>
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
          <Label htmlFor="email">Email *</Label>
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
            <Label htmlFor="phone">Phone</Label>
            <Input
              id="phone"
              value={data.phone}
              onChange={e => onChange({ phone: e.target.value })}
              placeholder="+1 234 567 890"
              className="mt-1.5"
            />
          </div>
          <div>
            <Label htmlFor="whatsapp">WhatsApp</Label>
            <Input
              id="whatsapp"
              value={data.whatsapp}
              onChange={e => onChange({ whatsapp: e.target.value })}
              placeholder="+1 234 567 890"
              className="mt-1.5"
            />
          </div>
        </div>

        {/* Social Links */}
        <div>
          <Label className="text-foreground">Social Media Links</Label>
          <div className="space-y-3 mt-2">
            {(['facebook', 'instagram', 'twitter', 'linkedin', 'youtube'] as const).map(platform => (
              <div key={platform}>
                <Label htmlFor={platform} className="text-xs text-muted-foreground capitalize">{platform}</Label>
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
