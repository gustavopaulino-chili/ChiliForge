import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const STOP_WORDS = new Set([
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

function expandQuery(query: string) {
  const lower = query.toLowerCase();
  const translatedTerms = Object.entries(PT_EN_HINTS)
    .filter(([pt]) => lower.includes(pt))
    .map(([, en]) => en);
  return [...translatedTerms, query].join(" ").trim();
}

function tokenize(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

function relevanceScore(query: string, photo: any) {
  const queryTokens = Array.from(new Set(tokenize(query)));
  if (!queryTokens.length) return 0;

  const source = [photo?.alt, photo?.photographer, photo?.url]
    .filter((part) => typeof part === "string" && part)
    .join(" ")
    .toLowerCase();

  let matched = 0;
  const coreTokens = queryTokens.slice(0, 6);
  const denominator = Math.max(1, coreTokens.length);

  for (const token of coreTokens) {
    if (source.includes(token)) matched += 1;
  }

  if ((query.includes("barbearia") || query.includes("barbeiro")) && /(barbecue|grill|sausages|chicken)/i.test(source)) {
    matched -= 1;
  }

  return Math.max(0, matched) / denominator;
}

function buildQueryVariants(query: string) {
  const compact = expandQuery(query.trim().replace(/\s+/g, " "));
  const tokens = tokenize(compact);
  const trimmedTokens = tokens.slice(0, 8);
  const variants = [
    compact,
    trimmedTokens.join(" "),
    `${trimmedTokens.slice(0, 5).join(" ")} editorial photography`.trim(),
  ].filter(Boolean);
  return Array.from(new Set(variants));
}

function buildPollinationsUrl(prompt: string, seed: number) {
  const text = encodeURIComponent(`${prompt}. high quality, realistic lighting, professional composition`);
  return `https://image.pollinations.ai/prompt/${text}?width=1792&height=1024&seed=${seed}&model=flux&nologo=true`;
}

function buildGeneratedFallbackImages(query: string, count: number) {
  const safeCount = Math.min(Math.max(count, 1), 10);
  return Array.from({ length: safeCount }).map((_, index) => {
    const seed = Math.floor(Math.random() * 999999999) + index;
    return {
      url: buildPollinationsUrl(query, seed),
      alt: query,
      provider: "pollinations",
      model: "flux",
      fallback: true,
    };
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { query, count = 3 } = await req.json();
    if (!query || typeof query !== "string") {
      return new Response(JSON.stringify({ error: "Query is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const PEXELS_API_KEY = Deno.env.get("PEXELS_API_KEY");
    if (!PEXELS_API_KEY) {
      const images = buildGeneratedFallbackImages(query, count);
      return new Response(JSON.stringify({ images, fallback: true, reason: "pexels-key-missing" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const perPage = Math.min(Math.max(count, 1), 10);
    const queryVariants = buildQueryVariants(query);
    let bestPhotos: any[] = [];
    let bestScored: Array<{ photo: any; relevance: number; quality: number }> = [];
    let bestScore = -1;
    let lastError: { status: number; text: string } | null = null;

    for (const variant of queryVariants.slice(0, 3)) {
      const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(variant)}&per_page=${Math.max(perPage, 12)}&orientation=landscape`;
      console.log("Searching Pexels:", variant);

      const response = await fetch(url, {
        headers: { Authorization: PEXELS_API_KEY },
      });

      if (!response.ok) {
        const text = await response.text();
        lastError = { status: response.status, text };
        console.error("Pexels API error:", response.status, text);
        continue;
      }

      const data = await response.json();
      const photos = Array.isArray(data.photos) ? data.photos : [];
      const scored = photos
        .map((photo: any) => {
          const width = Number(photo?.width || 0);
          const height = Number(photo?.height || 0);
          const area = width * height;
          const aspect = height > 0 ? width / height : 0;
          const landscapeFit = aspect > 1.45 && aspect < 2.1 ? 1 : 0;
          const quality = area + landscapeFit * 10_000_000;
          const relevance = relevanceScore(variant, photo);
          return { photo, relevance, quality };
        })
        .sort((a: { relevance: number; quality: number }, b: { relevance: number; quality: number }) => {
          if (b.relevance !== a.relevance) return b.relevance - a.relevance;
          return b.quality - a.quality;
        });

      const topRelevance = scored[0]?.relevance ?? 0;
      if (topRelevance > bestScore || (topRelevance === bestScore && scored.length > bestPhotos.length)) {
        bestPhotos = scored.slice(0, perPage).map((item: any) => item.photo);
        bestScored = scored;
        bestScore = topRelevance;
      }

      if (bestPhotos.length >= perPage && bestScore >= 0.3) break;
    }

    if (!bestPhotos.length && lastError) {
      const images = buildGeneratedFallbackImages(query, count);
      return new Response(JSON.stringify({ images, fallback: true, reason: `pexels-error-${lastError.status}` }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const preferredPool = bestScored.some((item) => item.relevance >= 0.1)
      ? bestScored.filter((item) => item.relevance >= 0.1)
      : bestScored;

    const images = (preferredPool.length ? preferredPool.map((item) => item.photo) : bestPhotos)
      .slice(0, perPage)
      .map((photo: any) => ({
      url: photo.src?.large2x || photo.src?.large || photo.src?.original,
      alt: photo.alt || query,
      photographer: photo.photographer,
      photographerUrl: photo.photographer_url,
      pexelsUrl: photo.url,
    }));

    if (!images.length) {
      const fallbackImages = buildGeneratedFallbackImages(query, count);
      return new Response(JSON.stringify({ images: fallbackImages, fallback: true, reason: "pexels-empty" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Found ${images.length} images for "${query}"`);

    return new Response(JSON.stringify({ images }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("search-images error:", e);
    const query = "business hero image";
    const images = buildGeneratedFallbackImages(query, 3);
    return new Response(JSON.stringify({ images, fallback: true, reason: e instanceof Error ? e.message : "Unknown error" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
