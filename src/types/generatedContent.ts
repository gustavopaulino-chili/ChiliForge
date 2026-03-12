export interface GeneratedContent {
  heroHeadline: string;
  heroSubheadline: string;
  aboutTitle: string;
  aboutContent: string;
  servicesIntro: string;
  services: { name: string; description: string }[];
  benefits: { title: string; description: string }[];
  ctaHeadline: string;
  ctaSubtext: string;
  ctaButtonText: string;
  testimonials: { quote: string; author: string; role: string }[];
  metaTitle: string;
  metaDescription: string;
}
