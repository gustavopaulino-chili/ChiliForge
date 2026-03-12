import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { BusinessFormData } from '@/types/businessForm';
import { Plus, X } from 'lucide-react';

interface Props {
  data: BusinessFormData;
  onChange: (updates: Partial<BusinessFormData>) => void;
}

export function StepServices({ data, onChange }: Props) {
  const addService = () => onChange({ services: [...data.services, ''] });
  const removeService = (i: number) => onChange({ services: data.services.filter((_, idx) => idx !== i) });
  const updateService = (i: number, val: string) => {
    const updated = [...data.services];
    updated[i] = val;
    onChange({ services: updated });
  };

  const addDiff = () => onChange({ differentiators: [...data.differentiators, ''] });
  const removeDiff = (i: number) => onChange({ differentiators: data.differentiators.filter((_, idx) => idx !== i) });
  const updateDiff = (i: number, val: string) => {
    const updated = [...data.differentiators];
    updated[i] = val;
    onChange({ differentiators: updated });
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="form-section-title">Services & Products</h3>
        <p className="form-section-desc">What do you offer?</p>
      </div>

      <div className="space-y-4">
        <div>
          <Label>Services / Products *</Label>
          <div className="space-y-2 mt-1.5">
            {data.services.map((s, i) => (
              <div key={i} className="flex gap-2">
                <Input
                  value={s}
                  onChange={e => updateService(i, e.target.value)}
                  placeholder={`Service ${i + 1}`}
                />
                {data.services.length > 1 && (
                  <Button variant="ghost" size="icon" onClick={() => removeService(i)}>
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={addService} className="gap-1">
              <Plus className="h-3 w-3" /> Add Service
            </Button>
          </div>
        </div>

        <div>
          <Label htmlFor="valueProposition">Main Value Proposition *</Label>
          <Textarea
            id="valueProposition"
            value={data.valueProposition}
            onChange={e => onChange({ valueProposition: e.target.value })}
            placeholder="What's the main benefit customers get from working with you?"
            rows={2}
            className="mt-1.5"
          />
        </div>

        <div>
          <Label>Key Differentiators</Label>
          <div className="space-y-2 mt-1.5">
            {data.differentiators.map((d, i) => (
              <div key={i} className="flex gap-2">
                <Input
                  value={d}
                  onChange={e => updateDiff(i, e.target.value)}
                  placeholder={`Differentiator ${i + 1}`}
                />
                {data.differentiators.length > 1 && (
                  <Button variant="ghost" size="icon" onClick={() => removeDiff(i)}>
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={addDiff} className="gap-1">
              <Plus className="h-3 w-3" /> Add Differentiator
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
