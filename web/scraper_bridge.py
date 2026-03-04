#!/usr/bin/env python3
"""
Playwright-based LinkedIn scraper bridge for the Next.js web app.

Called by the Next.js /api/scrape route via child_process.
Input:  JSON on stdin  { cookieString, profileUrl, limit }
Output: JSON on stdout { profile: {...}, posts: [...] }
Errors: printed to stderr (visible in Next.js server logs)
"""
import asyncio
import json
import sys
import re
import os
import random

# Force UTF-8 on Windows so emoji in post text don't crash the codec
if sys.stdout.encoding != 'utf-8':
    sys.stdout = open(sys.stdout.fileno(), mode='w', encoding='utf-8', buffering=1, closefd=False)
if sys.stderr.encoding != 'utf-8':
    sys.stderr = open(sys.stderr.fileno(), mode='w', encoding='utf-8', buffering=1, closefd=False)

# Make sure the linkedin_scraper package is importable
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from linkedin_scraper.core.browser import BrowserManager
from linkedin_scraper.scrapers.person_posts import PersonPostsScraper


def _jitter(lo: float = 1.5, hi: float = 4.5) -> float:
    """Return a random float in [lo, hi] to use as a sleep duration."""
    return random.uniform(lo, hi)


async def _human_pause(lo: float = 1.5, hi: float = 4.5) -> None:
    """Sleep for a random duration that mimics human think-time."""
    await asyncio.sleep(_jitter(lo, hi))


async def _move_mouse_randomly(page) -> None:
    """Move the mouse to a random position to simulate a real user."""
    try:
        x = random.randint(200, 1100)
        y = random.randint(150, 650)
        await page.mouse.move(x, y)
        await asyncio.sleep(random.uniform(0.1, 0.4))
    except Exception:
        pass


def cookie_string_to_list(raw: str) -> list:
    """
    Convert a raw Cookie header string into a list of Playwright cookie dicts.
    e.g. "li_at=ABC; JSESSIONID=\"ajax:123\"; bcookie=..."
    """
    # Determine which cookies belong to .www vs .linkedin domain
    www_cookies = {"JSESSIONID", "bscookie", "timezone", "li_theme", "li_theme_set"}

    result = []
    for part in raw.split(";"):
        part = part.strip()
        if not part or "=" not in part:
            continue
        eq = part.index("=")
        name = part[:eq].strip()
        value = part[eq + 1:].strip()
        # Strip surrounding quotes (JSESSIONID is stored as "ajax:XXX")
        if value.startswith('"') and value.endswith('"'):
            value = value[1:-1]
        if not name:
            continue
        result.append({
            "name": name,
            "value": value,
            "domain": ".www.linkedin.com" if name in www_cookies else ".linkedin.com",
            "path": "/",
            "expires": -1,
            "httpOnly": name in ("bscookie", "__cf_bm"),
            "secure": True,
            "sameSite": "None",
        })
    return result


def extract_name_from_title(title: str) -> str:
    """Extract person name from LinkedIn page title like 'Name - Title | LinkedIn'."""
    cleaned = re.sub(r'\s*\|\s*LinkedIn\s*$', '', title, flags=re.IGNORECASE).strip()
    if not cleaned or cleaned.lower() == "linkedin":
        return ""
    if " - " in cleaned:
        return cleaned.split(" - ")[0].strip()
    return cleaned


async def scrape(cookie_string: str, profile_url: str, limit: int) -> dict:
    profile_url = profile_url.rstrip("/") + "/"
    vanity = re.search(r'linkedin\.com/in/([^/?#]+)', profile_url)
    vanity_name = vanity.group(1).rstrip("/") if vanity else ""

    result = {
        "profile": {
            "name": vanity_name,
            "headline": "",
            "location": "",
            "profileUrl": profile_url,
            "vanityName": vanity_name,
        },
        "posts": [],
    }

    cookies = cookie_string_to_list(cookie_string)
    print(f"[bridge] Parsed {len(cookies)} cookies", file=sys.stderr)
    print(f"[bridge] Scraping {profile_url}, limit={limit}", file=sys.stderr)

    async with BrowserManager(headless=True) as browser:
        # Inject the session cookies so we're already "logged in"
        await browser.context.add_cookies(cookies)
        print("[bridge] Cookies loaded into browser", file=sys.stderr)

        # Brief random idle before starting — avoids same-millisecond request patterns
        await _human_pause(1.0, 3.0)

        # ── Step 1: Get the profile name ────────────────────────────────────
        try:
            await browser.page.goto(profile_url, wait_until="domcontentloaded", timeout=30000)
            # Randomised wait: 2.5 – 5 s (instead of fixed 2 s)
            await _human_pause(2.5, 5.0)
            await _move_mouse_randomly(browser.page)

            # Try h1 selector first
            name = ""
            for sel in ["h1.text-heading-xlarge", "h1", '[data-anonymize="person-name"]']:
                try:
                    el = browser.page.locator(sel).first
                    text = (await el.text_content(timeout=3000) or "").strip()
                    if text and len(text) > 1 and text.lower() != "linkedin":
                        name = text
                        break
                except Exception:
                    continue

            # Fallback: page title
            if not name:
                title = await browser.page.title()
                name = extract_name_from_title(title)
                print(f"[bridge] Using title-based name: {name!r}", file=sys.stderr)

            # Fallback: og:title from meta tag
            if not name:
                og = await browser.page.evaluate(
                    'document.querySelector(\'meta[property="og:title"]\')?.content ?? ""'
                )
                name = extract_name_from_title(og or "")

            if name:
                result["profile"]["name"] = name
                print(f"[bridge] Profile name: {name!r}", file=sys.stderr)

            # Also try to get location
            for sel in [
                ".text-body-small.inline.t-black--light.break-words",
                '[data-anonymize="location"]',
            ]:
                try:
                    loc_el = browser.page.locator(sel).first
                    loc = (await loc_el.text_content(timeout=2000) or "").strip()
                    if loc:
                        result["profile"]["location"] = loc
                        break
                except Exception:
                    continue

        except Exception as e:
            print(f"[bridge] Profile nav error: {e}", file=sys.stderr)

        # ── Step 2: Scrape posts ─────────────────────────────────────────────
        try:
            posts_scraper = PersonPostsScraper(browser.page)
            posts = await posts_scraper.scrape(profile_url, limit=limit)
            print(f"[bridge] Found {len(posts)} posts", file=sys.stderr)

            result["posts"] = [
                {
                    "urn": p.urn or "",
                    "text": p.text or "",
                    "postedDate": p.posted_date or "",
                    "reactionsCount": p.reactions_count or 0,
                    "commentsCount": p.comments_count or 0,
                    "repostsCount": p.reposts_count or 0,
                    "postUrl": p.linkedin_url or "",
                    "imageUrls": list(p.image_urls or []),
                    "videoUrl": p.video_url,
                    "articleUrl": p.article_url,
                }
                for p in posts
            ]
        except Exception as e:
            print(f"[bridge] Posts scrape error: {e}", file=sys.stderr)
            import traceback
            traceback.print_exc(file=sys.stderr)

    return result


async def main():
    raw = sys.stdin.read()
    data = json.loads(raw)
    cookie_string: str = data.get("cookieString", "")
    profile_url: str = data.get("profileUrl", "")
    limit: int = int(data.get("limit", 10))

    if not cookie_string:
        print(json.dumps({"error": "No cookieString provided"}))
        sys.exit(1)
    if not profile_url:
        print(json.dumps({"error": "No profileUrl provided"}))
        sys.exit(1)

    result = await scrape(cookie_string, profile_url, limit)
    # ensure_ascii=True keeps output safe on any Windows console encoding;
    # JavaScript's JSON.parse will decode \uXXXX escapes automatically.
    print(json.dumps(result, ensure_ascii=True))


if __name__ == "__main__":
    asyncio.run(main())
