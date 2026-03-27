import { NextRequest, NextResponse } from "next/server";
import { getDatabase } from "@/lib/mongodb";
import { cookies } from "next/headers";

export const maxDuration = 30;

const SESSION_TYPE = "fb_session";

// ── GET: Session status + conversation logs ────────────────────────────────────
export async function GET() {
  try {
    const db = await getDatabase();

    const sessionDoc = await db
      .collection("felix_config")
      .findOne({ type: SESSION_TYPE });

    const session = sessionDoc
      ? {
          exists: true,
          c_user: sessionDoc.c_user as string,
          savedAt: sessionDoc.savedAt as string,
          status: (sessionDoc.status as string) || "active",
        }
      : { exists: false };

    if (!sessionDoc) {
      return NextResponse.json({ session, logs: [] });
    }

    const logs = await db
      .collection("felix_conversation_logs")
      .find({})
      .sort({ lastActivity: -1 })
      .limit(50)
      .toArray();

    return NextResponse.json({ success: true, session, logs });
  } catch (err) {
    console.error("[felix] GET error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ── POST: Save Facebook session (cookie + MongoDB) ────────────────────────────
// Accepts EITHER:
//   { rawCookies: "c_user=xxx; xs=yyy; ..." }   ← recommended
//   { c_user, xs, fb_dtsg, datr }               ← legacy
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    let c_user: string;
    let xs: string;
    let datr: string | undefined;
    let sb: string | undefined;
    let fr: string | undefined;
    let fb_dtsg: string | undefined;
    let rawCookies: string | undefined;

    if (body.rawCookies && typeof body.rawCookies === "string") {
      const raw = body.rawCookies as string;
      const parse = (key: string): string | undefined => {
        const m = raw.match(new RegExp(`(?:^|;\\s*)${key}=([^;]+)`));
        return m ? decodeURIComponent(m[1].trim()) : undefined;
      };

      c_user = parse("c_user") ?? "";
      xs = parse("xs") ?? "";
      datr = parse("datr");
      sb = parse("sb");
      fr = parse("fr");
      rawCookies = raw;
      fb_dtsg = body.fb_dtsg ? String(body.fb_dtsg) : undefined;

      if (!c_user || !xs) {
        return NextResponse.json(
          { error: "rawCookies must contain at least c_user and xs." },
          { status: 400 }
        );
      }
    } else {
      c_user = String(body.c_user ?? "");
      xs = String(body.xs ?? "");
      fb_dtsg = body.fb_dtsg ? String(body.fb_dtsg) : undefined;
      datr = body.datr ? String(body.datr) : undefined;

      if (!c_user || !xs || !fb_dtsg) {
        return NextResponse.json(
          { error: "c_user, xs, and fb_dtsg are required." },
          { status: 400 }
        );
      }
    }

    const sessionValue = JSON.stringify({
      c_user,
      xs,
      ...(fb_dtsg ? { fb_dtsg } : {}),
      ...(datr ? { datr } : {}),
      ...(sb ? { sb } : {}),
      ...(fr ? { fr } : {}),
      ...(rawCookies ? { rawCookies } : {}),
    });

    // Save to browser cookie (30 days)
    const cookieStore = await cookies();
    cookieStore.set("fb_session", sessionValue, {
      path: "/",
      httpOnly: false,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30,
    });

    // Save to MongoDB so the session survives browser/server restarts
    const db = await getDatabase();
    await db.collection("felix_config").updateOne(
      { type: SESSION_TYPE },
      {
        $set: {
          type: SESSION_TYPE,
          c_user,
          xs,
          ...(fb_dtsg ? { fb_dtsg } : {}),
          ...(datr ? { datr } : {}),
          ...(sb ? { sb } : {}),
          ...(fr ? { fr } : {}),
          ...(rawCookies ? { rawCookies } : {}),
          savedAt: new Date().toISOString(),
          status: "active",
        },
      },
      { upsert: true }
    );

    return NextResponse.json({ success: true, message: "Facebook session saved." });
  } catch (err) {
    console.error("[felix] POST error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ── DELETE: Clear Facebook session ─────────────────────────────────────────────
export async function DELETE() {
  try {
    const db = await getDatabase();
    await db.collection("felix_config").deleteOne({ type: SESSION_TYPE });

    const cookieStore = await cookies();
    cookieStore.delete("fb_session");

    return NextResponse.json({ success: true, message: "Facebook session cleared." });
  } catch (err) {
    console.error("[felix] DELETE error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
