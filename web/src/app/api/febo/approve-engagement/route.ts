import { NextRequest, NextResponse } from "next/server";
import { getDatabase } from "@/lib/mongodb";

export const maxDuration = 30;

const VALID_TYPES = ["comment_reply", "group_post", "dm_outreach"];

export async function POST(req: NextRequest) {
  try {
    const cookieString = req.cookies.get("li_session")?.value;
    if (!cookieString) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    const { coraContentId, personaId, personaName, engagementType, content, status } =
      await req.json();

    if (!engagementType || !content) {
      return NextResponse.json(
        { error: "engagementType and content are required." },
        { status: 400 }
      );
    }
    if (!VALID_TYPES.includes(engagementType)) {
      return NextResponse.json({ error: "Invalid engagement type." }, { status: 400 });
    }

    const recordStatus = status === "draft" ? "draft" : "approved";

    const db = await getDatabase();
    const doc = {
      id: crypto.randomUUID(),
      cora_content_id: coraContentId || null,
      persona_id: personaId || null,
      persona_name: personaName || null,
      engagement_type: engagementType,
      content,
      status: recordStatus,
      created_at: new Date().toISOString(),
    };

    await db.collection("febo_engagement").insertOne(doc);

    return NextResponse.json({ success: true, record: doc });
  } catch (err) {
    console.error("[febo/approve-engagement] POST error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const cookieString = req.cookies.get("li_session")?.value;
    if (!cookieString) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const personaId = searchParams.get("personaId");
    const engagementType = searchParams.get("engagementType");

    const query: Record<string, string> = {};
    if (personaId) query.persona_id = personaId;
    if (engagementType) query.engagement_type = engagementType;

    const db = await getDatabase();
    const records = await db
      .collection("febo_engagement")
      .find(query)
      .sort({ created_at: -1 })
      .limit(100)
      .toArray();

    return NextResponse.json({ success: true, records });
  } catch (err) {
    console.error("[febo/approve-engagement] GET error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const cookieString = req.cookies.get("li_session")?.value;
    if (!cookieString) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });

    const db = await getDatabase();
    await db.collection("febo_engagement").deleteOne({ id });
    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
