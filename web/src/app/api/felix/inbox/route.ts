import { NextResponse } from "next/server";

export async function GET() {
  // Legacy HTTP scraping is obsolete due to Facebook E2EE encryption.
  // The new Puppeteer Cron handles finding and replying to all unread messages automatically.
  return NextResponse.json({
    success: true,
    unreadCount: 0,
    unread: [],
  });
}

export async function POST() {
  // Manual reply logic via HTTP API is also disabled due to E2EE restriction. 
  // All replies are handled by 100% automated Puppeteer typing.
  return NextResponse.json({
    success: false,
    error: "Manual sending disabled due to E2EE. Please let the Puppeteer cron auto-reply handle your chats.",
  });
}
