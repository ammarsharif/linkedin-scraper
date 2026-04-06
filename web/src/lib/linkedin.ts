/**
 * LinkedIn data extraction via authenticated HTTP requests.
 *
 * LinkedIn requires the full cookie string (li_at + JSESSIONID + bcookie etc.)
 * to accept server-side requests — li_at alone always results in a 302 redirect.
 */

import type { NextRequest } from "next/server";

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

// ─── DB-aware session getter ──────────────────────────────────────────────────

/**
 * Returns the LinkedIn cookie string for use in API calls.
 * DB is the source of truth (so updating cookies in DB auto-renews all bots).
 * Falls back to the request cookie if DB has no active session.
 */
export async function getLinkedInCookies(req?: NextRequest): Promise<string | null> {
  try {
    const { getDatabase } = await import("./mongodb");
    const db = await getDatabase();
    const doc = await db.collection("cindy_config").findOne({ type: "li_session", status: "active" });
    if (doc?.rawCookies) return doc.rawCookies as string;
  } catch {
    // DB unavailable — fall through to cookie
  }
  return req?.cookies.get("li_session")?.value ?? null;
}

/**
 * Returns the LinkedIn cookie string without a request context (for cron jobs).
 * Always reads from DB so that updating cookies in the DB takes effect immediately.
 */
export async function getLinkedInCookiesForCron(fallback?: string | null): Promise<string | null> {
  try {
    const { getDatabase } = await import("./mongodb");
    const db = await getDatabase();
    const doc = await db.collection("cindy_config").findOne({ type: "li_session", status: "active" });
    if (doc?.rawCookies) return doc.rawCookies as string;
  } catch {
    // DB unavailable — use fallback
  }
  return fallback ?? null;
}

// ─── cookie helpers ────────────────────────────────────────────────────────────

export function parseCookieString(raw: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const part of raw.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) map[key] = val;
  }
  return map;
}

export function extractJsessionId(cookieString: string): string | null {
  const cookies = parseCookieString(cookieString);
  const raw = cookies["JSESSIONID"];
  if (!raw) return null;
  return raw.replace(/^"(.*)"$/, "$1");
}

export function extractLiAt(cookieString: string): string | null {
  const cookies = parseCookieString(cookieString);
  return cookies["li_at"] ?? null;
}

export function extractVanityName(url: string): string {
  const match = url.match(/linkedin\.com\/in\/([^/?#]+)/i);
  if (!match) throw new Error(`Invalid LinkedIn profile URL: ${url}`);
  return match[1].replace(/\/$/, "");
}

// ─── header builders ───────────────────────────────────────────────────────────

function buildHeaders(
  cookieString: string,
  accept = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
): Record<string, string> {
  const jsessionId = extractJsessionId(cookieString);
  const cookieMap = parseCookieString(cookieString);
  const cookieParts: string[] = [];

  if (cookieMap["li_at"]) cookieParts.push(`li_at=${cookieMap["li_at"]}`);
  if (jsessionId) cookieParts.push(`JSESSIONID="${jsessionId}"`);

  for (const [k, v] of Object.entries(cookieMap)) {
    if (k === "li_at" || k === "JSESSIONID") continue;
    cookieParts.push(`${k}=${v}`);
  }

  const headers: Record<string, string> = {
    Cookie: cookieParts.join("; "),
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: accept,
    "Accept-Language": "en-US,en;q=0.9",
    Referer: "https://www.linkedin.com/feed/",
    Origin: "https://www.linkedin.com",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-User": "?1",
    "Sec-Fetch-Dest": "document",
    "Upgrade-Insecure-Requests": "1",
  };

  if (jsessionId) {
    headers["csrf-token"] = jsessionId;
    headers["x-li-lang"] = "en_US";
    headers["x-restli-protocol-version"] = "2.0.0";
  }

  return headers;
}

async function safeFetch(
  url: string,
  headers: Record<string, string>,
  followRedirects = false
): Promise<Response | null> {
  try {
    const res = await fetch(url, {
      headers,
      redirect: followRedirects ? "follow" : "manual",
    });
    if (!followRedirects && res.status >= 300 && res.status < 400) {
      console.log(`[safeFetch] Got ${res.status} for ${url}, retrying with follow...`);
      const retryRes = await fetch(url, { headers, redirect: "follow" });
      if (retryRes.status === 401 || retryRes.status === 403) return null;
      return retryRes;
    }
    if (res.status === 401 || res.status === 403) return null;
    return res;
  } catch (err) {
    console.error("safeFetch error:", url, err);
    return null;
  }
}

/**
 * Decode HTML entities: &amp; &lt; &gt; &quot; &#39; &#x27; etc.
 */
function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

// ─── validate ─────────────────────────────────────────────────────────────────

export async function validateCookie(
  cookieString: string
): Promise<{ valid: boolean; name?: string }> {
  const liAt = extractLiAt(cookieString);
  if (!liAt) return { valid: false };

  const res = await safeFetch(
    "https://www.linkedin.com/feed/",
    buildHeaders(cookieString),
    true
  );

  if (!res) return { valid: false };

  const html = await res.text();

  if (
    html.includes("login-form") ||
    html.includes("join-form") ||
    html.includes("authwall") ||
    html.includes('"isAnonymous":true')
  ) {
    return { valid: false };
  }

  const name = extractNameFromHtml(html) ?? "LinkedIn User";
  return { valid: true, name };
}

// ─── profile ──────────────────────────────────────────────────────────────────

export async function fetchProfile(
  cookieString: string,
  vanityName: string
): Promise<LinkedInProfile> {
  const profileUrl = `https://www.linkedin.com/in/${encodeURIComponent(vanityName)}/`;

  // Try HTML page first
  const res = await safeFetch(profileUrl, buildHeaders(cookieString), true);

  if (!res?.ok) {
    console.log(`[fetchProfile] HTML fetch failed for ${vanityName}, status: ${res?.status}`);
    return await fetchProfileFromApi(cookieString, vanityName, profileUrl);
  }

  const html = await res.text();

  if (html.includes("authwall") || html.includes("login-form") || html.includes('"isAnonymous":true')) {
    console.log(`[fetchProfile] Got auth wall for ${vanityName}`);
    return await fetchProfileFromApi(cookieString, vanityName, profileUrl);
  }

  const profile = parseProfileFromHtml(html, vanityName, profileUrl);
  console.log(`[fetchProfile] HTML-parsed name: "${profile.name}"`);

  // If HTML parsing didn't get the real name, try embedded JSON data
  if (profile.name === vanityName || profile.name === "LinkedIn" || !profile.name) {
    console.log(`[fetchProfile] Trying embedded JSON for name...`);
    const jsonProfile = extractProfileFromEmbeddedJson(html, vanityName, profileUrl);
    if (jsonProfile && jsonProfile.name !== vanityName && jsonProfile.name !== "LinkedIn") {
      console.log(`[fetchProfile] Got name from embedded JSON: "${jsonProfile.name}"`);
      return jsonProfile;
    }

    console.log(`[fetchProfile] Trying Voyager API for name...`);
    const apiProfile = await fetchProfileFromApi(cookieString, vanityName, profileUrl);
    if (apiProfile.name !== vanityName && apiProfile.name !== "LinkedIn") {
      return apiProfile;
    }
  }

  return profile;
}

/**
 * Extract profile info from embedded JSON/code blocks in the HTML.
 * LinkedIn SSR pages embed Voyager data in <code> tags.
 */
function extractProfileFromEmbeddedJson(
  html: string,
  vanityName: string,
  profileUrl: string
): LinkedInProfile | null {
  const codeBlocks = extractJsonFromCodeBlocks(html);

  for (const jsonStr of codeBlocks) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data: any = JSON.parse(jsonStr);
      const included = Array.isArray(data?.included) ? data.included : [];

      for (const item of included) {
        // Look for profile entity
        const entityUrn: string = item?.entityUrn ?? item?.urn ?? "";
        if (!entityUrn.includes("miniProfile:") && !entityUrn.includes("fs_profile:")) continue;

        // Check if this is the right profile by matching publicIdentifier
        if (item?.publicIdentifier && item.publicIdentifier !== vanityName) continue;

        const firstName = item?.firstName ?? "";
        const lastName = item?.lastName ?? "";
        const name = `${firstName} ${lastName}`.trim();
        if (!name) continue;

        const headline = item?.occupation ?? item?.headline ?? "";
        const location = item?.locationName ?? item?.geoLocationName ?? "";

        console.log(`[extractProfileFromEmbeddedJson] Found: name="${name}", headline="${headline}"`);
        return { name, headline, location, profileUrl, vanityName };
      }
    } catch { /* not valid JSON */ }
  }

  return null;
}

async function fetchProfileFromApi(
  cookieString: string,
  vanityName: string,
  profileUrl: string
): Promise<LinkedInProfile> {
  const jsessionId = extractJsessionId(cookieString);
  if (!jsessionId) {
    return { name: vanityName, headline: "", location: "", profileUrl, vanityName };
  }

  const apiHeaders = buildHeaders(cookieString, "application/vnd.linkedin.normalized+json+2.1");

  const apiUrl = `https://www.linkedin.com/voyager/api/identity/profiles/${encodeURIComponent(vanityName)}`;
  try {
    const res = await safeFetch(apiUrl, apiHeaders, true);
    if (res?.ok) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data: any = await res.json();
      const firstName = data?.firstName ?? data?.miniProfile?.firstName ?? "";
      const lastName = data?.lastName ?? data?.miniProfile?.lastName ?? "";
      const name = `${firstName} ${lastName}`.trim() || vanityName;
      const headline = data?.headline ?? data?.miniProfile?.occupation ?? "";
      const location = data?.locationName ?? data?.geoLocationName ?? "";
      console.log(`[fetchProfileFromApi] Got name: "${name}"`);
      return { name, headline, location, profileUrl, vanityName };
    }
  } catch (err) {
    console.log(`[fetchProfileFromApi] Error:`, err);
  }

  return { name: vanityName, headline: "", location: "", profileUrl, vanityName };
}

// ─── posts ────────────────────────────────────────────────────────────────────

export async function fetchPosts(
  cookieString: string,
  vanityName: string,
  limit: number = 10
): Promise<LinkedInPost[]> {
  const apiAccept = "application/vnd.linkedin.normalized+json+2.1";
  const apiHeaders = buildHeaders(cookieString, apiAccept);
  const jsessionId = extractJsessionId(cookieString);

  console.log(`[fetchPosts] Starting posts fetch for ${vanityName}, limit=${limit}, hasJsessionId=${!!jsessionId}`);

  // Try Voyager API first
  if (jsessionId) {
    const endpoints = [
      `https://www.linkedin.com/voyager/api/feed/dash/feedUpdates` +
        `?q=profileUpdatesByMemberShareFeed&memberIdentity=${encodeURIComponent(vanityName)}` +
        `&count=${Math.min(limit, 50)}&start=0`,
      `https://www.linkedin.com/voyager/api/identity/profileUpdatesV2` +
        `?publicIdentifier=${encodeURIComponent(vanityName)}&q=memberShareFeed` +
        `&count=${Math.min(limit, 50)}&start=0`,
    ];

    for (const url of endpoints) {
      console.log(`[fetchPosts] Trying endpoint: ${url.split("?")[0]}...`);
      const res = await safeFetch(url, apiHeaders, true);
      if (!res) { console.log(`[fetchPosts] Endpoint returned null`); continue; }
      if (!res.ok) { console.log(`[fetchPosts] Endpoint returned status ${res.status}`); continue; }
      try {
        const text = await res.text();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data: any = JSON.parse(text);
        const posts = parsePostsFromApiData(data, limit);
        console.log(`[fetchPosts] Parsed ${posts.length} posts from API`);
        if (posts.length > 0) return posts;
      } catch (err) {
        console.log(`[fetchPosts] Parse error:`, err);
      }
    }
  }

  // Fallback: parse activity page HTML
  console.log(`[fetchPosts] API endpoints failed, falling back to HTML parsing...`);
  const htmlPosts = await fetchPostsFromHtml(cookieString, vanityName, limit);
  console.log(`[fetchPosts] HTML fallback returned ${htmlPosts.length} posts`);
  return htmlPosts;
}

// ─── HTML parsers ─────────────────────────────────────────────────────────────

function extractNameFromHtml(html: string): string | null {
  // Try og:title (attribute order may vary)
  const ogTitle =
    html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i)?.[1];
  if (ogTitle) {
    const name = ogTitle.replace(/\s*\|\s*LinkedIn\s*$/i, "").trim();
    if (name && name !== "LinkedIn") return name;
  }

  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  if (titleMatch?.[1]) {
    const name = titleMatch[1].replace(/\s*\|\s*LinkedIn\s*$/i, "").trim();
    if (name && name !== "LinkedIn") return name;
  }

  return null;
}

function parseProfileFromHtml(
  html: string,
  vanityName: string,
  profileUrl: string
): LinkedInProfile {
  let name = vanityName;
  let headline = "";
  let location = "";

  // og:title → "First Last - Title at Company | LinkedIn"
  const ogTitleStr =
    html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i)?.[1];

  if (ogTitleStr) {
    const raw = ogTitleStr.replace(/\s*\|\s*LinkedIn\s*$/i, "").trim();
    if (raw && raw !== "LinkedIn") {
      if (raw.includes(" - ")) {
        const [n, ...rest] = raw.split(" - ");
        name = n.trim();
        headline = rest.join(" - ").trim();
      } else {
        name = raw;
      }
    }
  }

  if (name === vanityName || name === "LinkedIn") {
    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    if (titleMatch?.[1]) {
      const raw = titleMatch[1].replace(/\s*\|\s*LinkedIn\s*$/i, "").trim();
      if (raw && raw !== "LinkedIn") {
        if (raw.includes(" - ")) {
          const [n, ...rest] = raw.split(" - ");
          name = n.trim();
          headline = rest.join(" - ").trim();
        } else {
          name = raw;
        }
      }
    }
  }

  // JSON-LD
  const jsonLdBlocks =
    html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) ?? [];
  for (const block of jsonLdBlocks) {
    try {
      const jsonStr = block.replace(/<\/?script[^>]*>/gi, "");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parsed: any = JSON.parse(jsonStr);
      if (parsed?.name && (name === vanityName || name === "LinkedIn")) name = parsed.name;
      if (parsed?.jobTitle && !headline) headline = parsed.jobTitle;
      if (parsed?.address?.addressLocality && !location)
        location = parsed.address.addressLocality;
    } catch { /* skip */ }
  }

  name = name.replace(/\s*\|\s*LinkedIn\s*$/i, "").trim() || vanityName;
  return { name, headline, location, profileUrl, vanityName };
}

/**
 * Extract JSON strings from <code> blocks in LinkedIn SSR HTML.
 * LinkedIn wraps JSON in code blocks, sometimes inside HTML comments: <!--{...}-->
 * and sometimes HTML-encodes the content.
 */
function extractJsonFromCodeBlocks(html: string): string[] {
  const results: string[] = [];
  const codeBlocks = html.match(/<code[^>]*>([\s\S]*?)<\/code>/gi) ?? [];

  for (const block of codeBlocks) {
    let inner = block.replace(/<code[^>]*>/i, "").replace(/<\/code>/i, "").trim();

    // Strip HTML comment wrappers: <!--{...}--> → {...}
    if (inner.startsWith("<!--")) {
      inner = inner.replace(/^<!--\s*/, "").replace(/\s*-->$/, "").trim();
    }

    // HTML-decode the content
    inner = decodeHtmlEntities(inner);

    if (!inner.startsWith("{") && !inner.startsWith("[")) continue;

    results.push(inner);
  }

  return results;
}

async function fetchPostsFromHtml(
  cookieString: string,
  vanityName: string,
  limit: number
): Promise<LinkedInPost[]> {
  const url = `https://www.linkedin.com/in/${encodeURIComponent(vanityName)}/recent-activity/all/`;
  console.log(`[fetchPostsFromHtml] Fetching activity page: ${url}`);
  const res = await safeFetch(url, buildHeaders(cookieString), true);
  if (!res) { console.log(`[fetchPostsFromHtml] safeFetch returned null`); return []; }
  if (!res.ok) { console.log(`[fetchPostsFromHtml] Response status: ${res.status}`); return []; }

  const html = await res.text();
  console.log(`[fetchPostsFromHtml] Got HTML, length=${html.length}`);
  console.log(`[fetchPostsFromHtml] Has authwall: ${html.includes("authwall")}`);
  console.log(`[fetchPostsFromHtml] Has login-form: ${html.includes("login-form")}`);

  // Check for auth wall
  if (html.includes("authwall") || html.includes("login-form") || html.includes('"isAnonymous":true')) {
    console.log(`[fetchPostsFromHtml] Auth wall detected`);
    return [];
  }

  // Count URNs (including HTML-encoded ones)
  const decodedHtml = decodeHtmlEntities(html);
  const urnCount = (decodedHtml.match(/urn:li:activity:\d+/g) ?? []).length;
  console.log(`[fetchPostsFromHtml] URN count (decoded): ${urnCount}`);

  // Also check raw HTML for URNs
  const rawUrnCount = (html.match(/urn:li:activity:/g) ?? []).length;
  console.log(`[fetchPostsFromHtml] URN count (raw): ${rawUrnCount}`);

  // Show a sample of what surrounds the first URN match in raw HTML
  const firstUrnIdx = html.indexOf("urn:li:activity:");
  if (firstUrnIdx >= 0) {
    const sample = html.substring(firstUrnIdx, firstUrnIdx + 80);
    console.log(`[fetchPostsFromHtml] First URN context: "${sample}"`);
  }

  return parsePostsFromHtml(html, limit);
}

function parsePostsFromHtml(html: string, limit: number): LinkedInPost[] {
  const posts: LinkedInPost[] = [];
  const seen = new Set<string>();

  // STEP 1: Extract JSON from <code> blocks (LinkedIn embeds Voyager data here)
  const jsonStrings = extractJsonFromCodeBlocks(html);
  console.log(`[parsePostsFromHtml] Found ${jsonStrings.length} JSON blocks from code tags`);

  for (const jsonStr of jsonStrings) {
    if (posts.length >= limit) break;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parsed: any = JSON.parse(jsonStr);

      // Log structure of first few JSON blocks that have useful-looking keys
      const keys = Object.keys(parsed || {});
      const hasUsefulData = keys.some(k => ["included", "elements", "data"].includes(k));
      if (hasUsefulData) {
        console.log(`[parsePostsFromHtml] JSON block keys: ${keys.join(", ")}`);
        if (parsed.included) console.log(`[parsePostsFromHtml]   included: ${parsed.included.length} items`);
        if (parsed.elements) console.log(`[parsePostsFromHtml]   elements: ${parsed.elements.length} items`);
      }

      const codePosts = parsePostsFromApiData(parsed, limit - posts.length);
      for (const p of codePosts) {
        if (!seen.has(p.urn)) { seen.add(p.urn); posts.push(p); }
      }
    } catch { /* not valid JSON */ }
  }
  console.log(`[parsePostsFromHtml] After JSON parsing: ${posts.length} posts`);

  // STEP 2: If JSON parsing failed, try regex on decoded HTML
  if (posts.length === 0) {
    console.log(`[parsePostsFromHtml] Trying regex URN extraction on decoded HTML...`);
    const decodedHtml = decodeHtmlEntities(html);

    // Match URN patterns with digits
    for (const m of decodedHtml.matchAll(/urn:li:activity:(\d+)/g)) {
      if (posts.length >= limit) break;
      const urn = `urn:li:activity:${m[1]}`;
      if (seen.has(urn)) continue;
      seen.add(urn);
      posts.push({
        urn, text: "", postedDate: "",
        reactionsCount: 0, commentsCount: 0, repostsCount: 0,
        postUrl: `https://www.linkedin.com/feed/update/${urn}/`,
        imageUrls: [], videoUrl: null, articleUrl: null,
      });
    }
    console.log(`[parsePostsFromHtml] After decoded regex: ${posts.length} posts`);
  }

  // STEP 3: Last resort — scan raw HTML for any URN-like pattern
  if (posts.length === 0) {
    console.log(`[parsePostsFromHtml] Trying raw HTML regex...`);
    // Handle cases where digits might be separated or encoded
    for (const m of html.matchAll(/urn:li:activity:(\d+)/g)) {
      if (posts.length >= limit) break;
      const urn = `urn:li:activity:${m[1]}`;
      if (seen.has(urn)) continue;
      seen.add(urn);
      posts.push({
        urn, text: "", postedDate: "",
        reactionsCount: 0, commentsCount: 0, repostsCount: 0,
        postUrl: `https://www.linkedin.com/feed/update/${urn}/`,
        imageUrls: [], videoUrl: null, articleUrl: null,
      });
    }

    // Also try URL-encoded URNs
    if (posts.length === 0) {
      for (const m of html.matchAll(/urn%3Ali%3Aactivity%3A(\d+)/gi)) {
        if (posts.length >= limit) break;
        const urn = `urn:li:activity:${m[1]}`;
        if (seen.has(urn)) continue;
        seen.add(urn);
        posts.push({
          urn, text: "", postedDate: "",
          reactionsCount: 0, commentsCount: 0, repostsCount: 0,
          postUrl: `https://www.linkedin.com/feed/update/${urn}/`,
          imageUrls: [], videoUrl: null, articleUrl: null,
        });
      }
    }

    // Also try the pattern with ugcPost or share
    if (posts.length === 0) {
      for (const m of html.matchAll(/urn:li:(?:ugcPost|share):(\d+)/g)) {
        if (posts.length >= limit) break;
        const urn = `urn:li:activity:${m[1]}`;
        if (seen.has(urn)) continue;
        seen.add(urn);
        posts.push({
          urn, text: "", postedDate: "",
          reactionsCount: 0, commentsCount: 0, repostsCount: 0,
          postUrl: `https://www.linkedin.com/feed/update/${urn}/`,
          imageUrls: [], videoUrl: null, articleUrl: null,
        });
      }
    }

    console.log(`[parsePostsFromHtml] After all regex attempts: ${posts.length} posts`);
  }

  // STEP 4: Try to enrich bare-URN posts with text from nearby JSON
  if (posts.length > 0 && posts.every(p => !p.text)) {
    console.log(`[parsePostsFromHtml] Attempting post enrichment from embedded JSON...`);
    enrichPostsFromJson(posts, jsonStrings);
  }

  return posts;
}

/**
 * Try to find text, reactions, etc. for posts from the embedded JSON data.
 */
function enrichPostsFromJson(posts: LinkedInPost[], jsonStrings: string[]): void {
  // Build a lookup of all text content keyed by activity ID
  const textMap = new Map<string, { text: string; reactions: number; comments: number; reposts: number; date: string }>();

  for (const jsonStr of jsonStrings) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data: any = JSON.parse(jsonStr);
      const included = Array.isArray(data?.included) ? data.included : [];

      for (const item of included) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const el = item as any;
        const entityUrn: string = el?.entityUrn ?? el?.urn ?? "";

        // Look for text in various entity types
        const text: string =
          el?.commentary?.text?.text ?? el?.commentary?.text ??
          el?.shareCommentary?.text?.text ?? el?.shareCommentary?.text ??
          el?.text?.text ?? "";

        if (!text) continue;

        // Extract activity/share/ugcPost ID
        const idMatch = entityUrn.match(/(?:activity|share|ugcPost):(\d+)/);
        if (idMatch) {
          const social = el?.socialDetail ?? el?.socialSummary ?? {};
          textMap.set(idMatch[1], {
            text,
            reactions: social?.totalSocialActivityCounts?.numLikes ?? social?.numLikes ?? 0,
            comments: social?.totalSocialActivityCounts?.numComments ?? social?.numComments ?? 0,
            reposts: social?.totalSocialActivityCounts?.numShares ?? social?.numShares ?? 0,
            date: el?.createdAt ? new Date(el.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "",
          });
        }
      }
    } catch { /* skip */ }
  }

  console.log(`[enrichPostsFromJson] Found ${textMap.size} text entries`);

  // Enrich posts
  for (const post of posts) {
    const actId = post.urn.match(/activity:(\d+)/)?.[1];
    if (!actId) continue;
    const info = textMap.get(actId);
    if (info) {
      post.text = info.text;
      post.reactionsCount = info.reactions;
      post.commentsCount = info.comments;
      post.repostsCount = info.reposts;
      post.postedDate = info.date;
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parsePostsFromApiData(data: any, limit: number): LinkedInPost[] {
  const posts: LinkedInPost[] = [];
  const seen = new Set<string>();

  const elements: unknown[] = [
    ...(Array.isArray(data?.elements) ? data.elements : []),
    ...(Array.isArray(data?.included) ? data.included : []),
    ...(Array.isArray(data?.data?.elements) ? data.data.elements : []),
  ];

  for (const raw of elements) {
    if (posts.length >= limit) break;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const el = raw as any;

    const urn: string = el?.urn ?? el?.entityUrn ?? el?.["*update"] ?? el?.updateUrn ?? "";
    if (!urn) continue;
    if (!urn.includes("activity:") && !urn.includes("ugcPost:") && !urn.includes("share:")) continue;

    if (seen.has(urn)) continue;
    seen.add(urn);

    // Text from multiple possible paths
    const text: string =
      el?.commentary?.text?.text ?? el?.commentary?.text ??
      el?.shareCommentary?.text?.text ?? el?.shareCommentary?.text ??
      el?.updateMetadata?.shareCommentary?.text ??
      el?.value?.["com.linkedin.voyager.feed.render.UpdateV2"]?.commentary?.text?.text ??
      el?.text?.text ?? "";

    const social = el?.socialDetail ?? el?.socialSummary ??
                   el?.value?.["com.linkedin.voyager.feed.render.UpdateV2"]?.socialDetail ?? {};
    const reactionsCount: number = social?.totalSocialActivityCounts?.numLikes ?? social?.numLikes ?? 0;
    const commentsCount: number = social?.totalSocialActivityCounts?.numComments ?? social?.numComments ?? 0;
    const repostsCount: number = social?.totalSocialActivityCounts?.numShares ?? social?.numShares ?? 0;

    const activityId = urn.match(/(?:activity|ugcPost|share):(\d+)/)?.[1] ?? "";
    const postUrl = activityId ? `https://www.linkedin.com/feed/update/urn:li:activity:${activityId}/` : "";
    const rawTs: number = el?.createdAt?.time ?? el?.created?.time ?? el?.createdAt ?? el?.firstPublishedAt ?? 0;
    const postedDate = rawTs ? new Date(rawTs).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "";

    if (text || activityId) {
      posts.push({ urn, text, postedDate, reactionsCount, commentsCount, repostsCount, postUrl, imageUrls: [], videoUrl: null, articleUrl: null });
    }
  }

  return posts.slice(0, limit);
}
