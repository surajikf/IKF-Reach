import { randomUUID } from "node:crypto";
import { getQueueDb } from "../../db";
import { findZohoThreadAnchor, getZohoMessageContent, replyZohoMessage } from "./zoho";
import { replacePersonalizationPlaceholders } from "./personalization";

const FOLLOWUP_SCHEMA = `
CREATE TABLE IF NOT EXISTS zoho_thread_messages (id text PRIMARY KEY NOT NULL,campaign_id text NOT NULL,generated_email_id text,email_send_id text,recipient_email text NOT NULL,subject text NOT NULL,zoho_message_id text NOT NULL,original_zoho_message_id text,latest_zoho_message_id text,zoho_thread_id text,direction text DEFAULT 'outbound' NOT NULL,replied integer DEFAULT 0 NOT NULL,sent_at text,last_synced_at text,created_at text NOT NULL,updated_at text NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS zoho_thread_messages_campaign_recipient_uidx ON zoho_thread_messages(campaign_id,recipient_email);
CREATE TABLE IF NOT EXISTS followup_sequences (id text PRIMARY KEY NOT NULL,campaign_id text NOT NULL,campaign_name text NOT NULL,name text NOT NULL,status text DEFAULT 'draft' NOT NULL,mode text DEFAULT 'reply_thread' NOT NULL,exclude_replied integer DEFAULT 1 NOT NULL,total_recipients integer DEFAULT 0 NOT NULL,eligible_recipients integer DEFAULT 0 NOT NULL,excluded_recipients integer DEFAULT 0 NOT NULL,sent_count integer DEFAULT 0 NOT NULL,failed_count integer DEFAULT 0 NOT NULL,cancel_requested integer DEFAULT 0 NOT NULL,scheduled_for text,created_by text NOT NULL,approved_at text,started_at text,completed_at text,created_at text NOT NULL,updated_at text NOT NULL);
CREATE INDEX IF NOT EXISTS followup_sequences_campaign_idx ON followup_sequences(campaign_id);
CREATE TABLE IF NOT EXISTS followup_stages (id text PRIMARY KEY NOT NULL,sequence_id text NOT NULL,position integer NOT NULL,subject text NOT NULL,html_template text NOT NULL,delay_minutes integer DEFAULT 0 NOT NULL,created_at text NOT NULL,updated_at text NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS followup_stages_sequence_position_uidx ON followup_stages(sequence_id,position);
CREATE TABLE IF NOT EXISTS followup_recipients (id text PRIMARY KEY NOT NULL,sequence_id text NOT NULL,generated_email_id text,contact_id text,recipient_email text NOT NULL,company_name text,contact_name text,original_subject text NOT NULL,zoho_message_id text,status text DEFAULT 'eligible' NOT NULL,exclusion_reason text,current_stage integer DEFAULT 0 NOT NULL,next_run_at text,last_error text,replied integer DEFAULT 0 NOT NULL,created_at text NOT NULL,updated_at text NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS followup_recipients_sequence_email_uidx ON followup_recipients(sequence_id,recipient_email);
CREATE INDEX IF NOT EXISTS followup_recipients_due_idx ON followup_recipients(status,next_run_at);
CREATE TABLE IF NOT EXISTS followup_events (id text PRIMARY KEY NOT NULL,sequence_id text NOT NULL,recipient_id text,stage_position integer,event text NOT NULL,detail text,message_id text,created_at text NOT NULL);
CREATE INDEX IF NOT EXISTS followup_events_sequence_idx ON followup_events(sequence_id);
`;

let schemaReady: Promise<void> | null = null;
export async function ensureFollowupSchema() {
  if (!schemaReady) schemaReady = (async () => {
    const queue = getQueueDb();
    await queue.exec(FOLLOWUP_SCHEMA);
    const columns = await queue.prepare("PRAGMA table_info(zoho_thread_messages)").all<{ name: string }>();
    const names = new Set(columns.results.map((column) => column.name));
    if (!names.has("original_zoho_message_id")) await queue.exec("ALTER TABLE zoho_thread_messages ADD COLUMN original_zoho_message_id text");
    if (!names.has("latest_zoho_message_id")) await queue.exec("ALTER TABLE zoho_thread_messages ADD COLUMN latest_zoho_message_id text");
    await queue.exec("UPDATE zoho_thread_messages SET original_zoho_message_id=COALESCE(original_zoho_message_id,zoho_message_id),latest_zoho_message_id=COALESCE(latest_zoho_message_id,zoho_message_id)");
  })().catch((error) => { schemaReady = null; throw error; });
  await schemaReady;
}

function supabaseUrl() { return process.env.SUPABASE_URL || ""; }
function supabaseKey() { return process.env.SUPABASE_SECRET_KEY || ""; }
async function sb(path: string) {
  const response = await fetch(`${supabaseUrl()}/rest/v1/${path}`, { cache: "no-store", headers: { apikey: supabaseKey(), Authorization: `Bearer ${supabaseKey()}` } });
  if (!response.ok) throw new Error(`Database request failed (${response.status}).`);
  return await response.json() as Array<Record<string, any>>;
}

function chunks<T>(items: T[], size = 80) {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

export async function saveZohoThread(input: { campaignId: string; generatedEmailId?: string | null; emailSendId?: string | null; recipientEmail: string; subject: string; messageId: string; threadId?: string | null; direction?: string; replied?: boolean; sentAt?: string | null }) {
  await ensureFollowupSchema();
  const now = new Date().toISOString();
  await getQueueDb().prepare(`INSERT INTO zoho_thread_messages (id,campaign_id,generated_email_id,email_send_id,recipient_email,subject,zoho_message_id,original_zoho_message_id,latest_zoho_message_id,zoho_thread_id,direction,replied,sent_at,last_synced_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(campaign_id,recipient_email) DO UPDATE SET generated_email_id=COALESCE(excluded.generated_email_id,generated_email_id),email_send_id=COALESCE(excluded.email_send_id,email_send_id),subject=excluded.subject,zoho_message_id=excluded.zoho_message_id,original_zoho_message_id=COALESCE(original_zoho_message_id,excluded.original_zoho_message_id),latest_zoho_message_id=excluded.latest_zoho_message_id,zoho_thread_id=COALESCE(excluded.zoho_thread_id,zoho_thread_id),direction=excluded.direction,replied=MAX(replied,excluded.replied),sent_at=COALESCE(excluded.sent_at,sent_at),last_synced_at=excluded.last_synced_at,updated_at=excluded.updated_at`).bind(randomUUID(), input.campaignId, input.generatedEmailId || null, input.emailSendId || null, input.recipientEmail.trim().toLowerCase(), input.subject, input.messageId, input.messageId, input.messageId, input.threadId || null, input.direction || "outbound", input.replied ? 1 : 0, input.sentAt || null, now, now, now).run();
}

async function campaignAudience(campaignId: string) {
  const campaigns = await sb(`campaigns?select=id,name,status&id=eq.${encodeURIComponent(campaignId)}&limit=1`);
  if (!campaigns[0]) throw new Error("Campaign not found.");
  const emails = await sb(`generated_emails?select=id,contact_id,company_id,subject,status&campaign_id=eq.${encodeURIComponent(campaignId)}&status=eq.sent&limit=10000`);
  const contactIds = [...new Set(emails.map((row) => String(row.contact_id || "")).filter(Boolean))];
  const companyIds = [...new Set(emails.map((row) => String(row.company_id || "")).filter(Boolean))];
  const contacts: Array<Record<string, any>> = [];
  const companies: Array<Record<string, any>> = [];
  for (const group of chunks(contactIds)) contacts.push(...await sb(`contacts?select=id,email,full_name,unsubscribed&id=in.(${group.map(encodeURIComponent).join(",")})&limit=100`));
  for (const group of chunks(companyIds)) companies.push(...await sb(`companies?select=id,name&id=in.(${group.map(encodeURIComponent).join(",")})&limit=100`));
  const contactById = new Map(contacts.map((row) => [String(row.id), row]));
  const companyById = new Map(companies.map((row) => [String(row.id), row]));
  const rows: Array<Record<string, any>> = emails.map((email): Record<string, any> => ({
    ...email,
    contact: contactById.get(String(email.contact_id || "")),
    company: companyById.get(String(email.company_id || "")),
  }));
  return { campaign: campaigns[0], rows };
}

export async function createFollowupSequence(input: { campaignId: string; name: string; excludeReplied: boolean; stages: Array<{ subject: string; html: string; delayMinutes?: number }>; actor: string }) {
  await ensureFollowupSchema();
  if (!input.stages.length) throw new Error("Add at least one follow-up stage.");
  const { campaign, rows } = await campaignAudience(input.campaignId);
  if (!rows.length) throw new Error("This campaign has no sent emails to follow up.");
  const queue = getQueueDb();
  const sequenceId = randomUUID();
  const now = new Date().toISOString();
  const delivered = new Set<string>();
  const events = await queue.prepare("SELECT lower(recipient_email) email,event FROM email_analytics_events WHERE campaign_id = ? AND event IN ('delivered','hardBounce','blocked','spam','unsubscribed')").bind(input.campaignId).all<{ email: string; event: string }>();
  const harmful = new Map<string, string>();
  for (const event of events.results) {
    if (event.event === "delivered") delivered.add(event.email);
    else harmful.set(event.email, event.event);
  }
  const suppressions = await queue.prepare("SELECT normalized_email,source_event FROM email_suppressions WHERE active=1").all<{ normalized_email: string; source_event: string }>();
  for (const item of suppressions.results) harmful.set(item.normalized_email, item.source_event || "suppressed");
  const savedThreads = await queue.prepare("SELECT * FROM zoho_thread_messages WHERE campaign_id = ?").bind(input.campaignId).all<Record<string, any>>();
  const threadByEmail = new Map(savedThreads.results.map((item) => [String(item.recipient_email), item]));

  const recipientStatements = [];
  let eligible = 0;
  let excluded = 0;
  for (const row of rows) {
    const email = String(row.contact?.email || "").trim().toLowerCase();
    if (!email) continue;
    const thread = threadByEmail.get(email);
    let exclusion: string | null = null;
    if (!delivered.has(email)) exclusion = "not_confirmed_delivered";
    if (harmful.has(email)) exclusion = harmful.get(email) || "suppressed";
    if (row.contact?.unsubscribed) exclusion = "unsubscribed";
    if (input.excludeReplied && Number(thread?.replied || 0)) exclusion = "already_replied";
    if (!thread?.zoho_message_id) exclusion = "thread_unavailable";
    if (exclusion) excluded += 1; else eligible += 1;
    recipientStatements.push(queue.prepare("INSERT INTO followup_recipients (id,sequence_id,generated_email_id,contact_id,recipient_email,company_name,contact_name,original_subject,zoho_message_id,status,exclusion_reason,current_stage,next_run_at,last_error,replied,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(randomUUID(), sequenceId, row.id, row.contact_id || null, email, row.company?.name || "", row.contact?.full_name || "", row.subject || "", thread?.zoho_message_id || null, exclusion ? "excluded" : "eligible", exclusion, 0, null, null, Number(thread?.replied || 0), now, now));
  }
  await queue.prepare("INSERT INTO followup_sequences (id,campaign_id,campaign_name,name,status,mode,exclude_replied,total_recipients,eligible_recipients,excluded_recipients,sent_count,failed_count,cancel_requested,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(sequenceId, input.campaignId, campaign.name, input.name, "draft", "reply_thread", input.excludeReplied ? 1 : 0, rows.length, eligible, excluded, 0, 0, 0, input.actor, now, now).run();
  const stageStatements = input.stages.map((stage, index) => queue.prepare("INSERT INTO followup_stages (id,sequence_id,position,subject,html_template,delay_minutes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)").bind(randomUUID(), sequenceId, index + 1, stage.subject.trim(), stage.html, Math.max(0, Number(stage.delayMinutes || 0)), now, now));
  await queue.batch([...stageStatements, ...recipientStatements]);
  return { sequenceId, total: rows.length, eligible, excluded };
}

export async function syncCampaignThreads(campaignId: string, limit = 25) {
  await ensureFollowupSchema();
  const { rows } = await campaignAudience(campaignId);
  const saved = await getQueueDb().prepare("SELECT recipient_email FROM zoho_thread_messages WHERE campaign_id=?").bind(campaignId).all<{ recipient_email: string }>();
  const seen = new Set(saved.results.map((item) => item.recipient_email));
  const pending = rows
    .filter((item) => item.contact?.email && !seen.has(String(item.contact.email).toLowerCase()))
    .slice(0, Math.max(1, Math.min(50, limit)));
  let matched = 0;
  for (const row of pending) {
    const recipientEmail = String(row.contact.email).toLowerCase();
    const match = await findZohoThreadAnchor({ recipientEmail, subject: row.subject });
    if (!match) continue;
    await saveZohoThread({ campaignId, generatedEmailId: row.id, recipientEmail, subject: row.subject, messageId: match.messageId, threadId: match.threadId, direction: match.replied ? "inbound" : "outbound", replied: match.replied, sentAt: match.sentAt || match.receivedAt });
    matched += 1;
  }
  return { checked: pending.length, matched, remaining: Math.max(0, rows.length - seen.size - pending.length) };
}

export async function listFollowups(campaignId?: string) {
  await ensureFollowupSchema();
  const queue = getQueueDb();
  const sequences = await queue.prepare(`SELECT * FROM followup_sequences ${campaignId ? "WHERE campaign_id=?" : ""} ORDER BY created_at DESC`).bind(...(campaignId ? [campaignId] : [])).all<Record<string, any>>();
  const result = [];
  for (const sequence of sequences.results) {
    const [stages, recipients, events] = await Promise.all([
      queue.prepare("SELECT * FROM followup_stages WHERE sequence_id=? ORDER BY position").bind(sequence.id).all<Record<string, any>>(),
      queue.prepare("SELECT * FROM followup_recipients WHERE sequence_id=? ORDER BY created_at").bind(sequence.id).all<Record<string, any>>(),
      queue.prepare("SELECT * FROM followup_events WHERE sequence_id=? ORDER BY created_at DESC LIMIT 100").bind(sequence.id).all<Record<string, any>>(),
    ]);
    result.push({ ...sequence, stages: stages.results, recipients: recipients.results, events: events.results });
  }
  return result;
}

export async function approveFollowup(sequenceId: string, scheduledFor?: string | null) {
  await ensureFollowupSchema();
  const now = new Date().toISOString();
  const scheduledDate = scheduledFor ? new Date(scheduledFor) : null;
  if (scheduledDate && Number.isNaN(scheduledDate.getTime())) throw new Error("Choose a valid follow-up date and time.");
  const runAt = scheduledDate && scheduledDate > new Date() ? scheduledDate.toISOString() : now;
  const queue = getQueueDb();
  await queue.batch([
    queue.prepare("UPDATE followup_sequences SET status=?,scheduled_for=?,approved_at=?,cancel_requested=0,updated_at=? WHERE id=? AND status IN ('draft','stopped')").bind(runAt === now ? "running" : "scheduled", runAt, now, now, sequenceId),
    queue.prepare("UPDATE followup_recipients SET status='queued',next_run_at=?,last_error=NULL,updated_at=? WHERE sequence_id=? AND status IN ('eligible','stopped')").bind(runAt, now, sequenceId),
  ]);
}

export async function stopFollowup(sequenceId: string) {
  await ensureFollowupSchema();
  const now = new Date().toISOString();
  await getQueueDb().batch([
    getQueueDb().prepare("UPDATE followup_sequences SET status='stopped',cancel_requested=1,updated_at=? WHERE id=? AND status IN ('scheduled','running')").bind(now, sequenceId),
    getQueueDb().prepare("UPDATE followup_recipients SET status='stopped',next_run_at=NULL,updated_at=? WHERE sequence_id=? AND status IN ('queued','sending')").bind(now, sequenceId),
  ]);
}

function wrapHtml(html: string) { return `<div style="font-family:Calibri,Arial,sans-serif;font-size:11pt;line-height:1.5">${html}</div>`; }

function escapeQuoteText(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function quotedSenderName(email: string) {
  const local = email.split("@")[0] || email;
  return local.split(/[._-]+/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ") || email;
}

function safeQuotedHtml(value: string) {
  return String(value || "")
    .replace(/<\/?(?:html|head|body)[^>]*>/gi, "")
    .replace(/<(?:script|style|iframe|object|embed|form|link|meta)[\s\S]*?>[\s\S]*?<\/(?:script|style|iframe|object|embed|form)>/gi, "")
    .replace(/<(?:script|style|iframe|object|embed|form|link|meta|img)\b[^>]*\/?\s*>/gi, "")
    .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(?:href|src)\s*=\s*(["'])\s*javascript:[\s\S]*?\1/gi, 'href="#"');
}

function quotedTrail(input: { html: string; fromAddress: string; date?: string | null }) {
  const date = input.date ? new Date(input.date) : new Date();
  const readableDate = new Intl.DateTimeFormat("en-US", {
    weekday: "short", year: "numeric", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata",
  }).format(Number.isNaN(date.getTime()) ? new Date() : date);
  const email = input.fromAddress.trim().toLowerCase();
  const sender = quotedSenderName(email);
  return `<div class="ikf-quoted-reply" style="margin-top:24px;color:#222"><div style="margin-bottom:8px">On ${escapeQuoteText(readableDate)}, ${escapeQuoteText(sender)} &lt;<a href="mailto:${escapeQuoteText(email)}">${escapeQuoteText(email)}</a>&gt; wrote:</div><blockquote style="margin:0 0 0 4px;padding-left:12px;border-left:1px solid #b8b8b8">${safeQuotedHtml(input.html)}</blockquote></div>`;
}

export async function processDueFollowups(limit = 10) {
  await ensureFollowupSchema();
  const queue = getQueueDb();
  const now = new Date().toISOString();
  const stale = new Date(Date.now() - 10 * 60_000).toISOString();
  await queue.prepare("UPDATE followup_recipients SET status='queued',last_error='Recovered after an interrupted worker attempt.',updated_at=? WHERE status='sending' AND updated_at<?").bind(now, stale).run();
  const due = await queue.prepare("SELECT r.*,s.campaign_id,s.exclude_replied,s.cancel_requested FROM followup_recipients r JOIN followup_sequences s ON s.id=r.sequence_id WHERE r.status='queued' AND r.next_run_at<=? AND s.status IN ('scheduled','running') AND s.cancel_requested=0 ORDER BY r.next_run_at LIMIT ?").bind(now, Math.max(1, Math.min(50, limit))).all<Record<string, any>>();
  let sent = 0;
  let failed = 0;
  for (const recipient of due.results) {
    const claim = await queue.prepare("UPDATE followup_recipients SET status='sending',updated_at=? WHERE id=? AND status='queued'").bind(now, recipient.id).run() as unknown as { meta?: { changes?: number } };
    if (!Number(claim.meta?.changes || 0)) continue;
    const suppression = await queue.prepare("SELECT source_event FROM email_suppressions WHERE normalized_email=? AND active=1 LIMIT 1").bind(recipient.recipient_email).first<{ source_event: string }>();
    if (suppression || (recipient.exclude_replied && recipient.replied)) {
      await queue.prepare("UPDATE followup_recipients SET status='excluded',exclusion_reason=?,next_run_at=NULL,updated_at=? WHERE id=?").bind(suppression?.source_event || "already_replied", now, recipient.id).run();
      continue;
    }
    const latestThread = await findZohoThreadAnchor({ recipientEmail: recipient.recipient_email, subject: recipient.original_subject });
    if (latestThread) {
      recipient.zoho_message_id = latestThread.messageId;
      await saveZohoThread({ campaignId: recipient.campaign_id, generatedEmailId: recipient.generated_email_id, recipientEmail: recipient.recipient_email, subject: recipient.original_subject, messageId: latestThread.messageId, threadId: latestThread.threadId, direction: latestThread.replied ? "inbound" : "outbound", replied: latestThread.replied, sentAt: latestThread.receivedAt || latestThread.sentAt });
      if (recipient.exclude_replied && latestThread.replied) {
        await queue.batch([
          queue.prepare("UPDATE followup_recipients SET status='replied',replied=1,exclusion_reason='already_replied',next_run_at=NULL,zoho_message_id=?,updated_at=? WHERE id=?").bind(latestThread.messageId, now, recipient.id),
          queue.prepare("INSERT INTO followup_events (id,sequence_id,recipient_id,stage_position,event,detail,message_id,created_at) VALUES (?,?,?,?,?,?,?,?)").bind(randomUUID(), recipient.sequence_id, recipient.id, Number(recipient.current_stage || 0), "reply_detected", "Recipient reply detected in Zoho; remaining drip stages were stopped.", latestThread.messageId, now),
        ]);
        continue;
      }
    }
    const nextPosition = Number(recipient.current_stage || 0) + 1;
    const stage = await queue.prepare("SELECT * FROM followup_stages WHERE sequence_id=? AND position=?").bind(recipient.sequence_id, nextPosition).first<Record<string, any>>();
    if (!stage || !recipient.zoho_message_id) {
      await queue.prepare("UPDATE followup_recipients SET status='failed',last_error=?,next_run_at=NULL,updated_at=? WHERE id=?").bind(!stage ? "Follow-up stage is missing." : "Original Zoho message ID is missing.", now, recipient.id).run();
      failed += 1;
      continue;
    }
    const values = { name: recipient.contact_name || "Sir/Madam", company: recipient.company_name || "", topic: "", research: "", focus_areas: "" };
    try {
      const quotedContent = latestThread?.folderId
        ? await getZohoMessageContent({ messageId: latestThread.messageId, folderId: latestThread.folderId })
        : "";
      if (!quotedContent) throw new Error("The latest Zoho message content is unavailable, so Spark did not send an incomplete thread reply.");
      const replyBody = replacePersonalizationPlaceholders(stage.html_template, values)
        + quotedTrail({ html: quotedContent, fromAddress: latestThread.fromAddress, date: latestThread.receivedAt || latestThread.sentAt });
      const result = await replyZohoMessage({ messageId: recipient.zoho_message_id, toAddress: recipient.recipient_email, subject: recipient.original_subject, html: wrapHtml(replyBody) });
      const nextStage = await queue.prepare("SELECT delay_minutes FROM followup_stages WHERE sequence_id=? AND position=?").bind(recipient.sequence_id, nextPosition + 1).first<{ delay_minutes: number }>();
      const nextRun = nextStage ? new Date(Date.now() + Math.max(1, Number(nextStage.delay_minutes || 0)) * 60_000).toISOString() : null;
      await queue.batch([
        queue.prepare("UPDATE followup_recipients SET status=?,current_stage=?,next_run_at=?,zoho_message_id=COALESCE(?,zoho_message_id),last_error=NULL,updated_at=? WHERE id=?").bind(nextStage ? "queued" : "completed", nextPosition, nextRun, result.messageId, new Date().toISOString(), recipient.id),
        queue.prepare("INSERT INTO followup_events (id,sequence_id,recipient_id,stage_position,event,detail,message_id,created_at) VALUES (?,?,?,?,?,?,?,?)").bind(randomUUID(), recipient.sequence_id, recipient.id, nextPosition, "sent", "Zoho threaded reply accepted.", result.messageId || recipient.zoho_message_id, new Date().toISOString()),
      ]);
      if (result.messageId) await saveZohoThread({ campaignId: recipient.campaign_id, generatedEmailId: recipient.generated_email_id, recipientEmail: recipient.recipient_email, subject: recipient.original_subject, messageId: result.messageId, direction: "outbound", replied: false, sentAt: new Date().toISOString() });
      sent += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Zoho send failed.";
      await queue.batch([
        queue.prepare("UPDATE followup_recipients SET status='failed',last_error=?,next_run_at=NULL,updated_at=? WHERE id=?").bind(message, new Date().toISOString(), recipient.id),
        queue.prepare("INSERT INTO followup_events (id,sequence_id,recipient_id,stage_position,event,detail,created_at) VALUES (?,?,?,?,?,?,?)").bind(randomUUID(), recipient.sequence_id, recipient.id, nextPosition, "failed", message, new Date().toISOString()),
      ]);
      failed += 1;
    }
  }
  const sequenceIds = [...new Set(due.results.map((item) => String(item.sequence_id)))];
  for (const sequenceId of sequenceIds) {
    const counts = await queue.prepare("SELECT SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) completed,SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) failed,SUM(CASE WHEN status IN ('queued','sending') THEN 1 ELSE 0 END) pending FROM followup_recipients WHERE sequence_id=?").bind(sequenceId).first<{ completed: number; failed: number; pending: number }>();
    await queue.prepare("UPDATE followup_sequences SET status=?,sent_count=?,failed_count=?,started_at=COALESCE(started_at,?),completed_at=?,updated_at=? WHERE id=?").bind(Number(counts?.pending || 0) ? "running" : Number(counts?.failed || 0) ? "completed_with_issues" : "completed", Number(counts?.completed || 0), Number(counts?.failed || 0), now, Number(counts?.pending || 0) ? null : new Date().toISOString(), new Date().toISOString(), sequenceId).run();
  }
  const remaining = await queue.prepare("SELECT COUNT(*) count FROM followup_recipients r JOIN followup_sequences s ON s.id=r.sequence_id WHERE r.status='queued' AND r.next_run_at<=? AND s.status IN ('scheduled','running') AND s.cancel_requested=0").bind(new Date().toISOString()).first<{ count: number }>();
  return { sent, failed, remaining: Number(remaining?.count || 0) };
}

export async function dueFollowupIds() {
  await ensureFollowupSchema();
  const rows = await getQueueDb().prepare("SELECT DISTINCT s.id FROM followup_sequences s JOIN followup_recipients r ON r.sequence_id=s.id WHERE s.status IN ('scheduled','running') AND s.cancel_requested=0 AND r.status='queued' AND r.next_run_at<=?").bind(new Date().toISOString()).all<{ id: string }>();
  return rows.results.map((row) => row.id);
}
