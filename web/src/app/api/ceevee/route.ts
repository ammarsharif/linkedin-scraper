import { NextResponse } from "next/server";

export const maxDuration = 60;

// ── Types ─────────────────────────────────────────────────────────────────────

interface Profile {
  name: string;
  headline: string;
  location: string;
  profileUrl: string;
}

interface Post {
  text: string;
  reactionsCount: number;
  commentsCount: number;
  repostsCount: number;
  postedDate: string;
  postUrl: string;
}

interface CeeveeRequest {
  profile: Profile;
  posts: Post[];
  focusPillar?: string; // Optional focus area (e.g. Sales, Recruiting)
}

interface Insight {
  category: string;
  title: string;
  description: string;
  evidence: string[];
}

interface Icebreaker {
  type: string;
  text: string;
  rationale: string;
  rating: number; // 0 to 100
}

interface ProspectReport {
  profile: Profile;
  summary: {
    roleLevel: string;
    industryHints: string[];
    communicationStyle: string;
  };
  insights: Insight[];
  icebreakers: Icebreaker[];
  meta: {
    postsAnalyzed: number;
    generatedAt: string;
  };
}

// ── Utility: Strip emojis and clean text ──────────────────────────────────────

function cleanText(text: string): string {
  return text.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}\u{1F100}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{1FA70}-\u{1FAFF}\u{E0020}-\u{E007F}\u{2300}-\u{23FF}\u{2500}-\u{25FF}\u{2B00}-\u{2BFF}\u{200D}\u{FE0F}]/gu, '').replace(/\s+/g, ' ').trim();
}

// ── Role & Industry Extraction ────────────────────────────────────────────────

function extractRoleLevel(headline: string): string {
  const lower = headline.toLowerCase();
  if (/(founder|ceo|owner|president|co-founder|chief)/.test(lower)) return "C-Level / Founder";
  if (/(vp|vice president|head of|director)/.test(lower)) return "Executive / VP / Director";
  if (/(manager|lead|supervisor)/.test(lower)) return "Managerial";
  if (/(senior|sr|principal|staff)/.test(lower)) return "Senior Individual Contributor";
  return "Professional";
}

function extractIndustryHints(headline: string, posts: string[]): string[] {
  const allText = (headline + " " + posts.join(" ")).toLowerCase();
  const industries: Record<string, string[]> = {
    "SaaS & Tech": ["software", "ai", "tech", "cloud", "saas", "engineering", "developer"],
    "Sales & GTM": ["sales", "gtm", "revenue", "account executive", "b2b", "outbound"],
    "Marketing": ["marketing", "growth", "seo", "brand", "content", "social media"],
    "Finance": ["finance", "capital", "investment", "accounting", "wealth", "fintech"],
    "HR & Recruiting": ["recruiting", "talent", "hr", "hiring", "culture", "people"],
    "Healthcare": ["health", "medical", "care", "clinical", "hospital", "pharma"],
    "Real Estate": ["real estate", "property", "broker", "realtor", "commercial"]
  };

  const detected: string[] = [];
  for (const [ind, terms] of Object.entries(industries)) {
    if (terms.some(t => allText.includes(t))) detected.push(ind);
  }
  return detected.slice(0, 3);
}

// ── Communication Style Extraction ─────────────────────────────────────────────

function analyzeCommunicationStyle(posts: string[]): string {
  if (!posts.length) return "Unknown (Insufficient data)";
  const allText = posts.join(" ");
  const sentences = allText.split(/[.!?]+/).filter((s) => s.trim().length > 5);
  const avgLen = sentences.reduce((a, s) => a + s.split(" ").length, 0) / Math.max(sentences.length, 1);
  
  const hasEmojis = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}]/u.test(posts.join(" "));
  const usesQuestions = posts.filter(p => p.includes("?")).length > posts.length / 3;

  if (avgLen < 12 && hasEmojis && usesQuestions) return "Casual, engaging, and direct";
  if (avgLen > 20 && !usesQuestions) return "Formal, detailed, and narrative-driven";
  if (avgLen < 15 && usesQuestions) return "Punchy and conversational";
  return "Balanced and professional";
}

// ── Keyword / Top of Mind Extraction ──────────────────────────────────────────

function extractTopKeywords(posts: string[]): string[] {
  const allText = posts.map(cleanText).join(" ").toLowerCase();
  const words = allText.replace(/[^a-z\s]/g, " ").split(/\s+/);
  const stopWords = new Set(["the","a","an","and","or","but","in","on","at","to","for","of","with","is","are","was","were","be","been","have","has","had","do","does","did","will","would","could","should","may","might","i","you","he","she","we","they","it","this","that","my","your","our","their","not","no","so","if","as","from","by","about","into","than","more","when","how","what","who","which","can","just","like","up","out","get","all","one", "some", "very", "much"]);
  
  const freq: Record<string, number> = {};
  words.forEach(w => {
    if (w.length > 4 && !stopWords.has(w)) {
      freq[w] = (freq[w] || 0) + 1;
    }
  });

  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([w]) => w);
}

// ── Generate Report ────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { profile, posts = [], focusPillar = "General" } = body as CeeveeRequest;

    if (!profile || !profile.name) {
      return NextResponse.json({ error: "Profile data is required" }, { status: 400 });
    }

    const postTexts = posts.map(p => p.text).filter(Boolean);
    const firstName = profile.name.split(" ")[0];
    
    const roleLevel = extractRoleLevel(profile.headline);
    const industries = extractIndustryHints(profile.headline, postTexts);
    const commStyle = analyzeCommunicationStyle(postTexts);
    const keywords = extractTopKeywords(postTexts);

    // Filter top posts to find evidence
    const topEngaged = [...posts].sort((a, b) => (b.reactionsCount + b.commentsCount) - (a.reactionsCount + a.commentsCount)).slice(0, 3);

    const insights: Insight[] = [];
    
    // Insight 1: Current Focus
    insights.push({
      category: "Content Strategy",
      title: "Current Professional Focus",
      description: `Based on their recent posts, ${firstName} is highly focused on ${keywords.slice(0, 3).join(", ") || "their specific niche"}. They seem to prioritize sharing actionable advice over personal anecdotes.`,
      evidence: topEngaged.length > 0 ? [cleanText(topEngaged[0].text).slice(0, 100) + "..."] : ["No recent posts available to verify."],
    });

    // Insight 2: Pain Points (Heuristic)
    const challenges = ["struggl", "hard", "difficult", "challenge", "problem", "issue", "fail", "cost", "expensive", "slow"];
    const painPost = posts.find(p => challenges.some(c => p.text.toLowerCase().includes(c)));
    
    insights.push({
      category: "Pain Points",
      title: "Identified Challenges",
      description: painPost ? `They recently discussed challenges related to ${extractTopKeywords([painPost.text])[0] || "industry changes"}. This indicates an openness to solutions focusing on efficiency or problem-solving.` : `No explicit challenges mentioned recently. They maintain a predominantly positive/educational tone. Focus outreach on value-add rather than fixing immediate problems.`,
      evidence: painPost ? [cleanText(painPost.text).slice(0, 120) + "..."] : [],
    });

    // Icebreakers
    const icebreakers: Icebreaker[] = [];

    // Approach 1: Compliment & Question
    if (topEngaged.length > 0) {
      const topOpener = cleanText(topEngaged[0].text).split('\n')[0].slice(0, 60);
      icebreakers.push({
        type: "Content Relevance",
        text: `Hey ${firstName},\n\nLoved your recent post about "${topOpener}...". It got me thinking about how ${industries[0] || "your industry"} is shifting right now.\n\nAre you currently looking into ways to automate that part of your workflow?`,
        rationale: `References their top-performing post directly to prove you aren't sending an automated blast. Uses their confirmed interest to segue into your value proposition.`,
        rating: 95
      });
    }

    // Approach 2: Persona-based
    icebreakers.push({
      type: "Persona Match",
      text: `Hi ${firstName},\n\nNoticed you're leading the charge as a ${roleLevel} in the ${industries[0] || "tech space"}. Usually, leaders in your position are dealing with [Insert Your Solution's Problem].\n\nIs this something your team is currently prioritizing?`,
      rationale: `Leverages their exact seniority and industry to build instant credibility. Acknowledges their authority.`,
      rating: 88
    });

    // Approach 3: Keyword Common Ground
    if (keywords.length >= 2) {
      icebreakers.push({
        type: "Keyword Alignment",
        text: `${firstName},\n\nSeeing your thoughts on ${keywords[0]} and ${keywords[1]} perfectly aligns with what we're building.\n\nWould you be open to a quick chat to see if there's mutual value?`,
        rationale: `Uses the exact vocabulary they use in their own posts, creating subconscious alignment.`,
        rating: 85
      });
    } else {
      icebreakers.push({
        type: "Direct Value",
        text: `Hey ${firstName},\n\nI'll keep this brief. Your work at [Company Name] stood out to me. We help teams in ${industries[0] || "your sector"} achieve [Outcome].\n\nWorth a 3-minute read if I send over some info?`,
        rationale: `Short, punchy, and respects their time. Good fallback when minimal post data is available.`,
        rating: 80
      });
    }

    const report: ProspectReport = {
      profile,
      summary: {
        roleLevel,
        industryHints: industries,
        communicationStyle: commStyle
      },
      insights,
      icebreakers,
      meta: {
        postsAnalyzed: posts.length,
        generatedAt: new Date().toISOString()
      }
    };

    return NextResponse.json(report);
  } catch (error: any) {
    console.error("Ceevee Error:", error);
    return NextResponse.json({ error: error.message || "Failed to generate report" }, { status: 500 });
  }
}
