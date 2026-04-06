import { NextRequest, NextResponse } from "next/server";
import { extractJsessionId, getLinkedInCookiesForCron } from "@/lib/linkedin";
import { getDatabase } from "@/lib/mongodb";
import { createSessionAlert } from "@/lib/sessionAlert";
import { randomUUID, randomBytes } from "crypto";
import { processFollowUps, markFollowUpReplied, registerFollowUp } from "@/lib/followup";
import { KnowledgeBaseEntry } from "@/lib/mongodb";

async function getKnowledgeContext(): Promise<string> {
  try {
    const db = await getDatabase();
    const entries = await db
      .collection<KnowledgeBaseEntry>("knowledge_base")
      .find({ $or: [{ botId: "cindy" }, { botId: "all" }] })
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
      botId: "cindy",
      platform: "LinkedIn",
      conversationId: params.conversationId,
      senderName: params.senderName,
      lastMessage: params.lastMessage,
      reason: params.reason,
      status: "pending",
      createdAt: new Date().toISOString(),
    });
    console.log(`[cindy-escalation] Created escalation for ${params.senderName}`);
  } catch (err) { 
    console.error(`[cindy-escalation] Failed:`, err);
  }
}

/**
 * Safe fetch that handles LinkedIn's redirect behavior.
 * Uses redirect: "manual" first, then retries once with "follow" if 3xx.
 * Returns null on auth failure (401/403) or redirect loops.
 */
async function safeFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response | null> {
  try {
    const res = await fetch(url, {
      ...options,
      redirect: "manual",
    });

    if (res.status >= 300 && res.status < 400) {
      console.log(`[safeFetch-cron] Got ${res.status}, retrying with follow...`);
      try {
        const retryRes = await fetch(url, {
          ...options,
          redirect: "follow",
          signal: AbortSignal.timeout(15000),
        });
        if (retryRes.status === 401 || retryRes.status === 403) return null;
        return retryRes;
      } catch {
        return null;
      }
    }

    if (res.status === 401 || res.status === 403) return null;
    return res;
  } catch (err) {
    console.error(`[safeFetch-cron] Error:`, err);
    return null;
  }
}

export const maxDuration = 60;

const MY_PROFILE_URN =
  "urn:li:fsd_profile:ACoAAGUt7KsBAHMQRodG7z6z8EjY3JaOMFu5TmM";

const LINKEDIN_API_URL =
  "https://www.linkedin.com/voyager/api/voyagerMessagingGraphQL/graphql" +
  "?queryId=messengerConversations.0d5e6781bbee71c3e51c8843c6519f48" +
  "&variables=(mailboxUrn:urn%3Ali%3Afsd_profile%3AACoAAGUt7KsBAHMQRodG7z6z8EjY3JaOMFu5TmM)";

// ── In-memory state for the cron ─────────────────────────────────────────────
let cronInterval: ReturnType<typeof setInterval> | null = null;
let cronRunning = false;
let cronTickRunning = false;
let cronTickStartedAt: string | null = null;
let processingConvs: Set<string> = new Set();
let lastCronRun: string | null = null;
let cronLog: { time: string; message: string; type: "info" | "success" | "error" | "warning" }[] = [];
let processedMessageIds: Set<string> = new Set();

// Keep at most 50 log entries
function addCronLog(message: string, type: "info" | "success" | "error" | "warning" = "info") {
  const entry = { time: new Date().toISOString(), message, type };
  cronLog.push(entry);
  if (cronLog.length > 50) cronLog = cronLog.slice(-50);
  console.log(`[cron][${type}] ${message}`);
}

function buildLinkedInHeaders(cookieString: string, csrfToken: string) {
  return {
    Cookie: cookieString,
    "csrf-token": csrfToken,
    Accept: "application/graphql",
    "x-restli-protocol-version": "2.0.0",
    "x-li-lang": "en_US",
    "x-li-track": JSON.stringify({
      clientVersion: "1.13.42791",
      mpVersion: "1.13.42791",
      osName: "web",
      timezoneOffset: 5,
      timezone: "Asia/Karachi",
      deviceFormFactor: "DESKTOP",
      mpName: "voyager-web",
      displayDensity: 1.25,
      displayWidth: 1920,
      displayHeight: 1080,
    }),
    Referer: "https://www.linkedin.com/messaging/",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
  };
}

function buildSendHeaders(cookieString: string, csrfToken: string) {
  return {
    Cookie: cookieString,
    "csrf-token": csrfToken,
    "Content-Type": "text/plain;charset=UTF-8",
    Accept: "application/json",
    "x-restli-protocol-version": "2.0.0",
    "x-li-lang": "en_US",
    "x-li-track": JSON.stringify({
      clientVersion: "1.13.42791",
      mpVersion: "1.13.42791",
      osName: "web",
      timezoneOffset: 5,
      timezone: "Asia/Karachi",
      deviceFormFactor: "DESKTOP",
      mpName: "voyager-web",
      displayDensity: 1.25,
      displayWidth: 1920,
      displayHeight: 1080,
    }),
    Referer: "https://www.linkedin.com/messaging/",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "sec-ch-ua-platform": "Windows",
    "sec-ch-ua-mobile": "?0",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
    "x-li-sync": "=true",
    origin: "https://www.linkedin.com",
  };
}

// The actual cron tick function
async function cronTick(fallbackCookie: string) {
  // Always try DB first so updating cookies in DB auto-renews the session
  const cookieString = await getLinkedInCookiesForCron(fallbackCookie);
  if (!cookieString) {
    addCronLog("No LinkedIn cookies available (DB and fallback both missing).", "error");
    return;
  }
  // Keep in-memory cache in sync with whatever we're using
  storedCookie = cookieString;

  const csrfToken = extractJsessionId(cookieString) || "";
  if (!csrfToken) {
    addCronLog("Could not extract JSESSIONID from cookie.", "error");
    return;
  }

  if (!cronRunning) return;
  
  if (cronTickRunning) {
    const startedAt = cronTickStartedAt ? new Date(cronTickStartedAt).getTime() : 0;
    const runningForMs = Date.now() - startedAt;
    if (runningForMs < 10 * 60 * 1000) {
      addCronLog(`Cron tick already running (for ${Math.round(runningForMs / 1000)}s) — skipping`, "warning");
      return;
    }
    addCronLog(`Stale tick lock detected (${Math.round(runningForMs / 1000)}s) — force resetting`, "warning");
    processingConvs = new Set();
  }
  cronTickRunning = true;
  cronTickStartedAt = new Date().toISOString();

  lastCronRun = new Date().toISOString();
  addCronLog("Checking for unread messages...", "info");

  try {
    // ── Fetch conversations ──
    const headers = buildLinkedInHeaders(cookieString, csrfToken);
    const res = await safeFetch(LINKEDIN_API_URL, { headers, cache: "no-store" as RequestCache });

    if (!res) {
      addCronLog("LinkedIn rejected request — cookies may be expired.", "error");
      await createSessionAlert("cindy", "LinkedIn");
      stopCron();
      return;
    }

    if (!res.ok) {
      if (res.status === 401) {
        addCronLog("LinkedIn cookies expired (401). Please re-authenticate.", "error");
        await createSessionAlert("cindy", "LinkedIn");
        stopCron();
        return;
      }
      addCronLog(`LinkedIn API error: ${res.status}`, "error");
      return;
    }

    const data = await res.json();

    // ── Parse unread ──
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let elements: any[] | undefined;
    elements =
      data?.data?.messengerConversationsBySyncToken?.elements ??
      data?.messengerConversationsBySyncToken?.elements ??
      [];

    if (!elements || elements.length === 0) {
      addCronLog("No conversations returned.", "info");
      return;
    }

    let newMessages = 0;

    for (const conv of elements) {
      if (!cronRunning) {
        addCronLog("Cron stopped mid-execution. Aborting early.", "warning");
        return;
      }
      if (!conv.unreadCount || conv.unreadCount === 0) continue;
      if (conv.read === true) continue;

      const messages = conv.messages?.elements || [];
      if (messages.length === 0) continue;

      // Sort newest first
      messages.sort(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (a: any, b: any) => (b.deliveredAt || 0) - (a.deliveredAt || 0)
      );
      const latest = messages[0];

      // Build unique ID
      const msgId = latest.backendUrn || String(latest.deliveredAt || "");
      if (processedMessageIds.has(msgId)) continue;

      // Skip if I sent it
      const senderUrn =
        latest.actor?.hostIdentityUrn ||
        latest.sender?.hostIdentityUrn ||
        "";
      if (senderUrn === MY_PROFILE_URN) continue;

      const messageText = (latest.body?.text || "").trim();
      if (!messageText) continue;

      const senderFirstName =
        latest.actor?.participantType?.member?.firstName?.text || "there";
      const senderLastName =
        latest.actor?.participantType?.member?.lastName?.text || "";
      const senderName = `${senderFirstName} ${senderLastName}`.trim();
      const conversationUrn = conv.backendUrn;

      addCronLog(`New message from ${senderName}: "${messageText.slice(0, 60)}..."`, "info");

      // ── Concurrency Check ──
      if (processingConvs.has(conversationUrn)) {
        addCronLog(`Skipping ${senderName} — already being processed.`, "warning");
        continue;
      }
      
      const db = await getDatabase();
      const existingConv = await db.collection("conversation_logs").findOne({ conversationUrn });
      if (existingConv?.processingLockedAt) {
        const lockedMs = Date.now() - new Date(existingConv.processingLockedAt).getTime();
        if (lockedMs < 5 * 60 * 1000) {
          addCronLog(`Skipping ${senderName} — DB lock active (${Math.round(lockedMs / 1000)}s ago)`, "warning");
          continue;
        }
        addCronLog(`Cleared stale DB lock for ${senderName}`, "info");
      }
      
      processingConvs.add(conversationUrn);
      await db.collection("conversation_logs").updateOne(
        { conversationUrn },
        { $set: { processingLockedAt: new Date().toISOString() } },
        { upsert: true }
      );

      // Auto-mark any active follow-up thread for this user as replied
      await markFollowUpReplied("cindy", conversationUrn);

      // ── Generate AI reply ──
      const openaiKey = process.env.OPENAI_API_KEY;
      if (!openaiKey) {
        addCronLog("OPENAI_API_KEY not set. Cannot generate reply.", "error");
        continue;
      }

      try {
        // Build chatHistory from last 10 messages (API returns newest-first, reverse to chronological)
        const chatHistory: { role: "user" | "assistant"; content: string }[] = messages
          .slice(0, 10)
          .reverse()
          .filter((m: any) => (m.body?.text || "").trim())
          .map((m: any) => {
            const mSenderUrn = m.actor?.hostIdentityUrn || m.sender?.hostIdentityUrn || "";
            return {
              role: (mSenderUrn === MY_PROFILE_URN ? "assistant" : "user") as "user" | "assistant",
              content: (m.body?.text || "").trim(),
            };
          });
      const knowledgeCtx = await getKnowledgeContext();
        const systemPromptWithContext = 
          "You are a professional LinkedIn assistant for Ammar Sharif, a Full Stack Engineer at SparkoSol. Reply briefly, warmly and professionally to LinkedIn messages on his behalf. Keep replies under 3 sentences. Do not use emojis." +
          knowledgeCtx + `
  
ANTI-HALLUCINATION RULES (CRITICAL):
- Use ONLY the provided Company Knowledge Base as your source of truth.
- If the prospect asks something NOT covered in the Knowledge Base, you MUST reply with this EXACT phrase: "Let me confirm this for you — our team will follow up shortly. ##ESCALATE## <short reason>"
- Replacement of "confirm" with "review" or other words is NOT allowed.
- You MUST include the tag ##ESCALATE## whenever you cannot answer from the Knowledge Base.
- NEVER invent prices, technical details, or commitments.
- If you can answer confidently using the Knowledge Base, do NOT include ##ESCALATE##.`;

        const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${openaiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            max_tokens: 156, // and some buffer 
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
          await createEscalation({
            conversationId: conversationUrn,
            senderName,
            lastMessage: messageText,
            reason: escalationReason,
          });
          addCronLog(`Escalated ${senderName}: ${escalationReason}`, "info");
        }

        const replyText = rawReply
          .replace(/"/g, "'")
          .replace(/\n/g, " ")
          .replace(/\r/g, "");

        // ── Send reply ──
        const rawThreadId = conversationUrn.replace("urn:li:messagingThread:", "");
        const fullConversationUrn = `urn:li:msg_conversation:(${MY_PROFILE_URN},${rawThreadId})`;
        const originToken = randomUUID();
        const trackingId = randomBytes(16).toString("binary");

        const sendBody = JSON.stringify({
          message: {
            body: { attributes: [], text: replyText },
            renderContentUnions: [],
            conversationUrn: fullConversationUrn,
            originToken,
          },
          mailboxUrn: MY_PROFILE_URN,
          trackingId,
          dedupeByClientGeneratedToken: false,
        });

        const sendHeaders = buildSendHeaders(cookieString, csrfToken);
        const sendRes = await safeFetch(
          "https://www.linkedin.com/voyager/api/voyagerMessagingDashMessengerMessages?action=createMessage",
          {
            method: "POST",
            headers: sendHeaders,
            body: sendBody,
          }
        );

        if (!sendRes) {
          addCronLog(`LinkedIn rejected send for ${senderName} — auth issue.`, "error");
        } else if (sendRes.ok) {
          processedMessageIds.add(msgId);
          newMessages++;
          addCronLog(`✅ Replied to ${senderName}: "${replyText.slice(0, 50)}..."`, "success");

          // Register for automated follow-up tracking
          await registerFollowUp("cindy", conversationUrn, senderName, replyText, "msg_" + Date.now(), false, messageText);

          // Log conversation to MongoDB for Cara
          try {
            const db = await getDatabase();
            await db.collection("conversation_logs").updateOne(
              { conversationUrn },
              {
                $push: {
                  messages: {
                    $each: [
                      { role: "prospect", text: messageText, timestamp: new Date().toISOString(), source: "linkedin_inbox" },
                      { role: "cindy", text: replyText, timestamp: new Date().toISOString(), source: "cindy_cron" },
                    ],
                  },
                } as any,
                $set: { senderName, senderUrn, lastActivity: new Date().toISOString() },
                $unset: { processingLockedAt: "" },
                $setOnInsert: { createdAt: new Date().toISOString() },
              },
              { upsert: true }
            );
          } catch (logErr) {
            addCronLog(`Failed to log conversation for ${senderName}`, "warning");
          }
        } else {
          addCronLog(`Failed to send reply to ${senderName}: ${sendRes.status}`, "error");
        }
      } catch (aiErr) {
        const errMsg = aiErr instanceof Error ? aiErr.message : "Unknown AI error";
        addCronLog(`AI/Send error for ${senderName}: ${errMsg}`, "error");
      } finally {
        processingConvs.delete(conversationUrn);
        await db.collection("conversation_logs").updateOne({ conversationUrn }, { $unset: { processingLockedAt: "" } }).catch(()=>{});
      }
    }

    if (newMessages === 0) {
      addCronLog("No new unread messages this cycle.", "info");
    } else {
      addCronLog(`Processed ${newMessages} new message(s).`, "success");
    }

    // Process any pending follow-ups for Cindy
    const { sent } = await processFollowUps("cindy", addCronLog);
    if (sent > 0) addCronLog(`Follow-up scheduler: ${sent} follow-up(s) dispatched.`, "success");
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    addCronLog(`Cron error: ${msg}`, "error");
  } finally {
    cronTickRunning = false;
    cronTickStartedAt = null;
    processingConvs.clear();
  }
}

// Store cookie for background cron usage
let storedCookie: string | null = null;

function startCron(cookieString: string) {
  if (cronInterval) return;
  storedCookie = cookieString;
  cronRunning = true;
  addCronLog("Cron started — checking every 60 seconds.", "success");

  // Run immediately
  cronTick(cookieString);

  // Then every 60 seconds
  cronInterval = setInterval(() => {
    if (storedCookie) cronTick(storedCookie);
  }, 60_000);
}

function stopCron() {
  if (cronInterval) {
    clearInterval(cronInterval);
    cronInterval = null;
  }
  cronRunning = false;
  storedCookie = null;
  addCronLog("Cron stopped.", "warning");
}

// ── GET: Get cron status ─────────────────────────────────────────────────────
export async function GET() {
  return NextResponse.json({
    running: cronRunning,
    tickRunning: cronTickRunning,
    lastRun: lastCronRun,
    processedCount: processedMessageIds.size,
    logs: cronLog.slice(-30),
    processingConversations: [...processingConvs]
  });
}

// ── POST: Start/Stop the cron ────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action } = body;

    if (action === "send_followup") {
      const { conversationUrn, messageText: msg, senderName: sName } = body;
      if (!storedCookie) {
        return NextResponse.json({ sent: false, error: "Cron not running" });
      }
      try {
        const csrfToken = extractJsessionId(storedCookie) || "";
        const rawThreadId = conversationUrn.replace("urn:li:messagingThread:", "");
        const fullConversationUrn = `urn:li:msg_conversation:(${MY_PROFILE_URN},${rawThreadId})`;
        const originToken = randomUUID();
        const trackingId = randomBytes(16).toString("binary");
        const sendBody = JSON.stringify({
          message: { body: { attributes: [], text: msg }, renderContentUnions: [], conversationUrn: fullConversationUrn, originToken },
          mailboxUrn: MY_PROFILE_URN,
          trackingId,
          dedupeByClientGeneratedToken: false,
        });
        const sendRes = await safeFetch(
          "https://www.linkedin.com/voyager/api/voyagerMessagingDashMessengerMessages?action=createMessage",
          { method: "POST", headers: buildSendHeaders(storedCookie, csrfToken), body: sendBody }
        );
        if (sendRes?.ok) {
          addCronLog(`Follow-up sent to ${sName} (${conversationUrn.slice(-10)})`, "success");
          return NextResponse.json({ sent: true });
        }
        return NextResponse.json({ sent: false, error: "LinkedIn rejected send" });
      } catch (err: any) {
        addCronLog(`send_followup error: ${err.message}`, "error");
        return NextResponse.json({ sent: false, error: err.message });
      }
    }

    if (action === "start") {
      // Prefer DB cookies (source of truth); fallback to request cookie
      const cookieString = await getLinkedInCookiesForCron(req.cookies.get("li_session")?.value);
      if (!cookieString) {
        return NextResponse.json(
          { error: "Not authenticated. Please log in first." },
          { status: 401 }
        );
      }

      if (cronRunning) {
        return NextResponse.json({
          success: true,
          message: "Cron is already running.",
          running: true,
        });
      }

      processedMessageIds = new Set();
      startCron(cookieString);
      return NextResponse.json({
        success: true,
        message: "Cron started successfully.",
        running: true,
      });
    }

    if (action === "stop") {
      stopCron();
      return NextResponse.json({
        success: true,
        message: "Cron stopped.",
        running: false,
      });
    }

    if (action === "clear-logs") {
      cronLog = [];
      return NextResponse.json({ success: true, message: "Logs cleared." });
    }

    if (action === "reset-processed") {
      processedMessageIds = new Set();
      return NextResponse.json({
        success: true,
        message: "Processed message IDs reset.",
      });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err) {
    console.error("[cron] POST error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
