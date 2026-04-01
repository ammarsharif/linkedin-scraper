"use client";

import { useEffect, useRef } from "react";

const POLL_INTERVAL_MS = 60_000; // check every 60 seconds
const REMINDER_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours

/**
 * EscalationNotifier — mounts globally and polls /api/escalation for pending
 * escalations. When found it fires a browser Notification so the operator is
 * alerted even when looking at a different tab. Also calls the reminder
 * endpoint to mark stale (>12 h) escalations.
 */
export function EscalationNotifier() {
  const notifiedIds = useRef<Set<string>>(new Set());
  const permissionRequested = useRef(false);
  const lastReminderCheck = useRef(0);

  useEffect(() => {
    // Request notification permission once
    if (
      typeof window !== "undefined" &&
      "Notification" in window &&
      Notification.permission === "default" &&
      !permissionRequested.current
    ) {
      permissionRequested.current = true;
      Notification.requestPermission();
    }

    async function checkEscalations() {
      try {
        const res = await fetch("/api/escalation?status=pending", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (!data.success) return;

        const pending: any[] = data.escalations ?? [];

        for (const esc of pending) {
          const id = String(esc._id);
          if (notifiedIds.current.has(id)) continue;
          notifiedIds.current.add(id);

          if (
            typeof window !== "undefined" &&
            "Notification" in window &&
            Notification.permission === "granted"
          ) {
            new Notification(`🚨 Escalation — ${esc.platform}`, {
              body: `${esc.senderName}: "${esc.lastMessage.slice(0, 80)}..."\n\nReason: ${esc.reason}`,
              icon: "/favicon.ico",
              tag: id, // deduplicates notifications with same tag
            });
          }
        }

        // Check 12-hour reminders
        const now = Date.now();
        if (now - lastReminderCheck.current > REMINDER_INTERVAL_MS) {
          lastReminderCheck.current = now;
          const reminderRes = await fetch("/api/escalation/reminder", { cache: "no-store" });
          if (reminderRes.ok) {
            const reminderData = await reminderRes.json();
            if (reminderData.reminders > 0) {
              // Re-notify for reminded escalations
              for (const esc of reminderData.escalations ?? []) {
                if (
                  typeof window !== "undefined" &&
                  "Notification" in window &&
                  Notification.permission === "granted"
                ) {
                  new Notification(`⏰ Reminder — Unresolved Escalation (${esc.botId})`, {
                    body: `${esc.senderName} has been waiting since ${new Date(esc.createdAt).toLocaleString()}.\n\nReason: ${esc.reason}`,
                    icon: "/favicon.ico",
                    tag: `reminder_${esc.id}`,
                  });
                }
              }
            }
          }
        }
      } catch {
        // Network errors are silent — don't crash the app
      }
    }

    checkEscalations(); // immediate first check
    const interval = setInterval(checkEscalations, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  return null; // renders nothing
}
