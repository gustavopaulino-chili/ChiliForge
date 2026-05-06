export type LandingPreset = 'general' | 'campaign' | 'black-friday' | 'launch' | 'webinar' | 'lead-capture' | 'app-download' | 'seasonal';

export type VariantType = 'select' | 'counter' | 'text' | 'color' | 'boolean';

export const VARIANT_TYPES: { value: VariantType; label: string; desc: string }[] = [
  { value: 'select', label: 'Selection', desc: 'Pre-defined options (e.g. Size, Color)' },
  { value: 'counter', label: 'Quantity', desc: 'Numeric field with +/- counter' },
  { value: 'text', label: 'Free text', desc: 'Free-form text input (e.g. Engraving, Dedication)' },
  { value: 'color', label: 'Color', desc: 'Color picker with visual swatches' },
  { value: 'boolean', label: 'Yes/No', desc: 'Toggle on/off (e.g. Gift wrap)' },
];

export interface ProductVariant {
  name: string;
  type: VariantType;
  values: string[];
}

export interface ProductInput {
  label: string;
  placeholder: string;
  required: boolean;
}

export interface ProductItem {
  name: string;
  description: string;
  price: string;
  discountPrice: string;
  images: string[];
  sku: string;
  category: string;
  variants: ProductVariant[];
  inputs: ProductInput[];
}

export interface FeatureItem {
  name: string;
  description: string;
  icon: string;
}

export interface PricingPlan {
  name: string;
  price: string;
  features: string[];
}

export interface CourseItem {
  title: string;
  instructor: string;
  description: string;
  modules: string;
  price: string;
}

export interface PageSection {
  title: string;
  description: string;
}

export interface FormFieldConfig {
  label: string;
  type: 'text' | 'email' | 'tel' | 'textarea' | 'select';
  placeholder?: string;
  required?: boolean;
  options?: string[]; // for select type
}

export interface PageItem {
  name: string;
  description: string;
  required: boolean;
  enabled: boolean;
  sections: PageSection[];
  kind?: 'section' | 'form' | 'embed';
  embedCode?: string;
  formAction?: string;
  formButton?: string;
  formFields?: FormFieldConfig[];
}

export type ContentMode = 'ai' | 'manual';

export interface PagesConfig {
  mode: ContentMode;
  aiSummary: string;
  pages: PageItem[];
}

export interface ImageUrls {
  heroImage1: string;
  heroImage2: string;
  logoUrl: string;
  logoAlt: string;
  brandImage: string;
  sectionImage1: string;
  sectionImage2: string;
  sectionImage3: string;
  aboutImage: string;
  teamImage: string;
  productImages: string[];
  // Dimensions
  logoWidth?: number;
  logoHeight?: number;
  heroImage1Width?: number;
  heroImage1Height?: number;
  heroImage2Width?: number;
  heroImage2Height?: number;
  brandImageWidth?: number;
  brandImageHeight?: number;
  sectionImage1Width?: number;
  sectionImage1Height?: number;
  sectionImage2Width?: number;
  sectionImage2Height?: number;
  sectionImage3Width?: number;
  sectionImage3Height?: number;
  aboutImageWidth?: number;
  aboutImageHeight?: number;
  teamImageWidth?: number;
  teamImageHeight?: number;
}

export interface BusinessFormData {
  // Landing Page Preset
  landingPreset: LandingPreset;
  generationObjective: string;

  // Business Basics
  businessName: string;
  customSlug: string;
  businessDescription: string;
  businessCategory: string;
  targetAudience: string;

  // Services / Products
  services: string[];
  valueProposition: string;
  differentiators: string[];

  // Brand Identity
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  textColor: string;
  backgroundColor: string;
  preferredStyle: 'modern' | 'corporate' | 'minimal' | 'bold' | 'premium';

  // Images
  images: ImageUrls;
  generateAiImages: boolean;
  generateCarousel: boolean;

  // Location
  city: string;
  country: string;

  // Contact
  phone: string;
  whatsapp: string;
  email: string;
  socialLinks: {
    facebook?: string;
    instagram?: string;
    twitter?: string;
    linkedin?: string;
    youtube?: string;
  };

  // Pages & Content
  pagesConfig: PagesConfig;

  // Website scraping
  sourceWebsite: string;
  designNotes: string;

  // Fonts
  headingFont: string;
  bodyFont: string;

  // Language (detected from source website)
  language: 'pt' | 'en' | 'es' | 'fr' | 'de' | 'it' | 'ja' | 'zh' | 'auto';

  // Image context from URL analysis
  heroImage1Context: string;
  heroImage2Context: string;
  brandImageContext: string;
  sectionImage1Context: string;
  sectionImage2Context: string;
  sectionImage3Context: string;
  aboutImageContext: string;
  teamImageContext: string;

  // Advanced Settings (Brand & Conversion)
  brandPersonality: 'professional' | 'friendly' | 'bold' | 'luxury' | 'tech' | 'creative' | 'trustworthy' | 'innovative';
  toneOfVoice: 'formal' | 'casual' | 'inspirational' | 'authoritative' | 'conversational' | 'urgent' | 'empathetic';
  conversionGoal: 'lead-generation' | 'sales' | 'newsletter-signup' | 'app-download' | 'webinar-registration' | 'contact-form' | 'product-purchase';
  urgencyLevel: 'low' | 'medium' | 'high' | 'urgent';
  socialProof: boolean;
  testimonials: boolean;
  trustBadges: boolean;
  countdownTimer: boolean;
  guarantee: string;

  // Download files (PDFs, docs, etc.) to link according to the user-described page context
  downloadFiles: Array<{ name: string; url: string; label?: string; context?: string; mime?: string }>;
}

export const defaultFormData: BusinessFormData = {
  landingPreset: 'general',
  generationObjective: '',
  businessName: '',
  customSlug: '',
  businessDescription: '',
  businessCategory: '',
  targetAudience: '',
  services: [''],
  valueProposition: '',
  differentiators: [''],
  primaryColor: '#3B82F6',
  secondaryColor: '#8B5CF6',
  accentColor: '#F59E0B',
  textColor: '#1F2937',
  backgroundColor: '#FFFFFF',
  preferredStyle: 'modern',
  images: {
    heroImage1: '',
    heroImage2: '',
    logoUrl: '',
    logoAlt: '',
    brandImage: '',
    sectionImage1: '',
    sectionImage2: '',
    sectionImage3: '',
    aboutImage: '',
    teamImage: '',
    productImages: [],
    // Dimensions
    logoWidth: undefined,
    logoHeight: undefined,
    heroImage1Width: undefined,
    heroImage1Height: undefined,
    heroImage2Width: undefined,
    heroImage2Height: undefined,
    brandImageWidth: undefined,
    brandImageHeight: undefined,
    sectionImage1Width: undefined,
    sectionImage1Height: undefined,
    sectionImage2Width: undefined,
    sectionImage2Height: undefined,
    sectionImage3Width: undefined,
    sectionImage3Height: undefined,
    aboutImageWidth: undefined,
    aboutImageHeight: undefined,
    teamImageWidth: undefined,
    teamImageHeight: undefined,
  },
  generateAiImages: false,
  generateCarousel: false,
  city: '',
  country: '',
  phone: '',
  whatsapp: '',
  email: '',
  socialLinks: {},
  pagesConfig: {
    mode: 'ai',
    aiSummary: '',
    pages: [],
  },
  sourceWebsite: '',
  designNotes: '',
  headingFont: '',
  bodyFont: '',
  language: 'auto',
  heroImage1Context: '',
  heroImage2Context: '',
  brandImageContext: '',
  sectionImage1Context: '',
  sectionImage2Context: '',
  sectionImage3Context: '',
  aboutImageContext: '',
  teamImageContext: '',
  brandPersonality: 'professional',
  toneOfVoice: 'conversational',
  conversionGoal: 'lead-generation',
  urgencyLevel: 'medium',
  socialProof: true,
  testimonials: true,
  trustBadges: true,
  countdownTimer: false,
  guarantee: '',
  downloadFiles: [],
};

export const LANDING_PRESETS: { value: LandingPreset; label: string; desc: string; emoji: string }[] = [
  { value: 'general', label: 'Institutional', desc: 'Standard landing page to present the company, services, and capture leads', emoji: '🏢' },
  { value: 'campaign', label: 'Campaign', desc: 'Page focused on a specific marketing campaign with strong CTA', emoji: '📣' },
  { value: 'black-friday', label: 'Black Friday / Promo', desc: 'Urgent layout with countdown timer, discounts, and limited-time offers', emoji: '🔥' },
  { value: 'launch', label: 'Product Launch', desc: 'Impactful presentation of a new product or service with pre-sale', emoji: '🚀' },
  { value: 'webinar', label: 'Webinar / Event', desc: 'Registration page for an online or in-person event', emoji: '🎤' },
  { value: 'lead-capture', label: 'Lead Capture', desc: 'Optimized form for lead generation with a value offer', emoji: '🎯' },
  { value: 'app-download', label: 'App Download', desc: 'Page to promote a mobile app download', emoji: '📱' },
  { value: 'seasonal', label: 'Seasonal / Holiday', desc: 'Themed landing page for special dates (Christmas, Mother\'s Day, etc.)', emoji: '🎄' },
];

export const BUSINESS_CATEGORIES = [
  'Technology / SaaS',
  'Agency / Consulting',
  'E-commerce / Retail',
  'Restaurant / Food',
  'Healthcare / Medical',
  'Real Estate',
  'Education / Training',
  'Fitness / Wellness',
  'Legal / Financial',
  'Construction / Home Services',
  'Beauty / Salon',
  'Photography / Creative',
  'Non-Profit',
  'Other',
];

export const STYLE_OPTIONS = [
  { value: 'modern' as const, label: 'Modern', desc: 'Clean lines, gradients, bold typography' },
  { value: 'corporate' as const, label: 'Corporate', desc: 'Professional, structured, trustworthy' },
  { value: 'minimal' as const, label: 'Minimal', desc: 'White space, simple, elegant' },
  { value: 'bold' as const, label: 'Bold', desc: 'High contrast, dramatic, impactful' },
  { value: 'premium' as const, label: 'Premium', desc: 'Luxury feel, refined, sophisticated' },
];
