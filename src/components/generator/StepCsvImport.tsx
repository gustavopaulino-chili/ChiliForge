import { useState, useRef } from 'react';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { BusinessFormData } from '@/types/businessForm';
import { Upload, FileSpreadsheet, Check, AlertCircle, Table, X, Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import * as XLSX from 'xlsx';

interface Props {
  data: BusinessFormData;
  onChange: (updates: Partial<BusinessFormData>) => void;
}

function sheetToText(sheet: XLSX.WorkSheet): string {
  // Convert sheet to CSV text for AI to read
  return XLSX.utils.sheet_to_csv(sheet, { FS: ' | ', RS: '\n' });
}

function aiDataToFormUpdates(extracted: Record<string, any>): Partial<BusinessFormData> {
  const updates: Partial<BusinessFormData> = {};
  const images: Partial<BusinessFormData['images']> = {};
  const socialLinks: Partial<BusinessFormData['socialLinks']> = {};

  // Direct mappings
  if (extracted.websiteType) updates.websiteType = extracted.websiteType;
  if (extracted.businessName) updates.businessName = extracted.businessName;
  if (extracted.businessDescription) updates.businessDescription = extracted.businessDescription;
  if (extracted.businessCategory) updates.businessCategory = extracted.businessCategory;
  if (extracted.targetAudience) updates.targetAudience = extracted.targetAudience;
  if (extracted.valueProposition) updates.valueProposition = extracted.valueProposition;
  if (extracted.preferredStyle) updates.preferredStyle = extracted.preferredStyle;
  if (extracted.primaryColor) updates.primaryColor = extracted.primaryColor;
  if (extracted.secondaryColor) updates.secondaryColor = extracted.secondaryColor;
  if (extracted.city) updates.city = extracted.city;
  if (extracted.country) updates.country = extracted.country;
  if (extracted.phone) updates.phone = extracted.phone;
  if (extracted.whatsapp) updates.whatsapp = extracted.whatsapp;
  if (extracted.email) updates.email = extracted.email;

  // Arrays
  if (extracted.services?.length) updates.services = extracted.services;
  if (extracted.differentiators?.length) updates.differentiators = extracted.differentiators;

  // Images
  if (extracted.heroImage1) images.heroImage1 = extracted.heroImage1;
  if (extracted.heroImage2) images.heroImage2 = extracted.heroImage2;
  if (extracted.logoUrl) images.logoUrl = extracted.logoUrl;
  if (extracted.brandImage) images.brandImage = extracted.brandImage;
  if (extracted.sectionImage1) images.sectionImage1 = extracted.sectionImage1;
  if (extracted.sectionImage2) images.sectionImage2 = extracted.sectionImage2;
  if (extracted.sectionImage3) images.sectionImage3 = extracted.sectionImage3;
  if (Object.keys(images).length > 0) updates.images = images as any;

  // Social
  if (extracted.facebook) socialLinks.facebook = extracted.facebook;
  if (extracted.instagram) socialLinks.instagram = extracted.instagram;
  if (extracted.twitter) socialLinks.twitter = extracted.twitter;
  if (extracted.linkedin) socialLinks.linkedin = extracted.linkedin;
  if (extracted.youtube) socialLinks.youtube = extracted.youtube;
  if (Object.keys(socialLinks).length > 0) updates.socialLinks = socialLinks;

  return updates;
}

export function StepCsvImport({ data, onChange }: Props) {
  const [imported, setImported] = useState(false);
  const [fieldsFound, setFieldsFound] = useState<string[]>([]);
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState<string>('');
  const [fileName, setFileName] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const processSheetWithAI = async (wb: XLSX.WorkBook, sheetName: string) => {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) return;

    const sheetText = sheetToText(sheet);
    if (!sheetText.trim()) {
      toast.error(`Sheet "${sheetName}" is empty`);
      return;
    }

    setIsProcessing(true);
    setSelectedSheet(sheetName);

    try {
      const { data: result, error } = await supabase.functions.invoke('parse-spreadsheet', {
        body: { sheetData: sheetText },
      });

      if (error) throw error;
      if (result?.error) throw new Error(result.error);

      const extracted = result.extracted;
      if (!extracted) throw new Error('No data extracted');

      const updates = aiDataToFormUpdates(extracted);
      const matched = Object.keys(updates).filter(k => {
        const val = (updates as any)[k];
        if (Array.isArray(val)) return val.length > 0;
        if (typeof val === 'object') return Object.keys(val).length > 0;
        return !!val;
      });

      onChange(updates);
      setFieldsFound(matched);
      setImported(true);
      toast.success(`AI extracted ${matched.length} fields from "${sheetName}"`);
    } catch (err) {
      console.error('AI parsing error:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to parse spreadsheet with AI');
    } finally {
      setIsProcessing(false);
    }
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
        const arr = new Uint8Array(e.target?.result as ArrayBuffer);
        const wb = XLSX.read(arr, { type: 'array' });
        const names = wb.SheetNames;

        setWorkbook(wb);
        setSheetNames(names);
        setImported(false);
        setFieldsFound([]);
        setSelectedSheet('');

        if (names.length === 1) {
          processSheetWithAI(wb, names[0]);
        } else {
          toast.info(`Found ${names.length} sheets. Select one to import.`);
        }
      } catch {
        toast.error('Error reading file. Please check the format.');
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const clearFile = () => {
    setWorkbook(null);
    setSheetNames([]);
    setSelectedSheet('');
    setFileName('');
    setImported(false);
    setFieldsFound([]);
    setIsProcessing(false);
    if (fileRef.current) fileRef.current.value = '';
    toast.info('File removed');
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="form-section-title">Import from Spreadsheet</h3>
        <p className="form-section-desc">
          Upload a CSV or Excel file — AI will read and map the data to the form fields automatically
        </p>
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
              disabled={isProcessing}
              className="gap-2 w-full h-24 border-dashed"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  <div className="text-left">
                    <div className="text-sm font-medium">Processing with AI...</div>
                    <div className="text-xs text-muted-foreground">Extracting business data from spreadsheet</div>
                  </div>
                </>
              ) : fileName ? (
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
            {fileName && !isProcessing && (
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

        {/* Sheet tabs */}
        {sheetNames.length > 1 && !isProcessing && (
          <div>
            <Label className="text-foreground">Select Sheet</Label>
            <div className="flex flex-wrap gap-2 mt-2">
              {sheetNames.map(name => (
                <button
                  key={name}
                  type="button"
                  onClick={() => processSheetWithAI(workbook!, name)}
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

        {/* Processing indicator */}
        {isProcessing && (
          <div className="rounded-lg bg-primary/5 border border-primary/20 p-6 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-3" />
            <div className="flex items-center justify-center gap-2 mb-1">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium text-foreground">AI is reading your spreadsheet...</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Extracting business info, colors, images, and more
            </p>
          </div>
        )}

        {/* Success */}
        {imported && fieldsFound.length > 0 && !isProcessing && (
          <div className="rounded-lg bg-success/10 border border-success/20 p-4">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="h-4 w-4 text-success" />
              <span className="text-sm font-medium text-success">
                AI extracted from "{selectedSheet}":
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
              <p><strong>Supported formats:</strong> CSV, XLSX, XLS — any structure. AI will intelligently extract business data.</p>
              <p>All imported fields can be edited in the following steps.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
