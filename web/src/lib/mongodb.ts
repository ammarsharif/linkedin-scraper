import { MongoClient, Db } from "mongodb";

// Note: Removed the manual dns.setServers call as it can cause ECONNREFUSED 
// on serverless platforms like Vercel which manage their own networking.
// If you encounter local DNS issues, please set your computer's DNS manually.

const MONGODB_URI = process.env.MONGODB_URI as string;
const DB_NAME = "linkedin-scraper";

if (!MONGODB_URI) {
  throw new Error("MONGODB_URI is not defined in environment variables.");
}

/** 
 * Keep a global reference to the MongoDB client and database
 * to prevent multiple connections in serverless environments 
 * and during hot-reloads in development.
 */
let cachedClient: MongoClient | null = (global as any).mongoClient || null;
let cachedDb: Db | null = (global as any).mongoDb || null;

export async function getDatabase(): Promise<Db> {
  if (cachedDb) return cachedDb;

  try {
    const client = new MongoClient(MONGODB_URI, {
      connectTimeoutMS: 10000,
      serverSelectionTimeoutMS: 10000,
      maxPoolSize: 10, // Optimize for serverless functions
    });

    await client.connect();
    const db = client.db(DB_NAME);

    // Store in cache for this instance
    cachedClient = client;
    cachedDb = db;

    // Store in global for Next.js hot-reloading (development)
    (global as any).mongoClient = client;
    (global as any).mongoDb = db;

    return db;
  } catch (err: any) {
    if (err.message?.includes("ECONNREFUSED") || err.code === "ECONNREFUSED") {
      console.error("MongoDB Connection Refused. Check if your connection string is correct and Atlas allows your current IP (or 0.0.0.0 for Vercel).");
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
