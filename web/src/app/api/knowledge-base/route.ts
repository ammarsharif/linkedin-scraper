import { NextRequest, NextResponse } from "next/server";
import { getDatabase, KnowledgeBaseEntry } from "@/lib/mongodb";
import { ObjectId } from "mongodb";

export const maxDuration = 30;

// GET — list entries (optionally filter by botId)
export async function GET(req: NextRequest) {
  try {
    const botId = req.nextUrl.searchParams.get("botId") || undefined;
    const db = await getDatabase();
    const filter = botId ? { $or: [{ botId }, { botId: "all" }] } : {};
    const entries = await db
      .collection<KnowledgeBaseEntry>("knowledge_base")
      .find(filter)
      .sort({ updatedAt: -1 })
      .toArray();
    return NextResponse.json({ success: true, entries });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// POST — create new entry
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { botId, type, title, content } = body as KnowledgeBaseEntry;

    if (!botId || !type || !title || !content) {
      return NextResponse.json(
        { error: "botId, type, title, and content are required." },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    const entry: KnowledgeBaseEntry = {
      botId,
      type,
      title: title.trim(),
      content: content.trim(),
      createdAt: now,
      updatedAt: now,
    };

    const db = await getDatabase();
    const result = await db
      .collection<KnowledgeBaseEntry>("knowledge_base")
      .insertOne(entry as any);

    return NextResponse.json({ success: true, id: result.insertedId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// PATCH — update entry by id
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, title, content, type, botId } = body;

    if (!id) {
      return NextResponse.json({ error: "id is required." }, { status: 400 });
    }

    const updates: Partial<KnowledgeBaseEntry> = { updatedAt: new Date().toISOString() };
    if (title) updates.title = title.trim();
    if (content) updates.content = content.trim();
    if (type) updates.type = type;
    if (botId) updates.botId = botId;

    const db = await getDatabase();
    await db
      .collection("knowledge_base")
      .updateOne({ _id: new ObjectId(id) }, { $set: updates });

    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// DELETE — remove entry by id
export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "id is required." }, { status: 400 });
    }

    const db = await getDatabase();
    await db.collection("knowledge_base").deleteOne({ _id: new ObjectId(id) });

    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
