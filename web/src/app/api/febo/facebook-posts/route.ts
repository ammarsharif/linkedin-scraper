import { NextRequest, NextResponse } from "next/server";
import { getDatabase } from "@/lib/mongodb";

export const maxDuration = 30;

export async function GET(req: NextRequest) {
  try {
    const cookieString = req.cookies.get("li_session")?.value;
    if (!cookieString) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    const db = await getDatabase();
    const posts = await db
      .collection("cora_content")
      .find({ platform: "facebook", status: "approved" })
      .sort({ created_at: -1 })
      .limit(100)
      .toArray();

    return NextResponse.json({ success: true, posts });
  } catch (err) {
    console.error("[febo/facebook-posts] GET error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
