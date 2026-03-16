import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { extractVanityName } from "@/lib/linkedin";
import { getDatabase } from "@/lib/mongodb";

export const maxDuration = 300;

// ── Types ─────────────────────────────────────────────────────────────────────

interface Experience {
  position_title?: string;
  institution_name?: string;
  from_date?: string;
  to_date?: string;
  duration?: string;
  description?: string;
}

interface Education {
  institution_name?: string;
  degree?: string;
  from_date?: string;
  to_date?: string;
}

interface Accomplishment {
  category: string;
  title: string;
  issuer?: string;
  issued_date?: string;
}

interface Profile {
  name: string;
  headline: string;
  location: string;
  profileUrl: string;
  vanityName: string;
  about?: string;
  experiences?: Experience[];
  educations?: Education[];
  accomplishments?: Accomplishment[];
}

interface Post {
  urn: string;
  text: string;
  reactionsCount: number;
  commentsCount: number;
  repostsCount: number;
  postedDate: string;
  postUrl: string;
  imageUrls: string[];
  videoUrl: string | null;
  articleUrl: string | null;
}

// ── OpenAI ────────────────────────────────────────────────────────────────────

function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY environment variable is not set.");
  }
  return new OpenAI({ apiKey });
}

// ── Utility ───────────────────────────────────────────────────────────────────

function stripEmojis(text: string): string {
  return text
    .replace(
      /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}\u{1F100}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{1FA70}-\u{1FAFF}\u{E0020}-\u{E007F}\u{2300}-\u{23FF}\u{2500}-\u{25FF}\u{2B00}-\u{2BFF}\u{200D}\u{FE0F}]/gu,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
}

function scorePost(p: Post): number {
  return (p.reactionsCount || 0) * 1 + (p.commentsCount || 0) * 3 + (p.repostsCount || 0) * 2;
}

function formatExperience(exp: Experience[] = []): string {
  if (!exp.length) return "None provided";
  return exp
    .map(
      (e, i) =>
        `[${i + 1}] Title: ${e.position_title || "Unknown"} at ${e.institution_name || "Unknown"} (${e.from_date || "?"} - ${e.to_date || "?"})\nDescription: ${e.description ? stripEmojis(e.description).slice(0, 300) : "N/A"}`,
    )
    .join("\n\n");
}

function formatEducation(edu: Education[] = []): string {
  if (!edu.length) return "None provided";
  return edu
    .map(
      (e) =>
        `- ${e.degree || "Degree"} at ${e.institution_name || "Unknown"} (${e.from_date || "?"} - ${e.to_date || "?"})`,
    )
    .join("\n");
}

function formatAccomplishments(acc: Accomplishment[] = []): string {
  if (!acc.length) return "None provided";
  return acc
    .map(
      (a) =>
        `- [${a.category}] ${a.title} (issued by ${a.issuer || "Unknown"}, ${a.issued_date || "?"})`,
    )
    .join("\n");
}

// ── Generate comprehensive persona analysis ───────────────────────────────────

async function generatePersonaAnalysis(
  openai: OpenAI,
  profile: Profile,
  posts: Post[],
): Promise<Record<string, unknown>> {
  const postTexts = posts.filter((p) => p.text?.trim());
  const topPosts = [...postTexts].sort((a, b) => scorePost(b) - scorePost(a)).slice(0, 15);

  const postsSummary = topPosts
    .map(
      (p, i) =>
        `[Post ${i + 1}] (${p.reactionsCount} reactions, ${p.commentsCount} comments, ${p.repostsCount} reposts, date: ${p.postedDate || "unknown"})\n${stripEmojis(p.text).slice(0, 600)}`,
    )
    .join("\n\n---\n\n");

  const systemPrompt = `You are Cara, a Client Avatar Simulation Engine. Your job is to deeply analyze a LinkedIn prospect's profile and posts, then produce a comprehensive persona document that will be used to ROLEPLAY as this person in sales practice simulations.

The analysis must be thorough enough that another AI (or even a human actor) could convincingly impersonate this person's communication style, values, decision-making process, and likely reactions to sales approaches.

CRITICAL RULES:
- Do NOT use any emojis.
- Use clear, professional English.
- Be extremely specific — cite real quotes, topics, patterns from their posts.
- Do not make things up. Only derive insights from the actual data.
- Focus on actionable insights for sales simulation.

Respond with valid JSON only. No markdown, no code fences.

JSON Schema:
{
  "executiveSummary": "3-5 sentences capturing who this person is, what drives them, and what kind of prospect they represent.",
  
  "personalityProfile": {
    "communicationStyle": "How they express themselves — direct, storytelling, data-driven, casual, formal, etc. With specific examples.",
    "tone": "Their typical emotional register — optimistic, skeptical, pragmatic, passionate, reserved, etc.",
    "values": ["5-7 core values derived from their content — what clearly matters to them"],
    "motivations": ["What drives them professionally — growth, impact, innovation, stability, etc."],
    "petPeeves": ["Things they complain about or push back against in their posts"],
    "decisionMakingStyle": "How they likely make decisions — data-driven, gut instinct, consensus-seeking, etc."
  },
  
  "professionalInsights": {
    "currentRole": "Their current position and responsibilities",
    "currentFocus": "What they are actively working on or prioritizing right now",
    "industryExpertise": ["Industries or domains they deeply understand"],
    "areasOfExpertise": ["Specific skills and knowledge areas"],
    "challenges": ["Problems, frustrations, or pain points they have mentioned"],
    "achievements": ["Notable accomplishments they have shared"],
    "toolsAndTech": ["Technologies, platforms, or tools they use or advocate for"],
    "careerTrajectory": "How their career has evolved and where they seem to be heading"
  },
  
  "buyerProfile": {
    "buyerType": "One of: Analytical (data-driven, methodical), Driver (results-oriented, decisive), Amiable (relationship-focused, harmonious), Expressive (vision-driven, enthusiastic)",
    "decisionFactors": ["What matters most when they evaluate solutions — ROI, ease of use, team impact, scalability, etc."],
    "likelyObjections": ["Specific objections they would likely raise based on their personality and values"],
    "buyingTriggers": ["What would make them interested — specific pain points, growth goals, competitive pressure, etc."],
    "dealBreakers": ["Things that would immediately kill interest — pushy sales, lack of proof, etc."],
    "warmthLevel": 5,
    "trustBuilders": ["What would build their trust — case studies, peer recommendations, technical demos, etc."]
  },
  
  "simulationGuidelines": {
    "howTheyGreet": "How they typically start conversations — formal, casual, direct, etc.",
    "responseLength": "Do they write long, detailed responses or keep things brief?",
    "questionStyle": "What kinds of questions do they ask — probing, clarifying, challenging, etc.",
    "objectionStyle": "How do they push back — directly, diplomatically, with questions, with silence?",
    "engagementSignals": "What indicates they are interested vs. disengaged?",
    "samplePhrases": ["5-8 phrases or speech patterns characteristic of this person that an AI should use when roleplaying them"],
    "topicsTheyLove": ["Topics that light them up and get them talking"],
    "topicsToAvoid": ["Topics that bore them or create friction"]
  },
  
  "salesApproach": {
    "bestApproach": "The ideal way to approach this person for a sales conversation — detailed strategy",
    "openingAngles": ["3-4 specific conversation openers that would resonate with this person"],
    "keyMessages": ["Core value propositions that would appeal to their specific needs and values"],
    "doThis": ["Specific things a sales rep SHOULD do when engaging this person"],
    "avoidThis": ["Specific things a sales rep should NOT do"],
    "followUpStrategy": "How to follow up without being annoying, based on their communication preferences"
  },
  
  "quotableContent": {
    "memorableQuotes": ["3-5 direct quotes from their posts that reveal their character"],
    "recurringThemes": ["Topics and ideas they consistently return to"],
    "strongOpinions": ["Positions they hold strongly and defend"]
  }
}`;

  const userPrompt = `Analyze this LinkedIn prospect. Build a complete persona profile for sales simulation.

PROSPECT PROFILE:
Name: ${profile.name}
Headline: ${profile.headline}
Location: ${profile.location || "Not specified"}
Profile URL: ${profile.profileUrl}

ABOUT SUMMARY:
${profile.about ? stripEmojis(profile.about) : "None provided"}

CAREER EXPERIENCE:
${formatExperience(profile.experiences)}

EDUCATION:
${formatEducation(profile.educations)}

ACCOMPLISHMENTS (Awards, Certs, etc.):
${formatAccomplishments(profile.accomplishments)}

THEIR RECENT POSTS (${postTexts.length} total, showing top ${topPosts.length} by engagement):

${postsSummary || "No posts available"}

Generate a complete, detailed persona analysis. Every section must be thoroughly filled with specific, evidence-backed insights. This persona will be used to simulate realistic conversations with this person.`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.6,
    max_tokens: 4000,
    response_format: { type: "json_object" },
  });

  const raw = completion.choices[0]?.message?.content || "{}";
  let parsed: Record<string, unknown>;

  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error("[cara-analyze] Failed to parse OpenAI response:", raw);
    throw new Error("Failed to parse AI response");
  }

  return parsed;
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const cookieString = req.cookies.get("li_session")?.value;
    if (!cookieString) {
      return NextResponse.json(
        { error: "Not authenticated. Please log in again." },
        { status: 401 },
      );
    }

    const body = await req.json();
    const { profileUrl, postsLimit = 10 } = body;

    if (!profileUrl || typeof profileUrl !== "string") {
      return NextResponse.json({ error: "profileUrl is required" }, { status: 400 });
    }

    // Validate URL
    try {
      extractVanityName(profileUrl.trim());
    } catch {
      return NextResponse.json(
        { error: "Invalid LinkedIn profile URL. Expected: https://linkedin.com/in/username" },
        { status: 400 },
      );
    }

    const limit = Math.min(Math.max(1, Number(postsLimit) || 10), 50);
    const force = body.force === true;
    
    // Normalize URL for lookup (remove trailing slash)
    const normalizedUrl = profileUrl.trim().replace(/\/$/, "");

    // ── Step 0: Check for existing persona to avoid duplicate work ──
    const db = await getDatabase();
    const existingPersona = await db.collection("cara_personas").findOne({ 
      $or: [
        { profileUrl: normalizedUrl },
        { profileUrl: normalizedUrl + "/" }
      ]
    });

    if (existingPersona && !force) {
      console.log(`[cara-analyze] Returning existing persona for: ${normalizedUrl}`);
      return NextResponse.json({
        success: true,
        persona: existingPersona,
        isExisting: true,
        message: "Persona already exists in database."
      });
    }

    console.log(`[cara-analyze] Scraping profile: ${profileUrl}, limit=${limit}, force=${force}`);

    // ── Step 1: Scrape the profile via Python backend ──
    const backendUrl =
      process.env.PYTHON_BACKEND_URL?.replace(/\/$/, "") || "http://127.0.0.1:8000";
    const apiResponse = await fetch(`${backendUrl}/scrape`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "ngrok-skip-browser-warning": "true",
        "User-Agent": "NextJS-Backend",
      },
      body: JSON.stringify({
        cookieString,
        profileUrl: profileUrl.trim(),
        limit,
      }),
    });

    if (!apiResponse.ok) {
      const errorText = await apiResponse.text();
      return NextResponse.json(
        {
          error: `Scraper API error: ${apiResponse.statusText}. Details: ${errorText}`,
        },
        { status: apiResponse.status },
      );
    }

    const scrapeResult = await apiResponse.json();

    if (scrapeResult.error) {
      if (
        scrapeResult.error.includes("Not logged in") ||
        scrapeResult.error.includes("authenticate")
      ) {
        return NextResponse.json(
          { error: "Not logged in to LinkedIn. Please re-authenticate." },
          { status: 401 },
        );
      }
      return NextResponse.json({ error: scrapeResult.error }, { status: 500 });
    }

    const profile: Profile = scrapeResult.profile;
    const posts: Post[] = scrapeResult.posts || [];

    if (!profile || !profile.name) {
      return NextResponse.json({ error: "Could not extract profile data" }, { status: 500 });
    }

    console.log(`[cara-analyze] Analyzing ${posts.length} posts for ${profile.name}`);

    // ── Step 2: Generate AI persona analysis ──
    const openai = getOpenAIClient();
    const analysis = await generatePersonaAnalysis(openai, profile, posts);

    console.log(`[cara-analyze] Persona analysis generated for ${profile.name}`);

    // ── Step 3: Save to MongoDB ──
    const now = new Date().toISOString();

    // Fields to update on every upsert (profile data + analysis)
    const updatePayload = {
      profileUrl: profile.profileUrl,
      vanityName: profile.vanityName || "",
      name: profile.name,
      headline: profile.headline || "",
      location: profile.location || "",
      about: profile.about || "",
      analysis,
      postsAnalyzed: posts.length,
      lastUpdated: now,
    };

    const result = await db.collection("cara_personas").updateOne(
      { profileUrl: profile.profileUrl },
      {
        $set: updatePayload,
        $setOnInsert: {
          simulationSessions: [],
          scrapedAt: now,
        },
      },
      { upsert: true },
    );

    // Also store/update in the shared profiles collection for Demarko/others
    await db.collection("profiles").updateOne(
      { profileUrl: profile.profileUrl },
      {
        $set: {
          name: profile.name,
          headline: profile.headline || "",
          location: profile.location || "",
          vanityName: profile.vanityName || "",
          profileUrl: profile.profileUrl,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          executiveSummary: (analysis as any).executiveSummary || "",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          areasOfExpertise: (analysis as any).professionalInsights?.areasOfExpertise || [],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          currentFocus: (analysis as any).professionalInsights?.currentFocus || "",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          communicationStyle: (analysis as any).personalityProfile?.communicationStyle || "",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          values: (analysis as any).personalityProfile?.values || [],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          challengesMentioned: (analysis as any).professionalInsights?.challenges || [],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          achievementsMentioned: (analysis as any).professionalInsights?.achievements || [],
          lastUpdated: now,
        },
        $setOnInsert: {
          emailsSent: [],
          emailAddress: "",
          scrapedAt: now,
        },
      },
      { upsert: true },
    );

    // Fetch the saved persona to get the _id
    const savedPersona = await db
      .collection("cara_personas")
      .findOne({ profileUrl: profile.profileUrl });

    return NextResponse.json({
      success: true,
      persona: savedPersona,
      upserted: result.upsertedCount > 0,
      postsAnalyzed: posts.length,
    });
  } catch (err) {
    console.error("[cara-analyze] Fatal error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Cara analysis error: ${msg}` }, { status: 500 });
  }
}
