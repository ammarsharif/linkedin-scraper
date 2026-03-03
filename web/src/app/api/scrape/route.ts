import { NextRequest, NextResponse } from "next/server";
import { extractVanityName } from "@/lib/linkedin";
import { spawn } from "child_process";
import path from "path";

export const maxDuration = 120; // 2 minutes — Playwright needs time

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

async function runPlaywrightBridge(
  cookieString: string,
  profileUrl: string,
  limit: number
): Promise<BridgeResult> {
  return new Promise((resolve, reject) => {
    // scraper_bridge.py lives one level up from the web/ directory
    const bridgePath = path.join(process.cwd(), "scraper_bridge.py");
    const payload = JSON.stringify({ cookieString, profileUrl, limit });

    console.log(`[bridge] Spawning python scraper_bridge.py for ${profileUrl}`);
    console.log(`[bridge] Bridge path: ${bridgePath}`);

    // Try "python" first, then "python3" on systems where that's the alias
    const pythonCmd = process.platform === "win32" ? "python" : "python3";
    const proc = spawn(pythonCmd, [bridgePath], {
      cwd: path.join(process.cwd(), ".."), // Run from project root
      env: {
        ...process.env,
        PYTHONIOENCODING: "utf-8",   // Force UTF-8 stdout/stderr on Windows
        PYTHONUTF8: "1",             // Python 3.7+ UTF-8 mode flag
      },
    });

    let stdout = "";
    let stderr = "";

    proc.stdin.write(payload);
    proc.stdin.end();

    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      const line = chunk.toString();
      stderr += line;
      // Surface Python logs in Next.js terminal
      process.stdout.write(`[py] ${line}`);
    });

    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      reject(new Error("Python bridge timed out after 100 seconds"));
    }, 100_000);

    proc.on("close", (code) => {
      clearTimeout(timer);
      console.log(`[bridge] Process exited with code ${code}`);
      if (stderr) console.log(`[bridge] stderr: ${stderr.slice(-500)}`);

      if (code !== 0) {
        reject(new Error(`Bridge exited ${code}: ${stderr.slice(-300)}`));
        return;
      }

      // The bridge prints one JSON line to stdout
      const lastLine = stdout.trim().split("\n").pop() ?? "";
      try {
        const parsed = JSON.parse(lastLine) as BridgeResult;
        resolve(parsed);
      } catch {
        reject(new Error(`Failed to parse bridge JSON output: ${lastLine.slice(0, 200)}`));
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      console.error("[bridge] spawn error:", err);
      reject(err);
    });
  });
}

// ── Route handler ───────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const cookieString = req.cookies.get("li_session")?.value;
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

    console.log(`[scrape] Starting bridge scrape for ${vanityName}, limit=${limit}`);

    const result = await runPlaywrightBridge(cookieString, profileUrl.trim(), limit);

    if (result.error) {
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
