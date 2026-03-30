import { NextRequest, NextResponse } from "next/server";
import { getDatabase } from "@/lib/mongodb";
import puppeteer, { Browser } from "puppeteer";
import OpenAI from "openai";

export const maxDuration = 60;

// ── Global state ────────────────────────────────────────────────────────────
const g = globalThis as any;
if (g.instar_grow_initialized === undefined) {
  g.instar_grow_initialized = true;
  g.instar_grow_growInterval = null;
  g.instar_grow_growRunning = false;
  g.instar_grow_tickRunning = false;
  g.instar_grow_lastGrowRun = null;
  g.instar_grow_growLog = [];
  g.instar_grow_consecutiveErrors = 0;
  g.instar_grow_dailyCounts = { follow: 0, like: 0, comment: 0 };
  g.instar_grow_settings = null;
  // Round-robin index so we cycle through all targets instead of picking randomly
  g.instar_grow_targetIndex = 0;
  // Rotating action mode: 0 = comment, 1 = follow, 2 = like
  // Each cron tick focuses on ONE action type to ensure all three get runs
  g.instar_grow_actionMode = 0;
}

// ── Action mode labels ───────────────────────────────────────────────────────
type ActionMode = 0 | 1 | 2; // 0=comment, 1=follow, 2=like
const ACTION_LABELS: Record<ActionMode, string> = {
  0: "comment",
  1: "follow",
  2: "like",
};

// ── Default settings ────────────────────────────────────────────────────────
const DEFAULT_SETTINGS = {
  targetHashtags: ["business", "entrepreneur", "marketing"],
  targetProfiles: [] as string[],
  targetKeywords: [] as string[],
  dailyFollowLimit: 20,
  dailyLikeLimit: 60,
  dailyCommentLimit: 10,
  commentPrompt:
    "Write a short, genuine, relevant 1-sentence comment (no emojis, no hashtags) for an Instagram post about the topic provided. Be specific and insightful.",
  enableLike: true,
  enableFollow: true,
  enableComment: true,
};

// ── Settings helpers ─────────────────────────────────────────────────────────
// Always force a fresh DB read — never use stale cache during a tick.
async function getGrowSettings(forceFresh = false) {
  if (!forceFresh && g.instar_grow_settings) {
    return { ...DEFAULT_SETTINGS, ...g.instar_grow_settings };
  }
  try {
    const db = await getDatabase();
    const saved = await db
      .collection("instar_settings")
      .findOne({ type: "growth_settings" });
    if (saved) {
      g.instar_grow_settings = {
        ...DEFAULT_SETTINGS,
        targetHashtags: Array.isArray(saved.targetHashtags)
          ? saved.targetHashtags
          : DEFAULT_SETTINGS.targetHashtags,
        targetProfiles: Array.isArray(saved.targetProfiles)
          ? saved.targetProfiles
          : DEFAULT_SETTINGS.targetProfiles,
        targetKeywords: Array.isArray(saved.targetKeywords)
          ? saved.targetKeywords
          : DEFAULT_SETTINGS.targetKeywords,
        dailyFollowLimit: Number(
          saved.dailyFollowLimit ?? DEFAULT_SETTINGS.dailyFollowLimit
        ),
        dailyLikeLimit: Number(
          saved.dailyLikeLimit ?? DEFAULT_SETTINGS.dailyLikeLimit
        ),
        dailyCommentLimit: Number(
          saved.dailyCommentLimit ?? DEFAULT_SETTINGS.dailyCommentLimit
        ),
        commentPrompt:
          saved.commentPrompt ?? DEFAULT_SETTINGS.commentPrompt,
        enableLike: saved.enableLike ?? DEFAULT_SETTINGS.enableLike,
        enableFollow: saved.enableFollow ?? DEFAULT_SETTINGS.enableFollow,
        enableComment: saved.enableComment ?? DEFAULT_SETTINGS.enableComment,
      };
      return g.instar_grow_settings as typeof DEFAULT_SETTINGS;
    }
  } catch {}
  g.instar_grow_settings = { ...DEFAULT_SETTINGS };
  return g.instar_grow_settings as typeof DEFAULT_SETTINGS;
}

// ── Logging ──────────────────────────────────────────────────────────────────
function addGrowLog(
  message: string,
  type: "info" | "success" | "error" | "warning" = "info"
) {
  const entry = { time: new Date().toISOString(), message, type };
  g.instar_grow_growLog.push(entry);
  if (g.instar_grow_growLog.length > 200)
    g.instar_grow_growLog = g.instar_grow_growLog.slice(-200);
  console.log(`[instar-grow-cron][${type}] ${message}`);
}

// ── Sync daily counters from DB ───────────────────────────────────────────────
async function syncDailyCountersFromDb() {
  try {
    const db = await getDatabase();
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const actionsToday = await db
      .collection("instar_growth_logs")
      .find({
        status: "success",
        timestamp: { $gte: startOfToday.toISOString() },
      })
      .toArray();

    let f = 0,
      l = 0,
      c = 0;
    for (const a of actionsToday) {
      if (a.action === "follow") f++;
      if (a.action === "like") l++;
      if (a.action === "comment") c++;
    }
    g.instar_grow_dailyCounts = { follow: f, like: l, comment: c };
  } catch {
    g.instar_grow_dailyCounts = { follow: 0, like: 0, comment: 0 };
  }
}

// ── Browser factory ───────────────────────────────────────────────────────────
async function getGrowBrowser(): Promise<Browser> {
  if (!g.instarGrowBrowser || !g.instarGrowBrowser.connected) {
    addGrowLog("Starting growth Puppeteer browser...", "info");
    g.instarGrowBrowser = await puppeteer.launch({
      headless: false,
      userDataDir: "./ig_puppeteer_profile_grow",
      defaultViewport: { width: 1280, height: 900 },
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-notifications",
        "--disable-blink-features=AutomationControlled",
      ],
    });
  }
  return g.instarGrowBrowser;
}

function getOpenAI(): OpenAI {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set.");
  return new OpenAI({ apiKey: key });
}

// Human-like random delay
function randDelay(min = 1500, max = 4000): Promise<void> {
  return new Promise((r) =>
    setTimeout(r, Math.floor(Math.random() * (max - min)) + min)
  );
}

// Build flat list of targets (hashtags + profiles)
function buildSearchTargets(
  settings: typeof DEFAULT_SETTINGS
): Array<{ type: "hashtag" | "profile"; value: string }> {
  const targets: Array<{ type: "hashtag" | "profile"; value: string }> = [];
  for (const h of settings.targetHashtags ?? []) {
    if (h && typeof h === "string") targets.push({ type: "hashtag", value: h.trim() });
  }
  for (const p of settings.targetProfiles ?? []) {
    if (p && typeof p === "string") targets.push({ type: "profile", value: p.trim() });
  }
  return targets;
}

// ── Advance action mode — skip disabled or limit-reached modes ───────────────
function advanceActionMode(
  settings: typeof DEFAULT_SETTINGS,
  counts: { follow: number; like: number; comment: number }
): ActionMode {
  const enabled: Record<string, boolean> = {
    comment: settings.enableComment && counts.comment < settings.dailyCommentLimit,
    follow: settings.enableFollow && counts.follow < settings.dailyFollowLimit,
    like: settings.enableLike && counts.like < settings.dailyLikeLimit,
  };

  // Cycle through 0→1→2→0...
  // Find the next mode that is still enabled
  let mode = (g.instar_grow_actionMode as number) % 3;
  for (let tries = 0; tries < 3; tries++) {
    const label = ACTION_LABELS[mode as ActionMode];
    if (enabled[label]) {
      g.instar_grow_actionMode = (mode + 1) % 3; // queue next for following tick
      return mode as ActionMode;
    }
    mode = (mode + 1) % 3;
  }
  // All modes exhausted — return current (caller will check limits)
  g.instar_grow_actionMode = (mode + 1) % 3;
  return mode as ActionMode;
}

// ── LIKE action ───────────────────────────────────────────────────────────────
async function performLike(
  page: import("puppeteer").Page,
  postUrl: string,
  username: string,
  searchLabel: string,
  target: { type: string; value: string },
  db: import("mongodb").Db
): Promise<boolean> {
  // Wait for the action buttons to be visible
  await page.waitForSelector('article section, [role="button"] svg', { timeout: 5000 }).catch(() => {});
  await randDelay(1000, 2000);

  // Already liked on Instagram?
  const igAlreadyLiked = await page.evaluate(() => {
    const unlikes = Array.from(document.querySelectorAll('svg[aria-label*="Unlike"], svg[aria-label*="Remove Like"], svg[aria-label*="unlike"]'));
    if (unlikes.length > 0) return true;
    
    const redHearts = Array.from(document.querySelectorAll('svg[fill="#ff3040"], svg[color="#ff3040"], svg[fill="rgb(255, 48, 64)"]'));
    if (redHearts.length > 0) return true;

    return false;
  });

  if (igAlreadyLiked) {
    addGrowLog(`Post by @${username} already liked on IG.`, "info");
    await db.collection("instar_growth_logs").insertOne({
      action: "like",
      targetUsername: username,
      targetPostUrl: postUrl,
      source: target.type,
      sourceValue: target.value,
      timestamp: new Date().toISOString(),
      status: "success",
      note: "already_liked",
    });
    g.instar_grow_dailyCounts.like++;
    return true;
  }

  // Robust "Like" button logic
  const clickSuccess = await page.evaluate(() => {
    const findLikeBtn = () => {
      // Strategy 1: Search by aria-label
      const labels = ["Like", "Like post", "like", "Like this post"];
      for (const lbl of labels) {
        const svg = document.querySelector(`svg[aria-label="${lbl}"]`);
        if (svg) return svg.closest('[role="button"]') || svg.closest('button') || svg.parentElement;
      }
      // Strategy 2: Search by SVG title tag (found in user snippet)
      const titles = Array.from(document.querySelectorAll('svg title'));
      for (const t of titles) {
        if (t.textContent === 'Like') {
           const svg = t.closest('svg');
           if (svg) return svg.closest('[role="button"]') || svg.closest('button') || svg.parentElement;
        }
      }
      // Strategy 3: Target the first button in the actions row
      // IG actions are usually in a section, first button/role-button
      const actionsSection = document.querySelector('article section');
      if (actionsSection) {
        const btn = actionsSection.querySelector('button, [role="button"]');
        if (btn) return btn;
      }
      return null;
    };

    const btn = findLikeBtn() as HTMLElement;
    if (btn) {
      btn.scrollIntoView({ block: 'center' });
      // Use both click() and synthetic events for maximum chance
      btn.click();
      btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return true;
    }
    return false;
  });

  let liked = clickSuccess;

  // Fallback 1: Coordinate-based click on the SVG if found
  if (!liked) {
    try {
      const svgHandle = await page.$('svg[aria-label="Like"], svg[aria-label="Like post"]');
      if (svgHandle) {
        await svgHandle.click();
        liked = true;
      }
    } catch {}
  }

  // Fallback 2: Keyboard shortcut "L" to like
  if (!liked) {
    await page.keyboard.press("l").catch(() => {});
    await randDelay(800, 1200);
    liked = await page.evaluate(() => {
      return !!(
        document.querySelector('svg[aria-label*="Unlike"]') ||
        document.querySelector('svg[fill="#ff3040"]')
      );
    });
  }

  // Fallback 3: Double click as a last resort
  if (!liked) {
    try {
      const article = await page.$('article');
      if (article) {
        const box = await article.boundingBox();
        if (box) {
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { clickCount: 2 });
          await randDelay(1000, 1500);
          liked = true; // Assume success if double click performed
        }
      }
    } catch {}
  }

  if (liked) {
    g.instar_grow_dailyCounts.like++;
    addGrowLog(`❤️  Liked @${username}'s post. [${g.instar_grow_dailyCounts.like} today]`, "success");
    await db.collection("instar_growth_logs").insertOne({
      action: "like",
      targetUsername: username,
      targetPostUrl: postUrl,
      source: target.type,
      sourceValue: target.value,
      timestamp: new Date().toISOString(),
      status: "success",
    });
    return true;
  }

  addGrowLog(`Failed to like @${username}'s post (selectors failed).`, "warning");
  return false;
}

// ── FOLLOW action ─────────────────────────────────────────────────────────────
async function performFollow(
  page: import("puppeteer").Page,
  postUrl: string,
  username: string,
  target: { type: string; value: string },
  db: import("mongodb").Db
): Promise<boolean> {
  // Try clicking Follow / Follow Back button using multiple selectors
  const followed = await page.evaluate(() => {
    const candidates = Array.from(
      document.querySelectorAll<HTMLElement>('button, [role="button"]')
    );
    for (const btn of candidates) {
      const text = btn.innerText?.trim();
      // Accept "Follow" or "Follow Back" but NOT "Following" / "Requested"
      if (text === "Follow" || text === "Follow Back") {
        btn.click();
        return true;
      }
    }
    return false;
  });

  if (followed) {
    g.instar_grow_dailyCounts.follow++;
    addGrowLog(
      `➕ Followed @${username} [${g.instar_grow_dailyCounts.follow} today]`,
      "success"
    );
    await db.collection("instar_growth_logs").insertOne({
      action: "follow",
      targetUsername: username,
      targetPostUrl: postUrl,
      source: target.type,
      sourceValue: target.value,
      timestamp: new Date().toISOString(),
      status: "success",
    });
    await randDelay(3000, 6000);
    return true;
  }

  // Log reason — may already be following
  const alreadyFollowing = await page.evaluate(() => {
    const candidates = Array.from(
      document.querySelectorAll<HTMLElement>('button, [role="button"]')
    );
    return candidates.some((b) => {
      const t = b.innerText?.trim();
      return t === "Following" || t === "Requested";
    });
  });

  if (alreadyFollowing) {
    addGrowLog(`Already following @${username}, skipping.`, "info");
  } else {
    addGrowLog(
      `No Follow button found for @${username} — may be private or unavailable.`,
      "warning"
    );
  }
  return false;
}

// ── COMMENT action ────────────────────────────────────────────────────────────
async function performComment(
  page: import("puppeteer").Page,
  postUrl: string,
  postCaption: string,
  username: string,
  target: { type: string; value: string },
  settings: typeof DEFAULT_SETTINGS,
  openai: OpenAI,
  db: import("mongodb").Db
): Promise<boolean> {
  try {
    const contextLabel =
      target.type === "hashtag" ? `#${target.value}` : `by @${target.value}`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: settings.commentPrompt },
        {
          role: "user",
          content: `Instagram post ${contextLabel}${
            postCaption
              ? `: "${postCaption.slice(0, 150)}"`
              : ""
          }. Write a comment.`,
        },
      ],
      temperature: 0.8,
      max_tokens: 60,
    });

    const comment = completion.choices[0]?.message?.content?.trim() || "";
    if (!comment) throw new Error("Empty comment from AI.");

    // Click the comment box
    const commentBoxClicked = await page.evaluate(() => {
      const textarea = document.querySelector(
        'textarea[aria-label*="omment"], form textarea, [placeholder*="omment"]'
      );
      if (textarea) {
        (textarea as HTMLElement).click();
        (textarea as HTMLElement).focus();
        return true;
      }
      return false;
    });

    if (!commentBoxClicked) {
      addGrowLog(`Comment box not found on @${username}'s post.`, "warning");
      return false;
    }

    await randDelay(600, 1200);

    const commentBox = await page.$(
      'textarea[aria-label*="omment"], form textarea, [placeholder*="omment"]'
    );
    if (!commentBox) {
      addGrowLog(`Could not select comment textarea on @${username}'s post.`, "warning");
      return false;
    }

    await commentBox.type(comment, { delay: 40 });
    await randDelay(500, 1000);
    await page.keyboard.press("Enter");
    await randDelay(2500, 4000);

    g.instar_grow_dailyCounts.comment++;
    addGrowLog(
      `💬 Commented on @${username}'s post: "${comment.slice(0, 60)}" [${g.instar_grow_dailyCounts.comment} today]`,
      "success"
    );

    await db.collection("instar_growth_logs").insertOne({
      action: "comment",
      targetUsername: username,
      targetPostUrl: postUrl,
      source: target.type,
      sourceValue: target.value,
      content: comment,
      timestamp: new Date().toISOString(),
      status: "success",
    });

    return true;
  } catch (err: any) {
    addGrowLog(`Comment failed on @${username}'s post: ${err.message}`, "warning");
    return false;
  }
}

// ── Main Growth Cron Tick ─────────────────────────────────────────────────────
async function growCronTick(
  sessionid: string,
  ds_user_id: string,
  csrftoken: string,
  mid: string | undefined
) {
  if (!g.instar_grow_growRunning) return;

  if (g.instar_grow_tickRunning) {
    addGrowLog("Previous tick still running, skipping this interval.", "warning");
    return;
  }
  g.instar_grow_tickRunning = true;

  try {
    // Always read fresh settings from DB on every tick so enable toggles
    // and limit changes take effect immediately without a server restart.
    const settings = await getGrowSettings(true);
    g.instar_grow_lastGrowRun = new Date().toISOString();
    await syncDailyCountersFromDb();

    const counts = g.instar_grow_dailyCounts;

    // ── Check all daily limits ────────────────────────────────────────────
    const commentDone = !settings.enableComment || counts.comment >= settings.dailyCommentLimit;
    const followDone = !settings.enableFollow || counts.follow >= settings.dailyFollowLimit;
    const likeDone = !settings.enableLike || counts.like >= settings.dailyLikeLimit;

    if (commentDone && followDone && likeDone) {
      addGrowLog(
        `🚫 All daily limits reached — Comments: ${counts.comment}/${settings.dailyCommentLimit}, Follows: ${counts.follow}/${settings.dailyFollowLimit}, Likes: ${counts.like}/${settings.dailyLikeLimit}. Skipping tick.`,
        "warning"
      );
      return;
    }

    // ── Pick action mode for this tick ────────────────────────────────────
    // Rotation order: comment (0) → follow (1) → like (2) → repeat
    const actionMode = advanceActionMode(settings, counts);
    const actionName = ACTION_LABELS[actionMode];

    // Check if this action's limit is hit (this can happen when advanceActionMode 
    // finds no valid mode — all are actually exhausted but the all-done check above
    // didn't catch it). In that case bail cleanly.
    const actionLimitMap: Record<string, boolean> = {
      comment: commentDone,
      follow: followDone,
      like: likeDone,
    };
    if (actionLimitMap[actionName]) {
      addGrowLog(`Daily limit reached for ${actionName}s, skipping tick.`, "info");
      return;
    }

    addGrowLog(
      `🔄 Tick started — Mode: ${actionName.toUpperCase()} | Counts: Comments ${counts.comment}/${settings.dailyCommentLimit}, Follows ${counts.follow}/${settings.dailyFollowLimit}, Likes ${counts.like}/${settings.dailyLikeLimit}`,
      "info"
    );

    // ── Build search targets ──────────────────────────────────────────────
    const allTargets = buildSearchTargets(settings);
    if (allTargets.length === 0) {
      addGrowLog("No hashtags or profiles configured. Add targets in settings.", "warning");
      return;
    }

    let currentIndex = parseInt(g.instar_grow_targetIndex, 10);
    if (isNaN(currentIndex) || currentIndex < 0) currentIndex = 0;
    currentIndex = currentIndex % allTargets.length;
    const target = allTargets[currentIndex];
    if (!target) {
      addGrowLog("Failed to select a target from the list.", "error");
      return;
    }
    g.instar_grow_targetIndex = currentIndex + 1;

    const searchLabel =
      target.type === "hashtag" ? `#${target.value}` : `@${target.value}`;
    addGrowLog(`🎯 Targeting ${searchLabel} for ${actionName}s`, "info");

    const browser = await getGrowBrowser();
    const openai = settings.enableComment ? getOpenAI() : (null as any);
    const db = await getDatabase();

    try {
      const page = await browser.newPage();

      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      });

      const cookiesToSet = [
        { name: "sessionid", value: sessionid, domain: ".instagram.com" },
        { name: "ds_user_id", value: ds_user_id, domain: ".instagram.com" },
        { name: "csrftoken", value: csrftoken, domain: ".instagram.com" },
        ...(mid ? [{ name: "mid", value: mid, domain: ".instagram.com" }] : []),
      ];
      for (const cookie of cookiesToSet) {
        await page.setCookie(cookie);
      }

      const targetUrl =
        target.type === "hashtag"
          ? `https://www.instagram.com/explore/tags/${encodeURIComponent(target.value)}/`
          : `https://www.instagram.com/${encodeURIComponent(target.value)}/`;

      await page.goto(targetUrl, { waitUntil: "networkidle2", timeout: 45000 });

      if (page.url().includes("/accounts/login")) {
        addGrowLog("❌ Session expired on growth browser. Please refresh your session.", "error");
        await page.close();
        g.instar_grow_consecutiveErrors++;
        return;
      }

      await new Promise((r) => setTimeout(r, 4000));
      await page.evaluate(() => window.scrollBy(0, 600));
      await new Promise((r) => setTimeout(r, 2000));

      // Collect post links
      const postLinks = await page.evaluate(() => {
        const links = Array.from(
          document.querySelectorAll("a[href]")
        ) as HTMLAnchorElement[];
        const seen = new Set<string>();
        const result: string[] = [];
        for (const l of links) {
          const href = l.href;
          if (
            (href.includes("/p/") || href.includes("/reel/")) &&
            !seen.has(href)
          ) {
            seen.add(href);
            result.push(href);
            if (result.length >= 20) break;
          }
        }
        return result;
      });

      addGrowLog(`Found ${postLinks.length} posts from ${searchLabel}.`, "info");

      if (postLinks.length === 0) {
        addGrowLog(`No posts found for ${searchLabel} — skipping.`, "warning");
        await page.close();
        return;
      }

      // ── Load already-done actions from DB ────────────────────────────────
      const alreadyActedSet = new Set<string>(
        (
          await db
            .collection("instar_growth_logs")
            .find(
              { targetPostUrl: { $in: postLinks }, status: "success" },
              { projection: { targetPostUrl: 1, action: 1 } }
            )
            .toArray()
        ).map((r) => `${r.action}::${r.targetPostUrl}`)
      );

      const alreadyFollowedUsers = new Set<string>(
        (
          await db
            .collection("instar_growth_logs")
            .find(
              { action: "follow", status: "success" },
              { projection: { targetUsername: 1 } }
            )
            .toArray()
        ).map((r) => r.targetUsername as string)
      );

      // ── Process posts — max 5 actions per tick ────────────────────────────
      const maxActionsPerTick = 5;
      let actionsThisTick = 0;

      for (const postUrl of postLinks) {
        if (!g.instar_grow_growRunning) {
          addGrowLog("Cron stopped mid-execution. Aborting early.", "warning");
          break;
        }
        if (actionsThisTick >= maxActionsPerTick) break;

        // Re-check live daily limit on every iteration
        const liveCounts = g.instar_grow_dailyCounts;
        const limitReached =
          actionMode === 0
            ? liveCounts.comment >= settings.dailyCommentLimit
            : actionMode === 1
            ? liveCounts.follow >= settings.dailyFollowLimit
            : liveCounts.like >= settings.dailyLikeLimit;

        if (limitReached) {
          addGrowLog(
            `✅ Daily ${actionName} limit reached mid-tick (${liveCounts[actionName as keyof typeof liveCounts]}). Stopping.`,
            "info"
          );
          break;
        }

        // Skip post if this action was already done on it
        const alreadyDone =
          actionMode === 0
            ? alreadyActedSet.has(`comment::${postUrl}`)
            : actionMode === 1
            ? alreadyFollowedUsers.has("__check_per_post__") // for follow, we check username later
            : alreadyActedSet.has(`like::${postUrl}`);

        if (actionMode !== 1 && alreadyDone) {
          addGrowLog(
            `Already ${actionName}d post ${postUrl.split("/").slice(-3, -1).join("/")}. Skipping.`,
            "info"
          );
          continue;
        }

        try {
          await page.goto(postUrl, { waitUntil: "networkidle2", timeout: 35000 });
          await randDelay(2000, 3500);

          if (!g.instar_grow_growRunning) break;

          // ── Extract caption + author username ──────────────────────────
          const postInfo = await page.evaluate(() => {
            let caption = '';

            // Strategy 1: Open Graph Meta tag (extremely robust for single posts)
            // Format: <meta property="og:title" content='Username on Instagram: "Real caption here"'>
            const metaCaption = document.querySelector('meta[property="og:title"]');
            if (metaCaption) {
              const content = metaCaption.getAttribute('content') || '';
              const match = content.match(/on Instagram: "([\s\S]*?)"$/);
              if (match && match[1]) {
                caption = match[1];
              }
            }

            // Strategy 2: Various known IG selectors (if Strategy 1 fails)
            if (!caption || caption.length < 5) {
              const captionSelectors = [
                'h1[dir="auto"]', // Reels / modern post formats
                'article div > span > span[dir]', // Classic post wrapper
                'article li span[dir]', // First comment block
                '[data-testid="post-comment-root"] span',
                'article span[dir="auto"]'
              ];
              for (const sel of captionSelectors) {
                const els = Array.from(document.querySelectorAll(sel)) as HTMLElement[];
                for (const el of els) {
                  const txt = el.innerText?.trim() || '';
                  // Must be long enough to be a real caption and not just username or "X likes"
                  if (txt.length >= 10 && !txt.includes(" likes") && !txt.includes(" views")) {
                    caption = txt;
                    break;
                  }
                }
                if (caption && caption.length >= 5) break;
              }
            }

            // Username: extract from the href (/username/) rather than innerText.
            // On standalone post pages, content is in <main> not <article>.
            // We skip top navigation bars to prevent grabbing the logged-in user.
            let username = '';
            const authorLinks = Array.from(
              document.querySelectorAll('main header a[href], article header a[href], [data-testid="post-comment-root"] a[href], article a[href], main a[href]')
            ) as HTMLAnchorElement[];
            
            for (const a of authorLinks) {
              if (a.closest('nav') || a.closest('[role="navigation"]')) continue;
              
              try {
                const url = new URL(a.href, window.location.origin);
                const paths = url.pathname.split('/').filter(Boolean);
                
                if (paths.length === 1) {
                  const candidate = paths[0];
                  // Ignore known generic IG paths
                  const reserved = ['explore', 'accounts', 'stories', 'reels', 'direct', 'p', 'reel', 'tv'];
                  if (!reserved.includes(candidate)) {
                    // First valid profile link within main/article is the author
                    username = candidate;
                    break;
                  }
                }
              } catch {}
            }

            return { caption: caption.slice(0, 300), username };
          });

          addGrowLog(
            `📄 Post @${postInfo.username || '?'} — caption: ${postInfo.caption ? '"' + postInfo.caption.slice(0, 60) + '"' : '(none)'}`,
            'info'
          );

          // ── Keyword filter ────────────────────────────────────────────────
          // Only apply the keyword filter if we actually extracted a caption.
          // If caption extraction failed, proceed anyway (don't silently skip).
          const _rawKeywords: string[] = settings.targetKeywords ?? [];
          const _keywords = _rawKeywords.map(k => k.trim()).filter(Boolean); // Clean any empty strings
          
          if (_keywords.length > 0) {
            if (!postInfo.caption) {
              // Caption unavailable — skip keyword check, proceed with action
              addGrowLog(
                `Caption not extractable for @${postInfo.username || '?'} — skipping keyword filter.`,
                'info'
              );
            } else {
              const captionLower = postInfo.caption.toLowerCase();
              const hasKeyword = _keywords.some((kw: string) =>
                captionLower.includes(kw.toLowerCase())
              );
              if (!hasKeyword) {
                // EXPLICIT LOGGING: show the user exactly what words the bot is looking for
                addGrowLog(
                  `Skipping @${postInfo.username || '?'}'s post — caption doesn't contain any of your required keywords: [${_keywords.join(', ')}].`,
                  'info'
                );
                continue;
              } else {
                addGrowLog(`✅ Keyword matched on @${postInfo.username || '?'}'s post! Proceeding.`, 'success');
              }
            }
          }

          // ── For FOLLOW: check if already following this user ────────────
          if (actionMode === 1) {
            if (!postInfo.username) {
              addGrowLog("Could not extract username — skipping follow.", "warning");
              continue;
            }
            if (alreadyFollowedUsers.has(postInfo.username)) {
              addGrowLog(`Already followed @${postInfo.username}, skipping.`, "info");
              continue;
            }
          }

          // ── Execute the action for this tick ─────────────────────────────
          let success = false;

          if (actionMode === 0) {
            // COMMENT
            success = await performComment(
              page, postUrl, postInfo.caption, postInfo.username,
              target, settings, openai, db
            );
          } else if (actionMode === 1) {
            // FOLLOW
            success = await performFollow(
              page, postUrl, postInfo.username, target, db
            );
            if (success) alreadyFollowedUsers.add(postInfo.username);
          } else {
            // LIKE
            success = await performLike(
              page, postUrl, postInfo.username, searchLabel, target, db
            );
          }

          if (success) {
            actionsThisTick++;
            alreadyActedSet.add(`${actionName}::${postUrl}`);
          }

          await randDelay(2000, 4000);
        } catch (postErr: any) {
          addGrowLog(`Error on post ${postUrl}: ${postErr.message}`, "warning");
          await db.collection("instar_growth_logs").insertOne({
            action: "error",
            targetPostUrl: postUrl,
            source: target.type,
            sourceValue: target.value,
            timestamp: new Date().toISOString(),
            status: "failed",
            error: postErr.message,
          });
        }
      }

      await page.close();
      const c = g.instar_grow_dailyCounts;
      addGrowLog(
        `✅ Tick done — ${actionsThisTick} ${actionName}(s) this tick | 💬 Comments: ${c.comment}/${settings.dailyCommentLimit} | ➕ Follows: ${c.follow}/${settings.dailyFollowLimit} | ❤️  Likes: ${c.like}/${settings.dailyLikeLimit}`,
        "info"
      );
      g.instar_grow_consecutiveErrors = 0;
    } catch (err: any) {
      const errMsg: string = err?.message || String(err);
      // "Connection closed" happens when stop() closes the browser mid-tick.
      // Don't count that as a real error or chrome will be killed unnecessarily.
      const isGracefulStop =
        errMsg.includes('Connection closed') ||
        errMsg.includes('Target closed') ||
        errMsg.includes('Session closed');

      if (isGracefulStop) {
        addGrowLog('Tick interrupted by stop (browser closed). Not an error.', 'warning');
      } else {
        g.instar_grow_consecutiveErrors++;
        addGrowLog(`Growth tick error: ${errMsg}`, 'error');

        if (g.instar_grow_consecutiveErrors >= 4) {
          addGrowLog('4 consecutive errors — killing growth browser.', 'error');
          try { await g.instarGrowBrowser?.close(); } catch {}
          g.instarGrowBrowser = undefined;
          g.instar_grow_consecutiveErrors = 0;
        }
      }
    }
  } finally {
    g.instar_grow_tickRunning = false;
  }
}

// ── GET: Status + logs ────────────────────────────────────────────────────────
export async function GET() {
  const settings = await getGrowSettings();
  await syncDailyCountersFromDb();

  return NextResponse.json({
    running: g.instar_grow_growRunning,
    lastRun: g.instar_grow_lastGrowRun,
    logs: g.instar_grow_growLog.slice(-50),
    dailyCounts: g.instar_grow_dailyCounts,
    consecutiveErrors: g.instar_grow_consecutiveErrors,
    settings,
    nextActionMode: ACTION_LABELS[(g.instar_grow_actionMode ?? 0) as ActionMode],
  });
}

// ── POST: Start / Stop / Update settings ─────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action = body.action as string;

    // ── Clear logs ──────────────────────────────────────────────────────────
    if (action === "clear_logs") {
      g.instar_grow_growLog = [];
      return NextResponse.json({ success: true, message: "Growth logs cleared." });
    }

    // ── Update settings ─────────────────────────────────────────────────────
    if (action === "update_settings") {
      const newSettings = {
        targetHashtags: body.targetHashtags ?? DEFAULT_SETTINGS.targetHashtags,
        targetProfiles: body.targetProfiles ?? DEFAULT_SETTINGS.targetProfiles,
        targetKeywords: body.targetKeywords ?? DEFAULT_SETTINGS.targetKeywords,
        dailyFollowLimit: Math.min(
          20,
          Number(body.dailyFollowLimit ?? DEFAULT_SETTINGS.dailyFollowLimit)
        ),
        dailyLikeLimit: Math.min(
          60,
          Number(body.dailyLikeLimit ?? DEFAULT_SETTINGS.dailyLikeLimit)
        ),
        dailyCommentLimit: Math.min(
          10,
          Number(body.dailyCommentLimit ?? DEFAULT_SETTINGS.dailyCommentLimit)
        ),
        commentPrompt:
          body.commentPrompt ?? DEFAULT_SETTINGS.commentPrompt,
        enableLike: Boolean(body.enableLike ?? DEFAULT_SETTINGS.enableLike),
        enableFollow: Boolean(
          body.enableFollow ?? DEFAULT_SETTINGS.enableFollow
        ),
        enableComment: Boolean(
          body.enableComment ?? DEFAULT_SETTINGS.enableComment
        ),
      };

      const db = await getDatabase();
      await db.collection("instar_settings").updateOne(
        { type: "growth_settings" },
        {
          $set: {
            type: "growth_settings",
            ...newSettings,
            lastUpdated: new Date().toISOString(),
          },
        },
        { upsert: true }
      );

      // Flush cached settings + reset round-robin index
      g.instar_grow_settings = newSettings;
      g.instar_grow_targetIndex = 0;
      // Reset action mode so new settings start fresh from comment
      g.instar_grow_actionMode = 0;
      addGrowLog("Growth settings updated. Action mode reset to Comment → Follow → Like.", "info");
      return NextResponse.json({ success: true, message: "Settings saved." });
    }

    // ── Start cron ──────────────────────────────────────────────────────────
    if (action === "start") {
      if (g.instar_grow_growRunning) {
        return NextResponse.json({
          success: false,
          message: "Growth cron already running.",
        });
      }

      const db = await getDatabase();
      const sessionDoc = await db
        .collection("instar_config")
        .findOne({ type: "ig_session" });

      if (!sessionDoc?.sessionid) {
        return NextResponse.json(
          { error: "No Instagram session. Save your session first." },
          { status: 400 }
        );
      }

      g.instar_grow_growRunning = true;
      // Always start fresh from comment mode
      g.instar_grow_actionMode = 0;
      addGrowLog(
        "🚀 Growth cron started. Rotation: Comment → Follow → Like every 20 min.",
        "success"
      );

      const { sessionid, ds_user_id, csrftoken, mid } =
        sessionDoc as unknown as {
          sessionid: string;
          ds_user_id: string;
          csrftoken: string;
          mid?: string;
        };

      // Run immediately
      growCronTick(sessionid, ds_user_id, csrftoken, mid);

      // Then every 20 minutes
      g.instar_grow_growInterval = setInterval(
        () => growCronTick(sessionid, ds_user_id, csrftoken, mid),
        20 * 60 * 1000
      );

      return NextResponse.json({ success: true, message: "Growth cron started." });
    }

    // ── Stop cron ───────────────────────────────────────────────────────────
    if (action === "stop") {
      if (g.instar_grow_growInterval) clearInterval(g.instar_grow_growInterval);
      g.instar_grow_growInterval = null;
      g.instar_grow_growRunning = false;

      if (g.instarGrowBrowser) {
        addGrowLog("Closing browser to stop Growth task...", "warning");
        try {
          await g.instarGrowBrowser.close();
        } catch {}
        g.instarGrowBrowser = undefined;
      }

      addGrowLog("⛔ Growth cron stopped.", "warning");
      return NextResponse.json({ success: true, message: "Growth cron stopped." });
    }

    return NextResponse.json({ error: "Invalid action." }, { status: 400 });
  } catch (err) {
    console.error("[instar/grow/cron] POST error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
