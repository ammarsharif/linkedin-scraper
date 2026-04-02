"use client";

import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  Clock,
  RefreshCw,
  Pause,
  Play,
  StopCircle,
  Send,
  RotateCcw,
  CheckCircle2,
  History,
  ChevronDown,
  ChevronUp,
  Plus,
  Trash2,
  Save,
  Settings,
  MessageSquare,
  ToggleLeft,
  ToggleRight,
  X,
  Zap,
  Eye,
  Edit3,
  AlertCircle,
  User,
} from "lucide-react";
import { ConfirmModal } from "@/components/ConfirmModal";

// ── Types ──────────────────────────────────────────────────────────────────

type BotName = "cindy" | "instar" | "felix" | "zapier" | "xavier";

interface FollowUpRecord {
  _id: string;
  botName: BotName;
  userId: string;
  userName: string;
  contactInfo?: string;
  originalMessageId: string;
  originalMessageText: string;
  originalMessageSentAt: string;
  replyReceived: boolean;
  replyReceivedAt?: string;
  followUpsSent: number;
  lastFollowupSentAt?: string;
  nextFollowupScheduledAt: string;
  status: "active" | "paused" | "stopped" | "completed" | "replied";
  manuallyStoppedAt?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

interface FollowUpTemplate {
  _id?: string;
  botName: BotName;
  followUpNumber: 1 | 2 | 3 | 4 | 5;
  messageText: string;
  updatedAt: string;
}

interface FollowUpRule {
  _id: string;
  botName: BotName;
  type: "keyword" | "phrase";
  value: string;
  enabled: boolean;
  createdAt: string;
}

interface Stats {
  active: number;
  repliedToday: number;
  overdue: number;
  paused: number;
}

interface Props {
  botName: BotName;
  accentColor: string;
}

// ── Constants ──────────────────────────────────────────────────────────────

const SCHEDULE_LABELS = ["+4 hrs", "+12 hrs", "+16 hrs", "+24 hrs", "+48 hrs"];
const FOLLOWUP_HOURS = [4, 12, 16, 24, 48];

const STATUS_COLOR: Record<string, string> = {
  active:    "#10b981",
  paused:    "#f59e0b",
  stopped:   "#6b7280",
  completed: "#8b5cf6",
  replied:   "#3b82f6",
};

const STATUS_LABEL: Record<string, string> = {
  active:    "Active",
  paused:    "Paused",
  stopped:   "Stopped",
  completed: "No Reply",
  replied:   "Replied",
};

const DEFAULT_TEMPLATES: Record<number, string> = {
  1: "Hi {{user_name}}, just a friendly reminder about my previous message. Would love to hear your thoughts!",
  2: "Hi {{user_name}}, following up again — I wanted to make sure my message didn't get lost. Looking forward to connecting!",
  3: "Hi {{user_name}}, reaching out one more time. I sent a message {{days_waiting}} day(s) ago and haven't heard back. Happy to help whenever you're ready!",
  4: "Hi {{user_name}}, I know you're busy — just wanted to check in once more. Feel free to reach out anytime.",
  5: "Hi {{user_name}}, this will be my last follow-up. If you ever want to reconnect, don't hesitate to reach out. Wishing you all the best!",
};

// ── Helpers ────────────────────────────────────────────────────────────────

function formatRelative(isoDate: string, past = false): string {
  const diff = new Date(isoDate).getTime() - Date.now();
  const abs = Math.abs(diff);
  if (abs < 60_000) return past ? "just now" : "< 1 min";
  if (abs < 3_600_000) return `${Math.round(abs / 60_000)}m${past ? " ago" : ""}`;
  if (abs < 86_400_000) return `${Math.round(abs / 3_600_000)}h${past ? " ago" : ""}`;
  return `${Math.round(abs / 86_400_000)}d${past ? " ago" : ""}`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function renderPreview(text: string, record: FollowUpRecord): string {
  const days = Math.floor(
    (Date.now() - new Date(record.originalMessageSentAt).getTime()) / 86_400_000
  );
  return text
    .replace(/\{\{user_name\}\}/g, record.userName)
    .replace(/\{\{original_message\}\}/g, record.originalMessageText.slice(0, 80))
    .replace(/\{\{days_waiting\}\}/g, String(days));
}

// ── Button style helpers ───────────────────────────────────────────────────

function iconBtn(color: string): React.CSSProperties {
  return {
    background: `${color}18`, border: `1px solid ${color}33`,
    borderRadius: 7, padding: "5px 7px", cursor: "pointer", color,
    display: "flex", alignItems: "center", justifyContent: "center",
  };
}

function actionBtn(color: string): React.CSSProperties {
  return {
    background: `${color}18`, border: `1px solid ${color}40`,
    borderRadius: 8, padding: "6px 13px", cursor: "pointer", color,
    fontSize: 12, fontWeight: 600,
    display: "flex", alignItems: "center", gap: 5,
  };
}

// ── Manual Send Dialog ─────────────────────────────────────────────────────

function ManualSendDialog({
  record,
  templates,
  accentColor,
  onClose,
  onSent,
}: {
  record: FollowUpRecord;
  templates: FollowUpTemplate[];
  accentColor: string;
  onClose: () => void;
  onSent: () => void;
}) {
  const followUpNumber = Math.min(record.followUpsSent + 1, 5);
  const tmpl = templates.find((t) => t.followUpNumber === followUpNumber);
  const rawText = tmpl?.messageText ?? DEFAULT_TEMPLATES[followUpNumber];

  const [message, setMessage] = useState(rawText);
  const [useCustom, setUseCustom] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [sentOk, setSentOk] = useState(false);

  const preview = renderPreview(message, record);

  const send = async () => {
    setSending(true);
    setError("");
    try {
      const res = await fetch("/api/follow-up/cron", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "manual-send",
          recordId: record._id,
          customMessage: useCustom ? message : undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setSentOk(true);
        setTimeout(() => { onSent(); onClose(); }, 1200);
      } else {
        setError(data.error || "Failed to send.");
      }
    } catch {
      setError("Network error.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(0,0,0,0.75)", display: "flex",
        alignItems: "center", justifyContent: "center",
        backdropFilter: "blur(6px)",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: "rgba(12,15,22,0.98)", border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 20, width: "min(580px, 96vw)", maxHeight: "90vh",
        overflow: "auto", padding: 28,
        display: "flex", flexDirection: "column", gap: 20,
        boxShadow: `0 0 60px ${accentColor}18`,
      }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ color: "#fff", fontWeight: 700, fontSize: 17, marginBottom: 3, display: "flex", alignItems: "center", gap: 8 }}>
              <Send size={16} color={accentColor} />
              Send Follow-up #{followUpNumber}
            </div>
            <div style={{ color: "rgba(255,255,255,0.35)", fontSize: 12 }}>
              to <span style={{ color: "rgba(255,255,255,0.7)", fontWeight: 600 }}>{record.userName}</span>
              {" "}· {record.botName} · {record.followUpsSent}/5 sent so far
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.35)", padding: 4 }}>
            <X size={18} />
          </button>
        </div>

        {/* All 5 steps progress */}
        <div style={{ display: "flex", gap: 6 }}>
          {[1,2,3,4,5].map((n) => (
            <div key={n} style={{
              flex: 1, height: 4, borderRadius: 4,
              background: n <= record.followUpsSent
                ? "#10b981"
                : n === followUpNumber
                ? accentColor
                : "rgba(255,255,255,0.08)",
            }} />
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: -14 }}>
          {SCHEDULE_LABELS.map((l, i) => (
            <div key={i} style={{ fontSize: 9, color: "rgba(255,255,255,0.2)", textAlign: "center", flex: 1 }}>{l}</div>
          ))}
        </div>

        {/* Template toggle */}
        <div style={{
          background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 12, padding: 14,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
              {useCustom ? <><Edit3 size={13} color={accentColor} /> Custom Message</> : <><Eye size={13} color={accentColor} /> Template Message</>}
            </div>
            <button
              onClick={() => setUseCustom(!useCustom)}
              style={{
                background: useCustom ? `${accentColor}20` : "rgba(255,255,255,0.06)",
                border: `1px solid ${useCustom ? accentColor + "40" : "rgba(255,255,255,0.1)"}`,
                borderRadius: 7, padding: "4px 10px", cursor: "pointer",
                color: useCustom ? accentColor : "rgba(255,255,255,0.4)",
                fontSize: 11, fontWeight: 600,
                display: "flex", alignItems: "center", gap: 5,
              }}
            >
              <Edit3 size={11} />
              {useCustom ? "Using Custom" : "Edit Message"}
            </button>
          </div>

          {useCustom ? (
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
              style={{
                width: "100%", boxSizing: "border-box",
                background: "rgba(255,255,255,0.05)", border: `1px solid ${accentColor}44`,
                borderRadius: 10, padding: "10px 13px",
                color: "rgba(255,255,255,0.85)", fontSize: 13, lineHeight: 1.6,
                resize: "vertical", outline: "none", fontFamily: "inherit",
              }}
            />
          ) : (
            <div style={{
              background: "rgba(255,255,255,0.04)", borderRadius: 10, padding: "10px 13px",
              color: "rgba(255,255,255,0.6)", fontSize: 13, lineHeight: 1.6,
              borderLeft: `3px solid ${accentColor}`,
            }}>
              {rawText}
            </div>
          )}
        </div>

        {/* Live preview */}
        <div>
          <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 10, fontWeight: 700, textTransform: "uppercase", marginBottom: 8, letterSpacing: 1 }}>
            Message Preview (as sent)
          </div>
          <div style={{
            background: `${accentColor}0d`, border: `1px solid ${accentColor}25`,
            borderRadius: 12, padding: "12px 15px",
            color: "rgba(255,255,255,0.75)", fontSize: 13, lineHeight: 1.7,
          }}>
            {preview}
          </div>
        </div>

        {error && (
          <div style={{
            background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)",
            borderRadius: 10, padding: "10px 14px",
            color: "#ef4444", fontSize: 12, display: "flex", alignItems: "center", gap: 6,
          }}>
            <AlertCircle size={13} /> {error}
          </div>
        )}

        {sentOk && (
          <div style={{
            background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.25)",
            borderRadius: 10, padding: "10px 14px",
            color: "#10b981", fontSize: 12, display: "flex", alignItems: "center", gap: 6,
          }}>
            <CheckCircle2 size={13} /> Message sent successfully!
          </div>
        )}

        {/* CTA */}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={actionBtn("rgba(255,255,255,0.3)")}>
            <X size={12} /> Cancel
          </button>
          <button
            onClick={send}
            disabled={sending || sentOk || (useCustom && !message.trim())}
            style={{
              ...actionBtn(accentColor),
              opacity: (sending || sentOk || (useCustom && !message.trim())) ? 0.6 : 1,
              padding: "8px 20px", fontSize: 13,
            }}
          >
            <Send size={13} />
            {sending ? "Sending…" : sentOk ? "Sent!" : `Send Follow-up #${followUpNumber}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── History Modal ──────────────────────────────────────────────────────────

function HistoryModal({
  record,
  accentColor,
  onClose,
  onAction,
}: {
  record: FollowUpRecord;
  accentColor: string;
  onClose: () => void;
  onAction: (id: string, action: string) => void;
}) {
  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9998,
        background: "rgba(0,0,0,0.7)", display: "flex",
        alignItems: "center", justifyContent: "center",
        backdropFilter: "blur(4px)",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: "rgba(12,15,22,0.98)", border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 20, width: "min(560px, 95vw)", maxHeight: "85vh", overflow: "auto",
        padding: 28, display: "flex", flexDirection: "column", gap: 20,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ color: "#fff", fontWeight: 700, fontSize: 16, display: "flex", alignItems: "center", gap: 8 }}>
              <User size={15} color={accentColor} /> {record.userName}
            </div>
            <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 12, marginTop: 3 }}>
              {record.botName} · started {formatDate(record.createdAt)}
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.35)", padding: 4 }}>
            <X size={18} />
          </button>
        </div>

        {/* Original message */}
        <div style={{
          background: "rgba(255,255,255,0.03)", borderRadius: 12, padding: 14,
          borderLeft: `3px solid ${accentColor}`,
        }}>
          <div style={{ color: "rgba(255,255,255,0.25)", fontSize: 10, fontWeight: 700, marginBottom: 6, textTransform: "uppercase", letterSpacing: 1 }}>
            Original Message
          </div>
          <div style={{ color: "rgba(255,255,255,0.65)", fontSize: 13, lineHeight: 1.6 }}>
            {record.originalMessageText}
          </div>
          <div style={{ color: "rgba(255,255,255,0.2)", fontSize: 11, marginTop: 6 }}>
            Sent {formatDate(record.originalMessageSentAt)}
          </div>
        </div>

        {/* Timeline */}
        <div>
          <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, marginBottom: 14 }}>
            Follow-up Timeline
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {[1,2,3,4,5].map((num) => {
              const sent = num <= record.followUpsSent;
              const isCurrent = num === record.followUpsSent + 1;
              const scheduledAt = new Date(
                new Date(record.originalMessageSentAt).getTime() + FOLLOWUP_HOURS[num - 1] * 3_600_000
              ).toISOString();

              return (
                <div key={num} style={{ display: "flex", alignItems: "center", gap: 12, opacity: sent || isCurrent ? 1 : 0.35 }}>
                  <div style={{
                    width: 30, height: 30, borderRadius: "50%", flexShrink: 0,
                    background: sent ? "rgba(16,185,129,0.12)" : isCurrent ? `${accentColor}18` : "rgba(255,255,255,0.05)",
                    border: `1.5px solid ${sent ? "#10b981" : isCurrent ? accentColor : "rgba(255,255,255,0.1)"}`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    {sent ? (
                      <CheckCircle2 size={14} color="#10b981" />
                    ) : (
                      <span style={{ color: isCurrent ? accentColor : "rgba(255,255,255,0.25)", fontSize: 11, fontWeight: 700 }}>{num}</span>
                    )}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ color: sent ? "rgba(255,255,255,0.75)" : isCurrent ? "#fff" : "rgba(255,255,255,0.3)", fontSize: 13, fontWeight: isCurrent ? 600 : 400 }}>
                      Follow-up #{num} · {SCHEDULE_LABELS[num - 1]}
                      {isCurrent && <span style={{ marginLeft: 8, background: `${accentColor}20`, color: accentColor, fontSize: 10, padding: "2px 7px", borderRadius: 5, fontWeight: 700 }}>NEXT</span>}
                    </div>
                    <div style={{ color: "rgba(255,255,255,0.2)", fontSize: 11, marginTop: 2 }}>
                      {sent ? `Sent around ${formatDate(scheduledAt)}` : `Scheduled for ${formatDate(scheduledAt)}`}
                    </div>
                  </div>
                  {sent && <CheckCircle2 size={13} color="#10b981" />}
                </div>
              );
            })}
          </div>
        </div>

        {record.replyReceived && (
          <div style={{
            background: "rgba(16,185,129,0.07)", border: "1px solid rgba(16,185,129,0.2)",
            borderRadius: 10, padding: 12, display: "flex", alignItems: "center", gap: 8,
          }}>
            <CheckCircle2 size={15} color="#10b981" />
            <div style={{ color: "#10b981", fontSize: 13, fontWeight: 600 }}>
              Reply received {record.replyReceivedAt ? `on ${formatDate(record.replyReceivedAt)}` : ""}
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {record.status === "active" && (
            <button onClick={() => { onAction(record._id, "pause"); onClose(); }} style={actionBtn("#f59e0b")}>
              <Pause size={11} /> Pause
            </button>
          )}
          {record.status === "paused" && (
            <button onClick={() => { onAction(record._id, "resume"); onClose(); }} style={actionBtn("#10b981")}>
              <Play size={11} /> Resume
            </button>
          )}
          {(record.status === "active" || record.status === "paused") && (
            <button onClick={() => { onAction(record._id, "stop"); onClose(); }} style={actionBtn("#ef4444")}>
              <StopCircle size={11} /> Stop
            </button>
          )}
          {record.status !== "replied" && (
            <button onClick={() => { onAction(record._id, "mark-replied"); onClose(); }} style={actionBtn("#3b82f6")}>
              <CheckCircle2 size={11} /> Mark Replied
            </button>
          )}
          <button onClick={() => { onAction(record._id, "restart"); onClose(); }} style={actionBtn("#8b5cf6")}>
            <RotateCcw size={11} /> Restart
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main FollowUpManager Component ─────────────────────────────────────────

export function FollowUpManager({ botName, accentColor }: Props) {
  const [section, setSection] = useState<"tracking" | "rules" | "templates">("tracking");
  const [records, setRecords] = useState<FollowUpRecord[]>([]);
  const [stats, setStats] = useState<Stats>({ active: 0, repliedToday: 0, overdue: 0, paused: 0 });
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | FollowUpRecord["status"]>("all");
  const [historyRecord, setHistoryRecord] = useState<FollowUpRecord | null>(null);
  const [sendRecord, setSendRecord] = useState<FollowUpRecord | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [runningNow, setRunningNow] = useState(false);

  // Templates
  const [templates, setTemplates] = useState<FollowUpTemplate[]>([]);
  const [savingTemplate, setSavingTemplate] = useState<number | null>(null);
  const [templateEdits, setTemplateEdits] = useState<Record<number, string>>({});

  // Rules
  const [rules, setRules] = useState<FollowUpRule[]>([]);
  const [newRuleValue, setNewRuleValue] = useState("");
  const [newRuleType, setNewRuleType] = useState<"keyword" | "phrase">("keyword");
  const [addingRule, setAddingRule] = useState(false);

  // Deletion modals
  const [deleteRecordId, setDeleteRecordId] = useState<string | null>(null);
  const [deleteRuleId, setDeleteRuleId] = useState<string | null>(null);

  // Toast
  const TOAST_DURATION = 3500;
  const [toast, setToast] = useState<{ msg: string; ok: boolean; id: number } | null>(null);
  const [toastProgress, setToastProgress] = useState(100);

  const showToast = useCallback((msg: string, ok = true) => {
    const id = Date.now();
    setToast({ msg, ok, id });
    setToastProgress(100);

    // Animate progress bar down to 0 over TOAST_DURATION
    const step = 50; // ms per tick
    const decrement = (step / TOAST_DURATION) * 100;
    let current = 100;
    const ticker = setInterval(() => {
      current -= decrement;
      setToastProgress(Math.max(0, current));
    }, step);

    setTimeout(() => {
      clearInterval(ticker);
      setToast(null);
      setToastProgress(100);
    }, TOAST_DURATION);
  }, []);

  const cardBg  = "rgba(255,255,255,0.03)";
  const border  = "rgba(255,255,255,0.08)";
  const a22     = accentColor + "22";
  const a44     = accentColor + "44";

  // ── Data loading ──────────────────────────────────────────────────────────

  const loadRecords = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ botName });
      if (statusFilter !== "all") p.set("status", statusFilter);
      const res = await fetch(`/api/follow-up?${p}`);
      const data = await res.json();
      if (data.success) { setRecords(data.records); setStats(data.stats); }
    } finally { setLoading(false); }
  }, [botName, statusFilter]);

  const loadTemplates = useCallback(async () => {
    const res = await fetch(`/api/follow-up/templates?botName=${botName}`);
    const data = await res.json();
    if (data.success) {
      setTemplates(data.templates);
      const edits: Record<number, string> = {};
      data.templates.forEach((t: FollowUpTemplate) => { edits[t.followUpNumber] = t.messageText; });
      setTemplateEdits(edits);
    }
  }, [botName]);

  const loadRules = useCallback(async () => {
    const res = await fetch(`/api/follow-up/rules?botName=${botName}`);
    const data = await res.json();
    if (data.success) setRules(data.rules);
  }, [botName]);

  useEffect(() => { loadRecords(); }, [loadRecords]);
  useEffect(() => { if (section === "templates") loadTemplates(); }, [section, loadTemplates]);
  useEffect(() => { if (section === "rules") loadRules(); }, [section, loadRules]);

  // ── Actions ───────────────────────────────────────────────────────────────

  const doAction = async (id: string, action: string) => {
    await fetch("/api/follow-up", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action }),
    });
    loadRecords();
  };

  const deleteRecord = async (id: string) => {
    await fetch(`/api/follow-up?id=${id}`, { method: "DELETE" });
    setRecords((p) => p.filter((r) => r._id !== id));
  };

  const runNow = async () => {
    setRunningNow(true);
    try {
      const res = await fetch("/api/follow-up/cron", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "run-now", botName }),
      });
      const data = await res.json();
      showToast(data.message || "Check complete.", data.success);
      loadRecords();
    } finally { setRunningNow(false); }
  };

  const saveTemplate = async (followUpNumber: number) => {
    setSavingTemplate(followUpNumber);
    try {
      await fetch("/api/follow-up/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botName, followUpNumber, messageText: templateEdits[followUpNumber] }),
      });
      await loadTemplates();
      showToast(`Template #${followUpNumber} saved.`);
    } finally { setSavingTemplate(null); }
  };

  const addRule = async () => {
    if (!newRuleValue.trim()) return;
    setAddingRule(true);
    try {
      const res = await fetch("/api/follow-up/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botName, type: newRuleType, value: newRuleValue.trim() }),
      });
      const data = await res.json();
      if (data.duplicate) showToast("Rule already exists.", false);
      else showToast("Rule added.");
      setNewRuleValue("");
      loadRules();
    } finally { setAddingRule(false); }
  };

  const toggleRule = async (id: string, enabled: boolean) => {
    await fetch("/api/follow-up/rules", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, enabled }),
    });
    setRules((p) => p.map((r) => (r._id === id ? { ...r, enabled } : r)));
  };

  const deleteRule = async (id: string) => {
    await fetch(`/api/follow-up/rules?id=${id}`, { method: "DELETE" });
    setRules((p) => p.filter((r) => r._id !== id));
  };

  // ── Section tabs ──────────────────────────────────────────────────────────

  const sectionTabs = [
    { id: "tracking" as const, label: "Active Tracking", icon: <Clock size={13} /> },
    { id: "rules"    as const, label: "Reply Rules",     icon: <Settings size={13} /> },
    { id: "templates"as const, label: "Templates",       icon: <MessageSquare size={13} /> },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* ── Toast portal — mounts directly on <body> so fixed pos is always viewport ── */}
      {toast && typeof document !== "undefined" && createPortal(
        <>
          <style>{`
            @keyframes fu-toast-in {
              from { opacity:0; transform:translateY(16px) scale(0.95); }
              to   { opacity:1; transform:translateY(0)    scale(1);    }
            }
          `}</style>
          <div
            key={toast.id}
            style={{
              position: "fixed",
              bottom: 28,
              right: 28,
              zIndex: 99999,
              minWidth: 300,
              maxWidth: 400,
              borderRadius: 16,
              overflow: "hidden",
              animation: "fu-toast-in 0.3s cubic-bezier(0.34,1.56,0.64,1) both",
              boxShadow: toast.ok
                ? "0 16px 48px rgba(0,0,0,0.6), 0 0 0 1px rgba(16,185,129,0.25)"
                : "0 16px 48px rgba(0,0,0,0.6), 0 0 0 1px rgba(239,68,68,0.25)",
              backdropFilter: "blur(24px)",
              background: toast.ok ? "rgba(8,20,16,0.97)" : "rgba(22,8,8,0.97)",
            }}
          >
            {/* Body */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 14px 14px 16px" }}>
              <div style={{
                width: 34, height: 34, borderRadius: "50%", flexShrink: 0,
                background: toast.ok ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.15)",
                border: `1.5px solid ${toast.ok ? "rgba(16,185,129,0.35)" : "rgba(239,68,68,0.35)"}`,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {toast.ok
                  ? <CheckCircle2 size={16} color="#10b981" />
                  : <AlertCircle  size={16} color="#ef4444" />}
              </div>

              <span style={{
                flex: 1, fontSize: 13, fontWeight: 600, lineHeight: 1.45,
                color: toast.ok ? "#d1fae5" : "#fee2e2",
              }}>
                {toast.msg}
              </span>

              <button
                onClick={() => setToast(null)}
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  color: "rgba(255,255,255,0.3)", padding: "3px", flexShrink: 0,
                  display: "flex", alignItems: "center",
                  transition: "color 0.15s",
                }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.7)")}
                onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.3)")}
              >
                <X size={15} />
              </button>
            </div>

            {/* Countdown progress bar */}
            <div style={{ height: 3, background: "rgba(255,255,255,0.05)" }}>
              <div style={{
                height: "100%",
                width: `${toastProgress}%`,
                transition: "width 50ms linear",
                background: toast.ok
                  ? "linear-gradient(90deg, #059669, #10b981, #34d399)"
                  : "linear-gradient(90deg, #dc2626, #ef4444, #f87171)",
              }} />
            </div>
          </div>
        </>,
        document.body
      )}

      <style>{`
        .fu-input {
          transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .fu-input:hover {
          background: rgba(255, 255, 255, 0.08) !important;
          border-color: rgba(255, 255, 255, 0.15) !important;
        }
        .fu-input:focus {
          background: rgba(255, 255, 255, 0.09) !important;
          border-color: ${accentColor} !important;
          box-shadow: 0 0 0 3px ${accentColor}18;
          transform: translateY(-1px);
        }
        .fu-btn {
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .fu-btn:hover:not(:disabled) {
          transform: translateY(-1px);
          filter: brightness(1.15);
          box-shadow: 0 4px 12px ${accentColor}25;
        }
        .fu-btn:active:not(:disabled) {
          transform: translateY(0);
        }
        .fu-card {
          transition: all 0.3s ease;
        }
        .fu-card:hover {
          border-color: rgba(255, 255, 255, 0.15) !important;
          background: rgba(255, 255, 255, 0.045) !important;
          transform: translateY(-2px);
          box-shadow: 0 8px 24px rgba(0,0,0,0.2);
        }
        select option {
          background: #12141f;
          color: white;
        }
      `}</style>

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Clock size={18} color={accentColor} />
          <span style={{ color: "rgba(255,255,255,0.9)", fontWeight: 700, fontSize: 15 }}>Follow-up Manager</span>
          <span style={{
            background: "rgba(16,185,129,0.12)", color: "#10b981",
            fontSize: 10, fontWeight: 700, borderRadius: 20, padding: "2px 9px",
            display: "flex", alignItems: "center", gap: 4,
          }}>
            <Zap size={9} fill="#10b981" /> AUTO · runs with inbox cron
          </span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={runNow}
            disabled={runningNow}
            style={{
              background: a22, border: `1px solid ${a44}`,
              borderRadius: 8, padding: "7px 14px", cursor: "pointer",
              color: accentColor, fontSize: 12, fontWeight: 600,
              display: "flex", alignItems: "center", gap: 6,
              opacity: runningNow ? 0.6 : 1,
            }}
          >
            <RefreshCw size={12} style={{ animation: runningNow ? "spin 0.8s linear infinite" : "none" }} />
            {runningNow ? "Checking…" : "Run Check Now"}
          </button>
          <button
            onClick={loadRecords}
            disabled={loading}
            style={{
              background: "rgba(255,255,255,0.04)", border: `1px solid ${border}`,
              borderRadius: 8, padding: "7px 10px", cursor: "pointer",
              color: "rgba(255,255,255,0.4)", display: "flex", alignItems: "center",
            }}
          >
            <RefreshCw size={12} style={{ animation: loading ? "spin 1s linear infinite" : "none" }} />
          </button>
        </div>
      </div>

      {/* ── Stats bar ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
        {([
          { label: "Active Threads",  value: stats.active,      color: "#10b981", bg: "rgba(16,185,129,0.07)" },
          { label: "Replied Today",   value: stats.repliedToday, color: "#3b82f6", bg: "rgba(59,130,246,0.07)" },
          { label: "No Reply (Final)", value: stats.overdue,    color: "#8b5cf6", bg: "rgba(139,92,246,0.07)" },
          { label: "Paused",          value: stats.paused,      color: "#f59e0b", bg: "rgba(245,158,11,0.07)" },
        ] as const).map((s) => (
          <div key={s.label} style={{
            background: s.bg, border: `1px solid ${s.color}22`,
            borderRadius: 14, padding: "14px 16px",
          }}>
            <div style={{ color: s.color, fontSize: 26, fontWeight: 800, lineHeight: 1 }}>{s.value}</div>
            <div style={{ color: "rgba(255,255,255,0.35)", fontSize: 11, marginTop: 5 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* ── Section tabs ── */}
      <div style={{ display: "flex", gap: 6 }}>
        {sectionTabs.map((t) => (
          <button key={t.id} onClick={() => setSection(t.id)} style={{
            background: section === t.id ? a22 : "rgba(255,255,255,0.03)",
            border: `1px solid ${section === t.id ? a44 : border}`,
            borderRadius: 9, padding: "7px 15px", cursor: "pointer",
            color: section === t.id ? accentColor : "rgba(255,255,255,0.4)",
            fontSize: 12, fontWeight: 600,
            display: "flex", alignItems: "center", gap: 6,
          }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* ══ TRACKING TABLE ══ */}
      {section === "tracking" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Status filter chips */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {(["all", "active", "paused", "stopped", "completed", "replied"] as const).map((f) => {
              const col = f === "all" ? accentColor : STATUS_COLOR[f];
              return (
                <button key={f} onClick={() => setStatusFilter(f)} style={{
                  background: statusFilter === f ? `${col}18` : "rgba(255,255,255,0.03)",
                  border: `1px solid ${statusFilter === f ? col + "44" : border}`,
                  borderRadius: 7, padding: "4px 12px", cursor: "pointer",
                  color: statusFilter === f ? col : "rgba(255,255,255,0.3)",
                  fontSize: 11, fontWeight: 700, textTransform: "capitalize",
                }}>
                  {f === "all" ? "All" : STATUS_LABEL[f]}
                </button>
              );
            })}
          </div>

          {loading && records.length === 0 ? (
            <div style={{ textAlign: "center", color: "rgba(255,255,255,0.25)", padding: 40, fontSize: 13 }}>
              Loading…
            </div>
          ) : records.length === 0 ? (
            <div style={{
              background: cardBg, border: `1px dashed ${border}`,
              borderRadius: 14, padding: 40, textAlign: "center",
              color: "rgba(255,255,255,0.2)", fontSize: 13,
            }}>
              No follow-up threads found. They&apos;re created automatically when a bot sends an &ldquo;expecting reply&rdquo; message.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {records.map((r) => {
                const sc = STATUS_COLOR[r.status] ?? "#888";
                const isExpanded = expandedId === r._id;
                const isOverdue  = r.status === "active" && r.nextFollowupScheduledAt < new Date().toISOString() && r.followUpsSent < 5;
                const canSend    = (r.status === "active" || r.status === "paused") && r.followUpsSent < 5;

                return (
                  <div key={r._id} className="fu-card" style={{
                    background: isOverdue ? "rgba(239,68,68,0.03)" : cardBg,
                    border: `1px solid ${isOverdue ? "rgba(239,68,68,0.2)" : border}`,
                    borderRadius: 16, overflow: "hidden",
                  }}>
                    {/* Main row */}
                    <div style={{ padding: "14px 18px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                      
                      {/* Avatar */}
                      <div style={{
                        width: 40, height: 40, borderRadius: 12, flexShrink: 0,
                        background: `${sc}12`, border: `1px solid ${sc}25`,
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}>
                        <User size={18} color={sc} />
                      </div>

                      {/* Name + contact */}
                      <div style={{ flex: "1 1 140px", minWidth: 0 }}>
                        <div style={{ color: "rgba(255,255,255,0.95)", fontWeight: 700, fontSize: 13.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {r.userName}
                        </div>
                        {r.contactInfo && (
                          <div style={{ color: "rgba(255,255,255,0.35)", fontSize: 11.5, marginTop: 1 }}>{r.contactInfo}</div>
                        )}
                      </div>

                      {/* Status badge */}
                      <span style={{
                        background: `${sc}12`, border: `1px solid ${sc}25`, color: sc,
                        fontSize: 10, fontWeight: 800, borderRadius: 8, padding: "3px 10px",
                        textTransform: "uppercase", flexShrink: 0, letterSpacing: 0.5,
                      }}>
                        {STATUS_LABEL[r.status]}
                      </span>

                      {/* Progress bar + count */}
                      <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 5 }}>
                        <div style={{ display: "flex", gap: 4 }}>
                          {[1,2,3,4,5].map((n) => (
                            <div key={n} style={{
                              width: 6, height: 6, borderRadius: "50%",
                              background: n <= r.followUpsSent ? "#10b981" : "rgba(255,255,255,0.12)",
                              boxShadow: n <= r.followUpsSent ? "0 0 8px rgba(16,185,129,0.3)" : "none",
                            }} />
                          ))}
                        </div>
                        <div style={{ color: "rgba(255,255,255,0.25)", fontSize: 10, fontWeight: 600 }}>
                          {r.followUpsSent}/5 sent
                        </div>
                      </div>

                      {/* Next follow-up */}
                      <div style={{ flexShrink: 0, textAlign: "right", minWidth: 90 }}>
                        {r.status === "active" && r.followUpsSent < 5 ? (
                          <>
                            <div style={{ color: isOverdue ? "#ef4444" : "rgba(255,255,255,0.7)", fontSize: 13, fontWeight: 700 }}>
                              {isOverdue
                                ? "Overdue"
                                : new Date(r.nextFollowupScheduledAt) > new Date()
                                  ? formatRelative(r.nextFollowupScheduledAt)
                                  : "Due now"}
                            </div>
                            <div style={{ color: "rgba(255,255,255,0.2)", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>next follow-up</div>
                          </>
                        ) : (
                          <div style={{ color: "rgba(255,255,255,0.15)", fontSize: 12, fontWeight: 600 }}>
                            {r.status === "replied" ? "✓ Replied" : "Archived"}
                          </div>
                        )}
                      </div>

                      {/* Action buttons */}
                      <div style={{ display: "flex", gap: 6, flexShrink: 0, marginLeft: "auto", flexWrap: "wrap", alignItems: "center" }}>
                        {r.status === "active"  && <button onClick={() => doAction(r._id, "pause")}  title="Pause"  className="fu-btn" style={iconBtn("#f59e0b")}><Pause      size={12} /></button>}
                        {r.status === "paused"  && <button onClick={() => doAction(r._id, "resume")} title="Resume" className="fu-btn" style={iconBtn("#10b981")}><Play       size={12} /></button>}
                        {canSend && (
                          <button
                            onClick={() => setSendRecord(r)}
                            title="Send Follow-up Now"
                            className="fu-btn"
                            style={{
                              ...iconBtn(accentColor),
                              background: `${accentColor}18`, border: `1px solid ${accentColor}40`,
                              gap: 6, padding: "5px 12px", borderRadius: 9,
                            }}
                          >
                            <Send size={12} strokeWidth={2.5} />
                            <span style={{ fontSize: 11, fontWeight: 800 }}>SEND NOW</span>
                          </button>
                        )}
                        {(r.status === "active" || r.status === "paused") && (
                          <button onClick={() => doAction(r._id, "stop")} title="Stop" className="fu-btn" style={iconBtn("#ef4444")}><StopCircle size={12} /></button>
                        )}
                        <button onClick={() => doAction(r._id, "mark-replied")} title="Mark Replied" className="fu-btn" style={iconBtn("#3b82f6")}><CheckCircle2 size={12} /></button>
                        <button onClick={() => setHistoryRecord(r)} title="View History"             className="fu-btn" style={iconBtn("rgba(255,255,255,0.35)")}><History size={12} /></button>
                        <button onClick={() => setExpandedId(isExpanded ? null : r._id)} title="Expand" className="fu-btn" style={{ ...iconBtn("rgba(255,255,255,0.25)"), background: isExpanded ? "rgba(255,255,255,0.1)" : "transparent" }}>
                          {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                        </button>
                      </div>
                    </div>

                    {/* Expanded detail */}
                    {isExpanded && (
                      <div style={{
                        borderTop: `1px solid ${border}`, padding: "16px 18px",
                        background: "rgba(255,255,255,0.012)",
                        display: "flex", flexDirection: "column", gap: 12,
                      }}>
                        <div style={{ color: "rgba(255,255,255,0.25)", fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: 1 }}>
                          Original Message
                        </div>
                        <div style={{
                          color: "rgba(255,255,255,0.6)", fontSize: 12.5, lineHeight: 1.7,
                          borderLeft: `2.5px solid ${accentColor}40`, paddingLeft: 16,
                          fontStyle: "italic",
                        }}>
                          &ldquo;{r.originalMessageText}&rdquo;
                        </div>
                        <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginTop: 4 }}>
                          <div style={{ color: "rgba(255,255,255,0.25)", fontSize: 11 }}>
                            Sent: <span style={{ color: "rgba(255,255,255,0.6)", fontWeight: 600 }}>{formatDate(r.originalMessageSentAt)}</span>
                          </div>
                          {r.lastFollowupSentAt && (
                            <div style={{ color: "rgba(255,255,255,0.25)", fontSize: 11 }}>
                              Last follow-up: <span style={{ color: "rgba(255,255,255,0.6)", fontWeight: 600 }}>{formatDate(r.lastFollowupSentAt)}</span>
                            </div>
                          )}
                        </div>
                        {r.notes && <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 12, fontStyle: "italic", background: "rgba(255,255,255,0.03)", padding: "8px 12px", borderRadius: 8 }}>{r.notes}</div>}
                        <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
                          <button onClick={() => doAction(r._id, "restart")} className="fu-btn" style={{ ...actionBtn("#8b5cf6"), borderRadius: 10, padding: "8px 16px" }}><RotateCcw size={12} strokeWidth={2.5} /> Restart Sequence</button>
                          <button onClick={() => setDeleteRecordId(r._id)}         className="fu-btn" style={{ ...actionBtn("#ef4444"), borderRadius: 10, padding: "8px 16px" }}><Trash2    size={12} strokeWidth={2.5} /> Delete Thread</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ══ RULES ══ */}
      {section === "rules" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{
            background: "rgba(255,255,255,0.025)", border: `1px solid ${border}`,
            borderRadius: 12, padding: "13px 16px", fontSize: 12,
            color: "rgba(255,255,255,0.4)", lineHeight: 1.65,
          }}>
            Define keywords or phrases that, when present in a <em>sent</em> message, automatically start a follow-up sequence for that user.
            <br />Example: <code style={{ color: accentColor }}>can you confirm</code>, <code style={{ color: accentColor }}>please let me know</code>, <code style={{ color: accentColor }}>waiting to hear</code>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", background: "rgba(255,255,255,0.02)", padding: 12, borderRadius: 14, border: `1px solid ${border}` }}>
            <div style={{ position: "relative", flexShrink: 0 }}>
              <select
                value={newRuleType}
                onChange={(e) => setNewRuleType(e.target.value as any)}
                className="fu-input"
                style={{
                  background: "rgba(255,255,255,0.05)", border: `1px solid ${border}`,
                  borderRadius: 10, padding: "9px 32px 9px 14px", color: "rgba(255,255,255,0.9)",
                  fontSize: 13, cursor: "pointer", outline: "none",
                  appearance: "none", colorScheme: "dark",
                  fontWeight: 600,
                }}
              >
                <option value="keyword">Keyword</option>
                <option value="phrase">Phrase</option>
              </select>
              <ChevronDown size={14} style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", opacity: 0.4 }} />
            </div>
            
            <input
              value={newRuleValue}
              onChange={(e) => setNewRuleValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addRule()}
              placeholder={newRuleType === "keyword" ? "Enter keyword..." : "Enter phrase to match..."}
              className="fu-input"
              style={{
                flex: 1, minWidth: 200,
                background: "rgba(255,255,255,0.05)", border: `1px solid ${border}`,
                borderRadius: 10, padding: "9px 15px", color: "rgba(255,255,255,0.95)",
                fontSize: 13, outline: "none",
              }}
            />
            
            <button
              onClick={addRule}
              disabled={addingRule || !newRuleValue.trim()}
              className="fu-btn"
              style={{
                ...actionBtn(accentColor),
                opacity: !newRuleValue.trim() ? 0.4 : 1, 
                padding: "10px 20px",
                borderRadius: 10,
                background: accentColor,
                color: "#fff",
                border: "none",
              }}
            >
              {addingRule ? (
                <RefreshCw size={14} className="animate-spin" />
              ) : (
                <Plus size={15} strokeWidth={2.5} />
              ) }
              Add Rule
            </button>
          </div>

          {rules.length === 0 ? (
            <div style={{
              background: "rgba(255,255,255,0.015)", border: `1px dashed ${border}`,
              borderRadius: 16, padding: "60px 24px", textAlign: "center",
              display: "flex", flexDirection: "column", alignItems: "center", gap: 14,
            }}>
              <div style={{
                width: 48, height: 48, borderRadius: 16,
                background: "rgba(255,255,255,0.03)", border: `1px solid ${border}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                color: "rgba(255,255,255,0.15)", marginBottom: 4,
                transform: "rotate(-5deg)",
              }}>
                <Settings size={24} />
              </div>
              <div>
                <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 15, fontWeight: 700, marginBottom: 4 }}>No auto-rules defined</div>
                <div style={{ color: "rgba(255,255,255,0.2)", fontSize: 13, maxWidth: 320, margin: "0 auto", lineHeight: 1.6 }}>
                  Define triggers that start follow-up sequences automatically when you send a message.
                </div>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {rules.map((rule) => (
                <div key={rule._id} className="fu-card" style={{
                  background: cardBg, border: `1px solid ${border}`,
                  borderRadius: 12, padding: "12px 16px",
                  display: "flex", alignItems: "center", gap: 14,
                  opacity: rule.enabled ? 1 : 0.5,
                }}>
                  <div style={{
                    background: rule.type === "phrase" ? `${accentColor}15` : "rgba(255,255,255,0.06)", 
                    borderRadius: 6,
                    padding: "3px 8px", 
                    fontSize: 10,
                    color: rule.type === "phrase" ? accentColor : "rgba(255,255,255,0.4)", 
                    textTransform: "uppercase", 
                    fontWeight: 800, 
                    flexShrink: 0,
                    letterSpacing: 0.5,
                  }}>
                    {rule.type}
                  </div>
                  <span style={{ flex: 1, color: "rgba(255,255,255,0.85)", fontSize: 14, fontWeight: 500 }}>{rule.value}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <button 
                      onClick={() => toggleRule(rule._id, !rule.enabled)} 
                      style={{ 
                        background: "none", border: "none", cursor: "pointer", 
                        color: rule.enabled ? "#10b981" : "rgba(255,255,255,0.15)", 
                        padding: 4, display: "flex", alignItems: "center",
                        transition: "all 0.2s ease",
                      }}
                    >
                      {rule.enabled ? <ToggleRight size={24} /> : <ToggleLeft size={24} />}
                    </button>
                    <div style={{ width: 1, height: 16, background: "rgba(255,255,255,0.08)", margin: "0 4px" }} />
                    <button 
                      onClick={() => setDeleteRuleId(rule._id)} 
                      className="fu-btn"
                      style={{ 
                        background: "rgba(239, 68, 68, 0.1)", border: "1px solid rgba(239, 68, 68, 0.2)",
                        borderRadius: 7, cursor: "pointer", color: "#ef4444", padding: 6,
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ══ TEMPLATES ══ */}
      {section === "templates" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{
            background: "rgba(255,255,255,0.025)", border: `1px solid ${border}`,
            borderRadius: 12, padding: "13px 16px", fontSize: 12,
            color: "rgba(255,255,255,0.4)", lineHeight: 1.65,
          }}>
            Customize what each follow-up step says. Variables:&nbsp;
            <code style={{ color: accentColor }}>{"{{user_name}}"}</code>,&nbsp;
            <code style={{ color: accentColor }}>{"{{original_message}}"}</code>,&nbsp;
            <code style={{ color: accentColor }}>{"{{days_waiting}}"}</code>
          </div>

          {[1,2,3,4,5].map((num) => {
            const t = templates.find((x) => x.followUpNumber === num);
            const isSaving = savingTemplate === num;

            return (
              <div key={num} className="fu-card" style={{
                background: cardBg, border: `1px solid ${border}`,
                borderRadius: 16, overflow: "hidden",
                boxShadow: "0 4px 16px rgba(0,0,0,0.1)",
              }}>
                <div style={{
                  padding: "14px 18px",
                  background: "rgba(255,255,255,0.025)",
                  borderBottom: `1px solid ${border}`,
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{
                      width: 30, height: 30, borderRadius: 10, flexShrink: 0,
                      background: a22, border: `1px solid ${a44}`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      color: accentColor, fontSize: 12, fontWeight: 800,
                      boxShadow: `0 0 12px ${accentColor}20`,
                    }}>
                      {num}
                    </div>
                    <div>
                      <span style={{ color: "rgba(255,255,255,0.95)", fontWeight: 700, fontSize: 13.5 }}>
                        Follow-up #{num}
                      </span>
                      <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 12, marginLeft: 10, fontWeight: 500 }}>
                        {SCHEDULE_LABELS[num - 1]} delay
                      </span>
                    </div>
                  </div>
                  {t?._id && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <CheckCircle2 size={10} color="#10b981" />
                      <span style={{ color: "rgba(255,255,255,0.2)", fontSize: 10, fontWeight: 600, textTransform: "uppercase" }}>
                        Saved {formatRelative(t.updatedAt, true)}
                      </span>
                    </div>
                  )}
                </div>

                <div style={{ padding: "18px", display: "flex", flexDirection: "column", gap: 14 }}>
                  <textarea
                    value={templateEdits[num] ?? ""}
                    onChange={(e) => setTemplateEdits((p) => ({ ...p, [num]: e.target.value }))}
                    rows={4}
                    className="fu-input"
                    style={{
                      background: "rgba(255,255,255,0.03)", border: `1px solid ${border}`,
                      borderRadius: 12, padding: "12px 16px",
                      color: "rgba(255,255,255,0.9)", fontSize: 13.5, lineHeight: 1.6,
                      resize: "vertical", outline: "none",
                      width: "100%", boxSizing: "border-box", fontFamily: "inherit",
                    }}
                    placeholder="Type your follow-up message template..."
                  />
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ color: "rgba(255,255,255,0.15)", fontSize: 11, fontStyle: "italic" }}>
                     Variables allowed: {"{{user_name}}"}, {"{{days_waiting}}"}, ...
                    </div>
                    <button
                      onClick={() => saveTemplate(num)}
                      disabled={isSaving}
                      className="fu-btn"
                      style={{ 
                        ...actionBtn(accentColor), 
                        background: accentColor,
                        color: "#fff",
                        border: "none",
                        padding: "10px 24px",
                        borderRadius: 10,
                        opacity: isSaving ? 0.6 : 1,
                        fontSize: 13,
                        fontWeight: 700,
                      }}
                    >
                      {isSaving ? <RefreshCw size={13} className="animate-spin" /> : <Save size={14} />} 
                      {isSaving ? "Saving..." : "Save Template"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Modals ── */}
      {historyRecord && (
        <HistoryModal
          record={historyRecord}
          accentColor={accentColor}
          onClose={() => setHistoryRecord(null)}
          onAction={(id, action) => { doAction(id, action); setHistoryRecord(null); }}
        />
      )}

      {sendRecord && (
        <ManualSendDialog
          record={sendRecord}
          templates={templates}
          accentColor={accentColor}
          onClose={() => setSendRecord(null)}
          onSent={() => { loadRecords(); showToast("Follow-up sent successfully!"); }}
        />
      )}

      {/* ══ Confirm Modals ══ */}
      <ConfirmModal
        isOpen={!!deleteRecordId}
        onClose={() => setDeleteRecordId(null)}
        onConfirm={() => deleteRecordId && deleteRecord(deleteRecordId)}
        title="Delete Follow-up Thread"
        message="Are you sure you want to delete this thread? All tracking history, scheduled follow-ups, and logs will be permanently removed. This action cannot be undone."
        color={accentColor}
      />

      <ConfirmModal
        isOpen={!!deleteRuleId}
        onClose={() => setDeleteRuleId(null)}
        onConfirm={() => deleteRuleId && deleteRule(deleteRuleId)}
        title="Delete Rule"
        message="Are you sure you want to delete this keyword rule? This action cannot be undone."
        color={accentColor}
      />
    </div>
  );
}
