export type WebsiteType = 'corporate' | 'landing' | 'ecommerce' | 'portfolio' | 'saas' | 'blog' | 'educational';

export type VariantType = 'select' | 'counter' | 'text' | 'color' | 'boolean';

export const VARIANT_TYPES: { value: VariantType; label: string; desc: string }[] = [
  { value: 'select', label: 'Seleção', desc: 'Opções pré-definidas (ex: Tamanho, Cor)' },
  { value: 'counter', label: 'Quantidade', desc: 'Campo numérico com contador +/-' },
  { value: 'text', label: 'Texto livre', desc: 'Campo de digitação livre (ex: Gravação, Dedicatória)' },
  { value: 'color', label: 'Cor', desc: 'Seletor de cores com amostras visuais' },
  { value: 'boolean', label: 'Sim/Não', desc: 'Toggle liga/desliga (ex: Embrulho p/ presente)' },
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

export interface ImageUrls {
  heroImage1: string;
  heroImage2: string;
  logoUrl: string;
  brandImage: string;
  sectionImage1: string;
  sectionImage2: string;
  sectionImage3: string;
  productImages: string[];
}

export interface BusinessFormData {
  // Website Type
  websiteType: WebsiteType;

  // Business Basics
  businessName: string;
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
  preferredStyle: 'modern' | 'corporate' | 'minimal' | 'bold' | 'premium';

  // Images
  images: ImageUrls;
  generateAiImages: boolean;

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

  // Type-specific
  products: ProductItem[];
  features: FeatureItem[];
  pricingPlans: PricingPlan[];
  courses: CourseItem[];
}

export const defaultFormData: BusinessFormData = {
  websiteType: 'corporate',
  businessName: '',
  businessDescription: '',
  businessCategory: '',
  targetAudience: '',
  services: [''],
  valueProposition: '',
  differentiators: [''],
  primaryColor: '#3B82F6',
  secondaryColor: '#8B5CF6',
  preferredStyle: 'modern',
  images: {
    heroImage1: '',
    heroImage2: '',
    logoUrl: '',
    brandImage: '',
    sectionImage1: '',
    sectionImage2: '',
    sectionImage3: '',
    productImages: [],
  },
  generateAiImages: false,
  city: '',
  country: '',
  phone: '',
  whatsapp: '',
  email: '',
  socialLinks: {},
  products: [],
  features: [],
  pricingPlans: [],
  courses: [],
};

export const WEBSITE_TYPES: { value: WebsiteType; label: string; desc: string }[] = [
  { value: 'corporate', label: 'Corporate Website', desc: 'Professional business website with multiple pages' },
  { value: 'landing', label: 'Landing Page', desc: 'Single-page conversion-focused site' },
  { value: 'ecommerce', label: 'Ecommerce', desc: 'Online store with products, cart & checkout' },
  { value: 'portfolio', label: 'Portfolio', desc: 'Showcase work, projects or case studies' },
  { value: 'saas', label: 'SaaS', desc: 'Software product with features & pricing' },
  { value: 'blog', label: 'Blog', desc: 'Content-driven site with articles' },
  { value: 'educational', label: 'Educational / Course Platform', desc: 'Online courses and learning platform' },
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
