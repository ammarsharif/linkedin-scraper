import { NextRequest, NextResponse } from "next/server";
import { getDatabase, StoredProfile, EmailRecord } from "@/lib/mongodb";
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
          
          <!-- Header -->
          <tr>
            <td style="padding: 0 0 24px;">
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); border-radius: 16px 16px 0 0; overflow: hidden;">
                <tr>
                  <td style="padding: 28px 32px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                      <tr>
                        <td>
                          <div style="display: inline-block; background: linear-gradient(135deg, #f97316, #ef4444, #ec4899); padding: 8px 12px; border-radius: 10px; margin-bottom: 12px;">
                            <span style="color: white; font-size: 14px; font-weight: 700; letter-spacing: 0.5px;">DEMARKO</span>
                          </div>
                          <h1 style="margin: 8px 0 0; color: #ffffff; font-size: 22px; font-weight: 700; line-height: 1.3;">
                            A personalized message for you
                          </h1>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <!-- Gradient accent bar -->
                <tr>
                  <td style="height: 4px; background: linear-gradient(90deg, #f97316, #ef4444, #ec4899, #8b5cf6);"></td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td>
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background: #ffffff; border-radius: 0 0 16px 16px; box-shadow: 0 4px 24px rgba(0,0,0,0.08);">
                <tr>
                  <td style="padding: 36px 32px;">
                    <!-- Greeting -->
                    <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.7; color: #374151;">
                      Hi <strong style="color: #0f172a;">${recipientName}</strong>,
                    </p>
                    
                    <!-- Email Body -->
                    ${bodyHtml}
                    
                    <!-- Signature -->
                    ${senderName ? `
                    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-top: 32px; border-top: 1px solid #e5e7eb; padding-top: 24px;">
                      <tr>
                        <td>
                          <p style="margin: 0; font-size: 15px; font-weight: 600; color: #0f172a;">${senderName}</p>
                          ${senderTitle ? `<p style="margin: 4px 0 0; font-size: 13px; color: #6b7280;">${senderTitle}</p>` : ""}
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
              <p style="margin: 0; font-size: 11px; color: #9ca3af; line-height: 1.6;">
                This email was crafted with personalized insights via Demarko Outreach Bot.
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
    const cookieString = req.cookies.get("li_session")?.value;
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
    const cookieString = req.cookies.get("li_session")?.value;
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
