import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { referenceImageUrl, style, businessName, businessDescription, businessCategory, purpose, websiteType } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

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

Visual direction: ${visualHints}

CRITICAL RULES:
- DO NOT include any text, letters, words, logos, watermarks, or typography in the image
- DO NOT include UI elements, buttons, or mockups
- The image must be purely photographic or illustrative — NO text overlays
- Create a clean, high-resolution image suitable as a website background or section photo
- Use professional lighting and composition
- The image should feel authentic and relevant to "${businessCategory || 'the business'}"
- Maintain a ${style || 'modern'} aesthetic with cohesive color tones
- The image should work well with text overlaid on top of it (good contrast areas)`;

    const messages: any[] = [
      {
        role: "user",
        content: referenceImageUrl
          ? [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: referenceImageUrl } },
            ]
          : prompt,
      },
    ];

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3.1-flash-image-preview",
        messages,
        modalities: ["image", "text"],
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI usage limit reached. Please add credits." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const data = await response.json();
    const base64Url = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;

    if (!base64Url) throw new Error("No image generated");

    // Upload base64 image to Supabase Storage for a short URL
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Extract base64 data
    const matches = base64Url.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!matches) throw new Error("Invalid base64 image format");

    const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
    const base64Data = matches[2];
    const bytes = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));

    const fileName = `${crypto.randomUUID()}.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from('generated-images')
      .upload(fileName, bytes, { contentType: `image/${matches[1]}`, upsert: false });

    if (uploadError) {
      console.error("Storage upload error:", uploadError);
      throw new Error("Failed to upload image to storage");
    }

    const { data: publicUrlData } = supabase.storage
      .from('generated-images')
      .getPublicUrl(fileName);

    const imageUrl = publicUrlData.publicUrl;

    return new Response(JSON.stringify({ imageUrl }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-images error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
