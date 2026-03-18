import { NextRequest, NextResponse } from "next/server";
import { getDatabase } from "@/lib/mongodb";

export const maxDuration = 30;

export async function GET(req: NextRequest) {
  try {
    const cookieString = req.cookies.get("li_session")?.value;
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
        "analysis.personalityProfile.tone": 1,
        "analysis.personalityProfile.motivations": 1,
        "analysis.communicationStyle.linguisticPatterns": 1,
        "analysis.communicationStyle.shorthand": 1,
        "analysis.professionalInsights.currentRole": 1,
        "analysis.professionalInsights.challenges": 1,
        "analysis.buyerProfile.buyerType": 1,
        "analysis.salesApproach.keyMessages": 1,
        "analysis.executiveSummary": 1,
      })
      .toArray();

    return NextResponse.json({ success: true, personas });
  } catch (err) {
    console.error("[cora/personas] GET error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
