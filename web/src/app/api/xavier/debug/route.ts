import { NextResponse } from "next/server";
import { getDatabase } from "@/lib/mongodb";

const g = globalThis as any;

export async function GET() {
  try {
    const db = await getDatabase();

    const sessionDoc = await db
      .collection("xavier_config")
      .findOne({ type: "tw_session" });

    const dbStatus = "connected";

    const growState = {
      running: g.xavier_grow_running ?? false,
      tickRunning: g.xavier_grow_tickRunning ?? false,
      lastRun: g.xavier_grow_lastRun ?? null,
      consecutiveErrors: g.xavier_grow_consecutiveErrors ?? 0,
      dailyCounts: g.xavier_grow_dailyCounts ?? {},
      nextActionMode: g.xavier_grow_actionMode ?? 0,
      targetIndex: g.xavier_grow_targetIndex ?? 0,
    };

    const inboxState = {
      running: g.xavier_inbox_running ?? false,
      lastRun: g.xavier_inbox_lastRun ?? null,
      consecutiveErrors: g.xavier_inbox_consecutiveErrors ?? 0,
    };

    const browserOpen =
      !!g.xavier_grow_browser || !!g.xavier_inbox_browser;

    return NextResponse.json({
      success: true,
      session: {
        exists: !!sessionDoc,
        username: sessionDoc?.username ?? null,
        status: sessionDoc?.status ?? null,
        savedAt: sessionDoc?.savedAt ?? null,
      },
      db: dbStatus,
      browserOpen,
      grow: growState,
      inbox: inboxState,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message, db: "error" }, { status: 500 });
  }
}
