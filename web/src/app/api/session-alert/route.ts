import { NextResponse } from "next/server";
import { getDatabase } from "@/lib/mongodb";

export const maxDuration = 30;

// GET — returns all pending session alerts
export async function GET() {
  try {
    const db = await getDatabase();
    const alerts = await db
      .collection("session_alerts")
      .find({ status: "pending" })
      .sort({ createdAt: -1 })
      .toArray();

    return NextResponse.json({ success: true, alerts });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
