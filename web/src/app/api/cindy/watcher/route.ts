import { NextRequest, NextResponse } from "next/server";

const API_BASE = process.env.SCRAPER_API_URL || "http://127.0.0.1:8000";

export async function GET() {
  try {
    const res = await fetch(`${API_BASE}/watcher/status`, { cache: "no-store" });
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    console.error("[watcher] status error:", err);
    return NextResponse.json(
      { running: false, pid: null, logLines: [], error: "Backend unreachable" },
      { status: 502 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const { action } = await req.json();

    if (action !== "start" && action !== "stop") {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    const res = await fetch(`${API_BASE}/watcher/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    console.error("[watcher] action error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
