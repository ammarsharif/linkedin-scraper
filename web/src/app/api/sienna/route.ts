import { NextRequest, NextResponse } from "next/server";

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
  sourcePostUrl?: string; // which viral post this formula was derived from
  derivedFrom?: string; // short label like "Post with 2,400 reactions"
  dinaCaptionPrompt?: string; // generated prompt for the caption
  dinaImagePrompt?: string; // generated prompt for the image
}

interface TopPost {
  text: string;
  reactionsCount: number;
  commentsCount: number;
  repostsCount: number;
  postUrl: string;
  engagementScore: number;
  hookFormula: string; // what hook pattern this post used
  openingLine: string; // the first line / hook of the post
  percentileRank: number; // 100 = top post, lower = less viral
}

interface CreatorPattern {
  dominantThemes: string[];
  writingStyle: string;
  avgEngagement: number;
  topPostKeywords: string[];
  contentPillars: string[];
  authoritySignals: string[];
  topPostsUsed: number; // how many posts were used to derive hooks
  totalPostsAnalyzed: number;
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

// ── Extract the opening line cleanly ─────────────────────────────────────────

function extractOpeningLine(text: string): string {
  const lines = text
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return lines[0]?.slice(0, 120) || text.slice(0, 120);
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

  // Score and sort ALL posts
  const scored = posts
    .filter((p) => p.text?.trim())
    .map((p) => ({ ...p, engagementScore: scorePost(p) }))
    .sort((a, b) => b.engagementScore - a.engagementScore);

  if (!scored.length) return empty;

  const maxScore = scored[0].engagementScore;

  // ─── Select top performers ───────────────────────────────────────────────
  // Take top 30% but at least 3, at most 10 posts
  const topCount = Math.min(Math.max(3, Math.ceil(scored.length * 0.3)), 10);
  const topScored = scored.slice(0, topCount);

  // Build TopPost objects with formula + opening line
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

  // ─── Analyze only the top posts for patterns ─────────────────────────────
  const allText = topScored.map((p) => p.text).join(" ");

  const authorityTerms = [
    "CEO",
    "founder",
    "expert",
    "years",
    "built",
    "scaled",
    "millions",
    "team",
    "led",
    "created",
    "launched",
    "grew",
    "achieved",
    "hired",
    "raised",
    "revenue",
    "clients",
    "customers",
    "startup",
    "company",
    "leadership",
    "strategy",
    "data",
    "results",
    "proven",
  ];

  const emotionTerms = [
    "mistake",
    "lesson",
    "truth",
    "secret",
    "fail",
    "wrong",
    "bad",
    "shocked",
    "surprised",
    "never",
    "always",
    "everyone",
    "nobody",
    "changed",
    "transformed",
    "fired",
    "quit",
    "left",
  ];

  const foundAuthority = authorityTerms.filter((t) =>
    allText.toLowerCase().includes(t.toLowerCase()),
  );
  const foundEmotion = emotionTerms.filter((t) =>
    allText.toLowerCase().includes(t.toLowerCase()),
  );

  // Writing style from top posts
  const sentences = allText.split(/[.!?]+/).filter((s) => s.trim().length > 10);
  const avgSentenceLen =
    sentences.reduce((a, s) => a + s.split(" ").length, 0) /
    Math.max(sentences.length, 1);

  let writingStyle = "balanced";
  if (avgSentenceLen < 8) writingStyle = "punchy-short";
  else if (avgSentenceLen > 20) writingStyle = "detailed-narrative";
  else writingStyle = "structured-storytelling";

  // Content pillars
  const pillarKeywords: Record<string, string[]> = {
    "Leadership & Management": [
      "team",
      "leader",
      "manage",
      "hire",
      "culture",
      "CEO",
    ],
    Entrepreneurship: [
      "startup",
      "founder",
      "build",
      "launch",
      "scale",
      "business",
    ],
    "Personal Growth": [
      "learn",
      "growth",
      "mistake",
      "lesson",
      "mindset",
      "habit",
    ],
    "Career Advice": [
      "job",
      "career",
      "salary",
      "interview",
      "LinkedIn",
      "resume",
    ],
    "Marketing & Sales": [
      "client",
      "revenue",
      "sell",
      "brand",
      "content",
      "market",
    ],
    "Technology & AI": ["AI", "tech", "software", "data", "automation", "tool"],
    "Finance & Investing": [
      "money",
      "invest",
      "wealth",
      "income",
      "finance",
      "rich",
    ],
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

  // Top keywords from high-engagement posts only
  const stopWords = new Set([
    "the",
    "a",
    "an",
    "and",
    "or",
    "but",
    "in",
    "on",
    "at",
    "to",
    "for",
    "of",
    "with",
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "have",
    "has",
    "had",
    "do",
    "does",
    "did",
    "will",
    "would",
    "could",
    "should",
    "may",
    "might",
    "i",
    "you",
    "he",
    "she",
    "we",
    "they",
    "it",
    "this",
    "that",
    "my",
    "your",
    "our",
    "their",
    "its",
    "not",
    "no",
    "so",
    "if",
    "as",
    "from",
    "by",
    "about",
    "into",
    "than",
    "more",
    "when",
    "how",
    "what",
    "who",
    "which",
    "can",
    "just",
    "like",
    "up",
    "out",
    "get",
    "all",
    "one",
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

// ── Hook generation — derived from actual top posts ──────────────────────────

function generateHooks(
  profiles: Profile[],
  pattern: CreatorPattern,
  topPosts: TopPost[],
  tone: string,
  hookCount: number,
): HookVariant[] {
  const isMulti = profiles.length > 1;
  const name = isMulti
    ? "These top creators"
    : profiles[0]?.name?.split(" ")[0] || "This creator";
  const posName = isMulti ? "These top creators'" : `${name}'s`;
  const pillars = pattern.contentPillars;
  const keywords = pattern.topPostKeywords;
  const authority = pattern.authoritySignals;

  const pillar0 = pillars[0] || "their niche";
  const pillar1 = pillars[1] || "growth";
  const keyword0 = keywords[0] || "success";
  const keyword1 = keywords[1] || "strategy";

  const topPost = topPosts[0];
  const secondPost = topPosts[1];
  const thirdPost = topPosts[2];

  // ── Formula-derived hooks (grounded in actual top posts) ─────────────────
  //    Each hook references what formula the real viral posts used,
  //    making the output actionable and data-driven.

  const hooks: HookVariant[] = [];

  // 1. Mirror formula of #1 post
  if (topPost) {
    hooks.push({
      type: `Mirror: ${topPost.hookFormula}`,
      hook: buildMirrorHook(topPost, name, posName, keyword0, pillar0),
      rationale: `Directly mirrors the hook formula of ${posName} highest-engagement post (${topPost.engagementScore.toLocaleString()} engagement score). Proven to work for this creator's audience.`,
      emotionalTrigger: "Pattern recognition + proven formula confidence",
      engagementScore: 97,
      sourcePostUrl: topPost.postUrl,
      derivedFrom: `#1 post · ${topPost.reactionsCount.toLocaleString()} reactions`,
    });
  }

  // 2. Mirror formula of #2 post
  if (secondPost) {
    hooks.push({
      type: `Mirror: ${secondPost.hookFormula}`,
      hook: buildMirrorHook(secondPost, name, posName, keyword1, pillar1),
      rationale: `Adapts the structural formula from ${posName} second-highest performer. Two different formulas working = the audience responds to variety — use both.`,
      emotionalTrigger: "Curiosity + analytical insight",
      engagementScore: 94,
      sourcePostUrl: secondPost.postUrl,
      derivedFrom: `#2 post · ${secondPost.reactionsCount.toLocaleString()} reactions`,
    });
  }

  // 3. Blend of top-2 formulas into one
  if (topPost && secondPost) {
    hooks.push({
      type: "Hybrid Formula (Top 2 Combined)",
      hook: `${posName} two best posts both started differently — one with ${topPost.hookFormula.toLowerCase()}, one with ${secondPost.hookFormula.toLowerCase()}.\n\nThe pattern underneath both:\n\n${buildPatternInsight(topPost, secondPost, keyword0)}`,
      rationale: `Cross-analyzing multiple viral posts reveals the deeper formula. Combining two proven hooks creates a richer, stickier opener.`,
      emotionalTrigger: "Meta-insight + intellectual satisfaction",
      engagementScore: 92,
      derivedFrom: `Top 2 posts combined`,
    });
  }

  // 4. Engagement comparison — data driven
  hooks.push({
    type: "Data-Driven Contrast",
    hook: `${posName} avg post gets ${pattern.avgEngagement.toLocaleString()} engagement.\n\nThe top ${pattern.topPostsUsed} posts? ${topPost ? (topPost.engagementScore * 2).toLocaleString() : "3×"} that.\n\nHere's the structural difference between their average and viral posts:`,
    rationale: `Contrast between average and viral creates the sharpest proof of pattern effectiveness. Uses real numbers from this creator's data.`,
    emotionalTrigger: "Data credibility + FOMO",
    engagementScore: 91,
    derivedFrom: `${pattern.totalPostsAnalyzed} posts analyzed`,
  });

  // 5. Opening line steal (show the exact first line of viral post)
  if (topPost) {
    hooks.push({
      type: "Opening Line Transplant",
      hook: `${posName} most viral post started like this:\n\n"${topPost.openingLine}"\n\n${topPost.reactionsCount.toLocaleString()} reactions later...\n\nHere's why that specific opening line worked — and how to write yours the same way:`,
      rationale: `Quoting an actual viral opener anchors credibility. Teaching the formula creates value — and makes you the authority who decoded it.`,
      emotionalTrigger: "Curiosity + reverse-engineering desire",
      engagementScore: 90,
      sourcePostUrl: topPost.postUrl,
      derivedFrom: `#1 post · ${topPost.hookFormula}`,
    });
  }

  // 6. Contrarian opener — drawn from found emotion terms
  hooks.push({
    type: "Contrarian Opener",
    hook: `Everyone says focus on ${keyword0}.\n\n${posName} data says otherwise.\n\nTheir highest-performing ${pillar0} posts don't lead with ${keyword0}. They lead with something else entirely:`,
    rationale:
      "Challenging the conventional advice forces the reader to pause and question their assumptions — the most reliable scroll-stop mechanism.",
    emotionalTrigger: "Intellectual curiosity + contrarian pull",
    engagementScore: 88,
    derivedFrom: `Pattern from top ${pattern.topPostsUsed} posts`,
  });

  // 7. Specificity hook (number of posts studied)
  hooks.push({
    type: "Research Authority",
    hook: `I studied ${pattern.totalPostsAnalyzed} posts from ${name}.\n\nOnly ${pattern.topPostsUsed} of them drove 80% of total engagement.\n\nHere's what made those ${pattern.topPostsUsed} posts structurally different from the rest:`,
    rationale: `Specific numbers signal rigour. The Pareto observation (few posts = most engagement) creates immediate intrigue about what the outliers did differently.`,
    emotionalTrigger: "Trust from thoroughness + FOMO on the formula",
    engagementScore: 89,
    derivedFrom: `All ${pattern.totalPostsAnalyzed} posts`,
  });

  // 8. Pattern interrupt
  hooks.push({
    type: "Pattern Interrupt",
    hook: `Stop.\n\nBefore you write your next ${pillar0} post — read how ${name} structures theirs.\n\nI analysed their top ${pattern.topPostsUsed} posts. This is what I found:`,
    rationale: `The directive 'Stop' is a genuine pattern interrupt that breaks scroll inertia. Scarcity of the insight ('I found') drives completion reading.`,
    emotionalTrigger: "Urgency + exclusive insight",
    engagementScore: 87,
    derivedFrom: `Top ${pattern.topPostsUsed} posts`,
  });

  // 9. Story hook grounded in top post context
  if (topPost) {
    hooks.push({
      type: "Transformation Story",
      hook: `Before I found ${posName} content strategy, I was posting about ${keyword0} every week.\n\nZero traction. Same 10 reactions.\n\nThen I reverse-engineered their top ${pattern.topPostsUsed} posts. Everything changed:`,
      rationale:
        "The before/after transformation arc is the most primally satisfying narrative structure. Readers project themselves into the 'before' state, creating urgency.",
      emotionalTrigger: "Empathy + aspiration + hope",
      engagementScore: 86,
      derivedFrom: `Top posts framework`,
    });
  }

  // 10. FOMO hook
  hooks.push({
    type: "FOMO / Urgency",
    hook: `While most ${pillar0} creators are still posting generic content…\n\n${name} quietly built a formula that averages ${pattern.avgEngagement.toLocaleString()} engagement per post.\n\nThe gap is widening. Here's the exact formula:`,
    rationale:
      "Competitive urgency drives action. The contrast between 'most creators' and this specific outlier makes the reader feel behind — and motivates them to close the gap.",
    emotionalTrigger: "Competitive anxiety + desire to catch up",
    engagementScore: 85,
    derivedFrom: `Avg. engagement data`,
  });

  // 11. Bold claim
  hooks.push({
    type: "Bold Claim",
    hook: `This is the best ${pillar0} content strategy on LinkedIn right now.\n\nI've compared dozens of creators. ${posName} top posts are structurally different — and the engagement numbers prove it.\n\nHere's the framework (apply it):`,
    rationale:
      "Superlative claims demand verification. 'The numbers prove it' shifts from opinion to evidence — increasing reader trust.",
    emotionalTrigger: "Validation-seeking + resource acquisition",
    engagementScore: 84,
    derivedFrom: `Comparative post analysis`,
  });

  // 12. Third post formula (if available)
  if (thirdPost) {
    hooks.push({
      type: `Formula: ${thirdPost.hookFormula}`,
      hook: buildMirrorHook(thirdPost, name, posName, keyword0, pillar0),
      rationale: `Derived from ${posName} 3rd highest-performing post. Using the ${thirdPost.hookFormula} structure — a proven formula for this specific audience.`,
      emotionalTrigger: "Familiarity + proven trust",
      engagementScore: 83,
      sourcePostUrl: thirdPost.postUrl,
      derivedFrom: `#3 post · ${thirdPost.reactionsCount.toLocaleString()} reactions`,
    });
  }

  const toneMap: Record<string, (h: HookVariant) => HookVariant> = {
    professional: (h) => ({
      ...h,
      hook: `${h.hook
        .replace(/\bsteal\b/gi, "leverage")
        .replace(/\bkill\b/gi, "outperform")}`,
    }),
    bold: (h) => ({
      ...h,
      hook: `[Bold Take]\n${h.hook}\n\nNo excuses. Period. 🔥`,
      engagementScore: Math.min(100, h.engagementScore + 3),
    }),
    conversational: (h) => ({
      ...h,
      hook: `[Quick thought]\n${h.hook.replace(
        /\bThe formula:\b/gi,
        "What's the secret? It's simple:",
      )}`,
    }),
    inspirational: (h) => ({
      ...h,
      hook: `[Growth Mindset]\n${h.hook}\n\nRemember: your potential is limitless. Keep building. 🚀`,
      engagementScore: Math.min(100, h.engagementScore + 1),
    }),
  };

  const toneProcessor = toneMap[tone] || ((h: HookVariant) => h);
  const processed = hooks.map(toneProcessor);

  // Inject Dina AI Prompt for each hook
  const finalHooks = processed.map((h) => {
    // Extract the original opener if we have a direct reference
    const matchedPost = h.sourcePostUrl
      ? topPosts.find((p) => p.postUrl === h.sourcePostUrl)
      : null;
    let openerInstruction = `- Write a NEW post starting with this exact proven framework: "${h.type}"`;

    if (matchedPost) {
      openerInstruction += `\n- Here is the actual original viral opener for reference: "${matchedPost.openingLine}"\n- Adapt this hook structure for MY topic below. DO NOT mention the original creator's name.`;
    }

    // Clean up the meta commentary so the bot understands the logic instructions plainly
    const cleanLogic = h.hook
      .replace(/\[.*?\]\n/g, "")
      .replace(/\n\n/g, " ")
      .trim();

    const captionPrompt = `[SYSTEM ROLE]
You are Dina, an elite-level Executive Ghostwriter and LinkedIn Strategist. You specialize in crafting high-converting, pattern-interrupting posts that drive massive engagement without sounding clickbaity or AI-generated.

[CORE OBJECTIVE]
Write a highly engaging, viral-worthy LinkedIn post tailored to my profile. You must strictly follow the proven hook framework and structural psychology provided below. 

[VIRAL FRAMEWORK]
${openerInstruction}
• Psychological Breakdown (Apply This Logic): ${cleanLogic}
• Core Emotional Trigger to Hit: ${h.rationale}

[CONTENT DETAILS]
• Primary Topic / Pillar: ${pillar0}
• Required Keywords: ${keywords.slice(0, 3).join(", ")}
• Target Tone: ${tone.toUpperCase()}
• Structural Style: ${pattern.writingStyle}

[STRICT CONSTRAINTS]
1. ZERO AI JARGON: Completely avoid words like "In today's fast-paced world", "Unlock", "Delve", "Crucial", "Tapestry", "Elevate", "Dive in", or "Testament".
2. LENGTH & FORMATTING: Keep the total post concise, punchy, and highly readable (around 100-150 words). DO NOT write a massive essay that bores people. Use generous whitespace. Maximum 1-2 sentences per paragraph. Optimized for mobile scrolling.
3. FLOW: Hook the reader immediately → Build tension or curiosity → Deliver the value directly → End with a strong, single-focus closing to drive comments.
4. OUTPUT: Render ONLY the final post text. Do not include any intro, outro, or meta-commentary. Write exactly like a top 1% human creator.`;

    const imagePrompt = `Generate a hyper-realistic, premium image that directly complements a LinkedIn post about ${pillar0}.

[SCENE DETAILS]
• Subject Matter: A candid, natural-looking professional scene (e.g., diverse executives, modern workspaces, abstract data) evoking the emotion of "${h.emotionalTrigger}".
• Aesthetic: Cinematic lighting, 8k resolution, highly detailed, photorealistic, premium corporate/abstract lifestyle. Minimalist and sleek.
• Context: Weave subtle visual metaphors representing [ ${keywords.slice(0, 3).join(", ")} ] into the scene without using text.
• Camera Settings: Shot on Canon EOS R5, shallow depth of field, dramatic shadows, sharp focus on the main subject.

[CRITICAL CONSTRAINTS (MANDATORY)]
NO TEXT. NO LETTERS. NO WORDS. NO LOGOS.
NO CARTOONY GRAPHICS. NO AI MANNEQUIN FACES.
Ensure the final result looks exactly like an ultra-high-end, candid stock photo.`;

    return {
      ...h,
      dinaCaptionPrompt: captionPrompt,
      dinaImagePrompt: imagePrompt,
    };
  });

  return finalHooks
    .sort((a, b) => b.engagementScore - a.engagementScore)
    .slice(0, hookCount);
}

// ── Hook builders for specific formulas ──────────────────────────────────────

function buildMirrorHook(
  post: TopPost,
  name: string,
  posName: string,
  keyword: string,
  pillar: string,
): string {
  switch (post.hookFormula) {
    case "Personal story / vulnerability":
      return `I made a ${keyword} mistake last year that cost me 3 months.\n\n${name} made the same kind of mistake — but turned it into their most viral post.\n\nHere's what they wrote, and the formula behind it:`;
    case "Numbered list promise":
      return `${name} posted a list about ${pillar}.\n\nIt got ${post.reactionsCount.toLocaleString()}+ reactions.\n\nI broke down why each point worked — and turned it into a reusable framework:`;
    case "Pattern interrupt / directive":
      return `Stop creating ${keyword} content the old way.\n\n${posName} most viral posts don't start with a lesson. They start with a command.\n\nHere's the structural reason why commands outperform questions as openers:`;
    case "Hot take / contrarian":
      return `Unpopular opinion:\n\nMost ${pillar} advice is noise.\n\n${name} proves this every week — with posts that challenge the defaults and rack up ${post.reactionsCount.toLocaleString()}+ reactions. Here's their actual contrarian formula:`;
    case "Question hook":
      return `Why does ${posName} ${pillar} content consistently outperform everyone else?\n\nIt's not the topic. It's not even the visuals.\n\nIt's the structure of their opening question. Here's how to replicate it:`;
    case "Reveal / secret frame":
      return `The real reason ${posName} posts on ${keyword} go viral:\n\nIt's not what they say.\n\nIt's how they frame the opening. Here's the exact reveal structure they use — and why it works:`;
    case "Statistic / data lead":
      return `${name} opened their best post with a single number.\n\n${post.reactionsCount.toLocaleString()} people reacted.\n\nData-led hooks are the most powerful on LinkedIn. Here's the template they used:`;
    case "Contrast against the crowd":
      return `Most ${pillar} creators post the same things.\n\n${name} posts the opposite — and their engagement shows it.\n\nHere's the contrasting structure that made their top post break through:`;
    default:
      return `${posName} most viral ${pillar} post used a deceptively simple opener.\n\n${post.reactionsCount.toLocaleString()} reactions.\n\nHere's the exact hook formula, broken down line by line:`;
  }
}

function buildPatternInsight(
  postA: TopPost,
  postB: TopPost,
  keyword: string,
): string {
  return `Both create immediate tension in the first line — either through contrast, data, or a direct challenge.\n\nNeither starts with "I want to share…" or "Here are my thoughts on ${keyword}."\n\nThe formula: open with tension → promise resolution → deliver through a structured breakdown.`;
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

    const { pattern, topPosts } = analyzeCreatorPatterns(posts);

    const hooks = generateHooks(
      profiles,
      pattern,
      topPosts,
      tone,
      Math.min(Math.max(1, hookCount), 15),
    );

    console.log(
      `[sienna] Generated ${hooks.length} hooks from top ${pattern.topPostsUsed}/${pattern.totalPostsAnalyzed} posts`,
    );

    return NextResponse.json({
      success: true,
      profiles,
      patterns: pattern,
      hooks,
      topPosts: topPosts.slice(0, 5), // return top 5 for UI display
      meta: {
        postsAnalyzed: posts.length,
        topPostsUsed: pattern.topPostsUsed,
        tone,
        generatedAt: new Date().toISOString(),
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
