import { BusinessFormData, defaultFormData } from './businessForm';
import { AdCreativeFormData, defaultAdCreativeFormData } from './adCreativeForm';

export interface CompanyProjectFormData {
  businessName: string;
  projectSlug: string;
  businessDescription: string;
  businessCategory: string;
  targetAudience: string;
  valueProposition: string;
  services: string[];
  differentiators: string[];
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  textColor: string;
  backgroundColor: string;
  preferredStyle: BusinessFormData['preferredStyle'];
  toneOfVoice: BusinessFormData['toneOfVoice'];
  brandPersonality: BusinessFormData['brandPersonality'];
  brandKeywords: string;
  forbiddenWords: string;
  headingFont: string;
  bodyFont: string;
  city: string;
  country: string;
  phone: string;
  whatsapp: string;
  email: string;
  sourceWebsite: string;
  designNotes: string;
  images: BusinessFormData['images'];
  socialLinks: BusinessFormData['socialLinks'];
}

export const defaultCompanyProjectFormData: CompanyProjectFormData = {
  businessName: '',
  projectSlug: '',
  businessDescription: '',
  businessCategory: '',
  targetAudience: '',
  valueProposition: '',
  services: [''],
  differentiators: [''],
  primaryColor: defaultFormData.primaryColor,
  secondaryColor: defaultFormData.secondaryColor,
  accentColor: defaultFormData.accentColor,
  textColor: defaultFormData.textColor,
  backgroundColor: defaultFormData.backgroundColor,
  preferredStyle: defaultFormData.preferredStyle,
  toneOfVoice: defaultFormData.toneOfVoice,
  brandPersonality: defaultFormData.brandPersonality,
  brandKeywords: '',
  forbiddenWords: '',
  headingFont: defaultFormData.headingFont,
  bodyFont: defaultFormData.bodyFont,
  city: '',
  country: '',
  phone: '',
  whatsapp: '',
  email: '',
  sourceWebsite: '',
  designNotes: '',
  images: defaultFormData.images,
  socialLinks: defaultFormData.socialLinks,
};

export const slugifyCompanyProject = (value: string) =>
  (value || 'project')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'project';

export function normalizeCompanyProjectFormData(candidate?: Partial<CompanyProjectFormData> | null): CompanyProjectFormData {
  const incoming = candidate || {};
  return {
    ...defaultCompanyProjectFormData,
    ...incoming,
    projectSlug: incoming.projectSlug || slugifyCompanyProject(incoming.businessName || ''),
    services: Array.isArray(incoming.services) ? incoming.services : defaultCompanyProjectFormData.services,
    differentiators: Array.isArray(incoming.differentiators) ? incoming.differentiators : defaultCompanyProjectFormData.differentiators,
    images: {
      ...defaultCompanyProjectFormData.images,
      ...(incoming.images || {}),
      productImages: Array.isArray(incoming.images?.productImages) ? incoming.images.productImages : [],
    },
    socialLinks: {
      ...defaultCompanyProjectFormData.socialLinks,
      ...(incoming.socialLinks || {}),
    },
  };
}

export function buildCompanyContext(data: CompanyProjectFormData): string {
  const lines = [
    `Company: ${data.businessName}`,
    `Industry: ${data.businessCategory}`,
    `Description: ${data.businessDescription}`,
    `Audience: ${data.targetAudience}`,
    `Value proposition: ${data.valueProposition}`,
    `Services/products: ${data.services.filter(Boolean).join(', ')}`,
    `Differentiators: ${data.differentiators.filter(Boolean).join(', ')}`,
    `Brand keywords: ${data.brandKeywords}`,
    `Forbidden words: ${data.forbiddenWords}`,
    `Brand personality: ${data.brandPersonality}`,
    `Tone of voice: ${data.toneOfVoice}`,
    `Fonts: ${[data.headingFont, data.bodyFont].filter(Boolean).join(' / ')}`,
    `Location: ${[data.city, data.country].filter(Boolean).join(', ')}`,
    `Website/source: ${data.sourceWebsite}`,
    `Design notes: ${data.designNotes}`,
  ];
  return lines.filter((line) => !line.endsWith(': ') && !line.endsWith(':')).join('\n');
}

export function companyToLandingForm(company: CompanyProjectFormData, existing?: Partial<BusinessFormData>): BusinessFormData {
  const merged = { ...defaultFormData, ...(existing || {}) };
  return {
    ...merged,
    businessName: company.businessName,
    customSlug: company.projectSlug,
    businessDescription: company.businessDescription,
    businessCategory: company.businessCategory,
    targetAudience: company.targetAudience,
    valueProposition: company.valueProposition,
    services: company.services.filter((item) => item.trim()),
    differentiators: company.differentiators.filter((item) => item.trim()),
    primaryColor: company.primaryColor,
    secondaryColor: company.secondaryColor,
    accentColor: company.accentColor,
    textColor: company.textColor,
    backgroundColor: company.backgroundColor,
    preferredStyle: company.preferredStyle,
    toneOfVoice: company.toneOfVoice,
    brandPersonality: company.brandPersonality,
    headingFont: company.headingFont,
    bodyFont: company.bodyFont,
    city: company.city,
    country: company.country,
    phone: company.phone,
    whatsapp: company.whatsapp,
    email: company.email,
    sourceWebsite: company.sourceWebsite,
    designNotes: company.designNotes,
    images: { ...merged.images, ...company.images },
    socialLinks: { ...merged.socialLinks, ...company.socialLinks },
  };
}

export function companyToAdForm(company: CompanyProjectFormData, existing?: Partial<AdCreativeFormData>): AdCreativeFormData {
  const merged = { ...defaultAdCreativeFormData, ...(existing || {}) };
  return {
    ...merged,
    campaignName: merged.campaignName || `${company.businessName} Campaign`,
    websiteUrl: company.sourceWebsite,
    brandName: company.businessName,
    industry: company.businessCategory,
    brandKeywords: company.brandKeywords || company.differentiators.filter(Boolean).join(', '),
    forbiddenWords: company.forbiddenWords,
    context: '',
    primaryColor: company.primaryColor,
    secondaryColor: company.secondaryColor,
    accentColor: company.accentColor,
    textColor: company.textColor,
    backgroundColor: company.backgroundColor,
    preferredStyle: company.preferredStyle,
    headingFont: company.headingFont,
    bodyFont: company.bodyFont,
    productName: merged.productName || company.services.find(Boolean) || company.businessName,
    valueProposition: company.valueProposition,
    targetAudience: company.targetAudience,
    toneOfVoice: company.toneOfVoice,
    logoUrl: company.images.logoUrl,
    productImageUrl: company.images.productImages?.[0] || company.images.brandImage || '',
    backgroundImageUrl: company.images.heroImage1 || company.images.heroImage2 || '',
  };
}
