import { NextRequest, NextResponse } from "next/server";
import { getDatabase } from "@/lib/mongodb";
import { cookies } from "next/headers";

export const maxDuration = 30;

// ── GET: Fetch felix_conversation_logs ────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const fbSessionRaw = req.cookies.get("fb_session")?.value;
    if (!fbSessionRaw) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    const db = await getDatabase();
    const logs = await db
      .collection("felix_conversation_logs")
      .find({})
      .sort({ lastActivity: -1 })
      .limit(50)
      .toArray();

    return NextResponse.json({ success: true, logs });
  } catch (err) {
    console.error("[felix] GET error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ── POST: Save Facebook session cookie ────────────────────────────────────────
// Accepts EITHER:
//   { rawCookies: "c_user=xxx; xs=yyy; datr=zzz; ..." }  ← full raw cookie string (recommended)
//   { c_user, xs, fb_dtsg, datr, doc_id }                ← individual fields (legacy)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    let sessionValue: string;

    if (body.rawCookies && typeof body.rawCookies === "string") {
      // ── New path: parse from raw cookie string ──────────────────────────────
      const raw = body.rawCookies as string;

      const parse = (key: string): string | undefined => {
        const m = raw.match(new RegExp(`(?:^|;\\s*)${key}=([^;]+)`));
        return m ? decodeURIComponent(m[1].trim()) : undefined;
      };

      const c_user = parse("c_user");
      const xs     = parse("xs");
      const datr   = parse("datr");
      const sb      = parse("sb");
      const fr      = parse("fr");

      if (!c_user || !xs) {
        return NextResponse.json(
          { error: "rawCookies must contain at least c_user and xs." },
          { status: 400 }
        );
      }

      // fb_dtsg must be supplied separately — it's in page JS, not a cookie
      const fb_dtsg = body.fb_dtsg ? String(body.fb_dtsg) : undefined;

      sessionValue = JSON.stringify({
        c_user,
        xs,
        ...(fb_dtsg ? { fb_dtsg } : {}),
        ...(datr    ? { datr }    : {}),
        ...(sb      ? { sb }      : {}),
        ...(fr      ? { fr }      : {}),
        rawCookies: raw, // store full raw string for passthrough
      });
    } else {
      // ── Legacy path: individual fields ──────────────────────────────────────
      const { c_user, xs, fb_dtsg, doc_id, datr } = body;

      if (!c_user || !xs || !fb_dtsg) {
        return NextResponse.json(
          { error: "c_user, xs, and fb_dtsg are required." },
          { status: 400 }
        );
      }

      sessionValue = JSON.stringify({
        c_user: String(c_user),
        xs: String(xs),
        fb_dtsg: String(fb_dtsg),
        ...(doc_id ? { doc_id: String(doc_id) } : {}),
        ...(datr   ? { datr: String(datr) }   : {}),
      });
    }

    const cookieStore = await cookies();
    cookieStore.set("fb_session", sessionValue, {
      path: "/",
      httpOnly: false,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });

    return NextResponse.json({ success: true, message: "Facebook session saved." });
  } catch (err) {
    console.error("[felix] POST error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
