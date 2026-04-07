"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  MessageSquare,
  Zap,
  RefreshCw,
  Power,
  Terminal,
  ChevronDown,
  ChevronUp,
  Clock,
  Bot,
  AlertCircle,
  Play,
  Square,
  Trash2,
  RotateCcw,
  Facebook,
  Save,
  Key,
  History,
  LogOut,
  ShieldCheck,
  ShieldAlert,
  ShieldOff,
  CalendarClock,
  User,
  BookOpen,
  AlertTriangle,
} from "lucide-react";

import { ConfirmModal } from "@/components/ConfirmModal";
import { BotSwitcher } from "@/components/BotSwitcher";
import { KnowledgeBasePanel } from "@/components/KnowledgeBasePanel";
import { EscalationPanel } from "@/components/EscalationPanel";
import { FollowUpManager } from "@/components/FollowUpManager";

interface CronLogEntry {
  time: string;
  message: string;
  type: "info" | "success" | "error" | "warning";
}

interface ConversationLog {
  _id: string;
  threadId: string;
  senderName: string;
  senderId?: string;
  lastActivity: string;
  createdAt: string;
  messages: {
    role: string;
    text: string;
    timestamp: string;
    source: string;
  }[];
}

interface FbSession {
  exists: boolean;
  c_user?: string;
  savedAt?: string;
  status?: "active" | "expired";
}

const FELIX_GRADIENT = "linear-gradient(135deg, #3b82f6, #1d4ed8, #60a5fa)";
const FELIX_COLOR = "#3b82f6";

type TabId = "fb-auth" | "auto-reply" | "logs" | "knowledge-base" | "escalation" | "follow-ups";

export default function FelixPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [dataFetching, setDataFetching] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>("fb-auth");
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);

  // Cron state
  const [cronRunning, setCronRunning] = useState(false);
  const [cronLastRun, setCronLastRun] = useState<string | null>(null);
  const [cronProcessedCount, setCronProcessedCount] = useState(0);
  const [cronLogs, setCronLogs] = useState<CronLogEntry[]>([]);
  const [cronLoading, setCronLoading] = useState(false);
  const [showCronLogs, setShowCronLogs] = useState(false);
  const cronLogEndRef = useRef<HTMLDivElement>(null);

  // System prompt state
  const [systemPrompt, setSystemPrompt] = useState(
    "You are a professional Facebook Messenger assistant. Reply briefly, warmly and professionally to Facebook messages on behalf of the user. Keep replies under 3 sentences. Do not use emojis."
  );
  const [promptSaving, setPromptSaving] = useState(false);

  // Logs state
  const [convLogs, setConvLogs] = useState<ConversationLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [expandedLog, setExpandedLog] = useState<string | null>(null);

  // FB Session state
  const [fbSession, setFbSession] = useState<FbSession>({ exists: false });
  const [fbSessionLoading, setFbSessionLoading] = useState(false);
  const [rawCookies, setRawCookies] = useState("");
  const [fbDtsg, setFbDtsg] = useState("");
  const [clearingSession, setClearingSession] = useState(false);

  // Modals
  const [showClearSessionConfirm, setShowClearSessionConfirm] = useState(false);
  const [showClearLogsConfirm, setShowClearLogsConfirm] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const showToast = useCallback(
    (message: string, type: "success" | "error") => {
      setToast({ message, type });
      setTimeout(() => setToast(null), 4000);
    },
    []
  );

  // ── LinkedIn auth check ───────────────────────────────────────────────────
  useEffect(() => {
    fetch("/api/auth")
      .then((r) => r.json())
      .then((d) => {
        if (!d.authenticated) router.push("/");
      })
      .catch(() => router.push("/"))
      .finally(() => setChecking(false));
  }, [router]);

  // ── Load FB session from DB ───────────────────────────────────────────────
  const loadFbSession = useCallback(async () => {
    try {
      const res = await fetch("/api/felix");
      const data = await res.json();
      const session: FbSession = data.session ?? { exists: false };
      setFbSession(session);
      if (data.logs) setConvLogs(data.logs);
      // Auto-navigate to auto-reply tab if session is already active
      if (session.exists && session.status === "active") {
        setActiveTab("auto-reply");
      }
    } catch {
      setFbSession({ exists: false });
    }
  }, []);

  // ── Cron status polling ───────────────────────────────────────────────────
  const fetchCronStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/felix/inbox/cron");
      const data = await res.json();
      setCronRunning(data.running ?? false);
      setCronLastRun(data.lastRun ?? null);
      setCronProcessedCount(data.processedCount ?? 0);
      if (data.logs) setCronLogs(data.logs);
      if (data.systemPrompt) setSystemPrompt(data.systemPrompt);
    } catch {
      /* silent */
    }
  }, []);

  useEffect(() => {
    if (!checking) {
      Promise.all([loadFbSession(), fetchCronStatus()]).finally(() => setDataFetching(false));
    }
  }, [checking, loadFbSession, fetchCronStatus]);

  useEffect(() => {
    if (!checking) {
      const interval = setInterval(fetchCronStatus, 30000);
      return () => clearInterval(interval);
    }
  }, [checking, fetchCronStatus]);

  useEffect(() => {
    if (showCronLogs && cronLogEndRef.current) {
      cronLogEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [cronLogs, showCronLogs]);

  // ── Fetch conversation logs ───────────────────────────────────────────────
  const fetchLogs = useCallback(async () => {
    setLogsLoading(true);
    try {
      const res = await fetch("/api/felix");
      const data = await res.json();
      if (data.logs) setConvLogs(data.logs);
    } catch {
      /* silent */
    } finally {
      setLogsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!checking && activeTab === "logs") fetchLogs();
  }, [checking, activeTab, fetchLogs]);

  // ── Save FB session ───────────────────────────────────────────────────────
  const saveFbSession = async () => {
    if (!rawCookies.trim()) {
      showToast("Paste your Facebook cookie string first.", "error");
      return;
    }
    setFbSessionLoading(true);
    try {
      const res = await fetch("/api/felix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rawCookies: rawCookies.trim(),
          ...(fbDtsg.trim() ? { fb_dtsg: fbDtsg.trim() } : {}),
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setRawCookies("");
        setFbDtsg("");
        showToast("Facebook session saved successfully.", "success");
        await loadFbSession();
      } else {
        showToast(data.error || "Failed to save session.", "error");
      }
    } catch {
      showToast("Network error saving session.", "error");
    } finally {
      setFbSessionLoading(false);
    }
  };

  // ── Clear FB session ──────────────────────────────────────────────────────
  const clearFbSession = async () => {
    setClearingSession(true);
    try {
      const res = await fetch("/api/felix", { method: "DELETE" });
      const data = await res.json();
      if (res.ok && data.success) {
        setFbSession({ exists: false });
        showToast("Facebook session cleared.", "success");
      } else {
        showToast(data.error || "Failed to clear session.", "error");
      }
    } catch {
      showToast("Network error clearing session.", "error");
    } finally {
      setClearingSession(false);
    }
  };

  // ── Toggle cron ───────────────────────────────────────────────────────────
  const toggleCron = async () => {
    if (!cronRunning && !fbSession.exists) {
      showToast("Set up your Facebook session first.", "error");
      setActiveTab("fb-auth");
      return;
    }
    if (!cronRunning && fbSession.status === "expired") {
      showToast("Facebook session is expired. Please re-authenticate first.", "error");
      setActiveTab("fb-auth");
      return;
    }
    setCronLoading(true);
    const action = cronRunning ? "stop" : "start";
    try {
      const res = await fetch("/api/felix/inbox/cron", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (data.success) {
        setCronRunning(action === "start");
        showToast(
          action === "start"
            ? "Auto-reply cron started — checking every 60s."
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
    await fetch("/api/felix/inbox/cron", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "clear-logs" }),
    });
    setCronLogs([]);
  };

  const resetProcessed = async () => {
    await fetch("/api/felix/inbox/cron", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reset-processed" }),
    });
    setCronProcessedCount(0);
    showToast("Processed message IDs reset.", "success");
  };

  const saveSystemPrompt = async () => {
    setPromptSaving(true);
    try {
      const res = await fetch("/api/felix/inbox/cron", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update-prompt", prompt: systemPrompt }),
      });
      const data = await res.json();
      if (data.success) {
        showToast("System prompt updated.", "success");
      } else {
        showToast(data.error || "Failed to update prompt", "error");
      }
    } catch {
      showToast("Network error updating prompt", "error");
    } finally {
      setPromptSaving(false);
    }
  };

  const formatTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch {
      return iso;
    }
  };

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return iso;
    }
  };

  const logTypeColor = (type: CronLogEntry["type"]) => {
    switch (type) {
      case "success": return "#34d399";
      case "error":   return "#f87171";
      case "warning": return "#fbbf24";
      default:        return "#94a3b8";
    }
  };

  const sessionStatusConfig = () => {
    if (!fbSession.exists) {
      return {
        icon: <ShieldOff size={18} />,
        label: "Not Connected",
        desc: "No Facebook session found. Connect to enable auto-reply.",
        color: "#6b7280",
        bg: "rgba(107,114,128,0.08)",
        border: "rgba(107,114,128,0.2)",
      };
    }
    if (fbSession.status === "expired") {
      return {
        icon: <ShieldAlert size={18} />,
        label: "Session Expired",
        desc: "Your Facebook cookies have expired. Please reconnect with fresh cookies.",
        color: "#f87171",
        bg: "rgba(239,68,68,0.08)",
        border: "rgba(239,68,68,0.2)",
      };
    }
    return {
      icon: <ShieldCheck size={18} />,
      label: "Connected",
      desc: `Authenticated as UID ${fbSession.c_user}. Session is active.`,
      color: "#34d399",
      bg: "rgba(52,211,153,0.08)",
      border: "rgba(52,211,153,0.2)",
    };
  };

  if (checking || dataFetching) {
    return (
      <div style={{ minHeight: "100vh", background: "#080910", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: `${FELIX_COLOR} transparent` }} />
      </div>
    );
  }

  const sessionStatus = sessionStatusConfig();
  const isConnected = fbSession.exists && fbSession.status !== "expired";

  const tabs: { id: TabId; label: string; icon: React.ReactNode; count?: number; alert?: boolean }[] = [
    { id: "fb-auth",    label: "Facebook Auth",        icon: <Key size={15} />,           alert: !isConnected },
    { id: "auto-reply", label: "Auto-Reply",            icon: <Bot size={15} /> },
    { id: "logs",           label: "Conversation Logs",  icon: <History size={15} />,       count: convLogs.length },
    { id: "knowledge-base", label: "Knowledge Base",      icon: <BookOpen size={15} /> },
    { id: "escalation",     label: "Escalations",         icon: <AlertTriangle size={15} /> },
    { id: "follow-ups",     label: "Follow-Ups",          icon: <Clock size={15} /> },
  ];

  return (
    <div className="relative min-h-screen" style={{ background: "#080910" }}>
      <div className="bg-mesh" />

      <style>{`
        .glass-tab {
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .glass-tab:hover {
          background: rgba(255, 255, 255, 0.05) !important;
          color: #fff !important;
        }
        .nav-active {
          box-shadow: 0 0 20px rgba(59, 130, 246, 0.2), inset 0 0 10px rgba(59, 130, 246, 0.1);
        }
        .animate-glow {
          animation: glow 3s ease-in-out infinite;
        }
        @keyframes glow {
          0%, 100% { filter: drop-shadow(0 0 5px rgba(59,130,246,0.3)); }
          50% { filter: drop-shadow(0 0 15px rgba(59,130,246,0.6)); }
        }
      `}</style>

      {/* Toast */}
      {toast && (
        <div
          className="fixed bottom-6 right-6 z-50 animate-fade-in flex items-center gap-3 px-5 py-3 rounded-xl border text-sm font-semibold shadow-2xl"
          style={{
            background:
              toast.type === "success"
                ? "rgba(59,130,246,0.1)"
                : "rgba(239,68,68,0.1)",
            color: toast.type === "success" ? "#60a5fa" : "#ef4444",
            borderColor:
              toast.type === "success"
                ? "rgba(59,130,246,0.2)"
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
            <div className="flex items-center gap-2.5">
              <div
                className="flex items-center justify-center rounded-lg shadow-lg animate-glow"
                style={{ width: 32, height: 32, background: FELIX_GRADIENT }}
              >
                <Facebook size={16} stroke="white" strokeWidth={2.5} />
              </div>
              <div>
                <p className="text-sm font-bold" style={{ color: "#e5e7eb", lineHeight: 1.2 }}>
                  Felix
                </p>
                <p className="text-[11px]" style={{ color: "#4b5268" }}>
                  FB Inbox Auto-Reply
                </p>
              </div>
            </div>

            <div style={{ width: 1, height: 24, background: "rgba(255,255,255,0.08)", margin: "0 4px" }} />
            <BotSwitcher currentBotId="felix" />
          </div>

          <div className="flex items-center gap-3">
            {/* Session pill */}
            <div
              className="hidden sm:flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg border"
              style={{
                background: sessionStatus.bg,
                borderColor: sessionStatus.border,
                color: sessionStatus.color,
              }}
            >
              {sessionStatus.icon}
              <span className="font-semibold">{sessionStatus.label}</span>
            </div>

            <div style={{ width: 1, height: 20, background: "rgba(255,255,255,0.08)" }} />

            {/* Cron toggle */}
            <button
              onClick={toggleCron}
              disabled={cronLoading}
              className="flex items-center gap-2.5 text-sm px-4 py-2.5 rounded-xl font-bold transition-all cursor-pointer border disabled:opacity-50 active:scale-95 shadow-sm whitespace-nowrap"
              style={{
                background: cronRunning ? "rgba(239,68,68,0.1)" : "rgba(59,130,246,0.1)",
                borderColor: cronRunning ? "rgba(239,68,68,0.2)" : "rgba(59,130,246,0.2)",
                color: cronRunning ? "#ef4444" : FELIX_COLOR,
              }}
            >
              {cronLoading ? (
                <RefreshCw size={14} className="animate-spin" />
              ) : cronRunning ? (
                <Square size={14} />
              ) : (
                <Play size={14} />
              )}
              <span>{cronRunning ? "Stop Cron" : "Start Cron"}</span>
            </button>

            <div className="flex items-center gap-2 text-xs text-gray-500">
              <Clock size={12} />
              <span>{cronLastRun ? formatTime(cronLastRun) : "Never"}</span>
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
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2.5 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all cursor-pointer whitespace-nowrap shrink-0 group active:scale-95 glass-tab ${activeTab === tab.id ? "nav-active" : ""}`}
              style={{
                background: activeTab === tab.id ? "rgba(59,130,246,0.12)" : "transparent",
                color: activeTab === tab.id ? FELIX_COLOR : "rgba(255,255,255,0.5)",
                border: "1px solid",
                borderColor: activeTab === tab.id ? "rgba(59,130,246,0.3)" : "transparent",
              }}
            >
              <span className={`transition-colors ${activeTab === tab.id ? "text-[#3b82f6]" : "text-gray-500 group-hover:text-gray-300"}`}>
                {tab.icon}
              </span>
              {tab.label}
              {tab.alert && (
                <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0 shadow-[0_0_8px_rgba(251,191,36,0.4)]" />
              )}
              {tab.count !== undefined && tab.count > 0 && (
                <span
                  className="ml-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold transition-colors"
                  style={{
                    background: activeTab === tab.id ? "rgba(59,130,246,0.2)" : "rgba(255,255,255,0.08)",
                    color: activeTab === tab.id ? FELIX_COLOR : "rgba(255,255,255,0.6)",
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

        {/* ──────────────────── FACEBOOK AUTH TAB ──────────────────── */}
        {activeTab === "fb-auth" && (
          <div className="animate-fade-in max-w-2xl mx-auto">
            <div className="mb-8">
              <h1 className="text-2xl font-extrabold tracking-tight text-white mb-2">
                Facebook{" "}
                <span className="bg-clip-text text-transparent" style={{ backgroundImage: FELIX_GRADIENT }}>
                  Authentication
                </span>
              </h1>
              <p className="text-sm" style={{ color: "#5a5e72" }}>
                Felix needs your Facebook session cookies to access Messenger.
                Credentials are stored securely in the database and persist across sessions.
              </p>
            </div>

            {/* ── Session status card ── */}
            <div
              className="p-5 rounded-2xl border mb-6"
              style={{
                background: sessionStatus.bg,
                borderColor: sessionStatus.border,
              }}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: `${sessionStatus.bg}`, color: sessionStatus.color }}
                  >
                    {sessionStatus.icon}
                  </div>
                  <div>
                    <p className="text-sm font-bold" style={{ color: sessionStatus.color }}>
                      {sessionStatus.label}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: "#5a5e72" }}>
                      {sessionStatus.desc}
                    </p>
                    {fbSession.exists && fbSession.savedAt && (
                      <div className="flex items-center gap-1.5 mt-2">
                        <CalendarClock size={11} style={{ color: "#4b5268" }} />
                        <span className="text-[11px]" style={{ color: "#4b5268" }}>
                          Saved {formatDate(fbSession.savedAt)}
                        </span>
                      </div>
                    )}
                    {fbSession.exists && fbSession.c_user && (
                      <div className="flex items-center gap-1.5 mt-1">
                        <User size={11} style={{ color: "#4b5268" }} />
                        <span className="text-[11px]" style={{ color: "#4b5268" }}>
                          UID: {fbSession.c_user}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {fbSession.exists && (
                  <button
                    onClick={() => setShowClearSessionConfirm(true)}
                    disabled={clearingSession}
                    className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border cursor-pointer transition-all shrink-0 disabled:opacity-50"
                    style={{
                      background: "rgba(239,68,68,0.08)",
                      borderColor: "rgba(239,68,68,0.2)",
                      color: "#f87171",
                    }}
                  >
                    {clearingSession ? (
                      <RefreshCw size={12} className="animate-spin" />
                    ) : (
                      <LogOut size={12} />
                    )}
                    Disconnect
                  </button>
                )}
              </div>
            </div>

            {/* ── Cookie input form ── */}
            <div
              className="p-6 rounded-2xl border mb-6"
              style={{
                background: "rgba(0,0,0,0.3)",
                borderColor: "rgba(255,255,255,0.06)",
              }}
            >
              <h3 className="text-sm font-bold text-white mb-1">
                {fbSession.exists ? "Update Cookies" : "Connect Your Account"}
              </h3>
              <p className="text-xs mb-5" style={{ color: "#5a5e72" }}>
                {fbSession.exists
                  ? "Paste fresh Facebook cookies to refresh your session."
                  : "Paste your Facebook cookie string below to authenticate Felix."}
              </p>

              <div className="space-y-4">
                <div>
                  <label className="flex items-center gap-2 text-xs font-semibold text-gray-400 mb-2">
                    <Key size={12} style={{ color: FELIX_COLOR }} />
                    Raw Cookie String
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded font-normal"
                      style={{ background: "rgba(59,130,246,0.1)", color: FELIX_COLOR }}
                    >
                      required
                    </span>
                  </label>
                  <textarea
                    value={rawCookies}
                    onChange={(e) => setRawCookies(e.target.value)}
                    rows={5}
                    placeholder="c_user=123456789; xs=AbCdEf12:gh...; datr=xyz...; sb=...; fr=..."
                    className="w-full rounded-xl px-4 py-3 text-xs font-mono outline-none resize-none border transition-all"
                    style={{
                      background: "rgba(0,0,0,0.5)",
                      borderColor: rawCookies ? "rgba(59,130,246,0.3)" : "rgba(255,255,255,0.08)",
                      color: "#e5e7eb",
                    }}
                  />
                  <p className="text-[11px] mt-1.5" style={{ color: "#4b5268" }}>
                    Must include <code className="text-blue-400/80">c_user</code> and <code className="text-blue-400/80">xs</code>. Also include <code className="text-blue-400/80">datr</code>, <code className="text-blue-400/80">sb</code>, <code className="text-blue-400/80">fr</code> for best results.
                  </p>
                </div>

                <div>
                  <label className="flex items-center gap-2 text-xs font-semibold text-gray-400 mb-2">
                    <Zap size={12} style={{ color: FELIX_COLOR }} />
                    fb_dtsg Token
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded font-normal"
                      style={{ background: "rgba(255,255,255,0.04)", color: "#6b7280" }}
                    >
                      optional
                    </span>
                  </label>
                  <input
                    value={fbDtsg}
                    onChange={(e) => setFbDtsg(e.target.value)}
                    placeholder="AQH..."
                    className="w-full rounded-xl px-4 py-3 text-xs font-mono outline-none border transition-all"
                    style={{
                      background: "rgba(0,0,0,0.5)",
                      borderColor: "rgba(255,255,255,0.08)",
                      color: "#e5e7eb",
                    }}
                  />
                  <p className="text-[11px] mt-1.5" style={{ color: "#4b5268" }}>
                    Find in Facebook page source: search for <code className="text-blue-400/80">&quot;dtsg&quot;</code>. Needed for some API calls.
                  </p>
                </div>
              </div>

              <button
                onClick={saveFbSession}
                disabled={fbSessionLoading || !rawCookies.trim()}
                className="mt-5 flex items-center gap-2 px-6 py-2.5 rounded-xl font-bold text-sm border transition-all cursor-pointer disabled:opacity-50"
                style={{
                  background: "rgba(59,130,246,0.12)",
                  borderColor: "rgba(59,130,246,0.3)",
                  color: FELIX_COLOR,
                }}
              >
                {fbSessionLoading ? (
                  <RefreshCw size={14} className="animate-spin" />
                ) : (
                  <Save size={14} />
                )}
                {fbSession.exists ? "Update Session" : "Save & Connect"}
              </button>
            </div>

            {/* ── How to get cookies ── */}
            <div
              className="p-6 rounded-2xl border"
              style={{
                background: "rgba(0,0,0,0.2)",
                borderColor: "rgba(255,255,255,0.06)",
              }}
            >
              <h3 className="text-sm font-bold text-gray-300 mb-4 flex items-center gap-2">
                <Terminal size={14} style={{ color: FELIX_COLOR }} />
                How to Extract Your Cookies
              </h3>
              <div className="space-y-2.5">
                {[
                  {
                    step: "1",
                    title: "Open Facebook & log in",
                    desc: "Go to facebook.com in Chrome or Edge and make sure you're signed in.",
                  },
                  {
                    step: "2",
                    title: "Open DevTools",
                    desc: "Press F12 → Application tab → Storage → Cookies → https://www.facebook.com",
                  },
                  {
                    step: "3",
                    title: "Copy cookie values",
                    desc: 'Find c_user, xs, datr, sb, fr. Right-click the URL → "Copy all as header value" or manually assemble: c_user=VALUE; xs=VALUE; ...',
                  },
                  {
                    step: "4",
                    title: "Paste & save",
                    desc: "Paste the cookie string above and click Save & Connect. Your session is stored in the database and lasts until Facebook invalidates the cookies.",
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
                      className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0 text-xs font-black"
                      style={{
                        background: "rgba(59,130,246,0.12)",
                        color: FELIX_COLOR,
                        border: "1px solid rgba(59,130,246,0.2)",
                      }}
                    >
                      {item.step}
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-gray-200">{item.title}</p>
                      <p className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div
                className="mt-4 flex items-start gap-2 p-3 rounded-xl"
                style={{ background: "rgba(251,191,36,0.06)", border: "1px solid rgba(251,191,36,0.15)" }}
              >
                <AlertCircle size={13} className="text-amber-400 shrink-0 mt-0.5" />
                <p className="text-[11px] text-amber-400/80 leading-relaxed">
                  Facebook cookies expire when you log out or after a period of inactivity. If the cron starts showing login errors in the activity log, come back here and refresh your cookies.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ──────────────────── AUTO-REPLY TAB ──────────────────── */}
        {activeTab === "auto-reply" && (
          <div className="animate-fade-in max-w-3xl mx-auto">
            <div className="mb-8">
              <h1 className="text-2xl font-extrabold tracking-tight text-white mb-2">
                Auto-Reply{" "}
                <span className="bg-clip-text text-transparent" style={{ backgroundImage: FELIX_GRADIENT }}>
                  Engine
                </span>
              </h1>
              <p className="text-sm" style={{ color: "#5a5e72" }}>
                When enabled, Felix checks every 60 seconds for new unread Facebook
                messages and automatically generates &amp; sends professional replies.
              </p>
            </div>

            {/* No session warning */}
            {!isConnected && (
              <div
                className="flex items-center gap-3 p-4 rounded-xl border mb-6"
                style={{
                  background: "rgba(251,191,36,0.06)",
                  borderColor: "rgba(251,191,36,0.2)",
                }}
              >
                <AlertCircle size={16} className="text-amber-400 shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-amber-400">Facebook session required</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Connect your Facebook account before starting the cron.
                  </p>
                </div>
                <button
                  onClick={() => setActiveTab("fb-auth")}
                  className="text-xs px-3 py-1.5 rounded-lg border cursor-pointer"
                  style={{
                    background: "rgba(251,191,36,0.1)",
                    borderColor: "rgba(251,191,36,0.25)",
                    color: "#fbbf24",
                  }}
                >
                  Connect
                </button>
              </div>
            )}

            {/* Status Card */}
            <div
              className="p-6 rounded-2xl border mb-6"
              style={{
                background: "rgba(0,0,0,0.3)",
                borderColor: cronRunning ? "rgba(59,130,246,0.2)" : "rgba(255,255,255,0.06)",
              }}
            >
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div
                    className="w-12 h-12 rounded-xl flex items-center justify-center"
                    style={{
                      background: cronRunning ? "rgba(59,130,246,0.12)" : "rgba(239,68,68,0.08)",
                      border: `1px solid ${cronRunning ? "rgba(59,130,246,0.25)" : "rgba(239,68,68,0.15)"}`,
                    }}
                  >
                    {cronRunning ? (
                      <Zap size={22} style={{ color: FELIX_COLOR }} />
                    ) : (
                      <Power size={22} className="text-red-400" />
                    )}
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white">
                      {cronRunning ? "Cron Active" : "Cron Stopped"}
                    </h3>
                    <p className="text-sm text-gray-500">
                      {cronRunning
                        ? "Checking for new messages every 60 seconds."
                        : "Start the cron to enable automatic replies."}
                    </p>
                  </div>
                </div>
                <button
                  onClick={toggleCron}
                  disabled={cronLoading}
                  className="px-6 py-3 rounded-xl font-bold text-sm transition-all cursor-pointer disabled:opacity-50 flex items-center gap-2 border"
                  style={{
                    background: cronRunning ? "rgba(239,68,68,0.08)" : "rgba(59,130,246,0.1)",
                    borderColor: cronRunning ? "rgba(239,68,68,0.2)" : "rgba(59,130,246,0.3)",
                    color: cronRunning ? "#ef4444" : FELIX_COLOR,
                  }}
                >
                  {cronLoading ? (
                    <RefreshCw size={16} className="animate-spin" />
                  ) : cronRunning ? (
                    <><Square size={16} /> Stop</>
                  ) : (
                    <><Play size={16} /> Start Cron</>
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
                  <p className="text-2xl font-black text-white">{cronProcessedCount}</p>
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

              <div className="flex items-center gap-3 mt-4">
                <button
                  onClick={resetProcessed}
                  className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border cursor-pointer transition-all text-gray-400 border-white/10 hover:bg-white/5"
                >
                  <RotateCcw size={12} /> Reset Processed IDs
                </button>
                <button
                  onClick={clearCronLogs}
                  className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border cursor-pointer transition-all text-gray-400 border-white/10 hover:bg-white/5"
                >
                  <Trash2 size={12} /> Clear Logs
                </button>
              </div>
            </div>

            {/* System Prompt */}
            <div
              className="p-6 rounded-2xl border mb-6"
              style={{
                background: "rgba(0,0,0,0.2)",
                borderColor: "rgba(255,255,255,0.06)",
              }}
            >
              <h3 className="text-sm font-bold text-gray-300 mb-1 flex items-center gap-2">
                <Bot size={14} style={{ color: FELIX_COLOR }} />
                AI System Prompt
              </h3>
              <p className="text-xs text-gray-500 mb-3">
                Customize how Felix responds to Facebook messages on your behalf.
              </p>
              <textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                rows={4}
                className="w-full rounded-xl px-4 py-3 text-sm outline-none resize-none mb-3 border transition-all"
                style={{
                  background: "rgba(0,0,0,0.4)",
                  borderColor: "rgba(255,255,255,0.08)",
                  color: "#e5e7eb",
                }}
              />
              <button
                onClick={saveSystemPrompt}
                disabled={promptSaving}
                className="flex items-center gap-2 text-xs px-4 py-2 rounded-lg font-bold border transition-all cursor-pointer disabled:opacity-50"
                style={{
                  background: "rgba(59,130,246,0.1)",
                  borderColor: "rgba(59,130,246,0.3)",
                  color: FELIX_COLOR,
                }}
              >
                {promptSaving ? <RefreshCw size={12} className="animate-spin" /> : <Save size={12} />}
                Save Prompt
              </button>
            </div>

            {/* Cron Activity Log */}
            <div
              className="p-6 rounded-2xl border"
              style={{
                background: "rgba(0,0,0,0.2)",
                borderColor: "rgba(255,255,255,0.06)",
              }}
            >
              <button
                onClick={() => setShowCronLogs((v) => !v)}
                className="flex items-center justify-between w-full cursor-pointer"
              >
                <h3 className="text-sm font-bold text-gray-300 flex items-center gap-2">
                  <Terminal size={14} style={{ color: FELIX_COLOR }} />
                  Activity Log
                  <span
                    className="px-1.5 py-0.5 rounded text-[10px] font-bold"
                    style={{ background: "rgba(59,130,246,0.1)", color: FELIX_COLOR }}
                  >
                    {cronLogs.length}
                  </span>
                </h3>
                {showCronLogs ? (
                  <ChevronUp size={16} className="text-gray-500" />
                ) : (
                  <ChevronDown size={16} className="text-gray-500" />
                )}
              </button>

              {showCronLogs && (
                <div
                  className="mt-4 rounded-xl p-3 font-mono text-xs max-h-64 overflow-y-auto custom-scrollbar"
                  style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.04)" }}
                >
                  {cronLogs.length === 0 ? (
                    <p className="text-gray-600 text-center py-4">No log entries yet.</p>
                  ) : (
                    cronLogs.map((entry, i) => (
                      <div
                        key={i}
                        className="flex items-start gap-2 py-1 border-b border-white/5 last:border-0"
                      >
                        <span className="text-gray-600 shrink-0">{formatTime(entry.time)}</span>
                        <span style={{ color: logTypeColor(entry.type) }}>{entry.message}</span>
                      </div>
                    ))
                  )}
                  <div ref={cronLogEndRef} />
                </div>
              )}
            </div>
          </div>
        )}

        {/* ──────────────────── LOGS TAB ──────────────────── */}
        {activeTab === "logs" && (
          <div className="animate-fade-in">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h1 className="text-2xl font-extrabold tracking-tight text-white mb-1">
                  Conversation{" "}
                  <span className="bg-clip-text text-transparent" style={{ backgroundImage: FELIX_GRADIENT }}>
                    Logs
                  </span>
                </h1>
                <p className="text-sm" style={{ color: "#5a5e72" }}>
                  All Facebook Messenger conversations handled by Felix.
                </p>
              </div>
              <button
                onClick={fetchLogs}
                disabled={logsLoading}
                className="flex items-center gap-2 text-sm px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 font-medium transition-all border border-white/10 cursor-pointer disabled:opacity-50"
              >
                <RefreshCw size={14} className={logsLoading ? "animate-spin" : ""} />
                Refresh
              </button>
            </div>

            {logsLoading && (
              <div className="flex flex-col items-center justify-center py-20">
                <RefreshCw size={32} className="animate-spin mb-4" style={{ color: FELIX_COLOR }} />
                <p className="text-gray-400 text-sm">Loading conversation logs...</p>
              </div>
            )}

            {!logsLoading && convLogs.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20">
                <div
                  className="w-20 h-20 rounded-2xl flex items-center justify-center mb-4"
                  style={{
                    background: "rgba(59,130,246,0.06)",
                    border: "1px solid rgba(59,130,246,0.12)",
                  }}
                >
                  <MessageSquare size={36} style={{ color: FELIX_COLOR }} />
                </div>
                <p className="text-gray-300 text-base font-semibold mb-1">No logs yet</p>
                <p className="text-gray-500 text-sm">
                  Conversations will appear here after Felix processes messages.
                </p>
              </div>
            )}

            <div className="grid gap-4">
              {convLogs.map((log) => (
                <div
                  key={log._id}
                  className="rounded-2xl border transition-all overflow-hidden"
                  style={{
                    background: "rgba(0,0,0,0.3)",
                    borderColor: "rgba(255,255,255,0.06)",
                  }}
                >
                  <button
                    onClick={() => setExpandedLog(expandedLog === log._id ? null : log._id)}
                    className="w-full flex items-center justify-between p-5 text-left cursor-pointer hover:bg-white/2 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-white shrink-0 shadow-lg"
                        style={{ background: FELIX_GRADIENT }}
                      >
                        {(log.senderName || "?").charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-gray-100">{log.senderName || "Unknown"}</h3>
                        <p className="text-xs text-gray-500">
                          {Math.min(log.messages?.length || 0, 10)} messages &middot;{" "}
                          {log.lastActivity ? formatTime(log.lastActivity) : "—"}
                        </p>
                        {log.messages && log.messages.length > 0 && expandedLog !== log._id && (
                          <p className="text-[11px] mt-1.5 truncate max-w-sm" style={{ color: "#475569" }}>
                            {log.messages[log.messages.length - 1].text}
                          </p>
                        )}
                      </div>
                    </div>
                    {expandedLog === log._id ? (
                      <ChevronUp size={16} className="text-gray-500" />
                    ) : (
                      <ChevronDown size={16} className="text-gray-500" />
                    )}
                  </button>

                  {expandedLog === log._id && (
                    <div
                      className="px-5 pb-5 space-y-2 border-t"
                      style={{ borderColor: "rgba(255,255,255,0.05)" }}
                    >
                      {(log.messages || []).slice(-10).map((m, i) => (
                        <div key={i} className="flex gap-3 pt-3">
                          <div
                            className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black shrink-0 mt-0.5"
                            style={{
                              background:
                                m.role === "felix"
                                  ? "rgba(59,130,246,0.15)"
                                  : "rgba(255,255,255,0.06)",
                              color: m.role === "felix" ? FELIX_COLOR : "#9ca3af",
                            }}
                          >
                            {m.role === "felix" ? "F" : "U"}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span
                                className="text-[10px] font-bold uppercase"
                                style={{ color: m.role === "felix" ? FELIX_COLOR : "#6b7280" }}
                              >
                                {m.role === "felix" ? "Felix" : log.senderName || "User"}
                              </span>
                              <span className="text-[10px] text-gray-600">{formatTime(m.timestamp)}</span>
                            </div>
                            <p className="text-sm text-gray-300 leading-relaxed">{m.text}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === "knowledge-base" && (
          <div className="animate-fade-in" style={{ maxWidth: 760 }}>
            <div className="mb-6">
              <h1 className="text-2xl font-extrabold tracking-tight text-white mb-1">
                Knowledge{" "}
                <span className="bg-clip-text text-transparent" style={{ backgroundImage: FELIX_GRADIENT }}>
                  Base
                </span>
              </h1>
              <p className="text-sm" style={{ color: "#5a5e72" }}>
                Manage company policies, FAQs, and guidelines Felix uses to answer customer queries.
              </p>
            </div>
            <KnowledgeBasePanel botId="felix" accentColor={FELIX_COLOR} />
          </div>
        )}

        {activeTab === "escalation" && (
          <div className="animate-fade-in" style={{ maxWidth: 760 }}>
            <div className="mb-6">
              <h1 className="text-2xl font-extrabold tracking-tight text-white mb-1">
                Human{" "}
                <span className="bg-clip-text text-transparent" style={{ backgroundImage: FELIX_GRADIENT }}>
                  Escalations
                </span>
              </h1>
              <p className="text-sm" style={{ color: "#5a5e72" }}>
                Conversations Felix could not handle — requires your attention.
              </p>
            </div>
            <EscalationPanel botId="felix" accentColor={FELIX_COLOR} />
          </div>
        )}

        {activeTab === "follow-ups" && (
          <div className="animate-fade-in" style={{ maxWidth: 860 }}>
            <div className="mb-6">
              <h1 className="text-2xl font-extrabold tracking-tight text-white mb-1">
                Automated{" "}
                <span className="bg-clip-text text-transparent" style={{ backgroundImage: FELIX_GRADIENT }}>
                  Follow-Ups
                </span>
              </h1>
              <p className="text-sm" style={{ color: "#5a5e72" }}>
                Track unanswered messages and auto-send follow-ups at scheduled intervals.
              </p>
            </div>
            <FollowUpManager botName="felix" accentColor={FELIX_COLOR} />
          </div>
        )}
      </main>

      {/* ══ Confirm Modals ══ */}
      <ConfirmModal
        isOpen={showClearSessionConfirm}
        onClose={() => setShowClearSessionConfirm(false)}
        onConfirm={clearFbSession}
        title="Disconnect Facebook"
        message="Are you sure you want to disconnect your Facebook account? This will permanently remove your session cookies and authentication tokens. Auto-reply will stop working immediately."
        color="#ef4444"
      />

      <ConfirmModal
        isOpen={showClearLogsConfirm}
        onClose={() => setShowClearLogsConfirm(false)}
        onConfirm={clearCronLogs}
        title="Clear Activity Logs"
        message="Are you sure you want to clear all auto-reply logs? This will permanently remove the history shown in the logs panel. New activity will still be logged."
        color="#34d399"
      />

      <ConfirmModal
        isOpen={showResetConfirm}
        onClose={() => setShowResetConfirm(false)}
        onConfirm={resetProcessed}
        title="Reset Reply Counters"
        message="Are you sure you want to reset the processed message cache? Felix will treat previously replied-to messages as new if they appear in the inbox again."
        color="#34d399"
      />
    </div>
  );
}
