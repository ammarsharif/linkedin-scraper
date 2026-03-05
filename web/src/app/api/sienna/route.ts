import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

export const maxDuration = 60;

// ── Types ─────────────────────────────────────────────────────────────────────

interface Post {
  text: string;
  reactionsCount: number;
  commentsCount: number;
  repostsCount: number;
  postedDate: string;
  postUrl: string;
}

interface Profile {
  name: string;
  headline: string;
  location: string;
  profileUrl: string;
}

interface SiennaRequest {
  profiles: Profile[];
  posts: Post[];
  tone?: "professional" | "conversational" | "bold" | "inspirational";
  hookCount?: number;
}

interface HookVariant {
  type: string;
  hook: string;
  rationale: string;
  emotionalTrigger: string;
  engagementScore: number;
  sourcePostUrl?: string;
  derivedFrom?: string;
  sourcePostIndex?: number | null;
}

interface TopPost {
  text: string;
  reactionsCount: number;
  commentsCount: number;
  repostsCount: number;
  postUrl: string;
  engagementScore: number;
  hookFormula: string;
  openingLine: string;
  percentileRank: number;
}

interface CreatorPattern {
  dominantThemes: string[];
  writingStyle: string;
  avgEngagement: number;
  topPostKeywords: string[];
  contentPillars: string[];
  authoritySignals: string[];
  topPostsUsed: number;
  totalPostsAnalyzed: number;
}

// ── OpenAI client ─────────────────────────────────────────────────────────────

function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY environment variable is not set.");
  }
  return new OpenAI({ apiKey });
}

// ── Engagement scoring ────────────────────────────────────────────────────────

function scorePost(p: Post): number {
  return (
    (p.reactionsCount || 0) * 1 +
    (p.commentsCount || 0) * 3 +
    (p.repostsCount || 0) * 2
  );
}

// ── Detect the hook formula from the first line of a post ────────────────────

function detectHookFormula(text: string): string {
  const first = text.split(/\n/)[0].trim();
  const lower = first.toLowerCase();

  if (
    /^\d+\s+(things|ways|tips|lessons|reasons|mistakes|rules|steps)/i.test(
      first,
    )
  )
    return "Numbered list promise";
  if (
    /^(i|we)\s+(used to|once|just|recently|made|failed|quit|left|got)/i.test(
      first,
    )
  )
    return "Personal story / vulnerability";
  if (/^(stop|don't|never|avoid)/i.test(first))
    return "Pattern interrupt / directive";
  if (
    /^(unpopular opinion|hot take|controversial|nobody talks about)/i.test(
      lower,
    )
  )
    return "Hot take / contrarian";
  if (/\?$/.test(first)) return "Question hook";
  if (/^(the truth|the secret|the real reason|the one thing)/i.test(lower))
    return "Reveal / secret frame";
  if (/^\d+[\s%,]+/.test(first) || /\d{3,}/.test(first))
    return "Statistic / data lead";
  if (/^(after|when|how)\s/i.test(first)) return "Experience / process reveal";
  if (/^(most people|everyone|nobody|no one)/i.test(lower))
    return "Contrast against the crowd";
  if (/^(here['']?s|this is|this will|this changed)/i.test(lower))
    return "Direct value promise";
  return "Strong statement opener";
}

// ── Utility: Strip emojis ───────────────────────────────────────────────────

function stripEmojis(text: string): string {
  return text
    .replace(
      /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}\u{1F100}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{1FA70}-\u{1FAFF}\u{E0020}-\u{E007F}\u{2300}-\u{23FF}\u{2500}-\u{25FF}\u{2B00}-\u{2BFF}\u{200D}\u{FE0F}]/gu,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
}

// ── Extract the opening line cleanly ─────────────────────────────────────────

function extractOpeningLine(text: string): string {
  const lines = text
    .split(/\n/)
    .map((l) => stripEmojis(l.trim()))
    .filter(Boolean);
  return lines[0]?.slice(0, 120) || stripEmojis(text).slice(0, 120);
}

// ── Core analysis — only runs on top-performing posts ─────────────────────────

function analyzeCreatorPatterns(posts: Post[]): {
  pattern: CreatorPattern;
  topPosts: TopPost[];
} {
  const empty = {
    pattern: {
      dominantThemes: [],
      writingStyle: "unknown",
      avgEngagement: 0,
      topPostKeywords: [],
      contentPillars: [],
      authoritySignals: [],
      topPostsUsed: 0,
      totalPostsAnalyzed: 0,
    },
    topPosts: [],
  };
  if (!posts.length) return empty;

  const scored = posts
    .filter((p) => p.text?.trim())
    .map((p) => ({ ...p, engagementScore: scorePost(p) }))
    .sort((a, b) => b.engagementScore - a.engagementScore);

  if (!scored.length) return empty;

  const maxScore = scored[0].engagementScore;

  const topCount = Math.min(Math.max(3, Math.ceil(scored.length * 0.3)), 10);
  const topScored = scored.slice(0, topCount);

  const topPosts: TopPost[] = topScored.map((p) => ({
    text: p.text,
    reactionsCount: p.reactionsCount || 0,
    commentsCount: p.commentsCount || 0,
    repostsCount: p.repostsCount || 0,
    postUrl: p.postUrl || "",
    engagementScore: p.engagementScore,
    hookFormula: detectHookFormula(p.text),
    openingLine: extractOpeningLine(p.text),
    percentileRank:
      maxScore > 0 ? Math.round((p.engagementScore / maxScore) * 100) : 0,
  }));

  const allText = topScored.map((p) => p.text).join(" ");

  const authorityTerms = [
    "CEO", "founder", "expert", "years", "built", "scaled", "millions",
    "team", "led", "created", "launched", "grew", "achieved", "hired",
    "raised", "revenue", "clients", "customers", "startup", "company",
    "leadership", "strategy", "data", "results", "proven",
  ];

  const emotionTerms = [
    "mistake", "lesson", "truth", "secret", "fail", "wrong", "bad",
    "shocked", "surprised", "never", "always", "everyone", "nobody",
    "changed", "transformed", "fired", "quit", "left",
  ];

  const foundAuthority = authorityTerms.filter((t) =>
    allText.toLowerCase().includes(t.toLowerCase()),
  );
  const foundEmotion = emotionTerms.filter((t) =>
    allText.toLowerCase().includes(t.toLowerCase()),
  );

  const sentences = allText.split(/[.!?]+/).filter((s) => s.trim().length > 10);
  const avgSentenceLen =
    sentences.reduce((a, s) => a + s.split(" ").length, 0) /
    Math.max(sentences.length, 1);

  let writingStyle = "balanced";
  if (avgSentenceLen < 8) writingStyle = "punchy-short";
  else if (avgSentenceLen > 20) writingStyle = "detailed-narrative";
  else writingStyle = "structured-storytelling";

  const pillarKeywords: Record<string, string[]> = {
    "Leadership & Management": ["team", "leader", "manage", "hire", "culture", "CEO"],
    Entrepreneurship: ["startup", "founder", "build", "launch", "scale", "business"],
    "Personal Growth": ["learn", "growth", "mistake", "lesson", "mindset", "habit"],
    "Career Advice": ["job", "career", "salary", "interview", "LinkedIn", "resume"],
    "Marketing & Sales": ["client", "revenue", "sell", "brand", "content", "market"],
    "Technology & AI": ["AI", "tech", "software", "data", "automation", "tool"],
    "Finance & Investing": ["money", "invest", "wealth", "income", "finance", "rich"],
  };

  const contentPillars = Object.entries(pillarKeywords)
    .filter(([, kws]) =>
      kws.some((k) => allText.toLowerCase().includes(k.toLowerCase())),
    )
    .map(([pillar]) => pillar)
    .slice(0, 3);

  const avgEngagement = Math.round(
    topScored.reduce((a, p) => a + p.engagementScore, 0) / topScored.length,
  );

  const stopWords = new Set([
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "is", "are", "was", "were", "be", "been", "have", "has",
    "had", "do", "does", "did", "will", "would", "could", "should", "may",
    "might", "i", "you", "he", "she", "we", "they", "it", "this", "that",
    "my", "your", "our", "their", "its", "not", "no", "so", "if", "as",
    "from", "by", "about", "into", "than", "more", "when", "how", "what",
    "who", "which", "can", "just", "like", "up", "out", "get", "all", "one",
  ]);

  const wordFreq: Record<string, number> = {};
  allText
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !stopWords.has(w))
    .forEach((w) => {
      wordFreq[w] = (wordFreq[w] || 0) + 1;
    });

  const topPostKeywords = Object.entries(wordFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([word]) => word);

  return {
    topPosts,
    pattern: {
      dominantThemes: [
        ...foundEmotion.slice(0, 3),
        ...foundAuthority.slice(0, 3),
      ],
      writingStyle,
      avgEngagement,
      topPostKeywords,
      contentPillars,
      authoritySignals: foundAuthority.slice(0, 5),
      topPostsUsed: topScored.length,
      totalPostsAnalyzed: scored.length,
    },
  };
}

// ── Voice extraction — real linguistic fingerprint from top posts ─────────────

interface CreatorVoice {
  openingLines: string[];
  usesIStatements: boolean;
  usesQuestions: boolean;
  usesEmDashes: boolean;
  usesLists: boolean;
  avgWordsPerSentence: number;
  sentenceRhythm: string;
  repeatedPhrases: string[];
  repeatedVocabulary: string[];
  mostUsedFormula: string;
  mostUsedOpenerType: string;
}

function extractCreatorVoice(topPosts: TopPost[]): CreatorVoice {
  const top5 = topPosts.slice(0, 5);
  const openingLines = top5.map((p) => p.openingLine);

  const allText = top5.map((p) => p.text).join("\n");
  const allSentences = allText
    .split(/[.!?\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 5);

  const usesIStatements =
    top5.filter((p) => /^I\s/i.test(p.openingLine)).length >= 2;
  const usesQuestions =
    top5.filter((p) => p.openingLine.endsWith("?")).length >= 2;
  const usesEmDashes = (allText.match(/[—–]/g) || []).length >= 3;
  const usesLists =
    top5.filter((p) => /^\d+[\.)\s]/m.test(p.text)).length >= 2;

  const wordCounts = allSentences.map((s) => s.split(/\s+/).length);
  const avgWordsPerSentence = wordCounts.length
    ? Math.round(wordCounts.reduce((a, b) => a + b, 0) / wordCounts.length)
    : 10;

  let sentenceRhythm: string;
  if (avgWordsPerSentence <= 6)
    sentenceRhythm = `Ultra-short punchy lines, averaging ${avgWordsPerSentence} words per sentence`;
  else if (avgWordsPerSentence <= 10)
    sentenceRhythm = `Short, rhythmic sentences averaging ${avgWordsPerSentence} words`;
  else if (avgWordsPerSentence <= 16)
    sentenceRhythm = `Medium-length structured sentences averaging ${avgWordsPerSentence} words`;
  else
    sentenceRhythm = `Longer narrative sentences averaging ${avgWordsPerSentence} words`;

  const postWordSets = top5.map((p) => {
    const words = p.text
      .toLowerCase()
      .replace(/[^a-z\s'-]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 4);
    return new Set(words);
  });

  const vocabFreq: Record<string, number> = {};
  for (const ws of postWordSets) {
    Array.from(ws).forEach((w) => {
      vocabFreq[w] = (vocabFreq[w] || 0) + 1;
    });
  }
  const repeatedVocabulary = Object.entries(vocabFreq)
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([word]) => word);

  const phraseFreq: Record<string, number> = {};
  for (const post of top5) {
    const words = post.text
      .toLowerCase()
      .replace(/[^a-z\s'-]/g, " ")
      .split(/\s+/)
      .filter(Boolean);
    for (let i = 0; i < words.length - 1; i++) {
      const bi = `${words[i]} ${words[i + 1]}`;
      if (bi.length > 6) phraseFreq[bi] = (phraseFreq[bi] || 0) + 1;
      if (i < words.length - 2) {
        const tri = `${words[i]} ${words[i + 1]} ${words[i + 2]}`;
        if (tri.length > 10) phraseFreq[tri] = (phraseFreq[tri] || 0) + 1;
      }
    }
  }
  const repeatedPhrases = Object.entries(phraseFreq)
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([phrase]) => phrase);

  const formulaCounts: Record<string, number> = {};
  for (const p of topPosts) {
    formulaCounts[p.hookFormula] = (formulaCounts[p.hookFormula] || 0) + 1;
  }
  const mostUsedFormula =
    Object.entries(formulaCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ||
    "Strong statement opener";

  const openerTypes: Record<string, number> = {};
  for (const p of top5) {
    const firstWord = p.openingLine.split(/\s/)[0]?.toLowerCase() || "";
    let openerType = "statement";
    if (/^(i|i'm|i've|i'd)$/i.test(firstWord)) openerType = "I-statement";
    else if (
      /^(why|what|how|when|where|who|do|does|did|is|are|can|would|should)$/i.test(
        firstWord,
      )
    )
      openerType = "question";
    else if (/^(stop|don't|never|avoid|quit)$/i.test(firstWord))
      openerType = "directive";
    else if (/^\d/.test(firstWord)) openerType = "number-lead";
    else if (/^(the|this|that|here)$/i.test(firstWord))
      openerType = "declarative";
    openerTypes[openerType] = (openerTypes[openerType] || 0) + 1;
  }
  const mostUsedOpenerType =
    Object.entries(openerTypes).sort((a, b) => b[1] - a[1])[0]?.[0] ||
    "statement";

  return {
    openingLines,
    usesIStatements,
    usesQuestions,
    usesEmDashes,
    usesLists,
    avgWordsPerSentence,
    sentenceRhythm,
    repeatedPhrases,
    repeatedVocabulary,
    mostUsedFormula,
    mostUsedOpenerType,
  };
}

// ── OpenAI-powered hook generation ───────────────────────────────────────────

async function generateHooksWithAI(
  openai: OpenAI,
  profiles: Profile[],
  pattern: CreatorPattern,
  topPosts: TopPost[],
  voice: CreatorVoice,
  tone: string,
  hookCount: number,
): Promise<HookVariant[]> {
  const isMulti = profiles.length > 1;
  const name = isMulti
    ? "These top creators"
    : profiles[0]?.name?.split(" ")[0] || "This creator";

  // Build context from real top posts — send substantial content for proper analysis
  const topPostSummaries = topPosts.slice(0, 7).map((p, i) => ({
    rank: i + 1,
    openingLine: p.openingLine,
    hookFormula: p.hookFormula,
    reactions: p.reactionsCount,
    comments: p.commentsCount,
    reposts: p.repostsCount,
    engagementScore: p.engagementScore,
    fullText: p.text.slice(0, 800),
    postUrl: p.postUrl,
  }));

  const systemPrompt = `You are Sienna, a viral LinkedIn hook engine. You reverse-engineer WHY a creator's top posts made people click "...see more" and generate hooks that exploit the same psychological triggers.

LINKEDIN "SEE MORE" PSYCHOLOGY:
LinkedIn shows only the first 2-3 lines (~210 characters) before truncating with "...see more". The ENTIRE job of a hook is to make that click IRRESISTIBLE. Top-performing hooks do this by:

1. OPEN LOOP — Start a story or statement that's impossible to leave unfinished
   Example: "I got fired on a Monday. By Friday, I had 3 offers. Here's what I did in between:"
   
2. CURIOSITY GAP — Promise specific value but withhold the answer
   Example: "After analyzing 500 LinkedIn posts, I found the #1 pattern that separates 10x engagement from zero."
   
3. PATTERN INTERRUPT — Say something unexpected that breaks the scroll
   Example: "Stop writing LinkedIn posts. Seriously. Do this instead:"
   
4. SPECIFIC NUMBERS + INCOMPLETE INFO — Lead with data but leave the insight behind the fold
   Example: "I spent 3 years building something nobody asked for. It now makes $40k/month."
   
5. CONTRARIAN BAIT — Challenge a widely-held belief to spark curiosity
   Example: "Everyone is wrong about personal branding. Here's what actually builds authority:"

6. CONFESSION / VULNERABILITY — Open with something raw that demands more context
   Example: "I almost quit last month. Not because of money. Because of something no one talks about."

CRITICAL RULES:
- Generate exactly ${hookCount} hooks
- Each hook: 2-3 lines max, MUST fit within LinkedIn's ~210 character preview
- The hook MUST create an INCOMPLETE thought — the reader needs to click "see more" to get the payoff
- ABSOLUTELY NO emojis
- Every hook MUST be about THIS CREATOR's actual topics (study their posts)
- Use this creator's vocabulary, rhythm, and sentence patterns
- Each hook uses a DIFFERENT formula from the list above
- End hooks with a colon, ellipsis, or cliffhanger — NEVER complete the thought
- Tone: ${tone.toUpperCase()}
- BANNED: "Unlock", "Delve", "Elevate", "Dive in", "In today's fast-paced world", "Game-changer", "Revolutionize", "Navigate", "Harness"
- sourcePostIndex: reference which real post inspired this hook

Respond in valid JSON only. No markdown, no code fences.

JSON Schema:
{
  "hooks": [
    {
      "type": "formula name (e.g. 'Open Loop', 'Curiosity Gap', 'Pattern Interrupt', 'Data Cliffhanger', 'Contrarian Bait', 'Confession')",
      "hook": "the 2-3 line hook that ends BEFORE the payoff",
      "rationale": "1 sentence: why this creates a 'see more' click, referencing the source post",
      "emotionalTrigger": "1 phrase (3-5 words): the psychological pull",
      "engagementScore": 70-99,
      "sourcePostIndex": 0-based index or null,
      "derivedFrom": "e.g. 'Post #1 structure' or 'Top 3 theme blend'"
    }
  ],
  "aiKeywords": ["up to 10 keywords from the posts that drive engagement"],
  "aiInsight": "1-2 sentences on what makes this creator's hooks irresistible"
}`;

  const userPrompt = `Study these viral posts from ${name}. Pay attention to how their OPENING LINES create curiosity that forces the "see more" click. Then generate ${hookCount} hooks that exploit the same psychology on the same topics.

CREATOR:
${profiles.map((p) => `${p.name} — ${p.headline}${p.location ? ` (${p.location})` : ""}`).join("\n")}

=== THEIR TOP POSTS (study the opening lines especially) ===
${topPostSummaries.map((p) => `
[POST #${p.rank}] ${p.reactions} reactions | ${p.comments} comments | ${p.reposts} reposts | Score: ${p.engagementScore}
Formula: ${p.hookFormula}
Opening line: "${p.openingLine}"
Full post:
${p.fullText}
`).join("\n---\n")}

=== PATTERNS DETECTED ===
Writing style: ${pattern.writingStyle}
Content pillars: ${pattern.contentPillars.join(", ") || "general professional"}
Recurring keywords: ${pattern.topPostKeywords.join(", ")}
Avg engagement score: ${pattern.avgEngagement}
Most used hook formula: ${voice.mostUsedFormula}
Sentence rhythm: ${voice.sentenceRhythm}
Repeated vocabulary: ${voice.repeatedVocabulary.slice(0, 10).join(", ")}
Repeated phrases: ${voice.repeatedPhrases.slice(0, 6).join(", ")}
Style traits: ${[
    voice.usesIStatements && '"I" openers',
    voice.usesQuestions && "question hooks",
    voice.usesEmDashes && "em-dashes",
    voice.usesLists && "numbered lists",
  ].filter(Boolean).join(", ") || "direct statements"}

Generate ${hookCount} hooks. EVERY hook must:
1. Be about THIS creator's actual topics (${pattern.contentPillars.slice(0, 2).join(", ") || "their niche"})
2. Create an OPEN LOOP or CURIOSITY GAP that forces "see more"
3. End with incomplete information — colon, ellipsis, or cliffhanger
4. Fit within ~210 characters (LinkedIn's preview limit)
5. Use this creator's own words and patterns
6. Link to a specific source post via sourcePostIndex`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.85,
    max_tokens: 3000,
    response_format: { type: "json_object" },
  });

  const raw = completion.choices[0]?.message?.content || "{}";
  let parsed: {
    hooks?: Array<{
      type: string;
      hook: string;
      rationale: string;
      emotionalTrigger: string;
      engagementScore: number;
      sourcePostIndex?: number | null;
      derivedFrom?: string;
    }>;
    aiKeywords?: string[];
    aiInsight?: string;
  };

  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error("[sienna] Failed to parse OpenAI response:", raw);
    throw new Error("Failed to parse AI response");
  }

  if (!parsed.hooks || !Array.isArray(parsed.hooks)) {
    throw new Error("AI response missing hooks array");
  }

  // Map AI hooks to our format
  const hooks: HookVariant[] = parsed.hooks.map((aiHook) => {
    const sourceIdx = aiHook.sourcePostIndex != null && aiHook.sourcePostIndex >= 0 && aiHook.sourcePostIndex < topPosts.length
      ? aiHook.sourcePostIndex
      : null;
    const sourcePost = sourceIdx != null ? topPosts[sourceIdx] : null;

    return {
      type: aiHook.type,
      hook: stripEmojis(aiHook.hook),
      rationale: aiHook.rationale,
      emotionalTrigger: aiHook.emotionalTrigger,
      engagementScore: Math.min(99, Math.max(50, aiHook.engagementScore || 75)),
      sourcePostUrl: sourcePost?.postUrl,
      derivedFrom: aiHook.derivedFrom || "AI analysis",
      sourcePostIndex: sourceIdx,
    };
  });

  return hooks
    .sort((a, b) => b.engagementScore - a.engagementScore)
    .slice(0, hookCount);
}

// Dina caption generation is now handled by /api/sienna/dina endpoint

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

    const body = (await req.json()) as SiennaRequest;
    const { profiles, posts, tone = "professional", hookCount = 8 } = body;

    if (!profiles || profiles.length === 0 || !posts || !Array.isArray(posts)) {
      return NextResponse.json(
        { error: "Invalid request: profiles array and posts array required" },
        { status: 400 },
      );
    }

    if (posts.length === 0) {
      return NextResponse.json(
        { error: "No posts provided. Please scrape at least 1 post first." },
        { status: 400 },
      );
    }

    console.log(
      `[sienna] Analysing ${posts.length} posts for ${profiles.map((p) => p.name).join(", ")}, tone=${tone}`,
    );

    // 1. Analyze patterns locally (fast, no AI needed)
    const { pattern, topPosts } = analyzeCreatorPatterns(posts);
    const voice = extractCreatorVoice(topPosts);

    // 2. Generate hooks with OpenAI
    const openai = getOpenAIClient();
    const clampedCount = Math.min(Math.max(1, hookCount), 15);

    const hooks = await generateHooksWithAI(
      openai,
      profiles,
      pattern,
      topPosts,
      voice,
      tone,
      clampedCount,
    );

    console.log(
      `[sienna] Generated ${hooks.length} AI-powered hooks from top ${pattern.topPostsUsed}/${pattern.totalPostsAnalyzed} posts`,
    );

    return NextResponse.json({
      success: true,
      profiles,
      patterns: pattern,
      hooks,
      topPosts: topPosts.slice(0, 5),
      voice: {
        sentenceRhythm: voice.sentenceRhythm,
        usesIStatements: voice.usesIStatements,
        usesQuestions: voice.usesQuestions,
        usesEmDashes: voice.usesEmDashes,
        usesLists: voice.usesLists,
        repeatedPhrases: voice.repeatedPhrases,
        repeatedVocabulary: voice.repeatedVocabulary,
      },
      meta: {
        postsAnalyzed: posts.length,
        topPostsUsed: pattern.topPostsUsed,
        tone,
        generatedAt: new Date().toISOString(),
        poweredBy: "openai",
      },
    });
  } catch (err) {
    console.error("[sienna] Fatal error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Sienna error: ${msg}` },
      { status: 500 },
    );
  }
}
