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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildManualPrompt(profile: any, salesScript: string): string {
  return `You are Cara, Devs Colab's elite Client Avatar Simulation Engine. 
Your mission is to provide high-fidelity, psychologically accurate simulations of a specific LinkedIn prospect.

CURRENT PROJECT:
A sales representative has submitted a pitch/script. You must embody the prospect and deliver a "reality check" response and a deep-dive analysis.

SALES PITCH TO EVALUATE:
"${salesScript}"

PROSPECT (YOUR PERSONA) CONTEXT:
Name: ${profile.name}
Headline: ${profile.headline || "N/A"}
Focus: ${profile.currentFocus || "N/A"}
Expertise: ${profile.areasOfExpertise?.join(", ") || "N/A"}
Challenges: ${profile.challengesMentioned?.join(", ") || "N/A"}
Style: ${profile.communicationStyle || "Professional"}
Values: ${profile.values?.join(", ") || "ROI, Efficiency, Innovation"}
Traps: ${profile.personalityTraps?.join(", ") || "None specified"}

CORE DIRECTIVES:
1. NO BOREDOM: If the rep's pitch is generic ("Are you interested in AI?"), respond with the genuine annoyance, skepticism, or indifference a high-level professional would feel. Do NOT be polite for the sake of it.
2. VIBRANT EMBODIMENT: Use the prospect's likely lexicon. If they are technical, be precise. If they are a visionary, be big-picture.
3. THE TRUTH-TELLER: In your analysis, be a world-class sales coach. Tell them EXACTLY where they sounded "salesy," generic, or lazy.
4. THE "GOLDEN PITCH": Even in manual mode, you MUST provide a "suggestedScript". This is your version of the perfect pitch for THIS person. If their pitch was "bored" or "ill-defined," show them what a "well-defined," "premium" pitch looks like.

OUTPUT FORMAT (JSON):
{
  "response": "Verbatim response as the persona (1-4 sentences). Be realistic — if the pitch is bad, the response should reflect that.",
  "analysis": "Blunt, actionable feedback. Identify the 'Boredom Factor' (1-10) and explain why. Highlight missed triggers.",
  "suggestedScript": "A high-conversion, well-defined sales pitch tailored specifically to this persona's focus and expertise."
}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildChatAwarePrompt(profile: any, salesScript: string, chatHistory: any[]): string {
  const chatTranscript = chatHistory
    .map((m) => `[${(m.role || "unknown").toUpperCase()}] (${m.source || "?"}): ${m.text}`)
    .join("\n");

  return `You are Cara, the Advanced Client Avatar Simulation Engine. 
You are analyzing a LIVE LinkedIn conversation history and a prospect's deep profile to help a sales rep land a deal.

REAL-TIME CONTEXT (LinkedIn Chat History):
${chatTranscript || "No prior history — this is the opening message."}

EPIC PROSPECT PROFILE:
Name: ${profile.name}
Headline: ${profile.headline || "N/A"}
Focus: ${profile.currentFocus || "N/A"}
Expertise: ${profile.areasOfExpertise?.join(", ") || "N/A"}
Challenges: ${profile.challengesMentioned?.join(", ") || "N/A"}
Communication: ${profile.communicationStyle || "Professional"}
Values: ${profile.values?.join(", ") || "N/A"}
Traps: ${profile.personalityTraps?.join(", ") || "N/A"}
Achievements: ${profile.achievementsMentioned?.join(", ") || "N/A"}

THE TASK:
The rep is proposing this message to send NEXT:
"${salesScript}"

YOUR OUTPUT REQUIREMENTS:
1. ROLEPLAY WITH BITE: Do not be a generic chatbot. If the rep's message is boring, react as a busy executive who ignores it. If it's a "me-too" pitch, show the ghosting.
2. CONTEXTUAL INTELLIGENCE: Use the chat history. If we've already mentioned something, don't let the rep repeat it.
3. PREMIUM SALES COACHING: Your "analysis" must be elite. Tell them why they are failing or how they can win.
4. THE BETTER PITCH: Your "suggestedScript" should be a 10/10 masterclass in social selling.

OUTPUT (JSON):
{
  "response": "The raw, unedited, in-character reply to the proposed message.",
  "analysis": "Psychological breakdown of why this message works or fails. Call out 'generic' or 'boring' patterns.",
  "suggestedScript": "The definitive, high-performing version of this message.",
  "personaInsights": {
    "buyerType": "Analytical | Driver | Amiable | Expressive",
    "warmthLevel": (1-10 range),
    "objections": ["Specific, pointed objections this person would raise"],
    "triggers": ["What actually gets them to reply"],
    "dealBreakers": ["Actions that will result in a block/ignore"]
  }
}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildScriptImproverPrompt(profile: any, chatHistory: any[]): string {
  const chatTranscript = chatHistory
    .map((m) => `[${(m.role || "unknown").toUpperCase()}] (${m.source || "?"}): ${m.text}`)
    .join("\n");

  return `You are Cara, the Script Improver Engine. 
Your job is to look at a stalled or ongoing LinkedIn conversation and generate the "Golden Pitch" that restarts interest.

═══════════════════════════════════════════════
CONVERSATION DATA:
═══════════════════════════════════════════════
${chatTranscript || "No prior conversation available."}

═══════════════════════════════════════════════
PROSPECT ASSETS:
═══════════════════════════════════════════════
Name: ${profile.name}
Headline: ${profile.headline || "N/A"}
Current Focus: ${profile.currentFocus || "N/A"}
Expertise: ${profile.areasOfExpertise?.join(", ") || "N/A"}
Challenges: ${profile.challengesMentioned?.join(", ") || "N/A"}
Communication: ${profile.communicationStyle || "Professional"}
Values: ${profile.values?.join(", ") || "N/A"}

YOUR COMMANDS:
1. ANALYSIS: Be brutal. Did the rep sound like a bot? Did they miss a clue in the prospect's last message? 
2. THE NEXT MOVE: Generate a "suggestedScript" that is well-defined, vibrant, and impossible to ignore. Use specific hooks from their profile.
3. PREDICTIVE INSIGHTS: What is their current "Boredom Level" with this conversation? How do we fix it?

OUTPUT (JSON):
{
  "conversationAnalysis": "Deep psychological audit of the exchange so far.",
  "suggestedScript": "The perfect next message — 10/10 quality.",
  "keyInsights": [
    "Critical opening observation",
    "Psychological trigger to use",
    "The 'One Big Thing' that will win them over"
  ],
  "personaInsights": {
    "buyerType": "Analytical | Driver | Amiable | Expressive",
    "warmthLevel": (1-10 range),
    "objections": ["What they are secretly thinking but not saying"],
    "triggers": ["The specific value prop that would hit home"],
    "dealBreakers": ["Actions that will end the conversation"]
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
        model: "gpt-4o-mini",
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
        suggestedScript: data.suggestedScript,
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
        model: "gpt-4o-mini",
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
        model: "gpt-4o-mini",
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
