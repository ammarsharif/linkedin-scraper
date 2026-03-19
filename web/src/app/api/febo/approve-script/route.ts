import { NextRequest, NextResponse } from "next/server";
import { getDatabase } from "@/lib/mongodb";

export const maxDuration = 30;

const VALID_TYPES = ["sales_call", "dm_chat", "demo", "objection_handling"];

export async function POST(req: NextRequest) {
  try {
    const cookieString = req.cookies.get("li_session")?.value;
    if (!cookieString) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    const { personaId, personaName, manualInput, scriptType, content, status } = await req.json();

    if (!scriptType || !content) {
      return NextResponse.json(
        { error: "scriptType and content are required." },
        { status: 400 }
      );
    }
    if (!VALID_TYPES.includes(scriptType)) {
      return NextResponse.json({ error: "Invalid script type." }, { status: 400 });
    }

    const recordStatus = status === "draft" ? "draft" : "approved";

    const db = await getDatabase();
    const doc = {
      id: crypto.randomUUID(),
      persona_id: personaId || null,
      persona_name: personaName || null,
      manual_input: manualInput || null,
      script_type: scriptType,
      content,
      status: recordStatus,
      created_at: new Date().toISOString(),
    };

    await db.collection("febo_scripts").insertOne(doc);

    return NextResponse.json({ success: true, record: doc });
  } catch (err) {
    console.error("[febo/approve-script] POST error:", err);
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
    const scriptType = searchParams.get("scriptType");

    const query: Record<string, string> = {};
    if (personaId) query.persona_id = personaId;
    if (scriptType) query.script_type = scriptType;

    const db = await getDatabase();
    const records = await db
      .collection("febo_scripts")
      .find(query)
      .sort({ created_at: -1 })
      .limit(100)
      .toArray();

    return NextResponse.json({ success: true, records });
  } catch (err) {
    console.error("[febo/approve-script] GET error:", err);
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
    await db.collection("febo_scripts").deleteOne({ id });
    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
