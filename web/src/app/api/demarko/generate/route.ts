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

    const { profile } = await req.json();

    if (!profile) {
      return NextResponse.json(
        { error: "Profile data is required." },
        { status: 400 }
      );
    }

    const openai = getOpenAIClient();

    const prompt = `You are Demarko, an expert at writing highly personalized, professional cold outreach emails.
Your goal is to write a highly tailored outreach email based strictly on the prospect's profile insights and data. 

CRITICAL WRITING RULES:
- The email must be concise (around 3 to 4 short paragraphs).
- Naturally conversational, professional, and devoid of cheesy sales jargon.
- Focus on common ground or their recent challenges/achievements.
- ALWAYS use complete, grammatically correct sentences. Never end with a sentence fragment.
- DO NOT include ANY closing signature, ending wishes, or "Best regards" style sign-offs. 
- DO NOT use generic placeholders like "[Your Name]". 
- The email should end abruptly after the last call-to-action or closing sentence (e.g., "Would you be open to a brief chat next week?"). I will append the sender's real signature later.

Profile Insights:
Name: ${profile.name}
Headline: ${profile.headline || 'N/A'}
Executive Summary: ${profile.executiveSummary || 'N/A'}
Current Focus: ${profile.currentFocus || 'N/A'}
Areas of Expertise: ${profile.areasOfExpertise?.join(', ') || 'N/A'}
Recent Achievements: ${profile.achievementsMentioned?.join(', ') || 'N/A'}
Recent Challenges: ${profile.challengesMentioned?.join(', ') || 'N/A'}

Respond exactly in this JSON format:
{
  "subject": "Compelling subject line",
  "body": "The email body text, using \\n\\n for paragraph breaks."
}
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.7,
      max_tokens: 600,
    });

    const raw = completion.choices[0]?.message?.content || "{}";
    const data = JSON.parse(raw);

    return NextResponse.json({
      success: true,
      subject: data.subject,
      body: data.body,
    });
  } catch (err) {
    console.error("[demarko-generate] POST error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
