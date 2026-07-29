import { NextRequest, NextResponse } from "next/server";
import { getQueueDb } from "../../../db";

export const dynamic = "force-dynamic";

type BrevoWebhookEvent = Record<string, unknown>;

function normalizeMessageId(value: unknown) {
  return String(value || "").trim().replace(/^<|>$/g, "").toLowerCase();
}

function normalizeEvent(value: unknown) {
  const event = String(value || "").trim();
  const aliases: Record<string, string> = {
    request: "sent",
    requests: "sent",
    unique_opened: "uniqueOpened",
    hard_bounce: "hardBounce",
    soft_bounce: "softBounce",
    complaint: "spam",
    unsubscribe: "unsubscribed",
    clicks: "click",
    clicked: "click",
  };
  return aliases[event] || event;
}

function eventDate(event: BrevoWebhookEvent) {
  const supplied = event.date || event.ts_event || event.ts || event.timestamp;
  if (typeof supplied === "number") return new Date(supplied * 1000).toISOString();
  const parsed = new Date(String(supplied || ""));
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString();
}

function eventKey(event: BrevoWebhookEvent, eventAt = eventDate(event)) {
  return [
    normalizeMessageId(event["message-id"] || event.messageId || event.message_id),
    normalizeEvent(event.event),
    eventAt,
    String(event.email || "").toLowerCase(),
    String(event.link || event.url || ""),
    String(event.ip || ""),
  ].join("|");
}

async function supabase(path: string) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Supabase is not configured.");
  const response = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!response.ok) throw new Error(`Supabase lookup failed (${response.status}).`);
  return response.json();
}

export async function POST(req: NextRequest) {
  try {
    const configuredToken = process.env.BREVO_WEBHOOK_TOKEN;
    const suppliedToken = req.nextUrl.searchParams.get("token");
    const authorization = req.headers.get("authorization");
    const bearerToken = authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
    if (!configuredToken || (suppliedToken !== configuredToken && bearerToken !== configuredToken)) {
      return NextResponse.json({ ok: false, error: "Invalid webhook token." }, { status: 401 });
    }
    const body = await req.json();
    const incoming = (Array.isArray(body) ? body : [body]) as BrevoWebhookEvent[];
    const usable = incoming.filter((event) => event.email && event.event);
    if (!usable.length) return NextResponse.json({ ok: true, accepted: 0 });

    const sends = await supabase(
      "email_sends?select=id,generated_email_id,campaign_id,brevo_message_id,recipient_email,sender_email,subject&order=created_at.desc&limit=2000",
    );
    const sendByMessage = new Map(
      sends
        .filter((send: Record<string, unknown>) => send.brevo_message_id)
        .map((send: Record<string, unknown>) => [normalizeMessageId(send.brevo_message_id), send]),
    );
    const queueDb = getQueueDb();
    const now = new Date().toISOString();
    await queueDb.batch(usable.map((event) => {
      const messageId = normalizeMessageId(event["message-id"] || event.messageId || event.message_id);
      const send = sendByMessage.get(messageId) as Record<string, unknown> | undefined;
      const eventAt = eventDate(event);
      return queueDb.prepare(`
        INSERT OR IGNORE INTO email_analytics_events (
          id, provider_event_key, campaign_id, generated_email_id, email_send_id,
          message_id, recipient_email, sender_email, subject, event, event_at,
          ip_address, link, reason, tag, payload, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(),
        eventKey(event, eventAt),
        send?.campaign_id || null,
        send?.generated_email_id || null,
        send?.id || null,
        messageId || null,
        String(event.email || send?.recipient_email || "").toLowerCase(),
        String(event.from || send?.sender_email || "").toLowerCase() || null,
        String(event.subject || send?.subject || "") || null,
        normalizeEvent(event.event),
        eventAt,
        String(event.ip || "") || null,
        String(event.link || event.url || "") || null,
        String(event.reason || event.message || "") || null,
        String(event.tag || "") || null,
        JSON.stringify(event),
        now,
      );
    }));
    return NextResponse.json({ ok: true, accepted: usable.length });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Webhook processing failed." },
      { status: 500 },
    );
  }
}
