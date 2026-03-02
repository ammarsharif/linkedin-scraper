"""Person Posts scraper for LinkedIn - scrapes posts from a personal profile's activity feed."""

import asyncio
import logging
import re
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
        
        # Give extra time for dynamic content
        await self.page.wait_for_timeout(3000)
        
        # Try scrolling to trigger lazy loading
        for attempt in range(3):
            await self._trigger_lazy_load()
            
            # Check if any post URNs are present in the page
            has_posts = await self.page.evaluate('''() => {
                return document.body.innerHTML.includes('urn:li:activity:');
            }''')
            
            if has_posts:
                logger.debug(f"Posts found after attempt {attempt + 1}")
                return
            
            await self.page.wait_for_timeout(2000)
        
        logger.warning("Posts may not have loaded fully")
    
    async def _trigger_lazy_load(self) -> None:
        """Scroll the page to trigger lazy loading of posts."""
        await self.page.evaluate('''() => {
            const scrollHeight = document.documentElement.scrollHeight;
            const steps = 8;
            const stepSize = Math.min(scrollHeight / steps, 400);
            
            for (let i = 1; i <= steps; i++) {
                setTimeout(() => window.scrollTo(0, stepSize * i), i * 200);
            }
        }''')
        await self.page.wait_for_timeout(2500)
        
        # Scroll back up slightly to trigger any "see more" type loading
        await self.page.evaluate('window.scrollTo(0, 400)')
        await self.page.wait_for_timeout(1000)
    
    async def _scrape_posts(self, limit: int) -> List[Post]:
        """Scrape posts with scrolling to load more."""
        posts: List[Post] = []
        scroll_count = 0
        max_scrolls = (limit // 3) + 3  # A bit more generous for person feeds
        
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
        """Click all '…more' / 'see more' buttons on the page to expand truncated posts."""
        try:
            # LinkedIn uses multiple selectors for the "see more" button
            see_more_selectors = [
                'button.feed-shared-inline-show-more-text__see-more-less-toggle',
                'button[class*="see-more"]',
                'button:has-text("…more")',
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
                                    await asyncio.sleep(0.3)  # Brief pause between clicks
                            except Exception:
                                continue
                except Exception:
                    continue
            
            # Wait for text to expand after clicking
            await self.page.wait_for_timeout(1000)
            logger.debug("Finished clicking 'see more' buttons")
            
        except Exception as e:
            logger.debug(f"Error clicking see more buttons: {e}")
    
    async def _extract_posts_from_page(self) -> List[Post]:
        """Extract all visible posts from the current page state using JS."""
        posts_data = await self.page.evaluate('''() => {
            const posts = [];
            const html = document.body.innerHTML;
            
            // Find all activity URNs in the page
            const urnMatches = html.matchAll(/urn:li:activity:(\\d+)/g);
            const seenUrns = new Set();
            
            for (const match of urnMatches) {
                const urn = match[0];
                if (seenUrns.has(urn)) continue;
                seenUrns.add(urn);
                
                // Find the element with this URN
                const el = document.querySelector(`[data-urn="${urn}"]`);
                if (!el) continue;
                
                // Get text content - try multiple selectors for person activity feed
                let text = '';
                const textSelectors = [
                    '.feed-shared-update-v2__description',
                    '.update-components-text',
                    '.feed-shared-text',
                    '[data-test-id="main-feed-activity-card__commentary"]',
                    '.break-words.whitespace-pre-wrap',
                    '.feed-shared-inline-show-more-text',
                    '.update-components-text__text-view',
                    'span[dir="ltr"]'
                ];
                
                for (const sel of textSelectors) {
                    const textEl = el.querySelector(sel);
                    if (textEl) {
                        const t = textEl.innerText?.trim() || '';
                        if (t.length > text.length && t.length > 10) {
                            text = t;
                        }
                    }
                }
                
                // Fallback: find the largest meaningful text block
                if (!text || text.length < 20) {
                    const allDivs = el.querySelectorAll('div, span');
                    let maxLen = 0;
                    allDivs.forEach(div => {
                        const t = div.innerText?.trim() || '';
                        if (t.length > maxLen && t.length > 30 && 
                            !t.includes('followers') && 
                            !t.includes('reactions') &&
                            !t.match(/^\\d+[hdwmy]\\s/)) {
                            const parent = div.parentElement;
                            if (!parent?.classList?.contains('feed-shared-actor')) {
                                text = t;
                                maxLen = t.length;
                            }
                        }
                    });
                }
                
                // For person posts, allow shorter text (some posts are brief)
                if (!text || text.length < 5) continue;
                
                // Get time posted
                const timeEl = el.querySelector(
                    '[class*="actor__sub-description"], ' +
                    '[class*="update-components-actor__sub-description"], ' +
                    'time, ' +
                    '[class*="feed-shared-actor__sub-description"]'
                );
                const timeText = timeEl ? timeEl.innerText : '';
                
                // Get reactions count
                const reactionsEl = el.querySelector(
                    'button[aria-label*="reaction"], ' +
                    '[class*="social-details-social-counts__reactions"], ' +
                    'span[class*="social-details-social-counts__reactions-count"]'
                );
                const reactions = reactionsEl ? reactionsEl.innerText : '';
                
                // Get comments count
                const commentsEl = el.querySelector(
                    'button[aria-label*="comment"], ' +
                    '[class*="social-details-social-counts__comments"]'
                );
                const comments = commentsEl ? commentsEl.innerText : '';
                
                // Get reposts count
                const repostsEl = el.querySelector(
                    'button[aria-label*="repost"], ' +
                    '[class*="social-details-social-counts__reposts"]'
                );
                const reposts = repostsEl ? repostsEl.innerText : '';
                
                // Get images
                const images = [];
                el.querySelectorAll('img[src*="media"], img[src*="dms.licdn"]').forEach(img => {
                    if (img.src && !img.src.includes('profile') && !img.src.includes('logo') && 
                        !img.src.includes('static') && !img.src.includes('sprite')) {
                        images.push(img.src);
                    }
                });
                
                // Get video URL if present
                let videoUrl = null;
                const videoEl = el.querySelector('video source, video[src]');
                if (videoEl) {
                    videoUrl = videoEl.getAttribute('src') || videoEl.getAttribute('data-src') || null;
                }
                
                // Get article/link URL if present
                let articleUrl = null;
                const articleEl = el.querySelector(
                    'a[class*="feed-shared-article"], ' +
                    'a[class*="update-components-article"], ' +
                    'a[data-tracking-control-name*="article"]'
                );
                if (articleEl) {
                    articleUrl = articleEl.getAttribute('href') || null;
                }
                
                posts.push({
                    urn: urn,
                    text: text.substring(0, 10000),
                    timeText: timeText,
                    reactions: reactions,
                    comments: comments,
                    reposts: reposts,
                    images: images,
                    videoUrl: videoUrl,
                    articleUrl: articleUrl
                });
            }
            
            return posts;
        }''')
        
        result: List[Post] = []
        for data in posts_data:
            activity_id = data['urn'].replace('urn:li:activity:', '')
            post = Post(
                linkedin_url=f"https://www.linkedin.com/feed/update/urn:li:activity:{activity_id}/",
                urn=data['urn'],
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
        parts = text.split('•')
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
        """Scroll down to load more posts."""
        try:
            await self.page.keyboard.press('End')
            await self.page.wait_for_timeout(2000)
            
            # Also try clicking "Show more" buttons if present
            try:
                show_more = self.page.locator('button:has-text("Show more results"), button:has-text("Show more")')
                if await show_more.count() > 0:
                    await show_more.first.click()
                    await self.page.wait_for_timeout(1500)
            except:
                pass
        except Exception as e:
            logger.debug(f"Error scrolling: {e}")
