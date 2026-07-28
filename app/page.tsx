"use client";

import { useEffect, useMemo, useState } from "react";
import data from "./dashboard-data.json";

type Section = "overview" | "create" | "campaigns" | "emails" | "queue" | "contacts" | "companies" | "settings" | "activity";
type EmailRecord = { id: string; company: string; recipient: string; subject: string; campaign: string; html: string; status: string; sendStatus?: string | null; version: number; generatedAt: string };
type ContactRecord = { id: string; companyId?: string | null; name?: string | null; email: string; role?: string | null; confidence?: string | null; company: string; industry?: string | null; companyWebsite?: string | null; companyCountry?: string | null; createdAt?: string | null };
type CompanyRecord = { id: string; name: string; website?: string | null; industry?: string | null; country?: string | null; contacts: number; drafts: number; updatedAt?: string | null };
type ActivityRecord = { id?: string | number; action: string; company?: string | null; email?: string | null; createdAt: string };
type LiveStats = { companies: number; contacts: number; emails: number; pendingReview: number; approved: number; scheduled: number; sent: number; failed: number };
type ControlData = {
  ok: boolean;
  canManage?: boolean;
  operator?: string | null;
  providers?: { database: boolean; brevo: boolean };
  queue?: Array<Record<string, any>>;
  jobs?: Array<Record<string, any>>;
  settings?: Record<string, any>;
  campaigns?: Array<Record<string, any>>;
  liveEmails?: EmailRecord[];
  liveContacts?: ContactRecord[];
  liveCompanies?: CompanyRecord[];
  liveActivity?: ActivityRecord[];
  liveStats?: LiveStats;
  sender?: { name: string; email: string };
  replyTo?: string;
  refreshedAt?: string;
  scheduling?: { provider: string; timezone: string; maximumHoursAhead: number };
  error?: string;
};

const navItems: Array<{ id: Section; label: string; icon: string }> = [
  { id: "overview", label: "Overview", icon: "⌂" },
  { id: "create", label: "Create outreach", icon: "+" },
  { id: "campaigns", label: "Campaigns", icon: "▦" },
  { id: "emails", label: "Emails", icon: "✉" },
  { id: "queue", label: "Approval queue", icon: "✓" },
  { id: "contacts", label: "Contacts", icon: "◎" },
  { id: "companies", label: "Companies", icon: "◇" },
  { id: "settings", label: "Controls & APIs", icon: "⚙" },
  { id: "activity", label: "Activity", icon: "↗" },
];

const statusLabel: Record<string, string> = {
  draft_pending_review: "Needs review",
  sent: "Sent",
  send_failed: "Send failed",
  failed_insufficient_credits: "Failed",
  not_sent_insufficient_credits: "Not sent",
  active: "Active",
  approved: "Ready",
  scheduled: "Scheduled",
  running: "Running",
  completed: "Sent",
  needs_attention: "Needs attention",
  empty: "Empty",
  paused_no_credits: "Paused",
  paused_user_hold: "On hold",
};

function prettyStatus(value?: string | null) {
  if (!value) return "Draft";
  return statusLabel[value] || value.replaceAll("_", " ");
}

function statusTone(value?: string | null) {
  if (!value || value.includes("draft") || value.includes("review")) return "review";
  if (value === "sent" || value === "active" || value === "delivered" || value === "completed") return "good";
  if (value.includes("fail") || value.includes("not_sent")) return "bad";
  return "neutral";
}

function compactDate(value?: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function shortName(name: string) {
  return name.length > 43 ? `${name.slice(0, 43)}…` : name;
}

const genericMailboxWords = new Set([
  "admin", "business", "care", "communications", "connect", "contact", "coordinator",
  "enquiry", "enquiries", "forum", "general", "hello", "help", "hr", "info",
  "mail", "marketing", "membership", "office", "president", "sales", "secretary",
  "service", "support", "team",
]);

function contactDisplayName(contact: ContactRecord) {
  if (contact.name?.trim() && contact.name.trim().toLowerCase() !== "sir/madam") return contact.name.trim();

  const parts = contact.email.split("@")[0].toLowerCase().split(/[._-]+/).filter(Boolean);
  const looksLikePerson = parts.length >= 2 && parts.length <= 4 && parts.every((part) =>
    /^[a-z]{2,20}$/.test(part) && !genericMailboxWords.has(part)
  );

  return looksLikePerson
    ? parts.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ")
    : "Sir/Madam";
}

function personalizeGreeting(html: string, recipient: string, contacts: ContactRecord[]) {
  const contact = contacts.find((item) => item.email.toLowerCase() === recipient.toLowerCase());
  if (!contact) return html;
  const name = contactDisplayName(contact);
  return name === "Sir/Madam" ? html : html.replace(/Dear\s+(?:Sir\/?Madam|Sir or Madam)/i, `Dear ${name}`);
}

function StatusPill({ value }: { value?: string | null }) {
  return <span className={`status-pill ${statusTone(value)}`}>{prettyStatus(value)}</span>;
}

function Metric({ label, value, note, tone }: { label: string; value: number; note: string; tone: string }) {
  return (
    <article className="metric-card">
      <div className={`metric-icon ${tone}`} aria-hidden="true" />
      <div>
        <p>{label}</p>
        <strong>{value.toLocaleString("en-IN")}</strong>
        <span>{note}</span>
      </div>
    </article>
  );
}

function EmailTable({ rows, onOpen, compact = false, selected, onSelect }: { rows: EmailRecord[]; onOpen: (email: EmailRecord) => void; compact?: boolean; selected?: Set<string>; onSelect?: (id: string, checked: boolean) => void }) {
  const selectable = Boolean(selected && onSelect);
  const allSelected = selectable && rows.length > 0 && rows.every((email) => selected!.has(email.id));
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {selectable && <th className="check-column"><input type="checkbox" checked={allSelected} onChange={(event) => rows.forEach((email) => onSelect!(email.id, event.target.checked))} aria-label="Select all emails on this page" /></th>}
            <th>Company & recipient</th>
            <th>Subject</th>
            <th>Status</th>
            {!compact && <th>Campaign</th>}
            <th>Generated</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((email) => (
            <tr key={email.id} className={selected?.has(email.id) ? "selected-row" : ""} onClick={() => onOpen(email)} tabIndex={0} onKeyDown={(event) => event.key === "Enter" && onOpen(email)}>
              {selectable && <td className="check-column" onClick={(event) => event.stopPropagation()}><input type="checkbox" checked={selected!.has(email.id)} onChange={(event) => onSelect!(email.id, event.target.checked)} aria-label={`Select ${email.subject}`} /></td>}
              <td>
                <strong>{shortName(email.company)}</strong>
                <span>{email.recipient}</span>
              </td>
              <td className="subject-cell">{email.subject}</td>
              <td><StatusPill value={email.sendStatus || email.status} /></td>
              {!compact && <td>{email.campaign}</td>}
              <td>{compactDate(email.generatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <div className="empty-state">No records match these filters.</div>}
    </div>
  );
}

export default function Home() {
  const [section, setSection] = useState<Section>("overview");
  const [search, setSearch] = useState("");
  const [emailStatus, setEmailStatus] = useState("all");
  const [emailCampaign, setEmailCampaign] = useState("all");
  const [page, setPage] = useState(1);
  const [selectedEmail, setSelectedEmail] = useState<EmailRecord | null>(null);
  const [selectedContact, setSelectedContact] = useState<ContactRecord | null>(null);
  const [contactForm, setContactForm] = useState({ name: "", email: "", role: "", company: "", industry: "", website: "", country: "" });
  const [control, setControl] = useState<ControlData | null>(null);
  const [working, setWorking] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState("");
  const [noticeTone, setNoticeTone] = useState<"success" | "error">("success");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkMode, setBulkMode] = useState<"schedule" | "send" | "test" | null>(null);
  const [bulkForm, setBulkForm] = useState({ scheduledFor: "", delayMinutes: 5, confirmed: false, confirmText: "", testRecipients: "" });
  const [intakeForm, setIntakeForm] = useState({
    campaignName: "AI Native Thinking Masterclass Outreach",
    topic: "AI Native Thinking Masterclass",
    emailTemplate: `Dear {{name}},

While reviewing {{company}}, I noted its focus on {{research}}. This creates a relevant opportunity to apply {{topic}} thinking across {{focus_areas}}.

We would be delighted to conduct a practical {{topic}} session tailored to your leadership and functional teams.

Please let me know a suitable time to connect.`,
    rawInput: "",
    websites: "",
    brief: "",
  });
  const [intakeFile, setIntakeFile] = useState<File | null>(null);
  const [intakeResults, setIntakeResults] = useState<Array<Record<string, any>>>([]);
  const [queueForm, setQueueForm] = useState({ campaignId: "", scheduledFor: "", delayMinutes: 5, confirmed: false });
  const [campaignStatusFilter, setCampaignStatusFilter] = useState("all");
  const pageSize = 20;

  async function loadControl() {
    setRefreshing(true);
    try {
      const response = await fetch("/api/control");
      const result = await response.json();
      setControl(result);
    } catch {
      setControl({ ok: false, error: "Unable to reach the control service." });
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => { loadControl(); }, []);

  async function runAction(payload: Record<string, any>, success: string) {
    setWorking(true);
    setNotice("");
    try {
      const response = await fetch("/api/control", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Action could not be completed.");
      setNoticeTone("success");
      setNotice(success);
      await loadControl();
      return result;
    } catch (error) {
      setNoticeTone("error");
      setNotice(error instanceof Error ? error.message : "Action failed.");
    } finally {
      setWorking(false);
    }
  }

  const displayEmails = useMemo<EmailRecord[]>(() => control?.liveEmails?.length ? control.liveEmails : data.emails as EmailRecord[], [control?.liveEmails]);
  const displayContacts = useMemo<ContactRecord[]>(() => control?.liveContacts?.length ? control.liveContacts : data.contacts as ContactRecord[], [control?.liveContacts]);
  const displayCompanies = useMemo<CompanyRecord[]>(() => control?.liveCompanies?.length ? control.liveCompanies : data.companies as CompanyRecord[], [control?.liveCompanies]);
  const displayActivity = useMemo<ActivityRecord[]>(() => control?.liveActivity?.length ? control.liveActivity : data.activity as ActivityRecord[], [control?.liveActivity]);
  const stats = useMemo<LiveStats>(() => control?.liveStats || {
    companies: data.summary.companies,
    contacts: data.summary.contacts,
    emails: data.summary.emails,
    pendingReview: data.summary.pendingReview,
    approved: 0,
    scheduled: 0,
    sent: data.summary.sent,
    failed: data.summary.failed,
  }, [control?.liveStats]);
  const paused = control?.settings?.paused ?? true;
  const displayCampaigns = useMemo(() => control?.campaigns?.length ? control.campaigns.map((campaign) => ({
    id: String(campaign.id || campaign.name),
    name: String(campaign.name || "Outreach"),
    status: paused ? "paused_user_hold" : String(campaign.status || "active"),
    drafts: displayEmails.filter((email) => email.campaign === campaign.name).length,
    senderName: String(campaign.sender_name || control.sender?.name || "Tanishka"),
    senderEmail: String(campaign.sender_email || control.sender?.email || "tanishka@iknowai.in"),
  })) : data.campaigns.map((campaign) => ({ ...campaign, id: campaign.name })), [control?.campaigns, control?.sender, displayEmails, paused]);
  const selectedCampaign = displayCampaigns.find((campaign) => campaign.id === queueForm.campaignId) || displayCampaigns[0];
  const selectedCampaignEmails = selectedCampaign ? displayEmails.filter((email) => email.campaign === selectedCampaign.name) : [];
  const selectedCampaignDrafts = selectedCampaignEmails.filter((email) => email.status === "draft_pending_review").length;
  const selectedCampaignApproved = selectedCampaignEmails.filter((email) => email.status === "approved").length;
  const selectedCampaignScheduled = selectedCampaignEmails.filter((email) => email.status === "scheduled" || String(email.sendStatus || "").startsWith("scheduled")).length;
  const selectedCampaignSent = selectedCampaignEmails.filter((email) => email.status === "sent" || email.sendStatus === "sent").length;
  const scheduledCampaignGroups = useMemo(() => {
    const groups = new Map<string, { id: string; name: string; count: number; first: string | null; last: string | null }>();
    for (const item of control?.queue || []) {
      if (!String(item.status || "").includes("scheduled")) continue;
      const campaign = displayCampaigns.find((entry) => entry.id === item.campaign_id);
      const key = String(item.campaign_id || "unknown");
      const time = item.scheduled_for ? String(item.scheduled_for) : null;
      const current = groups.get(key) || { id: key, name: campaign?.name || "Campaign", count: 0, first: null, last: null };
      current.count += 1;
      if (time && (!current.first || time < current.first)) current.first = time;
      if (time && (!current.last || time > current.last)) current.last = time;
      groups.set(key, current);
    }
    return [...groups.values()];
  }, [control?.queue, displayCampaigns]);
  const campaignSummaries = useMemo(() => displayCampaigns.map((campaign) => {
    const emails = displayEmails.filter((email) => email.campaign === campaign.name);
    const needsReview = emails.filter((email) => email.status === "draft_pending_review").length;
    const approved = emails.filter((email) => email.status === "approved").length;
    const scheduled = emails.filter((email) => email.status === "scheduled" || String(email.sendStatus || "").startsWith("scheduled")).length;
    const sent = emails.filter((email) => email.status === "sent" || email.sendStatus === "sent").length;
    const failed = emails.filter((email) => String(email.sendStatus || email.status).includes("fail") || String(email.sendStatus || email.status).includes("not_sent")).length;
    const latestGeneratedAt = emails.reduce<string | null>((latest, email) => !latest || email.generatedAt > latest ? email.generatedAt : latest, null);
    const queued = scheduledCampaignGroups.find((item) => item.id === campaign.id);
    let lifecycle = "empty";
    if (failed > 0) lifecycle = "needs_attention";
    else if (sent > 0 && sent < emails.length) lifecycle = "running";
    else if (emails.length > 0 && sent === emails.length) lifecycle = "completed";
    else if (scheduled > 0) lifecycle = "scheduled";
    else if (approved > 0) lifecycle = "approved";
    else if (needsReview > 0) lifecycle = "draft_pending_review";
    const progressed = sent + scheduled;
    return {
      ...campaign,
      emails,
      total: emails.length,
      needsReview,
      approved,
      scheduled,
      sent,
      failed,
      lifecycle,
      progress: emails.length ? Math.round((progressed / emails.length) * 100) : 0,
      latestGeneratedAt,
      firstScheduledAt: queued?.first || null,
      lastScheduledAt: queued?.last || null,
    };
  }), [displayCampaigns, displayEmails, scheduledCampaignGroups]);
  const selectedCampaignSummary = campaignSummaries.find((campaign) => campaign.id === queueForm.campaignId) || campaignSummaries[0];
  const filteredCampaigns = useMemo(() => {
    const term = search.trim().toLowerCase();
    return campaignSummaries.filter((campaign) => {
      const matchesTerm = !term || `${campaign.name} ${campaign.senderName} ${campaign.senderEmail}`.toLowerCase().includes(term);
      const matchesStatus = campaignStatusFilter === "all" ||
        (campaignStatusFilter === "active" && ["approved", "scheduled", "running"].includes(campaign.lifecycle)) ||
        campaign.lifecycle === campaignStatusFilter;
      return matchesTerm && matchesStatus;
    });
  }, [campaignSummaries, campaignStatusFilter, search]);
  const campaignPortfolioStats = useMemo(() => ({
    total: campaignSummaries.length,
    draft: campaignSummaries.filter((campaign) => campaign.lifecycle === "draft_pending_review").length,
    active: campaignSummaries.filter((campaign) => ["approved", "scheduled", "running"].includes(campaign.lifecycle)).length,
    sent: campaignSummaries.filter((campaign) => campaign.lifecycle === "completed").length,
    attention: campaignSummaries.filter((campaign) => campaign.lifecycle === "needs_attention").length,
  }), [campaignSummaries]);
  const filteredEmails = useMemo(() => {
    const term = search.trim().toLowerCase();
    return displayEmails.filter((email) => {
      const matchesTerm = !term || `${email.company} ${email.recipient} ${email.subject} ${email.campaign}`.toLowerCase().includes(term);
      const status = email.sendStatus || email.status;
      const matchesStatus = emailStatus === "all" ||
        (emailStatus === "draft" && status === "draft_pending_review") ||
        (emailStatus === "failed" && Boolean(status?.includes("fail") || status?.includes("not_sent"))) ||
        status === emailStatus;
      const matchesCampaign = emailCampaign === "all" || email.campaign === emailCampaign;
      return matchesTerm && matchesStatus && matchesCampaign;
    });
  }, [displayEmails, search, emailStatus, emailCampaign]);

  const pagedEmails = filteredEmails.slice((page - 1) * pageSize, page * pageSize);
  const pages = Math.max(1, Math.ceil(filteredEmails.length / pageSize));
  const pageTitle = navItems.find((item) => item.id === section)?.label || "Overview";

  useEffect(() => {
    if (page > pages) setPage(pages);
  }, [page, pages]);

  useEffect(() => {
    if (displayCampaigns.length && !displayCampaigns.some((campaign) => campaign.id === queueForm.campaignId)) {
      setQueueForm((current) => ({ ...current, campaignId: displayCampaigns[0].id }));
    }
  }, [displayCampaigns, queueForm.campaignId]);

  useEffect(() => {
    if (!selectedEmail && !selectedContact) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedEmail(null);
        setSelectedContact(null);
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [selectedEmail, selectedContact]);

  function switchSection(next: Section) {
    setSection(next);
    setSearch("");
    setPage(1);
  }

  function toggleSelected(id: string, checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      checked ? next.add(id) : next.delete(id);
      return next;
    });
  }

  async function runBulkSchedule() {
    const scheduleDate = new Date(bulkForm.scheduledFor);
    if (!Number.isFinite(scheduleDate.getTime())) {
      setNoticeTone("error");
      setNotice("Choose a valid date and time before scheduling.");
      return;
    }
    const result = await runAction({
      action: "schedule_batch",
      emailIds: [...selectedIds],
      scheduledFor: scheduleDate.toISOString(),
      delayMinutes: bulkForm.delayMinutes,
      confirm: bulkForm.confirmed,
    }, `${selectedIds.size} emails were securely scheduled with Brevo.`);
    if (result?.ok) {
      setSelectedIds(new Set());
      setBulkMode(null);
      setBulkForm({ scheduledFor: "", delayMinutes: 5, confirmed: false, confirmText: "", testRecipients: "" });
    }
  }

  async function runBulkSend() {
    const result = await runAction({ action: "send_batch", emailIds: [...selectedIds], confirmText: bulkForm.confirmText }, `${selectedIds.size} emails were accepted by Brevo.`);
    if (result?.ok) {
      setSelectedIds(new Set());
      setBulkMode(null);
    }
  }

  async function runTestSend() {
    const testRecipient = bulkForm.testRecipients.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testRecipient)) {
      setNoticeTone("error");
      setNotice("Enter one valid email address to receive the test copy.");
      return;
    }
    const result = await runAction({
      action: "send_test",
      emailIds: [...selectedIds],
      testRecipients: testRecipient,
      confirm: bulkForm.confirmed,
    }, `Test copies sent successfully. The original recipients and draft statuses were not changed.`);
    if (result?.ok) {
      setBulkMode(null);
      setBulkForm({ scheduledFor: "", delayMinutes: 5, confirmed: false, confirmText: "", testRecipients: "" });
    }
  }

  async function approveSelectedCampaign() {
    const ids = selectedCampaignEmails.filter((email) => email.status === "draft_pending_review").map((email) => email.id);
    if (!ids.length) {
      setNoticeTone("success");
      setNotice("Every draft in this campaign is already approved or scheduled.");
      return;
    }
    await runAction({ action: "approve_batch", emailIds: ids }, `${ids.length} campaign drafts approved. Nothing has been sent.`);
  }

  async function scheduleSelectedCampaign() {
    if (!selectedCampaign) return;
    if (!queueForm.scheduledFor) {
      setNoticeTone("error");
      setNotice("Choose the campaign start date and time.");
      return;
    }
    const result = await runAction({
      action: "schedule_campaign",
      campaignId: selectedCampaign.id,
      scheduledFor: new Date(queueForm.scheduledFor).toISOString(),
      delayMinutes: queueForm.delayMinutes,
      confirm: queueForm.confirmed,
    }, `${selectedCampaign.name} was handed to Brevo for automatic scheduled delivery.`);
    if (result?.ok) {
      setNoticeTone("success");
      setNotice(`${result.scheduled} emails scheduled with Brevo${result.failed ? `; ${result.failed} need attention` : ""}. Delivery continues after the dashboard is closed.`);
      setQueueForm((current) => ({ ...current, confirmed: false }));
    }
  }

  async function runIntelligenceStudio() {
    let document: Record<string, string> | undefined;
    if (!intakeForm.rawInput.trim() && !intakeForm.websites.trim() && !intakeFile) {
      setNoticeTone("error");
      setNotice("Add email addresses, company websites, or a contact document first.");
      return;
    }
    if (!intakeForm.campaignName.trim() || !intakeForm.topic.trim() || !intakeForm.emailTemplate.trim()) {
      setNoticeTone("error");
      setNotice("Add a campaign name, email topic, and template before creating drafts.");
      return;
    }
    if (intakeFile) {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("The selected document could not be read."));
        reader.readAsDataURL(intakeFile);
      });
      document = { name: intakeFile.name, type: intakeFile.type, dataBase64: dataUrl };
    }
    const result = await runAction({ action: "research_batch", ...intakeForm, document }, "Research completed and personalized drafts were created for review.");
    if (result?.ok) setIntakeResults(result.results || []);
  }

  function handleFileSelection(file: File | null) {
    if (!file) {
      setIntakeFile(null);
      return;
    }
    const extension = file.name.split(".").pop()?.toLowerCase() || "";
    if (!["pdf", "docx", "csv", "tsv", "txt"].includes(extension)) {
      setNoticeTone("error");
      setNotice("Choose a PDF, DOCX, CSV, TSV, or TXT file.");
      return;
    }
    if (file.size > 6 * 1024 * 1024) {
      setNoticeTone("error");
      setNotice("The selected document is larger than 6 MB.");
      return;
    }
    setIntakeFile(file);
  }

  function openContactEditor(contact: ContactRecord) {
    setSelectedContact(contact);
    setContactForm({
      name: contact.name || "",
      email: contact.email,
      role: contact.role || "",
      company: contact.company || "",
      industry: contact.industry || "",
      website: contact.companyWebsite || "",
      country: contact.companyCountry || "",
    });
  }

  async function saveContact() {
    if (!selectedContact) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactForm.email.trim())) {
      setNoticeTone("error");
      setNotice("Enter a valid contact email address.");
      return;
    }
    if (!contactForm.company.trim()) {
      setNoticeTone("error");
      setNotice("Add the contact’s company or organization.");
      return;
    }
    const result = await runAction({
      action: "update_contact",
      contactId: selectedContact.id,
      ...contactForm,
    }, "Contact and organization details were updated in the database.");
    if (result?.ok) setSelectedContact(null);
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-mark"><span>IKF</span><b>Outreach</b></div>
        <p className="brand-caption">AI email operations</p>
        <nav aria-label="Dashboard sections">
          {navItems.map((item) => (
            <button key={item.id} className={section === item.id ? "active" : ""} onClick={() => switchSection(item.id)}>
              <span aria-hidden="true">{item.icon}</span>{item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span className="sync-dot" />
          <div>
            <strong>Live database</strong>
            <small>{refreshing ? "Refreshing…" : control?.refreshedAt ? `Updated ${new Date(control.refreshedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}` : "Connecting…"}</small>
          </div>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div>
            <p className="eyebrow">Masterclass outreach</p>
            <h1>{pageTitle}</h1>
          </div>
          <div className="top-actions">
            <label className="global-search">
              <span aria-hidden="true">⌕</span>
              <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search records" aria-label="Search records" />
            </label>
            <button className="refresh-button" onClick={loadControl} disabled={refreshing} aria-label="Refresh live dashboard data">{refreshing ? "Refreshing…" : "Refresh"}</button>
            <div className="avatar" aria-label="Tanishka">T</div>
          </div>
        </header>

        <div className="content">
          {!control && (
            <section className="system-banner loading-banner" role="status"><span className="loading-spinner" /><div><strong>Loading live outreach data</strong><p>Connecting to Supabase and Brevo.</p></div></section>
          )}
          {control && !control.ok && (
            <section className="system-banner error-banner" role="alert"><div><strong>Live data is temporarily unavailable</strong><p>{control.error || "Please try the connection again."}</p></div><button onClick={loadControl}>Retry</button></section>
          )}
          {control?.ok && !control.canManage && (
            <section className="access-banner">
              <div><strong>Public view · sending controls are locked</strong><p>Sign in with an authorized IKF account to approve, schedule, cancel, or send emails.</p></div>
              <a href="/signin-with-chatgpt?return_to=%2F">Sign in to manage</a>
            </section>
          )}
          {section === "overview" && (
            <>
              <section className={`credit-alert ${paused ? "" : "active-alert"}`} aria-label="Sending status">
                <span className="alert-icon">{paused ? "!" : "✓"}</span>
                <div><strong>{paused ? "Sending is on hold" : "Sending controls are active"}</strong><p>{paused ? "No campaign email can be scheduled or sent until an authorized operator turns off Pause all." : "Manual approval and confirmation are still required before every campaign send."} Drafts use Tanishka &lt;tanishka@iknowai.in&gt;.</p></div>
                <StatusPill value={paused ? "paused_user_hold" : "active"} />
              </section>

              <section className="metric-grid" aria-label="Outreach totals">
                <Metric label="Generated emails" value={stats.emails} note={`Across ${displayCampaigns.length} campaigns`} tone="violet" />
                <Metric label="Needs review" value={stats.pendingReview} note="Before approval or scheduling" tone="amber" />
                <Metric label="Contacts" value={stats.contacts} note={`${stats.companies} companies`} tone="blue" />
                <Metric label="Successful sends" value={stats.sent} note={`${stats.failed} failed attempts recorded`} tone="green" />
              </section>

              <section className="overview-grid">
                <article className="panel campaigns-panel">
                  <div className="panel-heading"><div><p className="eyebrow">Campaign health</p><h2>Active workstreams</h2></div><span>{displayCampaigns.length} campaigns</span></div>
                  <div className="campaign-list">
                    {displayCampaigns.map((campaign) => (
                      <div className="campaign-row" key={campaign.name}>
                        <div className="campaign-symbol">{campaign.name.slice(0, 2).toUpperCase()}</div>
                        <div className="campaign-copy"><strong>{campaign.name}</strong><span>{campaign.senderName} · {campaign.senderEmail}</span></div>
                        <div className="campaign-numbers"><strong>{campaign.drafts}</strong><span>emails</span></div>
                        <StatusPill value={campaign.status} />
                      </div>
                    ))}
                  </div>
                </article>

                <article className="panel delivery-panel">
                  <div className="panel-heading"><div><p className="eyebrow">Delivery readiness</p><h2>Campaign funnel</h2></div></div>
                  <div className="funnel-list">
                    <div><span>Imported contacts</span><strong>{stats.contacts}</strong><i style={{ width: "100%" }} /></div>
                    <div><span>Generated emails</span><strong>{stats.emails}</strong><i style={{ width: `${Math.min(100, Math.round(stats.emails / Math.max(1, stats.contacts) * 100))}%` }} /></div>
                    <div><span>Approved</span><strong>{stats.approved}</strong><i style={{ width: `${Math.max(1, Math.round(stats.approved / Math.max(1, stats.emails) * 100))}%` }} /></div>
                    <div><span>Scheduled</span><strong>{stats.scheduled}</strong><i style={{ width: `${Math.max(1, Math.round(stats.scheduled / Math.max(1, stats.emails) * 100))}%` }} /></div>
                    <div><span>Sent</span><strong>{stats.sent}</strong><i style={{ width: `${Math.max(1, Math.round(stats.sent / Math.max(1, stats.emails) * 100))}%` }} /></div>
                  </div>
                </article>
              </section>

              <section className="panel recent-panel">
                <div className="panel-heading"><div><p className="eyebrow">Latest output</p><h2>Recently generated emails</h2></div><button className="text-button" onClick={() => switchSection("emails")}>View all {stats.emails} →</button></div>
                <EmailTable rows={displayEmails.slice(0, 7)} onOpen={setSelectedEmail} compact />
              </section>
            </>
          )}

          {section === "campaigns" && (
            <section className="campaigns-hub">
              <article className="panel campaign-portfolio-hero">
                <div>
                  <p className="eyebrow">Campaign portfolio</p>
                  <h2>Every outreach campaign in one place</h2>
                  <p>See what is still being drafted, ready for approval, scheduled, running, sent, or needs attention.</p>
                </div>
                <button className="primary-action" onClick={() => switchSection("create")}>Create new campaign</button>
              </article>

              <section className="campaign-portfolio-metrics" aria-label="Campaign status totals">
                <button className={campaignStatusFilter === "all" ? "active" : ""} onClick={() => setCampaignStatusFilter("all")}><span>All campaigns</span><strong>{campaignPortfolioStats.total}</strong><small>Complete portfolio</small></button>
                <button className={campaignStatusFilter === "draft_pending_review" ? "active" : ""} onClick={() => setCampaignStatusFilter("draft_pending_review")}><span>Draft</span><strong>{campaignPortfolioStats.draft}</strong><small>Needs review</small></button>
                <button className={campaignStatusFilter === "active" ? "active" : ""} onClick={() => setCampaignStatusFilter("active")}><span>Active</span><strong>{campaignPortfolioStats.active}</strong><small>Ready or running</small></button>
                <button className={campaignStatusFilter === "completed" ? "active" : ""} onClick={() => setCampaignStatusFilter("completed")}><span>Sent</span><strong>{campaignPortfolioStats.sent}</strong><small>Fully completed</small></button>
                <button className={campaignStatusFilter === "needs_attention" ? "active" : ""} onClick={() => setCampaignStatusFilter("needs_attention")}><span>Attention</span><strong>{campaignPortfolioStats.attention}</strong><small>Delivery issues</small></button>
              </section>

              {paused && (
                <section className="campaign-safety-note">
                  <span>!</span>
                  <div><strong>Client sending is globally paused</strong><p>Campaign preparation and review remain available. No campaign can start until Pause all is turned off in Controls & APIs.</p></div>
                  <button onClick={() => switchSection("settings")}>View controls</button>
                </section>
              )}

              <section className="campaign-portfolio-layout">
                <article className="panel campaign-directory">
                  <div className="panel-heading">
                    <div><p className="eyebrow">Campaign directory</p><h2>{filteredCampaigns.length} campaigns</h2></div>
                    <label className="campaign-status-select"><span>Status</span><select value={campaignStatusFilter} onChange={(event) => setCampaignStatusFilter(event.target.value)}><option value="all">All statuses</option><option value="draft_pending_review">Draft</option><option value="active">Active</option><option value="approved">Ready</option><option value="scheduled">Scheduled</option><option value="running">Running</option><option value="completed">Sent</option><option value="needs_attention">Needs attention</option></select></label>
                  </div>
                  <div className="campaign-directory-list">
                    {filteredCampaigns.map((campaign) => (
                      <button key={campaign.id} className={selectedCampaignSummary?.id === campaign.id ? "campaign-directory-row active" : "campaign-directory-row"} onClick={() => setQueueForm((current) => ({ ...current, campaignId: campaign.id, confirmed: false }))}>
                        <span className="campaign-symbol">{campaign.name.slice(0, 2).toUpperCase()}</span>
                        <span className="campaign-directory-copy"><strong>{campaign.name}</strong><small>{campaign.total} recipients · Updated {compactDate(campaign.latestGeneratedAt)}</small><i><b style={{ width: `${campaign.progress}%` }} /></i></span>
                        <span className="campaign-directory-result"><StatusPill value={campaign.lifecycle} /><small>{campaign.progress}% delivered or scheduled</small></span>
                        <span className="campaign-row-arrow">→</span>
                      </button>
                    ))}
                    {!filteredCampaigns.length && <div className="empty-state">No campaigns match this status or search.</div>}
                  </div>
                </article>

                {selectedCampaignSummary && (
                  <article className="panel campaign-detail-panel">
                    <div className="campaign-detail-heading">
                      <div className="campaign-symbol">{selectedCampaignSummary.name.slice(0, 2).toUpperCase()}</div>
                      <div><p className="eyebrow">Selected campaign</p><h2>{selectedCampaignSummary.name}</h2><span>{selectedCampaignSummary.senderName} · {selectedCampaignSummary.senderEmail}</span></div>
                      <StatusPill value={selectedCampaignSummary.lifecycle} />
                    </div>

                    <div className="campaign-detail-progress">
                      <div><span>Campaign progress</span><strong>{selectedCampaignSummary.progress}%</strong></div>
                      <i><b style={{ width: `${selectedCampaignSummary.progress}%` }} /></i>
                    </div>

                    <div className="campaign-detail-stats">
                      <span><b>{selectedCampaignSummary.total}</b>Recipients</span>
                      <span><b>{selectedCampaignSummary.needsReview}</b>Draft</span>
                      <span><b>{selectedCampaignSummary.approved}</b>Ready</span>
                      <span><b>{selectedCampaignSummary.scheduled}</b>Scheduled</span>
                      <span><b>{selectedCampaignSummary.sent}</b>Sent</span>
                      <span><b>{selectedCampaignSummary.failed}</b>Failed</span>
                    </div>

                    <div className="campaign-lifecycle">
                      <p className="eyebrow">Lifecycle</p>
                      <ol>
                        <li className={selectedCampaignSummary.total ? "complete" : ""}><span>1</span><div><strong>Drafts created</strong><small>{selectedCampaignSummary.total} personalized emails</small></div></li>
                        <li className={selectedCampaignSummary.approved + selectedCampaignSummary.scheduled + selectedCampaignSummary.sent > 0 ? "complete" : ""}><span>2</span><div><strong>Reviewed and approved</strong><small>{selectedCampaignSummary.approved + selectedCampaignSummary.scheduled + selectedCampaignSummary.sent} ready or progressed</small></div></li>
                        <li className={selectedCampaignSummary.scheduled + selectedCampaignSummary.sent > 0 ? "complete" : ""}><span>3</span><div><strong>Scheduled with Brevo</strong><small>{selectedCampaignSummary.firstScheduledAt ? `Starts ${new Date(selectedCampaignSummary.firstScheduledAt).toLocaleString("en-IN")}` : "Not scheduled yet"}</small></div></li>
                        <li className={selectedCampaignSummary.sent === selectedCampaignSummary.total && selectedCampaignSummary.total > 0 ? "complete" : ""}><span>4</span><div><strong>Delivery completed</strong><small>{selectedCampaignSummary.sent} of {selectedCampaignSummary.total} sent</small></div></li>
                      </ol>
                    </div>

                    <div className="campaign-audience-preview">
                      <div><p className="eyebrow">Audience preview</p><button onClick={() => { setEmailCampaign(selectedCampaignSummary.name); switchSection("emails"); }}>View all emails</button></div>
                      {selectedCampaignSummary.emails.slice(0, 5).map((email) => <span key={email.id}><span><strong>{email.company}</strong><small>{email.recipient}</small></span><StatusPill value={email.sendStatus || email.status} /></span>)}
                    </div>

                    <div className="campaign-detail-actions">
                      <button onClick={() => { setEmailCampaign(selectedCampaignSummary.name); switchSection("emails"); }}>Review emails</button>
                      <button className="primary-action" onClick={() => switchSection("queue")}>Manage approval & schedule</button>
                    </div>
                  </article>
                )}
              </section>
            </section>
          )}

          {section === "emails" && (
            <section className="panel data-panel">
              <div className="panel-heading filters-heading">
                <div><p className="eyebrow">Email library</p><h2>{filteredEmails.length} generated emails</h2><p className="section-helper">Select emails, preview the content, then schedule or send only after confirmation.</p></div>
                <div className="email-filter-group">
                  <label><span>Campaign</span><select value={emailCampaign} onChange={(event) => { setEmailCampaign(event.target.value); setSelectedIds(new Set()); setPage(1); }} aria-label="Filter by campaign">
                    <option value="all">All campaigns</option>
                    {displayCampaigns.map((campaign) => <option key={campaign.name} value={campaign.name}>{campaign.name}</option>)}
                  </select></label>
                  <label><span>Status</span><select value={emailStatus} onChange={(event) => { setEmailStatus(event.target.value); setPage(1); }} aria-label="Filter by email status">
                    <option value="all">All statuses</option>
                    <option value="draft">Needs review</option>
                    <option value="failed">Failed</option>
                    <option value="sent">Sent</option>
                  </select></label>
                </div>
              </div>
              <div className="selection-toolbar">
                <div><strong>{selectedIds.size} selected</strong><span>{selectedIds.size ? paused ? "Review is available; sending and scheduling are paused" : "Ready for review, testing, or scheduling" : "Use the checkboxes to choose emails"}</span></div>
                <div>
                  <button disabled={!selectedIds.size || !control?.canManage || working} onClick={() => runAction({ action: "approve_batch", emailIds: [...selectedIds] }, `${selectedIds.size} emails approved. Nothing has been sent.`)}>Approve</button>
                  <button className="test-action" disabled={!selectedIds.size || selectedIds.size > 5 || !control?.canManage || working} onClick={() => setBulkMode("test")} title={selectedIds.size > 5 ? "Select up to 5 drafts for a test" : ""}>Send test copy</button>
                  <button className="primary-action" disabled={!selectedIds.size || selectedIds.size > 50 || paused || !control?.canManage || working} onClick={() => setBulkMode("schedule")} title={paused ? "Turn off Pause all before scheduling" : selectedIds.size > 50 ? "Schedule up to 50 emails at a time" : ""}>Schedule selected</button>
                  <button className="send-action" disabled={!selectedIds.size || selectedIds.size > 25 || paused || !control?.canManage || working} onClick={() => setBulkMode("send")} title={paused ? "Turn off Pause all before sending" : selectedIds.size > 25 ? "Send up to 25 emails at a time" : ""}>Send selected now</button>
                  {selectedIds.size > 0 && <button className="quiet-action" onClick={() => setSelectedIds(new Set())}>Clear</button>}
                </div>
              </div>
              {bulkMode === "schedule" && (
                <div className="bulk-panel">
                  <div><p className="eyebrow">Automatic delivery</p><h3>Schedule {selectedIds.size} emails</h3><p>Brevo will hold and deliver these messages even after this dashboard is closed.</p></div>
                  <label>First email time<input type="datetime-local" value={bulkForm.scheduledFor} onChange={(e) => setBulkForm({ ...bulkForm, scheduledFor: e.target.value })} /></label>
                  <label>Spacing between emails<select value={bulkForm.delayMinutes} onChange={(e) => setBulkForm({ ...bulkForm, delayMinutes: Number(e.target.value) })}><option value={2}>2 minutes</option><option value={5}>5 minutes</option><option value={10}>10 minutes</option><option value={15}>15 minutes</option></select></label>
                  <label className="confirm-box"><input type="checkbox" checked={bulkForm.confirmed} onChange={(e) => setBulkForm({ ...bulkForm, confirmed: e.target.checked })} /><span>I reviewed the recipients and approve automatic delivery.</span></label>
                  <div className="bulk-actions"><button className="quiet-action" onClick={() => setBulkMode(null)}>Cancel</button><button className="primary-action" disabled={!bulkForm.scheduledFor || !bulkForm.confirmed || paused || working} onClick={runBulkSchedule}>{working ? "Scheduling…" : "Confirm schedule"}</button></div>
                </div>
              )}
              {bulkMode === "send" && (
                <div className="bulk-panel danger-panel">
                  <div><p className="eyebrow">Immediate send</p><h3>Send {selectedIds.size} emails now</h3><p>This action cannot be undone. Type <strong>SEND</strong> to confirm.</p></div>
                  <label>Confirmation<input value={bulkForm.confirmText} onChange={(e) => setBulkForm({ ...bulkForm, confirmText: e.target.value.toUpperCase() })} placeholder="Type SEND" /></label>
                  <div className="bulk-actions"><button className="quiet-action" onClick={() => setBulkMode(null)}>Cancel</button><button className="danger-action" disabled={bulkForm.confirmText !== "SEND" || paused || working} onClick={runBulkSend}>{working ? "Sending…" : "Send now"}</button></div>
                </div>
              )}
              {bulkMode === "test" && (
                <div className="bulk-panel test-panel">
                  <div><p className="eyebrow">Inbox preview</p><h3>Send {selectedIds.size} selected email{selectedIds.size === 1 ? "" : "s"} as a test</h3><p>The preview will be delivered only to the email address you enter. The original client will not receive anything and the draft status will remain unchanged.</p></div>
                  <label className="test-recipient-field"><span>Send test to</span><input type="email" value={bulkForm.testRecipients} onChange={(e) => setBulkForm({ ...bulkForm, testRecipients: e.target.value })} placeholder="Enter your email address" autoComplete="email" /><small>Example: your.name@company.com</small></label>
                  <label className="confirm-box"><input type="checkbox" checked={bulkForm.confirmed} onChange={(e) => setBulkForm({ ...bulkForm, confirmed: e.target.checked })} /><span>I confirm that this is my test inbox and want to receive the preview.</span></label>
                  <div className="bulk-actions"><button className="quiet-action" onClick={() => setBulkMode(null)}>Cancel</button><button className="test-send-action" disabled={!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(bulkForm.testRecipients.trim()) || !bulkForm.confirmed || working} onClick={runTestSend}>{working ? "Sending test…" : "Send test email"}</button></div>
                </div>
              )}
              <EmailTable rows={pagedEmails} onOpen={setSelectedEmail} selected={selectedIds} onSelect={toggleSelected} />
              <div className="pagination"><span>Page {page} of {pages}</span><div><button disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Previous</button><button disabled={page === pages} onClick={() => setPage((p) => p + 1)}>Next</button></div></div>
            </section>
          )}

          {section === "create" && (
            <section className="intelligence-layout">
              <article className="panel intelligence-studio">
                <div className="studio-hero">
                  <div><p className="eyebrow">Research · enrich · personalize</p><h2>Outreach Intelligence Studio</h2><p>Bring whatever you have. The studio extracts contacts, researches company websites, discovers public email addresses, and creates review-ready drafts.</p></div>
                  <div className="studio-steps"><span>1 · Add sources</span><span>2 · Research</span><span>3 · Review drafts</span></div>
                </div>
                <form className="studio-form" onSubmit={(event) => { event.preventDefault(); runIntelligenceStudio(); }}>
                  <div className="campaign-setup-grid">
                    <label className="topic-field"><span>Campaign name</span><input required value={intakeForm.campaignName} onChange={(event) => setIntakeForm({ ...intakeForm, campaignName: event.target.value })} placeholder="Example: Manufacturing Leaders · August 2026" /><small>Every draft from this set stays together under this campaign.</small></label>
                    <label className="topic-field"><span>Email topic</span><input required value={intakeForm.topic} onChange={(event) => setIntakeForm({ ...intakeForm, topic: event.target.value })} placeholder="Example: AI-enabled manufacturing operations" /><small>Used to build each personalized subject line.</small></label>
                  </div>
                  <label className="template-field"><span>Your email template</span><textarea required rows={9} value={intakeForm.emailTemplate} onChange={(event) => setIntakeForm({ ...intakeForm, emailTemplate: event.target.value })} placeholder="Paste the email you want personalized for every client in this campaign." /><small>Personalization fields: <code>{"{{name}}"}</code>, <code>{"{{company}}"}</code>, <code>{"{{topic}}"}</code>, <code>{"{{research}}"}</code>, and <code>{"{{focus_areas}}"}</code>. A researched opening is added automatically when your template does not use personalization fields.</small></label>
                  <div className="source-grid">
                    <label className="source-card">
                      <span className="source-icon">Aa</span><strong>Paste names and emails</strong><small>One per line, CSV, or Name &lt;email&gt;</small>
                      <textarea rows={8} value={intakeForm.rawInput} onChange={(event) => setIntakeForm({ ...intakeForm, rawInput: event.target.value })} placeholder={"Suraj Sonnar <suraj@company.com>\nPriya, priya@company.in, Company Name\ninfo@company.org"} />
                    </label>
                    <label className="source-card">
                      <span className="source-icon">www</span><strong>Add company websites</strong><small>We inspect public home, about, and contact pages.</small>
                      <textarea rows={8} value={intakeForm.websites} onChange={(event) => setIntakeForm({ ...intakeForm, websites: event.target.value })} placeholder={"https://company.com\nhttps://association.org/contact"} />
                    </label>
                    <label className={`source-card upload-card ${intakeFile ? "has-file" : ""}`}>
                      <span className="source-icon">↑</span><strong>Upload a contact document</strong><small>PDF, DOCX, CSV, TSV, or TXT · up to 6 MB</small>
                      <input type="file" accept=".pdf,.docx,.csv,.tsv,.txt" onChange={(event) => handleFileSelection(event.target.files?.[0] || null)} />
                      <span className="file-cta">{intakeFile ? intakeFile.name : "Choose document"}</span>
                    </label>
                  </div>
                  <label className="brief-field"><span>Optional context or instructions</span><textarea rows={3} value={intakeForm.brief} onChange={(event) => setIntakeForm({ ...intakeForm, brief: event.target.value })} placeholder="Mention the audience, desired outcome, offer, industry angle, or specific pain points." /></label>
                  <div className="studio-actions"><div><strong>Campaign draft workflow</strong><span>Drafts stay grouped under “{intakeForm.campaignName || "Untitled campaign"}”. Nothing is approved, scheduled, or sent automatically.</span></div><button className="primary-action" disabled={working || !control?.canManage || !intakeForm.campaignName.trim() || !intakeForm.topic.trim() || !intakeForm.emailTemplate.trim() || (!intakeForm.rawInput.trim() && !intakeForm.websites.trim() && !intakeFile)}>{working ? "Researching websites…" : "Create campaign drafts"}</button></div>
                </form>
              </article>

              <aside className="studio-sidebar">
                <article className="panel intelligence-card">
                  <p className="eyebrow">How the intelligence works</p><h2>Smart, but reviewable</h2>
                  <ol className="intelligence-list"><li><b>Extract</b><span>Find emails, names, websites, and company clues in pasted text or documents.</span></li><li><b>Enrich</b><span>Derive the organization from the domain and inspect its public web presence.</span></li><li><b>Personalize</b><span>Connect the company’s focus with your outreach topic and relevant use cases.</span></li><li><b>Address correctly</b><span>Use a clear personal name when confidently available; otherwise Dear Sir/Madam.</span></li><li><b>Save safely</b><span>Update companies and contacts, prevent duplicates, and create drafts for manual review.</span></li></ol>
                </article>
                <article className="panel guardrail-card"><span className="guardrail-dot" /><div><strong>Sending remains protected</strong><p>Reply-To is tanishka@iknowai.in. Approval is still mandatory.</p></div></article>
              </aside>

              {intakeResults.length > 0 && (
                <section className="panel research-results">
                  <div className="panel-heading"><div><p className="eyebrow">Research output</p><h2>{intakeResults.filter((item) => item.ok).length} drafts created</h2></div><button className="text-button" onClick={() => switchSection("emails")}>Review in Emails →</button></div>
                  <div className="result-grid">{intakeResults.map((item, index) => <article key={`${item.email}-${index}`} className={item.ok ? "result-card" : "result-card failed"}><div><strong>{item.company || item.email}</strong><span>{item.email}</span></div><StatusPill value={item.ok ? "draft_pending_review" : "send_failed"} />{item.ok ? <><p>{item.researchSummary || "Company information saved from its domain and supplied context."}</p><small>Greeting: Dear {item.name || "Sir/Madam"}</small></> : <p>{item.error}</p>}</article>)}</div>
                </section>
              )}
            </section>
          )}

          {section === "queue" && (
            <section className="campaign-queue">
              <article className="panel campaign-picker">
                <div className="panel-heading"><div><p className="eyebrow">Campaign control centre</p><h2>Choose a campaign</h2><p className="section-helper">Recipients, approvals, and schedules stay organized inside their campaign.</p></div><span>{displayCampaigns.length} campaigns</span></div>
                <div className="campaign-picker-grid">
                  {displayCampaigns.map((campaign) => {
                    const emails = displayEmails.filter((email) => email.campaign === campaign.name);
                    const scheduled = emails.filter((email) => email.status === "scheduled" || String(email.sendStatus || "").startsWith("scheduled")).length;
                    const sent = emails.filter((email) => email.status === "sent" || email.sendStatus === "sent").length;
                    return <button key={campaign.id} className={selectedCampaign?.id === campaign.id ? "campaign-choice active" : "campaign-choice"} onClick={() => setQueueForm((current) => ({ ...current, campaignId: campaign.id, confirmed: false }))}><span className="campaign-symbol">{campaign.name.slice(0, 2).toUpperCase()}</span><div><strong>{campaign.name}</strong><small>{emails.length} recipients · {scheduled} scheduled · {sent} sent</small></div><i>→</i></button>;
                  })}
                </div>
              </article>

              {selectedCampaign && (
                <article className="panel campaign-workspace">
                  <div className="campaign-workspace-header">
                    <div><p className="eyebrow">Selected campaign</p><h2>{selectedCampaign.name}</h2><p>Review the audience, approve the drafts, then choose when Brevo should begin automatic delivery.</p></div>
                    <div className="campaign-stat-strip"><span><b>{selectedCampaignEmails.length}</b>Recipients</span><span><b>{selectedCampaignDrafts}</b>Needs review</span><span><b>{selectedCampaignApproved}</b>Approved</span><span><b>{selectedCampaignScheduled}</b>Scheduled</span><span><b>{selectedCampaignSent}</b>Sent</span></div>
                  </div>

                  <div className="campaign-process">
                    <section>
                      <div className="campaign-step-heading"><span>1</span><div><strong>Review campaign audience</strong><p>Client names remain inside this campaign—there is no long single-email dropdown.</p></div></div>
                      <div className="campaign-recipient-list">
                        {selectedCampaignEmails.slice(0, 12).map((email) => <div key={email.id}><span><strong>{email.company}</strong><small>{email.recipient}</small></span><StatusPill value={email.sendStatus || email.status} /></div>)}
                        {selectedCampaignEmails.length > 12 && <button type="button" onClick={() => { setEmailCampaign(selectedCampaign.name); switchSection("emails"); }}>View all {selectedCampaignEmails.length} recipients in Emails →</button>}
                      </div>
                    </section>

                    <section>
                      <div className="campaign-step-heading"><span>2</span><div><strong>Approve the campaign</strong><p>Approval only changes draft status. It does not send or schedule anything.</p></div></div>
                      <div className="campaign-approval-box"><div><b>{selectedCampaignDrafts}</b><span>drafts still need approval</span></div><button disabled={working || !control?.canManage || selectedCampaignDrafts === 0} onClick={approveSelectedCampaign}>{selectedCampaignDrafts ? `Approve ${selectedCampaignDrafts} drafts` : "Campaign approved"}</button></div>
                    </section>

                    <section className="campaign-schedule-section">
                      <div className="campaign-step-heading"><span>3</span><div><strong>Schedule automatic delivery</strong><p>Brevo stores the schedule and sends while this dashboard and your computer are closed.</p></div></div>
                      <div className="campaign-schedule-form">
                        <label><span>Campaign starts</span><input type="datetime-local" value={queueForm.scheduledFor} onChange={(event) => setQueueForm({ ...queueForm, scheduledFor: event.target.value })} /><small>Choose a time from 2 minutes up to 72 hours ahead.</small></label>
                        <label><span>Spacing between emails</span><select value={queueForm.delayMinutes} onChange={(event) => setQueueForm({ ...queueForm, delayMinutes: Number(event.target.value) })}><option value={1}>1 minute</option><option value={2}>2 minutes</option><option value={5}>5 minutes</option><option value={10}>10 minutes</option><option value={15}>15 minutes</option></select><small>Delivery also follows the daily limit and sending window.</small></label>
                        <label className="campaign-confirm"><input type="checkbox" disabled={paused || !control?.canManage} checked={queueForm.confirmed} onChange={(event) => setQueueForm({ ...queueForm, confirmed: event.target.checked })} /><span><strong>I reviewed this campaign and approve automatic delivery.</strong><small>{paused ? "Pause all is currently active. Turn it off in Controls & APIs before scheduling." : "Brevo will continue delivery even after this dashboard is closed."}</small></span></label>
                        <button className="primary-action campaign-schedule-button" disabled={working || paused || !control?.canManage || !queueForm.confirmed || !queueForm.scheduledFor || selectedCampaignApproved === 0 || selectedCampaignDrafts > 0} onClick={scheduleSelectedCampaign}>{working ? "Scheduling campaign…" : `Schedule ${selectedCampaignApproved} approved emails`}</button>
                      </div>
                    </section>
                  </div>
                </article>
              )}

              <article className="panel scheduled-campaigns">
                <div className="panel-heading"><div><p className="eyebrow">24/7 Brevo delivery</p><h2>Scheduled campaigns</h2><p className="section-helper">These schedules continue on Brevo’s servers when nobody is signed in.</p></div><span>{scheduledCampaignGroups.length} active</span></div>
                <div className="scheduled-campaign-list">{scheduledCampaignGroups.length ? scheduledCampaignGroups.map((item) => <div key={item.id}><span className="campaign-symbol">{item.name.slice(0, 2).toUpperCase()}</span><div><strong>{item.name}</strong><small>{item.count} emails · {item.first ? `starts ${new Date(item.first).toLocaleString("en-IN")}` : "start pending"}{item.last && item.last !== item.first ? ` · ends ${new Date(item.last).toLocaleString("en-IN")}` : ""}</small></div><StatusPill value="scheduled" /></div>) : <div className="empty-state">No campaigns are scheduled yet.</div>}</div>
              </article>
            </section>
          )}

          {section === "settings" && (
            <section className="settings-console">
              <article className={`panel settings-hero ${paused ? "is-paused" : "is-active"}`}>
                <div><p className="eyebrow">Outreach operations</p><h2>Sending is {paused ? "paused and protected" : "active within your limits"}</h2><p>{paused ? "Drafting, research, contact editing, and review remain available. Scheduling and client sending are blocked." : "Only approved emails can be scheduled or sent, inside the delivery limits below."}</p></div>
                <StatusPill value={paused ? "paused_user_hold" : "active"} />
              </article>

              <article className="panel settings-section">
                <div className="settings-section-heading"><div><span className="settings-number">1</span><div><p className="eyebrow">System readiness</p><h2>Connections and sending identity</h2><p>These services must be available before any delivery action can work.</p></div></div><button onClick={loadControl} disabled={refreshing}>{refreshing ? "Checking…" : "Check connections"}</button></div>
                <div className="connection-cards">
                  <div><span className={`api-dot ${control?.providers?.database ? "online" : "offline"}`} /><div><strong>Supabase database</strong><small>Contacts, companies, campaigns, drafts, and activity</small></div><b>{control?.providers?.database ? "Connected" : "Unavailable"}</b></div>
                  <div><span className={`api-dot ${control?.providers?.brevo ? "online" : "offline"}`} /><div><strong>Brevo delivery</strong><small>Test copies, scheduled delivery, and sending</small></div><b>{control?.providers?.brevo ? "Connected" : "Unavailable"}</b></div>
                  <div><span className="identity-avatar">T</span><div><strong>Tanishka &lt;tanishka@iknowai.in&gt;</strong><small>Sender and Reply-To: {control?.replyTo || "tanishka@iknowai.in"}</small></div><b>Verified</b></div>
                </div>
              </article>

              <article className="panel settings-section">
                <div className="settings-section-heading"><div><span className="settings-number">2</span><div><p className="eyebrow">Process flow</p><h2>How an email moves through the system</h2><p>Every step is visible and reviewable. Nothing bypasses approval.</p></div></div></div>
                <ol className="sending-flow">
                  <li><span>1</span><div><strong>Create campaign drafts</strong><p>Add recipients, research sources, and your template. Drafts are grouped by campaign.</p></div></li>
                  <li><span>2</span><div><strong>Review and approve</strong><p>Open each email, check personalization, and approve only the drafts you want.</p></div></li>
                  <li><span>3</span><div><strong>Test or schedule</strong><p>Send a preview to your own inbox, or choose the first delivery time and spacing.</p></div></li>
                  <li><span>4</span><div><strong>Track every result</strong><p>Brevo results and all database changes appear in the dashboard activity trail.</p></div></li>
                </ol>
              </article>

              <article className="panel settings-section">
                <div className="settings-section-heading"><div><span className="settings-number">3</span><div><p className="eyebrow">Delivery guardrails</p><h2>Control when and how fast emails can send</h2><p>All times use Asia/Kolkata. These limits apply to client delivery, not test previews.</p></div></div></div>
                <form className="safety-form" onSubmit={(e) => { e.preventDefault(); const form = new FormData(e.currentTarget); runAction({ action: "policy", dailyLimit: form.get("dailyLimit"), delay: form.get("delay"), windowStart: form.get("windowStart"), windowEnd: form.get("windowEnd"), paused: form.get("paused") === "on" }, "Safety settings saved."); }}>
                  <label><span>Daily sending limit</span><input disabled={!control?.canManage || working} name="dailyLimit" type="number" min="1" max="1000" defaultValue={control?.settings?.daily_limit || 25} /><small>Maximum client emails per day</small></label>
                  <label><span>Minimum spacing</span><div className="input-suffix"><input disabled={!control?.canManage || working} name="delay" type="number" min="1" max="60" defaultValue={control?.settings?.minimum_delay_minutes || 5} /><b>minutes</b></div><small>Delay between consecutive emails</small></label>
                  <label><span>Sending starts</span><input disabled={!control?.canManage || working} name="windowStart" type="time" defaultValue={control?.settings?.sending_window_start || "10:00"} /><small>Earliest allowed delivery</small></label>
                  <label><span>Sending ends</span><input disabled={!control?.canManage || working} name="windowEnd" type="time" defaultValue={control?.settings?.sending_window_end || "17:00"} /><small>Latest allowed delivery</small></label>
                  <label className={`pause-control ${paused ? "selected" : ""}`}><input disabled={!control?.canManage || working} name="paused" type="checkbox" defaultChecked={control?.settings?.paused ?? true} /><span><strong>Pause all client sending</strong><small>Recommended while campaigns are being prepared or reviewed.</small></span></label>
                  <div className="safety-actions"><div><strong>{control?.canManage ? "Changes apply immediately after saving." : "Sign in with an authorized IKF account to change controls."}</strong><span>Manual approval remains mandatory in both states.</span></div><button disabled={!control?.canManage || working} className="primary-action">{working ? "Saving…" : "Save delivery controls"}</button></div>
                </form>
              </article>
            </section>
          )}

          {section === "contacts" && (
            <section className="panel data-panel">
              <div className="panel-heading"><div><p className="eyebrow">Audience</p><h2>{displayContacts.length} contacts</h2></div><span>{displayContacts.filter((contact) => contactDisplayName(contact) !== "Sir/Madam").length} named contacts</span></div>
              <div className="table-wrap"><table className="contacts-table"><thead><tr><th>Contact</th><th>Company</th><th>Industry</th><th>Confidence</th><th>Added</th><th>Action</th></tr></thead><tbody>
                {displayContacts.filter((contact) => !search || `${contactDisplayName(contact)} ${contact.email} ${contact.company} ${contact.industry || ""}`.toLowerCase().includes(search.toLowerCase())).slice(0, 100).map((contact) => <tr key={contact.id}><td><strong>{contactDisplayName(contact)}</strong><span>{contact.email}</span></td><td>{contact.company}</td><td>{contact.industry || "—"}</td><td><StatusPill value={contact.confidence} /></td><td>{compactDate(contact.createdAt)}</td><td><button className="edit-contact-button" disabled={!control?.canManage} onClick={() => openContactEditor(contact)} title={control?.canManage ? "Edit this contact" : "Sign in with an authorized IKF account to edit"}>Edit</button></td></tr>)}
              </tbody></table></div>
            </section>
          )}

          {section === "companies" && (
            <section className="panel data-panel">
              <div className="panel-heading"><div><p className="eyebrow">Organizations</p><h2>{displayCompanies.length} companies</h2></div><span>Deduplicated by domain</span></div>
              <div className="company-grid">
                {displayCompanies.filter((company) => !search || `${company.name} ${company.industry || ""} ${company.website || ""}`.toLowerCase().includes(search.toLowerCase())).slice(0, 100).map((company) => <article key={company.id} className="company-card"><div className="company-letter">{company.name.slice(0, 1)}</div><div><strong>{company.name}</strong><span>{company.industry || "Industry pending verification"}</span><small>{company.contacts} contacts · {company.drafts} drafts</small>{company.website && <a href={company.website} target="_blank" rel="noreferrer">Visit website</a>}</div></article>)}
              </div>
            </section>
          )}

          {section === "activity" && (
            <section className="panel data-panel">
              <div className="panel-heading"><div><p className="eyebrow">Audit trail</p><h2>Recent activity</h2></div><span>Latest 100 events</span></div>
              <div className="timeline">
                {displayActivity.map((item, index) => <div className="timeline-item" key={`${item.id || item.createdAt}-${index}`}><span className="timeline-dot" /><div><strong>{prettyStatus(item.action)}</strong><p>{item.company || item.email || "System-wide operation"}</p><small>{compactDate(item.createdAt)}</small></div></div>)}
                {!displayActivity.length && <div className="empty-state">No activity has been recorded yet.</div>}
              </div>
            </section>
          )}
        </div>
      </main>

      {selectedEmail && (
        <div className="drawer-backdrop" onMouseDown={() => setSelectedEmail(null)}>
          <aside className="email-drawer" onMouseDown={(event) => event.stopPropagation()} aria-label="Email preview" role="dialog" aria-modal="true">
            <div className="drawer-header"><div><p className="eyebrow">Email preview</p><h2>{selectedEmail.company}</h2></div><button type="button" onClick={() => setSelectedEmail(null)} aria-label="Close email preview">×</button></div>
            <div className="email-meta"><div><span>To</span><strong>{selectedEmail.recipient}</strong></div><div><span>Subject</span><strong>{selectedEmail.subject}</strong></div><div><span>Campaign</span><strong>{selectedEmail.campaign}</strong></div><div><span>Status</span><StatusPill value={selectedEmail.sendStatus || selectedEmail.status} /></div></div>
            <iframe title={`Preview of ${selectedEmail.subject}`} sandbox="" srcDoc={`<style>body{font-family:Calibri,Arial,sans-serif;color:#25262b;line-height:1.55;padding:24px;font-size:11pt}a{color:#4d3dc4}li{margin:7px 0}</style>${personalizeGreeting(selectedEmail.html, selectedEmail.recipient, displayContacts)}`} />
            <div className="drawer-footer"><span>Version {selectedEmail.version} · {compactDate(selectedEmail.generatedAt)}</span><button onClick={() => navigator.clipboard?.writeText(selectedEmail.subject)}>Copy subject</button></div>
          </aside>
        </div>
      )}
      {selectedContact && (
        <div className="drawer-backdrop contact-editor-backdrop" onMouseDown={() => setSelectedContact(null)}>
          <aside className="contact-editor" onMouseDown={(event) => event.stopPropagation()} aria-label="Edit contact" role="dialog" aria-modal="true">
            <div className="drawer-header"><div><p className="eyebrow">Database contact</p><h2>Edit contact details</h2><p>Changes update Supabase and appear across Contacts and Companies.</p></div><button type="button" onClick={() => setSelectedContact(null)} aria-label="Close contact editor">×</button></div>
            <form className="contact-editor-form" onSubmit={(event) => { event.preventDefault(); saveContact(); }}>
              <div className="contact-form-section"><div><strong>Person</strong><span>Use only information you know or have verified.</span></div>
                <label><span>Full name</span><input value={contactForm.name} onChange={(event) => setContactForm({ ...contactForm, name: event.target.value })} placeholder="Leave blank to use Sir/Madam" /></label>
                <label><span>Email address</span><input required type="email" value={contactForm.email} onChange={(event) => setContactForm({ ...contactForm, email: event.target.value })} /></label>
                <label><span>Job title or role</span><input value={contactForm.role} onChange={(event) => setContactForm({ ...contactForm, role: event.target.value })} placeholder="Example: Marketing Director" /></label>
              </div>
              <div className="contact-form-section"><div><strong>Organization</strong><span>Organization changes are shared with its other contacts.</span></div>
                <label><span>Company or organization</span><input required value={contactForm.company} onChange={(event) => setContactForm({ ...contactForm, company: event.target.value })} /></label>
                <label><span>Industry</span><input value={contactForm.industry} onChange={(event) => setContactForm({ ...contactForm, industry: event.target.value })} placeholder="Example: Automotive manufacturing" /></label>
                <label><span>Website</span><input type="url" value={contactForm.website} onChange={(event) => setContactForm({ ...contactForm, website: event.target.value })} placeholder="https://company.com" /></label>
                <label><span>Country</span><input value={contactForm.country} onChange={(event) => setContactForm({ ...contactForm, country: event.target.value })} placeholder="Example: India" /></label>
              </div>
              <div className="contact-editor-actions"><button type="button" className="quiet-action" onClick={() => setSelectedContact(null)}>Cancel</button><button className="primary-action" disabled={working}>{working ? "Saving…" : "Save to database"}</button></div>
            </form>
          </aside>
        </div>
      )}
      {notice && <div className={`toast ${noticeTone}`} role={noticeTone === "error" ? "alert" : "status"}><span>{notice}</span><button onClick={() => setNotice("")} aria-label="Dismiss notification">×</button></div>}
    </div>
  );
}
