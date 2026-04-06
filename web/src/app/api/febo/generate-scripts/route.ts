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

    const { personaId, manualInput, scriptTypes } = await req.json();

    if (!personaId && !manualInput) {
      return NextResponse.json(
        { error: "Either personaId or manualInput is required." },
        { status: 400 }
      );
    }
    if (!Array.isArray(scriptTypes) || scriptTypes.length === 0) {
      return NextResponse.json(
        { error: "At least one script type must be selected." },
        { status: 400 }
      );
    }

    const validTypes = ["sales_call", "dm_chat", "demo", "objection_handling"];
    for (const t of scriptTypes) {
      if (!validTypes.includes(t)) {
        return NextResponse.json({ error: `Invalid script type: ${t}` }, { status: 400 });
      }
    }

    let contextBlock = "";

    if (personaId) {
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

      contextBlock = `BUYER PERSONA:
Name: ${persona.name}
Role: ${pi.currentRole || "N/A"}
Tone: ${ps.tone || "N/A"}
Buyer Type: ${bp.buyerType || "N/A"}
Pain Points / Challenges: ${(pi.challenges || []).join(", ") || "N/A"}
Motivations: ${(ps.motivations || []).join(", ") || "N/A"}
Likely Objections: ${(bp.likelyObjections || []).join(", ") || "N/A"}
Buying Triggers: ${(bp.buyingTriggers || []).join(", ") || "N/A"}
Language Style: ${(cs.shorthand || []).join(", ") || "N/A"}
Linguistic Patterns: ${(cs.linguisticPatterns || []).join(", ") || "N/A"}
Key Messages That Resonate: ${(sa.keyMessages || []).join(", ") || "N/A"}
Opening Angles: ${(sa.openingAngles || []).join(", ") || "N/A"}
Do This: ${(sa.doThis || []).join(", ") || "N/A"}
Avoid This: ${(sa.avoidThis || []).join(", ") || "N/A"}
Executive Summary: ${a.executiveSummary || "N/A"}`;
    } else {
      contextBlock = `MANUAL INPUT:
Target Audience: ${manualInput.targetAudience || "N/A"}
Product / Service: ${manualInput.productService || "N/A"}
Main Pain Point: ${manualInput.mainPainPoint || "N/A"}
Key Objection to Handle: ${manualInput.keyObjection || "N/A"}`;
    }

    const scriptInstructions: Record<string, string> = {
      sales_call: `Sales Call Script: A complete phone/video call script with clearly labeled stages:
  - Opening (warm intro, build rapport)
  - Discovery Questions (5-7 targeted questions)
  - Pitch (tailored value proposition, 2-3 sentences)
  - Objection Handling (address the main objection with a word-for-word response)
  - Close (3 closing variations: soft, direct, urgency-based)
  Keep it natural and conversational. Include [PAUSE], [LISTEN], [REACT] cues where appropriate.`,

      dm_chat: `DM/Chat Script: Short conversational message sequences for LinkedIn or Instagram DMs.
  Include:
  - Connection Request Note (under 300 chars)
  - Opening DM after connecting (2-3 sentences, curiosity-driven)
  - Follow-up if no reply (3-5 days later)
  - Pitch message (after rapport is built, 4-6 sentences)
  - Gentle close / call-to-action
  Each message should be copy-paste ready.`,

      demo: `Demo Script: A structured product/service demo walkthrough.
  Include:
  - Pre-demo opener (confirm time, set agenda)
  - Problem confirmation (tie demo to their specific pain point)
  - Feature walkthrough (3-4 key features, each tied to a benefit)
  - "So what?" moment (emotional anchor after each feature)
  - Q&A transition
  - Post-demo next steps (clear CTA)
  Use stage labels for each section.`,

      objection_handling: `Objection Handling Script: A comprehensive list of the top 6-8 objections this prospect type would raise, each with:
  - The Objection (word-for-word how they'd say it)
  - Acknowledge (empathize, don't fight it)
  - Reframe (shift their perspective)
  - Response (2-4 sentences, confident and calm)
  - Transition back to the pitch
  Format each objection as a clearly labeled block.`,
    };

    const selectedInstructions = scriptTypes
      .map((t: string) => `\n--- ${t.toUpperCase()} ---\n${scriptInstructions[t]}`)
      .join("\n\n");

    const resultKeys = scriptTypes.map((t: string) => `"${t}": "..."`).join(",\n  ");

    const systemPrompt = `You are Febo, an elite Sales Script Generator.

Your job is to write human, conversational, ready-to-use sales scripts tailored to the context below. Scripts should NEVER sound robotic or templated — they should feel like something a real expert salesperson would say naturally.

${contextBlock}

SCRIPTS TO GENERATE:
${selectedInstructions}

RULES:
1. Write in first person (the salesperson's voice).
2. Use natural language — contractions, short sentences, real pauses.
3. Always reference the specific pain points and triggers from the context above.
4. Every script must include clearly labeled stage headers. Write the label in UPPERCASE on its own line followed by a colon — example: "OPENING:" then a blank line then the content. Do NOT use any markdown syntax like **, __, ##, or *.
5. Use \\n for line breaks within content. Put a blank line between each stage section.

Return ONLY valid JSON with exactly these keys (no markdown, no extra keys):
{
  ${resultKeys}
}`;

    const openai = getOpenAIClient();
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: systemPrompt }],
      response_format: { type: "json_object" },
      temperature: 0.75,
      max_tokens: 3000,
    });

    const raw = completion.choices[0]?.message?.content || "{}";
    const results = JSON.parse(raw);

    return NextResponse.json({
      success: true,
      personaId: personaId || null,
      results,
    });
  } catch (err) {
    console.error("[febo/generate-scripts] POST error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
