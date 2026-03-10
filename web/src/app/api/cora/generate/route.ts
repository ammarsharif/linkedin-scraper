import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

export const maxDuration = 60;

function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY environment variable is not set.");
  }
  return new OpenAI({ apiKey });
}

export async function POST(req: NextRequest) {
  try {
    const cookieString = req.cookies.get("li_session")?.value;
    if (!cookieString) {
      return NextResponse.json(
        { error: "Not authenticated." },
        { status: 401 }
      );
    }

    const { profile, sourceContent, format } = await req.json();

    if (!profile && !sourceContent) {
      return NextResponse.json(
        { error: "Profile data or source content is required." },
        { status: 400 }
      );
    }

    if (!format) {
      return NextResponse.json(
        { error: "A target format is required (e.g., 'Twitter Thread')." },
        { status: 400 }
      );
    }

    const openai = getOpenAIClient();

    let contextBlock = "SOURCE MATERIAL TO REPURPOSE:\n";
    if (sourceContent) {
      contextBlock += `LinkedIn Post / Raw Content:\n"${sourceContent}"\n\n`;
    }
    if (profile) {
      contextBlock += `Author Profile Context:\nName: ${profile.name}\nHeadline: ${profile.headline || "N/A"}\nExpertise: ${profile.areasOfExpertise?.join(", ") || "N/A"}\nFocus: ${profile.currentFocus || "N/A"}\n\n`;
    }

    const prompt = `You are Cora, Devs Colab's elite Content Repurposing Bot.
Your goal is to take the provided LinkedIn content or profile context and magically repurpose it into a highly engaging piece of content tailored specifically for the requested platform/format.

TARGET FORMAT: ${format}

${contextBlock}

INSTRUCTIONS:
1. Emulate the best practices of the target format (e.g., if Twitter Thread, use short punchy hooks, line breaks, and emojis; if Newsletter, use a welcoming intro, subheadings, and a clear call to action).
2. Retain the core value and voice of the original author.
3. Don't add fluffy or generic corporate jargon. Ensure it sounds human, insightful, and attention-grabbing.
4. Output should include a "copy" which is the actual generated content, and an "explanation" briefly explaining why this framing works well for the target format.

Return exactly this JSON format:
{
  "content": "The full repurposed content here... (Use \\n for line breaks)",
  "explanation": "Why this angle works..."
}`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "system", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.7,
      max_tokens: 1200,
    });

    const raw = completion.choices[0]?.message?.content || "{}";
    const data = JSON.parse(raw);

    return NextResponse.json({
      success: true,
      content: data.content,
      explanation: data.explanation
    });
  } catch (err) {
    console.error("[cora-generate] POST error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
