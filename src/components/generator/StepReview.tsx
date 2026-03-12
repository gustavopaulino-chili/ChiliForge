import { BusinessFormData } from '@/types/businessForm';

interface Props {
  data: BusinessFormData;
}

export function StepReview({ data }: Props) {
  const services = data.services.filter(Boolean);
  const diffs = data.differentiators.filter(Boolean);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="form-section-title">Review Your Details</h3>
        <p className="form-section-desc">Make sure everything looks good before generating</p>
      </div>

      <div className="space-y-4">
        <ReviewSection title="Business">
          <ReviewItem label="Name" value={data.businessName} />
          <ReviewItem label="Industry" value={data.businessCategory} />
          <ReviewItem label="Target Audience" value={data.targetAudience} />
          <ReviewItem label="Description" value={data.businessDescription} />
        </ReviewSection>

        <ReviewSection title="Services">
          <ReviewItem label="Services" value={services.join(', ')} />
          <ReviewItem label="Value Proposition" value={data.valueProposition} />
          {diffs.length > 0 && <ReviewItem label="Differentiators" value={diffs.join(', ')} />}
        </ReviewSection>

        <ReviewSection title="Brand">
          <ReviewItem label="Style" value={data.preferredStyle} />
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Colors:</span>
            <div className="h-6 w-6 rounded-full border border-border" style={{ background: data.primaryColor }} />
            <div className="h-6 w-6 rounded-full border border-border" style={{ background: data.secondaryColor }} />
          </div>
        </ReviewSection>

        <ReviewSection title="Contact">
          <ReviewItem label="Location" value={`${data.city}, ${data.country}`} />
          <ReviewItem label="Email" value={data.email} />
          {data.phone && <ReviewItem label="Phone" value={data.phone} />}
        </ReviewSection>
      </div>
    </div>
  );
}

function ReviewSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-muted/50 p-4">
      <h4 className="text-sm font-semibold text-foreground mb-2">{title}</h4>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function ReviewItem({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="flex gap-2 text-sm">
      <span className="text-muted-foreground shrink-0">{label}:</span>
      <span className="text-foreground">{value}</span>
    </div>
  );
}
