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

// ── Utility: Strip emojis ───────────────────────────────────────────────────

function stripEmojis(text: string): string {
  return text.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}\u{1F100}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{1FA70}-\u{1FAFF}\u{E0020}-\u{E007F}\u{2300}-\u{23FF}\u{2500}-\u{25FF}\u{2B00}-\u{2BFF}\u{200D}\u{FE0F}]/gu, '').replace(/\s+/g, ' ').trim();
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

  // Collect all text from top posts
  const allText = top5.map((p) => p.text).join("\n");
  const allSentences = allText
    .split(/[.!?\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 5);

  // Detect stylistic traits
  const usesIStatements =
    top5.filter((p) => /^I\s/i.test(p.openingLine)).length >= 2;
  const usesQuestions =
    top5.filter((p) => p.openingLine.endsWith("?")).length >= 2;
  const usesEmDashes = (allText.match(/[—–]/g) || []).length >= 3;
  const usesLists =
    top5.filter((p) =>
      /^\d+[\.\)]\s/m.test(p.text),
    ).length >= 2;

  // Sentence rhythm
  const wordCounts = allSentences.map((s) => s.split(/\s+/).length);
  const avgWordsPerSentence = wordCounts.length
    ? Math.round(
        wordCounts.reduce((a, b) => a + b, 0) / wordCounts.length,
      )
    : 10;

  let sentenceRhythm: string;
  if (avgWordsPerSentence <= 6)
    sentenceRhythm = `Ultra-short punchy lines, averaging ${avgWordsPerSentence} words per sentence with hard line breaks after each idea`;
  else if (avgWordsPerSentence <= 10)
    sentenceRhythm = `Short, rhythmic sentences averaging ${avgWordsPerSentence} words — punchy with frequent line breaks`;
  else if (avgWordsPerSentence <= 16)
    sentenceRhythm = `Medium-length structured sentences averaging ${avgWordsPerSentence} words, mixing short punches with fuller explanations`;
  else
    sentenceRhythm = `Longer narrative sentences averaging ${avgWordsPerSentence} words, storytelling-heavy with flowing paragraphs`;

  // Extract repeated vocabulary (words appearing in 2+ top posts)
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

  // Extract repeated 2-3 word phrases from actual post text
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

  // Most-used hook formula
  const formulaCounts: Record<string, number> = {};
  for (const p of topPosts) {
    formulaCounts[p.hookFormula] = (formulaCounts[p.hookFormula] || 0) + 1;
  }
  const mostUsedFormula = Object.entries(formulaCounts)
    .sort((a, b) => b[1] - a[1])[0]?.[0] || "Strong statement opener";

  // Most-used opener type (first word category)
  const openerTypes: Record<string, number> = {};
  for (const p of top5) {
    const firstWord = p.openingLine.split(/\s/)[0]?.toLowerCase() || "";
    let openerType = "statement";
    if (/^(i|i'm|i've|i'd)$/i.test(firstWord)) openerType = "I-statement";
    else if (/^(why|what|how|when|where|who|do|does|did|is|are|can|would|should)$/i.test(firstWord)) openerType = "question";
    else if (/^(stop|don't|never|avoid|quit)$/i.test(firstWord)) openerType = "directive";
    else if (/^\d/.test(firstWord)) openerType = "number-lead";
    else if (/^(the|this|that|here)$/i.test(firstWord)) openerType = "declarative";
    openerTypes[openerType] = (openerTypes[openerType] || 0) + 1;
  }
  const mostUsedOpenerType = Object.entries(openerTypes)
    .sort((a, b) => b[1] - a[1])[0]?.[0] || "statement";

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

// ── Extract the first N non-empty lines from post text ────────────────────────

function extractFirstLines(text: string, count: number): string[] {
  return text
    .split(/\n/)
    .map((l) => stripEmojis(l.trim()))
    .filter(Boolean)
    .slice(0, count);
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

  const pillar0 = pillars[0] || "their niche";
  const pillar1 = pillars[1] || "growth";

  const topPost = topPosts[0];
  const secondPost = topPosts[1];
  const thirdPost = topPosts[2];

  // ── Voice extraction ────────────────────────────────────────────────────
  const voice = extractCreatorVoice(topPosts);
  const maxEngagement = topPost?.engagementScore || 1;

  // Helper: dynamic engagement score from real data
  function calcScore(sourcePost: TopPost | null, formulaMatch: boolean, openerMatch: boolean): number {
    let base = sourcePost
      ? Math.round((sourcePost.engagementScore / maxEngagement) * 100)
      : Math.round((pattern.avgEngagement / maxEngagement) * 70);
    if (formulaMatch) base += 5;
    if (openerMatch) base += 3;
    return Math.min(99, Math.max(50, base));
  }

  // Helper: check if a post's formula matches the creator's most-used
  function isFormulaMatch(post: TopPost): boolean {
    return post.hookFormula === voice.mostUsedFormula;
  }

  // Helper: check if a post's opener type matches the creator's most-used
  function isOpenerMatch(post: TopPost): boolean {
    const firstWord = post.openingLine.split(/\s/)[0]?.toLowerCase() || "";
    let openerType = "statement";
    if (/^(i|i'm|i've|i'd)$/i.test(firstWord)) openerType = "I-statement";
    else if (/^(why|what|how|when|where|who|do|does|did|is|are|can|would|should)$/i.test(firstWord)) openerType = "question";
    else if (/^(stop|don't|never|avoid|quit)$/i.test(firstWord)) openerType = "directive";
    else if (/^\d/.test(firstWord)) openerType = "number-lead";
    else if (/^(the|this|that|here)$/i.test(firstWord)) openerType = "declarative";
    return openerType === voice.mostUsedOpenerType;
  }

  // Collect real phrases for use in hooks
  const realPhraseSample = voice.repeatedPhrases.slice(0, 3).join('", "');
  const realVocabSample = voice.repeatedVocabulary.slice(0, 5).join(", ");

  const hooks: HookVariant[] = [];

  // 1. Mirror formula of #1 post
  if (topPost) {
    hooks.push({
      type: `Mirror: ${topPost.hookFormula}`,
      hook: buildMirrorHook(topPost, name, posName, voice),
      rationale: `Structurally mirrors the real opening of ${posName} #1 post ("${topPost.openingLine.slice(0, 60)}…"). ${topPost.engagementScore.toLocaleString()} engagement score — their highest performer.`,
      emotionalTrigger: "Mirrors their most successful, proven post opener",
      engagementScore: calcScore(topPost, isFormulaMatch(topPost), isOpenerMatch(topPost)),
      sourcePostUrl: topPost.postUrl,
      derivedFrom: `#1 post · ${topPost.reactionsCount.toLocaleString()} reactions`,
    });
  }

  // 2. Mirror formula of #2 post
  if (secondPost) {
    hooks.push({
      type: `Mirror: ${secondPost.hookFormula}`,
      hook: buildMirrorHook(secondPost, name, posName, voice),
      rationale: `Adapts the real structure from ${posName} #2 post ("${secondPost.openingLine.slice(0, 60)}…"). This formula also resonates with their audience — two proven patterns worth combining.`,
      emotionalTrigger: "Uses their second most reliable hook structure",
      engagementScore: calcScore(secondPost, isFormulaMatch(secondPost), isOpenerMatch(secondPost)),
      sourcePostUrl: secondPost.postUrl,
      derivedFrom: `#2 post · ${secondPost.reactionsCount.toLocaleString()} reactions`,
    });
  }

  // 3. Blend of top-2 formulas
  if (topPost && secondPost) {
    const isSameFormula = topPost.hookFormula === secondPost.hookFormula;
    const insight = buildPatternInsight(topPost, secondPost, voice);
    const blendScore = calcScore(
      topPost,
      isSameFormula,
      isOpenerMatch(topPost),
    );
    hooks.push({
      type: isSameFormula
        ? `Proven Framework: ${topPost.hookFormula}`
        : "Hybrid Formula (Top 2 Combined)",
      hook: isSameFormula
        ? `${posName} top two posts both opened the same way:\n\n#1: "${topPost.openingLine}"\n#2: "${secondPost.openingLine}"\n\nThe pattern underneath both:\n\n${insight}`
        : `${posName} two best posts started differently:\n\n#1 (${topPost.hookFormula.toLowerCase()}): "${topPost.openingLine}"\n#2 (${secondPost.hookFormula.toLowerCase()}): "${secondPost.openingLine}"\n\nThe pattern underneath both:\n\n${insight}`,
      rationale: isSameFormula
        ? `Both top posts literally use the same opening structure — this isn't coincidence, it's the creator's proven signature move.`
        : `Two different formulas, same audience response. The shared linguistic DNA reveals the deeper pattern that drives engagement.`,
      emotionalTrigger: "Combines elements from their top two best-performing hooks",
      engagementScore: Math.min(99, blendScore - 2),
      derivedFrom: `Top 2 posts combined`,
    });
  }

  // 4. Data-driven contrast with real numbers
  hooks.push({
    type: "Data-Driven Contrast",
    hook: `${posName} average post gets ${pattern.avgEngagement.toLocaleString()} engagement.\n\nTheir top post? ${topPost ? topPost.engagementScore.toLocaleString() : "10×"} — that's ${topPost ? Math.round(topPost.engagementScore / Math.max(pattern.avgEngagement, 1)) + "×" : "10×"} the average.\n\nThe difference isn't topic. It's the opening line structure.\n\nTheir viral openers use words like "${realVocabSample}" — the same vocabulary their audience already resonates with.`,
    rationale: `Uses real engagement ratios from the creator's own data. Highlights actual vocabulary patterns from their top posts.`,
    emotionalTrigger: "Shows clear proof of what words and formats get the most attention",
    engagementScore: calcScore(topPost || null, false, false),
    derivedFrom: `${pattern.totalPostsAnalyzed} posts analyzed`,
  });

  // 5. Opening line transplant — verbatim from top post
  if (topPost) {
    const firstLines = extractFirstLines(topPost.text, 3);
    hooks.push({
      type: "Opening Line Transplant",
      hook: `${posName} most viral post started exactly like this:\n\n${firstLines.map((l) => `"${l}"`).join("\n")}\n\n${topPost.reactionsCount.toLocaleString()} reactions.\n\nThat opening uses a ${topPost.hookFormula.toLowerCase()} — ${voice.usesEmDashes ? "with their signature em-dash rhythm" : voice.usesQuestions ? "leveraging the question pattern they keep returning to" : "their most natural structural instinct"}.\n\nHere's how to adapt this exact framework:`,
      rationale: `Verbatim quote of the actual viral opener. The ${topPost.hookFormula} is the real formula detected from this specific post.`,
      emotionalTrigger: "Draws attention by directly quoting a highly successful opening line",
      engagementScore: calcScore(topPost, isFormulaMatch(topPost), true),
      sourcePostUrl: topPost.postUrl,
      derivedFrom: `#1 post · ${topPost.hookFormula}`,
    });
  }

  // 6. Contrarian — grounded in real data patterns
  if (topPost) {
    const topFormulaDesc = voice.mostUsedFormula.toLowerCase();
    hooks.push({
      type: "Contrarian Opener",
      hook: `Everyone says LinkedIn hooks need to be clever.\n\n${posName} top ${pattern.topPostsUsed} posts disagree.\n\nTheir most-used opener? A ${topFormulaDesc}.\n\nNo tricks. Just: "${topPost.openingLine}"\n\n${topPost.reactionsCount.toLocaleString()} reactions. The simplicity IS the formula.`,
      rationale: `Contrarian frame built on real data — the creator's actual most-used formula (${voice.mostUsedFormula}) and their real #1 opening line.`,
      emotionalTrigger: "Hooks the reader by going against common advice",
      engagementScore: calcScore(topPost, true, isOpenerMatch(topPost)),
      derivedFrom: `Pattern from top ${pattern.topPostsUsed} posts`,
    });
  }

  // 7. Research authority — with real specifics
  hooks.push({
    type: "Research Authority",
    hook: `I studied ${pattern.totalPostsAnalyzed} posts from ${name}.\n\nOnly ${pattern.topPostsUsed} drove 80%+ of total engagement.\n\nThose ${pattern.topPostsUsed} posts share ${voice.usesIStatements ? '"I" statements' : voice.usesQuestions ? "question openers" : voice.usesLists ? "numbered lists" : "direct statement openers"}, ${voice.sentenceRhythm.split(",")[0].toLowerCase()}, and vocabulary like "${realVocabSample}".\n\nHere's the exact structural breakdown:`,
    rationale: `Specific numbers + real stylistic observations from the creator's actual writing, not generic claims.`,
    emotionalTrigger: "Builds trust through detailed analysis of what actually works",
    engagementScore: calcScore(topPost || null, false, false),
    derivedFrom: `All ${pattern.totalPostsAnalyzed} posts`,
  });

  // 8. Pattern interrupt — with real post reference
  if (topPost) {
    hooks.push({
      type: "Pattern Interrupt",
      hook: `Stop.\n\nBefore your next ${pillar0} post — look at this opener:\n\n"${topPost.openingLine}"\n\n${topPost.reactionsCount.toLocaleString()} reactions. ${topPost.commentsCount.toLocaleString()} comments.\n\n${name} didn't get lucky. Their top ${pattern.topPostsUsed} posts all follow ${voice.mostUsedFormula === topPost.hookFormula ? "this exact" : "a similar"} structural pattern:`,
      rationale: `The 'Stop' directive is a real pattern interrupt. Anchored to a verbatim opening line and real engagement numbers from the source post.`,
      emotionalTrigger: "Breaks the natural scrolling pattern to force the user to pay attention",
      engagementScore: calcScore(topPost, isFormulaMatch(topPost), true),
      derivedFrom: `Top ${pattern.topPostsUsed} posts`,
    });
  }

  // 9. Transformation story grounded in real post specifics
  if (topPost) {
    const realFirstLine = extractFirstLines(topPost.text, 1)[0] || topPost.openingLine;
    hooks.push({
      type: "Transformation Story",
      hook: `I used to open every ${pillar0} post the same way.\n\nThen I saw ${posName} opener:\n\n"${realFirstLine}"\n\n${topPost.reactionsCount.toLocaleString()} reactions on that post alone.\n\nI reverse-engineered their top ${pattern.topPostsUsed} posts. The rhythm is specific: ${voice.sentenceRhythm.split(",")[0].toLowerCase()}.\n\nEverything changed:`,
      rationale: `Before/after narrative anchored to the creator's real opening line and detected sentence rhythm — not a generic template.`,
      emotionalTrigger: "Uses a relatable before-and-after story to build interest",
      engagementScore: calcScore(topPost, false, isOpenerMatch(topPost)),
      derivedFrom: `Top posts framework`,
    });
  }

  // 10. FOMO hook — with real vocab
  hooks.push({
    type: "FOMO / Urgency",
    hook: `While most ${pillar0} creators are guessing what works…\n\n${name} has a formula averaging ${pattern.avgEngagement.toLocaleString()} engagement.\n\nTheir secret? ${voice.usesIStatements ? 'Personal "I" openers' : voice.usesQuestions ? "Question-driven hooks" : voice.usesLists ? "Numbered list structures" : "Direct statement leads"} + vocabulary their audience already trusts: "${realVocabSample}".\n\nThe gap is widening:`,
    rationale: `Competitive FOMO built on real engagement averages and the creator's actual detected writing patterns — not generic advice.`,
    emotionalTrigger: "Creates a sense of urgency to use the most effective methods right now",
    engagementScore: calcScore(null, false, false),
    derivedFrom: `Avg. engagement data`,
  });

  // 11. Bold claim — with real evidence
  if (topPost) {
    hooks.push({
      type: "Bold Claim",
      hook: `This is the strongest ${pillar0} hook formula on LinkedIn right now.\n\nProof: ${posName} top post — "${topPost.openingLine.slice(0, 70)}…"\n\n${topPost.reactionsCount.toLocaleString()} reactions. ${topPost.commentsCount.toLocaleString()} comments. ${topPost.repostsCount.toLocaleString()} reposts.\n\nI broke down the structural pattern. Here's the framework:`,
      rationale: `Superlative claim backed by the real opening line and exact engagement metrics from the source post.`,
      emotionalTrigger: "Gathers immediate attention and validates it with proof",
      engagementScore: calcScore(topPost, false, false),
      sourcePostUrl: topPost.postUrl,
      derivedFrom: `Comparative post analysis`,
    });
  }

  // 12. Third post formula
  if (thirdPost) {
    hooks.push({
      type: `Formula: ${thirdPost.hookFormula}`,
      hook: buildMirrorHook(thirdPost, name, posName, voice),
      rationale: `Derived from ${posName} #3 post ("${thirdPost.openingLine.slice(0, 60)}…"). The ${thirdPost.hookFormula} structure works repeatedly for this audience.`,
      emotionalTrigger: "Uses a consistent, proven structure that is known to perform well",
      engagementScore: calcScore(thirdPost, isFormulaMatch(thirdPost), isOpenerMatch(thirdPost)),
      sourcePostUrl: thirdPost.postUrl,
      derivedFrom: `#3 post · ${thirdPost.reactionsCount.toLocaleString()} reactions`,
    });
  }

  const toneMap: Record<string, (h: HookVariant) => HookVariant> = {
    professional: (h) => h,
    bold: (h) => ({
      ...h,
      engagementScore: Math.min(99, h.engagementScore + 2),
    }),
    conversational: (h) => h,
    inspirational: (h) => ({
      ...h,
      engagementScore: Math.min(99, h.engagementScore + 1),
    }),
  };

  const toneProcessor = toneMap[tone] || ((h: HookVariant) => h);
  const processed = hooks.map(toneProcessor);

  // Inject Dina AI Prompt — now with real voice data
  const finalHooks = processed.map((h) => {
    const matchedPost = h.sourcePostUrl
      ? topPosts.find((p) => p.postUrl === h.sourcePostUrl)
      : null;

    // Real first sentence of the source post for structural reference
    const realFirstSentence = matchedPost
      ? extractFirstLines(matchedPost.text, 1)[0] || matchedPost.openingLine
      : topPost
        ? extractFirstLines(topPost.text, 1)[0] || topPost.openingLine
        : "";

    // Real phrases from top posts for Dina to reference
    const realPhrasesForDina = voice.repeatedPhrases.slice(0, 3);
    const realVocabForDina = voice.repeatedVocabulary.slice(0, 5);

    let openerInstruction = `- Write a NEW post using this proven framework: "${h.type}"`;
    if (realFirstSentence) {
      openerInstruction += `\n- STRUCTURAL REFERENCE (real viral opener, verbatim): "${realFirstSentence}"`;
      openerInstruction += `\n- Mirror the STRUCTURE of that opener (sentence length, word choice pattern, emotional beat) — but adapt the topic to MY content below.`;
    }
    if (matchedPost) {
      openerInstruction += `\n- DO NOT mention the original creator's name.`;
    }

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

[CREATOR VOICE PROFILE]
• Sentence Rhythm: ${voice.sentenceRhythm}
• Signature Traits: ${[voice.usesIStatements && '"I" statement openers', voice.usesQuestions && "question-driven hooks", voice.usesEmDashes && "em-dash rhythm", voice.usesLists && "numbered list structures"].filter(Boolean).join(", ") || "direct statement style"}
• Real Phrases From Their Top Posts (use sparingly as inspiration): "${realPhrasesForDina.join('", "')}"
• Recurring Vocabulary: ${realVocabForDina.join(", ")}

[CONTENT DETAILS]
• Primary Topic / Pillar: ${pillar0}
• Required Keywords: ${pattern.topPostKeywords.slice(0, 3).join(", ")}
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
• Context: Weave subtle visual metaphors representing [ ${pattern.topPostKeywords.slice(0, 3).join(", ")} ] into the scene without using text.
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

// ── Hook builders — structurally mirrors real post openings ───────────────────

function buildMirrorHook(
  post: TopPost,
  name: string,
  posName: string,
  voice: CreatorVoice,
): string {
  // Extract the actual first 2-3 lines from the source post
  const realLines = extractFirstLines(post.text, 3);
  const line1 = realLines[0] || post.openingLine;
  const line2 = realLines[1] || "";
  const line3 = realLines[2] || "";

  // Count words in the real opening to mirror the rhythm
  const line1Words = line1.split(/\s+/).length;
  const isShort = line1Words <= 8;

  // Build the mirror hook by showing the real structure and teaching it
  let mirror = `${posName} post that got ${post.reactionsCount.toLocaleString()} reactions opened with:\n\n"${line1}"`;

  if (line2) {
    mirror += `\n"${line2}"`;
  }
  if (line3) {
    mirror += `\n"${line3}"`;
  }

  // Add structural analysis based on what's actually in the opening
  mirror += `\n\nThat's a ${post.hookFormula.toLowerCase()}`;
  mirror += isShort
    ? ` — ${line1Words} words, no filler, instant tension.`
    : ` — ${line1Words} words setting the full frame before the payoff.`;

  // Reference the voice patterns detected across posts
  if (voice.usesEmDashes && line1.includes("—")) {
    mirror += `\n\nNotice the em-dash. ${name} uses this rhythm consistently across their top posts.`;
  } else if (voice.usesIStatements && /^I\s/i.test(line1)) {
    mirror += `\n\n${name} opens with "I" — personal, vulnerable, immediate. They do this across their top posts.`;
  } else if (voice.usesQuestions && line1.endsWith("?")) {
    mirror += `\n\n${name} opens with a question — pulling the reader into dialogue. This is their signature pattern.`;
  } else if (voice.usesLists && /^\d/.test(line1)) {
    mirror += `\n\n${name} leads with a number — setting clear expectations. Their audience expects this and engages with it.`;
  }

  mirror += `\n\nHere's how to adapt this exact structural pattern:`;

  return mirror;
}

function buildPatternInsight(
  postA: TopPost,
  postB: TopPost,
  voice: CreatorVoice,
): string {
  const lineA = postA.openingLine;
  const lineB = postB.openingLine;

  // Analyze actual structural similarities
  const similarities: string[] = [];

  // Compare sentence length
  const wordsA = lineA.split(/\s+/).length;
  const wordsB = lineB.split(/\s+/).length;
  if (Math.abs(wordsA - wordsB) <= 3) {
    similarities.push(
      `Both openers are nearly the same length (${wordsA} vs ${wordsB} words) — this creator's audience responds to ${wordsA <= 8 ? "short, punchy" : "medium-length, structured"} first lines`,
    );
  }

  // Compare first word / opener type
  const firstWordA = lineA.split(/\s/)[0]?.toLowerCase() || "";
  const firstWordB = lineB.split(/\s/)[0]?.toLowerCase() || "";
  if (firstWordA === firstWordB) {
    similarities.push(
      `Both literally start with the same word: "${firstWordA}" — this is a conscious signature, not coincidence`,
    );
  } else if (
    (/^(i|i'm|i've)$/i.test(firstWordA) && /^(i|i'm|i've)$/i.test(firstWordB))
  ) {
    similarities.push(
      `Both open with a personal "I" statement — vulnerability as a scroll-stop mechanism`,
    );
  }

  // Check for shared punctuation patterns
  const bothUseEmDash = lineA.includes("—") && lineB.includes("—");
  const bothEndQuestion = lineA.endsWith("?") && lineB.endsWith("?");
  if (bothUseEmDash) {
    similarities.push(`Both use an em-dash to create a mid-line pause — building tension before the reveal`);
  }
  if (bothEndQuestion) {
    similarities.push(`Both end with a question mark — pulling the reader into a dialogue loop`);
  }

  // Check for shared vocabulary from the actual lines
  const wordsArrA = lineA.toLowerCase().replace(/[^a-z\s]/g, "").split(/\s+/).filter((w) => w.length > 3);
  const wordsSetB = new Set(lineB.toLowerCase().replace(/[^a-z\s]/g, "").split(/\s+/).filter((w) => w.length > 3));
  const shared = wordsArrA.filter((w) => wordsSetB.has(w)).filter((w, i, arr) => arr.indexOf(w) === i);
  if (shared.length > 0) {
    similarities.push(
      `Shared vocabulary across both openers: "${shared.slice(0, 3).join('", "')}" — these are words this audience trusts`,
    );
  }

  // Emotional beat comparison
  const emotionalA = /\b(never|always|stop|mistake|fail|wrong|truth|secret)\b/i.test(lineA);
  const emotionalB = /\b(never|always|stop|mistake|fail|wrong|truth|secret)\b/i.test(lineB);
  if (emotionalA && emotionalB) {
    similarities.push(`Both hit an emotional trigger word in the first line — creating instant psychological tension`);
  }

  // Fallback: if no structural similarities found, describe the contrast
  if (similarities.length === 0) {
    return `Post A opens with: "${lineA.slice(0, 80)}…"\nPost B opens with: "${lineB.slice(0, 80)}…"\n\nDifferent structures, but both match this creator's rhythm: ${voice.sentenceRhythm.split(",")[0].toLowerCase()}.\n\nThe shared DNA: both create immediate tension — then withhold the resolution to drive reading.`;
  }

  let insight = `Post A: "${lineA.slice(0, 80)}${lineA.length > 80 ? "…" : ""}"\nPost B: "${lineB.slice(0, 80)}${lineB.length > 80 ? "…" : ""}"\n\n`;
  insight += similarities.join(".\n\n") + ".";
  insight += `\n\nThe formula: ${voice.sentenceRhythm.split(",")[0].toLowerCase()} → immediate tension → withhold resolution.`;

  return insight;
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
