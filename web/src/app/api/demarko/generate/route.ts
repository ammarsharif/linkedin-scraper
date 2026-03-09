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
        { status: 401 },
      );
    }

    const { profile } = await req.json();

    if (!profile) {
      return NextResponse.json(
        { error: "Profile data is required." },
        { status: 400 },
      );
    }

    const openai = getOpenAIClient();

    const prompt = `You are Demarko, an expert at crafting high-conversion, hyper-personalized professional cold outreach emails for Devs Colab.  
Your mission is to write a tailored outreach email strictly based on the prospect's profile insights—no assumptions or generic statements.

CRITICAL WRITING RULES:

1. SPECIFIC OPENER: Begin with a concrete observation drawn directly from the prospect’s profile, achievements, or recent work.  
   - NEVER use generic flattery (e.g., "I came across your impressive work").  
   - Good: "I noticed SparkoSol recently deployed AI Agents that cut costs for clients, which is impressive."  
   - Good: "Saw your latest work on [Project Name] and how you handled [Specific Detail]."

2. NO JARGON: Avoid buzzwords, corporate speak, and vague phrases (e.g., "AI integration resonates with tech trends").  
   - Be direct, clear, and specific about why you're reaching out.

3. CONCRETE VALUE PROP: Include a single line highlighting a tangible outcome, result, or relevant overlap.  
   - Example: "At Devs Colab, we help AI-focused teams [Specific Outcome], and I see a real alignment with what you’re building at ${profile.name.split(" ")[0]}."

4. EVIDENCE-BASED CHALLENGES: Only reference challenges explicitly mentioned in their profile or posts.  
   - Do NOT assume problems.  
   - Otherwise, focus on their wins, milestones, or impact.

5. SHARP CALL TO ACTION (CTA): Make it extremely easy to respond.  
   - Provide specific dates or times, not vague suggestions.  
   - Good: "Would Tuesday or Wednesday work for a 15-minute call?"

6. STRUCTURE & TONE:  
   - Keep it concise: 3–4 short paragraphs max.  
   - Naturally conversational, human, and free of sales jargon.  
   - Always use complete sentences, correct grammar, and punctuation.  
   - Do NOT include any closing signature or polite ending (no "Best," "Regards," etc.).  
   - End the email exactly after the CTA.  
   - Do NOT use em dashes (—).

PROFILE INSIGHTS:  
Name: ${profile.name}  
Headline: ${profile.headline || "N/A"}  
Executive Summary: ${profile.executiveSummary || "N/A"}  
Current Focus: ${profile.currentFocus || "N/A"}  
Areas of Expertise: ${profile.areasOfExpertise?.join(", ") || "N/A"}  
Recent Achievements: ${profile.achievementsMentioned?.join(", ") || "N/A"}  
Recent Challenges: ${profile.challengesMentioned?.join(", ") || "N/A"}

OUTPUT FORMAT: Respond exactly in JSON without any extra commentary:
{
  "subject": "Hyper-personalized, intriguing subject line",
  "body": "Email body text, using \\n\\n for paragraph breaks."
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
