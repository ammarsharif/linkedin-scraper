import { NextRequest, NextResponse } from "next/server";
import { getDatabase } from "@/lib/mongodb";
import { getLinkedInCookies } from "@/lib/linkedin";
import { ObjectId } from "mongodb";
import OpenAI from "openai";

export const maxDuration = 120;

function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY environment variable is not set.");
  return new OpenAI({ apiKey });
}

export async function POST(req: NextRequest) {
  try {
    const cookieString = await getLinkedInCookies(req);
    if (!cookieString) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    const { personaId, originalPost, platforms } = await req.json();

    if (!personaId) {
      return NextResponse.json({ error: "personaId is required." }, { status: 400 });
    }
    if (!originalPost?.trim()) {
      return NextResponse.json({ error: "originalPost is required." }, { status: 400 });
    }
    if (!Array.isArray(platforms) || platforms.length === 0) {
      return NextResponse.json({ error: "At least one platform must be selected." }, { status: 400 });
    }

    const db = await getDatabase();
    const persona = await db
      .collection("cara_personas")
      .findOne({ _id: new ObjectId(personaId) });

    if (!persona) {
      return NextResponse.json({ error: "Persona not found." }, { status: 404 });
    }

    const a = persona.analysis || {};
    const ps = a.personalityProfile || {};
    const cs = a.communicationStyle || {};
    const pi = a.professionalInsights || {};
    const bp = a.buyerProfile || {};
    const sa = a.salesApproach || {};

    const platformInstructions: Record<string, string> = {
      facebook: "Facebook Post: Conversational storytelling tone, 150-300 words. Open with a relatable hook, tell a short story or insight, end with a question or soft CTA.",
      twitter: "Twitter/X Thread: 3-5 tweets. Tweet 1 is a punchy hook. Each tweet is under 280 characters. Number each tweet (1/, 2/, etc.). Last tweet has the CTA.",
      instagram: "Instagram Caption: 100-150 words with relevant emojis woven in naturally. End with exactly 10 relevant hashtags on a new line.",
      email: "Email Newsletter: Start with 'Subject: ...' on its own line, then a blank line, then the body (200-300 words). Personal, warm tone, clear CTA at the end.",
    };

    const selectedInstructions = (platforms as string[])
      .map((p: string) => `- ${platformInstructions[p] || p}`)
      .join("\n");

    const resultKeys = (platforms as string[]).map((p: string) => `"${p}": "..."`).join(",\n  ");

    const systemPrompt = `You are Cora, an elite Content Repurposing Bot.

Your job is to repurpose a LinkedIn post into platform-specific content written in a tone and language that resonates with the buyer persona below. Speak TO this type of buyer — address their pain points, use their language, reflect their values.

BUYER PERSONA:
Name: ${persona.name}
Role: ${pi.currentRole || "N/A"}
Tone: ${ps.tone || "N/A"}
Buyer Type: ${bp.buyerType || "N/A"}
Motivations: ${(ps.motivations || []).join(", ") || "N/A"}
Pain Points / Challenges: ${(pi.challenges || []).join(", ") || "N/A"}
Language Style / Shorthand: ${(cs.shorthand || []).join(", ") || "N/A"}
Linguistic Patterns: ${(cs.linguisticPatterns || []).join(", ") || "N/A"}
Key Messages That Resonate: ${(sa.keyMessages || []).join(", ") || "N/A"}
Executive Summary: ${a.executiveSummary || "N/A"}

ORIGINAL LINKEDIN POST:
"""
${originalPost.trim()}
"""

PLATFORM REQUIREMENTS:
${selectedInstructions}

INSTRUCTIONS:
1. Adapt the core message of the post to speak directly to this persona's world.
2. Use language, phrasing, and examples that match their communication style.
3. Do not add generic corporate filler. Keep it human and insightful.
4. Preserve the original post's core value and insight.

Return ONLY valid JSON in exactly this format (no markdown, no extra keys):
{
  ${resultKeys}
}`;

    const openai = getOpenAIClient();
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: systemPrompt }],
      response_format: { type: "json_object" },
      temperature: 0.75,
      max_tokens: 2000,
    });

    const raw = completion.choices[0]?.message?.content || "{}";
    const generated = JSON.parse(raw);

    return NextResponse.json({
      success: true,
      personaId,
      personaName: persona.name,
      originalPost,
      results: generated,
    });
  } catch (err) {
    console.error("[cora/generate] POST error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
