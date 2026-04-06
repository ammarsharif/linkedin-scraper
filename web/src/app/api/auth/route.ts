import { NextRequest, NextResponse } from "next/server";
import { validateCookie, extractLiAt, extractJsessionId } from "@/lib/linkedin";
import { resolveSessionAlert } from "@/lib/sessionAlert";
import { getDatabase } from "@/lib/mongodb";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const rawCookie: string = (body.cookieString ?? body.cookie ?? "").trim();

    if (!rawCookie) {
      return NextResponse.json({ error: "Cookie string is required" }, { status: 400 });
    }
    if (!rawCookie.includes("li_at=")) {
      return NextResponse.json(
        { error: 'Cookie string must contain "li_at=". Please copy the full Cookie header.' },
        { status: 400 }
      );
    }
    if (!rawCookie.includes("JSESSIONID=")) {
      return NextResponse.json(
        { error: 'Cookie string must contain "JSESSIONID=". Please copy the full Cookie header (not just li_at).' },
        { status: 400 }
      );
    }

    const liAt = extractLiAt(rawCookie);
    const jsessionId = extractJsessionId(rawCookie);
    if (!liAt || !jsessionId) {
      return NextResponse.json(
        { error: "Could not parse li_at or JSESSIONID from the cookie string." },
        { status: 400 }
      );
    }

    // Validate credentials against LinkedIn
    const result = await validateCookie(rawCookie);
    if (!result.valid) {
      return NextResponse.json(
        { error: "LinkedIn rejected these cookies. They may be expired. Please copy fresh cookies from your browser." },
        { status: 401 }
      );
    }

    const name = result.name ?? "LinkedIn User";
    const response = NextResponse.json({ success: true, name });

    const cookieOpts = {
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict" as const,
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    };

    // Store the full cookie string (httpOnly — not readable by JS)
    response.cookies.set("li_session", rawCookie, { ...cookieOpts, httpOnly: true });
    // Store display name (readable)
    response.cookies.set("li_name", name, { ...cookieOpts, httpOnly: false });

    // Persist to DB so all bots read fresh cookies from a single source of truth
    try {
      const db = await getDatabase();
      await db.collection("cindy_config").updateOne(
        { type: "li_session" },
        { 
          $set: { 
            type: "li_session", 
            rawCookies: rawCookie, 
            name: name,
            savedAt: new Date().toISOString(), 
            status: "active" 
          } 
        },
        { upsert: true }
      );
    } catch (dbErr) {
      console.error("[auth] Failed to save LinkedIn session to DB:", dbErr);
    }

    await resolveSessionAlert("cindy");

    return response;
  } catch (err) {
    console.error("Auth POST error:", err);
    return NextResponse.json({ error: "Server error during authentication" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  // Check browser cookie first
  let session = req.cookies.get("li_session")?.value;
  let name = req.cookies.get("li_name")?.value;

  if (session) {
    return NextResponse.json({ authenticated: true, name: name ?? "LinkedIn User" });
  }

  // Fallback: Check DB if browser session is missing (e.g. after manual DB update or browser logout)
  try {
    const db = await getDatabase();
    const doc = await db.collection("cindy_config").findOne({ type: "li_session", status: "active" });

    if (doc?.rawCookies) {
      const dbSession = doc.rawCookies as string;
      const dbName = (doc.name as string) ?? "LinkedIn User";

      const response = NextResponse.json({ authenticated: true, name: dbName });

      // Sync back to browser cookies
      const cookieOpts = {
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict" as const,
        path: "/",
        maxAge: 60 * 60 * 24 * 7,
      };
      response.cookies.set("li_session", dbSession, { ...cookieOpts, httpOnly: true });
      response.cookies.set("li_name", dbName, { ...cookieOpts, httpOnly: false });

      return response;
    }
  } catch (err) {
    console.error("[auth GET] DB session sync failed:", err);
  }

  return NextResponse.json({ authenticated: false });
}

export async function DELETE() {
  const res = NextResponse.json({ success: true });
  res.cookies.delete("li_session");
  res.cookies.delete("li_name");

  try {
    const db = await getDatabase();
    await db.collection("cindy_config").updateOne(
      { type: "li_session" },
      { $set: { status: "expired" } }
    );
  } catch (dbErr) {
    console.error("[auth] Failed to expire LinkedIn session in DB:", dbErr);
  }

  return res;
}
