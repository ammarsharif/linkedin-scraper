"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Instagram,
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
} from "lucide-react";
import { BotSwitcher } from "@/components/BotSwitcher";

const INSTAR_GRADIENT = "linear-gradient(135deg, #f09433, #e6683c, #dc2743, #cc2366, #bc1888)";
const INSTAR_COLOR = "#e1306c";

type TabId = "ig-auth" | "dm-reply" | "growth" | "content" | "logs";

interface CronLogEntry {
  time: string;
  message: string;
  type: "info" | "success" | "error" | "warning";
}

interface ConversationLog {
  _id: string;
  threadId: string;
  senderUsername: string;
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

interface IgSession {
  exists: boolean;
  username?: string;
  ds_user_id?: string;
  savedAt?: string;
  status?: "active" | "expired";
}

interface GrowthSettings {
  targetHashtags: string[];
  dailyFollowLimit: number;
  dailyLikeLimit: number;
  dailyCommentLimit: number;
  commentPrompt: string;
  autoReplyEnabled: boolean;
}

interface MetricsData {
  today: Record<string, number>;
  totals: Record<string, number>;
  byDay: Record<string, Record<string, number>>;
}

export default function InstarPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>("ig-auth");
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  // Auth state
  const [igSession, setIgSession] = useState<IgSession>({ exists: false });
  const [rawCookies, setRawCookies] = useState("");
  const [username, setUsername] = useState("");
  const [savingSession, setSavingSession] = useState(false);

  // DM cron state
  const [dmRunning, setDmRunning] = useState(false);
  const [dmLastRun, setDmLastRun] = useState<string | null>(null);
  const [dmLogs, setDmLogs] = useState<CronLogEntry[]>([]);
  const [dmSystemPrompt, setDmSystemPrompt] = useState(
    "You are a professional Instagram assistant. Reply briefly, warmly and professionally to Instagram Direct Messages on behalf of the user. Keep replies under 3 sentences. Be friendly and authentic."
  );
  const [editingDmPrompt, setEditingDmPrompt] = useState(false);
  const [dmLogsExpanded, setDmLogsExpanded] = useState(true);
  const [convLogs, setConvLogs] = useState<ConversationLog[]>([]);
  const [selectedConv, setSelectedConv] = useState<ConversationLog | null>(null);
  const [autoAcceptRequests, setAutoAcceptRequests] = useState(true);

  // Growth cron state
  const [growRunning, setGrowRunning] = useState(false);
  const [growLastRun, setGrowLastRun] = useState<string | null>(null);
  const [growLogs, setGrowLogs] = useState<CronLogEntry[]>([]);
  const [growLogsExpanded, setGrowLogsExpanded] = useState(true);
  const [growSettings, setGrowSettings] = useState<GrowthSettings>({
    targetHashtags: ["business", "entrepreneur", "marketing"],
    dailyFollowLimit: 40,
    dailyLikeLimit: 120,
    dailyCommentLimit: 20,
    commentPrompt:
      "Write a short, genuine, relevant 1-sentence comment (no emojis, no hashtags) for an Instagram post about the topic provided. Be specific and insightful.",
    autoReplyEnabled: true,
  });
  const [hashtagInput, setHashtagInput] = useState("");
  const [dailyCounts, setDailyCounts] = useState<Record<string, number>>({});
  const [savingSettings, setSavingSettings] = useState(false);

  // Metrics state
  const [metrics, setMetrics] = useState<MetricsData | null>(null);
  const [loadingMetrics, setLoadingMetrics] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const showToast = (message: string, type: "success" | "error") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  // ── Auth check ──────────────────────────────────────────────────────────
  useEffect(() => {
    fetch("/api/auth")
      .then((r) => r.json())
      .then((d) => {
        if (!d.authenticated) router.push("/");
        else setChecking(false);
      })
      .catch(() => router.push("/"));
  }, [router]);

  // ── Load session + conversation logs ───────────────────────────────────
  const loadSession = useCallback(async () => {
    try {
      const res = await fetch("/api/instar");
      const data = await res.json();
      if (data.session) setIgSession(data.session);
      if (data.logs) setConvLogs(data.logs);
      if (data.settings) {
        setGrowSettings((prev) => ({
          ...prev,
          targetHashtags: data.settings.targetHashtags || prev.targetHashtags,
          dailyFollowLimit: data.settings.dailyFollowLimit ?? prev.dailyFollowLimit,
          dailyLikeLimit: data.settings.dailyLikeLimit ?? prev.dailyLikeLimit,
          dailyCommentLimit: data.settings.dailyCommentLimit ?? prev.dailyCommentLimit,
          commentPrompt: data.settings.commentPrompt || prev.commentPrompt,
          autoReplyEnabled: data.settings.autoReplyEnabled ?? prev.autoReplyEnabled,
        }));
      }
      if (data.todayStats) setDailyCounts(data.todayStats);
    } catch {}
  }, []);

  // ── Poll DM cron status ────────────────────────────────────────────────
  const pollDmCron = useCallback(async () => {
    try {
      const res = await fetch("/api/instar/inbox/cron");
      const data = await res.json();
      setDmRunning(data.running ?? false);
      setDmLastRun(data.lastRun ?? null);
      setDmLogs(data.logs ?? []);
      if (data.autoAcceptRequests !== undefined) setAutoAcceptRequests(data.autoAcceptRequests);
    } catch {}
  }, []);

  // ── Poll Growth cron status ────────────────────────────────────────────
  const pollGrowCron = useCallback(async () => {
    try {
      const res = await fetch("/api/instar/grow/cron");
      const data = await res.json();
      setGrowRunning(data.running ?? false);
      setGrowLastRun(data.lastRun ?? null);
      setGrowLogs(data.logs ?? []);
      if (data.dailyCounts) setDailyCounts(data.dailyCounts);
    } catch {}
  }, []);

  useEffect(() => {
    if (checking) return;
    loadSession();
    pollDmCron();
    pollGrowCron();

    pollRef.current = setInterval(() => {
      pollDmCron();
      pollGrowCron();
    }, 30000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [checking, loadSession, pollDmCron, pollGrowCron]);

  // ── Load metrics ────────────────────────────────────────────────────────
  const loadMetrics = useCallback(async () => {
    setLoadingMetrics(true);
    try {
      const res = await fetch("/api/instar/metrics");
      const data = await res.json();
      if (data.success) setMetrics(data);
    } finally {
      setLoadingMetrics(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === "logs" && !checking) loadMetrics();
  }, [activeTab, checking, loadMetrics]);

  // ── Save Instagram session ─────────────────────────────────────────────
  const saveSession = async () => {
    if (!rawCookies.trim()) {
      showToast("Paste your Instagram cookies first.", "error");
      return;
    }
    setSavingSession(true);
    try {
      const res = await fetch("/api/instar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawCookies: rawCookies.trim(), username: username.trim() || undefined }),
      });
      const data = await res.json();
      if (data.success) {
        showToast("Instagram session saved.", "success");
        setRawCookies("");
        loadSession();
      } else {
        showToast(data.error || "Failed to save session.", "error");
      }
    } finally {
      setSavingSession(false);
    }
  };

  const clearSession = async () => {
    await fetch("/api/instar", { method: "DELETE" });
    showToast("Instagram session cleared.", "success");
    setIgSession({ exists: false });
  };

  // ── DM cron actions ────────────────────────────────────────────────────
  const toggleDmCron = async () => {
    const action = dmRunning ? "stop" : "start";
    const res = await fetch("/api/instar/inbox/cron", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const data = await res.json();
    if (data.error) showToast(data.error, "error");
    else {
      showToast(data.message, "success");
      pollDmCron();
    }
  };

  const saveDmPrompt = async () => {
    const res = await fetch("/api/instar/inbox/cron", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "update_prompt", systemPrompt: dmSystemPrompt }),
    });
    const data = await res.json();
    if (data.success) {
      showToast("DM prompt updated.", "success");
      setEditingDmPrompt(false);
    }
  };

  const clearDmLogs = async () => {
    await fetch("/api/instar/inbox/cron", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "clear_logs" }),
    });
    setDmLogs([]);
    showToast("DM logs cleared.", "success");
  };

  const toggleAutoAccept = async () => {
    const next = !autoAcceptRequests;
    setAutoAcceptRequests(next);
    await fetch("/api/instar/inbox/cron", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "toggle_auto_accept", enabled: next }),
    });
    showToast(`Auto-accept message requests: ${next ? "ON" : "OFF"}`, "success");
  };

  // ── Growth cron actions ────────────────────────────────────────────────
  const toggleGrowCron = async () => {
    const action = growRunning ? "stop" : "start";
    const res = await fetch("/api/instar/grow/cron", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const data = await res.json();
    if (data.error) showToast(data.error, "error");
    else {
      showToast(data.message, "success");
      pollGrowCron();
    }
  };

  const saveGrowSettings = async () => {
    setSavingSettings(true);
    try {
      const res = await fetch("/api/instar/grow/cron", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update_settings", ...growSettings }),
      });
      const data = await res.json();
      if (data.success) showToast("Growth settings saved.", "success");
      else showToast(data.error || "Failed.", "error");
    } finally {
      setSavingSettings(false);
    }
  };

  const addHashtag = () => {
    const tag = hashtagInput.trim().replace(/^#/, "");
    if (tag && !growSettings.targetHashtags.includes(tag)) {
      setGrowSettings((s) => ({ ...s, targetHashtags: [...s.targetHashtags, tag] }));
    }
    setHashtagInput("");
  };

  const removeHashtag = (tag: string) => {
    setGrowSettings((s) => ({
      ...s,
      targetHashtags: s.targetHashtags.filter((t) => t !== tag),
    }));
  };

  const clearGrowLogs = async () => {
    await fetch("/api/instar/grow/cron", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "clear_logs" }),
    });
    setGrowLogs([]);
    showToast("Growth logs cleared.", "success");
  };

  // ── Helpers ─────────────────────────────────────────────────────────────
  const fmtTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    } catch {
      return iso;
    }
  };

  const logColor = (type: CronLogEntry["type"]) => {
    switch (type) {
      case "success": return "#10b981";
      case "error": return "#ef4444";
      case "warning": return "#f59e0b";
      default: return "#94a3b8";
    }
  };

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#080910" }}>
        <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: `${INSTAR_COLOR} transparent` }} />
      </div>
    );
  }

  const TABS: { id: TabId; label: string; icon: React.ElementType }[] = [
    { id: "ig-auth", label: "Instagram Auth", icon: Key },
    { id: "dm-reply", label: "DM Auto-Reply", icon: MessageCircle },
    { id: "growth", label: "Growth Engine", icon: TrendingUp },
    { id: "content", label: "Content Ready", icon: Instagram },
    { id: "logs", label: "Analytics", icon: BarChart2 },
  ];

  return (
    <div className="relative min-h-screen" style={{ background: "#080910" }}>
      <div className="bg-mesh" />

      {/* Toast */}
      {toast && (
        <div
          className="fixed bottom-6 right-6 z-50 animate-fade-in flex items-center gap-3 px-5 py-3 rounded-xl border text-sm font-semibold shadow-2xl"
          style={{
            background: toast.type === "success" ? "rgba(225,48,108,0.1)" : "rgba(239,68,68,0.1)",
            color: toast.type === "success" ? INSTAR_COLOR : "#ef4444",
            borderColor: toast.type === "success" ? "rgba(225,48,108,0.2)" : "rgba(239,68,68,0.2)",
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
                style={{ width: 32, height: 32, background: INSTAR_GRADIENT }}
              >
                <Instagram size={16} stroke="white" />
              </div>
              <div>
                <p className="text-sm font-bold" style={{ color: "#e5e7eb", lineHeight: 1.2 }}>
                  Instar
                </p>
                <p className="text-[11px]" style={{ color: "#4b5268" }}>
                  Instagram Growth Bot
                </p>
              </div>
            </div>

            <div style={{ width: 1, height: 24, background: "rgba(255,255,255,0.08)", margin: "0 4px" }} />
            <BotSwitcher currentBotId="instar" />
          </div>

          <div className="flex items-center gap-3">
            {/* Session pill */}
            <div
              className={`hidden sm:flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg border ${
                !igSession.exists ? "opacity-50" : ""
              }`}
              style={{
                background: !igSession.exists ? "rgba(107,114,128,0.08)" : igSession.status === "expired" ? "rgba(239,68,68,0.08)" : "rgba(16,185,129,0.08)",
                borderColor: !igSession.exists ? "rgba(107,114,128,0.2)" : igSession.status === "expired" ? "rgba(239,68,68,0.2)" : "rgba(16,185,129,0.2)",
                color: !igSession.exists ? "#6b7280" : igSession.status === "expired" ? "#f87171" : "#34d399",
              }}
            >
              {!igSession.exists ? <ShieldOff size={14} /> : igSession.status === "expired" ? <ShieldAlert size={14} /> : <ShieldCheck size={14} />}
              <span className="font-semibold">
                {!igSession.exists ? "Not Connected" : igSession.username ? `@${igSession.username}` : "Connected"}
              </span>
            </div>

            <div style={{ width: 1, height: 20, background: "rgba(255,255,255,0.08)" }} />

            {/* Cron toggle (dynamic based on tab) */}
            <button
              onClick={activeTab === "growth" ? toggleGrowCron : toggleDmCron}
              disabled={!igSession.exists}
              className="flex items-center gap-2.5 text-sm px-4 py-2 rounded-xl font-semibold transition-all cursor-pointer border disabled:opacity-60"
              style={{
                background: (activeTab === "growth" ? growRunning : dmRunning) ? "rgba(239,68,68,0.08)" : "rgba(225,48,108,0.1)",
                borderColor: (activeTab === "growth" ? growRunning : dmRunning) ? "rgba(239,68,68,0.2)" : "rgba(225,48,108,0.3)",
                color: (activeTab === "growth" ? growRunning : dmRunning) ? "#ef4444" : INSTAR_COLOR,
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
                  ? fmtTime((activeTab === "growth" ? growLastRun : dmLastRun) || "") 
                  : "Never"}
              </span>
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
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all cursor-pointer"
              style={{
                background: activeTab === tab.id ? "rgba(225,48,108,0.12)" : "transparent",
                color: activeTab === tab.id ? INSTAR_COLOR : "rgba(255,255,255,0.4)",
                border: activeTab === tab.id ? "1px solid rgba(225,48,108,0.25)" : "1px solid transparent",
              }}
            >
              <tab.icon size={15} />
              {tab.label}
              {tab.id === "ig-auth" && !igSession.exists && (
                <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
              )}
            </button>
          ))}
        </div>
      </div>

      <main className="relative z-10 mx-auto max-w-7xl px-6 py-6">

        {/* ── Instagram Auth Tab ────────────────────────────────────────── */}
        {activeTab === "ig-auth" && (
          <div className="animate-fade-in max-w-2xl mx-auto space-y-6">
            <div className="mb-8">
              <h1 className="text-2xl font-extrabold tracking-tight text-white mb-2">
                Instagram{" "}
                <span className="bg-clip-text text-transparent" style={{ backgroundImage: INSTAR_GRADIENT }}>
                  Authentication
                </span>
              </h1>
              <p className="text-sm" style={{ color: "#5a5e72" }}>
                Instar needs your Instagram session cookies to automate growth and replies.
                Credentials are stored securely and persist across sessions.
              </p>
            </div>

            {igSession.exists && (
              <div
                className="p-5 rounded-2xl border flex items-center justify-between"
                style={{ background: "rgba(16,185,129,0.05)", borderColor: "rgba(16,185,129,0.2)" }}
              >
                <div className="flex items-center gap-3">
                  <ShieldCheck size={20} style={{ color: "#10b981" }} />
                  <div>
                    <p className="font-bold text-white">Session Active</p>
                    <p className="text-xs" style={{ color: "#64748b" }}>
                      {igSession.username ? `@${igSession.username}` : `User ID: ${igSession.ds_user_id}`} ·{" "}
                      Saved {igSession.savedAt ? new Date(igSession.savedAt).toLocaleDateString() : "recently"}
                    </p>
                  </div>
                </div>
                <button
                  onClick={clearSession}
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
              <div>
                <h3 className="text-sm font-bold text-white mb-1">
                  {igSession.exists ? "Update Cookies" : "Connect Your Account"}
                </h3>
                <p className="text-xs mb-5" style={{ color: "#5a5e72" }}>
                  {igSession.exists 
                    ? "Paste fresh Instagram cookies to refresh your session."
                    : "Paste your Instagram cookie string below to authenticate Instar."}
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold mb-2" style={{ color: "#94a3b8" }}>
                  Username (optional)
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="your_instagram_username"
                  className="w-full px-4 py-2.5 rounded-xl text-sm text-white placeholder-gray-600 outline-none border transition-all"
                  style={{ background: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.1)" }}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold mb-2" style={{ color: "#94a3b8" }}>
                  Cookie String <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <textarea
                  value={rawCookies}
                  onChange={(e) => setRawCookies(e.target.value)}
                  placeholder="sessionid=xxx; ds_user_id=yyy; csrftoken=zzz; mid=aaa; ..."
                  rows={4}
                  className="w-full px-4 py-3 rounded-xl text-sm text-white placeholder-gray-600 outline-none border transition-all font-mono resize-none"
                  style={{ background: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.1)" }}
                />
                <p className="text-xs mt-1.5" style={{ color: "#64748b" }}>
                  Required fields in cookies: <code className="text-pink-400">sessionid</code>,{" "}
                  <code className="text-pink-400">ds_user_id</code>,{" "}
                  <code className="text-pink-400">csrftoken</code>
                </p>
              </div>

              <button
                onClick={saveSession}
                disabled={savingSession || !rawCookies.trim()}
                className="flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-bold transition-all cursor-pointer disabled:opacity-40"
                style={{ background: INSTAR_GRADIENT, color: "white" }}
              >
                {savingSession ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
                {savingSession ? "Saving..." : "Save Session"}
              </button>
            </div>

            {/* How-to guide */}
            <div
              className="p-5 rounded-2xl border"
              style={{ background: "rgba(225,48,108,0.04)", borderColor: "rgba(225,48,108,0.12)" }}
            >
              <h3 className="text-sm font-bold mb-3" style={{ color: INSTAR_COLOR }}>
                How to get your Instagram cookies
              </h3>
              <ol className="space-y-2 text-sm" style={{ color: "#94a3b8" }}>
                <li>1. Log in to Instagram at instagram.com in Chrome</li>
                <li>2. Press F12 to open DevTools</li>
                <li>3. Go to Application → Storage → Cookies → https://www.instagram.com</li>
                <li>4. Find and copy: <code className="text-pink-400">sessionid</code>, <code className="text-pink-400">ds_user_id</code>, <code className="text-pink-400">csrftoken</code>, <code className="text-pink-400">mid</code></li>
                <li>5. Paste them above as: <code className="text-pink-300">sessionid=VALUE; ds_user_id=VALUE; csrftoken=VALUE</code></li>
              </ol>
            </div>
          </div>
        )}

        {/* ── DM Auto-Reply Tab ─────────────────────────────────────────── */}
        {activeTab === "dm-reply" && (
          <div className="animate-fade-in max-w-3xl mx-auto space-y-6">
            <div className="mb-8">
              <h1 className="text-2xl font-extrabold tracking-tight text-white mb-2">
                DM{" "}
                <span className="bg-clip-text text-transparent" style={{ backgroundImage: INSTAR_GRADIENT }}>
                  Auto-Reply
                </span>
              </h1>
              <p className="text-sm" style={{ color: "#5a5e72" }}>
                When enabled, Instar checks for new unread DMs every 60 seconds
                and automatically generates &amp; sends professional replies using AI.
              </p>
            </div>

            {/* Status card */}
            <div
              className="p-6 rounded-2xl border"
              style={{
                background: dmRunning ? "rgba(16,185,129,0.05)" : "rgba(0,0,0,0.3)",
                borderColor: dmRunning ? "rgba(16,185,129,0.2)" : "rgba(255,255,255,0.06)",
              }}
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center"
                    style={{ background: dmRunning ? "rgba(16,185,129,0.15)" : "rgba(255,255,255,0.05)" }}
                  >
                    <MessageCircle size={20} style={{ color: dmRunning ? "#10b981" : "#64748b" }} />
                  </div>
                  <div>
                    <h2 className="font-bold text-white">DM Auto-Reply</h2>
                    <p className="text-xs" style={{ color: "#64748b" }}>
                      {dmRunning ? "Monitoring Instagram DMs" : "Stopped — not watching DMs"}
                    </p>
                  </div>
                </div>
                <button
                  onClick={toggleDmCron}
                  disabled={!igSession.exists}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all cursor-pointer disabled:opacity-40"
                  style={{
                    background: dmRunning ? "rgba(239,68,68,0.15)" : "rgba(16,185,129,0.15)",
                    color: dmRunning ? "#ef4444" : "#10b981",
                    border: `1px solid ${dmRunning ? "rgba(239,68,68,0.3)" : "rgba(16,185,129,0.3)"}`,
                  }}
                >
                  {dmRunning ? <Square size={14} /> : <Play size={14} />}
                  {dmRunning ? "Stop" : "Start"}
                </button>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="p-3 rounded-xl" style={{ background: "rgba(255,255,255,0.03)" }}>
                  <p className="text-xs mb-1" style={{ color: "#64748b" }}>Status</p>
                  <p className="text-sm font-bold" style={{ color: dmRunning ? "#10b981" : "#64748b" }}>
                    {dmRunning ? "● Running" : "○ Stopped"}
                  </p>
                </div>
                <div className="p-3 rounded-xl" style={{ background: "rgba(255,255,255,0.03)" }}>
                  <p className="text-xs mb-1" style={{ color: "#64748b" }}>Last Check</p>
                  <p className="text-sm font-bold text-white">
                    {dmLastRun ? fmtTime(dmLastRun) : "Never"}
                  </p>
                </div>
              </div>

              {/* Auto-accept toggle */}
              <div
                className="mt-4 flex items-center justify-between px-4 py-3 rounded-xl"
                style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
              >
                <div>
                  <p className="text-sm font-semibold text-white">Auto-Accept Message Requests</p>
                  <p className="text-xs mt-0.5" style={{ color: "#64748b" }}>
                    Automatically accept pending DM requests and reply with AI
                  </p>
                </div>
                <button
                  onClick={toggleAutoAccept}
                  className="relative flex-shrink-0 transition-all duration-300 cursor-pointer"
                  style={{
                    width: "48px",
                    height: "26px",
                    borderRadius: "13px",
                    background: autoAcceptRequests
                      ? "linear-gradient(135deg, #e1306c, #bc1888)"
                      : "rgba(255,255,255,0.1)",
                    border: `1px solid ${
                      autoAcceptRequests ? "rgba(225,48,108,0.5)" : "rgba(255,255,255,0.15)"
                    }`,
                  }}
                  title={autoAcceptRequests ? "Click to disable" : "Click to enable"}
                >
                  <span
                    className="absolute shadow-sm transition-all duration-300"
                    style={{ 
                      backgroundColor: "#ffffff",
                      borderRadius: "50%",
                      width: "22px", 
                      height: "22px",
                      top: "1px",
                      left: autoAcceptRequests ? "calc(100% - 23px)" : "1px"
                    }}
                  />
                </button>
              </div>

              {!igSession.exists && (
                <p className="text-xs mt-3" style={{ color: "#f59e0b" }}>
                  Set up your Instagram session first.
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
                  <Bot size={16} style={{ color: INSTAR_COLOR }} /> AI System Prompt
                </h3>
                <button
                  onClick={() => setEditingDmPrompt(!editingDmPrompt)}
                  className="text-xs px-3 py-1.5 rounded-lg transition-all cursor-pointer"
                  style={{ background: "rgba(225,48,108,0.1)", color: INSTAR_COLOR }}
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
                    style={{ background: INSTAR_GRADIENT, color: "white" }}
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
                  <Terminal size={14} style={{ color: INSTAR_COLOR }} /> Activity Log ({dmLogs.length})
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => { e.stopPropagation(); clearDmLogs(); }}
                    className="px-3 py-1 rounded-lg text-xs cursor-pointer"
                    style={{ background: "rgba(255,255,255,0.05)", color: "#94a3b8" }}
                  >
                    <Trash2 size={11} />
                  </button>
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
                  <History size={15} style={{ color: INSTAR_COLOR }} /> Conversation History ({convLogs.length})
                </h3>
                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {convLogs.map((conv) => (
                    <button
                      key={conv._id}
                      onClick={() => setSelectedConv(selectedConv?._id === conv._id ? null : conv)}
                      className="w-full text-left p-3 rounded-xl border transition-all cursor-pointer"
                      style={{
                        background: selectedConv?._id === conv._id ? "rgba(225,48,108,0.08)" : "rgba(255,255,255,0.02)",
                        borderColor: selectedConv?._id === conv._id ? "rgba(225,48,108,0.2)" : "rgba(255,255,255,0.06)",
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-sm text-white flex items-center gap-2">
                          <User size={13} /> @{conv.senderUsername}
                        </span>
                        <span className="text-xs" style={{ color: "#475569" }}>
                          {conv.messages.length} msgs
                        </span>
                      </div>
                      {selectedConv?._id === conv._id && (
                        <div className="mt-3 space-y-2">
                          {conv.messages.map((msg, i) => (
                            <div
                              key={i}
                              className="flex gap-2 text-xs"
                              style={{ justifyContent: msg.role === "instar" ? "flex-end" : "flex-start" }}
                            >
                              <div
                                className="max-w-[80%] px-3 py-2 rounded-xl leading-relaxed"
                                style={{
                                  background: msg.role === "instar" ? "rgba(225,48,108,0.15)" : "rgba(255,255,255,0.05)",
                                  color: msg.role === "instar" ? INSTAR_COLOR : "#e2e8f0",
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

        {/* ── Growth Engine Tab ─────────────────────────────────────────── */}
        {activeTab === "growth" && (
          <div className="animate-fade-in max-w-3xl mx-auto space-y-6">
            <div className="mb-8">
              <h1 className="text-2xl font-extrabold tracking-tight text-white mb-2">
                Growth{" "}
                <span className="bg-clip-text text-transparent" style={{ backgroundImage: INSTAR_GRADIENT }}>
                  Automation
                </span>
              </h1>
              <p className="text-sm" style={{ color: "#5a5e72" }}>
                Automate follows, likes, and comments based on hashtags to organically
                grow your Instagram presence.
              </p>
            </div>

            {/* Growth status */}
            <div
              className="p-6 rounded-2xl border"
              style={{
                background: growRunning ? "rgba(225,48,108,0.04)" : "rgba(0,0,0,0.3)",
                borderColor: growRunning ? "rgba(225,48,108,0.2)" : "rgba(255,255,255,0.06)",
              }}
            >
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center"
                    style={{ background: growRunning ? "rgba(225,48,108,0.15)" : "rgba(255,255,255,0.05)" }}
                  >
                    <TrendingUp size={20} style={{ color: growRunning ? INSTAR_COLOR : "#64748b" }} />
                  </div>
                  <div>
                    <h2 className="font-bold text-white">Growth Engine</h2>
                    <p className="text-xs" style={{ color: "#64748b" }}>
                      {growRunning ? "Actively growing — follows, likes & comments" : "Stopped"}
                    </p>
                  </div>
                </div>
                <button
                  onClick={toggleGrowCron}
                  disabled={!igSession.exists}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all cursor-pointer disabled:opacity-40"
                  style={{
                    background: growRunning ? "rgba(239,68,68,0.15)" : "rgba(225,48,108,0.15)",
                    color: growRunning ? "#ef4444" : INSTAR_COLOR,
                    border: `1px solid ${growRunning ? "rgba(239,68,68,0.3)" : "rgba(225,48,108,0.3)"}`,
                  }}
                >
                  {growRunning ? <Square size={14} /> : <Zap size={14} />}
                  {growRunning ? "Stop Growth" : "Start Growth"}
                </button>
              </div>

              {/* Today's stats */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { key: "like", label: "Likes Today", icon: Heart, color: "#ef4444", limit: growSettings.dailyLikeLimit },
                  { key: "follow", label: "Follows Today", icon: UserPlus, color: "#3b82f6", limit: growSettings.dailyFollowLimit },
                  { key: "comment", label: "Comments Today", icon: MessageCircle, color: "#10b981", limit: growSettings.dailyCommentLimit },
                ].map((stat) => (
                  <div key={stat.key} className="p-4 rounded-xl" style={{ background: "rgba(255,255,255,0.03)" }}>
                    <div className="flex items-center gap-2 mb-2">
                      <stat.icon size={14} style={{ color: stat.color }} />
                      <p className="text-xs" style={{ color: "#64748b" }}>{stat.label}</p>
                    </div>
                    <p className="text-2xl font-bold text-white">{dailyCounts[stat.key] ?? 0}</p>
                    <p className="text-xs mt-1" style={{ color: "#475569" }}>of {stat.limit} limit</p>
                    <div className="mt-2 h-1 rounded-full" style={{ background: "rgba(255,255,255,0.08)" }}>
                      <div
                        className="h-1 rounded-full transition-all"
                        style={{
                          background: stat.color,
                          width: `${Math.min(100, ((dailyCounts[stat.key] ?? 0) / stat.limit) * 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
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
                <Settings size={15} style={{ color: INSTAR_COLOR }} /> Growth Settings
              </h3>

              {/* Target hashtags */}
              <div>
                <label className="block text-xs font-semibold mb-2" style={{ color: "#94a3b8" }}>
                  Target Hashtags
                </label>
                <div className="flex flex-wrap gap-2 mb-3">
                  {growSettings.targetHashtags.map((tag) => (
                    <span
                      key={tag}
                      className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-sm font-medium"
                      style={{ background: "rgba(225,48,108,0.1)", color: INSTAR_COLOR }}
                    >
                      <Hash size={11} />
                      {tag}
                      <button
                        onClick={() => removeHashtag(tag)}
                        className="ml-1 hover:text-white transition-colors cursor-pointer"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={hashtagInput}
                    onChange={(e) => setHashtagInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addHashtag()}
                    placeholder="Add hashtag (without #)"
                    className="flex-1 px-4 py-2 rounded-xl text-sm text-white placeholder-gray-600 outline-none border transition-all"
                    style={{ background: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.1)" }}
                  />
                  <button
                    onClick={addHashtag}
                    className="px-4 py-2 rounded-xl text-sm font-semibold cursor-pointer"
                    style={{ background: "rgba(225,48,108,0.15)", color: INSTAR_COLOR }}
                  >
                    Add
                  </button>
                </div>
              </div>

              {/* Daily limits */}
              <div className="grid grid-cols-3 gap-4">
                {[
                  { key: "dailyLikeLimit" as const, label: "Daily Like Limit", max: 300 },
                  { key: "dailyFollowLimit" as const, label: "Daily Follow Limit", max: 100 },
                  { key: "dailyCommentLimit" as const, label: "Daily Comment Limit", max: 50 },
                ].map((field) => (
                  <div key={field.key}>
                    <label className="block text-xs font-semibold mb-2" style={{ color: "#94a3b8" }}>
                      {field.label}
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={field.max}
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

              {/* Comment prompt */}
              <div>
                <label className="block text-xs font-semibold mb-2" style={{ color: "#94a3b8" }}>
                  AI Comment Prompt
                </label>
                <textarea
                  value={growSettings.commentPrompt}
                  onChange={(e) => setGrowSettings((s) => ({ ...s, commentPrompt: e.target.value }))}
                  rows={3}
                  className="w-full px-4 py-3 rounded-xl text-sm text-white outline-none border transition-all resize-none"
                  style={{ background: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.1)", fontFamily: "inherit" }}
                />
              </div>

              <button
                onClick={saveGrowSettings}
                disabled={savingSettings}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all cursor-pointer disabled:opacity-40"
                style={{ background: INSTAR_GRADIENT, color: "white" }}
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
                  <Zap size={14} style={{ color: INSTAR_COLOR }} /> Growth Log ({growLogs.length})
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => { e.stopPropagation(); clearGrowLogs(); }}
                    className="px-3 py-1 rounded-lg text-xs cursor-pointer"
                    style={{ background: "rgba(255,255,255,0.05)", color: "#94a3b8" }}
                  >
                    <Trash2 size={11} />
                  </button>
                  {growLogsExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </div>
              </div>

              {growLogsExpanded && (
                <div className="max-h-72 overflow-y-auto p-3 space-y-1" style={{ background: "rgba(0,0,0,0.3)" }}>
                  {growLogs.length === 0 ? (
                    <p className="text-xs text-center py-4" style={{ color: "#475569" }}>No growth activity yet.</p>
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

        {/* ── Content Ready Tab ─────────────────────────────────────────── */}
        {activeTab === "content" && (
          <ContentReadyTab showToast={showToast} instarColor={INSTAR_COLOR} />
        )}

        {/* ── Analytics Tab ─────────────────────────────────────────────── */}
        {activeTab === "logs" && (
          <div className="animate-fade-in max-w-4xl mx-auto space-y-6">
            <div className="flex items-center justify-between mb-8">
              <div>
                <h1 className="text-2xl font-extrabold tracking-tight text-white mb-2">
                  Growth{" "}
                  <span className="bg-clip-text text-transparent" style={{ backgroundImage: INSTAR_GRADIENT }}>
                    Analytics
                  </span>
                </h1>
                <p className="text-sm" style={{ color: "#5a5e72" }}>
                  Monitor your account&apos;s activity and growth performance over time.
                </p>
              </div>
              <button
                onClick={loadMetrics}
                disabled={loadingMetrics}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold cursor-pointer border transition-all"
                style={{ background: "rgba(255,255,255,0.03)", borderColor: "rgba(255,255,255,0.06)", color: "#94a3b8" }}
              >
                <RefreshCw size={14} className={loadingMetrics ? "animate-spin" : ""} />
                Refresh
              </button>
            </div>

            {metrics ? (
              <>
                {/* All-time totals */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {[
                    { key: "like", label: "Total Likes", icon: Heart, color: "#ef4444" },
                    { key: "follow", label: "Total Follows", icon: UserPlus, color: "#3b82f6" },
                    { key: "comment", label: "Total Comments", icon: MessageCircle, color: "#10b981" },
                    { key: "dm", label: "Total DMs", icon: MessageCircle, color: INSTAR_COLOR },
                  ].map((stat) => (
                    <div
                      key={stat.key}
                      className="p-5 rounded-2xl border text-center"
                      style={{ background: "rgba(0,0,0,0.3)", borderColor: "rgba(255,255,255,0.06)" }}
                    >
                      <stat.icon size={20} className="mx-auto mb-2" style={{ color: stat.color }} />
                      <p className="text-3xl font-bold text-white">{metrics.totals[stat.key] ?? 0}</p>
                      <p className="text-xs mt-1" style={{ color: "#64748b" }}>{stat.label}</p>
                    </div>
                  ))}
                </div>

                {/* Today's counts */}
                <div
                  className="p-5 rounded-2xl border"
                  style={{ background: "rgba(0,0,0,0.3)", borderColor: "rgba(255,255,255,0.06)" }}
                >
                <h3 className="text-sm font-bold text-white mb-4">Today&apos;s Activity</h3>
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { key: "like", label: "Likes", color: "#ef4444" },
                      { key: "follow", label: "Follows", color: "#3b82f6" },
                      { key: "comment", label: "Comments", color: "#10b981" },
                    ].map((s) => (
                      <div key={s.key} className="text-center p-3 rounded-xl" style={{ background: "rgba(255,255,255,0.03)" }}>
                        <p className="text-2xl font-bold" style={{ color: s.color }}>{metrics.today[s.key] ?? 0}</p>
                        <p className="text-xs mt-1" style={{ color: "#64748b" }}>{s.label}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 7-day breakdown */}
                {Object.keys(metrics.byDay).length > 0 && (
                  <div
                    className="p-5 rounded-2xl border"
                    style={{ background: "rgba(0,0,0,0.3)", borderColor: "rgba(255,255,255,0.06)" }}
                  >
                    <h3 className="text-sm font-bold text-white mb-4">Last 7 Days</h3>
                    <div className="space-y-2">
                      {Object.entries(metrics.byDay)
                        .sort(([a], [b]) => b.localeCompare(a))
                        .map(([day, actions]) => (
                          <div key={day} className="flex items-center gap-4 p-3 rounded-xl" style={{ background: "rgba(0,0,0,0.3)" }}>
                            <span className="text-xs font-mono w-24 shrink-0" style={{ color: "#64748b" }}>{day}</span>
                            <div className="flex gap-4 flex-wrap">
                              {["like", "follow", "comment"].map((action) =>
                                actions[action] ? (
                                  <span key={action} className="text-xs font-semibold" style={{ color: action === "like" ? "#ef4444" : action === "follow" ? "#3b82f6" : "#10b981" }}>
                                    {action === "like" ? "♥" : action === "follow" ? "+" : "✎"} {actions[action]}
                                  </span>
                                ) : null
                              )}
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-12" style={{ color: "#475569" }}>
                {loadingMetrics ? (
                  <RefreshCw size={24} className="mx-auto animate-spin mb-2" />
                ) : (
                  <p className="text-sm">No analytics data yet. Start the growth engine to begin tracking.</p>
                )}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

// ── Content Ready sub-component ──────────────────────────────────────────
function ContentReadyTab({
  showToast,
  instarColor,
}: {
  showToast: (msg: string, type: "success" | "error") => void;
  instarColor: string;
}) {
  const [coraContent, setCoraContent] = useState<
    { _id: string; persona_name?: string; content: string; created_at: string; platform: string; status: string }[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [posting, setPosting] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const loadContent = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/cora?platform=instagram&status=approved");
      const data = await res.json();
      if (data.content) setCoraContent(data.content);
    } catch {
      // If Cora endpoint doesn't support filters, fall back to all content
      try {
        const res2 = await fetch("/api/cora");
        const data2 = await res2.json();
        const items = (data2.content || []).filter(
          (c: { platform: string; status: string }) => c.platform === "instagram" || c.status === "approved"
        );
        setCoraContent(items);
      } catch {}
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadContent(); }, [loadContent]);

  const copyContent = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
    showToast("Caption copied to clipboard.", "success");
  };

  return (
    <div className="animate-fade-in max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-white mb-2">
            Content{" "}
            <span className="bg-clip-text text-transparent" style={{ backgroundImage: INSTAR_GRADIENT }}>
              Ready
            </span>
          </h1>
          <p className="text-sm" style={{ color: "#5a5e72" }}>
            Approved content from Cora, formatted for Instagram. Copy the caption and post manually.
          </p>
        </div>
        <button
          onClick={loadContent}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold cursor-pointer"
          style={{ background: "rgba(255,255,255,0.05)", color: "#94a3b8" }}
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12">
          <RefreshCw size={20} className="mx-auto animate-spin mb-2" style={{ color: instarColor }} />
          <p className="text-sm" style={{ color: "#64748b" }}>Loading content...</p>
        </div>
      ) : coraContent.length === 0 ? (
        <div
          className="p-8 rounded-2xl border text-center"
          style={{ background: "rgba(0,0,0,0.3)", borderColor: "rgba(255,255,255,0.06)" }}
        >
          <Instagram size={32} className="mx-auto mb-3" style={{ color: instarColor, opacity: 0.4 }} />
          <p className="font-semibold text-white mb-1">No Instagram content ready</p>
          <p className="text-sm" style={{ color: "#64748b" }}>
            Use <strong>Cora</strong> to repurpose LinkedIn content for Instagram, then approve it here.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {coraContent.map((item) => (
            <div
              key={item._id}
              className="p-5 rounded-2xl border"
              style={{ background: "rgba(0,0,0,0.3)", borderColor: "rgba(255,255,255,0.06)" }}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Instagram size={14} style={{ color: instarColor }} />
                  <span className="text-xs font-semibold" style={{ color: instarColor }}>Instagram</span>
                  {item.persona_name && (
                    <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "rgba(255,255,255,0.06)", color: "#94a3b8" }}>
                      {item.persona_name}
                    </span>
                  )}
                  <span
                    className="text-xs px-2 py-0.5 rounded-full"
                    style={{
                      background: item.status === "approved" ? "rgba(16,185,129,0.1)" : "rgba(255,255,255,0.05)",
                      color: item.status === "approved" ? "#10b981" : "#94a3b8",
                    }}
                  >
                    {item.status}
                  </span>
                </div>
                <span className="text-xs" style={{ color: "#475569" }}>
                  {new Date(item.created_at).toLocaleDateString()}
                </span>
              </div>

              <p className="text-sm leading-relaxed whitespace-pre-wrap mb-4" style={{ color: "#e2e8f0" }}>
                {item.content}
              </p>

              <div className="flex gap-2">
                <button
                  onClick={() => copyContent(item._id, item.content)}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer"
                  style={{
                    background: copied === item._id ? "rgba(16,185,129,0.15)" : "rgba(225,48,108,0.1)",
                    color: copied === item._id ? "#10b981" : instarColor,
                  }}
                >
                  {copied === item._id ? "✓ Copied!" : "Copy Caption"}
                </button>
                <a
                  href="https://www.instagram.com/create/story"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer"
                  style={{ background: "rgba(255,255,255,0.05)", color: "#94a3b8" }}
                >
                  <Eye size={11} /> Open Instagram
                </a>
              </div>
            </div>
          ))}
        </div>
      )}

      <div
        className="p-4 rounded-xl border"
        style={{ background: "rgba(225,48,108,0.04)", borderColor: "rgba(225,48,108,0.12)" }}
      >
        <p className="text-xs" style={{ color: "#94a3b8" }}>
          <strong style={{ color: instarColor }}>Note:</strong> Instagram requires images for feed posts.
          Copy the caption, then create your post on Instagram with a relevant image.
          DM Auto-Reply handles incoming messages automatically.
        </p>
      </div>
    </div>
  );
}
