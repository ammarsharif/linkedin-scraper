"""Browser lifecycle management for Playwright."""

import asyncio
import json
import logging
import random
import traceback
from pathlib import Path
from typing import Optional, Dict, Any
from playwright.async_api import async_playwright, Browser, BrowserContext, Page, Playwright

from .exceptions import NetworkError

logger = logging.getLogger(__name__)

# ── Real Chrome user-agents (updated periodically) ───────────────────────────
_USER_AGENTS = [
    # Chrome 120 – Windows
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    # Chrome 121 – Windows
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    # Chrome 122 – Windows
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    # Chrome 123 – Windows
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    # Chrome 120 – macOS
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    # Chrome 122 – macOS
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    # Edge 121 – Windows (common in enterprise)
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.0.0",
]

# Common desktop viewport sizes — avoids robotic 1280x720 every time
_VIEWPORTS = [
    {"width": 1366, "height": 768},
    {"width": 1440, "height": 900},
    {"width": 1536, "height": 864},
    {"width": 1600, "height": 900},
    {"width": 1920, "height": 1080},
    {"width": 1280, "height": 800},
    {"width": 1280, "height": 720},
]


class BrowserManager:
    """Async context manager for Playwright browser lifecycle."""
    
    def __init__(
        self,
        headless: bool = True,
        slow_mo: int = 0,
        viewport: Optional[Dict[str, int]] = None,
        user_agent: Optional[str] = None,
        **launch_options: Any
    ):
        """
        Initialize browser manager.

        Args:
            headless: Run browser in headless mode
            slow_mo: Slow down operations by specified milliseconds
            viewport: Browser viewport size (randomised from common desktop sizes if not set)
            user_agent: Custom UA — leave None to use Playwright's real Chromium UA.
                        WARNING: Setting a hardcoded UA that differs from the actual
                        Chromium binary version creates a detectable mismatch.
            **launch_options: Additional Playwright launch options
        """
        self.headless = headless
        self.slow_mo = slow_mo
        # Randomise viewport per session so window dimensions vary naturally.
        self.viewport = viewport or random.choice(_VIEWPORTS)
        # Do NOT default to a hardcoded UA string — Playwright's built-in Chromium
        # UA is self-consistent with all JS APIs; any override risks a version mismatch.
        self.user_agent = user_agent  # None = use real Chromium UA
        self.launch_options = launch_options
        
        self._playwright: Optional[Playwright] = None
        self._browser: Optional[Browser] = None
        self._context: Optional[BrowserContext] = None
        self._page: Optional[Page] = None
        self._is_authenticated = False
    
    async def __aenter__(self) -> "BrowserManager":
        """Start browser and create context."""
        await self.start()
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        """Close browser and cleanup."""
        await self.close()
    
    async def start(self) -> None:
        """Start Playwright and launch browser with stealth anti-detection flags."""
        try:
            self._playwright = await async_playwright().start()

            # Safe Chromium launch flags that suppress automation signals.
            # Rules for what NOT to add:
            #   - --disable-features=IsolateOrigins,site-per-process  → breaks cross-origin
            #     cookie scoping, causing ERR_TOO_MANY_REDIRECTS on authenticated sites.
            stealth_args = [
                "--disable-blink-features=AutomationControlled",
                "--disable-infobars",
                "--no-first-run",
                "--no-service-autorun",
                "--password-store=basic",
                "--use-mock-keychain",
                f"--window-size={self.viewport['width']},{self.viewport['height']}",
            ]

            self._browser = await self._playwright.chromium.launch(
                headless=self.headless,
                slow_mo=self.slow_mo,
                args=stealth_args,
                **self.launch_options
            )

            logger.info(f"Browser launched (headless={self.headless})")

            # Context: only set viewport (and UA if caller explicitly passed one).
            # Do NOT add locale/timezone/color_scheme/extra_http_headers — every
            # non-default value is an extra fingerprint signal and can cause
            # inconsistencies that trip session-validation checks.
            context_options: Dict[str, Any] = {
                "viewport": self.viewport,
            }
            if self.user_agent:
                context_options["user_agent"] = self.user_agent

            self._context = await self._browser.new_context(**context_options)
            self._page = await self._context.new_page()

            # Log the real UA the browser is actually using
            real_ua = await self._page.evaluate("() => navigator.userAgent")
            logger.info(f"Real browser UA: {real_ua}")

            # playwright-stealth v2: masks navigator.webdriver and ~15 other
            # automation signals that LinkedIn's bot detection scripts probe.
            try:
                from playwright_stealth import Stealth
                await Stealth().apply_stealth_async(self._page)
                logger.info("playwright-stealth (v2) applied")
            except ImportError:
                logger.warning(
                    "playwright-stealth not installed. Run: pip install playwright-stealth"
                )
            except Exception as e:
                logger.warning(f"playwright-stealth error (non-fatal): {e}")

            logger.info("Browser context and page created")

        except Exception as e:
            logger.error(f"Error starting browser in browser.py:\n{traceback.format_exc()}")
            await self.close()
            raise NetworkError(f"Failed to start browser: {e}")

    async def close(self) -> None:
        """Close browser and cleanup resources."""
        try:
            if self._page:
                await self._page.close()
                self._page = None
            
            if self._context:
                await self._context.close()
                self._context = None
            
            if self._browser:
                await self._browser.close()
                self._browser = None
            
            if self._playwright:
                await self._playwright.stop()
                self._playwright = None
            
            logger.info("Browser closed")
            
        except Exception as e:
            logger.error(f"Error closing browser: {e}")
    
    async def new_page(self) -> Page:
        """
        Create a new page in the current context.
        
        Returns:
            New Playwright page
        """
        if not self._context:
            raise RuntimeError("Browser context not initialized. Call start() first.")
        
        page = await self._context.new_page()
        return page
    
    @property
    def page(self) -> Page:
        """
        Get the main page.
        
        Returns:
            Main Playwright page
        """
        if not self._page:
            raise RuntimeError("Browser not started. Use async context manager or call start().")
        return self._page
    
    @property
    def context(self) -> BrowserContext:
        """
        Get the browser context.
        
        Returns:
            Playwright browser context
        """
        if not self._context:
            raise RuntimeError("Browser context not initialized.")
        return self._context
    
    @property
    def browser(self) -> Browser:
        """
        Get the browser instance.
        
        Returns:
            Playwright browser
        """
        if not self._browser:
            raise RuntimeError("Browser not started.")
        return self._browser
    
    async def save_session(self, filepath: str) -> None:
        """
        Save browser session (cookies and storage) to file.
        
        Args:
            filepath: Path to save session file
        """
        if not self._context:
            raise RuntimeError("No browser context to save")
        
        storage_state = await self._context.storage_state()
        
        path = Path(filepath)
        path.parent.mkdir(parents=True, exist_ok=True)
        
        with open(filepath, 'w') as f:
            json.dump(storage_state, f, indent=2)
        
        logger.info(f"Session saved to {filepath}")
    
    async def load_session(self, filepath: str) -> None:
        """
        Load browser session from file.
        
        Args:
            filepath: Path to session file
        """
        if not Path(filepath).exists():
            raise FileNotFoundError(f"Session file not found: {filepath}")
        
        # Close existing context and create new one with stored state
        if self._context:
            await self._context.close()
        
        if not self._browser:
            raise RuntimeError("Browser not started")
        
        self._context = await self._browser.new_context(
            storage_state=filepath,
            viewport=self.viewport,
            user_agent=self.user_agent
        )
        
        # Create new page
        if self._page:
            await self._page.close()
        self._page = await self._context.new_page()
        
        self._is_authenticated = True
        
        logger.info(f"Session loaded from {filepath}")
    
    async def set_cookie(self, name: str, value: str, domain: str = ".linkedin.com") -> None:
        """
        Set a single cookie.
        
        Args:
            name: Cookie name
            value: Cookie value
            domain: Cookie domain
        """
        if not self._context:
            raise RuntimeError("No browser context")
        
        await self._context.add_cookies([{
            "name": name,
            "value": value,
            "domain": domain,
            "path": "/"
        }])
        
        logger.debug(f"Cookie set: {name}")
    
    @property
    def is_authenticated(self) -> bool:
        """Check if user is authenticated."""
        return self._is_authenticated
    
    @is_authenticated.setter
    def is_authenticated(self, value: bool) -> None:
        """Set authentication status."""
        self._is_authenticated = value
