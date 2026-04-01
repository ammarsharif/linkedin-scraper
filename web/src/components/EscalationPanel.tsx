"use client";

import { useState, useEffect, useCallback } from "react";
import { AlertTriangle, CheckCircle, Bell, RefreshCw, User } from "lucide-react";

interface Escalation {
  _id: string;
  botId: string;
  platform: string;
  conversationId: string;
  senderName: string;
  senderUsername?: string;
  lastMessage: string;
  reason: string;
  status: "pending" | "resolved" | "reminded";
  createdAt: string;
  resolvedAt?: string;
  reminderSentAt?: string;
}

interface Props {
  botId: "cindy" | "felix" | "xavier" | "instar";
  accentColor: string;
}

export function EscalationPanel({ botId, accentColor }: Props) {
  const [escalations, setEscalations] = useState<Escalation[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<"all" | "pending" | "reminded" | "resolved">("pending");

  const cardBg = "rgba(255,255,255,0.04)";
  const borderColor = "rgba(255,255,255,0.08)";
  const accentAlpha = accentColor + "22";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ botId });
      if (filter !== "all") params.set("status", filter);
      const res = await fetch(`/api/escalation?${params}`);
      const data = await res.json();
      if (data.success) setEscalations(data.escalations);
    } finally {
      setLoading(false);
    }
  }, [botId, filter]);

  useEffect(() => { load(); }, [load]);

  const resolve = async (id: string) => {
    await fetch("/api/escalation", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: "resolved" }),
    });
    setEscalations((prev) =>
      prev.map((e) => (e._id === id ? { ...e, status: "resolved", resolvedAt: new Date().toISOString() } : e))
    );
  };

  const statusColor: Record<string, string> = {
    pending: "#f59e0b",
    reminded: "#ec4899",
    resolved: "#10b981",
  };

  const statusIcon: Record<string, React.ReactNode> = {
    pending: <AlertTriangle size={12} />,
    reminded: <Bell size={12} />,
    resolved: <CheckCircle size={12} />,
  };

  const pending = escalations.filter((e) => e.status === "pending" || e.status === "reminded").length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <AlertTriangle size={18} color="#f59e0b" />
          <span style={{ color: "rgba(255,255,255,0.9)", fontWeight: 600, fontSize: 15 }}>
            Escalations
          </span>
          {pending > 0 && (
            <span style={{
              background: "rgba(245,158,11,0.2)", color: "#f59e0b",
              fontSize: 11, fontWeight: 700, borderRadius: 20, padding: "2px 8px",
            }}>{pending} need attention</span>
          )}
        </div>
        <button
          onClick={load}
          disabled={loading}
          style={{
            background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 8, padding: "6px 10px", cursor: "pointer",
            color: "rgba(255,255,255,0.5)", display: "flex", alignItems: "center", gap: 6,
          }}
        >
          <RefreshCw size={13} style={{ animation: loading ? "spin 1s linear infinite" : "none" }} />
          <span style={{ fontSize: 12 }}>Refresh</span>
        </button>
      </div>

      {/* Info box */}
      <div style={{
        background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.15)",
        borderRadius: 12, padding: "12px 16px", fontSize: 12, color: "rgba(255,255,255,0.5)",
        lineHeight: 1.6,
      }}>
        Escalations are created when the bot cannot confidently answer from the knowledge base.
        Resolve them by replying to the customer directly, then mark as resolved here.
        Escalations older than 12 hours are automatically reminded.
      </div>

      {/* Filter tabs */}
      <div style={{ display: "flex", gap: 6 }}>
        {(["all", "pending", "reminded", "resolved"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              background: filter === f ? accentAlpha : "rgba(255,255,255,0.04)",
              border: `1px solid ${filter === f ? accentColor + "44" : "rgba(255,255,255,0.08)"}`,
              borderRadius: 8, padding: "5px 12px", cursor: "pointer",
              color: filter === f ? accentColor : "rgba(255,255,255,0.4)",
              fontSize: 12, fontWeight: 600, textTransform: "capitalize",
            }}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Escalation list */}
      {loading && escalations.length === 0 ? (
        <div style={{ textAlign: "center", color: "rgba(255,255,255,0.3)", padding: 30, fontSize: 13 }}>
          Loading...
        </div>
      ) : escalations.length === 0 ? (
        <div style={{
          background: cardBg, border: `1px dashed ${borderColor}`,
          borderRadius: 14, padding: 30, textAlign: "center",
          color: "rgba(255,255,255,0.25)", fontSize: 13,
        }}>
          {filter === "pending" ? "No pending escalations. Bots are handling everything." : "No escalations found."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {escalations.map((esc) => (
            <div key={esc._id} style={{
              background: esc.status === "pending"
                ? "rgba(245,158,11,0.04)"
                : esc.status === "reminded"
                ? "rgba(236,72,153,0.04)"
                : cardBg,
              border: `1px solid ${
                esc.status === "pending"
                  ? "rgba(245,158,11,0.15)"
                  : esc.status === "reminded"
                  ? "rgba(236,72,153,0.15)"
                  : borderColor
              }`,
              borderRadius: 12, padding: 16,
            }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {/* Sender + status */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                    <div style={{
                      background: "rgba(255,255,255,0.08)", borderRadius: "50%",
                      width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center",
                      flexShrink: 0,
                    }}>
                      <User size={13} color="rgba(255,255,255,0.5)" />
                    </div>
                    <span style={{ color: "rgba(255,255,255,0.85)", fontWeight: 600, fontSize: 13 }}>
                      {esc.senderName}
                      {esc.senderUsername && esc.senderUsername !== esc.senderName && (
                        <span style={{ color: "rgba(255,255,255,0.35)", fontWeight: 400, marginLeft: 4 }}>
                          @{esc.senderUsername}
                        </span>
                      )}
                    </span>
                    <span style={{
                      background: (statusColor[esc.status] || "#888") + "22",
                      color: statusColor[esc.status] || "#888",
                      fontSize: 10, fontWeight: 700, borderRadius: 6,
                      padding: "2px 7px", display: "flex", alignItems: "center", gap: 4,
                      textTransform: "uppercase",
                    }}>
                      {statusIcon[esc.status]}
                      {esc.status}
                    </span>
                    <span style={{ color: "rgba(255,255,255,0.25)", fontSize: 11 }}>
                      {esc.platform} · {new Date(esc.createdAt).toLocaleString()}
                    </span>
                  </div>

                  {/* Last message */}
                  <div style={{
                    background: "rgba(255,255,255,0.04)", borderRadius: 8,
                    padding: "8px 12px", marginBottom: 8,
                    color: "rgba(255,255,255,0.55)", fontSize: 12, lineHeight: 1.5,
                    borderLeft: "2px solid rgba(255,255,255,0.1)",
                  }}>
                    <span style={{ color: "rgba(255,255,255,0.25)", fontSize: 10, fontWeight: 600, display: "block", marginBottom: 3 }}>
                      LAST MESSAGE
                    </span>
                    {esc.lastMessage.length > 150 ? esc.lastMessage.slice(0, 150) + "..." : esc.lastMessage}
                  </div>

                  {/* Reason */}
                  <div style={{ color: "rgba(245,158,11,0.7)", fontSize: 11, display: "flex", alignItems: "center", gap: 5 }}>
                    <AlertTriangle size={10} />
                    <span>Reason: {esc.reason}</span>
                  </div>

                  {esc.reminderSentAt && (
                    <div style={{ color: "rgba(236,72,153,0.6)", fontSize: 11, marginTop: 4, display: "flex", alignItems: "center", gap: 5 }}>
                      <Bell size={10} />
                      <span>Reminder sent at {new Date(esc.reminderSentAt).toLocaleString()}</span>
                    </div>
                  )}
                </div>

                {/* Resolve button */}
                {esc.status !== "resolved" && (
                  <button
                    onClick={() => resolve(esc._id)}
                    style={{
                      background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)",
                      borderRadius: 8, padding: "6px 12px", cursor: "pointer",
                      color: "#10b981", fontSize: 12, fontWeight: 600,
                      display: "flex", alignItems: "center", gap: 5, flexShrink: 0,
                      whiteSpace: "nowrap",
                    }}
                  >
                    <CheckCircle size={12} />
                    Resolve
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
