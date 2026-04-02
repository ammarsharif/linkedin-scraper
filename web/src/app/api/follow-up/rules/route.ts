import { NextRequest, NextResponse } from "next/server";
import { getDatabase, FollowUpRule, FollowUpBotName } from "@/lib/mongodb";
import { ObjectId } from "mongodb";

export const maxDuration = 30;

// GET — list rules for a bot (optionally all bots)
export async function GET(req: NextRequest) {
  try {
    const botName = req.nextUrl.searchParams.get("botName") || undefined;
    const filter: Record<string, any> = {};
    if (botName) filter.botName = botName;

    const db = await getDatabase();
    const rules = await db
      .collection<FollowUpRule>("follow_up_rules")
      .find(filter)
      .sort({ createdAt: -1 })
      .toArray();

    return NextResponse.json({ success: true, rules });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// POST — create a new rule
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { botName, type, value } = body as Partial<FollowUpRule>;

    if (!botName || !type || !value) {
      return NextResponse.json(
        { error: "botName, type, value are required." },
        { status: 400 }
      );
    }
    if (!["keyword", "phrase"].includes(type)) {
      return NextResponse.json(
        { error: "type must be 'keyword' or 'phrase'." },
        { status: 400 }
      );
    }

    const db = await getDatabase();

    // Prevent exact duplicates
    const existing = await db
      .collection("follow_up_rules")
      .findOne({ botName, value: value.trim().toLowerCase() });
    if (existing) {
      return NextResponse.json({ success: true, id: existing._id, duplicate: true });
    }

    const now = new Date().toISOString();
    const rule: FollowUpRule = {
      botName: botName as FollowUpBotName,
      type,
      value: value.trim().toLowerCase(),
      enabled: true,
      createdAt: now,
    };

    const result = await db
      .collection<FollowUpRule>("follow_up_rules")
      .insertOne(rule as any);

    return NextResponse.json({ success: true, id: result.insertedId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// PATCH — toggle enabled/disabled
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, enabled } = body;

    if (!id || enabled === undefined) {
      return NextResponse.json({ error: "id and enabled are required." }, { status: 400 });
    }

    const db = await getDatabase();
    await db
      .collection("follow_up_rules")
      .updateOne({ _id: new ObjectId(id) }, { $set: { enabled: Boolean(enabled) } });

    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// DELETE — remove a rule
export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });

    const db = await getDatabase();
    await db.collection("follow_up_rules").deleteOne({ _id: new ObjectId(id) });

    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ── Utility: check if a message matches any active rule for a bot ─────────
// Used by bot inbox crons to auto-register follow-up tracking.
// Export as a helper so cron files can import it directly.
export async function checkMessageMatchesFollowUpRule(
  botName: FollowUpBotName,
  messageText: string
): Promise<boolean> {
  try {
    const db = await getDatabase();
    const rules = await db
      .collection<FollowUpRule>("follow_up_rules")
      .find({ botName, enabled: true })
      .toArray();

    const lower = messageText.toLowerCase();
    return rules.some((r) => lower.includes(r.value));
  } catch {
    return false;
  }
}
