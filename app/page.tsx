"use client";

import { useEffect, useMemo, useState } from "react";
import data from "./dashboard-data.json";

type Section = "overview" | "create" | "emails" | "queue" | "contacts" | "companies" | "settings" | "activity";
type EmailRecord = { id: string; company: string; recipient: string; subject: string; campaign: string; html: string; status: string; sendStatus?: string | null; version: number; generatedAt: string };
type ControlData = { ok: boolean; canManage?: boolean; operator?: string | null; providers?: { database: boolean; brevo: boolean }; queue?: Array<Record<string, any>>; jobs?: Array<Record<string, any>>; settings?: Record<string, any>; campaigns?: Array<Record<string, any>>; liveEmails?: EmailRecord[]; sender?: { name: string; email: string }; replyTo?: string; scheduling?: { provider: string; timezone: string; maximumHoursAhead: number }; error?: string };

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

function contactDisplayName(contact: (typeof data.contacts)[number]) {
  if (contact.name?.trim() && contact.name.trim().toLowerCase() !== "sir/madam") return contact.name.trim();

  const parts = contact.email.split("@")[0].toLowerCase().split(/[._-]+/).filter(Boolean);
  const looksLikePerson = parts.length >= 2 && parts.length <= 4 && parts.every((part) =>
    /^[a-z]{2,20}$/.test(part) && !genericMailboxWords.has(part)
  );

  return looksLikePerson
    ? parts.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ")
    : "Sir/Madam";
}

function personalizeGreeting(html: string, recipient: string) {
  const contact = data.contacts.find((item) => item.email.toLowerCase() === recipient.toLowerCase());
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
  const [page, setPage] = useState(1);
  const [selectedEmail, setSelectedEmail] = useState<EmailRecord | null>(null);
  const [control, setControl] = useState<ControlData | null>(null);
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkMode, setBulkMode] = useState<"schedule" | "send" | "test" | null>(null);
  const [bulkForm, setBulkForm] = useState({ scheduledFor: "", delayMinutes: 5, confirmed: false, confirmText: "", testRecipients: "" });
  const [intakeForm, setIntakeForm] = useState({ topic: "AI Native Thinking Masterclass", rawInput: "", websites: "", brief: "" });
  const [intakeFile, setIntakeFile] = useState<File | null>(null);
  const [intakeResults, setIntakeResults] = useState<Array<Record<string, any>>>([]);
  const [queueForm, setQueueForm] = useState({ emailId: data.emails[0]?.id || "", scheduledFor: "", confirmed: false });
  const pageSize = 20;

  async function loadControl() {
    try {
      const response = await fetch("/api/control");
      setControl(await response.json());
    } catch {
      setControl({ ok: false, error: "Unable to reach the control service." });
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
      setNotice(success);
      await loadControl();
      return result;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Action failed.");
    } finally {
      setWorking(false);
    }
  }

  const displayEmails = useMemo<EmailRecord[]>(() => control?.liveEmails?.length ? control.liveEmails : data.emails as EmailRecord[], [control?.liveEmails]);
  const filteredEmails = useMemo(() => {
    const term = search.trim().toLowerCase();
    return displayEmails.filter((email) => {
      const matchesTerm = !term || `${email.company} ${email.recipient} ${email.subject} ${email.campaign}`.toLowerCase().includes(term);
      const status = email.sendStatus || email.status;
      const matchesStatus = emailStatus === "all" ||
        (emailStatus === "draft" && status === "draft_pending_review") ||
        (emailStatus === "failed" && Boolean(status?.includes("fail") || status?.includes("not_sent"))) ||
        status === emailStatus;
      return matchesTerm && matchesStatus;
    });
  }, [displayEmails, search, emailStatus]);

  const pagedEmails = filteredEmails.slice((page - 1) * pageSize, page * pageSize);
  const pages = Math.max(1, Math.ceil(filteredEmails.length / pageSize));
  const pageTitle = navItems.find((item) => item.id === section)?.label || "Overview";

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
    const result = await runAction({
      action: "schedule_batch",
      emailIds: [...selectedIds],
      scheduledFor: new Date(bulkForm.scheduledFor).toISOString(),
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
    const result = await runAction({
      action: "send_test",
      emailIds: [...selectedIds],
      testRecipients: bulkForm.testRecipients,
      confirm: bulkForm.confirmed,
    }, `Test copies sent successfully. The original recipients and draft statuses were not changed.`);
    if (result?.ok) {
      setBulkMode(null);
      setBulkForm({ scheduledFor: "", delayMinutes: 5, confirmed: false, confirmText: "", testRecipients: "" });
    }
  }

  async function runIntelligenceStudio() {
    let document: Record<string, string> | undefined;
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
          <div><strong>Database snapshot</strong><small>28 Jul 2026</small></div>
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
            <div className="avatar" aria-label="Tanishka">T</div>
          </div>
        </header>

        <div className="content">
          {control?.ok && !control.canManage && (
            <section className="access-banner">
              <div><strong>Public view · sending controls are locked</strong><p>Sign in with an authorized IKF account to approve, schedule, cancel, or send emails.</p></div>
              <a href="/signin-with-chatgpt?return_to=%2F">Sign in to manage</a>
            </section>
          )}
          {section === "overview" && (
            <>
              <section className="credit-alert" aria-label="Sending status">
                <span className="alert-icon">!</span>
                <div><strong>Sending is on hold</strong><p>No email will be sent until Suraj gives explicit approval. Drafts use Tanishka &lt;tanishka@iknowai.in&gt; and the updated signature.</p></div>
                <StatusPill value="paused_user_hold" />
              </section>

              <section className="metric-grid" aria-label="Outreach totals">
                <Metric label="Generated emails" value={data.summary.emails} note="Across 2 campaigns" tone="violet" />
                <Metric label="Needs review" value={data.summary.pendingReview} note="Before bulk sending" tone="amber" />
                <Metric label="Contacts" value={data.summary.contacts} note={`${data.summary.companies} companies`} tone="blue" />
                <Metric label="Past send failures" value={data.summary.failed} note="Before plan activation" tone="red" />
              </section>

              <section className="overview-grid">
                <article className="panel campaigns-panel">
                  <div className="panel-heading"><div><p className="eyebrow">Campaign health</p><h2>Active workstreams</h2></div><span>{data.campaigns.length} campaigns</span></div>
                  <div className="campaign-list">
                    {data.campaigns.map((campaign) => (
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
                    <div><span>Imported contacts</span><strong>{data.summary.contacts}</strong><i style={{ width: "100%" }} /></div>
                    <div><span>Generated drafts</span><strong>{data.summary.drafts}</strong><i style={{ width: `${Math.round(data.summary.drafts / data.summary.contacts * 100)}%` }} /></div>
                    <div><span>Approved to send</span><strong>0</strong><i style={{ width: "1%" }} /></div>
                    <div><span>Delivered</span><strong>0</strong><i style={{ width: "1%" }} /></div>
                  </div>
                </article>
              </section>

              <section className="panel recent-panel">
                <div className="panel-heading"><div><p className="eyebrow">Latest output</p><h2>Recently generated emails</h2></div><button className="text-button" onClick={() => switchSection("emails")}>View all {data.summary.emails} →</button></div>
                <EmailTable rows={displayEmails.slice(0, 7)} onOpen={setSelectedEmail} compact />
              </section>
            </>
          )}

          {section === "emails" && (
            <section className="panel data-panel">
              <div className="panel-heading filters-heading">
                <div><p className="eyebrow">Email library</p><h2>{filteredEmails.length} generated emails</h2><p className="section-helper">Select emails, preview the content, then schedule or send only after confirmation.</p></div>
                <select value={emailStatus} onChange={(event) => { setEmailStatus(event.target.value); setPage(1); }} aria-label="Filter by email status">
                  <option value="all">All statuses</option>
                  <option value="draft">Needs review</option>
                  <option value="failed">Failed</option>
                  <option value="sent">Sent</option>
                </select>
              </div>
              <div className="selection-toolbar">
                <div><strong>{selectedIds.size} selected</strong><span>{selectedIds.size ? "Ready for review or scheduling" : "Use the checkboxes to choose emails"}</span></div>
                <div>
                  <button disabled={!selectedIds.size || !control?.canManage || working} onClick={() => runAction({ action: "approve_batch", emailIds: [...selectedIds] }, `${selectedIds.size} emails approved. Nothing has been sent.`)}>Approve</button>
                  <button className="test-action" disabled={!selectedIds.size || !control?.canManage || working} onClick={() => setBulkMode("test")}>Send test copy</button>
                  <button className="primary-action" disabled={!selectedIds.size || !control?.canManage || working} onClick={() => setBulkMode("schedule")}>Schedule selected</button>
                  <button className="send-action" disabled={!selectedIds.size || !control?.canManage || working} onClick={() => setBulkMode("send")}>Send selected now</button>
                  {selectedIds.size > 0 && <button className="quiet-action" onClick={() => setSelectedIds(new Set())}>Clear</button>}
                </div>
              </div>
              {bulkMode === "schedule" && (
                <div className="bulk-panel">
                  <div><p className="eyebrow">Automatic delivery</p><h3>Schedule {selectedIds.size} emails</h3><p>Brevo will hold and deliver these messages even after this dashboard is closed.</p></div>
                  <label>First email time<input type="datetime-local" value={bulkForm.scheduledFor} onChange={(e) => setBulkForm({ ...bulkForm, scheduledFor: e.target.value })} /></label>
                  <label>Spacing between emails<select value={bulkForm.delayMinutes} onChange={(e) => setBulkForm({ ...bulkForm, delayMinutes: Number(e.target.value) })}><option value={2}>2 minutes</option><option value={5}>5 minutes</option><option value={10}>10 minutes</option><option value={15}>15 minutes</option></select></label>
                  <label className="confirm-box"><input type="checkbox" checked={bulkForm.confirmed} onChange={(e) => setBulkForm({ ...bulkForm, confirmed: e.target.checked })} /><span>I reviewed the recipients and approve automatic delivery.</span></label>
                  <div className="bulk-actions"><button className="quiet-action" onClick={() => setBulkMode(null)}>Cancel</button><button className="primary-action" disabled={!bulkForm.scheduledFor || !bulkForm.confirmed || working} onClick={runBulkSchedule}>{working ? "Scheduling…" : "Confirm schedule"}</button></div>
                </div>
              )}
              {bulkMode === "send" && (
                <div className="bulk-panel danger-panel">
                  <div><p className="eyebrow">Immediate send</p><h3>Send {selectedIds.size} emails now</h3><p>This action cannot be undone. Type <strong>SEND</strong> to confirm.</p></div>
                  <label>Confirmation<input value={bulkForm.confirmText} onChange={(e) => setBulkForm({ ...bulkForm, confirmText: e.target.value.toUpperCase() })} placeholder="Type SEND" /></label>
                  <div className="bulk-actions"><button className="quiet-action" onClick={() => setBulkMode(null)}>Cancel</button><button className="danger-action" disabled={bulkForm.confirmText !== "SEND" || working} onClick={runBulkSend}>{working ? "Sending…" : "Send now"}</button></div>
                </div>
              )}
              {bulkMode === "test" && (
                <div className="bulk-panel test-panel">
                  <div><p className="eyebrow">Inbox preview</p><h3>Send {selectedIds.size} selected email{selectedIds.size === 1 ? "" : "s"} to yourself</h3><p>Each message is clearly marked as a test. Original recipients and draft statuses stay unchanged.</p></div>
                  <label className="test-recipient-field">Your test email addresses<textarea rows={3} value={bulkForm.testRecipients} onChange={(e) => setBulkForm({ ...bulkForm, testRecipients: e.target.value })} placeholder={"suraj@ikf.co.in\ntanishka@iknowai.in"} /><small>Paste up to 5 addresses, separated by commas or new lines.</small></label>
                  <label className="confirm-box"><input type="checkbox" checked={bulkForm.confirmed} onChange={(e) => setBulkForm({ ...bulkForm, confirmed: e.target.checked })} /><span>I confirm these are test inboxes and want to send preview copies.</span></label>
                  <div className="bulk-actions"><button className="quiet-action" onClick={() => setBulkMode(null)}>Cancel</button><button className="test-send-action" disabled={!bulkForm.testRecipients.trim() || !bulkForm.confirmed || working} onClick={runTestSend}>{working ? "Sending test…" : "Send test copies"}</button></div>
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
                  <label className="topic-field"><span>What is this outreach about?</span><input required value={intakeForm.topic} onChange={(event) => setIntakeForm({ ...intakeForm, topic: event.target.value })} placeholder="Example: AI Native Thinking Masterclass for leadership teams" /><small>This topic is used in every subject line and personalized email.</small></label>
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
                      <input type="file" accept=".pdf,.docx,.csv,.tsv,.txt" onChange={(event) => setIntakeFile(event.target.files?.[0] || null)} />
                      <span className="file-cta">{intakeFile ? intakeFile.name : "Choose document"}</span>
                    </label>
                  </div>
                  <label className="brief-field"><span>Optional context or instructions</span><textarea rows={3} value={intakeForm.brief} onChange={(event) => setIntakeForm({ ...intakeForm, brief: event.target.value })} placeholder="Mention the audience, desired outcome, offer, industry angle, or specific pain points." /></label>
                  <div className="studio-actions"><div><strong>Draft-only workflow</strong><span>Nothing is approved, scheduled, or sent automatically.</span></div><button className="primary-action" disabled={working || !control?.canManage}>{working ? "Researching websites…" : "Research & create drafts"}</button></div>
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
                  <div className="button-stack"><button disabled={working} onClick={() => runAction({ action: "approve", emailId: queueForm.emailId }, "Email approved. It has not been sent.")}>Approve draft</button><button disabled={working || !queueForm.scheduledFor} onClick={() => runAction({ action: "schedule", emailId: queueForm.emailId, scheduledFor: new Date(queueForm.scheduledFor).toISOString() }, "Email added to the scheduled queue.")}>Schedule</button></div>
                  <label className="confirm-box full-field"><input type="checkbox" checked={queueForm.confirmed} onChange={(e) => setQueueForm({ ...queueForm, confirmed: e.target.checked })} /><span>I confirm that I want to send this one email now.</span></label>
                  <button className="danger-action full-field" disabled={working || !queueForm.confirmed || !control?.canManage} onClick={() => runAction({ action: "send_now", emailId: queueForm.emailId, confirm: true }, "Brevo accepted the email. The database has been updated.")}>Send this email now</button>
                </div>
              </article>
              <article className="panel control-card"><p className="eyebrow">Scheduled queue</p><h2>Upcoming sends</h2><div className="mini-list">{control?.queue?.length ? control.queue.slice(0, 8).map((item) => <div key={item.id}><span><strong>{String(item.status)}</strong><small>{item.scheduled_for ? new Date(String(item.scheduled_for)).toLocaleString("en-IN") : "Awaiting time"}</small></span>{String(item.status).includes("scheduled") && <button disabled={!control?.canManage || working} onClick={() => runAction({ action: "cancel_scheduled", queueId: item.id }, "Scheduled email cancelled.")}>Cancel</button>}</div>) : <p className="muted-copy">No emails are scheduled.</p>}</div></article>
            </section>
          )}

          {section === "settings" && (
            <section className="workspace-grid">
              <article className="panel control-card">
                <p className="eyebrow">Live connections</p><h2>API status</h2>
                <div className="api-grid"><div><span className={`api-dot ${control?.providers?.database ? "online" : "offline"}`} /><strong>Supabase</strong><small>{control?.providers?.database ? "Connected" : "Unavailable"}</small></div><div><span className={`api-dot ${control?.providers?.brevo ? "online" : "offline"}`} /><strong>Brevo</strong><small>{control?.providers?.brevo ? "Connected" : "Unavailable"}</small></div></div>
                <button onClick={loadControl}>Check connections</button>
              </article>
              <article className="panel control-card wide-card">
                <div className="panel-heading"><div><p className="eyebrow">Sending identity</p><h2>Tanishka &lt;tanishka@iknowai.in&gt;</h2></div><StatusPill value="active" /></div>
                <div className="identity-grid"><div><span>Reply-To</span><strong>{control?.replyTo || "tanishka@iknowai.in"}</strong></div><div><span>Default mode</span><strong>Manual approval</strong></div><div><span>Timezone</span><strong>Asia/Kolkata</strong></div><div><span>Campaign state</span><strong>On hold</strong></div></div>
                <form className="policy-row" onSubmit={(e) => { e.preventDefault(); const form = new FormData(e.currentTarget); runAction({ action: "policy", dailyLimit: form.get("dailyLimit"), delay: form.get("delay"), windowStart: form.get("windowStart"), windowEnd: form.get("windowEnd"), paused: form.get("paused") === "on" }, "Safety settings saved."); }}><label>Daily limit<input name="dailyLimit" type="number" min="1" max="200" defaultValue={control?.settings?.daily_limit || 25} /></label><label>Delay (minutes)<input name="delay" type="number" min="1" defaultValue={control?.settings?.minimum_delay_minutes || 5} /></label><label>Start<input name="windowStart" type="time" defaultValue={control?.settings?.sending_window_start || "10:00"} /></label><label>End<input name="windowEnd" type="time" defaultValue={control?.settings?.sending_window_end || "17:00"} /></label><label className="confirm-box"><input name="paused" type="checkbox" defaultChecked={control?.settings?.paused ?? true} /><span>Pause all</span></label><button className="primary-action">Save controls</button></form>
              </article>
            </section>
          )}

          {section === "contacts" && (
            <section className="panel data-panel">
              <div className="panel-heading"><div><p className="eyebrow">Audience</p><h2>{data.contacts.length} contacts</h2></div><span>{data.contacts.filter((contact) => contactDisplayName(contact) !== "Sir/Madam").length} named contacts</span></div>
              <div className="table-wrap"><table><thead><tr><th>Contact</th><th>Company</th><th>Industry</th><th>Confidence</th><th>Added</th></tr></thead><tbody>
                {data.contacts.filter((contact) => !search || `${contactDisplayName(contact)} ${contact.email} ${contact.company}`.toLowerCase().includes(search.toLowerCase())).slice(0, 100).map((contact) => <tr key={contact.id}><td><strong>{contactDisplayName(contact)}</strong><span>{contact.email}</span></td><td>{contact.company}</td><td>{contact.industry || "—"}</td><td><StatusPill value={contact.confidence} /></td><td>{compactDate(contact.createdAt)}</td></tr>)}
              </tbody></table></div>
            </section>
          )}

          {section === "companies" && (
            <section className="panel data-panel">
              <div className="panel-heading"><div><p className="eyebrow">Organizations</p><h2>{data.companies.length} companies</h2></div><span>Deduplicated by domain</span></div>
              <div className="company-grid">
                {data.companies.filter((company) => !search || `${company.name} ${company.industry}`.toLowerCase().includes(search.toLowerCase())).slice(0, 100).map((company) => <article key={company.id} className="company-card"><div className="company-letter">{company.name.slice(0, 1)}</div><div><strong>{company.name}</strong><span>{company.industry || "Industry pending verification"}</span><small>{company.contacts} contacts · {company.drafts} drafts</small></div></article>)}
              </div>
            </section>
          )}

          {section === "activity" && (
            <section className="panel data-panel">
              <div className="panel-heading"><div><p className="eyebrow">Audit trail</p><h2>Recent activity</h2></div><span>Latest 100 events</span></div>
              <div className="timeline">
                {data.activity.map((item, index) => <div className="timeline-item" key={`${item.createdAt}-${index}`}><span className="timeline-dot" /><div><strong>{prettyStatus(item.action)}</strong><p>{item.company || item.email || "System-wide operation"}</p><small>{compactDate(item.createdAt)}</small></div></div>)}
              </div>
            </section>
          )}
        </div>
      </main>

      {selectedEmail && (
        <div className="drawer-backdrop" onMouseDown={() => setSelectedEmail(null)}>
          <aside className="email-drawer" onMouseDown={(event) => event.stopPropagation()} aria-label="Email preview">
            <div className="drawer-header"><div><p className="eyebrow">Email preview</p><h2>{selectedEmail.company}</h2></div><button onClick={() => setSelectedEmail(null)} aria-label="Close email preview">×</button></div>
            <div className="email-meta"><div><span>To</span><strong>{selectedEmail.recipient}</strong></div><div><span>Subject</span><strong>{selectedEmail.subject}</strong></div><div><span>Campaign</span><strong>{selectedEmail.campaign}</strong></div><div><span>Status</span><StatusPill value={selectedEmail.sendStatus || selectedEmail.status} /></div></div>
            <iframe title={`Preview of ${selectedEmail.subject}`} sandbox="" srcDoc={`<style>body{font-family:Calibri,Arial,sans-serif;color:#25262b;line-height:1.5;padding:24px;font-size:11pt}a{color:#5d45db}li{margin:7px 0}</style>${personalizeGreeting(selectedEmail.html, selectedEmail.recipient)}`} />
            <div className="drawer-footer"><span>Version {selectedEmail.version} · {compactDate(selectedEmail.generatedAt)}</span><button onClick={() => navigator.clipboard?.writeText(selectedEmail.subject)}>Copy subject</button></div>
          </aside>
        </div>
      )}
      {notice && <div className="toast" role="status"><span>{notice}</span><button onClick={() => setNotice("")}>×</button></div>}
    </div>
  );
}
