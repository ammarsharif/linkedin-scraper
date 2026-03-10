from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import asyncio
import json
import re
import os
import sys
import random
import time
import queue
import threading

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

def prettify_vanity(vanity: str) -> str:
    """Transform m-ammar-sharif-123 into Ammar Sharif."""
    if not vanity: return "Unknown"
    # remove leading m- or in-
    name = re.sub(r'^(m|in)-', '', vanity)
    # remove trailing numbers/ids (e.g. -14868919b or -123456)
    name = re.sub(r'-[0-9a-zA-Z]{5,}$', '', name)
    name = re.sub(r'-[0-9]+$', '', name)
    # replace dashes/dots with spaces
    name = name.replace('-', ' ').replace('.', ' ')
    # capitalize
    return name.title().strip() or vanity.title()

def _do_scrape(cookie_string: str, profile_url: str, limit: int, progress_queue=None) -> dict:
    import sys
    import asyncio
    
    if sys.platform == 'win32':
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

    def emit(stage: str, detail: str, pct: int):
        """Send a progress event to the queue if available."""
        if progress_queue:
            progress_queue.put({"stage": stage, "detail": detail, "pct": pct, "ts": time.time()})
        print(f"[api][progress] {stage}: {detail} ({pct}%)", file=sys.stderr)

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
                "name": prettify_vanity(vanity_name),
                "headline": "",
                "location": "",
                "profileUrl": p_url,
                "vanityName": vanity_name,
            },
            "posts": [],
        }

        cookies = cookie_string_to_list(cookie_string)
        emit("init", f"Parsed {len(cookies)} cookies", 2)
        print(f"[api] Scraping {p_url}, limit={limit}", file=sys.stderr)

        try:
            emit("browser", "Launching browser", 5)
            async with BrowserManager(headless=True) as browser:
                await browser.context.add_cookies(cookies)
                emit("browser", "Browser ready, cookies loaded", 8)

                # Tighter initial pause (0.5-1.5s instead of 1.0-3.0s)
                await _human_pause(0.5, 1.5)

                # ── Step 1: Get the profile ────────────────────────────────────
                emit("profile", "Scraping profile info", 10)
                try:
                    person_scraper = PersonScraper(browser.page)
                    person = await person_scraper.scrape(p_url)
                    
                    result["profile"].update(person.model_dump())
                    result["profile"]["headline"] = person.job_title or ""
                    result["profile"]["name"] = person.name or prettify_vanity(vanity_name)
                    result["profile"]["location"] = person.location or ""
                    emit("profile", f"Profile scraped: {result['profile']['name']}", 25)
                except Exception as e:
                    print(f"[api] Profile scrape error: {e}", file=sys.stderr)
                    if "Not logged in" in str(e) or "authenticate" in str(e).lower():
                        raise e
                    import traceback
                    traceback.print_exc(file=sys.stderr)
                    emit("profile", "Profile extraction had errors", 25)

                # ── Step 2: Scrape posts ─────────────────────────────────────────────
                emit("posts", "Starting posts scrape", 30)
                try:
                    posts_scraper = PersonPostsScraper(browser.page)

                    # Create a progress callback for SSE
                    async def posts_progress(stage, detail, pct):
                        # Remap pct from 0-100 to 30-90
                        mapped_pct = 30 + int(pct * 0.6)
                        emit(stage, detail, mapped_pct)

                    posts = await posts_scraper.scrape(p_url, limit=limit, on_progress=posts_progress)
                    emit("posts", f"Found {len(posts)} posts", 92)

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
                    if "Not logged in" in str(e) or "authenticate" in str(e).lower():
                        raise e
                    import traceback
                    traceback.print_exc(file=sys.stderr)

        except Exception as e:
            import traceback
            error_trace = traceback.format_exc()
            print(f"Top level error in do_scrape: {error_trace}", file=sys.stderr)
            return {"error": str(e), "traceback": error_trace}

        emit("done", f"Complete — {len(result['posts'])} posts", 100)
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
            request.limit,
            None  # no progress_queue for legacy endpoint
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


# ── SSE streaming endpoint ──────────────────────────────────────────────────
@app.post("/scrape-stream")
async def run_scrape_stream(request: ScrapeRequest):
    """Stream progress events as SSE (Server-Sent Events) with the final result."""
    if not request.cookieString:
        raise HTTPException(status_code=400, detail="No cookieString provided")
    if not request.profileUrl:
        raise HTTPException(status_code=400, detail="No profileUrl provided")

    progress_q = queue.Queue()

    def run_in_thread():
        return _do_scrape(request.cookieString, request.profileUrl, request.limit, progress_q)

    # Start scrape in background thread
    future = executor.submit(run_in_thread)

    async def event_generator():
        """Yield SSE events as they come from the progress queue."""
        while not future.done():
            # Drain queue
            while True:
                try:
                    evt = progress_q.get_nowait()
                    yield f"data: {json.dumps(evt)}\n\n"
                except queue.Empty:
                    break
            await asyncio.sleep(0.3)  # poll every 300ms

        # Drain remaining events
        while True:
            try:
                evt = progress_q.get_nowait()
                yield f"data: {json.dumps(evt)}\n\n"
            except queue.Empty:
                break

        # Send final result
        try:
            result = future.result()
            yield f"data: {json.dumps({'stage': 'result', 'data': result, 'pct': 100})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'stage': 'error', 'detail': str(e), 'pct': 100})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
