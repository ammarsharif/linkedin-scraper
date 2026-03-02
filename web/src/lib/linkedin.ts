/**
 * LinkedIn Voyager API utility
 *
 * Uses the li_at session cookie to call LinkedIn's internal Voyager API
 * for reliable, structured data (no Playwright / browser needed).
 */

// --------------- types ---------------

export interface LinkedInProfile {
  name: string;
  headline: string;
  location: string;
  profileUrl: string;
  vanityName: string;
  publicIdentifier: string;
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

export interface ScrapeResult {
  profile: LinkedInProfile;
  posts: LinkedInPost[];
}

// --------------- helpers ---------------

function generateCsrfToken(): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "ajax:";
  for (let i = 0; i < 16; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function buildHeaders(liAtCookie: string) {
  const csrfToken = generateCsrfToken();
  return {
    Cookie: `li_at=${liAtCookie}; JSESSIONID="${csrfToken}"`,
    "csrf-token": csrfToken,
    "x-li-lang": "en_US",
    "x-restli-protocol-version": "2.0.0",
    "x-li-page-instance":
      "urn:li:page:d_flagship3_profile_view_base;randomId==",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "application/vnd.linkedin.normalized+json+2.1",
    "Accept-Language": "en-US,en;q=0.9",
  };
}

/**
 * Extract the vanity-name / public-identifier from a LinkedIn profile URL.
 */
export function extractVanityName(url: string): string {
  // https://www.linkedin.com/in/some-name/  →  some-name
  const match = url.match(/linkedin\.com\/in\/([^/?#]+)/i);
  if (!match) throw new Error(`Invalid LinkedIn profile URL: ${url}`);
  return match[1].replace(/\/$/, "");
}

// --------------- API calls ---------------

/**
 * Validate a li_at cookie by fetching the authenticated user's own profile.
 * Returns the user's display name on success, or throws on failure.
 */
export async function validateCookie(
  liAtCookie: string
): Promise<{ valid: boolean; name?: string }> {
  try {
    const res = await fetch(
      "https://www.linkedin.com/voyager/api/me",
      { headers: buildHeaders(liAtCookie), redirect: "manual" }
    );

    if (res.status === 401 || res.status === 403 || res.status >= 300) {
      return { valid: false };
    }

    const data = await res.json();

    // The /me endpoint returns a miniProfile
    const mp =
      data?.miniProfile ??
      data?.included?.find(
        (e: Record<string, unknown>) => e.$type === "com.linkedin.voyager.identity.shared.MiniProfile"
      );

    const firstName = mp?.firstName ?? data?.firstName ?? "";
    const lastName = mp?.lastName ?? data?.lastName ?? "";
    const name = `${firstName} ${lastName}`.trim() || "LinkedIn User";

    return { valid: true, name };
  } catch {
    return { valid: false };
  }
}

/**
 * Fetch a LinkedIn profile by vanity name.
 */
export async function fetchProfile(
  liAtCookie: string,
  vanityName: string
): Promise<LinkedInProfile> {
  const headers = buildHeaders(liAtCookie);

  const url = `https://www.linkedin.com/voyager/api/identity/profiles/${encodeURIComponent(vanityName)}`;

  const res = await fetch(url, { headers });

  if (!res.ok) {
    throw new Error(
      `Failed to fetch profile (${res.status}): ${vanityName}`
    );
  }

  const data = await res.json();

  // Dig out the mini profile for first/last name
  const mp =
    data?.miniProfile ??
    data?.included?.find(
      (e: Record<string, unknown>) => e.$type === "com.linkedin.voyager.identity.shared.MiniProfile"
    ) ??
    {};

  const firstName =
    mp?.firstName ?? data?.firstName ?? data?.profile?.firstName ?? "";
  const lastName =
    mp?.lastName ?? data?.lastName ?? data?.profile?.lastName ?? "";

  const name = `${firstName} ${lastName}`.trim() || vanityName;

  const headline =
    mp?.headline ?? data?.headline ?? data?.profile?.headline ?? "";
  const location =
    data?.locationName ??
    data?.geoLocationName ??
    mp?.locationName ??
    data?.profile?.locationName ??
    "";

  return {
    name,
    headline,
    location,
    profileUrl: `https://www.linkedin.com/in/${vanityName}/`,
    vanityName,
    publicIdentifier: vanityName,
  };
}

/**
 * Fetch recent posts / activity for a profile.
 *
 * Uses the /identity/profileUpdatesV2 endpoint with a feed query.
 */
export async function fetchPosts(
  liAtCookie: string,
  vanityName: string,
  limit: number = 10
): Promise<LinkedInPost[]> {
  const headers = buildHeaders(liAtCookie);

  // Step 1: Get the profile URN
  const profileRes = await fetch(
    `https://www.linkedin.com/voyager/api/identity/profiles/${encodeURIComponent(vanityName)}`,
    { headers }
  );
  if (!profileRes.ok) {
    throw new Error(`Cannot resolve profile URN for ${vanityName}`);
  }
  const profileData = await profileRes.json();

  // Try to get the entityUrn from the profile data
  const entityUrn =
    profileData?.entityUrn ??
    profileData?.profile?.entityUrn ??
    profileData?.miniProfile?.entityUrn;

  if (!entityUrn) {
    // Fallback: try fetching posts using a different endpoint
    return await fetchPostsFallback(liAtCookie, vanityName, limit, headers);
  }

  // Convert urn:li:fs_profile:ABC to urn:li:fsd_profile:ABC
  const profileUrn = entityUrn.replace("fs_profile", "fsd_profile");

  // Step 2: Fetch updates
  const feedUrl = new URL(
    "https://www.linkedin.com/voyager/api/identity/profileUpdatesV2"
  );
  feedUrl.searchParams.set("profileUrn", profileUrn);
  feedUrl.searchParams.set("q", "memberShareFeed");
  feedUrl.searchParams.set("moduleKey", "member-shares:phone");
  feedUrl.searchParams.set("count", String(Math.min(limit, 50)));
  feedUrl.searchParams.set("start", "0");

  const feedRes = await fetch(feedUrl.toString(), { headers });

  if (!feedRes.ok) {
    return await fetchPostsFallback(liAtCookie, vanityName, limit, headers);
  }

  const feedData = await feedRes.json();
  return parsePostsFromFeed(feedData, limit);
}

/**
 * Fallback: Fetch posts from the activity page HTML
 */
async function fetchPostsFallback(
  liAtCookie: string,
  vanityName: string,
  limit: number,
  headers: Record<string, string>
): Promise<LinkedInPost[]> {
  // Try the feed/dash endpoint
  try {
    const altUrl = `https://www.linkedin.com/voyager/api/feed/dash/feedUpdates?q=profileUpdatesByMemberShareFeed&memberIdentity=${encodeURIComponent(vanityName)}&count=${Math.min(limit, 50)}&start=0`;
    const altRes = await fetch(altUrl, { headers });
    if (altRes.ok) {
      const altData = await altRes.json();
      return parsePostsFromFeed(altData, limit);
    }
  } catch {
    // continue
  }

  // Final fallback: scrape activity page HTML
  try {
    const htmlHeaders = {
      ...headers,
      Accept: "text/html,application/xhtml+xml",
    };
    const pageRes = await fetch(
      `https://www.linkedin.com/in/${encodeURIComponent(vanityName)}/recent-activity/all/`,
      { headers: htmlHeaders }
    );
    if (pageRes.ok) {
      const html = await pageRes.text();
      return parsePostsFromHtml(html, limit);
    }
  } catch {
    // ignore
  }

  return [];
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function parsePostsFromFeed(
  data: any,
  limit: number
): LinkedInPost[] {
  const posts: LinkedInPost[] = [];
  const elements: any[] = data?.elements ?? data?.included ?? [];

  for (const el of elements) {
    if (posts.length >= limit) break;

    // Look for update elements with activity URNs
    const urn: string = el?.urn ?? el?.entityUrn ?? el?.["*update"] ?? "";
    if (!urn || (!urn.includes("activity:") && !urn.includes("ugcPost:")))
      continue;

    // Extract text from commentary
    const commentary: string =
      el?.commentary?.text?.text ??
      el?.updateMetadata?.shareCommentary?.text ??
      "";

    // Extract counts
    const socialDetail = el?.socialDetail ?? {};
    const reactionsCount: number =
      socialDetail?.totalSocialActivityCounts?.numLikes ??
      socialDetail?.numLikes ??
      0;
    const commentsCount: number =
      socialDetail?.totalSocialActivityCounts?.numComments ??
      socialDetail?.numComments ??
      0;
    const repostsCount: number =
      socialDetail?.totalSocialActivityCounts?.numShares ??
      socialDetail?.numShares ??
      0;

    // Activity ID for URL
    const activityMatch = urn.match(/activity:(\d+)/);
    const ugcMatch = urn.match(/ugcPost:(\d+)/);
    const activityId = activityMatch?.[1] ?? ugcMatch?.[1] ?? "";
    const postUrl = activityId
      ? `https://www.linkedin.com/feed/update/urn:li:activity:${activityId}/`
      : "";

    // Date
    const createdAt = el?.createdAt?.time ?? el?.createdAt ?? 0;
    const postedDate = createdAt
      ? new Date(createdAt).toLocaleDateString("en-US", {
          year: "numeric",
          month: "short",
          day: "numeric",
        })
      : "";

    if (commentary || activityId) {
      posts.push({
        urn,
        text: commentary,
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
/* eslint-enable @typescript-eslint/no-explicit-any */

function parsePostsFromHtml(html: string, limit: number): LinkedInPost[] {
  const posts: LinkedInPost[] = [];
  const urnMatches = html.matchAll(/urn:li:activity:(\d+)/g);
  const seen = new Set<string>();

  for (const match of urnMatches) {
    if (posts.length >= limit) break;
    const activityId = match[1];
    if (seen.has(activityId)) continue;
    seen.add(activityId);

    posts.push({
      urn: `urn:li:activity:${activityId}`,
      text: "(Post text unavailable — view on LinkedIn)",
      postedDate: "",
      reactionsCount: 0,
      commentsCount: 0,
      repostsCount: 0,
      postUrl: `https://www.linkedin.com/feed/update/urn:li:activity:${activityId}/`,
      imageUrls: [],
      videoUrl: null,
      articleUrl: null,
    });
  }

  return posts;
}
