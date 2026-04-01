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

ALLOWED PACKAGES — you can ONLY import from these and from files YOU create:
- react
- react-dom / react-dom/client
- react-router-dom
- lucide-react — ONLY these icons exist: Menu, X, Phone, Mail, MapPin, Star, ChevronRight, ArrowRight, Check, Facebook, Instagram, Twitter, Linkedin, Youtube, Heart, Shield, Clock, Users, Zap, Award, Target, TrendingUp, Sparkles, Globe, MessageCircle, Calendar, DollarSign, BarChart3, Layers, Settings, Play, Download, ExternalLink, ChevronDown, ChevronUp, Search, Plus, Minus, Eye, EyeOff, Copy, Share2, ThumbsUp, Briefcase, Home, Info, AlertCircle, HelpCircle, Bell, Bookmark, Filter, RefreshCw, Send, Trash2, Edit, Lock, Unlock, Wifi, Monitor, Smartphone, Tablet, Code, Database, Server, Cloud, CreditCard, ShoppingCart, Gift, Percent, Tag, FileText, Image, Video, Music, Headphones, Mic, Volume2, Sun, Moon, Thermometer, Droplets, Wind, Umbrella, Coffee, Utensils, Car, Plane, Train, Ship, Building2, Store, GraduationCap, BookOpen, PenTool, Palette, Camera, Scissors, Wrench, Hammer, Key
- clsx
- tailwind-merge
- Local files you generate (import with "./" or "@/")

HARD BANS — these WILL crash the build:
- NEVER import from "@/components/ui/..." — Button, Card, Badge etc. do NOT exist
- NEVER import "Mobile" from lucide-react — it does not exist
- NEVER import from shadcn, @shadcn, @radix-ui, framer-motion, gsap, aos, @heroicons, react-icons, axios, swr, or ANY unlisted package
- NEVER use require()
- NEVER use arbitrary font classes like font-[var(...)], font-[...], or font-(...) — use ONLY standard Tailwind: font-normal, font-medium, font-semibold, font-bold, font-extrabold
- NEVER combine two font-weight classes on the same element
- NEVER define custom CSS font variables — use Google Fonts via <link> in index.html and Tailwind's font-sans/font-serif/font-mono
- NEVER use hardcoded colors: no text-white, text-black, bg-white, bg-black, bg-blue-500, bg-gray-100 etc.
  - EXCEPTION: bg-black/50, bg-white/10 opacity overlays are OK

RUNTIME SAFETY RULES (MANDATORY — violations cause white screen):
- The project MUST render successfully on the FIRST paint. No white screens allowed.
- Every component MUST have a default export: export default function ComponentName() { ... }
- src/App.tsx MUST have: export default function App() { ... } — NEVER export const App or named-only export
- src/main.tsx MUST import App from "./App" (not from "./App.tsx")
- Every local import MUST resolve to a file you also generate. If you import "@/components/Header", you MUST generate "src/components/Header.tsx"
- All data (services, testimonials, features, etc.) MUST be hardcoded as const arrays INSIDE the component file or in a shared data file you also generate. NEVER use undefined variables.
- NEVER call APIs, fetch(), or any async logic during render
- NEVER use window, document, localStorage, matchMedia, or any browser API at module top level
- NEVER use .map(), .filter(), .reduce() on a value that could be undefined — always use a hardcoded array
- NEVER use React.lazy() or dynamic imports — use static imports only
- Wrap all .map() calls with a fallback: (items || []).map(...)
- Every useState must have a proper initial value, never undefined
- NEVER use useEffect with missing dependencies or infinite loops
- DO NOT use React.StrictMode — just render <App /> directly in main.tsx

For buttons: <button className="inline-flex items-center justify-center rounded-lg bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">Text</button>
For cards: <div className="rounded-xl border border-border bg-card p-6 shadow-sm">content</div>

FILES TO GENERATE:
1. "index.html" — Vite entry with Google Fonts <link>, <div id="root"></div>, <script type="module" src="/src/main.tsx"></script>
2. "src/main.tsx" — import App from './App'; createRoot render <App />
3. "src/App.tsx" — default export function App with BrowserRouter + Routes + Route path="/" element={<LandingPage />}
4. "src/index.css" — @tailwind base/components/utilities + :root with HSL vars (space-separated, NO hsl() wrapper) for ALL tokens: --background, --foreground, --primary, --primary-foreground, --secondary, --secondary-foreground, --muted, --muted-foreground, --accent, --accent-foreground, --destructive, --destructive-foreground, --card, --card-foreground, --popover, --popover-foreground, --border, --input, --ring, --radius + body { @apply bg-background text-foreground; }
5. "src/pages/LandingPage.tsx" — default export, composes section components
6. "src/components/*.tsx" — Header, Hero, sections, Footer — each with default export

STYLING:
- ONLY Tailwind utility classes — no inline styles, no CSS modules, no custom CSS variables for fonts
- Semantic tokens: bg-primary, text-foreground, bg-card, border-border, bg-muted, text-muted-foreground
- Font weights: ONLY font-normal, font-medium, font-semibold, font-bold, font-extrabold
- Import cn from "@/lib/utils" for conditional classes

COMPONENTS:
- TypeScript functional components with default export
- Mobile-first: base → sm: → md: → lg:
- Header: sticky, hamburger with useState (initial value false)
- Raw HTML elements styled with Tailwind — no component library
- Icons from lucide-react only, sized with className="h-5 w-5"
- Images: use placeholder URLs like "https://placehold.co/600x400" if no specific URL given, always with alt text
- Semantic HTML: <header>, <main>, <section>, <footer>, <nav>

SELF-CHECK before returning:
1. Verify EVERY import path resolves to a file in your output or an allowed package
2. Verify EVERY component file has "export default"
3. Verify App.tsx imports only components you generated
4. Verify no className contains font-[...] or font-(...)
5. Verify no hardcoded color classes (text-white, bg-black, etc.)
6. Verify all arrays used in .map() are defined as const in the same file

Return ONLY valid JSON. No markdown, no code fences, no explanation.`;

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
          model: "google/gemini-2.5-pro",
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

    // ── Post-processing: sanitize, enforce locked files & validate ──────
    // 0. Sanitize all generated files — fix common AI mistakes
    const ALLOWED_PACKAGES = new Set([
      "react", "react-dom", "react-dom/client", "react-router-dom",
      "lucide-react", "clsx", "tailwind-merge",
    ]);

    for (const f of parsed.files) {
      if (!f.path.endsWith(".tsx") && !f.path.endsWith(".ts")) continue;
      
      // Remove forbidden imports (shadcn ui, framer-motion, etc.)
      f.content = f.content.replace(
        /^import\s+.*from\s+["'](@\/components\/ui\/[^"']+|shadcn[^"']*|@shadcn[^"']*|@radix-ui[^"']*|framer-motion|gsap|aos|@heroicons\/[^"']+|react-icons[^"']*|axios|swr)["'];?\s*$/gm,
        "// [removed invalid import]"
      );

      // Validate all remaining imports are from allowed packages or local paths
      f.content = f.content.replace(
        /^(import\s+.*from\s+["'])([^"'.@][^"']*)(["'];?)$/gm,
        (match, pre, pkg, post) => {
          const basePkg = pkg.startsWith("@") ? pkg.split("/").slice(0, 2).join("/") : pkg.split("/")[0];
          if (ALLOWED_PACKAGES.has(pkg) || ALLOWED_PACKAGES.has(basePkg)) return match;
          console.warn(`Removed forbidden import: ${pkg}`);
          return `// [removed invalid import: ${basePkg}]`;
        }
      );

      // Remove invalid lucide-react exports (e.g. "Mobile" doesn't exist)
      const VALID_LUCIDE = new Set(["Menu","X","Phone","Mail","MapPin","Star","ChevronRight","ArrowRight","Check","Facebook","Instagram","Twitter","Linkedin","Youtube","Heart","Shield","Clock","Users","Zap","Award","Target","TrendingUp","Sparkles","Globe","MessageCircle","Calendar","DollarSign","BarChart3","Layers","Settings","Play","Download","ExternalLink","ChevronDown","ChevronUp","Search","Plus","Minus","Eye","EyeOff","Copy","Share2","ThumbsUp","Briefcase","Home","Info","AlertCircle","HelpCircle","Bell","Bookmark","Filter","RefreshCw","Send","Trash2","Edit","Lock","Unlock","Wifi","Monitor","Smartphone","Tablet","Code","Database","Server","Cloud","CreditCard","ShoppingCart","Gift","Percent","Tag","FileText","Image","Video","Music","Headphones","Mic","Volume2","Sun","Moon","Thermometer","Droplets","Wind","Umbrella","Coffee","Utensils","Car","Plane","Train","Ship","Building2","Store","GraduationCap","BookOpen","PenTool","Palette","Camera","Scissors","Wrench","Hammer","Key"]);
      f.content = f.content.replace(
        /^(import\s*\{)([^}]+)(\}\s*from\s*["']lucide-react["'];?)$/gm,
        (match, pre, icons, post) => {
          const filtered = icons.split(",")
            .map((s: string) => s.trim())
            .filter((s: string) => s && VALID_LUCIDE.has(s));
          if (filtered.length === 0) return "// [removed: no valid lucide icons]";
          return `${pre} ${filtered.join(", ")} ${post}`;
        }
      );

      // Remove arbitrary font classes: font-[...] and font-(...)
      f.content = f.content.replace(/\bfont-\[[^\]]*\]/g, "");
      f.content = f.content.replace(/\bfont-\([^)]*\)/g, "");

      // Replace hardcoded color classes with semantic tokens
      const colorReplacements: [RegExp, string][] = [
        [/\btext-white\b/g, "text-primary-foreground"],
        [/\btext-black\b/g, "text-foreground"],
        [/\bbg-white\b(?!\/)/g, "bg-background"],
        [/\bbg-black\b(?!\/)/g, "bg-foreground"],
        [/\btext-gray-\d+\b/g, "text-muted-foreground"],
        [/\bbg-gray-\d+\b/g, "bg-muted"],
        [/\bborder-gray-\d+\b/g, "border-border"],
      ];
      for (const [re, replacement] of colorReplacements) {
        f.content = f.content.replace(re, replacement);
      }

      // Clean up double spaces left by removals
      f.content = f.content.replace(/  +/g, " ");
    }

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

    // 4. Cross-file import validation: verify all local imports resolve
    const generatedPaths = new Set(parsed.files.map((f) => f.path));
    for (const f of parsed.files) {
      if (!f.path.endsWith(".tsx") && !f.path.endsWith(".ts")) continue;
      // Find all local imports
      const localImports = [...f.content.matchAll(/from\s+["'](@\/|\.\.?\/)(.*?)["']/g)];
      for (const match of localImports) {
        const prefix = match[1];
        const importPath = match[2];
        let resolvedPath: string;
        if (prefix === "@/") {
          resolvedPath = `src/${importPath}`;
        } else {
          // Resolve relative path
          const dir = f.path.substring(0, f.path.lastIndexOf("/"));
          resolvedPath = `${dir}/${importPath}`.replace(/\/\.\//g, "/");
        }
        // Try with common extensions
        const candidates = [resolvedPath, `${resolvedPath}.tsx`, `${resolvedPath}.ts`, `${resolvedPath}/index.tsx`, `${resolvedPath}/index.ts`];
        const found = candidates.some((c) => generatedPaths.has(c));
        if (!found) {
          console.warn(`Broken import in ${f.path}: "${prefix}${importPath}" — removing line`);
          // Remove the entire import line
          f.content = f.content.replace(
            new RegExp(`^import\\s+.*from\\s+["']${prefix.replace("/", "\\/")}${importPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'];?\\s*$`, "gm"),
            `// [removed: broken import "${prefix}${importPath}"]`
          );
        }
      }
    }

    // 5. Ensure every .tsx file has a default export
    for (const f of parsed.files) {
      if (!f.path.endsWith(".tsx")) continue;
      if (LOCKED_PATHS.has(f.path)) continue;
      if (!f.content.includes("export default")) {
        // Try to find the main function/const and add default export
        const funcMatch = f.content.match(/(?:export\s+)?(?:function|const)\s+(\w+)/);
        if (funcMatch) {
          const name = funcMatch[0].includes("export") ? funcMatch[1] : funcMatch[1];
          if (!f.content.includes(`export default ${name}`)) {
            f.content += `\nexport default ${name};\n`;
            console.warn(`Added missing default export for ${name} in ${f.path}`);
          }
        }
      }
    }

    // 6. Ensure index.html exists
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

    // 7. Ensure src/main.tsx exists with safe content
    const hasMain = parsed.files.some((f) => f.path === "src/main.tsx");
    if (!hasMain) {
      parsed.files.push({
        path: "src/main.tsx",
        content: `import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
`,
      });
    } else {
      // Fix existing main.tsx — ensure it imports from './App' not './App.tsx'
      const mainFile = parsed.files.find((f) => f.path === "src/main.tsx");
      if (mainFile) {
        mainFile.content = mainFile.content.replace(/from\s+["']\.\/App\.tsx["']/g, "from './App'");
        // Remove StrictMode if present (can cause double-render issues)
        mainFile.content = mainFile.content.replace(/import\s+React\s+from\s+['"]react['"];?\s*/g, "");
        mainFile.content = mainFile.content.replace(/<React\.StrictMode>\s*/g, "");
        mainFile.content = mainFile.content.replace(/\s*<\/React\.StrictMode>/g, "");
      }
    }

    // 8. Ensure src/App.tsx has default export
    const appFile = parsed.files.find((f) => f.path === "src/App.tsx");
    if (appFile && !appFile.content.includes("export default")) {
      appFile.content = appFile.content.replace(
        /export\s+function\s+App/,
        "export default function App"
      );
      if (!appFile.content.includes("export default")) {
        appFile.content += "\nexport default App;\n";
      }
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
