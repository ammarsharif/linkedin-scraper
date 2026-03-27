import { NextResponse } from "next/server";
import { getDatabase } from "@/lib/mongodb";

export const maxDuration = 30;

// ── GET: Growth metrics for last 7 days ───────────────────────────────────
export async function GET() {
  try {
    const db = await getDatabase();

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    // Aggregate by day and action
    const rawMetrics = await db
      .collection("instar_growth_logs")
      .aggregate([
        {
          $match: {
            timestamp: { $gte: sevenDaysAgo.toISOString() },
            status: "success",
          },
        },
        {
          $addFields: {
            day: { $substr: ["$timestamp", 0, 10] },
          },
        },
        {
          $group: {
            _id: { day: "$day", action: "$action" },
            count: { $sum: 1 },
          },
        },
        { $sort: { "_id.day": 1 } },
      ])
      .toArray();

    // Structure metrics by day
    const byDay: Record<string, Record<string, number>> = {};
    for (const row of rawMetrics) {
      const day = row._id.day as string;
      const action = row._id.action as string;
      if (!byDay[day]) byDay[day] = {};
      byDay[day][action] = row.count;
    }

    // Totals (all time)
    const totals = await db
      .collection("instar_growth_logs")
      .aggregate([
        { $match: { status: "success" } },
        { $group: { _id: "$action", count: { $sum: 1 } } },
      ])
      .toArray();

    const totalMap: Record<string, number> = {};
    for (const t of totals) totalMap[t._id as string] = t.count;

    // Today's counts
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayRaw = await db
      .collection("instar_growth_logs")
      .aggregate([
        { $match: { timestamp: { $gte: todayStart.toISOString() }, status: "success" } },
        { $group: { _id: "$action", count: { $sum: 1 } } },
      ])
      .toArray();

    const todayMap: Record<string, number> = {};
    for (const t of todayRaw) todayMap[t._id as string] = t.count;

    // Recent 20 logs
    const recentLogs = await db
      .collection("instar_growth_logs")
      .find({})
      .sort({ timestamp: -1 })
      .limit(20)
      .toArray();

    return NextResponse.json({
      success: true,
      byDay,
      totals: totalMap,
      today: todayMap,
      recentLogs,
    });
  } catch (err) {
    console.error("[instar/metrics] GET error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
