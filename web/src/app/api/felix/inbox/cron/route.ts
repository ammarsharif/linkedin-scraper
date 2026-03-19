import { NextRequest, NextResponse } from "next/server";
import { getDatabase } from "@/lib/mongodb";
import puppeteer, { Browser } from "puppeteer";

export const maxDuration = 60;

// ── In-memory state ───────────────────────────────────────────────────────────
let cronInterval: ReturnType<typeof setInterval> | null = null;
let cronRunning = false;
let lastCronRun: string | null = null;
let cronLog: { time: string; message: string; type: "info" | "success" | "error" | "warning" }[] = [];
let processedMessageIds: Set<string> = new Set();
let consecutiveErrors = 0;

let systemPrompt =
  "You are a professional Facebook Messenger assistant. Reply briefly, warmly and professionally to Facebook messages on behalf of the user. Keep replies under 3 sentences. Do not use emojis.";

function addCronLog(message: string, type: "info" | "success" | "error" | "warning" = "info") {
  const entry = { time: new Date().toISOString(), message, type };
  cronLog.push(entry);
  if (cronLog.length > 100) cronLog = cronLog.slice(-100);
  console.log(`[felix-cron][${type}] ${message}`);
}

// Global browser instance so we don't spin up a new Chrome every 60 seconds
const g = globalThis as unknown as { felixBrowser?: Browser };

async function getBrowser(): Promise<Browser> {
  if (!g.felixBrowser || !g.felixBrowser.connected) {
    addCronLog("Starting new Puppeteer browser instance...", "info");
    g.felixBrowser = await puppeteer.launch({
      headless: false,
      userDataDir: "./fb_puppeteer_profile",
      defaultViewport: null,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-notifications", "--window-size=1280,800"]
    });
  }
  return g.felixBrowser;
}

// ── Main cron tick ────────────────────────────────────────────────────────────
async function cronTick(c_user: string, xs: string, datr: string | null) {
  lastCronRun = new Date().toISOString();
  addCronLog("Checking for unread messages using Puppeteer Tracker...", "info");

  try {
    const browser = await getBrowser();
    
    // Check if we have an open page or open a new one
    const pages = await browser.pages();
    let page = pages.find(p => p.url().includes("facebook.com"));
    if (!page) {
      page = await browser.newPage();
      await page.setCookie(
        { name: "c_user", value: c_user, domain: ".facebook.com" },
        { name: "xs", value: xs, domain: ".facebook.com" },
        ...(datr ? [{ name: "datr", value: datr, domain: ".facebook.com" }] : [])
      );
    }

    addCronLog("Navigating to Facebook Messenger...", "info");
    try {
      await page.goto("https://www.facebook.com/messages/", { waitUntil: "domcontentloaded", timeout: 45000 });
    } catch (e: any) {
      if (!e.message.includes("ERR_ABORTED")) throw e;
    }

    // Wait a few seconds for Facebook's React app to load and E2EE to sync via IndexedDB
    await new Promise(r => setTimeout(r, 6000));
    
    addCronLog(`Puppeteer is currently at URL: ${page.url()}`, "info");

    // Check if there is an E2EE "Restore PIN" prompt on the screen
    const e2eePrompt = await page.evaluate(() => {
       return document.body.innerText.includes("Enter your PIN") || 
              document.body.innerText.includes("Restore your messages") ||
              document.body.innerText.includes("Turn on secure storage");
    });

    if (e2eePrompt) {
       addCronLog("E2EE PIN / Restore Screen Detected! Please open the Puppeteer Chrome window and enter your PIN code to decrypt your messages.", "warning");
       // Don't error out, let the user enter it during this interval.
       return; 
    }

    // ── Find Unread Threads ──
    const allThreadsDebug = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[role="link"]'));
      return links
        .filter(a => typeof a.href === 'string' && (a.href.includes('/t/') || a.href.includes('/messages/t/')))
        .map(a => {
           const svgs = Array.from(a.querySelectorAll('svg circle')).map(c => c.getAttribute('fill')).join(',');
           const hrefParts = a.href.split('/t/');
           return {
              href: a.href,
              aria: a.getAttribute('aria-label') || "",
              text: a.innerText.replace(/\n/g, ' '),
              svgFills: svgs,
              threadId: hrefParts.length > 1 ? hrefParts[1].split('/')[0].split('?')[0] : ""
           }
        });
    });

    for (let i = 0; i < Math.min(3, allThreadsDebug.length); i++) {
        addCronLog(`DOM Thread ${i}: ID=${allThreadsDebug[i].threadId} | Aria=${allThreadsDebug[i].aria.substring(0,50)} | Text=${allThreadsDebug[i].text.substring(0, 50)} | SVG=${allThreadsDebug[i].svgFills}`, "info");
    }

    const unreadThreads = allThreadsDebug.filter(t => {
       const ariaLower = t.aria.toLowerCase();
       const textLower = t.text.toLowerCase();
       let match = false;
       let reason = "";
       
       // 1. Explicit indicators
       if (ariaLower.includes("unread") || textLower.includes("unread") || t.svgFills.includes('#0866FF') || t.svgFills.includes('#0866ff')) {
          match = true;
          reason = "Unread indicators present (aria/text/blue-dot)";
       }

       // 2. Auto-Read Edge Case
       if (!match && t.threadId && page.url().includes(t.threadId)) {
          if (!t.text.includes("You:")) {
             match = true;
             reason = "Current open thread and last message not from You";
          } else {
             reason = "Current open thread but last message IS from You";
          }
       }

       if (match) {
          addCronLog(`Matched Thread ${t.threadId}: ${reason}`, "info");
       } else if (t.threadId) {
          // Log skip if it's potentially interesting
          if (page.url().includes(t.threadId)) {
             addCronLog(`Checked Current Thread ${t.threadId}: ${reason || "No match"}`, "info");
          }
       }

       return match;
    });

    addCronLog(`Puppeteer found ${unreadThreads.length} potential unread threads.`, "info");

    // Deduplicate threads found in the sidebar
    const uniqueThreads = new Map<string, typeof unreadThreads[0]>();
    for (const t of unreadThreads) {
      if (t.threadId && !uniqueThreads.has(t.threadId)) {
        uniqueThreads.set(t.threadId, t);
      }
    }

    const threadsToProcess = Array.from(uniqueThreads.values());
    if (threadsToProcess.length === 0) {
      consecutiveErrors = 0;
      return;
    }

    addCronLog(`Puppeteer found ${threadsToProcess.length} unread thread(s). Processing...`, "success");

    // ── Process Each Thread ──
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) { addCronLog("OPENAI_API_KEY not set.", "error"); return; }

    for (const thread of threadsToProcess) {
      addCronLog(`Opening thread: ${thread.aria.slice(0, 50)}...`, "info");
      
      await page.goto(thread.href, { waitUntil: "domcontentloaded", timeout: 30000 });
      // Wait for chat history to fully decrypt and render
      await new Promise(r => setTimeout(r, 4000));

      // Snag the latest message
      const latestMessage = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('[role="row"], div[dir="auto"]'));
        if (rows.length === 0) return "";
        // Take the last visible text chunk
        for (let i = rows.length - 1; i >= 0; i--) {
            const txt = (rows[i] as HTMLElement).innerText;
            if (txt && txt.trim().length > 0) return txt.trim();
        }
        return "";
      });

      if (!latestMessage) {
        addCronLog(`Could not read text for thread ${thread.threadId}. E2EE sync pending?`, "warning");
        continue;
      }

      // Avoid double-replying to the same message
      const msgId = `${thread.threadId}_${latestMessage.slice(0, 50).replace(/\s+/g, "_")}`;
      if (processedMessageIds.has(msgId)) {
        addCronLog(`Skipping thread ${thread.threadId} — message already processed.`, "info");
        continue;
      }

      addCronLog(`Message reads: "${latestMessage.slice(0, 80)}"`, "info");

      try {
        // Generate AI reply
        const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "gpt-4o-mini", max_tokens: 150,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: `Reply to this Facebook message: ${latestMessage}` },
            ],
          }),
        });
        const aiData = await aiRes.json();
        const replyText = (aiData.choices?.[0]?.message?.content?.trim() || "Thank you for your message!")
          .replace(/"/g, "'").replace(/\n/g, " ").replace(/\r/g, "");

        // Find the composer and type the reply
        const composerSelector = 'div[aria-label="Message"], div[role="textbox"][contenteditable="true"], div[aria-placeholder="Message"]';
        await page.waitForSelector(composerSelector, { timeout: 10000 });
        await page.click(composerSelector);
        await new Promise(r => setTimeout(r, 300));
        await page.keyboard.type(replyText, { delay: 15 }); // Typing with slight delay so React registers it
        await new Promise(r => setTimeout(r, 500));
        await page.keyboard.press('Enter');

        addCronLog(`Replied to ${thread.threadId}: "${replyText.slice(0, 50)}..."`, "success");
        processedMessageIds.add(msgId);
        consecutiveErrors = 0;

        // Log to DB
        let senderName = thread.aria.includes(',') ? thread.aria.split(',')[1].trim() : "Unknown";
        senderName = senderName.replace(/^Unread message\s*/i, '');
        try {
          const db = await getDatabase();
          await db.collection("felix_conversation_logs").updateOne(
            { threadId: thread.threadId },
            { $push: { messages: { $each: [
              { role: "user", text: latestMessage, timestamp: new Date().toISOString(), source: "fb_puppeteer" },
              { role: "felix", text: replyText, timestamp: new Date().toISOString(), source: "felix_cron" },
            ] } } as never,
            $set: { senderName: senderName, senderId: thread.threadId, lastActivity: new Date().toISOString() },
            $setOnInsert: { createdAt: new Date().toISOString() } }, { upsert: true }
          );
        } catch { /* ignored */ }

      } catch (err) {
        addCronLog(`Error responding to ${thread.threadId}: ${err instanceof Error ? err.message : String(err)}`, "error");
      }
    }

    // Go back to inbox so next cron can scan the sidebar
    try {
      await page.goto("https://www.facebook.com/messages/", { waitUntil: "domcontentloaded", timeout: 45000 });
    } catch (e: any) {
      if (!e.message.includes("ERR_ABORTED")) throw e;
    }

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Unknown error";
    addCronLog(`Puppeteer Cron error: ${errMsg}`, "error");
    consecutiveErrors++;
    if (consecutiveErrors >= 3) {
      addCronLog("3 consecutive cron errors. Stopping.", "error");
      stopCron();
    }
  }
}

// ── Session store ─────────────────────────────────────────────────────────────
let storedCUser: string | null = null;
let storedXs: string | null = null;
let storedDatr: string | null = null;

function startCron(c_user: string, xs: string, datr: string | null) {
  if (cronInterval) return;
  storedCUser = c_user; storedXs = xs; storedDatr = datr;
  cronRunning = true; consecutiveErrors = 0;
  addCronLog("Puppeteer Cron started — checking every 60 seconds.", "success");
  cronTick(c_user, xs, datr);
  cronInterval = setInterval(() => {
    if (storedCUser && storedXs) cronTick(storedCUser, storedXs, storedDatr);
  }, 60_000);
}

function stopCron() {
  if (cronInterval) { clearInterval(cronInterval); cronInterval = null; }
  cronRunning = false; storedCUser = null; storedXs = null; storedDatr = null; 
  addCronLog("Cron stopped.", "warning");
}

// ── GET: Cron status ──────────────────────────────────────────────────────────
export async function GET() {
  return NextResponse.json({ running: cronRunning, lastRun: lastCronRun, processedCount: processedMessageIds.size, logs: cronLog.slice(-30), systemPrompt });
}

// ── POST: Start / Stop / Update ───────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const { action, prompt } = await req.json();

    if (action === "start") {
      const fbSessionRaw = req.cookies.get("fb_session")?.value;
      if (!fbSessionRaw) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

      let c_user: string, xs: string, datr: string | null;
      try {
        const parsed = JSON.parse(fbSessionRaw);
        c_user = parsed.c_user; xs = parsed.xs; datr = parsed.datr || null;
      } catch { return NextResponse.json({ error: "Invalid fb_session cookie format." }, { status: 400 }); }

      if (!c_user || !xs) return NextResponse.json({ error: "fb_session incomplete (missing c_user or xs)." }, { status: 401 });
      if (cronRunning) return NextResponse.json({ success: true, message: "Cron is already running.", running: true });

      startCron(c_user, xs, datr);
      return NextResponse.json({ success: true, message: "Puppeteer Cron started.", running: true });
    }

    if (action === "stop") { stopCron(); return NextResponse.json({ success: true, message: "Cron stopped.", running: false }); }
    if (action === "clear-logs") { cronLog = []; return NextResponse.json({ success: true, message: "Logs cleared." }); }
    if (action === "reset-processed") { processedMessageIds = new Set(); return NextResponse.json({ success: true, message: "Processed message IDs reset." }); }
    if (action === "update-prompt") {
      if (prompt && typeof prompt === "string") { systemPrompt = prompt.trim(); return NextResponse.json({ success: true, message: "System prompt updated." }); }
      return NextResponse.json({ error: "prompt field required." }, { status: 400 });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err) {
    console.error("[felix-cron] POST error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
