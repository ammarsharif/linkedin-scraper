import { NextRequest, NextResponse } from "next/server";
import { extractJsessionId, parseCookieString } from "@/lib/linkedin";
import { getDatabase } from "@/lib/mongodb";
import { randomUUID, randomBytes } from "crypto";

/**
 * Safe fetch that handles LinkedIn's redirect behavior.
 * Uses redirect: "manual" first, then retries with "follow" if 3xx.
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

    // If redirect, try once more with follow
    if (res.status >= 300 && res.status < 400) {
      console.log(`[safeFetch] Got ${res.status} for ${url}, retrying with follow...`);
      try {
        const retryRes = await fetch(url, {
          ...options,
          redirect: "follow",
          signal: AbortSignal.timeout(15000),
        });
        if (retryRes.status === 401 || retryRes.status === 403) return null;
        return retryRes;
      } catch (retryErr) {
        console.error(`[safeFetch] Retry with follow also failed:`, retryErr);
        return null;
      }
    }

    if (res.status === 401 || res.status === 403) return null;
    return res;
  } catch (err) {
    console.error(`[safeFetch] Error fetching ${url}:`, err);
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

export interface UnreadMessage {
  conversationUrn: string;
  messageText: string;
  senderName: string;
  senderUrn: string;
  deliveredAt: number;
  status: "unread";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseUnreadMessages(data: any): UnreadMessage[] {
  let elements: any[] | undefined;

  // Try multiple nesting levels
  elements =
    data?.data?.messengerConversationsBySyncToken?.elements ??
    data?.messengerConversationsBySyncToken?.elements ??
    data?.data?.data?.messengerConversationsBySyncToken?.elements;

  if (!elements || elements.length === 0) return [];

  const results: UnreadMessage[] = [];

  for (const conv of elements) {
    if (!conv.unreadCount || conv.unreadCount === 0) continue;
    if (conv.read === true) continue;

    const messages = conv.messages?.elements || [];
    if (messages.length === 0) continue;

    // Sort newest first
    messages.sort(
      (a: { deliveredAt?: number }, b: { deliveredAt?: number }) =>
        (b.deliveredAt || 0) - (a.deliveredAt || 0)
    );
    const latest = messages[0];

    // Skip if I sent it
    const senderUrn =
      latest.actor?.hostIdentityUrn ||
      latest.sender?.hostIdentityUrn ||
      "";
    if (senderUrn === MY_PROFILE_URN) continue;

    // Skip empty messages
    const messageText = latest.body?.text || "";
    if (!messageText.trim()) continue;

    // Extract sender name
    const senderFirstName =
      latest.actor?.participantType?.member?.firstName?.text || "there";
    const senderLastName =
      latest.actor?.participantType?.member?.lastName?.text || "";
    const senderName = `${senderFirstName} ${senderLastName}`.trim();

    results.push({
      conversationUrn: conv.backendUrn,
      messageText,
      senderName,
      senderUrn,
      deliveredAt: latest.deliveredAt || Date.now(),
      status: "unread",
    });
  }

  return results;
}

// ── GET: Fetch unread conversations ──────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const cookieString = req.cookies.get("li_session")?.value;
    if (!cookieString) {
      return NextResponse.json(
        { error: "Not authenticated." },
        { status: 401 }
      );
    }

    const csrfToken = extractJsessionId(cookieString) || "";
    if (!csrfToken) {
      return NextResponse.json(
        { error: "Could not extract JSESSIONID from cookies." },
        { status: 400 }
      );
    }

    const headers = buildLinkedInHeaders(cookieString, csrfToken);
    const res = await safeFetch(LINKEDIN_API_URL, {
      headers,
      cache: "no-store",
    });

    if (!res) {
      return NextResponse.json(
        { error: "LinkedIn rejected the request — cookies may be expired. Please re-authenticate." },
        { status: 401 }
      );
    }

    if (!res.ok) {
      const status = res.status;
      if (status === 401) {
        return NextResponse.json(
          { error: "LinkedIn cookies expired. Please re-authenticate." },
          { status: 401 }
        );
      }
      return NextResponse.json(
        { error: `LinkedIn API returned ${status}` },
        { status: 502 }
      );
    }

    const data = await res.json();
    const unread = parseUnreadMessages(data);

    return NextResponse.json({
      success: true,
      unread,
      totalFetched: unread.length,
      checkedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[cindy-inbox] GET error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ── POST: Generate AI reply + Send it ────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const cookieString = req.cookies.get("li_session")?.value;
    if (!cookieString) {
      return NextResponse.json(
        { error: "Not authenticated." },
        { status: 401 }
      );
    }

    const csrfToken = extractJsessionId(cookieString) || "";
    if (!csrfToken) {
      return NextResponse.json(
        { error: "Could not extract JSESSIONID from cookies." },
        { status: 400 }
      );
    }

    const { conversationUrn, messageText, senderName, autoSend } =
      await req.json();

    if (!conversationUrn || !messageText) {
      return NextResponse.json(
        { error: "conversationUrn and messageText are required." },
        { status: 400 }
      );
    }

    // ── Step 1: Generate AI reply ──────────────────
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY not configured." },
        { status: 500 }
      );
    }

    const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        max_tokens: 150,
        messages: [
          {
            role: "system",
            content:
              "You are a professional LinkedIn assistant for Ammar Sharif, a Full Stack Engineer at SparkoSol. Reply briefly, warmly and professionally to LinkedIn messages on his behalf. Keep replies under 3 sentences. Do not use emojis.",
          },
          {
            role: "user",
            content: `Reply to this LinkedIn message from ${senderName}: ${messageText}`,
          },
        ],
      }),
    });

    const aiData = await aiRes.json();
    const replyText = (
      aiData.choices?.[0]?.message?.content?.trim() ||
      "Thank you for reaching out! I will get back to you shortly."
    )
      .replace(/"/g, "'")
      .replace(/\n/g, " ")
      .replace(/\r/g, "");

    // If autoSend is false, just return the generated reply without sending
    if (autoSend === false) {
      return NextResponse.json({
        success: true,
        reply: replyText,
        sent: false,
        conversationUrn,
      });
    }

    // ── Step 2: Build and send the reply ──────────
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
      return NextResponse.json({
        success: false,
        reply: replyText,
        sent: false,
        error: "LinkedIn rejected the send request — cookies may be expired.",
      });
    }

    if (!sendRes.ok) {
      const errText = await sendRes.text().catch(() => "Unknown error");
      console.error("[cindy-inbox] Send failed:", sendRes.status, errText);
      return NextResponse.json({
        success: false,
        reply: replyText,
        sent: false,
        error: `Failed to send: ${sendRes.status}`,
      });
    }

    // ── Step 3: Log conversation to MongoDB for Cara ──────────
    try {
      const db = await getDatabase();
      await db.collection("conversation_logs").updateOne(
        { conversationUrn },
        {
          $push: {
            messages: {
              $each: [
                { role: "prospect", text: messageText, timestamp: new Date().toISOString(), source: "linkedin_inbox" },
                { role: "cindy", text: replyText, timestamp: new Date().toISOString(), source: "cindy_auto" },
              ],
            },
          } as any,
          $set: { senderName: senderName || "Unknown", senderUrn: "", lastActivity: new Date().toISOString() },
          $setOnInsert: { createdAt: new Date().toISOString() },
        },
        { upsert: true }
      );
    } catch (logErr) {
      console.error("[cindy-inbox] Failed to log conversation:", logErr);
    }

    return NextResponse.json({
      success: true,
      reply: replyText,
      sent: true,
      conversationUrn,
      sentAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[cindy-inbox] POST error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
