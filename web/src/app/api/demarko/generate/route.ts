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

    const prompt = `You are Demarko, an expert at writing high-conversion, hyper-personalized professional cold outreach emails from Devs Colab.
Your goal is to write a tailored outreach email based strictly on the prospect's profile insights.

CRITICAL WRITING RULES:
1. SPECIFIC OPENER: Never use generic flattery (e.g., "I came across your impressive work"). Start with a concrete observation.
   - Good: "I noticed SparkoSol recently deployed AI Agents that cut costs for clients, which is an impressive feat."
   - Good: "Saw your latest work on [Project Name] and how you handled [Specific Detail]."

2. NO JARGON: Avoid vague corporate speak or industry "trends" (e.g., "AI integration resonates with tech trends"). Be direct about why you're reaching out.

3. CONCRETE VALUE PROP: Include one line that hints at a tangible outcome or overlap.
   - Example: "At Devs Colab, we help AI-focused teams [Specific Outcome] and I think there's a real overlap with what you're building at ${profile.name.split(' ')[0]}."

4. EVIDENCE-BASED CHALLENGES: Do NOT assume their challenges. Only mention a challenge if it's explicitly stated in their profile/posts (e.g., "You mentioned the difficulty of scaling [X]"). Otherwise, focus on their wins.

5. SHARP CALL TO ACTION (CTA): Make the request easy to navigate. Instead of "a brief chat next week", use specific timeframes.
   - Good: "Would Tuesday or Wednesday work for a 15-minute call?"

6. STRUCTURE & TONE:
   - Concise (3-4 short paragraphs).
   - Naturally conversational and zero sales jargon.
   - ALWAYS use complete, grammatically correct sentences.
   - NO closing signature or ending wishes (e.g., do not use "Best," or "Regards").
   - The email must end exactly after the CTA.
   - DO NOT use the em dash (—) anywhere in the email.

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
  "subject": "Hyper-personalized, intriguing subject line",
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
