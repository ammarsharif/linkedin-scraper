import { NextRequest, NextResponse } from "next/server";
import { getDatabase } from "@/lib/mongodb";
import { createSessionAlert } from "@/lib/sessionAlert";
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
  g.xavier_grow_dailyCounts = { follow: 0, like: 0, retweet: 0, reply: 0 };
  g.xavier_grow_settings = null;
  g.xavier_grow_targetIndex = 0;
  // Action modes: 0=like, 1=follow, 2=retweet, 3=reply
  g.xavier_grow_actionMode = 0;
  g.xavier_grow_browser = null;
  g.xavier_grow_seenTweetUrls = new Set<string>();
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

  g.xavier_grow_browser = await puppeteer.launch({
    headless: false,
    userDataDir: "./xavier_puppeteer_profile",
    defaultViewport: { width: 1280, height: 900 },
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-notifications",
      "--disable-blink-features=AutomationControlled",
    ],
  });
  return g.xavier_grow_browser;
}

async function getOrCreatePage(browser: Browser): Promise<Page> {
  const pages = await browser.pages();
  const page = pages.length > 0 ? pages[0] : await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36"
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
  let url: string;
  // Alternate filter tabs each tick so we never hit the exact same URL twice in a row.
  // tickIndex is incremented before getSearchTweets is called, so odd/even alternates per tick.
  const tickIndex = g.xavier_grow_targetIndex as number;
  const useAlt = tickIndex % 2 === 0;

  if (type === "hashtag") {
    // Alternate between "top" and "live" (recent) for hashtags
    const filter = useAlt ? "top" : "live";
    url = `https://x.com/search?q=%23${encodeURIComponent(query.replace(/^#/, ""))}&f=${filter}`;
  } else if (type === "profile") {
    url = `https://x.com/${encodeURIComponent(query.replace(/^@/, ""))}`;
  } else {
    // Alternate between "latest" and "top"; every 3rd tick also exclude retweets for variety
    const filter = useAlt ? "latest" : "top";
    const noRt = tickIndex % 3 === 0 ? " -filter:retweets" : "";
    url = `https://x.com/search?q=${encodeURIComponent(query + noRt)}&f=${filter}`;
  }

  await page.goto(url, { waitUntil: "networkidle2", timeout: 40000 });
  await randDelay(2000, 3500);
  await page.evaluate(() => window.scrollBy(0, 400));
  await randDelay(1000, 2000);

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
    await page.goto(profileUrl, { waitUntil: "networkidle2", timeout: 40000 });
    await randDelay(1500, 3000);

    // Check login
    if (page.url().includes("/login") || page.url().includes("i/flow/login")) {
      return "failed";
    }

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
      addLog("Twitter session expired — marking as expired", "error");
      await db
        .collection("xavier_config")
        .updateOne({ type: "tw_session" }, { $set: { status: "expired" } });
      await createSessionAlert("xavier", "Twitter/X");
      g.xavier_grow_consecutiveErrors++;
      return;
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

// ── Start / Stop ──────────────────────────────────────────────────────────────
function startGrowth() {
  if (g.xavier_grow_running) return "already_running";
  g.xavier_grow_running = true;
  g.xavier_grow_consecutiveErrors = 0;
  addLog("Xavier growth bot started", "success");
  g.xavier_grow_interval = setInterval(() => {
    growthTick().catch((e) =>
      addLog(`Uncaught tick error: ${e.message}`, "error")
    );
  }, 90_000); // every 90 seconds
  // Kick off immediately
  growthTick().catch((e) =>
    addLog(`Initial tick error: ${e.message}`, "error")
  );
  return "started";
}

function stopGrowth() {
  if (g.xavier_grow_interval) {
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

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
