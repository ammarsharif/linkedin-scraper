import { NextRequest, NextResponse } from "next/server";
import {
  getDatabase,
  InstarConversationLog,
  InstarChatMessage,
} from "@/lib/mongodb";
import puppeteer, { Browser } from "puppeteer";
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

// Persistent Puppeteer browser instance for Instagram

async function getBrowser(): Promise<Browser> {
  if (!g.instarBrowser || !g.instarBrowser.connected) {
    addCronLog("Starting new Puppeteer browser for Instagram...", "info");
    g.instarBrowser = await puppeteer.launch({
      headless: false,
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
    let page = pages.find((p) => p.url().includes("instagram.com"));
    if (!page) {
      page = await browser.newPage();

      // Stealth: override automation flags
      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      });

      await page.setCookie(
        { name: "sessionid", value: sessionid, domain: ".instagram.com" },
        { name: "ds_user_id", value: ds_user_id, domain: ".instagram.com" },
        { name: "csrftoken", value: csrftoken, domain: ".instagram.com" },
        ...(mid ? [{ name: "mid", value: mid, domain: ".instagram.com" }] : []),
      );
    }

    addCronLog("Navigating to Instagram DMs...", "info");
    try {
      await page.goto("https://www.instagram.com/direct/inbox/", {
        waitUntil: "domcontentloaded",
        timeout: 45000,
      });
    } catch (e: any) {
      if (!e.message?.includes("ERR_ABORTED")) throw e;
    }

    await new Promise((r) => setTimeout(r, 5000));
    addCronLog(`Current URL: ${page.url()}`, "info");

    // Check if redirected to login
    if (page.url().includes("/accounts/login")) {
      addCronLog("Session expired – redirected to login page.", "error");
      g.instar_inbox_consecutiveErrors++;
      return;
    }

    // ── Strategy: collect ALL thread links, then determine which are unread ──
    const threads = await page.evaluate(() => {
      const results: {
        threadId: string;
        senderName: string;
        lastMessage: string;
        isPending: boolean;
      }[] = [];
      const seen = new Set<string>();

      // Helper: does this element have any unread signal?
      function isUnread(el: Element): boolean {
        // 1. Text content explicit matches
        const textContext = el.textContent?.toLowerCase() || "";
        if (
          textContext.includes("new message") ||
          textContext.includes("new request")
        )
          return true;

        // 2. Check all descendant spans/divs/p for styling
        const textNodes = el.querySelectorAll("span, div, p");
        for (const node of textNodes) {
          const style = window.getComputedStyle(node);
          const fw = style.fontWeight;
          // Instagram sometimes uses fw 600 or 700 for unread text.
          if (fw === "800" || fw === "900" || fw === "bold") {
            return true;
          }
          if (fw === "700") {
            // Often unread texts are 700
            // But let's check if the element has any sibling or not to avoid matching standard names..
            // For safety against regression, let's just return true as it was before.
            return true;
          }

          // Blue unread dots / text
          const bg = style.backgroundColor;
          if (
            bg === "rgb(0, 149, 246)" ||
            bg === "rgb(24, 119, 242)" ||
            bg.includes("var(--ig-primary-button)") ||
            bg.includes("var(--ig-primary-text)")
          )
            return true;

          const color = style.color;
          if (
            color === "rgb(0, 149, 246)" ||
            color === "rgb(24, 119, 242)" ||
            color.includes("var(--ig-primary-button)")
          )
            return true;
        }

        // 3. SVG dot – Instagram uses a small filled circle as an unread badge
        const svgs = el.querySelectorAll("svg circle, svg path");
        for (const s of svgs) {
          const fill = s.getAttribute("fill") || "";
          if (
            fill.toLowerCase().includes("#0095f6") ||
            fill.toLowerCase().includes("#1877f2")
          )
            return true;
          const colorAttr = s.getAttribute("color") || "";
          if (
            colorAttr.toLowerCase().includes("#0095f6") ||
            colorAttr.toLowerCase().includes("#1877f2")
          )
            return true;
        }

        // 4. Aria-label unread signals
        if (el.querySelector('[aria-label*="nread"]')) return true;
        if (el.querySelector('[aria-label*="ew message"]')) return true;

        // 5. Class name / innerHTML heuristics
        const htmlStr = el.innerHTML.toLowerCase();
        if (htmlStr.includes('"unread"') || htmlStr.includes("unread:true"))
          return true;

        // 6. Data attributes
        if (el.querySelector('[data-testid*="unread"]')) return true;

        // 7. Check for a notification badge (small number bubble)
        const badge = el.querySelector(
          '[aria-label*="message"], [aria-label*="Message"], [aria-label*="unread"], [aria-label*="Unread"]',
        );
        if (badge) return true;

        // 8. Unread dot character
        const textContent = el.textContent || "";
        if (textContent.includes("•")) {
          // Instagram often uses an unescaped dot character for unread messages
          return true;
        }

        return false;
      }

      function extractThread(link: HTMLAnchorElement, isPending: boolean) {
        const href = link.getAttribute("href") || "";
        if (!href.includes("/direct/t/")) return;
        const threadId = href.split("/direct/t/")[1]?.replace(/\//g, "") || "";
        if (!threadId || seen.has(threadId)) return;

        // Walk up to find the containing list item / row
        let container: Element = link;
        for (let i = 0; i < 6; i++) {
          if (container.parentElement) container = container.parentElement;
          else break;
        }

        const senderName =
          container.querySelector("img[alt]")?.getAttribute("alt") ||
          link.getAttribute("aria-label") ||
          container.querySelector("[aria-label]")?.getAttribute("aria-label") ||
          "Unknown";

        const spans = container.querySelectorAll("span, div");
        let lastMessage = "";
        for (const span of spans) {
          const t = (span as HTMLElement).innerText?.trim();
          if (
            t &&
            t.length > 3 &&
            t.length < 300 &&
            !t.includes("Active") &&
            !t.includes("active") &&
            !t.match(/^\d+[smhd]$/)
          ) {
            lastMessage = t;
          }
        }

        const unread = isPending || isUnread(container);
        if (!unread) return;

        seen.add(threadId);
        results.push({
          threadId,
          senderName:
            String(senderName).replace(/\n.*/s, "").trim() || "Unknown",
          lastMessage,
          isPending,
        });
      }

      // Scan ALL anchor tags pointing to /direct/t/ (accepted threads)
      document
        .querySelectorAll<HTMLAnchorElement>('a[href*="/direct/t/"]')
        .forEach((a) => {
          extractThread(a, false);
        });

      // Also scan message requests section — links under /direct/pending/ or /direct/requests/
      document
        .querySelectorAll<HTMLAnchorElement>(
          'a[href*="/direct/pending/"], a[href*="/direct/requests/"]',
        )
        .forEach((a) => {
          // These are requests — treat them as pending threads
          const href = a.getAttribute("href") || "";
          // Normalise: extract thread id if any
          const match = href.match(/\/direct\/(pending|requests|t)\/(\d+)/);
          if (match) {
            // Re-use extractThread but mark pending=true
            extractThread(a, true);
          }
        });

      return results;
    });

    addCronLog(`Found ${threads.length} potentially unread thread(s).`, "info");

    // ── Also check if there are pending message requests visible ──
    try {
      const requestsLink = await page.$(
        'a[href*="/direct/requests"], a[href*="message-requests"]',
      );
      if (requestsLink) {
        addCronLog(
          "Message Requests link found – navigating to check pending requests...",
          "info",
        );
        await requestsLink.click();
        await new Promise((r) => setTimeout(r, 3000));

        const pendingThreads = await page.evaluate(() => {
          const results: {
            threadId: string;
            senderName: string;
            lastMessage: string;
            isPending: boolean;
          }[] = [];
          const seen = new Set<string>();
          document
            .querySelectorAll<HTMLAnchorElement>('a[href*="/direct/t/"]')
            .forEach((a) => {
              const href = a.getAttribute("href") || "";
              const threadId =
                href.split("/direct/t/")[1]?.replace(/\//g, "") || "";
              if (!threadId || seen.has(threadId)) return;
              seen.add(threadId);
              let container: Element = a;
              for (let i = 0; i < 6; i++) {
                if (container.parentElement)
                  container = container.parentElement;
                else break;
              }
              const senderName =
                container.querySelector("img[alt]")?.getAttribute("alt") ||
                a.getAttribute("aria-label") ||
                "Unknown";
              const spans = container.querySelectorAll("span, div");
              let lastMessage = "";
              for (const span of spans) {
                const t = (span as HTMLElement).innerText?.trim();
                if (
                  t &&
                  t.length > 3 &&
                  t.length < 300 &&
                  !t.includes("Active")
                ) {
                  lastMessage = t;
                }
              }
              results.push({
                threadId,
                senderName:
                  String(senderName).replace(/\n.*/s, "").trim() || "Unknown",
                lastMessage,
                isPending: true,
              });
            });
          return results;
        });

        if (pendingThreads.length > 0) {
          addCronLog(
            `Found ${pendingThreads.length} pending message request(s).`,
            "info",
          );
          // Merge, dedup by threadId
          const existingIds = new Set(threads.map((t) => t.threadId));
          for (const pt of pendingThreads) {
            if (!existingIds.has(pt.threadId)) threads.push(pt);
          }
        }

        // Navigate back to inbox
        await page.goto("https://www.instagram.com/direct/inbox/", {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });
        await new Promise((r) => setTimeout(r, 2000));
      }
    } catch (reqErr: any) {
      addCronLog(
        `Could not check message requests: ${reqErr.message}`,
        "warning",
      );
    }

    if (threads.length === 0) {
      addCronLog("No unread DMs found.", "info");
      g.instar_inbox_consecutiveErrors = 0;
      return;
    }

    const db = await getDatabase();
    const openai = getOpenAI();

    for (const thread of threads) {
      if (!g.instar_inbox_cronRunning) {
        addCronLog("Cron stopped mid-execution. Aborting early.", "warning");
        return;
      }

      if (
        g.instar_inbox_processedThreadIds.has(
          thread.threadId + "_" + thread.lastMessage,
        )
      ) {
        addCronLog(
          `Skipping already-processed thread: ${thread.senderName}`,
          "info",
        );
        continue;
      }
      if (thread.isPending) {
        if (!g.instar_inbox_autoAcceptRequests) {
          addCronLog(
            `Thread from ${thread.senderName} is a pending request. Auto-accept is OFF – skipping.`,
            "warning",
          );
          g.instar_inbox_processedThreadIds.add(
            thread.threadId + "_" + thread.lastMessage,
          );
          continue;
        }

        addCronLog(
          `Pending request from ${thread.senderName} – attempting to auto-accept...`,
          "info",
        );
        try {
          // Navigate directly to the thread URL
          await page.goto(
            `https://www.instagram.com/direct/t/${thread.threadId}/`,
            {
              waitUntil: "domcontentloaded",
              timeout: 30000,
            },
          );
          await new Promise((r) => setTimeout(r, 3000));

          // Try to find and click the Accept / Allow button
          const acceptSelectors = [
            'button[type="submit"]',
            'button:has-text("Accept")',
            'button:has-text("Allow")',
            '[aria-label="Accept"]',
            '[aria-label="Allow"]',
          ];

          let accepted = false;
          for (const sel of acceptSelectors) {
            try {
              const btn = await page.$(sel);
              if (btn) {
                const btnText = await page.evaluate(
                  (b) => (b as HTMLElement).innerText?.toLowerCase() || "",
                  btn,
                );
                if (
                  btnText.includes("accept") ||
                  btnText.includes("allow") ||
                  sel.includes("Accept") ||
                  sel.includes("Allow")
                ) {
                  await btn.click();
                  addCronLog(
                    `Clicked accept button ("${btnText || sel}") for ${thread.senderName}.`,
                    "info",
                  );
                  accepted = true;
                  await new Promise((r) => setTimeout(r, 2500));
                  break;
                }
              }
            } catch {}
          }

          // Fallback: scan all visible buttons for accept/allow text
          if (!accepted) {
            accepted = await page.evaluate(() => {
              const buttons = Array.from(document.querySelectorAll("button"));
              for (const btn of buttons) {
                const t = btn.innerText?.toLowerCase() || "";
                if (t.includes("accept") || t.includes("allow")) {
                  btn.click();
                  return true;
                }
              }
              return false;
            });
            if (accepted) {
              addCronLog(
                `Accepted request from ${thread.senderName} via text scan.`,
                "info",
              );
              await new Promise((r) => setTimeout(r, 2500));
            }
          }

          if (!accepted) {
            addCronLog(
              `Could not find Accept button for ${thread.senderName} – skipping.`,
              "warning",
            );
            g.instar_inbox_processedThreadIds.add(
              thread.threadId + "_" + thread.lastMessage,
            );
            // Go back to inbox before next thread
            await page.goto("https://www.instagram.com/direct/inbox/", {
              waitUntil: "domcontentloaded",
              timeout: 30000,
            });
            await new Promise((r) => setTimeout(r, 2000));
            continue;
          }

          addCronLog(
            `✓ Accepted request from ${thread.senderName}. Now reading message...`,
            "success",
          );
          // thread.isPending = false — fall through to normal reply flow below
        } catch (acceptErr: any) {
          addCronLog(
            `Error auto-accepting thread from ${thread.senderName}: ${acceptErr.message}`,
            "error",
          );
          g.instar_inbox_processedThreadIds.add(
            thread.threadId + "_" + thread.lastMessage,
          );
          continue;
        }
      }

      addCronLog(`Opening DM thread from: ${thread.senderName}`, "info");

      try {
        // For pending threads we already navigated to the thread; for normal ones, click the link
        if (!thread.isPending || !page.url().includes(thread.threadId)) {
          await page.evaluate((tid) => {
            const links = document.querySelectorAll("a");
            for (const link of links) {
              if (link.href.includes(`/direct/t/${tid}`)) {
                (link as HTMLElement).click();
                break;
              }
            }
          }, thread.threadId);
          await new Promise((r) => setTimeout(r, 3000));
        }

        if (!g.instar_inbox_cronRunning) return; // double check after waits
        await new Promise((r) => setTimeout(r, 1500));

        // Read message content from the thread — multi-strategy
        const messages = await page.evaluate(() => {
          const msgs: { text: string; isMine: boolean }[] = [];

          // Strategy 1: role="row" containers (classic)
          document
            .querySelectorAll('[role="row"], [role="listitem"]')
            .forEach((el) => {
              const text = (el as HTMLElement).innerText?.trim();
              if (!text || text.length < 2 || text.length > 500) return;
              const style = window.getComputedStyle(el as HTMLElement);
              const isMine =
                style.justifyContent === "flex-end" ||
                (el as HTMLElement).style.alignSelf === "flex-end" ||
                style.alignItems === "flex-end";
              msgs.push({ text, isMine });
            });

          // Strategy 2: look for message bubbles via data-testid
          if (msgs.length === 0) {
            document
              .querySelectorAll('[data-testid*="message"], [class*="message"]')
              .forEach((el) => {
                const text = (el as HTMLElement).innerText?.trim();
                if (!text || text.length < 2 || text.length > 500) return;
                const rect = el.getBoundingClientRect();
                const containerRect = el
                  .closest('[role="main"]')
                  ?.getBoundingClientRect();
                const isMine = containerRect
                  ? rect.left > containerRect.left + containerRect.width / 2
                  : false;
                msgs.push({ text, isMine });
              });
          }

          return msgs;
        });

        const lastUserMsg = messages.filter((m) => !m.isMine).pop();
        const incomingText = lastUserMsg?.text || thread.lastMessage;

        if (!incomingText || incomingText.length < 2) {
          addCronLog(
            `No readable message in thread from ${thread.senderName}`,
            "warning",
          );
          continue;
        }

        addCronLog(
          `Generating reply to: "${incomingText.slice(0, 60)}..."`,
          "info",
        );

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
          addCronLog("AI returned empty reply.", "warning");
          continue;
        }

        addCronLog(`Sending reply: "${reply.slice(0, 60)}..."`, "info");

        // Find the message input box and type reply
        const inputSelector =
          'div[contenteditable="true"][role="textbox"], textarea[placeholder*="essage"], div[aria-label*="essage"]';
        await page.waitForSelector(inputSelector, { timeout: 8000 });
        await page.focus(inputSelector);

        // Type character by character with small delays
        for (const char of reply) {
          await page.type(inputSelector, char, { delay: 30 });
        }

        await new Promise((r) => setTimeout(r, 500));
        await page.keyboard.press("Enter");
        await new Promise((r) => setTimeout(r, 2000));

        // Log to MongoDB
        const logsCollection = db.collection<InstarConversationLog>(
          "instar_conversation_logs",
        );
        const existingLog = await logsCollection.findOne({
          threadId: thread.threadId,
        });

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

        if (existingLog) {
          await logsCollection.updateOne(
            { threadId: thread.threadId },
            {
              $push: { messages: { $each: [prospectMsg, botMsg] } },
              $set: { lastActivity: new Date().toISOString() },
            },
          );
        } else {
          await logsCollection.insertOne({
            threadId: thread.threadId,
            senderUsername: thread.senderName,
            lastActivity: new Date().toISOString(),
            createdAt: new Date().toISOString(),
            messages: [prospectMsg, botMsg],
          });
        }

        g.instar_inbox_processedThreadIds.add(
          thread.threadId + "_" + thread.lastMessage,
        );
        addCronLog(`✓ Replied to ${thread.senderName}.`, "success");

        // Small delay between threads
        await new Promise((r) => setTimeout(r, 2000));
      } catch (threadErr: any) {
        addCronLog(
          `Error processing thread ${thread.senderName}: ${threadErr.message}`,
          "error",
        );
      }
    }

    g.instar_inbox_consecutiveErrors = 0;
  } catch (err: any) {
    g.instar_inbox_consecutiveErrors++;
    addCronLog(`Cron tick error: ${err.message}`, "error");

    if (g.instar_inbox_consecutiveErrors >= 5) {
      addCronLog("5 consecutive errors – killing browser instance.", "error");
      try {
        await g.instarBrowser?.close();
      } catch {}
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
        90_000,
      );

      return NextResponse.json({ success: true, message: "DM cron started." });
    }

    if (action === "stop") {
      if (g.instar_inbox_cronInterval)
        clearInterval(g.instar_inbox_cronInterval);
      g.instar_inbox_cronInterval = null;
      g.instar_inbox_cronRunning = false;

      // Force kill the browser to ensure no ghost tasks keep running
      if (g.instarBrowser) {
        addCronLog("Closing browser to forcefully stop DM task...", "warning");
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
