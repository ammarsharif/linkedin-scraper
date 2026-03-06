"""Person Posts scraper for LinkedIn - scrapes posts from a personal profile's activity feed."""

import asyncio
import logging
import re
import random
import sys
from typing import List, Optional
from playwright.async_api import Page

from ..models.post import Post
from ..callbacks import ProgressCallback, SilentCallback
from .base import BaseScraper

logger = logging.getLogger(__name__)


class PersonPostsScraper(BaseScraper):
    """
    Async scraper for LinkedIn person profile posts/activity feed.
    
    Navigates to a person's recent activity page and extracts their posts
    including text, images, engagement metrics, and dates.
    
    Usage:
        async with BrowserManager(headless=False) as browser:
            await browser.load_session("session.json")
            scraper = PersonPostsScraper(browser.page)
            posts = await scraper.scrape("https://linkedin.com/in/username/", limit=10)
    """
    
    def __init__(self, page: Page, callback: Optional[ProgressCallback] = None):
        super().__init__(page, callback or SilentCallback())
    
    async def scrape(self, profile_url: str, limit: int = 10) -> List[Post]:
        """
        Scrape posts from a LinkedIn person's activity feed.
        
        Args:
            profile_url: LinkedIn profile URL (e.g. https://linkedin.com/in/username/)
            limit: Maximum number of posts to scrape (default: 10)
            
        Returns:
            List of Post objects with text, images, engagement data
        """
        logger.info(f"Starting person posts scraping: {profile_url}")
        await self.callback.on_start("person_posts", profile_url)
        
        # Build the activity/posts URL
        activity_url = self._build_activity_url(profile_url)
        await self.navigate_and_wait(activity_url)
        await self.callback.on_progress("Navigated to activity page", 10)
        
        await self.check_rate_limit()
        
        # Wait for posts to load
        await self._wait_for_posts_to_load()
        await self.callback.on_progress("Posts loaded", 20)
        
        # Scrape posts with scrolling
        posts = await self._scrape_posts(limit)
        await self.callback.on_progress(f"Scraped {len(posts)} posts", 100)
        await self.callback.on_complete("person_posts", posts)
        
        logger.info(f"Successfully scraped {len(posts)} posts from {profile_url}")
        return posts
    
    def _build_activity_url(self, profile_url: str) -> str:
        """Build the activity feed URL from a profile URL."""
        profile_url = profile_url.rstrip('/')
        
        # If already pointing to activity page, return as-is
        if '/recent-activity/' in profile_url:
            return profile_url
        
        # Remove trailing sections like /details/experience etc.
        # Keep only the base profile URL
        match = re.match(r'(https?://[^/]+/in/[^/]+)', profile_url)
        if match:
            base_url = match.group(1)
        else:
            base_url = profile_url
        
        return f"{base_url}/recent-activity/all/"
    
    async def _wait_for_posts_to_load(self, timeout: int = 30000) -> None:
        """Wait for the activity feed posts to load on the page."""
        try:
            await self.page.wait_for_load_state('domcontentloaded', timeout=timeout)
        except Exception as e:
            logger.debug(f"DOM load timeout: {e}")

        # Log current URL for debugging
        current_url = self.page.url
        print(f"[posts-debug] Current URL after nav: {current_url}", file=sys.stderr)

        # Randomised extra time for dynamic content (2.5 - 5 s)
        await self.page.wait_for_timeout(random.randint(2500, 5000))

        # Try scrolling to trigger lazy loading
        for attempt in range(5):
            await self._trigger_lazy_load()

            # Check multiple indicators for posts
            page_info = await self.page.evaluate('''() => {
                const html = document.body.innerHTML;
                return {
                    hasUrnActivity: html.includes('urn:li:activity:'),
                    hasUrnUgcPost: html.includes('urn:li:ugcPost:'),
                    hasUrnShare: html.includes('urn:li:share:'),
                    hasFeedUpdate: !!document.querySelector('.feed-shared-update-v2'),
                    hasOccludable: !!document.querySelector('.occludable-update'),
                    hasScaffold: !!document.querySelector('[data-id]'),
                    hasDataUrn: !!document.querySelector('[data-urn]'),
                    feedContainerCount: document.querySelectorAll('.feed-shared-update-v2, .occludable-update, [data-urn], [data-id]').length,
                    title: document.title,
                    bodyLen: html.length,
                };
            }''')

            print(f"[posts-debug] Attempt {attempt+1}: {page_info}", file=sys.stderr)

            if (page_info.get('hasUrnActivity') or page_info.get('hasUrnUgcPost') or
                page_info.get('hasUrnShare') or page_info.get('hasFeedUpdate') or
                page_info.get('hasOccludable') or page_info.get('feedContainerCount', 0) > 0):
                logger.debug(f"Posts found after attempt {attempt + 1}")
                return

            await self.page.wait_for_timeout(random.randint(1800, 3500))

        logger.warning("Posts may not have loaded fully")
    
    async def _trigger_lazy_load(self) -> None:
        """Scroll the page with human-like variable speed to trigger lazy loading."""
        scroll_height = await self.page.evaluate('document.documentElement.scrollHeight')
        steps = random.randint(6, 12)
        current = 0
        for i in range(steps):
            # Variable step size - humans don't scroll in uniform increments
            step = random.randint(200, 500)
            current = min(current + step, scroll_height)
            await self.page.evaluate(f'window.scrollTo(0, {current})')
            await self.page.wait_for_timeout(random.randint(150, 450))

        # Pause at the bottom like a human reading
        await self.page.wait_for_timeout(random.randint(800, 1800))

        # Scroll back up slightly to trigger any "see more" type loading
        await self.page.evaluate(f'window.scrollTo(0, {random.randint(200, 600)})')
        await self.page.wait_for_timeout(random.randint(600, 1200))
    
    async def _scrape_posts(self, limit: int) -> List[Post]:
        """Scrape posts with scrolling to load more."""
        posts: List[Post] = []
        scroll_count = 0
        max_scrolls = (limit // 3) + 5  # More generous for person feeds
        
        while len(posts) < limit and scroll_count < max_scrolls:
            # Click all "...more" buttons to expand full post text
            await self._click_all_see_more_buttons()
            
            new_posts = await self._extract_posts_from_page()
            
            for post in new_posts:
                if post.urn and not any(p.urn == post.urn for p in posts):
                    posts.append(post)
                    if len(posts) >= limit:
                        break
            
            if len(posts) < limit:
                await self._scroll_for_more_posts()
                scroll_count += 1
                logger.debug(f"Scroll {scroll_count}/{max_scrolls}, posts so far: {len(posts)}")
        
        return posts[:limit]
    
    async def _click_all_see_more_buttons(self) -> None:
        """Click all '...more' / 'see more' buttons on the page to expand truncated posts."""
        try:
            # LinkedIn uses multiple selectors for the "see more" button
            see_more_selectors = [
                'button.feed-shared-inline-show-more-text__see-more-less-toggle',
                'button[class*="see-more"]',
                'button:has-text("...more")',
                'button:has-text("...more")',
                'button:has-text("see more")',
                'button:has-text("See more")',
            ]
            
            for selector in see_more_selectors:
                try:
                    buttons = self.page.locator(selector)
                    count = await buttons.count()
                    
                    if count > 0:
                        logger.debug(f"Found {count} 'see more' buttons with selector: {selector}")
                        for i in range(min(count, 30)):  # Cap at 30 to avoid infinite loops
                            try:
                                btn = buttons.nth(i)
                                if await btn.is_visible():
                                    await btn.click(timeout=2000)
                                    # Randomised pause between clicks (0.2 - 0.8 s)
                                    await asyncio.sleep(random.uniform(0.2, 0.8))
                            except Exception:
                                continue
                except Exception:
                    continue
            
            # Wait for text to expand after clicking (randomised 0.8 - 1.8 s)
            await self.page.wait_for_timeout(random.randint(800, 1800))
            logger.debug("Finished clicking 'see more' buttons")
            
        except Exception as e:
            logger.debug(f"Error clicking see more buttons: {e}")
    
    async def _extract_posts_from_page(self) -> List[Post]:
        """Extract all visible posts from the current page state using JS.
        
        Uses a multi-strategy approach to handle LinkedIn's evolving DOM:
        1. Try data-urn elements (classic approach)
        2. Try feed-shared-update-v2 containers
        3. Try occludable-update containers
        4. Try data-id containers
        5. Fallback: find any containers with activity URNs nearby
        6. Last resort: find containers with substantial text content
        """

        # The JS extraction code
        posts_data = await self.page.evaluate('''() => {
            const posts = [];
            const seenUrns = new Set();
            const html = document.body.innerHTML;

            // Helper: extract URN from an element or its ancestors / innerHTML
            function findUrn(el) {
                // Check data-urn attribute on element and ancestors
                let node = el;
                for (let i = 0; i < 5 && node; i++) {
                    const urn = node.getAttribute && node.getAttribute('data-urn');
                    if (urn && urn.includes('urn:li:')) return urn;
                    const dataId = node.getAttribute && node.getAttribute('data-id');
                    if (dataId && dataId.includes('urn:li:')) return dataId;
                    node = node.parentElement;
                }
                // Search in innerHTML for URN patterns
                const inner = el.innerHTML || '';
                const m = inner.match(/urn:li:(?:activity|ugcPost|share):(\\d+)/);
                if (m) return m[0];
                // Check href links inside for activity URN
                const links = el.querySelectorAll('a[href*="feed/update"]');
                for (const link of links) {
                    const href = link.getAttribute('href') || '';
                    const hm = href.match(/urn:li:activity:(\\d+)/);
                    if (hm) return hm[0];
                }
                return null;
            }

            // Helper: extract post data from a container element
            function extractPostData(el, urn) {
                // Get text content - try multiple selectors
                let text = '';
                const textSelectors = [
                    '.feed-shared-update-v2__description',
                    '.update-components-text',
                    '.feed-shared-text',
                    '[data-test-id="main-feed-activity-card__commentary"]',
                    '.break-words',
                    '.feed-shared-inline-show-more-text',
                    '.update-components-text__text-view',
                    'span[dir="ltr"]',
                    '.feed-shared-text__text-view',
                    '.update-components-update-v2__commentary',
                    '[class*="commentary"]',
                    '[class*="text-view"]'
                ];

                for (const sel of textSelectors) {
                    try {
                        const textEls = el.querySelectorAll(sel);
                        textEls.forEach(textEl => {
                            const t = textEl.innerText?.trim() || '';
                            if (t.length > text.length && t.length > 5) {
                                text = t;
                            }
                        });
                    } catch(e) {}
                }

                // Fallback: largest meaningful text block
                if (!text || text.length < 10) {
                    const allEls = el.querySelectorAll('div, span, p');
                    let maxLen = text.length;
                    allEls.forEach(div => {
                        const t = (div.innerText?.trim() || '');
                        if (t.length > maxLen && t.length > 15 &&
                            !t.includes('followers') &&
                            !t.includes('Like') &&
                            !t.match(/^\\d+\\s*(reactions?|comments?|reposts?)/i) &&
                            !t.match(/^\\d+[hdwmy]\\s/)) {
                            // Avoid actor/header blocks
                            const cls = (div.className || '') + (div.parentElement?.className || '');
                            if (!cls.includes('actor') && !cls.includes('header')) {
                                text = t;
                                maxLen = t.length;
                            }
                        }
                    });
                }

                if (!text || text.length < 3) return null;

                // Time posted
                const timeEl = el.querySelector(
                    'time, ' +
                    '[class*="actor__sub-description"], ' +
                    '[class*="update-components-actor__sub-description"], ' +
                    '[class*="feed-shared-actor__sub-description"], ' +
                    'span[class*="visually-hidden"]'
                );
                let timeText = '';
                if (timeEl) {
                    timeText = timeEl.getAttribute('datetime') || timeEl.innerText || '';
                }

                // Reactions count
                const reactionsEl = el.querySelector(
                    'button[aria-label*="reaction"], ' +
                    '[class*="social-details-social-counts__reactions"], ' +
                    'span[class*="social-details-social-counts__reactions-count"], ' +
                    'span[class*="reactions-count"]'
                );
                const reactions = reactionsEl ? reactionsEl.innerText : '';

                // Comments count
                const commentsEl = el.querySelector(
                    'button[aria-label*="comment"], ' +
                    '[class*="social-details-social-counts__comments"], ' +
                    'button[class*="comment"]'
                );
                const comments = commentsEl ? commentsEl.innerText : '';

                // Reposts count
                const repostsEl = el.querySelector(
                    'button[aria-label*="repost"], ' +
                    '[class*="social-details-social-counts__reposts"], ' +
                    'button[class*="repost"]'
                );
                const reposts = repostsEl ? repostsEl.innerText : '';

                // Images
                const images = [];
                el.querySelectorAll('img[src*="media"], img[src*="dms.licdn"], img[src*="media-exp"]').forEach(img => {
                    if (img.src && !img.src.includes('profile') && !img.src.includes('logo') &&
                        !img.src.includes('static') && !img.src.includes('sprite') &&
                        !img.src.includes('ghost') && img.naturalWidth > 50) {
                        images.push(img.src);
                    }
                });

                // Video
                let videoUrl = null;
                const videoEl = el.querySelector('video source, video[src], [data-sources]');
                if (videoEl) {
                    videoUrl = videoEl.getAttribute('src') || videoEl.getAttribute('data-src') || null;
                }

                // Article URL
                let articleUrl = null;
                const articleEl = el.querySelector(
                    'a[class*="feed-shared-article"], ' +
                    'a[class*="update-components-article"], ' +
                    'a[data-tracking-control-name*="article"], ' +
                    'a[class*="app-aware-link"][href*="http"]'
                );
                if (articleEl) {
                    const href = articleEl.getAttribute('href') || '';
                    if (href && !href.includes('linkedin.com/in/') && !href.includes('/feed/')) {
                        articleUrl = href;
                    }
                }

                return {
                    urn: urn,
                    text: text.substring(0, 10000),
                    timeText: timeText,
                    reactions: reactions,
                    comments: comments,
                    reposts: reposts,
                    images: images,
                    videoUrl: videoUrl,
                    articleUrl: articleUrl
                };
            }

            // == Strategy 1: Find elements with data-urn attribute ==
            document.querySelectorAll('[data-urn*="urn:li:"]').forEach(el => {
                const urn = el.getAttribute('data-urn');
                if (!urn || seenUrns.has(urn)) return;
                seenUrns.add(urn);
                const data = extractPostData(el, urn);
                if (data) posts.push(data);
            });

            // == Strategy 2: Find feed-shared-update-v2 containers ==
            if (posts.length === 0) {
                document.querySelectorAll('.feed-shared-update-v2').forEach(el => {
                    const urn = findUrn(el);
                    if (!urn || seenUrns.has(urn)) return;
                    seenUrns.add(urn);
                    const data = extractPostData(el, urn);
                    if (data) posts.push(data);
                });
            }

            // == Strategy 3: Find occludable-update containers ==
            if (posts.length === 0) {
                document.querySelectorAll('.occludable-update').forEach(el => {
                    const urn = findUrn(el);
                    if (!urn || seenUrns.has(urn)) return;
                    seenUrns.add(urn);
                    const data = extractPostData(el, urn);
                    if (data) posts.push(data);
                });
            }

            // == Strategy 4: Find data-id containers ==
            if (posts.length === 0) {
                document.querySelectorAll('[data-id*="urn:li:"]').forEach(el => {
                    const urn = el.getAttribute('data-id');
                    if (!urn || seenUrns.has(urn)) return;
                    seenUrns.add(urn);
                    const data = extractPostData(el, urn);
                    if (data) posts.push(data);
                });
            }

            // == Strategy 5 (nuclear): scan for ANY URN in innerHTML, walk UP to container ==
            if (posts.length === 0) {
                const urnRegex = /urn:li:(?:activity|ugcPost|share):(\\d+)/g;
                const allMatches = [...html.matchAll(urnRegex)];
                const uniqueUrns = [...new Set(allMatches.map(m => m[0]))];

                for (const urn of uniqueUrns) {
                    if (seenUrns.has(urn)) continue;
                    seenUrns.add(urn);

                    // Try to find any element whose innerHTML contains this URN
                    // and is a reasonable post container
                    const candidates = document.querySelectorAll(
                        'div[class*="update"], div[class*="feed"], div[class*="post"], ' +
                        'article, li[class*="feed"], div[class*="occludable"]'
                    );
                    for (const cand of candidates) {
                        if (cand.innerHTML.includes(urn)) {
                            const data = extractPostData(cand, urn);
                            if (data) {
                                posts.push(data);
                                break;
                            }
                        }
                    }
                }
            }

            // == Strategy 6 (last resort): any container with substantial text ==
            if (posts.length === 0) {
                let idx = 0;
                document.querySelectorAll(
                    '.scaffold-finite-scroll__content > div, ' +
                    '.scaffold-finite-scroll__content > li, ' +
                    'main div[class*="feed"] > div, ' +
                    'main section > div > div'
                ).forEach(el => {
                    const t = (el.innerText || '').trim();
                    if (t.length > 30) {
                        const syntheticUrn = 'urn:li:activity:fallback-' + idx;
                        idx++;
                        if (!seenUrns.has(syntheticUrn)) {
                            seenUrns.add(syntheticUrn);
                            const data = extractPostData(el, syntheticUrn);
                            if (data) posts.push(data);
                        }
                    }
                });
            }

            return { posts: posts, debug: { strategies_tried: 6, total_found: posts.length } };
        }''')

        debug_info = posts_data.get('debug', {})
        raw_posts = posts_data.get('posts', [])
        print(f"[posts-debug] Extraction result: {debug_info}, posts_found={len(raw_posts)}", file=sys.stderr)

        result: List[Post] = []
        for data in raw_posts:
            urn = data.get('urn', '')
            # Normalise URN for URL construction
            activity_id = ''
            m = re.search(r'(?:activity|ugcPost|share):(\d+)', urn)
            if m:
                activity_id = m.group(1)
                canonical_urn = f"urn:li:activity:{activity_id}"
            else:
                canonical_urn = urn
                activity_id = urn.split(':')[-1] if ':' in urn else urn

            post = Post(
                linkedin_url=f"https://www.linkedin.com/feed/update/{canonical_urn}/" if activity_id else "",
                urn=canonical_urn,
                text=data['text'],
                posted_date=self._extract_time_from_text(data.get('timeText', '')),
                reactions_count=self._parse_count(data.get('reactions', '')),
                comments_count=self._parse_count(data.get('comments', '')),
                reposts_count=self._parse_count(data.get('reposts', '')),
                image_urls=data.get('images', []),
                video_url=data.get('videoUrl'),
                article_url=data.get('articleUrl')
            )
            result.append(post)

        return result
    
    def _extract_time_from_text(self, text: str) -> Optional[str]:
        """Extract relative time from time element text."""
        if not text:
            return None
        # Match patterns like "2d", "1w", "3 hours ago", "1 month ago"
        match = re.search(
            r'(\d+[hdwmy]|\d+\s*(?:hour|day|week|month|year)s?\s*ago)',
            text, re.IGNORECASE
        )
        if match:
            return match.group(1).strip()
        # Fall back to first part before bullet
        parts = text.split('\u2022')
        if parts:
            return parts[0].strip()
        return None
    
    def _parse_count(self, text: str) -> Optional[int]:
        """Parse engagement count from text like '1,234' or '5 comments'."""
        if not text:
            return None
        try:
            numbers = re.findall(r'[\d,]+', text.replace(',', ''))
            if numbers:
                return int(numbers[0])
        except:
            pass
        return None
    
    async def _scroll_for_more_posts(self) -> None:
        """Scroll down to load more posts with human-like timing."""
        try:
            # Occasionally use keyboard End, sometimes scroll by pixels - vary the approach
            if random.random() < 0.5:
                await self.page.keyboard.press('End')
            else:
                scroll_by = random.randint(600, 1200)
                await self.page.evaluate(f'window.scrollBy(0, {scroll_by})')

            # Randomised wait: 1.5 - 3.5 s
            await self.page.wait_for_timeout(random.randint(1500, 3500))

            # Also try clicking "Show more" buttons if present
            try:
                show_more = self.page.locator('button:has-text("Show more results"), button:has-text("Show more")')
                if await show_more.count() > 0:
                    await show_more.first.click()
                    await self.page.wait_for_timeout(random.randint(1200, 2500))
            except:
                pass
        except Exception as e:
            logger.debug(f"Error scrolling: {e}")
