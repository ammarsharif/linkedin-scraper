import { NextRequest, NextResponse } from "next/server";
import { getDatabase, StoredProfile, EmailRecord } from "@/lib/mongodb";
import { getLinkedInCookies } from "@/lib/linkedin";
import nodemailer from "nodemailer";

export const maxDuration = 60;

// ── Email transporter (configure via env vars) ───────────────────────────

function getTransporter() {
  return nodemailer.createTransport({
    service: process.env.EMAIL_SERVICE || "gmail",
    auth: {
      user: process.env.EMAIL_USER || "",
      pass: process.env.EMAIL_PASS || "",
    },
  });
}

// ── Beautiful HTML Email Template ────────────────────────────────────────

function generateEmailHtml(params: {
  recipientName: string;
  subject: string;
  body: string;
  senderName?: string;
  senderTitle?: string;
}): string {
  const { recipientName, body, senderName, senderTitle } = params;

  // Convert newlines in body to <br> and then to paragraphs
  const bodyHtml = body
    .split("\n\n")
    .map((para) => `<p style="margin: 0 0 16px; line-height: 1.7; color: #374151;">${para.replace(/\n/g, "<br>")}</p>`)
    .join("");

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Message for ${recipientName}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f3f4f6; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f3f4f6;">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="600" style="margin: 0 auto; max-width: 600px;">
          
          <!-- Unified Card -->
          <tr>
            <td>
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.06); border: 1px solid #e5e7eb;">
                
                <!-- Top Accent Bar -->
                <tr>
                  <td style="height: 4px; background: linear-gradient(90deg, #f97316, #ef4444, #ec4899);"></td>
                </tr>

                <!-- Branding Area -->
                <tr>
                  <td style="padding: 32px 32px 0;">
                    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                      <tr>
                        <td>
                          <div style="font-size: 13px; font-weight: 700; letter-spacing: 1.5px; color: #1e293b; text-transform: uppercase; line-height: 1;">
                            DEMARKO <span style="font-weight: 400; color: #94a3b8; font-size: 11px; margin-left: 8px; letter-spacing: 0.5px;">| INTELLIGENCE</span>
                          </div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- Body Area -->
                <tr>
                  <td style="padding: 32px 32px 40px;">
                    <!-- Email Content -->
                    <div style="font-size: 16px; line-height: 1.7; color: #334155;">
                      ${bodyHtml}
                    </div>
                    
                    <!-- Signature -->
                    ${senderName ? `
                    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-top: 40px; border-top: 1px solid #f1f5f9; padding-top: 24px;">
                      <tr>
                        <td>
                          <p style="margin: 0; font-size: 15px; font-weight: 600; color: #0f172a;">${senderName}</p>
                          ${senderTitle ? `<p style="margin: 4px 0 0; font-size: 13px; color: #64748b;">${senderTitle}</p>` : ""}
                        </td>
                      </tr>
                    </table>
                    ` : ""}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 0; text-align: center;">
              <p style="margin: 0; font-size: 11px; color: #9ca3af; font-weight: 500;">
                Sent via <span style="color: #374151; font-weight: 600;">Demarko</span> Intelligence
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ── GET: List all stored profiles ─────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const cookieString = await getLinkedInCookies(req);
    if (!cookieString) {
      return NextResponse.json(
        { error: "Not authenticated." },
        { status: 401 }
      );
    }

    const db = await getDatabase();
    const profiles = await db
      .collection("profiles")
      .find({})
      .sort({ lastUpdated: -1 })
      .toArray();

    return NextResponse.json({ success: true, profiles });
  } catch (err) {
    console.error("[demarko] GET error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ── POST: Store profile or send email ─────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const cookieString = await getLinkedInCookies(req);
    if (!cookieString) {
      return NextResponse.json(
        { error: "Not authenticated." },
        { status: 401 }
      );
    }

    const body = await req.json();
    const { action } = body;

    const db = await getDatabase();

    // ── Action: store-profile ──
    if (action === "store-profile") {
      const { profile, report } = body;
      if (!profile || !profile.name) {
        return NextResponse.json(
          { error: "Profile data is required." },
          { status: 400 }
        );
      }

      // Extract email from profile contacts if available
      const scrapedEmail = profile.contacts?.find(
        (c: any) => c.type === "email"
      )?.value;
      
      const now = new Date().toISOString();
      const profileDoc: StoredProfile = {
        profileUrl: profile.profileUrl || "",
        vanityName: profile.vanityName || "",
        name: profile.name,
        headline: profile.headline || "",
        location: profile.location || "",
        executiveSummary: report?.executiveSummary || "",
        roleLevel: report?.profileAnalysis?.roleLevel || "",
        industryFocus: report?.profileAnalysis?.industryFocus || [],
        areasOfExpertise: report?.profileAnalysis?.areasOfExpertise || [],
        currentFocus: report?.professionalInsights?.currentFocus || "",
        communicationStyle:
          report?.personalityProfile?.communicationStyle || "",
        values: report?.personalityProfile?.values || [],
        challengesMentioned:
          report?.professionalInsights?.challengesMentioned || [],
        achievementsMentioned:
          report?.professionalInsights?.achievementsMentioned || [],
        emailAddress: scrapedEmail || "",
        emailsSent: [],
        scrapedAt: now,
        lastUpdated: now,
      };

      // Upsert by profileUrl
      // Strip emailsSent, scrapedAt, and emailAddress from $set 
      // to avoid overwriting existing data with empty values
      const { emailsSent: _unused, scrapedAt: _unused2, emailAddress: providedEmail, ...updateData } = profileDoc;

      const setPayload: any = {
        ...updateData,
        lastUpdated: now,
      };

      // Only update email if we actually found a new one during this scrape
      if (providedEmail) {
        setPayload.emailAddress = providedEmail;
      }

      const result = await db.collection("profiles").updateOne(
        { profileUrl: profileDoc.profileUrl },
        {
          $set: setPayload,
          $setOnInsert: {
            emailsSent: [],
            scrapedAt: now,
          },
        },
        { upsert: true }
      );

      return NextResponse.json({
        success: true,
        action: "store-profile",
        upserted: result.upsertedCount > 0,
        modified: result.modifiedCount > 0,
      });
    }

    // ── Action: send-email ──
    if (action === "send-email") {
      const {
        profileId,
        recipientEmail,
        recipientName,
        subject,
        emailBody,
        senderName,
        senderTitle,
      } = body;

      if (!recipientEmail || !subject || !emailBody) {
        return NextResponse.json(
          { error: "Email, subject, and body are required." },
          { status: 400 }
        );
      }

      if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
        return NextResponse.json(
          {
            error:
              "Email credentials not configured. Set EMAIL_USER and EMAIL_PASS in .env",
          },
          { status: 500 }
        );
      }

      const htmlContent = generateEmailHtml({
        recipientName: recipientName || "there",
        subject,
        body: emailBody,
        senderName,
        senderTitle,
      });

      const emailRecord: EmailRecord = {
        id: `email_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        to: recipientEmail,
        subject,
        body: emailBody,
        sentAt: new Date().toISOString(),
        status: "sent",
      };

      try {
        const transporter = getTransporter();
        await transporter.sendMail({
          from: `"${senderName || "Demarko"}" <${process.env.EMAIL_USER}>`,
          to: recipientEmail,
          subject,
          html: htmlContent,
          text: `Hi ${recipientName || "there"},\n\n${emailBody}\n\n${senderName ? `${senderName}${senderTitle ? `\n${senderTitle}` : ""}` : ""}`,
        });

        console.log(
          `[demarko] Email sent to ${recipientEmail} for profile ${profileId}`
        );
      } catch (emailErr) {
        console.error("[demarko] Email send error:", emailErr);
        emailRecord.status = "failed";
        emailRecord.errorMessage =
          emailErr instanceof Error ? emailErr.message : "Email send failed";
      }

      // Save email record to profile
      if (profileId) {
        const { ObjectId } = await import("mongodb");
        let query: Record<string, unknown>;
        try {
          query = { _id: new ObjectId(profileId) };
        } catch {
          query = { profileUrl: profileId };
        }

        await db.collection("profiles").updateOne(query, {
          $push: { emailsSent: emailRecord as never },
          $set: {
            emailAddress: recipientEmail,
            lastUpdated: new Date().toISOString(),
          },
          $unset: {
            draftSubject: "",
            draftBody: "",
          }
        });
      }

      if (emailRecord.status === "failed") {
        return NextResponse.json(
          {
            success: false,
            error: emailRecord.errorMessage || "Email failed to send",
            emailRecord,
          },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        action: "send-email",
        emailRecord,
      });
    }

    // ── Action: update-email ──
    if (action === "update-email") {
      const { profileId, emailAddress } = body;
      if (!profileId || !emailAddress) {
        return NextResponse.json(
          { error: "profileId and emailAddress are required." },
          { status: 400 }
        );
      }

      const { ObjectId } = await import("mongodb");
      let query: Record<string, unknown>;
      try {
        query = { _id: new ObjectId(profileId) };
      } catch {
        query = { profileUrl: profileId };
      }

      await db.collection("profiles").updateOne(query, {
        $set: { emailAddress, lastUpdated: new Date().toISOString() },
      });

      return NextResponse.json({ success: true, action: "update-email" });
    }

    // ── Action: delete-profile ──
    if (action === "delete-profile") {
      const { profileId } = body;
      if (!profileId) {
        return NextResponse.json(
          { error: "profileId is required." },
          { status: 400 }
        );
      }

      const { ObjectId } = await import("mongodb");
      let query: Record<string, unknown>;
      try {
        query = { _id: new ObjectId(profileId) };
      } catch {
        query = { profileUrl: profileId };
      }

      await db.collection("profiles").deleteOne(query);
      return NextResponse.json({ success: true, action: "delete-profile" });
    }

    // ── Action: save-draft ──
    if (action === "save-draft") {
      const { profileId, draftSubject, draftBody } = body;
      if (!profileId) {
        return NextResponse.json(
          { error: "profileId is required." },
          { status: 400 }
        );
      }

      const { ObjectId } = await import("mongodb");
      let query: Record<string, unknown>;
      try {
        query = { _id: new ObjectId(profileId) };
      } catch {
        query = { profileUrl: profileId };
      }

      await db.collection("profiles").updateOne(query, {
        $set: { 
          draftSubject, 
          draftBody, 
          lastUpdated: new Date().toISOString() 
        },
      });

      return NextResponse.json({ success: true, action: "save-draft" });
    }

    return NextResponse.json(
      { error: `Unknown action: ${action}` },
      { status: 400 }
    );
  } catch (err) {
    console.error("[demarko] POST error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
