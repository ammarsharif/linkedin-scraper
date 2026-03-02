#!/usr/bin/env python3
"""
Create LinkedIn Session File

Since Google blocks Playwright (automated browser), we provide two methods:

METHOD 1 (Recommended): Extract li_at cookie from your regular Chrome browser
METHOD 2: Use your real Chrome profile to bypass Google's detection

Usage:
    python samples/create_session.py
"""
import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from linkedin_scraper import BrowserManager, wait_for_manual_login


async def method_cookie():
    """
    METHOD 1: Create session using li_at cookie from your regular browser.
    
    Steps:
    1. Open Chrome normally and go to linkedin.com (make sure you're logged in)
    2. Press F12 → Application tab → Cookies → linkedin.com
    3. Find the cookie named "li_at" and copy its value
    4. Paste it here when prompted
    """
    print("\n" + "=" * 60)
    print("  METHOD 1: Cookie-Based Session (Recommended)")
    print("=" * 60)
    print()
    print("  How to get your li_at cookie:")
    print("  1. Open Chrome and go to https://www.linkedin.com")
    print("  2. Make sure you are logged in")
    print("  3. Press F12 to open Developer Tools")
    print("  4. Click 'Application' tab at the top")
    print("  5. In the left sidebar: Storage → Cookies → https://www.linkedin.com")
    print("  6. Find the cookie named 'li_at'")
    print("  7. Double-click its Value and copy it")
    print()
    
    cookie_value = input("  Paste your li_at cookie value here: ").strip()
    
    if not cookie_value:
        print("  ❌ No cookie provided. Aborting.")
        return
    
    print("\n  🔄 Creating session with cookie...")
    
    async with BrowserManager(headless=False) as browser:
        # Set the li_at cookie
        await browser.page.context.add_cookies([{
            "name": "li_at",
            "value": cookie_value,
            "domain": ".linkedin.com",
            "path": "/"
        }])
        
        # Navigate to LinkedIn feed to verify
        await browser.page.goto("https://www.linkedin.com/feed/", wait_until="domcontentloaded")
        await asyncio.sleep(3)
        
        # Check if we're logged in
        current_url = browser.page.url
        if "login" in current_url or "authwall" in current_url:
            print("  ❌ Cookie is invalid or expired. Please get a fresh cookie.")
            return
        
        # Save session
        session_path = "linkedin_session.json"
        await browser.save_session(session_path)
        
        print(f"\n  ✅ Session saved to {session_path}")
        print("  You can now run: python samples/batch_scrape_posts.py")


async def method_chrome_profile():
    """
    METHOD 2: Use your real Chrome user data directory.
    This bypasses Google's automated browser detection.
    """
    print("\n" + "=" * 60)
    print("  METHOD 2: Real Chrome Profile Login")
    print("=" * 60)
    print()
    print("  ⚠️  IMPORTANT: Close ALL Chrome windows first!")
    print("     Playwright cannot use Chrome profile while Chrome is open.")
    print()
    
    input("  Press Enter after closing all Chrome windows...")
    
    # Find Chrome user data directory
    user_data_dir = os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\User Data")
    
    if not os.path.exists(user_data_dir):
        print(f"  ❌ Chrome profile not found at: {user_data_dir}")
        print("  Please use Method 1 (cookie) instead.")
        return
    
    print(f"\n  📂 Using Chrome profile: {user_data_dir}")
    print("  🔄 Opening browser with your Chrome profile...\n")
    
    from playwright.async_api import async_playwright
    
    async with async_playwright() as p:
        # Launch with real Chrome user data directory
        context = await p.chromium.launch_persistent_context(
            user_data_dir=user_data_dir,
            channel="chrome",
            headless=False,
            viewport={"width": 1280, "height": 800},
            args=[
                "--disable-blink-features=AutomationControlled",
                "--profile-directory=Default"
            ]
        )
        
        page = context.pages[0] if context.pages else await context.new_page()
        
        # Navigate to LinkedIn
        await page.goto("https://www.linkedin.com/", wait_until="domcontentloaded")
        
        print("  🔐 Please log in to LinkedIn in the browser window...")
        print('     → Click "Continue as Ammar" (Google) or sign in manually')
        print("     → You have 5 minutes")
        print("\n  ⏳ Waiting for login...\n")
        
        # Wait for login
        start_time = asyncio.get_event_loop().time()
        timeout = 300  # 5 minutes
        
        while True:
            current_url = page.url
            
            # Check if we're on an authenticated page
            auth_pages = ['/feed', '/mynetwork', '/messaging', '/notifications']
            if any(p in current_url for p in auth_pages):
                print("  ✓ Login detected!")
                break
            
            # Check for nav elements
            try:
                nav_count = await page.locator('nav a[href*="/feed"], nav a[href*="/mynetwork"]').count()
                if nav_count > 0:
                    print("  ✓ Login detected!")
                    break
            except:
                pass
            
            elapsed = asyncio.get_event_loop().time() - start_time
            if elapsed > timeout:
                print("  ❌ Timeout waiting for login.")
                await context.close()
                return
            
            await asyncio.sleep(1)
        
        # Extract cookies and save as session
        cookies = await context.cookies()
        session_data = {"cookies": cookies}
        
        session_path = "linkedin_session.json"
        with open(session_path, "w") as f:
            json.dump(session_data, f, indent=2)
        
        print(f"\n  ✅ Session saved to {session_path}")
        print("  You can now run: python samples/batch_scrape_posts.py")
        
        await context.close()


async def main():
    print("=" * 60)
    print("  LinkedIn Session Creator")
    print("=" * 60)
    print()
    print("  Choose a method:")
    print()
    print("  [1] Cookie Method (Recommended)")
    print("      → Copy li_at cookie from Chrome DevTools")
    print("      → Fastest and most reliable")
    print()
    print("  [2] Chrome Profile Method")
    print("      → Uses your real Chrome profile")
    print("      → Click 'Continue as Ammar' Google button")
    print("      → Must close all Chrome windows first")
    print()
    
    choice = input("  Enter choice (1 or 2): ").strip()
    
    if choice == "1":
        await method_cookie()
    elif choice == "2":
        await method_chrome_profile()
    else:
        print("  ❌ Invalid choice. Please enter 1 or 2.")


if __name__ == "__main__":
    asyncio.run(main())
