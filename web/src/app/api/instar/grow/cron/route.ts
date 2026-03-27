import { NextRequest, NextResponse } from "next/server";
import { getDatabase } from "@/lib/mongodb";
import puppeteer, { Browser } from "puppeteer";
import OpenAI from "openai";

export const maxDuration = 60;

const g = globalThis as any;
if (g.instar_grow_initialized === undefined) {
    g.instar_grow_initialized = true;

    g.instar_grow_growInterval = null;
    g.instar_grow_growRunning = false;
    g.instar_grow_lastGrowRun = null;
    g.instar_grow_growLog = [];
    g.instar_grow_consecutiveErrors = 0;
    g.instar_grow_dailyCounts = { follow: 0, like: 0, comment: 0 };
}



// ── In-memory state ────────────────────────────────────────────────────────

// Daily counters (reset at midnight)

const DEFAULT_SETTINGS = {
  targetHashtags: ["business", "entrepreneur", "marketing"],
  dailyFollowLimit: 40,
  dailyLikeLimit: 120,
  dailyCommentLimit: 20,
  commentPrompt:
    "Write a short, genuine, relevant 1-sentence comment (no emojis, no hashtags) for an Instagram post about the topic provided. Be specific and insightful.",
};

function addGrowLog(message: string, type: "info" | "success" | "error" | "warning" = "info") {
  const entry = { time: new Date().toISOString(), message, type };
  g.instar_grow_growLog.push(entry);
  if (g.instar_grow_growLog.length > 150) g.instar_grow_growLog = g.instar_grow_growLog.slice(-150);
  console.log(`[instar-grow-cron][${type}] ${message}`);
}

async function syncDailyCountersFromDb() {
  const today = new Date().toDateString();
  try {
    const db = await getDatabase();
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    
    const actionsToday = await db.collection("instar_growth_logs").find({
      status: "success",
      timestamp: { $gte: startOfToday.toISOString() }
    }).toArray();
    
    let f = 0, l = 0, c = 0;
    for (const a of actionsToday) {
      if (a.action === "follow") f++;
      if (a.action === "like") l++;
      if (a.action === "comment") c++;
    }
    
    g.instar_grow_dailyCounts = { follow: f, like: l, comment: c };
    // Do not log here to avoid spamming the logs during polling
  } catch {
    // fallback
    g.instar_grow_dailyCounts = { follow: 0, like: 0, comment: 0 };
  }
}

// Use the same browser instance as the DM cron if available, else create one

async function getGrowBrowser(): Promise<Browser> {
  if (!g.instarGrowBrowser || !g.instarGrowBrowser.connected) {
    addGrowLog("Starting growth Puppeteer browser...", "info");
    g.instarGrowBrowser = await puppeteer.launch({
      headless: true,
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

// Random delay between min-max ms (human-like)
function randDelay(min = 1500, max = 4000): Promise<void> {
  return new Promise((r) => setTimeout(r, Math.floor(Math.random() * (max - min)) + min));
}

// ── Growth cron tick ───────────────────────────────────────────────────────
async function growCronTick(
  sessionid: string,
  ds_user_id: string,
  csrftoken: string,
  mid: string | undefined,
  settings: typeof DEFAULT_SETTINGS
) {
  if (!g.instar_grow_growRunning) return;
  g.instar_grow_lastGrowRun = new Date().toISOString();
  await syncDailyCountersFromDb();
  addGrowLog("Growth tick started.", "info");

  const browser = await getGrowBrowser();
  const openai = getOpenAI();
  const db = await getDatabase();

  // Pick a random hashtag to target this tick
  const hashtag =
    settings.targetHashtags[Math.floor(Math.random() * settings.targetHashtags.length)];
  addGrowLog(`Targeting hashtag: #${hashtag}`, "info");

  try {
    const page = await browser.newPage();

    // Stealth
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });

    await page.setCookie(
      { name: "sessionid", value: sessionid, domain: ".instagram.com" },
      { name: "ds_user_id", value: ds_user_id, domain: ".instagram.com" },
      { name: "csrftoken", value: csrftoken, domain: ".instagram.com" },
      ...(mid ? [{ name: "mid", value: mid, domain: ".instagram.com" }] : [])
    );

    // Navigate to hashtag explore page
    await page.goto(`https://www.instagram.com/explore/tags/${encodeURIComponent(hashtag)}/`, {
      waitUntil: "domcontentloaded",
      timeout: 40000,
    });

    if (page.url().includes("/accounts/login")) {
      addGrowLog("Session expired on growth browser.", "error");
      await page.close();
      g.instar_grow_consecutiveErrors++;
      return;
    }

    await new Promise((r) => setTimeout(r, 4000));

    // Collect post links from the hashtag page
    const postLinks = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll("a[href]")) as HTMLAnchorElement[];
      return links
        .map((l) => l.href)
        .filter((href) => href.includes("/p/"))
        .slice(0, 12); // process up to 12 posts per tick
    });

    addGrowLog(`Found ${postLinks.length} posts under #${hashtag}.`, "info");

    let actionsThisTick = 0;
    const maxActionsPerTick = 5; // conservative per tick

    for (const postUrl of postLinks) {
      if (!g.instar_grow_growRunning) {
        addGrowLog("Cron stopped mid-execution. Aborting early.", "warning");
        return;
      }
      if (actionsThisTick >= maxActionsPerTick) break;

      try {
        // Navigate to the post
        await page.goto(postUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
        await randDelay(2000, 3500);
        
        if (!g.instar_grow_growRunning) return;

        // Extract post caption and author
        const postInfo = await page.evaluate(() => {
          const captionEl = document.querySelector("h1, [data-testid='post-comment-root'] span");
          const caption = captionEl ? (captionEl as HTMLElement).innerText?.trim() : "";

          const usernameEl = document.querySelector("header a, [role='link'] > span");
          const username = usernameEl ? (usernameEl as HTMLElement).innerText?.trim() : "";

          return { caption: caption?.slice(0, 300) || "", username };
        });

        // ── LIKE the post ──────────────────────────────────────────────
        if (g.instar_grow_dailyCounts.like < settings.dailyLikeLimit) {
          const liked = await page.evaluate(() => {
            // Find like button (heart SVG that is not yet liked)
            const likeBtn = document.querySelector(
              'svg[aria-label="Like"], svg[aria-label="Unlike"]'
            );
            if (!likeBtn) return false;
            const isAlreadyLiked = likeBtn.getAttribute("aria-label") === "Unlike";
            if (isAlreadyLiked) return false;

            const btn = likeBtn.closest("button");
            if (btn) {
              (btn as HTMLElement).click();
              return true;
            }
            return false;
          });

          if (liked) {
            g.instar_grow_dailyCounts.like++;
            actionsThisTick++;
            addGrowLog(`Liked post by @${postInfo.username} under #${hashtag}`, "success");

            await db.collection("instar_growth_logs").insertOne({
              action: "like",
              targetUsername: postInfo.username,
              targetPostUrl: postUrl,
              hashtag,
              timestamp: new Date().toISOString(),
              status: "success",
            });

            await randDelay(2000, 4000);
          }
        }

        // ── COMMENT on the post ────────────────────────────────────────
        if (g.instar_grow_dailyCounts.comment < settings.dailyCommentLimit && actionsThisTick < maxActionsPerTick) {
          try {
            const completion = await openai.chat.completions.create({
              model: "gpt-4o-mini",
              messages: [
                { role: "system", content: settings.commentPrompt },
                {
                  role: "user",
                  content: `Instagram post about #${hashtag}${postInfo.caption ? `: "${postInfo.caption.slice(0, 150)}"` : ""}. Write a comment.`,
                },
              ],
              temperature: 0.8,
              max_tokens: 60,
            });

            const comment = completion.choices[0]?.message?.content?.trim() || "";
            if (!comment) throw new Error("Empty comment from AI.");

            // Click comment field
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

            if (commentBoxClicked) {
              await randDelay(600, 1200);

              // Type comment
              const commentBox = await page.$(
                'textarea[aria-label*="omment"], form textarea, [placeholder*="omment"]'
              );
              if (commentBox) {
                await commentBox.type(comment, { delay: 40 });
                await randDelay(500, 1000);
                await page.keyboard.press("Enter");
                await randDelay(2000, 3000);

                g.instar_grow_dailyCounts.comment++;
                actionsThisTick++;
                addGrowLog(`Commented on @${postInfo.username}'s post: "${comment.slice(0, 60)}"`, "success");

                await db.collection("instar_growth_logs").insertOne({
                  action: "comment",
                  targetUsername: postInfo.username,
                  targetPostUrl: postUrl,
                  hashtag,
                  content: comment,
                  timestamp: new Date().toISOString(),
                  status: "success",
                });
              }
            }
          } catch (commentErr: any) {
            addGrowLog(`Comment failed: ${commentErr.message}`, "warning");
          }
        }

        // ── FOLLOW the post author ─────────────────────────────────────
        if (g.instar_grow_dailyCounts.follow < settings.dailyFollowLimit && actionsThisTick < maxActionsPerTick) {
          const followed = await page.evaluate(() => {
            // Look for Follow button (not Following)
            const buttons = Array.from(document.querySelectorAll("button"));
            const followBtn = buttons.find(
              (b) =>
                (b as HTMLElement).innerText?.trim() === "Follow" &&
                !(b as HTMLElement).innerText?.includes("Following")
            );
            if (followBtn) {
              (followBtn as HTMLElement).click();
              return true;
            }
            return false;
          });

          if (followed) {
            g.instar_grow_dailyCounts.follow++;
            actionsThisTick++;
            addGrowLog(`Followed @${postInfo.username}`, "success");

            await db.collection("instar_growth_logs").insertOne({
              action: "follow",
              targetUsername: postInfo.username,
              hashtag,
              timestamp: new Date().toISOString(),
              status: "success",
            });

            await randDelay(3000, 6000);
          }
        }

        await randDelay(2000, 4000);
      } catch (postErr: any) {
        addGrowLog(`Error on post ${postUrl}: ${postErr.message}`, "warning");
        await db.collection("instar_growth_logs").insertOne({
          action: "like",
          targetPostUrl: postUrl,
          hashtag,
          timestamp: new Date().toISOString(),
          status: "failed",
          error: postErr.message,
        });
      }
    }

    await page.close();
    addGrowLog(
      `Tick complete. Likes: ${g.instar_grow_dailyCounts.like}/${settings.dailyLikeLimit}, Follows: ${g.instar_grow_dailyCounts.follow}/${settings.dailyFollowLimit}, Comments: ${g.instar_grow_dailyCounts.comment}/${settings.dailyCommentLimit}`,
      "info"
    );
    g.instar_grow_consecutiveErrors = 0;
  } catch (err: any) {
    g.instar_grow_consecutiveErrors++;
    addGrowLog(`Growth tick error: ${err.message}`, "error");

    if (g.instar_grow_consecutiveErrors >= 4) {
      addGrowLog("4 consecutive errors – killing growth browser.", "error");
      try { await g.instarGrowBrowser?.close(); } catch {}
      g.instarGrowBrowser = undefined;
      g.instar_grow_consecutiveErrors = 0;
    }
  }
}

// ── GET: Growth cron status + logs ────────────────────────────────────────
export async function GET() {
  // Always force sync counters when the UI asks

  return NextResponse.json({
    running: g.instar_grow_growRunning,
    lastRun: g.instar_grow_lastGrowRun,
    logs: g.instar_grow_growLog.slice(-50),
    dailyCounts: g.instar_grow_dailyCounts,
    consecutiveErrors: g.instar_grow_consecutiveErrors,
  });
}

// ── POST: Start / Stop / Update settings ──────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action = body.action as string;

    if (action === "clear_logs") {
      g.instar_grow_growLog = [];
      return NextResponse.json({ success: true, message: "Growth logs cleared." });
    }

    if (action === "update_settings") {
      const db = await getDatabase();
      await db.collection("instar_settings").updateOne(
        { type: "growth_settings" },
        {
          $set: {
            type: "growth_settings",
            targetHashtags: body.targetHashtags ?? DEFAULT_SETTINGS.targetHashtags,
            dailyFollowLimit: Number(body.dailyFollowLimit ?? DEFAULT_SETTINGS.dailyFollowLimit),
            dailyLikeLimit: Number(body.dailyLikeLimit ?? DEFAULT_SETTINGS.dailyLikeLimit),
            dailyCommentLimit: Number(body.dailyCommentLimit ?? DEFAULT_SETTINGS.dailyCommentLimit),
            autoReplyEnabled: Boolean(body.autoReplyEnabled ?? true),
            commentPrompt: body.commentPrompt ?? DEFAULT_SETTINGS.commentPrompt,
            systemPrompt: body.systemPrompt ?? "",
            dmSystemPrompt: body.dmSystemPrompt ?? "",
            lastUpdated: new Date().toISOString(),
          },
        },
        { upsert: true }
      );
      addGrowLog("Growth settings updated.", "info");
      return NextResponse.json({ success: true, message: "Settings saved." });
    }

    if (action === "start") {
      if (g.instar_grow_growRunning) {
        return NextResponse.json({ success: false, message: "Growth cron already running." });
      }

      const db = await getDatabase();
      const sessionDoc = await db.collection("instar_config").findOne({ type: "ig_session" });

      if (!sessionDoc?.sessionid) {
        return NextResponse.json(
          { error: "No Instagram session. Save your session first." },
          { status: 400 }
        );
      }

      const savedSettings = await db.collection("instar_settings").findOne({ type: "growth_settings" });
      const settings = savedSettings
        ? {
            targetHashtags: (savedSettings.targetHashtags as string[]) || DEFAULT_SETTINGS.targetHashtags,
            dailyFollowLimit: Number(savedSettings.dailyFollowLimit ?? DEFAULT_SETTINGS.dailyFollowLimit),
            dailyLikeLimit: Number(savedSettings.dailyLikeLimit ?? DEFAULT_SETTINGS.dailyLikeLimit),
            dailyCommentLimit: Number(savedSettings.dailyCommentLimit ?? DEFAULT_SETTINGS.dailyCommentLimit),
            commentPrompt: (savedSettings.commentPrompt as string) || DEFAULT_SETTINGS.commentPrompt,
          }
        : DEFAULT_SETTINGS;

      const { sessionid, ds_user_id, csrftoken, mid } = sessionDoc as unknown as {
        sessionid: string;
        ds_user_id: string;
        csrftoken: string;
        mid?: string;
      };

      g.instar_grow_growRunning = true;
      addGrowLog("Growth cron started.", "success");

      // Run immediately, then every 12 minutes (conservative rate)
      growCronTick(sessionid, ds_user_id, csrftoken, mid, settings);
      g.instar_grow_growInterval = setInterval(
        () => growCronTick(sessionid, ds_user_id, csrftoken, mid, settings),
        12 * 60 * 1000
      );

      return NextResponse.json({ success: true, message: "Growth cron started." });
    }

    if (action === "stop") {
      if (g.instar_grow_growInterval) clearInterval(g.instar_grow_growInterval);
      g.instar_grow_growInterval = null;
      g.instar_grow_growRunning = false;
      
      if (g.instarGrowBrowser) {
        addGrowLog("Closing browser to forcefully stop Growth task...", "warning");
        try {
          await g.instarGrowBrowser.close();
        } catch {}
        g.instarGrowBrowser = undefined;
      }
      
      addGrowLog("Growth cron stopped.", "warning");
      return NextResponse.json({ success: true, message: "Growth cron stopped." });
    }

    return NextResponse.json({ error: "Invalid action." }, { status: 400 });
  } catch (err) {
    console.error("[instar/grow/cron] POST error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
