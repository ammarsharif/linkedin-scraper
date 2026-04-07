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
  BookOpen,
  AlertTriangle,
} from "lucide-react";

import { ConfirmModal } from "@/components/ConfirmModal";
import { BotSwitcher } from "@/components/BotSwitcher";
import { KnowledgeBasePanel } from "@/components/KnowledgeBasePanel";
import { EscalationPanel } from "@/components/EscalationPanel";
import { FollowUpManager } from "@/components/FollowUpManager";

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

type TabId = "inbox" | "auto-reply" | "knowledge-base" | "escalation" | "follow-ups";

export default function CindyPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [dataFetching, setDataFetching] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>("inbox");
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);

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

  // Modals
  const [showClearLogsConfirm, setShowClearLogsConfirm] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

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
      Promise.all([fetchInbox(), fetchCronStatus()]).finally(() => setDataFetching(false));
      const interval = setInterval(fetchCronStatus, 5000);
      return () => clearInterval(interval);
    }
  }, [checking, fetchCronStatus, fetchInbox]);

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
        setCronRunning(action === "start");
        showToast(
          action === "start"
            ? "Auto-reply cron started! Checking every 60s."
            : "Auto-reply cron stopped.",
          "success"
        );
        fetchCronStatus();
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

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    showToast("Copied to clipboard!", "success");
  };

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

  if (checking || dataFetching) {
    return (
      <div style={{ minHeight: "100vh", background: "#080910", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "#10b981 transparent" }} />
      </div>
    );
  }

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
    { id: "knowledge-base", label: "Knowledge Base", icon: <BookOpen size={15} /> },
    { id: "escalation",     label: "Escalations",    icon: <AlertTriangle size={15} /> },
    { id: "follow-ups",     label: "Follow-Ups",     icon: <Clock size={15} /> },
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
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black transition-all cursor-pointer border active:scale-95 shadow-sm whitespace-nowrap"
              style={{
                background: "rgba(0,180,216,0.1)",
                borderColor: "rgba(0,180,216,0.2)",
                color: "#00b4d8",
              }}
            >
              <Linkedin size={13} strokeWidth={3} />
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
              className="flex items-center gap-2.5 text-sm px-4 py-2.5 rounded-xl font-bold transition-all cursor-pointer border disabled:opacity-50 active:scale-95 shadow-sm whitespace-nowrap"
              style={{
                background: cronRunning
                  ? "rgba(239,68,68,0.1)"
                  : "rgba(16,185,129,0.1)",
                borderColor: cronRunning
                  ? "rgba(239,68,68,0.2)"
                  : "rgba(16,185,129,0.2)",
                color: cronRunning ? "#ef4444" : "#10b981",
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
                cronRunning ? <Square size={14} /> : <Play size={14} />
              )}
              <span>{cronRunning ? "Stop Cron" : "Start Cron"}</span>
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
            </div>
          </div>
        </div>
      </header>

      {/* TAB BAR */}
      <div className="relative z-10 mx-auto max-w-7xl px-6 pt-6 overflow-hidden">
        <div
          className="flex items-center gap-1 p-1 rounded-xl w-full max-w-fit overflow-x-auto shadow-sm no-scrollbar"
          style={{
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.06)",
            msOverflowStyle: 'none',
            scrollbarWidth: 'none',
          }}
        >
          {tabs.map((tab) => (
            <button
              key={tab.id}
              id={`tab-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className="flex items-center gap-2.5 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all cursor-pointer whitespace-nowrap shrink-0 group active:scale-95 hover:bg-white/[0.04]"
              style={{
                background:
                  activeTab === tab.id
                    ? "rgba(16,185,129,0.1)"
                    : "transparent",
                color:
                  activeTab === tab.id ? "#10b981" : "rgba(255,255,255,0.5)",
                border:
                  activeTab === tab.id
                    ? "1px solid rgba(16,185,129,0.2)"
                    : "1px solid transparent",
              }}
            >
              <span className={`transition-colors ${activeTab === tab.id ? "text-[#10b981]" : "text-gray-500 group-hover:text-gray-300"}`}>
                {tab.icon}
              </span>
              {tab.label}
              {tab.count !== undefined && tab.count > 0 && (
                <span
                  className="ml-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold transition-colors"
                  style={{
                    background:
                      activeTab === tab.id
                        ? "rgba(16,185,129,0.2)"
                        : "rgba(255,255,255,0.08)",
                    color:
                      activeTab === tab.id
                        ? "#10b981"
                        : "rgba(255,255,255,0.6)",
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
                  className="px-6 py-3 rounded-xl font-bold text-sm transition-all cursor-pointer disabled:opacity-50 flex items-center gap-2"
                  style={{
                    background: cronRunning
                      ? "rgba(239,68,68,0.08)"
                      : "rgba(16,185,129,0.1)",
                    borderColor: cronRunning
                      ? "rgba(239,68,68,0.2)"
                      : "rgba(16,185,129,0.3)",
                    color: cronRunning ? "#ef4444" : "#10b981",
                  }}
                >
                  {cronLoading ? (
                    <RefreshCw size={16} className="animate-spin" />
                  ) : cronRunning ? (
                    <>
                      <Square size={16} />
                      Stop Cron
                    </>
                  ) : (
                    <>
                      <Play size={16} />
                      Start Cron
                    </>
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

              {/* Advanced Actions */}
              <div className="flex items-center gap-2 mt-4 pt-4 border-t border-white/5">
                <button
                  onClick={() => setShowClearLogsConfirm(true)}
                  className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-bold px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 transition-all cursor-pointer"
                >
                  <Trash2 size={10} />
                  Clear Logs
                </button>
                <button
                  onClick={() => setShowResetConfirm(true)}
                  className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-bold px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 transition-all cursor-pointer"
                >
                  <RotateCcw size={10} />
                  Reset Counters
                </button>
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

        {activeTab === "knowledge-base" && (
          <div className="animate-fade-in" style={{ maxWidth: 760 }}>
            <div className="mb-6">
              <h1 className="text-2xl font-extrabold tracking-tight text-white mb-1">
                Knowledge{" "}
                <span className="bg-clip-text text-transparent" style={{ backgroundImage: CINDY_GRADIENT }}>
                  Base
                </span>
              </h1>
              <p className="text-sm" style={{ color: "#5a5e72" }}>
                Manage company policies, FAQs, and guidelines Cindy uses to answer LinkedIn queries.
              </p>
            </div>
            <KnowledgeBasePanel botId="cindy" accentColor="#10b981" />
          </div>
        )}

        {activeTab === "escalation" && (
          <div className="animate-fade-in" style={{ maxWidth: 760 }}>
            <div className="mb-6">
              <h1 className="text-2xl font-extrabold tracking-tight text-white mb-1">
                Human{" "}
                <span className="bg-clip-text text-transparent" style={{ backgroundImage: CINDY_GRADIENT }}>
                  Escalations
                </span>
              </h1>
              <p className="text-sm" style={{ color: "#5a5e72" }}>
                Conversations Cindy could not handle — requires your attention.
              </p>
            </div>
            <EscalationPanel botId="cindy" accentColor="#10b981" />
          </div>
        )}

        {activeTab === "follow-ups" && (
          <div className="animate-fade-in" style={{ maxWidth: 860 }}>
            <div className="mb-6">
              <h1 className="text-2xl font-extrabold tracking-tight text-white mb-1">
                Automated{" "}
                <span className="bg-clip-text text-transparent" style={{ backgroundImage: CINDY_GRADIENT }}>
                  Follow-Ups
                </span>
              </h1>
              <p className="text-sm" style={{ color: "#5a5e72" }}>
                Track unanswered messages and auto-send follow-ups at scheduled intervals.
              </p>
            </div>
            <FollowUpManager botName="cindy" accentColor="#10b981" />
          </div>
        )}
      </main>

      {/* ══ Confirm Modals ══ */}
      <ConfirmModal
        isOpen={showClearLogsConfirm}
        onClose={() => setShowClearLogsConfirm(false)}
        onConfirm={clearCronLogs}
        title="Clear Activity Logs"
        message="Are you sure you want to clear all auto-reply logs? This will permanently remove the history shown in the logs panel. New activity will still be logged."
        color="#10b981"
      />

      <ConfirmModal
        isOpen={showResetConfirm}
        onClose={() => setShowResetConfirm(false)}
        onConfirm={resetProcessed}
        title="Reset Reply Counters"
        message="Are you sure you want to reset the processed message cache? Cindy will treat previously replied-to messages as new if they appear in the inbox again."
        color="#10b981"
      />
    </div>
  );
}
