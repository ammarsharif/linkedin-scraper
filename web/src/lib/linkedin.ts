/**
 * LinkedIn data extraction via authenticated HTML page parsing.
 *
 * Instead of relying on Voyager API JSON shape (which changes frequently),
 * we fetch the real HTML pages with the li_at cookie and parse:
 *   - Profile name from the <title> / og:title tag
 *   - Posts from <code> tags that LinkedIn embeds in activity pages
 */

export interface LinkedInProfile {
  name: string;
  headline: string;
  location: string;
  profileUrl: string;
  vanityName: string;
}

export interface LinkedInPost {
  urn: string;
  text: string;
  postedDate: string;
  reactionsCount: number;
  commentsCount: number;
  repostsCount: number;
  postUrl: string;
  imageUrls: string[];
  videoUrl: string | null;
  articleUrl: string | null;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

export function extractVanityName(url: string): string {
  const match = url.match(/linkedin\.com\/in\/([^/?#]+)/i);
  if (!match) throw new Error(`Invalid LinkedIn profile URL: ${url}`);
  return match[1].replace(/\/$/, "");
}

function buildFetchHeaders(liAtCookie: string): Record<string, string> {
  // Use a fixed JSESSIONID — LinkedIn validates csrf-token == JSESSIONID cookie
  const csrf = "ajax:1234567890123456";
  return {
    Cookie: `li_at=${liAtCookie}; JSESSIONID="${csrf}"`,
    "csrf-token": csrf,
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    Referer: "https://www.linkedin.com/",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    "Upgrade-Insecure-Requests": "1",
  };
}

function buildApiHeaders(liAtCookie: string): Record<string, string> {
  const csrf = "ajax:1234567890123456";
  return {
    Cookie: `li_at=${liAtCookie}; JSESSIONID="${csrf}"`,
    "csrf-token": csrf,
    "x-li-lang": "en_US",
    "x-restli-protocol-version": "2.0.0",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "application/vnd.linkedin.normalized+json+2.1",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: "https://www.linkedin.com/feed/",
    Origin: "https://www.linkedin.com",
  };
}

/** Fetch a URL and return Response | null (null = auth failure / redirect). */
async function safeFetch(
  url: string,
  headers: Record<string, string>
): Promise<Response | null> {
  try {
    const res = await fetch(url, {
      headers,
      redirect: "manual", // never follow — LinkedIn redirects mean invalid cookie
    });
    // 3xx = being redirected to login → auth failure
    if (res.status >= 300 && res.status < 400) return null;
    if (res.status === 401 || res.status === 403) return null;
    return res;
  } catch (err) {
    console.error("safeFetch error:", err);
    return null;
  }
}

// ─── validate cookie ───────────────────────────────────────────────────────────

export async function validateCookie(
  liAtCookie: string
): Promise<{ valid: boolean; name?: string }> {
  // Validate by fetching the user's own feed page HTML
  const res = await safeFetch(
    "https://www.linkedin.com/feed/",
    buildFetchHeaders(liAtCookie)
  );

  if (!res || !res.ok) return { valid: false };

  const html = await res.text();

  // A logged-in feed page contains the user's name in og:title or in the nav
  if (
    html.includes("feed-identity-module") ||
    html.includes("global-nav__primary-link") ||
    html.includes('"activeUser"') ||
    html.includes("mynetwork") ||
    html.includes("/in/")
  ) {
    // Try to extract name from og:title or title tag
    const name = extractNameFromFeedHtml(html);
    return { valid: true, name };
  }

  // If we see the login page content, cookie is invalid
  if (
    html.includes("login-form") ||
    html.includes("join-form") ||
    html.includes("authwall")
  ) {
    return { valid: false };
  }

  // Assume valid if we got 200 without login form
  return { valid: true, name: "LinkedIn User" };
}

function extractNameFromFeedHtml(html: string): string {
  // Try og:title: <meta property="og:title" content="John Doe | LinkedIn">
  const ogTitle = html.match(
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i
  );
  if (ogTitle?.[1]) {
    return ogTitle[1].replace(/\s*\|.*$/, "").trim();
  }

  // Try <title> tag
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  if (titleMatch?.[1]) {
    return titleMatch[1].replace(/\s*\|.*$/, "").trim();
  }

  return "LinkedIn User";
}

// ─── fetch profile ─────────────────────────────────────────────────────────────

export async function fetchProfile(
  liAtCookie: string,
  vanityName: string
): Promise<LinkedInProfile> {
  const profileUrl = `https://www.linkedin.com/in/${encodeURIComponent(vanityName)}/`;

  // Fetch the profile HTML page
  const res = await safeFetch(profileUrl, buildFetchHeaders(liAtCookie));

  if (!res || !res.ok) {
    // Return minimal info if we can't fetch
    return {
      name: vanityName,
      headline: "",
      location: "",
      profileUrl,
      vanityName,
    };
  }

  const html = await res.text();
  return parseProfileFromHtml(html, vanityName, profileUrl);
}

function parseProfileFromHtml(
  html: string,
  vanityName: string,
  profileUrl: string
): LinkedInProfile {
  let name = vanityName;
  let headline = "";
  let location = "";

  // 1. og:title → "First Last - Title | LinkedIn" or "First Last | LinkedIn"
  const ogTitleMatch = html.match(
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i
  );
  if (ogTitleMatch?.[1]) {
    const raw = ogTitleMatch[1].replace(/\s*\|\s*LinkedIn\s*$/i, "").trim();
    // raw = "First Last - Some Title at Company"
    if (raw.includes(" - ")) {
      const parts = raw.split(" - ");
      name = parts[0].trim();
      headline = parts.slice(1).join(" - ").trim();
    } else {
      name = raw;
    }
  }

  // 2. <title> fallback
  if (name === vanityName) {
    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    if (titleMatch?.[1]) {
      const raw = titleMatch[1]
        .replace(/\s*\|\s*LinkedIn\s*$/i, "")
        .trim();
      if (raw.includes(" - ")) {
        const parts = raw.split(" - ");
        name = parts[0].trim();
        headline = parts.slice(1).join(" - ").trim();
      } else if (raw) {
        name = raw;
      }
    }
  }

  // 3. og:description → usually "location · headline"  or just headline
  const ogDescMatch = html.match(
    /<meta[^>]+(?:property=["']og:description["']|name=["']description["'])[^>]+content=["']([^"']+)["']/i
  );
  if (ogDescMatch?.[1]) {
    const desc = ogDescMatch[1].trim();
    // LinkedIn og:description is often "Followers · Connections · Bio"
    // or "Location · Connections · ..."
    const parts = desc.split("·").map((p) => p.trim());
    if (parts.length > 0 && !location) {
      // First part is often location or follower count
      if (!parts[0].toLowerCase().includes("follower")) {
        location = parts[0];
      }
    }
  }

  // 4. Try JSON-LD embedded in page
  const jsonLdMatch = html.match(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  );
  if (jsonLdMatch) {
    for (const block of jsonLdMatch) {
      try {
        const jsonStr = block
          .replace(/<script[^>]*>/i, "")
          .replace(/<\/script>/i, "");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const parsed: any = JSON.parse(jsonStr);
        if (parsed?.name && name === vanityName) {
          name = parsed.name;
        }
        if (parsed?.jobTitle && !headline) {
          headline = parsed.jobTitle;
        }
        if (parsed?.address?.addressLocality && !location) {
          location = parsed.address.addressLocality;
        }
      } catch {
        // skip malformed JSON-LD
      }
    }
  }

  // Clean up name — remove any trailing pipe / LinkedIn branding
  name = name.replace(/\s*\|\s*LinkedIn\s*$/i, "").trim() || vanityName;

  return { name, headline, location, profileUrl, vanityName };
}

// ─── fetch posts ───────────────────────────────────────────────────────────────

export async function fetchPosts(
  liAtCookie: string,
  vanityName: string,
  limit: number = 10
): Promise<LinkedInPost[]> {
  // Try Voyager JSON API first (fastest)
  const apiPosts = await fetchPostsViaApi(liAtCookie, vanityName, limit);
  if (apiPosts.length > 0) return apiPosts;

  // Fallback: parse activity page HTML
  return await fetchPostsViaHtml(liAtCookie, vanityName, limit);
}

// ─── posts via Voyager JSON API ────────────────────────────────────────────────

async function fetchPostsViaApi(
  liAtCookie: string,
  vanityName: string,
  limit: number
): Promise<LinkedInPost[]> {
  const apiHeaders = buildApiHeaders(liAtCookie);
  const encodedName = encodeURIComponent(vanityName);

  // Try multiple Voyager endpoints in order
  const endpoints = [
    // 1. feed/dash endpoint (newer, works for most profiles)
    `https://www.linkedin.com/voyager/api/feed/dash/feedUpdates` +
      `?q=profileUpdatesByMemberShareFeed&memberIdentity=${encodedName}` +
      `&count=${Math.min(limit, 50)}&start=0`,

    // 2. identity/profileUpdatesV2 (older but still used)
    `https://www.linkedin.com/voyager/api/identity/profileUpdatesV2` +
      `?publicIdentifier=${encodedName}&q=memberShareFeed` +
      `&count=${Math.min(limit, 50)}&start=0`,
  ];

  for (const url of endpoints) {
    try {
      const res = await safeFetch(url, apiHeaders);
      if (!res?.ok) continue;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let data: any;
      try {
        data = await res.json();
      } catch {
        continue;
      }

      const posts = parsePostsFromApiResponse(data, limit);
      if (posts.length > 0) return posts;
    } catch (err) {
      console.error("Voyager API error:", err);
    }
  }

  return [];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parsePostsFromApiResponse(data: any, limit: number): LinkedInPost[] {
  const posts: LinkedInPost[] = [];

  // LinkedIn normalises responses into `data` + `included` arrays
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const elements: any[] = [
    ...(Array.isArray(data?.elements) ? data.elements : []),
    ...(Array.isArray(data?.included) ? data.included : []),
    ...(Array.isArray(data?.data?.elements) ? data.data.elements : []),
  ];

  for (const el of elements) {
    if (posts.length >= limit) break;

    const urn: string =
      el?.urn ?? el?.entityUrn ?? el?.["*update"] ?? "";

    if (!urn || (!urn.includes("activity:") && !urn.includes("ugcPost:")))
      continue;

    // Text lives in different places depending on endpoint version
    const text: string =
      el?.commentary?.text?.text ??
      el?.commentary?.text ??
      el?.shareCommentary?.text?.text ??
      el?.shareCommentary?.text ??
      el?.updateMetadata?.shareCommentary?.text ??
      el?.specificContent?.["com.linkedin.ugc.ShareContent"]
        ?.shareCommentary?.text ??
      "";

    const social = el?.socialDetail ?? el?.socialSummary ?? {};
    const reactionsCount: number =
      social?.totalSocialActivityCounts?.numLikes ??
      social?.numLikes ??
      el?.numLikes ??
      0;
    const commentsCount: number =
      social?.totalSocialActivityCounts?.numComments ??
      social?.numComments ??
      el?.numComments ??
      0;
    const repostsCount: number =
      social?.totalSocialActivityCounts?.numShares ??
      social?.numShares ??
      el?.numShares ??
      0;

    const activityMatch = urn.match(/activity:(\d+)/);
    const ugcMatch = urn.match(/ugcPost:(\d+)/);
    const activityId = activityMatch?.[1] ?? ugcMatch?.[1] ?? "";
    const postUrl = activityId
      ? `https://www.linkedin.com/feed/update/urn:li:activity:${activityId}/`
      : "";

    const rawTs: number =
      el?.createdAt?.time ?? el?.created?.time ?? el?.createdAt ?? 0;
    const postedDate = rawTs
      ? new Date(rawTs).toLocaleDateString("en-US", {
          year: "numeric",
          month: "short",
          day: "numeric",
        })
      : "";

    if (text || activityId) {
      posts.push({
        urn,
        text,
        postedDate,
        reactionsCount,
        commentsCount,
        repostsCount,
        postUrl,
        imageUrls: [],
        videoUrl: null,
        articleUrl: null,
      });
    }
  }

  return posts.slice(0, limit);
}

// ─── posts via HTML parsing ────────────────────────────────────────────────────

async function fetchPostsViaHtml(
  liAtCookie: string,
  vanityName: string,
  limit: number
): Promise<LinkedInPost[]> {
  const activityUrl = `https://www.linkedin.com/in/${encodeURIComponent(vanityName)}/recent-activity/all/`;

  const res = await safeFetch(activityUrl, buildFetchHeaders(liAtCookie));
  if (!res?.ok) return [];

  const html = await res.text();
  return parsePostsFromActivityHtml(html, limit);
}

function parsePostsFromActivityHtml(html: string, limit: number): LinkedInPost[] {
  const posts: LinkedInPost[] = [];
  const seen = new Set<string>();

  // LinkedIn embeds its Voyager data inside <code> tags on SSR pages
  // Each <code> block contains JSON we can parse
  const codeBlocks = html.match(/<code[^>]*>([\s\S]*?)<\/code>/gi) ?? [];

  for (const block of codeBlocks) {
    if (posts.length >= limit) break;

    const inner = block
      .replace(/<code[^>]*>/i, "")
      .replace(/<\/code>/i, "")
      .trim();

    if (!inner.includes("activity:")) continue;

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parsed: any = JSON.parse(inner);
      const parsed_posts = parsePostsFromApiResponse(parsed, limit - posts.length);
      for (const p of parsed_posts) {
        if (!seen.has(p.urn)) {
          seen.add(p.urn);
          posts.push(p);
        }
      }
    } catch {
      // not JSON — try to extract URNs directly from the raw text
      const urnMatches = inner.matchAll(/urn:li:activity:(\d+)/g);
      for (const m of urnMatches) {
        if (posts.length >= limit) break;
        const activityId = m[1];
        const urn = `urn:li:activity:${activityId}`;
        if (seen.has(urn)) continue;
        seen.add(urn);

        posts.push({
          urn,
          text: "",
          postedDate: "",
          reactionsCount: 0,
          commentsCount: 0,
          repostsCount: 0,
          postUrl: `https://www.linkedin.com/feed/update/${urn}/`,
          imageUrls: [],
          videoUrl: null,
          articleUrl: null,
        });
      }
    }
  }

  // Also scan for URNs directly in the raw HTML as a last resort
  if (posts.length === 0) {
    const urnMatches = html.matchAll(/urn:li:activity:(\d+)/g);
    for (const m of urnMatches) {
      if (posts.length >= limit) break;
      const urn = `urn:li:activity:${m[1]}`;
      if (seen.has(urn)) continue;
      seen.add(urn);

      posts.push({
        urn,
        text: "",
        postedDate: "",
        reactionsCount: 0,
        commentsCount: 0,
        repostsCount: 0,
        postUrl: `https://www.linkedin.com/feed/update/${urn}/`,
        imageUrls: [],
        videoUrl: null,
        articleUrl: null,
      });
    }
  }

  return posts;
}
