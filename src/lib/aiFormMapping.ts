import { BusinessFormData } from '@/types/businessForm';

// Shared mapping from an AI-extracted record (spreadsheet / website scrape / LP briefing)
// into a Partial<BusinessFormData> the wizard can apply via onChange. Kept in one place so
// the spreadsheet/website importer and the briefing "Apply" button stay consistent.

export function normalizeColor(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const v = value.trim();
  // Extract first hex color — supports 3, 6, or 8 char (RGBA, strip alpha channel)
  const hexMatch = v.match(/#([0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3})(?:[^0-9a-f]|$)/i);
  if (hexMatch) {
    const raw = hexMatch[1].toLowerCase();
    if (raw.length === 3) return '#' + raw[0] + raw[0] + raw[1] + raw[1] + raw[2] + raw[2];
    if (raw.length === 8) return '#' + raw.slice(0, 6);
    return '#' + raw;
  }
  const rgb = v.match(/rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i);
  if (rgb) {
    return '#' + [rgb[1], rgb[2], rgb[3]].map(n => parseInt(n).toString(16).padStart(2, '0')).join('');
  }
  const rgba = v.match(/rgba\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,[^)]+\)/i);
  if (rgba) {
    return '#' + [rgba[1], rgba[2], rgba[3]].map(n => parseInt(n).toString(16).padStart(2, '0')).join('');
  }
  return null;
}

export function aiDataToFormUpdates(extracted: Record<string, any>): Partial<BusinessFormData> {
  const updates: Partial<BusinessFormData> = {};
  const images: Partial<BusinessFormData['images']> = {};
  const socialLinks: Partial<BusinessFormData['socialLinks']> = {};

  if (extracted.landingPreset) (updates as any).landingPreset = extracted.landingPreset;
  if (extracted.businessName) updates.businessName = extracted.businessName;
  if (extracted.businessDescription) updates.businessDescription = extracted.businessDescription;
  if (extracted.businessCategory) updates.businessCategory = extracted.businessCategory;
  if (extracted.targetAudience) updates.targetAudience = extracted.targetAudience;
  if (extracted.valueProposition) updates.valueProposition = extracted.valueProposition;
  if (extracted.preferredStyle) {
    const VALID_STYLES = ['modern', 'corporate', 'minimal', 'bold', 'premium'] as const;
    const STYLE_MAP: Record<string, typeof VALID_STYLES[number]> = {
      editorial: 'minimal', energetic: 'bold', saas: 'modern', tech: 'modern',
      luxury: 'premium', elegant: 'premium', 'high-end': 'premium',
      dramatic: 'bold', creative: 'bold', corporate: 'corporate',
    };
    const raw = String(extracted.preferredStyle).toLowerCase().trim();
    updates.preferredStyle = (VALID_STYLES as readonly string[]).includes(raw)
      ? (raw as typeof VALID_STYLES[number])
      : (STYLE_MAP[raw] ?? 'modern');
  }
  const primaryColor = normalizeColor(extracted.primaryColor);
  if (primaryColor) updates.primaryColor = primaryColor;
  const secondaryColor = normalizeColor(extracted.secondaryColor);
  if (secondaryColor) updates.secondaryColor = secondaryColor;
  const accentColor = normalizeColor(extracted.accentColor);
  if (accentColor) updates.accentColor = accentColor;
  const textColor = normalizeColor(extracted.textColor);
  if (textColor) updates.textColor = textColor;
  const backgroundColor = normalizeColor(extracted.backgroundColor);
  if (backgroundColor) updates.backgroundColor = backgroundColor;
  if (extracted.city) updates.city = extracted.city;
  if (extracted.country) updates.country = extracted.country;
  if (extracted.phone) updates.phone = extracted.phone;
  if (extracted.whatsapp) updates.whatsapp = extracted.whatsapp;
  if (extracted.email) updates.email = extracted.email;
  if (extracted.headingFont) updates.headingFont = extracted.headingFont;
  if (extracted.bodyFont) updates.bodyFont = extracted.bodyFont;

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

  if (extracted.heroImage1Context) updates.heroImage1Context = extracted.heroImage1Context;
  if (extracted.heroImage2Context) updates.heroImage2Context = extracted.heroImage2Context;
  if (extracted.brandImageContext) updates.brandImageContext = extracted.brandImageContext;
  if (extracted.sectionImage1Context) updates.sectionImage1Context = extracted.sectionImage1Context;
  if (extracted.sectionImage2Context) updates.sectionImage2Context = extracted.sectionImage2Context;
  if (extracted.sectionImage3Context) updates.sectionImage3Context = extracted.sectionImage3Context;

  if (extracted.facebook) socialLinks.facebook = extracted.facebook;
  if (extracted.instagram) socialLinks.instagram = extracted.instagram;
  if (extracted.twitter) socialLinks.twitter = extracted.twitter;
  if (extracted.linkedin) socialLinks.linkedin = extracted.linkedin;
  if (extracted.youtube) socialLinks.youtube = extracted.youtube;
  if (Object.keys(socialLinks).length > 0) updates.socialLinks = socialLinks;

  return updates;
}
