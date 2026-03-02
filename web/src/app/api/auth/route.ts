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

    const result = await validateCookie(cookie.trim());

    if (!result.valid) {
      return NextResponse.json(
        { error: "Invalid or expired li_at cookie. Please get a fresh one." },
        { status: 401 }
      );
    }

    // Set the cookie in an httpOnly cookie for subsequent requests
    const response = NextResponse.json({
      success: true,
      name: result.name,
    });

    response.cookies.set("li_at_session", cookie.trim(), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: 60 * 60 * 24 * 7, // 7 days
    });

    return response;
  } catch (error) {
    console.error("Auth error:", error);
    return NextResponse.json(
      { error: "Failed to validate cookie" },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  const cookie = req.cookies.get("li_at_session")?.value;

  if (!cookie) {
    return NextResponse.json({ authenticated: false });
  }

  const result = await validateCookie(cookie);
  return NextResponse.json({
    authenticated: result.valid,
    name: result.name,
  });
}

export async function DELETE() {
  const response = NextResponse.json({ success: true });
  response.cookies.delete("li_at_session");
  return response;
}
