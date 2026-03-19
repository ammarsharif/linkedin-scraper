import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;

const DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const MOBILE_UA  = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";

/** Full browser-like headers for a document navigation request */
function browserDocHeaders(cookieHeader: string, ua = DESKTOP_UA, referer?: string) {
  const isMobile = ua.includes("Mobile");
  return {
    Cookie: cookieHeader,
    "User-Agent": ua,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br, zstd",
    "Cache-Control": "max-age=0",
    "Upgrade-Insecure-Requests": "1",
    "sec-ch-ua": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    "sec-ch-ua-mobile": isMobile ? "?1" : "?0",
    "sec-ch-ua-platform": isMobile ? '"Android"' : '"Windows"',
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": referer ? "same-origin" : "none",
    "sec-fetch-user": "?1",
    ...(referer ? { Referer: referer } : {}),
  };
}

function extractLsd(html: string): string | null {
  const patterns = [
    /"LSD",\[\],\{"token":"([^"]+)"\}/,
    /\["LSD",\[\],\{"token":"([^"]+)"\}/,
    /name="lsd"\s+value="([^"]+)"/,
    /\blsd\b.{0,30}"([A-Za-z0-9_\-]{8,30})"/,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m?.[1]) return m[1];
  }
  return null;
}

function extractFbDtsg(html: string): string | null {
  const patterns = [
    /"DTSGInitialData",\[\],\{"token":"([^"]+)"\}/,
    /\["DTSGInitialData",\[\],\{"token":"([^"]+)"\}/,
    /"fb_dtsg","([^"]+)"/,
    /fb_dtsg.*?value="([^"]+)"/,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m?.[1]) return m[1];
  }
  return null;
}

export async function GET(req: NextRequest) {
  try {
    const fbSessionRaw = req.cookies.get("fb_session")?.value;
    if (!fbSessionRaw) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    const { c_user, xs, fb_dtsg: storedFbDtsg, datr, rawCookies } = JSON.parse(fbSessionRaw);
    if (!c_user || !xs) {
      return NextResponse.json({ error: "fb_session incomplete." }, { status: 400 });
    }

    const cookieHeader = rawCookies ?? [`c_user=${c_user}`, `xs=${xs}`, ...(datr ? [`datr=${datr}`] : [])].join("; ");
    const results: Record<string, unknown> = {};

    // ── Test 1: www.facebook.com with FULL browser headers ───────────────────
    try {
      const r = await fetch("https://www.facebook.com/", {
        redirect: "follow",
        signal: AbortSignal.timeout(15000),
        headers: browserDocHeaders(cookieHeader),
      });
      const html = await r.text();
      const lsd = extractLsd(html);
      const fbDtsgFresh = extractFbDtsg(html);
      results.homepage = {
        status: r.status,
        url: r.url,
        lsdFound: !!lsd,
        lsd: lsd ?? "(not found)",
        fbDtsgFound: !!fbDtsgFresh,
        isLoginPage: html.includes("login_form") || html.toLowerCase().includes("log into facebook"),
        htmlPreview: html.slice(0, 400),
      };
    } catch (e) { results.homepage = { error: String(e) }; }

    // ── Test 2: m.facebook.com inbox (Follows mbasic redirect) ───────────────
    try {
      const inboxUrl = "https://m.facebook.com/messages/inbox/";
      const r = await fetch(inboxUrl, {
        redirect: "follow",
        signal: AbortSignal.timeout(15000),
        headers: browserDocHeaders(cookieHeader, DESKTOP_UA, "https://www.facebook.com/"),
      });
      const txt = await r.text();
      const isLoginPage = txt.includes("login_form") || (txt.toLowerCase().includes("log in") && !txt.includes("/messages/read/"));
      results.mFacebookInbox = {
        status: r.status,
        url: r.url,
        isLoginPage,
        length: txt.length,
        htmlPreview: txt.slice(0, 5000), // Larger preview to inspect JSON
        verdict: isLoginPage ? "❌ Login page returned" : "✅ Inbox accessible!",
      };
    } catch (e) { results.mFacebookInbox = { error: String(e) }; }

    // ── Test 3: Zero-cookie www.facebook.com (baseline) ──────────────────────
    try {
      const r = await fetch("https://www.facebook.com/", {
        redirect: "follow",
        signal: AbortSignal.timeout(10000),
        headers: {
          "User-Agent": DESKTOP_UA,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Accept-Encoding": "gzip, deflate, br",
        },
      });
      results.noAuthHomepage = {
        status: r.status,
        verdict: r.status === 200 ? "✅ Base request works (no cookie) — TLS is fine" : `❌ Even no-cookie request fails (status ${r.status}) — TLS fingerprint issue`,
        htmlPreview: (await r.text()).slice(0, 200),
      };
    } catch (e) { results.noAuthHomepage = { error: String(e) }; }

    // Compute overall lsd from whatever homepage returned
    const homepageResult = results.homepage as Record<string, unknown> | undefined;
    const lsd = typeof homepageResult?.lsd === "string" && homepageResult.lsd !== "(not found)"
      ? homepageResult.lsd
      : null;

    return NextResponse.json({
      success: true,
      hasDatr: !!datr,
      hasRawCookies: !!rawCookies,
      lsdExtracted: !!lsd,
      lsd: lsd ?? null,
      fbDtsgFresh: !!(homepageResult?.fbDtsgFound) || !!storedFbDtsg,
      results,
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
