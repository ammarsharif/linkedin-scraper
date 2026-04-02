import { NextRequest, NextResponse } from "next/server";
import { getDatabase, FollowUpRecord, FollowUpBotName } from "@/lib/mongodb";
import { ObjectId } from "mongodb";

export const maxDuration = 30;

// Follow-up schedule: hours from original message sent at
const FOLLOWUP_HOURS = [4, 12, 16, 24, 48];

function computeNextScheduledAt(originalSentAt: string, followUpsSent: number): string | null {
  if (followUpsSent >= FOLLOWUP_HOURS.length) return null;
  const base = new Date(originalSentAt).getTime();
  return new Date(base + FOLLOWUP_HOURS[followUpsSent] * 3600 * 1000).toISOString();
}

// GET — list follow-up records, filter by botName / status / userId
export async function GET(req: NextRequest) {
  try {
    const botName = req.nextUrl.searchParams.get("botName") || undefined;
    const status   = req.nextUrl.searchParams.get("status")  || undefined;
    const userId   = req.nextUrl.searchParams.get("userId")  || undefined;
    const limit    = parseInt(req.nextUrl.searchParams.get("limit") || "100");

    const filter: Record<string, any> = {};
    const countFilter: Record<string, any> = {};
    if (botName) {
      filter.botName = botName;
      countFilter.botName = botName;
    }
    if (status)  filter.status  = status;
    if (userId)  filter.userId  = userId;

    const db = await getDatabase();
    const records = await db
      .collection<FollowUpRecord>("follow_up_tracking")
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();

    // Stats summary
    const now = new Date().toISOString();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const allCount = await db.collection("follow_up_tracking").countDocuments(countFilter);
    const activeCount = await db.collection("follow_up_tracking").countDocuments({ ...countFilter, status: "active" });
    const pausedCount = await db.collection("follow_up_tracking").countDocuments({ ...countFilter, status: "paused" });
    const stoppedCount = await db.collection("follow_up_tracking").countDocuments({ ...countFilter, status: "stopped" });
    const completedCount = await db.collection("follow_up_tracking").countDocuments({ ...countFilter, status: "completed" });
    const repliedCount = await db.collection("follow_up_tracking").countDocuments({ ...countFilter, status: "replied" });

    // Stats for overview cards
    const repliedToday = await db.collection("follow_up_tracking").countDocuments({
      ...countFilter,
      status: "replied",
      replyReceivedAt: { $gte: todayStart.toISOString() },
    });

    return NextResponse.json({
      success: true,
      records,
      stats: {
        active: activeCount,
        repliedToday,
        overdue: completedCount, // Original code labeled overdue as completed
        paused: pausedCount
      },
      counts: {
        all: allCount,
        active: activeCount,
        paused: pausedCount,
        stopped: stoppedCount,
        completed: completedCount,
        replied: repliedCount
      }
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// POST — create a new follow-up tracking record
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      botName,
      userId,
      userName,
      contactInfo,
      originalMessageId,
      originalMessageText,
    } = body as Partial<FollowUpRecord>;

    if (!botName || !userId || !userName || !originalMessageId || !originalMessageText) {
      return NextResponse.json(
        { error: "botName, userId, userName, originalMessageId, originalMessageText are required." },
        { status: 400 }
      );
    }

    const db = await getDatabase();

    // Don't create a second active record for the same user+bot
    const existing = await db
      .collection("follow_up_tracking")
      .findOne({ botName, userId, status: { $in: ["active", "paused"] } } as any);
    if (existing) {
      return NextResponse.json({ success: true, id: existing._id, duplicate: true });
    }

    const now = new Date().toISOString();
    const sentAt = body.originalMessageSentAt || now;

    const record: FollowUpRecord = {
      botName: botName as FollowUpBotName,
      userId,
      userName,
      contactInfo,
      originalMessageId,
      originalMessageText,
      originalMessageSentAt: sentAt,
      replyReceived: false,
      followUpsSent: 0,
      nextFollowupScheduledAt: computeNextScheduledAt(sentAt, 0)!,
      status: "active",
      createdAt: now,
      updatedAt: now,
    };

    const result = await db
      .collection<FollowUpRecord>("follow_up_tracking")
      .insertOne(record as any);

    return NextResponse.json({ success: true, id: result.insertedId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// PATCH — update a record: pause | stop | restart | mark-replied | send-now | add-note
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, action, notes } = body;

    if (!id || !action) {
      return NextResponse.json({ error: "id and action are required." }, { status: 400 });
    }

    const db = await getDatabase();
    const col = db.collection<FollowUpRecord>("follow_up_tracking");
    const record = await col.findOne({ _id: new ObjectId(id) as any });
    if (!record) return NextResponse.json({ error: "Record not found." }, { status: 404 });

    const now = new Date().toISOString();
    let update: Record<string, any> = { updatedAt: now };

    switch (action) {
      case "pause":
        update.status = "paused";
        break;

      case "resume":
        update.status = "active";
        // Recompute next scheduled time relative to now if it's in the past
        if (record.nextFollowupScheduledAt < now) {
          update.nextFollowupScheduledAt = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 min from now
        }
        break;

      case "stop":
        update.status = "stopped";
        update.manuallyStoppedAt = now;
        break;

      case "restart":
        update.status = "active";
        update.followUpsSent = 0;
        update.replyReceived = false;
        update.replyReceivedAt = null;
        update.lastFollowupSentAt = null;
        update.manuallyStoppedAt = null;
        update.originalMessageSentAt = now;
        update.nextFollowupScheduledAt = computeNextScheduledAt(now, 0)!;
        break;

      case "mark-replied":
        update.status = "replied";
        update.replyReceived = true;
        update.replyReceivedAt = now;
        break;

      case "send-now":
        // Schedules the next follow-up to fire immediately (cron will pick it up)
        if (record.followUpsSent < 5) {
          update.nextFollowupScheduledAt = now;
          update.status = "active";
        }
        break;

      case "add-note":
        update.notes = notes || "";
        break;

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    await col.updateOne({ _id: new ObjectId(id) as any }, { $set: update });
    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// DELETE — remove a record
export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    const botName = req.nextUrl.searchParams.get("botName");
    const deleteAllResolved = req.nextUrl.searchParams.get("deleteAllResolved") === "true";

    const db = await getDatabase();
    const col = db.collection("follow_up_tracking");

    if (deleteAllResolved && botName) {
      const result = await col.deleteMany({
        botName: botName as any,
        status: { $in: ["replied", "completed", "stopped"] }
      });
      return NextResponse.json({ success: true, count: result.deletedCount });
    }

    if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });

    await col.deleteOne({ _id: new ObjectId(id) as any });

    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

