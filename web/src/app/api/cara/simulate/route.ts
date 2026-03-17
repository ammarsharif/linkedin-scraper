import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { getDatabase } from "@/lib/mongodb";

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
function buildSimulationPrompt(persona: any, conversationHistory: any[]): string {
  const analysis = persona.analysis || {};
  const personality = analysis.personalityProfile || {};
  const professional = analysis.professionalInsights || {};
  const buyer = analysis.buyerProfile || {};
  const simulation = analysis.simulationGuidelines || {};
  const quotes = analysis.quotableContent || {};

  // Build conversation context
  const historyText = conversationHistory
    .map(
      (m) =>
        `[${m.role === "user" ? "SALES REP" : persona.name.toUpperCase()}]: ${m.content}`,
    )
    .join("\n");

  return `You are now FULLY embodying the persona of ${persona.name}.
You ARE ${persona.name}. You are not an AI assistant. You are this real person.

═══════════════════════════════════════════════
YOUR IDENTITY:
═══════════════════════════════════════════════
Name: ${persona.name}
Title: ${persona.headline || "Professional"}
Location: ${persona.location || "Not specified"}
About: ${persona.about || "Not available"}

═══════════════════════════════════════════════
YOUR PERSONALITY:
═══════════════════════════════════════════════
Communication Style: ${personality.communicationStyle || "Professional and direct"}
Tone: ${personality.tone || "Professional"}
Values: ${(personality.values || []).join(", ") || "Not specified"}
Motivations: ${(personality.motivations || []).join(", ") || "Not specified"}
Pet Peeves: ${(personality.petPeeves || []).join(", ") || "Not specified"}
Personality Traps: ${(personality.personalityTraps || []).join(", ") || "Not specified"}
Decision Making: ${personality.decisionMakingStyle || "Analytical"}

═══════════════════════════════════════════════
YOUR PROFESSIONAL CONTEXT:
═══════════════════════════════════════════════
Current Role: ${professional.currentRole || persona.headline || "Not specified"}
Current Focus: ${professional.currentFocus || "Not specified"}
Expertise: ${(professional.areasOfExpertise || []).join(", ") || "Not specified"}
Challenges You Face: ${(professional.challenges || []).join(", ") || "Not specified"}
Industry: ${(professional.industryExpertise || []).join(", ") || "Not specified"}
Career Path: ${professional.careerTrajectory || "Not specified"}

═══════════════════════════════════════════════
YOUR BUYER BEHAVIOR:
═══════════════════════════════════════════════
Buyer Type: ${buyer.buyerType || "Professional"}
Decision Factors: ${(buyer.decisionFactors || []).join(", ") || "ROI, value"}
Likely Objections: ${(buyer.likelyObjections || []).join(", ") || "Standard business objections"}
Buying Triggers: ${(buyer.buyingTriggers || []).join(", ") || "Clear value proposition"}
Deal Breakers: ${(buyer.dealBreakers || []).join(", ") || "Pushy sales, no proof"}
Trust Builders: ${(buyer.trustBuilders || []).join(", ") || "Case studies, references"}

═══════════════════════════════════════════════
HOW YOU COMMUNICATE:
═══════════════════════════════════════════════
Greeting Style: ${simulation.howTheyGreet || "Professional greeting"}
Response Length: ${simulation.responseLength || "Moderate"}
Question Style: ${simulation.questionStyle || "Direct and probing"}
Objection Style: ${simulation.objectionStyle || "Direct but professional"}
Engagement Signals: ${simulation.engagementSignals || "Asks follow-up questions when interested"}
Sample Phrases You Use: ${(simulation.samplePhrases || []).join(" | ") || "N/A"}
Topics You Love: ${(simulation.topicsTheyLove || []).join(", ") || "Industry topics"}
Topics to Avoid: ${(simulation.topicsToAvoid || []).join(", ") || "None specified"}

═══════════════════════════════════════════════
YOUR REAL QUOTES & OPINIONS:
═══════════════════════════════════════════════
Memorable Quotes: ${(quotes.memorableQuotes || []).join(" | ") || "N/A"}
Recurring Themes: ${(quotes.recurringThemes || []).join(", ") || "N/A"}
Strong Opinions: ${(quotes.strongOpinions || []).join(" | ") || "N/A"}

═══════════════════════════════════════════════
CONVERSATION SO FAR:
═══════════════════════════════════════════════
${historyText || "(This is the start of the conversation)"}

═══════════════════════════════════════════════
CRITICAL RULES FOR ROLEPLAYING:
═══════════════════════════════════════════════
1. You ARE ${persona.name}. Never break character. Never reveal you are an AI.
2. Respond EXACTLY as ${persona.name} would. Match their exact linguistic patterns, tone, and sentence structure based on their quotes.
3. Use their exact level of formality, specific vocabulary, and emotional baseline. If their quotes are brief and punchy, BE brief and punchy.
4. Reference your real expertise, challenges, and interests naturally.
5. If someone is pitching you something, react as a real buyer would:
   - Ask tough questions about relevance, ROI, and proof based on your actual buyer profile.
   - Raise your natural objections exactly as specified.
   - Show genuine interest ONLY if the pitch genuinely aligns with your needs.
   - Ignore or be brutally skeptical of generic pitches. Ghost them if appropriate by giving a very brief, disinterested reply.
6. Keep responses highly realistic to LinkedIn chat length (1-4 sentences). Do not sound like an AI assistant.
7. Use your characteristic phrases and speech patterns verbatim where possible.
8. Do NOT use emojis unless ${persona.name} commonly uses them.
9. Act human. Make conversational pivots if it fits your actual personality.

Respond ONLY with your in-character message. No JSON, no labels, no analysis. Just speak as ${persona.name}.`;
}

// ── POST: Send a message in the staging simulation ────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const cookieString = req.cookies.get("li_session")?.value;
    if (!cookieString) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    const { personaId, message, sessionId, conversationHistory } = await req.json();

    if (!personaId) {
      return NextResponse.json(
        { error: "personaId is required." },
        { status: 400 },
      );
    }

    if (!message || !message.trim()) {
      return NextResponse.json(
        { error: "Message is required." },
        { status: 400 },
      );
    }

    // Load the persona from DB
    const db = await getDatabase();
    const { ObjectId } = await import("mongodb");

    let query: Record<string, unknown>;
    try {
      query = { _id: new ObjectId(personaId) };
    } catch {
      query = { profileUrl: personaId };
    }

    const persona = await db.collection("cara_personas").findOne(query);
    if (!persona) {
      return NextResponse.json(
        { error: "Persona not found." },
        { status: 404 },
      );
    }

    // Build conversation history for context
    const history = conversationHistory || [];

    // Add the new user message to history for the prompt
    const fullHistory = [
      ...history,
      { role: "user", content: message },
    ];

    // Generate the simulation response
    const openai = getOpenAIClient();
    const systemPrompt = buildSimulationPrompt(persona, fullHistory);

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message },
      ],
      temperature: 0.85,
      max_tokens: 500,
    });

    const responseText =
      completion.choices[0]?.message?.content?.trim() ||
      "I appreciate you reaching out. Could you tell me more about what you have in mind?";

    // Save the simulation session to the persona record
    const currentSessionId = sessionId || `session_${Date.now()}`;
    const now = new Date().toISOString();

    const sessionMessage = {
      userMessage: message,
      personaResponse: responseText,
      timestamp: now,
    };

    // Update the persona with the simulation session
    await db.collection("cara_personas").updateOne(query, {
      $push: {
        [`simulationSessions`]: {
          $each: [],
        },
      } as never,
      $set: {
        lastSimulatedAt: now,
        lastUpdated: now,
      },
    });

    // Store the session message in a separate simulation_sessions collection for cleaner queries
    await db.collection("cara_simulation_sessions").updateOne(
      { sessionId: currentSessionId, personaId: personaId },
      {
        $push: {
          messages: {
            $each: [
              { role: "user", content: message, timestamp: now },
              { role: "persona", content: responseText, timestamp: now },
            ],
          },
        } as never,
        $set: {
          personaId,
          personaName: persona.name,
          lastActivity: now,
        },
        $setOnInsert: {
          createdAt: now,
        },
      },
      { upsert: true },
    );

    return NextResponse.json({
      success: true,
      response: responseText,
      sessionId: currentSessionId,
      personaName: persona.name,
      timestamp: now,
    });
  } catch (err) {
    console.error("[cara-simulate] POST error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ── GET: Fetch simulation session history ─────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const cookieString = req.cookies.get("li_session")?.value;
    if (!cookieString) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const personaId = searchParams.get("personaId");
    const sessionId = searchParams.get("sessionId");

    const db = await getDatabase();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const query: any = {};
    if (personaId) query.personaId = personaId;
    if (sessionId) query.sessionId = sessionId;

    const sessions = await db
      .collection("cara_simulation_sessions")
      .find(query)
      .sort({ lastActivity: -1 })
      .limit(20)
      .toArray();

    return NextResponse.json({
      success: true,
      sessions,
      total: sessions.length,
    });
  } catch (err) {
    console.error("[cara-simulate] GET error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
