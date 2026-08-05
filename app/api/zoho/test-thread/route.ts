import { NextRequest, NextResponse } from "next/server";
import { getManagementAccess } from "../../../lib/manage-access";
import { replyZohoMessage, sendZohoMessage } from "../../../lib/zoho";
import { saveZohoThread } from "../../../lib/followups";

export const dynamic = "force-dynamic";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function text(value: unknown, max = 10000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: NextRequest) {
  const access = await getManagementAccess(request);
  if (!access.allowed) return NextResponse.json({ ok: false, error: "Authorized IKF access is required." }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Request body must be valid JSON." }, { status: 400 });
  }

  const action = text(body.action, 20).toLowerCase();
  const toAddress = text(body.toAddress, 320).toLowerCase();
  const subject = text(body.subject, 300);
  const html = text(body.html, 100000);
  const fromAddress = text(body.fromAddress, 320).toLowerCase() || undefined;

  if (action !== "send" && action !== "reply") {
    return NextResponse.json({ ok: false, error: "Action must be send or reply." }, { status: 400 });
  }
  if (!emailPattern.test(toAddress)) return NextResponse.json({ ok: false, error: "A valid recipient email is required." }, { status: 400 });
  if (fromAddress && !emailPattern.test(fromAddress)) return NextResponse.json({ ok: false, error: "The sender email is invalid." }, { status: 400 });
  if (!subject) return NextResponse.json({ ok: false, error: "A subject is required." }, { status: 400 });
  if (!html) return NextResponse.json({ ok: false, error: "Email HTML is required." }, { status: 400 });

  try {
    if (action === "send") {
      const result = await sendZohoMessage({ toAddress, subject, html, fromAddress });
      const campaignId = text(body.campaignId, 100);
      if (campaignId && result.messageId) {
        await saveZohoThread({ campaignId, generatedEmailId: text(body.generatedEmailId, 100) || null, recipientEmail: toAddress, subject, messageId: result.messageId, direction: "outbound", sentAt: new Date().toISOString() });
      }
      return NextResponse.json({ ok: true, action, messageId: result.messageId, payload: result.payload });
    }

    const messageId = text(body.messageId, 500);
    if (!messageId) return NextResponse.json({ ok: false, error: "The original Zoho message ID is required for a reply." }, { status: 400 });
    const result = await replyZohoMessage({ messageId, toAddress, subject, html, fromAddress });
    const campaignId = text(body.campaignId, 100);
    if (campaignId && result.messageId) {
      await saveZohoThread({ campaignId, generatedEmailId: text(body.generatedEmailId, 100) || null, recipientEmail: toAddress, subject, messageId: result.messageId, direction: "outbound", sentAt: new Date().toISOString() });
    }
    return NextResponse.json({ ok: true, action, messageId: result.messageId, payload: result.payload });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Zoho Mail request failed." }, { status: 502 });
  }
}
