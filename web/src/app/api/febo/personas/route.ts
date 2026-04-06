import { NextRequest, NextResponse } from "next/server";
import { getDatabase } from "@/lib/mongodb";
import { getLinkedInCookies } from "@/lib/linkedin";

export const maxDuration = 30;

export async function GET(req: NextRequest) {
  try {
    const cookieString = await getLinkedInCookies(req);
    if (!cookieString) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    const db = await getDatabase();
    const personas = await db
      .collection("cara_personas")
      .find({})
      .sort({ lastUpdated: -1 })
      .project({
        _id: 1,
        name: 1,
        headline: 1,
        location: 1,
        postsAnalyzed: 1,
        lastUpdated: 1,
        "analysis.executiveSummary": 1,
        "analysis.personalityProfile.tone": 1,
        "analysis.personalityProfile.motivations": 1,
        "analysis.personalityProfile.values": 1,
        "analysis.communicationStyle.linguisticPatterns": 1,
        "analysis.communicationStyle.shorthand": 1,
        "analysis.professionalInsights.currentRole": 1,
        "analysis.professionalInsights.challenges": 1,
        "analysis.buyerProfile.buyerType": 1,
        "analysis.buyerProfile.likelyObjections": 1,
        "analysis.buyerProfile.buyingTriggers": 1,
        "analysis.salesApproach.keyMessages": 1,
        "analysis.salesApproach.openingAngles": 1,
        "analysis.salesApproach.doThis": 1,
        "analysis.salesApproach.avoidThis": 1,
      })
      .toArray();

    return NextResponse.json({ success: true, personas });
  } catch (err) {
    console.error("[febo/personas] GET error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
