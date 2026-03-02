"""Export utilities for LinkedIn scraper - CSV and Excel export for scraped data."""

import csv
import json
import logging
import os
import re
from datetime import datetime
from typing import List, Optional, Dict, Any

from .models.post import Post

logger = logging.getLogger(__name__)


def export_posts_to_csv(
    posts: List[Post],
    filepath: str,
    profile_name: str = "",
    profile_url: str = "",
    append: bool = False
) -> str:
    """
    Export a list of Post objects to a CSV file.
    
    Args:
        posts: List of Post objects to export
        filepath: Output CSV file path
        profile_name: Name of the profile these posts belong to
        profile_url: URL of the profile
        append: If True, append to existing file; if False, create new file
        
    Returns:
        The filepath of the created CSV
    """
    headers = [
        "Profile Name",
        "Profile URL",
        "Post Text",
        "Posted Date",
        "Reactions",
        "Comments",
        "Reposts",
        "Image URLs",
        "Video URL",
        "Article URL",
        "Post URL",
        "Post URN",
        "Scraped At"
    ]
    
    file_exists = os.path.exists(filepath)
    mode = 'a' if append and file_exists else 'w'
    write_header = not (append and file_exists)
    
    scraped_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    with open(filepath, mode, newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        
        if write_header:
            writer.writerow(headers)
        
        for post in posts:
            # Join image URLs with pipe separator
            image_urls_str = " | ".join(post.image_urls) if post.image_urls else ""
            
            # Clean text - remove "...more" / "see less" artifacts but keep paragraphs
            clean_text = post.text if post.text else ""
            # Remove common LinkedIn expand/collapse artifacts
            clean_text = re.sub(r'\s*…more\s*', '', clean_text)
            clean_text = re.sub(r'\s*\.\.\.more\s*', '', clean_text)
            clean_text = re.sub(r'\s*see less\s*', '', clean_text, flags=re.IGNORECASE)
            clean_text = re.sub(r'\s*See less\s*', '', clean_text)
            clean_text = clean_text.strip()
            
            writer.writerow([
                profile_name,
                profile_url,
                clean_text,
                post.posted_date or "",
                post.reactions_count if post.reactions_count is not None else "",
                post.comments_count if post.comments_count is not None else "",
                post.reposts_count if post.reposts_count is not None else "",
                image_urls_str,
                post.video_url or "",
                post.article_url or "",
                post.linkedin_url or "",
                post.urn or "",
                scraped_at
            ])
    
    logger.info(f"Exported {len(posts)} posts to {filepath}")
    return filepath


def export_posts_to_json(
    posts: List[Post],
    filepath: str,
    profile_name: str = "",
    profile_url: str = "",
    append: bool = False
) -> str:
    """
    Export a list of Post objects to a JSON file.
    
    Args:
        posts: List of Post objects to export
        filepath: Output JSON file path
        profile_name: Name of the profile these posts belong to
        profile_url: URL of the profile
        append: If True, merge with existing file data; if False, create new file
        
    Returns:
        The filepath of the created JSON
    """
    scraped_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    new_entries = []
    for post in posts:
        entry = post.to_dict()
        entry["profile_name"] = profile_name
        entry["profile_url"] = profile_url
        entry["scraped_at"] = scraped_at
        new_entries.append(entry)
    
    if append and os.path.exists(filepath):
        with open(filepath, 'r', encoding='utf-8') as f:
            existing_data = json.load(f)
        if isinstance(existing_data, list):
            existing_data.extend(new_entries)
        else:
            existing_data = new_entries
    else:
        existing_data = new_entries
    
    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(existing_data, f, indent=2, ensure_ascii=False)
    
    logger.info(f"Exported {len(posts)} posts to {filepath}")
    return filepath


def export_batch_results_to_csv(
    results: List[Dict[str, Any]],
    filepath: str
) -> str:
    """
    Export batch scraping results to a single CSV file.
    
    Args:
        results: List of dicts with keys: profile_name, profile_url, posts (List[Post])
        filepath: Output CSV file path
        
    Returns:
        The filepath of the created CSV
    """
    total_posts = 0
    
    for i, result in enumerate(results):
        posts = result.get("posts", [])
        profile_name = result.get("profile_name", "Unknown")
        profile_url = result.get("profile_url", "")
        
        export_posts_to_csv(
            posts=posts,
            filepath=filepath,
            profile_name=profile_name,
            profile_url=profile_url,
            append=(i > 0)  # Append after first profile
        )
        total_posts += len(posts)
    
    logger.info(f"Batch export complete: {total_posts} posts from {len(results)} profiles to {filepath}")
    return filepath
