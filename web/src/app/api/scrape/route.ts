import { NextRequest, NextResponse } from "next/server";
import {
  fetchProfile,
  fetchPosts,
  extractVanityName,
} from "@/lib/linkedin";

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
        { error: "Invalid LinkedIn profile URL. Expected format: https://linkedin.com/in/username" },
        { status: 400 }
      );
    }

    // Fetch profile data
    const profile = await fetchProfile(liAtCookie, vanityName);

    // Fetch posts
    const posts = await fetchPosts(
      liAtCookie,
      vanityName,
      Math.min(postsLimit, 50)
    );

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
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
