import { NextRequest, NextResponse } from "next/server";
import { getQueueDb } from "../../../db";

export const dynamic = "force-dynamic";

type AnalyticsEvent = {
  key: string;
  event: string;
  date: string;
  messageId: string;
  campaignId: string | null;
  campaignName: string;
  generatedEmailId: string | null;
  emailSendId: string | null;
  recipient: string;
  sender: string;
  subject: string;
  ip: string;
  link: string;
  reason: string;
  tag: string;
  source: "brevo" | "webhook" | "database";
};

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

function safeDate(value: unknown) {
  const parsed = new Date(String(value || ""));
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString();
}

function eventKey(event: Pick<AnalyticsEvent, "messageId" | "event" | "date" | "recipient" | "link" | "ip">) {
  return [event.messageId, event.event, event.date, event.recipient, event.link, event.ip].join("|");
}

const singleOccurrenceEvents = new Set([
  "sent", "scheduled", "delivered", "deferred", "softBounce", "hardBounce",
  "blocked", "invalid", "error", "spam", "unsubscribed",
]);

function canonicalEventKey(event: AnalyticsEvent) {
  if (event.messageId && singleOccurrenceEvents.has(event.event)) {
    return `${event.messageId}|${event.event}`;
  }
  return eventKey(event);
}

function addEvent(events: Map<string, AnalyticsEvent>, event: AnalyticsEvent) {
  const key = canonicalEventKey(event);
  const existing = events.get(key);
  const priority = { database: 0, webhook: 1, brevo: 2 };
  event.key = key;
  if (!existing || priority[event.source] > priority[existing.source]) events.set(key, event);
}

async function supabase(path: string) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Supabase is not configured.");
  const response = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Database request failed (${response.status}).`);
  return text ? JSON.parse(text) : [];
}

async function brevoEvents(startDate: string, endDate: string) {
  const key = process.env.BREVO_API_KEY;
  if (!key) throw new Error("Brevo is not configured.");
  const collected: Array<Record<string, unknown>> = [];
  for (let offset = 0; offset < 10_000; offset += 5_000) {
    const query = new URLSearchParams({
      startDate,
      endDate,
      limit: "5000",
      offset: String(offset),
      sort: "desc",
    });
    const response = await fetch(`https://api.brevo.com/v3/smtp/statistics/events?${query}`, {
      headers: { "api-key": key, accept: "application/json" },
    });
    const result = await response.json() as { events?: Array<Record<string, unknown>>; message?: string };
    if (!response.ok) throw new Error(result.message || "Brevo statistics could not be loaded.");
    const page = result.events || [];
    collected.push(...page);
    if (page.length < 5_000) break;
  }
  return collected;
}

function parseRange(req: NextRequest) {
  const today = new Date();
  const defaultEnd = today.toISOString().slice(0, 10);
  const requestedDays = Math.max(1, Math.min(90, Number(req.nextUrl.searchParams.get("days") || 30)));
  const defaultStartDate = new Date(today.getTime() - (requestedDays - 1) * 86_400_000);
  const startDate = String(req.nextUrl.searchParams.get("startDate") || defaultStartDate.toISOString().slice(0, 10));
  const endDate = String(req.nextUrl.searchParams.get("endDate") || defaultEnd);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    throw new Error("Use valid start and end dates.");
  }
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T23:59:59.999Z`);
  if (start > end || end.getTime() - start.getTime() > 90 * 86_400_000) {
    throw new Error("Statistics can cover a maximum of 90 days.");
  }
  return { startDate, endDate, start, end };
}

export async function GET(req: NextRequest) {
  try {
    const { startDate, endDate, start, end } = parseRange(req);
    const [campaigns, generatedEmails, contacts, sends, storedResult] = await Promise.all([
      supabase("campaigns?select=id,name,status,sender_name,sender_email,created_at&order=created_at.desc&limit=1000"),
      supabase("generated_emails?select=id,contact_id,campaign_id,subject,status,generated_at&order=generated_at.desc&limit=2000"),
      supabase("contacts?select=id,email,full_name&limit=2000"),
      supabase("email_sends?select=id,generated_email_id,campaign_id,sender_email,recipient_email,subject,brevo_message_id,status,sent_at,created_at&order=created_at.desc&limit=5000"),
      getQueueDb().prepare(`
        SELECT * FROM email_analytics_events
        WHERE event_at >= ? AND event_at <= ?
        ORDER BY event_at DESC
        LIMIT 10000
      `).bind(start.toISOString(), end.toISOString()).all(),
    ]);

    const campaignById = new Map(campaigns.map((campaign: Record<string, unknown>) => [String(campaign.id), campaign]));
    const generatedById = new Map(generatedEmails.map((email: Record<string, unknown>) => [String(email.id), email]));
    const contactById = new Map(contacts.map((contact: Record<string, unknown>) => [String(contact.id), contact]));
    const sendByMessage = new Map<string, Record<string, unknown>>();
    const sendById = new Map<string, Record<string, unknown>>();
    for (const send of sends) {
      sendById.set(String(send.id), send);
      const messageId = normalizeMessageId(send.brevo_message_id);
      if (messageId) sendByMessage.set(messageId, send);
    }

    let providerWarning: string | null = null;
    let liveEvents: Array<Record<string, unknown>> = [];
    try {
      liveEvents = await brevoEvents(startDate, endDate);
    } catch (error) {
      providerWarning = error instanceof Error ? error.message : "Brevo statistics are temporarily unavailable.";
    }

    const events = new Map<string, AnalyticsEvent>();
    for (const raw of liveEvents) {
      const messageId = normalizeMessageId(raw.messageId || raw["message-id"]);
      const send = sendByMessage.get(messageId);
      if (!send) continue;
      const generated = generatedById.get(String(send.generated_email_id || ""));
      const campaignId = String(send.campaign_id || generated?.campaign_id || "") || null;
      const campaign = campaignId ? campaignById.get(campaignId) : undefined;
      const contact = generated ? contactById.get(String(generated.contact_id || "")) : undefined;
      const event: AnalyticsEvent = {
        key: "",
        event: normalizeEvent(raw.event),
        date: safeDate(raw.date),
        messageId,
        campaignId,
        campaignName: String(campaign?.name || "Unassigned campaign"),
        generatedEmailId: String(send.generated_email_id || "") || null,
        emailSendId: String(send.id || "") || null,
        recipient: String(raw.email || send.recipient_email || contact?.email || "").toLowerCase(),
        sender: String(raw.from || send.sender_email || campaign?.sender_email || "").toLowerCase(),
        subject: String(raw.subject || send.subject || generated?.subject || ""),
        ip: String(raw.ip || ""),
        link: String(raw.link || raw.url || ""),
        reason: String(raw.reason || ""),
        tag: String(raw.tag || ""),
        source: "brevo",
      };
      addEvent(events, event);
    }

    for (const row of (storedResult.results || []) as Array<Record<string, unknown>>) {
      const messageId = normalizeMessageId(row.message_id);
      const send = sendByMessage.get(messageId) || sendById.get(String(row.email_send_id || ""));
      if (!send) continue;
      const generated = generatedById.get(String(send.generated_email_id || row.generated_email_id || ""));
      const campaignId = String(send.campaign_id || row.campaign_id || generated?.campaign_id || "") || null;
      const campaign = campaignId ? campaignById.get(campaignId) : undefined;
      const event: AnalyticsEvent = {
        key: String(row.provider_event_key || row.id),
        event: normalizeEvent(row.event),
        date: safeDate(row.event_at),
        messageId,
        campaignId,
        campaignName: String(campaign?.name || "Unassigned campaign"),
        generatedEmailId: String(send.generated_email_id || row.generated_email_id || "") || null,
        emailSendId: String(send.id || row.email_send_id || "") || null,
        recipient: String(row.recipient_email || send.recipient_email || "").toLowerCase(),
        sender: String(row.sender_email || send.sender_email || campaign?.sender_email || "").toLowerCase(),
        subject: String(row.subject || send.subject || generated?.subject || ""),
        ip: String(row.ip_address || ""),
        link: String(row.link || ""),
        reason: String(row.reason || ""),
        tag: String(row.tag || ""),
        source: "webhook",
      };
      addEvent(events, event);
    }

    for (const send of sends) {
      const sentDate = safeDate(send.sent_at || send.created_at);
      if (sentDate < start.toISOString() || sentDate > end.toISOString()) continue;
      if (!["sent", "delivered"].includes(String(send.status || "")) && !String(send.status || "").startsWith("scheduled")) continue;
      const generated = generatedById.get(String(send.generated_email_id || ""));
      const campaignId = String(send.campaign_id || generated?.campaign_id || "") || null;
      const campaign = campaignId ? campaignById.get(campaignId) : undefined;
      const contact = generated ? contactById.get(String(generated.contact_id || "")) : undefined;
      const synthetic: AnalyticsEvent = {
        key: "",
        event: String(send.status || "").startsWith("scheduled") ? "scheduled" : "sent",
        date: sentDate,
        messageId: normalizeMessageId(send.brevo_message_id),
        campaignId,
        campaignName: String(campaign?.name || "Unassigned campaign"),
        generatedEmailId: String(send.generated_email_id || "") || null,
        emailSendId: String(send.id || "") || null,
        recipient: String(send.recipient_email || contact?.email || "").toLowerCase(),
        sender: String(send.sender_email || campaign?.sender_email || "").toLowerCase(),
        subject: String(send.subject || generated?.subject || ""),
        ip: "",
        link: "",
        reason: "",
        tag: "ikf-outreach",
        source: "database",
      };
      addEvent(events, synthetic);
    }

    const output = [...events.values()].sort((a, b) => b.date.localeCompare(a.date));
    return NextResponse.json({
      ok: true,
      range: { startDate, endDate, maximumDays: 90 },
      provider: { connected: !providerWarning, warning: providerWarning, lastSyncedAt: new Date().toISOString() },
      campaigns: campaigns.map((campaign: Record<string, unknown>) => ({
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        senderName: campaign.sender_name,
        senderEmail: campaign.sender_email,
        createdAt: campaign.created_at,
      })),
      events: output,
      coverage: {
        liveBrevoEvents: liveEvents.length,
        storedWebhookEvents: (storedResult.results || []).length,
        matchedOutreachEvents: output.length,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Statistics could not be loaded." },
      { status: 500 },
    );
  }
}
