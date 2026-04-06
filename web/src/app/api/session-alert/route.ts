import { NextResponse } from "next/server";
import { getDatabase } from "@/lib/mongodb";

export const maxDuration = 30;

// GET — returns all pending session alerts
export async function GET() {
  try {
    const db = await getDatabase();
    const pendingRaw = await db
      .collection("session_alerts")
      .find({ status: "pending" })
      .sort({ createdAt: -1 })
      .toArray();

    // Verification step
    const activeBots = new Set<string>();
    const configs = await Promise.all([
      db.collection("xavier_config").findOne({ type: "tw_session", status: "active" }),
      db.collection("instar_config").findOne({ type: "ig_session", status: "active" }),
      db.collection("felix_config").findOne({ type: "fb_session", status: "active" }),
      db.collection("cindy_config").findOne({ type: "li_session", status: "active" }),
    ]);
    if (configs[0]) activeBots.add("xavier");
    if (configs[1]) activeBots.add("instar");
    if (configs[2]) activeBots.add("felix");
    if (configs[3]) activeBots.add("cindy");

    const alerts = [];
    for (const sa of pendingRaw) {
      if (activeBots.has(sa.botId)) {
        await db.collection("session_alerts").updateOne(
          { _id: sa._id },
          { $set: { status: "resolved", resolvedAt: new Date().toISOString() } }
        );
      } else {
        alerts.push(sa);
      }
    }

    return NextResponse.json({ success: true, alerts });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
