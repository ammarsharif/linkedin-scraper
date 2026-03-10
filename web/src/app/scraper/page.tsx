"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { 
  Linkedin, 
  Search, 
  Mail, 
  MessageSquare, 
  Zap, 
  Trash2, 
  AlertTriangle, 
  PlayCircle, 
  Activity, 
  Check, 
  Download 
} from "lucide-react";

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

interface ScrapeResultItem {
  profile: Profile;
  posts: Post[];
}

import { extractVanityName } from "@/lib/linkedin";

// ── Helpers ───────────────────────────────────────────────────────────────────

const formatDisplayName = (name: string) => {
  if (!name) return "Unknown";
  // If it's a messy LinkedIn slug like m-ammar-sharif-...
  if (name.includes("-") && /^[a-z0-9\-\.]+$/.test(name)) {
    let cleaned = name.replace(/^(m|in)-/, "");
    cleaned = cleaned.replace(/-[0-9a-zA-Z]{5,}$/, "").replace(/-[0-9]+$/, "");
    return cleaned
      .replace(/[\-\.]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim() || name;
  }
  return name;
};

export default function ScraperPage() {
  const router = useRouter();
  const [userName, setUserName] = useState("");
  const [profileUrls, setProfileUrls] = useState("https://www.linkedin.com/in/imnaveedsarwar/?locale=en");
  const [postsLimit, setPostsLimit] = useState(2);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [results, setResults] = useState<ScrapeResultItem[]>([]);
  const [currentProfile, setCurrentProfile] = useState("");
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [error, setError] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);

  // Real-time SSE progress
  const [liveStage, setLiveStage] = useState("");
  const [liveDetail, setLiveDetail] = useState("");
  const [livePct, setLivePct] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Stage labels for display
  const stageLabels: Record<string, string> = {
    init: "Initializing",
    browser: "Launching browser",
    profile: "Scraping profile",
    posts: "Scraping posts",
    posts_nav: "Loading activity feed",
    posts_loading: "Waiting for posts",
    posts_found: "Posts detected",
    posts_scraping: "Extracting posts",
    done: "Complete",
    error: "Error",
    result: "Done",
  };

  // Check auth
  useEffect(() => {
    async function checkAuth() {
      try {
        const res = await fetch("/api/auth");
        const data = await res.json();
        if (!data.authenticated) {
          router.push("/");
          return;
        }
        setUserName(data.name || "");
      } catch {
        router.push("/");
      } finally {
        setChecking(false);
      }
    }
    checkAuth();
  }, [router]);

  // Load state from localStorage
  useEffect(() => {
    try {
      const storedStr = localStorage.getItem("scraper_state");
      if (storedStr) {
        const state = JSON.parse(storedStr);
        if (state.profileUrls) setProfileUrls(state.profileUrls);
        if (state.postsLimit) setPostsLimit(state.postsLimit);
        if (state.results) setResults(state.results);
      }
    } catch {
      // ignore
    }
  }, []);

  // Save state to localStorage whenever changed
  useEffect(() => {
    if (profileUrls || results.length > 0) {
      localStorage.setItem("scraper_state", JSON.stringify({
        profileUrls,
        postsLimit,
        results
      }));
    }
  }, [profileUrls, postsLimit, results]);

  // Elapsed time counter
  useEffect(() => {
    if (loading) {
      setElapsedSec(0);
      timerRef.current = setInterval(() => setElapsedSec(s => s + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [loading]);

  const showToast = useCallback(
    (message: string, type: "success" | "error") => {
      setToast({ message, type });
      setTimeout(() => setToast(null), 4000);
    },
    []
  );

  function formatElapsed(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  }

  function handleCancel() {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setLoading(false);
    setCurrentProfile("");
    setLiveStage("");
    setLiveDetail("");
    setLivePct(0);
    showToast("Scraping cancelled", "error");
  }

  async function scrapeWithSSE(url: string): Promise<ScrapeResultItem | null> {
    return new Promise((resolve) => {
      const controller = new AbortController();
      abortRef.current = controller;

      setLiveStage("init");
      setLiveDetail("Starting...");
      setLivePct(0);

      fetch("/api/scrape-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileUrl: url, postsLimit }),
        signal: controller.signal,
      })
        .then(async (res) => {
          if (!res.ok) {
            const data = await res.json().catch(() => ({ error: res.statusText }));
            if (res.status === 401) {
              showToast("LinkedIn session expired. Please re-authenticate.", "error");
              localStorage.removeItem("scraper_state");
              localStorage.removeItem("sienna_state");
              localStorage.removeItem("sienna_payload");
              localStorage.removeItem("ceevee_state");
              localStorage.removeItem("inti_state");
              await fetch("/api/auth", { method: "DELETE" });
              router.push("/");
              resolve(null);
              return;
            }
            showToast(`Error scraping ${url}: ${data.error}`, "error");
            resolve(null);
            return;
          }

          const reader = res.body?.getReader();
          if (!reader) { resolve(null); return; }

          const decoder = new TextDecoder();
          let buffer = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            // Parse SSE events from buffer
            const lines = buffer.split("\n");
            buffer = lines.pop() || ""; // keep incomplete line

            for (const line of lines) {
              if (!line.startsWith("data: ")) continue;
              try {
                const evt = JSON.parse(line.slice(6));

                if (evt.stage === "result") {
                  // Final result
                  const data = evt.data;
                  if (data?.error) {
                    showToast(`Error: ${data.error}`, "error");
                    resolve(null);
                  } else {
                    resolve({
                      profile: data.profile,
                      posts: data.posts,
                    });
                  }
                  return;
                } else if (evt.stage === "error") {
                  showToast(`Error: ${evt.detail}`, "error");
                  resolve(null);
                  return;
                } else {
                  // Progress update
                  setLiveStage(evt.stage || "");
                  setLiveDetail(evt.detail || "");
                  setLivePct(evt.pct || 0);
                }
              } catch {
                // skip malformed events
              }
            }
          }

          // If we got here without a result event, resolve null
          resolve(null);
        })
        .catch((err) => {
          if (err.name === "AbortError") {
            resolve(null);
          } else {
            showToast(`Network error scraping ${url}`, "error");
            resolve(null);
          }
        });
    });
  }

  async function handleScrape(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setResults([]);

    const urls = profileUrls
      .split("\n")
      .map((u) => u.trim())
      .filter((u) => u && u.includes("linkedin.com/in/"));

    if (urls.length === 0) {
      setError(
        "Please enter at least one valid LinkedIn profile URL (e.g. https://linkedin.com/in/username)"
      );
      return;
    }

    setLoading(true);
    setProgress({ current: 0, total: urls.length });
    const allResults: ScrapeResultItem[] = [];

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      setCurrentProfile(url);
      setProgress({ current: i + 1, total: urls.length });

      const result = await scrapeWithSSE(url);

      if (result) {
        allResults.push(result);
        setResults([...allResults]);
      }

      // Brief delay between profiles
      if (i < urls.length - 1) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    setLoading(false);
    setCurrentProfile("");
    setLiveStage("");
    setLiveDetail("");
    setLivePct(0);

    if (allResults.length > 0) {
      showToast(
        `Scraped ${allResults.reduce((a, r) => a + r.posts.length, 0)} posts from ${allResults.length} profile(s)`,
        "success"
      );
    }
  }


  function generateCSV(): string {
    const headers = [
      "Profile Name",
      "Profile URL",
      "Post Text",
      "Posted Date",
      "Reactions",
      "Comments",
      "Reposts",
      "Post URL",
      "Post URN",
      "Scraped At",
    ];

    // Properly escape a CSV field
    const escapeCSV = (value: string): string => {
      if (value.includes(",") || value.includes('"') || value.includes("\n") || value.includes("\r")) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      return value;
    };

    const scrapedAt = new Date().toLocaleString();
    const rows = results.flatMap((r) =>
      r.posts.map((post) => [
        escapeCSV(r.profile.name || ""),
        escapeCSV(r.profile.profileUrl || ""),
        escapeCSV(post.text || ""),
        escapeCSV(post.postedDate || ""),
        String(post.reactionsCount || 0),
        String(post.commentsCount || 0),
        String(post.repostsCount || 0),
        escapeCSV(post.postUrl || ""),
        escapeCSV(post.urn || ""),
        escapeCSV(scrapedAt),
      ])
    );

    return [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  }

  function handleDownloadCSV() {
    if (results.length === 0) return;

    const csv = generateCSV();
    const blob = new Blob(["\ufeff" + csv], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `linkedin_posts_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    showToast("CSV downloaded successfully!", "success");
  }

  async function handleLogout() {
    localStorage.removeItem("scraper_state");
    localStorage.removeItem("sienna_state");
    localStorage.removeItem("sienna_payload");
    localStorage.removeItem("ceevee_state");
    localStorage.removeItem("inti_state");
    await fetch("/api/auth", { method: "DELETE" });
    router.push("/");
  }

  function handleClearData() {
    if (!confirmClear) {
      // First click — ask for confirmation
      setConfirmClear(true);
      setTimeout(() => setConfirmClear(false), 4000); // auto-reset after 4s
      return;
    }
    // Second click — actually clear everything
    localStorage.removeItem("scraper_state");
    localStorage.removeItem("sienna_state");
    localStorage.removeItem("sienna_payload");
    localStorage.removeItem("inti_state");
    setResults([]);
    setProfileUrls("");
    setPostsLimit(10);
    setError("");
    setConfirmClear(false);
    showToast("All data cleared. Ready for a new profile.", "success");
  }

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="bg-mesh" />
        <div className="spinner-lg spinner" />
      </div>
    );
  }

  const totalPosts = results.reduce((a, r) => a + r.posts.length, 0);

  return (
    <div className="relative min-h-screen">
      <div className="bg-mesh" />

      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-white/5 bg-[#0a0b14]/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-linear-to-br from-[#0077B5] to-[#00b4d8]">
              <Linkedin size={18} fill="white" stroke="white" />
            </div>
            <div>
              <h1 className="text-base font-semibold">LinkedIn Scraper</h1>
              <p
                className="text-xs"
                style={{ color: "var(--text-muted)" }}
              >
                Profile &amp; Posts Scraper
              </p>
            </div>

            {/* Navigation */}
            <div style={{ width: 1, height: 24, background: "rgba(255,255,255,0.08)", margin: "0 4px" }} />
            <nav className="flex items-center gap-1">
              <button
                onClick={() => {
                  if (results.length > 0) {
                    localStorage.setItem("sienna_payload", JSON.stringify({
                      profiles: results.map(r => r.profile),
                      posts: results.flatMap(r => r.posts),
                    }));
                    localStorage.removeItem("ceevee_state");
                  }
                  router.push("/ceevee");
                }}
                className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer border"
                style={{
                  background: "rgba(0,0,0,0.4)",
                  borderColor: "rgba(14,165,233,0.3)",
                  color: "#0ea5e9",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(14,165,233,0.08)";
                  e.currentTarget.style.borderColor = "rgba(14,165,233,0.5)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(0,0,0,0.4)";
                  e.currentTarget.style.borderColor = "rgba(14,165,233,0.3)";
                }}
              >
                <Search size={13} strokeWidth={2.5} />
                <span>Ceevee</span>
              </button>
              <button
                onClick={() => router.push("/demarko")}
                className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer border"
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

              <button
                onClick={() => router.push("/inti")}
                className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer border"
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

              <button
                onClick={() => {
                  if (results.length > 0) {
                    localStorage.setItem("sienna_payload", JSON.stringify({
                      profiles: results.map(r => r.profile),
                      posts: results.flatMap(r => r.posts),
                    }));
                  }
                  router.push("/sienna");
                }}
                className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer border"
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
            </nav>
          </div>

          <div className="flex items-center gap-3">
            {userName && (
              <div className="badge badge-success">
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full"
                  style={{ background: "var(--success)" }}
                />
                {userName}
              </div>
            )}

            {/* Clear data button — always visible in header */}
            {(results.length > 0 || profileUrls.trim()) && (
              <button
                onClick={handleClearData}
                disabled={loading}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-all cursor-pointer disabled:opacity-40"
                style={{
                  color: confirmClear ? "#f87171" : "var(--text-muted)",
                  background: confirmClear ? "rgba(239,68,68,0.08)" : "transparent",
                  border: confirmClear ? "1px solid rgba(239,68,68,0.25)" : "1px solid transparent",
                }}
                title="Clear all scraped data and start fresh"
              >
                {confirmClear ? (
                  <>
                    <AlertTriangle size={14} strokeWidth={2.5} />
                    Confirm clear?
                  </>
                ) : (
                  <>
                    <Trash2 size={14} />
                    Clear data
                  </>
                )}
              </button>
            )}

            <button
              onClick={handleLogout}
              className="rounded-lg px-3 py-1.5 text-sm transition-colors hover:bg-white/5"
              style={{ color: "var(--text-secondary)" }}
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="relative z-10 mx-auto max-w-7xl px-6 py-8">
        <div className="grid gap-8 lg:grid-cols-[400px_1fr]">
          {/* Left panel: Input form */}
          <div className="space-y-6">
            <div className="animate-fade-in">
              <h2 className="text-xl font-bold">Scrape Profiles</h2>
              <p
                className="mt-1 text-sm"
                style={{ color: "var(--text-secondary)" }}
              >
                Enter LinkedIn profile URLs to scrape their posts
              </p>
            </div>

            <form
              onSubmit={handleScrape}
              className="glass-card p-6 space-y-5 animate-fade-in-delay-1"
            >
              <div>
                <label
                  htmlFor="profile-urls"
                  className="mb-2 block text-sm font-medium"
                >
                  Profile URLs
                </label>
                <textarea
                  id="profile-urls"
                  className="premium-textarea"
                  placeholder={`https://linkedin.com/in/username1\nhttps://linkedin.com/in/username2\nhttps://linkedin.com/in/username3`}
                  value={profileUrls}
                  onChange={(e) => setProfileUrls(e.target.value)}
                  rows={5}
                  required
                />
                <p
                  className="mt-1.5 text-xs"
                  style={{ color: "var(--text-muted)" }}
                >
                  One URL per line. Supports multiple profiles.
                </p>
              </div>

              <div>
                <label
                  htmlFor="posts-limit"
                  className="mb-2 block text-sm font-medium"
                >
                  Posts per profile
                </label>
                <input
                  id="posts-limit"
                  type="number"
                  className="premium-input"
                  min={1}
                  max={50}
                  value={postsLimit}
                  onChange={(e) =>
                    setPostsLimit(
                      Math.min(50, Math.max(1, parseInt(e.target.value) || 2))
                    )
                  }
                />
              </div>

              {error && (
                <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                  ⚠️ {error}
                </div>
              )}

              <button
                type="submit"
                className="btn-primary w-full"
                disabled={loading || !profileUrls.trim()}
              >
                {loading ? (
                  <>
                    <span className="spinner" />
                    Scraping {progress.current}/{progress.total}...
                  </>
                ) : (
                  <>
                    <PlayCircle size={18} />
                    Start Scraping
                  </>
                )}
              </button>
            </form>

            {/* Progress indicator — real-time SSE */}
            {loading && currentProfile && (
              <div className="glass-card p-5 animate-fade-in border border-[#00b4d8]/20 shadow-[0_0_30px_rgba(0,180,216,0.1)]">
                <div className="flex items-start gap-4 mb-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#00b4d8]/10 text-[#00b4d8] shadow-inner mb-2 lg:mb-0">
                    <Activity size={20} strokeWidth={2.5} />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-bold bg-linear-to-r from-[#0077B5] to-[#00b4d8] bg-clip-text text-transparent">
                        Scraping Profile {progress.current} of {progress.total}
                      </h3>
                      <span className="text-xs font-mono px-2 py-0.5 rounded-md bg-white/5 text-white/70">
                        {formatElapsed(elapsedSec)}
                      </span>
                    </div>
                    <p
                      className="text-xs font-mono mt-0.5 truncate max-w-[280px]"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {currentProfile}
                    </p>
                  </div>
                </div>

                {/* Live Status */}
                <div className="mb-4 px-1">
                  <div className="flex items-center gap-3 text-sm">
                    <div className="spinner h-4 w-4 shrink-0" style={{ borderLeftColor: '#00b4d8', borderWidth: '2px' }} />
                    <div className="flex-1 min-w-0">
                      <span className="text-white font-medium">
                        {stageLabels[liveStage] || liveStage || "Starting..."}
                      </span>
                      {liveDetail && (
                        <p className="text-xs text-white/50 truncate mt-0.5">{liveDetail}</p>
                      )}
                    </div>
                    <span className="text-xs font-mono font-bold text-[#00b4d8]">
                      {livePct}%
                    </span>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="h-1.5 rounded-full bg-white/5 overflow-hidden ring-1 ring-white/10 mb-4">
                  <div
                    className="h-full rounded-full bg-linear-to-r from-[#0077B5] to-[#00b4d8] transition-all duration-700 ease-out relative"
                    style={{
                      width: `${Math.max(3, livePct)}%`,
                    }}
                  >
                    <div className="absolute inset-0 bg-white/20 animate-pulse"></div>
                  </div>
                </div>

                {/* Cancel button */}
                <button
                  onClick={handleCancel}
                  className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-medium transition-all cursor-pointer border"
                  style={{
                    background: "rgba(239,68,68,0.05)",
                    borderColor: "rgba(239,68,68,0.2)",
                    color: "#f87171",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "rgba(239,68,68,0.1)";
                    e.currentTarget.style.borderColor = "rgba(239,68,68,0.4)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "rgba(239,68,68,0.05)";
                    e.currentTarget.style.borderColor = "rgba(239,68,68,0.2)";
                  }}
                >
                  Cancel Scraping
                </button>
              </div>
            )}

            {/* Download CSV + Sienna CTA */}
            {results.length > 0 && !loading && (
              <div className="glass-card p-5 animate-fade-in">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold">Export Results</h3>
                    <p
                      className="text-xs"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      {totalPosts} posts from {results.length} profile(s)
                    </p>
                  </div>
                  <div className="badge badge-success">Ready</div>
                </div>

                <button
                  onClick={handleDownloadCSV}
                  className="btn-success w-full"
                >
                  <Download size={18} />
                  Download CSV
                </button>

                {/* Clear data — secondary action in card */}
                <button
                  onClick={handleClearData}
                  className="mt-3 w-full flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-medium transition-all cursor-pointer"
                  style={{
                    background: confirmClear ? "rgba(239,68,68,0.08)" : "rgba(255,255,255,0.03)",
                    border: confirmClear ? "1px solid rgba(239,68,68,0.3)" : "1px solid rgba(255,255,255,0.07)",
                    color: confirmClear ? "#f87171" : "var(--text-muted)",
                  }}
                >
                  {confirmClear ? (
                    <>
                      <AlertTriangle size={14} strokeWidth={2.5} />
                      Click again to confirm
                    </>
                  ) : (
                    <>
                      <Trash2 size={14} />
                      Clear all data &amp; start fresh
                    </>
                  )}
                </button>

                {/* Sienna CTA */}
                <div className="sienna-cta-card mt-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div style={{
                      display: "flex", alignItems: "center", justifyContent: "center",
                      width: 24, height: 24, borderRadius: 6,
                      background: "linear-gradient(135deg, #7c3aed, #c96ef5, #f06aff)",
                    }}>
                      <Zap size={12} strokeWidth={2.5} />
                    </div>
                    <span className="text-sm font-bold" style={{ background: "linear-gradient(135deg, #7c3aed, #c96ef5, #f06aff)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>Next Step: Sienna</span>
                  </div>
                  <p className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>
                    Turn these {totalPosts} scraped posts into viral scroll-stopping hook lines.
                  </p>
                  <button
                    onClick={() => {
                      if (results.length > 0) {
                        localStorage.setItem("sienna_payload", JSON.stringify({
                          profiles: results.map(r => r.profile),
                          posts: results.flatMap(r => r.posts),
                        }));
                        localStorage.removeItem("sienna_state");
                      }
                      router.push("/sienna");
                    }}
                    className="group relative flex w-full items-center justify-center gap-2 rounded-xl bg-linear-to-r from-[#7c3aed] via-[#c96ef5] to-[#f06aff] px-4 py-3.5 text-sm font-bold text-white shadow-lg shadow-purple-500/20 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-purple-500/40 active:translate-y-0 cursor-pointer overflow-hidden"
                  >
                    <div className="absolute inset-0 bg-white/20 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                    <Zap size={16} fill="currentColor" />
                    <span className="z-10 relative">Generate Hooks with Sienna</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Right panel: Results */}
          <div className="space-y-6">
            {results.length === 0 && !loading ? (
              <div className="flex h-96 items-center justify-center animate-fade-in-delay-2">
                <div className="text-center">
                  <div
                    className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl"
                    style={{ background: "rgba(255,255,255,0.03)" }}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="32"
                      height="32"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{ color: "var(--text-muted)" }}
                    >
                      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                      <polyline points="14 2 14 8 20 8" />
                      <line x1="16" y1="13" x2="8" y2="13" />
                      <line x1="16" y1="17" x2="8" y2="17" />
                      <polyline points="10 9 9 9 8 9" />
                    </svg>
                  </div>
                  <h3
                    className="text-base font-medium"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    No results yet
                  </h3>
                  <p
                    className="mt-1 text-sm"
                    style={{ color: "var(--text-muted)" }}
                  >
                    Enter profile URLs and click Start Scraping
                  </p>
                </div>
              </div>
            ) : (
              results.map((result, idx) => (
                <div
                  key={result.profile.vanityName + idx}
                  className="glass-card overflow-hidden animate-fade-in"
                >
                  {/* Profile header */}
                  <div className="border-b border-white/5 p-5">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-[#0077B5] to-[#00b4d8] text-sm font-bold text-white">
                             {formatDisplayName(result.profile.name)
                               .split(" ")
                               .map((n: string) => n[0])
                               .join("")
                               .slice(0, 2)}
                          </div>
                          <div>
                             <h3 className="text-base font-semibold">
                               {formatDisplayName(result.profile.name)}
                             </h3>
                            {result.profile.headline && (
                              <p
                                className="text-xs max-w-xs truncate"
                                style={{ color: "var(--text-secondary)" }}
                              >
                                {result.profile.headline}
                              </p>
                            )}
                          </div>
                        </div>
                        {result.profile.location && (
                          <p
                            className="mt-2 text-xs"
                            style={{ color: "var(--text-muted)" }}
                          >
                            📍 {result.profile.location}
                          </p>
                        )}
                      </div>
                      <div className="badge badge-info">
                        {result.posts.length} posts
                      </div>
                    </div>
                  </div>

                  {/* Posts table */}
                  <div className="overflow-x-auto">
                    <table className="results-table">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Post Text</th>
                          <th>Date</th>
                          <th>👍</th>
                          <th>💬</th>
                          <th>🔄</th>
                          <th>Link</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.posts.length === 0 ? (
                          <tr>
                            <td
                              colSpan={7}
                              className="text-center py-8"
                              style={{ color: "var(--text-muted)" }}
                            >
                              No posts found for this profile
                            </td>
                          </tr>
                        ) : (
                          result.posts.map((post, pidx) => (
                            <tr key={post.urn || pidx}>
                              <td
                                className="text-center text-xs"
                                style={{ color: "var(--text-muted)" }}
                              >
                                {pidx + 1}
                              </td>
                              <td className="truncate-cell">
                                {post.text
                                  ? post.text.length > 120
                                    ? post.text.slice(0, 120) + "…"
                                    : post.text
                                  : "—"}
                              </td>
                              <td
                                className="whitespace-nowrap text-xs"
                                style={{ color: "var(--text-secondary)" }}
                              >
                                {post.postedDate || "—"}
                              </td>
                              <td className="text-center text-sm">
                                {post.reactionsCount || 0}
                              </td>
                              <td className="text-center text-sm">
                                {post.commentsCount || 0}
                              </td>
                              <td className="text-center text-sm">
                                {post.repostsCount || 0}
                              </td>
                              <td>
                                {post.postUrl ? (
                                  <a
                                    href={post.postUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-[#00a0dc] hover:underline text-xs"
                                  >
                                    View →
                                  </a>
                                ) : (
                                  "—"
                                )}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </main>

      {/* Toast */}
      {toast && (
        <div className={`toast toast-${toast.type}`}>{toast.message}</div>
      )}
    </div>
  );
}
