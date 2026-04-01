import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export async function GET(req: NextRequest) {
  try {
    const filePath = path.join(process.cwd(), "xavier_inbox_debug.png");
    
    if (!fs.existsSync(filePath)) {
      return new NextResponse("Screenshot not found", { status: 404 });
    }

    const fileBuffer = fs.readFileSync(filePath);
    return new NextResponse(fileBuffer, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store, must-revalidate",
      },
    });
  } catch (err: any) {
    return new NextResponse(err.message, { status: 500 });
  }
}
