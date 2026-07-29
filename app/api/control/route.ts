import { NextRequest, NextResponse } from "next/server";
import { getQueueDb } from "../../../db";

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

type WebsiteScanResult = {
  input: string;
  ok: boolean;
  website?: string;
  companyName?: string;
  discoveredEmails: string[];
  pagesReviewed: string[];
  error?: string;
  research?: WebsiteResearch;
};

function draftHtml(input: { email: string; name?: string; company: string; brief?: string; topic?: string; research?: WebsiteResearch | null; template?: string; senderName?: string }) {
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
    body += `<p>Regards,<br><strong>${escapeHtml(input.senderName || sender.name)}</strong><br>I Knowledge Factory Pvt. Ltd.<br><a href="tel:+919503939911">+91 95039 39911</a><br><a href="https://www.ikf.co.in/">www.ikf.co.in</a></p>`;
  }
  return `<div style="font-family:Calibri,Arial,sans-serif;font-size:11pt;line-height:1.5">${body}</div>`;
}

export async function GET(req: NextRequest) {
  try {
    const [queue, researchAudit, backgroundJobs, settings, campaigns, emails, contacts, companies, sends, activityRows] = await Promise.all([
      db("outreach_queue?select=*&order=created_at.desc&limit=1000"),
      db("research_jobs?select=*&order=created_at.desc&limit=25"),
      listBackgroundJobs(),
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
        html: cleanupUnresolvedHtml(item.html_body),
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
        companyId: item.company_id || null,
        name: item.full_name || null,
        email: item.email,
        role: item.job_title || null,
        confidence: item.data_confidence || item.source || "unverified",
        company: company.name || "Unknown organization",
        industry: company.industry || null,
        companyWebsite: company.website || null,
        companyCountry: company.country || null,
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
        company: company.name || item.details?.company || item.details?.campaign_name || null,
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
    let availableSenders: Array<{ name: string; email: string; active: boolean }> = [];
    try {
      const check = await fetch("https://api.brevo.com/v3/account", { headers: { "api-key": process.env.BREVO_API_KEY || "" } });
      brevo = check.ok;
    } catch {}
    try {
      availableSenders = await getBrevoSenders();
    } catch {}
    if (!availableSenders.length && sender.email) availableSenders = [{ ...sender, active: brevo }];
    return NextResponse.json({
      ok: true,
      canManage: canManage(req),
      operator: actor(req) || null,
      providers: { database: true, brevo },
      queue,
      jobs: backgroundJobs,
      researchAudit,
      settings: settings[0]?.value || {},
      campaigns,
      liveEmails,
      liveContacts,
      liveCompanies,
      liveActivity,
      liveStats,
      sender,
      availableSenders,
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
    const body = await req.json();
    const internalWorker = body.action === "process_background_campaign" &&
      Boolean(process.env.SUPABASE_SECRET_KEY) &&
      req.headers.get("x-ikf-background-token") === process.env.SUPABASE_SECRET_KEY;
    if (!canManage(req) && !internalWorker) {
      return NextResponse.json(
        { ok: false, error: "Sign in with an authorized IKF account to manage or send emails." },
        { status: 403 },
      );
    }
    const user = internalWorker ? "background-campaign-worker" : actor(req);

    if (body.action === "queue_background_campaign") {
      const topic = String(body.topic || "").trim();
      const campaignName = cleanCampaignName(body.campaignName);
      const emailTemplate = String(body.emailTemplate || "").trim();
      if (!topic) return NextResponse.json({ ok: false, error: "Add the outreach topic that every personalized email should cover." }, { status: 400 });
      if (!campaignName) return NextResponse.json({ ok: false, error: "Add a campaign name so this set of drafts stays organized." }, { status: 400 });
      if (!emailTemplate) return NextResponse.json({ ok: false, error: "Paste the email template to personalize for this campaign." }, { status: 400 });
      if (emailTemplate.length > 15_000) return NextResponse.json({ ok: false, error: "Keep the email template under 15,000 characters." }, { status: 400 });

      const documentText = body.document ? await extractDocumentText(body.document) : "";
      const parsedContacts = parseContactInput(`${String(body.rawInput || "")}\n${documentText}`.trim());
      const suppliedWebsites = extractWebsites(String(body.websites || ""));
      if (!parsedContacts.length && !suppliedWebsites.length) {
        return NextResponse.json({ ok: false, error: "Paste contacts, enter company websites, or upload a supported document." }, { status: 400 });
      }
      if (suppliedWebsites.length > 50) {
        return NextResponse.json({ ok: false, error: "Add up to 50 company websites to one campaign." }, { status: 400 });
      }
      if (parsedContacts.length > 50) {
        return NextResponse.json({ ok: false, error: "Add up to 50 known contacts to one campaign." }, { status: 400 });
      }

      const selectedSender = await selectVerifiedSender(body.senderEmail);
      const campaign = await ensureCampaign(campaignName, "researching", selectedSender);
      const job = await queueBackgroundCampaign({
        campaignId: campaign.id,
        campaignName,
        topic,
        emailTemplate,
        brief: String(body.brief || ""),
        user,
        websites: suppliedWebsites,
        contacts: parsedContacts,
      });
      await db("activity_log", {
        method: "POST",
        body: JSON.stringify({
          action: "background_campaign_queued",
          details: {
            campaign_id: campaign.id,
            campaign_name: campaignName,
            job_id: job.id,
            websites: suppliedWebsites.length,
            known_contacts: parsedContacts.length,
            queued_by: user,
          },
        }),
      });
      return NextResponse.json({ ok: true, queued: true, job, campaign }, { status: 202 });
    }

    if (body.action === "process_background_campaign") {
      const jobId = String(body.jobId || "");
      if (!/^[0-9a-f-]{36}$/i.test(jobId)) {
        return NextResponse.json({ ok: false, error: "A valid background campaign job is required." }, { status: 400 });
      }
      const progress = await processBackgroundCampaignBatch(jobId);
      return NextResponse.json({ ok: true, ...progress });
    }

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

    if (body.action === "discover_website_contacts") {
      const suppliedWebsites = extractWebsites(String(body.websites || ""));
      if (!suppliedWebsites.length) {
        return NextResponse.json({ ok: false, error: "Enter at least one public company website." }, { status: 400 });
      }
      if (suppliedWebsites.length > 50) {
        return NextResponse.json({ ok: false, error: "Scan up to 50 company websites at a time." }, { status: 400 });
      }
      const websiteScans = await researchWebsites(suppliedWebsites);
      return NextResponse.json({
        ok: true,
        websites: websiteScans,
        found: websiteScans.reduce((total, item) => total + item.discoveredEmails.length, 0),
      });
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
      if (suppliedWebsites.length > 10) {
        return NextResponse.json({ ok: false, error: "Research up to 10 company websites in one campaign batch." }, { status: 400 });
      }

      const contactInputs = [...parsedContacts];
      const websiteScans = await researchWebsites(suppliedWebsites);
      for (const scan of websiteScans) {
        if (!scan.ok || !scan.website || !scan.companyName || !scan.research) continue;
        const research = scan.research;
        for (const email of research.discoveredEmails.slice(0, 10)) {
          if (!contactInputs.some((item) => item.email === email)) {
            contactInputs.push({ email, name: "", website: research.website, company: research.companyName, research });
          }
        }
      }
      if (!contactInputs.length) {
        return NextResponse.json({
          ok: true,
          created: 0,
          failed: 0,
          results: [],
          websiteScans,
          warning: "The websites were scanned, but no public email addresses were found. Try a direct contact page or paste a known email.",
        });
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
      return NextResponse.json({ ok: true, created: results.filter((item) => item.ok).length, failed: results.filter((item) => !item.ok).length, results, websiteScans });
    }

    if (body.action === "update_contact") {
      const contactId = String(body.contactId || "");
      if (!/^[0-9a-f-]{36}$/i.test(contactId)) return NextResponse.json({ ok: false, error: "Choose a valid contact to edit." }, { status: 400 });
      const email = String(body.email || "").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ ok: false, error: "Enter a valid contact email address." }, { status: 400 });
      const companyName = cleanText(body.company, 180);
      if (!companyName) return NextResponse.json({ ok: false, error: "Add the company or organization name." }, { status: 400 });
      const contacts = await db(`contacts?select=*&id=eq.${encodeURIComponent(contactId)}&limit=1`);
      const contact = contacts[0];
      if (!contact) return NextResponse.json({ ok: false, error: "Contact not found." }, { status: 404 });
      const duplicates = await db(`contacts?select=id&normalized_email=eq.${encodeURIComponent(email)}&limit=2`);
      if (duplicates.some((item: Record<string, any>) => item.id !== contactId)) {
        return NextResponse.json({ ok: false, error: "Another contact already uses this email address." }, { status: 409 });
      }
      const fullName = cleanText(body.name, 120) || null;
      const role = cleanText(body.role, 140) || null;
      const updatedContacts = await db(`contacts?id=eq.${encodeURIComponent(contactId)}`, {
        method: "PATCH",
        body: JSON.stringify({
          full_name: fullName,
          email,
          normalized_email: email,
          job_title: role,
          data_confidence: "user_verified",
        }),
      });
      let updatedCompany: Record<string, any> | null = null;
      if (contact.company_id) {
        const websiteInput = String(body.website || "").trim();
        let website: string | null = null;
        try {
          website = websiteInput ? safeWebsiteUrl(websiteInput) : null;
        } catch {
          return NextResponse.json({ ok: false, error: "Enter a valid public company website." }, { status: 400 });
        }
        const companyRows = await db(`companies?id=eq.${encodeURIComponent(contact.company_id)}`, {
          method: "PATCH",
          body: JSON.stringify({
            name: companyName,
            normalized_name: companyName.toLowerCase(),
            industry: cleanText(body.industry, 180) || null,
            website,
            country: cleanText(body.country, 100) || null,
          }),
        });
        updatedCompany = companyRows[0] || null;
      }
      await db("activity_log", {
        method: "POST",
        body: JSON.stringify({
          company_id: contact.company_id,
          contact_id: contactId,
          action: "contact_updated",
          details: { email, company: companyName, updated_by: user },
        }),
      });
      return NextResponse.json({ ok: true, contact: updatedContacts[0], company: updatedCompany });
    }

    if (body.action === "approve") {
      const rows = await db(`generated_emails?id=eq.${body.emailId}`, { method: "PATCH", body: JSON.stringify({ status: "approved" }) });
      return NextResponse.json({ ok: true, email: rows[0] });
    }

    if (body.action === "clean_unresolved_placeholders") {
      const rows = await db("generated_emails?select=id,html_body,status&status=in.(draft_pending_review,approved)&limit=1000");
      const changed = rows
        .map((item: Record<string, any>) => ({ ...item, cleanHtml: cleanupUnresolvedHtml(item.html_body) }))
        .filter((item: Record<string, any>) => item.cleanHtml !== item.html_body);
      for (const group of chunk(changed, 20)) {
        await Promise.all(group.map((item: Record<string, any>) =>
          db(`generated_emails?id=eq.${item.id}`, { method: "PATCH", body: JSON.stringify({ html_body: item.cleanHtml }) })
        ));
      }
      if (changed.length) {
        await db("activity_log", {
          method: "POST",
          body: JSON.stringify({
            action: "unresolved_placeholders_cleaned",
            details: { updated_drafts: changed.length, updated_by: user },
          }),
        });
      }
      return NextResponse.json({ ok: true, scanned: rows.length, updated: changed.length });
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
      if (mail.status !== "approved") {
        return NextResponse.json({ ok: false, error: "Approve this email before scheduling." }, { status: 409 });
      }
      const contacts = await db(`contacts?select=*&id=eq.${mail.contact_id}&limit=1`);
      const contact = contacts[0];
      const usedSender = await senderForMail(mail);
      const result = await submitBrevo(mail, contact, scheduledAt.toISOString());
      const rows = await db("outreach_queue", { method: "POST", body: JSON.stringify({ id: crypto.randomUUID(), generated_email_id: mail.id, contact_id: mail.contact_id, campaign_id: mail.campaign_id, status: "scheduled_with_brevo", scheduled_for: scheduledAt.toISOString(), approved_by: user, approved_at: new Date().toISOString() }) });
      await db("email_sends", { method: "POST", body: JSON.stringify({ id: crypto.randomUUID(), generated_email_id: mail.id, company_id: mail.company_id, contact_id: mail.contact_id, campaign_id: mail.campaign_id, sender_name: usedSender.name, sender_email: usedSender.email, recipient_email: contact.email, subject: mail.subject, brevo_message_id: result.messageId, status: `scheduled:${scheduledAt.toISOString()}` }) });
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
      if (mails.some((mail: Record<string, any>) => mail.status !== "approved")) {
        return NextResponse.json({ ok: false, error: "Approve every selected email before scheduling." }, { status: 409 });
      }
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
        const usedSender = await senderForMail(mail);
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
            sender_name: usedSender.name,
            sender_email: usedSender.email,
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

    if (body.action === "schedule_campaign") {
      const campaignId = String(body.campaignId || "");
      if (!/^[0-9a-f-]{36}$/i.test(campaignId)) return NextResponse.json({ ok: false, error: "Choose a valid campaign." }, { status: 400 });
      if (body.confirm !== true) return NextResponse.json({ ok: false, error: "Confirm that you reviewed and approved this campaign." }, { status: 400 });
      const start = new Date(String(body.scheduledFor || ""));
      const now = Date.now();
      if (!Number.isFinite(start.getTime()) || start.getTime() < now + 2 * 60_000) {
        return NextResponse.json({ ok: false, error: "Choose a campaign start time at least 2 minutes from now." }, { status: 400 });
      }
      if (start.getTime() > now + 72 * 60 * 60_000) {
        return NextResponse.json({ ok: false, error: "Brevo accepts scheduled transactional emails up to 72 hours ahead." }, { status: 400 });
      }
      const [settingsRows, campaignRows, mails] = await Promise.all([
        db("outreach_settings?select=*&key=eq.sending_policy"),
        db(`campaigns?select=*&id=eq.${encodeURIComponent(campaignId)}&limit=1`),
        db(`generated_emails?select=*&campaign_id=eq.${encodeURIComponent(campaignId)}&status=eq.approved&order=generated_at.asc&limit=1000`),
      ]);
      const policy = settingsRows[0]?.value || {};
      if (policy.paused) return NextResponse.json({ ok: false, error: "Sending is paused. Turn off “Pause all” in Controls & APIs before scheduling." }, { status: 409 });
      const campaign = campaignRows[0];
      if (!campaign) return NextResponse.json({ ok: false, error: "Campaign not found." }, { status: 404 });
      if (!mails.length) return NextResponse.json({ ok: false, error: "This campaign has no approved, unscheduled emails." }, { status: 400 });
      if (mails.length > 600) return NextResponse.json({ ok: false, error: "Schedule up to 600 approved emails in one campaign." }, { status: 400 });
      const delayMinutes = Math.max(1, Math.min(60, Number(body.delayMinutes || policy.minimum_delay_minutes || 5)));
      let scheduleTimes: Date[];
      try {
        scheduleTimes = buildCampaignSchedule(start, mails.length, delayMinutes, policy);
      } catch (error) {
        return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "The campaign schedule is invalid." }, { status: 400 });
      }
      if (scheduleTimes.at(-1)!.getTime() > now + 72 * 60 * 60_000) {
        return NextResponse.json({
          ok: false,
          error: "This campaign would extend beyond Brevo’s 72-hour scheduling horizon. Increase the daily limit, reduce spacing, widen the sending window, or schedule a smaller campaign.",
        }, { status: 400 });
      }
      const contactIds = [...new Set(mails.map((mail: Record<string, any>) => mail.contact_id).filter(Boolean))];
      const contacts = contactIds.length ? await db(`contacts?select=*&id=in.(${contactIds.join(",")})`) : [];
      const contactById = new Map(contacts.map((item: Record<string, any>) => [item.id, item]));
      const results: Array<Record<string, any>> = new Array(mails.length);
      let cursor = 0;
      async function scheduleWorker() {
        while (cursor < mails.length) {
          const index = cursor++;
          const mail = mails[index];
          const contact = contactById.get(mail.contact_id);
          if (!contact?.email) {
            results[index] = { ok: false, mail, error: "Recipient email is missing." };
            continue;
          }
          try {
            const scheduledAt = scheduleTimes[index].toISOString();
            const result = await submitBrevo(mail, contact, scheduledAt);
            results[index] = { ok: true, mail, contact, scheduledAt, messageId: result.messageId };
          } catch (error) {
            results[index] = { ok: false, mail, contact, error: error instanceof Error ? error.message : "Brevo scheduling failed." };
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(6, mails.length) }, () => scheduleWorker()));
      const successful = results.filter((item) => item?.ok);
      if (successful.length) {
        const approvedAt = new Date().toISOString();
        await db("outreach_queue", {
          method: "POST",
          body: JSON.stringify(successful.map((item) => ({
            id: crypto.randomUUID(),
            generated_email_id: item.mail.id,
            contact_id: item.mail.contact_id,
            campaign_id: campaignId,
            status: "scheduled_with_brevo",
            scheduled_for: item.scheduledAt,
            approved_by: user,
            approved_at: approvedAt,
          }))),
        });
        await db("email_sends", {
          method: "POST",
          body: JSON.stringify(await Promise.all(successful.map(async (item) => {
            const usedSender = await senderForMail(item.mail);
            return {
            id: crypto.randomUUID(),
            generated_email_id: item.mail.id,
            company_id: item.mail.company_id,
            contact_id: item.mail.contact_id,
            campaign_id: campaignId,
            sender_name: usedSender.name,
            sender_email: usedSender.email,
            recipient_email: item.contact.email,
            subject: item.mail.subject,
            brevo_message_id: item.messageId,
            status: `scheduled:${item.scheduledAt}`,
            };
          }))),
        });
        for (const ids of chunk(successful.map((item) => item.mail.id), 100)) {
          await db(`generated_emails?id=in.(${ids.join(",")})`, { method: "PATCH", body: JSON.stringify({ status: "scheduled" }) });
        }
        await db(`campaigns?id=eq.${encodeURIComponent(campaignId)}`, { method: "PATCH", body: JSON.stringify({ status: "scheduled" }) });
      }
      await db("activity_log", {
        method: "POST",
        body: JSON.stringify({
          action: "campaign_scheduled",
          details: {
            campaign_name: campaign.name,
            requested: mails.length,
            scheduled: successful.length,
            failed: results.length - successful.length,
            first_scheduled_for: successful[0]?.scheduledAt || null,
            last_scheduled_for: successful.at(-1)?.scheduledAt || null,
            scheduled_by: user,
          },
        }),
      });
      return NextResponse.json({
        ok: successful.length > 0,
        campaign: campaign.name,
        requested: mails.length,
        scheduled: successful.length,
        failed: results.length - successful.length,
        firstScheduledFor: successful[0]?.scheduledAt || null,
        lastScheduledFor: successful.at(-1)?.scheduledAt || null,
        errors: results.filter((item) => item && !item.ok).slice(0, 10).map((item) => ({ emailId: item.mail?.id, error: item.error })),
      }, { status: successful.length ? 200 : 502 });
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
      if (mail.status !== "approved") return NextResponse.json({ ok: false, error: "Approve this email before sending." }, { status: 409 });
      const contacts = await db(`contacts?select=*&id=eq.${mail.contact_id}&limit=1`);
      const contact = contacts[0];
      if (!contact?.email) return NextResponse.json({ ok: false, error: "The selected draft has no valid recipient." }, { status: 400 });
      const usedSender = await senderForMail(mail);
      const result = await submitBrevo(mail, contact);
      await db("email_sends", { method: "POST", body: JSON.stringify({ id: crypto.randomUUID(), generated_email_id: mail.id, company_id: mail.company_id, contact_id: mail.contact_id, campaign_id: mail.campaign_id, sender_name: usedSender.name, sender_email: usedSender.email, recipient_email: contact.email, subject: mail.subject, brevo_message_id: result.messageId, status: "sent", sent_at: new Date().toISOString() }) });
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
      if (mails.some((mail: Record<string, any>) => mail.status !== "approved")) {
        return NextResponse.json({ ok: false, error: "Approve every selected email before sending." }, { status: 409 });
      }
      const contactIds = [...new Set(mails.map((mail: Record<string, any>) => mail.contact_id).filter(Boolean))];
      const contacts = contactIds.length ? await db(`contacts?select=*&id=in.(${contactIds.join(",")})`) : [];
      const contactById = new Map(contacts.map((item: Record<string, any>) => [item.id, item]));
      const sent: string[] = [];
      for (const mail of mails) {
        const contact = contactById.get(mail.contact_id);
        if (!contact?.email) continue;
        const usedSender = await senderForMail(mail);
        const result = await submitBrevo(mail, contact);
        await db("email_sends", { method: "POST", body: JSON.stringify({ id: crypto.randomUUID(), generated_email_id: mail.id, company_id: mail.company_id, contact_id: mail.contact_id, campaign_id: mail.campaign_id, sender_name: usedSender.name, sender_email: usedSender.email, recipient_email: contact.email, subject: mail.subject, brevo_message_id: result.messageId, status: "sent", sent_at: new Date().toISOString() }) });
        await db(`generated_emails?id=eq.${mail.id}`, { method: "PATCH", body: JSON.stringify({ status: "sent" }) });
        sent.push(mail.id);
      }
      return NextResponse.json({ ok: true, count: sent.length });
    }

    if (body.action === "send_campaign") {
      const campaignId = String(body.campaignId || "");
      if (!/^[0-9a-f-]{36}$/i.test(campaignId)) return NextResponse.json({ ok: false, error: "Choose a valid campaign." }, { status: 400 });
      if (body.confirmText !== "SEND CAMPAIGN") return NextResponse.json({ ok: false, error: "Type SEND CAMPAIGN to confirm immediate delivery." }, { status: 400 });
      const [settingsRows, campaignRows, mails] = await Promise.all([
        db("outreach_settings?select=*&key=eq.sending_policy"),
        db(`campaigns?select=*&id=eq.${encodeURIComponent(campaignId)}&limit=1`),
        db(`generated_emails?select=*&campaign_id=eq.${encodeURIComponent(campaignId)}&status=eq.approved&order=generated_at.asc&limit=1000`),
      ]);
      const policy = settingsRows[0]?.value || {};
      if (policy.paused) return NextResponse.json({ ok: false, error: "Sending is paused. Turn off “Pause all” before sending this campaign." }, { status: 409 });
      if (!campaignRows[0]) return NextResponse.json({ ok: false, error: "Campaign not found." }, { status: 404 });
      if (!mails.length) return NextResponse.json({ ok: false, error: "This campaign has no approved, unsent emails." }, { status: 400 });
      const dailyLimit = Math.max(1, Math.min(1000, Number(policy.daily_limit || 25)));
      if (mails.length > dailyLimit) {
        return NextResponse.json({ ok: false, error: `This campaign has ${mails.length} approved emails, above the ${dailyLimit}-email daily limit. Schedule it instead or reduce the audience.` }, { status: 400 });
      }
      const contactIds = [...new Set(mails.map((mail: Record<string, any>) => mail.contact_id).filter(Boolean))];
      const contacts = contactIds.length ? await db(`contacts?select=*&id=in.(${contactIds.join(",")})`) : [];
      const contactById = new Map(contacts.map((item: Record<string, any>) => [item.id, item]));
      const sent: string[] = [];
      const failures: Array<{ id: string; error: string }> = [];
      for (const mail of mails) {
        const contact = contactById.get(mail.contact_id);
        if (!contact?.email) {
          failures.push({ id: mail.id, error: "Recipient email is missing." });
          continue;
        }
        try {
          const usedSender = await senderForMail(mail);
          const result = await submitBrevo(mail, contact);
          await db("email_sends", { method: "POST", body: JSON.stringify({ id: crypto.randomUUID(), generated_email_id: mail.id, company_id: mail.company_id, contact_id: mail.contact_id, campaign_id: mail.campaign_id, sender_name: usedSender.name, sender_email: usedSender.email, recipient_email: contact.email, subject: mail.subject, brevo_message_id: result.messageId, status: "sent", sent_at: new Date().toISOString() }) });
          await db(`generated_emails?id=eq.${mail.id}`, { method: "PATCH", body: JSON.stringify({ status: "sent" }) });
          sent.push(mail.id);
        } catch (error) {
          failures.push({ id: mail.id, error: error instanceof Error ? error.message : "Brevo rejected this email." });
        }
      }
      return NextResponse.json({ ok: true, sent: sent.length, failed: failures.length, failures });
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
      const value = { mode: "manual_approval", daily_limit: Math.max(1, Math.min(1000, Number(body.dailyLimit || 25))), sending_window_start: body.windowStart || "10:00", sending_window_end: body.windowEnd || "17:00", timezone: "Asia/Kolkata", minimum_delay_minutes: Math.max(1, Math.min(60, Number(body.delay || 5))), paused: Boolean(body.paused) };
      await db("outreach_settings?key=eq.sending_policy", { method: "PATCH", body: JSON.stringify({ value, updated_by: user, updated_at: new Date().toISOString() }) });
      return NextResponse.json({ ok: true, settings: value });
    }

    return NextResponse.json({ ok: false, error: "Unknown action." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Action failed" }, { status: 500 });
  }
}

async function listBackgroundJobs() {
  try {
    const result = await getQueueDb().prepare(`
      SELECT
        id,
        campaign_id AS campaignId,
        campaign_name AS campaignName,
        status,
        total_items AS totalItems,
        completed_items AS completedItems,
        successful_items AS successfulItems,
        failed_items AS failedItems,
        drafts_created AS draftsCreated,
        contacts_found AS contactsFound,
        last_error AS lastError,
        created_at AS createdAt,
        started_at AS startedAt,
        completed_at AS completedAt,
        updated_at AS updatedAt
      FROM background_research_jobs
      ORDER BY created_at DESC
      LIMIT 100
    `).all();
    return result.results || [];
  } catch {
    return [];
  }
}

async function getBrevoSenders() {
  const response = await fetch("https://api.brevo.com/v3/senders", {
    headers: { "api-key": process.env.BREVO_API_KEY || "" },
  });
  if (!response.ok) throw new Error("Brevo senders could not be loaded.");
  const data = await response.json() as { senders?: Array<Record<string, any>> };
  return (data.senders || [])
    .filter((item) => item.active !== false && item.email)
    .map((item) => ({
      name: cleanText(item.name, 120) || String(item.email).split("@")[0],
      email: String(item.email).trim().toLowerCase(),
      active: item.active !== false,
    }));
}

async function selectVerifiedSender(value: unknown) {
  const requested = String(value || sender.email).trim().toLowerCase();
  const senders = await getBrevoSenders();
  const selected = senders.find((item) => item.email === requested);
  if (!selected) throw new Error("Choose an active sender that is verified in Brevo.");
  return selected;
}

async function ensureCampaign(campaignName: string, status = "paused_user_hold", campaignSender?: { name: string; email: string }) {
  let campaigns = await db(`campaigns?select=*&name=eq.${encodeURIComponent(campaignName)}&limit=1`);
  if (!campaigns.length) {
    campaigns = await db("campaigns", {
      method: "POST",
      body: JSON.stringify({
        id: crypto.randomUUID(),
        name: campaignName,
        status,
        sender_name: campaignSender?.name || sender.name,
        sender_email: campaignSender?.email || sender.email,
      }),
    });
  } else if (
    (status && campaigns[0].status !== status) ||
    (campaignSender && (campaigns[0].sender_email !== campaignSender.email || campaigns[0].sender_name !== campaignSender.name))
  ) {
    const updated = await db(`campaigns?id=eq.${campaigns[0].id}`, {
      method: "PATCH",
      body: JSON.stringify({
        ...(status ? { status } : {}),
        ...(campaignSender ? { sender_name: campaignSender.name, sender_email: campaignSender.email } : {}),
      }),
    });
    campaigns = updated.length ? updated : campaigns;
  }
  if (!campaigns[0]) throw new Error("The campaign could not be created.");
  return campaigns[0];
}

async function queueBackgroundCampaign(input: {
  campaignId: string;
  campaignName: string;
  topic: string;
  emailTemplate: string;
  brief: string;
  user: string;
  websites: string[];
  contacts: Array<Record<string, any>>;
}) {
  const queueDb = getQueueDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const items = [
    ...input.websites.map((website) => ({
      id: crypto.randomUUID(),
      type: "website",
      value: website,
      payload: JSON.stringify({ website }),
    })),
    ...input.contacts.map((contact) => ({
      id: crypto.randomUUID(),
      type: "contact",
      value: String(contact.email || "").toLowerCase(),
      payload: JSON.stringify(contact),
    })),
  ];
  await queueDb.batch([
    queueDb.prepare(`
      INSERT INTO background_research_jobs (
        id, campaign_id, campaign_name, topic, email_template, brief, created_by,
        status, total_items, completed_items, successful_items, failed_items,
        drafts_created, contacts_found, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, 0, 0, 0, 0, 0, ?, ?)
    `).bind(id, input.campaignId, input.campaignName, input.topic, input.emailTemplate, input.brief || null, input.user, items.length, now, now),
    ...items.map((item) => queueDb.prepare(`
      INSERT INTO background_research_items (
        id, job_id, input_type, input_value, payload, status, attempts, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'queued', 0, ?, ?)
    `).bind(item.id, id, item.type, item.value, item.payload, now, now)),
  ]);
  return {
    id,
    campaignId: input.campaignId,
    campaignName: input.campaignName,
    status: "queued",
    totalItems: items.length,
    completedItems: 0,
    websiteCount: input.websites.length,
    knownContactCount: input.contacts.length,
    createdAt: now,
  };
}

async function processBackgroundCampaignBatch(jobId: string) {
  const queueDb = getQueueDb();
  const jobResult = await queueDb.prepare("SELECT * FROM background_research_jobs WHERE id = ? LIMIT 1").bind(jobId).all();
  const job = jobResult.results?.[0] as Record<string, any> | undefined;
  if (!job) throw new Error("Background campaign job not found.");
  if (["completed", "completed_with_issues", "failed"].includes(String(job.status))) {
    return { jobId, status: job.status, remaining: 0, completedItems: Number(job.completed_items || 0), totalItems: Number(job.total_items || 0) };
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const staleBefore = new Date(now.getTime() - 5 * 60_000).toISOString();
  await queueDb.prepare(`
    UPDATE background_research_items
    SET status = CASE WHEN attempts >= 3 THEN 'failed' ELSE 'queued' END,
        error = CASE WHEN attempts >= 3 THEN COALESCE(error, 'The research worker could not finish this item after three attempts.') ELSE error END,
        claimed_by = NULL,
        updated_at = ?
    WHERE job_id = ? AND status = 'researching' AND updated_at < ?
  `).bind(nowIso, jobId, staleBefore).run();

  const queued = await queueDb.prepare(`
    SELECT * FROM background_research_items
    WHERE job_id = ? AND status = 'queued'
    ORDER BY created_at ASC
    LIMIT 3
  `).bind(jobId).all();
  const claimId = crypto.randomUUID();
  const candidates = (queued.results || []) as Array<Record<string, any>>;
  if (candidates.length) {
    await queueDb.batch(candidates.map((item) => queueDb.prepare(`
      UPDATE background_research_items
      SET status = 'researching', attempts = attempts + 1, claimed_by = ?, updated_at = ?
      WHERE id = ? AND status = 'queued'
    `).bind(claimId, nowIso, item.id)));
  }
  const claimedResult = await queueDb.prepare(`
    SELECT * FROM background_research_items
    WHERE job_id = ? AND claimed_by = ? AND status = 'researching'
  `).bind(jobId, claimId).all();
  const claimed = (claimedResult.results || []) as Array<Record<string, any>>;

  await queueDb.prepare(`
    UPDATE background_research_jobs
    SET status = 'researching', started_at = COALESCE(started_at, ?), updated_at = ?
    WHERE id = ?
  `).bind(nowIso, nowIso, jobId).run();

  const outcomes = await Promise.all(claimed.map(async (item) => {
    try {
      const result = await processBackgroundResearchItem(item, job);
      return { item, ok: true, result };
    } catch (error) {
      return { item, ok: false, error: error instanceof Error ? error.message : "Research failed." };
    }
  }));
  if (outcomes.length) {
    await queueDb.batch(outcomes.map((outcome) => queueDb.prepare(`
      UPDATE background_research_items
      SET status = ?, result = ?, error = ?, claimed_by = NULL, updated_at = ?
      WHERE id = ?
    `).bind(
      outcome.ok ? "completed" : "failed",
      outcome.ok ? JSON.stringify(outcome.result) : null,
      outcome.ok ? null : outcome.error,
      new Date().toISOString(),
      outcome.item.id,
    )));
  }

  const addedDrafts = outcomes.reduce((total, outcome) => total + (outcome.ok ? Number(outcome.result.draftsCreated || 0) : 0), 0);
  const addedContacts = outcomes.reduce((total, outcome) => total + (outcome.ok ? Number(outcome.result.contactsFound || 0) : 0), 0);
  const countsResult = await queueDb.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status IN ('completed', 'failed') THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS successful,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN status IN ('queued', 'researching') THEN 1 ELSE 0 END) AS remaining
    FROM background_research_items
    WHERE job_id = ?
  `).bind(jobId).all();
  const counts = (countsResult.results?.[0] || {}) as Record<string, any>;
  const remaining = Number(counts.remaining || 0);
  const completedItems = Number(counts.completed || 0);
  const successfulItems = Number(counts.successful || 0);
  const failedItems = Number(counts.failed || 0);
  const currentDrafts = Number(job.drafts_created || 0) + addedDrafts;
  const currentContacts = Number(job.contacts_found || 0) + addedContacts;
  const finalStatus = remaining
    ? "researching"
    : failedItems && successfulItems
      ? "completed_with_issues"
      : failedItems
        ? "failed"
        : "completed";
  const completedAt = remaining ? null : new Date().toISOString();
  const lastError = outcomes.find((outcome) => !outcome.ok)?.error || null;

  await queueDb.prepare(`
    UPDATE background_research_jobs
    SET status = ?, completed_items = ?, successful_items = ?, failed_items = ?,
        drafts_created = ?, contacts_found = ?, last_error = COALESCE(?, last_error),
        completed_at = ?, updated_at = ?
    WHERE id = ?
  `).bind(finalStatus, completedItems, successfulItems, failedItems, currentDrafts, currentContacts, lastError, completedAt, new Date().toISOString(), jobId).run();

  if (!remaining) {
    const campaignStatus = currentDrafts ? "draft_pending_review" : failedItems ? "research_failed" : "research_complete_no_contacts";
    await db(`campaigns?id=eq.${job.campaign_id}`, { method: "PATCH", body: JSON.stringify({ status: campaignStatus }) });
    await db("activity_log", {
      method: "POST",
      body: JSON.stringify({
        action: "background_campaign_completed",
        details: {
          campaign_id: job.campaign_id,
          campaign_name: job.campaign_name,
          job_id: jobId,
          status: finalStatus,
          drafts_created: currentDrafts,
          contacts_found: currentContacts,
          failed_items: failedItems,
        },
      }),
    });
  }
  return {
    jobId,
    status: finalStatus,
    remaining,
    totalItems: Number(counts.total || 0),
    completedItems,
    successfulItems,
    failedItems,
    draftsCreated: currentDrafts,
    contactsFound: currentContacts,
  };
}

async function processBackgroundResearchItem(item: Record<string, any>, job: Record<string, any>) {
  const payload = JSON.parse(String(item.payload || "{}"));
  const common = {
    topic: job.topic,
    campaignName: job.campaign_name,
    emailTemplate: job.email_template,
    brief: job.brief || "",
    source: `background_campaign:${job.id}`,
    skipExistingCampaignContact: true,
  };
  if (item.input_type === "contact") {
    const created = await createDraftRecord({ ...payload, ...common }, String(job.created_by || "background-worker"));
    return {
      contactsFound: 1,
      draftsCreated: created.skipped ? 0 : 1,
      email: String(payload.email || ""),
      company: created.company?.name || payload.company || "",
      skippedExisting: Boolean(created.skipped),
    };
  }

  const research = await researchWebsite(String(payload.website || item.input_value));
  const emails = [...new Set(research.discoveredEmails.map((email) => email.toLowerCase()))].slice(0, 10);
  const drafts: Array<Record<string, any>> = [];
  const errors: string[] = [];
  for (const email of emails) {
    try {
      const created = await createDraftRecord({
        ...common,
        email,
        company: research.companyName,
        website: research.website,
        research,
      }, String(job.created_by || "background-worker"));
      drafts.push({ id: created.draft.id, email, skippedExisting: Boolean(created.skipped) });
    } catch (error) {
      errors.push(error instanceof Error ? error.message : `Could not create the draft for ${email}.`);
    }
  }
  if (emails.length && !drafts.length && errors.length) throw new Error(errors[0]);
  return {
    website: research.website,
    companyName: research.companyName,
    contactsFound: emails.length,
    draftsCreated: drafts.filter((draft) => !draft.skippedExisting).length,
    discoveredEmails: emails,
    pagesReviewed: research.pagesReviewed,
    drafts,
    errors,
  };
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
  const campaign = await ensureCampaign(campaignName, "");
  if (!campaign) throw new Error("No outreach campaign is configured.");
  const existing = await db(`generated_emails?select=*&contact_id=eq.${contact.id}&campaign_id=eq.${campaign.id}&order=version.desc&limit=1`);
  if (input.skipExistingCampaignContact && existing[0]) {
    return { draft: existing[0], company, contact, research, skipped: true };
  }
  const topic = String(input.topic || "AI Native Thinking Masterclass").trim();
  const campaignSender = {
    name: String(campaign.sender_name || sender.name),
    email: String(campaign.sender_email || sender.email),
  };
  const html = draftHtml({ email, name: input.name, company: companyName, brief: input.brief, topic, research, template: input.emailTemplate, senderName: campaignSender.name });
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
        sender_name: campaignSender.name,
        sender_email: campaignSender.email,
        reply_to_email: replyTo(),
        email_font: "Calibri",
        email_font_size: "11pt",
        bold_underline_organization: true,
        sending_hold: true,
      },
    }),
  });
  await db("research_jobs", { method: "POST", body: JSON.stringify({ id: crypto.randomUUID(), email, company: companyName, website, brief: input.brief || null, status: "draft_created", created_by: user, result: { generated_email_id: drafts[0].id, campaign_id: campaign.id, campaign_name: campaignName, research: researchData } }) });
  return { draft: drafts[0], company, contact, research, skipped: false };
}

async function researchWebsites(websites: string[]): Promise<WebsiteScanResult[]> {
  if (!websites.length) return [];
  const results = new Array<WebsiteScanResult>(websites.length);
  let cursor = 0;
  async function worker() {
    while (cursor < websites.length) {
      const index = cursor++;
      const input = websites[index];
      try {
        const research = await researchWebsite(input);
        results[index] = {
          input,
          ok: true,
          website: research.website,
          companyName: research.companyName,
          discoveredEmails: research.discoveredEmails,
          pagesReviewed: research.pagesReviewed,
          research,
        };
      } catch (error) {
        results[index] = {
          input,
          ok: false,
          discoveredEmails: [],
          pagesReviewed: [],
          error: error instanceof Error ? error.message : "The website could not be scanned.",
        };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(5, websites.length) }, () => worker()));
  return results;
}

async function researchWebsite(rawUrl: string): Promise<WebsiteResearch> {
  const firstUrl = safeWebsiteUrl(rawUrl);
  const pinnedHost = siteHost(new URL(firstUrl).hostname);
  const pages = [firstUrl];
  const visited = new Set<string>();
  const reviewed: string[] = [];
  const texts: string[] = [];
  const emailScores = new Map<string, number>();
  let firstHtml = "";
  let canonicalWebsite = firstUrl;
  const deadline = Date.now() + 14_000;

  for (let index = 0; index < pages.length && reviewed.length < 6 && index < 14 && Date.now() < deadline; index += 1) {
    const requestedUrl = pages[index];
    const normalizedRequest = stripTrackingUrl(requestedUrl);
    if (visited.has(normalizedRequest)) continue;
    visited.add(normalizedRequest);
    try {
      const response = await fetchWithTimeout(normalizedRequest, pinnedHost);
      if (!response.ok) continue;
      const contentType = String(response.headers.get("content-type") || "").toLowerCase();
      if (contentType && !contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) continue;
      const contentLength = Number(response.headers.get("content-length") || 0);
      if (contentLength > 2_000_000) continue;
      const finalUrl = safeWebsiteUrl(response.url || normalizedRequest);
      if (siteHost(new URL(finalUrl).hostname) !== pinnedHost) continue;
      const html = (await response.text()).slice(0, 600_000);
      if (!html.trim()) continue;

      canonicalWebsite = reviewed.length ? canonicalWebsite : finalUrl;
      if (!firstHtml) firstHtml = html;
      reviewed.push(finalUrl);
      texts.push(htmlToText(html).slice(0, 32_000));
      for (const candidate of extractEmailsFromHtml(html, finalUrl)) {
        emailScores.set(candidate.email, Math.max(candidate.score, emailScores.get(candidate.email) || 0));
      }

      for (const href of extractUsefulLinks(html, finalUrl, pinnedHost)) {
        if (!pages.includes(href)) pages.push(href);
      }
      if (reviewed.length === 1) {
        const origin = new URL(finalUrl).origin;
        for (const path of ["/contact-us/", "/contact/", "/contactus/", "/get-in-touch/", "/about-us/", "/about/", "/team/", "/leadership/", "/staff/", "/support/"]) {
          const candidate = new URL(path, origin).toString();
          if (!pages.includes(candidate)) pages.push(candidate);
        }
      }
    } catch {
      // One blocked or unavailable page must not stop the rest of the same-site crawl.
    }
  }

  if (!reviewed.length) throw new Error(`The website ${new URL(firstUrl).hostname} could not be read.`);
  const combined = texts.join(" ");
  const title = decodeEntities(firstHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").trim();
  const description = decodeEntities(firstHtml.match(/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']+)["']/i)?.[1] || firstHtml.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["'](?:description|og:description)["']/i)?.[1] || "").trim();
  const companyName = cleanCompanyTitle(title) || companyFromDomain(new URL(canonicalWebsite).hostname);
  const focusAreas = detectFocusAreas(`${title} ${description} ${combined}`);
  const summary = (description || meaningfulExcerpt(combined, companyName)).slice(0, 420);
  const discoveredEmails = [...emailScores.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([email]) => email)
    .slice(0, 25);
  return { website: canonicalWebsite, companyName, title, description, summary, focusAreas, discoveredEmails, pagesReviewed: reviewed };
}

async function fetchWithTimeout(url: string, expectedSiteHost: string) {
  let current = safeWebsiteUrl(url);
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    try {
      const response = await fetch(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent": "IKF-Outreach-Research/2.0 (+https://www.ikf.co.in)",
          Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
        },
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location) return response;
        const next = safeWebsiteUrl(new URL(location, current).toString());
        if (siteHost(new URL(next).hostname) !== expectedSiteHost) throw new Error("The website redirected outside its own domain.");
        current = next;
        continue;
      }
      return response;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("The website redirected too many times.");
}

function safeWebsiteUrl(value: string) {
  const trimmed = String(value || "").trim().replace(/^[<([{]+|[>\])},.;]+$/g, "");
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = new URL(withProtocol);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only public HTTP or HTTPS websites can be researched.");
  if (url.username || url.password) throw new Error("Website URLs cannot contain sign-in credentials.");
  if (url.port && !["80", "443"].includes(url.port)) throw new Error("Only standard public website ports can be researched.");
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host.includes(":") || isBlockedIpv4(host) || host === "localhost" || /\.(?:local|internal|lan|home|test|example|invalid|onion)$/i.test(host)) {
    throw new Error("Private or internal network addresses cannot be researched.");
  }
  url.hostname = host;
  url.hash = "";
  return url.toString();
}

function isBlockedIpv4(host: string) {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return false;
  const octets = host.split(".").map(Number);
  if (octets.some((value) => value < 0 || value > 255)) return true;
  const [a, b] = octets;
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19));
}

function siteHost(hostname: string) {
  return hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
}

function stripTrackingUrl(value: string) {
  const url = new URL(value);
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|fbclid|gclid|mc_)/i.test(key)) url.searchParams.delete(key);
  }
  url.hash = "";
  return url.toString();
}

function extractUsefulLinks(html: string, baseUrl: string, expectedSiteHost: string) {
  const scored = new Map<string, number>();
  for (const match of html.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)) {
    const raw = decodeEntities(match[1]).trim();
    if (!raw || /^(?:mailto|tel|javascript|data):/i.test(raw)) continue;
    try {
      const url = new URL(raw, baseUrl);
      if (!["http:", "https:"].includes(url.protocol) || siteHost(url.hostname) !== expectedSiteHost) continue;
      if (/\.(?:pdf|docx?|xlsx?|zip|jpe?g|png|gif|svg|webp|mp4|mp3)(?:$|\?)/i.test(url.pathname)) continue;
      const searchable = `${url.pathname} ${url.search}`.toLowerCase();
      let score = 0;
      if (/contact|contact-us|contactus|get-in-touch|reach-us|connect/.test(searchable)) score = 100;
      else if (/team|leadership|staff|people|management|directory/.test(searchable)) score = 80;
      else if (/about|who-we-are|company|profile/.test(searchable)) score = 60;
      else if (/support|help|customer-care|locations?|offices?/.test(searchable)) score = 45;
      else if (/privacy|terms|legal|imprint/.test(searchable)) score = 25;
      if (!score) continue;
      const normalized = stripTrackingUrl(url.toString());
      scored.set(normalized, Math.max(score, scored.get(normalized) || 0));
    } catch {}
  }
  return [...scored.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([url]) => url)
    .slice(0, 10);
}

function extractEmailsFromHtml(html: string, pageUrl: string) {
  const candidates = new Map<string, number>();
  const pageHost = siteHost(new URL(pageUrl).hostname);
  const add = (value: string, score: number) => {
    let decoded = value;
    try { decoded = decodeURIComponent(value); } catch {}
    const email = decoded.replace(/^mailto:/i, "").split(/[?#,;]/)[0].trim().replace(/^[("'[<{]+|[)"'\]}>.,:;]+$/g, "").toLowerCase();
    if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?\.[a-z]{2,24}$/i.test(email)) return;
    if (/\.(?:png|jpe?g|gif|svg|webp|css|js|woff2?)$/i.test(email) || /^(?:example|test|email)\.(?:com|org|net)$/i.test(email.split("@")[1])) return;
    const local = email.split("@")[0];
    if (/^u[0-9a-f]{4}/i.test(local)) return;
    if (/^(?:no-?reply|donotreply|mailer-daemon)$/i.test(local)) return;
    const domainScore = siteHost(email.split("@")[1]) === pageHost ? 35 : 0;
    candidates.set(email, Math.max(score + domainScore, candidates.get(email) || 0));
  };

  const decoded = decodeEntities(html);
  for (const match of decoded.matchAll(/mailto:([^"'<>\\\s]+)/gi)) add(match[1], 70);
  for (const match of decoded.matchAll(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,24}/gi)) add(match[0], 35);
  const plain = htmlToText(decoded);
  for (const match of plain.matchAll(/([A-Z0-9._%+-]+)\s*(?:\[at\]|\(at\)|\sat\s)\s*([A-Z0-9.-]+)\s*(?:\[dot\]|\(dot\)|\sdot\s)\s*([A-Z]{2,24})/gi)) {
    add(`${match[1]}@${match[2]}.${match[3]}`, 45);
  }
  for (const match of html.matchAll(/data-cfemail=["']([0-9a-f]{6,})["']/gi)) {
    const decodedEmail = decodeCloudflareEmail(match[1]);
    if (decodedEmail) add(decodedEmail, 60);
  }
  return [...candidates.entries()].map(([email, score]) => ({ email, score }));
}

function decodeCloudflareEmail(hex: string) {
  try {
    const key = Number.parseInt(hex.slice(0, 2), 16);
    let value = "";
    for (let index = 2; index < hex.length; index += 2) value += String.fromCharCode(Number.parseInt(hex.slice(index, index + 2), 16) ^ key);
    return value;
  } catch {
    return "";
  }
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
  const websites: string[] = [];
  const matches = String(text || "").match(/(?:https?:\/\/|www\.)[^\s,;<>"']+|(?<!@)\b(?:[a-z0-9-]+\.)+[a-z]{2,24}(?:\/[^\s,;<>"']*)?/gi) || [];
  for (const match of matches) {
    if (match.includes("@")) continue;
    try {
      const website = stripTrackingUrl(safeWebsiteUrl(match));
      if (!websites.includes(website)) websites.push(website);
    } catch {}
  }
  return websites;
}

function cleanCampaignName(value: unknown) {
  return String(value || "").replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
}

function cleanText(value: unknown, maxLength: number) {
  return String(value || "").replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function cleanupTemplateText(value: string) {
  return value
    .split("\n")
    .map((line) => {
      let clean = line
        .replace(/\{\{\s*[^{}]{1,80}\s*\}\}/g, "")
        .replace(/[ \t]+/g, " ")
        .replace(/\b(?:with|using|through|about|regarding|around|for)\s+(?=(?:to|and|or)\b|[,.;:!?]|$)/gi, "")
        .replace(/\s+([,.;:!?])/g, "$1")
        .replace(/([,;:])(?:\s*[,;:])+/g, "$1")
        .trim();
      if (!clean || /^[-•*]\s*$/.test(clean) || /^[^.!?]{1,60}:\s*$/.test(clean)) return "";
      if (/\b(?:is|are|was|were|with|for|about|using|through|includes?|offers?|provides?)\s*[.!?]$/i.test(clean)) return "";
      return clean;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanupUnresolvedHtml(value: unknown) {
  let html = String(value || "")
    .replace(/\{\{\s*[^{}]{1,80}\s*\}\}/g, "")
    .replace(/\b(?:with|using|through|about|regarding|around|for)(?:\s|&nbsp;)+(?=(?:to|and|or)\b|[,.;:!?])/gi, "")
    .replace(/(?:\s|&nbsp;)+([,.;:!?])/g, "$1")
    .replace(/<(strong|u|em|b)>\s*<\/\1>/gi, "");
  html = html
    .replace(/<(p|li)>\s*(?:<br\s*\/?>\s*)*<\/\1>/gi, "")
    .replace(/<ul>\s*<\/ul>/gi, "")
    .replace(/[ \t]{2,}/g, " ");
  return html.trim();
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
  const withTokens = template.replace(/\{\{\s*([a-z][a-z0-9_.-]{0,79})\s*\}\}/gi, (_, key: string) => {
    const value = tokenValues[key.toLowerCase()] || "";
    if (!value) return "";
    const marker = `IKFPERSONALIZATIONTOKEN${tokens.length}END`;
    tokens.push(value);
    return marker;
  });
  let safe = escapeHtml(cleanupTemplateText(withTokens));
  tokens.forEach((value, index) => {
    safe = safe.replace(`IKFPERSONALIZATIONTOKEN${index}END`, value);
  });
  safe = safe.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  return cleanupUnresolvedHtml(safe
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
    .join(""));
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

function chunk<T>(items: T[], size: number) {
  const groups: T[][] = [];
  for (let index = 0; index < items.length; index += size) groups.push(items.slice(index, index + size));
  return groups;
}

function buildCampaignSchedule(start: Date, count: number, delayMinutes: number, policy: Record<string, any>) {
  const indiaOffsetMinutes = 330;
  const windowStart = parseClock(String(policy.sending_window_start || "10:00"));
  const windowEnd = parseClock(String(policy.sending_window_end || "17:00"));
  if (windowEnd <= windowStart) throw new Error("The sending window end must be later than its start.");
  if (!insideIndiaWindow(start, String(policy.sending_window_start || "10:00"), String(policy.sending_window_end || "17:00"))) {
    throw new Error(`Choose a start time inside the ${policy.sending_window_start || "10:00"}–${policy.sending_window_end || "17:00"} Asia/Kolkata sending window.`);
  }
  const dailyLimit = Math.max(1, Math.min(1000, Number(policy.daily_limit || 25)));
  const dayCounts = new Map<string, number>();
  const times: Date[] = [];
  let cursor = new Date(start);
  for (let index = 0; index < count; index += 1) {
    while (true) {
      const shifted = new Date(cursor.getTime() + indiaOffsetMinutes * 60_000);
      const year = shifted.getUTCFullYear();
      const month = shifted.getUTCMonth();
      const day = shifted.getUTCDate();
      const minutes = shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
      const dayKey = `${year}-${month + 1}-${day}`;
      const used = dayCounts.get(dayKey) || 0;
      if (minutes < windowStart) {
        cursor = indiaLocalDate(year, month, day, windowStart, indiaOffsetMinutes);
        continue;
      }
      if (minutes > windowEnd || used >= dailyLimit) {
        cursor = indiaLocalDate(year, month, day + 1, windowStart, indiaOffsetMinutes);
        continue;
      }
      times.push(new Date(cursor));
      dayCounts.set(dayKey, used + 1);
      cursor = new Date(cursor.getTime() + delayMinutes * 60_000);
      break;
    }
  }
  return times;
}

function parseClock(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw new Error("The configured sending window is invalid.");
  }
  return hours * 60 + minutes;
}

function indiaLocalDate(year: number, month: number, day: number, minutes: number, offsetMinutes: number) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return new Date(Date.UTC(year, month, day, hours, mins) - offsetMinutes * 60_000);
}

function insideIndiaWindow(date: Date, start: string, end: string) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
  return parts >= start && parts <= end;
}

async function submitBrevo(mail: Record<string, any>, contact: Record<string, any>, scheduledAt?: string) {
  const htmlContent = cleanupUnresolvedHtml(mail.html_body);
  const campaignSender = await senderForMail(mail);
  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": process.env.BREVO_API_KEY || "", "Content-Type": "application/json" },
    body: JSON.stringify({
      sender: campaignSender,
      replyTo: { email: replyTo() },
      to: [{ email: contact.email, name: contact.full_name || undefined }],
      subject: mail.subject,
      htmlContent,
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
  const htmlContent = cleanupUnresolvedHtml(mail.html_body);
  const campaignSender = await senderForMail(mail);
  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": process.env.BREVO_API_KEY || "", "Content-Type": "application/json" },
    body: JSON.stringify({
      sender: campaignSender,
      replyTo: { email: replyTo() },
      to: [{ email: testRecipient, name: "IKF Test Recipient" }],
      subject: `[TEST PREVIEW] ${mail.subject}`,
      htmlContent: `${previewBanner}${htmlContent}`,
      tags: ["ikf-outreach", "test-preview"],
    }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || "Brevo rejected the test email.");
  return result;
}

async function senderForMail(mail: Record<string, any>) {
  if (mail.campaign_id) {
    const campaigns = await db(`campaigns?select=sender_name,sender_email&id=eq.${mail.campaign_id}&limit=1`);
    if (campaigns[0]?.sender_email) {
      return {
        name: String(campaigns[0].sender_name || campaigns[0].sender_email.split("@")[0]),
        email: String(campaigns[0].sender_email).toLowerCase(),
      };
    }
  }
  return sender;
}
