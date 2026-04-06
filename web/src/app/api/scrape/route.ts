import { NextRequest, NextResponse } from "next/server";
import { extractVanityName, getLinkedInCookies } from "@/lib/linkedin";
import { spawn } from "child_process";
import path from "path";

export const maxDuration = 300; // 5 minutes — Playwright needs time

// ── Python bridge caller ────────────────────────────────────────────────────

interface BridgeResult {
  profile: {
    name: string;
    headline: string;
    location: string;
    profileUrl: string;
    vanityName: string;
  };
  posts: {
    urn: string;
    text: string;
    postedDate: string;
    reactionsCount: number;
    commentsCount: number;
    repostsCount: number;
    postUrl: string;
    imageUrls: string[];
    videoUrl: string | null;
    articleUrl: string | null;
  }[];
  error?: string;
}

// ── Utility Removed: The legacy Python bridge caller runPlaywrightBridge() is now obsolete. Data is fetched via FastAPI ──

// ── Route handler ───────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const cookieString = await getLinkedInCookies(req);
    if (!cookieString) {
      return NextResponse.json(
        { error: "Not authenticated. Please log in again." },
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

    let vanityName: string;
    try {
      vanityName = extractVanityName(profileUrl.trim());
    } catch {
      return NextResponse.json(
        { error: "Invalid LinkedIn profile URL. Expected: https://linkedin.com/in/username" },
        { status: 400 }
      );
    }

    const limit = Math.min(Math.max(1, Number(postsLimit) || 10), 50);

    console.log(`[scrape] Calling FastAPI endpoint for ${vanityName}, limit=${limit}`);

    // Call the new FastAPI endpoint instead of spawning bridge process
    const backendUrl = process.env.PYTHON_BACKEND_URL?.replace(/\/$/, '') || "http://127.0.0.1:8000";
    const apiResponse = await fetch(`${backendUrl}/scrape`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "ngrok-skip-browser-warning": "true",
        "User-Agent": "NextJS-Backend",
      },
      body: JSON.stringify({
        cookieString,
        profileUrl: profileUrl.trim(),
        limit,
      }),
    });

    if (!apiResponse.ok) {
        const errorText = await apiResponse.text();
        console.error(`[scrape] FastAPI error status ${apiResponse.status}:`, errorText);
        return NextResponse.json({ error: `Scraper API error: ${apiResponse.statusText}. Details: ${errorText}` }, { status: apiResponse.status });
    }

    const result = await apiResponse.json();

    if (result.error) {
      if (result.error.includes("Not logged in") || result.error.includes("authenticate")) {
        return NextResponse.json(
          { error: "Not logged in to LinkedIn. Please re-authenticate." },
          { status: 401 }
        );
      }
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    console.log(`[scrape] Done — profile: "${result.profile.name}", posts: ${result.posts.length}`);

    return NextResponse.json({
      success: true,
      profile: result.profile,
      posts: result.posts,
      totalPosts: result.posts.length,
    });
  } catch (err) {
    console.error("[scrape] Fatal error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Scraper error: ${msg}` }, { status: 500 });
  }
}
