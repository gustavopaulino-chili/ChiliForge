import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Locked config files — AI cannot override these ──────────────────────
const LOCKED_FILES: Record<string, string> = {
  "package.json": JSON.stringify({
    name: "landing-page",
    private: true,
    version: "0.0.0",
    type: "module",
    scripts: {
      dev: "vite",
      build: "vite build",
      preview: "vite preview",
    },
    dependencies: {
      react: "^18.3.1",
      "react-dom": "^18.3.1",
      "react-router-dom": "^6.30.0",
      "lucide-react": "^0.462.0",
      clsx: "^2.1.1",
      "tailwind-merge": "^2.6.0",
      "tailwindcss-animate": "^1.0.7",
    },
    devDependencies: {
      "@types/react": "^18.3.12",
      "@types/react-dom": "^18.3.1",
      "@vitejs/plugin-react": "^4.3.4",
      autoprefixer: "^10.4.20",
      postcss: "^8.4.49",
      tailwindcss: "^3.4.17",
      typescript: "^5.8.0",
      vite: "^5.4.19",
    },
  }, null, 2),

  "tsconfig.json": JSON.stringify({
    compilerOptions: {
      target: "ES2020",
      useDefineForClassFields: true,
      lib: ["ES2020", "DOM", "DOM.Iterable"],
      module: "ESNext",
      skipLibCheck: true,
      moduleResolution: "bundler",
      allowImportingTsExtensions: true,
      resolveJsonModule: true,
      isolatedModules: true,
      noEmit: true,
      jsx: "react-jsx",
      strict: false,
      baseUrl: ".",
      paths: { "@/*": ["./src/*"] },
    },
    include: ["src"],
    references: [{ path: "./tsconfig.node.json" }],
  }, null, 2),

  "tsconfig.node.json": JSON.stringify({
    compilerOptions: {
      composite: true,
      skipLibCheck: true,
      module: "ESNext",
      moduleResolution: "bundler",
      allowSyntheticDefaultImports: true,
    },
    include: ["vite.config.ts"],
  }, null, 2),

  "postcss.config.js": `export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
`,

  "vite.config.ts": `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
`,

  "tailwind.config.ts": `import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: { "2xl": "1400px" },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
    },
  },
  plugins: [animate],
} satisfies Config;
`,

  "src/lib/utils.ts": `import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
`,
};

const LOCKED_PATHS = new Set(Object.keys(LOCKED_FILES));

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

Your task: Generate ONLY the source files for a React + Vite + Tailwind CSS project as a JSON object.

IMPORTANT: The following files are pre-built and MUST NOT be included in your response:
- package.json
- tsconfig.json
- tsconfig.node.json
- postcss.config.js
- vite.config.ts
- tailwind.config.ts
- src/lib/utils.ts

Return a JSON object with this exact structure:
{
  "files": [
    { "path": "file/path.ext", "content": "file content as string" }
  ]
}

FILES YOU MUST GENERATE:

1. "index.html" — standard Vite entry point. Must include:
   - <!DOCTYPE html>, <html lang>, <head> with charset, viewport meta, title
   - Google Fonts <link> tags if the design uses custom fonts
   - <div id="root"></div> and <script type="module" src="/src/main.tsx"></script>

2. "src/main.tsx" — React 18 entry point with createRoot

3. "src/App.tsx" — main app with BrowserRouter from react-router-dom, rendering LandingPage at "/"

4. "src/index.css" — MUST start with:
   @tailwind base;
   @tailwind components;
   @tailwind utilities;
   
   Then define :root with CSS custom properties in HSL format (space-separated values, NO hsl() wrapper):
   --background: 0 0% 100%;
   --foreground: 222 84% 5%;
   --primary: <brand hue> <saturation>% <lightness>%;
   --primary-foreground: 0 0% 100%;
   --secondary: ...;
   --secondary-foreground: ...;
   --accent: ...;
   --accent-foreground: ...;
   --muted: ...;
   --muted-foreground: ...;
   --destructive: 0 84% 60%;
   --destructive-foreground: 0 0% 98%;
   --border: 220 13% 91%;
   --input: 220 13% 91%;
   --ring: <brand hue> <saturation>% <lightness>%;
   --radius: 0.5rem;
   --card: 0 0% 100%;
   --card-foreground: 222 84% 5%;
   --popover: 0 0% 100%;
   --popover-foreground: 222 84% 5%;
   
   Also add a .dark block with inverted values.
   Add global styles: body { @apply bg-background text-foreground; }

5. "src/pages/LandingPage.tsx" — main page composing all section components

6. "src/components/" — one file per section:
   - Header.tsx (sticky, responsive, mobile hamburger menu with state)
   - Hero.tsx (compelling headline, CTA buttons, hero image/background)
   - One component per section from the specification
   - Footer.tsx (contact info, social links, copyright)

CRITICAL RULES:
- Each component: proper React functional component with TypeScript
- Use Tailwind CSS classes ONLY — no inline styles, no CSS modules
- Use semantic color tokens: bg-primary, text-foreground, bg-card, etc.
- NEVER hardcode colors like bg-blue-500 or text-white — use design tokens (text-primary-foreground, bg-background, etc.)
- Import cn from "@/lib/utils" when combining conditional classes
- Use lucide-react for ALL icons (import { IconName } from "lucide-react")
- Mobile-first responsive: base styles for mobile, sm:, md:, lg: for larger
- Use the EXACT image URLs from the specification
- Smooth transitions: transition-all, duration-300, hover: states
- Use IntersectionObserver or simple CSS animations for scroll effects
- Proper semantic HTML: <header>, <main>, <section>, <footer>, <nav>
- Alt text on all <img>, aria-labels on buttons/links
- All imports must use relative paths or the "@/" alias
- Do NOT import from packages not in the pre-built package.json

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
              content: `Generate the React source files based on this specification:\n\n${prompt}`,
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

    // ── Post-processing: enforce locked files & validate JSON ──────────
    // 1. Remove any AI-generated config files (they're locked)
    parsed.files = parsed.files.filter((f) => !LOCKED_PATHS.has(f.path));

    // 2. Inject all locked files
    for (const [path, content] of Object.entries(LOCKED_FILES)) {
      parsed.files.push({ path, content });
    }

    // 3. Validate all JSON files in the output
    for (const f of parsed.files) {
      if (f.path.endsWith(".json")) {
        try {
          JSON.parse(f.content);
        } catch {
          console.error(`Invalid JSON in generated file: ${f.path}`);
          throw new Error(`Generated file ${f.path} contains invalid JSON`);
        }
      }
    }

    // 4. Ensure index.html exists
    const hasIndex = parsed.files.some((f) => f.path === "index.html");
    if (!hasIndex) {
      parsed.files.push({
        path: "index.html",
        content: `<!DOCTYPE html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${businessName || "Landing Page"}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>`,
      });
    }

    // 5. Ensure src/main.tsx exists
    const hasMain = parsed.files.some((f) => f.path === "src/main.tsx");
    if (!hasMain) {
      parsed.files.push({
        path: "src/main.tsx",
        content: `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
`,
      });
    }

    console.log(`Final project: ${parsed.files.length} files (${parsed.files.filter(f => LOCKED_PATHS.has(f.path)).length} locked)`);

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
