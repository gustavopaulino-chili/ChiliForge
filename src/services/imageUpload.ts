import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

const BUCKET_NAME = 'chiliforge-images';

/**
 * Upload an image file to Supabase Storage and return the public URL
 */
export async function uploadImageToStorage(file: File, userId: string, imageType: string): Promise<string | null> {
  try {
    // Validate file
    if (!file.type.startsWith('image/')) {
      toast.error('Please select a valid image file');
      return null;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image must be smaller than 5MB');
      return null;
    }

    // Create unique filename
    const timestamp = Date.now();
    const ext = file.name.split('.').pop() || 'jpg';
    const filename = `${userId}/${imageType}-${timestamp}.${ext}`;

    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(filename, file, {
        upsert: false,
        contentType: file.type,
      });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      toast.error('Failed to upload image. Please try again.');
      return null;
    }

    // Get public URL
    const { data } = supabase.storage
      .from(BUCKET_NAME)
      .getPublicUrl(filename);

    if (!data?.publicUrl) {
      toast.error('Could not generate image URL');
      return null;
    }

    toast.success('Image uploaded successfully');
    return data.publicUrl;
  } catch (error) {
    console.error('Image upload error:', error);
    toast.error('Failed to upload image');
    return null;
  }
}

/**
 * Check if a string is a valid URL
 */
export function isValidUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if URL is from Supabase Storage (uploaded by user)
 */
export function isUploadedImage(url: string): boolean {
  return url.includes('supabase') && url.includes('chiliforge-images');
}
