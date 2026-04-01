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

type TabId = "ig-auth" | "dm-reply" | "growth" | "logs";

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
  targetProfiles: string[];
  targetKeywords: string[];
  dailyFollowLimit: number;
  dailyLikeLimit: number;
  dailyCommentLimit: number;
  commentPrompt: string;
  autoReplyEnabled: boolean;
  enableLike: boolean;
  enableFollow: boolean;
  enableComment: boolean;
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
  const [nextActionMode, setNextActionMode] = useState<string>("comment");
  const [growSettings, setGrowSettings] = useState<GrowthSettings>({
    targetHashtags: ["business", "entrepreneur", "marketing"],
    targetProfiles: [],
    targetKeywords: [],
    dailyFollowLimit: 20,
    dailyLikeLimit: 60,
    dailyCommentLimit: 10,
    commentPrompt:
      "Write a short, genuine, relevant 1-sentence comment (no emojis, no hashtags) for an Instagram post about the topic provided. Be specific and insightful.",
    autoReplyEnabled: true,
    enableLike: true,
    enableFollow: true,
    enableComment: true,
  });
  const [hashtagInput, setHashtagInput] = useState("");
  const [profileInput, setProfileInput] = useState("");
  const [keywordInput, setKeywordInput] = useState("");
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
          targetProfiles: data.settings.targetProfiles ?? prev.targetProfiles,
          targetKeywords: data.settings.targetKeywords ?? prev.targetKeywords,
          dailyFollowLimit: data.settings.dailyFollowLimit ?? prev.dailyFollowLimit,
          dailyLikeLimit: data.settings.dailyLikeLimit ?? prev.dailyLikeLimit,
          dailyCommentLimit: data.settings.dailyCommentLimit ?? prev.dailyCommentLimit,
          commentPrompt: data.settings.commentPrompt || prev.commentPrompt,
          autoReplyEnabled: data.settings.autoReplyEnabled ?? prev.autoReplyEnabled,
          enableLike: data.settings.enableLike ?? prev.enableLike,
          enableFollow: data.settings.enableFollow ?? prev.enableFollow,
          enableComment: data.settings.enableComment ?? prev.enableComment,
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
      if (data.nextActionMode) setNextActionMode(data.nextActionMode);
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

    // When starting, always push the current UI settings to DB first.
    // This ensures enable/disable toggles take effect immediately without
    // requiring a manual "Save Settings" click before starting.
    if (action === "start") {
      try {
        await fetch("/api/instar/grow/cron", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "update_settings", ...growSettings }),
        });
      } catch {
        // Non-fatal — proceed with start anyway
      }
    }

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

  const addProfile = () => {
    const p = profileInput.trim().replace(/^@/, "");
    if (p && !growSettings.targetProfiles.includes(p)) {
      setGrowSettings((s) => ({ ...s, targetProfiles: [...s.targetProfiles, p] }));
    }
    setProfileInput("");
  };

  const removeProfile = (p: string) => {
    setGrowSettings((s) => ({ ...s, targetProfiles: s.targetProfiles.filter((x) => x !== p) }));
  };

  const addKeyword = () => {
    const kw = keywordInput.trim();
    if (kw && !growSettings.targetKeywords.includes(kw)) {
      setGrowSettings((s) => ({ ...s, targetKeywords: [...s.targetKeywords, kw] }));
    }
    setKeywordInput("");
  };

  const removeKeyword = (kw: string) => {
    setGrowSettings((s) => ({ ...s, targetKeywords: s.targetKeywords.filter((x) => x !== kw) }));
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
                      {growRunning
                        ? "Actively growing — comment → follow → like rotation"
                        : "Stopped — start to begin comment → follow → like rotation"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {/* Next action badge */}
                  {growRunning && (
                    <div
                      className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border"
                      style={{
                        background:
                          nextActionMode === "comment"
                            ? "rgba(16,185,129,0.1)"
                            : nextActionMode === "follow"
                            ? "rgba(59,130,246,0.1)"
                            : "rgba(239,68,68,0.1)",
                        borderColor:
                          nextActionMode === "comment"
                            ? "rgba(16,185,129,0.25)"
                            : nextActionMode === "follow"
                            ? "rgba(59,130,246,0.25)"
                            : "rgba(239,68,68,0.25)",
                        color:
                          nextActionMode === "comment"
                            ? "#10b981"
                            : nextActionMode === "follow"
                            ? "#60a5fa"
                            : "#ef4444",
                      }}
                    >
                      {nextActionMode === "comment" ? (
                        <MessageCircle size={11} />
                      ) : nextActionMode === "follow" ? (
                        <UserPlus size={11} />
                      ) : (
                        <Heart size={11} />
                      )}
                      Next: {nextActionMode}
                    </div>
                  )}
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
              </div>

              {/* Rotation info */}
              <div
                className="flex items-center gap-2 mb-4 px-4 py-2.5 rounded-xl"
                style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
              >
                <RefreshCw size={12} style={{ color: "#475569" }} />
                <p className="text-xs" style={{ color: "#64748b" }}>
                  <span style={{ color: "#10b981" }}>① Comment</span>
                  {" → "}
                  <span style={{ color: "#60a5fa" }}>② Follow</span>
                  {" → "}
                  <span style={{ color: "#ef4444" }}>③ Like</span>
                  {" → repeat · 20 min interval · max 3 actions/tick"}
                </p>
              </div>

              {/* Today's stats */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { key: "comment", label: "Comments Today", icon: MessageCircle, color: "#10b981", limit: growSettings.dailyCommentLimit, enabled: growSettings.enableComment },
                  { key: "follow", label: "Follows Today", icon: UserPlus, color: "#3b82f6", limit: growSettings.dailyFollowLimit, enabled: growSettings.enableFollow },
                  { key: "like", label: "Likes Today", icon: Heart, color: "#ef4444", limit: growSettings.dailyLikeLimit, enabled: growSettings.enableLike },
                ].map((stat) => {
                  const count = dailyCounts[stat.key] ?? 0;
                  const limitReached = count >= stat.limit;
                  return (
                    <div
                      key={stat.key}
                      className="p-4 rounded-xl"
                      style={{
                        background: limitReached
                          ? `${stat.color}11`
                          : "rgba(255,255,255,0.03)",
                        border: limitReached
                          ? `1px solid ${stat.color}44`
                          : "1px solid transparent",
                        opacity: stat.enabled ? 1 : 0.45,
                      }}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <stat.icon size={14} style={{ color: stat.color }} />
                          <p className="text-xs" style={{ color: "#64748b" }}>{stat.label}</p>
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
                      <p className="text-xs mt-1" style={{ color: "#475569" }}>of {stat.limit} limit</p>
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
                <Settings size={15} style={{ color: INSTAR_COLOR }} /> Growth Settings
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

              {/* Target Profiles */}
              <div>
                <label className="block text-xs font-semibold mb-1" style={{ color: "#94a3b8" }}>
                  Target Profiles
                </label>
                <p className="text-xs mb-2" style={{ color: "#475569" }}>
                  Browse posts directly from these accounts (e.g. competitor or niche influencer pages).
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
                        onClick={() => removeProfile(p)}
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
                    onKeyDown={(e) => e.key === "Enter" && addProfile()}
                    placeholder="Add username (without @)"
                    className="flex-1 px-4 py-2 rounded-xl text-sm text-white placeholder-gray-600 outline-none border transition-all"
                    style={{ background: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.1)" }}
                  />
                  <button
                    onClick={addProfile}
                    className="px-4 py-2 rounded-xl text-sm font-semibold cursor-pointer"
                    style={{ background: "rgba(59,130,246,0.15)", color: "#60a5fa" }}
                  >
                    Add
                  </button>
                </div>
              </div>

              {/* Target Keywords */}
              <div>
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <label className="text-xs font-semibold" style={{ color: "#94a3b8" }}>
                    Keyword Filter <span style={{ color: "#334155", fontWeight: 400 }}>(optional)</span>
                  </label>
                  {/* Mode badges — show which actions are affected */}
                  <span className="flex items-center gap-1">
                    <span
                      className="text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1"
                      style={{ background: "rgba(16,185,129,0.12)", color: "#34d399" }}
                    >
                      <MessageCircle size={9} /> Comment only
                    </span>
                    <span
                      className="text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1"
                      style={{ background: "rgba(255,255,255,0.04)", color: "#334155" }}
                      title="Keywords do not filter likes"
                    >
                      <Heart size={9} /> Like — all posts
                    </span>
                    <span
                      className="text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1"
                      style={{ background: "rgba(255,255,255,0.04)", color: "#334155" }}
                      title="Keywords do not filter follows"
                    >
                      <UserPlus size={9} /> Follow — all posts
                    </span>
                  </span>
                </div>
                <p className="text-xs mb-2" style={{ color: "#475569" }}>
                  Only leave a <span style={{ color: "#34d399" }}>Comment</span> on posts whose caption matches a keyword (so AI writes relevant replies).{" "}
                  <span style={{ color: "#475569" }}>Likes and Follows engage with all posts from your targets regardless of keywords.</span>
                </p>
                <div className="flex flex-wrap gap-2 mb-3">
                  {growSettings.targetKeywords.map((kw) => (
                    <span
                      key={kw}
                      className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-sm font-medium"
                      style={{ background: "rgba(16,185,129,0.12)", color: "#34d399" }}
                    >
                      {kw}
                      <button
                        onClick={() => removeKeyword(kw)}
                        className="ml-1 hover:text-white transition-colors cursor-pointer"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  {growSettings.targetKeywords.length === 0 && (
                    <span className="text-xs" style={{ color: "#334155" }}>No filter — comments on all posts</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={keywordInput}
                    onChange={(e) => setKeywordInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addKeyword()}
                    placeholder="e.g. startup, growth, fitness"
                    className="flex-1 px-4 py-2 rounded-xl text-sm text-white placeholder-gray-600 outline-none border transition-all"
                    style={{ background: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.1)" }}
                  />
                  <button
                    onClick={addKeyword}
                    className="px-4 py-2 rounded-xl text-sm font-semibold cursor-pointer"
                    style={{ background: "rgba(16,185,129,0.15)", color: "#34d399" }}
                  >
                    Add
                  </button>
                </div>
              </div>

              {/* Action toggles */}
              <div>
                <label className="block text-xs font-semibold mb-3" style={{ color: "#94a3b8" }}>
                  Actions
                </label>
                <div className="flex gap-3">
                  {[
                    { key: "enableLike" as const, label: "Likes", color: "#ef4444" },
                    { key: "enableFollow" as const, label: "Follows", color: "#3b82f6" },
                    { key: "enableComment" as const, label: "Comments", color: "#10b981" },
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
                <div className="flex items-center gap-2 mb-3">
                  <label className="text-xs font-semibold" style={{ color: "#94a3b8" }}>
                    Daily Limits
                  </label>
                  <span
                    className="text-xs px-2 py-0.5 rounded-md"
                    style={{ background: "rgba(245,158,11,0.1)", color: "#f59e0b" }}
                  >
                    Safe: likes ≤ 60 · follows ≤ 20 · comments ≤ 10
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  {[
                    { key: "dailyLikeLimit" as const, label: "Likes / day", max: 60 },
                    { key: "dailyFollowLimit" as const, label: "Follows / day", max: 20 },
                    { key: "dailyCommentLimit" as const, label: "Comments / day", max: 10 },
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


