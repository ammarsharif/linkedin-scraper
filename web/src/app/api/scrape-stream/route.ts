import { NextRequest, NextResponse } from "next/server";
import { getLinkedInCookies } from "@/lib/linkedin";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * SSE streaming proxy for the scraper.
 * Forwards the request to the Python FastAPI /scrape-stream endpoint
 * and streams progress events back to the frontend.
 */
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

    const limit = Math.min(Math.max(1, Number(postsLimit) || 10), 50);
    const backendUrl =
      process.env.PYTHON_BACKEND_URL?.replace(/\/$/, "") ||
      "http://127.0.0.1:8000";

    // Fetch the SSE stream from FastAPI
    const apiResponse = await fetch(`${backendUrl}/scrape-stream`, {
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

    if (!apiResponse.ok || !apiResponse.body) {
      const errorText = await apiResponse.text();
      return NextResponse.json(
        { error: `Scraper API error: ${apiResponse.statusText}. ${errorText}` },
        { status: apiResponse.status }
      );
    }

    // Pipe the SSE stream through to the client
    const stream = new ReadableStream({
      async start(controller) {
        const reader = apiResponse.body!.getReader();
        const decoder = new TextDecoder();

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            controller.enqueue(new TextEncoder().encode(chunk));
          }
        } catch (err) {
          console.error("[scrape-stream] Stream error:", err);
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    console.error("[scrape-stream] Fatal error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Stream error: ${msg}` },
      { status: 500 }
    );
  }
}
