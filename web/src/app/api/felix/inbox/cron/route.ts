import { NextRequest, NextResponse } from "next/server";
import { getDatabase, KnowledgeBaseEntry } from "@/lib/mongodb";
import puppeteer, { Browser } from "puppeteer";
import { processFollowUps, markFollowUpReplied, registerFollowUp } from "@/lib/followup";

async function getKnowledgeContext(): Promise<string> {
  try {
    const db = await getDatabase();
    const entries = await db
      .collection<KnowledgeBaseEntry>("knowledge_base")
      .find({ $or: [{ botId: "felix" }, { botId: "all" }] })
      .sort({ updatedAt: -1 })
      .toArray();
    if (entries.length === 0) return "";
    return (
      "\n\nCOMPANY KNOWLEDGE BASE (use this as your only source of truth):\n" +
      entries.map((e) => `[${e.type.toUpperCase()}] ${e.title}:\n${e.content}`).join("\n\n")
    );
  } catch {
    return "";
  }
}

async function createEscalation(params: {
  conversationId: string;
  senderName: string;
  lastMessage: string;
  reason: string;
}): Promise<void> {
  try {
    const db = await getDatabase();
    const existing = await db
      .collection("escalations")
      .findOne({ conversationId: params.conversationId, status: "pending" });
    if (existing) return;
    await db.collection("escalations").insertOne({
      botId: "felix",
      platform: "Facebook",
      conversationId: params.conversationId,
      senderName: params.senderName,
      lastMessage: params.lastMessage,
      reason: params.reason,
      status: "pending",
      createdAt: new Date().toISOString(),
    });
    console.log(`[felix-escalation] Created escalation for ${params.senderName}`);
  } catch (err) { 
    console.error(`[felix-escalation] Failed:`, err);
  }
}

export const maxDuration = 60;

const g = globalThis as any;
if (g.felix_initialized === undefined) {
    g.felix_initialized = true;

    g.felix_cronInterval = null;
    g.felix_cronRunning = false;
    g.felix_cronTickRunning = false;
    g.felix_tickStartedAt = null;
    g.felix_processingConvs = new Set();
    g.felix_lastCronRun = null;
    g.felix_cronLog = [];
    g.felix_processedMessageIds = new Set();
    g.felix_consecutiveErrors = 0;
    g.felix_systemPrompt = "You are a professional Facebook Messenger assistant. Reply briefly, warmly and professionally to Facebook messages on behalf of the user. Keep replies under 3 sentences. Do not use emojis.";
    g.felix_storedCUser = null;
    g.felix_storedXs = null;
    g.felix_storedDatr = null;
}

if (!g.felix_processingConvs) {
  g.felix_processingConvs = new Set();
}
if (g.felix_cronTickRunning === undefined) {
  g.felix_cronTickRunning = false;
  g.felix_tickStartedAt = null;
}



// ── In-memory state ───────────────────────────────────────────────────────────

function addCronLog(message: string, type: "info" | "success" | "error" | "warning" = "info") {
  const entry = { time: new Date().toISOString(), message, type };
  g.felix_cronLog.push(entry);
  if (g.felix_cronLog.length > 100) g.felix_cronLog = g.felix_cronLog.slice(-100);
  console.log(`[felix-cron][${type}] ${message}`);
}

// Global browser instance so we don't spin up a new Chrome every 60 seconds

async function getBrowser(): Promise<Browser> {
  if (!g.felixBrowser || !g.felixBrowser.connected) {
    addCronLog("Starting new Puppeteer browser instance...", "info");
    g.felixBrowser = await puppeteer.launch({
      headless: true,
      userDataDir: "./fb_puppeteer_profile",
      defaultViewport: null,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-notifications", "--window-size=1280,800"]
    });
  }
  return g.felixBrowser;
}

// ── Main cron tick ────────────────────────────────────────────────────────────
async function cronTick(c_user: string, xs: string, datr: string | null) {
  if (!g.felix_cronRunning) return;
  
  if (g.felix_cronTickRunning) {
    const startedAt = g.felix_tickStartedAt ? new Date(g.felix_tickStartedAt).getTime() : 0;
    const runningForMs = Date.now() - startedAt;
    if (runningForMs < 10 * 60 * 1000) {
      addCronLog(`Cron tick already running (for ${Math.round(runningForMs / 1000)}s) — skipping`, "warning");
      return;
    }
    addCronLog(`Stale tick lock detected (${Math.round(runningForMs / 1000)}s) — force resetting`, "warning");
    g.felix_processingConvs = new Set();
  }
  g.felix_cronTickRunning = true;
  g.felix_tickStartedAt = new Date().toISOString();

  g.felix_lastCronRun = new Date().toISOString();
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
       
       // 1. Explicit indicators in ARIA or Text
       if (
          ariaLower.includes("unread") || 
          textLower.includes("unread") || 
          ariaLower.includes("new message") ||
          ariaLower.includes("nouveau message") || // French
          ariaLower.includes("mensaje nuevo") ||   // Spanish
          t.svgFills.includes("#0866FF")            // Still a good strong indicator if present
       ) {
          match = true;
          reason = "Unread indicators present (aria/text/svg)";
       }

       // 2. Structural matching: if it doesn't say "You:" it's likely a message from them
       // but only if it's not already matched above. 
       if (!match && !textLower.includes("you:") && !textLower.includes("vous:") && t.text.length > 5) {
          match = true; 
          reason = "Implicit unread: Last message not from user";
       }

       // 3. Auto-Read Edge Case: if we are already on this thread but it has unread content
       if (!match && t.threadId && page.url().includes(t.threadId)) {
          if (!t.text.toLowerCase().includes("you:")) {
             match = true;
             reason = "Current open thread and last message not from You";
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
      g.felix_consecutiveErrors = 0;
      return;
    }

    addCronLog(`Puppeteer found ${threadsToProcess.length} unread thread(s). Processing...`, "success");

    // ── Process Each Thread ──
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) { addCronLog("OPENAI_API_KEY not set.", "error"); return; }
    
    // Get DB once for locks
    const db = await getDatabase();

    for (const thread of threadsToProcess) {
      if (!g.felix_cronRunning) {
        addCronLog("Cron stopped mid-execution. Aborting early.", "warning");
        return;
      }
      
      // Concurrency guard checks
      if (g.felix_processingConvs.has(thread.threadId)) {
        addCronLog(`Skipping thread ${thread.threadId} — already being processed.`, "warning");
        continue;
      }
      const existingDbConv = await db.collection("felix_conversation_logs").findOne({ threadId: thread.threadId });
      if (existingDbConv?.processingLockedAt) {
        const lockedMs = Date.now() - new Date(existingDbConv.processingLockedAt).getTime();
        if (lockedMs < 5 * 60 * 1000) {
          addCronLog(`Skipping thread ${thread.threadId} — DB lock active (${Math.round(lockedMs / 1000)}s ago)`, "warning");
          continue;
        }
        addCronLog(`Cleared stale DB lock for ${thread.threadId}`, "info");
      }
      
      // Acquire locks
      g.felix_processingConvs.add(thread.threadId);
      await db.collection("felix_conversation_logs").updateOne(
        { threadId: thread.threadId },
        { $set: { processingLockedAt: new Date().toISOString() } },
        { upsert: true }
      );
      
      try {
        addCronLog(`Opening thread: ${thread.aria.slice(0, 50)}...`, "info");
      
      await page.goto(thread.href, { waitUntil: "domcontentloaded", timeout: 30000 });
      // Wait for chat history to fully decrypt and render
      await new Promise(r => setTimeout(r, 4000));

      // Extract last 10 messages with direction detection (with retry loop for E2EE sync)
      let conversationMessages: { text: string; isOutgoing: boolean }[] = [];
      let latestMessage = "";
      for (let attempt = 0; attempt < 3; attempt++) {
        conversationMessages = await page.evaluate(() => {
          const panel = (document.querySelector('[role="main"]') || document.body) as HTMLElement;
          const panelRect = panel.getBoundingClientRect();
          const results: { text: string; isOutgoing: boolean }[] = [];

          const allRows = Array.from(document.querySelectorAll('[role="row"]')) as HTMLElement[];
          for (const row of allRows.slice(-15)) {
            const txt = row.innerText?.trim() ?? "";
            if (!txt) continue;
            const rect = row.getBoundingClientRect();
            const relCenter = panelRect.width > 0
              ? (rect.left + rect.width / 2 - panelRect.left) / panelRect.width
              : 0.5;
            results.push({ text: txt, isOutgoing: relCenter > 0.55 });
          }

          if (results.length === 0) {
            const divs = Array.from(document.querySelectorAll('div[dir="auto"]')) as HTMLElement[];
            for (const d of divs.slice(-10)) {
              const txt = d.innerText?.trim() ?? "";
              if (txt) results.push({ text: txt, isOutgoing: false });
            }
          }

          return results.slice(-10);
        });

        // Last incoming message as the "latest" for dedup and check
        latestMessage = conversationMessages.filter(m => !m.isOutgoing).pop()?.text
          || conversationMessages[conversationMessages.length - 1]?.text
          || "";

        if (latestMessage && latestMessage.toLowerCase() !== "loading..." && latestMessage.length > 0) {
          break;
        }

        if (attempt < 2) {
          addCronLog(`Message is still "${latestMessage || 'empty'}" — waiting for E2EE sync...`, "info");
          await new Promise(r => setTimeout(r, 4000));
        }
      }

      if (!latestMessage || latestMessage.toLowerCase() === "loading...") {
        addCronLog(`Could not read text for thread ${thread.threadId}. E2EE sync pending or message is "Loading...". Skipping.`, "warning");
        // Release locks
        g.felix_processingConvs.delete(thread.threadId);
        await db.collection("felix_conversation_logs").updateOne({ threadId: thread.threadId }, { $unset: { processingLockedAt: "" } }).catch(()=>{});
        continue;
      }

      // Avoid double-replying to the same message
      const msgId = `${thread.threadId}_${latestMessage.slice(0, 50).replace(/\s+/g, "_")}`;
      if (g.felix_processedMessageIds.has(msgId)) {
        addCronLog(`Skipping thread ${thread.threadId} — message already processed.`, "info");
        // Release locks
        g.felix_processingConvs.delete(thread.threadId);
        await db.collection("felix_conversation_logs").updateOne({ threadId: thread.threadId }, { $unset: { processingLockedAt: "" } }).catch(()=>{});
        continue;
      }

      addCronLog(`Message reads: "${latestMessage.slice(0, 80)}"`, "info");

      // Auto-mark any active follow-up thread for this user as replied
      await markFollowUpReplied("felix", thread.threadId);

      try {
        // Build chatHistory from last 10 messages for AI context
        const chatHistory = conversationMessages.map(m => ({
          role: (m.isOutgoing ? "assistant" : "user") as "user" | "assistant",
          content: m.text,
        }));

        // Generate AI reply with knowledge base context
        const knowledgeCtx = await getKnowledgeContext();
        const systemPromptWithContext = g.felix_systemPrompt + knowledgeCtx + `
  
ANTI-HALLUCINATION RULES (CRITICAL):
- Use ONLY the provided Company Knowledge Base as your source of truth.
- If the prospect asks something NOT covered in the Knowledge Base, you MUST reply with this EXACT phrase: "Let me confirm this for you — our team will follow up shortly. ##ESCALATE## <short reason>"
- Replacement of "confirm" with "review" or other words is NOT allowed.
- You MUST include the tag ##ESCALATE## whenever you cannot answer from the Knowledge Base.
- NEVER invent prices, technical details, or commitments.
- If you can answer confidently using the Knowledge Base, do NOT include ##ESCALATE##.`;

        const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "gpt-4o-mini", max_tokens: 210,
            messages: [
              { role: "system", content: systemPromptWithContext + `
              
EXAMPLES OF ESCALATION:
Prospect: "Do you have a discount?" (Not in KB)
Reply: "Let me confirm this for you — our team will follow up shortly. ##ESCALATE## Discount request"

Prospect: "What is your refund policy?" (In KB: No refunds)
Reply: "We do not offer refunds as per our policy."` },
              ...chatHistory,
            ],
          }),
        });
        const aiData = await aiRes.json();
        let rawReply = aiData.choices?.[0]?.message?.content?.trim() || "Thank you for your message!";

        // DETECTION LOGIC: Explicit tag or specific holding phrase
        const hasTag = rawReply.includes("##ESCALATE##");
        const hasPhrase = rawReply.toLowerCase().includes("let me confirm this for you");
        const needsEscalation = hasTag || hasPhrase;

        if (needsEscalation) {
          let escalationReason = "Out-of-context query";
          if (hasTag) {
            const parts = rawReply.split("##ESCALATE##");
            rawReply = parts[0].trim();
            escalationReason = (parts[1] || "Out-of-context query").trim();
          }
          let sName = thread.aria.includes(',') ? thread.aria.split(',')[1].trim() : "Unknown";
          sName = sName.replace(/^Unread message\s*/i, '');
          await createEscalation({
            conversationId: thread.threadId,
            senderName: sName,
            lastMessage: latestMessage,
            reason: escalationReason,
          });
          addCronLog(`Escalated ${thread.threadId}: ${escalationReason}`, "info");
        }

        const replyText = rawReply.replace(/"/g, "'").replace(/\n/g, " ").replace(/\r/g, "");

        // Find the composer and type the reply
        const composerSelector = 'div[aria-label="Message"], div[role="textbox"][contenteditable="true"], div[aria-placeholder="Message"]';
        await page.waitForSelector(composerSelector, { timeout: 10000 });
        await page.click(composerSelector);
        await new Promise(r => setTimeout(r, 300));
        await page.keyboard.type(replyText, { delay: 15 }); // Typing with slight delay so React registers it
        await new Promise(r => setTimeout(r, 500));
        await page.keyboard.press('Enter');

        addCronLog(`Replied to ${thread.threadId}: "${replyText.slice(0, 50)}..."`, "success");
        g.felix_processedMessageIds.add(msgId);
        g.felix_consecutiveErrors = 0;

        // Register for automated follow-up tracking
        let sn = thread.aria.includes(",") ? thread.aria.split(",")[1].trim() : "Unknown";
        sn = sn.replace(/^Unread message\s*/i, "");
        await registerFollowUp("felix", thread.threadId, sn, replyText, "msg_" + Date.now(), false, latestMessage);

        // Log to DB
        let senderName = thread.aria.includes(',') ? thread.aria.split(',')[1].trim() : "Unknown";
        senderName = senderName.replace(/^Unread message\s*/i, '');
        try {
          await db.collection("felix_conversation_logs").updateOne(
            { threadId: thread.threadId },
            { $push: { messages: { $each: [
              { role: "user", text: latestMessage, timestamp: new Date().toISOString(), source: "fb_puppeteer" },
              { role: "felix", text: replyText, timestamp: new Date().toISOString(), source: "felix_cron" },
            ] } } as never,
            $set: { senderName: senderName, senderId: thread.threadId, lastActivity: new Date().toISOString() },
            $unset: { processingLockedAt: "" },
            $setOnInsert: { createdAt: new Date().toISOString() } }, { upsert: true }
          );
        } catch { /* ignored */ }
        
        g.felix_processingConvs.delete(thread.threadId);

      } catch (err) {
        addCronLog(`Error responding to ${thread.threadId}: ${err instanceof Error ? err.message : String(err)}`, "error");
        g.felix_processingConvs.delete(thread.threadId);
        await db.collection("felix_conversation_logs").updateOne({ threadId: thread.threadId }, { $unset: { processingLockedAt: "" } }).catch(()=>{});
      }
      } catch (outerErr) {
        addCronLog(`Unexpected error while processing thread ${thread.threadId}: ${outerErr instanceof Error ? outerErr.message : String(outerErr)}`, "error");
        g.felix_processingConvs.delete(thread.threadId);
        await db.collection("felix_conversation_logs").updateOne({ threadId: thread.threadId }, { $unset: { processingLockedAt: "" } }).catch(()=>{});
      }
    }

    // Go back to inbox so next cron can scan the sidebar
    try {
      await page.goto("https://www.facebook.com/messages/", { waitUntil: "domcontentloaded", timeout: 45000 });
    } catch (e: any) {
      if (!e.message.includes("ERR_ABORTED")) throw e;
    }

    // Process any pending follow-ups for Felix
    const { sent } = await processFollowUps("felix", addCronLog);
    if (sent > 0) addCronLog(`Follow-up scheduler: ${sent} follow-up(s) dispatched.`, "success");
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Unknown error";
    addCronLog(`Puppeteer Cron error: ${errMsg}`, "error");
    g.felix_consecutiveErrors++;
    if (g.felix_consecutiveErrors >= 3) {
      addCronLog("3 consecutive cron errors. Stopping.", "error");
      stopCron();
    }
  } finally {
    g.felix_cronTickRunning = false;
    g.felix_tickStartedAt = null;
    g.felix_processingConvs.clear();
  }
}

// ── Session store ─────────────────────────────────────────────────────────────

function startCron(c_user: string, xs: string, datr: string | null) {
  if (g.felix_cronInterval) return;
  g.felix_storedCUser = c_user; g.felix_storedXs = xs; g.felix_storedDatr = datr;
  g.felix_cronRunning = true; g.felix_consecutiveErrors = 0;
  addCronLog("Puppeteer Cron started — checking every 60 seconds.", "success");
  cronTick(c_user, xs, datr);
  g.felix_cronInterval = setInterval(() => {
    if (g.felix_storedCUser && g.felix_storedXs) cronTick(g.felix_storedCUser, g.felix_storedXs, g.felix_storedDatr);
  }, 60_000);
}

function stopCron() {
  if (g.felix_cronInterval) { clearInterval(g.felix_cronInterval); g.felix_cronInterval = null; }
  g.felix_cronRunning = false; g.felix_storedCUser = null; g.felix_storedXs = null; g.felix_storedDatr = null; 
  
  if (g.felixBrowser) {
    addCronLog("Closing browser to forcefully stop Felix task...", "warning");
    try {
      g.felixBrowser.close();
    } catch {}
    g.felixBrowser = undefined;
  }
  
  addCronLog("Cron stopped.", "warning");
}

// ── GET: Cron status ──────────────────────────────────────────────────────────
export async function GET() {
  return NextResponse.json({ 
    running: g.felix_cronRunning, 
    tickRunning: g.felix_cronTickRunning,
    lastRun: g.felix_lastCronRun, 
    processedCount: g.felix_processedMessageIds.size, 
    logs: g.felix_cronLog.slice(-30), 
    systemPrompt: g.felix_systemPrompt,
    processingConversations: [...(g.felix_processingConvs || new Set())]
  });
}

// ── POST: Start / Stop / Update ───────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, prompt } = body;

    if (action === "send_followup") {
      const { threadId, messageText: msg } = body;
      if (!g.felixBrowser?.connected) {
        return NextResponse.json({ sent: false, error: "Browser not running" });
      }
      // No tickRunning guard — processFollowUps is called from inside the tick itself.
      try {
        const browser = await getBrowser();
        const pages = await browser.pages();
        let page = pages.find((p) => p.url().includes("facebook.com"));
        if (!page) page = await browser.newPage();
        try {
          await page.goto(`https://www.facebook.com/messages/t/${threadId}`, { waitUntil: "domcontentloaded", timeout: 30000 });
        } catch (e: any) { if (!e.message.includes("ERR_ABORTED")) throw e; }
        await new Promise((r) => setTimeout(r, 4000));
        const composerSelector = 'div[aria-label="Message"], div[role="textbox"][contenteditable="true"], div[aria-placeholder="Message"]';
        await page.waitForSelector(composerSelector, { timeout: 10000 });
        await page.click(composerSelector);
        await new Promise((r) => setTimeout(r, 300));
        const replyText = msg.replace(/"/g, "'").replace(/\n/g, " ").replace(/\r/g, "");
        await page.keyboard.type(replyText, { delay: 15 });
        await new Promise((r) => setTimeout(r, 500));
        await page.keyboard.press("Enter");
        addCronLog(`Follow-up sent to thread ${threadId}`, "success");
        return NextResponse.json({ sent: true, success: true });
      } catch (err: any) {
        addCronLog(`send_followup error: ${err.message}`, "error");
        return NextResponse.json({ sent: false, error: err.message });
      }
    }

    if (action === "start") {
      let c_user: string, xs: string, datr: string | null = null;

      // Try browser cookie first, fall back to MongoDB
      const fbSessionRaw = req.cookies.get("fb_session")?.value;
      if (fbSessionRaw) {
        try {
          const parsed = JSON.parse(fbSessionRaw);
          c_user = parsed.c_user; xs = parsed.xs; datr = parsed.datr || null;
        } catch {
          return NextResponse.json({ error: "Invalid fb_session cookie format." }, { status: 400 });
        }
      } else {
        const db = await getDatabase();
        const sessionDoc = await db.collection("felix_config").findOne({ type: "fb_session" });
        if (!sessionDoc) {
          return NextResponse.json({ error: "No Facebook session found. Please authenticate in the Facebook Auth tab." }, { status: 401 });
        }
        c_user = sessionDoc.c_user as string;
        xs = sessionDoc.xs as string;
        datr = (sessionDoc.datr as string) || null;
      }

      if (!c_user || !xs) return NextResponse.json({ error: "Session incomplete (missing c_user or xs)." }, { status: 401 });
      if (g.felix_cronRunning) return NextResponse.json({ success: true, message: "Cron is already running.", running: true });

      g.felix_processedMessageIds = new Set();
      startCron(c_user, xs, datr);
      return NextResponse.json({ success: true, message: "Puppeteer Cron started.", running: true });
    }

    if (action === "stop") { stopCron(); return NextResponse.json({ success: true, message: "Cron stopped.", running: false }); }
    if (action === "clear-logs") { g.felix_cronLog = []; return NextResponse.json({ success: true, message: "Logs cleared." }); }
    if (action === "reset-processed") { g.felix_processedMessageIds = new Set(); return NextResponse.json({ success: true, message: "Processed message IDs reset." }); }
    if (action === "update-prompt") {
      if (prompt && typeof prompt === "string") { g.felix_systemPrompt = prompt.trim(); return NextResponse.json({ success: true, message: "System prompt updated." }); }
      return NextResponse.json({ error: "prompt field required." }, { status: 400 });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err) {
    console.error("[felix-cron] POST error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
