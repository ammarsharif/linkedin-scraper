import { NextRequest, NextResponse } from "next/server";
import { getDatabase } from "@/lib/mongodb";
import puppeteer, { Browser, Page } from "puppeteer";
import OpenAI from "openai";

export const maxDuration = 60;

// ── Global state ──────────────────────────────────────────────────────────────
const g = globalThis as any;
if (g.xavier_inbox_initialized === undefined) {
  g.xavier_inbox_initialized = true;
  g.xavier_inbox_interval = null;
  g.xavier_inbox_running = false;
  g.xavier_inbox_tickRunning = false;
  g.xavier_inbox_lastRun = null;
  g.xavier_inbox_log = [];
  g.xavier_inbox_consecutiveErrors = 0;
  g.xavier_inbox_browser = null;
  g.xavier_inbox_dmSystemPrompt =
    "You are a professional Twitter/X assistant. Reply warmly, concisely, and professionally to Twitter DMs on behalf of the user. Keep replies under 3 sentences. Be friendly and authentic.";
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function randDelay(min = 1200, max = 3500): Promise<void> {
  return new Promise((r) =>
    setTimeout(r, Math.floor(Math.random() * (max - min)) + min)
  );
}

function addLog(
  message: string,
  type: "info" | "success" | "error" | "warning" = "info"
) {
  const entry = { time: new Date().toISOString(), message, type };
  g.xavier_inbox_log.unshift(entry);
  if (g.xavier_inbox_log.length > 100) g.xavier_inbox_log.length = 100;
}

async function getOrCreateBrowser(): Promise<Browser> {
  if (g.xavier_inbox_browser) {
    try {
      const pages = await g.xavier_inbox_browser.pages();
      if (pages.length > 0) return g.xavier_inbox_browser;
    } catch {}
    g.xavier_inbox_browser = null;
  }

  g.xavier_inbox_browser = await puppeteer.launch({
    headless: false,
    userDataDir: "./xavier_puppeteer_inbox_profile",
    defaultViewport: { width: 1280, height: 900 },
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-notifications",
      "--disable-blink-features=AutomationControlled",
    ],
  });
  return g.xavier_inbox_browser;
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

// ── DM Inbox Tick ─────────────────────────────────────────────────────────────
async function inboxTick() {
  if (g.xavier_inbox_tickRunning) {
    addLog("Inbox tick already running — skipping", "warning");
    return;
  }
  g.xavier_inbox_tickRunning = true;
  g.xavier_inbox_lastRun = new Date().toISOString();

  try {
    const db = await getDatabase();

    const sessionDoc = await db
      .collection("xavier_config")
      .findOne({ type: "tw_session" });

    if (!sessionDoc?.auth_token) {
      addLog("No Twitter session — skipping inbox check", "error");
      g.xavier_inbox_consecutiveErrors++;
      return;
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const browser = await getOrCreateBrowser();
    const pages = await browser.pages();
    const page = pages.length > 0 ? pages[0] : await browser.newPage();

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    );

    await setTwitterCookies(page, sessionDoc);

    // Navigate to DMs
    await page.goto("https://x.com/messages", {
      waitUntil: "networkidle2",
      timeout: 40000,
    });
    await randDelay(2000, 3500);

    let loggedIn = await page.evaluate(
      () =>
        !!document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]') ||
        !!document.querySelector('[data-testid="AppTabBar_Home_Link"]') ||
        !!document.querySelector('[data-testid="conversation"]')
    );
    
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
          await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 20000 }).catch(() => {});
          await randDelay(3000, 5000);
          
          // Re-check login
          loggedIn = await page.evaluate(
            () =>
              !!document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]') ||
              !!document.querySelector('[data-testid="AppTabBar_Home_Link"]') ||
              !!document.querySelector('[data-testid="conversation"]')
          );
        }
      }
    }

    if (!loggedIn) {
      addLog("Session expired or challenge failed — marking as expired", "error");
      await db
        .collection("xavier_config")
        .updateOne({ type: "tw_session" }, { $set: { status: "expired" } });
      g.xavier_inbox_consecutiveErrors++;
      return;
    }

    // Wait for conversations list to appear — try multiple selectors
    const CONV_SELECTORS = [
      '[data-testid="conversation"]',
      '[data-testid="DMConversation"]',
      '[data-testid="cellInnerDiv"]',
    ];
    let selectorFound = false;
    for (const sel of CONV_SELECTORS) {
      try {
        await page.waitForSelector(sel, { timeout: 5000 });
        selectorFound = true;
        addLog(`Inbox loaded (selector: ${sel})`, "info");
        break;
      } catch { /* try next */ }
    }
    if (!selectorFound) {
      addLog("Inbox list not found — saving debug screenshot", "warning");
      await page.screenshot({ path: "./xavier_inbox_debug.png" }).catch(() => {});
    }
    await randDelay(2000, 4000);

    const conversations = await page.evaluate(() => {
      let rows: Element[] = [];

      // Strategy 1: primary data-testids
      for (const sel of ['[data-testid="conversation"]', '[data-testid="DMConversation"]']) {
        rows = Array.from(document.querySelectorAll(sel));
        if (rows.length > 0) break;
      }

      // Strategy 2: cellInnerDiv wrappers that contain a messages link
      if (rows.length === 0) {
        rows = Array.from(document.querySelectorAll('[data-testid="cellInnerDiv"]'))
          .filter(el => !!el.querySelector('a[href*="/messages/"]'));
      }

      // Strategy 3: walk up from every unique /messages/{id} link
      if (rows.length === 0) {
        const seen = new Set<string>();
        rows = (Array.from(document.querySelectorAll('a[href]')) as HTMLAnchorElement[])
          .filter(a => {
            const h = a.getAttribute("href") || "";
            if (!/^\/messages\/\d/.test(h) || seen.has(h)) return false;
            seen.add(h);
            return true;
          })
          .map(a => {
            let node: Element = a;
            while (node.parentElement && node.getBoundingClientRect().height < 60) {
              node = node.parentElement;
            }
            return node;
          });
      }

      return rows.slice(0, 10).map((row: any) => {
        const link: HTMLAnchorElement | null =
          row.tagName === "A" ? row : row.querySelector('a[href*="/messages/"]');
        const href = link?.getAttribute("href") || "";
        const conversationId = href.split("/").pop() || "";

        // Username: prefer @handle span, fall back to dir="ltr"
        const allSpans = Array.from(row.querySelectorAll("span")) as HTMLElement[];
        const atSpan = allSpans.find(s => s.textContent?.trim().startsWith("@"));
        const username = atSpan
          ? atSpan.textContent!.trim().replace("@", "")
          : (row.querySelector('[dir="ltr"] span') as HTMLElement)?.textContent?.trim() ?? "";

        const previewEl: HTMLElement | null =
          row.querySelector('[data-testid="tweetText"]') ||
          row.querySelector('[dir="auto"] span');
        const preview = previewEl?.innerText?.trim() ?? "";

        // Unread: badge element OR SVG dot OR aria-label
        const unread =
          !!row.querySelector('[data-testid="unread-badge"]') ||
          !!row.querySelector('[data-testid="badge"]') ||
          !!row.querySelector('span[aria-label*="nread"]');

        return { conversationId, username, preview, href, unread };
      }).filter((c: any) => c.conversationId && /^\d/.test(c.conversationId));
    });

    const unreadCount = conversations.filter(c => c.unread).length;
    addLog(`Found ${conversations.length} conversations (${unreadCount} unread)`, "info");

    let repliedCount = 0;
    for (const conv of conversations) {
      if (!conv.conversationId || !conv.href) continue;

      // Check if we already logged this conversation
      const existing = await db
        .collection("xavier_conversations")
        .findOne({ conversationId: conv.conversationId });

      // Navigate into conversation
      const convUrl = `https://x.com${conv.href}`;
      await page.goto(convUrl, { waitUntil: "networkidle2", timeout: 35000 });
      await randDelay(1500, 2500);

      // Wait for message entries to load
      await page.waitForSelector(
        '[data-testid="messageEntry"], [data-testid="DM_Message_container"], [data-testid="cellInnerDiv"]',
        { timeout: 10000 }
      ).catch(() => {});
      await randDelay(800, 1500);

      // Extract messages
      const messages = await page.evaluate(() => {
        const vw = window.innerWidth || 1280;

        // Try multiple selectors for message entries
        let msgEls: Element[] = Array.from(document.querySelectorAll('[data-testid="messageEntry"]'));
        if (msgEls.length === 0)
          msgEls = Array.from(document.querySelectorAll('[data-testid="DM_Message_container"]'));
        if (msgEls.length === 0) {
          // Generic: cells that contain text content and a time element
          msgEls = Array.from(document.querySelectorAll('[data-testid="cellInnerDiv"]'))
            .filter(el => !!el.querySelector("time") && !!(el as HTMLElement).innerText?.trim());
        }

        return msgEls.slice(-10).map((el: any) => {
          // Text: prefer tweetText, then dir="auto", then any lang-attributed span
          const textEl: HTMLElement | null =
            el.querySelector('[data-testid="tweetText"]') ||
            el.querySelector('[dir="auto"]') ||
            el.querySelector("span[lang]");
          const text = textEl?.innerText?.trim() ?? el.innerText?.trim() ?? "";

          // Outgoing detection: outgoing messages sit on the RIGHT side of the viewport.
          // We check the horizontal center of the element against the viewport midpoint.
          const rect = el.getBoundingClientRect();
          const centerX = rect.left + rect.width / 2;
          const isOutgoing = centerX > vw * 0.55;

          const timeEl: HTMLElement | null = el.querySelector("time");
          const timestamp = timeEl?.getAttribute("datetime") ?? new Date().toISOString();

          return { text, isOutgoing, timestamp };
        }).filter((m: any) => m.text.length > 0);
      });

      if (!messages.length) continue;

      const lastMsg = messages[messages.length - 1];

      // Skip if last message is ours (outgoing)
      if (lastMsg.isOutgoing) {
        addLog(`@${conv.username}: last msg is ours — skipping`, "info");
        continue;
      }

      // Skip if already replied (last logged message matches)
      if (existing?.messages?.length) {
        const lastLogged = existing.messages[existing.messages.length - 1];
        if (
          lastLogged.role === "xavier" &&
          new Date(lastMsg.timestamp) <=
            new Date(lastLogged.timestamp)
        ) {
          addLog(`@${conv.username}: no new messages — skipping`, "info");
          continue;
        }
      }

      addLog(`Generating reply for @${conv.username}...`, "info");

      // Build conversation history for AI
      const chatHistory: { role: "user" | "assistant"; content: string }[] = messages.map((m: any) => ({
        role: (m.isOutgoing ? "assistant" : "user") as "user" | "assistant",
        content: m.text as string,
      }));

      try {
        const aiRes = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: g.xavier_inbox_dmSystemPrompt },
            ...chatHistory,
          ],
          max_tokens: 150,
          temperature: 0.75,
        });

        const replyText = aiRes.choices[0]?.message?.content?.trim() ?? "";
        if (!replyText) continue;

        // Type and send the reply
        const inputEl = await page.$(
          '[data-testid="dmComposerTextInput"]'
        );
        if (!inputEl) {
          addLog(`@${conv.username}: DM input not found`, "error");
          continue;
        }

        await inputEl.click();
        await randDelay(400, 800);

        for (const char of replyText) {
          await page.keyboard.type(char, { delay: Math.random() * 50 + 20 });
        }
        await randDelay(600, 1200);

        // ── KEY FIX: Trigger React state updates ─────────────────────────
        await page.evaluate(() => {
          const el = document.querySelector('[data-testid="dmComposerTextInput"]') as HTMLElement | null;
          if (!el) return;
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: " " }));
        });
        await randDelay(800, 1500);

        // Send via Enter key or send button
        const sendBtn = await page.$('[data-testid="dmComposerSendButton"]');
        if (sendBtn) {
          await sendBtn.click();
        } else {
          await page.keyboard.press("Enter");
        }

        await randDelay(1000, 2000);

        // ── Handle "Unlock more on X" / "Got it" popup ───────────────────
        try {
          const gotItBtn = await page.evaluateHandle(() => {
            const buttons = Array.from(document.querySelectorAll('button[role="button"]'));
            return buttons.find(b => b.textContent?.toLowerCase().includes("got it"));
          });
          if (gotItBtn && (gotItBtn as any).asElement()) {
            addLog("Found popup after DM — clicking 'Got it'", "info");
            await (gotItBtn as any).asElement().click();
            await randDelay(1000, 2000);
          } else {
            const closeBtn = await page.$('[aria-label="Close"], [data-testid="app-bar-close"]');
            if (closeBtn) {
              addLog("Found popup — clicking close button", "info");
              await closeBtn.click();
              await randDelay(1000, 2000);
            }
          }
        } catch {}

        // Persist conversation log
        const newMessages = [
          ...messages.map((m: any) => ({
            role: m.isOutgoing ? "xavier" : "prospect",
            text: m.text,
            timestamp: m.timestamp,
            source: "tw_inbox",
          })),
          {
            role: "xavier",
            text: replyText,
            timestamp: new Date().toISOString(),
            source: "xavier_cron",
          },
        ];

        await db.collection("xavier_conversations").updateOne(
          { conversationId: conv.conversationId },
          {
            $set: {
              conversationId: conv.conversationId,
              senderUsername: conv.username,
              lastActivity: new Date().toISOString(),
              messages: newMessages,
            },
            $setOnInsert: { createdAt: new Date().toISOString() },
          },
          { upsert: true }
        );

        addLog(`Replied to @${conv.username}: "${replyText.substring(0, 60)}..."`, "success");
        repliedCount++;
        g.xavier_inbox_consecutiveErrors = 0;

        // Human-like delay between conversations
        await randDelay(3000, 6000);
      } catch (replyErr: any) {
        addLog(`Reply error for @${conv.username}: ${replyErr.message}`, "error");
        g.xavier_inbox_consecutiveErrors++;
      }
    }

    if (repliedCount === 0) {
      addLog("No new DMs to reply to", "info");
    } else {
      addLog(`Replied to ${repliedCount} conversation(s)`, "success");
    }

    if (g.xavier_inbox_consecutiveErrors >= 8) {
      addLog("8 consecutive errors — auto-stopping inbox bot", "error");
      stopInbox();
    }
  } catch (err: any) {
    addLog(`Inbox tick error: ${err.message}`, "error");
    g.xavier_inbox_consecutiveErrors++;
    if (g.xavier_inbox_consecutiveErrors >= 8) {
      addLog("8 consecutive errors — auto-stopping inbox bot", "error");
      stopInbox();
    }
  } finally {
    g.xavier_inbox_tickRunning = false;
  }
}

// ── Start / Stop ──────────────────────────────────────────────────────────────
function startInbox() {
  if (g.xavier_inbox_running) return "already_running";
  g.xavier_inbox_running = true;
  g.xavier_inbox_consecutiveErrors = 0;
  addLog("Xavier inbox bot started", "success");
  g.xavier_inbox_interval = setInterval(() => {
    inboxTick().catch((e) =>
      addLog(`Uncaught inbox error: ${e.message}`, "error")
    );
  }, 120_000); // every 2 minutes
  inboxTick().catch((e) =>
    addLog(`Initial inbox tick error: ${e.message}`, "error")
  );
  return "started";
}

function stopInbox() {
  if (g.xavier_inbox_interval) {
    clearInterval(g.xavier_inbox_interval);
    g.xavier_inbox_interval = null;
  }
  g.xavier_inbox_running = false;
  addLog("Xavier inbox bot stopped", "info");

  if (g.xavier_inbox_browser) {
    g.xavier_inbox_browser.close().catch(() => {});
    g.xavier_inbox_browser = null;
  }
  return "stopped";
}

// ── Route handlers ────────────────────────────────────────────────────────────
export async function GET() {
  return NextResponse.json({
    running: g.xavier_inbox_running ?? false,
    tickRunning: g.xavier_inbox_tickRunning ?? false,
    lastRun: g.xavier_inbox_lastRun ?? null,
    logs: g.xavier_inbox_log ?? [],
    consecutiveErrors: g.xavier_inbox_consecutiveErrors ?? 0,
    dmSystemPrompt: g.xavier_inbox_dmSystemPrompt,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action } = body;

    if (action === "start") {
      const result = startInbox();
      return NextResponse.json({
        success: true,
        message:
          result === "already_running"
            ? "Inbox bot is already running."
            : "Xavier inbox bot started.",
      });
    }

    if (action === "stop") {
      stopInbox();
      return NextResponse.json({ success: true, message: "Xavier inbox bot stopped." });
    }

    if (action === "save_prompt") {
      const { prompt } = body;
      if (!prompt?.trim()) {
        return NextResponse.json({ error: "Prompt cannot be empty" }, { status: 400 });
      }
      g.xavier_inbox_dmSystemPrompt = prompt.trim();

      // Persist to DB
      const db = await getDatabase();
      await db.collection("xavier_settings").updateOne(
        { type: "growth_settings" },
        { $set: { dmSystemPrompt: prompt.trim(), lastUpdated: new Date().toISOString() } },
        { upsert: true }
      );
      return NextResponse.json({ success: true, message: "DM prompt saved." });
    }

    if (action === "clear_logs") {
      g.xavier_inbox_log = [];
      return NextResponse.json({ success: true, message: "DM logs cleared." });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
