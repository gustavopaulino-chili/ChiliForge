import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { BusinessFormData, BUSINESS_CATEGORIES } from '@/types/businessForm';

interface Props {
  data: BusinessFormData;
  onChange: (updates: Partial<BusinessFormData>) => void;
}

export function StepBasics({ data, onChange }: Props) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="form-section-title">Business Basics</h3>
        <p className="form-section-desc">Tell us about your business</p>
      </div>

      <div className="space-y-4">
        <div>
          <Label htmlFor="businessName">Business Name *</Label>
          <Input
            id="businessName"
            value={data.businessName}
            onChange={e => onChange({ businessName: e.target.value })}
            placeholder="e.g. Acme Digital Agency"
            className="mt-1.5"
          />
        </div>

        <div>
          <Label htmlFor="businessDescription">Business Description *</Label>
          <Textarea
            id="businessDescription"
            value={data.businessDescription}
            onChange={e => onChange({ businessDescription: e.target.value })}
            placeholder="Describe what your business does, who you serve, and what makes you unique..."
            rows={3}
            className="mt-1.5"
          />
        </div>

        <div>
          <Label htmlFor="businessCategory">Industry / Category *</Label>
          <Select
            value={data.businessCategory}
            onValueChange={v => onChange({ businessCategory: v })}
          >
            <SelectTrigger className="mt-1.5">
              <SelectValue placeholder="Select your industry" />
            </SelectTrigger>
            <SelectContent>
              {BUSINESS_CATEGORIES.map(cat => (
                <SelectItem key={cat} value={cat}>{cat}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label htmlFor="targetAudience">Target Audience</Label>
          <Input
            id="targetAudience"
            value={data.targetAudience}
            onChange={e => onChange({ targetAudience: e.target.value })}
            placeholder="e.g. Small business owners aged 25-45"
            className="mt-1.5"
          />
        </div>
      </div>
    </div>
  );
}
