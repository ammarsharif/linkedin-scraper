/**
 * Shared follow-up processing utility.
 * Imported by each bot's inbox cron so follow-ups are processed
 * automatically whenever the inbox cron runs — no separate scheduler needed.
 */

import { getDatabase, FollowUpRecord, FollowUpTemplate } from "@/lib/mongodb";

// ── Schedule ──────────────────────────────────────────────────────────────────
// Hours from original message sent at which each follow-up fires
export const FOLLOWUP_HOURS = [4, 12, 16, 24, 48];

export function computeNextScheduledAt(
  originalSentAt: string,
  followUpsSent: number
): string | null {
  if (followUpsSent >= FOLLOWUP_HOURS.length) return null;
  const base = new Date(originalSentAt).getTime();
  return new Date(
    base + FOLLOWUP_HOURS[followUpsSent] * 3_600_000
  ).toISOString();
}

// ── Template rendering ────────────────────────────────────────────────────────
export function renderTemplate(
  text: string,
  vars: Record<string, string>
): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

const DEFAULT_TEMPLATES: Record<number, string> = {
  1: "Hi {{user_name}}, just a friendly reminder about my previous message. Would love to hear your thoughts!",
  2: "Hi {{user_name}}, following up again — I wanted to make sure my message didn't get lost. Looking forward to connecting!",
  3: "Hi {{user_name}}, reaching out one more time. I sent a message {{days_waiting}} day(s) ago and haven't heard back. Happy to help whenever you're ready!",
  4: "Hi {{user_name}}, I know you're busy — just wanted to check in once more. Feel free to reach out anytime.",
  5: "Hi {{user_name}}, this will be my last follow-up. If you ever want to reconnect, don't hesitate to reach out. Wishing you all the best!",
};

// ── Bot-specific message dispatch ─────────────────────────────────────────────
/**
 * Sends a follow-up message through the appropriate bot channel.
 * Returns true if the send succeeded (or was queued).
 */
export async function dispatchFollowUp(
  record: FollowUpRecord,
  messageText: string,
  followUpNumber: number
): Promise<boolean> {
  try {
    const baseUrl =
      process.env.NEXT_PUBLIC_BASE_URL ||
      (process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "http://localhost:3000");

    switch (record.botName) {
      case "cindy": {
        const res = await fetch(`${baseUrl}/api/cindy/inbox`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversationUrn: record.userId,
            messageText: record.originalMessageText,
            senderName: record.userName,
            autoSend: true,
            overrideReply: messageText,
            isFollowUp: true,
            followUpNumber,
          }),
        });
        const data = await res.json();
        return data.sent === true;
      }

      case "felix": {
        const res = await fetch(`${baseUrl}/api/felix/inbox`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            threadId: record.userId,
            messageText,
            isFollowUp: true,
            followUpNumber,
          }),
        });
        const data = await res.json();
        return data.success === true;
      }

      case "instar": {
        const res = await fetch(`${baseUrl}/api/instar/inbox`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            threadId: record.userId,
            messageText,
            senderUsername: record.userName,
            autoSend: true,
            isFollowUp: true,
            followUpNumber,
          }),
        });
        const data = await res.json();
        return data.sent === true || data.success === true;
      }

      case "xavier": {
        const res = await fetch(`${baseUrl}/api/xavier/inbox`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversationId: record.userId,
            messageText,
            senderUsername: record.userName,
            autoSend: true,
            isFollowUp: true,
            followUpNumber,
          }),
        });
        const data = await res.json();
        return data.sent === true || data.success === true;
      }

      case "zapier": {
        const webhook = process.env.ZAPIER_FOLLOWUP_WEBHOOK_URL;
        if (!webhook) return false;
        const res = await fetch(webhook, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: record.userId,
            userName: record.userName,
            messageText,
            followUpNumber,
            originalMessageText: record.originalMessageText,
          }),
        });
        return res.ok;
      }

      default:
        return false;
    }
  } catch {
    return false;
  }
}

// ── Core processor ────────────────────────────────────────────────────────────
/**
 * Checks for due follow-ups for a specific bot and dispatches them.
 * Call this at the end of each bot's inbox cron tick.
 *
 * @param botName  - Which bot to process follow-ups for
 * @param log      - Optional logger function (uses console.log fallback)
 */
export async function processFollowUps(
  botName: FollowUpRecord["botName"],
  log: (msg: string, type?: "info" | "success" | "error" | "warning") => void = (m) =>
    console.log(`[FollowUp][${botName}] ${m}`)
): Promise<{ processed: number; sent: number }> {
  const now = new Date().toISOString();
  let processed = 0;
  let sent = 0;

  try {
    const db = await getDatabase();
    const col = db.collection<FollowUpRecord>("follow_up_tracking");
    const templatesCol = db.collection<FollowUpTemplate>("follow_up_templates");

    // All active records for this bot where the next follow-up is due
    const due = await col
      .find({
        botName,
        status: "active",
        replyReceived: false,
        nextFollowupScheduledAt: { $lte: now },
      })
      .toArray();

    if (due.length === 0) return { processed: 0, sent: 0 };

    log(`${due.length} follow-up(s) due — dispatching…`, "info");

    for (const record of due) {
      processed++;
      const followUpNumber = (record.followUpsSent + 1) as 1 | 2 | 3 | 4 | 5;

      const template = await templatesCol.findOne({ botName, followUpNumber });
      const templateText =
        template?.messageText ?? DEFAULT_TEMPLATES[followUpNumber] ?? "Hi {{user_name}}, just following up on my previous message!";

      const daysWaiting = Math.floor(
        (Date.now() - new Date(record.originalMessageSentAt).getTime()) /
          86_400_000
      );

      const messageText = renderTemplate(templateText, {
        user_name: record.userName,
        original_message: record.originalMessageText,
        days_waiting: String(daysWaiting),
      });

      const success = await dispatchFollowUp(record, messageText, followUpNumber);

      const nowIso = new Date().toISOString();
      const newFollowUpsSent = record.followUpsSent + 1;
      const isLast = newFollowUpsSent >= 5;
      const nextScheduled = isLast
        ? null
        : computeNextScheduledAt(record.originalMessageSentAt, newFollowUpsSent);

      if (success) {
        sent++;
        await col.updateOne(
          { _id: record._id },
          {
            $set: {
              followUpsSent: newFollowUpsSent,
              lastFollowupSentAt: nowIso,
              nextFollowupScheduledAt: nextScheduled ?? nowIso,
              status: isLast ? "completed" : "active",
              updatedAt: nowIso,
            },
          }
        );
        log(
          `Follow-up #${followUpNumber} sent to ${record.userName}${isLast ? " (final)" : ""}`,
          "success"
        );
      } else {
        log(
          `Follow-up #${followUpNumber} dispatch failed for ${record.userName} — will retry next cycle`,
          "warning"
        );
      }
    }
  } catch (err: any) {
    log(`processFollowUps error: ${err.message}`, "error");
  }

  return { processed, sent };
}

// ── Reply detection ───────────────────────────────────────────────────────────
/**
 * Call this whenever a user sends a message back (in any bot's inbox cron).
 * Marks all active follow-up threads for that user as "replied".
 */
export async function markFollowUpReplied(
  botName: FollowUpRecord["botName"],
  userId: string
): Promise<void> {
  try {
    const db = await getDatabase();
    const now = new Date().toISOString();
    await db.collection<FollowUpRecord>("follow_up_tracking").updateMany(
      { botName, userId, status: { $in: ["active", "paused"] } },
      {
        $set: {
          status: "replied",
          replyReceived: true,
          replyReceivedAt: now,
          updatedAt: now,
        },
      }
    );
  } catch {
    // Non-fatal — inbox cron should not break if this fails
  }
}

// ── Rule matching ─────────────────────────────────────────────────────────────
/**
 * Returns true if the message matches any active follow-up rule for this bot.
 * Use this in the inbox cron after a bot sends a message to decide whether
 * to register a follow-up tracking record.
 */
export async function messageMatchesFollowUpRule(
  botName: FollowUpRecord["botName"],
  messageText: string
): Promise<boolean> {
  try {
    const db = await getDatabase();
    const rules = await db
      .collection("follow_up_rules")
      .find({ botName, enabled: true })
      .toArray();
    const lower = messageText.toLowerCase();
    return rules.some((r: any) => lower.includes(r.value));
  } catch {
    return false;
  }
}
