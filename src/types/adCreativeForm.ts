export type AdPlatform = 'social' | 'display' | 'video' | 'email';

export type AdFormat =
  | 'feed-post'
  | 'portrait'
  | 'story'
  | 'reel'
  | 'square'
  | 'pinterest-pin'
  | 'twitter-post'
  | 'linkedin-post'
  | 'banner'
  | 'leaderboard'
  | 'medium-rectangle'
  | 'large-rectangle'
  | 'half-page'
  | 'wide-skyscraper'
  | 'mobile-banner'
  | 'youtube-video'
  | 'youtube-thumbnail'
  | 'email-header'
  | 'email-body';

export interface AdFormatDimension {
  platform: AdPlatform;
  format: AdFormat;
  width: number;
  height: number;
  label: string;
  enabled: boolean;
}

export interface AdLogoVariant {
  id: string;
  url: string;
  label: string;
  usageHint?: string;
}

export const ALL_AD_FORMATS: Omit<AdFormatDimension, 'enabled'>[] = [
  // Social Media
  { platform: 'social', format: 'story',           width: 1080, height: 1920, label: 'Story / Vertical (1080×1920)' },
  { platform: 'social', format: 'reel',            width: 1080, height: 1920, label: 'Reels / TikTok (1080×1920)' },
  { platform: 'social', format: 'portrait',        width: 1080, height: 1350, label: 'Portrait 4:5 (1080×1350)' },
  { platform: 'social', format: 'square',          width: 1080, height: 1080, label: 'Square (1080×1080)' },
  { platform: 'social', format: 'feed-post',       width: 1200, height: 628,  label: 'Landscape / Feed (1200×628)' },
  { platform: 'social', format: 'pinterest-pin',   width: 1000, height: 1500, label: 'Pinterest Pin (1000×1500)' },
  { platform: 'social', format: 'twitter-post',    width: 1200, height: 675,  label: 'Twitter/X Post (1200×675)' },
  { platform: 'social', format: 'linkedin-post',   width: 1200, height: 627,  label: 'LinkedIn Post (1200×627)' },
  // Video
  { platform: 'video',  format: 'youtube-video',   width: 1920, height: 1080, label: 'Widescreen / Video (1920×1080)' },
  { platform: 'video',  format: 'youtube-thumbnail',width: 1280, height: 720, label: 'YouTube Thumbnail (1280×720)' },
  // Display / Web
  { platform: 'display',format: 'banner',          width: 728,  height: 90,   label: 'Leaderboard (728×90)' },
  { platform: 'display',format: 'leaderboard',     width: 970,  height: 90,   label: 'Billboard (970×90)' },
  { platform: 'display',format: 'medium-rectangle',width: 300,  height: 250,  label: 'Medium Rectangle (300×250)' },
  { platform: 'display',format: 'large-rectangle', width: 336,  height: 280,  label: 'Large Rectangle (336×280)' },
  { platform: 'display',format: 'half-page',       width: 300,  height: 600,  label: 'Half Page (300×600)' },
  { platform: 'display',format: 'wide-skyscraper', width: 160,  height: 600,  label: 'Wide Skyscraper (160×600)' },
  { platform: 'display',format: 'square',          width: 250,  height: 250,  label: 'Small Square (250×250)' },
  { platform: 'display',format: 'mobile-banner',   width: 320,  height: 50,   label: 'Mobile Banner (320×50)' },
  // Email
  { platform: 'email',  format: 'email-header',    width: 600,  height: 200,  label: 'Email Header (600×200)' },
  { platform: 'email',  format: 'email-body',      width: 600,  height: 400,  label: 'Email Banner (600×400)' },
];

export const AD_PLATFORM_LABELS: Record<AdPlatform, string> = {
  social:  'Social Media',
  display: 'Display / Web',
  video:   'Video',
  email:   'Email Marketing',
};

export type CampaignObjective =
  | 'lead-generation'
  | 'sales'
  | 'awareness'
  | 'product-launch'
  | 'retargeting'
  | 'engagement'
  | 'app-install'
  | 'whatsapp'
  | 'traffic'
  | 'event'
  | '';

export type FunnelStage = 'awareness' | 'consideration' | 'conversion';

export type CreativeStrategy =
  | 'problem-solution'
  | 'before-after'
  | 'testimonial'
  | 'ugc'
  | 'founder-story'
  | 'educational'
  | 'emotional'
  | 'luxury-premium'
  | 'direct-response'
  | 'meme-trend'
  | 'comparison'
  | 'authority'
  | 'lifestyle'
  | 'product-showcase'
  | 'other'
  | '';

export interface AdCustomFont {
  name: string;
  fileName: string;
  dataUri: string;
  format: 'truetype' | 'opentype' | 'woff' | 'woff2';
}

export interface AdCreativeFormData {
  // Step 1: Objective (NEW)
  campaignObjective: CampaignObjective;
  funnelStage: FunnelStage;

  // Step 2: Import
  campaignName: string;
  websiteUrl: string;
  brandBookFileName: string;
  brandBookExtractedData: Record<string, unknown>;
  context: string;

  // Step 3: Platform
  selectedPlatforms: AdPlatform[];
  selectedFormats: AdFormatDimension[];

  // Step 4: Brand Identity
  brandName: string;
  industry: string;
  brandKeywords: string;
  forbiddenWords: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  textColor: string;
  backgroundColor: string;
  preferredStyle: 'modern' | 'corporate' | 'minimal' | 'bold' | 'premium' | 'luxury' | 'futuristic' | 'cinematic' | 'clean' | 'high-contrast';
  headingFont: string;
  bodyFont: string;
  customHeadingFont: AdCustomFont | null;
  customBodyFont: AdCustomFont | null;

  // Step 5: Copy & Audience
  productName: string;
  mainHeadline: string;
  subheadline: string;
  useAiCopy: boolean;
  offer: string;
  pricing: string;
  discount: string;
  guarantee: string;
  scarcity: string;
  valueProposition: string;
  ctaText: string;
  targetAudience: string;
  ageRange: string;
  gender: 'all' | 'male' | 'female';
  painPoints: string;
  desires: string;
  toneOfVoice: 'formal' | 'casual' | 'inspirational' | 'authoritative' | 'conversational' | 'urgent' | 'empathetic';
  urgencyLevel: 'none' | 'low' | 'medium' | 'high';

  // Step 6: Creative Strategy (NEW)
  creativeStrategy: CreativeStrategy;
  creativeStrategyOther: string;

  // Step 7: Formats & A/B
  formatNotes: Record<string, string>;
  abTestingEnabled: boolean;
  abVariantCount: 2 | 3;
  abTestFocus: 'headline' | 'cta' | 'visual' | 'color' | 'mixed';
  headlineVariants: string[];
  ctaVariants: string[];

  // Step 8: Images
  logoUrl: string;
  logoVariants: AdLogoVariant[];
  preferredLogoStrategy: 'auto' | 'light' | 'dark' | 'monochrome' | 'full-color';
  productImageUrl: string;
  backgroundImageUrl: string;
  productImageVariants: string[];
  backgroundImageVariants: string[];
  imageFallbackMode: 'auto' | 'gemini' | 'pexels' | 'none';
  imageFallbackPrompt: string;
}

export const defaultAdCreativeFormData: AdCreativeFormData = {
  campaignObjective: '',
  funnelStage: 'awareness',

  campaignName: '',
  websiteUrl: '',
  brandBookFileName: '',
  brandBookExtractedData: {},
  context: '',

  selectedPlatforms: [],
  selectedFormats: [],

  brandName: '',
  industry: '',
  brandKeywords: '',
  forbiddenWords: '',
  primaryColor: '#3B82F6',
  secondaryColor: '#8B5CF6',
  accentColor: '#F59E0B',
  textColor: '#1F2937',
  backgroundColor: '#FFFFFF',
  preferredStyle: 'modern',
  headingFont: '',
  bodyFont: '',
  customHeadingFont: null,
  customBodyFont: null,

  productName: '',
  mainHeadline: '',
  subheadline: '',
  useAiCopy: true,
  offer: '',
  pricing: '',
  discount: '',
  guarantee: '',
  scarcity: '',
  valueProposition: '',
  ctaText: '',
  targetAudience: '',
  ageRange: '',
  gender: 'all',
  painPoints: '',
  desires: '',
  toneOfVoice: 'conversational',
  urgencyLevel: 'medium',

  creativeStrategy: '',
  creativeStrategyOther: '',

  formatNotes: {},
  abTestingEnabled: false,
  abVariantCount: 2,
  abTestFocus: 'mixed',
  headlineVariants: [],
  ctaVariants: [],

  logoUrl: '',
  logoVariants: [],
  preferredLogoStrategy: 'auto',
  productImageUrl: '',
  backgroundImageUrl: '',
  productImageVariants: [],
  backgroundImageVariants: [],
  imageFallbackMode: 'auto',
  imageFallbackPrompt: '',
};
