import { NextRequest, NextResponse } from "next/server";
import { validateCookie } from "@/lib/linkedin";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { cookie } = body;

    if (!cookie || typeof cookie !== "string" || cookie.trim().length < 10) {
      return NextResponse.json(
        { error: "Please provide a valid li_at cookie value" },
        { status: 400 }
      );
    }

    const liAt = cookie.trim();
    const result = await validateCookie(liAt);

    if (!result.valid) {
      return NextResponse.json(
        {
          error:
            "Invalid or expired li_at cookie. Please copy a fresh one from your browser.",
        },
        { status: 401 }
      );
    }

    // Store the cookie in an httpOnly session cookie
    const response = NextResponse.json({
      success: true,
      name: result.name ?? "LinkedIn User",
    });

    const cookieOptions = {
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict" as const,
      path: "/",
      maxAge: 60 * 60 * 24 * 7, // 7 days
    };

    response.cookies.set("li_at_session", liAt, {
      ...cookieOptions,
      httpOnly: true, // httpOnly so JS can't read the actual cookie value
    });

    // Store display name in a readable cookie (not sensitive)
    response.cookies.set("li_at_name", result.name ?? "LinkedIn User", {
      ...cookieOptions,
      httpOnly: false,
    });

    return response;
  } catch (error) {
    console.error("Auth error:", error);
    return NextResponse.json(
      { error: "Server error while validating cookie. Please try again." },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  const cookie = req.cookies.get("li_at_session")?.value;

  if (!cookie) {
    return NextResponse.json({ authenticated: false });
  }

  // Quick lightweight check — don't re-validate on every navigation
  // Just confirm the cookie exists (we validated it on login)
  return NextResponse.json({
    authenticated: true,
    name: req.cookies.get("li_at_name")?.value ?? "LinkedIn User",
  });
}

export async function DELETE() {
  const response = NextResponse.json({ success: true });
  response.cookies.delete("li_at_session");
  response.cookies.delete("li_at_name");
  return response;
}
