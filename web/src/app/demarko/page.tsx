"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { 
  Linkedin, 
  Search, 
  MessageSquare, 
  Zap, 
  Mail, 
  RefreshCw, 
  Trash2, 
  History,
  X,
  Send 
} from "lucide-react";

interface EmailRecord {
  id: string;
  to: string;
  subject: string;
  body: string;
  sentAt: string;
  status: "sent" | "failed";
  errorMessage?: string;
}

interface StoredProfile {
  _id: string;
  profileUrl: string;
  vanityName: string;
  name: string;
  headline: string;
  location: string;
  executiveSummary?: string;
  roleLevel?: string;
  industryFocus?: string[];
  areasOfExpertise?: string[];
  currentFocus?: string;
  communicationStyle?: string;
  values?: string[];
  challengesMentioned?: string[];
  achievementsMentioned?: string[];
  emailAddress?: string;
  emailsSent: EmailRecord[];
  scrapedAt: string;
  lastUpdated: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string): string {
  const now = new Date();
  const d = new Date(dateStr);
  const seconds = Math.floor((now.getTime() - d.getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

// ── Brand Colors ───────────────────────────────────────────────────────────────

const DEMARKO_GRADIENT = "linear-gradient(135deg, #f97316, #ef4444, #ec4899)";
const DEMARKO_COLOR = "#f97316";
const DEMARKO_GLOW = "rgba(255,107,74,0.3)";
const DEMARKO_SOFT = "rgba(249, 115, 22, 0.1)";

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

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function DemarkoPage() {
  const router = useRouter();

  const [checking, setChecking] = useState(true);
  const [profiles, setProfiles] = useState<StoredProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);

  // Compose modal state
  const [composing, setComposing] = useState<StoredProfile | null>(null);
  const [emailTo, setEmailTo] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [senderName, setSenderName] = useState("");
  const [senderTitle, setSenderTitle] = useState("");
  const [extraNotes, setExtraNotes] = useState("");
  const [sending, setSending] = useState(false);
  const [generatingEmail, setGeneratingEmail] = useState(false);
  const [showFullInsights, setShowFullInsights] = useState(false);

  // History modal
  const [viewingHistory, setViewingHistory] = useState<StoredProfile | null>(
    null
  );

  // Filter
  const [filter, setFilter] = useState<"all" | "emailed" | "not-emailed">(
    "all"
  );
  const [searchQuery, setSearchQuery] = useState("");

  const showToast = useCallback(
    (message: string, type: "success" | "error") => {
      setToast({ message, type });
      setTimeout(() => setToast(null), 4000);
    },
    []
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

  // Load profiles
  const loadProfiles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/demarko");
      const data = await res.json();
      if (res.ok && data.profiles) {
        setProfiles(data.profiles);
      } else {
        setError(data.error || "Failed to load profiles");
      }
    } catch {
      setError("Network error loading profiles");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!checking) loadProfiles();
  }, [checking, loadProfiles]);

  // Auto-store Ceevee data if available
  useEffect(() => {
    if (checking) return;
    try {
      const stateStr = localStorage.getItem("ceevee_state");
      if (!stateStr) return;
      const s = JSON.parse(stateStr);
      if (!s.data?.profile || !s.data?.report) return;

      // Store to MongoDB
      fetch("/api/demarko", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "store-profile",
          profile: s.data.profile,
          report: s.data.report,
        }),
      })
        .then((r) => r.json())
        .then((d) => {
          if (d.success) {
            loadProfiles();
          }
        })
        .catch(() => {});
    } catch {
      // ignore
    }
  }, [checking, loadProfiles]);

  // Compose email
  async function generateEmailForProfile(profile: StoredProfile) {
    setGeneratingEmail(true);
    try {
      const res = await fetch("/api/demarko/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile }),
      });
      const data = await res.json();
      if (data.success) {
        setEmailSubject(data.subject);
        setEmailBody(data.body);
        // Persist the generated email immediately
        saveLocalDraft(profile._id, data.subject, data.body);
      } else {
        setError(data.error || "Failed to generate AI email.");
        fallbackEmailGen(profile);
      }
    } catch {
      setError("Network error connecting to AI generator.");
      fallbackEmailGen(profile);
    } finally {
      setGeneratingEmail(false);
    }
  }

  // Helper to save draft to DB and local state
  async function saveLocalDraft(profileId: string, subject: string, body: string) {
    // Update local state first so openCompose sees the draft if closed/reopened
    setProfiles(prev => prev.map(p => 
      p._id === profileId ? { ...p, draftSubject: subject, draftBody: body } : p
    ));

    try {
      await fetch("/api/demarko", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save-draft",
          profileId,
          draftSubject: subject,
          draftBody: body,
        }),
      });
    } catch (e) {
      console.error("Failed to save draft", e);
    }
  }

  function fallbackEmailGen(profile: StoredProfile) {
    const nameParts = profile.name.split(" ");
    const recipientName = nameParts.length > 1 ? `${nameParts[0]} ${nameParts[1]}` : nameParts[0];
    setEmailSubject(
      `Quick note for ${recipientName} — loved your perspective on ${profile.areasOfExpertise?.[0] || "your work"}`
    );

    let body = `I came across your LinkedIn profile and was genuinely impressed by your work`;
    if (profile.headline) {
      body += ` as ${profile.headline}`;
    }
    body += ".\n\n";

    if (
      profile.achievementsMentioned &&
      profile.achievementsMentioned.length > 0
    ) {
      body += `What particularly caught my attention was ${profile.achievementsMentioned[0].toLowerCase()}.\n\n`;
    }

    if (profile.currentFocus) {
      body += `I noticed you're currently focused on ${profile.currentFocus.toLowerCase()}. `;
    }

    if (
      profile.challengesMentioned &&
      profile.challengesMentioned.length > 0
    ) {
      body += `I understand the challenges around ${profile.challengesMentioned[0].toLowerCase()}, and I believe there might be a great opportunity for us to connect and share insights.\n\n`;
    } else {
      body += `I'd love to connect and explore potential synergies between our work.\n\n`;
    }

    body += `Would you be open to a brief conversation this week? I'd really value your perspective.\n\nLooking forward to hearing from you!`;

    setEmailBody(body);
  }

  function openCompose(profile: StoredProfile) {
    setComposing(profile);
    setEmailTo(profile.emailAddress || "");
    setExtraNotes("");
    setError("");
    setShowFullInsights(false);

    if (profile.draftSubject && profile.draftBody) {
      setEmailSubject(profile.draftSubject);
      setEmailBody(profile.draftBody);
    } else {
      setEmailSubject("Generating subject with AI...");
      setEmailBody("Generating personalized email body with AI...");
      // Auto-generate using AI only if no draft exists
      generateEmailForProfile(profile);
    }
  }

  // Auto-save draft when editing
  useEffect(() => {
    if (!composing || generatingEmail) return;
    const timer = setTimeout(() => {
      saveLocalDraft(composing._id, emailSubject, emailBody);
    }, 1000);
    return () => clearTimeout(timer);
  }, [emailSubject, emailBody, composing, generatingEmail]);

  async function handleSendEmail() {
    if (!composing || !emailTo || !emailSubject || !emailBody) {
      setError("Please fill in all required fields.");
      return;
    }

    setSending(true);
    setError("");

    try {
      // Combine body with extra notes
      let finalBody = emailBody;
      if (extraNotes.trim()) {
        finalBody += "\n\n" + extraNotes.trim();
      }

      const res = await fetch("/api/demarko", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send-email",
          profileId: composing._id,
          recipientEmail: emailTo,
          recipientName: composing.name.split(" ").slice(0, 2).join(" "),
          subject: emailSubject,
          emailBody: finalBody,
          senderName,
          senderTitle,
        }),
      });

      const data = await res.json();

      if (data.success) {
        showToast(
          `Email sent to ${composing.name} successfully!`,
          "success"
        );
        setComposing(null);
        loadProfiles();
      } else {
        setError(data.error || "Failed to send email");
      }
    } catch {
      setError("Network error sending email");
    } finally {
      setSending(false);
    }
  }

  async function handleDeleteProfile(profileId: string) {
    if (!confirm("Are you sure you want to delete this profile?")) return;

    try {
      const res = await fetch("/api/demarko", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "delete-profile",
          profileId,
        }),
      });
      const data = await res.json();
      if (data.success) {
        showToast("Profile deleted successfully", "success");
        loadProfiles();
      } else {
        showToast(data.error || "Failed to delete profile", "error");
      }
    } catch {
      showToast("Network error deleting profile", "error");
    }
  }

  // Filtered profiles
  const filteredProfiles = profiles.filter((p) => {
    if (filter === "emailed" && (!p.emailsSent || p.emailsSent.length === 0))
      return false;
    if (filter === "not-emailed" && p.emailsSent && p.emailsSent.length > 0)
      return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        p.name.toLowerCase().includes(q) ||
        p.headline.toLowerCase().includes(q) ||
        p.location?.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const totalEmailed = profiles.filter(
    (p) => p.emailsSent && p.emailsSent.length > 0
  ).length;

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

  return (
    <div className="relative min-h-screen" style={{ background: "#080910" }}>
      <div className="bg-mesh" />

      {/* ── Toast ── */}
      {toast && (
        <div
          className="fixed bottom-6 right-6 z-50 animate-fade-in flex items-center gap-3 px-5 py-3 rounded-xl border text-sm font-semibold shadow-2xl"
          style={{
            background:
              toast.type === "success"
                ? "rgba(0,230,118,0.1)"
                : "rgba(239,68,68,0.1)",
            color: toast.type === "success" ? "#00e676" : "#ef4444",
            borderColor:
              toast.type === "success"
                ? "rgba(0,230,118,0.2)"
                : "rgba(239,68,68,0.2)",
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
            <div
              style={{
                width: 1,
                height: 20,
                background: "rgba(255,255,255,0.08)",
              }}
            />
            <div className="flex items-center gap-2.5">
              <div
                className="flex items-center justify-center rounded-lg shadow-lg"
                style={{
                  width: 32,
                  height: 32,
                  background: DEMARKO_GRADIENT,
                }}
              >
                  <Mail size={16} stroke="white" />
              </div>
              <div>
                <p
                  className="text-sm font-bold"
                  style={{ color: "#e5e7eb", lineHeight: 1.2 }}
                >
                  Demarko
                </p>
                <p className="text-[11px]" style={{ color: "#4b5268" }}>
                  Outreach Hub
                </p>
              </div>
            </div>

            {/* Navigation */}
            <div style={{ width: 1, height: 24, background: "rgba(255,255,255,0.08)", margin: "0 4px" }} />
            <nav className="flex items-center gap-1">
              <button
                onClick={() => router.push("/ceevee")}
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
                  const sPayload = localStorage.getItem("sienna_payload");
                  if (sPayload) {
                    router.push("/sienna");
                  } else {
                    showToast("No scraper data found for Sienna", "error");
                  }
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
            <button
              onClick={loadProfiles}
              disabled={loading}
              className="flex items-center gap-2 text-sm px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 font-medium transition-all border border-white/10 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
              <span>{loading ? "Refreshing..." : "Refresh"}</span>
            </button>
          </div>
        </div>
      </header>

      {/* ── Main ── */}
      <main className="relative z-10 mx-auto max-w-7xl px-6 py-8">
        {/* Stats Bar */}
        <div className="mb-8 animate-fade-in">
          <div className="flex items-center gap-4 mb-6">
            <div>
              <h1
                className="text-2xl font-extrabold tracking-tight"
                style={{ color: "#ffffff" }}
              >
                Prospect{" "}
                <span
                  className="bg-clip-text text-transparent"
                  style={{
                    backgroundImage: DEMARKO_GRADIENT,
                  }}
                >
                  Outreach Hub
                </span>
              </h1>
              <p className="text-sm mt-1" style={{ color: "#5a5e72" }}>
                Manage profiles from Ceevee and send personalized follow-up
                emails
              </p>
            </div>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <div
              className="p-4 rounded-xl border"
              style={{
                background: "rgba(0,0,0,0.3)",
                borderColor: "rgba(255,255,255,0.06)",
              }}
            >
              <p
                className="text-[10px] font-bold uppercase tracking-wider mb-1"
                style={{ color: "#5a5e72" }}
              >
                Total Profiles
              </p>
              <p className="text-2xl font-bold text-white">
                {profiles.length}
              </p>
            </div>
            <div
              className="p-4 rounded-xl border"
              style={{
                background: "rgba(0,0,0,0.3)",
                borderColor: "rgba(0,230,118,0.12)",
              }}
            >
              <p
                className="text-[10px] font-bold uppercase tracking-wider mb-1"
                style={{ color: "#00e676" }}
              >
                Emailed Outreach
              </p>
              <p className="text-2xl font-bold" style={{ color: "#00e676" }}>
                {totalEmailed}
              </p>
            </div>
            <div
              className="p-4 rounded-xl border"
              style={{
                background: "rgba(0,0,0,0.3)",
                borderColor: "rgba(249,115,22,0.12)",
              }}
            >
              <p
                className="text-[10px] font-bold uppercase tracking-wider mb-1"
                style={{ color: DEMARKO_COLOR }}
              >
                Pending Outreach
              </p>
              <p
                className="text-2xl font-bold"
                style={{ color: DEMARKO_COLOR }}
              >
                {profiles.length - totalEmailed}
              </p>
            </div>
          </div>

          {/* Filters & Search */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex gap-1 p-1 rounded-xl border border-white/5">
              {(
                [
                  { id: "all", label: "All" },
                  { id: "emailed", label: "Emailed" },
                  { id: "not-emailed", label: "Not Emailed" },
                ] as const
              ).map((f) => (
                <button
                  key={f.id}
                  onClick={() => setFilter(f.id)}
                  className="px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer"
                  style={{
                    background:
                      filter === f.id
                        ? `${DEMARKO_SOFT}`
                        : "transparent",
                    color:
                      filter === f.id ? DEMARKO_COLOR : "#6b7280",
                    border:
                      filter === f.id
                        ? `1px solid rgba(249,115,22,0.2)`
                        : "1px solid transparent",
                  }}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <div className="flex-1 min-w-[200px] max-w-sm">
              <input
                type="text"
                placeholder="Search profiles..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-lg px-3.5 py-2 text-sm outline-none"
                style={{
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.06)",
                  color: "#d1d5db",
                }}
              />
            </div>
          </div>
        </div>

        {/* Profile List */}
        {loading && profiles.length === 0 ? (
          <div className="flex items-center justify-center py-16">
            <div className="text-center">
              <div className="spinner mx-auto mb-4" style={{ width: 32, height: 32 }} />
              <p className="text-sm text-gray-500">Loading profiles...</p>
            </div>
          </div>
        ) : filteredProfiles.length === 0 ? (
          <div className="flex items-center justify-center py-16 animate-fade-in">
            <div className="text-center max-w-md">
              <div
                className="mx-auto mb-6 flex items-center justify-center rounded-2xl"
                style={{
                  width: 72,
                  height: 72,
                  background: DEMARKO_SOFT,
                  border: "1px solid rgba(249,115,22,0.15)",
                }}
              >
                  <Mail size={32} stroke={DEMARKO_COLOR} strokeWidth={1.5} />
              </div>
              <h2 className="text-xl font-bold text-white mb-3">
                {profiles.length === 0
                  ? "No Profiles Found"
                  : "No Matching Profiles"}
              </h2>
              <p className="text-gray-400 text-sm mb-6 leading-relaxed">
                {profiles.length === 0
                  ? "Research prospects using Ceevee first. Profiles will automatically appear here for outreach."
                  : "Try adjusting your search or filter."}
              </p>
              {profiles.length === 0 && (
                <button
                  onClick={() => router.push("/ceevee")}
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-white cursor-pointer"
                  style={{
                    background:
                      "linear-gradient(135deg, #0ea5e9, #2563eb)",
                  }}
                >
                  <Search size={16} />
                  Go to Ceevee
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-3 animate-fade-in">
            {filteredProfiles.map((profile) => {
              const hasEmails =
                profile.emailsSent && profile.emailsSent.length > 0;
              const lastEmail = hasEmails
                ? profile.emailsSent[profile.emailsSent.length - 1]
                : null;

              return (
                <div
                  key={profile._id}
                  className="demarko-profile-card group"
                  style={{
                    background: "rgba(0,0,0,0.3)",
                    border: "1px solid rgba(255,255,255,0.06)",
                    borderRadius: 16,
                    padding: "20px 24px",
                    transition: "all 0.3s",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor =
                      "rgba(249,115,22,0.15)";
                    e.currentTarget.style.boxShadow =
                      "0 4px 24px rgba(249,115,22,0.05)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor =
                      "rgba(255,255,255,0.06)";
                    e.currentTarget.style.boxShadow = "none";
                  }}
                >
                  <div className="flex items-start justify-between gap-4">
                    {/* Left: Profile Info */}
                    <div className="flex items-start gap-4 flex-1 min-w-0">
                      {/* Avatar */}
                      <div
                        className="flex items-center justify-center rounded-xl text-sm font-bold text-white shrink-0"
                        style={{
                          width: 48,
                          height: 48,
                          background: DEMARKO_GRADIENT,
                          boxShadow: `0 4px 14px ${DEMARKO_GLOW}`,
                        }}
                      >
                        {formatDisplayName(profile.name)
                          .split(" ")
                          .map((n) => n[0])
                          .join("")
                          .slice(0, 2)}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="text-[15px] font-bold text-white truncate">
                            {formatDisplayName(profile.name)}
                          </h3>
                          {/* Status badge */}
                          {hasEmails ? (
                            <span
                              className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0"
                              style={{
                                background: "rgba(0,230,118,0.08)",
                                color: "#00e676",
                                border:
                                  "1px solid rgba(0,230,118,0.2)",
                              }}
                            >
                              ✓ Emailed ({profile.emailsSent.length})
                            </span>
                          ) : (
                            <span
                              className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0"
                              style={{
                                background: DEMARKO_SOFT,
                                color: DEMARKO_COLOR,
                                border:
                                  "1px solid rgba(249,115,22,0.2)",
                              }}
                            >
                              Pending
                            </span>
                          )}
                        </div>
                        <p
                          className="text-xs truncate mb-2"
                          style={{ color: "#6b7280" }}
                        >
                          {profile.headline}
                        </p>

                        {/* Tags */}
                        <div className="flex flex-wrap items-center gap-1.5">
                          {profile.roleLevel && (
                            <span
                              className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                              style={{
                                background: "rgba(99,102,241,0.08)",
                                color: "#818cf8",
                                border:
                                  "1px solid rgba(99,102,241,0.15)",
                              }}
                            >
                              {profile.roleLevel}
                            </span>
                          )}
                          {profile.location && (
                            <span
                              className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                              style={{
                                background: "rgba(255,255,255,0.03)",
                                color: "#5a5e72",
                                border:
                                  "1px solid rgba(255,255,255,0.06)",
                              }}
                            >
                              📍 {profile.location}
                            </span>
                          )}
                          {profile.industryFocus
                            ?.slice(0, 2)
                            .map((ind) => (
                              <span
                                key={ind}
                                className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                                style={{
                                  background:
                                    "rgba(168,85,247,0.08)",
                                  color: "#c084fc",
                                  border:
                                    "1px solid rgba(168,85,247,0.15)",
                                }}
                              >
                                {ind}
                              </span>
                            ))}
                        </div>

                        {/* Last email info */}
                        {lastEmail && (
                          <div
                            className="mt-2 flex items-center gap-2 text-[11px]"
                            style={{ color: "#4b5268" }}
                          >
                            <svg
                              width="10"
                              height="10"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                            >
                              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                              <polyline points="22,6 12,13 2,6" />
                            </svg>
                            Last email: &quot;{lastEmail.subject}&quot; —{" "}
                            {timeAgo(lastEmail.sentAt)}
                            <span
                              style={{
                                color:
                                  lastEmail.status === "sent"
                                    ? "#00e676"
                                    : "#ef4444",
                              }}
                            >
                              ({lastEmail.status})
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Right: Actions */}
                    <div className="flex items-center gap-3 shrink-0">
                      {hasEmails && (
                        <button
                          onClick={() => setViewingHistory(profile)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all cursor-pointer"
                          style={{
                            background: "rgba(255,255,255,0.03)",
                            border: "1px solid rgba(255,255,255,0.06)",
                            color: "#6b7280",
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)";
                            e.currentTarget.style.color = "#d1d5db";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)";
                            e.currentTarget.style.color = "#6b7280";
                          }}
                        >
                          <History size={14} />
                          History
                        </button>
                      )}
                      
                      <a
                        href={profile.profileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all cursor-pointer"
                        style={{
                          background: "rgba(14,165,233,0.06)",
                          border: "1px solid rgba(14,165,233,0.12)",
                          color: "#0ea5e9",
                        }}
                      >
                        <svg
                          width="11"
                          height="11"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                          <polyline points="15 3 21 3 21 9" />
                          <line x1="10" y1="14" x2="21" y2="3" />
                        </svg>
                        LinkedIn
                      </a>

                      <button
                        onClick={() => openCompose(profile)}
                        className="group relative flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold text-white transition-all cursor-pointer hover:-translate-y-px overflow-hidden"
                        style={{
                          background: DEMARKO_GRADIENT,
                          boxShadow: `0 0 12px ${DEMARKO_GLOW}`,
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.boxShadow = `0 0 20px rgba(249,115,22,0.5)`;
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.boxShadow = `0 0 12px ${DEMARKO_GLOW}`;
                        }}
                      >
                        <div className="absolute inset-0 bg-white/10 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                        <Mail size={14} className="relative z-10" />
                        <span className="relative z-10">
                          {hasEmails ? "Follow Up" : "Send Email"}
                        </span>
                      </button>

                      {/* Delete Button */}
                      <button
                        onClick={() => handleDeleteProfile(profile._id)}
                        className="flex items-center justify-center w-8 h-8 rounded-lg transition-all cursor-pointer text-gray-600 hover:text-red-500 hover:bg-red-500/10 border border-transparent hover:border-red-500/20"
                        title="Delete profile"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* ── Compose Email Modal ── */}
      {composing && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }}
        >
          <div
            className="w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto rounded-2xl animate-fade-in"
            style={{
              background: "#0f1019",
              border: "1px solid rgba(255,255,255,0.08)",
              boxShadow: `0 24px 80px rgba(0,0,0,0.6), 0 0 40px ${DEMARKO_GLOW}`,
            }}
          >
            {/* Modal Header */}
            <div
              className="p-6 border-b"
              style={{ borderColor: "rgba(255,255,255,0.06)" }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className="flex items-center justify-center rounded-lg"
                    style={{
                      width: 36,
                      height: 36,
                      background: DEMARKO_GRADIENT,
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
                      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                      <polyline points="22,6 12,13 2,6" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white">
                      Compose Email
                    </h3>
                    <p className="text-[11px]" style={{ color: "#4b5268" }}>
                      To: {composing.name}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setComposing(null)}
                  className="w-8 h-8 flex items-center justify-center rounded-lg transition-all cursor-pointer"
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    color: "#6b7280",
                  }}
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-4">
              {/* Profile Summary */}
              <div
                className="p-4 rounded-xl"
                style={{
                  background: "rgba(255,255,255,0.02)",
                  border: "1px solid rgba(255,255,255,0.04)",
                }}
              >
                <div className="flex justify-between items-center mb-2">
                  <p
                    className="text-[10px] font-bold uppercase tracking-wider"
                    style={{ color: "#5a5e72" }}
                  >
                    Profile Insights (used for personalization)
                  </p>
                  <button
                    onClick={() => generateEmailForProfile(composing)}
                    disabled={generatingEmail}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold transition-all disabled:opacity-50"
                    style={{
                      background: "rgba(249,115,22,0.1)",
                      color: DEMARKO_COLOR,
                      border: "1px solid rgba(249,115,22,0.2)",
                      cursor: generatingEmail ? "not-allowed" : "pointer",
                    }}
                  >
                    <Zap size={12} className={generatingEmail ? "animate-pulse" : ""} />
                    <span>{generatingEmail ? "Generating..." : "Regenerate with AI"}</span>
                  </button>
                </div>
                <p className="text-xs text-gray-400 leading-relaxed">
                  {composing.executiveSummary ? (
                    <>
                      {showFullInsights 
                        ? composing.executiveSummary 
                        : composing.executiveSummary.slice(0, 180) + "..."
                      }
                      <button 
                        onClick={() => setShowFullInsights(!showFullInsights)}
                        className="ml-2 text-[10px] font-bold underline transition-all hover:text-white"
                        style={{ color: DEMARKO_COLOR }}
                      >
                        {showFullInsights ? "Show Less" : "See All"}
                      </button>
                    </>
                  ) : (
                    `${composing.name} — ${composing.headline}`
                  )}
                </p>
              </div>

              {/* Recipient Email */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-300">
                  Recipient Email <span className="text-red-400">*</span>
                </label>
                <input
                  type="email"
                  value={emailTo}
                  onChange={(e) => setEmailTo(e.target.value)}
                  placeholder="prospect@company.com"
                  className="demarko-input"
                  required
                />
              </div>

              {/* Subject */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-300">
                  Subject <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={emailSubject}
                  onChange={(e) => setEmailSubject(e.target.value)}
                  className="demarko-input"
                />
              </div>

              {/* Email Body */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-300">
                  Email Body <span className="text-red-400">*</span>
                </label>
                <textarea
                  value={emailBody}
                  onChange={(e) => setEmailBody(e.target.value)}
                  rows={8}
                  className="demarko-textarea"
                />
                <p
                  className="mt-1 text-[10px]"
                  style={{ color: "#3d4155" }}
                >
                  Auto-generated from profile data. Edit freely.
                </p>
              </div>

              {/* Extra Notes (Optional) */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-medium text-gray-300">
                    Additional Notes
                  </label>
                  <span
                    className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                    style={{
                      background: "rgba(255,255,255,0.05)",
                      color: "#5a5e72",
                      border: "1px solid rgba(255,255,255,0.08)",
                    }}
                  >
                    OPTIONAL
                  </span>
                </div>
                <textarea
                  value={extraNotes}
                  onChange={(e) => setExtraNotes(e.target.value)}
                  rows={3}
                  placeholder="Add any custom note to append to the email (meeting details, specific offers, etc.)..."
                  className="demarko-textarea"
                />
              </div>

              {/* Sender Details */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-gray-300">
                    Your Name
                  </label>
                  <input
                    type="text"
                    value={senderName}
                    onChange={(e) => setSenderName(e.target.value)}
                    placeholder="John Doe"
                    className="demarko-input"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-gray-300">
                    Your Title
                  </label>
                  <input
                    type="text"
                    value={senderTitle}
                    onChange={(e) => setSenderTitle(e.target.value)}
                    placeholder="CEO at Company"
                    className="demarko-input"
                  />
                </div>
              </div>

              {error && (
                <div
                  className="rounded-lg border px-4 py-3 text-sm"
                  style={{
                    background: "rgba(239,68,68,0.08)",
                    borderColor: "rgba(239,68,68,0.2)",
                    color: "#ef4444",
                  }}
                >
                  ⚠️ {error}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div
              className="p-6 pt-0 flex items-center justify-between gap-3"
            >
              <button
                onClick={() => setComposing(null)}
                className="px-5 py-2.5 rounded-xl text-sm font-medium transition-all cursor-pointer"
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.06)",
                  color: "#6b7280",
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSendEmail}
                disabled={sending || !emailTo || !emailSubject || !emailBody}
                className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold text-white transition-all cursor-pointer disabled:opacity-50"
                style={{
                  background: DEMARKO_GRADIENT,
                  boxShadow: `0 4px 18px ${DEMARKO_GLOW}`,
                }}
              >
                {sending ? (
                  <>
                    <div
                      className="spinner"
                      style={{ width: 14, height: 14 }}
                    />
                    Sending...
                  </>
                ) : (
                  <>
                    <Send size={14} className="mr-2" />
                    Send Email
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Email History Modal ── */}
      {viewingHistory && (
        <div
          className="fixed inset-0 z-100 flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }}
        >
          <div
            className="w-full max-w-xl mx-4 max-h-[80vh] overflow-y-auto rounded-2xl animate-fade-in"
            style={{
              background: "#0f1019",
              border: "1px solid rgba(255,255,255,0.08)",
              boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
            }}
          >
            {/* Header */}
            <div
              className="p-6 border-b"
              style={{ borderColor: "rgba(255,255,255,0.06)" }}
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-white">
                    Email History
                  </h3>
                  <p className="text-xs" style={{ color: "#4b5268" }}>
                    {formatDisplayName(viewingHistory.name)} —{" "}
                    {viewingHistory.emailsSent?.length || 0} emails sent
                  </p>
                </div>
                <button
                  onClick={() => setViewingHistory(null)}
                  className="w-8 h-8 flex items-center justify-center rounded-lg transition-all cursor-pointer"
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    color: "#6b7280",
                  }}
                >
                    <X size={16} />
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="p-6 space-y-4">
              {viewingHistory.emailsSent &&
              viewingHistory.emailsSent.length > 0 ? (
                viewingHistory.emailsSent
                  .slice()
                  .reverse()
                  .map((email) => (
                    <div
                      key={email.id}
                      className="p-4 rounded-xl"
                      style={{
                        background: "rgba(255,255,255,0.02)",
                        border: "1px solid rgba(255,255,255,0.05)",
                      }}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex-1 truncate mr-4">
                          <p className="text-sm font-semibold text-white truncate">
                            {email.subject}
                          </p>
                          <p className="text-[10px] text-gray-500 truncate">
                            To: {email.to}
                          </p>
                        </div>
                        <span
                          className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ml-2"
                          style={{
                            background:
                              email.status === "sent"
                                ? "rgba(0,230,118,0.08)"
                                : "rgba(239,68,68,0.08)",
                            color:
                              email.status === "sent"
                                ? "#00e676"
                                : "#ef4444",
                            border: `1px solid ${email.status === "sent" ? "rgba(0,230,118,0.2)" : "rgba(239,68,68,0.2)"}`,
                          }}
                        >
                          {email.status === "sent" ? "✓ Sent" : "✗ Failed"}
                        </span>
                      </div>
                      <p
                        className="text-xs leading-relaxed mb-2"
                        style={{ color: "#6b7280" }}
                      >
                        {email.body.slice(0, 200)}
                        {email.body.length > 200 ? "..." : ""}
                      </p>
                      <p
                        className="text-[10px]"
                        style={{ color: "#3d4155" }}
                      >
                        {new Date(email.sentAt).toLocaleString()}
                      </p>
                      {email.errorMessage && (
                        <p className="text-[10px] text-red-400 mt-1">
                          Error: {email.errorMessage}
                        </p>
                      )}
                    </div>
                  ))
              ) : (
                <p className="text-sm text-gray-500 text-center py-8">
                  No emails sent yet.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
