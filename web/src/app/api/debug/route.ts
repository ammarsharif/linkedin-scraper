import { NextRequest, NextResponse } from "next/server";
import { parseCookieString, extractJsessionId } from "@/lib/linkedin";

export const maxDuration = 60;

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(Number(c)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function extractCodeBlocks(html: string): string[] {
  const results: string[] = [];
  const blocks = html.match(/<code[^>]*>([\s\S]*?)<\/code>/gi) ?? [];
  for (const block of blocks) {
    let inner = block.replace(/<code[^>]*>/i, "").replace(/<\/code>/i, "").trim();
    if (inner.startsWith("<!--")) inner = inner.replace(/^<!--\s*/, "").replace(/\s*-->$/, "").trim();
    inner = decodeHtmlEntities(inner);
    if (!inner.startsWith("{") && !inner.startsWith("[")) continue;
    results.push(inner);
  }
  return results;
}

export async function GET(req: NextRequest) {
  const sessionCookie = req.cookies.get("li_session")?.value;
  if (!sessionCookie) {
    return NextResponse.json({ error: "No li_session cookie — please log in first" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const vanityName = searchParams.get("name") ?? "jasirullahkhan";

  const cookies = parseCookieString(sessionCookie);
  const jsessionId = extractJsessionId(sessionCookie);
  const csrf = jsessionId ?? "ajax:0000000000000000000";

  const cookieParts: string[] = [];
  if (cookies["li_at"]) cookieParts.push(`li_at=${cookies["li_at"]}`);
  if (jsessionId) cookieParts.push(`JSESSIONID="${jsessionId}"`);
  for (const [k, v] of Object.entries(cookies)) {
    if (k === "li_at" || k === "JSESSIONID") continue;
    cookieParts.push(`${k}=${v}`);
  }
  const cookieHeader = cookieParts.join("; ");

  const htmlHeaders = {
    Cookie: cookieHeader,
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: "https://www.linkedin.com/feed/",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-Mode": "navigate",
    "Upgrade-Insecure-Requests": "1",
  };

  const apiHeaders = {
    Cookie: cookieHeader,
    "csrf-token": csrf,
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "application/vnd.linkedin.normalized+json+2.1",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: "https://www.linkedin.com/feed/",
    "x-li-lang": "en_US",
    "x-restli-protocol-version": "2.0.0",
    "x-li-track": JSON.stringify({ clientVersion: "1.13.3893", osName: "web" }),
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const results: Record<string, any> = {
    sessionInfo: {
      cookieKeys: Object.keys(cookies),
      hasLiAt: !!cookies["li_at"],
      hasJsessionId: !!jsessionId,
      jsessionIdPreview: jsessionId ? jsessionId.slice(0, 30) + "..." : null,
    },
  };

  // ── 1. Activity page HTML inspection ──────────────────────────────────────
  try {
    const r = await fetch(
      `https://www.linkedin.com/in/${vanityName}/recent-activity/all/`,
      { headers: htmlHeaders, redirect: "follow" }
    );
    const html = await r.text();

    // Extract all JSON code blocks and show the entity URNs inside them
    const jsonBlocks = extractCodeBlocks(html);
    const blockSummaries = [];

    for (let i = 0; i < jsonBlocks.length; i++) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const parsed: any = JSON.parse(jsonBlocks[i]);
        const keys = Object.keys(parsed ?? {});
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const included: any[] = Array.isArray(parsed?.included) ? parsed.included : [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const elements: any[] = Array.isArray(parsed?.elements) ? parsed.elements : [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const dataElements: any[] = Array.isArray(parsed?.data?.elements) ? parsed.data.elements : [];

        // Collect all entityUrns / urns for diagnosis
        const allItems = [...included, ...elements, ...dataElements];
        const urns = allItems
          .map((item) => item?.entityUrn ?? item?.urn ?? item?.["$type"] ?? null)
          .filter(Boolean)
          .slice(0, 20);

        // Also find which items have post-like content
        const postLikeItems = allItems
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .filter((item: any) => {
            const urn = item?.entityUrn ?? item?.urn ?? "";
            return (
              urn.includes("activity") ||
              urn.includes("ugcPost") ||
              urn.includes("share") ||
              urn.includes("update") ||
              item?.commentary ||
              item?.shareCommentary
            );
          })
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((item: any) => ({
            entityUrn: item?.entityUrn ?? item?.urn ?? "?",
            type: item?.["$type"] ?? "?",
            hasCommentary: !!item?.commentary,
            commentaryText: (item?.commentary?.text?.text ?? item?.commentary?.text ?? "").slice(0, 100),
            hasShareCommentary: !!item?.shareCommentary,
          }));

        if (keys.length > 0) {
          blockSummaries.push({
            blockIndex: i,
            topLevelKeys: keys,
            includedCount: included.length,
            elementsCount: elements.length,
            dataElementsCount: dataElements.length,
            sampleUrns: urns,
            postLikeItems: postLikeItems.slice(0, 5),
          });
        }
      } catch {
        blockSummaries.push({ blockIndex: i, parseError: true });
      }
    }

    results.activityPage = {
      status: r.status,
      htmlLength: html.length,
      hasAuthWall: html.includes("authwall") || html.includes("login-form"),
      rawUrnMatches: (html.match(/urn:li:activity:/g) ?? []).length,
      decodedUrnMatches: (decodeHtmlEntities(html).match(/urn:li:activity:\d+/g) ?? []).length,
      jsonBlockCount: jsonBlocks.length,
      blockSummaries,
    };
  } catch (e) {
    results.activityPage = { error: String(e) };
  }

  // ── 2. Try multiple Voyager API endpoints ──────────────────────────────────
  const apiEndpoints = [
    `https://www.linkedin.com/voyager/api/feed/dash/feedUpdates?q=profileUpdatesByMemberShareFeed&memberIdentity=${vanityName}&count=5&start=0`,
    `https://www.linkedin.com/voyager/api/identity/profileUpdatesV2?publicIdentifier=${vanityName}&q=memberShareFeed&count=5&start=0`,
    `https://www.linkedin.com/voyager/api/feed/updates?q=memberShareFeed&identifier=${vanityName}&count=5&start=0`,
    `https://www.linkedin.com/voyager/api/identity/profiles/${vanityName}/feed?count=5&start=0`,
  ];

  results.apiEndpoints = {};
  for (const url of apiEndpoints) {
    const label = url.split("?")[0].split("/").slice(-2).join("/");
    try {
      const r = await fetch(url, { headers: apiHeaders, redirect: "follow" });
      const text = r.ok ? await r.text() : null;
      let parsed = null;
      if (text) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          parsed = JSON.parse(text) as any;
        } catch { /* not JSON */ }
      }
      results.apiEndpoints[label] = {
        status: r.status,
        responseLen: text?.length ?? 0,
        topLevelKeys: parsed ? Object.keys(parsed).slice(0, 10) : [],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        elementsCount: Array.isArray(parsed?.elements) ? (parsed?.elements as any[]).length : "N/A",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        includedCount: Array.isArray(parsed?.included) ? (parsed?.included as any[]).length : "N/A",
        preview: text?.slice(0, 400) ?? null,
      };
    } catch (e) {
      results.apiEndpoints[label] = { error: String(e) };
    }
  }

  return NextResponse.json(results, {
    headers: { "Content-Type": "application/json" },
  });
}
