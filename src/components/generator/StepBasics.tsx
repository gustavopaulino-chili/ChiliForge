import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { BusinessFormData, BUSINESS_CATEGORIES } from '@/types/businessForm';
import { FieldLabel } from './FieldLabel';

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
          <FieldLabel htmlFor="businessName" required hint="The official name of your company or brand as it should appear on the website.">
            Business Name
          </FieldLabel>
          <Input
            id="businessName"
            value={data.businessName}
            onChange={e => onChange({ businessName: e.target.value })}
            placeholder="e.g. Acme Digital Agency"
            className="mt-1.5"
          />
        </div>

        <div>
          <FieldLabel htmlFor="customSlug" required hint="Used as the folder name for hosting your website. Only letters, numbers, and hyphens allowed.">
            Site Slug
          </FieldLabel>
          <Input
            id="customSlug"
            value={data.customSlug}
            onChange={e => {
              const value = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
              onChange({ customSlug: value });
            }}
            placeholder="e.g. my-business-name"
            className="mt-1.5"
          />
          {data.customSlug ? (
            <p className="text-sm text-muted-foreground mt-1">
              Slug: {data.customSlug}
            </p>
          ) : (
            <p className="text-sm text-destructive mt-1">
              Required — this identifies your project and is used for hosting.
            </p>
          )}
        </div>

        <div>
          <FieldLabel htmlFor="businessDescription" required hint="A brief summary of what your business does, who you serve, and what makes you unique. This will be used to generate all website copy.">
            Business Description
          </FieldLabel>
          <Textarea
            id="businessDescription"
            value={data.businessDescription}
            onChange={e => onChange({ businessDescription: e.target.value })}
            placeholder="Describe what your business does, who you serve, and what makes you unique..."
            rows={3}
            className="mt-1.5"
          />
        </div>

        {(() => {
          const predefined = BUSINESS_CATEGORIES.filter(c => c !== 'Other');
          const isPredefined = predefined.includes(data.businessCategory);
          const showCustomInput = !isPredefined && data.businessCategory !== '';
          
          return (
            <div>
              <FieldLabel htmlFor="businessCategory" required hint="Select the industry that best describes your business. This helps tailor the website layout and content structure.">
                Industry / Category
              </FieldLabel>
              <Select
                value={isPredefined ? data.businessCategory : 'Other'}
                onValueChange={v => onChange({ businessCategory: v === 'Other' ? '' : v })}
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
              {!isPredefined && (
                <Input
                  value={data.businessCategory}
                  onChange={e => onChange({ businessCategory: e.target.value })}
                  placeholder="Type your industry..."
                  className="mt-2"
                />
              )}
            </div>
          );
        })()}

        <div>
          <FieldLabel htmlFor="targetAudience" hint="Describe your ideal customer — age range, profession, interests, or demographics. Helps create more targeted messaging.">
            Target Audience
          </FieldLabel>
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
