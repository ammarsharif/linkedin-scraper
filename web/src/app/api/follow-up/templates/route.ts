import { NextRequest, NextResponse } from "next/server";
import { getDatabase, FollowUpTemplate, FollowUpBotName } from "@/lib/mongodb";
import { ObjectId } from "mongodb";

export const maxDuration = 30;

const DEFAULT_TEMPLATES: Record<number, string> = {
  1: "Hi {{user_name}}, just a friendly reminder about my previous message. Would love to hear your thoughts!",
  2: "Hi {{user_name}}, following up again — I wanted to make sure my message didn't get lost. Looking forward to connecting!",
  3: "Hi {{user_name}}, reaching out one more time. I sent a message {{days_waiting}} day(s) ago and haven't heard back. Happy to help whenever you're ready!",
  4: "Hi {{user_name}}, I know you're busy — just wanted to check in once more. Feel free to reach out anytime.",
  5: "Hi {{user_name}}, this will be my last follow-up. If you ever want to reconnect, don't hesitate to reach out. Wishing you all the best!",
};

// GET — list all templates for a bot (or all bots)
export async function GET(req: NextRequest) {
  try {
    const botName = req.nextUrl.searchParams.get("botName") || undefined;
    const filter: Record<string, any> = {};
    if (botName) filter.botName = botName;

    const db = await getDatabase();
    const templates = await db
      .collection<FollowUpTemplate>("follow_up_templates")
      .find(filter)
      .sort({ botName: 1, followUpNumber: 1 })
      .toArray();

    // Fill in defaults for any missing steps
    if (botName) {
      const byStep: Record<number, FollowUpTemplate> = {};
      for (const t of templates) byStep[t.followUpNumber] = t;

      const filled: FollowUpTemplate[] = [];
      for (let i = 1; i <= 5; i++) {
        filled.push(
          byStep[i] ?? {
            botName: botName as FollowUpBotName,
            followUpNumber: i as 1 | 2 | 3 | 4 | 5,
            messageText: DEFAULT_TEMPLATES[i],
            updatedAt: new Date().toISOString(),
          }
        );
      }
      return NextResponse.json({ success: true, templates: filled });
    }

    return NextResponse.json({ success: true, templates });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// POST — upsert a template (create or update by botName + followUpNumber)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { botName, followUpNumber, messageText } = body as Partial<FollowUpTemplate>;

    if (!botName || !followUpNumber || !messageText) {
      return NextResponse.json(
        { error: "botName, followUpNumber, messageText are required." },
        { status: 400 }
      );
    }
    if (followUpNumber < 1 || followUpNumber > 5) {
      return NextResponse.json(
        { error: "followUpNumber must be between 1 and 5." },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    const db = await getDatabase();

    await db.collection<FollowUpTemplate>("follow_up_templates").updateOne(
      { botName, followUpNumber },
      { $set: { botName, followUpNumber, messageText, updatedAt: now } },
      { upsert: true }
    );

    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// DELETE — remove a template (reverts to default)
export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });

    const db = await getDatabase();
    await db.collection("follow_up_templates").deleteOne({ _id: new ObjectId(id) });

    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
