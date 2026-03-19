"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  MessageSquare,
  Zap,
  RefreshCw,
  CheckCircle2,
  Copy,
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
  Trash2,
  RotateCcw,
  Facebook,
  Save,
  Key,
  History,
} from "lucide-react";

import { BotSwitcher } from "@/components/BotSwitcher";

interface FbMessage {
  threadId: string;
  messageText: string;
  senderName: string;
  senderId: string;
  timestamp: number;
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
  threadId: string;
  sentAt: string;
  sent: boolean;
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

const FELIX_GRADIENT = "linear-gradient(135deg, #3b82f6, #1d4ed8, #60a5fa)";
const FELIX_COLOR = "#3b82f6";

type TabId = "auto-reply" | "logs";

export default function FelixPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>("auto-reply");
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

  // ── Cron status polling ──
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

  // ── Fetch conversation logs ──
  const fetchLogs = useCallback(async () => {
    setLogsLoading(true);
    try {
      const res = await fetch("/api/felix");
      const data = await res.json();
      if (res.ok && data.success) {
        setConvLogs(data.logs || []);
      }
    } catch {
      /* silent */
    } finally {
      setLogsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!checking && activeTab === "logs") fetchLogs();
  }, [checking, activeTab, fetchLogs]);

  // ── Toggle cron ──
  const toggleCron = async () => {
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

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    showToast("Copied to clipboard!", "success");
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

  const formatRelative = (ts: number) => {
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  const logTypeColor = (type: CronLogEntry["type"]) => {
    switch (type) {
      case "success": return "#34d399";
      case "error": return "#f87171";
      case "warning": return "#fbbf24";
      default: return "#94a3b8";
    }
  };

  if (checking) return null;

  const tabs: { id: TabId; label: string; icon: React.ReactNode; count?: number }[] = [
    { id: "auto-reply", label: "Auto-Reply Tracker", icon: <Bot size={15} /> },
    { id: "logs", label: "Conversation Logs", icon: <History size={15} />, count: convLogs.length },
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
                className="flex items-center justify-center rounded-lg shadow-lg"
                style={{ width: 32, height: 32, background: FELIX_GRADIENT }}
              >
                <Facebook size={16} stroke="white" />
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
            {/* Cron Status Pill */}
            <button
              onClick={toggleCron}
              disabled={cronLoading}
              id="cron-toggle-btn"
              className="flex items-center gap-2.5 text-sm px-4 py-2 rounded-xl font-semibold transition-all cursor-pointer border disabled:opacity-60"
              style={{
                background: cronRunning ? "rgba(239,68,68,0.08)" : "rgba(59,130,246,0.1)",
                borderColor: cronRunning ? "rgba(239,68,68,0.2)" : "rgba(59,130,246,0.3)",
                color: cronRunning ? "#ef4444" : FELIX_COLOR,
              }}
              title={cronRunning ? "Click to stop auto-reply cron" : "Click to start auto-reply cron (every 60s)"}
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

            <div style={{ width: 1, height: 20, background: "rgba(255,255,255,0.08)" }} />

            <div className="flex items-center gap-2 text-xs text-gray-500">
              <Clock size={12} />
              <span>{cronLastRun ? formatTime(cronLastRun) : "Never"}</span>
            </div>
          </div>
        </div>
      </header>

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
                background: activeTab === tab.id ? "rgba(59,130,246,0.12)" : "transparent",
                color: activeTab === tab.id ? FELIX_COLOR : "rgba(255,255,255,0.4)",
                border: activeTab === tab.id ? "1px solid rgba(59,130,246,0.25)" : "1px solid transparent",
              }}
            >
              {tab.icon}
              {tab.label}
              {tab.count !== undefined && tab.count > 0 && (
                <span
                  className="ml-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold"
                  style={{
                    background: activeTab === tab.id ? "rgba(59,130,246,0.2)" : "rgba(255,255,255,0.06)",
                    color: activeTab === tab.id ? FELIX_COLOR : "rgba(255,255,255,0.4)",
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

        {/* ─────────────────── AUTO-REPLY TAB ─────────────────── */}
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
                      {cronRunning ? "Cron is Active" : "Cron is Off"}
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
                    <><Square size={16} /> Stop Cron</>
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

              {/* Actions */}
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

            {/* System Prompt Customization */}
            <div
              className="p-6 rounded-2xl border mb-6"
              style={{
                background: "rgba(0,0,0,0.2)",
                borderColor: "rgba(255,255,255,0.06)",
              }}
            >
              <h3 className="text-sm font-bold text-gray-300 mb-3 flex items-center gap-2">
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
                id="system-prompt-input"
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

            {/* Cron Logs */}
            <div
              className="p-6 rounded-2xl border mb-6"
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
                  Cron Activity Log
                  <span
                    className="px-1.5 py-0.5 rounded text-[10px] font-bold"
                    style={{ background: "rgba(59,130,246,0.1)", color: FELIX_COLOR }}
                  >
                    {cronLogs.length}
                  </span>
                </h3>
                {showCronLogs ? <ChevronUp size={16} className="text-gray-500" /> : <ChevronDown size={16} className="text-gray-500" />}
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
                      <div key={i} className="flex items-start gap-2 py-1 border-b border-white/5 last:border-0">
                        <span className="text-gray-600 shrink-0">{formatTime(entry.time)}</span>
                        <span style={{ color: logTypeColor(entry.type) }}>{entry.message}</span>
                      </div>
                    ))
                  )}
                  <div ref={cronLogEndRef} />
                </div>
              )}
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
                <Zap size={14} style={{ color: FELIX_COLOR }} />
                How Auto-Reply Works
              </h3>
              <div className="space-y-3">
                {[
                  {
                    step: "1",
                    title: "Authenticate",
                    desc: "Felix uses your c_user and xs browser cookies to maintain an active Facebook session.",
                  },
                  {
                    step: "2",
                    title: "Fetch Inbox",
                    desc: "Every 60 seconds, Felix calls Facebook's internal GraphQL API to fetch unread Messenger threads.",
                  },
                  {
                    step: "3",
                    title: "Generate AI Reply",
                    desc: "OpenAI generates a professional, warm, and brief reply using your customized system prompt.",
                  },
                  {
                    step: "4",
                    title: "Send & Log",
                    desc: "The reply is sent via Facebook's internal API and the conversation is logged to MongoDB.",
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
                        background: "rgba(59,130,246,0.12)",
                        color: FELIX_COLOR,
                        border: "1px solid rgba(59,130,246,0.2)",
                      }}
                    >
                      {item.step}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-200">{item.title}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ─────────────────── LOGS TAB ─────────────────── */}
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
                id="refresh-logs-btn"
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
                <p className="text-gray-500 text-sm">Conversations will appear here after Felix processes messages.</p>
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
                    className="w-full flex items-center justify-between p-5 text-left cursor-pointer hover:bg-white/[0.02] transition-colors"
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
                          {log.messages?.length || 0} messages &middot;{" "}
                          {log.lastActivity ? formatTime(log.lastActivity) : "—"}
                        </p>
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
                      {(log.messages || []).map((m, i) => (
                        <div
                          key={i}
                          className="flex gap-3 pt-3"
                        >
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
      </main>
    </div>
  );
}
