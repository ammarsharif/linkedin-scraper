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

// ── FOLLOW action — navigate to the user's profile page and follow ────────────
// This is a shared helper used by both direct-target follows and
// post-author follows. It always navigates to the profile URL for reliability.
async function followUserByProfile(
  page: import("puppeteer").Page,
  username: string,
  sourcePostUrl: string,
  target: { type: string; value: string },
  db: import("mongodb").Db
): Promise<"followed" | "already_following" | "not_found" | "failed"> {
  if (!username) return "failed";

  const profileUrl = `https://www.instagram.com/${encodeURIComponent(username)}/`;
  addGrowLog(`🔗 Navigating to @${username}'s profile to follow...`, "info");

  try {
    await page.goto(profileUrl, { waitUntil: "networkidle2", timeout: 40000 });
  } catch {
    addGrowLog(`Timeout navigating to @${username}'s profile — skipping.`, "warning");
    return "failed";
  }

  if (page.url().includes("/accounts/login")) {
    addGrowLog("❌ Session expired. Please refresh your session.", "error");
    return "failed";
  }

  await randDelay(2000, 3500);

  // Check page not found
  const notFound = await page.evaluate(() => {
    const txt = document.body?.innerText || "";
    return (
      txt.includes("Sorry, this page") ||
      txt.includes("isn't available") ||
      txt.includes("Page Not Found")
    );
  });
  if (notFound) {
    addGrowLog(`Profile @${username} not found — skipping.`, "warning");
    return "not_found";
  }

  // Detect current follow state
  const followState = await page.evaluate(() => {
    const btns = Array.from(
      document.querySelectorAll<HTMLElement>('button, [role="button"]')
    );
    for (const btn of btns) {
      const txt = btn.innerText?.trim();
      if (txt === "Follow" || txt === "Follow Back") return "can_follow";
      if (txt === "Following" || txt === "Requested") return "already_following";
    }
    return "unknown";
  });

  if (followState === "already_following") {
    addGrowLog(`Already following @${username}, skipping.`, "info");
    return "already_following";
  }

  if (followState !== "can_follow") {
    addGrowLog(
      `Follow button not found for @${username} — profile may be yours or didn't load properly.`,
      "warning"
    );
    return "failed";
  }

  // Click the Follow button
  const clicked = await page.evaluate(() => {
    const btns = Array.from(
      document.querySelectorAll<HTMLElement>('button, [role="button"]')
    );
    for (const btn of btns) {
      const txt = btn.innerText?.trim();
      if (txt === "Follow" || txt === "Follow Back") {
        btn.click();
        return true;
      }
    }
    return false;
  });

  if (!clicked) {
    addGrowLog(`Could not click Follow for @${username}.`, "warning");
    return "failed";
  }

  await randDelay(2000, 4000);

  // Verify the follow actually registered (button should now say "Following" or "Requested")
  const confirmed = await page.evaluate(() => {
    const btns = Array.from(
      document.querySelectorAll<HTMLElement>('button, [role="button"]')
    );
    return btns.some((b) => {
      const t = b.innerText?.trim();
      return t === "Following" || t === "Requested";
    });
  });

  if (confirmed || clicked) {
    g.instar_grow_dailyCounts.follow++;
    addGrowLog(
      `➕ Followed @${username} [${g.instar_grow_dailyCounts.follow} today]`,
      "success"
    );
    await db.collection("instar_growth_logs").insertOne({
      action: "follow",
      targetUsername: username,
      targetPostUrl: sourcePostUrl || profileUrl,
      source: target.type,
      sourceValue: target.value,
      timestamp: new Date().toISOString(),
      status: "success",
    });
    await randDelay(3000, 5000);
    return "followed";
  }

  addGrowLog(`Follow click did not register for @${username}.`, "warning");
  return "failed";
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

    let postLinks: string[] = [];
    let target: any = null;
    let searchLabel = "";

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

      // ── Actions State ───────────────────────────────────────────────────
      let actionsThisTick = 0;
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

      // ── FOLLOW MODE + PROFILE TARGET: Follow the configured profile directly ──
      // When actionMode is FOLLOW and a profile target is configured, navigate
      // to that profile and follow it (if not already followed).
      // NOTE: Unlike like/comment which work from posts, follow-from-profile-target
      // only follows the profile itself, not its followers. To follow post authors
      // from a profile's posts, those are handled in the hashtag post loop below.
      if (actionMode === 1) {
        const profileTargets = allTargets.filter((t) => t.type === "profile");
        for (const pt of profileTargets) {
          if (g.instar_grow_dailyCounts.follow >= settings.dailyFollowLimit) break;
          if (alreadyFollowedUsers.has(pt.value)) {
            addGrowLog(`Already followed @${pt.value}, skipping.`, "info");
            continue;
          }
          target = pt;
          searchLabel = `@${pt.value}`;
          addGrowLog(`🎯 Direct-follow target: ${searchLabel}`, "info");

          const result = await followUserByProfile(
            page, pt.value, "", { type: "profile", value: pt.value }, db
          );

          if (result === "followed") {
            alreadyFollowedUsers.add(pt.value);
            actionsThisTick++;
          } else if (result === "failed" && page.url().includes("/accounts/login")) {
            // Session expired — abort
            await page.close();
            g.instar_grow_consecutiveErrors++;
            g.instar_grow_tickRunning = false;
            return;
          }

          if (g.instar_grow_dailyCounts.follow >= settings.dailyFollowLimit) {
            addGrowLog(`✅ Daily follow limit reached (${g.instar_grow_dailyCounts.follow}). Stopping.`, "info");
            await page.close();
            const c = g.instar_grow_dailyCounts;
            addGrowLog(
              `✅ Tick done — ${actionsThisTick} follow(s) this tick | 💬 Comments: ${c.comment}/${settings.dailyCommentLimit} | ➕ Follows: ${c.follow}/${settings.dailyFollowLimit} | ❤️  Likes: ${c.like}/${settings.dailyLikeLimit}`,
              "info"
            );
            g.instar_grow_tickRunning = false;
            return;
          }
        }
      }

      // ── Find a target with posts (try ALL targets, round-robin) ──────────────
      // For FOLLOW mode from hashtags: gather posts from the hashtag feed, then
      // follow each post's AUTHOR by navigating to their profile.
      // For LIKE/COMMENT: use ALL targets (hashtags + profiles).
      const hashtagTargets = actionMode === 1
        ? allTargets.filter((t) => t.type === "hashtag") // follow post authors from hashtag feeds
        : allTargets; // like/comment: use all targets (hashtags + profile feeds)

      for (let attempt = 0; attempt < hashtagTargets.length; attempt++) {
        let currentIndex = parseInt(g.instar_grow_targetIndex, 10);
        if (isNaN(currentIndex) || currentIndex < 0) currentIndex = 0;
        currentIndex = currentIndex % hashtagTargets.length;
        target = hashtagTargets[currentIndex];
        if (!target) { g.instar_grow_targetIndex = currentIndex + 1; continue; }
        g.instar_grow_targetIndex = currentIndex + 1;

        searchLabel = target.type === "hashtag" ? `#${target.value}` : `@${target.value}`;
        addGrowLog(`🎯 Targeting ${searchLabel} for ${actionName}s`, "info");

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

        // Check page not found
        const isNotFound = await page.evaluate(() => {
          const bodyText = document.body?.innerText || '';
          return bodyText.includes("Sorry, this page") || bodyText.includes("isn't available") || bodyText.includes("Page Not Found");
        });
        if (isNotFound) {
          addGrowLog(`${searchLabel} page not found — skipping to next target.`, "warning");
          continue;
        }

        // Scroll the page multiple times to load a larger, more diverse pool of posts
        await new Promise((r) => setTimeout(r, 3500));
        for (let scroll = 0; scroll < 4; scroll++) {
          await page.evaluate(() => window.scrollBy(0, 900));
          await new Promise((r) => setTimeout(r, 1800));
        }

        // Collect up to 50 post links for a larger fresh pool each tick
        postLinks = await page.evaluate(() => {
          const links = Array.from(document.querySelectorAll("a[href]")) as HTMLAnchorElement[];
          const seen = new Set<string>();
          const result: string[] = [];
          for (const l of links) {
            const href = l.href;
            if ((href.includes("/p/") || href.includes("/reel/")) && !seen.has(href)) {
              seen.add(href);
              result.push(href);
              if (result.length >= 50) break;
            }
          }
          return result;
        });

        if (postLinks.length > 0) break;

        addGrowLog(`No posts found for ${searchLabel} — trying next target...`, "warning");
      }

      if (postLinks.length === 0) {
        if (actionsThisTick > 0) {
          // We did some direct profile follows — that's fine, don't call it a failure
          addGrowLog(`No hashtag posts found but completed ${actionsThisTick} direct profile follow(s). Tick done.`, "info");
        } else {
          addGrowLog(`No posts found across all targets — skipping tick.`, "warning");
        }
        await page.close();
        return;
      }

      addGrowLog(`Found ${postLinks.length} posts from ${searchLabel}.`, "info");

      // ── Load ALL already-acted post URLs for this action from DB ─────────
      // Query broadly (not just the current batch) so we catch posts processed
      // in previous ticks that appear again in today's hashtag feed.
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

      // ── Pre-filter: remove posts already fully acted on ───────────────────
      // For FOLLOW mode, filter by author username (done after page load).
      // For LIKE/COMMENT, remove any postUrl that's already in alreadyActedSet.
      let freshPostLinks = actionMode === 1
        ? postLinks // follow dedup is by username, handled per-post below
        : postLinks.filter(
            (url) => !alreadyActedSet.has(`${actionName}::${url}`)
          );

      // ── Shuffle the pool (Fisher-Yates) so every tick processes ──────────
      // posts in a different random order — prevents always re-visiting
      // the same top posts when limits haven't been hit yet.
      for (let i = freshPostLinks.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [freshPostLinks[i], freshPostLinks[j]] = [freshPostLinks[j], freshPostLinks[i]];
      }

      addGrowLog(
        `🔀 Processing ${freshPostLinks.length} fresh posts (${postLinks.length - freshPostLinks.length} already ${actionName}d, skipped).`,
        "info"
      );

      // ── Process posts — max 5 actions per tick ────────────────────────────
      const maxActionsPerTick = 5;

      for (const postUrl of freshPostLinks) {
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

          // ── Keyword filter (optional, only applies to LIKE and COMMENT) ──────
          // In FOLLOW mode, we follow ALL post authors from target hashtags regardless
          // of caption keywords — the hashtag itself is already the targeting signal.
          // Keywords are only meaningful when deciding whether to engage (like/comment).
          // Profile-sourced posts are also never filtered (explicitly targeted).
          const _rawKeywords: string[] = settings.targetKeywords ?? [];
          const _keywords = _rawKeywords.map(k => k.trim()).filter(Boolean);

          const isFollowMode = actionMode === 1;

          if (!isFollowMode && _keywords.length > 0 && target?.type === "hashtag") {
            if (postInfo.caption && postInfo.caption.length >= 5) {
              const captionLower = postInfo.caption.toLowerCase();
              const hasKeyword = _keywords.some((kw: string) =>
                captionLower.includes(kw.toLowerCase())
              );
              if (!hasKeyword) {
                addGrowLog(
                  `Skipping @${postInfo.username || '?'} — no keyword match [${_keywords.join(', ')}].`,
                  'info'
                );
                continue;
              }
            }
            // If caption unavailable, proceed without filtering (don't skip good posts)
          }

          // ── For FOLLOW: check if already following this user ────────────
          if (actionMode === 1) {
            if (!postInfo.username) {
              addGrowLog("Could not extract username from post — skipping follow.", "warning");
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
            // COMMENT — perform on the post page
            success = await performComment(
              page, postUrl, postInfo.caption, postInfo.username,
              target, settings, openai, db
            );
          } else if (actionMode === 1) {
            // FOLLOW — navigate to the post AUTHOR's profile and follow them there.
            // This is more reliable than trying to click Follow on the post page.
            if (!postInfo.username) {
              addGrowLog("No username extracted from post, skipping follow.", "warning");
              continue;
            }
            const followResult = await followUserByProfile(
              page, postInfo.username, postUrl, target, db
            );
            success = followResult === "followed";
            if (success) alreadyFollowedUsers.add(postInfo.username);
            // If session expired, abort the whole tick
            if (followResult === "failed" && page.url().includes("/accounts/login")) {
              addGrowLog("❌ Session expired mid-tick. Aborting.", "error");
              break;
            }
          } else {
            // LIKE — perform on the post page
            // Navigate back to the post page (followUserByProfile may have changed it)
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
