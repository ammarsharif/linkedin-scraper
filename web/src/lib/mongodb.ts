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
