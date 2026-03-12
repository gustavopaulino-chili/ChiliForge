import { useState, useRef } from 'react';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { BusinessFormData } from '@/types/businessForm';
import { Upload, FileSpreadsheet, Check, AlertCircle, Table, X } from 'lucide-react';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';

interface Props {
  data: BusinessFormData;
  onChange: (updates: Partial<BusinessFormData>) => void;
}

// Map CSV/sheet column names to form fields
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

function sheetToRows(sheet: XLSX.WorkSheet): Record<string, string>[] {
  const json = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: '' });
  // Normalize keys to lowercase
  return json.map(row => {
    const normalized: Record<string, string> = {};
    for (const [key, value] of Object.entries(row)) {
      normalized[key.toLowerCase().trim()] = String(value).trim();
    }
    return normalized;
  });
}

function mapRowToFormData(rows: Record<string, string>[]): { updates: Partial<BusinessFormData>; matched: string[] } {
  const row = rows[0];
  if (!row) return { updates: {}, matched: [] };

  const updates: Partial<BusinessFormData> = {};
  const matched: string[] = [];

  for (const [col, value] of Object.entries(row)) {
    if (!value) continue;
    const mapper = COLUMN_MAP[col];
    if (mapper) {
      mapper(updates, value);
      matched.push(col);
    }
  }

  // Services (semicolon separated)
  const servicesKey = Object.keys(row).find(k => k.includes('service'));
  if (servicesKey && row[servicesKey]) {
    updates.services = row[servicesKey].split(';').map(s => s.trim()).filter(Boolean);
    matched.push('services');
  }

  const diffsKey = Object.keys(row).find(k => k.includes('differentiator'));
  if (diffsKey && row[diffsKey]) {
    updates.differentiators = row[diffsKey].split(';').map(s => s.trim()).filter(Boolean);
    matched.push('differentiators');
  }

  return { updates, matched };
}

export function StepCsvImport({ data, onChange }: Props) {
  const [imported, setImported] = useState(false);
  const [fieldsFound, setFieldsFound] = useState<string[]>([]);
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState<string>('');
  const [fileName, setFileName] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const processSheet = (wb: XLSX.WorkBook, sheetName: string) => {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) return;

    const rows = sheetToRows(sheet);
    if (rows.length === 0) {
      toast.error(`Sheet "${sheetName}" has no data rows`);
      return;
    }

    const { updates, matched } = mapRowToFormData(rows);
    onChange(updates);
    setFieldsFound(matched);
    setImported(true);
    setSelectedSheet(sheetName);
    toast.success(`Imported ${matched.length} fields from "${sheetName}"`);
  };

  const handleFile = (file: File) => {
    const validExts = ['.csv', '.xlsx', '.xls'];
    const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
    if (!validExts.includes(ext)) {
      toast.error('Please upload a CSV or Excel file (.csv, .xlsx, .xls)');
      return;
    }

    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array' });
        const names = wb.SheetNames;

        setWorkbook(wb);
        setSheetNames(names);

        if (names.length === 1) {
          // Single sheet — process immediately
          processSheet(wb, names[0]);
        } else {
          // Multiple sheets — let user pick
          setSelectedSheet('');
          setImported(false);
          setFieldsFound([]);
          toast.info(`Found ${names.length} sheets. Select one to import.`);
        }
      } catch {
        toast.error('Error parsing file. Please check the format.');
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleSheetSelect = (name: string) => {
    if (!workbook) return;
    processSheet(workbook, name);
  };

  const clearFile = () => {
    setWorkbook(null);
    setSheetNames([]);
    setSelectedSheet('');
    setFileName('');
    setImported(false);
    setFieldsFound([]);
    if (fileRef.current) fileRef.current.value = '';
    toast.info('File removed');
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="form-section-title">Import from Spreadsheet</h3>
        <p className="form-section-desc">Upload a CSV or Excel file to auto-fill the form, or skip to fill manually</p>
      </div>

      <div className="space-y-4">
        <div>
          <Label>Spreadsheet File (optional)</Label>
          <div className="mt-2">
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.xlsx,.xls"
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
            {fileName ? (
                <>
                  <FileSpreadsheet className="h-5 w-5 text-primary" />
                  <div className="text-left">
                    <div className="text-sm font-medium">{fileName}</div>
                    <div className="text-xs text-muted-foreground">Click to upload a different file</div>
                  </div>
                </>
              ) : (
                <>
                  <Upload className="h-5 w-5" />
                  <span>Click to upload CSV or Excel file</span>
                </>
              )}
            </Button>
            {fileName && (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={clearFile}
                className="gap-1.5 mt-2"
              >
                <X className="h-4 w-4" /> Remove File
              </Button>
            )}
          </div>
        </div>

        {/* Sheet tabs — shown when file has multiple sheets */}
        {sheetNames.length > 1 && (
          <div>
            <Label className="text-foreground">Select Sheet</Label>
            <div className="flex flex-wrap gap-2 mt-2">
              {sheetNames.map(name => (
                <button
                  key={name}
                  type="button"
                  onClick={() => handleSheetSelect(name)}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-all ${
                    selectedSheet === name
                      ? 'border-primary bg-primary/10 text-primary ring-1 ring-primary/30'
                      : 'border-border bg-card text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground'
                  }`}
                >
                  <Table className="h-3.5 w-3.5" />
                  {name}
                  {selectedSheet === name && <Check className="h-3.5 w-3.5 ml-1" />}
                </button>
              ))}
            </div>
          </div>
        )}

        {imported && fieldsFound.length > 0 && (
          <div className="rounded-lg bg-success/10 border border-success/20 p-4">
            <div className="flex items-center gap-2 mb-2">
              <FileSpreadsheet className="h-4 w-4 text-success" />
              <span className="text-sm font-medium text-success">
                Fields imported from "{selectedSheet}":
              </span>
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
              <p><strong>Supported formats:</strong> CSV, XLSX, XLS. If Excel has multiple sheets, you can select which one to import.</p>
              <p><strong>Supported columns:</strong> Title, Description, Category, Target Audience, Email, Phone, City, Country, Services (semicolon-separated), Hero Image 1, Logo URL, and more.</p>
              <p>All imported fields can be edited in the following steps.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
