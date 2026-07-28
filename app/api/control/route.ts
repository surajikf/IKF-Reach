import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const supabaseUrl = () => process.env.SUPABASE_URL || "";
const supabaseKey = () => process.env.SUPABASE_SECRET_KEY || "";
const sender = { name: process.env.BREVO_SENDER_NAME || "Tanishka", email: process.env.BREVO_SENDER_EMAIL || "tanishka@iknowai.in" };
const replyTo = () => process.env.BREVO_REPLY_TO_EMAIL || "sales@ikf.co.in";

function actor(req: NextRequest) {
  return req.headers.get("oai-authenticated-user-email") || "workspace-owner";
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

export async function GET() {
  try {
    const [queue, jobs, settings, campaigns] = await Promise.all([
      db("outreach_queue?select=*&order=created_at.desc&limit=40"),
      db("research_jobs?select=*&order=created_at.desc&limit=25"),
      db("outreach_settings?select=*&key=eq.sending_policy"),
      db("campaigns?select=id,name,status,sender_name,sender_email&order=created_at.desc"),
    ]);
    let brevo = false;
    try {
      const check = await fetch("https://api.brevo.com/v3/account", { headers: { "api-key": process.env.BREVO_API_KEY || "" } });
      brevo = check.ok;
    } catch {}
    return NextResponse.json({ ok: true, providers: { database: true, brevo }, queue, jobs, settings: settings[0]?.value || {}, campaigns, sender, replyTo: replyTo() });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Unable to load controls" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
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

    if (body.action === "schedule") {
      if (!body.scheduledFor) return NextResponse.json({ ok: false, error: "Choose a schedule time." }, { status: 400 });
      const mails = await db(`generated_emails?select=*&id=eq.${body.emailId}&limit=1`);
      const mail = mails[0];
      const rows = await db("outreach_queue", { method: "POST", body: JSON.stringify({ id: crypto.randomUUID(), generated_email_id: mail.id, contact_id: mail.contact_id, campaign_id: mail.campaign_id, status: "scheduled", scheduled_for: body.scheduledFor, approved_by: user, approved_at: new Date().toISOString() }) });
      await db(`generated_emails?id=eq.${mail.id}`, { method: "PATCH", body: JSON.stringify({ status: "scheduled" }) });
      return NextResponse.json({ ok: true, queue: rows[0] });
    }

    if (body.action === "send_now") {
      if (body.confirm !== true) return NextResponse.json({ ok: false, error: "Explicit confirmation is required." }, { status: 400 });
      const mails = await db(`generated_emails?select=*&id=eq.${body.emailId}&limit=1`);
      const mail = mails[0];
      const contacts = await db(`contacts?select=*&id=eq.${mail.contact_id}&limit=1`);
      const contact = contacts[0];
      const response = await fetch("https://api.brevo.com/v3/smtp/email", { method: "POST", headers: { "api-key": process.env.BREVO_API_KEY || "", "Content-Type": "application/json" }, body: JSON.stringify({ sender, replyTo: { email: replyTo() }, to: [{ email: contact.email, name: contact.full_name || undefined }], subject: mail.subject, htmlContent: mail.html_body }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Brevo rejected the send request.");
      await db("email_sends", { method: "POST", body: JSON.stringify({ id: crypto.randomUUID(), generated_email_id: mail.id, company_id: mail.company_id, contact_id: mail.contact_id, campaign_id: mail.campaign_id, sender_name: sender.name, sender_email: sender.email, recipient_email: contact.email, subject: mail.subject, brevo_message_id: result.messageId, status: "sent", sent_at: new Date().toISOString() }) });
      await db(`generated_emails?id=eq.${mail.id}`, { method: "PATCH", body: JSON.stringify({ status: "sent" }) });
      return NextResponse.json({ ok: true, messageId: result.messageId });
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
