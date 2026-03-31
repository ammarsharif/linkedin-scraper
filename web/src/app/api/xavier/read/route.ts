import { NextRequest, NextResponse } from "next/server";
import { getDatabase } from "@/lib/mongodb";
import puppeteer from "puppeteer";

export const maxDuration = 60;

// ── Helpers ──────────────────────────────────────────────────────────────────

function randDelay(min = 1200, max = 3500): Promise<void> {
  return new Promise((r) =>
    setTimeout(r, Math.floor(Math.random() * (max - min)) + min)
  );
}

async function getSession(db: any) {
  const doc = await db
    .collection("xavier_config")
    .findOne({ type: "tw_session" });
  if (!doc || !doc.auth_token || !doc.ct0) return null;
  return doc;
}

async function setTwitterCookies(page: any, session: any) {
  await page.setCookie(
    {
      name: "auth_token",
      value: session.auth_token,
      domain: ".x.com",
      path: "/",
      httpOnly: true,
      secure: true,
    },
    {
      name: "ct0",
      value: session.ct0,
      domain: ".x.com",
      path: "/",
      secure: true,
    }
  );
  if (session.twid) {
    await page.setCookie({
      name: "twid",
      value: session.twid,
      domain: ".x.com",
      path: "/",
      secure: true,
    });
  }
}

// Extract tweets from current page DOM
async function extractTweets(page: any, sourceQuery: string): Promise<any[]> {
  return page.evaluate((query: string) => {
    const articles = Array.from(
      document.querySelectorAll('[data-testid="tweet"]')
    ).slice(0, 15);

    return articles.map((el: any) => {
      // Username / display name
      const userNameEl = el.querySelector('[data-testid="User-Name"]');
      const nameLinks = userNameEl
        ? Array.from(userNameEl.querySelectorAll("a"))
        : [];
      const displayName =
        (nameLinks[0] as any)?.innerText?.trim() ?? "";
      const usernameRaw =
        (nameLinks[1] as any)?.href?.split("/").at(-1) ?? "";

      // Tweet text
      const textEl = el.querySelector('[data-testid="tweetText"]');
      const text = textEl ? (textEl as any).innerText?.trim() : "";

      // Tweet link
      const tweetLink = el.querySelector('a[href*="/status/"]') as any;
      const tweetUrl = tweetLink
        ? "https://x.com" + tweetLink.getAttribute("href")?.split("?")[0]
        : "";

      // Extract tweet ID from URL
      const tweetId = tweetUrl.split("/status/")[1] ?? "";

      // Stats
      const statEls = Array.from(
        el.querySelectorAll('[data-testid$="-count"]')
      );
      const getCount = (testId: string): number => {
        const s = el.querySelector(`[data-testid="${testId}"]`);
        return s
          ? parseInt((s as any).innerText?.replace(/[^0-9]/g, "") || "0", 10) || 0
          : 0;
      };

      // Timestamp
      const timeEl = el.querySelector("time");
      const timestamp = timeEl ? timeEl.getAttribute("datetime") ?? "" : "";

      return {
        tweetId,
        username: usernameRaw,
        displayName,
        text,
        tweetUrl,
        likes: getCount("like"),
        retweets: getCount("retweet"),
        replies: getCount("reply"),
        timestamp,
        scrapedAt: new Date().toISOString(),
        sourceQuery: query,
      };
    });
  }, sourceQuery);
}

// ── POST: scrape tweets ──────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  let browser: any = null;
  try {
    const body = await req.json();
    const { query, type = "keyword", limit = 15 } = body;

    if (!query?.trim()) {
      return NextResponse.json(
        { error: "query is required" },
        { status: 400 }
      );
    }

    const db = await getDatabase();
    const session = await getSession(db);
    if (!session) {
      return NextResponse.json(
        { error: "No Twitter session. Save cookies first." },
        { status: 401 }
      );
    }

    browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
        "--disable-notifications",
      ],
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    );

    await setTwitterCookies(page, session);

    // Build search URL
    let url: string;
    if (type === "hashtag") {
      const tag = query.replace(/^#/, "");
      url = `https://x.com/search?q=%23${encodeURIComponent(tag)}&f=top`;
    } else if (type === "profile") {
      url = `https://x.com/${encodeURIComponent(query.replace(/^@/, ""))}`;
    } else {
      url = `https://x.com/search?q=${encodeURIComponent(query)}&f=top`;
    }

    await page.goto(url, { waitUntil: "networkidle2", timeout: 45000 });

    // Check still logged in
    const loginCheck = await page.evaluate(
      () =>
        !!document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]') ||
        !!document.querySelector('[data-testid="AppTabBar_Home_Link"]')
    );

    if (!loginCheck) {
      await db
        .collection("xavier_config")
        .updateOne({ type: "tw_session" }, { $set: { status: "expired" } });
      return NextResponse.json(
        { error: "Twitter session expired. Please re-authenticate." },
        { status: 401 }
      );
    }

    await randDelay(2000, 3500);

    // Scroll once to load more
    await page.evaluate(() => window.scrollBy(0, 600));
    await randDelay(1500, 2500);

    const tweets = await extractTweets(page, query);
    const filtered = tweets
      .filter((t: any) => t.tweetId && t.text)
      .slice(0, limit);

    // Persist to DB (upsert by tweetId)
    for (const tweet of filtered) {
      await db.collection("xavier_tweets").updateOne(
        { tweetId: tweet.tweetId },
        { $set: tweet },
        { upsert: true }
      );
    }

    return NextResponse.json({ success: true, tweets: filtered, count: filtered.length });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {}
    }
  }
}

// ── GET: fetch saved tweets from DB ─────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = parseInt(searchParams.get("limit") ?? "50");
    const query = searchParams.get("query");

    const db = await getDatabase();
    const filter = query ? { sourceQuery: { $regex: query, $options: "i" } } : {};

    const tweets = await db
      .collection("xavier_tweets")
      .find(filter)
      .sort({ scrapedAt: -1 })
      .limit(limit)
      .toArray();

    return NextResponse.json({ success: true, tweets, count: tweets.length });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
