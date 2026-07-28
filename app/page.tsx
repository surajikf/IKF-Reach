"use client";

import { useEffect, useMemo, useState } from "react";
import data from "./dashboard-data.json";

type Section = "overview" | "create" | "emails" | "queue" | "contacts" | "companies" | "settings" | "activity";
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
  paused_no_credits: "Paused",
  paused_user_hold: "On hold",
};

function prettyStatus(value?: string | null) {
  if (!value) return "Draft";
  return statusLabel[value] || value.replaceAll("_", " ");
}

function statusTone(value?: string | null) {
  if (!value || value.includes("draft") || value.includes("review")) return "review";
  if (value === "sent" || value === "active" || value === "delivered") return "good";
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
  const [listeningField, setListeningField] = useState("");
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
  const [queueForm, setQueueForm] = useState({ emailId: data.emails[0]?.id || "", scheduledFor: "", confirmed: false });
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
    name: String(campaign.name || "Outreach"),
    status: paused ? "paused_user_hold" : String(campaign.status || "active"),
    drafts: displayEmails.filter((email) => email.campaign === campaign.name).length,
    senderName: String(campaign.sender_name || control.sender?.name || "Tanishka"),
    senderEmail: String(campaign.sender_email || control.sender?.email || "tanishka@iknowai.in"),
  })) : data.campaigns, [control?.campaigns, control?.sender, displayEmails, paused]);
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
    if (displayEmails.length && !displayEmails.some((email) => email.id === queueForm.emailId)) {
      setQueueForm((current) => ({ ...current, emailId: displayEmails[0].id }));
    }
  }, [displayEmails, queueForm.emailId]);

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

  function startDictation(field: string, currentValue: string, update: (value: string) => void) {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setNoticeTone("error");
      setNotice("Voice typing is not supported in this browser. On Windows, click the field and press Windows + H.");
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = "en-IN";
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onstart = () => setListeningField(field);
    recognition.onend = () => setListeningField("");
    recognition.onerror = () => {
      setListeningField("");
      setNoticeTone("error");
      setNotice("Voice typing could not start. Check microphone permission or use Windows + H.");
    };
    recognition.onresult = (event: any) => {
      const transcript = String(event.results?.[0]?.[0]?.transcript || "").trim();
      if (transcript) update(`${currentValue}${currentValue.trim() ? " " : ""}${transcript}`);
    };
    recognition.start();
  }

  function VoiceButton({ field, value, onChange, label }: { field: string; value: string; onChange: (value: string) => void; label: string }) {
    const active = listeningField === field;
    return <button type="button" className={`voice-button ${active ? "listening" : ""}`} onClick={() => startDictation(field, value, onChange)} aria-label={`Dictate ${label}`} title={active ? "Listening…" : `Speak ${label}`}>{active ? "●" : "🎙"}</button>;
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
                    <label className="topic-field"><span>Campaign name</span><div className="voice-field"><input required value={intakeForm.campaignName} onChange={(event) => setIntakeForm({ ...intakeForm, campaignName: event.target.value })} placeholder="Example: Manufacturing Leaders · August 2026" /><VoiceButton field="campaignName" value={intakeForm.campaignName} onChange={(campaignName) => setIntakeForm((current) => ({ ...current, campaignName }))} label="campaign name" /></div><small>Every draft from this set stays together under this campaign.</small></label>
                    <label className="topic-field"><span>Email topic</span><div className="voice-field"><input required value={intakeForm.topic} onChange={(event) => setIntakeForm({ ...intakeForm, topic: event.target.value })} placeholder="Example: AI-enabled manufacturing operations" /><VoiceButton field="topic" value={intakeForm.topic} onChange={(topic) => setIntakeForm((current) => ({ ...current, topic }))} label="email topic" /></div><small>Used to build each personalized subject line.</small></label>
                  </div>
                  <label className="template-field"><span>Your email template</span><div className="voice-field voice-textarea"><textarea required rows={9} value={intakeForm.emailTemplate} onChange={(event) => setIntakeForm({ ...intakeForm, emailTemplate: event.target.value })} placeholder="Paste the email you want personalized for every client in this campaign." /><VoiceButton field="emailTemplate" value={intakeForm.emailTemplate} onChange={(emailTemplate) => setIntakeForm((current) => ({ ...current, emailTemplate }))} label="email template" /></div><small>Personalization fields: <code>{"{{name}}"}</code>, <code>{"{{company}}"}</code>, <code>{"{{topic}}"}</code>, <code>{"{{research}}"}</code>, and <code>{"{{focus_areas}}"}</code>. A researched opening is added automatically when your template does not use personalization fields.</small></label>
                  <div className="source-grid">
                    <label className="source-card">
                      <span className="source-icon">Aa</span><strong>Paste names and emails</strong><small>One per line, CSV, or Name &lt;email&gt;</small>
                      <div className="voice-field voice-textarea"><textarea rows={8} value={intakeForm.rawInput} onChange={(event) => setIntakeForm({ ...intakeForm, rawInput: event.target.value })} placeholder={"Suraj Sonnar <suraj@company.com>\nPriya, priya@company.in, Company Name\ninfo@company.org"} /><VoiceButton field="rawInput" value={intakeForm.rawInput} onChange={(rawInput) => setIntakeForm((current) => ({ ...current, rawInput }))} label="contact list" /></div>
                    </label>
                    <label className="source-card">
                      <span className="source-icon">www</span><strong>Add company websites</strong><small>We inspect public home, about, and contact pages.</small>
                      <div className="voice-field voice-textarea"><textarea rows={8} value={intakeForm.websites} onChange={(event) => setIntakeForm({ ...intakeForm, websites: event.target.value })} placeholder={"https://company.com\nhttps://association.org/contact"} /><VoiceButton field="websites" value={intakeForm.websites} onChange={(websites) => setIntakeForm((current) => ({ ...current, websites }))} label="company websites" /></div>
                    </label>
                    <label className={`source-card upload-card ${intakeFile ? "has-file" : ""}`}>
                      <span className="source-icon">↑</span><strong>Upload a contact document</strong><small>PDF, DOCX, CSV, TSV, or TXT · up to 6 MB</small>
                      <input type="file" accept=".pdf,.docx,.csv,.tsv,.txt" onChange={(event) => handleFileSelection(event.target.files?.[0] || null)} />
                      <span className="file-cta">{intakeFile ? intakeFile.name : "Choose document"}</span>
                    </label>
                  </div>
                  <label className="brief-field"><span>Optional context or instructions</span><div className="voice-field voice-textarea"><textarea rows={3} value={intakeForm.brief} onChange={(event) => setIntakeForm({ ...intakeForm, brief: event.target.value })} placeholder="Mention the audience, desired outcome, offer, industry angle, or specific pain points." /><VoiceButton field="brief" value={intakeForm.brief} onChange={(brief) => setIntakeForm((current) => ({ ...current, brief }))} label="campaign instructions" /></div></label>
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
            <section className="workspace-grid">
              <article className="panel control-card wide-card">
                <div className="panel-heading"><div><p className="eyebrow">Approval workflow</p><h2>Approve, schedule, or send</h2></div><span>{control?.queue?.length || 0} queued</span></div>
                <div className="control-form compact-form">
                  <label className="full-field">Choose generated email<select value={queueForm.emailId} onChange={(e) => setQueueForm({ ...queueForm, emailId: e.target.value })}>{displayEmails.map((email) => <option key={email.id} value={email.id}>{email.company} — {email.recipient}</option>)}</select></label>
                  <label>Schedule date and time<input type="datetime-local" value={queueForm.scheduledFor} onChange={(e) => setQueueForm({ ...queueForm, scheduledFor: e.target.value })} /></label>
                  <div className="button-stack"><button disabled={working || !control?.canManage} onClick={() => runAction({ action: "approve", emailId: queueForm.emailId }, "Email approved. It has not been sent.")}>Approve draft</button><button disabled={working || paused || !control?.canManage || !queueForm.scheduledFor} onClick={() => runAction({ action: "schedule", emailId: queueForm.emailId, scheduledFor: new Date(queueForm.scheduledFor).toISOString() }, "Email added to the scheduled queue.")}>Schedule</button></div>
                  <label className="confirm-box full-field"><input type="checkbox" disabled={paused || !control?.canManage} checked={queueForm.confirmed} onChange={(e) => setQueueForm({ ...queueForm, confirmed: e.target.checked })} /><span>{paused ? "Sending is paused. Turn off Pause all before using immediate send." : "I confirm that I want to send this one email now."}</span></label>
                  <button className="danger-action full-field" disabled={working || paused || !queueForm.confirmed || !control?.canManage} onClick={() => runAction({ action: "send_now", emailId: queueForm.emailId, confirm: true }, "Brevo accepted the email. The database has been updated.")}>Send this email now</button>
                </div>
              </article>
              <article className="panel control-card"><p className="eyebrow">Scheduled queue</p><h2>Upcoming sends</h2><div className="mini-list">{control?.queue?.length ? control.queue.slice(0, 8).map((item) => <div key={item.id}><span><strong>{String(item.status)}</strong><small>{item.scheduled_for ? new Date(String(item.scheduled_for)).toLocaleString("en-IN") : "Awaiting time"}</small></span>{String(item.status).includes("scheduled") && <button disabled={!control?.canManage || working} onClick={() => runAction({ action: "cancel_scheduled", queueId: item.id }, "Scheduled email cancelled.")}>Cancel</button>}</div>) : <p className="muted-copy">No emails are scheduled.</p>}</div></article>
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
                  <label><span>Daily sending limit</span><input disabled={!control?.canManage || working} name="dailyLimit" type="number" min="1" max="200" defaultValue={control?.settings?.daily_limit || 25} /><small>Maximum client emails per day</small></label>
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
                <label><span>Full name</span><div className="voice-field"><input value={contactForm.name} onChange={(event) => setContactForm({ ...contactForm, name: event.target.value })} placeholder="Leave blank to use Sir/Madam" /><VoiceButton field="contactName" value={contactForm.name} onChange={(name) => setContactForm((current) => ({ ...current, name }))} label="contact name" /></div></label>
                <label><span>Email address</span><input required type="email" value={contactForm.email} onChange={(event) => setContactForm({ ...contactForm, email: event.target.value })} /></label>
                <label><span>Job title or role</span><div className="voice-field"><input value={contactForm.role} onChange={(event) => setContactForm({ ...contactForm, role: event.target.value })} placeholder="Example: Marketing Director" /><VoiceButton field="contactRole" value={contactForm.role} onChange={(role) => setContactForm((current) => ({ ...current, role }))} label="job title" /></div></label>
              </div>
              <div className="contact-form-section"><div><strong>Organization</strong><span>Organization changes are shared with its other contacts.</span></div>
                <label><span>Company or organization</span><div className="voice-field"><input required value={contactForm.company} onChange={(event) => setContactForm({ ...contactForm, company: event.target.value })} /><VoiceButton field="contactCompany" value={contactForm.company} onChange={(company) => setContactForm((current) => ({ ...current, company }))} label="company name" /></div></label>
                <label><span>Industry</span><div className="voice-field"><input value={contactForm.industry} onChange={(event) => setContactForm({ ...contactForm, industry: event.target.value })} placeholder="Example: Automotive manufacturing" /><VoiceButton field="contactIndustry" value={contactForm.industry} onChange={(industry) => setContactForm((current) => ({ ...current, industry }))} label="industry" /></div></label>
                <label><span>Website</span><input type="url" value={contactForm.website} onChange={(event) => setContactForm({ ...contactForm, website: event.target.value })} placeholder="https://company.com" /></label>
                <label><span>Country</span><div className="voice-field"><input value={contactForm.country} onChange={(event) => setContactForm({ ...contactForm, country: event.target.value })} placeholder="Example: India" /><VoiceButton field="contactCountry" value={contactForm.country} onChange={(country) => setContactForm((current) => ({ ...current, country }))} label="country" /></div></label>
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
