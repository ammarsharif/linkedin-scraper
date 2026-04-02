import { getDatabase } from "./mongodb";

export async function createSessionAlert(botId: string, platform: string) {
  try {
    const db = await getDatabase();
    // Upsert — only one pending alert per bot at a time
    await db.collection("session_alerts").updateOne(
      { botId, status: "pending" },
      {
        $setOnInsert: {
          botId,
          platform,
          status: "pending",
          createdAt: new Date().toISOString(),
        },
      },
      { upsert: true }
    );
  } catch (err) {
    console.error(`[sessionAlert] Failed to create alert for ${botId}:`, err);
  }
}

export async function resolveSessionAlert(botId: string) {
  try {
    const db = await getDatabase();
    await db.collection("session_alerts").updateMany(
      { botId, status: "pending" },
      { $set: { status: "resolved", resolvedAt: new Date().toISOString() } }
    );
  } catch (err) {
    console.error(`[sessionAlert] Failed to resolve alert for ${botId}:`, err);
  }
}
