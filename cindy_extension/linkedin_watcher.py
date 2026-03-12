"""
LinkedIn Message Watcher — Cindy
=================================
Polls LinkedIn for new unread messages and fires your n8n webhook
whenever a new message arrives.

Setup:
    pip install requests

Run:
    python linkedin_watcher.py

To run in background (Linux/Mac):
    nohup python linkedin_watcher.py > watcher.log 2>&1 &

To run in background (Windows):
    pythonw linkedin_watcher.py
"""

import requests
import json
import time
import logging
from datetime import datetime
from pathlib import Path

# ─────────────────────────────────────────────
#  CONFIG — edit these values
# ─────────────────────────────────────────────

N8N_WEBHOOK_URL = "https://ammar-test-377.app.n8n.cloud/webhook/21d7f5af-8101-4dd5-8b26-92c4c50c6963"

MY_PROFILE_URN = "urn:li:fsd_profile:ACoAAGUt7KsBAHMQRodG7z6z8EjY3JaOMFu5TmM"

# Paste your full Cookie header value here (copy from browser DevTools → Network → any LinkedIn request → Headers)
LINKEDIN_COOKIE = (
    'bcookie="v=2&1bc0572f-db82-4bbd-8a0e-7314bdb56677"; '
    'li_at=AQEDAWUt7KsFj2I8AAABnOLFeSMAAAGdBtH9I1YAHOOFNjzGn9laPVus81xDJeEXEFq1hZQAbNF_G-VLLwhWFo-S9an05up5M9CVhEnCBYPGsoHoMXZTSPQyWYNoTQ7c0TOmU8PO1UfXmfSl4EAIxkNM; '
    'JSESSIONID="ajax:1991703646420322042"'
    # Add the rest of your cookies here if needed
)

CSRF_TOKEN = "ajax:1991703646420322042"  # taken from JSESSIONID value above

POLL_INTERVAL_SECONDS = 30  # how often to check (30s = near real-time, safe from rate limits)

SEEN_IDS_FILE = "seen_message_ids.json"  # persists seen IDs across restarts

# ─────────────────────────────────────────────
#  LOGGING
# ─────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler("watcher.log", encoding="utf-8"),
    ],
)
log = logging.getLogger("linkedin_watcher")

# ─────────────────────────────────────────────
#  HEADERS  (mirrors your working n8n config)
# ─────────────────────────────────────────────

HEADERS = {
    "Cookie": LINKEDIN_COOKIE,
    "csrf-token": CSRF_TOKEN,
    "Accept": "application/graphql",
    "x-restli-protocol-version": "2.0.0",
    "x-li-lang": "en_US",
    "x-li-track": json.dumps({
        "clientVersion": "1.13.42775",
        "mpVersion": "1.13.42775",
        "osName": "web",
        "timezoneOffset": 5,
        "timezone": "Asia/Karachi",
        "deviceFormFactor": "DESKTOP",
        "mpName": "voyager-web",
        "displayDensity": 1.25,
        "displayWidth": 1920,
        "displayHeight": 1080,
    }),
    "Referer": "https://www.linkedin.com/messaging/",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/145.0.0.0 Safari/537.36"
    ),
}

LINKEDIN_API_URL = (
    "https://www.linkedin.com/voyager/api/voyagerMessagingGraphQL/graphql"
    "?queryId=messengerConversations.0d5e6781bbee71c3e51c8843c6519f48"
    "&variables=(mailboxUrn:urn%3Ali%3Afsd_profile%3AACoAAGUt7KsBAHMQRodG7z6z8EjY3JaOMFu5TmM)"
)

# ─────────────────────────────────────────────
#  PERSIST SEEN MESSAGE IDs
# ─────────────────────────────────────────────

def load_seen_ids() -> set:
    path = Path(SEEN_IDS_FILE)
    if path.exists():
        try:
            return set(json.loads(path.read_text()))
        except Exception:
            pass
    return set()


def save_seen_ids(seen: set) -> None:
    try:
        Path(SEEN_IDS_FILE).write_text(json.dumps(list(seen)))
    except Exception as e:
        log.warning(f"Could not save seen IDs: {e}")

# ─────────────────────────────────────────────
#  FETCH CONVERSATIONS FROM LINKEDIN
# ─────────────────────────────────────────────

def fetch_conversations() -> list:
    try:
        resp = requests.get(LINKEDIN_API_URL, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        data = resp.json()

        # Try multiple nesting levels (LinkedIn API can vary)
        elements = (
            data.get("data", {}).get("messengerConversationsBySyncToken", {}).get("elements")
            or data.get("messengerConversationsBySyncToken", {}).get("elements")
            or []
        )
        return elements

    except requests.exceptions.HTTPError as e:
        if e.response.status_code == 401:
            log.error("401 Unauthorized — your LinkedIn cookies have expired. Please refresh them.")
        else:
            log.error(f"HTTP error fetching conversations: {e}")
    except requests.exceptions.ConnectionError:
        log.warning("Network error — will retry next cycle.")
    except Exception as e:
        log.error(f"Unexpected error fetching conversations: {e}")

    return []

# ─────────────────────────────────────────────
#  FIRE THE N8N WEBHOOK
# ─────────────────────────────────────────────

def fire_webhook(payload: dict) -> bool:
    try:
        resp = requests.get(N8N_WEBHOOK_URL, params=payload, timeout=10)
        resp.raise_for_status()
        log.info(f"✅ Webhook fired for message from {payload['senderName']!r}: "
                 f"{payload['messageText'][:60]!r}")
        return True
    except Exception as e:
        log.error(f"Failed to fire webhook: {e}")
        return False

# ─────────────────────────────────────────────
#  PROCESS ONE POLL CYCLE
# ─────────────────────────────────────────────

def check_messages(seen_ids: set) -> None:
    elements = fetch_conversations()
    if not elements:
        return

    new_found = 0

    for conv in elements:
        # Skip read / no unread
        if not conv.get("unreadCount") or conv.get("read") is True:
            continue

        messages = conv.get("messages", {}).get("elements", [])
        if not messages:
            continue

        # Sort newest first
        messages.sort(key=lambda m: m.get("deliveredAt", 0), reverse=True)
        latest = messages[0]

        # Build a stable unique ID for this message
        msg_id = latest.get("backendUrn") or str(latest.get("deliveredAt", ""))
        sender_urn = (
            latest.get("actor", {}).get("hostIdentityUrn")
            or latest.get("sender", {}).get("hostIdentityUrn", "")
        )

        # Skip if already handled or sent by me
        if msg_id in seen_ids or sender_urn == MY_PROFILE_URN:
            continue

        message_text = latest.get("body", {}).get("text", "").strip()
        if not message_text:
            continue

        # Extract sender name
        member = latest.get("actor", {}).get("participantType", {}).get("member", {})
        first = member.get("firstName", {}).get("text", "")
        last  = member.get("lastName",  {}).get("text", "")
        sender_name = f"{first} {last}".strip() or "there"

        payload = {
            "conversationUrn": conv.get("backendUrn", ""),
            "messageText": message_text,
            "senderName": sender_name,
            "status": "unread",
        }

        if fire_webhook(payload):
            seen_ids.add(msg_id)
            save_seen_ids(seen_ids)
            new_found += 1

    if new_found == 0:
        log.debug("No new messages this cycle.")

# ─────────────────────────────────────────────
#  MAIN LOOP
# ─────────────────────────────────────────────

def main():
    log.info("=" * 55)
    log.info("  LinkedIn Message Watcher — Cindy")
    log.info(f"  Webhook : {N8N_WEBHOOK_URL}")
    log.info(f"  Interval: {POLL_INTERVAL_SECONDS}s")
    log.info("=" * 55)

    seen_ids = load_seen_ids()
    log.info(f"Loaded {len(seen_ids)} previously seen message ID(s).")

    while True:
        try:
            check_messages(seen_ids)
        except KeyboardInterrupt:
            log.info("Stopped by user.")
            break
        except Exception as e:
            log.error(f"Unhandled error in main loop: {e}")

        time.sleep(POLL_INTERVAL_SECONDS)


if __name__ == "__main__":
    main()
