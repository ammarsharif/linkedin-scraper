import { NextRequest, NextResponse } from "next/server";
import { getDatabase } from "@/lib/mongodb";
import { getLinkedInCookies } from "@/lib/linkedin";

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  try {
    const cookieString = await getLinkedInCookies(req);
    if (!cookieString) {
      return NextResponse.json(
        { error: "Not authenticated." },
        { status: 401 }
      );
    }

    const db = await getDatabase();
    const profiles = await db
      .collection("profiles")
      .find({})
      .sort({ lastUpdated: -1 })
      .toArray();

    return NextResponse.json({ success: true, profiles });
  } catch (err) {
    console.error("[cora] GET error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
