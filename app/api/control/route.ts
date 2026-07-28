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

type WebsiteResearch = {
  website: string;
  companyName: string;
  title: string;
  description: string;
  summary: string;
  focusAreas: string[];
  discoveredEmails: string[];
  pagesReviewed: string[];
};

function draftHtml(input: { email: string; name?: string; company: string; brief?: string; topic?: string; research?: WebsiteResearch | null; template?: string }) {
  const name = greetingName(input.email, input.name);
  const researchedContext = input.research?.summary || input.research?.description || "";
  const context = input.brief?.trim() || researchedContext || `${input.company}'s priorities, operations, and growth plans`;
  const focusAreas = input.research?.focusAreas?.length ? input.research.focusAreas.slice(0, 3).join(", ") : "productivity, knowledge workflows, and stakeholder engagement";
  const topic = input.topic?.trim() || "AI Native Thinking Masterclass";
  const template = String(input.template || "").trim();
  const usesPersonalization = /\{\{\s*(name|company|topic|research|focus_areas)\s*\}\}/i.test(template);
  const defaultTemplate = `Dear {{name}},

While reviewing {{company}}, I noted its focus on {{research}}. This creates a relevant opportunity to apply {{topic}} thinking across {{focus_areas}}.

We would be delighted to conduct a practical {{topic}} session tailored to your leadership and functional teams.

Please let me know a suitable time to connect.`;
  const personalizedOpening = !usesPersonalization && template
    ? `Dear {{name}},\n\nWhile reviewing {{company}}, I noted its focus on {{research}}. This makes your message especially relevant to {{focus_areas}}.\n\n`
    : "";
  let body = renderEmailTemplate(`${personalizedOpening}${template || defaultTemplate}`, { name, company: input.company, topic, research: context, focusAreas });
  if (!/chat\.whatsapp\.com/i.test(body)) {
    body += `<p>Alternatively, you are welcome to join our <strong>AI Native Thinkers Community</strong>:<br><strong><a href="https://chat.whatsapp.com/DrVSACvnPE4KLt0tWbn26r">Join the WhatsApp community</a></strong></p>`;
  }
  if (!/I Knowledge Factory Pvt\. Ltd\./i.test(body)) {
    body += `<p>Regards,<br><strong>Tanishka</strong><br>I Knowledge Factory Pvt. Ltd.<br><a href="tel:+919503939911">+91 95039 39911</a><br><a href="https://www.ikf.co.in/">www.ikf.co.in</a></p>`;
  }
  return `<div style="font-family:Calibri,Arial,sans-serif;font-size:11pt;line-height:1.5">${body}</div>`;
}

export async function GET(req: NextRequest) {
  try {
    const [queue, jobs, settings, campaigns, emails, contacts, companies, sends, activityRows] = await Promise.all([
      db("outreach_queue?select=*&order=created_at.desc&limit=100"),
      db("research_jobs?select=*&order=created_at.desc&limit=25"),
      db("outreach_settings?select=*&key=eq.sending_policy"),
      db("campaigns?select=id,name,status,sender_name,sender_email&order=created_at.desc"),
      db("generated_emails?select=id,contact_id,company_id,campaign_id,subject,html_body,status,version,generated_at&order=generated_at.desc&limit=1000"),
      db("contacts?select=id,company_id,email,full_name,job_title,data_confidence,source,created_at&order=created_at.desc&limit=1000"),
      db("companies?select=id,name,website,normalized_domain,industry,country,research_data,updated_at&order=updated_at.desc&limit=1000"),
      db("email_sends?select=id,generated_email_id,status,sent_at,created_at&order=created_at.desc&limit=1000"),
      db("activity_log?select=id,company_id,contact_id,action,details,created_at&order=created_at.desc&limit=100"),
    ]);
    const contactById = new Map(contacts.map((item: Record<string, any>) => [item.id, item]));
    const companyById = new Map(companies.map((item: Record<string, any>) => [item.id, item]));
    const campaignById = new Map(campaigns.map((item: Record<string, any>) => [item.id, item]));
    const latestSendByEmailId = new Map<string, Record<string, any>>();
    for (const item of sends) {
      if (item.generated_email_id && !latestSendByEmailId.has(item.generated_email_id)) latestSendByEmailId.set(item.generated_email_id, item);
    }
    const liveEmails = emails.map((item: Record<string, any>) => {
      const contact = contactById.get(item.contact_id) || {};
      const company = companyById.get(item.company_id) || {};
      const campaign = campaignById.get(item.campaign_id) || {};
      const latestSend = latestSendByEmailId.get(item.id);
      return {
        id: item.id,
        recipient: contact.email || "",
        recipientName: contact.full_name || "",
        company: company.name || "Unknown organization",
        campaign: campaign.name || "Outreach",
        subject: item.subject,
        html: item.html_body,
        status: item.status,
        sendStatus: latestSend?.status || null,
        version: item.version,
        generatedAt: item.generated_at,
      };
    });
    const contactCountByCompany = new Map<string, number>();
    const draftCountByCompany = new Map<string, number>();
    for (const contact of contacts) {
      if (contact.company_id) contactCountByCompany.set(contact.company_id, (contactCountByCompany.get(contact.company_id) || 0) + 1);
    }
    for (const email of emails) {
      if (email.company_id) draftCountByCompany.set(email.company_id, (draftCountByCompany.get(email.company_id) || 0) + 1);
    }
    const liveContacts = contacts.map((item: Record<string, any>) => {
      const company = companyById.get(item.company_id) || {};
      return {
        id: item.id,
        name: item.full_name || null,
        email: item.email,
        role: item.job_title || null,
        confidence: item.data_confidence || item.source || "unverified",
        company: company.name || "Unknown organization",
        industry: company.industry || null,
        createdAt: item.created_at,
      };
    });
    const liveCompanies = companies.map((item: Record<string, any>) => ({
      id: item.id,
      name: item.name,
      website: item.website || (item.normalized_domain ? `https://${item.normalized_domain}` : ""),
      industry: item.industry || null,
      country: item.country || null,
      contacts: contactCountByCompany.get(item.id) || 0,
      drafts: draftCountByCompany.get(item.id) || 0,
      updatedAt: item.updated_at,
    }));
    const liveActivity = activityRows.map((item: Record<string, any>) => {
      const company = companyById.get(item.company_id) || {};
      const contact = contactById.get(item.contact_id) || {};
      return {
        id: item.id,
        action: item.action,
        company: company.name || item.details?.company || null,
        email: contact.email || item.details?.email || item.details?.test_recipient || null,
        createdAt: item.created_at,
      };
    });
    const liveStats = {
      companies: companies.length,
      contacts: contacts.length,
      emails: emails.length,
      pendingReview: emails.filter((item: Record<string, any>) => item.status === "draft_pending_review").length,
      approved: emails.filter((item: Record<string, any>) => item.status === "approved").length,
      scheduled: emails.filter((item: Record<string, any>) => item.status === "scheduled").length,
      sent: sends.filter((item: Record<string, any>) => item.status === "sent").length,
      failed: sends.filter((item: Record<string, any>) => /fail|not_sent/i.test(String(item.status || ""))).length,
    };
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
      liveContacts,
      liveCompanies,
      liveActivity,
      liveStats,
      sender,
      replyTo: replyTo(),
      refreshedAt: new Date().toISOString(),
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
      const result = await createDraftRecord({
        email: body.email,
        name: body.name,
        company: body.company,
        website: body.website,
        brief: body.brief,
        topic: body.topic,
        campaignName: body.campaignName,
        emailTemplate: body.emailTemplate,
        source: "single_form",
      }, user);
      return NextResponse.json({ ok: true, draft: result.draft, research: result.research });
    }

    if (body.action === "research_batch") {
      const topic = String(body.topic || "").trim();
      if (!topic) return NextResponse.json({ ok: false, error: "Add the outreach topic that every personalized email should cover." }, { status: 400 });
      const campaignName = cleanCampaignName(body.campaignName);
      if (!campaignName) return NextResponse.json({ ok: false, error: "Add a campaign name so this set of drafts stays organized." }, { status: 400 });
      const emailTemplate = String(body.emailTemplate || "").trim();
      if (!emailTemplate) return NextResponse.json({ ok: false, error: "Paste the email template to personalize for this campaign." }, { status: 400 });
      if (emailTemplate.length > 15_000) return NextResponse.json({ ok: false, error: "Keep the email template under 15,000 characters." }, { status: 400 });
      const documentText = body.document ? await extractDocumentText(body.document) : "";
      const rawInput = `${String(body.rawInput || "")}\n${documentText}`.trim();
      const parsedContacts = parseContactInput(rawInput);
      const suppliedWebsites = extractWebsites(String(body.websites || ""));
      if (!parsedContacts.length && !suppliedWebsites.length) {
        return NextResponse.json({ ok: false, error: "Paste contacts, enter a website, or upload a supported document." }, { status: 400 });
      }

      const contactInputs = [...parsedContacts];
      for (const website of suppliedWebsites.slice(0, 5)) {
        const research = await researchWebsite(website);
        for (const email of research.discoveredEmails.slice(0, 5)) {
          if (!contactInputs.some((item) => item.email === email)) {
            contactInputs.push({ email, name: "", website: research.website, company: research.companyName, research });
          }
        }
      }
      if (!contactInputs.length) {
        return NextResponse.json({ ok: false, error: "No email addresses were found. Try a contact/about page or paste at least one email." }, { status: 400 });
      }
      if (contactInputs.length > 25) {
        return NextResponse.json({ ok: false, error: "Process up to 25 contacts at a time so each website can be researched carefully." }, { status: 400 });
      }

      const results: Array<Record<string, any>> = [];
      for (const input of contactInputs) {
        try {
          const result = await createDraftRecord({
            ...input,
            topic,
            campaignName,
            emailTemplate,
            brief: String(body.brief || ""),
            source: body.document?.name ? `document:${body.document.name}` : "pasted_list",
          }, user);
          results.push({ ok: true, email: input.email, company: result.company.name, name: greetingName(input.email, input.name), discoveredEmails: result.research?.discoveredEmails || [], researchSummary: result.research?.summary || "", draftId: result.draft.id });
        } catch (error) {
          results.push({ ok: false, email: input.email, error: error instanceof Error ? error.message : "Research failed" });
        }
      }
      return NextResponse.json({ ok: true, created: results.filter((item) => item.ok).length, failed: results.filter((item) => !item.ok).length, results });
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
      const settingsRows = await db("outreach_settings?select=*&key=eq.sending_policy");
      if (settingsRows[0]?.value?.paused) {
        return NextResponse.json({ ok: false, error: "Sending is paused. Turn off “Pause all” first." }, { status: 409 });
      }
      const mails = await db(`generated_emails?select=*&id=eq.${body.emailId}&limit=1`);
      const mail = mails[0];
      if (!mail) return NextResponse.json({ ok: false, error: "Email draft not found." }, { status: 404 });
      const contacts = await db(`contacts?select=*&id=eq.${mail.contact_id}&limit=1`);
      const contact = contacts[0];
      if (!contact?.email) return NextResponse.json({ ok: false, error: "The selected draft has no valid recipient." }, { status: 400 });
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

async function createDraftRecord(input: Record<string, any>, user: string) {
  const email = String(input.email || "").trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("A valid email address is required.");
  const emailDomain = email.split("@")[1];
  const inferredWebsite = input.website || (!isPublicMailbox(emailDomain) ? `https://${emailDomain}` : "");
  let research: WebsiteResearch | null = input.research || null;
  if (!research && inferredWebsite) {
    try { research = await researchWebsite(inferredWebsite); } catch {}
  }
  const companyName = String(input.company || research?.companyName || companyFromDomain(emailDomain)).trim();
  if (!companyName || (isPublicMailbox(emailDomain) && companyName === companyFromDomain(emailDomain) && !input.company && !research)) {
    throw new Error(`Add the company or website for ${email}; its public-mail domain does not identify an organization.`);
  }
  const companyDomain = research?.website ? new URL(research.website).hostname.replace(/^www\./, "") : emailDomain;
  const website = research?.website || inferredWebsite || null;
  const researchData = {
    brief: String(input.brief || ""),
    topic: String(input.topic || "AI Native Thinking Masterclass"),
    campaign_name: cleanCampaignName(input.campaignName) || "AI Leadership Masterclass Outreach",
    template_provided: Boolean(String(input.emailTemplate || "").trim()),
    source: input.source || "dashboard",
    requested_by: user,
    researched_at: new Date().toISOString(),
    website_title: research?.title || "",
    website_description: research?.description || "",
    research_summary: research?.summary || "",
    focus_areas: research?.focusAreas || [],
    discovered_emails: research?.discoveredEmails || [],
    pages_reviewed: research?.pagesReviewed || [],
  };

  let companies = await db(`companies?select=*&normalized_domain=eq.${encodeURIComponent(companyDomain)}&limit=1`);
  if (!companies.length) {
    companies = await db("companies", { method: "POST", body: JSON.stringify({ name: companyName, normalized_name: companyName.toLowerCase(), normalized_domain: companyDomain, website, research_data: researchData }) });
  } else {
    const existingResearch = companies[0].research_data && typeof companies[0].research_data === "object" ? companies[0].research_data : {};
    const updated = await db(`companies?id=eq.${companies[0].id}`, { method: "PATCH", body: JSON.stringify({ website: website || companies[0].website, research_data: { ...existingResearch, ...researchData } }) });
    companies = updated.length ? updated : companies;
  }
  const company = companies[0];

  let contacts = await db(`contacts?select=*&normalized_email=eq.${encodeURIComponent(email)}&limit=1`);
  if (!contacts.length) {
    contacts = await db("contacts", { method: "POST", body: JSON.stringify({ company_id: company.id, full_name: input.name || null, email, normalized_email: email, data_confidence: input.name ? "user_provided" : "domain_researched", source: input.source || "intelligence_studio" }) });
  } else if (input.name && !contacts[0].full_name) {
    const updated = await db(`contacts?id=eq.${contacts[0].id}`, { method: "PATCH", body: JSON.stringify({ full_name: input.name, data_confidence: "user_provided" }) });
    contacts = updated.length ? updated : contacts;
  }
  const contact = contacts[0];
  const campaignName = cleanCampaignName(input.campaignName) || "AI Leadership Masterclass Outreach";
  let campaigns = await db(`campaigns?select=*&name=eq.${encodeURIComponent(campaignName)}&limit=1`);
  if (!campaigns.length) {
    campaigns = await db("campaigns", {
      method: "POST",
      body: JSON.stringify({
        id: crypto.randomUUID(),
        name: campaignName,
        status: "paused_user_hold",
        sender_name: sender.name,
        sender_email: sender.email,
      }),
    });
  }
  const campaign = campaigns[0];
  if (!campaign) throw new Error("No outreach campaign is configured.");
  const existing = await db(`generated_emails?select=version&contact_id=eq.${contact.id}&campaign_id=eq.${campaign.id}&order=version.desc&limit=1`);
  const topic = String(input.topic || "AI Native Thinking Masterclass").trim();
  const html = draftHtml({ email, name: input.name, company: companyName, brief: input.brief, topic, research, template: input.emailTemplate });
  const drafts = await db("generated_emails", {
    method: "POST",
    body: JSON.stringify({
      company_id: company.id,
      contact_id: contact.id,
      campaign_id: campaign.id,
      version: (existing[0]?.version || 0) + 1,
      subject: `${companyName} - ${topic}`,
      html_body: html,
      status: "draft_pending_review",
      personalization_data: {
        greeting_name: greetingName(email, input.name),
        greeting_source: input.name ? "user_provided" : "email_localpart_or_fallback",
        organization_name: companyName,
        topic,
        campaign_name: campaignName,
        template_provided: Boolean(String(input.emailTemplate || "").trim()),
        research_summary: research?.summary || "",
        focus_areas: research?.focusAreas || [],
        website,
        sender_name: sender.name,
        sender_email: sender.email,
        reply_to_email: replyTo(),
        email_font: "Calibri",
        email_font_size: "11pt",
        bold_underline_organization: true,
        sending_hold: true,
      },
    }),
  });
  await db("research_jobs", { method: "POST", body: JSON.stringify({ id: crypto.randomUUID(), email, company: companyName, website, brief: input.brief || null, status: "draft_created", created_by: user, result: { generated_email_id: drafts[0].id, campaign_id: campaign.id, campaign_name: campaignName, research: researchData } }) });
  return { draft: drafts[0], company, contact, research };
}

async function researchWebsite(rawUrl: string): Promise<WebsiteResearch> {
  const firstUrl = safeWebsiteUrl(rawUrl);
  const origin = new URL(firstUrl).origin;
  const pages = [firstUrl];
  const reviewed: string[] = [];
  const texts: string[] = [];
  let firstHtml = "";
  for (let index = 0; index < pages.length && index < 3; index += 1) {
    const url = pages[index];
    try {
      const response = await fetchWithTimeout(url);
      if (!response.ok || !String(response.headers.get("content-type") || "").includes("text/html")) continue;
      const html = (await response.text()).slice(0, 350_000);
      if (!firstHtml) firstHtml = html;
      reviewed.push(url);
      texts.push(htmlToText(html).slice(0, 24_000));
      if (index === 0) {
        for (const href of extractUsefulLinks(html, origin)) if (!pages.includes(href)) pages.push(href);
      }
    } catch {}
  }
  if (!reviewed.length) throw new Error(`The website ${new URL(firstUrl).hostname} could not be read.`);
  const combined = texts.join(" ");
  const title = decodeEntities(firstHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").trim();
  const description = decodeEntities(firstHtml.match(/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']+)["']/i)?.[1] || firstHtml.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["'](?:description|og:description)["']/i)?.[1] || "").trim();
  const emails = [...new Set(`${firstHtml} ${combined}`.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)?.map((item) => item.toLowerCase()).filter((item) => !/\.(png|jpg|jpeg|gif|svg|webp)$/i.test(item)) || [])];
  const companyName = cleanCompanyTitle(title) || companyFromDomain(new URL(firstUrl).hostname);
  const focusAreas = detectFocusAreas(`${title} ${description} ${combined}`);
  const summary = (description || meaningfulExcerpt(combined, companyName)).slice(0, 420);
  return { website: firstUrl, companyName, title, description, summary, focusAreas, discoveredEmails: emails.slice(0, 20), pagesReviewed: reviewed };
}

async function fetchWithTimeout(url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    return await fetch(url, { redirect: "follow", signal: controller.signal, headers: { "User-Agent": "IKF-Outreach-Research/1.0 (+https://www.ikf.co.in)" } });
  } finally {
    clearTimeout(timer);
  }
}

function safeWebsiteUrl(value: string) {
  const withProtocol = /^https?:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`;
  const url = new URL(withProtocol);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only public HTTP or HTTPS websites can be researched.");
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || /^127\.|^10\.|^192\.168\.|^169\.254\.|^172\.(1[6-9]|2\d|3[01])\./.test(host)) throw new Error("Private network addresses cannot be researched.");
  url.hash = "";
  return url.toString();
}

function extractUsefulLinks(html: string, origin: string) {
  const links: string[] = [];
  for (const match of html.matchAll(/href=["']([^"'#]+)["']/gi)) {
    try {
      const url = new URL(match[1], origin);
      if (url.origin === origin && /\/(about|contact|company|who-we-are)(\/|$)/i.test(url.pathname)) links.push(url.toString());
    } catch {}
  }
  return [...new Set(links)].slice(0, 2);
}

function htmlToText(html: string) {
  return decodeEntities(html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function meaningfulExcerpt(text: string, company: string) {
  const cleaned = text.replace(/\s+/g, " ").trim();
  const index = cleaned.toLowerCase().indexOf(company.toLowerCase().split(" ")[0]);
  return cleaned.slice(Math.max(0, index), Math.max(0, index) + 380) || cleaned.slice(0, 380);
}

function detectFocusAreas(text: string) {
  const rules: Array<[RegExp, string]> = [
    [/manufactur|plant|industrial|automotive/i, "manufacturing and operational excellence"],
    [/software|technology|digital|cloud|data/i, "digital products and technology"],
    [/market|brand|customer|sales|advertis/i, "customer engagement and growth"],
    [/health|hospital|medical|pharma/i, "healthcare and service delivery"],
    [/education|training|academy|learning/i, "learning and knowledge development"],
    [/association|member|federation|council/i, "member services and stakeholder engagement"],
    [/sustainab|energy|environment|climate/i, "sustainability and responsible growth"],
    [/finance|bank|insurance|investment/i, "financial services and decision support"],
  ];
  const matches = rules.filter(([pattern]) => pattern.test(text)).map(([, label]) => label);
  return matches.length ? matches.slice(0, 4) : ["operations", "knowledge workflows", "stakeholder engagement"];
}

function cleanCompanyTitle(title: string) {
  return title.split(/\s+[|–—]\s+|\s+-\s+/)[0].replace(/\b(home|official site|welcome)\b/gi, "").trim();
}

function companyFromDomain(domain: string) {
  const base = domain.replace(/^www\./, "").split(".")[0].replace(/[-_]+/g, " ");
  return base.replace(/\b\w/g, (char) => char.toUpperCase());
}

function isPublicMailbox(domain: string) {
  return new Set(["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "rediffmail.com", "icloud.com", "proton.me", "protonmail.com"]).has(domain.toLowerCase());
}

function parseContactInput(text: string) {
  const contacts: Array<{ email: string; name: string; company?: string; website?: string; research?: WebsiteResearch }> = [];
  for (const line of text.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
    const emails = line.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
    const website = extractWebsites(line)[0];
    for (const rawEmail of emails) {
      const email = rawEmail.toLowerCase();
      const angleName = line.match(new RegExp(`^\\s*([^<,;]+)\\s*<\\s*${escapeRegExp(rawEmail)}`, "i"))?.[1]?.trim() || "";
      const fields = line.split(/[,;\t]/).map((item) => item.trim()).filter(Boolean);
      const nonEmailFields = fields.filter((item) => !item.includes("@") && !/^https?:\/\//i.test(item));
      const name = angleName || (nonEmailFields.length ? nonEmailFields[0] : "");
      const company = nonEmailFields.length > 1 ? nonEmailFields[1] : undefined;
      if (!contacts.some((item) => item.email === email)) contacts.push({ email, name, company, website });
    }
  }
  return contacts;
}

function extractWebsites(text: string) {
  const matches = text.match(/(?:https?:\/\/|www\.)[^\s,;<>]+/gi) || [];
  return [...new Set(matches.map((item) => item.replace(/[).]+$/, "")).map((item) => item.startsWith("www.") ? `https://${item}` : item))];
}

function cleanCampaignName(value: unknown) {
  return String(value || "").replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
}

function renderEmailTemplate(template: string, values: { name: string; company: string; topic: string; research: string; focusAreas: string }) {
  const tokenValues: Record<string, string> = {
    name: escapeHtml(values.name),
    company: `<strong><u>${escapeHtml(values.company)}</u></strong>`,
    topic: `<strong>${escapeHtml(values.topic)}</strong>`,
    research: escapeHtml(values.research),
    focus_areas: escapeHtml(values.focusAreas),
  };
  const tokens: string[] = [];
  const withTokens = template.replace(/\{\{\s*(name|company|topic|research|focus_areas)\s*\}\}/gi, (_, key: string) => {
    const marker = `IKFPERSONALIZATIONTOKEN${tokens.length}END`;
    tokens.push(tokenValues[key.toLowerCase()]);
    return marker;
  });
  let safe = escapeHtml(withTokens);
  tokens.forEach((value, index) => {
    safe = safe.replace(`IKFPERSONALIZATIONTOKEN${index}END`, value);
  });
  safe = safe.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  return safe
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split(/\n/).map((line) => line.trim()).filter(Boolean);
      if (lines.length && lines.every((line) => /^[-•*]\s+/.test(line))) {
        return `<ul>${lines.map((line) => `<li>${line.replace(/^[-•*]\s+/, "")}</li>`).join("")}</ul>`;
      }
      return `<p>${lines.join("<br>")}</p>`;
    })
    .join("");
}

async function extractDocumentText(document: Record<string, any>) {
  const name = String(document.name || "").toLowerCase();
  const raw = String(document.dataBase64 || "").replace(/^data:[^,]+,/, "");
  if (!raw || raw.length > 8_000_000) throw new Error("Upload a document smaller than 6 MB.");
  const bytes = Uint8Array.from(atob(raw), (char) => char.charCodeAt(0));
  if (name.endsWith(".pdf")) {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(bytes);
    const result = await extractText(pdf, { mergePages: true });
    return String(result.text || "").slice(0, 120_000);
  }
  if (name.endsWith(".docx")) {
    const { unzipSync, strFromU8 } = await import("fflate");
    const files = unzipSync(bytes);
    const xml = files["word/document.xml"];
    if (!xml) throw new Error("The DOCX file does not contain readable document text.");
    return decodeEntities(strFromU8(xml).replace(/<w:tab\/>/g, "\t").replace(/<\/w:p>/g, "\n").replace(/<[^>]+>/g, "")).slice(0, 120_000);
  }
  if (/\.(txt|csv|tsv)$/i.test(name)) return new TextDecoder().decode(bytes).slice(0, 120_000);
  throw new Error("Supported documents are PDF, DOCX, CSV, TSV, and TXT.");
}

function decodeEntities(value: string) {
  return value.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;|&apos;/g, "'");
}

function escapeHtml(value: string) {
  return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
