"use client";

import { useEffect, useRef, useState } from "react";

const POLL_INTERVAL_MS = 60_000;
const REMINDER_INTERVAL_MS = 12 * 60 * 60 * 1000;

const BOT_PATHS: Record<string, string> = {
  xavier: "/xavier",
  cindy: "/",
  instar: "/instar",
  felix: "/felix",
};

const BOT_LABELS: Record<string, string> = {
  xavier: "Twitter/X (Xavier)",
  cindy: "LinkedIn (Cindy)",
  instar: "Instagram (Instar)",
  felix: "Facebook (Felix)",
};

/**
 * EscalationNotifier — mounts globally, polls every 60s.
 *
 * Two-phase fetch to minimise server load:
 *   Phase 1 (every poll): GET /api/notification/status → returns counts + lastChangedAt.
 *                         Single indexed aggregation, <30ms. Skips Phase 2 if nothing changed.
 *   Phase 2 (only when lastChangedAt changes): fetch full escalation + session-alert data
 *                         to fire browser notifications and update the expired-session banner.
 */
export function EscalationNotifier() {
  const notifiedEscIds = useRef<Set<string>>(new Set());
  const notifiedSessionBots = useRef<Set<string>>(new Set());
  const permissionRequested = useRef(false);
  const lastReminderCheck = useRef(0);
  const lastChangedAt = useRef<string | null>(null);

  const [expiredSessions, setExpiredSessions] = useState<{ botId: string; platform: string }[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    // Restore deduplication state from localStorage
    try {
      const storedEsc = localStorage.getItem("escalation_notified_ids");
      if (storedEsc) {
        const parsed = JSON.parse(storedEsc);
        if (Array.isArray(parsed)) notifiedEscIds.current = new Set(parsed);
      }
      const storedSessions = localStorage.getItem("session_alert_notified_bots");
      if (storedSessions) {
        const parsed = JSON.parse(storedSessions);
        if (Array.isArray(parsed)) notifiedSessionBots.current = new Set(parsed);
      }
    } catch {}

    if (
      typeof window !== "undefined" &&
      "Notification" in window &&
      Notification.permission === "default" &&
      !permissionRequested.current
    ) {
      permissionRequested.current = true;
      Notification.requestPermission();
    }

    function fireNotification(title: string, body: string, tag: string) {
      if (
        typeof window !== "undefined" &&
        "Notification" in window &&
        Notification.permission === "granted"
      ) {
        new Notification(title, { body, icon: "/favicon.ico", tag });
      }
    }

    async function fullFetch() {
      // ── Session alerts ────────────────────────────────────────────────────
      try {
        const saRes = await fetch("/api/session-alert", { cache: "no-store" });
        if (saRes.ok) {
          const saData = await saRes.json();
          const pending: { botId: string; platform: string }[] = saData.alerts ?? [];
          setExpiredSessions(pending);

          let dirty = false;
          for (const alert of pending) {
            const key = `session_${alert.botId}`;
            if (notifiedSessionBots.current.has(key)) continue;
            notifiedSessionBots.current.add(key);
            dirty = true;
            fireNotification(
              `🔐 Session Expired — ${alert.platform}`,
              `${BOT_LABELS[alert.botId] ?? alert.botId} session has expired. Click to re-authenticate.`,
              key
            );
          }

          // Remove resolved bots from the notified set so they re-notify if they expire again
          const pendingKeys = new Set(pending.map((a) => `session_${a.botId}`));
          for (const k of notifiedSessionBots.current) {
            if (!pendingKeys.has(k)) notifiedSessionBots.current.delete(k);
          }

          if (dirty) {
            try {
              localStorage.setItem(
                "session_alert_notified_bots",
                JSON.stringify(Array.from(notifiedSessionBots.current))
              );
            } catch {}
          }
        }
      } catch {}

      // ── Escalation alerts ─────────────────────────────────────────────────
      try {
        const res = await fetch("/api/escalation?status=pending", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (!data.success) return;

        const pending: any[] = data.escalations ?? [];
        let dirty = false;

        for (const esc of pending) {
          const id = String(esc._id);
          if (notifiedEscIds.current.has(id)) continue;
          notifiedEscIds.current.add(id);
          dirty = true;
          fireNotification(
            `🚨 Escalation — ${esc.platform}`,
            `${esc.senderName}: "${esc.lastMessage.slice(0, 80)}..."\n\nReason: ${esc.reason}`,
            id
          );
        }

        if (dirty) {
          try {
            localStorage.setItem(
              "escalation_notified_ids",
              JSON.stringify(Array.from(notifiedEscIds.current))
            );
          } catch {}
        }
      } catch {}

      // ── 12-hour reminders ─────────────────────────────────────────────────
      try {
        const now = Date.now();
        if (now - lastReminderCheck.current > REMINDER_INTERVAL_MS) {
          lastReminderCheck.current = now;
          const reminderRes = await fetch("/api/escalation/reminder", { cache: "no-store" });
          if (reminderRes.ok) {
            const reminderData = await reminderRes.json();
            let dirty = false;
            for (const esc of reminderData.escalations ?? []) {
              const tagId = `reminder_${esc.id}`;
              if (notifiedEscIds.current.has(tagId)) continue;
              notifiedEscIds.current.add(tagId);
              dirty = true;
              fireNotification(
                `⏰ Reminder — Unresolved Escalation (${esc.botId})`,
                `${esc.senderName} has been waiting since ${new Date(esc.createdAt).toLocaleString()}.\n\nReason: ${esc.reason}`,
                tagId
              );
            }
            if (dirty) {
              try {
                localStorage.setItem(
                  "escalation_notified_ids",
                  JSON.stringify(Array.from(notifiedEscIds.current))
                );
              } catch {}
            }
          }
        }
      } catch {}
    }

    async function checkAll() {
      try {
        // ── Phase 1: lean status check (~20ms, indexed) ───────────────────
        const res = await fetch("/api/notification/status", { cache: "no-store" });
        if (!res.ok) return;
        const status = await res.json();

        const nothingPending =
          (status.pendingEscalations ?? 0) === 0 &&
          (status.pendingSessionAlerts ?? 0) === 0;

        if (nothingPending) {
          // Everything resolved — clear banner and reset change tracker
          setExpiredSessions([]);
          lastChangedAt.current = null;
          return;
        }

        if (status.lastChangedAt === lastChangedAt.current) {
          // Nothing new since last full fetch — skip heavy queries
          return;
        }

        // ── Phase 2: something changed — fetch full data ──────────────────
        lastChangedAt.current = status.lastChangedAt;
        await fullFetch();
      } catch {
        // Silent — don't crash the app
      }
    }

    checkAll();
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        checkAll();
      }
    }, 120_000);

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        checkAll();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const visible = expiredSessions.filter((s) => !dismissed.has(s.botId));
  if (visible.length === 0) return null;

  return (
    <div
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        background: "rgba(15, 10, 10, 0.97)",
        borderTop: "1px solid rgba(239,68,68,0.4)",
        padding: "10px 16px",
        display: "flex",
        alignItems: "center",
        gap: "12px",
        flexWrap: "wrap",
        fontFamily: "inherit",
        backdropFilter: "blur(8px)",
      }}
    >
      <span
        style={{
          color: "#f87171",
          fontWeight: 700,
          fontSize: "12px",
          letterSpacing: "0.05em",
          textTransform: "uppercase",
          whiteSpace: "nowrap",
          display: "flex",
          alignItems: "center",
          gap: "6px",
        }}
      >
        <span style={{ fontSize: "14px" }}>🔐</span> SESSION EXPIRED
      </span>

      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", flex: 1 }}>
        {visible.map((s) => (
          <a
            key={s.botId}
            href={BOT_PATHS[s.botId] ?? "/"}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "4px 12px",
              borderRadius: "6px",
              background: "rgba(239,68,68,0.12)",
              border: "1px solid rgba(239,68,68,0.35)",
              color: "#fca5a5",
              fontSize: "12px",
              fontWeight: 600,
              textDecoration: "none",
            }}
            onMouseEnter={(e) =>
              ((e.currentTarget as HTMLAnchorElement).style.background = "rgba(239,68,68,0.22)")
            }
            onMouseLeave={(e) =>
              ((e.currentTarget as HTMLAnchorElement).style.background = "rgba(239,68,68,0.12)")
            }
          >
            {s.platform} — re-authenticate →
          </a>
        ))}
      </div>

      <button
        onClick={() => setDismissed(new Set(visible.map((s) => s.botId)))}
        style={{
          background: "none",
          border: "none",
          color: "#6b7280",
          cursor: "pointer",
          fontSize: "18px",
          lineHeight: 1,
          padding: "2px 4px",
          flexShrink: 0,
        }}
        title="Dismiss (reappears in 60s if still unresolved)"
      >
        ×
      </button>
    </div>
  );
}
