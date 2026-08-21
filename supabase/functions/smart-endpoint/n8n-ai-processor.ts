import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

Deno.serve(async (req) => {
  try {
    const apiKey = req.headers.get("x-api-key");
    if (apiKey !== Deno.env.get("N8N_API_KEY")) {
      return new Response("Unauthorized", { status: 401 });
    }

    const { userPrompt } = await req.json();

    if (!userPrompt) {
      return new Response("Missing userPrompt", { status: 400 });
    }

    // 🔎 Detectar tipo automaticamente
    const lowerPrompt = userPrompt.toLowerCase();
    let type = "chat";

    if (lowerPrompt.includes("apresentação") || lowerPrompt.includes("slides")) {
      type = "apresentacao";
    } else if (lowerPrompt.includes("relatório") || lowerPrompt.includes("report")) {
      type = "relatorio";
    }

    const aiResponse = await fetch("https://gateway.lovable.dev/v1/ai", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${Deno.env.get("LOVABLE_API_KEY")}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "user", content: userPrompt }
        ]
      })
    });

    const aiData = await aiResponse.json();
    const content = aiData.choices?.[0]?.message?.content || "";

    let structuredData = null;

    if (type === "apresentacao") {
      structuredData = {
        slides: content.split("\n\n").map(block => ({
          title: block.split("\n")[0],
          bullets: block.split("\n").slice(1)
        }))
      };
    }

    if (type === "relatorio") {
      structuredData = {
        sections: content.split("\n\n").map(section => ({
          title: section.split("\n")[0],
          content: section.split("\n").slice(1).join("\n")
        }))
      };
    }

    const { data, error } = await supabase
      .from("conversations")
      .insert({
        user_prompt: userPrompt,
        ai_response: content,
        presentation_data: structuredData,
        presentation_type: type
      })
      .select()
      .single();

    if (error) throw error;

    const link = `https://zwdvvgcedceqhnnnhkmb.supabase.co/functions/v1/n8n-ai-processor`;

    return Response.json({
      conversationId: data.id,
      presentationType: type,
      conversationLink: link
    });

  } catch (err) {
    return new Response(err.message, { status: 500 });
  }
});