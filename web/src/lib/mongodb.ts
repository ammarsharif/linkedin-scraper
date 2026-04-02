import { MongoClient, Db } from "mongodb";
import dns from "dns";

dns.setServers(["8.8.8.8", "8.8.4.4"]);

const MONGODB_URI = process.env.MONGODB_URI as string;

if (!MONGODB_URI) {
  throw new Error("MONGODB_URI is not defined in environment variables. Connection skipped.");
}

const DB_NAME = "linkedin-scraper";

let cachedClient: MongoClient | null = null;
let cachedDb: Db | null = null;

export async function getDatabase(): Promise<Db> {
  if (cachedDb) return cachedDb;

  try {
    const client = new MongoClient(MONGODB_URI as string, {
      connectTimeoutMS: 10000, // 10s connection timeout
    });
    await client.connect();
    const db = client.db(DB_NAME);

    cachedClient = client;
    cachedDb = db;

    return db;
  } catch (err: any) {
    if (err.message?.includes("ECONNREFUSED") || err.code === "ECONNREFUSED") {
      throw new Error(
        "MongoDB Connection Refused. This is usually a DNS issue. Try changing your computer's DNS to: Primary: 8.8.8.8 (Google), Secondary: 1.1.1.1 (Cloudflare)."
      );
    }
    throw err;
  }
}

// ── Instar (Instagram) Interfaces ─────────────────────────────────────────

export interface InstarConfig {
  _id?: string;
  type: "ig_session";
  sessionid: string;
  ds_user_id: string;
  csrftoken: string;
  mid?: string;
  username?: string;
  rawCookies?: string;
  savedAt: string;
  status: "active" | "expired";
}

export interface InstarChatMessage {
  role: "prospect" | "instar" | "human_rep";
  text: string;
  timestamp: string;
  source: "ig_inbox" | "instar_auto" | "instar_cron" | "manual";
}

export interface InstarConversationLog {
  _id?: string;
  threadId: string;
  senderUsername: string;
  senderId?: string;
  lastActivity: string;
  createdAt: string;
  messages: InstarChatMessage[];
}

export interface InstarGrowthLog {
  _id?: string;
  action: "follow" | "like" | "comment" | "story_view" | "dm" | "post";
  targetUsername?: string;
  targetPostUrl?: string;
  hashtag?: string;
  content?: string;
  timestamp: string;
  status: "success" | "failed" | "skipped";
  error?: string;
}

export interface InstarSettings {
  _id?: string;
  type: "growth_settings";
  targetHashtags: string[];
  dailyFollowLimit: number;
  dailyLikeLimit: number;
  dailyCommentLimit: number;
  autoReplyEnabled: boolean;
  systemPrompt: string;
  dmSystemPrompt: string;
  commentPrompt: string;
  lastUpdated: string;
}

// ── Xavier (Twitter/X) Interfaces ────────────────────────────────────────

export interface XavierConfig {
  _id?: string;
  type: "tw_session";
  auth_token: string;
  ct0: string;
  twid?: string;
  username?: string;
  rawCookies?: string;
  savedAt: string;
  status: "active" | "expired";
}

export interface XavierChatMessage {
  role: "prospect" | "xavier" | "human_rep";
  text: string;
  timestamp: string;
  source: "tw_inbox" | "xavier_auto" | "xavier_cron" | "manual";
}

export interface XavierConversationLog {
  _id?: string;
  conversationId: string;
  senderUsername: string;
  senderId?: string;
  lastActivity: string;
  createdAt: string;
  messages: XavierChatMessage[];
}

export interface XavierGrowthLog {
  _id?: string;
  action: "follow" | "like" | "retweet" | "reply" | "dm" | "unfollow";
  targetUsername?: string;
  targetTweetUrl?: string;
  sourceType?: "hashtag" | "keyword" | "profile";
  sourceValue?: string;
  content?: string;
  timestamp: string;
  status: "success" | "failed" | "skipped";
  error?: string;
  note?: string;
}

export interface XavierSettings {
  _id?: string;
  type: "growth_settings";
  targetKeywords: string[];
  targetHashtags: string[];
  targetProfiles: string[];
  dailyFollowLimit: number;
  dailyLikeLimit: number;
  dailyRetweetLimit: number;
  dailyReplyLimit: number;
  dailyDmLimit: number;
  replyPrompt: string;
  dmSystemPrompt: string;
  enableLike: boolean;
  enableFollow: boolean;
  enableRetweet: boolean;
  enableReply: boolean;
  lastUpdated: string;
}

export interface XavierTweetRead {
  _id?: string;
  tweetId: string;
  username: string;
  displayName: string;
  text: string;
  tweetUrl: string;
  likes: number;
  retweets: number;
  replies: number;
  timestamp: string;
  scrapedAt: string;
  sourceQuery?: string;
}

// ── Collection Interfaces ─────────────────────────────────────────────────

export interface StoredProfile {
  _id?: string;
  profileUrl: string;
  vanityName: string;
  name: string;
  headline: string;
  location: string;
  // Ceevee report data
  executiveSummary?: string;
  roleLevel?: string;
  industryFocus?: string[];
  areasOfExpertise?: string[];
  currentFocus?: string;
  communicationStyle?: string;
  values?: string[];
  challengesMentioned?: string[];
  achievementsMentioned?: string[];
  // Email tracking
  emailAddress?: string;
  emailsSent: EmailRecord[];
  draftSubject?: string;
  draftBody?: string;
  // Timestamps
  scrapedAt: string;
  lastUpdated: string;
}

export interface EmailRecord {
  id: string;
  to: string;
  subject: string;
  body: string;
  sentAt: string;
  status: "sent" | "failed";
  errorMessage?: string;
}

// ── Knowledge Base ────────────────────────────────────────────────────────

export interface KnowledgeBaseEntry {
  _id?: string;
  botId: "all" | "cindy" | "felix" | "xavier" | "instar";
  type: "policy" | "faq" | "terms" | "guideline" | "instruction";
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

// ── Escalation System ─────────────────────────────────────────────────────

export interface EscalationRecord {
  _id?: string;
  botId: "cindy" | "felix" | "xavier" | "instar";
  platform: string;
  conversationId: string;
  senderName: string;
  senderUsername?: string;
  lastMessage: string;
  reason: string;
  status: "pending" | "resolved" | "reminded";
  createdAt: string;
  resolvedAt?: string;
  reminderSentAt?: string;
}

// ── Follow-Up Tracking System ────────────────────────────────────────────

export type FollowUpBotName = "cindy" | "instar" | "felix" | "zapier";

/** One "expecting reply" thread being tracked */
export interface FollowUpRecord {
  _id?: string;
  botName: FollowUpBotName;
  userId: string;         // platform-specific conversation/user id
  userName: string;
  contactInfo?: string;   // e.g. email, phone, username
  originalMessageId: string;
  originalMessageText: string;
  originalMessageSentAt: string;  // ISO
  replyReceived: boolean;
  replyReceivedAt?: string;       // ISO
  followUpsSent: number;          // 0–5
  lastFollowupSentAt?: string;    // ISO
  nextFollowupScheduledAt: string; // ISO — when to fire next
  status: "active" | "paused" | "stopped" | "completed" | "replied";
  manuallyStoppedAt?: string;     // ISO
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

/** Per-bot, per-step follow-up message template */
export interface FollowUpTemplate {
  _id?: string;
  botName: FollowUpBotName;
  followUpNumber: 1 | 2 | 3 | 4 | 5;
  messageText: string;   // supports {{user_name}}, {{original_message}}, {{days_waiting}}
  updatedAt: string;
}

/** Keyword/phrase rule that triggers follow-up tracking on a sent message */
export interface FollowUpRule {
  _id?: string;
  botName: FollowUpBotName;
  type: "keyword" | "phrase";
  value: string;
  enabled: boolean;
  createdAt: string;
}

// ── Conversation Logs (Cindy ↔ Cara integration) ─────────────────────────

export interface ChatMessage {
  role: "prospect" | "cindy" | "human_rep";
  text: string;
  timestamp: string;
  source: "linkedin_inbox" | "cindy_auto" | "cindy_cron" | "manual";
}

export interface ConversationLog {
  _id?: string;
  conversationUrn: string;
  senderUrn: string;
  senderName: string;
  profileId?: string;
  messages: ChatMessage[];
  lastActivity: string;
  createdAt: string;
}
