import { NextRequest, NextResponse } from "next/server";
import { getDatabase } from "@/lib/mongodb";
import { getLinkedInCookies } from "@/lib/linkedin";

export const maxDuration = 60;

// GET: List all saved personas
export async function GET(req: NextRequest) {
  try {
    const cookieString = await getLinkedInCookies(req);
    if (!cookieString) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search") || "";
    const limit = parseInt(searchParams.get("limit") || "50", 10);

    const db = await getDatabase();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const query: any = {};
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { headline: { $regex: search, $options: "i" } },
        { location: { $regex: search, $options: "i" } },
      ];
    }

    const personas = await db
      .collection("cara_personas")
      .find(query)
      .sort({ lastUpdated: -1 })
      .limit(Math.min(limit, 100))
      .toArray();

    return NextResponse.json({
      success: true,
      personas,
      total: personas.length,
    });
  } catch (err) {
    console.error("[cara-personas] GET error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// DELETE: Delete a persona by ID
export async function DELETE(req: NextRequest) {
  try {
    const cookieString = await getLinkedInCookies(req);
    if (!cookieString) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const personaId = searchParams.get("id");

    if (!personaId) {
      return NextResponse.json({ error: "Persona ID is required." }, { status: 400 });
    }

    const db = await getDatabase();
    const { ObjectId } = await import("mongodb");

    let query: Record<string, unknown>;
    try {
      query = { _id: new ObjectId(personaId) };
    } catch {
      query = { profileUrl: personaId };
    }

    // Find the persona first to get all identifiers for cascade delete
    const persona = await db.collection("cara_personas").findOne(query);
    
    if (!persona) {
      return NextResponse.json({ error: "Persona not found." }, { status: 404 });
    }

    const p_id = persona._id.toString();
    const p_url = persona.profileUrl;

    // Cascade delete: delete all simulation sessions associated with this persona
    // We check for both _id string and profileUrl to be thorough
    const sessionDeleteResult = await db.collection("cara_simulation_sessions").deleteMany({
      $or: [
        { personaId: p_id },
        { personaId: p_url }
      ]
    });

    console.log(`[cara-personas] Cascade delete: removed ${sessionDeleteResult.deletedCount} sessions for ${persona.name}`);

    // Finally delete the persona
    const result = await db.collection("cara_personas").deleteOne({ _id: persona._id });

    return NextResponse.json({
      success: true,
      deleted: result.deletedCount > 0,
      sessionsDeleted: sessionDeleteResult.deletedCount,
    });
  } catch (err) {
    console.error("[cara-personas] DELETE error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
