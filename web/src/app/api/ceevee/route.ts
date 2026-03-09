import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { extractVanityName } from "@/lib/linkedin";
import { spawn } from "child_process";
import path from "path";

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

interface BridgeResult {
  profile: Profile;
  posts: Post[];
  error?: string;
}

// ── OpenAI ────────────────────────────────────────────────────────────────────

function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY environment variable is not set.");
  }
  return new OpenAI({ apiKey });
}

// ── Python bridge (reuse the scraper) ────────────────────────────────────────

// ── Python bridge (Legacy function removed, data fetched via FastAPI) ──

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

// ── Formatter ─────────────────────────────────────────────────────────────────

function formatExperience(exp: Experience[] = []): string {
  if (!exp.length) return "None provided";
  return exp.map((e, i) => `[${i + 1}] Title: ${e.position_title || "Unknown"} at ${e.institution_name || "Unknown"} (${e.from_date || "?"} - ${e.to_date || "?"})
Description: ${e.description ? stripEmojis(e.description).slice(0, 300) : "N/A"}`).join("\n\n");
}

function formatEducation(edu: Education[] = []): string {
  if (!edu.length) return "None provided";
  return edu.map(e => `- ${e.degree || "Degree"} at ${e.institution_name || "Unknown"} (${e.from_date || "?"} - ${e.to_date || "?"})`).join("\n");
}

function formatAccomplishments(acc: Accomplishment[] = []): string {
  if (!acc.length) return "None provided";
  return acc.map(a => `- [${a.category}] ${a.title} (issued by ${a.issuer || "Unknown"}, ${a.issued_date || "?"})`).join("\n");
}

// ── OpenAI-powered deep prospect analysis ─────────────────────────────────────

async function generateProspectReport(
  openai: OpenAI,
  profile: Profile,
  posts: Post[],
): Promise<object> {
  const postTexts = posts.filter((p) => p.text?.trim());
  const topPosts = [...postTexts]
    .sort((a, b) => scorePost(b) - scorePost(a))
    .slice(0, 15);

  const postsSummary = topPosts
    .map(
      (p, i) =>
        `[Post ${i + 1}] (${p.reactionsCount} reactions, ${p.commentsCount} comments, ${p.repostsCount} reposts, date: ${p.postedDate || "unknown"})
${stripEmojis(p.text).slice(0, 600)}`,
    )
    .join("\n\n---\n\n");

  const systemPrompt = `You are Ceevee, a prospect research assistant. Your job is to look at a LinkedIn person's profile and their posts, then write a simple, clear summary about them.

The goal: The user wants to message this person and needs to understand them well first. Write everything so a non-expert can read it quickly and understand it.

CRITICAL RULES:
- Do NOT use any emojis.
- Use simple, everyday English. Write short, clear sentences. Avoid big or complicated words.
- If you must use a technical term, briefly explain what it means.
- Be specific — mention actual things from their posts or profile (real quotes, dates, topics).
- Do not make things up. Only write what the data shows.
- Imagine you are explaining this person to a friend who does not know them at all.

Respond with valid JSON only. No markdown, no code fences.

JSON Schema:
{
  "executiveSummary": "3-5 short, simple sentences. Say who this person is, what their job is, what topics they care about, and what makes them stand out. Write it like you are telling a friend about someone you just looked up.",
  
  "profileAnalysis": {
    "roleLevel": "Their job level in simple terms (e.g. 'Company owner', 'Senior manager', 'Team lead', 'Junior employee')",
    "industryFocus": ["Up to 3 fields or industries they work in, written simply"],
    "areasOfExpertise": ["3-5 things they are clearly good at, based on their posts — use plain words"],
    "estimatedCompanyStage": "How big or mature their company seems (e.g. 'Small startup', 'Growing mid-size company', 'Large established company') — only if you can tell from the data"
  },
  
  "careerTrajectory": {
    "currentFocus": "What their current job is and what they are working on right now — in 1-2 simple sentences",
    "keyTransitions": "How their career has changed over time, written simply (e.g. 'They started as a developer, then moved into management')",
    "notableCompanies": ["The most important or well-known companies they have worked at"],
    "awardsAndCertifications": ["Any awards, certificates, or big achievements they have earned"],
    "educationBackground": "Where they studied and what they studied — keep it brief and simple"
  },
  
  "contentAnalysis": {
    "primaryTopics": [
      {
        "topic": "What this topic is about in simple words",
        "frequency": "How often they post about this (e.g. 'They post about this a lot — about 4 out of every 10 posts')",
        "stance": "What they think or believe about this topic, explained simply",
        "evidence": "A real quote or specific example from one of their posts"
      }
    ],
    "contentStyle": "How they write their posts — for example: 'They write short posts with bullet points', 'They tell personal stories', 'They share data and numbers', 'They are direct and to the point'",
    "postingPatterns": "How often they post and what kinds of posts they share (text, photos, articles, etc.)",
    "topPerformingContent": "What kind of posts get the most likes and comments, and give a simple example"
  },
  
  "professionalInsights": {
    "challengesMentioned": ["Problems or frustrations they have talked about publicly — written simply"],
    "achievementsMentioned": ["Things they are proud of or have achieved that they have shared"],
    "toolsAndTechnologies": ["Apps, tools, or software they mention using — explain briefly what each one is if it is not well known"],
    "networkAndInfluence": "How many people seem to engage with them, and who their audience seems to be — keep it simple"
  },
  
  "personalityProfile": {
    "communicationStyle": "How they come across when they write — for example: 'They are very direct and confident', 'They like to tell stories', 'They back up what they say with data'",
    "values": ["3-5 things that clearly matter to them, based on what they post about"],
    "petPeeves": ["Things they dislike or complain about in their posts"],
    "motivations": ["What seems to drive them or excite them, based on their posts"]
  },
  
  "conversationStarters": [
    {
      "approach": "A short name for this message approach (e.g. 'Mention their latest post', 'Ask about their experience')",
      "message": "A full message you can send right away. Keep it friendly and natural. Show that you read their profile. No more than 3-4 sentences. Use simple words.",
      "rationale": "In 1-2 sentences, explain why this message is a good idea — what specific thing from their profile or posts makes it relevant",
      "confidence": 70-99
    }
  ],
  
  "keyReferences": {
    "quotableLines": ["2-3 memorable lines from their posts that you could bring up in a conversation to show you read their content"],
    "topicsToAvoid": ["Topics or opinions they feel strongly about that could create a bad first impression if you bring them up the wrong way"],
    "commonGround": ["Things you could both relate to or talk about to build a connection"]
  }
}`;

  const userPrompt = `Analyze this LinkedIn prospect in depth.

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

${postsSummary}

Produce a complete prospect intelligence dossier. Be thorough, specific, and analytical. Every section must contain actionable insights backed by evidence from the data above. Generate exactly 4 conversation starters with different approaches.`;

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
    console.error("[ceevee] Failed to parse OpenAI response:", raw);
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
    const { profileUrl, postsLimit = 10, profile: existingProfile, posts: existingPosts } = body;

    let profile: Profile;
    let posts: Post[];

    // If pre-scraped data is provided (from scraper page), use it directly
    if (existingProfile && existingPosts && existingPosts.length > 0) {
      console.log(`[ceevee] Using pre-scraped data for ${existingProfile.name}`);
      profile = existingProfile;
      posts = existingPosts;
    } else if (profileUrl) {
      // Otherwise, scrape the profile from the URL
      if (typeof profileUrl !== "string") {
        return NextResponse.json({ error: "Invalid profile URL" }, { status: 400 });
      }

      try {
        extractVanityName(profileUrl.trim());
      } catch {
        return NextResponse.json(
          { error: "Invalid LinkedIn profile URL. Expected: https://linkedin.com/in/username" },
          { status: 400 },
        );
      }

      const limit = Math.min(Math.max(1, Number(postsLimit) || 10), 50);
      console.log(`[ceevee] Fetching scrape data via API: ${profileUrl}, limit=${limit}`);

      const backendUrl = process.env.PYTHON_BACKEND_URL?.replace(/\/$/, '') || "http://127.0.0.1:8000";
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
        return NextResponse.json({ error: `Scraper API error: ${apiResponse.statusText}. Details: ${errorText}` }, { status: apiResponse.status });
      }

      const result = await apiResponse.json();
      
      if (result.error) {
        if (result.error.includes("Not logged in") || result.error.includes("authenticate")) {
          return NextResponse.json(
            { error: "Not logged in to LinkedIn. Please re-authenticate." },
            { status: 401 }
          );
        }
        return NextResponse.json({ error: result.error }, { status: 500 });
      }

      profile = result.profile;
      posts = result.posts;
    } else {
      return NextResponse.json({ error: "Either profileUrl or profile+posts data is required" }, { status: 400 });
    }

    if (!profile || !profile.name) {
      return NextResponse.json({ error: "Could not extract profile data" }, { status: 500 });
    }

    console.log(`[ceevee] Analyzing ${posts.length} posts for ${profile.name}`);

    // Generate the AI-powered report
    const openai = getOpenAIClient();
    const aiReport = await generateProspectReport(openai, profile, posts);

    console.log(`[ceevee] Report generated successfully for ${profile.name}`);

    return NextResponse.json({
      success: true,
      profile,
      posts: posts.slice(0, 5).map((p) => ({
        text: p.text?.slice(0, 200),
        reactionsCount: p.reactionsCount,
        commentsCount: p.commentsCount,
        repostsCount: p.repostsCount,
        postedDate: p.postedDate,
        postUrl: p.postUrl,
      })),
      report: aiReport,
      meta: {
        postsAnalyzed: posts.length,
        generatedAt: new Date().toISOString(),
        poweredBy: "openai",
      },
    });
  } catch (err) {
    console.error("[ceevee] Fatal error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Ceevee error: ${msg}` }, { status: 500 });
  }
}
