"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { 
  Search, 
  Copy, 
  Check, 
  Linkedin, 
  Mail, 
  MessageSquare, 
  Zap, 
  RotateCcw, 
  FileText 
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────

interface Profile {
  name: string;
  headline: string;
  location: string;
  profileUrl: string;
  vanityName?: string;
}

interface PostSummary {
  text: string;
  reactionsCount: number;
  commentsCount: number;
  repostsCount: number;
  postedDate: string;
  postUrl: string;
}

interface TopicInsight {
  topic: string;
  frequency: string;
  stance: string;
  evidence: string;
}

interface ConversationStarter {
  approach: string;
  message: string;
  rationale: string;
  confidence: number;
}

interface ProspectReport {
  executiveSummary: string;
  profileAnalysis: {
    roleLevel: string;
    industryFocus: string[];
    areasOfExpertise: string[];
    estimatedCompanyStage: string;
  };
  careerTrajectory: {
    currentFocus: string;
    keyTransitions: string;
    notableCompanies: string[];
    awardsAndCertifications: string[];
    educationBackground: string;
  };
  contentAnalysis: {
    primaryTopics: TopicInsight[];
    contentStyle: string;
    postingPatterns: string;
    topPerformingContent: string;
  };
  professionalInsights: {
    currentFocus: string;
    challengesMentioned: string[];
    achievementsMentioned: string[];
    toolsAndTechnologies: string[];
    networkAndInfluence: string;
  };
  personalityProfile: {
    communicationStyle: string;
    values: string[];
    petPeeves: string[];
    motivations: string[];
  };
  conversationStarters: ConversationStarter[];
  keyReferences: {
    quotableLines: string[];
    topicsToAvoid: string[];
    commonGround: string[];
  };
}

interface CeeveeResponse {
  success: boolean;
  profile: Profile;
  posts: PostSummary[];
  report: ProspectReport;
  meta: {
    postsAnalyzed: number;
    generatedAt: string;
    poweredBy: string;
  };
}

// ── Copy Button ────────────────────────────────────────────────────────────────

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="ceevee-copy-btn"
      style={{
        background: copied ? "rgba(0,230,118,0.08)" : "rgba(255,255,255,0.04)",
        borderColor: copied ? "rgba(0,230,118,0.25)" : "rgba(255,255,255,0.08)",
        color: copied ? "#00e676" : "#8b8fa3",
      }}
    >
      {copied ? (
        <>
          <Check size={12} strokeWidth={2.5} />
          Copied
        </>
      ) : (
        <>
          <Copy size={12} />
          {label || "Copy"}
        </>
      )}
    </button>
  );
}

// ── Confidence Badge ───────────────────────────────────────────────────────────

function ConfidenceBadge({ score }: { score: number }) {
  let color = "#8b8fa3";
  let label = "Fair";
  if (score >= 90) { color = "#00e676"; label = "Excellent"; }
  else if (score >= 80) { color = "#00b4d8"; label = "Strong"; }
  else if (score >= 70) { color = "#c96ef5"; label = "Good"; }

  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-bold"
      style={{ color, background: `${color}15`, border: `1px solid ${color}30` }}
    >
      {score}% {label}
    </span>
  );
}

// ── Section Header ─────────────────────────────────────────────────────────────

function SectionHeader({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle?: string }) {
  return (
    <div className="flex items-center gap-3 mb-5">
      <div
        className="flex items-center justify-center rounded-lg shrink-0"
        style={{ width: 36, height: 36, background: "rgba(2,132,199,0.1)", border: "1px solid rgba(2,132,199,0.2)" }}
      >
        {icon}
      </div>
      <div>
        <h3 className="text-[15px] font-bold text-white">{title}</h3>
        {subtitle && <p className="text-[11px] mt-0.5" style={{ color: "#5a5e72" }}>{subtitle}</p>}
      </div>
    </div>
  );
}

// ── Loading States ────────────────────────────────────────────────────────────

const LOADING_STEPS = [
  "Connecting to LinkedIn...",
  "Extracting profile data...",
  "Scraping recent posts...",
  "Analyzing content patterns...",
  "Building intelligence report...",
  "Generating conversation starters...",
  "Finalizing dossier...",
];

function LoadingOverlay({ step }: { step: number }) {
  return (
    <div className="max-w-md mx-auto mt-16 animate-fade-in">
      <div className="p-8 rounded-2xl border border-white/10 bg-black/40 backdrop-blur-xl text-center">
        <div
          className="mx-auto mb-6 flex items-center justify-center rounded-2xl"
          style={{
            width: 64,
            height: 64,
            background: "linear-gradient(135deg, #0ea5e9, #2563eb)",
            boxShadow: "0 0 40px rgba(14, 165, 233, 0.3)",
            animation: "ceevee-pulse 2s ease-in-out infinite",
          }}
        >
          <Search size={28} />
        </div>

        <h3 className="text-lg font-bold text-white mb-2">Researching Prospect</h3>
        <p className="text-sm text-gray-400 mb-6">This may take 30-60 seconds</p>

        <div className="space-y-2">
          {LOADING_STEPS.map((label, i) => (
            <div
              key={i}
              className="flex items-center gap-3 px-4 py-2 rounded-lg transition-all duration-500"
              style={{
                background: i === step ? "rgba(14,165,233,0.08)" : "transparent",
                opacity: i <= step ? 1 : 0.3,
              }}
            >
              <div className="w-5 h-5 flex items-center justify-center shrink-0">
                {i < step ? (
                  <Check size={14} stroke="#00e676" strokeWidth={2.5} />
                ) : i === step ? (
                  <div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
                ) : (
                  <div className="w-1.5 h-1.5 rounded-full bg-gray-600" />
                )}
              </div>
              <span className="text-sm" style={{ color: i <= step ? "#e5e7eb" : "#5a5e72" }}>
                {label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function CeeveePage() {
  const router = useRouter();

  const [checking, setChecking] = useState(true);
  const [profileUrl, setProfileUrl] = useState("");
  const [postsLimit, setPostsLimit] = useState(10);
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [data, setData] = useState<CeeveeResponse | null>(null);
  const [error, setError] = useState("");
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [activeSection, setActiveSection] = useState(0);

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

  // Check for pre-scraped data from scraper page
  useEffect(() => {
    try {
      const stateStr = localStorage.getItem("ceevee_state");
      if (stateStr) {
        const s = JSON.parse(stateStr);
        if (s.data) setData(s.data);
      }
    } catch {
      // ignore
    }
  }, []);

  // Persist state & auto-store to Demarko/MongoDB
  useEffect(() => {
    if (data) {
      localStorage.setItem("ceevee_state", JSON.stringify({ data }));
      // Auto-store to MongoDB for Demarko outreach
      fetch("/api/demarko", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "store-profile",
          profile: data.profile,
          report: data.report,
        }),
      }).catch(() => {}); // silently fail
    }
  }, [data]);

  // Loading step animation
  useEffect(() => {
    if (!loading) return;
    const interval = setInterval(() => {
      setLoadingStep((prev) => {
        if (prev < LOADING_STEPS.length - 1) return prev + 1;
        return prev;
      });
    }, 5000);
    return () => clearInterval(interval);
  }, [loading]);

  async function handleAnalyze(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setData(null);
    setLoadingStep(0);

    const url = profileUrl.trim();
    if (!url || !url.includes("linkedin.com/in/")) {
      setError("Please enter a valid LinkedIn profile URL (e.g. https://linkedin.com/in/username)");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/ceevee", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileUrl: url, postsLimit }),
      });
      const result = await res.json();

      if (!res.ok) {
        if (res.status === 401) {
          showToast("LinkedIn session expired. Please re-authenticate.", "error");
          localStorage.removeItem("scraper_state");
          localStorage.removeItem("sienna_state");
          localStorage.removeItem("sienna_payload");
          localStorage.removeItem("ceevee_state");
          localStorage.removeItem("inti_state");
          await fetch("/api/auth", { method: "DELETE" });
          router.push("/");
          return;
        }
        setError(result.error || "Failed to generate report");
        return;
      }

      setData(result as CeeveeResponse);
      showToast("Prospect dossier generated successfully", "success");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  // Handle pre-scraped data flow from scraper
  async function handleAnalyzeFromScraper() {
    setError("");
    setData(null);
    setLoadingStep(0);
    setLoading(true);

    try {
      const payloadStr = localStorage.getItem("sienna_payload");
      if (!payloadStr) {
        setError("No scraped data found. Please scrape a profile first.");
        setLoading(false);
        return;
      }

      const payload = JSON.parse(payloadStr);
      if (!payload.profiles || payload.profiles.length === 0) {
        setError("No profile data found.");
        setLoading(false);
        return;
      }

      const res = await fetch("/api/ceevee", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile: payload.profiles[0],
          posts: payload.posts,
        }),
      });

      const result = await res.json();

      if (!res.ok) {
        if (res.status === 401) {
          showToast("LinkedIn session expired. Please re-authenticate.", "error");
          localStorage.removeItem("scraper_state");
          localStorage.removeItem("sienna_state");
          localStorage.removeItem("sienna_payload");
          localStorage.removeItem("ceevee_state");
          localStorage.removeItem("inti_state");
          await fetch("/api/auth", { method: "DELETE" });
          router.push("/");
          return;
        }
        setError(result.error || "Failed to generate report");
        return;
      }

      setData(result as CeeveeResponse);
      showToast("Prospect dossier generated successfully", "success");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function handleReset() {
    setData(null);
    setProfileUrl("");
    setError("");
    localStorage.removeItem("ceevee_state");
  }

  if (checking) {
    return (
      <div style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center" }}>
        <div className="bg-mesh" />
        <div className="spinner-lg spinner" />
      </div>
    );
  }

  const report = data?.report;
  const personalityProfile = report?.personalityProfile;
  const hasScraperData = typeof window !== "undefined" && !!localStorage.getItem("sienna_payload");

  // ── Report Section Tabs ────────────────────────────────────────────────────

  const SECTIONS = [
    { label: "Overview", id: "overview" },
    { label: "Content", id: "content" },
    { label: "Career", id: "career" },
    { label: "Professional", id: "professional" },
    { label: "Personality", id: "personality" },
    { label: "Messages", id: "messages" },
    { label: "References", id: "references" },
  ];

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
              className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer border"
              style={{
                background: "rgba(0,0,0,0.4)",
                borderColor: "rgba(0,180,216,0.3)",
                color: "#00b4d8",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(0,180,216,0.08)";
                e.currentTarget.style.borderColor = "rgba(0,180,216,0.5)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "rgba(0,0,0,0.4)";
                e.currentTarget.style.borderColor = "rgba(0,180,216,0.3)";
              }}
            >
              <Linkedin size={13} strokeWidth={2.5} />
              <span>Scraper</span>
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
                <Search size={16} stroke="white" />
              </div>
              <div>
                <p className="text-sm font-bold" style={{ color: "#e5e7eb", lineHeight: 1.2 }}>Ceevee</p>
                <p className="text-[11px]" style={{ color: "#4b5268" }}>Prospect Research Bot</p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {data && (
              <button
                className="flex items-center gap-2 rounded-xl px-3.5 py-1.5 text-xs font-bold transition-all cursor-default border"
                style={{
                  background: "rgba(14,165,233,0.1)",
                  borderColor: "rgba(14,165,233,0.4)",
                  color: "#0ea5e9",
                }}
              >
                  <Search size={13} strokeWidth={2.5} />
                <span>Ceevee</span>
              </button>
            )}
            {data && (
              <button
                onClick={() => router.push("/demarko")}
                className="flex items-center gap-2 rounded-xl px-3.5 py-1.5 text-xs font-bold transition-all cursor-pointer border"
                style={{
                  background: "rgba(0,0,0,0.4)",
                  borderColor: "rgba(249,115,22,0.3)",
                  color: "#f97316",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(249,115,22,0.08)";
                  e.currentTarget.style.borderColor = "rgba(249,115,22,0.5)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(0,0,0,0.4)";
                  e.currentTarget.style.borderColor = "rgba(249,115,22,0.3)";
                }}
              >
                  <Mail size={13} strokeWidth={2.5} />
                <span>Demarko</span>
              </button>
            )}
            {data && (
              <button
                onClick={() => router.push("/inti")}
                className="flex items-center gap-2 rounded-xl px-3.5 py-1.5 text-xs font-bold transition-all cursor-pointer border"
                style={{
                  background: "rgba(0,0,0,0.4)",
                  borderColor: "rgba(99,102,241,0.3)",
                  color: "#818cf8",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(99,102,241,0.08)";
                  e.currentTarget.style.borderColor = "rgba(99,102,241,0.5)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(0,0,0,0.4)";
                  e.currentTarget.style.borderColor = "rgba(99,102,241,0.3)";
                }}
              >
                  <MessageSquare size={13} strokeWidth={2.5} />
                <span>Inti</span>
              </button>
            )}
            {data && (
              <button
                onClick={() => {
                  const sPayload = localStorage.getItem("sienna_payload");
                  if (sPayload) {
                    router.push("/sienna");
                  } else {
                    showToast("No scraper data found for Sienna", "error");
                  }
                }}
                className="flex items-center gap-2 rounded-xl px-3.5 py-1.5 text-xs font-bold transition-all cursor-pointer border"
                style={{
                  background: "rgba(0,0,0,0.4)",
                  borderColor: "rgba(201,110,245,0.3)",
                  color: "#c96ef5",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(201,110,245,0.08)";
                  e.currentTarget.style.borderColor = "rgba(201,110,245,0.5)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(0,0,0,0.4)";
                  e.currentTarget.style.borderColor = "rgba(201,110,245,0.3)";
                }}
              >
                  <Zap size={13} strokeWidth={2.5} />
                <span>Sienna</span>
              </button>
            )}
            {data && (
              <button
                onClick={handleReset}
                className="text-sm px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 font-medium transition-all border border-white/10 cursor-pointer"
              >
                <RotateCcw size={14} className="mr-2 inline" />
                New Research
              </button>
            )}
          </div>
        </div>
      </header>

      {/* ── Main ── */}
      <main className="relative z-10 mx-auto max-w-6xl px-6 py-10">
        {loading ? (
          <LoadingOverlay step={loadingStep} />
        ) : !data ? (
          /* ── Input View ── */
          <div className="max-w-2xl mx-auto mt-8 animate-fade-in">
            <div className="text-center mb-10">
              <p
                className="text-[11px] font-bold uppercase tracking-widest mb-3"
                style={{ color: "#00b4d8" }}
              >
                AI-Powered Prospect Intelligence
              </p>
              <h1
                className="text-4xl font-extrabold tracking-tight leading-tight mb-4"
                style={{ color: "#ffffff" }}
              >
                Know your prospect{" "}
                <span className="bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-blue-500">
                  before you message.
                </span>
              </h1>
              <p className="text-[15px] leading-relaxed mx-auto max-w-lg" style={{ color: "#a1a1aa" }}>
                Paste a LinkedIn profile URL. Ceevee will scrape their profile and posts, then use AI to generate a
                comprehensive research dossier with personalized conversation starters.
              </p>
            </div>

            <form
              onSubmit={handleAnalyze}
              className="p-8 rounded-2xl border bg-black/40 backdrop-blur-xl border-white/10 shadow-2xl"
            >
              <div className="mb-5">
                <label htmlFor="ceevee-url" className="mb-2 block text-sm font-medium text-gray-200">
                  LinkedIn Profile URL
                </label>
                <input
                  id="ceevee-url"
                  type="url"
                  className="premium-input"
                  placeholder="https://linkedin.com/in/username"
                  value={profileUrl}
                  onChange={(e) => setProfileUrl(e.target.value)}
                  required
                  autoFocus
                />
              </div>

              <div className="mb-6">
                <label htmlFor="ceevee-limit" className="mb-2 block text-sm font-medium text-gray-200">
                  Posts to analyze
                </label>
                <div className="flex items-center gap-4">
                  <input
                    id="ceevee-limit"
                    type="range"
                    min={2}
                    max={30}
                    value={postsLimit}
                    onChange={(e) => setPostsLimit(Number(e.target.value))}
                    className="flex-1"
                    style={{
                      accentColor: "#0ea5e9",
                      height: 4,
                    }}
                  />
                  <span className="text-sm font-mono font-bold text-white min-w-[40px] text-right">{postsLimit}</span>
                </div>
                <p className="mt-1.5 text-xs" style={{ color: "#5a5e72" }}>
                  More posts = deeper analysis, but takes longer
                </p>
              </div>

              <button
                type="submit"
                disabled={loading || !profileUrl.trim()}
                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl font-bold text-[15px] transition-all cursor-pointer disabled:opacity-50"
                style={{
                  background: "linear-gradient(135deg, #0ea5e9, #2563eb)",
                  color: "white",
                  boxShadow: "0 4px 14px 0 rgba(14, 165, 233, 0.39)",
                }}
              >
                  <Search size={18} />
                Research This Prospect
              </button>

              {error && <p className="text-red-400 text-sm mt-4">{error}</p>}
            </form>

            {/* Divider: OR use scraped data */}
            {hasScraperData && (
              <div className="mt-8">
                <div className="flex items-center gap-4 mb-6">
                  <div className="flex-1 h-px bg-white/10" />
                  <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Or use scraped data
                  </span>
                  <div className="flex-1 h-px bg-white/10" />
                </div>
                <button
                  onClick={handleAnalyzeFromScraper}
                  className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl font-bold text-[15px] transition-all cursor-pointer border"
                  style={{
                    background: "rgba(255,255,255,0.03)",
                    borderColor: "rgba(255,255,255,0.1)",
                    color: "#e5e7eb",
                  }}
                >
                  <FileText size={16} />
                  Analyze Previously Scraped Profile
                </button>
              </div>
            )}
          </div>
        ) : (
          /* ── Report View ── */
          <div className="animate-fade-in">
            {/* Report Header */}
            <div className="mb-8 p-6 rounded-2xl border border-white/10 bg-black/30 backdrop-blur-xl">
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-4">
                  <div
                    className="flex items-center justify-center rounded-xl text-lg font-bold text-white shrink-0"
                    style={{
                      width: 56,
                      height: 56,
                      background: "linear-gradient(135deg, #0ea5e9, #2563eb)",
                      boxShadow: "0 4px 16px rgba(14, 165, 233, 0.3)",
                    }}
                  >
                    {data.profile.name
                      .split(" ")
                      .map((n) => n[0])
                      .join("")
                      .slice(0, 2)}
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold text-white mb-1">{data.profile.name}</h2>
                    <p className="text-sm text-gray-400 max-w-xl leading-relaxed">{data.profile.headline}</p>
                    <div className="flex flex-wrap items-center gap-2 mt-3">
                      {report?.profileAnalysis?.roleLevel && (
                        <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
                          {report.profileAnalysis.roleLevel}
                        </span>
                      )}
                      {report?.profileAnalysis?.industryFocus?.map((ind) => (
                        <span
                          key={ind}
                          className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20"
                        >
                          {ind}
                        </span>
                      ))}
                      {data.profile.location && (
                        <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-white/5 text-gray-400 border border-white/10">
                          {data.profile.location}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[11px] text-gray-500 mb-1">Posts analyzed</p>
                  <p className="text-2xl font-bold text-white">{data.meta.postsAnalyzed}</p>
                  <a
                    href={data.profile.profileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-400 hover:underline mt-2 inline-block"
                  >
                    View Profile
                  </a>
                </div>
              </div>
            </div>

            {/* Section Tabs */}
            <div className="flex gap-1 mb-8 p-1 rounded-xl bg-white/[0.03] border border-white/5 overflow-x-auto">
              {SECTIONS.map((s, i) => (
                <button
                  key={s.id}
                  onClick={() => setActiveSection(i)}
                  className="px-4 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer whitespace-nowrap"
                  style={{
                    background: activeSection === i ? "rgba(14,165,233,0.12)" : "transparent",
                    color: activeSection === i ? "#0ea5e9" : "#6b7280",
                    border: activeSection === i ? "1px solid rgba(14,165,233,0.2)" : "1px solid transparent",
                  }}
                >
                  {s.label}
                </button>
              ))}
            </div>

            {/* ── Section: Overview ── */}
            {activeSection === 0 && report && (
              <div className="space-y-6 animate-fade-in">
                {/* Executive Summary */}
                <div className="p-6 rounded-2xl border border-white/10 bg-white/[0.02]">
                  <SectionHeader
                    icon={
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0ea5e9" strokeWidth="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                        <line x1="16" y1="13" x2="8" y2="13" />
                        <line x1="16" y1="17" x2="8" y2="17" />
                      </svg>
                    }
                    title="Executive Summary"
                    subtitle="High-level briefing on this prospect"
                  />
                  <p className="text-[15px] leading-relaxed text-gray-300">{report.executiveSummary}</p>
                </div>

                {/* Profile Analysis Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-5 rounded-xl border border-white/8 bg-white/[0.02]">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-2">Areas of Expertise</p>
                    <div className="flex flex-wrap gap-2">
                      {report.profileAnalysis.areasOfExpertise.map((area) => (
                        <span
                          key={area}
                          className="text-xs font-medium px-2.5 py-1 rounded-lg bg-cyan-500/8 text-cyan-400 border border-cyan-500/15"
                        >
                          {area}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="p-5 rounded-xl border border-white/8 bg-white/[0.02]">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-2">Company Stage</p>
                    <p className="text-sm text-gray-300">{report.profileAnalysis.estimatedCompanyStage}</p>
                  </div>
                </div>

                {/* Current Focus */}
                <div className="p-5 rounded-xl border border-white/8 bg-white/[0.02]">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-2">Current Focus</p>
                  <p className="text-sm text-gray-300 leading-relaxed">{report.professionalInsights.currentFocus}</p>
                </div>

                {/* Achievements + Challenges */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {report.professionalInsights.achievementsMentioned.length > 0 && (
                    <div className="p-5 rounded-xl border border-white/8 bg-white/[0.02]">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-green-400/60 mb-3">
                        Achievements Mentioned
                      </p>
                      <ul className="space-y-2">
                        {report.professionalInsights.achievementsMentioned.map((a, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-gray-300">
                            <span className="text-green-400 shrink-0 mt-1">
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            </span>
                            {a}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {report.professionalInsights.challengesMentioned.length > 0 && (
                    <div className="p-5 rounded-xl border border-white/8 bg-white/[0.02]">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-amber-400/60 mb-3">
                        Challenges Identified
                      </p>
                      <ul className="space-y-2">
                        {report.professionalInsights.challengesMentioned.map((c, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-gray-300">
                            <span className="text-amber-400 shrink-0 mt-1">
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <circle cx="12" cy="12" r="10" />
                                <line x1="12" y1="8" x2="12" y2="12" />
                                <line x1="12" y1="16" x2="12.01" y2="16" />
                              </svg>
                            </span>
                            {c}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── Section: Content Analysis ── */}
            {activeSection === 1 && report && (
              <div className="space-y-6 animate-fade-in">
                {/* Content Style */}
                <div className="p-6 rounded-2xl border border-white/10 bg-white/[0.02]">
                  <SectionHeader
                    icon={
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0ea5e9" strokeWidth="2">
                        <path d="M12 20h9" />
                        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                      </svg>
                    }
                    title="Content Strategy"
                    subtitle="How they create and share content"
                  />
                  <div className="space-y-4">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">Writing Style</p>
                      <p className="text-sm text-gray-300 leading-relaxed">{report.contentAnalysis.contentStyle}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">Posting Patterns</p>
                      <p className="text-sm text-gray-300 leading-relaxed">{report.contentAnalysis.postingPatterns}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">Top Performing Content</p>
                      <p className="text-sm text-gray-300 leading-relaxed">{report.contentAnalysis.topPerformingContent}</p>
                    </div>
                  </div>
                </div>

                {/* Primary Topics */}
                <div className="space-y-4">
                  <h3 className="text-[15px] font-bold text-white">Topics They Post About</h3>
                  {report.contentAnalysis.primaryTopics.map((t, i) => (
                    <div
                      key={i}
                      className="p-5 rounded-xl border border-white/8 bg-white/[0.02] hover:bg-white/[0.04] transition-colors"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-sm font-semibold text-gray-200">{t.topic}</h4>
                        <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
                          {t.frequency}
                        </span>
                      </div>
                      <p className="text-sm text-gray-400 leading-relaxed mb-3">{t.stance}</p>
                      <div className="p-3 rounded-lg bg-black/30 border-l-2 border-l-blue-500/50">
                        <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wider mb-1">Evidence</p>
                        <p className="text-xs text-gray-300 italic leading-relaxed">"{t.evidence}"</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Section: Career Trajectory ── */}
            {activeSection === 2 && report && ("careerTrajectory" in report) && (
              <div className="space-y-6 animate-fade-in">
                <div className="p-6 rounded-2xl border border-white/10 bg-white/[0.02]">
                  <SectionHeader
                    icon={
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0ea5e9" strokeWidth="2">
                        <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
                      </svg>
                    }
                    title="Career Trajectory"
                    subtitle="Work history, transitions, and background"
                  />
                  <div className="space-y-5">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">Current Focus</p>
                      <p className="text-sm text-gray-300 leading-relaxed">{(report as any).careerTrajectory.currentFocus}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">Key Transitions</p>
                      <p className="text-sm text-gray-300 leading-relaxed">{(report as any).careerTrajectory.keyTransitions}</p>
                    </div>
                    {((report as any).careerTrajectory.educationBackground) && (
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">Education Background</p>
                        <p className="text-sm text-gray-300 leading-relaxed">{(report as any).careerTrajectory.educationBackground}</p>
                      </div>
                    )}
                  </div>
                </div>

                {((report as any).careerTrajectory.notableCompanies?.length > 0) && (
                  <div className="p-5 rounded-xl border border-white/8 bg-white/[0.02]">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-blue-400/60 mb-3">
                      Notable Companies
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {((report as any).careerTrajectory.notableCompanies).map((c: string, i: number) => (
                        <span key={i} className="text-xs font-medium px-2.5 py-1.5 rounded-lg bg-blue-500/10 text-blue-300 border border-blue-500/20">
                          {c}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                
                {((report as any).careerTrajectory.awardsAndCertifications?.length > 0) && (
                  <div className="p-5 rounded-xl border border-white/8 bg-white/[0.02]">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-indigo-400/60 mb-3">
                      Awards & Certifications
                    </p>
                    <ul className="space-y-3">
                      {((report as any).careerTrajectory.awardsAndCertifications).map((a: string, i: number) => (
                        <li key={i} className="flex items-start gap-3 text-sm text-gray-300 leading-relaxed">
                          <span className="text-indigo-400 shrink-0 mt-0.5">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                            </svg>
                          </span>
                          {a}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* ── Section: Professional Insights ── */}
            {activeSection === 3 && report && (
              <div className="space-y-6 animate-fade-in">
                <div className="p-6 rounded-2xl border border-white/10 bg-white/[0.02]">
                  <SectionHeader
                    icon={
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0ea5e9" strokeWidth="2">
                        <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
                        <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
                      </svg>
                    }
                    title="Professional Intelligence"
                    subtitle="Career insights and expertise indicators"
                  />

                  <div className="space-y-5">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">Network and Influence</p>
                      <p className="text-sm text-gray-300 leading-relaxed">{report.professionalInsights.networkAndInfluence}</p>
                    </div>

                    {report.professionalInsights.toolsAndTechnologies.length > 0 && (
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-2">
                          Tools and Technologies
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {report.professionalInsights.toolsAndTechnologies.map((t) => (
                            <span
                              key={t}
                              className="text-xs font-medium px-2.5 py-1 rounded-lg bg-white/5 text-gray-300 border border-white/10"
                            >
                              {t}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Achievements Detail */}
                {report.professionalInsights.achievementsMentioned.length > 0 && (
                  <div className="p-5 rounded-xl border border-white/8 bg-white/[0.02]">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-green-400/60 mb-3">
                      Achievements and Milestones
                    </p>
                    <ul className="space-y-3">
                      {report.professionalInsights.achievementsMentioned.map((a, i) => (
                        <li key={i} className="flex items-start gap-3 text-sm text-gray-300 leading-relaxed">
                          <span className="text-green-400 shrink-0 mt-0.5">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          </span>
                          {a}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Challenges Detail */}
                {report.professionalInsights.challengesMentioned.length > 0 && (
                  <div className="p-5 rounded-xl border border-white/8 bg-white/[0.02]">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-amber-400/60 mb-3">
                      Challenges and Pain Points
                    </p>
                    <ul className="space-y-3">
                      {report.professionalInsights.challengesMentioned.map((c, i) => (
                        <li key={i} className="flex items-start gap-3 text-sm text-gray-300 leading-relaxed">
                          <span className="text-amber-400 shrink-0 mt-0.5">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <circle cx="12" cy="12" r="10" />
                              <line x1="12" y1="8" x2="12" y2="12" />
                              <line x1="12" y1="16" x2="12.01" y2="16" />
                            </svg>
                          </span>
                          {c}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* ── Section: Personality Profile ── */}
            {activeSection === 4 && report && (
              <div className="space-y-6 animate-fade-in">
                <div className="p-6 rounded-2xl border border-white/10 bg-white/[0.02]">
                  <SectionHeader
                    icon={
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0ea5e9" strokeWidth="2">
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                        <circle cx="12" cy="7" r="4" />
                      </svg>
                    }
                    title="Personality Profile"
                    subtitle="Communication style and behavioral patterns"
                  />

                  <div className="space-y-5">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">Communication Style</p>
                      <p className="text-sm text-gray-300 leading-relaxed">{personalityProfile?.communicationStyle}</p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="p-5 rounded-xl border border-white/8 bg-white/[0.02]">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-blue-400/60 mb-3">Core Values</p>
                    <ul className="space-y-2">
                      {Array.isArray(personalityProfile?.values) && personalityProfile.values.map((v, i) => (
                        <li key={i} className="text-sm text-gray-300 flex items-start gap-2">
                          <span className="text-blue-400 shrink-0 mt-1">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                              <circle cx="12" cy="12" r="5" />
                            </svg>
                          </span>
                          {v}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="p-5 rounded-xl border border-white/8 bg-white/[0.02]">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-cyan-400/60 mb-3">Motivations</p>
                    <ul className="space-y-2">
                      {Array.isArray(personalityProfile?.motivations) && personalityProfile.motivations.map((m, i) => (
                        <li key={i} className="text-sm text-gray-300 flex items-start gap-2">
                          <span className="text-cyan-400 shrink-0 mt-1">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                            </svg>
                          </span>
                          {m}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="p-5 rounded-xl border border-white/8 bg-white/[0.02]">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-red-400/60 mb-3">Complaint</p>
                    <ul className="space-y-2">
                      {Array.isArray(personalityProfile?.petPeeves) && personalityProfile.petPeeves.map((p, i) => (
                        <li key={i} className="text-sm text-gray-300 flex items-start gap-2">
                          <span className="text-red-400 shrink-0 mt-1">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                              <line x1="18" y1="6" x2="6" y2="18" />
                              <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                          </span>
                          {p}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}

            {/* ── Section: Conversation Starters ── */}
            {activeSection === 5 && report && (
              <div className="space-y-6 animate-fade-in">
                <SectionHeader
                  icon={
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0ea5e9" strokeWidth="2">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </svg>
                  }
                  title="Personalized Messages"
                  subtitle="Ready-to-send conversation starters, ranked by confidence"
                />

                {report.conversationStarters.map((cs, i) => (
                  <div
                    key={i}
                    className="p-6 rounded-2xl border border-white/10 bg-[#0b0c14] shadow-xl hover:border-blue-500/20 transition-all"
                  >
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <span className="text-[11px] font-bold text-gray-500">{String(i + 1).padStart(2, "0")}</span>
                        <h4 className="text-sm font-semibold text-gray-200">{cs.approach}</h4>
                      </div>
                      <ConfidenceBadge score={cs.confidence} />
                    </div>

                    <div className="p-4 rounded-xl bg-white/[0.03] border border-white/5 mb-4">
                      <p className="text-sm text-gray-200 leading-relaxed whitespace-pre-wrap">{cs.message}</p>
                    </div>

                    <div className="flex items-center justify-between">
                      <p className="text-[11px] text-gray-500 max-w-[65%] leading-relaxed">
                        <strong className="text-gray-400 font-medium">Why it works:</strong> {cs.rationale}
                      </p>
                      <CopyButton text={cs.message} label="Copy Message" />
                    </div>
                  </div>
                ))}

                {/* ── Inti CTA ── */}
                <div className="inti-cta-card">
                  <div className="flex items-center gap-2 mb-2">
                    <div style={{
                      display: "flex", alignItems: "center", justifyContent: "center",
                      width: 24, height: 24, borderRadius: 6,
                      background: "linear-gradient(135deg, #4f46e5, #6366f1, #818cf8)",
                    }}>
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                      </svg>
                    </div>
                    <span className="text-sm font-bold" style={{ background: "linear-gradient(135deg, #4f46e5, #6366f1, #818cf8)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>Next Step: Inti Pitching Bot</span>
                  </div>
                  <p className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>
                    Ready to hunt this client? Inti uses this research dossier to craft a tailored sales pitch with your chosen tone.
                  </p>
                  <button
                    onClick={() => router.push("/inti")}
                    className="group relative flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3.5 text-sm font-bold text-white shadow-lg transition-all duration-300 hover:-translate-y-0.5 active:translate-y-0 cursor-pointer overflow-hidden"
                    style={{ background: "linear-gradient(135deg, #4f46e5, #6366f1, #818cf8)", boxShadow: "0 4px 20px rgba(99,102,241,0.3)" }}
                  >
                    <div className="absolute inset-0 bg-white/20 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="z-10 relative">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </svg>
                    <span className="z-10 relative">Generate Tailored Pitch with Inti</span>
                  </button>
                </div>
              </div>
            )}

            {/* ── Section: Key References ── */}

            {activeSection === 6 && report && (
              <div className="space-y-6 animate-fade-in">
                <SectionHeader
                  icon={
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0ea5e9" strokeWidth="2">
                      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                    </svg>
                  }
                  title="Quick Reference Guide"
                  subtitle="Key phrases to reference and topics to be aware of"
                />

                {/* Quotable Lines */}
                {report.keyReferences.quotableLines.length > 0 && (
                  <div className="p-5 rounded-xl border border-white/8 bg-white/[0.02]">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-cyan-400/60 mb-4">
                      Quotable Lines from Their Posts
                    </p>
                    <div className="space-y-3">
                      {report.keyReferences.quotableLines.map((q, i) => (
                        <div key={i} className="flex items-start gap-3">
                          <span className="text-cyan-400/40 text-xl font-serif leading-none shrink-0">"</span>
                          <p className="text-sm text-gray-300 italic leading-relaxed">{q}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Common Ground */}
                {report.keyReferences.commonGround.length > 0 && (
                  <div className="p-5 rounded-xl border border-white/8 bg-white/[0.02]">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-green-400/60 mb-3">
                      Potential Common Ground
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {report.keyReferences.commonGround.map((c, i) => (
                        <span
                          key={i}
                          className="text-xs font-medium px-3 py-1.5 rounded-lg bg-green-500/8 text-green-400 border border-green-500/15"
                        >
                          {c}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Topics to Avoid */}
                {report.keyReferences.topicsToAvoid.length > 0 && (
                  <div className="p-5 rounded-xl border border-red-500/10 bg-red-500/[0.02]">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-red-400/60 mb-3">
                      Topics to Approach with Caution
                    </p>
                    <ul className="space-y-2">
                      {report.keyReferences.topicsToAvoid.map((t, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-gray-300">
                          <span className="text-red-400 shrink-0 mt-0.5">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                              <line x1="12" y1="9" x2="12" y2="13" />
                              <line x1="12" y1="17" x2="12.01" y2="17" />
                            </svg>
                          </span>
                          {t}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Meta Info */}
                <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5 text-center">
                  <p className="text-[11px] text-gray-500">
                    Report generated on {new Date(data.meta.generatedAt).toLocaleString()} -- Powered by OpenAI GPT-4o
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
