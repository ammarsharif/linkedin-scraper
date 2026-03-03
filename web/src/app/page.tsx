"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

export default function AuthPage() {
  const router = useRouter();
  const [cookieStr, setCookieStr] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    async function checkAuth() {
      try {
        const res = await fetch("/api/auth");
        const data = await res.json();
        if (data.authenticated) router.push("/scraper");
      } catch { /* not authenticated */ }
      finally { setChecking(false); }
    }
    checkAuth();
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");

    const trimmed = cookieStr.trim();
    if (!trimmed.includes("li_at=")) {
      setError('The cookie string must contain "li_at=". Make sure you copied the full Cookie header value.');
      return;
    }
    if (!trimmed.includes("JSESSIONID=")) {
      setError('The cookie string must contain "JSESSIONID=". Make sure you copied the full Cookie header value (not just li_at).');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cookieString: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Failed to validate session"); return; }
      setSuccess(`Welcome, ${data.name}! Redirecting...`);
      setTimeout(() => router.push("/scraper"), 1200);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="bg-mesh" />
        <div className="spinner-lg spinner" />
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4 py-12">
      <div className="bg-mesh" />
      <div className="relative z-10 w-full max-w-xl">

        {/* Logo */}
        <div className="mb-8 text-center animate-fade-in">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-[#0077B5] to-[#00b4d8] shadow-lg shadow-[#0077B5]/30">
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="white">
              <path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z"/>
            </svg>
          </div>
          <h1 className="text-3xl font-bold tracking-tight">LinkedIn Scraper</h1>
          <p className="mt-2 text-base" style={{ color: "var(--text-secondary)" }}>
            Authenticate with your full LinkedIn session cookies
          </p>
        </div>

        {/* Auth card */}
        <div className="glass-card p-8 animate-fade-in-delay-1">
          <div className="linkedin-accent" />
          <h2 className="mb-1 text-lg font-semibold">Paste your LinkedIn Cookie header</h2>
          <p className="mb-5 text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
            LinkedIn requires your <em>full</em> session cookie string (not just <code className="rounded bg-white/5 px-1.5 py-0.5 text-xs font-mono text-[#00a0dc]">li_at</code>).
            Copy the entire <code className="rounded bg-white/5 px-1.5 py-0.5 text-xs font-mono text-[#00a0dc]">Cookie:</code> header
            value from DevTools → Network → any LinkedIn request.
          </p>

          <form onSubmit={handleSubmit}>
            <div className="mb-4">
              <label htmlFor="cookie-input" className="mb-2 block text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
                Full Cookie Header Value
              </label>
              <textarea
                id="cookie-input"
                className="premium-textarea"
                placeholder="li_at=AQEDATX...; JSESSIONID=&quot;ajax:123...&quot;; bcookie=&quot;v=2&amp;...&quot;; bscookie=..."
                value={cookieStr}
                onChange={(e) => setCookieStr(e.target.value)}
                rows={5}
                autoComplete="off"
                spellCheck={false}
                required
              />
            </div>

            {error && (
              <div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                ⚠️ {error}
              </div>
            )}
            {success && (
              <div className="mb-4 rounded-lg border border-green-500/20 bg-green-500/10 px-4 py-3 text-sm text-green-400">
                ✅ {success}
              </div>
            )}

            <button
              type="submit"
              className="btn-primary w-full"
              disabled={loading || !cookieStr.trim()}
            >
              {loading ? (
                <><span className="spinner" /> Validating...</>
              ) : (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                  </svg>
                  Authenticate &amp; Continue
                </>
              )}
            </button>
          </form>
        </div>

        {/* Instructions */}
        <div className="glass-card mt-5 p-6 animate-fade-in-delay-2">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
            How to copy your Cookie header
          </h3>
          <ol className="space-y-3 text-sm" style={{ color: "var(--text-secondary)" }}>
            {[
              "Open Chrome and go to linkedin.com (make sure you're logged in)",
              "Press F12 to open DevTools → click the Network tab",
              "Reload the page — click any request to linkedin.com in the list",
              'In the right panel click "Headers" → scroll to "Request Headers"',
              'Find the "Cookie:" row — click it to select all, then Copy',
              "Paste the entire value into the box above",
            ].map((text, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/5 text-xs font-bold text-[#00a0dc]">
                  {i + 1}
                </span>
                <span>{text}</span>
              </li>
            ))}
          </ol>

          <div className="mt-5 rounded-lg border border-[#0077B5]/20 bg-[#0077B5]/08 px-4 py-3 text-xs" style={{ color: "var(--text-secondary)", background: "rgba(0,119,181,0.06)" }}>
            💡 <strong>Tip:</strong> You need both <code className="text-[#00a0dc]">li_at</code> and{" "}
            <code className="text-[#00a0dc]">JSESSIONID</code> in the string. The full cookie header
            contains both automatically.
          </div>
        </div>

        <p className="mt-6 text-center text-xs animate-fade-in-delay-3" style={{ color: "var(--text-muted)" }}>
          Your cookies are stored as httpOnly session cookies and only used to make requests to LinkedIn.
        </p>
      </div>
    </div>
  );
}
