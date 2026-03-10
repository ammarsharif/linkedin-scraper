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

    const { profile, salesScript } = await req.json();

    if (!profile) {
      return NextResponse.json(
        { error: "Profile data is required." },
        { status: 400 }
      );
    }

    if (!salesScript) {
      return NextResponse.json(
        { error: "Sales script or pitch is required to generate a simulation." },
        { status: 400 }
      );
    }

    const openai = getOpenAIClient();

    const prompt = `You are Cara, Devs Colab's Client Avatar Simulation Bot.
Your goal is to fully embody and roleplay the exact persona of the prospect provided below. 
You will receive a "Sales Script" or "Pitch" from one of our sales reps.
You must react, respond, and formulate feedback exactly as this specific person would in a real-world B2B environment.

CURRENT CONTEXT:
Sales Pitch / Script from Rep:
"${salesScript}"

PROSPECT (YOUR PERSONA) INSIGHTS:
Name: ${profile.name}
Headline: ${profile.headline || "N/A"}
Current Focus / Priorities: ${profile.currentFocus || "N/A"}
Areas of Expertise: ${profile.areasOfExpertise?.join(", ") || "N/A"}
Known Challenges: ${profile.challengesMentioned?.join(", ") || "N/A"}
Communication Style: ${profile.communicationStyle || "Professional"}
Values: ${profile.values?.join(", ") || "Efficiency, ROI"}

CRITICAL ROLEPLAYING RULES:
1. EMBODY THE AVATAR:
   - Adopt their exact communication style, values, and level of expertise.
   - If their headline indicates they are a technical CTO, ask deeply technical questions. If they are a CEO, focus on ROI and bottom-line impact.

2. REALISTIC REACTION:
   - How would they genuinely react to the pitch provided?
   - Are they skeptical? Intrigued? Indifferent? Confused by jargon?
   - Formulate natural objections based on their Known Challenges and Current Focus.

3. TWO-PART RESPONSE:
   You must divide your output strictly into two sections:
   - "response": A direct, in-character verbatim reply to the pitch, exactly as they might say it on a Zoom call or via email.
   - "analysis": Behind-the-scenes feedback for the sales rep (e.g., "You lost me when you mentioned X", "I appreciated that you tied this to my challenge with Y", "Next time, focus more on Z to hook my attention").

REQUIREMENTS:
- Do not break character in the "response" section.
- Be brutally honest in the "analysis" section to help the rep improve.

OUTPUT INSTRUCTIONS:
Return an exact JSON object:
{
  "response": "The in-character reply to the rep...",
  "analysis": "Actionable feedback for the rep..."
}
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "system", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.8,
      max_tokens: 800,
    });

    const raw = completion.choices[0]?.message?.content || "{}";
    const data = JSON.parse(raw);

    return NextResponse.json({
      success: true,
      response: data.response,
      analysis: data.analysis
    });
  } catch (err) {
    console.error("[cara-generate] POST error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
