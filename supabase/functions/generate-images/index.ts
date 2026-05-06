import { serve } from "https://deno.land/std@0.168.0/http/server.ts";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const DEFAULT_GEMINI_IMAGE_MODELS = [
  "gemini-2.5-flash-image-preview",
  "gemini-2.0-flash-preview-image-generation",
  "gemini-2.0-flash-exp",
];

const GEMINI_IMAGE_MODELS = Array.from(new Set([
  ...(Deno.env.get("GEMINI_IMAGE_MODELS") || Deno.env.get("GEMINI_IMAGE_MODEL") || "")
    .split(",")
    .map((value: string) => value.trim())
    .filter(Boolean),
  ...DEFAULT_GEMINI_IMAGE_MODELS,
])).slice(0, 5);

const OPENAI_IMAGE_MODELS = (Deno.env.get("OPENAI_IMAGE_MODELS") || "gpt-image-1,dall-e-3")
  .split(",")
  .map((value: string) => value.trim())
  .filter(Boolean)
  .slice(0, 3);

function normalizeAccountType(value: unknown) {
  return value === "admin" ? "admin" : "testing";
}

function getGeminiApiKeysForAccountType(accountType: unknown) {
  const productionKey = Deno.env.get("GEMINI_API_KEY_PRODUCTION") || Deno.env.get("GEMINI_API_KEY");
  const testingKey = Deno.env.get("GEMINI_API_KEY_TESTING");

  if (normalizeAccountType(accountType) === "admin") {
    return [productionKey, testingKey].filter((k): k is string => Boolean(k));
  }

  return [testingKey, productionKey].filter((k): k is string => Boolean(k));
}

const PEXELS_STOP_WORDS = new Set([
  "a", "an", "and", "the", "for", "with", "without", "from", "into", "onto", "over", "under", "of", "to", "in", "on", "at", "by",
  "website", "image", "photo", "background", "professional", "high", "quality", "modern", "general", "business",
]);

const PT_EN_HINTS: Record<string, string> = {
  "barbearia": "barbershop",
  "barbeiro": "barber",
  "salao": "salon",
  "salão": "salon",
  "advocacia": "law firm",
  "clinica": "clinic",
  "clínica": "clinic",
  "restaurante": "restaurant",
  "academia": "gym fitness",
  "imobiliaria": "real estate",
  "imobiliária": "real estate",
  "construcao": "construction",
  "construção": "construction",
  "beleza": "beauty",
  "saude": "healthcare",
  "saúde": "healthcare",
};

function expandQueryForPexels(query: string) {
  const lower = query.toLowerCase();
  const translatedTerms = Object.entries(PT_EN_HINTS)
    .filter(([pt]) => lower.includes(pt))
    .map(([, en]) => en);

  const expanded = [...translatedTerms, query].join(" ").trim();
  return expanded;
}

function tokenizeForPexels(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !PEXELS_STOP_WORDS.has(token));
}

function uniqueTokens(tokens: string[]) {
  return Array.from(new Set(tokens));
}

function relevanceScore(query: string, photo: any) {
  const queryTokens = uniqueTokens(tokenizeForPexels(query));
  if (!queryTokens.length) return 0;

  const source = [
    photo?.alt,
    photo?.photographer,
    photo?.url,
  ]
    .filter((part) => typeof part === "string" && part)
    .join(" ")
    .toLowerCase();

  let score = 0;
  const coreTokens = queryTokens.slice(0, 6);
  const denominator = Math.max(1, coreTokens.length);

  for (const token of coreTokens) {
    if (source.includes(token)) score += 1;
  }

  // Disambiguate common PT/EN confusion around barbershop vs barbecue results.
  if ((query.includes("barbearia") || query.includes("barbeiro")) && /(barbecue|grill|sausages|chicken)/i.test(source)) {
    score -= 1;
  }

  return Math.max(0, score) / denominator;
}

async function searchPexelsImage(queries: string[], apiKey: string) {
  const cleanQueries = uniqueTokens(
    queries
      .map((q) => q.trim())
      .filter(Boolean)
      .flatMap((q) => [q, expandQueryForPexels(q)]),
  );
  let bestCandidate: { photo: any; relevance: number; qualityScore: number } | null = null;
  let bestRelevantCandidate: { photo: any; relevance: number; qualityScore: number } | null = null;
  let lastError: { status: number; text: string } | null = null;

  for (const query of cleanQueries.slice(0, 4)) {
    const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=20&orientation=landscape`;
  const response = await fetch(url, {
    headers: { Authorization: apiKey },
  });

    if (!response.ok) {
      lastError = { status: response.status, text: await response.text() };
      continue;
    }

    const data = await response.json();
    const photos = Array.isArray(data.photos) ? data.photos : [];
    const scoredPhotos = photos
      .map((photo: any) => {
        const width = Number(photo?.width || 0);
        const height = Number(photo?.height || 0);
        const area = width * height;
        const aspect = height > 0 ? width / height : 0;
        const landscapeFit = aspect > 1.45 && aspect < 2.1 ? 1 : 0;
        const qualityScore = area + landscapeFit * 10_000_000;
        const relevance = relevanceScore(query, photo);
        return { photo, relevance, qualityScore };
      })
      .sort((a: { relevance: number; qualityScore: number }, b: { relevance: number; qualityScore: number }) => {
        if (b.relevance !== a.relevance) return b.relevance - a.relevance;
        return b.qualityScore - a.qualityScore;
      });

    // Avoid obviously off-topic matches when Pexels metadata is sparse.
    const top = scoredPhotos[0];
    if (!top) continue;

    const topRelevant = scoredPhotos.find((item: { relevance: number }) => item.relevance >= 0.2);
    if (topRelevant && (!bestRelevantCandidate || topRelevant.relevance > bestRelevantCandidate.relevance || (topRelevant.relevance === bestRelevantCandidate.relevance && topRelevant.qualityScore > bestRelevantCandidate.qualityScore))) {
      bestRelevantCandidate = topRelevant;
    }

    if (!bestCandidate || top.relevance > bestCandidate.relevance || (top.relevance === bestCandidate.relevance && top.qualityScore > bestCandidate.qualityScore)) {
      bestCandidate = top;
    }
  }

  if (bestRelevantCandidate) {
    bestCandidate = bestRelevantCandidate;
  }

  if (!bestCandidate) {
    if (lastError) {
      return { ok: false as const, status: lastError.status, text: lastError.text };
    }
    return { ok: false as const, status: 404, text: "Pexels search returned no matching image" };
  }

  const photo = bestCandidate.photo;
  const imageUrl = photo?.src?.large2x || photo?.src?.large || photo?.src?.original;
  if (!imageUrl) {
    return { ok: false as const, status: 404, text: "Pexels search returned no matching image" };
  }

  return {
    ok: true as const,
    imageUrl,
    photographer: photo.photographer,
    photographerUrl: photo.photographer_url,
    pexelsUrl: photo.url,
  };
}

function buildGeminiImageApiUrl(model: string, apiKey: string) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

async function buildReferenceInlineData(referenceImageUrl?: string) {
  if (!referenceImageUrl) return null;

  try {
    const response = await fetch(referenceImageUrl);
    if (!response.ok) return null;

    const mimeType = response.headers.get("content-type") || "image/png";
    const bytes = new Uint8Array(await response.arrayBuffer());
    return {
      inlineData: {
        mimeType,
        data: bytesToBase64(bytes),
      },
    };
  } catch (error) {
    console.warn("Failed to fetch reference image for Gemini image generation:", error);
    return null;
  }
}

function extractGeminiImageDataUrl(payload: any) {
  const parts = payload?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return null;

  const imagePart = parts.find((part: any) => typeof part?.inlineData?.data === "string" && String(part?.inlineData?.mimeType || "").startsWith("image/"));
  if (!imagePart) return null;

  return `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`;
}

async function generateImageWithGemini(prompt: string, geminiApiKeys: string[], referenceImageUrl?: string) {
  const parts: any[] = [{ text: prompt }];
  const referenceInlineData = await buildReferenceInlineData(referenceImageUrl);
  if (referenceInlineData) {
    parts.push(referenceInlineData);
  }

  const startedAt = Date.now();
  let lastError = "Gemini image generation failed";

  for (const geminiApiKey of geminiApiKeys) {
    for (const model of GEMINI_IMAGE_MODELS) {
      const elapsed = Date.now() - startedAt;
      const remaining = Math.max(0, 45000 - elapsed);
      if (remaining < 5000) break;

      const perRequestTimeout = Math.min(22000, remaining - 1000);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), perRequestTimeout);

      let response: Response;
      try {
        response = await fetch(buildGeminiImageApiUrl(model, geminiApiKey), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts }],
            generationConfig: {
              responseModalities: ["TEXT", "IMAGE"],
              temperature: 0.2,
            },
          }),
          signal: controller.signal,
        });
      } catch (fetchErr: any) {
        clearTimeout(timeoutId);
        if (fetchErr?.name === "AbortError") {
          lastError = `Gemini ${model} timed out`;
          continue;
        }
        lastError = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
        continue;
      }
      clearTimeout(timeoutId);

      if (!response.ok) {
        const text = await response.text().catch(() => `HTTP ${response.status}`);
        lastError = `Gemini ${model}: ${response.status} ${text}`;

        if ([400, 404, 429, 500, 502, 503, 504].includes(response.status)) {
          continue;
        }

        return { ok: false as const, status: response.status, text: lastError };
      }

      let payload: any;
      try {
        payload = await response.json();
      } catch {
        lastError = `Gemini ${model} returned invalid JSON`;
        continue;
      }

      const imageUrl = extractGeminiImageDataUrl(payload);
      if (!imageUrl) {
        lastError = `Gemini ${model} returned no image data`;
        continue;
      }

      return { ok: true as const, imageUrl, model };
    }
  }

  return { ok: false as const, status: 502, text: lastError };
}

async function generateImageWithOpenAi(prompt: string, openAiApiKey: string) {
  let lastError = "OpenAI image generation failed";

  for (const model of OPENAI_IMAGE_MODELS) {
    let response: Response | null = null;

    for (let attempt = 0; attempt < 3; attempt++) {
      const openAiBody = model.startsWith("dall-e")
        ? {
            model,
            prompt,
            size: "1792x1024",
            quality: "hd",
            style: "natural",
            n: 1,
          }
        : {
            model,
            prompt,
            size: "1792x1024",
            quality: "high",
            n: 1,
          };

      response = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openAiApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(openAiBody),
      });

      if (response.status !== 429) break;
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    }

    if (!response) {
      lastError = `OpenAI ${model} returned no response`;
      continue;
    }

    if (!response.ok) {
      const text = await response.text().catch(() => `HTTP ${response.status}`);
      lastError = `OpenAI ${model}: ${response.status} ${text}`;
      if ([400, 404, 429, 500, 502, 503, 504].includes(response.status)) {
        continue;
      }
      return { ok: false as const, status: response.status, text: lastError };
    }

    const data = await response.json().catch(() => null);
    const imageUrl = data?.data?.[0]?.url;
    const b64Data = data?.data?.[0]?.b64_json;

    if (typeof imageUrl === "string" && imageUrl) {
      return { ok: true as const, imageUrl, model };
    }

    if (typeof b64Data === "string" && b64Data) {
      return { ok: true as const, imageUrl: `data:image/png;base64,${b64Data}`, model };
    }

    lastError = `OpenAI ${model} returned no image payload`;
  }

  return { ok: false as const, status: 502, text: lastError };
}

async function generateImageWithPollinations(prompt: string) {
  const seed = Math.floor(Math.random() * 999999999);
  const cleanPrompt = encodeURIComponent(`${prompt}. ultra detailed, professional lighting, 16:9 composition`);
  const url = `https://image.pollinations.ai/prompt/${cleanPrompt}?width=1792&height=1024&seed=${seed}&model=flux&nologo=true`;

  try {
    const response = await fetch(url, { method: "GET" });
    if (!response.ok) {
      return { ok: false as const, status: response.status, text: await response.text().catch(() => `HTTP ${response.status}`) };
    }

    return {
      ok: true as const,
      imageUrl: url,
      provider: "pollinations",
      model: "flux",
    };
  } catch (error) {
    return {
      ok: false as const,
      status: 502,
      text: error instanceof Error ? error.message : "Pollinations request failed",
    };
  }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { referenceImageUrl, style, businessName, businessDescription, businessCategory, purpose, websiteType, brandPersonality, primaryColor, secondaryColor, valueProposition, targetAudience, services, differentiators, accountType } = await req.json();
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    const GEMINI_API_KEYS = getGeminiApiKeysForAccountType(accountType);
    const PEXELS_API_KEY = Deno.env.get("PEXELS_API_KEY");
    if (!GEMINI_API_KEYS.length && !OPENAI_API_KEY && !PEXELS_API_KEY) throw new Error("No image provider is configured");

    const categoryHints: Record<string, string> = {
      'Technology / SaaS': 'abstract tech patterns, clean workspaces, modern devices, data visualizations, digital interfaces',
      'Agency / Consulting': 'professional meeting rooms, collaborative teams, modern offices, strategic planning imagery',
      'E-commerce / Retail': 'lifestyle product photography, shopping environments, packaging, stylish product displays',
      'Restaurant / Food': 'appetizing food photography, restaurant ambiance, kitchen scenes, table settings, ingredients',
      'Healthcare / Medical': 'clean medical environments, caring professionals, wellness imagery, health and vitality',
      'Real Estate': 'architectural photography, property interiors, cityscapes, luxury living spaces',
      'Education / Training': 'learning environments, students collaborating, books, classrooms, knowledge sharing',
      'Fitness / Wellness': 'active lifestyle, gym equipment, yoga, healthy living, energy and movement',
      'Legal / Financial': 'professional settings, trust and authority, corporate environments, handshakes',
      'Construction / Home Services': 'construction sites, tools, building processes, renovated spaces, blueprints',
      'Beauty / Salon': 'beauty treatments, salon interiors, cosmetics, elegance, self-care',
      'Photography / Creative': 'artistic compositions, creative workspaces, camera equipment, portfolios',
      'Non-Profit': 'community, helping hands, social impact, volunteers, positive change',
    };

    const categoryKey = Object.keys(categoryHints).find(k => businessCategory?.includes(k.split(' /')[0])) || '';
    const visualHints = categoryHints[categoryKey] || 'professional business environment, modern aesthetic';

    const purposeMap: Record<string, string> = {
      'hero banner': 'a wide cinematic background image for the main hero section of a website. The image should work as a full-width background behind text overlays.',
      'about section background': 'a background or lifestyle photo for an about/company section. Should convey the brand essence and company culture.',
      'services section': 'a visual that represents the services or products offered. Should feel authentic and relevant to the business.',
      'marketing visual': 'a versatile marketing image that can be used across different sections as a background or decorative photo.',
      'testimonials background': 'a subtle, professional background image for a testimonials or social proof section.',
    };

    const purposeDesc = purposeMap[purpose] || `a professional image for: ${purpose}`;

    const prompt = `Generate ${purposeDesc}

Business context:
- Name: "${businessName}"
- Industry: ${businessCategory || 'General business'}
- Description: ${businessDescription || 'A professional business'}
- Website type: ${websiteType || 'corporate'}
- Design style: ${style || 'modern'}
${brandPersonality ? `- Brand personality: ${brandPersonality}` : ''}
${valueProposition ? `- Value proposition: ${valueProposition}` : ''}
${targetAudience ? `- Target audience: ${targetAudience}` : ''}
${services && services.length > 0 ? `- Services: ${services.join(', ')}` : ''}
${differentiators && differentiators.length > 0 ? `- Key differentiators: ${differentiators.join(', ')}` : ''}

Visual direction: ${visualHints}
${primaryColor && secondaryColor ? `Brand colors to incorporate: Primary ${primaryColor}, Secondary ${secondaryColor}` : ''}

CRITICAL RULES:
- DO NOT include any text, letters, words, logos, watermarks, or typography in the image
- DO NOT include UI elements, buttons, or mockups
- The image must be purely photographic or illustrative — NO text overlays
- Create a clean, ultra-sharp, high-resolution image suitable as a website background or section photo
- Use premium production quality: realistic lighting, precise focus, rich dynamic range, and natural color grading
- Prefer editorial/commercial photography quality with clear depth, texture detail, and no noise/artifacts
- Use professional lighting and composition
- The image should feel authentic and relevant to "${businessCategory || 'the business'}"
- Maintain a ${style || 'modern'} aesthetic with cohesive color tones
- The image should work well with text overlaid on top of it (good contrast areas)
- Ensure a 16:9 landscape composition optimized for desktop hero usage (safe negative space for text)
- Avoid visual clutter; keep one clear focal subject and balanced spacing
${purpose === 'hero banner' ? `- HERO-SPECIFIC: This image will be the main visual element of the landing page. Make it impactful, professional, and perfectly representative of the brand's core values and offerings.` : ''}`;

    const contextualBits = [
      businessCategory,
      targetAudience,
      services?.[0],
      differentiators?.[0],
      style,
      websiteType,
    ].filter(Boolean) as string[];

    const purposeHint = typeof purpose === "string"
      ? purpose.split(/\s+/).slice(0, 12).join(" ")
      : "";

    const pexelsQueries = [
      purposeHint,
      [businessCategory, purposeHint, services?.[0], "editorial photography"].filter(Boolean).join(" "),
      [businessCategory, targetAudience, style, "realistic photo"].filter(Boolean).join(" "),
      [businessDescription, ...contextualBits].filter(Boolean).join(" "),
      `${businessCategory || businessName || "business"} ${purposeHint || "hero banner"} professional photography`,
    ].map((q) => q.trim()).filter((q) => q.length > 0);

    if (GEMINI_API_KEYS.length > 0 && GEMINI_IMAGE_MODELS.length > 0) {
      const geminiResult = await generateImageWithGemini(prompt, GEMINI_API_KEYS, referenceImageUrl);
      if (geminiResult.ok) {
        return new Response(JSON.stringify({ imageUrl: geminiResult.imageUrl, provider: "gemini", model: geminiResult.model || GEMINI_IMAGE_MODELS[0] }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      console.error("Gemini image generation failed:", geminiResult.status, geminiResult.text.substring(0, 400));
    }

    if (OPENAI_API_KEY) {
      const openAiResult = await generateImageWithOpenAi(prompt, OPENAI_API_KEY);
      if (openAiResult.ok) {
        return new Response(JSON.stringify({ imageUrl: openAiResult.imageUrl, provider: "openai", model: openAiResult.model || OPENAI_IMAGE_MODELS[0] }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      console.error("OpenAI image generation failed:", openAiResult.status, openAiResult.text);
    }

    const pollinationsResult = await generateImageWithPollinations(prompt);
    if (pollinationsResult.ok) {
      return new Response(JSON.stringify({
        imageUrl: pollinationsResult.imageUrl,
        fallback: true,
        provider: pollinationsResult.provider,
        model: pollinationsResult.model,
        reason: "provider-fallback",
      }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.error("Pollinations image generation failed:", pollinationsResult.status, pollinationsResult.text);

    // Só faz fallback para Pexels se todos os outros falharem
    if (PEXELS_API_KEY) {
      const pexelsResult = await searchPexelsImage(pexelsQueries, PEXELS_API_KEY);
      if (pexelsResult.ok) {
        return new Response(JSON.stringify({
          imageUrl: pexelsResult.imageUrl,
          fallback: true,
          provider: "pexels",
          model: "pexels-search",
          photographer: pexelsResult.photographer,
          photographerUrl: pexelsResult.photographerUrl,
          pexelsUrl: pexelsResult.pexelsUrl,
          reason: "provider-fallback",
        }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      console.error("Pexels image search failed:", pexelsResult.status, pexelsResult.text);
    }

    // Fallback final: Pollinations com o mesmo contexto do prompt original
    const fallbackPrompt = `${businessName || ''} ${purpose || ''} ${businessCategory || ''} ${style || ''} ${targetAudience || ''} professional, 16:9, high quality`.trim();
    return new Response(JSON.stringify({
      imageUrl: `https://image.pollinations.ai/prompt/${encodeURIComponent(fallbackPrompt)}?width=1792&height=1024&seed=${Math.floor(Math.random() * 999999999)}&model=flux&nologo=true`,
      fallback: true,
      reason: "last-resort-generated-fallback",
      provider: "pollinations",
      model: "flux",
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-images error:", e);
    return new Response(JSON.stringify({
      imageUrl: `https://image.pollinations.ai/prompt/${encodeURIComponent('Website hero image professional, 16:9, high quality') }?width=1792&height=1024&seed=${Math.floor(Math.random() * 999999999)}&model=flux&nologo=true`,
      fallback: true,
      reason: e instanceof Error ? e.message : "Unknown error",
      provider: "pollinations",
      model: "flux",
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
