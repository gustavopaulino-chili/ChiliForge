import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { FieldLabel } from './FieldLabel';
import { Loader2, Upload, X, CheckCircle } from 'lucide-react';
import { uploadImageToStorage, isValidUrl, isUploadedImage } from '@/services/imageUpload';
import { useAuth } from '@/contexts/AuthContext';

interface ImageUploadFieldProps {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  imageType: 'logo' | 'hero1' | 'hero2' | 'section1' | 'section2' | 'section3' | 'brand' | 'about' | 'team' | 'product';
  required?: boolean;
}

export function ImageUploadField({
  label,
  hint,
  value,
  onChange,
  imageType,
  required = false,
}: ImageUploadFieldProps) {
  const { user } = useAuth();
  const [isUploading, setIsUploading] = useState(false);
  const [mode, setMode] = useState<'url' | 'file'>('url');

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user?.id) return;

    setIsUploading(true);
    try {
      const url = await uploadImageToStorage(file, user.id, imageType);
      if (url) {
        onChange(url);
        setMode('url');
      }
    } finally {
      setIsUploading(false);
    }
  };

  const isUploaded = value && isUploadedImage(value);
  const isValid = value && (isValidUrl(value) || isUploaded);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <FieldLabel className="text-xs text-muted-foreground" hint={hint}>
          {label}
          {required && <span className="text-red-500 ml-1">*</span>}
        </FieldLabel>
        <div className="flex gap-1 text-xs">
          <button
            onClick={() => setMode('url')}
            className={`px-2 py-1 rounded ${mode === 'url' ? 'bg-primary text-white' : 'text-muted-foreground hover:text-foreground'}`}
          >
            URL
          </button>
          <button
            onClick={() => setMode('file')}
            className={`px-2 py-1 rounded ${mode === 'file' ? 'bg-primary text-white' : 'text-muted-foreground hover:text-foreground'}`}
          >
            Upload
          </button>
        </div>
      </div>

      {mode === 'url' ? (
        <div className="flex gap-2">
          <Input
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder="https://example.com/image.jpg"
            className={isValid ? 'border-green-500' : undefined}
          />
          {isValid && <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0" />}
        </div>
      ) : (
        <div className="flex gap-2">
          <label className="flex-1">
            <div className="relative">
              <input
                type="file"
                accept="image/*"
                onChange={handleFileSelect}
                disabled={isUploading}
                className="hidden"
              />
              <Button
                variant="outline"
                className="w-full"
                disabled={isUploading}
                onClick={(e) => {
                  e.preventDefault();
                  (e.currentTarget.previousElementSibling as HTMLInputElement)?.click();
                }}
              >
                {isUploading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4 mr-2" />
                    Choose Image
                  </>
                )}
              </Button>
            </div>
          </label>
        </div>
      )}

      {/* Show preview or uploaded indicator */}
      {value && (
        <div className="flex items-center gap-2 p-2 rounded bg-muted">
          {isUploaded ? (
            <>
              <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />
              <span className="text-xs text-muted-foreground">Uploaded image (will be used on site)</span>
            </>
          ) : isValid ? (
            <>
              <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />
              <span className="text-xs text-muted-foreground truncate">{value}</span>
            </>
          ) : null}
          {value && (
            <button
              onClick={() => onChange('')}
              className="ml-auto text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        {isUploaded && '✓ This image will be automatically used on your landing page'}
      </p>
    </div>
  );
}
