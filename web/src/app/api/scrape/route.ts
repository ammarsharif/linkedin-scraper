import { NextRequest, NextResponse } from "next/server";
import { fetchProfile, fetchPosts, extractVanityName } from "@/lib/linkedin";

export const maxDuration = 30; // Vercel function timeout (seconds)

export async function POST(req: NextRequest) {
  try {
    const liAtCookie = req.cookies.get("li_at_session")?.value;

    if (!liAtCookie) {
      return NextResponse.json(
        { error: "Not authenticated. Please set your li_at cookie first." },
        { status: 401 }
      );
    }

    const body = await req.json();
    const { profileUrl, postsLimit = 10 } = body;

    if (!profileUrl || typeof profileUrl !== "string") {
      return NextResponse.json(
        { error: "Please provide a valid LinkedIn profile URL" },
        { status: 400 }
      );
    }

    // Extract vanity name from URL
    let vanityName: string;
    try {
      vanityName = extractVanityName(profileUrl.trim());
    } catch {
      return NextResponse.json(
        {
          error:
            "Invalid LinkedIn profile URL. Expected format: https://linkedin.com/in/username",
        },
        { status: 400 }
      );
    }

    const limit = Math.min(Math.max(1, Number(postsLimit) || 10), 50);

    // Run profile + posts fetch concurrently to save time
    const [profile, posts] = await Promise.all([
      fetchProfile(liAtCookie, vanityName),
      fetchPosts(liAtCookie, vanityName, limit),
    ]);

    return NextResponse.json({
      success: true,
      profile,
      posts,
      totalPosts: posts.length,
    });
  } catch (error) {
    console.error("Scrape error:", error);
    const message =
      error instanceof Error ? error.message : "Unknown scraping error";

    // Surface a friendlier message for auth failures
    if (
      message.toLowerCase().includes("redirect") ||
      message.toLowerCase().includes("auth") ||
      message.toLowerCase().includes("401") ||
      message.toLowerCase().includes("403")
    ) {
      return NextResponse.json(
        {
          error:
            "LinkedIn session expired or blocked. Please re-authenticate with a fresh li_at cookie.",
        },
        { status: 401 }
      );
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
