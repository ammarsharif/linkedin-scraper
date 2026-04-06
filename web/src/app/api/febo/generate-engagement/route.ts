import { NextRequest, NextResponse } from "next/server";
import { getDatabase } from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import OpenAI from "openai";
import { getLinkedInCookies } from "@/lib/linkedin";

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

    const { coraContentId, facebookPostContent, personaId, engagementTypes } = await req.json();

    if (!facebookPostContent?.trim()) {
      return NextResponse.json(
        { error: "facebookPostContent is required." },
        { status: 400 }
      );
    }
    if (!Array.isArray(engagementTypes) || engagementTypes.length === 0) {
      return NextResponse.json(
        { error: "At least one engagement type must be selected." },
        { status: 400 }
      );
    }

    const validTypes = ["comment_reply", "group_post", "dm_outreach"];
    for (const t of engagementTypes) {
      if (!validTypes.includes(t)) {
        return NextResponse.json({ error: `Invalid engagement type: ${t}` }, { status: 400 });
      }
    }

    let personaBlock = "";
    if (personaId) {
      const db = await getDatabase();
      const persona = await db
        .collection("cara_personas")
        .findOne({ _id: new ObjectId(personaId) });

      if (persona) {
        const a = persona.analysis || {};
        const ps = a.personalityProfile || {};
        const cs = a.communicationStyle || {};
        const bp = a.buyerProfile || {};

        personaBlock = `\nAUDIENCE PERSONA (match this tone and style):
Name: ${persona.name}
Tone: ${ps.tone || "N/A"}
Buyer Type: ${bp.buyerType || "N/A"}
Values: ${(ps.values || []).join(", ") || "N/A"}
Language Style: ${(cs.shorthand || []).join(", ") || "N/A"}
Linguistic Patterns: ${(cs.linguisticPatterns || []).join(", ") || "N/A"}
Motivations: ${(ps.motivations || []).join(", ") || "N/A"}`;
      }
    }

    const engagementInstructions: Record<string, string> = {
      comment_reply: `Comment Reply Templates: Write 5 varied reply templates for people who comment on this Facebook post.
  Each reply should:
  - Acknowledge their comment warmly
  - Add value or spark further conversation
  - Be 1-3 sentences, natural and human
  - Vary in tone (enthusiastic, thoughtful, curious, grateful, conversational)
  Label them Reply 1 through Reply 5.`,

      group_post: `Facebook Group Post Adaptation: Rewrite this post for a Facebook group context.
  - Adjust the opening hook to feel like a group member sharing something valuable, not a brand broadcasting
  - Remove any overly promotional language
  - Add a discussion question at the end to drive comments
  - Keep it 100-200 words
  - Should feel like it comes from a real person in the group`,

      dm_outreach: `Facebook DM Outreach: Write a short DM to send to people who engaged (liked/commented) on this post.
  Include:
  - Opening: Reference that you saw they engaged with the post (warm, not creepy)
  - Value add: One sentence connecting their interest to something helpful you can offer
  - Soft CTA: Low-pressure ask (a question, not a pitch)
  - Keep it under 5 sentences, conversational and genuine`,
    };

    const selectedInstructions = engagementTypes
      .map((t: string) => `\n--- ${t.toUpperCase()} ---\n${engagementInstructions[t]}`)
      .join("\n\n");

    const resultKeys = engagementTypes.map((t: string) => `"${t}": "..."`).join(",\n  ");

    const systemPrompt = `You are Febo, a Facebook Engagement specialist.

Your job is to generate engagement content based on the Facebook post below. All content should feel human, authentic, and tailored to the audience — never generic or corporate.

FACEBOOK POST:
"""
${facebookPostContent.trim()}
"""
${personaBlock}

ENGAGEMENT CONTENT TO GENERATE:
${selectedInstructions}

RULES:
1. Write in a natural, human voice.
2. Reference the actual post content where relevant.
3. Never sound like a bot or template.
4. Use \\n for line breaks within content. Put a blank line between each section.
5. For section labels (e.g. "Reply 1", "Reply 2", subject lines), write them in UPPERCASE on their own line followed by a colon — example: "REPLY 1:". Do NOT use **, __, ##, or any markdown.
${personaId ? "6. Match the tone and language style of the persona described above." : ""}

Return ONLY valid JSON with exactly these keys (no markdown, no extra keys):
{
  ${resultKeys}
}`;

    const openai = getOpenAIClient();
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: systemPrompt }],
      response_format: { type: "json_object" },
      temperature: 0.8,
      max_tokens: 2000,
    });

    const raw = completion.choices[0]?.message?.content || "{}";
    const results = JSON.parse(raw);

    return NextResponse.json({
      success: true,
      coraContentId: coraContentId || null,
      personaId: personaId || null,
      results,
    });
  } catch (err) {
    console.error("[febo/generate-engagement] POST error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
