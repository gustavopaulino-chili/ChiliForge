import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { logGeminiCost } from "../_shared/geminiCost.ts";

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
  mode?: "edit" | "plan";       // 'plan' = split a feedback text into distinct tasks
};

// Split a free-form feedback text into distinct, self-contained edit tasks so the
// editor can apply them one at a time (asking the user to advance between each).
async function planTasks(feedback: string, apiKey: string): Promise<string[]> {
  const sys = [
    "You split a user's landing-page feedback into a list of DISTINCT, self-contained edit tasks.",
    "Each task = ONE concrete change, phrased as a short imperative instruction in the user's language.",
    "Do not merge unrelated changes; do not invent changes the user didn't ask for. Preserve the user's intent and order.",
    "Return JSON only: {\"tasks\":[\"...\",\"...\"]}. For a single change, return exactly one task.",
  ].join("\n");
  const body = {
    systemInstruction: { parts: [{ text: sys }] },
    contents: [{ parts: [{ text: feedback }] }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 1200,
      responseMimeType: "application/json",
      responseSchema: { type: "object", properties: { tasks: { type: "array", items: { type: "string" } } }, required: ["tasks"] },
    },
  };
  const res = await fetch(`${buildAiUrl("gemini-2.5-flash")}?key=${apiKey}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`plan ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  const data = await res.json();
  logGeminiCost("agents-lp-reforge(plan)", "gemini-2.5-flash", data?.usageMetadata);
  const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("") ?? "";
  let tasks: string[] = [];
  try { const j = JSON.parse(text); if (Array.isArray(j?.tasks)) tasks = j.tasks.map((t: unknown) => String(t || "").trim()).filter(Boolean); } catch { /* ignore */ }
  if (!tasks.length) tasks = [feedback.trim()];
  return tasks.slice(0, 12);
}

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
type Unmatched = { search: string; reason: "not_found" | "ambiguous" | "empty" };

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

function indexAll(haystack: string, needle: string): number[] {
  const out: number[] = [];
  if (!needle) return out;
  let i = haystack.indexOf(needle);
  while (i >= 0) { out.push(i); i = haystack.indexOf(needle, i + 1); }
  return out;
}

// Line-trimmed match: compare blocks ignoring trailing whitespace per line, but
// map back to the EXACT original line range so replacement stays position-accurate.
function lineTrimMatchStarts(htmlLines: string[], searchLines: string[]): number[] {
  const n = searchLines.length;
  const st = searchLines.map((l) => l.replace(/\s+$/, ""));
  const starts: number[] = [];
  for (let i = 0; i + n <= htmlLines.length; i++) {
    let ok = true;
    for (let j = 0; j < n; j++) {
      if (htmlLines[i + j].replace(/\s+$/, "") !== st[j]) { ok = false; break; }
    }
    if (ok) starts.push(i);
  }
  return starts;
}

// Apply edit blocks SURGICALLY and SAFELY. A block is applied only when it matches
// the current HTML UNIQUELY (exact, else line-trim fallback). Ambiguous or missing
// blocks are never guessed — they're reported so the model can correct them.
function applyEdits(html: string, blocks: EditBlock[]): { html: string; applied: number; unmatched: Unmatched[] } {
  let out = html;
  let applied = 0;
  const unmatched: Unmatched[] = [];
  for (const b of blocks) {
    if (b.search === "") { unmatched.push({ search: "", reason: "empty" }); continue; }

    const exact = indexAll(out, b.search);
    if (exact.length === 1) {
      out = out.slice(0, exact[0]) + b.replace + out.slice(exact[0] + b.search.length);
      applied++;
      continue;
    }
    if (exact.length > 1) { unmatched.push({ search: b.search, reason: "ambiguous" }); continue; }

    // Fallback: line-trim match mapped back to the exact original lines.
    const hl = out.split("\n");
    const sl = b.search.split("\n");
    const starts = lineTrimMatchStarts(hl, sl);
    if (starts.length === 1) {
      const i = starts[0];
      out = [...hl.slice(0, i), b.replace, ...hl.slice(i + sl.length)].join("\n");
      applied++;
    } else if (starts.length > 1) {
      unmatched.push({ search: b.search, reason: "ambiguous" });
    } else {
      unmatched.push({ search: b.search, reason: "not_found" });
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
  logGeminiCost("agents-lp-reforge", model, data?.usageMetadata);
  const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("") ?? "";
  if (!text.trim()) throw new Error(`Gemini ${model} returned empty response`);
  return text;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const payload = await req.json() as ReforgePayload;
    if (!payload?.instruction?.trim()) {
      return new Response(JSON.stringify({ error: "instruction is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const apiKey = getApiKey(typeof payload.geminiApiKey === "string" ? payload.geminiApiKey : undefined);
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "Gemini API key not configured" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // PLAN mode: just split the feedback into tasks (no html / stores needed).
    if (payload.mode === "plan") {
      const tasks = await planTasks(payload.instruction, apiKey);
      return new Response(JSON.stringify({ tasks }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (!payload?.html?.trim()) {
      return new Response(JSON.stringify({ error: "html is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const preferred = payload.model || MODEL_CHAIN[0];
    const chain = [preferred, ...MODEL_CHAIN.filter((m) => m !== preferred)];
    const isTransient = (msg: string) => /returned (429|500|502|503|504)|UNAVAILABLE|high demand|overloaded|RESOURCE_EXHAUSTED/i.test(msg);
    const runModel = async (p: ReforgePayload): Promise<string> => {
      let lastErr: Error | null = null;
      for (const model of chain) {
        for (let attempt = 0; attempt < 3; attempt++) {
          try { return await callGemini(p, model, apiKey); }
          catch (e) {
            lastErr = e instanceof Error ? e : new Error(String(e));
            // Overloaded/transient → wait briefly and retry the SAME model before
            // moving on (503 spikes are usually momentary).
            if (isTransient(lastErr.message) && attempt < 2) {
              await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
              continue;
            }
            break; // non-transient or out of attempts → try next model
          }
        }
      }
      throw lastErr ?? new Error("All models failed");
    };

    // Round 0: the user's request. Rounds 1-2: auto-correct the blocks that did not
    // match, re-issued against the (already partially-updated) HTML — so edits land
    // reliably without the user having to rephrase.
    let html = payload.html;
    let firstReply = "";
    let totalApplied = 0;
    let lastUnmatched: Unmatched[] = [];

    for (let round = 0; round < 3; round++) {
      const roundInstruction = round === 0
        ? payload.instruction
        : [
            `The previous edits for this request could NOT be applied because their SEARCH text did not match the current HTML uniquely.`,
            `Original request: "${payload.instruction}"`,
            `Re-issue SEARCH/REPLACE blocks ONLY for the following failed changes. Copy the SEARCH VERBATIM from the CURRENT HTML below, and include MORE surrounding context so each SEARCH is unique. Do not touch anything else.`,
            `Failed targets:\n` + lastUnmatched.map((u, i) => `${i + 1}. [${u.reason}] ${u.search.slice(0, 200)}`).join("\n"),
          ].join("\n");

      const raw = await runModel({ ...payload, html, instruction: roundInstruction });
      const { reply, blocks } = parseEditBlocks(raw);
      if (round === 0) firstReply = reply;

      if (!blocks.length) { lastUnmatched = []; break; }  // a question or nothing to do

      const r = applyEdits(html, blocks);
      html = r.html;
      totalApplied += r.applied;
      lastUnmatched = r.unmatched;
      if (!lastUnmatched.length) break;                    // everything landed
    }

    // Safety guard: never return structurally-broken HTML. If the page lost its
    // closing tags after edits, revert entirely and report instead of corrupting.
    let reverted = false;
    const hadHtmlClose = /<\/html>/i.test(payload.html);
    const hadBodyClose = /<\/body>/i.test(payload.html);
    if (totalApplied > 0 && ((hadHtmlClose && !/<\/html>/i.test(html)) || (hadBodyClose && !/<\/body>/i.test(html)))) {
      html = payload.html;
      totalApplied = 0;
      reverted = true;
    }

    const unmatchedSnippets = lastUnmatched.map((u) => u.search.slice(0, 120)).filter(Boolean);
    const reply = firstReply
      || (reverted ? "Detectei que a alteração quebraria a página, então não apliquei. Pode reformular?"
        : totalApplied ? "Pronto, apliquei a alteração." : "Não fiz alterações.");

    return new Response(JSON.stringify({
      reply,
      html,
      changed: totalApplied > 0,
      applied: totalApplied,
      unmatched: unmatchedSnippets,
      reverted,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("[agents-lp-reforge] error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    // Overloaded/transient model errors → friendly 200 so the chat shows a clean
    // note (and keeps the page unchanged) instead of a raw 500.
    if (/(429|500|502|503|504)|UNAVAILABLE|high demand|overloaded|RESOURCE_EXHAUSTED/i.test(msg)) {
      return new Response(JSON.stringify({
        reply: "⚠️ O modelo de IA está sobrecarregado agora. Não alterei nada — tente novamente em alguns segundos.",
        changed: false, applied: 0, unmatched: [], reverted: false,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
