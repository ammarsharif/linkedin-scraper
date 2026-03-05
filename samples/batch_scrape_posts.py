#!/usr/bin/env python3
"""
Batch LinkedIn Profile Posts Scraper

Scrape posts from multiple LinkedIn profiles and export to a CSV spreadsheet.
Great for content research - analyze what top profiles are posting about.

Usage:
    python samples/batch_scrape_posts.py

Setup:
    1. First create a session: python samples/create_session.py
    2. Edit the PROFILE_URLS list below with the profiles you want to scrape
    3. Run this script
    
Output:
    - scraped_posts.csv  (spreadsheet with all posts)
    - scraped_posts.json (JSON with full data)
"""
import asyncio
import sys
import os

# Add parent directory to path so we can import linkedin_scraper
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from linkedin_scraper.core.browser import BrowserManager
from linkedin_scraper.scrapers.person_posts import PersonPostsScraper
from linkedin_scraper.scrapers.person import PersonScraper
from linkedin_scraper.export import export_posts_to_csv, export_posts_to_json, export_batch_results_to_csv


# ============================================================
# CONFIGURATION - Edit these values
# ============================================================

# =============================================
# ADD YOUR LINKEDIN PROFILE URLs HERE 👇
# =============================================
PROFILE_URLS = [
    "https://www.linkedin.com/in/imnaveedsarwar/?locale=en",
]

# Maximum number of posts to scrape per profile
POSTS_PER_PROFILE = 10

# Output file paths
OUTPUT_CSV = "scraped_posts.csv"
OUTPUT_JSON = "scraped_posts.json"

# Delay between profiles (seconds) - to avoid rate limiting
DELAY_BETWEEN_PROFILES = 5

# Session file path
SESSION_FILE = "linkedin_session.json"

# ============================================================


async def main():
    """Scrape posts from multiple LinkedIn profiles."""
    print("=" * 60)
    print("  LinkedIn Profile Posts Batch Scraper")
    print("=" * 60)
    print(f"\n  Profiles to scrape: {len(PROFILE_URLS)}")
    print(f"  Posts per profile:  {POSTS_PER_PROFILE}")
    print(f"  Output CSV:         {OUTPUT_CSV}")
    print(f"  Output JSON:        {OUTPUT_JSON}")
    print(f"\n{'=' * 60}\n")
    
    # Check if session file exists
    if not os.path.exists(SESSION_FILE):
        print(f"❌ Session file not found: {SESSION_FILE}")
        print("   Please run 'python samples/create_session.py' first to create a session.")
        return
    
    all_results = []
    
    async with BrowserManager(headless=False) as browser:
        # Load authenticated session
        await browser.load_session(SESSION_FILE)
        print("✓ Session loaded\n")
        
        # Initialize scrapers
        posts_scraper = PersonPostsScraper(browser.page)
        person_scraper = PersonScraper(browser.page)
        
        for i, profile_url in enumerate(PROFILE_URLS, 1):
            print(f"\n{'─' * 50}")
            print(f"  [{i}/{len(PROFILE_URLS)}] Scraping: {profile_url}")
            print(f"{'─' * 50}")
            
            try:
                # First get the person's name
                profile_name = "Unknown"
                try:
                    person = await person_scraper.scrape(profile_url)
                    profile_name = person.name or "Unknown"
                    print(f"  👤 Profile: {profile_name}")
                except Exception as e:
                    print(f"  ⚠️  Could not get profile name via scraper: {e}")
                
                # Fallback: try to get name from page title if still Unknown
                if profile_name == "Unknown":
                    try:
                        import re
                        # Navigate to profile page to get the title
                        await browser.page.goto(profile_url, wait_until='domcontentloaded', timeout=30000)
                        await asyncio.sleep(2)
                        page_title = await browser.page.title()
                        if page_title and "LinkedIn" in page_title:
                            cleaned = re.sub(r'\s*\|\s*LinkedIn\s*$', '', page_title).strip()
                            if cleaned:
                                if " - " in cleaned:
                                    parts = cleaned.split(" - ")
                                    candidate = parts[0].strip()
                                else:
                                    candidate = cleaned
                                if candidate and len(candidate) > 1 and candidate != "LinkedIn":
                                    profile_name = candidate
                                    print(f"  👤 Profile (from title): {profile_name}")
                    except Exception as e2:
                        print(f"  ⚠️  Fallback name extraction also failed: {e2}")
                
                # Now scrape their posts
                print(f"  📝 Scraping up to {POSTS_PER_PROFILE} posts...")
                posts = await posts_scraper.scrape(profile_url, limit=POSTS_PER_PROFILE)
                print(f"  ✓ Found {len(posts)} posts")
                
                # Store results
                all_results.append({
                    "profile_name": profile_name,
                    "profile_url": profile_url,
                    "posts": posts
                })
                
                # Print preview
                for j, post in enumerate(posts[:3], 1):
                    text_preview = post.text[:80] + "..." if post.text and len(post.text) > 80 else post.text
                    print(f"    Post {j}: {text_preview}")
                    print(f"      📊 Reactions: {post.reactions_count or 0} | "
                          f"Comments: {post.comments_count or 0} | "
                          f"Reposts: {post.reposts_count or 0}")
                
                if len(posts) > 3:
                    print(f"    ... and {len(posts) - 3} more posts")
                
            except Exception as e:
                print(f"  ❌ Error scraping {profile_url}: {e}")
                all_results.append({
                    "profile_name": "Error",
                    "profile_url": profile_url,
                    "posts": []
                })
            
            # Delay between profiles to avoid rate limiting
            if i < len(PROFILE_URLS):
                print(f"\n  ⏳ Waiting {DELAY_BETWEEN_PROFILES}s before next profile...")
                await asyncio.sleep(DELAY_BETWEEN_PROFILES)
    
    # Export results
    print(f"\n{'=' * 60}")
    print("  Exporting Results")
    print(f"{'=' * 60}\n")
    
    # Export to CSV
    export_batch_results_to_csv(all_results, OUTPUT_CSV)
    print(f"  ✓ CSV exported: {os.path.abspath(OUTPUT_CSV)}")
    
    # Export to JSON
    total_posts = 0
    for i, result in enumerate(all_results):
        export_posts_to_json(
            posts=result["posts"],
            filepath=OUTPUT_JSON,
            profile_name=result["profile_name"],
            profile_url=result["profile_url"],
            append=(i > 0)
        )
        total_posts += len(result["posts"])
    
    print(f"  ✓ JSON exported: {os.path.abspath(OUTPUT_JSON)}")
    
    # Summary
    print(f"\n{'=' * 60}")
    print("  Summary")
    print(f"{'=' * 60}")
    print(f"  Total profiles scraped: {len(all_results)}")
    print(f"  Total posts collected:  {total_posts}")
    print(f"  CSV file:  {os.path.abspath(OUTPUT_CSV)}")
    print(f"  JSON file: {os.path.abspath(OUTPUT_JSON)}")
    print(f"\n  Open the CSV file in Excel or Google Sheets to analyze!")
    print(f"{'=' * 60}\n")


if __name__ == "__main__":
    asyncio.run(main())
