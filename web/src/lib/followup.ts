/**
 * Shared follow-up processing utility.
 * Imported by each bot's inbox cron so follow-ups are processed
 * automatically whenever the inbox cron runs — no separate scheduler needed.
 */

import { getDatabase, FollowUpRecord, FollowUpTemplate } from "@/lib/mongodb";

// ── Schedule ──────────────────────────────────────────────────────────────────
// Delay (in hours) to wait AFTER the previous follow-up before sending the next one.
// Testing values: 2min → 5min → 10min → 20min → 30min between each send.
// For production swap to e.g. [24, 48, 72, 96, 168] (1d, 2d, 3d, 4d, 7d).
export const FOLLOWUP_HOURS = [2 / 60, 5 / 60, 10 / 60, 20 / 60, 30 / 60];

/**
 * Returns the ISO timestamp for the next follow-up based on the current time.
 * Each interval is measured FROM NOW (when the previous follow-up was sent),
 * not from the original message time.
 */
export function computeNextScheduledAt(
  _originalSentAt: string,
  followUpsSent: number
): string | null {
  if (followUpsSent >= FOLLOWUP_HOURS.length) return null;
  return new Date(
    Date.now() + FOLLOWUP_HOURS[followUpsSent] * 3_600_000
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
        // Calls the cindy cron directly so it can use the stored LinkedIn session
        const res = await fetch(`${baseUrl}/api/cindy/inbox/cron`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "send_followup",
            conversationUrn: record.userId,
            messageText,
            senderName: record.userName,
          }),
        });
        const data = await res.json();
        return data.sent === true;
      }

      case "felix": {
        // Calls the felix cron which has the Puppeteer browser for Facebook E2EE
        const res = await fetch(`${baseUrl}/api/felix/inbox/cron`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "send_followup",
            threadId: record.userId,
            messageText,
          }),
        });
        const data = await res.json();
        return data.sent === true || data.success === true;
      }

      case "instar": {
        // Calls the instar cron which has the Puppeteer browser for Instagram
        const res = await fetch(`${baseUrl}/api/instar/inbox/cron`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "send_followup",
            threadId: record.userId,
            messageText,
          }),
        });
        const data = await res.json();
        return data.sent === true || data.success === true;
      }

      case "xavier": {
        // Calls the xavier cron which has the Puppeteer browser for Twitter/X
        const res = await fetch(`${baseUrl}/api/xavier/inbox/cron`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "send_followup",
            conversationId: record.userId,
            messageText,
            senderUsername: record.userName,
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
    return rules.some((r: any) => lower.includes(r.value.toLowerCase()));
  } catch {
    return false;
  }
}

/**
 * Creates or updates a follow-up tracking record if the message matches rules.
 */
export async function registerFollowUp(
  botName: FollowUpRecord["botName"],
  userId: string,
  userName: string,
  originalMessageText: string,
  originalMessageId: string = "msg_" + Date.now(),
  force: boolean = false,
  /**
   * The user's incoming message to match against follow-up rules.
   * If not provided, falls back to checking originalMessageText (bot reply).
   * Always pass the user's message here so keyword rules like "interested"
   * correctly match what the prospect said, not what the bot replied.
   */
  incomingUserMessage?: string
): Promise<boolean> {
  try {
    const isEscalation = originalMessageText.toLowerCase().includes("let me confirm this for you") ||
                         originalMessageText.includes("##ESCALATE##");

    // Match rules against the user's incoming message (what the prospect said),
    // not the bot's reply text.
    const textToMatch = incomingUserMessage ?? originalMessageText;

    // If not forced and doesn't match rules/escalation, skip
    if (!force && !isEscalation) {
      const matches = await messageMatchesFollowUpRule(botName, textToMatch);
      if (!matches) return false;
    }

    const db = await getDatabase();
    const now = new Date().toISOString();
    const nextWait = FOLLOWUP_HOURS[0]; // First follow-up interval
    const nextScheduled = new Date(Date.now() + nextWait * 3_600_000).toISOString();

    const record: FollowUpRecord = {
      botName,
      userId,
      userName,
      originalMessageId,
      originalMessageText,
      originalMessageSentAt: now,
      replyReceived: false,
      followUpsSent: 0,
      nextFollowupScheduledAt: nextScheduled,
      status: "active",
      createdAt: now,
      updatedAt: now,
    };

    // Upsert: replace any existing active/paused for this user to restart the chain
    await db.collection("follow_up_tracking").updateOne(
      { botName, userId, status: { $in: ["active", "paused", "replied"] } },
      { $set: record },
      { upsert: true }
    );

    return true;
  } catch (err) {
    console.error(`[FollowUp][${botName}] registerFollowUp error:`, err);
    return false;
  }
}
