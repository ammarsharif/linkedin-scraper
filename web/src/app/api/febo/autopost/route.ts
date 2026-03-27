import { NextRequest, NextResponse } from "next/server";
import { getDatabase } from "@/lib/mongodb";
import puppeteer, { Browser } from "puppeteer";

export const maxDuration = 60;

const g = globalThis as unknown as { feboPostBrowser?: Browser };

async function getPostBrowser(): Promise<Browser> {
  if (!g.feboPostBrowser || !g.feboPostBrowser.connected) {
    g.feboPostBrowser = await puppeteer.launch({
      headless: false,
      userDataDir: "./fb_puppeteer_profile",
      defaultViewport: { width: 1280, height: 900 },
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-notifications"],
    });
  }
  return g.feboPostBrowser;
}

// ── POST: Publish approved content to Facebook ─────────────────────────────
// Body: { content: string, contentId?: string }
export async function POST(req: NextRequest) {
  try {
    const cookieString = req.cookies.get("li_session")?.value;
    if (!cookieString) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    const { content, contentId } = await req.json();

    if (!content?.trim()) {
      return NextResponse.json({ error: "content is required." }, { status: 400 });
    }

    const db = await getDatabase();

    // Load Felix's Facebook session (shared FB cookies)
    const sessionDoc = await db
      .collection("felix_config")
      .findOne({ type: "fb_session" });

    if (!sessionDoc?.c_user || !sessionDoc?.xs) {
      return NextResponse.json(
        {
          error:
            "No Facebook session found. Please set up Felix (FB session) first.",
        },
        { status: 400 }
      );
    }

    const { c_user, xs, datr } = sessionDoc as unknown as {
      c_user: string;
      xs: string;
      datr?: string;
    };

    const browser = await getPostBrowser();
    const page = await browser.newPage();

    try {
      await page.setCookie(
        { name: "c_user", value: c_user, domain: ".facebook.com" },
        { name: "xs", value: xs, domain: ".facebook.com" },
        ...(datr ? [{ name: "datr", value: datr, domain: ".facebook.com" }] : [])
      );

      // Navigate to Facebook home
      await page.goto("https://www.facebook.com/", {
        waitUntil: "domcontentloaded",
        timeout: 40000,
      });
      await new Promise((r) => setTimeout(r, 4000));

      if (page.url().includes("/login")) {
        await page.close();
        return NextResponse.json(
          { error: "Facebook session expired. Please re-save Felix session." },
          { status: 401 }
        );
      }

      // Click "What's on your mind?" post box
      const postBoxClicked = await page.evaluate(() => {
        const candidates = Array.from(document.querySelectorAll("[role='button']"));
        const postBox = candidates.find(
          (el) =>
            (el as HTMLElement).innerText?.toLowerCase().includes("what's on your mind") ||
            (el as HTMLElement).getAttribute("placeholder")?.toLowerCase().includes("what's on your mind")
        );
        if (postBox) {
          (postBox as HTMLElement).click();
          return true;
        }

        // Fallback: look for the composer area
        const composer = document.querySelector(
          '[data-testid="status-attachment-mentions-input"], [contenteditable="true"][role="textbox"]'
        );
        if (composer) {
          (composer as HTMLElement).click();
          return true;
        }
        return false;
      });

      if (!postBoxClicked) {
        await page.close();
        return NextResponse.json(
          { error: "Could not find the Facebook post composer. Facebook layout may have changed." },
          { status: 500 }
        );
      }

      await new Promise((r) => setTimeout(r, 2000));

      // Type the post content into the composer
      const textInputSelector =
        '[contenteditable="true"][role="textbox"], [data-testid="status-attachment-mentions-input"]';

      await page.waitForSelector(textInputSelector, { timeout: 10000 });
      await page.focus(textInputSelector);
      await new Promise((r) => setTimeout(r, 500));

      // Type content in chunks to avoid timeout
      const chunks = content.match(/.{1,50}/g) || [content];
      for (const chunk of chunks) {
        await page.type(textInputSelector, chunk, { delay: 20 });
      }

      await new Promise((r) => setTimeout(r, 1500));

      // Click the Post / Share button
      const posted = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll("button, [role='button']"));
        const postBtn = buttons.find((b) => {
          const text = (b as HTMLElement).innerText?.trim().toLowerCase();
          return text === "post" || text === "share now" || text === "share";
        });
        if (postBtn) {
          (postBtn as HTMLElement).click();
          return true;
        }
        return false;
      });

      if (!posted) {
        await page.close();
        return NextResponse.json(
          { error: "Could not find the Post button. Please post manually." },
          { status: 500 }
        );
      }

      await new Promise((r) => setTimeout(r, 3000));
      await page.close();

      // Log the post action
      await db.collection("febo_autopost_logs").insertOne({
        contentId: contentId || null,
        content: content.slice(0, 500),
        postedAt: new Date().toISOString(),
        status: "success",
        platform: "facebook",
      });

      return NextResponse.json({
        success: true,
        message: "Content posted to Facebook successfully.",
        postedAt: new Date().toISOString(),
      });
    } catch (innerErr: any) {
      try { await page.close(); } catch {}
      throw innerErr;
    }
  } catch (err) {
    console.error("[febo/autopost] POST error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ── GET: Recent autopost history ───────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const cookieString = req.cookies.get("li_session")?.value;
    if (!cookieString) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    const db = await getDatabase();
    const logs = await db
      .collection("febo_autopost_logs")
      .find({})
      .sort({ postedAt: -1 })
      .limit(20)
      .toArray();

    return NextResponse.json({ success: true, logs });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
