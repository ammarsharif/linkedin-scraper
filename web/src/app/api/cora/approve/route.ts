import { NextRequest, NextResponse } from "next/server";
import { getDatabase } from "@/lib/mongodb";
import { getLinkedInCookies } from "@/lib/linkedin";

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const cookieString = await getLinkedInCookies(req);
    if (!cookieString) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    const { personaId, personaName, originalPost, platform, content, status } = await req.json();

    if (!personaId || !originalPost || !platform || !content) {
      return NextResponse.json(
        { error: "personaId, originalPost, platform, and content are required." },
        { status: 400 }
      );
    }

    const validPlatforms = ["facebook", "twitter", "instagram", "email"];
    if (!validPlatforms.includes(platform)) {
      return NextResponse.json({ error: "Invalid platform." }, { status: 400 });
    }

    const validStatuses = ["draft", "approved"];
    const recordStatus = validStatuses.includes(status) ? status : "approved";

    const db = await getDatabase();
    const doc = {
      id: crypto.randomUUID(),
      persona_id: personaId,
      persona_name: personaName || null,
      original_post: originalPost,
      platform,
      content,
      status: recordStatus,
      created_at: new Date().toISOString(),
    };

    await db.collection("cora_content").insertOne(doc);

    return NextResponse.json({ success: true, record: doc });
  } catch (err) {
    console.error("[cora/approve] POST error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const cookieString = await getLinkedInCookies(req);
    if (!cookieString) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const personaId = searchParams.get("personaId");

    const db = await getDatabase();
    const query = personaId ? { persona_id: personaId } : {};
    const records = await db
      .collection("cora_content")
      .find(query)
      .sort({ created_at: -1 })
      .limit(100)
      .toArray();

    return NextResponse.json({ success: true, records });
  } catch (err) {
    console.error("[cora/approve] GET error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
