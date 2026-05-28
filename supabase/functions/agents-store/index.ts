import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type AgentsStorePayload =
  | {
      action: "get_or_create";
      geminiApiKey?: string;
      storeName?: string;
      displayName: string;
      documentText: string;
      documentLabel: string;
      accountType?: "admin" | "user";
    }
  | {
      action: "upload_learnings";
      geminiApiKey?: string;
      storeName?: string;
      displayName: string;
      learningsText: string;
      accountType?: "admin" | "user";
    }
  | {
      action: "upload_file";
      geminiApiKey?: string;
      storeName: string;
      fileBase64: string;
      mimeType: string;
      displayName: string;
      accountType?: "admin" | "user";
    };

type Operation = {
  name?: string;
  done?: boolean;
  error?: { message?: string; code?: number; status?: string };
  response?: Record<string, unknown>;
};

const env = (globalThis as any).Deno?.env;
const GEMINI_BASE = "https://generativelanguage.googleapis.com";

function getApiKey(userKey?: string): string {
  if (userKey?.trim()) return userKey.trim();
  return env?.get("GEMINI_API_KEY_PRODUCTION") || env?.get("GEMINI_API_KEY_TESTING") || "";
}

async function createStore(displayName: string, apiKey: string): Promise<string> {
  const res = await fetch(`${GEMINI_BASE}/v1beta/fileSearchStores?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      displayName,
      embedding_model: "models/gemini-embedding-2",
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`Failed to create File Search Store: HTTP ${res.status}: ${err.slice(0, 300)}`);
  }

  const data = await res.json();
  if (!data?.name) throw new Error("File Search Store created but no name returned");
  return data.name as string;
}

async function waitForOperation(operation: Operation, apiKey: string): Promise<Operation> {
  if (!operation?.name) {
    throw new Error("File Search upload started but no operation name was returned");
  }

  let current = operation;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (current.done) {
      if (current.error) {
        throw new Error(`File Search indexing failed: ${current.error.message || current.error.status || "Unknown error"}`);
      }
      return current;
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));
    const res = await fetch(`${GEMINI_BASE}/v1beta/${current.name}?key=${apiKey}`);
    if (!res.ok) {
      const err = await res.text().catch(() => "");
      throw new Error(`Failed to poll File Search operation: HTTP ${res.status}: ${err.slice(0, 300)}`);
    }
    current = await res.json();
  }

  throw new Error("File Search indexing did not finish in time");
}

async function uploadBytesToStore(
  storeName: string,
  fileBytes: Uint8Array,
  mimeType: string,
  displayName: string,
  apiKey: string
): Promise<Operation> {
  const boundary = `boundary_${Date.now()}`;
  const safeFileName = displayName.replace(/[^\w.\-]+/g, "-") || "file";
  const metadataJson = JSON.stringify({ displayName, mimeType });
  const encoder = new TextEncoder();
  const bodyParts: Uint8Array[] = [
    encoder.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`),
    encoder.encode(metadataJson),
    encoder.encode(`\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\nContent-Disposition: form-data; name="file"; filename="${safeFileName}"\r\n\r\n`),
    fileBytes,
    encoder.encode(`\r\n--${boundary}--\r\n`),
  ];

  let totalLen = 0;
  for (const part of bodyParts) totalLen += part.length;

  const body = new Uint8Array(totalLen);
  let offset = 0;
  for (const part of bodyParts) {
    body.set(part, offset);
    offset += part.length;
  }

  const res = await fetch(`${GEMINI_BASE}/upload/v1beta/${storeName}:uploadToFileSearchStore?key=${apiKey}`, {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": `multipart/related; boundary=${boundary}`,
      "Content-Length": String(totalLen),
    },
    body,
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`Failed to upload to File Search store: HTTP ${res.status}: ${err.slice(0, 300)}`);
  }

  return await res.json();
}

function decodeBase64(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

function isAdBannerHtml(html: string): boolean {
  return html.includes('ad-banner') || html.includes('data-platform') || html.includes('data-format');
}

function wrapBannerAsInspiration(html: string, label: string): string {
  return `# Ad Creative Example: ${label}\n\n` +
    `> **USAGE — INSPIRATION ONLY**: Study layout structure, CTA placement, visual hierarchy, ` +
    `and composition. Do NOT treat as a technical rule or copy exact positions/colors.\n\n` +
    `## HTML Source\n\`\`\`html\n${html}\n\`\`\`\n`;
}

async function describeAdImage(fileBase64: string, mimeType: string, label: string, apiKey: string): Promise<string> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { inline_data: { mime_type: mimeType, data: fileBase64 } },
            { text: `Analyze this ad creative image. Describe in detail:\n` +
              `1. Layout structure and composition (quadrants, alignment, flow)\n` +
              `2. Visual hierarchy (what draws attention first, second, third)\n` +
              `3. Text elements — exact text of headline, subheadline, CTA if readable\n` +
              `4. CTA treatment (button position, size, color, style)\n` +
              `5. Color palette (dominant, accent, background colors with estimates)\n` +
              `6. Image/logo usage (product photo position, logo placement, background treatment)\n` +
              `7. Spacing and proportions (padding, text-to-image ratio)\n` +
              `8. Visual style (minimal, bold, lifestyle, etc.)\n` +
              `9. Format estimate (square, story, banner dimensions)\n\n` +
              `This is a visual reference for AI ad generation. Be specific and technical.\n` +
              `Label: ${label}`
            }
          ]
        }],
        generationConfig: { maxOutputTokens: 1500, temperature: 0.2 }
      })
    }
  );
  if (!res.ok) throw new Error(`Vision API failed: ${res.status}`);
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  if (!text) throw new Error('Vision API returned empty description');

  return `# Ad Visual Reference: ${label}\n\n` +
    `> **USAGE — INSPIRATION ONLY**: Use layout principles, CTA treatment, and composition ` +
    `patterns as creative reference. Do NOT copy colors, brand elements, or exact arrangements.\n\n` +
    `## Visual Analysis\n\n${text}\n`;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const payload = await req.json() as AgentsStorePayload;
    const apiKey = getApiKey(typeof payload.geminiApiKey === "string" ? payload.geminiApiKey : undefined);

    if (!apiKey) {
      return new Response(JSON.stringify({ error: "Gemini API key not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (payload.action === "get_or_create") {
      const { storeName: existingStore, displayName, documentText, documentLabel } = payload;

      if (!documentText?.trim()) {
        return new Response(JSON.stringify({ error: "documentText is required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const storeName = existingStore?.trim() || await createStore(displayName, apiKey);
      const operation = await waitForOperation(
        await uploadBytesToStore(storeName, new TextEncoder().encode(documentText), "text/plain", documentLabel, apiKey),
        apiKey
      );

      return new Response(JSON.stringify({ storeName, operationName: operation.name, document: operation.response ?? null }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (payload.action === "upload_learnings") {
      const { storeName: existingStore, displayName, learningsText } = payload;

      if (!learningsText?.trim()) {
        return new Response(JSON.stringify({ error: "learningsText is required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const storeName = existingStore?.trim() || await createStore(displayName, apiKey);
      const operation = await waitForOperation(
        await uploadBytesToStore(
          storeName,
          new TextEncoder().encode(learningsText),
          "text/plain",
          `Learnings - ${new Date().toISOString().slice(0, 10)}`,
          apiKey
        ),
        apiKey
      );

      return new Response(JSON.stringify({ storeName, operationName: operation.name, document: operation.response ?? null }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (payload.action === "upload_file") {
      const { storeName, fileBase64, mimeType, displayName } = payload;

      if (!storeName?.trim()) {
        return new Response(JSON.stringify({ error: "storeName is required for upload_file" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!fileBase64?.trim()) {
        return new Response(JSON.stringify({ error: "fileBase64 is required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      let uploadBytes: Uint8Array;
      let uploadMime = mimeType || "application/octet-stream";

      if (uploadMime.startsWith('image/') && uploadMime !== 'image/svg+xml') {
        const description = await describeAdImage(fileBase64, uploadMime, displayName || 'Ad Image', apiKey);
        uploadBytes = new TextEncoder().encode(description);
        uploadMime = 'text/plain';
      } else if (uploadMime === 'text/html' || uploadMime === 'application/octet-stream') {
        const htmlContent = new TextDecoder().decode(decodeBase64(fileBase64));
        if (isAdBannerHtml(htmlContent)) {
          const wrapped = wrapBannerAsInspiration(htmlContent, displayName || 'Ad Banner');
          uploadBytes = new TextEncoder().encode(wrapped);
          uploadMime = 'text/plain';
        } else {
          uploadBytes = decodeBase64(fileBase64);
        }
      } else {
        uploadBytes = decodeBase64(fileBase64);
      }

      const operation = await waitForOperation(
        await uploadBytesToStore(storeName, uploadBytes, uploadMime, displayName, apiKey),
        apiKey
      );

      return new Response(JSON.stringify({ storeName, operationName: operation.name, document: operation.response ?? null }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[agents-store] error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
