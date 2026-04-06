import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { extractVanityName, getLinkedInCookies } from "@/lib/linkedin";
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

interface Comment {
  urn: string;
  text: string;
  postedDate: string;
  postUrl: string;
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
  comments: Comment[] = [],
): Promise<Record<string, unknown>> {
  const postTexts = posts.filter((p) => p.text?.trim());
  const topPosts = [...postTexts].sort((a, b) => scorePost(b) - scorePost(a)).slice(0, 15);

  const postsSummary = topPosts
    .map(
      (p, i) =>
        `[Post ${i + 1}] (${p.reactionsCount} reactions, ${p.commentsCount} comments, ${p.repostsCount} reposts, date: ${p.postedDate || "unknown"})\n${stripEmojis(p.text).slice(0, 600)}`,
    )
    .join("\n\n---\n\n");

  const commentsSummary = comments
    .filter((c) => c.text?.trim())
    .slice(0, 10)
    .map((c, i) => `[Comment ${i + 1}] (date: ${c.postedDate || "unknown"})\n${stripEmojis(c.text)}`)
    .join("\n\n---\n\n");

  const systemPrompt = `You are Cara, the elite Client Avatar Simulation Engine. Your goal is to dissect a LinkedIn prospect's psychology for high-stakes sales simulation.

You must build a document rich in detail but EXTREMELY CONCISE.

CRITICAL RULES:
1. STRICT BREVITY: Every bullet point and array item MUST be 2-4 words maximum.
2. NO EMOJIS.
3. PROFESSIONAL, PENETRATING English.
4. COMMENT-BASED STYLE: The 'communicationStyle' section MUST be derived from their comments on other people's posts. If no comments are available in the data, set this entire field to null.
5. DERIVE, DON'T INVENT: All insights must be 1:1 reflections of their actual content.

JSON Schema:
{
  "executiveSummary": "A highly specific 3-sentence profile diagnostic. Sentence 1: A deep dive into their professional identity, seniority, and specific domain of influence. Sentence 2: A breakdown of their primary commercial value, highlighting specific achievements or unique skills. Sentence 3: A diagnostic of their psychological posture and the specific 'hook' needed to prompt engagement.",
  
  "communicationStyle": {
    "sectionDescription": "A 1-2 sentence brief detailing how this prospect specifically interacts in public/private settings based on their actual comments and posts.",
    "linguisticPatterns": ["List 2-4 short phrases"],
    "commentStyle": "Description of comment behavior.",
    "shorthand": ["List specific abbreviations used"],
    "interactionModel": "Engagement model (e.g., 'low frequency, high depth')."
  },

  "personalityProfile": {
    "sectionDescription": "A 1-2 sentence brief on their character baseline, explaining how their values translate into their professional temperament.",
    "tone": "Emotional baseline (e.g., 'calm and inquisitive').",
    "values": ["3-5 core values"],
    "motivations": ["2-3 main motivators"],
    "petPeeves": ["1-3 specific red flags"],
    "personalityTraps": ["1-2 conversational derailment patterns"],
    "decisionMakingStyle": "Diagnostic of how they pull the trigger on decisions."
  },
  
  "professionalInsights": {
    "sectionDescription": "A 1-2 sentence brief on their career traction, current leverage points, and immediate organizational priorities.",
    "currentRole": "Diagnostic of current seat.",
    "currentFocus": "Their #1 immediate priority.",
    "industryExpertise": ["2-3 core domains"],
    "areasOfExpertise": ["3-4 specific skills"],
    "challenges": ["1-2 high-level pain points"],
    "achievements": ["1-2 ego-boosters/wins"],
    "toolsAndTech": ["Top 3 tools"],
    "secretHooks": ["1-2 niche interests or conversation starters"]
  },
  
  "buyerProfile": {
    "sectionDescription": "A 1-2 sentence brief on their purchasing psychology, explaining what specifically earns their trust vs what triggers immediate rejection.",
    "buyerType": "Analytical | Driver | Amiable | Expressive",
    "decisionFactors": ["2-3 primary criteria"],
    "likelyObjections": ["Predict 1-2 exact 'No' scenarios"],
    "buyingTriggers": ["1-2 events or needs"],
    "dealBreakers": ["1-2 relationship killers"],
    "warmthLevel": "(1-10 range)",
    "trustBuilders": ["1-2 specific evidence types that work"]
  },
  
  "salesApproach": {
    "sectionDescription": "A 1-2 sentence brief on the 'master key' strategy for opening a dialogue with this specific individual.",
    "bestApproach": "The 'Golden Strategy' (detailed tactical summary).",
    "openingAngles": ["2-3 short openers (max 8 words each)"],
    "keyMessages": ["1-2 value props (max 8 words each)"],
    "doThis": ["2-3 essential moves (2-4 words each)"],
    "avoidThis": ["2-3 failure moves (2-4 words each)"],
    "followUpStrategy": "Short note (max 10 words)."
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

THEIR COMMENTS ON OTHER POSTS (revealing true texting/writing style):

${commentsSummary || "No comments available"}

Generate a complete, detailed persona analysis. Every section must be thoroughly filled with specific, evidence-backed insights. This persona will be used to simulate realistic conversations with this person.`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
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
    const cookieString = await getLinkedInCookies(req);
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

    // ── Step 1: Scrape the profile via Python backend (Streaming) ──
    const backendUrl =
      process.env.PYTHON_BACKEND_URL?.replace(/\/$/, "") || "http://127.0.0.1:8000";
    
    console.log(`[cara-analyze] Starting stream-scrape for: ${profileUrl}`);
    
    let scrapeResult: any = null;
    try {
      const response = await fetch(`${backendUrl}/scrape-stream`, {
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

      if (!response.ok) {
        const errorText = await response.text();
        return NextResponse.json(
          { error: `Scraper stream error: ${response.statusText}. Details: ${errorText}` },
          { status: response.status }
        );
      }

      if (!response.body) {
        throw new Error("Response body is null");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const chunk = JSON.parse(line.slice(6));
              if (chunk.stage === "result") {
                scrapeResult = chunk.data;
              } else if (chunk.stage === "error") {
                throw new Error(chunk.detail || "Unknown scraper error");
              } else {
                // Log progress to server console
                // console.log(`[cara-scraper] ${chunk.stage}: ${chunk.detail} (${chunk.pct}%)`);
              }
            } catch (e) {
              if (e instanceof Error && e.message.includes("scraper error")) throw e;
              // Ignore parse errors for keep-alive or malformed lines
            }
          }
        }
      }
    } catch (scrapeErr) {
      console.error("[cara-analyze] Scrape stream failed:", scrapeErr);
      return NextResponse.json(
        { error: `Scraping failed: ${scrapeErr instanceof Error ? scrapeErr.message : "Connection lost"}` },
        { status: 500 }
      );
    }

    if (!scrapeResult || scrapeResult.error) {
      return NextResponse.json(
        { error: scrapeResult?.error || "Failed to get scrape result from stream" },
        { status: 500 }
      );
    }

    const profile: Profile = scrapeResult.profile;
    const posts: Post[] = scrapeResult.posts || [];
    const comments: Comment[] = scrapeResult.comments || [];

    if (!profile || !profile.name) {
      return NextResponse.json({ error: "Could not extract profile data" }, { status: 500 });
    }

    console.log(`[cara-analyze] Analyzing ${posts.length} posts and ${comments.length} comments for ${profile.name}`);

    // ── Step 2: Generate AI persona analysis ──
    const openai = getOpenAIClient();
    const analysis = await generatePersonaAnalysis(openai, profile, posts, comments);

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
