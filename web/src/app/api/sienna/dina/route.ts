import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { getLinkedInCookies } from "@/lib/linkedin";

export const maxDuration = 60;

// ── Dina Caption Generation API ──────────────────────────────────────────────
// This endpoint takes a hook + context and generates the actual LinkedIn caption
// via OpenAI — not a prompt template, but the real ready-to-post caption.

interface DinaRequest {
  hook: {
    type: string;
    hook: string;
    rationale: string;
    emotionalTrigger: string;
  };
  sourcePost?: {
    text: string;
    openingLine: string;
    hookFormula: string;
    reactionsCount: number;
  } | null;
  voice: {
    sentenceRhythm: string;
    usesIStatements: boolean;
    usesQuestions: boolean;
    usesEmDashes: boolean;
    usesLists: boolean;
    repeatedPhrases: string[];
    repeatedVocabulary: string[];
  };
  pattern: {
    contentPillars: string[];
    topPostKeywords: string[];
    writingStyle: string;
  };
  tone: string;
  creatorName: string;
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

    const body = (await req.json()) as DinaRequest;
    const { hook, sourcePost, voice, pattern, tone, creatorName } = body;

    if (!hook || !hook.hook) {
      return NextResponse.json(
        { error: "Hook data is required." },
        { status: 400 },
      );
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "OpenAI API key not configured." },
        { status: 500 },
      );
    }

    const openai = new OpenAI({ apiKey });

    const pillar = pattern?.contentPillars?.[0] || "professional growth";
    const keywords = pattern?.topPostKeywords?.slice(0, 4).join(", ") || "";
    const vocabStr = voice?.repeatedVocabulary?.slice(0, 5).join(", ") || "";
    const phrasesStr = voice?.repeatedPhrases?.slice(0, 3).join('", "') || "";

    const traits: string[] = [];
    if (voice?.usesIStatements) traits.push('"I" statement openers');
    if (voice?.usesQuestions) traits.push("question hooks");
    if (voice?.usesEmDashes) traits.push("em-dash rhythm");
    if (voice?.usesLists) traits.push("numbered lists");
    const traitsStr = traits.length > 0 ? traits.join(", ") : "direct statement style";

    let sourceContext = "";
    if (sourcePost) {
      sourceContext = `\n\nREFERENCE POST (${sourcePost.reactionsCount} reactions, ${sourcePost.hookFormula} formula):
Opening: "${sourcePost.openingLine}"
Full text excerpt: "${sourcePost.text.slice(0, 500)}"

Study this post's structure, rhythm, and topic closely. Your caption should feel like it comes from the same creator.`;
    }

    const systemPrompt = `You are Dina, an elite LinkedIn ghostwriter who writes captions engineered for maximum "see more" clicks and engagement.

YOUR WRITING STRUCTURE (follow exactly):

ABOVE THE FOLD (first 2-3 lines — what shows BEFORE "...see more"):
- Use the provided hook verbatim or closely adapted
- This MUST create an open loop, curiosity gap, or cliffhanger
- End with a colon, dash, or incomplete thought
- Reader MUST feel compelled to click "see more"

BELOW THE FOLD (the payoff):
- Deliver the promised value in 3-4 professional, well-structured paragraphs
- DO NOT use the "broetry" style of one sentence per line
- Each paragraph should contain 2-4 cohesive sentences
- Group related thoughts together logically
- Include 1 specific, concrete insight (a number, a tactic, a real example)

CLOSING (last 1-2 lines):
- End with a short, direct question that drives comments
- Or a bold one-liner that begs to be shared
- Make the reader feel they MUST respond

CRITICAL RULES:
- Output ONLY the final LinkedIn post. No labels, no headers, no meta text.
- Total length: 100-200 words
- NO emojis
- NO AI jargon: avoid "Unlock", "Delve", "Elevate", "Testament", "Landscape", "Navigate", "Leverage", "Harness", "In today's fast-paced world"
- Write like a real human — conversational, direct, professional
- Avoid single-sentence lines unless for strong emphasis. Most text should be in standard paragraphs.`;

    const userPrompt = `Write a LinkedIn caption for ${creatorName}.

HOOK TO USE (this is the above-the-fold opener):
"${hook.hook}"

Hook formula: ${hook.type}
Emotional pull: ${hook.emotionalTrigger}
Why it works: ${hook.rationale}

CREATOR'S VOICE:
- Sentence rhythm: ${voice?.sentenceRhythm || "punchy, short"}
- Writing traits: ${traitsStr}
- Their vocabulary: ${vocabStr}
- Their phrases: "${phrasesStr}"

CONTENT:
- Topic: ${pillar}
- Keywords: ${keywords}
- Tone: ${tone?.toUpperCase() || "PROFESSIONAL"}
- Style: ${pattern?.writingStyle || "structured-storytelling"}${sourceContext}

STRUCTURE YOUR POST EXACTLY LIKE THIS:
1. Lines 1-3: The hook (above the fold — creates "see more" click)
2. Middle section: The value (below the fold — deliver the insight in cohesive paragraphs, not single lines)
3. Last line: A comment-driving question or bold closer

Write the complete post now. Only the post text, nothing else.`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.9,
      max_tokens: 800,
    });

    const caption = completion.choices[0]?.message?.content?.trim() || "";

    if (!caption) {
      return NextResponse.json(
        { error: "Failed to generate caption." },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      caption,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[dina] Error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Dina error: ${msg}` },
      { status: 500 },
    );
  }
}
