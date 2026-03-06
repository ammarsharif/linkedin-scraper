from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import asyncio
import json
import re
import os
import sys
import random

if sys.platform == 'win32':
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

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
from linkedin_scraper.scrapers.person import PersonScraper

app = FastAPI(title="LinkedIn Scraper API")

# ── CORS: Allow Vercel-deployed frontend (and any origin) to reach this API ──
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ScrapeRequest(BaseModel):
    cookieString: str
    profileUrl: str
    limit: int = 10

def cookie_string_to_list(raw: str) -> list:
    """
    Convert a raw Cookie header string into a list of Playwright cookie dicts.
    e.g. "li_at=ABC; JSESSIONID=\"ajax:123\"; bcookie=..."
    """
    www_cookies = {"JSESSIONID", "bscookie", "timezone", "li_theme", "li_theme_set"}

    result = []
    for part in raw.split(";"):
        part = part.strip()
        if not part or "=" not in part:
            continue
        eq = part.index("=")
        name = part[:eq].strip()
        value = part[eq + 1:].strip()
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

def _jitter(lo: float = 1.5, hi: float = 4.5) -> float:
    return random.uniform(lo, hi)

async def _human_pause(lo: float = 1.5, hi: float = 4.5) -> None:
    await asyncio.sleep(_jitter(lo, hi))

def _do_scrape(cookie_string: str, profile_url: str, limit: int) -> dict:
    import sys
    import asyncio
    
    if sys.platform == 'win32':
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
        
    async def async_scrape():
        from urllib.parse import urlparse, urlunparse
        
        parsed = urlparse(profile_url)
        p_url = profile_url
        if not parsed.path.endswith('/'):
            p_url = urlunparse(parsed._replace(path=parsed.path + '/'))
            
        vanity = re.search(r'linkedin\.com/in/([^/?#]+)', p_url)
        vanity_name = vanity.group(1).strip("/") if vanity else ""

        result = {
            "profile": {
                "name": vanity_name,
                "headline": "",
                "location": "",
                "profileUrl": p_url,
                "vanityName": vanity_name,
            },
            "posts": [],
        }

        cookies = cookie_string_to_list(cookie_string)
        print(f"[api] Parsed {len(cookies)} cookies", file=sys.stderr)
        print(f"[api] Scraping {p_url}, limit={limit}", file=sys.stderr)

        try:
            async with BrowserManager(headless=True) as browser:
                await browser.context.add_cookies(cookies)
                print("[api] Cookies loaded into browser", file=sys.stderr)

                await _human_pause(1.0, 3.0)

                # ── Step 1: Get the profile ────────────────────────────────────
                try:
                    person_scraper = PersonScraper(browser.page)
                    person = await person_scraper.scrape(p_url)
                    
                    result["profile"].update(person.model_dump())
                    result["profile"]["headline"] = person.job_title or ""
                    result["profile"]["name"] = person.name or vanity_name
                    result["profile"]["location"] = person.location or ""
                    print(f"[api] Profile scraped: {person.name!r}", file=sys.stderr)
                except Exception as e:
                    print(f"[api] Profile scrape error: {e}", file=sys.stderr)
                    import traceback
                    traceback.print_exc(file=sys.stderr)

                # ── Step 2: Scrape posts ─────────────────────────────────────────────
                try:
                    posts_scraper = PersonPostsScraper(browser.page)
                    posts = await posts_scraper.scrape(p_url, limit=limit)
                    print(f"[api] Found {len(posts)} posts", file=sys.stderr)

                    # Debug: if no posts, dump page info
                    if len(posts) == 0:
                        final_url = browser.page.url
                        page_title = await browser.page.title()
                        html_snippet = await browser.page.evaluate('() => document.body.innerHTML.substring(0, 3000)')
                        print(f"[api][DEBUG] Final URL: {final_url}", file=sys.stderr)
                        print(f"[api][DEBUG] Page title: {page_title}", file=sys.stderr)
                        print(f"[api][DEBUG] HTML snippet (first 3000 chars): {html_snippet}", file=sys.stderr)

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
                    print(f"[api] Posts scrape error: {e}", file=sys.stderr)
                    import traceback
                    traceback.print_exc(file=sys.stderr)

        except Exception as e:
            import traceback
            error_trace = traceback.format_exc()
            print(f"Top level error in do_scrape: {error_trace}", file=sys.stderr)
            return {"error": str(e), "traceback": error_trace}

        return result

    return asyncio.run(async_scrape())


from concurrent.futures import ThreadPoolExecutor
executor = ThreadPoolExecutor(max_workers=5)

@app.post("/scrape")
async def run_scrape(request: ScrapeRequest):
    if not request.cookieString:
        raise HTTPException(status_code=400, detail="No cookieString provided")
    if not request.profileUrl:
        raise HTTPException(status_code=400, detail="No profileUrl provided")

    try:
        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(
            executor, 
            _do_scrape, 
            request.cookieString, 
            request.profileUrl, 
            request.limit
        )
        if "error" in result:
             # Just pass the dict as JSON response as it already handles error response
             pass
        return result
    except Exception as e:
        import traceback
        error_trace = traceback.format_exc()
        print(f"Server executor error: {error_trace}", file=sys.stderr)
        return {"error": str(e), "traceback": error_trace}
