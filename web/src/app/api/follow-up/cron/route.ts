/**
 * Follow-Up Check Endpoint
 *
 * NOTE: Follow-ups are processed automatically at the end of each bot's
 * inbox cron tick — no separate scheduler is needed or started here.
 *
 * This route exposes:
 *   GET  — query how many due follow-ups exist right now
 *   POST action=run-now     — manually trigger a check for all bots
 *   POST action=manual-send — send a specific follow-up immediately
 */

import { NextRequest, NextResponse } from "next/server";
import { getDatabase, FollowUpRecord, FollowUpTemplate } from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import {
  processFollowUps,
  renderTemplate,
  dispatchFollowUp,
  FOLLOWUP_HOURS,
  computeNextScheduledAt,
} from "@/lib/followup";

export const maxDuration = 60;

const ALL_BOTS: FollowUpRecord["botName"][] = ["cindy", "instar", "felix", "zapier", "xavier" as any];

// ── GET: Query pending follow-ups count ──────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const botName = req.nextUrl.searchParams.get("botName") || undefined;
    const now = new Date().toISOString();

    const db = await getDatabase();
    const filter: Record<string, any> = {
      status: "active",
      replyReceived: false,
      nextFollowupScheduledAt: { $lte: now },
    };
    if (botName) filter.botName = botName;

    const dueCount = await db
      .collection("follow_up_tracking")
      .countDocuments(filter);

    return NextResponse.json({
      success: true,
      dueCount,
      note: "Follow-ups run automatically inside each bot's inbox cron. Use POST action=run-now to trigger manually.",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ── POST: Actions ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action } = body;

    // ── run-now: process due follow-ups for all bots right now ──
    if (action === "run-now") {
      const results: Record<string, { processed: number; sent: number }> = {};
      const targetBots = body.botName ? [body.botName] : ALL_BOTS;

      for (const bot of targetBots) {
        results[bot] = await processFollowUps(bot as any);
      }

      const totalSent = Object.values(results).reduce((s, r) => s + r.sent, 0);
      return NextResponse.json({
        success: true,
        message: `Manual check complete. ${totalSent} follow-up(s) dispatched.`,
        results,
      });
    }

    // ── manual-send: immediately send the next follow-up for a specific record ──
    if (action === "manual-send") {
      const { recordId, customMessage } = body;
      if (!recordId) {
        return NextResponse.json({ error: "recordId is required." }, { status: 400 });
      }

      const db = await getDatabase();
      const col = db.collection<FollowUpRecord>("follow_up_tracking");
      const record = await col.findOne({ _id: new ObjectId(recordId) });
      if (!record) {
        return NextResponse.json({ error: "Follow-up record not found." }, { status: 404 });
      }
      if (record.followUpsSent >= 5) {
        return NextResponse.json({ error: "All 5 follow-ups have already been sent." }, { status: 400 });
      }

      const followUpNumber = (record.followUpsSent + 1) as 1 | 2 | 3 | 4 | 5;

      // Resolve message: use customMessage if provided, else fetch template
      let messageText = customMessage?.trim();
      if (!messageText) {
        const tmpl = await db
          .collection<FollowUpTemplate>("follow_up_templates")
          .findOne({ botName: record.botName, followUpNumber });

        const DEFAULT_TEMPLATES: Record<number, string> = {
          1: "Hi {{user_name}}, just a friendly reminder about my previous message. Would love to hear your thoughts!",
          2: "Hi {{user_name}}, following up again — I wanted to make sure my message didn't get lost. Looking forward to connecting!",
          3: "Hi {{user_name}}, reaching out one more time. I sent a message {{days_waiting}} day(s) ago and haven't heard back. Happy to help whenever you're ready!",
          4: "Hi {{user_name}}, I know you're busy — just wanted to check in once more. Feel free to reach out anytime.",
          5: "Hi {{user_name}}, this will be my last follow-up. If you ever want to reconnect, don't hesitate to reach out. Wishing you all the best!",
        };

        const raw = tmpl?.messageText ?? DEFAULT_TEMPLATES[followUpNumber];
        const daysWaiting = Math.floor(
          (Date.now() - new Date(record.originalMessageSentAt).getTime()) / 86_400_000
        );
        messageText = renderTemplate(raw, {
          user_name: record.userName,
          original_message: record.originalMessageText,
          days_waiting: String(daysWaiting),
        });
      }

      const sent = await dispatchFollowUp(record, messageText, followUpNumber);

      if (!sent) {
        return NextResponse.json({
          success: false,
          error: "Dispatch failed — the bot's send endpoint returned an error. The record was NOT updated.",
          messageText,
        });
      }

      const nowIso = new Date().toISOString();
      const newFollowUpsSent = record.followUpsSent + 1;
      const isLast = newFollowUpsSent >= 5;
      const nextScheduled = isLast
        ? null
        : computeNextScheduledAt(record.originalMessageSentAt, newFollowUpsSent);

      await col.updateOne(
        { _id: new ObjectId(recordId) },
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

      return NextResponse.json({
        success: true,
        message: `Follow-up #${followUpNumber} sent to ${record.userName}.`,
        sentMessage: messageText,
        isLast,
        followUpNumber,
      });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
