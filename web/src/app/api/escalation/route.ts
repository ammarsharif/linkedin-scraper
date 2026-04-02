import { NextRequest, NextResponse } from "next/server";
import { getDatabase, EscalationRecord } from "@/lib/mongodb";
import { ObjectId } from "mongodb";

export const maxDuration = 30;

// GET — list escalations (optionally filter by botId or status)
export async function GET(req: NextRequest) {
  try {
    const botId = req.nextUrl.searchParams.get("botId") || undefined;
    const status = req.nextUrl.searchParams.get("status") || undefined;

    const filter: Record<string, any> = {};
    if (botId) filter.botId = botId;
    if (status) {
      if (status === "pending") {
        filter.status = { $in: ["pending", "reminded"] };
      } else {
        filter.status = status;
      }
    }

    const db = await getDatabase();
    const escalations = await db
      .collection<EscalationRecord>("escalations")
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(200)
      .toArray();

    // Counts for buttons (for this bot or all)
    const countFilter: Record<string, any> = {};
    if (botId) countFilter.botId = botId;

    const totalCount = await db.collection("escalations").countDocuments(countFilter);
    const actionNeededCount = await db.collection("escalations").countDocuments({ 
      ...countFilter, 
      status: { $in: ["pending", "reminded"] } 
    });
    const resolvedCount = await db.collection("escalations").countDocuments({ ...countFilter, status: "resolved" });

    return NextResponse.json({
      success: true,
      escalations,
      counts: {
        all: totalCount,
        pending: actionNeededCount,
        resolved: resolvedCount
      }
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// POST — create a new escalation record
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { botId, platform, conversationId, senderName, senderUsername, lastMessage, reason } =
      body as EscalationRecord;

    if (!botId || !conversationId || !senderName || !lastMessage || !reason) {
      return NextResponse.json(
        { error: "botId, conversationId, senderName, lastMessage, reason are required." },
        { status: 400 }
      );
    }

    const db = await getDatabase();

    // Avoid duplicate pending escalations for same conversation
    const existing = await db
      .collection("escalations")
      .findOne({ conversationId, status: "pending" });
    if (existing) {
      return NextResponse.json({ success: true, id: existing._id, duplicate: true });
    }

    const now = new Date().toISOString();
    const record: EscalationRecord = {
      botId,
      platform: platform || botId,
      conversationId,
      senderName,
      senderUsername,
      lastMessage,
      reason,
      status: "pending",
      createdAt: now,
    };

    const result = await db
      .collection<EscalationRecord>("escalations")
      .insertOne(record as any);

    return NextResponse.json({ success: true, id: result.insertedId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// PATCH — update escalation status (resolve, remind, etc.)
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, status } = body;

    if (!id || !status) {
      return NextResponse.json({ error: "id and status are required." }, { status: 400 });
    }

    const updates: Record<string, any> = { status };
    if (status === "resolved") updates.resolvedAt = new Date().toISOString();
    if (status === "reminded") updates.reminderSentAt = new Date().toISOString();

    const db = await getDatabase();
    await db
      .collection("escalations")
      .updateOne({ _id: new ObjectId(id) }, { $set: updates });

    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// DELETE — remove a resolved escalation
export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    const botId = req.nextUrl.searchParams.get("botId");
    const deleteAllResolved = req.nextUrl.searchParams.get("deleteAllResolved") === "true";

    const db = await getDatabase();
    const col = db.collection("escalations");

    if (deleteAllResolved && botId) {
      const result = await col.deleteMany({
        botId: botId as any,
        status: "resolved"
      });
      return NextResponse.json({ success: true, count: result.deletedCount });
    }

    if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });

    await db.collection("escalations").deleteOne({ _id: new ObjectId(id) });

    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
