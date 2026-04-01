import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { getDatabase, KnowledgeBaseEntry } from "@/lib/mongodb";

export const maxDuration = 60;

function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY environment variable is not set.");
  }
  return new OpenAI({ apiKey });
}

async function getKnowledgeContext(botId: string): Promise<string> {
  try {
    const db = await getDatabase();
    const entries = await db
      .collection<KnowledgeBaseEntry>("knowledge_base")
      .find({ $or: [{ botId }, { botId: "all" }] })
      .sort({ updatedAt: -1 })
      .toArray();

    if (entries.length === 0) return "";

    return (
      "\n\nCOMPANY KNOWLEDGE BASE (use this as your primary source of truth):\n" +
      entries
        .map((e) => `[${e.type.toUpperCase()}] ${e.title}:\n${e.content}`)
        .join("\n\n")
    );
  } catch {
    return "";
  }
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

    const { profile, prospectMessage } = await req.json();

    if (!profile) {
      return NextResponse.json(
        { error: "Profile data is required." },
        { status: 400 }
      );
    }

    if (!prospectMessage) {
      return NextResponse.json(
        { error: "Prospect message is required to generate a reply." },
        { status: 400 }
      );
    }

    const openai = getOpenAIClient();
    const knowledgeContext = await getKnowledgeContext("cindy");

    const prompt = `You are Cindy, a polite, professional, and helpful Customer Service and Sales Support Bot for Devs Colab.
You are stepping in automatically because the human representative in charge of this prospect has been unavailable to reply for 2 minutes.
Your goal is to parse the prospect's message, provide quick, helpful support, handle objections or queries naturally, and gently guide the conversation forward by deeply studying their profile and the message context. Keep it seamless; do not explicitly say "I am a bot since the human is away", but be exceptionally helpful and context-aware.
${knowledgeContext}

CURRENT CONTEXT:
Prospect Message: "${prospectMessage}"

PROFILE INSIGHTS:
Name: ${profile.name}
Headline: ${profile.headline || "N/A"}
Current Focus: ${profile.currentFocus || "N/A"}
Areas of Expertise: ${profile.areasOfExpertise?.join(", ") || "N/A"}
Challenges: ${profile.challengesMentioned?.join(", ") || "N/A"}
Achievements: ${profile.achievementsMentioned?.join(", ") || "N/A"}

ANTI-HALLUCINATION RULES (CRITICAL):
- Base your reply STRICTLY on the Company Knowledge Base above and the prospect's profile.
- If the prospect asks something NOT covered in the knowledge base and you cannot answer confidently from profile context, set "needsEscalation": true and set "reply" to: "Let me confirm this for you — I want to make sure I give you the most accurate information. Someone from our team will follow up shortly."
- NEVER invent policies, prices, features, or commitments that are not in the knowledge base.
- If you can answer confidently, set "needsEscalation": false.

CRITICAL WRITING RULES:
1. EMPATHY & CLARITY:
   - Begin by directly addressing the prospect's specific query, objection, or comment.
   - Show empathy and understanding of their situation and context.

2. VALUE ADDITION:
   - Answer their question concisely but comprehensively.
   - Do NOT use typical corporate jargon. Maintain a human, helpful tone.

3. CONTEXTUAL RELEVANCE:
   - Rely on their Profile Insights to frame your answer if relevant. For example, if they mention an issue, tie it back to their known "Challenges" or "Current Focus".

4. SOFT CALL-TO-ACTION (CTA):
   - Provide a natural next step, such as asking an engaging follow-up question or gently suggesting a brief call to align further.

5. FORMAT & TONE:
   - 2-3 short, highly readable paragraphs.
   - Professional, warm, and highly capable language.
   - No subject line needed, just the body of the response.

REQUIREMENTS:
- ONLY output the email/message reply text. Do not include markdown blocks or extra commentary.
- Be highly responsive to what they actually said in "Prospect Message".

OUTPUT INSTRUCTIONS:
Return an exact JSON object:
{
  "reply": "Body of the reply here...",
  "needsEscalation": false,
  "escalationReason": ""
}
If escalation is needed, set needsEscalation to true and provide a short escalationReason (e.g. "Query about pricing not in knowledge base").
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.7,
      max_tokens: 700,
    });

    const raw = completion.choices[0]?.message?.content || "{}";
    const data = JSON.parse(raw);

    return NextResponse.json({
      success: true,
      reply: data.reply,
      needsEscalation: data.needsEscalation === true,
      escalationReason: data.escalationReason || "",
    });
  } catch (err) {
    console.error("[cindy-generate] POST error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
