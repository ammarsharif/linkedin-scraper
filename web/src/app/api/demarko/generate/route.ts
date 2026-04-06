import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { getLinkedInCookies } from "@/lib/linkedin";

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
    const cookieString = await getLinkedInCookies(req);
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

    // Helper to get next weekdays (Mon-Fri) in readable format
    function getNextWeekdays(numDays = 2) {
      const daysOfWeek = [
        "Sunday",
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
      ];
      const result = [];
      let date = new Date();
      // Use a separate tracker to avoid modifying the current date unnecessarily in the loop
      let checkDate = new Date(date);

      while (result.length < numDays) {
        checkDate.setDate(checkDate.getDate() + 1);
        const dayNum = checkDate.getDay();
        // Skip Saturday (6) and Sunday (0)
        if (dayNum !== 0 && dayNum !== 6) {
          result.push(daysOfWeek[dayNum]);
        }
      }
      return result;
    }

    const nextWeekdays = getNextWeekdays(2);
    const currentDate = new Date().toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const prompt = `You are Demarko, an expert at writing high-conversion, hyper-personalized cold outreach emails for Devs Colab.
Your goal is to create a unique email strictly based on the prospect's profile insights, with no repeated templates or static examples.

CURRENT CONTEXT:
Today's Date: ${currentDate}

CRITICAL WRITING RULES:

1. SPECIFIC, DYNAMIC OPENER:
   - Start with a fresh, concrete observation from the prospect’s profile, achievements, or recent work.
   - Avoid generic flattery or reused sentences.
   - All examples should come from the prospect’s actual data.

2. NO JARGON:
   - Avoid buzzwords, corporate phrases, or vague trends.
   - Explain clearly why you’re reaching out.

3. CONCRETE, UNIQUE VALUE PROP:
   - Include one line highlighting a tangible outcome or relevant overlap.
   - Use the prospect’s current projects, focus areas, or expertise to dynamically create this.

4. EVIDENCE-BASED CHALLENGES:
   - Only mention challenges explicitly noted in their profile.
   - Otherwise, focus on their successes or milestones.
   - Avoid assumptions.

5. SHARP CTA:
   - Provide a simple, specific next step with a time suggestion.
   - Use the next two available weekdays dynamically: "${nextWeekdays.join('" or "')}".
   - Instruct the AI to generate a natural phrase like: "Would ${nextWeekdays.join(" or ")} work for a 15-minute call?"

6. STRUCTURE & TONE:
   - 3–4 concise paragraphs max.
   - Conversational, natural, human, zero sales jargon.
   - Grammatically correct, complete sentences only.
   - No signature or closing; end immediately after CTA.
   - Do NOT use em dashes (—).

PROFILE INSIGHTS:
Name: ${profile.name}
Headline: ${profile.headline || "N/A"}
Executive Summary: ${profile.executiveSummary || "N/A"}
Current Focus: ${profile.currentFocus || "N/A"}
Areas of Expertise: ${profile.areasOfExpertise?.join(", ") || "N/A"}
Recent Achievements: ${profile.achievementsMentioned?.join(", ") || "N/A"}
Recent Challenges: ${profile.challengesMentioned?.join(", ") || "N/A"}

REQUIREMENTS:
- Generate entirely new phrasing every time.
- Do not repeat any previous examples.
- Every sentence should feel personalized to the prospect.

OUTPUT FORMAT (exact JSON, no extra commentary):
{
  "subject": "Unique, intriguing subject line derived from the profile",
  "body": "Email body text using \\n\\n for paragraph breaks, ending immediately after CTA."
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
