import { NextRequest, NextResponse } from "next/server";
import { getDatabase } from "@/lib/mongodb";
import { createSessionAlert, resolveSessionAlert } from "@/lib/sessionAlert";
import puppeteer, { Browser, Page } from "puppeteer";
import OpenAI from "openai";

export const maxDuration = 60;

// ── Global state ─────────────────────────────────────────────────────────────
const g = globalThis as any;
if (g.xavier_grow_initialized === undefined) {
  g.xavier_grow_initialized = true;
  g.xavier_grow_interval = null;
  g.xavier_grow_running = false;
  g.xavier_grow_tickRunning = false;
  g.xavier_grow_lastRun = null;
  g.xavier_grow_log = []; // last 200 entries
  g.xavier_grow_consecutiveErrors = 0;
  g.xavier_grow_sessionSuspended = false;
  g.xavier_grow_dailyCounts = { follow: 0, like: 0, retweet: 0, reply: 0 };
  g.xavier_grow_settings = null;
  g.xavier_grow_targetIndex = 0;
  // Action modes: 0=like, 1=follow, 2=retweet, 3=reply
  g.xavier_grow_actionMode = 0;
  g.xavier_grow_browser = null;
  g.xavier_grow_seenTweetUrls = new Set<string>();

  // ── Anti-detection: visited URL tracking (per session) ────────────────
  // visitedSearchUrls: search/hashtag/keyword pages already navigated to
  // visitedProfileUrls: user profile pages already visited (for follow)
  g.xavier_grow_visitedSearchUrls = new Set<string>();
  g.xavier_grow_visitedProfileUrls = new Set<string>();

  // Track total actions performed this session for adaptive rate limiting
  g.xavier_grow_sessionActions = 0;
  // Timestamp of the last completed action (for cool-down between bursts)
  g.xavier_grow_lastActionTime = null;
  // Current tick interval ms (starts at 2 min, adapts between 90s-5min)
  g.xavier_grow_currentIntervalMs = 120_000;
}

// ── Action mode labels ────────────────────────────────────────────────────────
type ActionMode = 0 | 1 | 2 | 3;
const ACTION_LABELS: Record<ActionMode, string> = {
  0: "like",
  1: "follow",
  2: "retweet",
  3: "reply",
};

// ── Default settings ──────────────────────────────────────────────────────────
const DEFAULT_SETTINGS = {
  targetKeywords: ["startup", "entrepreneur", "tech"],
  targetHashtags: ["SaaS", "buildinpublic", "marketing"],
  targetProfiles: [] as string[],
  dailyFollowLimit: 30,
  dailyLikeLimit: 50,
  dailyRetweetLimit: 20,
  dailyReplyLimit: 15,
  replyPrompt:
    "Write a short, genuine, relevant 1-2 sentence reply (no hashtags, no self-promotion) for a tweet about the topic provided. Be specific, insightful, and professional.",
  enableLike: true,
  enableFollow: true,
  enableRetweet: true,
  enableReply: true,
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function randDelay(min = 1500, max = 4500): Promise<void> {
  return new Promise((r) =>
    setTimeout(r, Math.floor(Math.random() * (max - min)) + min)
  );
}

/**
 * Human-like variable scrolling: scrolls in 3-7 short bursts with random
 * distances and pauses, then occasionally scrolls back slightly to mimic
 * natural reading behaviour.
 */
async function humanScroll(page: import("puppeteer").Page, totalScrolls = 4): Promise<void> {
  const steps = totalScrolls + Math.floor(Math.random() * 3); // 4-6 steps
  for (let i = 0; i < steps; i++) {
    const distance = Math.floor(Math.random() * 350) + 150; // 150-500px
    const direction = Math.random() < 0.12 ? -1 : 1; // 12% chance of scrolling back
    await page.evaluate((d: number) => window.scrollBy(0, d), distance * direction);
    // Variable pause between scrolls: 600ms-2000ms
    await randDelay(600, 2000);
  }
  // Occasional longer pause at end (reading simulation)
  if (Math.random() < 0.4) await randDelay(1500, 3500);
}

/**
 * Simulates human mouse movement. If an element is provided, moves towards it.
 * Otherwise, moves randomly across the viewport.
 */
async function humanMouseMove(page: import("puppeteer").Page, element?: import("puppeteer").ElementHandle<Element> | null): Promise<void> {
  try {
    const viewport = await page.viewport() || { width: 1280, height: 900 };
    let targetX = Math.floor(Math.random() * viewport.width);
    let targetY = Math.floor(Math.random() * viewport.height);
    
    if (element) {
      const box = await element.boundingBox();
      if (box) {
        targetX = box.x + box.width / 2 + (Math.random() * 10 - 5);
        targetY = box.y + box.height / 2 + (Math.random() * 10 - 5);
      }
    }

    const steps = 5 + Math.floor(Math.random() * 10);
    await page.mouse.move(targetX, targetY, { steps });
    await randDelay(100, 300);
  } catch (e) {
    // Ignore mouse movement errors
  }
}

/**
 * Injects stealth overrides to hide headless/automation signals.
 * Called on every new page so X.com can't fingerprint Puppeteer.
 */
async function injectStealth(page: import("puppeteer").Page): Promise<void> {
  await page.evaluateOnNewDocument(() => {
    // Hide webdriver flag
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    // Fake plugins to look like a real Chrome install
    Object.defineProperty(navigator, "plugins", {
      get: () => [1, 2, 3, 4, 5], // non-empty array
    });
    // Fake languages
    Object.defineProperty(navigator, "languages", {
      get: () => ["en-US", "en"],
    });
    // Remove automation-related chrome properties
    (window as any).chrome = { runtime: {} };
  });
}

function addLog(
  message: string,
  type: "info" | "success" | "error" | "warning" = "info"
) {
  const entry = { time: new Date().toISOString(), message, type };
  g.xavier_grow_log.unshift(entry);
  if (g.xavier_grow_log.length > 200) g.xavier_grow_log.length = 200;
}

async function getSettings(forceFresh = false) {
  if (!forceFresh && g.xavier_grow_settings) {
    return { ...DEFAULT_SETTINGS, ...g.xavier_grow_settings };
  }
  try {
    const db = await getDatabase();
    const saved = await db
      .collection("xavier_settings")
      .findOne({ type: "growth_settings" });
    if (saved) {
      g.xavier_grow_settings = {
        ...DEFAULT_SETTINGS,
        targetKeywords: Array.isArray(saved.targetKeywords)
          ? saved.targetKeywords
          : DEFAULT_SETTINGS.targetKeywords,
        targetHashtags: Array.isArray(saved.targetHashtags)
          ? saved.targetHashtags
          : DEFAULT_SETTINGS.targetHashtags,
        targetProfiles: Array.isArray(saved.targetProfiles)
          ? saved.targetProfiles
          : DEFAULT_SETTINGS.targetProfiles,
        dailyFollowLimit: Number(saved.dailyFollowLimit ?? DEFAULT_SETTINGS.dailyFollowLimit),
        dailyLikeLimit: Number(saved.dailyLikeLimit ?? DEFAULT_SETTINGS.dailyLikeLimit),
        dailyRetweetLimit: Number(saved.dailyRetweetLimit ?? DEFAULT_SETTINGS.dailyRetweetLimit),
        dailyReplyLimit: Number(saved.dailyReplyLimit ?? DEFAULT_SETTINGS.dailyReplyLimit),
        replyPrompt: saved.replyPrompt ?? DEFAULT_SETTINGS.replyPrompt,
        enableLike: saved.enableLike ?? DEFAULT_SETTINGS.enableLike,
        enableFollow: saved.enableFollow ?? DEFAULT_SETTINGS.enableFollow,
        enableRetweet: saved.enableRetweet ?? DEFAULT_SETTINGS.enableRetweet,
        enableReply: saved.enableReply ?? DEFAULT_SETTINGS.enableReply,
      };
      return g.xavier_grow_settings as typeof DEFAULT_SETTINGS;
    }
  } catch { }
  g.xavier_grow_settings = { ...DEFAULT_SETTINGS };
  return g.xavier_grow_settings as typeof DEFAULT_SETTINGS;
}

function advanceActionMode(
  settings: typeof DEFAULT_SETTINGS,
  counts: typeof g.xavier_grow_dailyCounts
): ActionMode {
  const enabled: Record<string, boolean> = {
    like: settings.enableLike && counts.like < settings.dailyLikeLimit,
    follow: settings.enableFollow && counts.follow < settings.dailyFollowLimit,
    retweet: settings.enableRetweet && counts.retweet < settings.dailyRetweetLimit,
    reply: settings.enableReply && counts.reply < settings.dailyReplyLimit,
  };

  let mode = (g.xavier_grow_actionMode as number) % 4;
  for (let i = 0; i < 4; i++) {
    const label = ACTION_LABELS[mode as ActionMode];
    if (enabled[label]) {
      g.xavier_grow_actionMode = (mode + 1) % 4;
      return mode as ActionMode;
    }
    mode = (mode + 1) % 4;
  }
  return mode as ActionMode;
}

// ── Reset daily counts at midnight ───────────────────────────────────────────
function resetDailyCountsIfNeeded() {
  const now = new Date();
  const lastRun = g.xavier_grow_lastRun
    ? new Date(g.xavier_grow_lastRun)
    : null;
  if (!lastRun || now.toDateString() !== lastRun.toDateString()) {
    g.xavier_grow_dailyCounts = { follow: 0, like: 0, retweet: 0, reply: 0 };
  }
}

// ── Browser/Session helpers ───────────────────────────────────────────────────
async function getOrCreateBrowser(): Promise<Browser> {
  if (g.xavier_grow_browser) {
    try {
      const pages = await g.xavier_grow_browser.pages();
      if (pages.length > 0) return g.xavier_grow_browser;
    } catch { }
    g.xavier_grow_browser = null;
  }

  // Randomize viewport slightly each launch — avoids a fixed fingerprint
  const viewportWidth = 1240 + Math.floor(Math.random() * 80); // 1240-1320
  const viewportHeight = 860 + Math.floor(Math.random() * 80); // 860-940

  g.xavier_grow_browser = await puppeteer.launch({
    headless: false,
    userDataDir: "./xavier_puppeteer_profile",
    defaultViewport: { width: viewportWidth, height: viewportHeight },
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-notifications",
      "--disable-blink-features=AutomationControlled",
      `--window-size=${viewportWidth},${viewportHeight}`,
    ],
  });
  return g.xavier_grow_browser;
}

async function getOrCreatePage(browser: Browser): Promise<Page> {
  const pages = await browser.pages();
  const page = pages.length > 0 ? pages[0] : await browser.newPage();

  // Inject stealth scripts before any navigation
  await injectStealth(page);

  // Randomize user-agent slightly between Chrome patch versions
  const chromePatch = 130 + Math.floor(Math.random() * 10); // 130-139
  await page.setUserAgent(
    `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromePatch}.0.0.0 Safari/537.36`
  );
  return page;
}

async function setTwitterCookies(page: Page, session: any) {
  await page.setCookie(
    { name: "auth_token", value: session.auth_token, domain: ".x.com", path: "/", httpOnly: true, secure: true },
    { name: "ct0", value: session.ct0, domain: ".x.com", path: "/", secure: true }
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

async function isLoggedIn(page: Page): Promise<boolean> {
  return page.evaluate(
    () =>
      !!document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]') ||
      !!document.querySelector('[data-testid="AppTabBar_Home_Link"]') ||
      !!document.querySelector('[data-testid="conversation"]')
  );
}

// ── Get tweets from search ────────────────────────────────────────────────────
async function getSearchTweets(
  page: Page,
  query: string,
  type: "keyword" | "hashtag" | "profile"
): Promise<{ tweetUrl: string; username: string; tweetText: string }[]> {
  // ── Build candidate URL list (multiple filter variants) ──────────────────
  // We try different filter suffixes so that if the primary URL was already
  // visited this session, we fall back to an alternate variant before giving up.
  const tickIndex = g.xavier_grow_targetIndex as number;
  const useAlt = tickIndex % 2 === 0;

  let candidateUrls: string[] = [];

  if (type === "hashtag") {
    const base = `https://x.com/search?q=%23${encodeURIComponent(query.replace(/^#/, ""))}}`;
    candidateUrls = [
      `https://x.com/search?q=%23${encodeURIComponent(query.replace(/^#/, ""))}&f=${useAlt ? "top" : "live"}`,
      `https://x.com/search?q=%23${encodeURIComponent(query.replace(/^#/, ""))}&f=${useAlt ? "live" : "top"}`,
    ];
    void base;
  } else if (type === "profile") {
    const handle = query.replace(/^@/, "");
    candidateUrls = [
      `https://x.com/${encodeURIComponent(handle)}`,
      `https://x.com/${encodeURIComponent(handle)}/with_replies`,
      `https://x.com/${encodeURIComponent(handle)}/media`,
    ];
  } else {
    const noRt = tickIndex % 3 === 0 ? " -filter:retweets" : "";
    const noRt2 = tickIndex % 3 !== 0 ? " -filter:retweets" : "";
    candidateUrls = [
      `https://x.com/search?q=${encodeURIComponent(query + (useAlt ? noRt : ""))}&f=${useAlt ? "latest" : "top"}`,
      `https://x.com/search?q=${encodeURIComponent(query + noRt2)}&f=${useAlt ? "top" : "latest"}`,
    ];
  }

  // Pick the first URL not yet visited this session
  if (!g.xavier_grow_visitedSearchUrls) g.xavier_grow_visitedSearchUrls = new Set<string>();
  let url = candidateUrls.find((u) => !g.xavier_grow_visitedSearchUrls.has(u));
  if (!url) {
    // All variants visited — clear stale entries and reuse first (rotate cleanly)
    addLog(`All search URL variants for "${query}" visited — clearing search history for this target`, "info");
    for (const u of candidateUrls) g.xavier_grow_visitedSearchUrls.delete(u);
    url = candidateUrls[0];
  }

  // Mark URL as visited BEFORE navigating so concurrent ticks don't repeat it
  g.xavier_grow_visitedSearchUrls.add(url);
  // Cap the set at 300 entries so it doesn't grow forever
  if (g.xavier_grow_visitedSearchUrls.size > 300) {
    const oldest = g.xavier_grow_visitedSearchUrls.values().next().value;
    g.xavier_grow_visitedSearchUrls.delete(oldest);
  }

  addLog(`Navigating to search: ${url}`, "info");
  await page.goto(url, { waitUntil: "networkidle2", timeout: 40000 });

  // Human-like variable delay after page load before scrolling
  await randDelay(2500, 5000);

  // Scroll naturally through the feed instead of a fixed single scroll
  await humanScroll(page, 3);

  return page.evaluate(() => {
    const results: { tweetUrl: string; username: string; tweetText: string }[] = [];
    // Primary: [data-testid="tweet"]
    // Fallback: <article> elements which X uses for all tweets
    const articles = Array.from(document.querySelectorAll('[data-testid="tweet"], article')).slice(0, 10);

    for (const el of articles) {
      const linkEl = el.querySelector('a[href*="/status/"]') as HTMLAnchorElement | null;
      if (!linkEl) continue;
      const tweetUrl = "https://x.com" + linkEl.getAttribute("href")?.split("?")[0];

      // Username: prefer data-testid="User-Name", fall back to scanning all links
      const nameLinks = el.querySelectorAll('[data-testid="User-Name"] a, a[href^="/"]');
      let username = "";
      for (const a of Array.from(nameLinks) as HTMLAnchorElement[]) {
        const h = a.getAttribute("href") || "";
        if (h.length > 1 && !h.includes("/") && !h.startsWith("/status")) {
          username = h.replace("/", "");
          break;
        }
      }
      if (!username) {
        username = (nameLinks[1] as HTMLAnchorElement)?.href?.split("/").at(-1) ?? "";
      }

      const textEl = el.querySelector('[data-testid="tweetText"]') || el.querySelector('[dir="auto"]');
      const tweetText = (textEl as HTMLElement)?.innerText?.trim() ?? "";

      if (tweetUrl && username) {
        results.push({ tweetUrl, username, tweetText });
      }
    }
    return results;
  });
}

// ── Action: Like ─────────────────────────────────────────────────────────────
async function likeTweet(
  page: Page,
  tweetUrl: string,
  db: any,
  target: { type: string; value: string }
): Promise<"liked" | "already_liked" | "failed"> {
  try {
    await page.goto(tweetUrl, { waitUntil: "networkidle2", timeout: 35000 });
    await randDelay(1500, 3000);

    // Check already liked
    const alreadyLiked = await page.evaluate(() =>
      !!document.querySelector('[data-testid="unlike"]')
    );
    if (alreadyLiked) {
      await db.collection("xavier_growth_logs").insertOne({
        action: "like",
        targetTweetUrl: tweetUrl,
        sourceType: target.type,
        sourceValue: target.value,
        timestamp: new Date().toISOString(),
        status: "skipped",
        note: "already_liked",
      });
      return "already_liked";
    }

    // Strategy 1: data-testid="like" button
    const likeBtn = await page.$('[data-testid="like"]');
    if (likeBtn) {
      await humanMouseMove(page, likeBtn);
      await likeBtn.click();
      await randDelay(800, 1500);

      // Confirm liked
      const confirmed = await page.evaluate(() =>
        !!document.querySelector('[data-testid="unlike"]')
      );
      if (confirmed) {
        g.xavier_grow_dailyCounts.like++;
        await db.collection("xavier_growth_logs").insertOne({
          action: "like",
          targetTweetUrl: tweetUrl,
          sourceType: target.type,
          sourceValue: target.value,
          timestamp: new Date().toISOString(),
          status: "success",
        });
        return "liked";
      }
    }

    // Strategy 2: aria-label fallback
    const liked = await page.evaluate(() => {
      const btns = Array.from(
        document.querySelectorAll('button[aria-label*="Like"], button[aria-label*="like"]')
      );
      for (const btn of btns) {
        if (btn.closest("li")) continue; // skip comment likes
        (btn as HTMLElement).click();
        return true;
      }
      return false;
    });

    if (liked) {
      await randDelay(800, 1500);
      g.xavier_grow_dailyCounts.like++;
      await db.collection("xavier_growth_logs").insertOne({
        action: "like",
        targetTweetUrl: tweetUrl,
        sourceType: target.type,
        sourceValue: target.value,
        timestamp: new Date().toISOString(),
        status: "success",
      });
      return "liked";
    }

    await db.collection("xavier_growth_logs").insertOne({
      action: "like",
      targetTweetUrl: tweetUrl,
      sourceType: target.type,
      sourceValue: target.value,
      timestamp: new Date().toISOString(),
      status: "failed",
      error: "Like button not found",
    });
    return "failed";
  } catch (err: any) {
    await db.collection("xavier_growth_logs").insertOne({
      action: "like",
      targetTweetUrl: tweetUrl,
      sourceType: target.type,
      sourceValue: target.value,
      timestamp: new Date().toISOString(),
      status: "failed",
      error: err.message,
    });
    return "failed";
  }
}

// ── Action: Follow ────────────────────────────────────────────────────────────
async function followUser(
  page: Page,
  username: string,
  sourceTweetUrl: string,
  db: any,
  target: { type: string; value: string }
): Promise<"followed" | "already_following" | "failed"> {
  try {
    const profileUrl = `https://x.com/${encodeURIComponent(username)}`;

    // ── Visited profile URL deduplication ────────────────────────────────
    if (!g.xavier_grow_visitedProfileUrls) g.xavier_grow_visitedProfileUrls = new Set<string>();
    if (g.xavier_grow_visitedProfileUrls.has(profileUrl)) {
      addLog(`Profile @${username} already visited this session — skipping navigation`, "info");
      // Still attempt to read follow state from current DOM if already on profile
      if (page.url() !== profileUrl) {
        await db.collection("xavier_growth_logs").insertOne({
          action: "follow",
          targetUsername: username,
          targetTweetUrl: sourceTweetUrl,
          sourceType: target.type,
          sourceValue: target.value,
          timestamp: new Date().toISOString(),
          status: "skipped",
          note: "profile_already_visited_this_session",
        });
        return "already_following";
      }
    } else {
      g.xavier_grow_visitedProfileUrls.add(profileUrl);
      // Cap visited profiles at 500 entries
      if (g.xavier_grow_visitedProfileUrls.size > 500) {
        const oldest = g.xavier_grow_visitedProfileUrls.values().next().value;
        g.xavier_grow_visitedProfileUrls.delete(oldest);
      }
    }

    await page.goto(profileUrl, { waitUntil: "networkidle2", timeout: 40000 });
    // Human-like pause after landing on a profile (humans read bio before clicking Follow)
    await randDelay(2000, 4500);
    await humanScroll(page, 1); // brief scroll down to simulate reading
    await humanMouseMove(page); // Random mouse move before checking the button

    // Check login
    if (page.url().includes("/login") || page.url().includes("i/flow/login")) {
      return "failed";
    }
    // Brief extra pause — varies reading time on profile page
    await randDelay(500, 1500);

    // Check follow state
    const followState = await page.evaluate(() => {
      // Primary: data-testid="followButton"
      const followBtn = document.querySelector('[data-testid="followButton"]');
      if (followBtn) {
        const txt = (followBtn as HTMLElement).innerText?.trim().toLowerCase();
        if (txt === "follow" || txt === "follow back") return "can_follow";
        if (txt === "following" || txt === "requested") return "already_following";
      }

      // Fallback: scan all buttons
      const allBtns = Array.from(
        document.querySelectorAll('button[role="button"], [role="button"]')
      );
      for (const btn of allBtns) {
        const txt = (btn as HTMLElement).innerText?.trim().toLowerCase();
        if (txt === "follow" || txt === "follow back") return "can_follow";
        if (txt === "following" || txt === "requested") return "already_following";
      }
      return "unknown";
    });

    if (followState === "already_following") {
      await db.collection("xavier_growth_logs").insertOne({
        action: "follow",
        targetUsername: username,
        targetTweetUrl: sourceTweetUrl,
        sourceType: target.type,
        sourceValue: target.value,
        timestamp: new Date().toISOString(),
        status: "skipped",
        note: "already_following",
      });
      return "already_following";
    }

    if (followState !== "can_follow") {
      await db.collection("xavier_growth_logs").insertOne({
        action: "follow",
        targetUsername: username,
        targetTweetUrl: sourceTweetUrl,
        sourceType: target.type,
        sourceValue: target.value,
        timestamp: new Date().toISOString(),
        status: "failed",
        error: "Follow button not found",
      });
      return "failed";
    }

    // Click Follow
    const clicked = await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="followButton"]') as HTMLElement | null;
      if (btn) { btn.click(); return true; }

      const allBtns = Array.from(document.querySelectorAll('button, [role="button"]'));
      for (const b of allBtns as HTMLElement[]) {
        const txt = b.innerText?.trim().toLowerCase();
        const ariaValue = b.getAttribute("aria-label")?.toLowerCase() || "";
        if (txt === "follow" || txt === "follow back" || ariaValue.includes("follow")) {
          b.click();
          return true;
        }
      }
      return false;
    });

    await randDelay(1200, 2500);

    // Verify follow
    const confirmed = await page.evaluate(() => {
      const allBtns = Array.from(document.querySelectorAll('button, [role="button"]'));
      return allBtns.some((b) => {
        const t = (b as HTMLElement).innerText?.trim().toLowerCase();
        const a = b.getAttribute("aria-label")?.toLowerCase() || "";
        return t === "following" || t === "requested" || a.includes("following");
      });
    });

    if (clicked || confirmed) {
      g.xavier_grow_dailyCounts.follow++;
      await db.collection("xavier_growth_logs").insertOne({
        action: "follow",
        targetUsername: username,
        targetTweetUrl: sourceTweetUrl,
        sourceType: target.type,
        sourceValue: target.value,
        timestamp: new Date().toISOString(),
        status: "success",
      });
      return "followed";
    }

    await db.collection("xavier_growth_logs").insertOne({
      action: "follow",
      targetUsername: username,
      targetTweetUrl: sourceTweetUrl,
      sourceType: target.type,
      sourceValue: target.value,
      timestamp: new Date().toISOString(),
      status: "failed",
      error: "Follow not confirmed",
    });
    return "failed";
  } catch (err: any) {
    await db.collection("xavier_growth_logs").insertOne({
      action: "follow",
      targetUsername: username,
      targetTweetUrl: sourceTweetUrl,
      sourceType: target.type,
      sourceValue: target.value,
      timestamp: new Date().toISOString(),
      status: "failed",
      error: err.message,
    });
    return "failed";
  }
}

// ── Action: Retweet ───────────────────────────────────────────────────────────
async function retweetTweet(
  page: Page,
  tweetUrl: string,
  db: any,
  target: { type: string; value: string }
): Promise<"retweeted" | "already_retweeted" | "failed"> {
  try {
    await page.goto(tweetUrl, { waitUntil: "networkidle2", timeout: 35000 });
    await randDelay(1500, 3000);

    // Check already retweeted
    const alreadyRt = await page.evaluate(
      () => !!document.querySelector('[data-testid="unretweet"]')
    );
    if (alreadyRt) {
      await db.collection("xavier_growth_logs").insertOne({
        action: "retweet",
        targetTweetUrl: tweetUrl,
        sourceType: target.type,
        sourceValue: target.value,
        timestamp: new Date().toISOString(),
        status: "skipped",
        note: "already_retweeted",
      });
      return "already_retweeted";
    }

    // Click retweet button
    const rtBtn = await page.$('[data-testid="retweet"]');
    if (!rtBtn) {
      await db.collection("xavier_growth_logs").insertOne({
        action: "retweet",
        targetTweetUrl: tweetUrl,
        sourceType: target.type,
        sourceValue: target.value,
        timestamp: new Date().toISOString(),
        status: "failed",
        error: "Retweet button not found",
      });
      return "failed";
    }

    await humanMouseMove(page, rtBtn);
    await rtBtn.click();
    await randDelay(800, 1500);

    // Confirm retweet in popup
    const confirmBtn = await page.$('[data-testid="retweetConfirm"]');
    if (confirmBtn) {
      await confirmBtn.click();
      await randDelay(800, 1500);
    }

    g.xavier_grow_dailyCounts.retweet++;
    await db.collection("xavier_growth_logs").insertOne({
      action: "retweet",
      targetTweetUrl: tweetUrl,
      sourceType: target.type,
      sourceValue: target.value,
      timestamp: new Date().toISOString(),
      status: "success",
    });
    return "retweeted";
  } catch (err: any) {
    await db.collection("xavier_growth_logs").insertOne({
      action: "retweet",
      targetTweetUrl: tweetUrl,
      sourceType: target.type,
      sourceValue: target.value,
      timestamp: new Date().toISOString(),
      status: "failed",
      error: err.message,
    });
    return "failed";
  }
}

// ── Action: Reply ─────────────────────────────────────────────────────────────
async function replyToTweet(
  page: Page,
  tweetUrl: string,
  tweetText: string,
  replyPrompt: string,
  db: any,
  target: { type: string; value: string }
): Promise<"replied" | "failed"> {
  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Generate reply
    const aiRes = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: replyPrompt },
        {
          role: "user",
          content: `Tweet content: "${tweetText.substring(0, 300)}"`,
        },
      ],
      max_tokens: 120,
      temperature: 0.8,
    });

    const replyText = aiRes.choices[0]?.message?.content?.trim() ?? "";
    if (!replyText) {
      return "failed";
    }

    await page.goto(tweetUrl, { waitUntil: "networkidle2", timeout: 35000 });
    await randDelay(1500, 3000);

    // Click reply button
    const replyBtn = await page.$('[data-testid="reply"]');
    if (!replyBtn) {
      await db.collection("xavier_growth_logs").insertOne({
        action: "reply",
        targetTweetUrl: tweetUrl,
        sourceType: target.type,
        sourceValue: target.value,
        content: replyText,
        timestamp: new Date().toISOString(),
        status: "failed",
        error: "Reply button not found",
      });
      return "failed";
    }

    await humanMouseMove(page, replyBtn);
    await replyBtn.click();
    await randDelay(1200, 2200);

    // Wait for the reply modal/inline textarea to appear
    await page.waitForSelector('[data-testid="tweetTextarea_0"]', {
      timeout: 12000,
    });
    await randDelay(500, 900);

    // Focus the contenteditable div
    const textarea = await page.$('[data-testid="tweetTextarea_0"]');
    if (!textarea) return "failed";

    await textarea.click();
    await randDelay(400, 800);

    // Type character-by-character
    for (const char of replyText) {
      await page.keyboard.type(char, { delay: Math.random() * 60 + 20 });
    }
    await randDelay(600, 1000);

    // ── KEY FIX: Dispatch native input events so React registers the text ──
    // X.com uses React's synthetic event system; keyboard.type alone doesn't
    // update internal state, leaving the Reply button disabled.
    await page.evaluate(() => {
      const el = document.querySelector(
        '[data-testid="tweetTextarea_0"]'
      ) as HTMLElement | null;
      if (!el) return;
      // Fire input event to update React's controlled state
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      // Also trigger a keyup so any key-listener validation runs
      el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: " " }));
    });
    await randDelay(800, 1500);

    // ── Submit reply ──────────────────────────────────────────────────────
    // Wait up to 5s for the inline Reply button to become enabled
    // (it stays disabled until React registers the text in its state)
    let submitted = false;
    try {
      await page.waitForFunction(
        () => {
          const btn = document.querySelector(
            '[data-testid="tweetButtonInline"]'
          ) as HTMLButtonElement | null;
          return btn && !btn.disabled;
        },
        { timeout: 5000 }
      );
      const sendBtn = await page.$('[data-testid="tweetButtonInline"]');
      if (sendBtn) {
        await sendBtn.click();
        submitted = true;
      }
    } catch {
      // Button never became enabled — fall back to Ctrl+Enter
    }

    if (!submitted) {
      // Re-focus textarea and send keyboard shortcut
      const ta = await page.$('[data-testid="tweetTextarea_0"]');
      if (ta) await ta.click();
      await randDelay(300, 600);
      await page.keyboard.down("Control");
      await page.keyboard.press("Enter");
      await page.keyboard.up("Control");
      submitted = true;
    }

    await randDelay(2000, 3000);

    // ── Handle "Unlock more on X" / "Got it" popup ─────────────────────────
    // This popup sometimes appears after a reply as an anti-spam measure.
    try {
      const gotItBtn = await page.evaluateHandle(() => {
        const buttons = Array.from(document.querySelectorAll('button[role="button"]'));
        return buttons.find(b => b.textContent?.toLowerCase().includes("got it"));
      });
      if (gotItBtn && (gotItBtn as any).asElement()) {
        addLog("Found 'Unlock more on X' popup — clicking 'Got it'", "info");
        await (gotItBtn as any).asElement().click();
        await randDelay(1000, 2000);
      } else {
        // Fallback: try finding close button (X)
        const closeBtn = await page.$('[aria-label="Close"], [data-testid="app-bar-close"]');
        if (closeBtn) {
          addLog("Found popup — clicking close button", "info");
          await closeBtn.click();
          await randDelay(1000, 2000);
        }
      }
    } catch {
      // No popup found or error handling it — continue
    }

    // Confirm: the textarea should be gone or emptied after a successful reply
    const confirmed = await page.evaluate(() => {
      const ta = document.querySelector(
        '[data-testid="tweetTextarea_0"]'
      ) as HTMLElement | null;
      // textarea gone = modal closed = reply sent
      if (!ta) return true;
      // or the text was cleared
      return (ta.innerText?.trim() ?? "") === "";
    });

    if (!confirmed) {
      await db.collection("xavier_growth_logs").insertOne({
        action: "reply",
        targetTweetUrl: tweetUrl,
        sourceType: target.type,
        sourceValue: target.value,
        content: replyText,
        timestamp: new Date().toISOString(),
        status: "failed",
        error: "Reply submit not confirmed — textarea still has text",
      });
      return "failed";
    }

    g.xavier_grow_dailyCounts.reply++;
    await db.collection("xavier_growth_logs").insertOne({
      action: "reply",
      targetTweetUrl: tweetUrl,
      sourceType: target.type,
      sourceValue: target.value,
      content: replyText,
      timestamp: new Date().toISOString(),
      status: "success",
    });
    return "replied";
  } catch (err: any) {
    await db.collection("xavier_growth_logs").insertOne({
      action: "reply",
      targetTweetUrl: tweetUrl,
      sourceType: target.type,
      sourceValue: target.value,
      timestamp: new Date().toISOString(),
      status: "failed",
      error: err.message,
    });
    return "failed";
  }
}

// ── Main growth tick ──────────────────────────────────────────────────────────
async function growthTick() {
  if (g.xavier_grow_tickRunning) {
    addLog("Tick already running — skipping", "warning");
    return;
  }

  // ── Session suspended: check if session was restored in DB ────────────────
  if (g.xavier_grow_sessionSuspended) {
    try {
      const db = await getDatabase();
      const sessionDoc = await db.collection("xavier_config").findOne({ type: "tw_session" });
      if (sessionDoc?.auth_token && sessionDoc?.status === "active") {
        addLog("Twitter session restored — resuming growth bot", "success");
        g.xavier_grow_sessionSuspended = false;
        g.xavier_grow_consecutiveErrors = 0;
        await resolveSessionAlert("xavier");
      } else {
        addLog("Twitter session still expired — waiting for session refresh in DB", "warning");
        return; // skip tick but keep cron running
      }
    } catch {
      return;
    }
  }

  g.xavier_grow_tickRunning = true;
  g.xavier_grow_lastRun = new Date().toISOString();
  resetDailyCountsIfNeeded();

  let browser: Browser | null = null;
  let page: Page | null = null;

  try {
    const db = await getDatabase();
    const settings = await getSettings(true);

    // Build target pool
    type TargetItem = { type: "keyword" | "hashtag" | "profile"; value: string };
    const targets: TargetItem[] = [
      ...settings.targetKeywords.map((k: string) => ({ type: "keyword" as const, value: k })),
      ...settings.targetHashtags.map((h: string) => ({ type: "hashtag" as const, value: h })),
      ...settings.targetProfiles.map((p: string) => ({ type: "profile" as const, value: p })),
    ];

    if (targets.length === 0) {
      addLog("No targets configured — skipping tick", "warning");
      return;
    }

    // Determine action mode
    const actionMode = advanceActionMode(settings, g.xavier_grow_dailyCounts);
    const actionLabel = ACTION_LABELS[actionMode];

    // Check daily limit
    const limitKey = `daily${actionLabel.charAt(0).toUpperCase() + actionLabel.slice(1)}Limit` as keyof typeof settings;
    const limit = settings[limitKey] as number;
    const count = g.xavier_grow_dailyCounts[actionLabel] ?? 0;
    if (count >= limit) {
      addLog(`Daily ${actionLabel} limit reached (${count}/${limit})`, "warning");
      return;
    }

    addLog(
      `Tick: action=${actionLabel} (${count}/${limit}) dailyCounts=${JSON.stringify(g.xavier_grow_dailyCounts)}`,
      "info"
    );

    // Get session
    const sessionDoc = await db
      .collection("xavier_config")
      .findOne({ type: "tw_session" });
    if (!sessionDoc || !sessionDoc.auth_token) {
      addLog("No Twitter session found", "error");
      g.xavier_grow_consecutiveErrors++;
      return;
    }

    // Round-robin target
    const targetIdx = g.xavier_grow_targetIndex % targets.length;
    g.xavier_grow_targetIndex++;
    const target = targets[targetIdx];

    addLog(`Target: ${target.type}=${target.value}`, "info");

    browser = await getOrCreateBrowser();
    page = await getOrCreatePage(browser);
    await setTwitterCookies(page, sessionDoc);

    // Login check — only navigate to x.com/home if we're NOT already on x.com.
    // Navigating home on every tick is an extra predictable request X can fingerprint.
    const currentUrl = page.url();
    const alreadyOnX = currentUrl.includes("x.com") &&
      !currentUrl.includes("/login") &&
      !currentUrl.includes("i/flow");

    let loggedIn = false;
    if (alreadyOnX) {
      // Quick DOM check — no navigation needed
      loggedIn = await isLoggedIn(page);
    }

    if (!loggedIn) {
      // Not on x.com yet, or DOM check failed — navigate to home to verify
      try {
        await page.goto("https://x.com/home", {
          waitUntil: "domcontentloaded",
          timeout: 40000,
        });
      } catch (navErr: any) {
        // ERR_ABORTED is safe to ignore — the page content still loads
        if (!navErr.message?.includes("ERR_ABORTED") && !navErr.message?.includes("net::")) {
          throw navErr;
        }
      }
      await randDelay(2000, 3000);
      loggedIn = await isLoggedIn(page);
    }

    // ── Handle Passcode Challenge ──────────────────────────────────────────
    if (!loggedIn && sessionDoc.passcode) {
      addLog("Checking for passcode challenge...", "info");
      const isChallenge = await page.evaluate(() => {
        return !!document.querySelector('input[name="challenge_response"]') ||
          !!document.querySelector('[data-testid="ocfEnterTextTextInput"]') ||
          document.body.innerText.includes("Enter the code") ||
          document.body.innerText.includes("Check your email");
      });

      if (isChallenge) {
        addLog("Found login challenge — attempting to fill passcode", "warning");
        const input = await page.$('input[name="challenge_response"], [data-testid="ocfEnterTextTextInput"]');
        if (input) {
          await input.type(sessionDoc.passcode, { delay: 100 });
          await randDelay(1000, 2000);
          await page.keyboard.press("Enter");
          await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 20000 }).catch(() => { });
          await randDelay(3000, 5000);

          // Re-check login
          loggedIn = await isLoggedIn(page);
        }
      }
    }

    if (!loggedIn) {
      addLog("Twitter session expired — suspending growth cron (will auto-resume when session is refreshed in DB)", "error");
      await db
        .collection("xavier_config")
        .updateOne({ type: "tw_session" }, { $set: { status: "expired" } });
      await createSessionAlert("xavier", "Twitter/X");
      g.xavier_grow_sessionSuspended = true;
      return; // skip tick, do NOT increment consecutive errors or stop cron
    }

    // Fetch tweets from target
    const tweets = await getSearchTweets(page, target.value, target.type);
    if (!tweets.length) {
      addLog(`No tweets found for ${target.type}=${target.value}`, "warning");
      return;
    }

    if (!g.xavier_grow_seenTweetUrls) g.xavier_grow_seenTweetUrls = new Set<string>();
    for (const t of tweets) g.xavier_grow_seenTweetUrls.add(t.tweetUrl);
    if (g.xavier_grow_seenTweetUrls.size > 500) g.xavier_grow_seenTweetUrls.clear();

    // Increment session action counter (used for adaptive rate-limiting)
    g.xavier_grow_sessionActions = (g.xavier_grow_sessionActions ?? 0) + 1;

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const tweetUrlsInPool = tweets.map((t) => t.tweetUrl);
    const alreadyActedDocs = await db
      .collection("xavier_growth_logs")
      .find(
        {
          targetTweetUrl: { $in: tweetUrlsInPool },
          action: actionLabel,
          status: "success",
          timestamp: { $gte: sevenDaysAgo },
        },
        { projection: { targetTweetUrl: 1 } }
      )
      .toArray();
    const alreadyActedSet = new Set(alreadyActedDocs.map((d: any) => d.targetTweetUrl));

    const freshTweets = tweets.filter((t) => !alreadyActedSet.has(t.tweetUrl));
    addLog(
      `Search returned ${tweets.length} tweet(s), ${freshTweets.length} fresh (${tweets.length - freshTweets.length} already ${actionLabel}d)`,
      "info"
    );

    if (!freshTweets.length) {
      addLog(`All tweets from ${target.type}=${target.value} already ${actionLabel}d — skipping`, "warning");
      return;
    }

    // Execute action
    if (actionMode === 3) {
      // For REPLIES only: Filter by keyword to ensure on-topic engagement
      const _keywords = (settings.targetKeywords || []).map((k: string) => k.toLowerCase().trim()).filter(Boolean);
      const _hashtags = (settings.targetHashtags || []).map((h: string) => h.toLowerCase().trim().replace(/^#/, "")).filter(Boolean);
      const allFilters = [..._keywords, ..._hashtags];

      if (allFilters.length > 0) {
        const matches = freshTweets.slice(0, 8).filter(t => {
          const txt = t.tweetText.toLowerCase();
          return allFilters.some(f => txt.includes(f));
        });

        if (matches.length === 0) {
          addLog(`No fresh tweets matched your keywords [${allFilters.join(', ')}]. Skipping reply.`, "warning");
          return;
        }

        const pick = matches[Math.floor(Math.random() * Math.min(matches.length, 3))];
        addLog(`Picked on-topic tweet by @${pick.username}: ${pick.tweetUrl}`, "info");

        const res = await replyToTweet(page, pick.tweetUrl, pick.tweetText, settings.replyPrompt, db, target);
        if (res === "replied") {
          addLog(`Replied to @${pick.username}`, "success");
          g.xavier_grow_consecutiveErrors = 0;
        } else {
          addLog(`Reply failed for @${pick.username}`, "error");
          g.xavier_grow_consecutiveErrors++;
        }
        return;
      }
    }

    // Default: Pick a random tweet from fresh results
    const pick = freshTweets[Math.floor(Math.random() * Math.min(freshTweets.length, 5))];
    addLog(`Picked tweet by @${pick.username}: ${pick.tweetUrl}`, "info");

    if (actionMode === 0) {
      // Like
      const res = await likeTweet(page, pick.tweetUrl, db, target);
      if (res === "liked") {
        addLog(`Liked tweet by @${pick.username}`, "success");
        g.xavier_grow_consecutiveErrors = 0;
      } else if (res === "already_liked") {
        addLog(`Already liked @${pick.username}`, "warning");
      } else {
        addLog(`Like failed for @${pick.username}`, "error");
        g.xavier_grow_consecutiveErrors++;
      }
    } else if (actionMode === 1) {
      // Follow
      const res = await followUser(page, pick.username, pick.tweetUrl, db, target);
      if (res === "followed") {
        addLog(`Followed @${pick.username}`, "success");
        g.xavier_grow_consecutiveErrors = 0;
      } else if (res === "already_following") {
        addLog(`Already following @${pick.username}`, "warning");
      } else {
        addLog(`Follow failed for @${pick.username}`, "error");
        g.xavier_grow_consecutiveErrors++;
      }
    } else if (actionMode === 2) {
      // Retweet
      const res = await retweetTweet(page, pick.tweetUrl, db, target);
      if (res === "retweeted") {
        addLog(`Retweeted @${pick.username}`, "success");
        g.xavier_grow_consecutiveErrors = 0;
      } else if (res === "already_retweeted") {
        addLog(`Already retweeted @${pick.username}`, "warning");
      } else {
        addLog(`Retweet failed for @${pick.username}`, "error");
        g.xavier_grow_consecutiveErrors++;
      }
    } else {
      // Reply
      const res = await replyToTweet(
        page,
        pick.tweetUrl,
        pick.tweetText,
        settings.replyPrompt,
        db,
        target
      );
      if (res === "replied") {
        addLog(`Replied to @${pick.username}`, "success");
        g.xavier_grow_consecutiveErrors = 0;
      } else {
        addLog(`Reply failed for @${pick.username}`, "error");
        g.xavier_grow_consecutiveErrors++;
      }
    }

    // Auto-stop after 10 consecutive errors
    if (g.xavier_grow_consecutiveErrors >= 10) {
      addLog("10 consecutive errors — auto-stopping growth bot", "error");
      stopGrowth();
    }

    // ── Save fresh cookies to DB ───────────────────────────────────────────────
    // X rotates ct0 (CSRF token) on write actions. Save updated cookies to prevent expiry.
    try {
      if (page) {
        const currentCookies = await page.cookies();
        const newAuthToken = currentCookies.find((c: any) => c.name === "auth_token")?.value;
        const newCt0 = currentCookies.find((c: any) => c.name === "ct0")?.value;
        const newTwid = currentCookies.find((c: any) => c.name === "twid")?.value;

        if (newAuthToken && newCt0) {
          await db.collection("xavier_config").updateOne(
            { type: "tw_session" },
            {
              $set: {
                auth_token: newAuthToken,
                ct0: newCt0,
                ...(newTwid && { twid: newTwid }),
                updatedAt: new Date().toISOString()
              }
            }
          );
        }
      }
    } catch (e: any) {
      addLog(`Failed to refresh cookies in DB: ${e.message}`, "warning");
    }
  } catch (err: any) {
    addLog(`Tick error: ${err.message}`, "error");
    g.xavier_grow_consecutiveErrors++;
    if (g.xavier_grow_consecutiveErrors >= 10) {
      addLog("10 consecutive errors — auto-stopping", "error");
      stopGrowth();
    }
  } finally {
    g.xavier_grow_tickRunning = false;
  }
}

// ── Adaptive tick scheduling ─────────────────────────────────────────────────
/**
 * Adjusts the next tick interval based on:
 * - Session action count (slow down after many actions to appear human)
 * - Consecutive errors (back off on failure)
 * - Pure randomness (no fixed cadence fingerprint)
 *
 * Range: 90s (few actions, no errors) → 5min (many actions or errors)
 */
function computeNextIntervalMs(): number {
  const actions = g.xavier_grow_sessionActions ?? 0;
  const errors = g.xavier_grow_consecutiveErrors ?? 0;

  // Base interval grows with number of actions performed this session
  let base = 120_000; // 2 min default
  if (actions > 20) base = 180_000;  // 3 min after 20 actions
  if (actions > 40) base = 240_000;  // 4 min after 40 actions
  if (actions > 80) base = 300_000;  // 5 min after 80 actions

  // Back off on errors
  if (errors > 0) base = Math.min(base + errors * 30_000, 300_000);

  // Add ±30% jitter to avoid a detectable fixed cadence
  const jitter = (Math.random() * 0.6 - 0.3) * base; // -30% to +30%
  const interval = Math.max(90_000, Math.round(base + jitter));

  addLog(`Next tick in ${Math.round(interval / 1000)}s (actions=${actions}, errors=${errors})`, "info");
  return interval;
}

// ── Start / Stop ──────────────────────────────────────────────────────────────
function scheduleNextTick() {
  if (!g.xavier_grow_running) return;
  const delay = computeNextIntervalMs();
  g.xavier_grow_currentIntervalMs = delay;
  g.xavier_grow_interval = setTimeout(() => {
    growthTick()
      .catch((e) => addLog(`Uncaught tick error: ${e.message}`, "error"))
      .finally(() => scheduleNextTick());
  }, delay);
}

function startGrowth() {
  if (g.xavier_grow_running) return "already_running";
  g.xavier_grow_running = true;
  g.xavier_grow_consecutiveErrors = 0;
  g.xavier_grow_sessionSuspended = false;
  g.xavier_grow_sessionActions = 0;
  addLog("Xavier growth bot started", "success");
  // Kick off immediately, then use adaptive scheduling
  growthTick()
    .catch((e) => addLog(`Initial tick error: ${e.message}`, "error"))
    .finally(() => scheduleNextTick());
  return "started";
}

function stopGrowth() {
  if (g.xavier_grow_interval) {
    // Works for both clearInterval and clearTimeout
    clearTimeout(g.xavier_grow_interval);
    clearInterval(g.xavier_grow_interval);
    g.xavier_grow_interval = null;
  }
  g.xavier_grow_running = false;
  addLog("Xavier growth bot stopped", "info");

  // Close browser
  if (g.xavier_grow_browser) {
    g.xavier_grow_browser.close().catch(() => { });
    g.xavier_grow_browser = null;
  }

  // Clear visited URL sets when stopped so next session is fresh
  g.xavier_grow_visitedSearchUrls = new Set<string>();
  g.xavier_grow_visitedProfileUrls = new Set<string>();
  g.xavier_grow_sessionActions = 0;
  return "stopped";
}

// ── Route handlers ────────────────────────────────────────────────────────────
export async function GET() {
  return NextResponse.json({
    running: g.xavier_grow_running ?? false,
    tickRunning: g.xavier_grow_tickRunning ?? false,
    lastRun: g.xavier_grow_lastRun ?? null,
    logs: g.xavier_grow_log ?? [],
    dailyCounts: g.xavier_grow_dailyCounts ?? {},
    nextActionMode: ACTION_LABELS[(g.xavier_grow_actionMode ?? 0) % 4 as ActionMode],
    consecutiveErrors: g.xavier_grow_consecutiveErrors ?? 0,
    sessionSuspended: g.xavier_grow_sessionSuspended ?? false,
    sessionActions: g.xavier_grow_sessionActions ?? 0,
    currentIntervalMs: g.xavier_grow_currentIntervalMs ?? 120_000,
    visitedSearchCount: (g.xavier_grow_visitedSearchUrls as Set<string> | undefined)?.size ?? 0,
    visitedProfileCount: (g.xavier_grow_visitedProfileUrls as Set<string> | undefined)?.size ?? 0,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action } = body;

    if (action === "start") {
      const result = startGrowth();
      return NextResponse.json({
        success: true,
        message:
          result === "already_running"
            ? "Growth bot is already running."
            : "Xavier growth bot started.",
      });
    }

    if (action === "stop") {
      stopGrowth();
      return NextResponse.json({
        success: true,
        message: "Xavier growth bot stopped.",
      });
    }

    if (action === "tick") {
      // Manual single tick (for testing)
      growthTick().catch(() => { });
      return NextResponse.json({ success: true, message: "Manual tick triggered." });
    }

    if (action === "reset_counts") {
      g.xavier_grow_dailyCounts = { follow: 0, like: 0, retweet: 0, reply: 0 };
      return NextResponse.json({ success: true, message: "Daily counts reset." });
    }

    if (action === "clear_logs") {
      g.xavier_grow_log = [];
      return NextResponse.json({ success: true, message: "Growth logs cleared." });
    }

    if (action === "clear_visited") {
      g.xavier_grow_visitedSearchUrls = new Set<string>();
      g.xavier_grow_visitedProfileUrls = new Set<string>();
      g.xavier_grow_sessionActions = 0;
      return NextResponse.json({ success: true, message: "Visited URL history and session action count cleared." });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
