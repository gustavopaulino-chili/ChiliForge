export type LandingPreset = 'general' | 'campaign' | 'black-friday' | 'launch' | 'webinar' | 'lead-capture' | 'app-download' | 'seasonal';

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

export interface PageSection {
  title: string;
  description: string;
}

export interface PageItem {
  name: string;
  description: string;
  required: boolean;
  enabled: boolean;
  sections: PageSection[];
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
  brandImage: string;
  sectionImage1: string;
  sectionImage2: string;
  sectionImage3: string;
  productImages: string[];
}

export interface BusinessFormData {
  // Landing Page Preset
  landingPreset: LandingPreset;

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
  accentColor: string;
  textColor: string;
  backgroundColor: string;
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

  // Pages & Content
  pagesConfig: PagesConfig;

  // Website scraping
  sourceWebsite: string;
  designNotes: string;
}

export const defaultFormData: BusinessFormData = {
  landingPreset: 'general',
  businessName: '',
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
  pagesConfig: {
    mode: 'manual',
    aiSummary: '',
    pages: [],
  },
  sourceWebsite: '',
  designNotes: '',
};

export const LANDING_PRESETS: { value: LandingPreset; label: string; desc: string; emoji: string }[] = [
  { value: 'general', label: 'Institucional', desc: 'Landing page padrão para apresentar empresa, serviços e captar leads', emoji: '🏢' },
  { value: 'campaign', label: 'Campanha', desc: 'Página focada em uma campanha de marketing específica com CTA forte', emoji: '📣' },
  { value: 'black-friday', label: 'Black Friday / Promoção', desc: 'Layout urgente com contagem regressiva, descontos e ofertas limitadas', emoji: '🔥' },
  { value: 'launch', label: 'Lançamento de Produto', desc: 'Apresentação impactante de novo produto ou serviço com pré-venda', emoji: '🚀' },
  { value: 'webinar', label: 'Webinar / Evento', desc: 'Página de inscrição para evento online ou presencial', emoji: '🎤' },
  { value: 'lead-capture', label: 'Captura de Leads', desc: 'Formulário otimizado para geração de leads com oferta de valor', emoji: '🎯' },
  { value: 'app-download', label: 'Download de App', desc: 'Página para promover download de aplicativo mobile', emoji: '📱' },
  { value: 'seasonal', label: 'Sazonal / Data Comemorativa', desc: 'Landing page temática para datas especiais (Natal, Dia das Mães, etc.)', emoji: '🎄' },
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
