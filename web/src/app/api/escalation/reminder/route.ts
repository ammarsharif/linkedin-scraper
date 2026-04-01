import { NextResponse } from "next/server";
import { getDatabase } from "@/lib/mongodb";

export const maxDuration = 30;

// GET — check for escalations older than 12h without resolution, mark them as needing reminder
export async function GET() {
  try {
    const db = await getDatabase();
    const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();

    // Find pending escalations created more than 12h ago that haven't been reminded yet
    const stale = await db
      .collection("escalations")
      .find({
        status: "pending",
        createdAt: { $lte: twelveHoursAgo },
        reminderSentAt: { $exists: false },
      })
      .toArray();

    if (stale.length === 0) {
      return NextResponse.json({ success: true, reminders: 0 });
    }

    const now = new Date().toISOString();
    const ids = stale.map((e) => e._id);

    await db.collection("escalations").updateMany(
      { _id: { $in: ids } },
      { $set: { status: "reminded", reminderSentAt: now } }
    );

    return NextResponse.json({
      success: true,
      reminders: stale.length,
      escalations: stale.map((e) => ({
        id: e._id,
        botId: e.botId,
        senderName: e.senderName,
        reason: e.reason,
        createdAt: e.createdAt,
      })),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
