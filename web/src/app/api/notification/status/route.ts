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

    const [escResult, saResult] = await Promise.all([
      db
        .collection("escalations")
        .aggregate([
          { $match: { status: { $in: ["pending", "reminded"] } } },
          { $group: { _id: null, count: { $sum: 1 }, lastAt: { $max: "$createdAt" } } },
        ])
        .toArray(),
      db
        .collection("session_alerts")
        .aggregate([
          { $match: { status: "pending" } },
          { $group: { _id: null, count: { $sum: 1 }, lastAt: { $max: "$createdAt" } } },
        ])
        .toArray(),
    ]);

    const pendingEscalations: number = escResult[0]?.count ?? 0;
    const pendingSessionAlerts: number = saResult[0]?.count ?? 0;

    // Pick the most recent createdAt across both collections as the change signal
    const escLastAt: string | null = escResult[0]?.lastAt ?? null;
    const saLastAt: string | null = saResult[0]?.lastAt ?? null;
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
