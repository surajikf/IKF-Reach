import { NextRequest, NextResponse } from "next/server";
import { getQueueDb } from "../../../db";

export const dynamic = "force-dynamic";

const supabaseUrl = () => process.env.SUPABASE_URL || "";
const supabaseKey = () => process.env.SUPABASE_SECRET_KEY || "";

async function db(path: string, init: RequestInit = {}) {
  const response = await fetch(`${supabaseUrl()}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: supabaseKey(),
      Authorization: `Bearer ${supabaseKey()}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers || {}),
    },
  });
  if (!response.ok) throw new Error(`Database request failed (${response.status})`);
  const text = await response.text();
  return text ? JSON.parse(text) : [];
}

async function unsubscribeContact(contactId: string, email: string) {
  const normalized = email.trim().toLowerCase();
  if (!/^[0-9a-f-]{36}$/i.test(contactId) || !/^\S+@\S+\.\S+$/.test(normalized)) return false;
  const contacts = await db(`contacts?select=id,email&id=eq.${encodeURIComponent(contactId)}&limit=1`);
  const contact = contacts[0];
  if (!contact || String(contact.email || "").trim().toLowerCase() !== normalized) return false;

  const now = new Date().toISOString();
  await getQueueDb().prepare(`
    INSERT INTO email_suppressions (normalized_email, source_event, reason, first_seen_at, last_seen_at, active)
    VALUES (?, 'unsubscribed', 'Recipient unsubscribed via the one-click link in the email.', ?, ?, 1)
    ON CONFLICT(normalized_email) DO UPDATE SET
      source_event = 'unsubscribed',
      reason = 'Recipient unsubscribed via the one-click link in the email.',
      last_seen_at = excluded.last_seen_at,
      active = 1
  `).bind(normalized, now, now).run();

  await db("activity_log", {
    method: "POST",
    body: JSON.stringify({
      contact_id: contactId,
      action: "recipient_unsubscribed",
      details: { email: normalized, source: "unsubscribe_link" },
    }),
  });
  return true;
}

function confirmationPage(success: boolean) {
  const message = success
    ? "You have been unsubscribed and will not receive further emails from us."
    : "We could not find that subscription. If you keep receiving emails, reply to any message and let us know.";
  return `<!doctype html><html><head><meta charset="utf-8"><title>Unsubscribed</title><style>body{font-family:Calibri,Arial,sans-serif;max-width:520px;margin:80px auto;padding:0 20px;color:#20252d;text-align:center;line-height:1.5}h1{font-size:20px}</style></head><body><h1>${message}</h1></body></html>`;
}

async function handleUnsubscribe(req: NextRequest) {
  const contactId = req.nextUrl.searchParams.get("contact") || "";
  const email = req.nextUrl.searchParams.get("email") || "";
  try {
    return await unsubscribeContact(contactId, email);
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  const success = await handleUnsubscribe(req);
  return new NextResponse(confirmationPage(success), { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export async function POST(req: NextRequest) {
  const success = await handleUnsubscribe(req);
  return NextResponse.json({ ok: success });
}
