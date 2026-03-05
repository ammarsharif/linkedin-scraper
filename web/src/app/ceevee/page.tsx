"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";

// ── Types ──────────────────────────────────────────────────────────────────────

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

// ── Helpers ────────────────────────────────────────────────────────────────────

function scoreColor(score: number): string {
  if (score >= 95) return "#00e676";
  if (score >= 90) return "#00b4d8";
  if (score >= 85) return "#c96ef5";
  return "#8b8fa3";
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
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer hover:bg-white/5"
      style={{
        background: copied ? "rgba(0,230,118,0.08)" : "rgba(255,255,255,0.04)",
        borderColor: copied ? "rgba(0,230,118,0.25)" : "rgba(255,255,255,0.08)",
        color: copied ? "#00e676" : "#8b8fa3",
      }}
    >
      {copied ? "Copied" : "Copy Message"}
    </button>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function CeeveePage() {
  const router = useRouter();

  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<ProspectReport | null>(null);
  const [error, setError] = useState("");
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);

  const showToast = useCallback((message: string, type: "success" | "error") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

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

  // Load data from storage (sharing payload from Scraper)
  useEffect(() => {
    try {
      const stateStr = localStorage.getItem("ceevee_state");
      const payloadStr = localStorage.getItem("sienna_payload"); // Usually populated from the scraper
      if (stateStr) {
        const s = JSON.parse(stateStr);
        if (s.profiles) setProfiles(s.profiles);
        if (s.posts) setPosts(s.posts);
        if (s.report) setReport(s.report);
      } else if (payloadStr) {
        const p = JSON.parse(payloadStr) as { profiles: Profile[]; posts: Post[] };
        if (p.profiles && p.profiles.length > 0) setProfiles(p.profiles);
        setPosts(p.posts);
      }
    } catch {
      // ignore
    }
  }, []);

  // Persist state
  useEffect(() => {
    if (profiles.length > 0 && posts.length > 0) {
      localStorage.setItem("ceevee_state", JSON.stringify({ profiles, posts, report }));
    }
  }, [profiles, posts, report]);

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setReport(null);

    if (profiles.length === 0) {
      setError("No profile data found. Go to the Scraper page, scrape a lead, then return here.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/ceevee", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile: profiles[0],
          posts: posts
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 401) {
          router.push("/");
          return;
        }
        setError(data.error || "Failed to generate report");
        return;
      }
      setReport(data as ProspectReport);
      showToast("Prospect report generated successfully ✓", "success");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (checking) {
    return (
      <div style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center" }}>
        <div className="bg-mesh" />
        <div className="spinner-lg spinner" />
      </div>
    );
  }

  return (
    <div className="relative min-h-screen" style={{ background: "#080910" }}>
      <div className="bg-mesh" />
      
      {/* ── Toast ── */}
      {toast && (
        <div
          className="fixed bottom-6 right-6 z-50 animate-fade-in flex items-center gap-3 px-5 py-3 rounded-xl border text-sm font-semibold shadow-2xl"
          style={{
            background: toast.type === "success" ? "rgba(0,230,118,0.1)" : "rgba(239,68,68,0.1)",
            color: toast.type === "success" ? "#00e676" : "#ef4444",
            borderColor: toast.type === "success" ? "rgba(0,230,118,0.2)" : "rgba(239,68,68,0.2)",
            backdropFilter: "blur(12px)",
          }}
        >
          {toast.message}
        </div>
      )}

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
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push("/scraper")}
              className="flex items-center gap-2 text-sm font-medium transition-colors cursor-pointer"
              style={{ color: "#6b7280" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "#00b4d8")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "#6b7280")}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="19" y1="12" x2="5" y2="12" />
                <polyline points="12 19 5 12 12 5" />
              </svg>
              Back
            </button>
            <div style={{ width: 1, height: 20, background: "rgba(255,255,255,0.08)" }} />
            <div className="flex items-center gap-2.5">
              <div
                className="flex items-center justify-center rounded-lg shadow-lg"
                style={{
                  width: 32,
                  height: 32,
                  background: "linear-gradient(135deg, #0284c7, #00b4d8)",
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-bold" style={{ color: "#e5e7eb", lineHeight: 1.2 }}>Ceevee</p>
                <p className="text-[11px]" style={{ color: "#4b5268" }}>Prospect Research Bot</p>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* ── Main ── */}
      <main className="relative z-10 mx-auto max-w-5xl px-6 py-12">
        {!report ? (
          <div className="max-w-2xl mx-auto space-y-8 animate-fade-in text-center mt-10">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest mb-3" style={{ color: "#00b4d8" }}>
                Deep Research on Autopilot
              </p>
              <h1 className="text-4xl font-extrabold tracking-tight leading-tight mb-4" style={{ color: "#ffffff" }}>
                Eliminate the 15-minute <span className="bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-blue-500">Manual Research</span> phase.
              </h1>
              <p className="text-[15px] leading-relaxed mx-auto max-w-lg" style={{ color: "#a1a1aa" }}>
                Ceevee instantly synthesizes your prospect's profile data and recent activity into actionable insights and high-converting, personalized icebreakers.
              </p>
            </div>

            {profiles.length > 0 ? (
              <form onSubmit={handleGenerate} className="p-8 rounded-2xl border bg-black/40 backdrop-blur-xl border-white/10 shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
                   <svg width="120" height="120" viewBox="0 0 24 24" fill="white"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
                </div>
                
                <h3 className="text-lg font-semibold text-white mb-2">Ready to research <span style={{ color: "#00b4d8" }}>{profiles[0].name}</span>?</h3>
                <p className="text-sm text-gray-400 mb-6">Found {posts.length} posts and profile data.</p>
                
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl font-bold text-[15px] transition-all cursor-pointer disabled:opacity-50"
                  style={{
                    background: "linear-gradient(135deg, #0ea5e9, #2563eb)",
                    color: "white",
                    boxShadow: "0 4px 14px 0 rgba(14, 165, 233, 0.39)",
                    textShadow: "0 1px 2px rgba(0,0,0,0.2)",
                  }}
                >
                  {loading ? (
                    <>
                      <div className="spinner-sm spinner" />
                      Analyzing Prospect Data...
                    </>
                  ) : (
                    <>
                      Generate Prospect Dossier
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                    </>
                  )}
                </button>
                {error && <p className="text-red-400 text-sm mt-4">{error}</p>}
              </form>
            ) : (
              <div className="p-6 rounded-2xl border bg-white/5 border-white/10 inline-block">
                <p className="text-gray-400 mb-4">You need to scrape a LinkedIn profile first.</p>
                <button
                  onClick={() => router.push("/scraper")}
                  className="px-6 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white font-medium transition-colors"
                >
                  Go to Scraper
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-10 animate-fade-in">
            {/* Report Header */}
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-3xl font-bold text-white mb-2">{report.profile.name}</h2>
                <p className="text-gray-400 max-w-2xl leading-relaxed">{report.profile.headline}</p>
                <div className="flex items-center gap-3 mt-4">
                  <span className="text-xs font-medium px-2.5 py-1 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">{report.summary.roleLevel}</span>
                  {report.summary.industryHints.map((ind) => (
                    <span key={ind} className="text-xs font-medium px-2.5 py-1 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20">{ind}</span>
                  ))}
                </div>
              </div>
              <button
                onClick={() => setReport(null)}
                className="text-sm px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 font-medium transition-all border border-white/10"
              >
                Reset
              </button>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
              {/* Insights */}
              <div className="space-y-6">
                <h3 className="text-lg font-semibold text-white/90 border-b border-white/10 pb-2">Key Insights</h3>
                {report.insights.map((insight, i) => (
                  <div key={i} className="p-5 rounded-2xl bg-white/[0.03] border border-white/5 hover:bg-white/[0.05] transition-colors shadow-lg">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded">
                        {insight.category}
                      </span>
                    </div>
                    <h4 className="text-[15px] font-semibold text-gray-200 mb-1.5">{insight.title}</h4>
                    <p className="text-sm text-gray-400 leading-relaxed mb-4">{insight.description}</p>
                    
                    {insight.evidence.length > 0 && (
                      <div className="p-3 rounded-lg bg-black/40 border border-white/5 border-l-2 border-l-blue-500">
                        <p className="text-[11px] font-medium text-gray-500 mb-1 uppercase tracking-wider">Evidence from Posts</p>
                        <p className="text-xs text-gray-300 italic">"{insight.evidence[0]}"</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Icebreakers */}
              <div className="space-y-6">
                <h3 className="text-lg font-semibold text-white/90 border-b border-white/10 pb-2">Personalized Icebreakers</h3>
                {report.icebreakers.map((ib, i) => (
                  <div key={i} className="p-5 rounded-2xl bg-[#0b0c14] border border-white/10 shadow-xl relative overflow-hidden group">
                     {/* Score indicator */}
                    <div className="absolute top-4 right-4 flex items-center gap-1.5">
                      <span className="text-[10px] text-gray-500 font-medium uppercase tracking-wider">Quality Match</span>
                      <span className="text-xs font-bold font-mono px-1.5 py-0.5 rounded" style={{ color: scoreColor(ib.rating), background: `${scoreColor(ib.rating)}15` }}>
                        {ib.rating}%
                      </span>
                    </div>

                    <h4 className="text-sm font-semibold text-gray-200 mb-4 pr-24 flex items-center gap-2">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#00b4d8" strokeWidth="2.5"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                      {ib.type}
                    </h4>
                    
                    <div className="p-4 rounded-xl bg-white/5 border border-white/5 mb-4 font-mono text-sm text-gray-300 whitespace-pre-wrap leading-relaxed shadow-inner">
                      {ib.text}
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <p className="text-[11px] text-gray-500 max-w-[70%]">
                        <strong className="text-gray-400 font-medium">Why it works:</strong> {ib.rationale}
                      </p>
                      <CopyButton text={ib.text} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
