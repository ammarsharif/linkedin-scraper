import { NextRequest, NextResponse } from "next/server";
import { getDatabase } from "@/lib/mongodb";
import { resolveSessionAlert } from "@/lib/sessionAlert";
import { cookies } from "next/headers";

export const maxDuration = 30;

const SESSION_TYPE = "ig_session";

// ── GET: Session status + conversation logs + growth stats ─────────────────
export async function GET() {
  try {
    const db = await getDatabase();

    const sessionDoc = await db
      .collection("instar_config")
      .findOne({ type: SESSION_TYPE });

    const session = sessionDoc
      ? {
          exists: true,
          username: sessionDoc.username as string | undefined,
          ds_user_id: sessionDoc.ds_user_id as string,
          savedAt: sessionDoc.savedAt as string,
          status: (sessionDoc.status as string) || "active",
        }
      : { exists: false };

    if (!sessionDoc) {
      return NextResponse.json({ session, logs: [], settings: null });
    }

    const logs = await db
      .collection("instar_conversation_logs")
      .find({})
      .sort({ lastActivity: -1 })
      .limit(50)
      .toArray();

    const settings = await db
      .collection("instar_settings")
      .findOne({ type: "growth_settings" });

    // Today's growth stats
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayStats = await db
      .collection("instar_growth_logs")
      .aggregate([
        { $match: { timestamp: { $gte: todayStart.toISOString() }, status: "success" } },
        { $group: { _id: "$action", count: { $sum: 1 } } },
      ])
      .toArray();

    const stats: Record<string, number> = {};
    for (const s of todayStats) stats[s._id as string] = s.count;

    return NextResponse.json({ success: true, session, logs, settings, todayStats: stats });
  } catch (err) {
    console.error("[instar] GET error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ── POST: Save Instagram session cookies ────────────────────────────────────
// Accepts { rawCookies: "sessionid=xxx; ds_user_id=yyy; ..." }
// OR      { sessionid, ds_user_id, csrftoken, username? }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    let sessionid: string;
    let ds_user_id: string;
    let csrftoken: string;
    let mid: string | undefined;
    let username: string | undefined;
    let rawCookies: string | undefined;

    if (body.rawCookies && typeof body.rawCookies === "string") {
      const raw: string = body.rawCookies.trim();
      rawCookies = raw;
      username = body.username ? String(body.username) : undefined;

      if (raw.startsWith("[")) {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            sessionid = parsed.find(c => c.name === "sessionid")?.value ?? "";
            ds_user_id = parsed.find(c => c.name === "ds_user_id")?.value ?? "";
            csrftoken = parsed.find(c => c.name === "csrftoken")?.value ?? "";
            mid = parsed.find(c => c.name === "mid")?.value;
          } else {
            sessionid = ""; ds_user_id = ""; csrftoken = "";
          }
        } catch (e) {
          sessionid = ""; ds_user_id = ""; csrftoken = "";
        }
      } else {
        const parse = (key: string): string | undefined => {
          const m = raw.match(new RegExp(`(?:^|;\\s*)${key}=([^;]+)`));
          return m ? decodeURIComponent(m[1].trim()) : undefined;
        };
        sessionid = parse("sessionid") ?? "";
        ds_user_id = parse("ds_user_id") ?? "";
        csrftoken = parse("csrftoken") ?? "";
        mid = parse("mid");
      }

      if (!sessionid || !ds_user_id) {
        return NextResponse.json(
          { error: "Could not find sessionid or ds_user_id in the provided JSON/cookies. Please ensure you are pasting the correct format." },
          { status: 400 }
        );
      }
    } else {
      sessionid = String(body.sessionid ?? "");
      ds_user_id = String(body.ds_user_id ?? "");
      csrftoken = String(body.csrftoken ?? "");
      mid = body.mid ? String(body.mid) : undefined;
      username = body.username ? String(body.username) : undefined;

      if (!sessionid || !ds_user_id || !csrftoken) {
        return NextResponse.json(
          { error: "Manual setup requires sessionid, ds_user_id, and csrftoken." },
          { status: 400 }
        );
      }
    }

    const sessionValue = JSON.stringify({
      sessionid,
      ds_user_id,
      csrftoken,
      ...(mid ? { mid } : {}),
      ...(username ? { username } : {}),
    });

    const cookieStore = await cookies();
    cookieStore.set("ig_session", sessionValue, {
      path: "/",
      httpOnly: false,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30,
    });

    const db = await getDatabase();
    await db.collection("instar_config").updateOne(
      { type: SESSION_TYPE },
      {
        $set: {
          type: SESSION_TYPE,
          sessionid,
          ds_user_id,
          csrftoken,
          ...(mid ? { mid } : {}),
          ...(username ? { username } : {}),
          ...(rawCookies ? { rawCookies } : {}),
          savedAt: new Date().toISOString(),
          status: "active",
        },
      },
      { upsert: true }
    );

    await resolveSessionAlert("instar");

    return NextResponse.json({ success: true, message: "Instagram session saved." });
  } catch (err) {
    console.error("[instar] POST error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ── DELETE: Clear Instagram session ────────────────────────────────────────
export async function DELETE() {
  try {
    const db = await getDatabase();
    await db.collection("instar_config").deleteOne({ type: SESSION_TYPE });

    const cookieStore = await cookies();
    cookieStore.delete("ig_session");

    return NextResponse.json({ success: true, message: "Instagram session cleared." });
  } catch (err) {
    console.error("[instar] DELETE error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
