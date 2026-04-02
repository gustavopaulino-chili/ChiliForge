import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const file = url.searchParams.get("file")?.trim();

    if (!file || !file.endsWith(".html") || file.includes("..")) {
      return new Response("Invalid file parameter", {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseServiceRoleKey) {
      throw new Error("Supabase credentials not configured");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
    const { data, error } = await supabase.storage.from("landing-pages").download(file);

    if (error || !data) {
      return new Response(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Preview not found</title></head><body style="font-family: Arial, sans-serif; padding: 2rem;"><h1>Preview not found</h1><p>The generated landing page file could not be loaded.</p></body></html>`, {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" },
      });
    }

    const html = await data.text();
    const safeFileName = file.replace(/[^a-zA-Z0-9._-]/g, "-");

    return new Response(html, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `inline; filename="${safeFileName}"`,
        "Cache-Control": "public, max-age=60",
      },
    });
  } catch (error) {
    console.error("render-landing-preview error:", error);
    return new Response(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Preview error</title></head><body style="font-family: Arial, sans-serif; padding: 2rem;"><h1>Preview error</h1><p>${error instanceof Error ? error.message : "Unknown error"}</p></body></html>`, {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" },
    });
  }
});
