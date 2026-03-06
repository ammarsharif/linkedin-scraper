"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

// ── Types ──────────────────────────────────────────────────────────────────────

interface Profile {
  name: string;
  headline: string;
  location: string;
  profileUrl: string;
  vanityName: string;
}

interface Post {
  urn: string;
  text: string;
  postedDate: string;
  reactionsCount: number;
  commentsCount: number;
  repostsCount: number;
  postUrl: string;
  imageUrls: string[];
  videoUrl: string | null;
  articleUrl: string | null;
}

interface VoiceData {
  sentenceRhythm: string;
  usesIStatements: boolean;
  usesQuestions: boolean;
  usesEmDashes: boolean;
  usesLists: boolean;
  repeatedPhrases: string[];
  repeatedVocabulary: string[];
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
  coreInsightExtracted?: string;
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

interface SiennaResult {
  profiles: Profile[];
  patterns: CreatorPattern;
  hooks: HookVariant[];
  topPosts: TopPost[];
  voice: VoiceData;
  meta: {
    postsAnalyzed: number;
    topPostsUsed: number;
    tone: string;
    generatedAt: string;
  };
}

type Tone = "professional" | "conversational" | "bold" | "inspirational";

// ── Helpers ────────────────────────────────────────────────────────────────────

function scoreColor(score: number): string {
  if (score >= 95) return "#00e676";
  if (score >= 90) return "#00b4d8";
  if (score >= 85) return "#c96ef5";
  return "#8b8fa3";
}

function fmtNum(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toString();
}

// ── Copy Button ────────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer"
      style={{
        background: copied ? "rgba(0,230,118,0.08)" : "rgba(255,255,255,0.04)",
        borderColor: copied ? "rgba(0,230,118,0.25)" : "rgba(255,255,255,0.08)",
        color: copied ? "#00e676" : "#8b8fa3",
      }}
    >
      {copied ? (
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <rect x="9" y="9" width="13" height="13" rx="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

// ── Hook Card ──────────────────────────────────────────────────────────────────

function HookCard({
  hook,
  index,
  onPromptClick,
}: {
  hook: HookVariant;
  index: number;
  onPromptClick: (h: HookVariant) => void;
}) {
  const [open, setOpen] = useState(false);
  const color = scoreColor(hook.engagementScore);

  return (
    <div
      className="rounded-2xl border transition-all duration-300 animate-fade-in hover:shadow-lg hover:border-white/20"
      style={{
        background: "rgba(20, 21, 31, 0.4)",
        backdropFilter: "blur(12px)",
        borderColor: "rgba(255,255,255,0.08)",
        animationDelay: `${index * 0.05}s`,
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-6 py-4 border-b"
        style={{ borderColor: "rgba(255,255,255,0.04)" }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span
            className="text-xs font-bold tabular-nums"
            style={{ color: "#3d3f52" }}
          >
            #{index + 1}
          </span>
          <span
            className="truncate text-xs font-bold px-3 py-1 rounded-full border"
            style={{
              background: "transparent",
              color: "#c96ef5",
              borderColor: "rgba(201,110,245,0.3)",
            }}
          >
            {hook.type}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => onPromptClick(hook)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer hover:scale-105"
            style={{
              background: "linear-gradient(135deg, rgba(168,85,247,0.12), rgba(236,72,153,0.12))",
              borderColor: "rgba(236,72,153,0.25)",
              color: "#fbcfe8",
              borderWidth: 1,
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
            Generate Caption
          </button>
          {/* Score badge */}
          <span
            className="text-xs font-black tabular-nums px-2.5 py-1 rounded-full border shadow-sm"
            style={{ background: "transparent", color, borderColor: color }}
          >
            {hook.engagementScore}
          </span>
          <CopyButton text={hook.hook} />
        </div>
      </div>

      {/* Hook text */}
      <div className="px-5 py-4">
        <div className="text-sm leading-relaxed" style={{ color: "#d1d5db" }}>
          {hook.hook.split("\n").map((line, i) =>
            line.trim() === "" ? (
              <div key={i} className="h-3" />
            ) : (
              <p key={i} className="m-0">
                {line}
              </p>
            ),
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="px-5 pb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            className="text-[11px] font-medium"
            style={{ color: "#6b7280" }}
          >
            {hook.emotionalTrigger}
          </span>
        </div>

        <div className="flex items-center gap-3">
          {/* Source post reference */}
          {hook.derivedFrom && (
            <span className="text-[11px]" style={{ color: "#4b5268" }}>
              from: {hook.derivedFrom}
            </span>
          )}
          {hook.sourcePostUrl && (
            <a
              href={hook.sourcePostUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] font-semibold transition-colors hover:underline"
              style={{ color: "#00a0dc" }}
            >
              Source post ↗
            </a>
          )}
        </div>
      </div>

      {/* Why this works — expandable */}
      <div className="px-5 pb-4">
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-1.5 text-xs transition-colors cursor-pointer"
          style={{ color: open ? "#c96ef5" : "#4b5268" }}
        >
          <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            style={{
              transform: open ? "rotate(90deg)" : "none",
              transition: "transform 0.2s",
            }}
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
          Why this works
        </button>
        {open && (
          <div
            className="mt-3 px-4 py-3 rounded-lg text-xs leading-relaxed animate-fade-in space-y-2"
            style={{
              background: "rgba(201,110,245,0.05)",
              color: "#d1d5db",
              border: "1px solid rgba(201,110,245,0.1)",
            }}
          >
            {hook.coreInsightExtracted && (
              <p className="m-0">
                <span className="font-bold opacity-80" style={{ color: "#c96ef5" }}>Core Idea:</span>{" "}
                {hook.coreInsightExtracted}
              </p>
            )}
            <p className="m-0">
              <span className="font-bold opacity-80" style={{ color: "#c96ef5" }}>Hook Psychology:</span>{" "}
              {hook.rationale}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Viral Post Reference Card ──────────────────────────────────────────────────

function ViralPostCard({ post, rank }: { post: TopPost; rank: number }) {
  const rankColors = ["#f59e0b", "#94a3b8", "#b45309"];
  const rankColor = rank <= 3 ? rankColors[rank - 1] : "#4b5268";

  return (
    <div
      className="rounded-2xl border p-5 transition-all hover:bg-white/5"
      style={{
        background: "transparent",
        borderColor: "rgba(255,255,255,0.08)",
      }}
    >
      {/* Rank + formula */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <span
            className="text-sm font-bold tabular-nums"
            style={{ color: rankColor }}
          >
            #{rank}
          </span>
          <span
            className="text-[11px] font-semibold px-2 py-0.5 rounded"
            style={{ background: "rgba(201,110,245,0.08)", color: "#c96ef5" }}
          >
            {post.hookFormula}
          </span>
        </div>
        <span
          className="text-[11px] font-bold px-2 py-0.5 rounded-full"
          style={{ background: "rgba(0,230,118,0.08)", color: "#00e676" }}
        >
          {post.percentileRank}% score
        </span>
      </div>

      {/* Opening line */}
      <p
        className="text-xs leading-relaxed mb-3 italic"
        style={{ color: "#9ca3af" }}
      >
        &quot;{post.openingLine}
        {post.openingLine.length >= 119 ? "…" : ""}&quot;
      </p>

      {/* Engagement row */}
      <div className="flex items-center gap-4">
        <span className="text-xs font-semibold" style={{ color: "#6b7280" }}>
          {fmtNum(post.reactionsCount)} reactions
        </span>
        <span className="text-xs font-semibold" style={{ color: "#6b7280" }}>
          {fmtNum(post.commentsCount)} comments
        </span>
        <span className="text-xs font-semibold" style={{ color: "#6b7280" }}>
          {fmtNum(post.repostsCount)} reposts
        </span>
        {post.postUrl && (
          <a
            href={post.postUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto text-[11px] font-semibold hover:underline transition-colors"
            style={{ color: "#00a0dc" }}
          >
            View post
          </a>
        )}
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

function SiennaPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SiennaResult | null>(null);
  const [error, setError] = useState("");
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const hooksPerPage = 4;

  const [tone, setTone] = useState<Tone>("professional");
  const [hookCount, setHookCount] = useState(8);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [manualInput, setManualInput] = useState(false);
  const [manualJson, setManualJson] = useState("");
  const [dinaModalHook, setDinaModalHook] = useState<HookVariant | null>(null);
  const [dinaCaption, setDinaCaption] = useState<string>("");
  const [dinaLoading, setDinaLoading] = useState(false);
  const [dinaError, setDinaError] = useState("");
  const [generatedCaptions, setGeneratedCaptions] = useState<Record<string, string>>({});

  const showToast = useCallback(
    (message: string, type: "success" | "error") => {
      setToast({ message, type });
      setTimeout(() => setToast(null), 4000);
    },
    [],
  );

  // Auth check
  useEffect(() => {
    fetch("/api/auth")
      .then((r) => r.json())
      .then((d) => {
        if (!d.authenticated) router.push("/");
      })
      .catch(() => router.push("/"))
      .finally(() => setChecking(false));
  }, [router]);

  // Load data from storage
  useEffect(() => {
    try {
      const stateStr = localStorage.getItem("sienna_state");
      const payloadStr = localStorage.getItem("sienna_payload");
      if (stateStr) {
        const s = JSON.parse(stateStr);
        if (s.profiles) setProfiles(s.profiles);
        if (s.posts) setPosts(s.posts);
        if (s.result) setResult(s.result);
        if (s.tone) setTone(s.tone);
        if (s.hookCount) setHookCount(s.hookCount);
      } else if (payloadStr) {
        const p = JSON.parse(payloadStr) as {
          profiles: Profile[];
          posts: Post[];
        };
        if (p.profiles && p.profiles.length > 0) setProfiles(p.profiles);
        setPosts(p.posts);
      }
      const captionsStr = localStorage.getItem("sienna_dina_captions");
      if (captionsStr) {
        setGeneratedCaptions(JSON.parse(captionsStr));
      }
    } catch {
      /* no payload */
    }
  }, [searchParams]);

  // Persist state
  useEffect(() => {
    if (profiles.length > 0 && posts.length > 0) {
      localStorage.setItem(
        "sienna_state",
        JSON.stringify({ profiles, posts, result, tone, hookCount }),
      );
    }
  }, [profiles, posts, result, tone, hookCount]);

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setResult(null);

    let finalProfiles = profiles;
    let finalPosts = posts;

    if (manualInput && manualJson.trim()) {
      try {
        const parsed = JSON.parse(manualJson);
        if (Array.isArray(parsed)) {
          finalPosts = parsed;
          finalProfiles =
            finalProfiles.length > 0
              ? finalProfiles
              : [
                  {
                    name: "Creator",
                    headline: "",
                    location: "",
                    profileUrl: "",
                    vanityName: "",
                  },
                ];
        } else if (parsed.posts) {
          finalProfiles =
            parsed.profiles || parsed.profile
              ? [parsed.profile]
              : finalProfiles;
          finalPosts = parsed.posts;
        }
      } catch {
        setError("Invalid JSON. Please paste valid post data.");
        return;
      }
    }

    if (finalProfiles.length === 0 || !finalPosts.length) {
      setError(
        "No post data found. Go to the Scraper page, scrape a profile, then return here.",
      );
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/sienna", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profiles: finalProfiles,
          posts: finalPosts,
          tone,
          hookCount,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 401) {
          router.push("/");
          return;
        }
        setError(data.error || "Failed to generate hooks");
        return;
      }
      setResult(data as SiennaResult);
      setCurrentPage(1);
      showToast(
        `${data.hooks.length} hooks generated from top ${data.meta.topPostsUsed} posts ✓`,
        "success",
      );
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function handleExport() {
    if (!result) return;
    const lines = result.hooks.map(
      (h, i) =>
        `== HOOK #${i + 1}: ${h.type} (Score: ${h.engagementScore}) ==\n` +
        `Derived from: ${h.derivedFrom || "pattern analysis"}\n\n` +
        `${h.hook}\n\nReason: ${h.emotionalTrigger}\nExplanation: ${h.rationale}\n`,
    );
    const content = [
      `SIENNA VIRAL HOOK REPORT`,
      `Creators: ${result.profiles.map((p) => p.name).join(", ")}`,
      `Posts Analysed: ${result.meta.postsAnalyzed} (top ${result.meta.topPostsUsed} used for hook derivation)`,
      `Generated: ${new Date(result.meta.generatedAt).toLocaleString()}`,
      `Tone: ${result.meta.tone}`,
      `\n${"═".repeat(60)}\n`,
      ...lines,
    ].join("\n");
    const blob = new Blob([content], { type: "text/plain;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `sienna_${
      result.profiles
        .map((p) => p.name)
        .join("_")
        .replace(/\s+/g, "_") || "creators"
    }_${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast("Hooks exported", "success");
  }

  if (checking) {
    return (
      <div
        style={{
          display: "flex",
          minHeight: "100vh",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div className="bg-mesh" />
        <div className="spinner-lg spinner" />
      </div>
    );
  }

  // Dina caption generation
  async function handleDinaGenerate(hook: HookVariant, forceRegenerate = false) {
    if (!result) return;
    setDinaModalHook(hook);
    setDinaError("");

    if (!forceRegenerate && generatedCaptions[hook.hook]) {
      setDinaCaption(generatedCaptions[hook.hook]);
      return;
    }

    setDinaCaption("");
    setDinaLoading(true);

    try {
      const sourcePost = hook.sourcePostIndex != null
        ? result.topPosts[hook.sourcePostIndex] || null
        : null;

      const res = await fetch("/api/sienna/dina", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hook: {
            type: hook.type,
            hook: hook.hook,
            rationale: hook.rationale,
            emotionalTrigger: hook.emotionalTrigger,
          },
          sourcePost: sourcePost ? {
            text: sourcePost.text,
            openingLine: sourcePost.openingLine,
            hookFormula: sourcePost.hookFormula,
            reactionsCount: sourcePost.reactionsCount,
          } : null,
          voice: result.voice,
          pattern: {
            contentPillars: result.patterns.contentPillars,
            topPostKeywords: result.patterns.topPostKeywords,
            writingStyle: result.patterns.writingStyle,
          },
          tone: result.meta.tone,
          creatorName: result.profiles[0]?.name || "Creator",
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setDinaError(data.error || "Failed to generate caption");
      } else {
        setDinaCaption(data.caption);
        setGeneratedCaptions((prev) => {
          const updated = { ...prev, [hook.hook]: data.caption };
          localStorage.setItem("sienna_dina_captions", JSON.stringify(updated));
          return updated;
        });
      }
    } catch {
      setDinaError("Network error. Please try again.");
    } finally {
      setDinaLoading(false);
    }
  }

  const toneOptions: { value: Tone; label: string }[] = [
    { value: "professional", label: "Professional" },
    { value: "conversational", label: "Conversational" },
    { value: "bold", label: "Bold" },
    { value: "inspirational", label: "Inspirational" },
  ];

  const totalPages = result ? Math.ceil(result.hooks.length / hooksPerPage) : 0;
  const pagedHooks = result
    ? result.hooks.slice(
        (currentPage - 1) * hooksPerPage,
        currentPage * hooksPerPage,
      )
    : [];

  return (
    <div className="relative min-h-screen" style={{ background: "#080910" }}>
      <div className="bg-mesh" />

      {/* ── Header ── */}
      <header
        className="sticky top-0 z-50 border-b"
        style={{
          background: "rgba(8,9,16,0.85)",
          backdropFilter: "blur(16px)",
          borderColor: "rgba(255,255,255,0.06)",
        }}
      >
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3.5">
          {/* Left */}
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push("/scraper")}
              className="flex items-center gap-2 text-sm font-medium transition-colors cursor-pointer"
              style={{ color: "#6b7280" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "#c96ef5")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "#6b7280")}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <line x1="19" y1="12" x2="5" y2="12" />
                <polyline points="12 19 5 12 12 5" />
              </svg>
              Back
            </button>

            <div
              style={{
                width: 1,
                height: 20,
                background: "rgba(255,255,255,0.08)",
              }}
            />

            <div className="flex items-center gap-2.5">
              <div
                className="flex items-center justify-center rounded-lg"
                style={{
                  width: 32,
                  height: 32,
                  background: "linear-gradient(135deg, #7c3aed, #c96ef5)",
                }}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="white"
                  strokeWidth="2"
                >
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                </svg>
              </div>
              <div>
                <p
                  className="text-sm font-bold"
                  style={{ color: "#e5e7eb", lineHeight: 1.2 }}
                >
                  Sienna
                </p>
                <p className="text-[11px]" style={{ color: "#4b5268" }}>
                  Viral Hook Intelligence
                </p>
              </div>
            </div>
          </div>

          {/* Right — status */}
          <div className="flex items-center gap-2">
            {profiles.length > 0 && (
              <span
                className="text-xs font-semibold px-3 py-1 rounded-full truncate max-w-[200px]"
                style={{
                  background: "rgba(0,160,220,0.1)",
                  color: "#00a0dc",
                  border: "1px solid rgba(0,160,220,0.2)",
                }}
                title={profiles.map((p) => p.name).join(", ")}
              >
                {profiles.length > 1
                  ? `${profiles.length} Creators`
                  : profiles[0].name}
              </span>
            )}
            {posts.length > 0 && (
              <span
                className="text-xs font-semibold px-3 py-1 rounded-full"
                style={{
                  background: "rgba(0,230,118,0.08)",
                  color: "#00e676",
                  border: "1px solid rgba(0,230,118,0.15)",
                }}
              >
                {posts.length} posts loaded
              </span>
            )}
          </div>
        </div>
      </header>

      {/* ── Main ── */}
      <main className="relative z-10 mx-auto max-w-7xl px-6 py-12">
        <div className="grid gap-10 lg:grid-cols-[360px_1fr]">
          {/* ── Left Panel ── */}
          <div className="space-y-5">
            {/* Title block */}
            <div className="animate-fade-in">
              <p
                className="text-[11px] font-bold uppercase tracking-widest mb-3"
                style={{ color: "#c96ef5" }}
              >
                Engagement-First Hook Engine
              </p>
              <h1
                className="text-3xl font-extrabold tracking-tight leading-loose mb-2"
                style={{ color: "#ffffff" }}
              >
                Learn from their{" "}
                <span className="bg-clip-text text-transparent bg-linear-to-r from-purple-500 to-pink-500">
                  most viral
                </span>{" "}
                posts
              </h1>
              <p
                className="text-[15px] leading-relaxed"
                style={{ color: "#a1a1aa" }}
              >
                Sienna studies the top-performing posts by engagement not all
                posts equally. It extracts the hook formula from each viral post
                and builds new hooks using those exact proven structures.
              </p>
            </div>

            {/* Data status */}
            {(profiles.length === 0 || posts.length === 0) && (
              <div
                className="rounded-xl p-4 border animate-fade-in"
                style={{
                  background: "rgba(201,110,245,0.04)",
                  borderColor: "rgba(201,110,245,0.15)",
                }}
              >
                <p
                  className="text-sm font-semibold mb-1"
                  style={{ color: "#e5e7eb" }}
                >
                  No data loaded
                </p>
                <p className="text-xs mb-3" style={{ color: "#6b7280" }}>
                  Scrape a LinkedIn profile first to get started.
                </p>
                <button
                  onClick={() => router.push("/scraper")}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg cursor-pointer transition-all"
                  style={{
                    background: "rgba(201,110,245,0.12)",
                    color: "#c96ef5",
                    border: "1px solid rgba(201,110,245,0.2)",
                  }}
                >
                  Go to Scraper →
                </button>
              </div>
            )}

            {/* Config form */}
            <form
              onSubmit={handleGenerate}
              className="rounded-2xl border p-6 space-y-6 animate-fade-in shadow-xl backdrop-blur-md"
              style={{
                background: "rgba(20, 21, 31, 0.4)",
                borderColor: "rgba(255,255,255,0.08)",
              }}
            >
              {/* Tone */}
              <div>
                <label
                  className="block text-xs font-semibold uppercase tracking-widest mb-3"
                  style={{ color: "#4b5268" }}
                >
                  Hook Tone
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {toneOptions.map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => setTone(t.value)}
                      className="flex items-center gap-2 px-3 py-2.5 rounded-lg border text-left transition-all cursor-pointer"
                      style={{
                        background:
                          tone === t.value
                            ? "rgba(201,110,245,0.1)"
                            : "rgba(255,255,255,0.02)",
                        borderColor:
                          tone === t.value
                            ? "rgba(201,110,245,0.35)"
                            : "rgba(255,255,255,0.06)",
                        color: tone === t.value ? "#e5e7eb" : "#6b7280",
                      }}
                    >
                      <span className="text-xs font-semibold">{t.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Hook count */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <label
                    className="text-xs font-semibold uppercase tracking-widest"
                    style={{ color: "#4b5268" }}
                  >
                    Hooks to Generate
                  </label>
                  <span
                    className="text-sm font-bold"
                    style={{ color: "#c96ef5" }}
                  >
                    {hookCount}
                  </span>
                </div>
                <input
                  type="range"
                  min={3}
                  max={15}
                  value={hookCount}
                  onChange={(e) => setHookCount(parseInt(e.target.value))}
                  className="w-full h-1 rounded-full appearance-none cursor-pointer"
                  style={{
                    accentColor: "#c96ef5",
                    background: "rgba(255,255,255,0.08)",
                  }}
                />
                <div
                  className="flex justify-between mt-1.5 text-[11px]"
                  style={{ color: "#3d3f52" }}
                >
                  <span>3</span>
                  <span>9</span>
                  <span>15</span>
                </div>
              </div>

              {/* Manual JSON */}
              <div>
                <button
                  type="button"
                  onClick={() => setManualInput(!manualInput)}
                  className="flex items-center gap-1.5 text-xs cursor-pointer transition-colors"
                  style={{ color: "#4b5268" }}
                >
                  <svg
                    width="11"
                    height="11"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    style={{
                      transform: manualInput ? "rotate(90deg)" : "none",
                      transition: "transform 0.2s",
                    }}
                  >
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                  {manualInput
                    ? "Close JSON input"
                    : "Paste post data manually (JSON)"}
                </button>
                {manualInput && (
                  <textarea
                    className="premium-textarea mt-2"
                    rows={4}
                    placeholder='[{"text": "Post text...", "reactionsCount": 100, ...}]'
                    value={manualJson}
                    onChange={(e) => setManualJson(e.target.value)}
                  />
                )}
              </div>

              {error && (
                <div
                  className="rounded-lg px-4 py-3 text-xs"
                  style={{
                    background: "rgba(239,68,68,0.08)",
                    border: "1px solid rgba(239,68,68,0.2)",
                    color: "#f87171",
                  }}
                >
                  ⚠ {error}
                </div>
              )}

              <button
                type="submit"
                disabled={
                  loading || profiles.length === 0 || posts.length === 0
                }
                className="group relative flex w-full items-center justify-center gap-2 rounded-xl bg-linear-to-r from-[#7c3aed] via-[#c96ef5] to-[#f06aff] px-4 py-3.5 text-sm font-bold text-white shadow-lg shadow-purple-500/20 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-purple-500/40 active:translate-y-0 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none overflow-hidden"
              >
                {loading ? (
                  <>
                    <span className="spinner border-2 border-white/20 border-t-white w-4 h-4 rounded-full animate-spin" />
                    Analysing top posts…
                  </>
                ) : (
                  <>
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                    >
                      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                    </svg>
                    Generate Viral Hooks
                  </>
                )}
              </button>
            </form>

            {/* How it works */}
            <div
              className="rounded-2xl border p-6 animate-fade-in-delay-1"
              style={{
                background: "transparent",
                borderColor: "rgba(255,255,255,0.08)",
              }}
            >
              <p
                className="text-[11px] font-bold uppercase tracking-widest mb-4"
                style={{ color: "#3d3f52" }}
              >
                How it works
              </p>
              <div className="space-y-3.5">
                {[
                  {
                    step: "01",
                    title: "Rank by engagement",
                    desc: "Posts scored: reactions + comments×3 + reposts×2",
                  },
                  {
                    step: "02",
                    title: "Study top 30%",
                    desc: "Only high-performers analyzed — not all posts equally",
                  },
                  {
                    step: "03",
                    title: "Extract formula",
                    desc: "Opening line, hook type, and pattern detected per post",
                  },
                  {
                    step: "04",
                    title: "AI-powered hooks",
                    desc: "OpenAI generates dynamic, contextual hooks from real post data",
                  },
                ].map((s, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <span
                      className="text-[10px] font-bold tabular-nums mt-0.5 w-5 shrink-0"
                      style={{ color: "#c96ef5" }}
                    >
                      {s.step}
                    </span>
                    <div>
                      <p
                        className="text-xs font-semibold"
                        style={{ color: "#e5e7eb" }}
                      >
                        {s.title}
                      </p>
                      <p
                        className="text-[11px] mt-0.5"
                        style={{ color: "#4b5268" }}
                      >
                        {s.desc}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── Right Panel ── */}
          <div className="space-y-6">
            {/* Empty state */}
            {!result && !loading && (
              <div className="flex h-[520px] items-center justify-center animate-fade-in-delay-1">
                <div className="text-center">
                  <div
                    className="flex items-center justify-center rounded-2xl mx-auto mb-5"
                    style={{
                      width: 56,
                      height: 56,
                      background: "rgba(201,110,245,0.08)",
                      border: "1px solid rgba(201,110,245,0.15)",
                    }}
                  >
                    <svg
                      width="24"
                      height="24"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#c96ef5"
                      strokeWidth="1.5"
                    >
                      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                    </svg>
                  </div>
                  <h2
                    className="text-base font-bold mb-2"
                    style={{ color: "#e5e7eb" }}
                  >
                    Ready to generate
                  </h2>
                  <p className="text-sm max-w-xs" style={{ color: "#4b5268" }}>
                    Load a scraped profile and click Generate. Sienna will study
                    only their most viral posts and derive hooks from those
                    specific formulas.
                  </p>
                  <div
                    className="flex items-center justify-center gap-2 mt-6 text-xs"
                    style={{ color: "#3d3f52" }}
                  >
                    {["Scraper", "→", "Sienna", "→", "Viral Hooks"].map(
                      (item, i) => (
                        <span
                          key={i}
                          style={{
                            color: item === "→" ? "#1e2030" : "#4b5268",
                            fontWeight: item !== "→" ? 600 : 400,
                          }}
                        >
                          {item}
                        </span>
                      ),
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Loading */}
            {loading && (
              <div className="flex h-64 items-center justify-center">
                <div className="text-center">
                  <div
                    className="flex items-center justify-center rounded-2xl mx-auto mb-4 animate-pulse"
                    style={{
                      width: 56,
                      height: 56,
                      background: "linear-gradient(135deg,#7c3aed,#c96ef5)",
                      boxShadow: "0 0 28px rgba(201,110,245,0.3)",
                    }}
                  >
                    <svg
                      width="24"
                      height="24"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="white"
                      strokeWidth="2"
                    >
                      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                    </svg>
                  </div>
                  <p
                    className="text-sm font-semibold"
                    style={{ color: "#e5e7eb" }}
                  >
                    Generating AI-powered hooks…
                  </p>
                  <p className="text-xs mt-1" style={{ color: "#4b5268" }}>
                    Studying top posts with OpenAI
                  </p>
                </div>
              </div>
            )}

            {/* Results */}
            {result && !loading && (
              <div className="space-y-6">
                {/* Creator insight bar */}
                <div
                  className="rounded-2xl border py-5 px-6 flex flex-wrap items-center gap-6 justify-between animate-fade-in backdrop-blur-md"
                  style={{
                    background: "rgba(20, 21, 31, 0.4)",
                    borderColor: "rgba(255,255,255,0.08)",
                  }}
                >
                  <div className="flex items-center gap-4 animate-fade-in">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-linear-to-br from-[#7c3aed] to-[#c96ef5] shadow-lg shadow-purple-500/20">
                      <span className="text-sm font-bold text-white">
                        {result.profiles.length > 1
                          ? `${result.profiles.length}x`
                          : result.profiles[0]?.name
                              .split(" ")
                              .map((n) => n[0])
                              .join("")
                              .slice(0, 2)}
                      </span>
                    </div>
                    <div>
                      <h2
                        className="text-xl font-bold tracking-tight"
                        style={{ color: "#f9fafb" }}
                      >
                        {result.profiles.length > 1
                          ? result.profiles.map((p) => p.name).join(", ")
                          : result.profiles[0]?.name}
                      </h2>
                      <p
                        className="text-xs font-medium"
                        style={{ color: "#6b7280" }}
                      >
                        {result.meta.postsAnalyzed} posts scraped · top{" "}
                        <span style={{ color: "#c96ef5" }}>
                          {result.meta.topPostsUsed}
                        </span>{" "}
                        used for hooks
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="text-center">
                      <p
                        className="text-lg font-bold"
                        style={{ color: "#00e676" }}
                      >
                        {result.patterns.avgEngagement}
                      </p>
                      <p
                        className="text-[10px] uppercase tracking-wider"
                        style={{ color: "#3d3f52" }}
                      >
                        Avg. Eng.
                      </p>
                    </div>
                    <div
                      style={{
                        width: 1,
                        height: 28,
                        background: "rgba(255,255,255,0.06)",
                      }}
                    />
                    <div className="text-center">
                      <p
                        className="text-lg font-bold"
                        style={{ color: "#c96ef5" }}
                      >
                        {result.patterns.writingStyle}
                      </p>
                      <p
                        className="text-[10px] uppercase tracking-wider"
                        style={{ color: "#3d3f52" }}
                      >
                        Style
                      </p>
                    </div>
                    <div
                      style={{
                        width: 1,
                        height: 28,
                        background: "rgba(255,255,255,0.06)",
                      }}
                    />
                    <button
                      onClick={handleExport}
                      className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg cursor-pointer transition-all"
                      style={{
                        background: "rgba(255,255,255,0.04)",
                        color: "#6b7280",
                        border: "1px solid rgba(255,255,255,0.08)",
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.color =
                          "#e5e7eb";
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.color =
                          "#6b7280";
                      }}
                    >
                      <svg
                        width="13"
                        height="13"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
                      </svg>
                      Export
                    </button>
                  </div>
                </div>

                {/* Content pillars + keywords */}
                <div className="flex flex-wrap gap-6 animate-fade-in">
                  {result.patterns.contentPillars.length > 0 && (
                    <div>
                      <p
                        className="text-[10px] font-bold uppercase tracking-widest mb-2"
                        style={{ color: "#3d3f52" }}
                      >
                        Pillars
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {result.patterns.contentPillars.map((p, i) => (
                          <span
                            key={i}
                            className="text-[11px] font-semibold px-2.5 py-1 rounded-full"
                            style={{
                              background: "rgba(0,160,220,0.08)",
                              color: "#00a0dc",
                              border: "1px solid rgba(0,160,220,0.15)",
                            }}
                          >
                            {p}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {result.patterns.topPostKeywords.length > 0 && (
                    <div>
                      <p
                        className="text-[10px] font-bold uppercase tracking-widest mb-2"
                        style={{ color: "#3d3f52" }}
                      >
                        Keywords from viral posts
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {result.patterns.topPostKeywords
                          .slice(0, 8)
                          .map((k, i) => (
                            <span
                              key={i}
                              className="text-[11px] font-semibold px-2.5 py-1 rounded-full"
                              style={{
                                background: "rgba(201,110,245,0.08)",
                                color: "#c96ef5",
                                border: "1px solid rgba(201,110,245,0.12)",
                              }}
                            >
                              {k}
                            </span>
                          ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Top viral posts reference */}
                {result.topPosts && result.topPosts.length > 0 && (
                  <div className="animate-fade-in">
                    <p
                      className="text-xs font-bold uppercase tracking-widest mb-3"
                      style={{ color: "#3d3f52" }}
                    >
                      Viral Posts Used as Hook Sources
                    </p>
                    <div className="space-y-3">
                      {result.topPosts.map((post, i) => (
                        <ViralPostCard key={i} post={post} rank={i + 1} />
                      ))}
                    </div>
                  </div>
                )}

                {/* Hooks */}
                <div className="animate-fade-in">
                  <div className="flex items-center justify-between mb-4">
                    <p
                      className="text-sm font-bold"
                      style={{ color: "#f9fafb" }}
                    >
                      <span style={{ color: "#c96ef5" }}>
                        {result.hooks.length}
                      </span>{" "}
                      Hooks Generated
                    </p>
                    <span className="text-[11px]" style={{ color: "#3d3f52" }}>
                      Sorted by predicted engagement ↓
                    </span>
                  </div>

                  <div className="space-y-3">
                    {pagedHooks.map((hook, i) => (
                      <HookCard
                        key={i + (currentPage - 1) * hooksPerPage}
                        hook={hook}
                        index={i + (currentPage - 1) * hooksPerPage}
                        onPromptClick={handleDinaGenerate}
                      />
                    ))}
                  </div>

                  {/* Pagination */}
                  {totalPages > 1 && (
                    <div
                      className="flex items-center justify-between mt-5 pt-4 border-t"
                      style={{ borderColor: "rgba(255,255,255,0.06)" }}
                    >
                      <button
                        onClick={() =>
                          setCurrentPage((p) => Math.max(1, p - 1))
                        }
                        disabled={currentPage === 1}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold cursor-pointer transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                        style={{
                          background: "rgba(255,255,255,0.04)",
                          color: "#6b7280",
                          border: "1px solid rgba(255,255,255,0.08)",
                        }}
                      >
                        <svg
                          width="13"
                          height="13"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <polyline points="15 18 9 12 15 6" />
                        </svg>
                        Previous
                      </button>

                      <div className="flex items-center gap-1.5">
                        {Array.from(
                          { length: totalPages },
                          (_, i) => i + 1,
                        ).map((page) => (
                          <button
                            key={page}
                            onClick={() => setCurrentPage(page)}
                            className="w-7 h-7 rounded-md text-xs font-bold cursor-pointer transition-all"
                            style={{
                              background:
                                currentPage === page
                                  ? "rgba(201,110,245,0.15)"
                                  : "transparent",
                              color:
                                currentPage === page ? "#c96ef5" : "#3d3f52",
                              border:
                                currentPage === page
                                  ? "1px solid rgba(201,110,245,0.3)"
                                  : "1px solid transparent",
                            }}
                          >
                            {page}
                          </button>
                        ))}
                      </div>

                      <button
                        onClick={() =>
                          setCurrentPage((p) => Math.min(totalPages, p + 1))
                        }
                        disabled={currentPage === totalPages}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold cursor-pointer transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                        style={{
                          background: "rgba(255,255,255,0.04)",
                          color: "#6b7280",
                          border: "1px solid rgba(255,255,255,0.08)",
                        }}
                      >
                        Next
                        <svg
                          width="13"
                          height="13"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <polyline points="9 18 15 12 9 6" />
                        </svg>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* ── Dina Caption Modal ── */}
      {dinaModalHook && (
        <div className="fixed inset-0 z-100 flex items-center justify-center p-4 animate-fade-in">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />

          {/* Modal Content */}
          <div
            className="relative w-full max-w-2xl rounded-2xl border p-6 shadow-2xl overflow-y-auto max-h-[85vh] animate-fade-in-up"
            style={{
              background: "#0f1019",
              borderColor: "rgba(255,255,255,0.1)",
            }}
          >
            <div className="flex items-center justify-between mb-6">
              <h2
                className="text-xl font-bold flex items-center gap-3"
                style={{ color: "#f9fafb" }}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "#c96ef5" }}>
                  <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                </svg>
                Dina — Generated Caption
              </h2>
              <button
                onClick={() => { setDinaModalHook(null); setDinaCaption(""); setDinaError(""); }}
                className="text-gray-400 hover:text-white transition-colors cursor-pointer"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* Hook reference */}
            <div
              className="rounded-xl p-4 mb-5 border"
              style={{
                background: "rgba(201,110,245,0.04)",
                borderColor: "rgba(201,110,245,0.12)",
              }}
            >
              <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: "#4b5268" }}>Based on hook</p>
              <p className="text-sm" style={{ color: "#d1d5db" }}>{dinaModalHook.hook}</p>
              <p className="text-[11px] mt-2" style={{ color: "#6b7280" }}>{dinaModalHook.type} — {dinaModalHook.emotionalTrigger}</p>
            </div>

            {/* Loading state */}
            {dinaLoading && (
              <div className="flex flex-col items-center justify-center py-12">
                <div className="w-8 h-8 rounded-full border-2 border-purple-500/20 border-t-purple-400 animate-spin mb-4" />
                <p className="text-sm font-medium" style={{ color: "#e5e7eb" }}>Dina is writing your caption...</p>
                <p className="text-xs mt-1" style={{ color: "#4b5268" }}>Generating via OpenAI</p>
              </div>
            )}

            {/* Error */}
            {dinaError && (
              <div
                className="rounded-lg px-4 py-3 text-xs mb-4"
                style={{
                  background: "rgba(239,68,68,0.08)",
                  border: "1px solid rgba(239,68,68,0.2)",
                  color: "#f87171",
                }}
              >
                {dinaError}
              </div>
            )}

            {/* Generated caption */}
            {dinaCaption && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3
                    className="text-sm font-semibold uppercase tracking-widest"
                    style={{ color: "#c96ef5" }}
                  >
                    Ready-to-Post Caption
                  </h3>
                  <CopyButton text={dinaCaption} />
                </div>
                <div
                  className="rounded-xl p-5 text-sm leading-relaxed whitespace-pre-wrap border"
                  style={{
                    background: "rgba(255,255,255,0.03)",
                    borderColor: "rgba(255,255,255,0.08)",
                    color: "#e5e7eb",
                  }}
                >
                  {dinaCaption}
                </div>
              </div>
            )}

            <div className="mt-6 flex items-center justify-between">
              {dinaCaption && (
                <button
                  onClick={() => handleDinaGenerate(dinaModalHook, true)}
                  disabled={dinaLoading}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold cursor-pointer transition-all disabled:opacity-50"
                  style={{
                    background: "rgba(201,110,245,0.08)",
                    color: "#c96ef5",
                    border: "1px solid rgba(201,110,245,0.2)",
                  }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="23 4 23 10 17 10" />
                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                  </svg>
                  Regenerate
                </button>
              )}
              <div className="ml-auto">
                <button
                  onClick={() => { setDinaModalHook(null); setDinaCaption(""); setDinaError(""); }}
                  className="px-5 py-2.5 rounded-xl text-sm font-bold transition-all cursor-pointer border"
                  style={{
                    background: "rgba(255,255,255,0.05)",
                    borderColor: "rgba(255,255,255,0.1)",
                    color: "#fff",
                  }}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`toast toast-${toast.type}`}>{toast.message}</div>
      )}
    </div>
  );
}

export default function SiennaPage() {
  return (
    <Suspense
      fallback={
        <div
          style={{
            display: "flex",
            minHeight: "100vh",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div className="bg-mesh" />
          <div className="spinner-lg spinner" />
        </div>
      }
    >
      <SiennaPageInner />
    </Suspense>
  );
}
