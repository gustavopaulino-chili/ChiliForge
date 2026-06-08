import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// ReForge / "Chilito" — surgical LP editor. Given the CURRENT page HTML, the user's
// requested change, the conversation history, and the LP + company File Search
// stores, it returns ONLY targeted SEARCH/REPLACE edits (never a full rewrite),
// applies them to the HTML server-side, and returns the new HTML + a chat reply.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type ChatMsg = { role: "user" | "assistant"; content: string };

type ReforgePayload = {
  html: string;
  instruction: string;
  history?: ChatMsg[];
  globalStoreName?: string;
  companyStoreName?: string;
  generationContext?: string;   // original brief / brand facts so edits stay on-brand
  geminiApiKey?: string;
  model?: string;
};

const env = (globalThis as any).Deno?.env;
const MODEL_CHAIN = ["gemini-2.5-flash", "gemini-2.5-pro"];

function getApiKey(userKey?: string): string {
  if (userKey?.trim()) return userKey.trim();
  return env?.get("GEMINI_API_KEY_PRODUCTION") || env?.get("GEMINI_API_KEY_TESTING") || "";
}
function buildAiUrl(model: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

const SYSTEM_PROMPT = [
  "You are Chilito, a precise landing-page editor inside ChiliForge's visual editor.",
  "You receive the FULL current HTML of an already-generated landing page and a single change request from the user.",
  "Your job: apply EXACTLY the change requested — nothing more. You are a scalpel, not a rewrite tool.",
  "",
  "ABSOLUTE RULES:",
  "• NEVER rewrite or regenerate the whole page. Touch only the minimum needed for the request.",
  "• Preserve everything else byte-for-byte: structure, classes, copy, scripts, other sections, brand colors, fonts.",
  "• Respect the brand: keep the exact brand colors and fonts unless the user explicitly asks to change them. The attached File Search stores (global LP guidelines + company brand) and the generation context are the source of truth for tone/brand.",
  "• Keep the change consistent with the page's existing design language (spacing, component style, tailwind utility patterns already used).",
  "• If the request is ambiguous or you need info, ask a short clarifying question and return NO edits.",
  "",
  "OUTPUT FORMAT (strict):",
  "1) First, a SHORT friendly reply (1-3 sentences) describing what you changed, in the user's language.",
  "2) Then, for EACH edit, a block in EXACTLY this format (copy the SEARCH text VERBATIM from the provided HTML, including whitespace/indentation, large enough to be unique):",
  "<<<<<<< SEARCH",
  "(exact existing snippet)",
  "=======",
  "(replacement snippet)",
  ">>>>>>> REPLACE",
  "",
  "• Each SEARCH must match the current HTML exactly and uniquely. Prefer a few lines of context to stay unique.",
  "• Do NOT wrap the blocks in markdown code fences. Output the markers literally.",
  "• If no change is needed (e.g. you asked a question), output only the reply with no blocks.",
].join("\n");

type EditBlock = { search: string; replace: string };

function parseEditBlocks(text: string): { reply: string; blocks: EditBlock[] } {
  const re = /<<<<<<< SEARCH\r?\n([\s\S]*?)\r?\n=======\r?\n([\s\S]*?)\r?\n>>>>>>> REPLACE/g;
  const blocks: EditBlock[] = [];
  let m: RegExpExecArray | null;
  let firstIdx = text.length;
  while ((m = re.exec(text)) !== null) {
    if (m.index < firstIdx) firstIdx = m.index;
    blocks.push({ search: m[1], replace: m[2] });
  }
  const reply = (blocks.length ? text.slice(0, firstIdx) : text).trim();
  return { reply, blocks };
}

// Apply edit blocks to the HTML. Exact match first; if not found, a whitespace-
// tolerant fallback (trim trailing spaces per line). Never apply a non-matching
// block — surface it as unmatched so nothing gets corrupted.
function applyEdits(html: string, blocks: EditBlock[]): { html: string; applied: number; unmatched: string[] } {
  let out = html;
  let applied = 0;
  const unmatched: string[] = [];
  for (const b of blocks) {
    if (b.search === "") { unmatched.push("(empty search)"); continue; }
    if (out.includes(b.search)) {
      out = out.replace(b.search, b.replace);
      applied++;
      continue;
    }
    // Fallback: normalize trailing whitespace per line on both sides.
    const norm = (s: string) => s.split("\n").map((l) => l.replace(/\s+$/, "")).join("\n");
    const nHtml = norm(out);
    const nSearch = norm(b.search);
    const idx = nHtml.indexOf(nSearch);
    if (idx >= 0) {
      // Map back is unreliable after normalization; rebuild by replacing in normalized
      // space then keeping it (acceptable — only trailing spaces differ).
      out = nHtml.replace(nSearch, b.replace);
      applied++;
    } else {
      unmatched.push(b.search.slice(0, 120));
    }
  }
  return { html: out, applied, unmatched };
}

async function callGemini(payload: ReforgePayload, model: string, apiKey: string): Promise<string> {
  const stores = [payload.globalStoreName?.trim(), payload.companyStoreName?.trim()].filter(Boolean) as string[];

  const historyText = (payload.history || [])
    .slice(-8)
    .map((h) => `${h.role === "user" ? "USER" : "CHILITO"}: ${h.content}`)
    .join("\n");

  const userMessage = [
    stores.length ? "Use the attached File Search stores (global LP guidelines + company brand) as the source of truth for brand, tone and design rules." : "",
    payload.generationContext?.trim() ? `=== ORIGINAL GENERATION CONTEXT (brand + brief) ===\n${payload.generationContext.trim()}` : "",
    historyText ? `=== CONVERSATION SO FAR ===\n${historyText}` : "",
    `=== CURRENT PAGE HTML (edit surgically) ===\n${payload.html}`,
    `=== USER CHANGE REQUEST ===\n${payload.instruction.trim()}`,
    "Reply briefly, then output the minimal SEARCH/REPLACE blocks for this request only.",
  ].filter(Boolean).join("\n\n");

  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ parts: [{ text: userMessage }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 20000 },
  };
  if (stores.length) body.tools = [{ file_search: { file_search_store_names: stores } }];

  const res = await fetch(`${buildAiUrl(model)}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`Gemini ${model} returned ${res.status}: ${err.slice(0, 300)}`);
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("") ?? "";
  if (!text.trim()) throw new Error(`Gemini ${model} returned empty response`);
  return text;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const payload = await req.json() as ReforgePayload;
    if (!payload?.html?.trim()) {
      return new Response(JSON.stringify({ error: "html is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!payload?.instruction?.trim()) {
      return new Response(JSON.stringify({ error: "instruction is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const apiKey = getApiKey(typeof payload.geminiApiKey === "string" ? payload.geminiApiKey : undefined);
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "Gemini API key not configured" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const chain = [payload.model || MODEL_CHAIN[0], ...MODEL_CHAIN.filter((m) => m !== (payload.model || MODEL_CHAIN[0]))];
    let raw = "";
    let lastErr: Error | null = null;
    for (const model of chain) {
      try { raw = await callGemini(payload, model, apiKey); break; }
      catch (e) { lastErr = e instanceof Error ? e : new Error(String(e)); }
    }
    if (!raw) throw lastErr ?? new Error("All models failed");

    const { reply, blocks } = parseEditBlocks(raw);
    const { html, applied, unmatched } = blocks.length ? applyEdits(payload.html, blocks) : { html: payload.html, applied: 0, unmatched: [] };

    return new Response(JSON.stringify({
      reply: reply || (applied ? "Pronto, apliquei a alteração." : "Não fiz alterações."),
      html,
      changed: applied > 0,
      applied,
      total_blocks: blocks.length,
      unmatched,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("[agents-lp-reforge] error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
