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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildManualPrompt(profile: any, salesScript: string): string {
  return `You are Cara, Devs Colab's Client Avatar Simulation Bot.
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
}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildChatAwarePrompt(profile: any, salesScript: string, chatHistory: any[]): string {
  const chatTranscript = chatHistory
    .map((m) => `[${(m.role || "unknown").toUpperCase()}] (${m.source || "?"}): ${m.text}`)
    .join("\n");

  return `You are Cara, Devs Colab's Client Avatar Simulation Bot.
You now have access to REAL conversation history between our sales team (Cindy bot / human rep) and this prospect on LinkedIn.
Use this context to deeply understand the prospect's mindset, objections, engagement level, and what has already been discussed.

═══════════════════════════════════════════════
REAL CONVERSATION HISTORY (from LinkedIn):
═══════════════════════════════════════════════
${chatTranscript || "No prior conversation history available."}

═══════════════════════════════════════════════
PROSPECT PROFILE:
═══════════════════════════════════════════════
Name: ${profile.name}
Headline: ${profile.headline || "N/A"}
Current Focus / Priorities: ${profile.currentFocus || "N/A"}
Areas of Expertise: ${profile.areasOfExpertise?.join(", ") || "N/A"}
Known Challenges: ${profile.challengesMentioned?.join(", ") || "N/A"}
Communication Style: ${profile.communicationStyle || "Professional"}
Values: ${profile.values?.join(", ") || "Efficiency, ROI"}
Achievements: ${profile.achievementsMentioned?.join(", ") || "N/A"}

═══════════════════════════════════════════════
PROPOSED NEXT MESSAGE TO TEST:
═══════════════════════════════════════════════
"${salesScript}"

═══════════════════════════════════════════════
YOUR MISSION:
═══════════════════════════════════════════════
1. Fully embody this prospect's persona based on BOTH their profile AND the conversation history.
2. Consider what has already been said — don't ignore prior exchanges.
3. React to the proposed next message naturally, as this person would in real life.
4. Provide brutally honest analysis + an improved version of the message.

OUTPUT (strict JSON):
{
  "response": "Your in-character reply to the proposed message, as this person would actually say it...",
  "analysis": "Detailed feedback: what worked, what fell flat, what felt generic vs. personalized, and specific suggestions...",
  "suggestedScript": "A rewritten, improved version of the proposed message that would land better with THIS specific person based on everything you know...",
  "personaInsights": {
    "buyerType": "One of: Analytical, Driver, Amiable, Expressive",
    "warmthLevel": 7,
    "objections": ["likely objection 1", "likely objection 2"],
    "triggers": ["what motivates them"],
    "dealBreakers": ["what would kill the deal"]
  }
}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildScriptImproverPrompt(profile: any, chatHistory: any[]): string {
  const chatTranscript = chatHistory
    .map((m) => `[${(m.role || "unknown").toUpperCase()}] (${m.source || "?"}): ${m.text}`)
    .join("\n");

  return `You are Cara, Devs Colab's Client Avatar Simulation Bot — now in Script Improvement mode.
Analyze the full conversation history and the prospect's profile, then generate an optimized sales script that our team should use for the NEXT follow-up message.

═══════════════════════════════════════════════
CONVERSATION HISTORY:
═══════════════════════════════════════════════
${chatTranscript || "No prior conversation available."}

═══════════════════════════════════════════════
PROSPECT PROFILE:
═══════════════════════════════════════════════
Name: ${profile.name}
Headline: ${profile.headline || "N/A"}
Current Focus: ${profile.currentFocus || "N/A"}
Expertise: ${profile.areasOfExpertise?.join(", ") || "N/A"}
Challenges: ${profile.challengesMentioned?.join(", ") || "N/A"}
Communication Style: ${profile.communicationStyle || "Professional"}
Values: ${profile.values?.join(", ") || "N/A"}

═══════════════════════════════════════════════
YOUR MISSION:
═══════════════════════════════════════════════
1. Analyze what has been discussed so far.
2. Identify missed opportunities, weak points in our approach, and untapped angles.
3. Generate the ideal next message that leverages everything we know about this person.

OUTPUT (strict JSON):
{
  "conversationAnalysis": "Summary of the conversation so far: what went well, what went poorly, where the conversation is heading...",
  "suggestedScript": "The ideal next follow-up message to send to this prospect...",
  "keyInsights": [
    "Insight 1 about the prospect's state of mind",
    "Insight 2 about opportunities we missed",
    "Insight 3 about the approach we should take"
  ],
  "personaInsights": {
    "buyerType": "One of: Analytical, Driver, Amiable, Expressive",
    "warmthLevel": 7,
    "objections": ["likely objection 1"],
    "triggers": ["what motivates them"],
    "dealBreakers": ["what would kill the deal"]
  }
}`;
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

    const { profile, salesScript, chatHistory, mode } = await req.json();

    if (!profile) {
      return NextResponse.json(
        { error: "Profile data is required." },
        { status: 400 }
      );
    }

    const resolvedMode = mode || "manual";
    const openai = getOpenAIClient();

    // ── Mode: manual (original behavior) ──
    if (resolvedMode === "manual") {
      if (!salesScript) {
        return NextResponse.json(
          { error: "Sales script or pitch is required for manual mode." },
          { status: 400 }
        );
      }

      const prompt = buildManualPrompt(profile, salesScript);
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
        mode: "manual",
        response: data.response,
        analysis: data.analysis,
      });
    }

    // ── Mode: chat-aware (new) ──
    if (resolvedMode === "chat-aware") {
      if (!salesScript) {
        return NextResponse.json(
          { error: "A proposed message is required for chat-aware mode." },
          { status: 400 }
        );
      }

      const prompt = buildChatAwarePrompt(profile, salesScript, chatHistory || []);
      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "system", content: prompt }],
        response_format: { type: "json_object" },
        temperature: 0.8,
        max_tokens: 1200,
      });

      const raw = completion.choices[0]?.message?.content || "{}";
      const data = JSON.parse(raw);

      return NextResponse.json({
        success: true,
        mode: "chat-aware",
        response: data.response,
        analysis: data.analysis,
        suggestedScript: data.suggestedScript,
        personaInsights: data.personaInsights,
      });
    }

    // ── Mode: script-improver (new) ──
    if (resolvedMode === "script-improver") {
      const prompt = buildScriptImproverPrompt(profile, chatHistory || []);
      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "system", content: prompt }],
        response_format: { type: "json_object" },
        temperature: 0.8,
        max_tokens: 1200,
      });

      const raw = completion.choices[0]?.message?.content || "{}";
      const data = JSON.parse(raw);

      return NextResponse.json({
        success: true,
        mode: "script-improver",
        conversationAnalysis: data.conversationAnalysis,
        suggestedScript: data.suggestedScript,
        keyInsights: data.keyInsights,
        personaInsights: data.personaInsights,
      });
    }

    return NextResponse.json(
      { error: `Invalid mode: ${resolvedMode}. Use 'manual', 'chat-aware', or 'script-improver'.` },
      { status: 400 }
    );
  } catch (err) {
    console.error("[cara-generate] POST error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
