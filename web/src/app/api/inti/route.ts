import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { getLinkedInCookies } from "@/lib/linkedin";

export const maxDuration = 120;

// ── Types ─────────────────────────────────────────────────────────────────────

type PitchTone =
  | "professional"
  | "friendly"
  | "bold"
  | "consultative"
  | "storytelling"
  | "direct";

interface ProspectData {
  name: string;
  headline: string;
  location?: string;
  executiveSummary?: string;
  areasOfExpertise?: string[];
  challengesMentioned?: string[];
  achievementsMentioned?: string[];
  toolsAndTechnologies?: string[];
  primaryTopics?: string[];
  values?: string[];
  communicationStyle?: string;
  currentFocus?: string;
  companyStage?: string;
  roleLevel?: string;
  quotableLines?: string[];
  commonGround?: string[];
  petPeeves?: string[];
  motivations?: string[];
  careerSummary?: string;
}

// ── OpenAI ────────────────────────────────────────────────────────────────────

function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY environment variable is not set.");
  return new OpenAI({ apiKey });
}

// ── Tone definitions ──────────────────────────────────────────────────────────

const TONE_DESCRIPTIONS: Record<PitchTone, string> = {
  professional:
    "Polished, formal, and business-oriented. Speak with authority and credibility. Use clean, precise language. Avoid casual phrases.",
  friendly:
    "Warm, approachable, and conversational. Use natural, human language. Build rapport first. Feel like you are a colleague, not a cold caller.",
  bold:
    "Confident, punchy, and direct. Lead with a strong statement or provocative insight. High energy. Do not hedge. Make them feel they would be missing out.",
  consultative:
    "Thoughtful and problem-solver mindset. Focus deeply on their pain points and challenges. Position as an advisor. Show deep understanding before pitching.",
  storytelling:
    "Use a mini narrative arc. Open with a relatable scenario or a brief story hook. Build tension and resolution. Emotional and engaging.",
  direct:
    "No fluff. One clear opening line stating who you are and what you offer. Short sentences. Maximum impact, minimum words.",
};

const TONE_LABELS: Record<PitchTone, string> = {
  professional: "Professional",
  friendly: "Friendly",
  bold: "Bold",
  consultative: "Consultative",
  storytelling: "Storytelling",
  direct: "Direct",
};

// ── Generate pitch ────────────────────────────────────────────────────────────

async function generatePitch(
  openai: OpenAI,
  prospect: ProspectData,
  tone: PitchTone,
  extraContext: string,
): Promise<object> {
  const toneInstruction = TONE_DESCRIPTIONS[tone];

  const systemPrompt = `You are Inti, an elite B2B sales pitch writer who specializes in sending highly personalized LinkedIn outreach messages to Ideal Customer Profiles (ICPs).

Your goal: Craft a pitch message that feels like it was written specifically for this ONE person — not a template. The message should make the prospect feel understood, not sold to.

PITCH TONE: ${TONE_LABELS[tone]}
Tone instruction: ${toneInstruction}

CRITICAL RULES:
- Do NOT use any emojis.
- No generic openers like "I hope this finds you well" or "I came across your profile".
- Reference specific, real things from their profile to show you actually read it.
- The pitch should feel human and natural, not robotic or templated.
- Do NOT mention your company name (leave a [YOUR COMPANY] placeholder where needed).
- Do NOT mention a specific services/product price.
- Leave [YOUR SERVICE/OFFER] placeholder if you need to describe what you offer (unless extra context provides it).
- Keep the core pitch message between 80-160 words. No longer.
- Use simple, clear English. Short sentences.
- End with a soft, low-pressure call-to-action (e.g. "Worth a 15-minute conversation?" or "Would love to hear your take on this.").

Respond with valid JSON only. No markdown, no code fences.

JSON Schema:
{
  "subject": "Optional: A compelling subject line if this were an email. 8-12 words max.",
  "pitchMessage": "The full pitch message ready to send. 80-160 words. No emojis.",
  "openingHook": "Just the opening sentence or two — the most critical part that grabs attention.",
  "whyItWorks": "2-3 sentences explaining WHY this pitch works for this specific person. What signals from their profile did you use?",
  "keyPersonalizationPoints": ["3-5 specific things from their profile that this pitch references or leverages"],
  "alternateClosings": ["2 alternative CTA closing lines they could swap in"],
  "redFlags": ["1-2 things to be careful about when messaging this person based on their profile — topics to avoid, sensitivities, etc."],
  "followUpAngle": "A one-sentence idea for a follow-up message if they do not reply within a week."
}`;

  const userPrompt = `Write a tailored pitch message for this LinkedIn prospect.

PROSPECT PROFILE:
Name: ${prospect.name}
Headline: ${prospect.headline}
Location: ${prospect.location || "Not specified"}
Role Level: ${prospect.roleLevel || "Unknown"}
Company Stage: ${prospect.companyStage || "Unknown"}

EXECUTIVE SUMMARY:
${prospect.executiveSummary || "Not available"}

AREAS OF EXPERTISE:
${prospect.areasOfExpertise?.join(", ") || "Not specified"}

CURRENT FOCUS:
${prospect.currentFocus || "Not specified"}

CHALLENGES THEY HAVE MENTIONED:
${prospect.challengesMentioned?.join("; ") || "None identified"}

ACHIEVEMENTS THEY HAVE MENTIONED:
${prospect.achievementsMentioned?.join("; ") || "None identified"}

TOOLS & TECHNOLOGIES THEY USE:
${prospect.toolsAndTechnologies?.join(", ") || "None identified"}

THEIR VALUES:
${prospect.values?.join(", ") || "Not identified"}

THEIR COMMUNICATION STYLE:
${prospect.communicationStyle || "Not identified"}

THEIR MOTIVATIONS:
${prospect.motivations?.join("; ") || "Not identified"}

THEIR PET PEEVES (things they dislike):
${prospect.petPeeves?.join("; ") || "None identified"}

QUOTABLE LINES FROM THEIR POSTS:
${prospect.quotableLines?.slice(0, 3).map((q, i) => `[${i + 1}] "${q}"`).join("\n") || "None provided"}

COMMON GROUND / SHARED TOPICS:
${prospect.commonGround?.join(", ") || "None identified"}

${extraContext ? `\nEXTRA CONTEXT FROM THE SENDER (VERY IMPORTANT — use this as primary guidance for pitch angle):\n${extraContext}` : ""}

Now generate the pitch using the ${TONE_LABELS[tone]} tone. Make it feel deeply personal to ${prospect.name}. Reference real things from the data above.`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.75,
    max_tokens: 1500,
    response_format: { type: "json_object" },
  });

  const raw = completion.choices[0]?.message?.content || "{}";
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Failed to parse AI pitch response");
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const cookieString = await getLinkedInCookies(req);
    if (!cookieString) {
      return NextResponse.json(
        { error: "Not authenticated. Please log in again." },
        { status: 401 },
      );
    }

    const body = await req.json();
    const { prospect, tone = "professional", extraContext = "" } = body;

    if (!prospect || !prospect.name) {
      return NextResponse.json({ error: "Prospect data is required." }, { status: 400 });
    }

    const validTones: PitchTone[] = [
      "professional",
      "friendly",
      "bold",
      "consultative",
      "storytelling",
      "direct",
    ];
    if (!validTones.includes(tone as PitchTone)) {
      return NextResponse.json({ error: "Invalid tone specified." }, { status: 400 });
    }

    const openai = getOpenAIClient();
    const pitch = await generatePitch(openai, prospect as ProspectData, tone as PitchTone, extraContext);

    return NextResponse.json({
      success: true,
      tone,
      toneName: TONE_LABELS[tone as PitchTone],
      pitch,
      meta: {
        prospectName: prospect.name,
        generatedAt: new Date().toISOString(),
        poweredBy: "openai",
      },
    });
  } catch (err) {
    console.error("[inti] Fatal error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Inti error: ${msg}` }, { status: 500 });
  }
}
