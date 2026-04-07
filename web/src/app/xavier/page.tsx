"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Sparkles,
  Rocket,
  Globe,
  Shield,
  Activity,
  Users,
  Twitter,
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
  Save,
  Key,
  History,
  LogOut,
  ShieldCheck,
  ShieldAlert,
  ShieldOff,
  TrendingUp,
  Heart,
  UserPlus,
  MessageCircle,
  Hash,
  Settings,
  BarChart2,
  Eye,
  User,
  Repeat2,
  Search,
  BookOpen,
  Send,
  Info,
} from "lucide-react";
import { BotSwitcher } from "@/components/BotSwitcher";
import { KnowledgeBasePanel } from "@/components/KnowledgeBasePanel";
import { EscalationPanel } from "@/components/EscalationPanel";
import { FollowUpManager } from "@/components/FollowUpManager";
import { ConfirmModal } from "@/components/ConfirmModal";

// ── Theme ─────────────────────────────────────────────────────────────────────
const X_COLOR = "#1d9bf0";
const X_GRADIENT = "linear-gradient(135deg, #1d9bf0 0%, #0a6fa8 100%)";

// ── Types ─────────────────────────────────────────────────────────────────────
type TabId = "auth" | "dm-reply" | "growth" | "read" | "logs" | "knowledge-base" | "escalation" | "follow-ups";

interface CronLogEntry {
  time: string;
  message: string;
  type: "info" | "success" | "error" | "warning";
}

interface TwSession {
  exists: boolean;
  username?: string;
  twid?: string;
  passcode?: string;
  savedAt?: string;
  status?: "active" | "expired";
}

interface GrowthSettings {
  targetKeywords: string[];
  targetHashtags: string[];
  targetProfiles: string[];
  dailyFollowLimit: number;
  dailyLikeLimit: number;
  dailyRetweetLimit: number;
  dailyReplyLimit: number;
  replyPrompt: string;
  enableLike: boolean;
  enableFollow: boolean;
  enableRetweet: boolean;
  enableReply: boolean;
}

interface MetricsData {
  today: Record<string, number>;
  totals: Record<string, number>;
  byDay: Record<string, Record<string, number>>;
  recentLogs: any[];
  failedLast24h: number;
}

interface Tweet {
  tweetId: string;
  username: string;
  displayName: string;
  text: string;
  tweetUrl: string;
  likes: number;
  retweets: number;
  replies: number;
  timestamp: string;
  scrapedAt: string;
  sourceQuery?: string;
}

interface ConversationLog {
  _id: string;
  conversationId: string;
  senderUsername: string;
  lastActivity: string;
  createdAt: string;
  messages: {
    role: string;
    text: string;
    timestamp: string;
    source: string;
  }[];
}

// ── Log color helper ──────────────────────────────────────────────────────────
function logColor(type: CronLogEntry["type"]) {
  switch (type) {
    case "success": return "#22c55e";
    case "error":   return "#ef4444";
    case "warning": return "#f59e0b";
    default:        return "#94a3b8";
  }
}

// ── Main component ────────────────────────────────────────────────────────────
export default function XavierPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [dataFetching, setDataFetching] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>("auth");
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  // Auth state
  const [twSession, setTwSession] = useState<TwSession>({ exists: false });
  const [rawCookies, setRawCookies] = useState("");
  const [manualAuthToken, setManualAuthToken] = useState("");
  const [manualCt0, setManualCt0] = useState("");
  const [manualUsername, setManualUsername] = useState("");
  const [manualPasscode, setManualPasscode] = useState("");
  const [authMode, setAuthMode] = useState<"raw" | "manual">("raw");
  const [savingSession, setSavingSession] = useState(false);

  // DM inbox state
  const [dmRunning, setDmRunning] = useState(false);
  const [dmLastRun, setDmLastRun] = useState<string | null>(null);
  const [dmLogs, setDmLogs] = useState<CronLogEntry[]>([]);
  const [dmSystemPrompt, setDmSystemPrompt] = useState(
    "You are a professional Twitter/X assistant. Reply warmly, concisely, and professionally to Twitter DMs on behalf of the user. Keep replies under 3 sentences. Be friendly and authentic."
  );
  const [editingDmPrompt, setEditingDmPrompt] = useState(false);
  const [dmLogsExpanded, setDmLogsExpanded] = useState(true);
  const [convLogs, setConvLogs] = useState<ConversationLog[]>([]);
  const [selectedConv, setSelectedConv] = useState<ConversationLog | null>(null);

  // Growth cron state
  const [growRunning, setGrowRunning] = useState(false);
  const [growLastRun, setGrowLastRun] = useState<string | null>(null);
  const [growLogs, setGrowLogs] = useState<CronLogEntry[]>([]);
  const [growLogsExpanded, setGrowLogsExpanded] = useState(true);
  const [nextActionMode, setNextActionMode] = useState<string>("like");
  const [dailyCounts, setDailyCounts] = useState<Record<string, number>>({});
  const [savingSettings, setSavingSettings] = useState(false);

  const [growSettings, setGrowSettings] = useState<GrowthSettings>({
    targetKeywords: ["startup", "entrepreneur", "tech"],
    targetHashtags: ["SaaS", "buildinpublic", "marketing"],
    targetProfiles: [],
    dailyFollowLimit: 30,
    dailyLikeLimit: 50,
    dailyRetweetLimit: 20,
    dailyReplyLimit: 15,
    replyPrompt:
      "Write a short, genuine, relevant 1-2 sentence reply (no hashtags, no self-promotion) for a tweet about the topic provided. Be specific, insightful, and professional.",
    enableLike: true,
    enableFollow: true,
    enableRetweet: true,
    enableReply: true,
  });

  const [keywordInput, setKeywordInput] = useState("");
  const [hashtagInput, setHashtagInput] = useState("");
  const [profileInput, setProfileInput] = useState("");

  // Read tweets state
  const [readQuery, setReadQuery] = useState("");
  const [readType, setReadType] = useState<"keyword" | "hashtag" | "profile">("keyword");
  const [readLoading, setReadLoading] = useState(false);
  const [tweets, setTweets] = useState<Tweet[]>([]);
  const [savedTweets, setSavedTweets] = useState<Tweet[]>([]);
  const [readTab, setReadTab] = useState<"search" | "saved">("search");

  // Metrics state
  const [metrics, setMetrics] = useState<MetricsData | null>(null);
  const [loadingMetrics, setLoadingMetrics] = useState(false);

  // Modals
  const [showClearSessionConfirm, setShowClearSessionConfirm] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const showToast = (message: string, type: "success" | "error") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const fmtTime = (iso: string | null) => {
    if (!iso) return "—";
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch {
      return iso;
    }
  };

  // ── Auth check ──────────────────────────────────────────────────────────────
  useEffect(() => {
    fetch("/api/auth")
      .then((r) => r.json())
      .then((d) => {
        if (!d.authenticated) router.push("/");
        else setChecking(false);
      })
      .catch(() => router.push("/"));
  }, [router]);

  // ── Load session ────────────────────────────────────────────────────────────
  const loadSession = useCallback(async () => {
    try {
      const res = await fetch("/api/xavier");
      const data = await res.json();
      if (data.session) setTwSession(data.session);
      if (data.logs) setConvLogs(data.logs);
      if (data.settings) {
        setGrowSettings((prev) => ({
          ...prev,
          targetKeywords: data.settings.targetKeywords ?? prev.targetKeywords,
          targetHashtags: data.settings.targetHashtags ?? prev.targetHashtags,
          targetProfiles: data.settings.targetProfiles ?? prev.targetProfiles,
          dailyFollowLimit: data.settings.dailyFollowLimit ?? prev.dailyFollowLimit,
          dailyLikeLimit: data.settings.dailyLikeLimit ?? prev.dailyLikeLimit,
          dailyRetweetLimit: data.settings.dailyRetweetLimit ?? prev.dailyRetweetLimit,
          dailyReplyLimit: data.settings.dailyReplyLimit ?? prev.dailyReplyLimit,
          replyPrompt: data.settings.replyPrompt ?? prev.replyPrompt,
          enableLike: data.settings.enableLike ?? prev.enableLike,
          enableFollow: data.settings.enableFollow ?? prev.enableFollow,
          enableRetweet: data.settings.enableRetweet ?? prev.enableRetweet,
          enableReply: data.settings.enableReply ?? prev.enableReply,
        }));
        if (data.settings.dmSystemPrompt) {
          setDmSystemPrompt(data.settings.dmSystemPrompt);
        }
      }
      if (data.todayStats) setDailyCounts(data.todayStats);
    } catch {}
  }, []);

  // ── Poll cron status ────────────────────────────────────────────────────────
  const pollGrowCron = useCallback(async () => {
    try {
      const res = await fetch("/api/xavier/grow/cron");
      const data = await res.json();
      setGrowRunning(data.running ?? false);
      setGrowLastRun(data.lastRun ?? null);
      setGrowLogs(data.logs ?? []);
      if (data.dailyCounts) setDailyCounts(data.dailyCounts);
      if (data.nextActionMode) setNextActionMode(data.nextActionMode);
    } catch {}
  }, []);

  const pollInboxCron = useCallback(async () => {
    try {
      const res = await fetch("/api/xavier/inbox/cron");
      const data = await res.json();
      setDmRunning(data.running ?? false);
      setDmLastRun(data.lastRun ?? null);
      setDmLogs(data.logs ?? []);
      if (data.dmSystemPrompt) setDmSystemPrompt(data.dmSystemPrompt);
    } catch {}
  }, []);

  useEffect(() => {
    if (checking) return;
    Promise.all([loadSession(), pollGrowCron(), pollInboxCron()]).finally(() => setDataFetching(false));

    pollRef.current = setInterval(() => {
      pollGrowCron();
      pollInboxCron();
    }, 30000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [checking, loadSession, pollGrowCron, pollInboxCron]);

  // ── Load metrics ────────────────────────────────────────────────────────────
  const loadMetrics = useCallback(async () => {
    setLoadingMetrics(true);
    try {
      const res = await fetch("/api/xavier/metrics");
      const data = await res.json();
      if (data.success) setMetrics(data);
    } finally {
      setLoadingMetrics(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === "logs" && !checking) loadMetrics();
  }, [activeTab, checking, loadMetrics]);

  // ── Load saved tweets when read tab opens ───────────────────────────────────
  useEffect(() => {
    if (activeTab === "read" && !checking) {
      fetch("/api/xavier/read?limit=50")
        .then((r) => r.json())
        .then((d) => { if (d.tweets) setSavedTweets(d.tweets); })
        .catch(() => {});
    }
  }, [activeTab, checking]);

  // ── Auth actions ────────────────────────────────────────────────────────────
  const saveSession = async () => {
    if (authMode === "raw" && !rawCookies.trim()) {
      showToast("Paste your Twitter cookies first.", "error");
      return;
    }
    if (authMode === "manual" && (!manualAuthToken.trim() || !manualCt0.trim())) {
      showToast("auth_token and ct0 are required.", "error");
      return;
    }
    setSavingSession(true);
    try {
      const body =
        authMode === "raw"
          ? { rawCookies: rawCookies.trim(), username: manualUsername.trim() || undefined }
          : {
              auth_token: manualAuthToken.trim(),
              ct0: manualCt0.trim(),
              username: manualUsername.trim() || undefined,
              passcode: manualPasscode.trim() || undefined,
            };

      const res = await fetch("/api/xavier", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) {
        showToast("Twitter session saved.", "success");
        setRawCookies("");
        setManualAuthToken("");
        setManualCt0("");
        setManualPasscode("");
        loadSession();
      } else {
        showToast(data.error || "Failed to save session.", "error");
      }
    } finally {
      setSavingSession(false);
    }
  };

  const clearSession = async () => {
    await fetch("/api/xavier", { method: "DELETE" });
    showToast("Twitter session cleared.", "success");
    setTwSession({ exists: false });
  };

  // ── Growth actions ──────────────────────────────────────────────────────────
  const toggleGrowCron = async () => {
    if (!growRunning && twSession.status === "expired") {
      showToast("Twitter/X session is expired. Please re-authenticate first.", "error");
      return;
    }
    const action = growRunning ? "stop" : "start";
    const res = await fetch("/api/xavier/grow/cron", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const data = await res.json();
    if (data.error) showToast(data.error, "error");
    else { showToast(data.message, "success"); pollGrowCron(); }
  };

  const saveGrowSettings = async () => {
    setSavingSettings(true);
    try {
      const res = await fetch("/api/xavier", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(growSettings),
      });
      const data = await res.json();
      if (data.success) showToast("Settings saved.", "success");
      else showToast(data.error || "Save failed.", "error");
    } finally {
      setSavingSettings(false);
    }
  };

  // ── DM actions ──────────────────────────────────────────────────────────────
  const toggleDmCron = async () => {
    if (!dmRunning && twSession.status === "expired") {
      showToast("Twitter/X session is expired. Please re-authenticate first.", "error");
      return;
    }
    const action = dmRunning ? "stop" : "start";
    const res = await fetch("/api/xavier/inbox/cron", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const data = await res.json();
    if (data.error) showToast(data.error, "error");
    else { showToast(data.message, "success"); pollInboxCron(); }
  };

  const saveDmPrompt = async () => {
    const res = await fetch("/api/xavier/inbox/cron", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "save_prompt", prompt: dmSystemPrompt }),
    });
    const data = await res.json();
    if (data.success) { showToast("DM prompt saved.", "success"); setEditingDmPrompt(false); }
    else showToast(data.error || "Save failed.", "error");
  };

  // ── Read tweets ─────────────────────────────────────────────────────────────
  const searchTweets = async () => {
    if (!readQuery.trim()) { showToast("Enter a search query.", "error"); return; }
    setReadLoading(true);
    try {
      const res = await fetch("/api/xavier/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: readQuery.trim(), type: readType, limit: 15 }),
      });
      const data = await res.json();
      if (data.success) {
        setTweets(data.tweets);
        if (data.tweets.length === 0) showToast("No tweets found.", "error");
        else showToast(`Found ${data.count} tweets`, "success");
      } else {
        showToast(data.error || "Search failed.", "error");
      }
    } finally {
      setReadLoading(false);
    }
  };

  // ── Tag management helpers ──────────────────────────────────────────────────
  const addItem = (
    field: keyof GrowthSettings,
    value: string,
    setter: (v: string) => void
  ) => {
    const trimmed = value.trim().replace(/^[@#]/, "");
    if (!trimmed) return;
    setGrowSettings((prev) => ({
      ...prev,
      [field]: [...(prev[field] as string[]).filter((v: string) => v !== trimmed), trimmed],
    }));
    setter("");
  };

  const removeItem = (field: keyof GrowthSettings, value: string) => {
    setGrowSettings((prev) => ({
      ...prev,
      [field]: (prev[field] as string[]).filter((v: string) => v !== value),
    }));
  };

  // ── Tab definitions ───────────────────────────────────────────────────────
  const tabs: { id: TabId; label: string; icon: React.ElementType }[] = [
    { id: "auth",     label: "Twitter Auth",   icon: Key },
    { id: "dm-reply", label: "DM Auto-Reply",  icon: MessageCircle },
    { id: "growth",   label: "Growth Engine",  icon: TrendingUp },
    { id: "read",     label: "Discovery Feed", icon: BookOpen },
    { id: "logs",           label: "Analytics",     icon: BarChart2 },
    { id: "knowledge-base", label: "Knowledge Base", icon: BookOpen },
    { id: "escalation",     label: "Escalations",    icon: AlertCircle },
    { id: "follow-ups",     label: "Follow-Ups",     icon: Clock },
  ];

  if (checking || dataFetching) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#080910" }}>
        <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: `${X_COLOR} transparent` }} />
      </div>
    );
  }

  const sessionIcon = !twSession.exists
    ? <ShieldOff size={14} color="#ef4444" />
    : twSession.status === "expired"
    ? <ShieldAlert size={14} color="#f59e0b" />
    : <ShieldCheck size={14} color="#22c55e" />;

  const sessionLabel = !twSession.exists
    ? "No session"
    : twSession.status === "expired"
    ? "Session expired"
    : `@${twSession.username ?? "connected"}`;

  return (
    <div className="relative min-h-screen" style={{ background: "#080910" }}>
      <div className="bg-mesh" />

      {/* Toast */}
      {toast && (
        <div
          className="fixed bottom-6 right-6 z-50 animate-fade-in flex items-center gap-3 px-5 py-3 rounded-xl border text-sm font-semibold shadow-2xl"
          style={{
            background: toast.type === "success" ? "rgba(29,155,240,0.1)" : "rgba(239,68,68,0.1)",
            color: toast.type === "success" ? X_COLOR : "#ef4444",
            borderColor: toast.type === "success" ? "rgba(29,155,240,0.2)" : "rgba(239,68,68,0.2)",
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
                style={{ width: 32, height: 32, background: X_GRADIENT }}
              >
                <Twitter size={16} stroke="white" />
              </div>
              <div>
                <p className="text-sm font-bold" style={{ color: "#e5e7eb", lineHeight: 1.2 }}>
                  Xavier
                </p>
                <p className="text-[11px]" style={{ color: "#4b5268" }}>
                  Twitter Growth Bot
                </p>
              </div>
            </div>

            <div style={{ width: 1, height: 24, background: "rgba(255,255,255,0.08)", margin: "0 4px" }} />
            <BotSwitcher currentBotId="xavier" />
          </div>

          <div className="flex items-center gap-3">
            {/* Session pill */}
            <div
              className={`hidden sm:flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg border ${
                !twSession.exists ? "opacity-50" : ""
              }`}
              style={{
                background: !twSession.exists ? "rgba(107,114,128,0.08)" : twSession.status === "expired" ? "rgba(239,68,68,0.08)" : "rgba(34,197,94,0.08)",
                borderColor: !twSession.exists ? "rgba(107,114,128,0.2)" : twSession.status === "expired" ? "rgba(239,68,68,0.2)" : "rgba(34,197,94,0.2)",
                color: !twSession.exists ? "#6b7280" : twSession.status === "expired" ? "#f87171" : "#34d399",
              }}
            >
              {!twSession.exists ? <ShieldOff size={14} /> : twSession.status === "expired" ? <ShieldAlert size={14} /> : <ShieldCheck size={14} />}
              <span className="font-semibold">
                {!twSession.exists ? "Not Connected" : twSession.username ? `@${twSession.username}` : "Connected"}
              </span>
            </div>

            <div style={{ width: 1, height: 20, background: "rgba(255,255,255,0.08)" }} />

            {/* Cron toggle (dynamic based on tab) */}
            <button
              onClick={activeTab === "growth" ? toggleGrowCron : toggleDmCron}
              disabled={!twSession.exists}
              className="flex items-center gap-2.5 text-sm px-4 py-2.5 rounded-xl font-bold transition-all cursor-pointer border disabled:opacity-50 active:scale-95 shadow-sm whitespace-nowrap"
              style={{
                background: (activeTab === "growth" ? growRunning : dmRunning) ? "rgba(239,68,68,0.1)" : "rgba(29,155,240,0.1)",
                borderColor: (activeTab === "growth" ? growRunning : dmRunning) ? "rgba(239,68,68,0.2)" : "rgba(29,155,240,0.2)",
                color: (activeTab === "growth" ? growRunning : dmRunning) ? "#ef4444" : X_COLOR,
              }}
            >
              {(activeTab === "growth" ? growRunning : dmRunning) ? <Square size={14} /> : <Play size={14} />}
              <span>
                {activeTab === "growth" 
                  ? (growRunning ? "Stop Growth" : "Start Growth") 
                  : (dmRunning ? "Stop DMs" : "Start DMs")}
              </span>
            </button>

            <div className="flex items-center gap-2 text-xs text-gray-500">
              <Clock size={12} />
              <span>
                {(activeTab === "growth" ? growLastRun : dmLastRun) 
                  ? new Date((activeTab === "growth" ? growLastRun : dmLastRun) || "").toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) 
                  : "Never"}
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
              onClick={() => setActiveTab(tab.id)}
              className="flex items-center gap-2.5 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all cursor-pointer whitespace-nowrap shrink-0 group active:scale-95 hover:bg-white/[0.04]"
              style={{
                background: activeTab === tab.id ? "rgba(29,155,240,0.1)" : "transparent",
                color: activeTab === tab.id ? X_COLOR : "rgba(255,255,255,0.5)",
                border: activeTab === tab.id ? "1px solid rgba(29,155,240,0.2)" : "1px solid transparent",
              }}
            >
              <tab.icon 
                size={16} 
                className={`transition-colors ${activeTab === tab.id ? "text-[#1d9bf0]" : "text-gray-500 group-hover:text-gray-300"}`} 
              />
              {tab.label}
              {tab.id === "dm-reply" && convLogs.length > 0 && (
                <span className="ml-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold transition-colors" style={{ 
                  background: activeTab === tab.id ? "rgba(29,155,240,0.2)" : "rgba(255,255,255,0.08)",
                  color: activeTab === tab.id ? X_COLOR : "rgba(255,255,255,0.6)"
                }}>
                  {convLogs.length}
                </span>
              )}
              {tab.id === "auth" && !twSession.exists && (
                <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0 shadow-[0_0_8px_rgba(251,191,36,0.4)]" />
              )}
            </button>
          ))}
        </div>
      </div>

      <main className="relative z-10 mx-auto max-w-7xl px-6 py-6">


        {/* ── AUTH TAB ──────────────────────────────────────────────────── */}
        {activeTab === "auth" && (
          <div className="animate-fade-in max-w-2xl mx-auto space-y-6">
            <div className="mb-8">
              <h1 className="text-2xl font-extrabold tracking-tight text-white mb-2">
                Twitter{" "}
                <span className="bg-clip-text text-transparent" style={{ backgroundImage: X_GRADIENT }}>
                  Authentication
                </span>
              </h1>
              <p className="text-sm" style={{ color: "#5a5e72" }}>
                Xavier needs your Twitter session cookies to automate growth and replies.
                Credentials are stored securely and persist across sessions.
              </p>
            </div>

            {twSession.exists && (
              <div
                className="p-5 rounded-2xl border flex items-center justify-between"
                style={{ background: twSession.status === "expired" ? "rgba(239,68,68,0.05)" : "rgba(16,185,129,0.05)", borderColor: twSession.status === "expired" ? "rgba(239,68,68,0.2)" : "rgba(16,185,129,0.2)" }}
              >
                <div className="flex items-center gap-3">
                  {twSession.status === "expired" ? (
                    <ShieldAlert size={20} style={{ color: "#ef4444" }} />
                  ) : (
                    <ShieldCheck size={20} style={{ color: "#10b981" }} />
                  )}
                  <div>
                    <p className="font-bold text-white">{twSession.status === "expired" ? "Session Expired" : "Session Active"}</p>
                    <p className="text-xs" style={{ color: "#64748b" }}>
                      {twSession.username ? `@${twSession.username}` : `User ID: ${twSession.twid}`} ·{" "}
                      Saved {twSession.savedAt ? new Date(twSession.savedAt).toLocaleDateString() : "recently"}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setShowClearSessionConfirm(true)}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all cursor-pointer"
                  style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444" }}
                >
                  <LogOut size={14} /> Clear Session
                </button>
              </div>
            )}

            <div
              className="p-6 rounded-2xl border space-y-5"
              style={{ background: "rgba(0,0,0,0.3)", borderColor: "rgba(255,255,255,0.06)" }}
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-white mb-1">
                    {twSession.exists ? "Update Cookies" : "Connect Your Account"}
                  </h3>
                  <p className="text-xs mb-5" style={{ color: "#5a5e72" }}>
                    {twSession.exists 
                      ? "Choose either JSON (recommended) or Manual input to refresh your session."
                      : "Connect your Twitter account using either JSON (from Cookie-Editor) or manual entry below."}
                  </p>
                </div>
                <div className="flex gap-2 p-1 rounded-xl bg-white/5 border border-white/5">
                  {(["raw", "manual"] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setAuthMode(mode)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                        authMode === mode 
                          ? "bg-white/10 text-white shadow-sm" 
                          : "text-gray-500 hover:text-gray-400"
                      }`}
                    >
                      {mode === "raw" ? "JSON" : "Manual"}
                    </button>
                  ))}
                </div>
              </div>

              {authMode === "raw" ? (
                <div>
                  <label className="block text-xs font-semibold mb-2" style={{ color: "#94a3b8" }}>
                    Cookie-Editor JSON Blob <span style={{ color: "#ef4444" }}>*</span>
                  </label>
                  <textarea
                    value={rawCookies}
                    onChange={(e) => setRawCookies(e.target.value)}
                    placeholder='[{"name":"auth_token","value":"..."},{"name":"ct0","value":"..."}]'
                    rows={4}
                    className="w-full px-4 py-3 rounded-xl text-sm text-white placeholder-gray-600 outline-none border transition-all font-mono resize-none"
                    style={{ background: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.1)" }}
                  />
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4">
                  {[
                    { label: "auth_token", value: manualAuthToken, setter: setManualAuthToken, placeholder: "f4048915..." },
                    { label: "ct0", value: manualCt0, setter: setManualCt0, placeholder: "32fabd48..." },
                  ].map(({ label, value, setter, placeholder }) => (
                    <div key={label}>
                       <label className="block text-xs font-semibold mb-2" style={{ color: "#94a3b8" }}>{label}</label>
                       <input
                        type="text"
                        value={value}
                        onChange={(e) => setter(e.target.value)}
                        placeholder={placeholder}
                        className="w-full px-4 py-2.5 rounded-xl text-sm text-white placeholder-gray-600 outline-none border transition-all font-mono"
                        style={{ background: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.1)" }}
                      />
                    </div>
                  ))}
                </div>
              )}

              <div className="space-y-4 pt-2">
                <div>
                  <label className="block text-xs font-semibold mb-2" style={{ color: "#94a3b8" }}>Username (optional)</label>
                  <input
                    type="text"
                    value={manualUsername}
                    onChange={(e) => setManualUsername(e.target.value)}
                    placeholder="@yourhandle"
                    className="w-full px-4 py-2.5 rounded-xl text-sm text-white placeholder-gray-600 outline-none border transition-all"
                    style={{ background: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.1)" }}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-2" style={{ color: "#94a3b8" }}>Passcode (backup/2FA)</label>
                  <input
                    type="password"
                    value={manualPasscode}
                    onChange={(e) => setManualPasscode(e.target.value)}
                    placeholder="Your 2FA or backup code"
                    className="w-full px-4 py-2.5 rounded-xl text-sm text-white placeholder-gray-600 outline-none border transition-all"
                    style={{ background: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.1)" }}
                  />
                </div>
              </div>

              <button
                onClick={saveSession}
                disabled={savingSession}
                className="flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-bold transition-all cursor-pointer disabled:opacity-40 mt-1"
                style={{ background: X_GRADIENT, color: "white" }}
              >
                {savingSession ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
                {savingSession ? "Saving..." : "Save Session"}
              </button>
            </div>

            {/* How-to guide */}
            <div
              className="p-5 rounded-2xl border"
              style={{ background: "rgba(29,155,240,0.04)", borderColor: "rgba(29,155,240,0.12)" }}
            >
              <h3 className="text-sm font-bold mb-3" style={{ color: X_COLOR }}>
                How to get your Twitter cookies
              </h3>
              <ol className="space-y-2 text-sm" style={{ color: "#94a3b8" }}>
                <li>1. Log in to x.com in Chrome</li>
                <li>2. Press F12 to open DevTools or use Cookie-Editor extension</li>
                <li>3. If using extension, click Export → JSON</li>
                <li>4. If manual, go to Application → Storage → Cookies → https://x.com</li>
                <li>5. Find and copy: <code className="text-blue-400">auth_token</code> and <code className="text-blue-400">ct0</code></li>
                <li>6. Paste them above to authenticate</li>
              </ol>
            </div>
          </div>
        )}

        {/* ── READ TAB ─────────────────────────────────────────────────── */}
        {activeTab === "read" && (
          <div className="animate-fade-in max-w-4xl mx-auto space-y-6">
            <div className="mb-8">
              <h1 className="text-2xl font-extrabold tracking-tight text-white mb-2">
                Discovery{" "}
                <span className="bg-clip-text text-transparent" style={{ backgroundImage: X_GRADIENT }}>
                  Feed
                </span>
              </h1>
              <p className="text-sm" style={{ color: "#5a5e72" }}>
                Search for tweets and profiles to interact with. Use filters to find high-performing content.
              </p>
            </div>

            {/* Search card */}
            <div
              className="p-6 rounded-2xl border space-y-5"
              style={{ background: "rgba(0,0,0,0.3)", borderColor: "rgba(255,255,255,0.06)" }}
            >
              <div className="flex items-center gap-2 mb-1">
                <Search size={16} style={{ color: X_COLOR }} />
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">Twitter Search</h3>
              </div>

              <div className="flex flex-col md:flex-row gap-4">
                <div className="flex p-1.5 rounded-xl bg-white/5 w-fit border border-white/5">
                  {(["keyword", "hashtag", "profile"] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setReadType(t)}
                      className={`px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                        readType === t 
                          ? "bg-white/10 text-white shadow-sm" 
                          : "text-gray-500 hover:text-gray-400"
                      }`}
                    >
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </button>
                  ))}
                </div>

                <div className="flex-1 flex gap-2">
                  <input
                    type="text"
                    value={readQuery}
                    onChange={(e) => setReadQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && searchTweets()}
                    placeholder={
                      readType === "hashtag" ? "Search hashtag (without #)" :
                      readType === "profile" ? "Search user (without @)" :
                      "Search for keywords..."
                    }
                    className="flex-1 px-4 py-2.5 rounded-xl text-sm text-white placeholder-gray-600 outline-none border transition-all"
                    style={{ background: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.1)" }}
                  />
                  <button
                    onClick={searchTweets}
                    disabled={readLoading}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all cursor-pointer disabled:opacity-40"
                    style={{ background: X_GRADIENT, color: "white" }}
                  >
                    {readLoading ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />}
                    {readLoading ? "Searching..." : "Search"}
                  </button>
                </div>
              </div>
            </div>

            {/* Content view toggle */}
            <div className="flex justify-between items-center bg-white/5 p-1 rounded-xl w-fit border border-white/5">
              {[["search", "Results"], ["saved", "Saved Tweets"]].map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setReadTab(id as "search" | "saved")}
                  className={`px-5 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    readTab === id 
                      ? "bg-white/10 text-white shadow-sm" 
                      : "text-gray-500 hover:text-gray-400"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* List */}
            {(readTab === "search" ? tweets : savedTweets).length === 0 ? (
              <div 
                className="p-16 rounded-2xl border border-dashed flex flex-col items-center justify-center text-center space-y-4"
                style={{ background: "rgba(255,255,255,0.02)", borderColor: "rgba(255,255,255,0.08)" }}
              >
                 <div className="w-12 h-12 rounded-full mb-2 flex items-center justify-center" style={{ background: "rgba(255,255,255,0.05)" }}>
                    <Twitter size={24} style={{ color: "#334155" }} />
                 </div>
                 <div>
                    <p className="text-sm font-semibold text-white">No results to show</p>
                    <p className="text-xs mt-1" style={{ color: "#64748b" }}>
                        {readTab === "search" 
                          ? "Run a search to discover content in your target niche." 
                          : "You haven't saved any tweets yet."}
                    </p>
                 </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {(readTab === "search" ? tweets : savedTweets).map((tweet) => (
                  <div
                    key={tweet.tweetId}
                    className="p-5 rounded-2xl border hover:border-white/10 transition-all flex flex-col justify-between"
                    style={{ background: "rgba(0,0,0,0.3)", borderColor: "rgba(255,255,255,0.06)" }}
                  >
                    <div>
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-10 h-10 rounded-full bg-white/5 border border-white/5 flex items-center justify-center shrink-0">
                            <User size={18} className="text-gray-500" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-white truncate">{tweet.displayName}</p>
                            <p className="text-xs text-gray-500 truncate">@{tweet.username}</p>
                          </div>
                        </div>
                        <a
                          href={tweet.tweetUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="p-2 rounded-lg bg-white/5 transition-all cursor-pointer text-gray-500 hover:text-white"
                        >
                          <Twitter size={14} />
                        </a>
                      </div>
                      <p className="text-sm text-gray-300 leading-relaxed mb-4 line-clamp-4">
                        {tweet.text}
                      </p>
                    </div>
                    
                    <div className="flex items-center justify-between pt-4 border-t border-white/5">
                      <div className="flex items-center gap-4">
                        <div className="flex items-center gap-1.5 text-xs text-gray-500">
                          <Heart size={12} className="text-rose-500" /> {tweet.likes}
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-gray-500">
                          <Repeat2 size={12} className="text-blue-500" /> {tweet.retweets}
                        </div>
                      </div>
                      {/* Interaction or Save button could go here */}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── GROWTH TAB ───────────────────────────────────────────────── */}
        {activeTab === "growth" && (
          <div className="animate-fade-in max-w-3xl mx-auto space-y-6">
            <div className="mb-8">
              <h1 className="text-2xl font-extrabold tracking-tight text-white mb-2">
                Growth{" "}
                <span className="bg-clip-text text-transparent" style={{ backgroundImage: X_GRADIENT }}>
                  Automation
                </span>
              </h1>
              <p className="text-sm" style={{ color: "#5a5e72" }}>
                Automate follows, likes, retweets, and replies based on keywords and hashtags to organically
                grow your Twitter presence.
              </p>
            </div>

            {/* Growth status */}
            <div
              className="p-6 rounded-2xl border"
              style={{
                background: growRunning ? "rgba(29,155,240,0.04)" : "rgba(0,0,0,0.3)",
                borderColor: growRunning ? "rgba(29,155,240,0.2)" : "rgba(255,255,255,0.06)",
              }}
            >
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center"
                    style={{ background: growRunning ? "rgba(29,155,240,0.15)" : "rgba(255,255,255,0.05)" }}
                  >
                    <TrendingUp size={20} style={{ color: growRunning ? X_COLOR : "#64748b" }} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="font-bold text-white">Growth Engine</h2>
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full font-extrabold uppercase tracking-tighter" style={{ background: "rgba(34,197,94,0.15)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.2)" }}>
                        Stable Mode
                      </span>
                    </div>
                    <p className="text-xs" style={{ color: "#64748b" }}>
                      {growRunning
                        ? "Actively growing — engaging with targets"
                        : "Stopped — start to begin growth rotation"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {growRunning && (
                    <div
                      className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border"
                      style={{
                        background:
                          nextActionMode === "reply" ? "rgba(168,85,247,0.1)" :
                          nextActionMode === "retweet" ? "rgba(29,155,240,0.1)" :
                          nextActionMode === "follow" ? "rgba(16,185,129,0.1)" :
                          "rgba(244,63,94,0.1)",
                        borderColor:
                          nextActionMode === "reply" ? "rgba(168,85,247,0.25)" :
                          nextActionMode === "retweet" ? "rgba(29,155,240,0.25)" :
                          nextActionMode === "follow" ? "rgba(16,185,129,0.25)" :
                          "rgba(244,63,94,0.25)",
                        color:
                          nextActionMode === "reply" ? "#a855f7" :
                          nextActionMode === "retweet" ? "#1d9bf0" :
                          nextActionMode === "follow" ? "#10b981" :
                          "#f43f5e",
                      }}
                    >
                      {nextActionMode === "reply" ? <MessageCircle size={11} /> :
                       nextActionMode === "retweet" ? <Repeat2 size={11} /> :
                       nextActionMode === "follow" ? <UserPlus size={11} /> :
                       <Heart size={11} />}
                      Next: {nextActionMode}
                    </div>
                  )}
                  <button
                    onClick={toggleGrowCron}
                    disabled={!twSession.exists}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all cursor-pointer disabled:opacity-40"
                    style={{
                      background: growRunning ? "rgba(239,68,68,0.15)" : "rgba(29,155,240,0.15)",
                      color: growRunning ? "#ef4444" : X_COLOR,
                      border: `1px solid ${growRunning ? "rgba(239,68,68,0.3)" : "rgba(29,155,240,0.3)"}`,
                    }}
                  >
                    {growRunning ? <Square size={14} /> : <Zap size={14} />}
                    {growRunning ? "Stop Growth" : "Start Growth"}
                  </button>
                </div>
              </div>

              {/* Today's stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { key: "reply", label: "Replies", icon: MessageCircle, color: "#a855f7", limit: growSettings.dailyReplyLimit, enabled: growSettings.enableReply },
                  { key: "retweet", label: "Retweets", icon: Repeat2, color: X_COLOR, limit: growSettings.dailyRetweetLimit, enabled: growSettings.enableRetweet },
                  { key: "follow", label: "Follows", icon: UserPlus, color: "#10b981", limit: growSettings.dailyFollowLimit, enabled: growSettings.enableFollow },
                  { key: "like", label: "Likes", icon: Heart, color: "#f43f5e", limit: growSettings.dailyLikeLimit, enabled: growSettings.enableLike },
                ].map((stat) => {
                  const count = dailyCounts[stat.key] ?? 0;
                  const limitReached = count >= stat.limit;
                  return (
                    <div
                      key={stat.key}
                      className="p-4 rounded-xl"
                      style={{
                        background: limitReached ? `${stat.color}11` : "rgba(255,255,255,0.03)",
                        border: limitReached ? `1px solid ${stat.color}44` : "1px solid transparent",
                        opacity: stat.enabled ? 1 : 0.45,
                      }}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-1.5 opacity-80">
                          <stat.icon size={12} style={{ color: stat.color }} />
                          <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{stat.label}</p>
                        </div>
                        {limitReached && (
                          <span
                            className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                            style={{ background: `${stat.color}22`, color: stat.color }}
                          >
                            DONE
                          </span>
                        )}
                        {!stat.enabled && (
                          <span
                            className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                            style={{ background: "rgba(255,255,255,0.06)", color: "#475569" }}
                          >
                            OFF
                          </span>
                        )}
                      </div>
                      <p className="text-2xl font-bold text-white">{count}</p>
                      <p className="text-[11px] mt-1 text-gray-500">of {stat.limit} limit</p>
                      <div className="mt-2 h-1 rounded-full" style={{ background: "rgba(255,255,255,0.08)" }}>
                        <div
                          className="h-1 rounded-full transition-all"
                          style={{
                            background: stat.color,
                            width: `${Math.min(100, (count / stat.limit) * 100)}%`,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              {growLastRun && (
                <p className="text-xs mt-3" style={{ color: "#475569" }}>
                  <Clock size={11} className="inline mr-1" />
                  Last run: {new Date(growLastRun).toLocaleTimeString()}
                </p>
              )}
            </div>

            {/* Settings */}
            <div
              className="p-6 rounded-2xl border space-y-5"
              style={{ background: "rgba(0,0,0,0.3)", borderColor: "rgba(255,255,255,0.06)" }}
            >
              <h3 className="font-bold text-white flex items-center gap-2">
                <Settings size={15} style={{ color: X_COLOR }} /> Growth Settings
              </h3>

              {/* Target Hashtags */}
              <div>
                <label className="block text-xs font-semibold mb-2" style={{ color: "#94a3b8" }}>
                  Target Hashtags
                </label>
                <div className="flex flex-wrap gap-2 mb-3">
                  {growSettings.targetHashtags.map((tag) => (
                    <span
                      key={tag}
                      className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-sm font-medium"
                      style={{ background: "rgba(168,85,247,0.1)", color: "#a855f7" }}
                    >
                      <Hash size={11} />
                      {tag}
                      <button
                        onClick={() => removeItem("targetHashtags", tag)}
                        className="ml-1 hover:text-white transition-colors cursor-pointer"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  {growSettings.targetHashtags.length === 0 && (
                    <span className="text-xs" style={{ color: "#334155" }}>No hashtags added</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={hashtagInput}
                    onChange={(e) => setHashtagInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addItem("targetHashtags", hashtagInput, setHashtagInput)}
                    placeholder="Add hashtag (without #)"
                    className="flex-1 px-4 py-2 rounded-xl text-sm text-white placeholder-gray-600 outline-none border transition-all"
                    style={{ background: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.1)" }}
                  />
                  <button
                    onClick={() => addItem("targetHashtags", hashtagInput, setHashtagInput)}
                    className="px-4 py-2 rounded-xl text-sm font-semibold cursor-pointer"
                    style={{ background: "rgba(168,85,247,0.15)", color: "#a855f7" }}
                  >
                    Add
                  </button>
                </div>
              </div>

              {/* Target Keywords */}
              <div>
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <label className="text-xs font-semibold" style={{ color: "#94a3b8" }}>
                    Target Keywords <span style={{ color: "#334155", fontWeight: 400 }}>(optional)</span>
                  </label>
                  {/* Action scope badges */}
                  <span className="flex items-center gap-1 flex-wrap">
                    <span
                      className="text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1"
                      style={{ background: "rgba(168,85,247,0.12)", color: "#a855f7" }}
                    >
                      <MessageCircle size={9} /> Reply only
                    </span>
                    <span
                      className="text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1"
                      style={{ background: "rgba(255,255,255,0.04)", color: "#334155" }}
                      title="Keywords do not filter likes"
                    >
                      <Heart size={9} /> Like — all tweets
                    </span>
                    <span
                      className="text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1"
                      style={{ background: "rgba(255,255,255,0.04)", color: "#334155" }}
                      title="Keywords do not filter follows"
                    >
                      <UserPlus size={9} /> Follow — all tweets
                    </span>
                    <span
                      className="text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1"
                      style={{ background: "rgba(255,255,255,0.04)", color: "#334155" }}
                      title="Keywords do not filter retweets"
                    >
                      <Repeat2 size={9} /> Retweet — all tweets
                    </span>
                  </span>
                </div>
                <p className="text-xs mb-3" style={{ color: "#475569" }}>
                  Only leave a <span style={{ color: "#a855f7" }}>Reply</span> on tweets whose content matches a keyword (so AI writes relevant replies).{" "}
                  <span style={{ color: "#475569" }}>Likes, follows, and retweets engage with all found tweets regardless of keywords.</span>
                </p>
                <div className="flex flex-wrap gap-2 mb-3">
                  {growSettings.targetKeywords.map((kw) => (
                    <span
                      key={kw}
                      className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-sm font-medium"
                      style={{ background: "rgba(168,85,247,0.1)", color: "#a855f7" }}
                    >
                      {kw}
                      <button
                        onClick={() => removeItem("targetKeywords", kw)}
                        className="ml-1 hover:text-white transition-colors cursor-pointer"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  {growSettings.targetKeywords.length === 0 && (
                    <span className="text-xs" style={{ color: "#334155" }}>No filter — replies on all found tweets</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={keywordInput}
                    onChange={(e) => setKeywordInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addItem("targetKeywords", keywordInput, setKeywordInput)}
                    placeholder="e.g. startup, growth, web3"
                    className="flex-1 px-4 py-2 rounded-xl text-sm text-white placeholder-gray-600 outline-none border transition-all"
                    style={{ background: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.1)" }}
                  />
                  <button
                    onClick={() => addItem("targetKeywords", keywordInput, setKeywordInput)}
                    className="px-4 py-2 rounded-xl text-sm font-semibold cursor-pointer"
                    style={{ background: "rgba(168,85,247,0.15)", color: "#a855f7" }}
                  >
                    Add
                  </button>
                </div>
              </div>

              {/* Target Profiles (by account) */}
              <div>
                <label className="block text-xs font-semibold mb-1" style={{ color: "#94a3b8" }}>
                  Target Profiles
                </label>
                <p className="text-xs mb-3" style={{ color: "#475569" }}>
                  Browse tweets directly from these accounts (e.g. competitor or niche influencer pages). All actions apply.
                </p>
                <div className="flex flex-wrap gap-2 mb-3">
                  {growSettings.targetProfiles.map((p) => (
                    <span
                      key={p}
                      className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-sm font-medium"
                      style={{ background: "rgba(59,130,246,0.12)", color: "#60a5fa" }}
                    >
                      <User size={11} />
                      @{p}
                      <button
                        onClick={() => removeItem("targetProfiles", p)}
                        className="ml-1 hover:text-white transition-colors cursor-pointer"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  {growSettings.targetProfiles.length === 0 && (
                    <span className="text-xs" style={{ color: "#334155" }}>No profiles added</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={profileInput}
                    onChange={(e) => setProfileInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addItem("targetProfiles", profileInput, setProfileInput)}
                    placeholder="Add username (without @)"
                    className="flex-1 px-4 py-2 rounded-xl text-sm text-white placeholder-gray-600 outline-none border transition-all"
                    style={{ background: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.1)" }}
                  />
                  <button
                    onClick={() => addItem("targetProfiles", profileInput, setProfileInput)}
                    className="px-4 py-2 rounded-xl text-sm font-semibold cursor-pointer"
                    style={{ background: "rgba(59,130,246,0.15)", color: "#60a5fa" }}
                  >
                    Add
                  </button>
                </div>
              </div>

              {/* Action toggles */}
              <div>
                <label className="block text-xs font-semibold mb-3" style={{ color: "#94a3b8" }}>
                  Actions Enabled
                </label>
                <div className="flex flex-wrap gap-3">
                  {[
                    { key: "enableLike" as const, label: "Likes", color: "#f43f5e" },
                    { key: "enableFollow" as const, label: "Follows", color: "#10b981" },
                    { key: "enableRetweet" as const, label: "Retweets", color: X_COLOR },
                    { key: "enableReply" as const, label: "Replies", color: "#a855f7" },
                  ].map(({ key, label, color }) => (
                    <button
                      key={key}
                      onClick={() => setGrowSettings((s) => ({ ...s, [key]: !s[key] }))}
                      className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border transition-all cursor-pointer"
                      style={{
                        background: growSettings[key] ? `${color}22` : "rgba(255,255,255,0.03)",
                        borderColor: growSettings[key] ? color : "rgba(255,255,255,0.1)",
                        color: growSettings[key] ? color : "#64748b",
                      }}
                    >
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{ background: growSettings[key] ? color : "#334155" }}
                      />
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Daily limits */}
              <div>
                <label className="block text-xs font-semibold mb-3" style={{ color: "#94a3b8" }}>
                  Daily Limits
                </label>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {[
                    { key: "dailyLikeLimit" as const, label: "Likes" },
                    { key: "dailyFollowLimit" as const, label: "Follows" },
                    { key: "dailyRetweetLimit" as const, label: "Retweets" },
                    { key: "dailyReplyLimit" as const, label: "Replies" },
                  ].map((field) => (
                    <div key={field.key}>
                      <label className="block text-[10px] uppercase font-bold text-gray-500 mb-2">
                        {field.label}
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={growSettings[field.key]}
                        onChange={(e) =>
                          setGrowSettings((s) => ({ ...s, [field.key]: Number(e.target.value) }))
                        }
                        className="w-full px-3 py-2 rounded-xl text-sm text-white outline-none border transition-all"
                        style={{ background: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.1)" }}
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Comment prompt */}
              <div>
                <label className="block text-xs font-semibold mb-2" style={{ color: "#94a3b8" }}>
                  AI Reply Generation Prompt
                </label>
                <textarea
                  value={growSettings.replyPrompt}
                  onChange={(e) => setGrowSettings((s) => ({ ...s, replyPrompt: e.target.value }))}
                  rows={3}
                  className="w-full px-4 py-3 rounded-xl text-sm text-white outline-none border transition-all resize-none"
                  style={{ background: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.1)", fontFamily: "inherit" }}
                />
              </div>

              <button
                onClick={saveGrowSettings}
                disabled={savingSettings}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all cursor-pointer disabled:opacity-40 mt-1"
                style={{ background: X_GRADIENT, color: "white" }}
              >
                {savingSettings ? <RefreshCw size={13} className="animate-spin" /> : <Save size={13} />}
                {savingSettings ? "Saving..." : "Save Settings"}
              </button>
            </div>

            {/* Growth Logs */}
            <div
              className="rounded-2xl border overflow-hidden"
              style={{ borderColor: "rgba(255,255,255,0.06)" }}
            >
              <div
                onClick={() => setGrowLogsExpanded(!growLogsExpanded)}
                className="w-full flex items-center justify-between px-5 py-4 transition-all cursor-pointer"
                style={{ background: "rgba(255,255,255,0.03)" }}
                role="button"
                tabIndex={0}
              >
              <span className="flex items-center gap-2 font-semibold text-sm text-white">
                  <Terminal size={14} style={{ color: X_COLOR }} /> Execution Logs ({growLogs.length})
                </span>
                <div className="flex items-center gap-2">
                  {growLogs.length > 0 && (
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        await fetch("/api/xavier/grow/cron", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ action: "clear_logs" }),
                        });
                        setGrowLogs([]);
                      }}
                      className="flex items-center justify-center p-1.5 rounded-lg transition-all cursor-pointer"
                      style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.2)" }}
                      title="Clear all execution logs"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                  {growLogsExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </div>
              </div>

              {growLogsExpanded && (
                <div className="max-h-72 overflow-y-auto p-3 space-y-1" style={{ background: "rgba(0,0,0,0.3)" }}>
                  {growLogs.length === 0 ? (
                    <p className="text-xs text-center py-4" style={{ color: "#475569" }}>No execution logs yet.</p>
                  ) : (
                    [...growLogs].reverse().map((log, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs font-mono">
                        <span style={{ color: "#475569", minWidth: 60 }}>{fmtTime(log.time)}</span>
                        <span style={{ color: logColor(log.type) }}>{log.message}</span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── DM AUTO-REPLY TAB ────────────────────────────────────────── */}
        {activeTab === "dm-reply" && (
          <div className="animate-fade-in max-w-3xl mx-auto space-y-6">
            <div className="mb-8">
              <h1 className="text-2xl font-extrabold tracking-tight text-white mb-2">
                DM{" "}
                <span className="bg-clip-text text-transparent" style={{ backgroundImage: X_GRADIENT }}>
                  Auto-Reply
                </span>
              </h1>
              <p className="text-sm" style={{ color: "#5a5e72" }}>
                When enabled, Xavier checks for new unread DMs every 60 seconds
                and automatically generates &amp; sends professional replies using AI.
              </p>
            </div>

            {/* Status card */}
            <div
              className="p-6 rounded-2xl border mb-6"
              style={{
                background: "rgba(0,0,0,0.3)",
                borderColor: dmRunning ? "rgba(29,155,240,0.2)" : "rgba(255,255,255,0.06)",
              }}
            >
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div
                    className="w-12 h-12 rounded-xl flex items-center justify-center"
                    style={{ 
                      background: dmRunning ? "rgba(29,155,240,0.12)" : "rgba(239,68,68,0.08)",
                      border: `1px solid ${dmRunning ? "rgba(29,155,240,0.25)" : "rgba(239,68,68,0.15)"}`
                    }}
                  >
                    {dmRunning ? (
                      <Zap size={22} style={{ color: X_COLOR }} />
                    ) : (
                      <Power size={22} className="text-red-400" />
                    )}
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white">
                      {dmRunning ? "Cron Active" : "Cron Stopped"}
                    </h3>
                    <p className="text-sm text-gray-500">
                      {dmRunning
                        ? "Checking for new messages every 60 seconds."
                        : "Start the cron to enable automatic replies."}
                    </p>
                  </div>
                </div>
                <button
                  onClick={toggleDmCron}
                  disabled={!twSession.exists}
                  className="px-6 py-3 rounded-xl font-bold text-sm transition-all cursor-pointer disabled:opacity-50 flex items-center gap-2 border"
                  style={{
                    background: dmRunning ? "rgba(239,68,68,0.08)" : "rgba(29,155,240,0.1)",
                    borderColor: dmRunning ? "rgba(239,68,68,0.2)" : "rgba(29,155,240,0.3)",
                    color: dmRunning ? "#ef4444" : X_COLOR,
                  }}
                >
                  {dmRunning ? (
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
                  <p className="text-2xl font-black text-white">{convLogs.length}</p>
                  <p className="text-xs text-gray-500 mt-1">Total Threads</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-black text-white">60s</p>
                  <p className="text-xs text-gray-500 mt-1">Check Interval</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-black text-white">
                    {dmLastRun ? fmtTime(dmLastRun) : "—"}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">Last Check</p>
                </div>
              </div>

              {!twSession.exists && (
                <p className="text-xs mt-4 text-center" style={{ color: "#f59e0b" }}>
                  Set up your Twitter session first to enable the auto-reply engine.
                </p>
              )}
            </div>

            {/* System Prompt */}
            <div
              className="p-6 rounded-2xl border"
              style={{ background: "rgba(0,0,0,0.3)", borderColor: "rgba(255,255,255,0.06)" }}
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-white flex items-center gap-2">
                  <Bot size={16} style={{ color: X_COLOR }} /> AI System Prompt
                </h3>
                <button
                  onClick={() => setEditingDmPrompt(!editingDmPrompt)}
                  className="text-xs px-3 py-1.5 rounded-lg transition-all cursor-pointer"
                  style={{ background: "rgba(29,155,240,0.1)", color: X_COLOR }}
                >
                  {editingDmPrompt ? "Cancel" : "Edit"}
                </button>
              </div>

              {editingDmPrompt ? (
                <div className="space-y-3">
                  <textarea
                    value={dmSystemPrompt}
                    onChange={(e) => setDmSystemPrompt(e.target.value)}
                    rows={5}
                    className="w-full px-4 py-3 rounded-xl text-sm text-white outline-none border transition-all resize-none"
                    style={{ background: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.12)", fontFamily: "inherit" }}
                  />
                  <button
                    onClick={saveDmPrompt}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold cursor-pointer"
                    style={{ background: X_GRADIENT, color: "white" }}
                  >
                    <Save size={13} /> Save Prompt
                  </button>
                </div>
              ) : (
                <p className="text-sm leading-relaxed" style={{ color: "#94a3b8" }}>{dmSystemPrompt}</p>
              )}
            </div>

            {/* DM Logs */}
            <div
              className="rounded-2xl border overflow-hidden"
              style={{ borderColor: "rgba(255,255,255,0.06)" }}
            >
              <div
                onClick={() => setDmLogsExpanded(!dmLogsExpanded)}
                className="w-full flex items-center justify-between px-5 py-4 transition-all cursor-pointer"
                style={{ background: "rgba(255,255,255,0.03)" }}
                role="button"
                tabIndex={0}
              >
                <span className="flex items-center gap-2 font-semibold text-sm text-white">
                  <Terminal size={14} style={{ color: X_COLOR }} /> Activity Log ({dmLogs.length})
                </span>
                <div className="flex items-center gap-2">
                  {dmLogs.length > 0 && (
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        await fetch("/api/xavier/inbox/cron", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ action: "clear_logs" }),
                        });
                        setDmLogs([]);
                      }}
                      className="flex items-center justify-center p-1.5 rounded-lg transition-all cursor-pointer"
                      style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.2)" }}
                      title="Clear all activity logs"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                  {dmLogsExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </div>
              </div>

              {dmLogsExpanded && (
                <div className="max-h-64 overflow-y-auto p-3 space-y-1" style={{ background: "rgba(0,0,0,0.3)" }}>
                  {dmLogs.length === 0 ? (
                    <p className="text-xs text-center py-4" style={{ color: "#475569" }}>No logs yet.</p>
                  ) : (
                    [...dmLogs].reverse().map((log, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs font-mono">
                        <span style={{ color: "#475569", minWidth: 60 }}>{fmtTime(log.time)}</span>
                        <span style={{ color: logColor(log.type) }}>{log.message}</span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Conversation Logs */}
            {convLogs.length > 0 && (
              <div
                className="p-5 rounded-2xl border"
                style={{ background: "rgba(0,0,0,0.3)", borderColor: "rgba(255,255,255,0.06)" }}
              >
                <h3 className="font-bold text-white mb-4 flex items-center gap-2">
                  <History size={15} style={{ color: X_COLOR }} /> Conversation History ({convLogs.length})
                </h3>
                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {convLogs.map((conv) => (
                    <button
                      key={conv._id}
                      onClick={() => setSelectedConv(selectedConv?._id === conv._id ? null : conv)}
                      className="w-full text-left p-3 rounded-xl border transition-all cursor-pointer"
                      style={{
                        background: selectedConv?._id === conv._id ? "rgba(29,155,240,0.08)" : "rgba(255,255,255,0.02)",
                        borderColor: selectedConv?._id === conv._id ? "rgba(29,155,240,0.2)" : "rgba(255,255,255,0.06)",
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-sm text-white flex items-center gap-2">
                          <User size={13} /> @{conv.senderUsername}
                        </span>
                        <span className="text-xs" style={{ color: "#475569" }}>
                          {Math.min(conv.messages.length, 10)} msgs
                        </span>
                      </div>
                      {conv.messages.length > 0 && selectedConv?._id !== conv._id && (
                        <p className="text-[11px] mt-1.5 truncate" style={{ color: "#4b5268" }}>
                          {conv.messages[conv.messages.length - 1].text}
                        </p>
                      )}
                      {selectedConv?._id === conv._id && (
                        <div className="mt-3 space-y-2">
                          {conv.messages.slice(-10).map((msg, i) => (
                            <div
                               key={i}
                               className="flex gap-2 text-xs"
                               style={{ justifyContent: msg.role === "xavier" ? "flex-end" : "flex-start" }}
                             >
                               <div
                                 className="max-w-[80%] px-3 py-2 rounded-xl leading-relaxed"
                                 style={{
                                   background: msg.role === "xavier" ? "rgba(29,155,240,0.15)" : "rgba(255,255,255,0.05)",
                                   color: msg.role === "xavier" ? X_COLOR : "#e2e8f0",
                                 }}
                               >
                                 {msg.text}
                               </div>
                             </div>
                           ))}
                         </div>
                       )}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── LOGS TAB ─────────────────────────────────────────────────── */}
        {activeTab === "logs" && (
          <div className="animate-fade-in max-w-5xl mx-auto space-y-6">
            <div className="mb-8 flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-extrabold tracking-tight text-white mb-2">
                  Analytics &{" "}
                  <span className="bg-clip-text text-transparent" style={{ backgroundImage: X_GRADIENT }}>
                    Activity
                  </span>
                </h1>
                <p className="text-sm" style={{ color: "#5a5e72" }}>
                  Monitor Xavier's performance and recent account actions.
                </p>
              </div>
              <button
                onClick={loadMetrics}
                disabled={loadingMetrics}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all disabled:opacity-50 cursor-pointer border"
                style={{
                  background: "rgba(255,255,255,0.05)",
                  borderColor: "rgba(255,255,255,0.1)",
                  color: "#e2e8f0"
                }}
              >
                <RefreshCw size={14} className={loadingMetrics ? "animate-spin" : ""} />
                Refresh
              </button>
            </div>

            {!metrics ? (
              <div 
                className="p-12 rounded-2xl border border-dashed flex flex-col items-center justify-center text-center mt-8"
                style={{ background: "rgba(255,255,255,0.02)", borderColor: "rgba(255,255,255,0.1)" }}
              >
                 <div className="w-12 h-12 rounded-full mb-4 flex items-center justify-center" style={{ background: "rgba(255,255,255,0.05)" }}>
                    <BarChart2 size={20} style={{ color: "#64748b" }} />
                 </div>
                 <p className="text-sm font-semibold text-white">No data available</p>
                 <p className="text-xs mt-1" style={{ color: "#64748b" }}>Wait for the bot to perform actions or run a sync.</p>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Summary cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {[
                    { key: "like", label: "Likes", icon: Heart, color: "#f43f5e" },
                    { key: "follow", label: "Follows", icon: UserPlus, color: "#10b981" },
                    { key: "retweet", label: "Retweets", icon: Repeat2, color: X_COLOR },
                    { key: "reply", label: "Replies", icon: MessageCircle, color: "#a855f7" },
                  ].map(({ key, label, icon: Icon, color }) => (
                    <div
                      key={key}
                      className="p-5 rounded-2xl border relative overflow-hidden"
                      style={{ background: "rgba(0,0,0,0.3)", borderColor: "rgba(255,255,255,0.06)" }}
                    >
                      <div className="absolute -right-4 -bottom-4 pointer-events-none" style={{ opacity: 0.05 }}>
                        <Icon size={72} style={{ color }} />
                      </div>
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${color}15` }}>
                          <Icon size={14} style={{ color }} />
                        </div>
                        <span className="text-xs font-bold text-gray-400">{label}</span>
                      </div>
                      <div>
                        <p className="text-3xl font-black text-white">
                            {metrics.totals[key] ?? 0}
                        </p>
                        <p className="text-[11px] font-semibold mt-1" style={{ color: `${color}99` }}>
                           +{metrics.today[key] ?? 0} today
                        </p>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Health Warning */}
                {(metrics.failedLast24h ?? 0) > 0 && (
                  <div 
                    className="p-4 rounded-xl border flex items-center gap-4 bg-rose-500/10 border-rose-500/20"
                  >
                    <div className="w-10 h-10 rounded-xl bg-rose-500/20 flex items-center justify-center shrink-0">
                        <ShieldAlert size={20} className="text-rose-400" />
                    </div>
                    <div>
                        <h4 className="text-sm font-bold text-rose-300">Action Failures Detected</h4>
                        <p className="text-xs text-rose-400/80">{metrics.failedLast24h} actions failed recently. Check connection status.</p>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Activity Feed */}
                    <div 
                        className="rounded-2xl border"
                        style={{ background: "rgba(0,0,0,0.3)", borderColor: "rgba(255,255,255,0.06)" }}
                    >
                        <div className="px-5 py-4 border-b border-white/5 flex items-center gap-2">
                            <History size={15} style={{ color: "#94a3b8" }} />
                            <h3 className="text-sm font-bold text-white">Recent Activity</h3>
                        </div>
                        <div className="p-2 overflow-y-auto max-h-[350px] custom-scrollbar">
                            <div className="space-y-1">
                                {!metrics.recentLogs || metrics.recentLogs.length === 0 ? (
                                    <p className="text-xs text-center py-8" style={{ color: "#64748b" }}>No recent activity.</p>
                                ) : (
                                    metrics.recentLogs.slice(0, 50).map((log: any, i: number) => (
                                        <div key={i} className="flex items-start gap-3 p-3 rounded-xl hover:bg-white/5 transition-colors">
                                            <div 
                                                className="w-2 h-2 rounded-full mt-1.5 shrink-0" 
                                                style={{ background: log.status === "success" ? "#10b981" : log.status === "skipped" ? "#f59e0b" : "#ef4444" }} 
                                            />
                                            <div className="flex-1 min-w-0">
                                                <p className="text-xs text-gray-300">
                                                    <span className="font-bold uppercase tracking-wider mr-1.5 text-[10px]" style={{ color: "#94a3b8" }}>
                                                        {log.action}
                                                    </span>
                                                    {log.targetUsername ? `@${log.targetUsername}` : log.targetTweetUrl ?? "System processing"}
                                                </p>
                                                {log.error && <p className="text-[10px] text-rose-400 mt-0.5">{log.error}</p>}
                                                <p className="text-[10px] text-gray-600 mt-1 font-mono">
                                                    {new Date(log.timestamp).toLocaleString()}
                                                </p>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Daily Breakdown */}
                    <div 
                        className="rounded-2xl border"
                        style={{ background: "rgba(0,0,0,0.3)", borderColor: "rgba(255,255,255,0.06)" }}
                    >
                        <div className="px-5 py-4 border-b border-white/5 flex items-center gap-2">
                            <Activity size={15} style={{ color: "#94a3b8" }} />
                            <h3 className="text-sm font-bold text-white">7-Day History</h3>
                        </div>
                        <div className="p-5 overflow-y-auto max-h-[350px] custom-scrollbar space-y-4">
                            {Object.entries(metrics.byDay || {})
                              .sort(([a], [b]) => b.localeCompare(a))
                              .map(([date, actions]: [string, any]) => (
                                <div key={date}>
                                    <p className="text-xs font-bold text-white mb-2">{new Date(date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</p>
                                    <div className="grid grid-cols-4 gap-2">
                                        {['like', 'follow', 'retweet', 'reply'].map(action => (
                                            <div key={action} className="p-2 rounded-lg text-center" style={{ background: "rgba(255,255,255,0.03)" }}>
                                                <p className="text-[10px] uppercase font-bold text-gray-500 mb-1">{action}</p>
                                                <p className="text-sm font-bold text-white">{actions[action] || 0}</p>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
              </div>
            )}
          </div>
        )}
        {activeTab === "knowledge-base" && (
          <div className="animate-fade-in" style={{ maxWidth: 760 }}>
            <div className="mb-6">
              <h1 className="text-2xl font-extrabold tracking-tight text-white mb-1">
                Knowledge{" "}
                <span className="bg-clip-text text-transparent" style={{ backgroundImage: X_GRADIENT }}>
                  Base
                </span>
              </h1>
              <p className="text-sm" style={{ color: "#5a5e72" }}>
                Manage company policies, FAQs, and guidelines Xavier uses to answer DM queries.
              </p>
            </div>
            <KnowledgeBasePanel botId="xavier" accentColor={X_COLOR} />
          </div>
        )}

        {activeTab === "escalation" && (
          <div className="animate-fade-in" style={{ maxWidth: 760 }}>
            <div className="mb-6">
              <h1 className="text-2xl font-extrabold tracking-tight text-white mb-1">
                Human{" "}
                <span className="bg-clip-text text-transparent" style={{ backgroundImage: X_GRADIENT }}>
                  Escalations
                </span>
              </h1>
              <p className="text-sm" style={{ color: "#5a5e72" }}>
                Conversations Xavier could not handle — requires your attention.
              </p>
            </div>
            <EscalationPanel botId="xavier" accentColor={X_COLOR} />
          </div>
        )}

        {activeTab === "follow-ups" && (
          <div className="animate-fade-in" style={{ maxWidth: 860 }}>
            <div className="mb-6">
              <h1 className="text-2xl font-extrabold tracking-tight text-white mb-1">
                Automated{" "}
                <span className="bg-clip-text text-transparent" style={{ backgroundImage: X_GRADIENT }}>
                  Follow-Ups
                </span>
              </h1>
              <p className="text-sm" style={{ color: "#5a5e72" }}>
                Track unanswered DMs and auto-send follow-ups at scheduled intervals.
              </p>
            </div>
            <FollowUpManager botName="xavier" accentColor={X_COLOR} />
          </div>
        )}
      </main>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        * { scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.1) transparent; }
        *::-webkit-scrollbar { width: 6px; }
        *::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 4px; }
        .bg-mesh {
          position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: 0;
          background-image: 
            radial-gradient(at 0% 0%, rgba(29,155,240, 0.08) 0, transparent 50%),
            radial-gradient(at 100% 0%, rgba(168,85,247, 0.08) 0, transparent 50%),
            radial-gradient(at 50% 100%, rgba(16,185,129, 0.05) 0, transparent 50%);
          pointer-events: none;
        }
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.05); border-radius: 10px; }
        .animate-fade-in { animation: fadeIn 0.4s ease-out; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    

      {/* ══ Confirm Modals ══ */}
      <ConfirmModal
        isOpen={showClearSessionConfirm}
        onClose={() => setShowClearSessionConfirm(false)}
        onConfirm={clearSession}
        title="Disconnect Twitter/X"
        message="Are you sure you want to disconnect your Twitter account? This will permanently remove your session cookies and authentication tokens. Growth actions and auto-reply will stop working immediately."
        color="#1d9bf0"
      />
    </div>
  );
}
