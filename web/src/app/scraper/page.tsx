"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

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

export default function ScraperPage() {
  const router = useRouter();
  const [userName, setUserName] = useState("");
  const [profileUrls, setProfileUrls] = useState("");
  const [postsLimit, setPostsLimit] = useState(10);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [results, setResults] = useState<ScrapeResultItem[]>([]);
  const [currentProfile, setCurrentProfile] = useState("");
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [error, setError] = useState("");
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);

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

  const showToast = useCallback(
    (message: string, type: "success" | "error") => {
      setToast({ message, type });
      setTimeout(() => setToast(null), 4000);
    },
    []
  );

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

      try {
        const res = await fetch("/api/scrape", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ profileUrl: url, postsLimit }),
        });

        const data = await res.json();

        if (!res.ok) {
          if (res.status === 401) {
            showToast("Session expired. Please re-authenticate.", "error");
            router.push("/");
            return;
          }
          showToast(`Error scraping ${url}: ${data.error}`, "error");
          continue;
        }

        allResults.push({
          profile: data.profile,
          posts: data.posts,
        });

        setResults([...allResults]);
      } catch {
        showToast(`Network error scraping ${url}`, "error");
      }

      // Brief delay between profiles
      if (i < urls.length - 1) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    setLoading(false);
    setCurrentProfile("");

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

    const scrapedAt = new Date().toLocaleString();
    const rows = results.flatMap((r) =>
      r.posts.map((post) => [
        r.profile.name,
        r.profile.profileUrl,
        `"${(post.text || "").replace(/"/g, '""')}"`,
        post.postedDate,
        String(post.reactionsCount),
        String(post.commentsCount),
        String(post.repostsCount),
        post.postUrl,
        post.urn,
        scrapedAt,
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
    await fetch("/api/auth", { method: "DELETE" });
    router.push("/");
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
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-[#0077B5] to-[#00b4d8]">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="white"
              >
                <path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z" />
              </svg>
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
          </div>

          <div className="flex items-center gap-4">
            {userName && (
              <div className="badge badge-success">
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full"
                  style={{ background: "var(--success)" }}
                />
                {userName}
              </div>
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
                      Math.min(50, Math.max(1, parseInt(e.target.value) || 10))
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
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <circle cx="12" cy="12" r="10" />
                      <polygon points="10 8 16 12 10 16 10 8" />
                    </svg>
                    Start Scraping
                  </>
                )}
              </button>
            </form>

            {/* Progress indicator */}
            {loading && currentProfile && (
              <div className="glass-card p-4 animate-fade-in">
                <div className="flex items-center gap-3 mb-3">
                  <div className="spinner" />
                  <span className="text-sm font-medium">
                    Scraping profile {progress.current} of {progress.total}
                  </span>
                </div>
                <p
                  className="text-xs font-mono truncate"
                  style={{ color: "var(--text-muted)" }}
                >
                  {currentProfile}
                </p>
                <div className="mt-3 h-1.5 rounded-full bg-white/5 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[#0077B5] to-[#00b4d8] transition-all duration-500"
                    style={{
                      width: `${(progress.current / progress.total) * 100}%`,
                    }}
                  />
                </div>
              </div>
            )}

            {/* Download CSV button */}
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
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  Download CSV
                </button>
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
                            {result.profile.name
                              .split(" ")
                              .map((n) => n[0])
                              .join("")
                              .slice(0, 2)}
                          </div>
                          <div>
                            <h3 className="text-base font-semibold">
                              {result.profile.name}
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
