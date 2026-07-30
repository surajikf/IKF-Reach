import { NextRequest, NextResponse } from "next/server";
import { getQueueDb } from "../../../db";

export const dynamic = "force-dynamic";

type BrevoWebhookEvent = Record<string, unknown>;
const permanentSuppressionEvents = new Set(["hardBounce", "blocked", "invalid", "spam", "unsubscribed"]);

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
  const timestamp = event.ts_event || event.ts || event.timestamp;
  const numericTimestamp = Number(timestamp);
  if (timestamp !== undefined && Number.isFinite(numericTimestamp)) {
    return new Date(numericTimestamp > 1_000_000_000_000 ? numericTimestamp : numericTimestamp * 1000).toISOString();
  }
  const parsed = new Date(String(event.date || ""));
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

function suppressionReason(eventName: string, providerReason: string) {
  if (eventName === "hardBounce") {
    return providerReason
      ? `This address hard-bounced and is permanently suppressed. ${providerReason}`
      : "This address hard-bounced and is permanently suppressed.";
  }
  if (eventName === "spam") return "A spam complaint was recorded. This address is permanently suppressed.";
  if (eventName === "unsubscribed") return "The recipient unsubscribed. This address is permanently suppressed.";
  return providerReason
    ? `This address was rejected and is permanently suppressed. ${providerReason}`
    : "This address was rejected and is permanently suppressed.";
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
    const headerToken = req.headers.get("x-brevo-webhook-token") || "";
    if (!configuredToken || (suppliedToken !== configuredToken && bearerToken !== configuredToken && headerToken !== configuredToken)) {
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
    const statements: D1PreparedStatement[] = [];
    for (const event of usable) {
      const messageId = normalizeMessageId(event["message-id"] || event.messageId || event.message_id);
      const send = sendByMessage.get(messageId) as Record<string, unknown> | undefined;
      const eventAt = eventDate(event);
      const recipientEmail = String(event.email || send?.recipient_email || "").trim().toLowerCase();
      const eventName = normalizeEvent(event.event);
      const providerReason = String(event.reason || event.message || "").trim();
      statements.push(queueDb.prepare(`
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
        recipientEmail,
        String(event.from || send?.sender_email || "").toLowerCase() || null,
        String(event.subject || send?.subject || "") || null,
        eventName,
        eventAt,
        String(event.ip || "") || null,
        String(event.link || event.url || "") || null,
        providerReason || null,
        String(event.tag || "") || null,
        JSON.stringify(event),
        now,
      ));
      if (permanentSuppressionEvents.has(eventName)) {
        const reason = suppressionReason(eventName, providerReason);
        statements.push(queueDb.prepare(`
          INSERT INTO email_suppressions (
            normalized_email, source_event, reason, message_id,
            first_seen_at, last_seen_at, active
          ) VALUES (?, ?, ?, ?, ?, ?, 1)
          ON CONFLICT(normalized_email) DO UPDATE SET
            source_event = excluded.source_event,
            reason = excluded.reason,
            message_id = COALESCE(excluded.message_id, email_suppressions.message_id),
            last_seen_at = excluded.last_seen_at,
            active = 1
        `).bind(recipientEmail, eventName, reason, messageId || null, eventAt, eventAt));
        statements.push(queueDb.prepare(`
          UPDATE email_validation_results
          SET verdict = 'invalid',
              score = 0,
              previous_hard_bounce = CASE WHEN ? IN ('hardBounce', 'blocked', 'invalid') THEN 1 ELSE previous_hard_bounce END,
              complaint = CASE WHEN ? = 'spam' THEN 1 ELSE complaint END,
              unsubscribed = CASE WHEN ? = 'unsubscribed' THEN 1 ELSE unsubscribed END,
              reasons = ?,
              job_id = 'provider-suppression',
              validated_at = ?
          WHERE normalized_email = ?
        `).bind(eventName, eventName, eventName, JSON.stringify([reason]), eventAt, recipientEmail));
      }
    }
    for (let index = 0; index < statements.length; index += 80) {
      await queueDb.batch(statements.slice(index, index + 80));
    }
    return NextResponse.json({ ok: true, accepted: usable.length });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Webhook processing failed." },
      { status: 500 },
    );
  }
}
