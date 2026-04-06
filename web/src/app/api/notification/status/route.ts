import { NextResponse } from "next/server";
import { getDatabase } from "@/lib/mongodb";

export const maxDuration = 15;

/**
 * Lean status endpoint for EscalationNotifier.
 * Returns only counts + a lastChangedAt timestamp — no full documents.
 * Two aggregations (one per collection), both hit indexed status fields → <30ms.
 */
export async function GET() {
  try {
    const db = await getDatabase();

    const [escResult, saResultRaw] = await Promise.all([
      db
        .collection("escalations")
        .aggregate([
          { $match: { status: { $in: ["pending", "reminded"] } } },
          { $group: { _id: null, count: { $sum: 1 }, lastAt: { $max: "$createdAt" } } },
        ])
        .toArray(),
      db.collection("session_alerts").find({ status: "pending" }).toArray(),
    ]);

    // Validation: Auto-resolve if session is now active
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

    let pendingSessionAlerts = 0;
    let saLastAt: string | null = null;

    for (const sa of saResultRaw) {
      if (activeBots.has(sa.botId)) {
        // Resolve it!
        await db.collection("session_alerts").updateOne(
          { _id: sa._id },
          { $set: { status: "resolved", resolvedAt: new Date().toISOString() } }
        );
      } else {
        pendingSessionAlerts++;
        if (!saLastAt || sa.createdAt > saLastAt) {
          saLastAt = sa.createdAt;
        }
      }
    }

    const pendingEscalations: number = escResult[0]?.count ?? 0;
    const escLastAt: string | null = escResult[0]?.lastAt ?? null;

    const lastChangedAt =
      escLastAt && saLastAt
        ? escLastAt > saLastAt ? escLastAt : saLastAt
        : escLastAt ?? saLastAt ?? null;

    return NextResponse.json({
      pendingEscalations,
      pendingSessionAlerts,
      lastChangedAt,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
