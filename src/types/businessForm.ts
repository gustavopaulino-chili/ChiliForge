export interface BusinessFormData {
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
  logoUrl?: string;
  preferredStyle: 'modern' | 'corporate' | 'minimal' | 'bold' | 'premium';

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
}

export const defaultFormData: BusinessFormData = {
  businessName: '',
  businessDescription: '',
  businessCategory: '',
  targetAudience: '',
  services: [''],
  valueProposition: '',
  differentiators: [''],
  primaryColor: '#3B82F6',
  secondaryColor: '#8B5CF6',
  logoUrl: '',
  preferredStyle: 'modern',
  city: '',
  country: '',
  phone: '',
  whatsapp: '',
  email: '',
  socialLinks: {},
};

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
