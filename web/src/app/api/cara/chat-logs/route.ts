import { NextRequest, NextResponse } from "next/server";
import { getDatabase } from "@/lib/mongodb";
import { getLinkedInCookies } from "@/lib/linkedin";

export const maxDuration = 60;

// GET: Fetch conversation logs for Cara
export async function GET(req: NextRequest) {
  try {
    const cookieString = await getLinkedInCookies(req);
    if (!cookieString) {
      return NextResponse.json(
        { error: "Not authenticated." },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(req.url);
    const senderName = searchParams.get("senderName");
    const conversationUrn = searchParams.get("conversationUrn");
    const limit = parseInt(searchParams.get("limit") || "50", 10);

    const db = await getDatabase();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const query: any = {};
    if (senderName) query.senderName = { $regex: senderName, $options: "i" };
    if (conversationUrn) query.conversationUrn = conversationUrn;

    const logs = await db
      .collection("conversation_logs")
      .find(query)
      .sort({ lastActivity: -1 })
      .limit(Math.min(limit, 100))
      .toArray();

    return NextResponse.json({
      success: true,
      logs,
      totalFetched: logs.length,
    });
  } catch (err) {
    console.error("[cara-chat-logs] GET error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
