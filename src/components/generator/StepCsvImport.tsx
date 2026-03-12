import { useState, useRef } from 'react';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { BusinessFormData } from '@/types/businessForm';
import { Upload, FileSpreadsheet, Check, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  data: BusinessFormData;
  onChange: (updates: Partial<BusinessFormData>) => void;
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, '').toLowerCase());
  const rows: Record<string, string>[] = [];
  
  for (let i = 1; i < lines.length; i++) {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;
    
    for (const char of lines[i]) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current.trim());
    
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] || '';
    });
    rows.push(row);
  }
  return rows;
}

// Map CSV column names to form fields
const COLUMN_MAP: Record<string, (data: Partial<BusinessFormData>, value: string) => void> = {
  'title': (d, v) => { d.businessName = v; },
  'business name': (d, v) => { d.businessName = v; },
  'name': (d, v) => { if (!d.businessName) d.businessName = v; },
  'description': (d, v) => { d.businessDescription = v; },
  'business description': (d, v) => { d.businessDescription = v; },
  'category': (d, v) => { d.businessCategory = v; },
  'industry': (d, v) => { d.businessCategory = v; },
  'target audience': (d, v) => { d.targetAudience = v; },
  'audience': (d, v) => { d.targetAudience = v; },
  'email': (d, v) => { d.email = v; },
  'phone': (d, v) => { d.phone = v; },
  'whatsapp': (d, v) => { d.whatsapp = v; },
  'city': (d, v) => { d.city = v; },
  'country': (d, v) => { d.country = v; },
  'value proposition': (d, v) => { d.valueProposition = v; },
  'primary color': (d, v) => { d.primaryColor = v; },
  'secondary color': (d, v) => { d.secondaryColor = v; },
  'style': (d, v) => {
    const valid = ['modern', 'corporate', 'minimal', 'bold', 'premium'];
    if (valid.includes(v.toLowerCase())) d.preferredStyle = v.toLowerCase() as any;
  },
  'website type': (d, v) => {
    const map: Record<string, string> = {
      corporate: 'corporate', landing: 'landing', ecommerce: 'ecommerce',
      portfolio: 'portfolio', saas: 'saas', blog: 'blog', educational: 'educational',
    };
    const key = v.toLowerCase().replace(/\s+/g, '');
    if (map[key]) (d as any).websiteType = map[key];
  },
  'hero image 1': (d, v) => { if (!d.images) d.images = {} as any; (d.images as any).heroImage1 = v; },
  'hero image 2': (d, v) => { if (!d.images) d.images = {} as any; (d.images as any).heroImage2 = v; },
  'logo url': (d, v) => { if (!d.images) d.images = {} as any; (d.images as any).logoUrl = v; },
  'logo': (d, v) => { if (!d.images) d.images = {} as any; (d.images as any).logoUrl = v; },
  'brand image': (d, v) => { if (!d.images) d.images = {} as any; (d.images as any).brandImage = v; },
  'image url': (d, v) => { if (!d.images) d.images = {} as any; (d.images as any).sectionImage1 = v; },
  'section image 1': (d, v) => { if (!d.images) d.images = {} as any; (d.images as any).sectionImage1 = v; },
  'section image 2': (d, v) => { if (!d.images) d.images = {} as any; (d.images as any).sectionImage2 = v; },
  'section image 3': (d, v) => { if (!d.images) d.images = {} as any; (d.images as any).sectionImage3 = v; },
  'facebook': (d, v) => { if (!d.socialLinks) d.socialLinks = {}; d.socialLinks.facebook = v; },
  'instagram': (d, v) => { if (!d.socialLinks) d.socialLinks = {}; d.socialLinks.instagram = v; },
  'twitter': (d, v) => { if (!d.socialLinks) d.socialLinks = {}; d.socialLinks.twitter = v; },
  'linkedin': (d, v) => { if (!d.socialLinks) d.socialLinks = {}; d.socialLinks.linkedin = v; },
  'youtube': (d, v) => { if (!d.socialLinks) d.socialLinks = {}; d.socialLinks.youtube = v; },
};

// Handle services/differentiators which can be multi-value (semicolon separated)
function mapServicesAndDiffs(rows: Record<string, string>[], updates: Partial<BusinessFormData>) {
  const row = rows[0];
  if (!row) return;
  
  const servicesKey = Object.keys(row).find(k => k.toLowerCase().includes('service'));
  if (servicesKey && row[servicesKey]) {
    updates.services = row[servicesKey].split(';').map(s => s.trim()).filter(Boolean);
  }
  
  const diffsKey = Object.keys(row).find(k => k.toLowerCase().includes('differentiator'));
  if (diffsKey && row[diffsKey]) {
    updates.differentiators = row[diffsKey].split(';').map(s => s.trim()).filter(Boolean);
  }
}

export function StepCsvImport({ data, onChange }: Props) {
  const [imported, setImported] = useState(false);
  const [fieldsFound, setFieldsFound] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (file: File) => {
    if (!file.name.endsWith('.csv')) {
      toast.error('Please upload a CSV file');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const rows = parseCsv(text);
        if (rows.length === 0) {
          toast.error('CSV file is empty or has no data rows');
          return;
        }

        const row = rows[0]; // Use first data row
        const updates: Partial<BusinessFormData> = {};
        const matched: string[] = [];

        for (const [col, value] of Object.entries(row)) {
          if (!value) continue;
          const normalizedCol = col.toLowerCase().trim();
          const mapper = COLUMN_MAP[normalizedCol];
          if (mapper) {
            mapper(updates, value);
            matched.push(col);
          }
        }

        mapServicesAndDiffs(rows, updates);
        if (updates.services) matched.push('services');

        onChange(updates);
        setFieldsFound(matched);
        setImported(true);
        toast.success(`Imported ${matched.length} fields from CSV`);
      } catch {
        toast.error('Error parsing CSV file');
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="form-section-title">Import from CSV</h3>
        <p className="form-section-desc">Upload a CSV file to auto-fill the form, or skip to fill manually</p>
      </div>

      <div className="space-y-4">
        <div>
          <Label>CSV File (optional)</Label>
          <div className="mt-2">
            <input
              ref={fileRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={e => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
              }}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => fileRef.current?.click()}
              className="gap-2 w-full h-24 border-dashed"
            >
              {imported ? (
                <>
                  <Check className="h-5 w-5 text-success" />
                  <span>CSV Imported — Click to re-upload</span>
                </>
              ) : (
                <>
                  <Upload className="h-5 w-5" />
                  <span>Click to upload CSV</span>
                </>
              )}
            </Button>
          </div>
        </div>

        {imported && fieldsFound.length > 0 && (
          <div className="rounded-lg bg-success/10 border border-success/20 p-4">
            <div className="flex items-center gap-2 mb-2">
              <FileSpreadsheet className="h-4 w-4 text-success" />
              <span className="text-sm font-medium text-success">Fields imported:</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {fieldsFound.map(f => (
                <span key={f} className="text-xs bg-success/10 text-success rounded px-2 py-0.5">{f}</span>
              ))}
            </div>
          </div>
        )}

        <div className="rounded-lg bg-muted/50 p-4">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-muted-foreground mt-0.5" />
            <div className="text-xs text-muted-foreground space-y-1">
              <p><strong>Supported columns:</strong> Title, Description, Category, Target Audience, Email, Phone, City, Country, Services (semicolon-separated), Hero Image 1, Logo URL, and more.</p>
              <p>All imported fields can be edited in the following steps.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
