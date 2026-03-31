import { NextRequest, NextResponse } from "next/server";
import { getDatabase } from "@/lib/mongodb";

// ── GET: fetch all DM conversation logs ──────────────────────────────────────
export async function GET() {
  try {
    const db = await getDatabase();

    const conversations = await db
      .collection("xavier_conversations")
      .find()
      .sort({ lastActivity: -1 })
      .limit(50)
      .toArray();

    return NextResponse.json({ success: true, conversations });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ── DELETE: clear all DM conversation logs ────────────────────────────────────
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const conversationId = searchParams.get("id");
    const db = await getDatabase();

    if (conversationId) {
      await db
        .collection("xavier_conversations")
        .deleteOne({ conversationId });
      return NextResponse.json({ success: true, deleted: 1 });
    }

    const result = await db.collection("xavier_conversations").deleteMany({});
    return NextResponse.json({ success: true, deleted: result.deletedCount });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
