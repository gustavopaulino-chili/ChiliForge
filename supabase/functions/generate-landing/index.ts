import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  try {
    const { prompt, businessName } = await req.json();
    if (!prompt || typeof prompt !== "string" || prompt.length < 50) {
      return new Response(
        JSON.stringify({ error: "Invalid prompt provided." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY)
      throw new Error("Supabase credentials not configured");

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const systemPrompt = `You are an expert React front-end architect. The user will give you a detailed landing page specification.

Your task: Generate a COMPLETE React + Vite + Tailwind CSS project as a JSON object containing all project files.

Return a JSON object with this exact structure:
{
  "files": [
    { "path": "file/path.ext", "content": "file content as string" }
  ]
}

MANDATORY FILES TO GENERATE:

1. "package.json" — with these exact dependencies:
   - react, react-dom (^18.3.1)
   - react-router-dom (^6.30.0)
   - lucide-react (^0.462.0)
   - tailwindcss (^3.4.17), tailwindcss-animate (^1.0.7), autoprefixer, postcss
   - tailwind-merge (^2.6.0), clsx (^2.1.1)
   - @vitejs/plugin-react (devDep)
   - vite (^5.4.19, devDep)
   - typescript (^5.8.0, devDep)
   - @types/react, @types/react-dom (devDeps)
   Scripts: dev, build, preview

2. "vite.config.ts" — standard React Vite config with path alias "@" -> "./src"

3. "tsconfig.json" — MUST be valid JSON (no comments, no trailing commas). Use this exact content:
   {"compilerOptions":{"target":"ES2020","useDefineForClassFields":true,"lib":["ES2020","DOM","DOM.Iterable"],"module":"ESNext","skipLibCheck":true,"moduleResolution":"bundler","allowImportingTsExtensions":true,"resolveJsonModule":true,"isolatedModules":true,"noEmit":true,"jsx":"react-jsx","strict":false,"baseUrl":".","paths":{"@/*":["./src/*"]}},"include":["src"],"references":[{"path":"./tsconfig.node.json"}]}

4. "tsconfig.node.json" — MUST be valid JSON (no comments, no trailing commas). Use this exact content:
   {"compilerOptions":{"composite":true,"skipLibCheck":true,"module":"ESNext","moduleResolution":"Bundler","allowSyntheticDefaultImports":true},"include":["vite.config.ts"]}

5. "tailwind.config.ts" — with brand colors mapped to CSS variables (--primary, --secondary, --accent, --background, --foreground, etc.)

6. "postcss.config.js" — tailwindcss + autoprefixer

7. "index.html" — standard Vite entry with meta tags, title, Google Fonts links if needed

8. "src/main.tsx" — React entry point

9. "src/App.tsx" — main app with React Router, rendering the LandingPage

10. "src/index.css" — Tailwind directives + CSS custom properties for all brand colors in HSL format in :root and .dark

11. "src/lib/utils.ts" — cn() utility using clsx + tailwind-merge

12. "src/pages/LandingPage.tsx" — the main landing page component that imports and composes all section components

13. "src/components/" — individual section components:
    - Header.tsx (sticky, responsive, mobile menu)
    - Hero.tsx (compelling headline, CTA, background)
    - One component per section from the specification
    - Footer.tsx (contact, social, legal)
    - Any shared UI components (Button, Card, etc.)

CRITICAL RULES:
- Each component must be a proper React functional component with TypeScript
- Use Tailwind CSS classes ONLY — no inline styles, no CSS modules
- Use semantic color tokens: bg-primary, text-foreground, etc. (mapped via tailwind.config.ts)
- NEVER hardcode colors like bg-blue-500, text-white — always use design tokens
- Use lucide-react for all icons
- Mobile-first responsive design with sm:, md:, lg: breakpoints
- Proper TypeScript types
- Use the EXACT image URLs from the specification
- Smooth animations with Tailwind (animate-*, transition-*)
- Use IntersectionObserver for scroll animations
- The project must work with: npm install && npm run dev
- Make it production-quality, premium, professional
- Keep components focused — one per file
- Use proper semantic HTML (header, main, section, footer, nav)
- Alt text on all images, aria-labels on interactive elements

Return ONLY valid JSON. No markdown, no explanation, no code fences.`;

    console.log("Calling AI gateway to generate React project...");

    const response = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: systemPrompt },
            {
              role: "user",
              content: `Generate the complete React project based on this specification:\n\n${prompt}`,
            },
          ],
          response_format: { type: "json_object" },
        }),
      }
    );

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Please add funds." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const data = await response.json();
    const rawContent = data.choices?.[0]?.message?.content;
    if (!rawContent) throw new Error("No response from AI");

    // Clean markdown fences and extract JSON
    const cleaned = rawContent.replace(/```json\s*|```/gi, "").trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("Could not extract JSON from AI response:", rawContent.substring(0, 500));
      throw new Error("AI did not return valid JSON");
    }

    let parsed: { files: { path: string; content: string }[] };
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      console.error("Failed to parse extracted JSON:", jsonMatch[0].substring(0, 500));
      throw new Error("AI returned malformed JSON");
    }

    if (!parsed.files || !Array.isArray(parsed.files) || parsed.files.length === 0) {
      throw new Error("AI response missing files array");
    }

    console.log(`Generated ${parsed.files.length} files for React project`);

    // Save to generated_prompts for history
    await supabase
      .from("generated_prompts")
      .insert({
        business_name: businessName || "Landing Page",
        prompt_text: prompt,
      })
      .select()
      .single();

    return new Response(
      JSON.stringify({
        files: parsed.files,
        fileCount: parsed.files.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("generate-landing error:", e);
    return new Response(
      JSON.stringify({
        error: e instanceof Error ? e.message : "Unknown error",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
