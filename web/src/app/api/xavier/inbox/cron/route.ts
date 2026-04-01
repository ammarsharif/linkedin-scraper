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

// ── X DM API response parsers (network-intercept approach) ────────────────────
function parseXInboxFromApiResponse(json: any, myUserId: string) {
  const state =
    json?.inbox_initial_state ||
    json?.data?.inbox_initial_state ||
    json?.data?.dm_inbox_state;
  if (!state) return [];
  const conversations = (state.conversations as Record<string, any>) || {};
  const users = (state.users as Record<string, any>) || {};
  return Object.values(conversations)
    .filter((c: any) => c.conversation_id)
    .slice(0, 10)
    .map((conv: any) => {
      const otherP =
        (conv.participants || []).find((p: any) => p.user_id !== myUserId) ||
        conv.participants?.[0];
      const userInfo = users[otherP?.user_id || ""] || {};
      const username = userInfo.screen_name || "";
      const unread = (conv.unread_count ?? 0) > 0;
      const href = `/messages/${conv.conversation_id}`;
      return { conversationId: conv.conversation_id, username, href, unread, preview: "" };
    })
    .filter((c: any) => c.conversationId);
}

function parseXMessagesFromApiResponse(json: any, myUserId: string) {
  // Try multiple response shapes from X's API
  const timeline =
    json?.data?.conversation_timeline ||
    json?.conversation_timeline ||
    {};
  const entries: any[] =
    (timeline.entries as any[]) || (json?.entries as any[]) || [];

  const results: { text: string; isOutgoing: boolean; timestamp: string }[] = [];

  for (const e of entries) {
    // Shape 1: GraphQL DM timeline
    const itemContent = e?.content?.item_content;
    if (itemContent?.message) {
      const msg = itemContent.message;
      const text = msg.text || msg.message_data?.text || "";
      const senderId = msg.sender_id || msg.message_data?.sender_id || "";
      if (text) {
        results.push({
          text,
          isOutgoing: senderId === myUserId,
          timestamp: msg.sent_at_secs
            ? new Date(parseInt(msg.sent_at_secs) * 1000).toISOString()
            : new Date().toISOString(),
        });
      }
      continue;
    }
    // Shape 2: REST inbox_initial_state message entries
    const msg = e?.message?.message_data;
    if (msg?.text) {
      results.push({
        text: msg.text,
        isOutgoing: msg.sender_id === myUserId,
        timestamp: msg.time
          ? new Date(parseInt(msg.time)).toISOString()
          : new Date().toISOString(),
      });
    }
  }

  return results.slice(-10).filter((m) => m.text.length > 0);
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

    // ── Intercept X DM API responses (API-first approach) ────────────────────
    let apiInboxData: any = null;
    let apiConvData: any = null;
    const _inboxApiHandler = async (res: import("puppeteer").HTTPResponse) => {
      try {
        const url = res.url();
        if (
          url.includes("inbox_initial_state") ||
          url.includes("DmAllSearchSlice") ||
          url.includes("InboxTimeline") ||
          url.includes("DirectMessageConversation")
        ) {
          const json = await res.json().catch(() => null);
          if (json) {
             if (url.includes("DirectMessageConversation")) {
               apiConvData = json;
             } else {
               apiInboxData = json;
             }
          }
        }
      } catch {}
    };
    page.on("response", _inboxApiHandler);
    page.on("console", (msg) => {
      // Filter out noisy messages but keep detection logs
      if (msg.text().includes('XAVIER')) {
        addLog(`Browser Log: ${msg.text()}`, "info");
      }
    });

    // Navigate to DMs — X now uses /i/chat
    await page.goto("https://x.com/i/chat", {
      waitUntil: "networkidle2",
      timeout: 40000,
    });
    await randDelay(3000, 5000);
    page.off("response", _inboxApiHandler);

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

    // ── API-first: use intercepted response if available ─────────────────────
    const myUserId = (sessionDoc.twid || "").replace("u=", "");
    const apiConversations = apiInboxData
      ? parseXInboxFromApiResponse(apiInboxData, myUserId)
      : [];
    if (apiConversations.length > 0) {
      addLog(`API: found ${apiConversations.length} conversation(s) — skipping DOM extraction`, "info");
    }

    // Wait for conversations list to appear — try multiple selectors
    const CONV_SELECTORS = [
      '[data-testid="conversation"]',
      '[data-testid="DMConversation"]',
      '[data-testid="cellInnerDiv"]',
      '[data-testid^="dm-conversation-item-"]',
      'a[role="link"][href*="/messages/"]',
      'a[role="link"][href*="/i/chat/"]',
    ];
    let selectorFound = false;
    for (const sel of CONV_SELECTORS) {
      try {
        await page.waitForSelector(sel, { timeout: 15000 });
        selectorFound = true;
        addLog(`Inbox component visible (selector: ${sel})`, "info");
        break;
      } catch { /* try next */ }
    }
    if (!selectorFound) {
      const debugInfo = await page.evaluate(() => {
        const ids = Array.from(document.querySelectorAll('[data-testid]')).map(el => el.getAttribute('data-testid'));
        const links = Array.from(document.querySelectorAll('a')).map(a => a.getAttribute('href')).filter(h => h?.includes('messages'));
        return { ids: [...new Set(ids)].slice(0, 50), links: [...new Set(links)] };
      });
      addLog(`Inbox list selector timeout — testids: ${debugInfo.ids.join(', ')} — links: ${debugInfo.links.join(', ')}`, "warning");
      await page.screenshot({ path: "./xavier_inbox_debug.png" }).catch(() => {});
    }
    await randDelay(3000, 5000);

    const conversations = apiConversations.length > 0 ? apiConversations : await page.evaluate(() => {
      let rows: Element[] = [];

      // Strategy 1: primary data-testids
      for (const sel of ['[data-testid="conversation"]', '[data-testid="DMConversation"]', '[data-testid^="dm-conversation-item-"]']) {
        rows = Array.from(document.querySelectorAll(sel));
        if (rows.length > 0) break;
      }

      // Strategy 2: cellInnerDiv wrappers that contain a messages link
      if (rows.length === 0) {
        rows = Array.from(document.querySelectorAll('[data-testid="cellInnerDiv"]'))
          .filter(el => !!el.querySelector('a[href*="/messages/"]') || !!el.querySelector('a[href*="/i/chat/"]'));
      }

      // Strategy 3: walk up from every unique /messages/{id} link
      if (rows.length === 0) {
        // Find ALL links that look like a message conversation
        const links = Array.from(document.querySelectorAll('a[href*="/messages/"], a[href*="/i/chat/"]')) as HTMLAnchorElement[];
        console.log(`XAVIER: Found ${links.length} potential message links`);
        
        const seen = new Set<string>();
        for (const a of links) {
          const h = a.getAttribute("href") || "";
          // Skip the main inbox link itself
          if (h.endsWith("/messages") || h.endsWith("/messages/") || h.endsWith("/i/chat") || h.endsWith("/i/chat/") || seen.has(h)) continue;
          seen.add(h);
          
          let node: Element = a;
          // Row detection: go up to find the full container that includes the unread dot
          let count = 0;
          while (node.parentElement && node.getBoundingClientRect().height < 80 && count < 8) {
             node = node.parentElement;
             count++;
          }
          // Final check: if it has a direct parent with a meaningful aria-label or testid, go there
          if (node.parentElement?.getAttribute('data-testid')?.startsWith('dm-conversation-item-') ||
              node.parentElement?.getAttribute('aria-label')?.toLowerCase().includes('conversation')) {
            node = node.parentElement;
          }
          rows.push(node);
        }
        console.log(`XAVIER: Strategy 3 found ${rows.length} rows`);
      }

      return rows.slice(0, 10).map((row: any) => {
        const link: HTMLAnchorElement | null =
          row.tagName === "A" ? row : (row.querySelector('a[href*="/messages/"]') || row.querySelector('a[href*="/i/chat/"]'));
        const href = link?.getAttribute("href") || "";
        const conversationId = href.split("/").pop() || "";

        // Username: use aria-label on the row, or pull all visible text nodes and pick the name
        // The conversation item aria-label is typically "Conversation with DisplayName"
        const ariaLabel = (row as HTMLElement).getAttribute("aria-label") ?? "";
        const fromAriaLabel = ariaLabel.replace(/conversation with /i, "").trim();

        // Fallback: first short text span that isn't @ and isn't the preview
        const allSpans = Array.from(row.querySelectorAll("span")) as HTMLElement[];
        const atSpan = allSpans.find(s => s.textContent?.trim().startsWith("@") && s.textContent!.trim().length < 30);
        const nameSpan = allSpans.find(s => {
          const t = s.textContent?.trim() ?? "";
          return t.length > 0 && t.length < 50 && !t.startsWith("@") && !t.match(/^\d/) && s.children.length === 0;
        });

        const displayName = fromAriaLabel || nameSpan?.textContent?.trim() || "";
        const username = atSpan
          ? atSpan.textContent!.trim().replace("@", "")
          : displayName.replace(/\s+/g, "_").toLowerCase() || conversationId;

        const ltrSpans = Array.from(row.querySelectorAll('[dir="ltr"]')) as HTMLElement[];

        const previewEl: HTMLElement | null =
          row.querySelector('[data-testid="tweetText"]') ||
          row.querySelector('[dir="auto"] span');
        const preview = previewEl?.innerText?.trim() ?? "";

        // Unread detection: X shows a filled blue circle for unread conversations
        // Strategy 1: data-testid badges
        const hasBadge =
          !!row.querySelector('[data-testid="unread-badge"]') ||
          !!row.querySelector('[data-testid="badge"]') ||
          !!row.querySelector('[aria-label*="unread"]') ||
          !!row.querySelector('[aria-label*="New Message"]') ||
          !!row.querySelector('[aria-label*="nread"]');

        // Strategy 2: look for a small filled circle (the blue dot) by size + shape
        const hasBlueCircle = !!Array.from(row.querySelectorAll('div, span')).find((el: any) => {
          const w = el.offsetWidth;
          const h = el.offsetHeight;
          if (w < 4 || w > 20 || Math.abs(w - h) > 4) return false;
          const style = window.getComputedStyle(el);
          const bg = style.backgroundColor;
          // Twitter blue variants
          return bg.includes('29, 155') || bg.includes('1, 161') || bg.includes('0, 111') || bg.includes('29,155');
        });

        // Strategy 3: bold/heavy font-weight on the display name often indicates unread
        const hasBoldName = ltrSpans.length > 0 && (() => {
          const style = window.getComputedStyle(ltrSpans[0]);
          const fw = parseInt(style.fontWeight || "400");
          return fw >= 700;
        })();

        const unread = hasBadge || hasBlueCircle || hasBoldName;

        console.log(`XAVIER: Row for @${username} (${displayName}) unread=${unread} badge=${hasBadge} circle=${hasBlueCircle} bold=${hasBoldName} preview="${preview.substring(0, 30)}"`);

        return { conversationId, username, displayName, preview, href, unread };
      }).filter((c: any) => c.conversationId && /^\d/.test(c.conversationId));
    });

    const unreadCount = conversations.filter(c => c.unread).length;
    addLog(`Found ${conversations.length} conversations (${unreadCount} unread)`, "info");

    let repliedCount = 0;
    for (const conv of conversations) {
      if (!conv.conversationId || !conv.href) continue;

      // Check DB for this conversation
      const existing = await db
        .collection("xavier_conversations")
        .findOne({ conversationId: conv.conversationId });

      // Skip if we replied within the last 2 hours (avoid double-replies)
      if (existing?.messages?.length) {
        const lastXavierMsg = [...existing.messages].reverse().find((m: any) => m.role === "xavier");
        if (lastXavierMsg) {
          const msSinceReply = Date.now() - new Date(lastXavierMsg.timestamp).getTime();
          if (msSinceReply < 2 * 60 * 60 * 1000) {
            // Still skip unread: if it says unread=false AND we replied recently, skip
            if (!conv.unread) {
              addLog(`@${conv.username}: replied recently (${Math.round(msSinceReply / 60000)}m ago) — skipping`, "info");
              continue;
            }
          }
        }
      }

      // Set up API interceptor BEFORE clicking into conversation
      let convApiData: any = null;
      const convApiHandler = async (res: import("puppeteer").HTTPResponse) => {
        try {
          const url = res.url();
          if (
            url.includes("DirectMessageConversation") ||
            url.includes("conversation_timeline") ||
            url.includes("DmConversationByConversationId") ||
            url.includes("dm_conversation")
          ) {
            const json = await res.json().catch(() => null);
            if (json) convApiData = json;
          }
        } catch {}
      };
      page.on("response", convApiHandler);

      addLog(`Opening conversation with @${conv.username}...`, "info");

      // Use page.click() with the selector string — triggers React router properly
      const convLinkSel = `a[href*="${conv.conversationId}"]`;
      const linkExists = await page.$(convLinkSel);

      if (linkExists) {
        await page.click(convLinkSel);
      } else {
        // Fallback: direct navigation
        await page.goto(`https://x.com${conv.href}`, { waitUntil: "domcontentloaded", timeout: 20000 });
      }

      // Wait for the DM message list — confirmed testid from X's current DOM
      const panelReady = await page.waitForSelector(
        '[data-testid="dm-message-list"], [data-testid="dm-conversation-panel"]',
        { timeout: 12000 }
      ).then(() => true).catch(() => false);

      page.off("response", convApiHandler);

      if (!panelReady) {
        const debugIds = await page.evaluate(() =>
          [...new Set(Array.from(document.querySelectorAll("[data-testid]"))
            .map(el => el.getAttribute("data-testid")))].slice(0, 60).join(", ")
        ).catch(() => "");
        addLog(`@${conv.username}: panel not ready. testids: ${debugIds}`, "warning");
        await page.screenshot({ path: "./xavier_conv_debug.png" }).catch(() => {});
        await page.goto("https://x.com/i/chat", { waitUntil: "domcontentloaded", timeout: 15000 });
        await randDelay(1500, 2000);
        continue;
      }

      addLog(`Conversation panel loaded`, "info");
      await randDelay(800, 1500);

      // Get real username from the conversation header (confirmed testid: dm-conversation-username)
      const headerUsername = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="dm-conversation-username"]');
        return el?.textContent?.trim() ?? "";
      }).catch(() => "");
      if (headerUsername) conv.username = headerUsername;

      // Extract messages
      let finalMessages: { text: string; isOutgoing: boolean; timestamp: string }[] = [];

      // ── API-First Extraction ───────────────────────────────────────────────
      if (convApiData) {
        try {
          finalMessages = parseXMessagesFromApiResponse(convApiData, myUserId);
          if (finalMessages.length > 0) {
            addLog(`Captured ${finalMessages.length} messages via Network API`, "success");
          }
        } catch {}
      }

      // ── DOM Fallback using X's confirmed testid pattern ───────────────────
      if (finalMessages.length === 0) {
        finalMessages = await page.evaluate(() => {
          // X's confirmed testid: message-text-{uuid}
          let msgTextEls = Array.from(document.querySelectorAll('[data-testid^="message-text-"]')) as HTMLElement[];
          if (msgTextEls.length === 0) {
            msgTextEls = Array.from(document.querySelectorAll('[data-testid="messageEntry"], [data-testid="DM_Message_container"]')) as HTMLElement[];
          }
          if (msgTextEls.length === 0) return [];

          // Use the message list panel as reference for relative positioning.
          // The message-{uuid} wrapper is full-width (flex row), so we MUST
          // measure position relative to the panel, not the viewport.
          const listEl = (
            document.querySelector('[data-testid="dm-message-list"]') ??
            document.querySelector('[data-testid="dm-message-list-container"]') ??
            document.querySelector('[data-testid="dm-conversation-content"]')
          ) as HTMLElement | null;
          const listRect = listEl?.getBoundingClientRect();
          const panelLeft = listRect?.left ?? 0;
          const panelWidth = listRect?.width ?? window.innerWidth;

          return msgTextEls.slice(-15).flatMap((el: HTMLElement) => {
            const text = el.innerText?.trim() ?? "";
            if (!text) return [];

            // Use the text element's own rect — it sits inside the bubble which is
            // left- or right-aligned within the full-width message-{uuid} wrapper.
            const rect = el.getBoundingClientRect();
            const relCenter = panelWidth > 0
              ? (rect.left + rect.width / 2 - panelLeft) / panelWidth
              : 0.5;
            // Outgoing messages sit in the right half of the conversation panel
            const isOutgoing = relCenter > 0.55;

            console.log(`XAVIER MSG: "${text.substring(0, 30)}" relCenter=${relCenter.toFixed(2)} outgoing=${isOutgoing}`);

            const timeEl = (el.parentElement?.querySelector("time") ?? el.querySelector("time")) as HTMLTimeElement | null;
            const timestamp = timeEl?.getAttribute("datetime") ?? new Date().toISOString();
            return [{ text, isOutgoing, timestamp }];
          });
        }) as { text: string; isOutgoing: boolean; timestamp: string }[];
        if (finalMessages.length > 0) {
          addLog(`Extracted ${finalMessages.length} messages via DOM`, "info");
        }
      }

      const messages = finalMessages;
      if (!messages.length) {
        addLog(`@${conv.username}: no messages found — skipping`, "warning");
        continue;
      }

      const lastMsg = messages[messages.length - 1];

      // Skip if last message is ours (outgoing)
      if (lastMsg.isOutgoing) {
        addLog(`@${conv.username}: last msg is outgoing — skipping`, "info");
        continue;
      }

      // Skip if we've already replied to this exact last message
      if (existing?.messages?.length) {
        const lastXavierMsg = [...existing.messages].reverse().find((m: any) => m.role === "xavier");
        if (lastXavierMsg && new Date(lastMsg.timestamp) <= new Date(lastXavierMsg.timestamp)) {
          addLog(`@${conv.username}: no new messages since last reply — skipping`, "info");
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

        // Click the composer container to focus it, then find the contenteditable inside
        await page.click('[data-testid="dm-composer-container"]').catch(() => {});
        await randDelay(400, 700);

        // Find the contenteditable text input inside the composer
        const INPUT_SELECTORS = [
          '[data-testid="dm-composer-container"] [contenteditable="true"]',
          '[data-testid="dm-composer-container"] [role="textbox"]',
          '[data-testid="dm-composer-container"] textarea',
          '[contenteditable="true"]',
        ];
        let inputEl = null;
        for (const sel of INPUT_SELECTORS) {
          inputEl = await page.$(sel);
          if (inputEl) break;
        }
        if (!inputEl) {
          addLog(`@${conv.username}: DM input not found`, "error");
          continue;
        }

        await inputEl.click();
        await randDelay(300, 600);

        // Type the reply character by character (human-like)
        for (const char of replyText) {
          await page.keyboard.type(char, { delay: Math.random() * 40 + 15 });
        }
        await randDelay(500, 1000);

        // Trigger React input events so send button activates
        await page.evaluate(() => {
          const el = document.querySelector('[data-testid="dm-composer-container"] [contenteditable="true"]') as HTMLElement | null
            ?? document.querySelector('[contenteditable="true"]') as HTMLElement | null;
          if (!el) return;
          el.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        });
        await randDelay(600, 1200);

        // Send — no send button testid found in X's current DOM, use Enter key
        await page.keyboard.press("Enter");

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

        // Human-like delay, then return to inbox for next conversation
        await randDelay(2000, 3500);
        await page.goto("https://x.com/i/chat", { waitUntil: "domcontentloaded", timeout: 15000 });
        await randDelay(1500, 2500);
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
  }, 5 * 60_000); // every 5 minutes
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
