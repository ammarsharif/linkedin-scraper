import { NextRequest, NextResponse } from "next/server";
import { getDatabase } from "@/lib/mongodb";
import { cookies } from "next/headers";

// ── GET: session info + settings + today's stats ─────────────────────────────
export async function GET() {
  try {
    const db = await getDatabase();

    const sessionDoc = await db
      .collection("xavier_config")
      .findOne({ type: "tw_session" });

    const session = sessionDoc
      ? {
          exists: true,
          username: sessionDoc.username,
          twid: sessionDoc.twid,
          passcode: sessionDoc.passcode,
          savedAt: sessionDoc.savedAt,
          status: sessionDoc.status ?? "active",
        }
      : { exists: false };

    // Today's growth stats
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayAgg = await db
      .collection("xavier_growth_logs")
      .aggregate([
        {
          $match: {
            status: "success",
            timestamp: { $gte: todayStart.toISOString() },
          },
        },
        { $group: { _id: "$action", count: { $sum: 1 } } },
      ])
      .toArray();

    const todayStats: Record<string, number> = {};
    for (const row of todayAgg) {
      if (row._id) todayStats[row._id] = row.count;
    }

    // Settings
    const settingsDoc = await db
      .collection("xavier_settings")
      .findOne({ type: "growth_settings" });

    // Conversation logs (last 30)
    const logs = await db
      .collection("xavier_conversations")
      .find()
      .sort({ lastActivity: -1 })
      .limit(30)
      .toArray();

    return NextResponse.json({
      session,
      todayStats,
      settings: settingsDoc ?? null,
      logs,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ── POST: save Twitter session cookies ───────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const db = await getDatabase();

    let auth_token: string;
    let ct0: string;
    let twid: string | undefined;
    let username: string | undefined;
    let passcode: string | undefined;

    if (body.rawCookies) {
      const raw: string = body.rawCookies;
      const parse = (key: string): string | undefined => {
        const m = raw.match(new RegExp(`(?:^|;\\s*)${key}=([^;]+)`));
        return m ? decodeURIComponent(m[1].trim()) : undefined;
      };
      auth_token = parse("auth_token") ?? "";
      ct0 = parse("ct0") ?? "";
      twid = parse("twid");
      // twid comes as "u%3D123456789" — decode it
      if (twid) twid = decodeURIComponent(twid);
    } else {
      auth_token = String(body.auth_token ?? "").trim();
      ct0 = String(body.ct0 ?? "").trim();
      twid = body.twid ? String(body.twid).trim() : undefined;
    }

    username = body.username ? String(body.username).trim() : undefined;
    passcode = body.passcode ? String(body.passcode).trim() : undefined;

    if (!auth_token || !ct0) {
      return NextResponse.json(
        { error: "auth_token and ct0 are required." },
        { status: 400 }
      );
    }

    const sessionValue = JSON.stringify({ auth_token, ct0, twid, username, passcode });

    // Store in Next.js cookie
    const cookieStore = await cookies();
    cookieStore.set("tw_session", sessionValue, {
      httpOnly: false,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });

    // Persist in MongoDB
    await db.collection("xavier_config").updateOne(
      { type: "tw_session" },
      {
        $set: {
          type: "tw_session",
          auth_token,
          ct0,
          twid,
          username,
          passcode,
          rawCookies: body.rawCookies ?? null,
          savedAt: new Date().toISOString(),
          status: "active",
        },
      },
      { upsert: true }
    );

    return NextResponse.json({ success: true, username });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ── DELETE: clear session ────────────────────────────────────────────────────
export async function DELETE() {
  try {
    const db = await getDatabase();
    await db
      .collection("xavier_config")
      .updateOne(
        { type: "tw_session" },
        { $set: { status: "expired" } }
      );

    const cookieStore = await cookies();
    cookieStore.delete("tw_session");

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ── PATCH: save growth settings ──────────────────────────────────────────────
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const db = await getDatabase();

    await db.collection("xavier_settings").updateOne(
      { type: "growth_settings" },
      {
        $set: {
          type: "growth_settings",
          targetKeywords: body.targetKeywords ?? [],
          targetHashtags: body.targetHashtags ?? [],
          targetProfiles: body.targetProfiles ?? [],
          dailyFollowLimit: Number(body.dailyFollowLimit ?? 30),
          dailyLikeLimit: Number(body.dailyLikeLimit ?? 50),
          dailyRetweetLimit: Number(body.dailyRetweetLimit ?? 20),
          dailyReplyLimit: Number(body.dailyReplyLimit ?? 15),
          dailyDmLimit: Number(body.dailyDmLimit ?? 10),
          replyPrompt:
            body.replyPrompt ??
            "Write a short, genuine, relevant 1-2 sentence reply (no hashtags) for a tweet about the topic provided. Be specific, insightful, and professional.",
          dmSystemPrompt:
            body.dmSystemPrompt ??
            "You are a professional Twitter assistant. Reply warmly and professionally to Twitter DMs on behalf of the user. Keep replies under 3 sentences.",
          enableLike: body.enableLike ?? true,
          enableFollow: body.enableFollow ?? true,
          enableRetweet: body.enableRetweet ?? true,
          enableReply: body.enableReply ?? true,
          lastUpdated: new Date().toISOString(),
        },
      },
      { upsert: true }
    );

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
