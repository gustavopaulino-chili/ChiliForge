import { useState, useRef } from 'react';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { BusinessFormData } from '@/types/businessForm';
import { Upload, FileSpreadsheet, Check, AlertCircle, Table, X, Loader2, Sparkles, Globe, Link2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import * as XLSX from 'xlsx';

interface Props {
  data: BusinessFormData;
  onChange: (updates: Partial<BusinessFormData>) => void;
}

function sheetToText(sheet: XLSX.WorkSheet): string {
  return XLSX.utils.sheet_to_csv(sheet, { FS: ' | ', RS: '\n' });
}

function aiDataToFormUpdates(extracted: Record<string, any>): Partial<BusinessFormData> {
  const updates: Partial<BusinessFormData> = {};
  const images: Partial<BusinessFormData['images']> = {};
  const socialLinks: Partial<BusinessFormData['socialLinks']> = {};

  if (extracted.landingPreset) (updates as any).landingPreset = extracted.landingPreset;
  if (extracted.businessName) updates.businessName = extracted.businessName;
  if (extracted.businessDescription) updates.businessDescription = extracted.businessDescription;
  if (extracted.businessCategory) updates.businessCategory = extracted.businessCategory;
  if (extracted.targetAudience) updates.targetAudience = extracted.targetAudience;
  if (extracted.valueProposition) updates.valueProposition = extracted.valueProposition;
  if (extracted.preferredStyle) updates.preferredStyle = extracted.preferredStyle;
  if (extracted.primaryColor) updates.primaryColor = extracted.primaryColor;
  if (extracted.secondaryColor) updates.secondaryColor = extracted.secondaryColor;
  if (extracted.accentColor) updates.accentColor = extracted.accentColor;
  if (extracted.textColor) updates.textColor = extracted.textColor;
  if (extracted.backgroundColor) updates.backgroundColor = extracted.backgroundColor;
  if (extracted.city) updates.city = extracted.city;
  if (extracted.country) updates.country = extracted.country;
  if (extracted.phone) updates.phone = extracted.phone;
  if (extracted.whatsapp) updates.whatsapp = extracted.whatsapp;
  if (extracted.email) updates.email = extracted.email;

  if (extracted.services?.length) updates.services = extracted.services;
  if (extracted.differentiators?.length) updates.differentiators = extracted.differentiators;

  if (extracted.heroImage1) images.heroImage1 = extracted.heroImage1;
  if (extracted.heroImage2) images.heroImage2 = extracted.heroImage2;
  if (extracted.logoUrl) images.logoUrl = extracted.logoUrl;
  if (extracted.brandImage) images.brandImage = extracted.brandImage;
  if (extracted.sectionImage1) images.sectionImage1 = extracted.sectionImage1;
  if (extracted.sectionImage2) images.sectionImage2 = extracted.sectionImage2;
  if (extracted.sectionImage3) images.sectionImage3 = extracted.sectionImage3;
  if (Object.keys(images).length > 0) updates.images = images as any;

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

  // Website URL scraping state
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [isScraping, setIsScraping] = useState(false);
  const [scrapeResult, setScrapeResult] = useState<{ fields: string[]; designNotes: string } | null>(null);
  const [designNotes, setDesignNotes] = useState('');

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

  const handleScrapeWebsite = async () => {
    if (!websiteUrl.trim()) {
      toast.error('Please enter a website URL');
      return;
    }

    setIsScraping(true);
    setScrapeResult(null);

    try {
      const { data: result, error } = await supabase.functions.invoke('scrape-website', {
        body: { url: websiteUrl.trim() },
      });

      if (error) throw error;
      if (result?.error) throw new Error(result.error);

      const extracted = result.extracted;
      if (!extracted) throw new Error('No data extracted from website');

      const updates = aiDataToFormUpdates(extracted);
      const matched = Object.keys(updates).filter(k => {
        const val = (updates as any)[k];
        if (Array.isArray(val)) return val.length > 0;
        if (typeof val === 'object') return Object.keys(val).length > 0;
        return !!val;
      });

      // Store design notes for the prompt generation
      if (extracted.designNotes) {
        setDesignNotes(extracted.designNotes);
        // Add designNotes to form data so it can be used in prompt generation
        onChange({ ...updates, designNotes: extracted.designNotes, sourceWebsite: websiteUrl.trim() } as any);
      } else {
        onChange(updates);
      }

      setScrapeResult({ fields: matched, designNotes: extracted.designNotes || '' });
      setImported(true);
      setFieldsFound(matched);
      toast.success(`AI analyzed the website and extracted ${matched.length} fields!`);
    } catch (err) {
      console.error('Website scraping error:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to analyze website');
    } finally {
      setIsScraping(false);
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
    <div className="space-y-8">
      <div>
        <h3 className="form-section-title">Import Data</h3>
        <p className="form-section-desc">
          Import business data from a website URL or spreadsheet — AI will extract and fill the form automatically
        </p>
      </div>

      {/* Website URL Scraping */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <Globe className="h-4 w-4 text-primary" />
          <Label className="text-sm font-semibold text-foreground">Import from Website URL</Label>
        </div>
        <p className="text-xs text-muted-foreground -mt-2">
          Paste a website link and AI will analyze the entire site: content, images, colors, style, and more. The generated website will follow a similar design.
        </p>

        <div className="flex gap-2">
          <Input
            type="url"
            placeholder="https://example.com"
            value={websiteUrl}
            onChange={(e) => setWebsiteUrl(e.target.value)}
            disabled={isScraping}
            className="flex-1"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleScrapeWebsite();
              }
            }}
          />
          <Button
            type="button"
            onClick={handleScrapeWebsite}
            disabled={isScraping || !websiteUrl.trim()}
            className="gap-2 shrink-0"
          >
            {isScraping ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                Analyze Site
              </>
            )}
          </Button>
        </div>

        {/* Scraping progress */}
        {isScraping && (
          <div className="rounded-lg bg-primary/5 border border-primary/20 p-6 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-3" />
            <div className="flex items-center justify-center gap-2 mb-1">
              <Globe className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium text-foreground">AI is analyzing the website...</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Reading content, extracting images, identifying colors and design patterns
            </p>
          </div>
        )}

        {/* Scrape success */}
        {scrapeResult && !isScraping && (
          <div className="rounded-lg bg-success/10 border border-success/20 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Check className="h-4 w-4 text-success" />
              <span className="text-sm font-medium text-success">
                Website analyzed successfully!
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {scrapeResult.fields.map(f => (
                <span key={f} className="text-xs bg-success/10 text-success rounded px-2 py-0.5">{f}</span>
              ))}
            </div>
            {scrapeResult.designNotes && (
              <div className="mt-2 rounded bg-primary/5 border border-primary/10 p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                  <span className="text-xs font-medium text-primary">Design Analysis</span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {scrapeResult.designNotes.length > 200 
                    ? scrapeResult.designNotes.substring(0, 200) + '...' 
                    : scrapeResult.designNotes}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Divider */}
      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-border" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-card px-3 text-muted-foreground">or</span>
        </div>
      </div>

      {/* Spreadsheet Import */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <FileSpreadsheet className="h-4 w-4 text-primary" />
          <Label className="text-sm font-semibold text-foreground">Import from Spreadsheet</Label>
        </div>
        <p className="text-xs text-muted-foreground -mt-2">
          Upload a CSV or Excel file — AI will read and map the data to the form fields automatically
        </p>

        <div>
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
            className="gap-2 w-full h-20 border-dashed"
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

        {/* Success (spreadsheet) */}
        {imported && fieldsFound.length > 0 && !isProcessing && !scrapeResult && (
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
      </div>

      <div className="rounded-lg bg-muted/50 p-4">
        <div className="flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-muted-foreground mt-0.5" />
          <div className="text-xs text-muted-foreground space-y-1">
            <p><strong>Website URL:</strong> AI will read the site content, extract images, colors, and design style to replicate.</p>
            <p><strong>Spreadsheet:</strong> CSV, XLSX, XLS — any structure. AI will intelligently extract business data.</p>
            <p>All imported fields can be edited in the following steps.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
