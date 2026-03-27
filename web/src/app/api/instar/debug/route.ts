import { NextResponse } from "next/server";
import { getDatabase } from "@/lib/mongodb";

export const maxDuration = 15;

const g = globalThis as unknown as {
  instarBrowser?: { connected: boolean };
  instarGrowBrowser?: { connected: boolean };
};

export async function GET() {
  try {
    const db = await getDatabase();

    const sessionDoc = await db.collection("instar_config").findOne({ type: "ig_session" });
    const settingsDoc = await db.collection("instar_settings").findOne({ type: "growth_settings" });

    const dmLogs = await db
      .collection("instar_conversation_logs")
      .countDocuments();

    const growthLogs = await db
      .collection("instar_growth_logs")
      .countDocuments();

    return NextResponse.json({
      session: sessionDoc
        ? {
            exists: true,
            username: sessionDoc.username,
            ds_user_id: sessionDoc.ds_user_id,
            savedAt: sessionDoc.savedAt,
            status: sessionDoc.status,
          }
        : { exists: false },
      browsers: {
        dmBrowser: g.instarBrowser
          ? g.instarBrowser.connected ? "connected" : "disconnected"
          : "not started",
        growBrowser: g.instarGrowBrowser
          ? g.instarGrowBrowser.connected ? "connected" : "disconnected"
          : "not started",
      },
      counts: {
        dmConversations: dmLogs,
        growthActions: growthLogs,
      },
      settings: settingsDoc || null,
      serverTime: new Date().toISOString(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
