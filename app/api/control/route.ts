import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const supabaseUrl = () => process.env.SUPABASE_URL || "";
const supabaseKey = () => process.env.SUPABASE_SECRET_KEY || "";
const sender = { name: process.env.BREVO_SENDER_NAME || "Tanishka", email: process.env.BREVO_SENDER_EMAIL || "tanishka@iknowai.in" };
const replyTo = () => process.env.BREVO_REPLY_TO_EMAIL || "tanishka@iknowai.in";
const allowedOperators = new Set(["gpt@ikf.co.in", "social@ikf.co.in"]);

function actor(req: NextRequest) {
  return req.headers.get("oai-authenticated-user-email")?.trim().toLowerCase() || "";
}

function canManage(req: NextRequest) {
  return allowedOperators.has(actor(req));
}

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

const generic = new Set(["admin", "contact", "info", "sales", "office", "support", "team", "hello", "marketing", "secretary", "president", "communications"]);
function greetingName(email: string, supplied?: string) {
  if (supplied?.trim()) return supplied.trim();
  const parts = email.split("@")[0].toLowerCase().split(/[._-]+/).filter(Boolean);
  return parts.length >= 2 && parts.length <= 4 && parts.every((part) => /^[a-z]{2,20}$/.test(part) && !generic.has(part))
    ? parts.map((part) => part[0].toUpperCase() + part.slice(1)).join(" ")
    : "Sir/Madam";
}

function draftHtml(input: { email: string; name?: string; company: string; brief?: string }) {
  const name = greetingName(input.email, input.name);
  const context = input.brief?.trim() || `${input.company}'s priorities, operations, and growth plans`;
  return `<div style="font-family:Calibri,Arial,sans-serif;font-size:11pt;line-height:1.5"><p>Dear ${name},</p><p>Considering <strong><u>${input.company}</u></strong> and its focus on ${context}, there is a strong opportunity to use AI for practical productivity, knowledge sharing, stakeholder engagement, and leadership decision-making.</p><p>We are conducting a practical <strong>AI Leadership Masterclass</strong>. The session can be tailored around:</p><ul><li><strong>AI-enabled research and reporting</strong></li><li><strong>Workflow automation and operational productivity</strong></li><li><strong>Sales, marketing, and stakeholder engagement</strong></li><li><strong>Knowledge management and decision support</strong></li><li><strong>Responsible AI adoption frameworks</strong></li></ul><p>The objective is to identify immediate opportunities while building a structured roadmap for AI adoption.</p><p>Alternatively, you are welcome to join our <strong>AI Native Thinkers Community</strong>:<br><strong><a href="https://chat.whatsapp.com/DrVSACvnPE4KLt0tWbn26r">Join the WhatsApp community</a></strong></p><p><strong>Please let me know a suitable time to connect.</strong></p><p>Regards,<br><strong>Tanishka</strong><br>I Knowledge Factory Pvt. Ltd.<br><a href="tel:+919503939911">+91 95039 39911</a><br><a href="https://www.ikf.co.in/">www.ikf.co.in</a></p></div>`;
}

export async function GET(req: NextRequest) {
  try {
    const [queue, jobs, settings, campaigns, emails, contacts, companies] = await Promise.all([
      db("outreach_queue?select=*&order=created_at.desc&limit=100"),
      db("research_jobs?select=*&order=created_at.desc&limit=25"),
      db("outreach_settings?select=*&key=eq.sending_policy"),
      db("campaigns?select=id,name,status,sender_name,sender_email&order=created_at.desc"),
      db("generated_emails?select=id,contact_id,company_id,campaign_id,subject,html_body,status,version,generated_at&order=generated_at.desc&limit=1000"),
      db("contacts?select=id,email,full_name&limit=1000"),
      db("companies?select=id,name&limit=1000"),
    ]);
    const contactById = new Map(contacts.map((item: Record<string, any>) => [item.id, item]));
    const companyById = new Map(companies.map((item: Record<string, any>) => [item.id, item]));
    const campaignById = new Map(campaigns.map((item: Record<string, any>) => [item.id, item]));
    const liveEmails = emails.map((item: Record<string, any>) => {
      const contact = contactById.get(item.contact_id) || {};
      const company = companyById.get(item.company_id) || {};
      const campaign = campaignById.get(item.campaign_id) || {};
      return {
        id: item.id,
        recipient: contact.email || "",
        recipientName: contact.full_name || "",
        company: company.name || "Unknown organization",
        campaign: campaign.name || "Outreach",
        subject: item.subject,
        html: item.html_body,
        status: item.status,
        version: item.version,
        generatedAt: item.generated_at,
      };
    });
    let brevo = false;
    try {
      const check = await fetch("https://api.brevo.com/v3/account", { headers: { "api-key": process.env.BREVO_API_KEY || "" } });
      brevo = check.ok;
    } catch {}
    return NextResponse.json({
      ok: true,
      canManage: canManage(req),
      operator: actor(req) || null,
      providers: { database: true, brevo },
      queue,
      jobs,
      settings: settings[0]?.value || {},
      campaigns,
      liveEmails,
      sender,
      replyTo: replyTo(),
      scheduling: { provider: "Brevo", timezone: "Asia/Kolkata", maximumHoursAhead: 72 },
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Unable to load controls" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!canManage(req)) {
      return NextResponse.json(
        { ok: false, error: "Sign in with an authorized IKF account to manage or send emails." },
        { status: 403 },
      );
    }
    const body = await req.json();
    const user = actor(req);

    if (body.action === "create_draft") {
      const email = String(body.email || "").trim().toLowerCase();
      const companyName = String(body.company || "").trim();
      if (!/^\S+@\S+\.\S+$/.test(email) || !companyName) return NextResponse.json({ ok: false, error: "A valid email and company are required." }, { status: 400 });
      const domain = email.split("@")[1];
      let companies = await db(`companies?select=*&normalized_domain=eq.${encodeURIComponent(domain)}&limit=1`);
      if (!companies.length) companies = await db("companies", { method: "POST", body: JSON.stringify({ name: companyName, normalized_name: companyName.toLowerCase(), normalized_domain: domain, website: body.website || `https://${domain}`, research_data: { brief: body.brief || "", requested_by: user } }) });
      const company = companies[0];
      let contacts = await db(`contacts?select=*&normalized_email=eq.${encodeURIComponent(email)}&limit=1`);
      if (!contacts.length) contacts = await db("contacts", { method: "POST", body: JSON.stringify({ company_id: company.id, full_name: body.name || null, email, normalized_email: email, data_confidence: "user_provided", source: "dashboard" }) });
      const contact = contacts[0];
      const campaigns = await db("campaigns?select=*&name=eq.AI%20Leadership%20Masterclass%20Outreach&limit=1");
      const campaign = campaigns[0];
      const existing = await db(`generated_emails?select=version&contact_id=eq.${contact.id}&campaign_id=eq.${campaign.id}&order=version.desc&limit=1`);
      const html = draftHtml({ email, name: body.name, company: companyName, brief: body.brief });
      const drafts = await db("generated_emails", { method: "POST", body: JSON.stringify({ company_id: company.id, contact_id: contact.id, campaign_id: campaign.id, version: (existing[0]?.version || 0) + 1, subject: `${companyName} - AI Native Thinking Masterclass`, html_body: html, status: "draft_pending_review", personalization_data: { greeting_name: greetingName(email, body.name), sender_name: sender.name, sender_email: sender.email, reply_to_email: replyTo(), email_font: "Calibri", email_font_size: "11pt", bold_underline_organization: true, sending_hold: true } }) });
      await db("research_jobs", { method: "POST", body: JSON.stringify({ id: crypto.randomUUID(), email, company: companyName, website: body.website || null, brief: body.brief || null, status: "draft_created", created_by: user, result: { generated_email_id: drafts[0].id } }) });
      return NextResponse.json({ ok: true, draft: drafts[0] });
    }

    if (body.action === "approve") {
      const rows = await db(`generated_emails?id=eq.${body.emailId}`, { method: "PATCH", body: JSON.stringify({ status: "approved" }) });
      return NextResponse.json({ ok: true, email: rows[0] });
    }

    if (body.action === "approve_batch") {
      const ids = cleanIds(body.emailIds);
      if (!ids.length) return NextResponse.json({ ok: false, error: "Select at least one email." }, { status: 400 });
      await db(`generated_emails?id=in.(${ids.join(",")})`, { method: "PATCH", body: JSON.stringify({ status: "approved" }) });
      return NextResponse.json({ ok: true, count: ids.length });
    }

    if (body.action === "schedule") {
      if (!body.scheduledFor) return NextResponse.json({ ok: false, error: "Choose a schedule time." }, { status: 400 });
      const scheduledAt = new Date(String(body.scheduledFor));
      const now = Date.now();
      if (!Number.isFinite(scheduledAt.getTime()) || scheduledAt.getTime() < now + 2 * 60_000 || scheduledAt.getTime() > now + 72 * 60 * 60_000) {
        return NextResponse.json({ ok: false, error: "Choose a time between 2 minutes and 72 hours from now." }, { status: 400 });
      }
      const settingsRows = await db("outreach_settings?select=*&key=eq.sending_policy");
      if (settingsRows[0]?.value?.paused) return NextResponse.json({ ok: false, error: "Sending is paused. Turn off “Pause all” first." }, { status: 409 });
      const mails = await db(`generated_emails?select=*&id=eq.${body.emailId}&limit=1`);
      const mail = mails[0];
      if (!mail) return NextResponse.json({ ok: false, error: "Email draft not found." }, { status: 404 });
      const contacts = await db(`contacts?select=*&id=eq.${mail.contact_id}&limit=1`);
      const contact = contacts[0];
      const result = await submitBrevo(mail, contact, scheduledAt.toISOString());
      const rows = await db("outreach_queue", { method: "POST", body: JSON.stringify({ id: crypto.randomUUID(), generated_email_id: mail.id, contact_id: mail.contact_id, campaign_id: mail.campaign_id, status: "scheduled_with_brevo", scheduled_for: scheduledAt.toISOString(), approved_by: user, approved_at: new Date().toISOString() }) });
      await db("email_sends", { method: "POST", body: JSON.stringify({ id: crypto.randomUUID(), generated_email_id: mail.id, company_id: mail.company_id, contact_id: mail.contact_id, campaign_id: mail.campaign_id, sender_name: sender.name, sender_email: sender.email, recipient_email: contact.email, subject: mail.subject, brevo_message_id: result.messageId, status: `scheduled:${scheduledAt.toISOString()}` }) });
      await db(`generated_emails?id=eq.${mail.id}`, { method: "PATCH", body: JSON.stringify({ status: "scheduled" }) });
      return NextResponse.json({ ok: true, queue: rows[0], messageId: result.messageId });
    }

    if (body.action === "schedule_batch") {
      const ids = cleanIds(body.emailIds);
      if (!ids.length) return NextResponse.json({ ok: false, error: "Select at least one email." }, { status: 400 });
      if (ids.length > 50) return NextResponse.json({ ok: false, error: "Schedule up to 50 emails at a time." }, { status: 400 });
      if (body.confirm !== true) return NextResponse.json({ ok: false, error: "Review confirmation is required." }, { status: 400 });

      const start = new Date(String(body.scheduledFor || ""));
      const now = Date.now();
      if (!Number.isFinite(start.getTime()) || start.getTime() < now + 2 * 60_000) {
        return NextResponse.json({ ok: false, error: "Choose a time at least 2 minutes from now." }, { status: 400 });
      }
      if (start.getTime() > now + 72 * 60 * 60_000) {
        return NextResponse.json({ ok: false, error: "Brevo accepts scheduled transactional emails up to 72 hours ahead." }, { status: 400 });
      }

      const settingsRows = await db("outreach_settings?select=*&key=eq.sending_policy");
      const policy = settingsRows[0]?.value || {};
      if (policy.paused) {
        return NextResponse.json({ ok: false, error: "Sending is paused. Turn off “Pause all” in Controls & APIs before scheduling." }, { status: 409 });
      }
      const dailyLimit = Math.max(1, Number(policy.daily_limit || 25));
      if (ids.length > dailyLimit) {
        return NextResponse.json({ ok: false, error: `Your safety limit is ${dailyLimit} emails per batch. Select fewer emails or update the limit.` }, { status: 400 });
      }
      const delayMinutes = Math.max(1, Math.min(60, Number(body.delayMinutes || policy.minimum_delay_minutes || 5)));
      const finalTime = new Date(start.getTime() + (ids.length - 1) * delayMinutes * 60_000);
      const windowStart = String(policy.sending_window_start || "10:00");
      const windowEnd = String(policy.sending_window_end || "17:00");
      if (!insideIndiaWindow(start, windowStart, windowEnd) || !insideIndiaWindow(finalTime, windowStart, windowEnd)) {
        return NextResponse.json({ ok: false, error: `Keep the full batch inside the ${windowStart}–${windowEnd} Asia/Kolkata sending window.` }, { status: 400 });
      }
      const mails = await db(`generated_emails?select=*&id=in.(${ids.join(",")})`);
      const contactIds = [...new Set(mails.map((mail: Record<string, any>) => mail.contact_id).filter(Boolean))];
      const contacts = contactIds.length ? await db(`contacts?select=*&id=in.(${contactIds.join(",")})`) : [];
      const contactById = new Map(contacts.map((item: Record<string, any>) => [item.id, item]));
      const scheduled: Array<Record<string, any>> = [];

      for (let index = 0; index < mails.length; index += 1) {
        const mail = mails[index];
        const contact = contactById.get(mail.contact_id);
        if (!contact?.email) continue;
        const scheduledAt = new Date(start.getTime() + index * delayMinutes * 60_000).toISOString();
        if (new Date(scheduledAt).getTime() > now + 72 * 60 * 60_000) {
          throw new Error("The spacing pushes part of this batch beyond Brevo’s 72-hour scheduling limit.");
        }
        const result = await submitBrevo(mail, contact, scheduledAt);
        const queueId = crypto.randomUUID();
        await db("outreach_queue", {
          method: "POST",
          body: JSON.stringify({
            id: queueId,
            generated_email_id: mail.id,
            contact_id: mail.contact_id,
            campaign_id: mail.campaign_id,
            status: "scheduled_with_brevo",
            scheduled_for: scheduledAt,
            approved_by: user,
            approved_at: new Date().toISOString(),
          }),
        });
        await db("email_sends", {
          method: "POST",
          body: JSON.stringify({
            id: crypto.randomUUID(),
            generated_email_id: mail.id,
            company_id: mail.company_id,
            contact_id: mail.contact_id,
            campaign_id: mail.campaign_id,
            sender_name: sender.name,
            sender_email: sender.email,
            recipient_email: contact.email,
            subject: mail.subject,
            brevo_message_id: result.messageId,
            status: `scheduled:${scheduledAt}`,
          }),
        });
        await db(`generated_emails?id=eq.${mail.id}`, { method: "PATCH", body: JSON.stringify({ status: "scheduled" }) });
        scheduled.push({ id: mail.id, messageId: result.messageId, scheduledAt });
      }
      return NextResponse.json({ ok: true, count: scheduled.length, scheduled });
    }

    if (body.action === "send_now") {
      if (body.confirm !== true) return NextResponse.json({ ok: false, error: "Explicit confirmation is required." }, { status: 400 });
      const mails = await db(`generated_emails?select=*&id=eq.${body.emailId}&limit=1`);
      const mail = mails[0];
      const contacts = await db(`contacts?select=*&id=eq.${mail.contact_id}&limit=1`);
      const contact = contacts[0];
      const result = await submitBrevo(mail, contact);
      await db("email_sends", { method: "POST", body: JSON.stringify({ id: crypto.randomUUID(), generated_email_id: mail.id, company_id: mail.company_id, contact_id: mail.contact_id, campaign_id: mail.campaign_id, sender_name: sender.name, sender_email: sender.email, recipient_email: contact.email, subject: mail.subject, brevo_message_id: result.messageId, status: "sent", sent_at: new Date().toISOString() }) });
      await db(`generated_emails?id=eq.${mail.id}`, { method: "PATCH", body: JSON.stringify({ status: "sent" }) });
      return NextResponse.json({ ok: true, messageId: result.messageId });
    }

    if (body.action === "send_test") {
      const ids = cleanIds(body.emailIds);
      const testRecipients = cleanEmails(body.testRecipients);
      if (!ids.length) return NextResponse.json({ ok: false, error: "Select at least one generated email." }, { status: 400 });
      if (ids.length > 5) return NextResponse.json({ ok: false, error: "Select up to 5 generated emails for one test." }, { status: 400 });
      if (!testRecipients.length) return NextResponse.json({ ok: false, error: "Enter at least one valid test email address." }, { status: 400 });
      if (testRecipients.length > 5) return NextResponse.json({ ok: false, error: "Use up to 5 test inboxes at a time." }, { status: 400 });
      if (ids.length * testRecipients.length > 15) return NextResponse.json({ ok: false, error: "A test can create up to 15 preview messages. Reduce the selected emails or inboxes." }, { status: 400 });
      if (body.confirm !== true) return NextResponse.json({ ok: false, error: "Confirm that these are test inboxes." }, { status: 400 });

      const mails = await db(`generated_emails?select=*&id=in.(${ids.join(",")})`);
      const contactIds = [...new Set(mails.map((mail: Record<string, any>) => mail.contact_id).filter(Boolean))];
      const contacts = contactIds.length ? await db(`contacts?select=*&id=in.(${contactIds.join(",")})`) : [];
      const contactById = new Map(contacts.map((item: Record<string, any>) => [item.id, item]));
      const sent: Array<Record<string, string>> = [];

      for (const mail of mails) {
        const originalContact = contactById.get(mail.contact_id) || {};
        for (const testRecipient of testRecipients) {
          const result = await submitTestBrevo(mail, testRecipient, originalContact.email || "unknown");
          await db("activity_log", {
            method: "POST",
            body: JSON.stringify({
              company_id: mail.company_id,
              contact_id: mail.contact_id,
              action: "test_email_sent",
              details: {
                generated_email_id: mail.id,
                test_recipient: testRecipient,
                original_recipient: originalContact.email || null,
                brevo_message_id: result.messageId,
                sent_by: user,
                original_status_unchanged: true,
              },
            }),
          });
          sent.push({ generatedEmailId: mail.id, testRecipient, messageId: result.messageId });
        }
      }
      return NextResponse.json({ ok: true, count: sent.length, sent });
    }

    if (body.action === "send_batch") {
      const ids = cleanIds(body.emailIds);
      if (!ids.length) return NextResponse.json({ ok: false, error: "Select at least one email." }, { status: 400 });
      if (ids.length > 25) return NextResponse.json({ ok: false, error: "Send up to 25 emails at a time." }, { status: 400 });
      if (body.confirmText !== "SEND") return NextResponse.json({ ok: false, error: "Type SEND to confirm this action." }, { status: 400 });
      const settingsRows = await db("outreach_settings?select=*&key=eq.sending_policy");
      if (settingsRows[0]?.value?.paused) {
        return NextResponse.json({ ok: false, error: "Sending is paused. Turn off “Pause all” first." }, { status: 409 });
      }
      const mails = await db(`generated_emails?select=*&id=in.(${ids.join(",")})`);
      const contactIds = [...new Set(mails.map((mail: Record<string, any>) => mail.contact_id).filter(Boolean))];
      const contacts = contactIds.length ? await db(`contacts?select=*&id=in.(${contactIds.join(",")})`) : [];
      const contactById = new Map(contacts.map((item: Record<string, any>) => [item.id, item]));
      const sent: string[] = [];
      for (const mail of mails) {
        const contact = contactById.get(mail.contact_id);
        if (!contact?.email) continue;
        const result = await submitBrevo(mail, contact);
        await db("email_sends", { method: "POST", body: JSON.stringify({ id: crypto.randomUUID(), generated_email_id: mail.id, company_id: mail.company_id, contact_id: mail.contact_id, campaign_id: mail.campaign_id, sender_name: sender.name, sender_email: sender.email, recipient_email: contact.email, subject: mail.subject, brevo_message_id: result.messageId, status: "sent", sent_at: new Date().toISOString() }) });
        await db(`generated_emails?id=eq.${mail.id}`, { method: "PATCH", body: JSON.stringify({ status: "sent" }) });
        sent.push(mail.id);
      }
      return NextResponse.json({ ok: true, count: sent.length });
    }

    if (body.action === "cancel_scheduled") {
      const queueId = String(body.queueId || "");
      const rows = await db(`outreach_queue?select=*&id=eq.${encodeURIComponent(queueId)}&limit=1`);
      const item = rows[0];
      const sends = await db(`email_sends?select=*&generated_email_id=eq.${item.generated_email_id}&status=like.scheduled*&order=created_at.desc&limit=1`);
      const messageId = sends[0]?.brevo_message_id;
      if (!messageId) return NextResponse.json({ ok: false, error: "This scheduled item has no Brevo message ID." }, { status: 400 });
      const response = await fetch(`https://api.brevo.com/v3/smtp/email/${encodeURIComponent(messageId)}`, { method: "DELETE", headers: { "api-key": process.env.BREVO_API_KEY || "" } });
      if (!response.ok && response.status !== 404) throw new Error("Brevo could not cancel this scheduled email.");
      await db(`outreach_queue?id=eq.${encodeURIComponent(queueId)}`, { method: "PATCH", body: JSON.stringify({ status: "cancelled" }) });
      await db(`email_sends?id=eq.${sends[0].id}`, { method: "PATCH", body: JSON.stringify({ status: "cancelled" }) });
      await db(`generated_emails?id=eq.${item.generated_email_id}`, { method: "PATCH", body: JSON.stringify({ status: "approved" }) });
      return NextResponse.json({ ok: true });
    }

    if (body.action === "policy") {
      const value = { mode: "manual_approval", daily_limit: Number(body.dailyLimit || 25), sending_window_start: body.windowStart || "10:00", sending_window_end: body.windowEnd || "17:00", timezone: "Asia/Kolkata", minimum_delay_minutes: Number(body.delay || 5), paused: Boolean(body.paused) };
      await db("outreach_settings?key=eq.sending_policy", { method: "PATCH", body: JSON.stringify({ value, updated_by: user, updated_at: new Date().toISOString() }) });
      return NextResponse.json({ ok: true, settings: value });
    }

    return NextResponse.json({ ok: false, error: "Unknown action." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Action failed" }, { status: 500 });
  }
}

function cleanIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(String).filter((id) => /^[0-9a-f-]{36}$/i.test(id)))];
}

function cleanEmails(value: unknown): string[] {
  return [...new Set(String(value || "").split(/[\s,;]+/).map((email) => email.trim().toLowerCase()).filter((email) => /^\S+@\S+\.\S+$/.test(email)))];
}

function insideIndiaWindow(date: Date, start: string, end: string) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
  return parts >= start && parts <= end;
}

async function submitBrevo(mail: Record<string, any>, contact: Record<string, any>, scheduledAt?: string) {
  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": process.env.BREVO_API_KEY || "", "Content-Type": "application/json" },
    body: JSON.stringify({
      sender,
      replyTo: { email: replyTo() },
      to: [{ email: contact.email, name: contact.full_name || undefined }],
      subject: mail.subject,
      htmlContent: mail.html_body,
      ...(scheduledAt ? { scheduledAt } : {}),
      tags: ["ikf-outreach"],
    }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || "Brevo rejected the email request.");
  return result;
}

async function submitTestBrevo(mail: Record<string, any>, testRecipient: string, originalRecipient: string) {
  const previewBanner = `<div style="font-family:Calibri,Arial,sans-serif;font-size:11pt;line-height:1.45;margin:0 0 18px;padding:12px 14px;border:1px solid #a9dce9;border-radius:8px;background:#eefaff;color:#155d73"><strong>TEST PREVIEW</strong><br>This copy was sent to ${testRecipient} for review. The intended recipient is ${originalRecipient}. The original draft has not been marked as sent.</div>`;
  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": process.env.BREVO_API_KEY || "", "Content-Type": "application/json" },
    body: JSON.stringify({
      sender,
      replyTo: { email: replyTo() },
      to: [{ email: testRecipient, name: "IKF Test Recipient" }],
      subject: `[TEST PREVIEW] ${mail.subject}`,
      htmlContent: `${previewBanner}${mail.html_body}`,
      tags: ["ikf-outreach", "test-preview"],
    }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || "Brevo rejected the test email.");
  return result;
}
