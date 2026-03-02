import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 30;


export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available in production" }, { status: 403 });
  }

  const liAt = req.cookies.get("li_at_session")?.value;
  if (!liAt) {
    return NextResponse.json({ error: "No session cookie" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const vanityName = searchParams.get("name") ?? "jasirullahkhan";

  const csrf = "ajax:1234567890123456";
  const htmlHeaders = {
    Cookie: `li_at=${liAt}; JSESSIONID="${csrf}"`,
    "csrf-token": csrf,
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: "https://www.linkedin.com/",
  };

  const apiHeaders = {
    Cookie: `li_at=${liAt}; JSESSIONID="${csrf}"`,
    "csrf-token": csrf,
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "application/vnd.linkedin.normalized+json+2.1",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: "https://www.linkedin.com/feed/",
    "x-li-lang": "en_US",
    "x-restli-protocol-version": "2.0.0",
  };

  const results: Record<string, unknown> = {};

  // 1. Profile HTML page
  try {
    const r = await fetch(`https://www.linkedin.com/in/${vanityName}/`, { headers: htmlHeaders, redirect: "manual" });
    const text = r.ok ? (await r.text()).slice(0, 2000) : null;
    results.profileHtml = { status: r.status, hasOgTitle: text?.includes("og:title") ?? false, hasLoginForm: text?.includes("login-form") ?? false, preview: text?.slice(0, 500) };
  } catch (e) { results.profileHtml = { error: String(e) }; }

  // 2. Activity HTML page
  try {
    const r = await fetch(`https://www.linkedin.com/in/${vanityName}/recent-activity/all/`, { headers: htmlHeaders, redirect: "manual" });
    const text = r.ok ? await r.text() : null;
    const urnCount = (text?.match(/urn:li:activity:/g) ?? []).length;
    results.activityHtml = { status: r.status, urnCount, hasLoginForm: text?.includes("login-form") ?? false, preview: text?.slice(0, 300) };
  } catch (e) { results.activityHtml = { error: String(e) }; }

  // 3. Voyager feed/dash
  try {
    const r = await fetch(
      `https://www.linkedin.com/voyager/api/feed/dash/feedUpdates?q=profileUpdatesByMemberShareFeed&memberIdentity=${vanityName}&count=10&start=0`,
      { headers: apiHeaders, redirect: "manual" }
    );
    const text = r.ok ? await r.text() : null;
    results.voyagerFeedDash = { status: r.status, preview: text?.slice(0, 1000) };
  } catch (e) { results.voyagerFeedDash = { error: String(e) }; }

  // 4. Voyager /me
  try {
    const r = await fetch("https://www.linkedin.com/voyager/api/me", { headers: apiHeaders, redirect: "manual" });
    const text = r.ok ? await r.text() : null;
    results.voyagerMe = { status: r.status, preview: text?.slice(0, 1000) };
  } catch (e) { results.voyagerMe = { error: String(e) }; }

  return NextResponse.json(results, { status: 200 });
}
