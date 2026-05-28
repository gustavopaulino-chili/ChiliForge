import {
  AdCreativeFormData,
  AdFormatDimension,
  AdPlatform,
  CampaignObjective,
  CreativeStrategy,
  FunnelStage,
} from '@/types/adCreativeForm';

export const RECOMMENDATION_TIP_STORAGE_KEY = 'chiliforge-ad-recommendation-tip-seen';

export const recommendedOptionClass =
  'animate-pulse border-primary/70 bg-primary/10 shadow-[0_0_22px_hsl(var(--primary)/0.28)] ring-1 ring-primary/30 hover:bg-primary/15';

export const formatKey = (fmt: Pick<AdFormatDimension, 'platform' | 'format' | 'width' | 'height'>) =>
  `${fmt.platform}:${fmt.format}:${fmt.width}x${fmt.height}`;

export const getRecommendedObjectives = (funnelStage: FunnelStage): Set<CampaignObjective> => {
  const map: Record<FunnelStage, CampaignObjective[]> = {
    awareness: ['awareness', 'engagement', 'traffic', 'product-launch'],
    consideration: ['traffic', 'lead-generation', 'engagement', 'product-launch'],
    conversion: ['sales', 'lead-generation', 'whatsapp', 'retargeting', 'app-install', 'event'],
  };
  return new Set(map[funnelStage] || []);
};

export const getRecommendedToneOfVoice = (data: AdCreativeFormData): Set<AdCreativeFormData['toneOfVoice']> => {
  const values = new Set<AdCreativeFormData['toneOfVoice']>();
  if (data.funnelStage === 'awareness') ['conversational', 'casual', 'inspirational'].forEach(v => values.add(v as AdCreativeFormData['toneOfVoice']));
  if (data.funnelStage === 'consideration') ['authoritative', 'conversational', 'empathetic'].forEach(v => values.add(v as AdCreativeFormData['toneOfVoice']));
  if (data.funnelStage === 'conversion') ['urgent', 'authoritative', 'conversational'].forEach(v => values.add(v as AdCreativeFormData['toneOfVoice']));

  if (data.campaignObjective === 'lead-generation') values.add('authoritative');
  if (data.campaignObjective === 'engagement') values.add('casual');
  if (data.campaignObjective === 'whatsapp') values.add('conversational');
  if (data.campaignObjective === 'event') values.add('urgent');
  return values;
};

export const getRecommendedUrgencyLevels = (data: AdCreativeFormData): Set<AdCreativeFormData['urgencyLevel']> => {
  const values = new Set<AdCreativeFormData['urgencyLevel']>();
  if (data.funnelStage === 'awareness') ['none', 'low'].forEach(v => values.add(v as AdCreativeFormData['urgencyLevel']));
  if (data.funnelStage === 'consideration') ['low', 'medium'].forEach(v => values.add(v as AdCreativeFormData['urgencyLevel']));
  if (data.funnelStage === 'conversion') ['medium', 'high'].forEach(v => values.add(v as AdCreativeFormData['urgencyLevel']));

  if (data.campaignObjective === 'sales') values.add('high');
  if (data.campaignObjective === 'event') values.add('high');
  if (data.campaignObjective === 'retargeting') values.add('medium');
  if (data.campaignObjective === 'awareness') values.add('low');
  return values;
};

export const getRecommendedStrategies = (data: AdCreativeFormData): Set<CreativeStrategy> => {
  const values = new Set<CreativeStrategy>();
  if (data.funnelStage === 'awareness') ['emotional', 'lifestyle', 'ugc', 'educational'].forEach(v => values.add(v as CreativeStrategy));
  if (data.funnelStage === 'consideration') ['educational', 'comparison', 'authority', 'problem-solution', 'testimonial'].forEach(v => values.add(v as CreativeStrategy));
  if (data.funnelStage === 'conversion') ['direct-response', 'problem-solution', 'product-showcase', 'testimonial', 'comparison'].forEach(v => values.add(v as CreativeStrategy));

  if (data.campaignObjective === 'product-launch') values.add('product-showcase');
  if (data.campaignObjective === 'lead-generation') values.add('authority');
  if (data.campaignObjective === 'engagement') values.add('ugc');
  if (data.campaignObjective === 'retargeting') values.add('comparison');
  if (data.campaignObjective === 'whatsapp') values.add('problem-solution');
  return values;
};

export const getRecommendedFormatKeys = (data: AdCreativeFormData): Set<string> => {
  const keys = new Set<string>();
  const add = (platform: AdPlatform, format: string, width: number, height: number) => {
    keys.add(`${platform}:${format}:${width}x${height}`);
  };

  if (data.funnelStage === 'awareness') {
    add('social', 'story', 1080, 1920);
    add('social', 'reel', 1080, 1920);
    add('social', 'square', 1080, 1080);
    add('social', 'portrait', 1080, 1350);
  }
  if (data.funnelStage === 'consideration') {
    add('social', 'feed-post', 1200, 628);
    add('social', 'portrait', 1080, 1350);
    add('social', 'square', 1080, 1080);
    add('display', 'medium-rectangle', 300, 250);
  }
  if (data.funnelStage === 'conversion') {
    add('social', 'square', 1080, 1080);
    add('social', 'story', 1080, 1920);
    add('display', 'medium-rectangle', 300, 250);
    add('display', 'mobile-banner', 320, 50);
  }

  switch (data.campaignObjective) {
    case 'lead-generation':
      add('social', 'feed-post', 1200, 628);
      add('social', 'portrait', 1080, 1350);
      add('display', 'medium-rectangle', 300, 250);
      break;
    case 'sales':
      add('social', 'square', 1080, 1080);
      add('social', 'story', 1080, 1920);
      add('display', 'medium-rectangle', 300, 250);
      add('display', 'mobile-banner', 320, 50);
      break;
    case 'product-launch':
      add('social', 'reel', 1080, 1920);
      add('social', 'story', 1080, 1920);
      add('video', 'youtube-thumbnail', 1280, 720);
      break;
    case 'retargeting':
      add('display', 'medium-rectangle', 300, 250);
      add('display', 'mobile-banner', 320, 50);
      add('social', 'feed-post', 1200, 628);
      break;
    case 'engagement':
      add('social', 'reel', 1080, 1920);
      add('social', 'square', 1080, 1080);
      add('social', 'pinterest-pin', 1000, 1500);
      break;
    case 'app-install':
      add('social', 'story', 1080, 1920);
      add('social', 'reel', 1080, 1920);
      add('display', 'mobile-banner', 320, 50);
      break;
    case 'whatsapp':
      add('social', 'story', 1080, 1920);
      add('social', 'square', 1080, 1080);
      add('social', 'feed-post', 1200, 628);
      break;
    case 'traffic':
      add('social', 'feed-post', 1200, 628);
      add('display', 'banner', 728, 90);
      add('display', 'medium-rectangle', 300, 250);
      break;
    case 'event':
      add('social', 'story', 1080, 1920);
      add('social', 'feed-post', 1200, 628);
      add('social', 'square', 1080, 1080);
      break;
    default:
      break;
  }

  return keys;
};
