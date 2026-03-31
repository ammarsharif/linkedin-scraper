import { NextResponse } from "next/server";
import { getDatabase } from "@/lib/mongodb";

export async function GET() {
  try {
    const db = await getDatabase();

    // 7-day window
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    // Aggregate by day + action
    const agg = await db
      .collection("xavier_growth_logs")
      .aggregate([
        {
          $match: {
            status: "success",
            timestamp: { $gte: sevenDaysAgo.toISOString() },
          },
        },
        {
          $group: {
            _id: {
              date: { $substr: ["$timestamp", 0, 10] },
              action: "$action",
            },
            count: { $sum: 1 },
          },
        },
        { $sort: { "_id.date": 1 } },
      ])
      .toArray();

    const byDay: Record<string, Record<string, number>> = {};
    const totalsAll: Record<string, number> = {};
    const todayDate = todayStart.toISOString().substring(0, 10);

    for (const row of agg) {
      const date = row._id.date;
      const action = row._id.action;
      if (!byDay[date]) byDay[date] = {};
      byDay[date][action] = row.count;
      totalsAll[action] = (totalsAll[action] ?? 0) + row.count;
    }

    const today: Record<string, number> = byDay[todayDate] ?? {};

    // All-time totals
    const allTimeAgg = await db
      .collection("xavier_growth_logs")
      .aggregate([
        { $match: { status: "success" } },
        { $group: { _id: "$action", count: { $sum: 1 } } },
      ])
      .toArray();

    const totals: Record<string, number> = {};
    for (const row of allTimeAgg) {
      if (row._id) totals[row._id] = row.count;
    }

    // Recent 20 log entries
    const recentLogs = await db
      .collection("xavier_growth_logs")
      .find()
      .sort({ timestamp: -1 })
      .limit(20)
      .toArray();

    // Failed actions last 24h
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const failedCount = await db.collection("xavier_growth_logs").countDocuments({
      status: "failed",
      timestamp: { $gte: oneDayAgo },
    });

    return NextResponse.json({
      success: true,
      byDay,
      totals,
      today,
      recentLogs,
      failedLast24h: failedCount,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
