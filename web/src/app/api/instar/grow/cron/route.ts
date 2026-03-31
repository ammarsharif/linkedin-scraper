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

// ── LIKE action ───────────────────────────────────────────────
// Instagram has TWO types of like buttons on a post page:
//   1. POST like button -- in the action bar (div/section after the media)
//   2. COMMENT like buttons -- inside each comment row (li element)
// Key rule: comment like buttons are always inside a <li>. Post like is NOT.
// Instagram DOM changes frequently so we use layered strategies + debug logging.
async function performLike(
  page: import("puppeteer").Page,
  postUrl: string,
  username: string,
  searchLabel: string,
  target: { type: string; value: string },
  db: import("mongodb").Db
): Promise<boolean> {

  // Step 1: Scroll to TOP so the post action bar is visible
  await page.evaluate(() => { window.scrollTo({ top: 0, behavior: "instant" }); });
  await randDelay(1500, 2500);

  // Helper: check if already liked (Unlike SVG visible outside <li>)
  const checkAlreadyLiked = () => page.evaluate(() =>
    Array.from(document.querySelectorAll("svg[aria-label]")).some(
      (svg) => !svg.closest("li") &&
        (svg.getAttribute("aria-label") || "").toLowerCase().includes("unlike")
    )
  );

  if (await checkAlreadyLiked()) {
    addGrowLog(`Post by @${username} already liked on IG.`, "info");
    await db.collection("instar_growth_logs").insertOne({
      action: "like", targetUsername: username, targetPostUrl: postUrl,
      source: target.type, sourceValue: target.value,
      timestamp: new Date().toISOString(), status: "success", note: "already_liked",
    });
    g.instar_grow_dailyCounts.like++;
    return true;
  }

  // Debug: log all SVG aria-labels visible outside <li> so we can see what IG renders
  const svgDebug = await page.evaluate(() =>
    Array.from(document.querySelectorAll("svg[aria-label]"))
      .filter((el) => !(el as SVGElement).closest("li"))
      .map((el) => (el as SVGElement).getAttribute("aria-label") || "")
      .slice(0, 20)
  );
  addGrowLog(`[like-debug] SVGs outside li: ${JSON.stringify(svgDebug)}`, "info");

  let liked = false;

  // Strategy 1: aria-label matching with many locale/layout variants
  // Search article -> main -> body to handle different IG page structures
  const likeAriaLabels = ["Like", "like", "Like post", "Like this post", "J'aime", "Me gusta", "Curtir", "Gefallt mir"];
  for (const label of likeAriaLabels) {
    if (liked) break;
    for (const rootSel of ["article", "main", "body"]) {
      if (liked) break;
      try {
        const btnHandle = await page.evaluateHandle((rootSel: string, ariaLabel: string) => {
          const root = document.querySelector(rootSel);
          if (!root) return null;
          for (const svg of Array.from(root.querySelectorAll("svg[aria-label]"))) {
            if ((svg as SVGElement).closest("li")) continue;
            const lbl = ((svg as SVGElement).getAttribute("aria-label") || "").toLowerCase().trim();
            if (lbl === ariaLabel.toLowerCase().trim()) {
              let node: Element | null = svg as Element;
              while (node) {
                if (node.getAttribute("role") === "button" || node.tagName === "BUTTON") return node;
                node = node.parentElement;
              }
              return (svg as SVGElement).parentElement;
            }
          }
          return null;
        }, rootSel, label);
        const jsEl = btnHandle.asElement() as any;
        if (jsEl) {
          await jsEl.click();
          await randDelay(1200, 2000);
          // Optimistically mark as liked — "Unlike" may take a moment to appear
          liked = true;
          addGrowLog(`S1 (label="${label}" root=${rootSel}) clicked.`, "info");
          break;
        }
      } catch { /* try next */ }
    }
  }

  // Strategy 2: SVG <title> element contains text "like"
  if (!liked) {
    try {
      const btnHandle = await page.evaluateHandle(() => {
        for (const svg of Array.from(document.querySelectorAll("svg"))) {
          if ((svg as SVGElement).closest("li")) continue;
          const title = svg.querySelector("title");
          if (title && (title.textContent || "").toLowerCase().trim() === "like") {
            let node: Element | null = svg as Element;
            while (node) {
              if (node.getAttribute("role") === "button" || node.tagName === "BUTTON") return node;
              node = node.parentElement;
            }
            return (svg as SVGElement).parentElement;
          }
        }
        return null;
      });
      const jsEl = btnHandle.asElement() as any;
      if (jsEl) {
        await jsEl.click();
        await randDelay(1200, 1800);
        liked = true;
        addGrowLog(`S2 (SVG title="like") clicked.`, "info");
      }
    } catch { }
  }

  // Strategy 3: Puppeteer $$ with direct SVG aria-label attribute selectors
  if (!liked) {
    for (const sel of ['svg[aria-label="Like"]', 'svg[aria-label="like"]', 'svg[aria-label="Like post"]']) {
      if (liked) break;
      try {
        for (const h of await page.$$(sel)) {
          const inLi = await page.evaluate((el) => !!el.closest("li"), h);
          if (inLi) continue;
          const btnHandle = await page.evaluateHandle((el) => {
            let node: Element | null = el;
            while (node) {
              if (node.getAttribute("role") === "button" || node.tagName === "BUTTON") return node;
              node = node.parentElement;
            }
            return el.parentElement;
          }, h);
          const btnEl = btnHandle.asElement() as any;
          if (btnEl) {
            await btnEl.click();
            await randDelay(1000, 1800);
            liked = true;
            addGrowLog(`S3 (selector="${sel}") clicked.`, "info");
            break;
          }
        }
      } catch { }
    }
  }

  // Strategy 4: Post action bar container (section[role="group"] or div[role="group"])
  // Instagram renders the Like/Comment/Share bar as a grouped section
  if (!liked) {
    try {
      const btnHandle = await page.evaluateHandle(() => {
        const containers = [
          ...Array.from(document.querySelectorAll('section[role="group"]')),
          ...Array.from(document.querySelectorAll('div[role="group"]')),
        ];
        for (const container of containers) {
          if ((container as HTMLElement).closest("li")) continue;
          const btns = Array.from(container.querySelectorAll<HTMLElement>('[role="button"], button'));
          // First button in action bar = Like button
          if (btns.length > 0) return btns[0];
        }
        return null;
      });
      const jsEl = btnHandle.asElement() as any;
      if (jsEl) {
        await jsEl.click();
        await randDelay(1000, 1800);
        if (await checkAlreadyLiked()) {
          liked = true;
          addGrowLog(`S4 (action group first button) liked confirmed.`, "info");
        }
      }
    } catch { }
  }

  // Fallback A: Double-tap the post image (mimics mobile like gesture)
  if (!liked) {
    try {
      const mediaEl = await page.$([
        "article img[style]", "article video", "article img",
        "main img[style]", "main video", "main img"
      ].join(", "));
      if (mediaEl) {
        const box = await mediaEl.boundingBox();
        if (box && box.width > 100) {
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { clickCount: 2 });
          await randDelay(1500, 2200);
          liked = true;
          addGrowLog(`Fallback A (double-tap image) used on @${username}'s post.`, "info");
        }
      }
    } catch { }
  }

  // Fallback B: "L" keyboard shortcut -- focus the post container first
  if (!liked) {
    try {
      await page.evaluate(() => {
        const el = document.querySelector<HTMLElement>("article, main section, main");
        if (el) el.focus?.();
      });
      await page.keyboard.press("l");
      await randDelay(1200, 1800);
      if (await checkAlreadyLiked()) {
        liked = true;
        addGrowLog(`Fallback B ("L" key) liked confirmed.`, "info");
      }
    } catch { }
  }

  if (liked) {
    g.instar_grow_dailyCounts.like++;
    addGrowLog(`❤️  Liked @${username}'s post. [${g.instar_grow_dailyCounts.like} today]`, "success");
    await db.collection("instar_growth_logs").insertOne({
      action: "like", targetUsername: username, targetPostUrl: postUrl,
      source: target.type, sourceValue: target.value,
      timestamp: new Date().toISOString(), status: "success",
    });
    return true;
  }

  addGrowLog(`Failed to like @${username}'s post (all strategies failed).`, "warning");
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

        const targetUrl =
          currentTarget.type === "hashtag"
            ? `https://www.instagram.com/explore/tags/${encodeURIComponent(currentTarget.value)}/`
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
      const maxActionsPerTick = 8; // Increased slightly for more impact

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
            const metaCaption = document.querySelector('meta[property="og:title"]');
            if (metaCaption) {
              const content = metaCaption.getAttribute('content') || '';
              const match = content.match(/on Instagram: "([\s\S]*?)"$/);
              if (match && match[1]) caption = match[1];
            }
            if (!caption || caption.length < 5) {
              const captionSelectors = ['h1[dir="auto"]', 'article div > span > span[dir]', 'article li span[dir]', '[data-testid="post-comment-root"] span', 'article span[dir="auto"]'];
              for (const sel of captionSelectors) {
                const els = Array.from(document.querySelectorAll(sel)) as HTMLElement[];
                for (const el of els) {
                  const txt = el.innerText?.trim() || '';
                  if (txt.length >= 10 && !txt.includes(" likes") && !txt.includes(" views")) { caption = txt; break; }
                }
                if (caption && caption.length >= 5) break;
              }
            }
            let username = '';
            const authorLinks = Array.from(document.querySelectorAll('main header a[href], article header a[href], [data-testid="post-comment-root"] a[href], article a[href], main a[href]')) as HTMLAnchorElement[];
            for (const a of authorLinks) {
              if (a.closest('nav') || a.closest('[role="navigation"]')) continue;
              try {
                const url = new URL(a.href, window.location.origin);
                const paths = url.pathname.split('/').filter(Boolean);
                if (paths.length === 1) {
                  const candidate = paths[0];
                  if (!['explore', 'accounts', 'stories', 'reels', 'direct', 'p', 'reel', 'tv'].includes(candidate)) { username = candidate; break; }
                }
              } catch {}
            }
            return { caption: caption.slice(0, 300), username };
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

          if (isCommentMode && _keywords.length > 0 && target?.type === "hashtag") {
            if (postInfo.caption && postInfo.caption.length >= 5) {
              const captionLower = postInfo.caption.toLowerCase();
              const hasKeyword = _keywords.some((kw: string) =>
                captionLower.includes(kw.toLowerCase())
              );
              if (!hasKeyword) {
                addGrowLog(
                  `Skipping @${postInfo.username || '?'} for comment — no keyword match [${_keywords.join(', ')}].`,
                  'info'
                );
                continue;
              }
            }
            // If caption unavailable, comment anyway — don't skip good posts
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
