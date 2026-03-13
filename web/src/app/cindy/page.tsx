"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Linkedin,
  MessageSquare,
  Zap,
  Mail,
  RefreshCw,
  Headphones,
  CheckCircle2,
  Copy,
  ChevronLeft,
  Power,
  Terminal,
  ChevronDown,
  ChevronUp,
  Clock,
  Send,
  Inbox,
  Bot,
  AlertCircle,
  Play,
  Square,
  Eye,
  EyeOff,
  Trash2,
  RotateCcw,
} from "lucide-react";

import { BotSwitcher } from "@/components/BotSwitcher";

interface StoredProfile {
  _id: string;
  profileUrl: string;
  vanityName: string;
  name: string;
  headline: string;
  location: string;
  executiveSummary?: string;
  currentFocus?: string;
  areasOfExpertise?: string[];
  challengesMentioned?: string[];
  achievementsMentioned?: string[];
  emailAddress?: string;
}

interface UnreadMessage {
  conversationUrn: string;
  messageText: string;
  senderName: string;
  senderUrn: string;
  deliveredAt: number;
  status: string;
}

interface CronLogEntry {
  time: string;
  message: string;
  type: "info" | "success" | "error" | "warning";
}

interface ProcessedReply {
  senderName: string;
  messageText: string;
  reply: string;
  conversationUrn: string;
  sentAt: string;
  sent: boolean;
}

const CINDY_GRADIENT = "linear-gradient(135deg, #10b981, #059669, #34d399)";

type TabId = "inbox" | "auto-reply" | "profiles";

export default function CindyPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>("inbox");
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);

  // Profile state
  const [profiles, setProfiles] = useState<StoredProfile[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState<StoredProfile | null>(
    null
  );
  const [prospectMessage, setProspectMessage] = useState("");
  const [generatedReply, setGeneratedReply] = useState("");
  const [generating, setGenerating] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Inbox state
  const [unreadMessages, setUnreadMessages] = useState<UnreadMessage[]>([]);
  const [inboxLoading, setInboxLoading] = useState(false);
  const [inboxError, setInboxError] = useState("");
  const [replying, setReplying] = useState<Record<string, boolean>>({});
  const [processedReplies, setProcessedReplies] = useState<ProcessedReply[]>(
    []
  );

  // Cron state
  const [cronRunning, setCronRunning] = useState(false);
  const [cronLastRun, setCronLastRun] = useState<string | null>(null);
  const [cronProcessedCount, setCronProcessedCount] = useState(0);
  const [cronLogs, setCronLogs] = useState<CronLogEntry[]>([]);
  const [cronLoading, setCronLoading] = useState(false);
  const [showCronLogs, setShowCronLogs] = useState(false);
  const cronLogEndRef = useRef<HTMLDivElement>(null);

  // Timer state
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [timeLeft, setTimeLeft] = useState(120);

  const showToast = useCallback(
    (message: string, type: "success" | "error") => {
      setToast({ message, type });
      setTimeout(() => setToast(null), 4000);
    },
    []
  );

  // ── Auth check ──
  useEffect(() => {
    fetch("/api/auth")
      .then((r) => r.json())
      .then((d) => {
        if (!d.authenticated) router.push("/");
      })
      .catch(() => router.push("/"))
      .finally(() => setChecking(false));
  }, [router]);

  // ── Load profiles ──
  const loadProfiles = useCallback(async () => {
    setProfilesLoading(true);
    try {
      const res = await fetch("/api/cindy");
      const data = await res.json();
      if (res.ok && data.profiles) setProfiles(data.profiles);
    } catch {
      /* silent */
    } finally {
      setProfilesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!checking) loadProfiles();
  }, [checking, loadProfiles]);

  // ── Fetch inbox ──
  const fetchInbox = useCallback(async () => {
    setInboxLoading(true);
    setInboxError("");
    try {
      const res = await fetch("/api/cindy/inbox");
      const data = await res.json();
      if (res.ok && data.success) {
        setUnreadMessages(data.unread || []);
      } else {
        setInboxError(data.error || "Failed to fetch inbox");
      }
    } catch {
      setInboxError("Network error fetching inbox");
    } finally {
      setInboxLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!checking && activeTab === "inbox") fetchInbox();
  }, [checking, activeTab, fetchInbox]);

  // ── Cron status polling ──
  const fetchCronStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/cindy/inbox/cron");
      const data = await res.json();
      setCronRunning(data.running ?? false);
      setCronLastRun(data.lastRun ?? null);
      setCronProcessedCount(data.processedCount ?? 0);
      if (data.logs) setCronLogs(data.logs);
    } catch {
      /* silent */
    }
  }, []);

  useEffect(() => {
    if (!checking) {
      fetchCronStatus();
      const interval = setInterval(fetchCronStatus, 5000);
      return () => clearInterval(interval);
    }
  }, [checking, fetchCronStatus]);

  useEffect(() => {
    if (showCronLogs && cronLogEndRef.current) {
      cronLogEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [cronLogs, showCronLogs]);

  // ── Toggle cron ──
  const toggleCron = async () => {
    setCronLoading(true);
    const action = cronRunning ? "stop" : "start";
    try {
      const res = await fetch("/api/cindy/inbox/cron", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (data.success) {
        showToast(
          action === "start"
            ? "Auto-reply cron started! Checking every 60s."
            : "Auto-reply cron stopped.",
          "success"
        );
        setTimeout(fetchCronStatus, 500);
      } else {
        showToast(data.error || `Failed to ${action} cron`, "error");
      }
    } catch {
      showToast(`Network error — could not ${action} cron`, "error");
    } finally {
      setCronLoading(false);
    }
  };

  const clearCronLogs = async () => {
    await fetch("/api/cindy/inbox/cron", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "clear-logs" }),
    });
    setCronLogs([]);
  };

  const resetProcessed = async () => {
    await fetch("/api/cindy/inbox/cron", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reset-processed" }),
    });
    setCronProcessedCount(0);
    showToast("Processed message IDs reset.", "success");
  };

  // ── Reply to a specific message ──
  const replyToMessage = async (msg: UnreadMessage, sendNow: boolean) => {
    setReplying((prev) => ({ ...prev, [msg.conversationUrn]: true }));
    try {
      const res = await fetch("/api/cindy/inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationUrn: msg.conversationUrn,
          messageText: msg.messageText,
          senderName: msg.senderName,
          autoSend: sendNow,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setProcessedReplies((prev) => [
          {
            senderName: msg.senderName,
            messageText: msg.messageText,
            reply: data.reply,
            conversationUrn: msg.conversationUrn,
            sentAt: data.sentAt || new Date().toISOString(),
            sent: data.sent,
          },
          ...prev,
        ]);
        // Remove from unread
        setUnreadMessages((prev) =>
          prev.filter((m) => m.conversationUrn !== msg.conversationUrn)
        );
        showToast(
          data.sent
            ? `Reply sent to ${msg.senderName}!`
            : `Reply generated for ${msg.senderName}.`,
          "success"
        );
      } else {
        showToast(data.error || "Failed to process reply", "error");
      }
    } catch {
      showToast("Network error sending reply", "error");
    } finally {
      setReplying((prev) => ({ ...prev, [msg.conversationUrn]: false }));
    }
  };

  // ── Manual profile reply (existing feature) ──
  const startSimulation = () => {
    if (!prospectMessage.trim()) {
      showToast("Please enter the prospect's message first.", "error");
      return;
    }
    setGeneratedReply("");
    setTimeLeft(120);
    setIsTimerRunning(true);
  };
  const cancelSimulation = () => {
    setIsTimerRunning(false);
    setTimeLeft(120);
  };
  const skipTimer = () => {
    setIsTimerRunning(false);
    setTimeLeft(0);
    generateReply();
  };

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (isTimerRunning && timeLeft > 0) {
      timer = setTimeout(() => setTimeLeft((p) => p - 1), 1000);
    } else if (isTimerRunning && timeLeft === 0) {
      setIsTimerRunning(false);
      generateReply();
    }
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTimerRunning, timeLeft]);

  async function generateReply() {
    if (!prospectMessage.trim() || !selectedProfile) return;
    setGenerating(true);
    setGeneratedReply("");
    try {
      const res = await fetch("/api/cindy/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile: selectedProfile,
          prospectMessage,
        }),
      });
      const data = await res.json();
      if (data.success) setGeneratedReply(data.reply);
      else showToast(data.error || "Failed to generate reply", "error");
    } catch {
      showToast("Network error generating reply", "error");
    } finally {
      setGenerating(false);
      setIsTimerRunning(false);
    }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    showToast("Copied to clipboard!", "success");
  };

  const filteredProfiles = profiles.filter((p) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      p.name.toLowerCase().includes(q) ||
      (p.headline && p.headline.toLowerCase().includes(q))
    );
  });

  const formatTime = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch {
      return iso;
    }
  };

  const formatRelative = (ts: number) => {
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  if (checking) return null;

  // ── TAB DATA ──────────────────────────────────────────────────────
  const tabs: { id: TabId; label: string; icon: React.ReactNode; count?: number }[] = [
    {
      id: "inbox",
      label: "Inbox",
      icon: <Inbox size={15} />,
      count: unreadMessages.length,
    },
    {
      id: "auto-reply",
      label: "Auto-Reply",
      icon: <Bot size={15} />,
    },
    {
      id: "profiles",
      label: "Profiles",
      icon: <MessageSquare size={15} />,
      count: profiles.length,
    },
  ];

  return (
    <div className="relative min-h-screen" style={{ background: "#080910" }}>
      <div className="bg-mesh" />

      {/* Toast */}
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

      {/* HEADER */}
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
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "rgba(0,0,0,0.4)";
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
                style={{ width: 32, height: 32, background: CINDY_GRADIENT }}
              >
                <Headphones size={16} stroke="white" />
              </div>
              <div>
                <p
                  className="text-sm font-bold"
                  style={{ color: "#e5e7eb", lineHeight: 1.2 }}
                >
                  Cindy
                </p>
                <p className="text-[11px]" style={{ color: "#4b5268" }}>
                  Auto-Reply Engine
                </p>
              </div>
            </div>

            <div
              style={{
                width: 1,
                height: 24,
                background: "rgba(255,255,255,0.08)",
                margin: "0 4px",
              }}
            />
            <BotSwitcher currentBotId="cindy" />
          </div>

          <div className="flex items-center gap-3">
            {/* Cron Status Pill */}
            <button
              onClick={toggleCron}
              disabled={cronLoading}
              id="cron-toggle-btn"
              className="flex items-center gap-2.5 text-sm px-4 py-2 rounded-xl font-semibold transition-all cursor-pointer border disabled:opacity-60"
              style={{
                background: cronRunning
                  ? "rgba(16,185,129,0.1)"
                  : "rgba(239,68,68,0.08)",
                borderColor: cronRunning
                  ? "rgba(16,185,129,0.3)"
                  : "rgba(239,68,68,0.2)",
                color: cronRunning ? "#10b981" : "#ef4444",
              }}
              title={
                cronRunning
                  ? "Click to stop auto-reply cron"
                  : "Click to start auto-reply cron (every 60s)"
              }
            >
              {cronLoading ? (
                <RefreshCw size={14} className="animate-spin" />
              ) : (
                <>
                  <span className="relative flex h-2.5 w-2.5">
                    {cronRunning && (
                      <span
                        className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
                        style={{ background: "#10b981" }}
                      />
                    )}
                    <span
                      className="relative inline-flex rounded-full h-2.5 w-2.5"
                      style={{
                        background: cronRunning ? "#10b981" : "#ef4444",
                      }}
                    />
                  </span>
                  {cronRunning ? <Play size={14} /> : <Square size={14} />}
                </>
              )}
              <span>{cronRunning ? "Cron Active" : "Cron Off"}</span>
            </button>

            {/* Log toggle */}
            <button
              onClick={() => setShowCronLogs(!showCronLogs)}
              id="cron-logs-btn"
              className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-gray-200 transition-all border border-white/10 cursor-pointer"
              title="Toggle cron logs"
            >
              <Terminal size={13} />
              <span>Logs</span>
              {showCronLogs ? (
                <ChevronUp size={12} />
              ) : (
                <ChevronDown size={12} />
              )}
            </button>

            <div
              style={{
                width: 1,
                height: 20,
                background: "rgba(255,255,255,0.08)",
              }}
            />

            {/* Stats */}
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <Clock size={12} />
              <span>
                {cronLastRun ? formatTime(cronLastRun) : "Never"}
              </span>
              <span>·</span>
              <span>{cronProcessedCount} processed</span>
            </div>
          </div>
        </div>
      </header>

      {/* CRON LOG PANEL */}
      {showCronLogs && (
        <div className="relative z-20 mx-auto max-w-7xl px-6 animate-fade-in">
          <div
            className="mt-2 rounded-2xl border overflow-hidden"
            style={{
              background: "rgba(0,0,0,0.5)",
              borderColor: "rgba(255,255,255,0.08)",
              backdropFilter: "blur(16px)",
            }}
          >
            <div
              className="flex items-center justify-between px-4 py-2.5 border-b"
              style={{ borderColor: "rgba(255,255,255,0.06)" }}
            >
              <div className="flex items-center gap-2">
                <Terminal size={14} className="text-gray-500" />
                <span className="text-xs font-semibold text-gray-400">
                  Auto-Reply Cron Logs
                </span>
                {cronRunning && (
                  <span className="px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
                    LIVE
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={clearCronLogs}
                  className="text-xs text-gray-500 hover:text-gray-300 cursor-pointer transition-colors flex items-center gap-1"
                >
                  <Trash2 size={11} /> Clear
                </button>
                <button
                  onClick={resetProcessed}
                  className="text-xs text-gray-500 hover:text-gray-300 cursor-pointer transition-colors flex items-center gap-1"
                >
                  <RotateCcw size={11} /> Reset IDs
                </button>
                <button
                  onClick={fetchCronStatus}
                  className="text-xs text-gray-500 hover:text-gray-300 cursor-pointer transition-colors flex items-center gap-1"
                >
                  <RefreshCw size={11} /> Refresh
                </button>
              </div>
            </div>
            <div
              className="px-4 py-3 max-h-[200px] overflow-y-auto font-mono text-xs leading-relaxed"
              style={{ color: "#8b949e" }}
            >
              {cronLogs.length === 0 ? (
                <p className="text-gray-600 italic">
                  No logs yet. Start the cron to see activity.
                </p>
              ) : (
                cronLogs.map((entry, i) => (
                  <div
                    key={i}
                    className="py-0.5 flex gap-2"
                    style={{
                      color:
                        entry.type === "error"
                          ? "#f87171"
                          : entry.type === "success"
                          ? "#34d399"
                          : entry.type === "warning"
                          ? "#fbbf24"
                          : "#8b949e",
                    }}
                  >
                    <span className="text-gray-600 flex-shrink-0">
                      {formatTime(entry.time)}
                    </span>
                    <span>{entry.message}</span>
                  </div>
                ))
              )}
              <div ref={cronLogEndRef} />
            </div>
          </div>
        </div>
      )}

      {/* TAB BAR */}
      <div className="relative z-10 mx-auto max-w-7xl px-6 pt-6">
        <div
          className="flex items-center gap-1 p-1 rounded-xl w-fit"
          style={{
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          {tabs.map((tab) => (
            <button
              key={tab.id}
              id={`tab-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all cursor-pointer"
              style={{
                background:
                  activeTab === tab.id
                    ? "rgba(16,185,129,0.12)"
                    : "transparent",
                color:
                  activeTab === tab.id ? "#10b981" : "rgba(255,255,255,0.4)",
                border:
                  activeTab === tab.id
                    ? "1px solid rgba(16,185,129,0.25)"
                    : "1px solid transparent",
              }}
            >
              {tab.icon}
              {tab.label}
              {tab.count !== undefined && tab.count > 0 && (
                <span
                  className="ml-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold"
                  style={{
                    background:
                      activeTab === tab.id
                        ? "rgba(16,185,129,0.2)"
                        : "rgba(255,255,255,0.06)",
                    color:
                      activeTab === tab.id
                        ? "#10b981"
                        : "rgba(255,255,255,0.4)",
                  }}
                >
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* MAIN CONTENT */}
      <main className="relative z-10 mx-auto max-w-7xl px-6 py-6">
        {/* ─────────────────── INBOX TAB ─────────────────── */}
        {activeTab === "inbox" && (
          <div className="animate-fade-in">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h1 className="text-2xl font-extrabold tracking-tight text-white mb-1">
                  LinkedIn{" "}
                  <span
                    className="bg-clip-text text-transparent"
                    style={{ backgroundImage: CINDY_GRADIENT }}
                  >
                    Inbox
                  </span>
                </h1>
                <p className="text-sm" style={{ color: "#5a5e72" }}>
                  View and reply to unread LinkedIn messages in real-time.
                </p>
              </div>
              <button
                onClick={fetchInbox}
                disabled={inboxLoading}
                id="refresh-inbox-btn"
                className="flex items-center gap-2 text-sm px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 font-medium transition-all border border-white/10 cursor-pointer disabled:opacity-50"
              >
                <RefreshCw
                  size={14}
                  className={inboxLoading ? "animate-spin" : ""}
                />
                Refresh
              </button>
            </div>

            {inboxError && (
              <div
                className="flex items-center gap-3 p-4 rounded-xl mb-6 border"
                style={{
                  background: "rgba(239,68,68,0.06)",
                  borderColor: "rgba(239,68,68,0.15)",
                }}
              >
                <AlertCircle size={18} className="text-red-400" />
                <p className="text-sm text-red-400">{inboxError}</p>
              </div>
            )}

            {inboxLoading && unreadMessages.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20">
                <RefreshCw
                  size={32}
                  className="animate-spin text-emerald-400 mb-4"
                />
                <p className="text-gray-400 text-sm">
                  Fetching LinkedIn conversations...
                </p>
              </div>
            )}

            {!inboxLoading && unreadMessages.length === 0 && !inboxError && (
              <div className="flex flex-col items-center justify-center py-20">
                <div
                  className="w-20 h-20 rounded-2xl flex items-center justify-center mb-4"
                  style={{
                    background: "rgba(16,185,129,0.06)",
                    border: "1px solid rgba(16,185,129,0.12)",
                  }}
                >
                  <CheckCircle2 size={36} className="text-emerald-400" />
                </div>
                <p className="text-gray-300 text-base font-semibold mb-1">
                  All caught up!
                </p>
                <p className="text-gray-500 text-sm">
                  No unread messages right now.
                </p>
              </div>
            )}

            {/* Unread Message Cards */}
            <div className="grid gap-4">
              {unreadMessages.map((msg) => (
                <div
                  key={msg.conversationUrn}
                  className="p-5 rounded-2xl border transition-all"
                  style={{
                    background: "rgba(0,0,0,0.3)",
                    borderColor: "rgba(255,255,255,0.06)",
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.borderColor =
                      "rgba(16,185,129,0.3)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.borderColor =
                      "rgba(255,255,255,0.06)")
                  }
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <div
                        className="w-11 h-11 rounded-full flex items-center justify-center font-bold text-white shrink-0 shadow-xl"
                        style={{ background: CINDY_GRADIENT }}
                      >
                        {msg.senderName.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="text-sm font-bold text-gray-100">
                            {msg.senderName}
                          </h3>
                          <span className="text-[10px] text-gray-500">
                            {formatRelative(msg.deliveredAt)}
                          </span>
                          <span
                            className="px-1.5 py-0.5 rounded text-[9px] font-bold"
                            style={{
                              background: "rgba(59,130,246,0.12)",
                              color: "#60a5fa",
                              border: "1px solid rgba(59,130,246,0.2)",
                            }}
                          >
                            UNREAD
                          </span>
                        </div>
                        <p className="text-sm text-gray-300 leading-relaxed">
                          {msg.messageText}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => replyToMessage(msg, false)}
                        disabled={replying[msg.conversationUrn]}
                        id={`preview-btn-${msg.conversationUrn}`}
                        className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border transition-all cursor-pointer disabled:opacity-50"
                        style={{
                          borderColor: "rgba(255,255,255,0.1)",
                          color: "#a1a1aa",
                          background: "rgba(255,255,255,0.03)",
                        }}
                        title="Generate reply preview"
                      >
                        {replying[msg.conversationUrn] ? (
                          <RefreshCw size={12} className="animate-spin" />
                        ) : (
                          <Eye size={12} />
                        )}
                        Preview
                      </button>
                      <button
                        onClick={() => replyToMessage(msg, true)}
                        disabled={replying[msg.conversationUrn]}
                        id={`send-btn-${msg.conversationUrn}`}
                        className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg font-semibold border transition-all cursor-pointer disabled:opacity-50"
                        style={{
                          background: "rgba(16,185,129,0.12)",
                          borderColor: "rgba(16,185,129,0.3)",
                          color: "#10b981",
                        }}
                        title="Generate and send reply"
                      >
                        {replying[msg.conversationUrn] ? (
                          <RefreshCw size={12} className="animate-spin" />
                        ) : (
                          <Send size={12} />
                        )}
                        Auto-Reply
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Processed Replies */}
            {processedReplies.length > 0 && (
              <div className="mt-8">
                <h2 className="text-base font-bold text-gray-300 mb-4 flex items-center gap-2">
                  <CheckCircle2 size={16} className="text-emerald-400" />
                  Processed Replies
                </h2>
                <div className="grid gap-3">
                  {processedReplies.map((pr, i) => (
                    <div
                      key={i}
                      className="p-4 rounded-xl border"
                      style={{
                        background: "rgba(16,185,129,0.04)",
                        borderColor: "rgba(16,185,129,0.12)",
                      }}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-gray-200">
                            {pr.senderName}
                          </span>
                          <span
                            className="px-1.5 py-0.5 rounded text-[9px] font-bold"
                            style={{
                              background: pr.sent
                                ? "rgba(16,185,129,0.15)"
                                : "rgba(250,204,21,0.12)",
                              color: pr.sent ? "#34d399" : "#fbbf24",
                              border: `1px solid ${
                                pr.sent
                                  ? "rgba(16,185,129,0.25)"
                                  : "rgba(250,204,21,0.2)"
                              }`,
                            }}
                          >
                            {pr.sent ? "SENT" : "PREVIEW"}
                          </span>
                        </div>
                        <button
                          onClick={() => copyToClipboard(pr.reply)}
                          className="text-xs text-gray-500 hover:text-gray-300 cursor-pointer flex items-center gap-1 transition-colors"
                        >
                          <Copy size={11} /> Copy
                        </button>
                      </div>
                      <p className="text-xs text-gray-500 mb-1.5 italic">
                        &ldquo;{pr.messageText.slice(0, 80)}
                        {pr.messageText.length > 80 ? "..." : ""}&rdquo;
                      </p>
                      <p className="text-sm text-gray-300 leading-relaxed">
                        {pr.reply}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ─────────────────── AUTO-REPLY TAB ─────────────────── */}
        {activeTab === "auto-reply" && (
          <div className="animate-fade-in max-w-3xl mx-auto">
            <div className="mb-8">
              <h1 className="text-2xl font-extrabold tracking-tight text-white mb-2">
                Auto-Reply{" "}
                <span
                  className="bg-clip-text text-transparent"
                  style={{ backgroundImage: CINDY_GRADIENT }}
                >
                  Engine
                </span>
              </h1>
              <p className="text-sm" style={{ color: "#5a5e72" }}>
                When enabled, Cindy checks every 60 seconds for new unread
                LinkedIn messages and automatically generates & sends
                professional replies.
              </p>
            </div>

            {/* Status Card */}
            <div
              className="p-6 rounded-2xl border mb-6"
              style={{
                background: "rgba(0,0,0,0.3)",
                borderColor: cronRunning
                  ? "rgba(16,185,129,0.2)"
                  : "rgba(255,255,255,0.06)",
              }}
            >
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div
                    className="w-12 h-12 rounded-xl flex items-center justify-center"
                    style={{
                      background: cronRunning
                        ? "rgba(16,185,129,0.12)"
                        : "rgba(239,68,68,0.08)",
                      border: `1px solid ${
                        cronRunning
                          ? "rgba(16,185,129,0.25)"
                          : "rgba(239,68,68,0.15)"
                      }`,
                    }}
                  >
                    {cronRunning ? (
                      <Zap size={22} className="text-emerald-400" />
                    ) : (
                      <Power size={22} className="text-red-400" />
                    )}
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white">
                      {cronRunning
                        ? "Cron is Active"
                        : "Cron is Off"}
                    </h3>
                    <p className="text-sm text-gray-500">
                      {cronRunning
                        ? "Auto-replying to new messages every 60 seconds."
                        : "Start the cron to enable automatic replies."}
                    </p>
                  </div>
                </div>
                <button
                  onClick={toggleCron}
                  disabled={cronLoading}
                  id="cron-toggle-main-btn"
                  className="px-6 py-3 rounded-xl font-bold text-sm transition-all cursor-pointer disabled:opacity-50"
                  style={{
                    background: cronRunning
                      ? "rgba(239,68,68,0.12)"
                      : CINDY_GRADIENT,
                    color: cronRunning ? "#ef4444" : "white",
                    border: cronRunning
                      ? "1px solid rgba(239,68,68,0.25)"
                      : "none",
                  }}
                >
                  {cronLoading ? (
                    <RefreshCw size={16} className="animate-spin" />
                  ) : cronRunning ? (
                    "Stop Cron"
                  ) : (
                    "Start Cron"
                  )}
                </button>
              </div>

              {/* Stats Grid */}
              <div
                className="grid grid-cols-3 gap-3 p-4 rounded-xl"
                style={{
                  background: "rgba(255,255,255,0.02)",
                  border: "1px solid rgba(255,255,255,0.04)",
                }}
              >
                <div className="text-center">
                  <p className="text-2xl font-black text-white">
                    {cronProcessedCount}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">Replies Sent</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-black text-white">60s</p>
                  <p className="text-xs text-gray-500 mt-1">Check Interval</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-black text-white">
                    {cronLastRun ? formatTime(cronLastRun) : "—"}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">Last Check</p>
                </div>
              </div>
            </div>

            {/* How it works */}
            <div
              className="p-6 rounded-2xl border"
              style={{
                background: "rgba(0,0,0,0.2)",
                borderColor: "rgba(255,255,255,0.06)",
              }}
            >
              <h3 className="text-sm font-bold text-gray-300 mb-4 flex items-center gap-2">
                <Zap size={14} className="text-emerald-400" />
                How Auto-Reply Works
              </h3>
              <div className="space-y-3">
                {[
                  {
                    step: "1",
                    title: "Fetch Conversations",
                    desc: "LinkedIn Voyager API fetches your latest conversations every 60s using your authenticated cookies.",
                  },
                  {
                    step: "2",
                    title: "Detect Unread Messages",
                    desc: "Parses responses to find new unread messages from other people (not your own).",
                  },
                  {
                    step: "3",
                    title: "Generate AI Reply",
                    desc: "OpenAI generates a professional, warm, and brief reply on your behalf.",
                  },
                  {
                    step: "4",
                    title: "Send Automatically",
                    desc: "The reply is sent directly via LinkedIn's Voyager messaging API.",
                  },
                ].map((item) => (
                  <div
                    key={item.step}
                    className="flex items-start gap-3 p-3 rounded-xl"
                    style={{
                      background: "rgba(255,255,255,0.02)",
                      border: "1px solid rgba(255,255,255,0.04)",
                    }}
                  >
                    <div
                      className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 text-xs font-black"
                      style={{
                        background: "rgba(16,185,129,0.12)",
                        color: "#10b981",
                        border: "1px solid rgba(16,185,129,0.2)",
                      }}
                    >
                      {item.step}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-200">
                        {item.title}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {item.desc}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ─────────────────── PROFILES TAB ─────────────────── */}
        {activeTab === "profiles" && (
          <>
            {!selectedProfile ? (
              <div className="animate-fade-in">
                <div className="mb-8">
                  <h1 className="text-2xl font-extrabold tracking-tight text-white mb-2">
                    Prospect Customer Support{" "}
                    <span
                      className="bg-clip-text text-transparent"
                      style={{ backgroundImage: CINDY_GRADIENT }}
                    >
                      Hub
                    </span>
                  </h1>
                  <p className="text-sm mt-1" style={{ color: "#5a5e72" }}>
                    Provide intelligent, helpful replies to prospects instantly.
                  </p>
                </div>

                <input
                  type="text"
                  placeholder="Search profiles..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  id="profile-search"
                  className="w-full sm:max-w-md rounded-xl px-4 py-3 text-sm outline-none mb-6 border transition-all focus:border-[#10b981]"
                  style={{
                    background: "rgba(0,0,0,0.4)",
                    borderColor: "rgba(255,255,255,0.1)",
                    color: "#e5e7eb",
                  }}
                />

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredProfiles.map((p) => (
                    <div
                      key={p._id}
                      className="p-5 rounded-2xl border transition-all"
                      style={{
                        background: "rgba(0,0,0,0.3)",
                        borderColor: "rgba(255,255,255,0.06)",
                      }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.borderColor =
                          "rgba(16,185,129,0.3)")
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.borderColor =
                          "rgba(255,255,255,0.06)")
                      }
                    >
                      <div className="flex items-center gap-3 mb-3">
                        <div
                          className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-white shadow-xl"
                          style={{ background: CINDY_GRADIENT }}
                        >
                          {p.name.charAt(0)}
                        </div>
                        <div>
                          <h3 className="font-bold text-gray-100 text-sm">
                            {p.name}
                          </h3>
                          <p className="text-xs text-gray-500 line-clamp-1">
                            {p.headline}
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => setSelectedProfile(p)}
                        className="w-full mt-3 py-2 rounded-lg text-xs cursor-pointer font-bold text-[#10b981] border border-[#10b981] bg-[rgba(16,185,129,0.1)] hover:bg-[rgba(16,185,129,0.2)] transition-all"
                      >
                        Support & Reply
                      </button>
                    </div>
                  ))}
                </div>

                {filteredProfiles.length === 0 && !profilesLoading && (
                  <div className="text-center py-12">
                    <p className="text-gray-400 text-sm">
                      No profiles found. Run the Ceevee bot to acquire more
                      profiles.
                    </p>
                  </div>
                )}

                {profilesLoading && profiles.length === 0 && (
                  <div className="flex items-center gap-2 justify-center py-12 text-gray-400 text-sm">
                    <RefreshCw size={16} className="animate-spin" /> Loading
                    profiles...
                  </div>
                )}
              </div>
            ) : (
              <div className="animate-fade-in max-w-4xl mx-auto">
                <button
                  onClick={() => {
                    setSelectedProfile(null);
                    setGeneratedReply("");
                    setProspectMessage("");
                    setIsTimerRunning(false);
                  }}
                  className="flex items-center gap-2 text-sm text-gray-400 hover:text-white cursor-pointer transition-all mb-6"
                >
                  <ChevronLeft size={16} /> Back to profiles
                </button>

                <div
                  className="p-6 md:p-8 rounded-3xl border mb-6"
                  style={{
                    background: "rgba(8,9,16,0.6)",
                    borderColor: "rgba(255,255,255,0.08)",
                    backdropFilter: "blur(20px)",
                  }}
                >
                  <div className="flex items-center gap-4 mb-8 pb-6 border-b border-white/10">
                    <div
                      className="w-14 h-14 rounded-2xl flex items-center justify-center font-bold text-xl text-white shadow-2xl"
                      style={{ background: CINDY_GRADIENT }}
                    >
                      {selectedProfile.name.charAt(0)}
                    </div>
                    <div>
                      <h2 className="text-xl font-bold text-white">
                        {selectedProfile.name}
                      </h2>
                      <p className="text-sm text-gray-400">
                        {selectedProfile.headline}
                      </p>
                    </div>
                  </div>

                  <div className="mb-6">
                    <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                      Message from Prospect
                    </label>
                    <textarea
                      value={prospectMessage}
                      onChange={(e) => setProspectMessage(e.target.value)}
                      disabled={isTimerRunning || generating}
                      placeholder="Paste the email or message sent by the prospect..."
                      id="prospect-message-input"
                      className="w-full rounded-xl px-4 py-3 text-sm outline-none resize-none min-h-[120px] disabled:opacity-50"
                      style={{
                        background: "rgba(255,255,255,0.03)",
                        border: "1px solid rgba(255,255,255,0.1)",
                        color: "#e5e7eb",
                      }}
                    />
                  </div>

                  {!isTimerRunning && !generating && !generatedReply && (
                    <button
                      onClick={startSimulation}
                      disabled={!prospectMessage.trim()}
                      id="receive-message-btn"
                      className="w-full py-3.5 rounded-xl font-bold flex items-center justify-center gap-2 cursor-pointer transition-all disabled:opacity-50"
                      style={{ background: CINDY_GRADIENT, color: "white" }}
                    >
                      <MessageSquare size={18} />
                      Receive Message
                    </button>
                  )}

                  {isTimerRunning && (
                    <div className="w-full p-4 rounded-xl border border-yellow-500/20 bg-yellow-500/10 mb-4 animate-fade-in">
                      <div className="flex flex-col items-center justify-center">
                        <p className="text-yellow-400 font-bold mb-2">
                          Human Representative Unavailable
                        </p>
                        <p className="text-sm text-gray-300 mb-4">
                          Time until Cindy auto-replies:{" "}
                          <span className="font-mono font-bold">
                            {Math.floor(timeLeft / 60)}:
                            {(timeLeft % 60).toString().padStart(2, "0")}
                          </span>
                        </p>
                        <div className="flex items-center gap-3 w-full">
                          <button
                            onClick={cancelSimulation}
                            className="flex-1 py-2 rounded-lg text-sm font-bold border border-white/10 hover:bg-white/5 text-white transition-all cursor-pointer"
                          >
                            Reply Manually
                          </button>
                          <button
                            onClick={skipTimer}
                            className="flex-1 py-2 rounded-lg text-sm font-bold border border-[#10b981] bg-[rgba(16,185,129,0.1)] hover:bg-[rgba(16,185,129,0.2)] text-[#10b981] transition-all cursor-pointer"
                          >
                            Skip Timer (Auto-Reply Now)
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {generating && (
                    <div className="w-full py-4 flex flex-col items-center justify-center gap-3 bg-[rgba(16,185,129,0.05)] border border-[rgba(16,185,129,0.2)] rounded-xl animate-fade-in">
                      <RefreshCw
                        size={24}
                        className="animate-spin text-[#10b981]"
                      />
                      <p className="text-sm font-bold text-[#10b981]">
                        Cindy is studying the profile and message context...
                      </p>
                    </div>
                  )}
                </div>

                {generatedReply && (
                  <div
                    className="p-6 md:p-8 rounded-3xl border animate-fade-in"
                    style={{
                      background: "rgba(16,185,129,0.05)",
                      borderColor: "rgba(16,185,129,0.2)",
                    }}
                  >
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2 text-[#10b981]">
                        <CheckCircle2 size={18} />
                        <h3 className="font-bold">Generated Reply</h3>
                      </div>
                      <button
                        onClick={() => copyToClipboard(generatedReply)}
                        className="flex items-center cursor-pointer gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-[#10b981] text-[#10b981] hover:bg-[#10b981] hover:text-white transition-all"
                      >
                        <Copy size={14} /> Copy
                      </button>
                    </div>
                    <div className="text-gray-300 text-sm leading-relaxed whitespace-pre-wrap">
                      {generatedReply}
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
