import { NextRequest, NextResponse } from "next/server";
import {
  getDatabase,
  InstarChatMessage,
} from "@/lib/mongodb";
import puppeteer, { Browser, Page } from "puppeteer";
import OpenAI from "openai";

export const maxDuration = 60;

const g = globalThis as any;
if (g.instar_inbox_initialized === undefined) {
  g.instar_inbox_initialized = true;

  g.instar_inbox_cronInterval = null;
  g.instar_inbox_cronRunning = false;
  g.instar_inbox_lastCronRun = null;
  g.instar_inbox_cronLog = [];
  g.instar_inbox_processedThreadIds = new Set();
  g.instar_inbox_consecutiveErrors = 0;
  g.instar_inbox_autoAcceptRequests = true;
  g.instar_inbox_systemPrompt =
    "You are a professional Instagram assistant. Reply briefly, warmly and professionally to Instagram Direct Messages on behalf of the user. Keep replies under 3 sentences. Be friendly and authentic.";
}

// ── In-memory state ────────────────────────────────────────────────────────

function addCronLog(
  message: string,
  type: "info" | "success" | "error" | "warning" = "info",
) {
  const entry = { time: new Date().toISOString(), message, type };
  g.instar_inbox_cronLog.push(entry);
  if (g.instar_inbox_cronLog.length > 100)
    g.instar_inbox_cronLog = g.instar_inbox_cronLog.slice(-100);
  console.log(`[instar-dm-cron][${type}] ${message}`);
}

async function getBrowser(): Promise<Browser> {
  if (!g.instarBrowser || !g.instarBrowser.connected) {
    addCronLog("Starting new Puppeteer browser for Instagram...", "info");
    g.instarBrowser = await puppeteer.launch({
      headless: true,
      userDataDir: "./ig_puppeteer_profile",
      defaultViewport: null,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-notifications",
        "--window-size=1280,900",
        "--disable-blink-features=AutomationControlled",
      ],
    });
  }
  return g.instarBrowser;
}

function getOpenAI(): OpenAI {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set.");
  return new OpenAI({ apiKey: key });
}

// ── Helpers ────────────────────────────────────────────────────────────────

interface ThreadInfo {
  threadId: string;
  senderName: string;
  lastMessage: string;
  isPending: boolean;
}

interface IGAPIThread {
  thread_id: string;
  thread_title: string;
  unseen_count: number;
  read_state: number;
  pending: boolean;
  items: Array<{
    text?: string;
    item_type: string;
    user_id: number | string;
  }>;
  users: Array<{
    pk: string;
    username: string;
    full_name: string;
  }>;
  viewer_id: string;
}

async function navigateTo(page: Page, url: string): Promise<void> {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  } catch (e: any) {
    if (!e.message?.includes("ERR_ABORTED")) throw e;
  }
  await new Promise((r) => setTimeout(r, 4000));
}

/**
 * Fetch DM threads via Instagram's private API, executed inside the Puppeteer
 * page context so session cookies are automatically included.
 */
async function fetchIGThreads(
  page: Page,
  isPending: boolean,
): Promise<IGAPIThread[]> {
  const endpoint = isPending
    ? "https://www.instagram.com/api/v1/direct_v2/pending_inbox/?visual_message_return_type=unseen&direction=older&limit=20"
    : "https://www.instagram.com/api/v1/direct_v2/inbox/?visual_message_return_type=unseen&direction=older&limit=20";

  const result = await page.evaluate(async (url: string) => {
    const csrf =
      document.cookie
        .split(";")
        .find((c) => c.trim().startsWith("csrftoken="))
        ?.split("=")[1] || "";
    try {
      const res = await fetch(url, {
        headers: {
          "X-CSRFToken": csrf,
          "X-IG-App-ID": "936619743392459",
          "X-Requested-With": "XMLHttpRequest",
          Accept: "*/*",
        },
        credentials: "include",
      });
      const text = await res.text();
      if (!res.ok) return { error: `HTTP ${res.status}: ${text.slice(0, 200)}`, threads: [] };
      const data = JSON.parse(text);
      const threads =
        data.inbox?.threads ||
        data.pending_inbox?.threads ||
        [];
      return { threads };
    } catch (e: any) {
      return { error: e.message, threads: [] };
    }
  }, endpoint);

  if (result.error) {
    addCronLog(`IG API error (${isPending ? "requests" : "inbox"}): ${result.error}`, "error");
    return [];
  }

  addCronLog(
    `IG API (${isPending ? "requests" : "inbox"}): ${result.threads.length} thread(s) returned.`,
    "info",
  );
  return result.threads as IGAPIThread[];
}

/**
 * Fetch full messages for a thread via Instagram's thread detail API.
 * Much more reliable than DOM scraping.
 */
async function fetchThreadMessages(
  page: Page,
  threadId: string,
  viewerId: string,
): Promise<{ text: string; isMine: boolean }[]> {
  const result = await page.evaluate(
    async (tid: string, uid: string) => {
      const csrf =
        document.cookie
          .split(";")
          .find((c) => c.trim().startsWith("csrftoken="))
          ?.split("=")[1] || "";
      try {
        const res = await fetch(
          `https://www.instagram.com/api/v1/direct_v2/threads/${tid}/?visual_message_return_type=unseen&direction=older&limit=20`,
          {
            headers: {
              "X-CSRFToken": csrf,
              "X-IG-App-ID": "936619743392459",
              "X-Requested-With": "XMLHttpRequest",
              Accept: "*/*",
            },
            credentials: "include",
          },
        );
        const data = await res.json();
        const thread = data.thread;
        if (!thread) return { msgs: [], error: "No thread in response" };
        const viewerPk = uid || String(thread.viewer_id);
        const msgs = (thread.items || [])
          .filter((item: any) => item.item_type === "text" && item.text)
          .map((item: any) => ({
            text: item.text as string,
            isMine: String(item.user_id) === viewerPk,
          }))
          .reverse(); // API returns newest-first; reverse so last = most recent
        return { msgs, error: null };
      } catch (e: any) {
        return { msgs: [], error: e.message };
      }
    },
    threadId,
    viewerId,
  );

  if (result.error) {
    addCronLog(`Thread detail API error: ${result.error}`, "warning");
  }
  return result.msgs;
}

/**
 * Type and send a reply in the currently open thread.
 * Returns true on success.
 */
async function sendReply(page: Page, reply: string): Promise<boolean> {
  // Use broad selector – Instagram may or may not have role="textbox"
  const textboxSelector = 'div[contenteditable="true"]';
  try {
    await page.waitForSelector(textboxSelector, { timeout: 15000 });
    await page.click(textboxSelector);
    await new Promise((r) => setTimeout(r, 400));
    await page.keyboard.type(reply, { delay: 30 });
    await page.keyboard.press("Enter");
    await new Promise((r) => setTimeout(r, 2000));
    return true;
  } catch (e: any) {
    addCronLog(`Compose box not found: ${e.message}`, "error");
    return false;
  }
}

/**
 * Process a single thread: navigate → (accept if request) → read → reply → save.
 */
async function processThread(
  page: Page,
  thread: ThreadInfo,
  openai: OpenAI,
  db: any,
  viewerId: string,
): Promise<boolean> {
  const cacheKey = thread.threadId + "_" + thread.lastMessage.slice(0, 40);
  if (g.instar_inbox_processedThreadIds.has(cacheKey)) {
    addCronLog(`Already processed: ${thread.senderName}`, "info");
    return false;
  }

  addCronLog(`Opening thread: ${thread.senderName}`, "info");
  await navigateTo(page, `https://www.instagram.com/direct/t/${thread.threadId}/`);

  // Resolve real sender name from page title if we only have a placeholder
  if (thread.senderName === "Request") {
    const pageName = await page.evaluate(() => {
      const h = document.querySelector('h2, [role="heading"]') as HTMLElement | null;
      return h?.innerText?.trim() || document.title.replace("• Instagram", "").trim() || "Unknown";
    });
    thread.senderName = pageName || "Unknown";
  }

  // Accept request via real mouse click (triggers React's event handlers)
  if (thread.isPending && g.instar_inbox_autoAcceptRequests) {
    try {
      // Get viewport coordinates of the "Accept" element (works for any element type)
      const coords = await page.evaluate(() => {
        const all = Array.from(document.querySelectorAll("*")) as HTMLElement[];
        const btn = all.find(
          (el) =>
            el.childElementCount === 0 &&
            el.textContent?.trim() === "Accept",
        );
        if (!btn) return null;
        const r = btn.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });

      if (coords) {
        await page.mouse.click(coords.x, coords.y); // real native mouse event → React fires
        addCronLog(`Accepted request from ${thread.senderName}.`, "success");
        // Wait for compose box to appear (confirms transition to chat view)
        await page
          .waitForSelector('div[contenteditable="true"]', { timeout: 15000 })
          .catch(() =>
            addCronLog("Compose box slow to appear after accept.", "warning"),
          );
      } else {
        addCronLog(
          `Accept button not found for ${thread.senderName} – treating as already accepted.`,
          "warning",
        );
      }
    } catch (e: any) {
      addCronLog(`Accept step error: ${e.message}`, "warning");
    }
  }

  const threadId = thread.threadId;

  // Fetch full messages via API
  const messages = await fetchThreadMessages(page, threadId, viewerId);
  const lastUserMsg = messages.filter((m: { text: string; isMine: boolean }) => !m.isMine).pop();
  const incomingText = lastUserMsg?.text || thread.lastMessage;

  if (!incomingText || incomingText.trim().length < 2) {
    addCronLog(`No readable message from ${thread.senderName}.`, "warning");
    return false;
  }

  addCronLog(`Generating reply to: "${incomingText.slice(0, 50)}..."`, "info");

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: g.instar_inbox_systemPrompt },
      {
        role: "user",
        content: `Message from ${thread.senderName}: ${incomingText}`,
      },
    ],
    temperature: 0.7,
    max_tokens: 150,
  });

  const reply = completion.choices[0]?.message?.content?.trim() || "";
  if (!reply) {
    addCronLog("Empty AI reply.", "warning");
    return false;
  }

  addCronLog(`Sending reply: "${reply.slice(0, 50)}..."`, "info");
  const sent = await sendReply(page, reply);

  if (!sent) {
    addCronLog(`Failed to send reply to ${thread.senderName}.`, "error");
    return false;
  }

  // Save to DB
  const logsCollection = db.collection("instar_conversation_logs");
  const prospectMsg: InstarChatMessage = {
    role: "prospect",
    text: incomingText,
    timestamp: new Date().toISOString(),
    source: "ig_inbox",
  };
  const botMsg: InstarChatMessage = {
    role: "instar",
    text: reply,
    timestamp: new Date().toISOString(),
    source: "instar_cron",
  };

  const existingLog = await logsCollection.findOne({ threadId });
  if (existingLog) {
    await logsCollection.updateOne(
      { threadId },
      {
        $push: { messages: { $each: [prospectMsg, botMsg] } } as any,
        $set: { lastActivity: new Date().toISOString() },
      },
    );
  } else {
    await logsCollection.insertOne({
      threadId,
      senderUsername: thread.senderName,
      lastActivity: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      messages: [prospectMsg, botMsg],
    } as any);
  }

  g.instar_inbox_processedThreadIds.add(cacheKey);
  addCronLog(`✓ Replied to ${thread.senderName}.`, "success");
  return true;
}

// ── Main DM cron tick ──────────────────────────────────────────────────────
async function dmCronTick(
  sessionid: string,
  ds_user_id: string,
  csrftoken: string,
  mid?: string,
) {
  if (!g.instar_inbox_cronRunning) return;
  g.instar_inbox_lastCronRun = new Date().toISOString();
  addCronLog("Checking Instagram DMs via Puppeteer...", "info");

  try {
    const browser = await getBrowser();
    const pages = await browser.pages();
    let page = pages.find((p) => p.url().includes("instagram.com")) as
      | Page
      | undefined;

    if (!page) {
      page = await browser.newPage();
      page.on("console", (msg) => console.log("[page-console]", msg.text()));

      // Stealth
      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, "webdriver", {
          get: () => undefined,
        });
      });

      await page.setCookie(
        { name: "sessionid", value: sessionid, domain: ".instagram.com" },
        { name: "ds_user_id", value: ds_user_id, domain: ".instagram.com" },
        { name: "csrftoken", value: csrftoken, domain: ".instagram.com" },
        ...(mid
          ? [{ name: "mid", value: mid, domain: ".instagram.com" }]
          : []),
      );
    }

    const db = await getDatabase();
    const openai = getOpenAI();

    // Navigate to inbox once to activate the session in the browser context
    addCronLog("Navigating to Instagram inbox...", "info");
    await navigateTo(page, "https://www.instagram.com/direct/inbox/");

    if (page.url().includes("/accounts/login")) {
      addCronLog("Session expired – re-injecting cookies and retrying...", "warning");
      await page.setCookie(
        { name: "sessionid", value: sessionid, domain: ".instagram.com" },
        { name: "ds_user_id", value: ds_user_id, domain: ".instagram.com" },
        { name: "csrftoken", value: csrftoken, domain: ".instagram.com" },
        ...(mid ? [{ name: "mid", value: mid, domain: ".instagram.com" }] : []),
      );
      await navigateTo(page, "https://www.instagram.com/direct/inbox/");
      if (page.url().includes("/accounts/login")) {
        addCronLog("Session truly expired – cookies invalid. Update session in settings.", "error");
        g.instar_inbox_consecutiveErrors++;
        return;
      }
      addCronLog("Session restored successfully.", "success");
    }

    // ── Phase 1: Regular inbox – fetch via API ─────────────────────────────
    const igInboxThreads = await fetchIGThreads(page, false);
    // Only process threads with unseen messages
    const unreadInbox = igInboxThreads.filter(
      (t) => t.unseen_count > 0 || t.read_state !== 0,
    );
    addCronLog(`${unreadInbox.length} unread thread(s) in inbox.`, "info");

    for (const igThread of unreadInbox) {
      if (!g.instar_inbox_cronRunning) break;
      const senderName =
        igThread.users.find((u) => u.pk !== igThread.viewer_id)?.full_name ||
        igThread.thread_title ||
        "Unknown";
      const lastMsg = igThread.items.find(
        (i) =>
          i.item_type === "text" &&
          String(i.user_id) !== String(igThread.viewer_id),
      );
      const thread: ThreadInfo = {
        threadId: igThread.thread_id,
        senderName,
        lastMessage: lastMsg?.text || "",
        isPending: false,
      };
      try {
        await processThread(page, thread, openai, db, ds_user_id);
      } catch (err: any) {
        addCronLog(`Error processing inbox thread ${senderName}: ${err.message}`, "error");
      }
    }

    // ── Phase 2: Message requests ──────────────────────────────────────────
    if (g.instar_inbox_autoAcceptRequests) {
      addCronLog("Checking message requests...", "info");

      // Instagram loads pending requests via GraphQL (/api/graphql).
      // Set up listener BEFORE navigating so we capture all responses.
      const inboxThreadIdSet = new Set(igInboxThreads.map((t) => t.thread_id));
      const requestThreadIds: string[] = [];

      const graphqlRespListener = async (resp: any) => {
        const url: string = resp.url();
        if (!url.includes("/api/graphql") && !url.includes("/graphql"))
          return;
        try {
          const text = await resp.text().catch(() => "");
          if (!text.includes('"thread_id"')) return;
          const matches = text.matchAll(/"thread_id":"(\d+)"/g);
          for (const m of matches) {
            const tid = m[1];
            if (!inboxThreadIdSet.has(tid) && !requestThreadIds.includes(tid))
              requestThreadIds.push(tid);
          }
        } catch { /* ignore */ }
      };

      page.on("response", graphqlRespListener);
      await navigateTo(page, "https://www.instagram.com/direct/requests/");
      await new Promise((r) => setTimeout(r, 6000));
      page.off("response", graphqlRespListener);

      addCronLog(
        `${requestThreadIds.length} pending request thread(s) found.`,
        "info",
      );

      for (const threadId of requestThreadIds) {
        if (!g.instar_inbox_cronRunning) break;
        const cacheKey = threadId + "_pending";
        if (g.instar_inbox_processedThreadIds.has(cacheKey)) {
          addCronLog(`Already processed request ${threadId}`, "info");
          continue;
        }
        const thread: ThreadInfo = {
          threadId,
          senderName: "Request",
          lastMessage: "",
          isPending: true,
        };
        try {
          const ok = await processThread(page, thread, openai, db, ds_user_id);
          // Only cache on success so failed attempts are retried next tick
          if (ok) g.instar_inbox_processedThreadIds.add(cacheKey);
        } catch (err: any) {
          addCronLog(
            `Error processing request thread ${threadId}: ${err.message}`,
            "error",
          );
        }
      }
    }

    if (unreadInbox.length === 0) {
      addCronLog("No unread DMs found.", "info");
    }

    g.instar_inbox_consecutiveErrors = 0;
  } catch (err: any) {
    g.instar_inbox_consecutiveErrors++;
    addCronLog(`Cron tick error: ${err.message}`, "error");
    if (g.instar_inbox_consecutiveErrors >= 5) {
      await g.instarBrowser?.close();
      g.instarBrowser = undefined;
      g.instar_inbox_consecutiveErrors = 0;
    }
  }
}

// ── GET: Cron status + logs ────────────────────────────────────────────────
export async function GET() {
  return NextResponse.json({
    running: g.instar_inbox_cronRunning,
    lastRun: g.instar_inbox_lastCronRun,
    logs: g.instar_inbox_cronLog.slice(-50),
    systemPrompt: g.instar_inbox_systemPrompt,
    processedCount: g.instar_inbox_processedThreadIds.size,
    consecutiveErrors: g.instar_inbox_consecutiveErrors,
    autoAcceptRequests: g.instar_inbox_autoAcceptRequests,
  });
}

// ── POST: Start / Stop / Update ────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action = body.action as string;

    if (action === "update_prompt" && body.systemPrompt) {
      g.instar_inbox_systemPrompt = body.systemPrompt;
      addCronLog("System prompt updated.", "info");
      return NextResponse.json({ success: true, message: "Prompt updated." });
    }

    if (action === "clear_logs") {
      g.instar_inbox_cronLog = [];
      g.instar_inbox_processedThreadIds.clear();
      return NextResponse.json({ success: true, message: "Logs cleared." });
    }

    if (action === "toggle_auto_accept") {
      g.instar_inbox_autoAcceptRequests =
        body.enabled !== undefined
          ? Boolean(body.enabled)
          : !g.instar_inbox_autoAcceptRequests;
      addCronLog(
        `Auto-accept message requests: ${g.instar_inbox_autoAcceptRequests ? "ON" : "OFF"}`,
        "info",
      );
      return NextResponse.json({
        success: true,
        autoAcceptRequests: g.instar_inbox_autoAcceptRequests,
      });
    }

    if (action === "start") {
      if (g.instar_inbox_cronRunning) {
        return NextResponse.json({
          success: false,
          message: "DM cron already running.",
        });
      }

      const db = await getDatabase();
      const sessionDoc = await db
        .collection("instar_config")
        .findOne({ type: "ig_session" });

      if (!sessionDoc || !sessionDoc.sessionid) {
        return NextResponse.json(
          {
            error:
              "No Instagram session found. Please save your session first.",
          },
          { status: 400 },
        );
      }

      const { sessionid, ds_user_id, csrftoken, mid } =
        sessionDoc as unknown as {
          sessionid: string;
          ds_user_id: string;
          csrftoken: string;
          mid?: string;
        };

      g.instar_inbox_cronRunning = true;
      addCronLog("DM cron started.", "success");

      // Run immediately, then every 90 seconds
      dmCronTick(sessionid, ds_user_id, csrftoken, mid);
      g.instar_inbox_cronInterval = setInterval(
        () => dmCronTick(sessionid, ds_user_id, csrftoken, mid),
        60_000,
      );

      return NextResponse.json({ success: true, message: "DM cron started." });
    }

    if (action === "stop") {
      if (g.instar_inbox_cronInterval)
        clearInterval(g.instar_inbox_cronInterval);
      g.instar_inbox_cronInterval = null;
      g.instar_inbox_cronRunning = false;

      if (g.instarBrowser) {
        addCronLog("Closing browser...", "warning");
        try {
          await g.instarBrowser.close();
        } catch {}
        g.instarBrowser = undefined;
      }

      addCronLog("DM cron stopped.", "warning");
      return NextResponse.json({ success: true, message: "DM cron stopped." });
    }

    return NextResponse.json({ error: "Invalid action." }, { status: 400 });
  } catch (err) {
    console.error("[instar/inbox/cron] POST error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
