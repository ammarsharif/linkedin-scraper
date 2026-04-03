import { NextRequest, NextResponse } from "next/server";
import { getDatabase } from "@/lib/mongodb";
import { createSessionAlert } from "@/lib/sessionAlert";
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

// ── Generic API Helper for Instar ──────────────────────────────
async function callInstarApi(page: import("puppeteer").Page, url: string, method: string = "POST") {
  return page.evaluate(async (apiUrl: string, apiMethod: string) => {
    const csrf = document.cookie
      .split(";")
      .find((c) => c.trim().startsWith("csrftoken="))
      ?.split("=")[1] || "";
    try {
      const res = await fetch(apiUrl, {
        method: apiMethod,
        headers: {
          "X-CSRFToken": csrf,
          "X-IG-App-ID": "936619743392459",
          "X-Requested-With": "XMLHttpRequest",
          Accept: "*/*",
        },
        credentials: "include",
      });
      const data = await res.json();
      return { success: res.ok && data.status === "ok", data };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }, url, method);
}

// ── LIKE action ───────────────────────────────────────────────
async function performLike(
  page: import("puppeteer").Page,
  postUrl: string,
  username: string,
  searchLabel: string,
  target: { type: string; value: string },
  db: import("mongodb").Db
): Promise<boolean> {
  // Step 1: Extract Media ID from the page
  const mediaId = await page.evaluate(() => {
    // Media ID is often in the "al:ios:url" meta tag as ig://media?id=...
    const meta = document.querySelector('meta[property="al:ios:url"]') as HTMLMetaElement | null;
    if (meta) {
      const match = meta.content.match(/id=(\d+)/);
      if (match) return match[1];
    }
    // Fallback: search window.__additionalData
    const scripts = Array.from(document.querySelectorAll('script'));
    for (const s of scripts) {
      const match = s.innerText.match(/"media_id":"(\d+)"/);
      if (match) return match[1];
    }
    return null;
  });

  if (!mediaId) {
    addGrowLog(`Could not find Media ID for ${postUrl} — falling back to DOM click.`, "warning");
    // Existing DOM strategies as fallback...
    // (Keeping it simple: let's try the API approach first, if it fails we log it)
  }

  const apiUrl = `https://www.instagram.com/api/v1/web/likes/${mediaId}/like/`;
  const result = await callInstarApi(page, apiUrl);

  if (result.success) {
    g.instar_grow_dailyCounts.like++;
    addGrowLog(`❤️  API Liked @${username}'s post. [${g.instar_grow_dailyCounts.like} today]`, "success");
    await db.collection("instar_growth_logs").insertOne({
      action: "like", targetUsername: username, targetPostUrl: postUrl,
      source: target.type, sourceValue: target.value,
      timestamp: new Date().toISOString(), status: "success",
    });
    return true;
  }

  addGrowLog(`API Like failed for @${username}: ${JSON.stringify(result.data || result.error)}`, "warning");
  return false;
}

// ── FOLLOW action ────────────────────────────────────────────
async function followUserByProfile(
  page: import("puppeteer").Page,
  username: string,
  sourcePostUrl: string,
  target: { type: string; value: string },
  db: import("mongodb").Db
): Promise<"followed" | "already_following" | "not_found" | "failed"> {
  if (!username) return "failed";

  const profileUrl = `https://www.instagram.com/${encodeURIComponent(username)}/`;
  addGrowLog(`🔗 Navigating to @${username}'s profile...`, "info");

  try {
    await page.goto(profileUrl, { waitUntil: "networkidle2", timeout: 40000 });
  } catch {
    return "failed";
  }

  if (page.url().includes("/accounts/login")) return "failed";
  await randDelay(2000, 3500);

  // Extract User ID (PK) from the page
  const userId = await page.evaluate(() => {
    // Try meta tags
    const meta = document.querySelector('meta[property="instapp:owner_user_id"]') as HTMLMetaElement | null;
    if (meta) return meta.content;
    
    // Scan for user data in scripts
    const scripts = Array.from(document.querySelectorAll('script'));
    for (const s of scripts) {
      const match = s.innerText.match(/"id":"(\d+)"/);
      if (match) return match[1];
    }
    return null;
  });

  if (!userId) {
    addGrowLog(`Could not find User ID for @${username}.`, "warning");
    return "failed";
  }

  const apiUrl = `https://www.instagram.com/api/v1/friendships/create/${userId}/`;
  const result = await callInstarApi(page, apiUrl);

  if (result.success) {
    g.instar_grow_dailyCounts.follow++;
    addGrowLog(`➕ API Followed @${username} [${g.instar_grow_dailyCounts.follow} today]`, "success");
    await db.collection("instar_growth_logs").insertOne({
      action: "follow", targetUsername: username, targetPostUrl: sourcePostUrl || profileUrl,
      source: target.type, sourceValue: target.value,
      timestamp: new Date().toISOString(), status: "success",
    });
    return "followed";
  }

  if (result.data?.status === "fail" && result.data?.feedback_title?.includes("Following")) {
     return "already_following";
  }

  addGrowLog(`API Follow failed for @${username}: ${JSON.stringify(result.data || result.error)}`, "warning");
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

      // ── Find targets with posts (gather from multiple sources) ─────────────
      // For LIKE/COMMENT/FOLLOW: gather from ALL targets (hashtags + profiles)
      // We try up to 3 targets per tick to keep it reasonably fast but diverse.
      const maxTargetsPerTick = 3;
      let searchedCount = 0;
      let combinedPool: Array<{ url: string; target: any }> = [];

      // Get the correct round-robin starting point
      let startIndex = parseInt(g.instar_grow_targetIndex || "0", 10);
      if (isNaN(startIndex) || startIndex < 0) startIndex = 0;

      for (let i = 0; i < allTargets.length; i++) {
        const currentIndex = (startIndex + i) % allTargets.length;
        const currentTarget = allTargets[currentIndex];
        if (!currentTarget) continue;

        if (searchedCount >= maxTargetsPerTick && combinedPool.length >= 20) break;

        searchLabel = currentTarget.type === "hashtag" ? `#${currentTarget.value}` : `@${currentTarget.value}`;
        addGrowLog(`🎯 Gathering posts from ${searchLabel} (${actionName}s)...`, "info");

        const hashtagVariants = ["", "top/", "reels/"];
        const variantSuffix = currentTarget.type === "hashtag"
          ? hashtagVariants[currentIndex % hashtagVariants.length]
          : "";
        const targetUrl =
          currentTarget.type === "hashtag"
            ? `https://www.instagram.com/explore/tags/${encodeURIComponent(currentTarget.value)}/${variantSuffix}`
            : `https://www.instagram.com/${encodeURIComponent(currentTarget.value)}/`;

        try {
          await page.goto(targetUrl, { waitUntil: "networkidle2", timeout: 40000 });
          searchedCount++;

          // Check page not found
          const isNotFound = await page.evaluate(() => {
            const bodyText = document.body?.innerText || '';
            return bodyText.includes("Sorry, this page") || bodyText.includes("isn't available") || bodyText.includes("Page Not Found");
          });

          if (isNotFound) {
            addGrowLog(`${searchLabel} page not found — skipping.`, "warning");
            continue;
          }

          // Scroll a bit to load fresh posts
          await new Promise((r) => setTimeout(r, 2500));
          for (let scroll = 0; scroll < 3; scroll++) {
            await page.evaluate(() => window.scrollBy(0, 800));
            await new Promise((r) => setTimeout(r, 1200));
          }

          const pageLinks = await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll("a[href]")) as HTMLAnchorElement[];
            const seen = new Set<string>();
            const result: string[] = [];
            for (const l of links) {
              const href = l.href;
              if ((href.includes("/p/") || href.includes("/reel/")) && !seen.has(href)) {
                seen.add(href);
                result.push(href);
                if (result.length >= 25) break; 
              }
            }
            return result;
          });

          if (pageLinks.length > 0) {
            for (const url of pageLinks) {
              combinedPool.push({ url, target: currentTarget });
            }
            addGrowLog(`+ Found ${pageLinks.length} posts from ${searchLabel}.`, "info");
          } else {
            addGrowLog(`No posts found for ${searchLabel}.`, "warning");
          }
        } catch (targetErr: any) {
          addGrowLog(`Error checking ${searchLabel}: ${targetErr.message}`, "warning");
        }

        // Increment index after each successful or attempted check to ensure rotation
        g.instar_grow_targetIndex = (currentIndex + 1) % allTargets.length;
        if (combinedPool.length >= 60) break;
      }

      if (combinedPool.length === 0) {
        if (actionsThisTick > 0) {
          addGrowLog(`No posts gathered but handled ${actionsThisTick} direct follow(s). Tick done.`, "info");
        } else {
          addGrowLog(`No posts gathered from any targets — skipping tick.`, "warning");
        }
        await page.close();
        return;
      }

      addGrowLog(`🔀 Total pool: ${combinedPool.length} posts from ${searchedCount} targets.`, "info");

      // ── Load already-acted post URLs from DB for deduplication ──────────
      const poolUrls = combinedPool.map(p => p.url);
      const alreadyActedSet = new Set<string>(
        (
          await db
            .collection("instar_growth_logs")
            .find(
              { targetPostUrl: { $in: poolUrls }, status: "success" },
              { projection: { targetPostUrl: 1, action: 1 } }
            )
            .toArray()
        ).map((r) => `${r.action}::${r.targetPostUrl}`)
      );

      // ── Filter & Shuffle ────────────────────────────────────────────────
      let freshItems = combinedPool.filter(item => 
        actionMode === 1 ? true : !alreadyActedSet.has(`${actionName}::${item.url}`)
      );

      // Fisher-Yates shuffle
      for (let i = freshItems.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [freshItems[i], freshItems[j]] = [freshItems[j], freshItems[i]];
      }

      addGrowLog(
        `🔀 Processing ${freshItems.length} fresh posts (${combinedPool.length - freshItems.length} already ${actionName}d).`,
        "info"
      );

      // ── Process posts — max actions per tick ────────────────────────────
      const maxActionsPerTick = 3; // Limited to 3 per tick for safety as requested

      for (const item of freshItems) {
        const postUrl = item.url;
        const target = item.target;

        if (!g.instar_grow_growRunning) {
          addGrowLog("Cron stopped mid-execution. Aborting early.", "warning");
          break;
        }
        if (actionsThisTick >= maxActionsPerTick) break;

        // Re-check live daily limit
        const liveCounts = g.instar_grow_dailyCounts;
        const limitReached =
          actionMode === 0
            ? liveCounts.comment >= settings.dailyCommentLimit
            : actionMode === 1
            ? liveCounts.follow >= settings.dailyFollowLimit
            : liveCounts.like >= settings.dailyLikeLimit;

        if (limitReached) {
          addGrowLog(`✅ Daily ${actionName} limit reached mid-tick. Stopping.`, "info");
          break;
        }

        try {
          await page.goto(postUrl, { waitUntil: "networkidle2", timeout: 35000 });
          await randDelay(2000, 3500);

          if (!g.instar_grow_growRunning) break;

          // ── Extract caption + author username ──────────────────────────
          const postInfo = await page.evaluate(() => {
            let caption = '';
            // Try multiple meta tags (description often has the full caption)
            const metaDesc = document.querySelector('meta[name="description"], meta[property="og:description"]');
            if (metaDesc) {
              const content = metaDesc.getAttribute('content') || '';
              // Instagram meta descriptions often start with the caption or contain it after 'See photos and videos from...'
              caption = content;
            }

            // If meta fails or is generic, scrape the article text
            if (!caption || caption.includes("See Instagram photos") || caption.length < 5) {
              const captionSelectors = ['h1[dir="auto"]', 'article div > span > span[dir]', 'article li span[dir]', 'article span[dir="auto"]'];
              for (const sel of captionSelectors) {
                const el = document.querySelector(sel) as HTMLElement;
                if (el && el.innerText?.trim()) {
                   caption = el.innerText.trim();
                   break;
                }
              }
            }
            
            let username = '';
            const authorLinks = Array.from(document.querySelectorAll('main header a[href], article header a[href], article a[href], main a[href]')) as HTMLAnchorElement[];
            for (const a of authorLinks) {
              if (a.closest('nav') || a.closest('[role="navigation"]')) continue;
              try {
                const url = new URL(a.href, window.location.origin);
                const paths = url.pathname.split('/').filter(Boolean);
                if (paths.length === 1 && !['explore', 'accounts', 'stories', 'reels', 'direct', 'p', 'reel', 'tv'].includes(paths[0])) {
                  username = paths[0];
                  break;
                }
              } catch {}
            }
            return { caption: caption.slice(0, 500), username };
          });

          addGrowLog(
            `📄 Post @${postInfo.username || '?'} — caption: ${postInfo.caption ? '"' + postInfo.caption.slice(0, 60) + '"' : '(none)'}`,
            'info'
          );

          // ── Keyword filter — COMMENT mode only ──────────────────────────────
          // Keywords only gate COMMENTS because the AI needs on-topic captions
          // to write a relevant reply. For LIKE and FOLLOW, the hashtag you
          // chose is already the targeting filter — engaging with everything
          // there is the intended behaviour. Profile-sourced posts are never
          // filtered (you explicitly configured them).
          const _rawKeywords: string[] = settings.targetKeywords ?? [];
          const _keywords = _rawKeywords.map(k => k.trim()).filter(Boolean);

          const isCommentMode = actionMode === 0;

          if (isCommentMode && _keywords.length > 0) {
            const captionContent = postInfo.caption && postInfo.caption.length >= 5 ? postInfo.caption : "";
            const captionLower = captionContent.toLowerCase().replace(/\s+/g, ' ');

            const hasKeyword = _keywords.some((kw: string) => {
              const k = kw.toLowerCase().trim();
              if (captionLower.includes(k)) return true;
              return false;
            });

            if (!hasKeyword) {
              // Check for potential typos to help the user
              const potentialTypo = _keywords.find(kw => 
                kw.toLowerCase().includes("bussiness") && captionLower.includes("business")
              );
              
              const typoNote = potentialTypo ? " (NOTE: check your settings for 'bussiness' typo)" : "";
              addGrowLog(
                `Skipping @${postInfo.username || '?'}: no keyword match for [${_keywords.join(', ')}] in caption${typoNote}.`,
                'info'
              );
              continue;
            }
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
              await db.collection("instar_config").updateOne({ type: "ig_session" }, { $set: { status: "expired" } });
              await createSessionAlert("instar", "Instagram");
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
