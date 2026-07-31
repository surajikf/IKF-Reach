"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import data from "./dashboard-data.json";
import StatisticsDashboard from "./statistics-dashboard";
import RichEmailEditor from "./rich-email-editor";
import { inferContactName } from "./lib/name";

type Section = "overview" | "create" | "campaigns" | "statistics" | "emails" | "queue" | "contacts" | "companies" | "settings" | "activity";
type CampaignWorkspaceView = "overview" | "emails" | "delivery";
type EmailRecord = { id: string; company: string; recipient: string; subject: string; campaign: string; html: string; status: string; sendStatus?: string | null; version: number; generatedAt: string };
type ContactRecord = { id: string; companyId?: string | null; name?: string | null; email: string; role?: string | null; confidence?: string | null; company: string; industry?: string | null; companyWebsite?: string | null; companyCountry?: string | null; createdAt?: string | null };
type CompanyRecord = { id: string; name: string; website?: string | null; industry?: string | null; country?: string | null; contacts: number; drafts: number; updatedAt?: string | null };
type ActivityRecord = { id?: string | number; action: string; company?: string | null; email?: string | null; createdAt: string };
type LiveStats = { companies: number; contacts: number; emails: number; pendingReview: number; approved: number; scheduled: number; sent: number; failed: number };
type WebsiteScanRecord = { input: string; ok: boolean; website?: string; companyName?: string; discoveredEmails: string[]; pagesReviewed: string[]; error?: string };
type BackgroundJob = { id: string; campaignId: string; campaignName: string; topic?: string; emailTemplate?: string; emailTemplateFormat?: string; emailTemplateText?: string; templateVersion?: number; brief?: string; status: string; totalItems: number; completedItems: number; successfulItems: number; failedItems: number; retryItems?: number; draftsCreated: number; contactsFound: number; lastError?: string | null; createdAt: string; startedAt?: string | null; updatedAt: string };
type ValidationVerdict = "valid" | "risky" | "invalid" | "unknown";
type ValidationResult = { contactId: string; email: string; verdict: ValidationVerdict; score: number; syntaxValid: boolean; domainReachable: boolean | null; roleBased: boolean; disposable: boolean; previousHardBounce: boolean; previousSoftBounce: boolean; previousDelivered: boolean; complaint: boolean; unsubscribed: boolean; reasons: string[]; mxRecords: string[]; validatedAt: string };
type ValidationJob = { id: string; status: string; scheduledFor?: string | null; totalItems: number; processedItems: number; validItems: number; riskyItems: number; invalidItems: number; unknownItems: number; failedItems: number; lastError?: string | null; createdAt: string; startedAt?: string | null; completedAt?: string | null; updatedAt: string };
type ValidationData = { ok: boolean; canManage?: boolean; jobs?: ValidationJob[]; results?: ValidationResult[]; summary?: { checked: number; valid: number; risky: number; invalid: number; unknown: number }; refreshedAt?: string; error?: string };
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
  availableSenders?: Array<{ name: string; email: string; active: boolean }>;
  replyTo?: string;
  refreshedAt?: string;
  scheduling?: { provider: string; timezone: string; maximumHoursAhead: number };
  error?: string;
};

const navItems: Array<{ id: Section; label: string; icon: string }> = [
  { id: "overview", label: "Overview", icon: "⌂" },
  { id: "create", label: "Create Campaign", icon: "+" },
  { id: "campaigns", label: "Campaigns", icon: "▦" },
  { id: "statistics", label: "Statistics", icon: "↗" },
  { id: "contacts", label: "Contacts", icon: "◎" },
  { id: "companies", label: "Companies", icon: "◇" },
  { id: "settings", label: "Controls & APIs", icon: "⚙" },
  { id: "activity", label: "Activity", icon: "↗" },
];

const industryDomains = [
  "Manufacturing",
  "IT & Software",
  "AI & Technology",
  "Marketing & Advertising",
  "Professional Services",
  "Financial Services",
  "Healthcare & Life Sciences",
  "Education & Research",
  "Retail & E-commerce",
  "Construction & Real Estate",
  "Automotive & Mobility",
  "Agriculture & Food",
  "Energy & Utilities",
  "Government & Public Sector",
  "Associations & Non-profits",
  "Media & Entertainment",
  "Logistics & Transportation",
  "Hospitality & Travel",
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
  queued: "Queued",
  researching: "Researching",
  completed_with_issues: "Completed with issues",
  research_failed: "Research failed",
  research_complete_no_contacts: "No contacts found",
  research_cancelled: "Research stopped",
  cancelled: "Stopped",
  needs_attention: "Needs attention",
  empty: "Empty",
  paused_no_credits: "Paused",
  paused_user_hold: "On hold",
};

function prettyStatus(value?: string | null) {
  if (!value) return "Draft";
  return statusLabel[value] || value.replaceAll("_", " ");
}

function fullWebsiteUrl(value?: string | null) {
  const website = String(value || "").trim();
  if (!website) return "";
  return /^https?:\/\//i.test(website) ? website : `https://${website.replace(/^\/+/, "")}`;
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

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function shortName(name: string) {
  return name.length > 43 ? `${name.slice(0, 43)}…` : name;
}

function contactDisplayName(contact: ContactRecord) {
  return inferContactName(contact.email, contact.name);
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

function ValidationPill({ result }: { result?: ValidationResult }) {
  if (!result) return <span className="validation-pill unchecked">Not checked</span>;
  const label = result.verdict === "invalid" ? "Quarantined" : prettyStatus(result.verdict);
  return (
    <span
      className={`validation-pill ${result.verdict}`}
      title={result.reasons.join(" • ") || `Validation score ${result.score}`}
    >
      {label} <small>{result.score}</small>
    </span>
  );
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

function EmailTable({ rows, onOpen, compact = false, selected, onSelect, onDelete, deletingDisabled = false }: { rows: EmailRecord[]; onOpen: (email: EmailRecord) => void; compact?: boolean; selected?: Set<string>; onSelect?: (id: string, checked: boolean) => void; onDelete?: (email: EmailRecord) => void; deletingDisabled?: boolean }) {
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
            {onDelete && <th>Action</th>}
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
              {onDelete && <td onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}><button type="button" className="delete-email-action" disabled={deletingDisabled || email.status === "sent" || email.status === "scheduled" || String(email.sendStatus || "").startsWith("scheduled")} onClick={() => onDelete(email)} title={email.status === "sent" || email.status === "scheduled" || String(email.sendStatus || "").startsWith("scheduled") ? "Sent or scheduled emails cannot be deleted" : "Delete this generated email"}>Delete</button></td>}
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

  useEffect(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("ikf_reach_section");
      if (saved) {
        setSection(saved as Section);
      }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("ikf_reach_section", section);
  }, [section]);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [emailStatus, setEmailStatus] = useState("all");
  const [emailCampaign, setEmailCampaign] = useState("all");
  const [page, setPage] = useState(1);
  const [contactPage, setContactPage] = useState(1);
  const [companyPage, setCompanyPage] = useState(1);
  const [selectedEmail, setSelectedEmail] = useState<EmailRecord | null>(null);
  const [selectedContact, setSelectedContact] = useState<ContactRecord | null>(null);
  const [selectedCompany, setSelectedCompany] = useState<CompanyRecord | null>(null);
  const [editingCompany, setEditingCompany] = useState<CompanyRecord | null>(null);
  const [contactForm, setContactForm] = useState({ name: "", email: "", role: "", company: "", industry: "", website: "", country: "" });
  const [companyForm, setCompanyForm] = useState({ name: "", industry: "", website: "", country: "" });
  const [control, setControl] = useState<ControlData | null>(null);
  const [working, setWorking] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState("");
  const [noticeTone, setNoticeTone] = useState<"success" | "error">("success");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkMode, setBulkMode] = useState<"schedule" | "send" | "test" | null>(null);
  const [bulkForm, setBulkForm] = useState({ scheduledFor: "", delayMinutes: 5, confirmed: false, confirmText: "", testRecipients: "" });
  const [intakeForm, setIntakeForm] = useState({
    campaignName: "",
    topic: "",
    emailTemplate: `<p>Dear <span class="personalization-chip" data-personalization="name" contenteditable="false">{{name}}</span>,</p>
<p>While reviewing <strong><u><span class="personalization-chip" data-personalization="company" contenteditable="false">{{company}}</span></u></strong>, I noted its focus on <span class="personalization-chip" data-personalization="research" contenteditable="false">{{research}}</span>. This creates a relevant opportunity to apply <strong><span class="personalization-chip" data-personalization="topic" contenteditable="false">{{topic}}</span></strong> thinking across <span class="personalization-chip" data-personalization="focus_areas" contenteditable="false">{{focus_areas}}</span>.</p>
<p>We would be delighted to conduct a practical <strong><span class="personalization-chip" data-personalization="topic" contenteditable="false">{{topic}}</span></strong> session tailored to your leadership and functional teams.</p>
<p>Please let me know a suitable time to connect.</p>`,
    emailTemplateFormat: "rich_html_v1",
    emailTemplateVersion: 1,
    rawInput: "",
    websites: "",
    brief: "",
    industry: "",
    senderEmail: "tanishka@iknowai.in",
    replyToEmail: "tanishka@iknowai.in",
  });
  const [currentStep, setCurrentStep] = useState(1);

  // Auto-save intakeForm to localStorage
  useEffect(() => {
    const saved = localStorage.getItem("ikf_reach_draft");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === "object") {
          setIntakeForm(parsed);
        }
      } catch (e) {
        console.error("Failed to parse saved draft", e);
      }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("ikf_reach_draft", JSON.stringify(intakeForm));
  }, [intakeForm]);

  const [replyToChoice, setReplyToChoice] = useState("sender");
  const [intakeFile, setIntakeFile] = useState<File | null>(null);
  const [intakeResults, setIntakeResults] = useState<Array<Record<string, any>>>([]);
  const [websiteScans, setWebsiteScans] = useState<WebsiteScanRecord[]>([]);
  const [scanningWebsites, setScanningWebsites] = useState(false);
  const [scanProgress, setScanProgress] = useState<{ completed: number; total: number } | null>(null);
  const [scanWaitNote, setScanWaitNote] = useState<string | null>(null);
  const [scanSavedTotals, setScanSavedTotals] = useState<{ contactsCreated: number; companiesCreated: number } | null>(null);
  const scanCancelRef = useRef(false);
  const [savingDiscoveredContacts, setSavingDiscoveredContacts] = useState(false);
  const [queueForm, setQueueForm] = useState({ campaignId: "", scheduledFor: "", batchSize: 1, delayMinutes: 5, confirmed: false });
  const [campaignDeliveryChoice, setCampaignDeliveryChoice] = useState<"schedule" | "send">("schedule");
  const [campaignSendConfirm, setCampaignSendConfirm] = useState("");
  const [campaignStatusFilter, setCampaignStatusFilter] = useState("all");
  const [campaignWorkspaceView, setCampaignWorkspaceView] = useState<CampaignWorkspaceView>("overview");
  const [campaignDetailOpen, setCampaignDetailOpen] = useState(false);
  const [campaignDeleteId, setCampaignDeleteId] = useState<string | null>(null);
  const [campaignDeleteConfirm, setCampaignDeleteConfirm] = useState("");
  const [contactPageSize, setContactPageSize] = useState(50);
  const [companyPageSize, setCompanyPageSize] = useState(18);
  const [contactIndustry, setContactIndustry] = useState("all");
  const [companyIndustry, setCompanyIndustry] = useState("all");
  const [companyView, setCompanyView] = useState<"cards" | "table">("cards");
  const [activityFilter, setActivityFilter] = useState("all");
  const [settingsView, setSettingsView] = useState<"connections" | "workflow" | "delivery">("connections");
  const [accessBannerExpanded, setAccessBannerExpanded] = useState(false);
  const [validationData, setValidationData] = useState<ValidationData | null>(null);
  const [validationFilter, setValidationFilter] = useState<"all" | ValidationVerdict | "unchecked">("all");
  const [validationPanelOpen, setValidationPanelOpen] = useState(false);
  const [validationScheduleMode, setValidationScheduleMode] = useState<"now" | "schedule">("now");
  const [validationScheduledFor, setValidationScheduledFor] = useState("");
  const [validationScope, setValidationScope] = useState<"unchecked" | "selected" | "all">("unchecked");
  const [selectedContactIds, setSelectedContactIds] = useState<Set<string>>(new Set());
  const backgroundKickoffsRef = useRef(new Map<string, number>());
  const validationKickoffsRef = useRef(new Map<string, number>());
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

  async function loadValidation() {
    try {
      const response = await fetch("/api/email-validation");
      setValidationData(await response.json());
    } catch {
      setValidationData({ ok: false, error: "Unable to load email validation status." });
    }
  }

  useEffect(() => { loadControl(); loadValidation(); }, []);

  useEffect(() => {
    const available = control?.availableSenders || [];
    if (available.length && !available.some((item) => item.email === intakeForm.senderEmail)) {
      setIntakeForm((current) => ({
        ...current,
        senderEmail: available[0].email,
        ...(replyToChoice === "sender" ? { replyToEmail: available[0].email } : {}),
      }));
    }
  }, [control?.availableSenders, intakeForm.senderEmail, replyToChoice]);

  useEffect(() => {
    const active = (control?.jobs || []).some((job) => ["queued", "researching"].includes(String(job.status)));
    if (!active) return;
    const timer = window.setInterval(loadControl, 3000);
    return () => window.clearInterval(timer);
  }, [control?.jobs]);

  useEffect(() => {
    const active = (validationData?.jobs || []).some((job) => ["scheduled", "queued", "running"].includes(job.status));
    if (!active) return;
    const timer = window.setInterval(loadValidation, 3000);
    return () => window.clearInterval(timer);
  }, [validationData?.jobs]);

  useEffect(() => {
    const now = Date.now();
    for (const job of (validationData?.jobs || [])) {
      if (!["queued", "running"].includes(job.status)) continue;
      const lastKickoff = validationKickoffsRef.current.get(job.id) || 0;
      const updatedAt = new Date(job.updatedAt || job.startedAt || job.createdAt).getTime();
      const stalled = Number.isFinite(updatedAt) && now - updatedAt > 90_000;
      if (now - lastKickoff < 60_000 || (job.status !== "queued" && !stalled)) continue;
      validationKickoffsRef.current.set(job.id, now);
      void fetch("/api/background-email-validation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id }),
      }).then((response) => {
        if (!response.ok) validationKickoffsRef.current.delete(job.id);
      }).catch(() => validationKickoffsRef.current.delete(job.id));
    }
  }, [validationData?.jobs]);

  useEffect(() => {
    const now = Date.now();
    for (const job of (control?.jobs || []) as BackgroundJob[]) {
      if (!["queued", "researching"].includes(String(job.status))) continue;
      const lastKickoff = backgroundKickoffsRef.current.get(job.id) || 0;
      const updatedAt = new Date(job.updatedAt || job.createdAt).getTime();
      const stalled = Number.isFinite(updatedAt) && now - updatedAt > 120_000;
      if (now - lastKickoff < 120_000 || (job.status !== "queued" && !stalled)) continue;
      backgroundKickoffsRef.current.set(job.id, now);
      void fetch("/api/background-campaign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id }),
      });
    }
  }, [control?.jobs]);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileMenuOpen(false);
    };
    const desktopQuery = window.matchMedia("(min-width: 761px)");
    const closeOnDesktop = (event: MediaQueryListEvent) => {
      if (event.matches) setMobileMenuOpen(false);
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", closeOnEscape);
    desktopQuery.addEventListener("change", closeOnDesktop);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
      desktopQuery.removeEventListener("change", closeOnDesktop);
    };
  }, [mobileMenuOpen]);

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

  async function startEmailValidation() {
    setWorking(true);
    setNotice("");
    try {
      let contactIds: string[] | undefined;
      if (validationScope === "selected") {
        contactIds = [...selectedContactIds];
        if (!contactIds.length) throw new Error("Select at least one contact to validate.");
      } else if (validationScope === "unchecked") {
        contactIds = displayContacts
          .filter((contact) => !validationByContact.has(contact.id))
          .map((contact) => contact.id);
        if (!contactIds.length) throw new Error("Every contact has already been checked. Choose All contacts to revalidate them.");
      }
      let scheduledFor: string | null = null;
      if (validationScheduleMode === "schedule") {
        const scheduledDate = new Date(validationScheduledFor);
        if (!validationScheduledFor || Number.isNaN(scheduledDate.getTime())) {
          throw new Error("Choose a valid date and time for the validation.");
        }
        if (scheduledDate.getTime() <= Date.now()) {
          throw new Error("Choose a future date and time for the validation.");
        }
        scheduledFor = scheduledDate.toISOString();
      }
      const response = await fetch("/api/email-validation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "queue", scheduledFor, contactIds }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Email validation could not be queued.");
      if (!scheduledFor) {
        void fetch("/api/background-email-validation", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId: result.jobId }),
        });
      }
      setValidationPanelOpen(false);
      setValidationScheduledFor("");
      setSelectedContactIds(new Set());
      setNoticeTone("success");
      setNotice(scheduledFor
        ? `Email validation is scheduled for ${new Date(scheduledFor).toLocaleString("en-IN")}. It will run with the dashboard closed.`
        : `${result.totalItems} contacts were queued for validation. No validation email will be sent.`);
      await loadValidation();
    } catch (error) {
      setNoticeTone("error");
      setNotice(error instanceof Error ? error.message : "Email validation failed.");
    } finally {
      setWorking(false);
    }
  }

  async function cancelEmailValidation(jobId: string) {
    setWorking(true);
    try {
      const response = await fetch("/api/email-validation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel", jobId }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Validation could not be stopped.");
      setNoticeTone("success");
      setNotice("Email validation was stopped. Completed results were preserved.");
      await loadValidation();
    } catch (error) {
      setNoticeTone("error");
      setNotice(error instanceof Error ? error.message : "Validation could not be stopped.");
    } finally {
      setWorking(false);
    }
  }

  const displayEmails = useMemo<EmailRecord[]>(() => Array.isArray(control?.liveEmails) ? control.liveEmails : data.emails as EmailRecord[], [control?.liveEmails]);
  const displayContacts = useMemo<ContactRecord[]>(() => Array.isArray(control?.liveContacts) ? control.liveContacts : data.contacts as ContactRecord[], [control?.liveContacts]);
  const displayCompanies = useMemo<CompanyRecord[]>(() => Array.isArray(control?.liveCompanies) ? control.liveCompanies : data.companies as CompanyRecord[], [control?.liveCompanies]);
  const displayActivity = useMemo<ActivityRecord[]>(() => Array.isArray(control?.liveActivity) ? control.liveActivity : data.activity as ActivityRecord[], [control?.liveActivity]);
  const availableIndustries = useMemo(
    () => [...new Set([...industryDomains, ...displayCompanies.map((company) => company.industry || "").filter(Boolean)])].sort((a, b) => a.localeCompare(b)),
    [displayCompanies],
  );
  const validationByContact = useMemo(
    () => new Map((validationData?.results || []).map((result) => [result.contactId, result])),
    [validationData?.results],
  );
  const activeValidationJob = useMemo(
    () => (validationData?.jobs || []).find((job) => ["scheduled", "queued", "running"].includes(job.status)),
    [validationData?.jobs],
  );
  const validationCounts = useMemo(() => {
    const counts = { all: displayContacts.length, valid: 0, risky: 0, invalid: 0, unknown: 0, unchecked: 0 };
    for (const contact of displayContacts) {
      const verdict = validationByContact.get(contact.id)?.verdict;
      if (verdict) counts[verdict] += 1;
      else counts.unchecked += 1;
    }
    return counts;
  }, [displayContacts, validationByContact]);
  const filteredContacts = useMemo(() => {
    const term = search.trim().toLowerCase();
    return displayContacts.filter((contact) => {
      const matchesIndustry = contactIndustry === "all" || (contact.industry || "") === contactIndustry;
      const verdict = validationByContact.get(contact.id)?.verdict;
      const matchesValidation = validationFilter === "all"
        || (validationFilter === "unchecked" ? !verdict : verdict === validationFilter);
      return matchesIndustry && matchesValidation && (!term || `${contactDisplayName(contact)} ${contact.email} ${contact.company} ${contact.industry || ""}`.toLowerCase().includes(term));
    });
  }, [displayContacts, search, contactIndustry, validationByContact, validationFilter]);
  const contactPages = Math.max(1, Math.ceil(filteredContacts.length / contactPageSize));
  const safeContactPage = Math.min(contactPage, contactPages);
  const pagedContacts = filteredContacts.slice((safeContactPage - 1) * contactPageSize, safeContactPage * contactPageSize);
  const pageContactIds = pagedContacts.map((contact) => contact.id);
  const pageContactsSelected = pageContactIds.length > 0 && pageContactIds.every((id) => selectedContactIds.has(id));
  const toggleContactSelection = (contactId: string) => {
    setSelectedContactIds((current) => {
      const next = new Set(current);
      if (next.has(contactId)) next.delete(contactId);
      else next.add(contactId);
      return next;
    });
  };
  const togglePageContactSelection = () => {
    setSelectedContactIds((current) => {
      const next = new Set(current);
      if (pageContactsSelected) pageContactIds.forEach((id) => next.delete(id));
      else pageContactIds.forEach((id) => next.add(id));
      return next;
    });
  };
  const selectAllFilteredContacts = () => {
    setSelectedContactIds(new Set(filteredContacts.map((contact) => contact.id)));
  };
  const filteredCompanies = useMemo(() => {
    const term = search.trim().toLowerCase();
    return displayCompanies.filter((company) => {
      const matchesIndustry = companyIndustry === "all" || (company.industry || "") === companyIndustry;
      return matchesIndustry && (!term || `${company.name} ${company.industry || ""} ${company.website || ""}`.toLowerCase().includes(term));
    });
  }, [displayCompanies, search, companyIndustry]);
  const companyPages = Math.max(1, Math.ceil(filteredCompanies.length / companyPageSize));
  const safeCompanyPage = Math.min(companyPage, companyPages);
  const pagedCompanies = filteredCompanies.slice((safeCompanyPage - 1) * companyPageSize, safeCompanyPage * companyPageSize);
  const activityTypes = useMemo(
    () => [...new Set(displayActivity.map((item) => item.action).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [displayActivity],
  );
  const filteredActivity = useMemo(() => {
    const term = search.trim().toLowerCase();
    return displayActivity.filter((item) => {
      const matchesType = activityFilter === "all" || item.action === activityFilter;
      const haystack = `${prettyStatus(item.action)} ${item.company || ""} ${item.email || ""}`.toLowerCase();
      return matchesType && (!term || haystack.includes(term));
    });
  }, [displayActivity, activityFilter, search]);
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
  const globalMinimumGap = Math.max(1, Number(control?.settings?.minimum_delay_minutes || 1));
  const effectiveCampaignGap = Math.max(globalMinimumGap, queueForm.delayMinutes);
  const backgroundJobs = useMemo<BackgroundJob[]>(() => (control?.jobs || []) as BackgroundJob[], [control?.jobs]);
  const activeBackgroundJobs = useMemo(() => backgroundJobs.filter((job) => ["queued", "researching"].includes(job.status)), [backgroundJobs]);
  const latestCompletedBackgroundJob = useMemo(() => backgroundJobs.find((job) => ["completed", "completed_with_issues", "failed"].includes(job.status)), [backgroundJobs]);
  const displayCampaigns = useMemo(() => Array.isArray(control?.campaigns) ? control.campaigns.map((campaign) => ({
    id: String(campaign.id || campaign.name),
    name: String(campaign.name || "IKF Reach"),
    status: paused ? "paused_user_hold" : String(campaign.status || "active"),
    drafts: displayEmails.filter((email) => email.campaign === campaign.name).length,
    senderName: String(campaign.sender_name || control.sender?.name || "Tanishka"),
    senderEmail: String(campaign.sender_email || control.sender?.email || "tanishka@iknowai.in"),
    replyToEmail: String(campaign.reply_to_email || control.replyTo || "tanishka@iknowai.in"),
  })) : data.campaigns.map((campaign) => ({ ...campaign, id: campaign.name })), [control?.campaigns, control?.sender, displayEmails, paused]);
  const selectedCampaign = displayCampaigns.find((campaign) => campaign.id === queueForm.campaignId) || displayCampaigns[0];
  const selectedCampaignEmails = selectedCampaign ? displayEmails.filter((email) => email.campaign === selectedCampaign.name) : [];
  const selectedCampaignDrafts = selectedCampaignEmails.filter((email) => email.status === "draft_pending_review").length;
  const selectedCampaignApproved = selectedCampaignEmails.filter((email) => email.status === "approved").length;
  const selectedCampaignScheduled = selectedCampaignEmails.filter((email) => email.status === "scheduled" || String(email.sendStatus || "").startsWith("scheduled")).length;
  const selectedCampaignSent = selectedCampaignEmails.filter((email) => email.status === "sent" || email.sendStatus === "sent").length;
  const selectedCampaignEmailRecords = selectedCampaignEmails.filter((email) => selectedIds.has(email.id));
  const selectedCampaignUnapproved = selectedCampaignEmailRecords.filter((email) => email.status !== "approved").length;
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
    const researchJob = backgroundJobs.find((job) => job.campaignId === campaign.id);
    let lifecycle = "empty";
    if (researchJob && ["queued", "researching"].includes(researchJob.status)) lifecycle = researchJob.status;
    else if (researchJob?.status === "cancelled") lifecycle = emails.length ? "draft_pending_review" : "cancelled";
    else if (failed > 0 || researchJob?.status === "completed_with_issues" || researchJob?.status === "failed") lifecycle = "needs_attention";
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
      researchJob,
      researchProgress: researchJob?.totalItems ? Math.round((researchJob.completedItems / researchJob.totalItems) * 100) : null,
      latestGeneratedAt,
      firstScheduledAt: queued?.first || null,
      lastScheduledAt: queued?.last || null,
    };
  }), [displayCampaigns, displayEmails, scheduledCampaignGroups, backgroundJobs]);
  const selectedCampaignSummary = campaignSummaries.find((campaign) => campaign.id === queueForm.campaignId) || campaignSummaries[0];
  const filteredCampaigns = useMemo(() => {
    const term = search.trim().toLowerCase();
    return campaignSummaries.filter((campaign) => {
      const matchesTerm = !term || `${campaign.name} ${campaign.senderName} ${campaign.senderEmail} ${campaign.replyToEmail}`.toLowerCase().includes(term);
      const matchesStatus = campaignStatusFilter === "all" ||
        (campaignStatusFilter === "active" && ["queued", "researching", "approved", "scheduled", "running"].includes(campaign.lifecycle)) ||
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
  const campaignEmailRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (selectedCampaignSummary?.emails || []).filter((email) => {
      const matchesTerm = !term || `${email.company} ${email.recipient} ${email.subject}`.toLowerCase().includes(term);
      const status = email.sendStatus || email.status;
      const matchesStatus = emailStatus === "all" ||
        (emailStatus === "draft" && status === "draft_pending_review") ||
        (emailStatus === "failed" && Boolean(status?.includes("fail") || status?.includes("not_sent"))) ||
        status === emailStatus;
      return matchesTerm && matchesStatus;
    });
  }, [selectedCampaignSummary, emailStatus, search]);
  const campaignEmailPages = Math.max(1, Math.ceil(campaignEmailRows.length / pageSize));
  const pagedCampaignEmails = campaignEmailRows.slice((page - 1) * pageSize, page * pageSize);
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
  const searchPlaceholder = section === "contacts"
    ? "Search contacts, emails, companies"
    : section === "companies"
      ? "Search companies, industries, websites"
      : section === "campaigns"
        ? "Search campaigns and recipients"
        : section === "activity"
          ? "Search activity"
          : section === "statistics"
            ? "Search analytics"
            : "Search workspace";

  useEffect(() => {
    if (page > pages) setPage(pages);
  }, [page, pages]);

  useEffect(() => {
    if (campaignWorkspaceView === "emails" && page > campaignEmailPages) setPage(campaignEmailPages);
  }, [campaignEmailPages, campaignWorkspaceView, page]);

  useEffect(() => {
    if (displayCampaigns.length && !displayCampaigns.some((campaign) => campaign.id === queueForm.campaignId)) {
      setQueueForm((current) => ({ ...current, campaignId: displayCampaigns[0].id }));
    }
  }, [displayCampaigns, queueForm.campaignId]);

  useEffect(() => {
    setCampaignDeleteId(null);
    setCampaignDeleteConfirm("");
  }, [queueForm.campaignId]);

  useEffect(() => {
    if (!selectedEmail && !selectedContact && !selectedCompany && !editingCompany) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedEmail(null);
        setSelectedContact(null);
        setSelectedCompany(null);
        setEditingCompany(null);
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [selectedEmail, selectedContact, selectedCompany, editingCompany]);

  function switchSection(next: Section) {
    setSection(next);
    if (next === "campaigns") setCampaignDetailOpen(false);
    setMobileMenuOpen(false);
    setSearch("");
    setPage(1);
    setContactPage(1);
    setCompanyPage(1);
  }

  function openCampaignWorkspace(view: CampaignWorkspaceView, campaignName?: string) {
    const campaign = campaignName ? displayCampaigns.find((item) => item.name === campaignName) : selectedCampaign;
    if (campaign) {
      setQueueForm((current) => ({ ...current, campaignId: campaign.id, confirmed: false }));
      setEmailCampaign(campaign.name);
    }
    setCampaignWorkspaceView(view);
    setSelectedIds(new Set());
    setBulkMode(null);
    switchSection("campaigns");
    setCampaignDetailOpen(true);
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

  async function stopBackgroundJob(job: BackgroundJob) {
    if (!window.confirm(`Stop background research for “${job.campaignName}”? Completed contacts and drafts will be kept, but unprocessed sources will be cancelled.`)) return;
    await runAction(
      { action: "cancel_background_campaign", jobId: job.id },
      `Background research for ${job.campaignName} was stopped. Completed work was preserved.`,
    );
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

  function selectAllCampaignEmails() {
    setSelectedIds(new Set(selectedCampaignEmails.map((email) => email.id)));
  }

  async function approveCampaignSelection() {
    if (!selectedIds.size || !selectedCampaign) return;
    const entireCampaignSelected = selectedIds.size === selectedCampaignEmails.length
      && selectedCampaignEmails.every((email) => selectedIds.has(email.id));
    if (entireCampaignSelected) {
      const pendingCount = selectedCampaignEmails.filter((email) => email.status === "draft_pending_review").length;
      if (!pendingCount) {
        setNoticeTone("success");
        setNotice("Every draft in this campaign is already approved or scheduled.");
        return;
      }
      if (!window.confirm(`Approve all ${pendingCount} draft emails in “${selectedCampaign.name}”?\n\nThis only changes approval status. It will not send or schedule any email.`)) return;
      const result = await runAction(
        { action: "approve_campaign", campaignId: selectedCampaign.id },
        `${pendingCount} campaign drafts approved. Nothing has been sent.`,
      );
      if (result?.ok) setSelectedIds(new Set());
      return;
    }
    await runAction(
      { action: "approve_batch", emailIds: [...selectedIds] },
      `${selectedIds.size} selected campaign emails approved. Nothing has been sent.`,
    );
  }

  async function deleteCampaignEmail(email: EmailRecord) {
    if (email.status === "sent" || email.status === "scheduled" || String(email.sendStatus || "").startsWith("scheduled")) {
      setNoticeTone("error");
      setNotice("Sent or scheduled emails cannot be deleted. Cancel a scheduled delivery first.");
      return;
    }
    if (!window.confirm(`Delete the generated email for ${email.recipient} from this campaign?\n\nThe contact and company will remain in the database.`)) return;
    const result = await runAction(
      { action: "delete_generated_email", emailId: email.id },
      `The generated email for ${email.recipient} was deleted. Its contact and company were kept.`,
    );
    if (result) {
      setSelectedIds((current) => {
        const next = new Set(current);
        next.delete(email.id);
        return next;
      });
      if (selectedEmail?.id === email.id) setSelectedEmail(null);
    }
  }

  async function deleteSelectedCampaign() {
    if (!selectedCampaignSummary || campaignDeleteConfirm !== selectedCampaignSummary.name) return;
    const result = await runAction(
      {
        action: "delete_campaign",
        campaignId: selectedCampaignSummary.id,
        confirmName: campaignDeleteConfirm,
      },
      `${selectedCampaignSummary.name} was deleted from the campaign workspace.`,
    );
    if (result?.ok) {
      setCampaignDeleteId(null);
      setCampaignDeleteConfirm("");
      setSelectedIds(new Set());
      setSelectedEmail(null);
      setCampaignWorkspaceView("overview");
      setCampaignDetailOpen(false);
      setPage(1);
    }
  }

  async function abortSelectedCampaignDelivery() {
    if (!selectedCampaignSummary) return;
    const result = await runAction(
      { action: "abort_campaign_delivery", campaignId: selectedCampaignSummary.id },
      "The remaining scheduled campaign delivery was stopped. Cancelled emails are approved again and can be rescheduled later.",
    );
    if (result?.ok) {
      setQueueForm((current) => ({ ...current, confirmed: false, scheduledFor: "" }));
      setCampaignSendConfirm("");
    }
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
      batchSize: queueForm.batchSize,
      delayMinutes: queueForm.delayMinutes,
      confirm: queueForm.confirmed,
    }, `${selectedCampaign.name} was handed to Brevo for automatic scheduled delivery.`);
    if (result?.ok) {
      setNoticeTone("success");
      setNotice(`${result.scheduled} emails scheduled with Brevo${result.failed ? `; ${result.failed} need attention` : ""}. Delivery continues after the dashboard is closed.`);
      setQueueForm((current) => ({ ...current, confirmed: false }));
    }
  }

  async function sendSelectedCampaignNow() {
    if (!selectedCampaign) return;
    const result = await runAction({
      action: "send_campaign",
      campaignId: selectedCampaign.id,
      confirmText: campaignSendConfirm,
    }, `${selectedCampaign.name} was submitted to Brevo for immediate delivery.`);
    if (result?.ok) {
      setCampaignSendConfirm("");
      setNoticeTone(result.failed ? "error" : "success");
      setNotice(`${result.sent} campaign emails were accepted by Brevo${result.failed ? `; ${result.failed} need attention` : ""}.`);
    }
  }

  function stopWebsiteDiscovery() {
    scanCancelRef.current = true;
  }

  async function fetchScanBatchWithRetry(payload: Record<string, unknown>, attempts = 3) {
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 75_000);
      if (attempt > 1) setScanWaitNote(`No response yet — retrying (attempt ${attempt} of ${attempts})…`);
      else setScanWaitNote(null);
      try {
        const response = await fetch("/api/control", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || "The websites could not be scanned.");
        setScanWaitNote(null);
        return result;
      } catch (error) {
        clearTimeout(timeoutId);
        lastError = error;
        if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
      }
    }
    throw lastError instanceof Error ? lastError : new Error("The websites could not be scanned.");
  }

  async function runWebsiteDiscovery() {
    if (!intakeForm.websites.trim()) {
      setNoticeTone("error");
      setNotice("Enter at least one company website to scan.");
      return;
    }
    const BATCH_SIZE = 30;
    const resuming = websiteScans.length > 0;
    scanCancelRef.current = false;
    setScanningWebsites(true);
    setNotice("");
    setScanWaitNote(null);
    setScanProgress({ completed: websiteScans.length, total: 0 });
    if (!resuming) setScanSavedTotals(null);
    const allScans: WebsiteScanRecord[] = resuming ? [...websiteScans] : [];
    const savedTotals = { contactsCreated: 0, companiesCreated: 0, contactsSkipped: 0, ...(resuming && scanSavedTotals ? scanSavedTotals : {}) };
    let saveFailedOnce = false;

    function applyFoundEmailsToRawInput() {
      const uniqueFound = new Map<string, string>();
      for (const scan of allScans) {
        for (const email of scan.discoveredEmails) {
          const normalizedEmail = email.toLowerCase();
          if (!uniqueFound.has(normalizedEmail)) uniqueFound.set(normalizedEmail, `${email}, ${scan.companyName || ""}, ${scan.website || scan.input}`);
        }
      }
      const foundLines = [...uniqueFound.values()];
      setIntakeForm((current) => {
        const existingEmails = new Set((current.rawInput.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).map((email) => email.toLowerCase()));
        const additions = foundLines.filter((line) => {
          const email = line.split(",")[0].trim().toLowerCase();
          if (existingEmails.has(email)) return false;
          existingEmails.add(email);
          return true;
        });
        if (!additions.length) return current;
        return { ...current, rawInput: [current.rawInput.trim(), ...additions].filter(Boolean).join("\n") };
      });
      return foundLines.length;
    }

    let networkPaused = false;
    try {
      let offset = allScans.length;
      let total = Infinity;
      while (offset < total && !scanCancelRef.current) {
        let result: any;
        try {
          result = await fetchScanBatchWithRetry({ action: "discover_website_contacts", websites: intakeForm.websites, offset, limit: BATCH_SIZE });
        } catch {
          networkPaused = true;
          break;
        }
        const scans = (result.websites || []) as WebsiteScanRecord[];
        allScans.push(...scans);
        total = Number(result.total || 0);
        offset += scans.length;
        setWebsiteScans([...allScans]);
        setScanProgress({ completed: Math.min(offset, total), total });
        applyFoundEmailsToRawInput();

        const batchWithEmails = scans.filter((scan) => scan.discoveredEmails.length > 0);
        if (batchWithEmails.length && control?.canManage) {
          try {
            const saveResult = await persistDiscoveredContacts(batchWithEmails);
            savedTotals.contactsCreated += saveResult.contactsCreated;
            savedTotals.companiesCreated += saveResult.companiesCreated;
            savedTotals.contactsSkipped += saveResult.contactsSkipped;
            setScanSavedTotals({ contactsCreated: savedTotals.contactsCreated, companiesCreated: savedTotals.companiesCreated });
          } catch {
            saveFailedOnce = true;
          }
        }

        if (!result.hasMore || !scans.length) break;
      }

      const foundCount = applyFoundEmailsToRawInput();
      const stoppedEarly = scanCancelRef.current;
      const progressLabel = networkPaused ? `Paused after a network issue at website ${allScans.length}. Found` : stoppedEarly ? "Stopped early. Found" : "Found";
      const resumeHint = networkPaused ? ` Click "Resume scanning" to continue from where it left off — nothing found so far has been lost.` : "";
      if (foundCount) {
        const foundSummary = `${progressLabel} ${foundCount} public email address${foundCount === 1 ? "" : "es"} across ${allScans.filter((scan) => scan.ok).length} website${allScans.filter((scan) => scan.ok).length === 1 ? "" : "s"}.${resumeHint}`;
        if (control?.canManage) {
          const saveSummary = savedTotals.contactsCreated || savedTotals.companiesCreated
            ? ` Saved ${savedTotals.contactsCreated} contact${savedTotals.contactsCreated === 1 ? "" : "s"} to the database under ${savedTotals.companiesCreated} compan${savedTotals.companiesCreated === 1 ? "y" : "ies"} as it went${savedTotals.contactsSkipped ? ` (${savedTotals.contactsSkipped} already existed and were skipped)` : ""}.`
            : "";
          setNoticeTone(saveFailedOnce ? "error" : "success");
          setNotice(`${foundSummary}${saveSummary}${saveFailedOnce ? ` Some batches could not be auto-saved — use "Save found contacts to database" below to catch anything missed.` : ""}`);
          if (savedTotals.contactsCreated || savedTotals.companiesCreated) await loadControl();
        } else {
          setNoticeTone("success");
          setNotice(foundSummary);
        }
      } else {
        setNoticeTone("error");
        setNotice(networkPaused ? `Paused after a network issue before finding any public email addresses.${resumeHint}` : stoppedEarly ? "Scanning was stopped before any public email addresses were found." : "The websites were scanned, but no public email addresses were found. Review the per-website results below.");
      }
    } catch (error) {
      setNoticeTone("error");
      setNotice(error instanceof Error ? error.message : "The websites could not be scanned.");
    } finally {
      setScanningWebsites(false);
      setScanProgress(null);
      setScanWaitNote(null);
    }
  }

  async function persistDiscoveredContacts(scans: WebsiteScanRecord[]) {
    const response = await fetch("/api/control", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "save_discovered_contacts",
        scans: scans.map((scan) => ({ website: scan.website || scan.input, companyName: scan.companyName, discoveredEmails: scan.discoveredEmails })),
        industry: intakeForm.industry,
      }),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "The discovered contacts could not be saved.");
    return result as { contactsCreated: number; companiesCreated: number; contactsSkipped: number };
  }

  async function saveDiscoveredContacts() {
    const scans = websiteScans.filter((scan) => scan.discoveredEmails.length > 0);
    if (!scans.length) {
      setNoticeTone("error");
      setNotice("No discovered email addresses to save yet.");
      return;
    }
    setSavingDiscoveredContacts(true);
    setNotice("");
    try {
      const result = await persistDiscoveredContacts(scans);
      setNoticeTone("success");
      setNotice(`Saved ${result.contactsCreated} contact${result.contactsCreated === 1 ? "" : "s"} under ${result.companiesCreated} new compan${result.companiesCreated === 1 ? "y" : "ies"}${result.contactsSkipped ? ` (${result.contactsSkipped} already existed and were skipped)` : ""}.`);
      await loadControl();
    } catch (error) {
      setNoticeTone("error");
      setNotice(error instanceof Error ? error.message : "The discovered contacts could not be saved.");
    } finally {
      setSavingDiscoveredContacts(false);
    }
  }

  async function runIntelligenceStudio(intent: "draft" | "delivery" = "draft") {
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
    if (!isValidEmail(intakeForm.replyToEmail)) {
      setNoticeTone("error");
      setNotice("Select or enter a valid Reply-To email address.");
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
    const result = await runAction(
      { action: "queue_background_campaign", ...intakeForm, document },
      "Campaign research was queued. It will continue after this tab is closed.",
    );
    if (result?.ok && result.job?.id) {
      setIntakeResults([]);
      setWebsiteScans([]);
      const kickoff = await fetch("/api/background-campaign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: result.job.id }),
      });
      if (!kickoff.ok) {
        setNoticeTone("error");
        setNotice("The campaign was saved, but its background worker did not start. Open Campaigns and retry.");
      }
      setQueueForm((current) => ({ ...current, campaignId: result.campaign.id, confirmed: false }));
      if (intent === "delivery") {
        setEmailCampaign(result.campaign.name);
        setCampaignWorkspaceView("overview");
        setSelectedIds(new Set());
        setBulkMode(null);
        switchSection("campaigns");
        setCampaignDetailOpen(true);
      }
      await loadControl();
    }
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

  function openCompanyEditor(company: CompanyRecord) {
    setSelectedCompany(null);
    setEditingCompany(company);
    setCompanyForm({
      name: company.name || "",
      industry: company.industry || "",
      website: company.website || "",
      country: company.country || "",
    });
  }

  async function saveCompany() {
    if (!editingCompany) return;
    if (!companyForm.name.trim()) {
      setNoticeTone("error");
      setNotice("Add the company or organization name.");
      return;
    }
    const result = await runAction({
      action: "update_company",
      companyId: editingCompany.id,
      ...companyForm,
    }, "Company details and its linked contacts were updated in the database.");
    if (result?.ok) setEditingCompany(null);
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand-row">
          <div className="brand-mark"><span>IKF</span><b>Reach</b></div>
          <button className={`mobile-menu-toggle ${mobileMenuOpen ? "open" : ""}`} type="button" aria-label={mobileMenuOpen ? "Close navigation menu" : "Open navigation menu"} aria-expanded={mobileMenuOpen} aria-controls="dashboard-navigation" onClick={() => setMobileMenuOpen((open) => !open)}>
            <span /><span /><span />
          </button>
        </div>
        <p className="brand-caption">AI email operations</p>
        <nav id="dashboard-navigation" className={mobileMenuOpen ? "mobile-open" : ""} aria-label="Dashboard sections">
          <div className="mobile-menu-intro"><strong>IKF Reach workspace</strong><span>Select a section to continue</span></div>
          {navItems.map((item) => (
            <button key={item.id} className={section === item.id ? "active" : ""} aria-current={section === item.id ? "page" : undefined} onClick={() => switchSection(item.id)}>
              <span aria-hidden="true">{item.icon}</span>{item.label}
            </button>
          ))}
          <div className="mobile-menu-status"><span className="sync-dot" /><div><strong>Live database</strong><small>{refreshing ? "Refreshing…" : control?.refreshedAt ? `Updated ${new Date(control.refreshedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}` : "Connecting…"}</small></div></div>
        </nav>
        {mobileMenuOpen && <button className="mobile-menu-backdrop" type="button" aria-label="Close navigation menu" onClick={() => setMobileMenuOpen(false)} />}
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
            <p className="eyebrow">Masterclass IKF Reach</p>
            <h1>{pageTitle}</h1>
          </div>
          <div className="top-actions">
            <label className="global-search">
              <span aria-hidden="true">⌕</span>
              <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); setContactPage(1); setCompanyPage(1); }} placeholder={searchPlaceholder} aria-label={searchPlaceholder} />
            </label>
            <button className="refresh-button" onClick={loadControl} disabled={refreshing} aria-label="Refresh live dashboard data">{refreshing ? "Refreshing…" : "Refresh"}</button>
            <div className="avatar" aria-label="Tanishka">T</div>
          </div>
        </header>

        <div className="content">
          {!control && (
            <section className="system-banner loading-banner" role="status"><span className="loading-spinner" /><div><strong>Loading live IKF Reach data</strong><p>Connecting to Supabase and Brevo.</p></div></section>
          )}
          {control && !control.ok && (
            <section className="system-banner error-banner" role="alert"><div><strong>Live data is temporarily unavailable</strong><p>{control.error || "Please try the connection again."}</p></div><button onClick={loadControl}>Retry</button></section>
          )}
          {control?.ok && !control.canManage && (
            <section className={`access-banner compact-access-banner ${accessBannerExpanded ? "expanded" : ""}`}>
              <div><strong>Public view · sending is locked</strong>{accessBannerExpanded && <p>Sign in with an authorized IKF account to approve, schedule, cancel, or send emails.</p>}</div>
              <div className="access-banner-actions"><button type="button" onClick={() => setAccessBannerExpanded((value) => !value)}>{accessBannerExpanded ? "Less" : "Why?"}</button><a href="/signin-with-chatgpt?return_to=%2F">Sign in</a></div>
            </section>
          )}
          {section === "overview" && (
            <>
              <section className={`credit-alert ${paused ? "" : "active-alert"}`} aria-label="Sending status">
                <span className="alert-icon">{paused ? "!" : "✓"}</span>
                <div><strong>{paused ? "Sending is on hold" : "Sending controls are active"}</strong><p>{paused ? "No campaign email can be scheduled or sent until an authorized operator turns off Pause all." : "Manual approval and confirmation are still required before every campaign send."} Drafts use Tanishka &lt;tanishka@iknowai.in&gt;.</p></div>
                <StatusPill value={paused ? "paused_user_hold" : "active"} />
              </section>

              <section className="metric-grid" aria-label="IKF Reach totals">
                <Metric label="Generated emails" value={stats.emails} note={`Across ${displayCampaigns.length} campaigns`} tone="violet" />
                <Metric label="Needs review" value={stats.pendingReview} note="Before approval or scheduling" tone="amber" />
                <Metric label="All database contacts" value={stats.contacts} note={`${stats.companies} companies across every campaign`} tone="blue" />
                <Metric label="Successful sends" value={stats.sent} note={`${stats.failed} failed attempts recorded`} tone="green" />
              </section>

              <section className="overview-command-bar" aria-label="Quick actions">
                <div><p className="eyebrow">Command centre</p><strong>Choose your next action</strong></div>
                <div>
                  <button className="primary-action" onClick={() => switchSection("create")}>Create campaign</button>
                  <button className="quiet-action" onClick={() => switchSection("contacts")}>Validate contacts</button>
                  <button className="quiet-action" onClick={() => switchSection("campaigns")}>Review campaigns</button>
                  <button className="quiet-action" onClick={() => switchSection("statistics")}>View results</button>
                </div>
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
                    <div><span>All database contacts</span><strong>{stats.contacts}</strong><i style={{ width: "100%" }} /></div>
                    <div><span>Generated emails</span><strong>{stats.emails}</strong><i style={{ width: `${Math.min(100, Math.round(stats.emails / Math.max(1, stats.contacts) * 100))}%` }} /></div>
                    <div><span>Approved</span><strong>{stats.approved}</strong><i style={{ width: `${Math.max(1, Math.round(stats.approved / Math.max(1, stats.emails) * 100))}%` }} /></div>
                    <div><span>Scheduled</span><strong>{stats.scheduled}</strong><i style={{ width: `${Math.max(1, Math.round(stats.scheduled / Math.max(1, stats.emails) * 100))}%` }} /></div>
                    <div><span>Sent</span><strong>{stats.sent}</strong><i style={{ width: `${Math.max(1, Math.round(stats.sent / Math.max(1, stats.emails) * 100))}%` }} /></div>
                  </div>
                </article>
              </section>

              <section className="panel recent-panel">
                <div className="panel-heading"><div><p className="eyebrow">Latest output</p><h2>Recently generated emails</h2></div><button className="text-button" onClick={() => openCampaignWorkspace("overview")}>Open campaigns →</button></div>
                <EmailTable rows={displayEmails.slice(0, 7)} onOpen={setSelectedEmail} compact />
              </section>
            </>
          )}

          {section === "campaigns" && (
            <section className="campaigns-hub">
              <article className="panel campaign-portfolio-hero">
                <div>
                  <p className="eyebrow">{campaignDetailOpen ? "Campaign workspace" : "Campaign portfolio"}</p>
                  <h2>{campaignDetailOpen ? selectedCampaignSummary?.name || "Campaign details" : "Every IKF Reach campaign in one place"}</h2>
                  <p>{campaignDetailOpen ? "Review the template, generated emails, live status, and delivery controls for this campaign." : "Choose a campaign to open its emails, template, status, and sending controls."}</p>
                </div>
                {campaignDetailOpen ? <button className="quiet-action campaign-back-button" onClick={() => { setCampaignDetailOpen(false); setCampaignWorkspaceView("overview"); setSelectedIds(new Set()); setBulkMode(null); }}>← Back to campaigns</button> : <button className="primary-action" onClick={() => switchSection("create")}>Create new campaign</button>}
              </article>

              {!campaignDetailOpen && activeBackgroundJobs.length > 0 && (
                <section className="panel background-campaign-jobs" aria-live="polite">
                  <div className="background-jobs-heading">
                    <div>
                      <p className="eyebrow">Live campaign generation</p>
                      <h2>{activeBackgroundJobs.length} campaign{activeBackgroundJobs.length === 1 ? "" : "s"} processing</h2>
                    </div>
                    <span><b /> Live · refreshes every 3 seconds</span>
                  </div>
                  <div className="background-job-list">
                    {activeBackgroundJobs.map((job) => {
                      const progress = job.totalItems ? Math.round((job.completedItems / job.totalItems) * 100) : 0;
                      const remaining = Math.max(0, job.totalItems - job.completedItems);
                      const startedAt = job.startedAt ? new Date(job.startedAt).getTime() : 0;
                      const elapsedMinutes = startedAt ? Math.max((Date.now() - startedAt) / 60_000, 0.1) : 0;
                      const rate = elapsedMinutes && job.completedItems ? job.completedItems / elapsedMinutes : 0;
                      const etaMinutes = rate ? Math.ceil(remaining / rate) : 0;
                      const activity = job.status === "queued"
                        ? "Starting secure background worker…"
                        : Number(job.retryItems || 0) > 0
                          ? `Retrying ${Number(job.retryItems || 0).toLocaleString("en-IN")} source record${Number(job.retryItems || 0) === 1 ? "" : "s"} after the first attempt…`
                        : etaMinutes
                          ? `About ${etaMinutes < 60 ? `${etaMinutes} min` : `${Math.ceil(etaMinutes / 60)} hr`} remaining`
                          : "Generating personalized emails…";
                      return (
                        <article key={job.id}>
                          <div className="background-job-title">
                            <span className="campaign-symbol">{job.campaignName.slice(0, 2).toUpperCase()}</span>
                            <div>
                              <strong>{job.campaignName}</strong>
                              <small>{activity}</small>
                            </div>
                            <div className="background-job-actions">
                              <StatusPill value={job.status} />
                              <button type="button" aria-label="Stop processing" disabled={working || !control?.canManage} onClick={() => stopBackgroundJob(job)}>Stop</button>
                            </div>
                          </div>
                          <div className="background-job-progress">
                            <div><strong>{progress}%</strong><span>{job.completedItems.toLocaleString("en-IN")} of {job.totalItems.toLocaleString("en-IN")} processed</span></div>
                            <i aria-label={`${progress}% complete`}><b style={{ width: `${progress}%` }} /></i>
                          </div>
                          <div className="background-job-metrics" aria-label="Live generation counts">
                            <span><b>{job.draftsCreated.toLocaleString("en-IN")}</b><small>Unique emails created</small></span>
                            <span><b>{Math.max(0, job.successfulItems - job.draftsCreated).toLocaleString("en-IN")}</b><small>Duplicates / existing skipped</small></span>
                            <span><b>{remaining.toLocaleString("en-IN")}</b><small>Remaining, including retries</small></span>
                            <span className={Number(job.retryItems || 0) ? "has-retries" : ""}><b>{Number(job.retryItems || 0).toLocaleString("en-IN")}</b><small>Queued for automatic retry</small></span>
                            <span className={job.failedItems ? "has-failures" : ""}><b>{job.failedItems.toLocaleString("en-IN")}</b><small>Failed after retry</small></span>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              )}

              {!campaignDetailOpen && activeBackgroundJobs.length === 0 && latestCompletedBackgroundJob && (
                <section className="panel campaign-completion-report" aria-live="polite">
                  <div>
                    <p className="eyebrow">Latest generation report</p>
                    <h2>{latestCompletedBackgroundJob.campaignName}</h2>
                    <span>All source records were finalized. Failed first attempts were retried automatically before this report was closed.</span>
                  </div>
                  <div className="background-job-metrics" aria-label="Final reconciled campaign generation counts">
                    <span><b>{latestCompletedBackgroundJob.totalItems.toLocaleString("en-IN")}</b><small>Total source records</small></span>
                    <span><b>{latestCompletedBackgroundJob.draftsCreated.toLocaleString("en-IN")}</b><small>Unique emails created</small></span>
                    <span><b>{Math.max(0, latestCompletedBackgroundJob.successfulItems - latestCompletedBackgroundJob.draftsCreated).toLocaleString("en-IN")}</b><small>Duplicates / existing skipped</small></span>
                    <span className={latestCompletedBackgroundJob.failedItems ? "has-failures" : ""}><b>{latestCompletedBackgroundJob.failedItems.toLocaleString("en-IN")}</b><small>Failed after retry</small></span>
                  </div>
                </section>
              )}

              {campaignDetailOpen && <article className="panel campaign-workspace-switcher">
                <div>
                  <p className="eyebrow">Campaign workspace</p>
                  <label><span>Working campaign</span><select value={selectedCampaignSummary?.id || ""} onChange={(event) => { const campaign = displayCampaigns.find((item) => item.id === event.target.value); setQueueForm((current) => ({ ...current, campaignId: event.target.value, confirmed: false })); if (campaign) setEmailCampaign(campaign.name); setSelectedIds(new Set()); setBulkMode(null); setPage(1); }}>{displayCampaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select></label>
                </div>
                <div className="campaign-workspace-tabs" role="tablist" aria-label="Campaign workspace views">
                  <button className={campaignWorkspaceView === "overview" ? "active" : ""} role="tab" aria-selected={campaignWorkspaceView === "overview"} onClick={() => { setCampaignWorkspaceView("overview"); setPage(1); }}>Overview</button>
                  <button className={campaignWorkspaceView === "emails" ? "active" : ""} role="tab" aria-selected={campaignWorkspaceView === "emails"} onClick={() => { setCampaignWorkspaceView("emails"); setSelectedIds(new Set()); setBulkMode(null); setPage(1); }}>Emails <span>{selectedCampaignSummary?.total || 0}</span></button>
                  <button className={campaignWorkspaceView === "delivery" ? "active" : ""} role="tab" aria-selected={campaignWorkspaceView === "delivery"} onClick={() => { setCampaignWorkspaceView("delivery"); setSelectedIds(new Set()); setBulkMode(null); setPage(1); }}>Approval & delivery</button>
                </div>
              </article>}

              {campaignWorkspaceView === "overview" && (
                <>
              {!campaignDetailOpen && <section className="campaign-portfolio-metrics" aria-label="Campaign status totals">
                <button className={campaignStatusFilter === "all" ? "active" : ""} onClick={() => setCampaignStatusFilter("all")}><span>All campaigns</span><strong>{campaignPortfolioStats.total}</strong><small>Complete portfolio</small></button>
                <button className={campaignStatusFilter === "draft_pending_review" ? "active" : ""} onClick={() => setCampaignStatusFilter("draft_pending_review")}><span>Draft</span><strong>{campaignPortfolioStats.draft}</strong><small>Needs review</small></button>
                <button className={campaignStatusFilter === "active" ? "active" : ""} onClick={() => setCampaignStatusFilter("active")}><span>Active</span><strong>{campaignPortfolioStats.active}</strong><small>Ready or running</small></button>
                <button className={campaignStatusFilter === "completed" ? "active" : ""} onClick={() => setCampaignStatusFilter("completed")}><span>Sent</span><strong>{campaignPortfolioStats.sent}</strong><small>Fully completed</small></button>
                <button className={campaignStatusFilter === "needs_attention" ? "active" : ""} onClick={() => setCampaignStatusFilter("needs_attention")}><span>Attention</span><strong>{campaignPortfolioStats.attention}</strong><small>Delivery issues</small></button>
              </section>}

              {paused && (
                <section className="campaign-safety-note">
                  <span>!</span>
                  <div><strong>Client sending is globally paused</strong><p>Campaign preparation and review remain available. No campaign can start until Pause all is turned off in Controls & APIs.</p></div>
                  <button onClick={() => switchSection("settings")}>View controls</button>
                </section>
              )}

              <section className={campaignDetailOpen ? "campaign-portfolio-layout campaign-detail-only" : "campaign-portfolio-layout"}>
                {!campaignDetailOpen && <article className="panel campaign-directory">
                  <div className="panel-heading">
                    <div><p className="eyebrow">Campaign directory</p><h2>{filteredCampaigns.length} campaigns</h2></div>
                    <label className="campaign-status-select"><span>Status</span><select value={campaignStatusFilter} onChange={(event) => setCampaignStatusFilter(event.target.value)}><option value="all">All statuses</option><option value="draft_pending_review">Draft</option><option value="active">Active</option><option value="approved">Ready</option><option value="scheduled">Scheduled</option><option value="running">Running</option><option value="completed">Sent</option><option value="needs_attention">Needs attention</option></select></label>
                  </div>
                  <div className="campaign-directory-list">
                    {filteredCampaigns.map((campaign) => (
                      <button key={campaign.id} className={selectedCampaignSummary?.id === campaign.id ? "campaign-directory-row active" : "campaign-directory-row"} onClick={() => { setQueueForm((current) => ({ ...current, campaignId: campaign.id, confirmed: false })); setEmailCampaign(campaign.name); setCampaignWorkspaceView("overview"); setCampaignDetailOpen(true); setSelectedIds(new Set()); setBulkMode(null); }}>
                        <span className="campaign-symbol">{campaign.name.slice(0, 2).toUpperCase()}</span>
                        <span className="campaign-directory-copy"><strong>{campaign.name}</strong><small>{campaign.researchJob && ["queued", "researching"].includes(campaign.researchJob.status) ? `${campaign.researchJob.completedItems} of ${campaign.researchJob.totalItems} sources researched` : `${campaign.total} recipients · Updated ${compactDate(campaign.latestGeneratedAt)}`}</small><i><b style={{ width: `${campaign.researchProgress ?? campaign.progress}%` }} /></i></span>
                        <span className="campaign-directory-result"><StatusPill value={campaign.lifecycle} /><small>{campaign.researchProgress !== null && ["queued", "researching"].includes(campaign.lifecycle) ? `${campaign.researchProgress}% research complete` : `${campaign.progress}% delivered or scheduled`}</small></span>
                        <span className="campaign-row-arrow">→</span>
                      </button>
                    ))}
                    {!filteredCampaigns.length && <div className="empty-state">No campaigns match this status or search.</div>}
                  </div>
                </article>}

                {campaignDetailOpen && selectedCampaignSummary && (
                  <article className="panel campaign-detail-panel">
                    <div className="campaign-detail-heading">
                      <div className="campaign-symbol">{selectedCampaignSummary.name.slice(0, 2).toUpperCase()}</div>
                      <div><p className="eyebrow">Selected campaign</p><h2>{selectedCampaignSummary.name}</h2><span>{selectedCampaignSummary.senderName} · {selectedCampaignSummary.senderEmail} · Reply-To: {selectedCampaignSummary.replyToEmail}</span></div>
                      <StatusPill value={selectedCampaignSummary.lifecycle} />
                    </div>

                    <div className="campaign-detail-progress">
                      <div><span>{selectedCampaignSummary.researchProgress !== null && ["queued", "researching"].includes(selectedCampaignSummary.lifecycle) ? "Research progress" : "Campaign progress"}</span><strong>{selectedCampaignSummary.researchProgress ?? selectedCampaignSummary.progress}%</strong></div>
                      <i><b style={{ width: `${selectedCampaignSummary.researchProgress ?? selectedCampaignSummary.progress}%` }} /></i>
                    </div>

                    <div className="campaign-detail-stats">
                      <span><b>{selectedCampaignSummary.total}</b>Recipients</span>
                      <span><b>{selectedCampaignSummary.needsReview}</b>Draft</span>
                      <span><b>{selectedCampaignSummary.approved}</b>Ready</span>
                      <span><b>{selectedCampaignSummary.scheduled}</b>Scheduled</span>
                      <span><b>{selectedCampaignSummary.sent}</b>Sent</span>
                      <span><b>{selectedCampaignSummary.failed}</b>Failed</span>
                    </div>

                    <div className="campaign-template-panel">
                      <div>
                        <p className="eyebrow">Original campaign template</p>
                        <h3>{selectedCampaignSummary.researchJob?.topic || "Email template"}</h3>
                        <span>{selectedCampaignSummary.researchJob?.emailTemplate ? "This is the source template used to personalize every recipient email." : "This legacy campaign was created before source templates were retained in the campaign workspace."}</span>
                      </div>
                      {selectedCampaignSummary.researchJob?.emailTemplate
                        ? selectedCampaignSummary.researchJob.emailTemplateFormat === "rich_html_v1"
                          ? <div className="campaign-template-preview" dangerouslySetInnerHTML={{ __html: selectedCampaignSummary.researchJob.emailTemplate }} />
                          : <pre>{selectedCampaignSummary.researchJob.emailTemplate}</pre>
                        : <div className="empty-state">Original template unavailable. Generated emails remain available in the Emails tab.</div>}
                    </div>

                    <div className="campaign-live-status">
                      <div><p className="eyebrow">Current sending status</p><h3>{prettyStatus(selectedCampaignSummary.lifecycle)}</h3></div>
                      <div>
                        <span><b>{selectedCampaignSummary.sent}</b> sent</span>
                        <span><b>{selectedCampaignSummary.scheduled}</b> scheduled</span>
                        <span><b>{selectedCampaignSummary.approved}</b> ready</span>
                        <span><b>{selectedCampaignSummary.failed}</b> failed</span>
                      </div>
                      <p>{selectedCampaignSummary.firstScheduledAt ? `Scheduled activity begins ${new Date(selectedCampaignSummary.firstScheduledAt).toLocaleString("en-IN")}.` : "No future campaign delivery is scheduled."} {selectedCampaignSummary.researchJob?.lastError || ""}</p>
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
                      <div><p className="eyebrow">Audience preview</p><button onClick={() => openCampaignWorkspace("emails", selectedCampaignSummary.name)}>View all emails</button></div>
                      {selectedCampaignSummary.emails.slice(0, 5).map((email) => <span key={email.id}><span><strong>{email.company}</strong><small>{email.recipient}</small></span><StatusPill value={email.sendStatus || email.status} /></span>)}
                    </div>

                    <div className="campaign-detail-actions">
                      <button onClick={() => openCampaignWorkspace("emails", selectedCampaignSummary.name)}>Review emails</button>
                      <button className="primary-action" onClick={() => openCampaignWorkspace("delivery", selectedCampaignSummary.name)}>{selectedCampaignSummary.scheduled || selectedCampaignSummary.sent ? "Continue campaign" : "Approve, schedule, or send"}</button>
                      {selectedCampaignSummary.scheduled > 0 && <button className="danger-action" disabled={working || !control?.canManage} onClick={abortSelectedCampaignDelivery}>{working ? "Stopping…" : "Stop remaining scheduled emails"}</button>}
                    </div>

                    <div className="campaign-delete-zone">
                      <div>
                        <strong>Delete this campaign</strong>
                        <p>Removes every generated email from the workspace, stops background research, and cancels scheduled Brevo delivery. Contacts, companies, and sent-email audit history are kept.</p>
                      </div>
                      {campaignDeleteId !== selectedCampaignSummary.id ? (
                        <button type="button" disabled={working || !control?.canManage} onClick={() => { setCampaignDeleteId(selectedCampaignSummary.id); setCampaignDeleteConfirm(""); }}>Delete campaign…</button>
                      ) : (
                        <div className="campaign-delete-confirmation">
                          <label>
                            <span>Type <b>{selectedCampaignSummary.name}</b> to confirm</span>
                            <input autoFocus value={campaignDeleteConfirm} onChange={(event) => setCampaignDeleteConfirm(event.target.value)} placeholder="Complete campaign name" />
                          </label>
                          <div>
                            <button type="button" className="quiet-action" disabled={working} onClick={() => { setCampaignDeleteId(null); setCampaignDeleteConfirm(""); }}>Cancel</button>
                            <button type="button" className="danger-action" disabled={working || campaignDeleteConfirm !== selectedCampaignSummary.name} onClick={deleteSelectedCampaign}>{working ? "Deleting campaign…" : `Delete campaign and ${selectedCampaignSummary.total} emails`}</button>
                          </div>
                        </div>
                      )}
                    </div>
                  </article>
                )}
              </section>
                </>
              )}

              {campaignDetailOpen && campaignWorkspaceView === "emails" && selectedCampaignSummary && (
                <section className="panel data-panel campaign-email-workspace">
                  <div className="panel-heading filters-heading">
                    <div><p className="eyebrow">Campaign emails</p><h2>{selectedCampaignSummary.name}</h2><p className="section-helper">{campaignEmailRows.length} emails in this campaign. Preview, test, approve, schedule, or send only the selected records.</p></div>
                    <div className="email-filter-group single-filter">
                      <label><span>Status</span><select value={emailStatus} onChange={(event) => { setEmailStatus(event.target.value); setSelectedIds(new Set()); setPage(1); }} aria-label="Filter campaign emails by status"><option value="all">All statuses</option><option value="draft">Needs review</option><option value="failed">Failed</option><option value="sent">Sent</option></select></label>
                    </div>
                  </div>
                  <div className="selection-toolbar">
                    <div><strong>{selectedIds.size} selected</strong><span>{selectedIds.size === selectedCampaignEmails.length && selectedCampaignEmails.length ? `All ${selectedCampaignEmails.length} campaign emails selected` : selectedIds.size ? paused ? "Review and test copies are available; client delivery is paused" : "Ready for review, testing, or delivery" : "Select campaign emails using the checkboxes"}</span></div>
                    <div>
                      {selectedCampaignEmails.length > 0 && selectedIds.size !== selectedCampaignEmails.length && <button className="quiet-action" disabled={working} onClick={selectAllCampaignEmails}>Select all {selectedCampaignEmails.length}</button>}
                      <button disabled={!selectedIds.size || !control?.canManage || working} onClick={approveCampaignSelection}>{selectedIds.size === selectedCampaignEmails.length && selectedCampaignEmails.length ? "Approve all" : "Approve selected"}</button>
                      <button className="test-action" disabled={!selectedIds.size || selectedIds.size > 5 || !control?.canManage || working} onClick={() => setBulkMode("test")} title={selectedIds.size > 5 ? "Select up to 5 drafts for a test" : ""}>Send test copy</button>
                      <button className="primary-action" disabled={!selectedIds.size || selectedCampaignUnapproved > 0 || selectedIds.size > 50 || paused || !control?.canManage || working} onClick={() => setBulkMode("schedule")} title={selectedCampaignUnapproved ? "Approve every selected email before scheduling" : paused ? "Turn off Pause all before scheduling" : selectedIds.size > 50 ? "Schedule up to 50 emails at a time" : ""}>Schedule selected</button>
                      <button className="send-action" disabled={!selectedIds.size || selectedCampaignUnapproved > 0 || selectedIds.size > 25 || paused || !control?.canManage || working} onClick={() => setBulkMode("send")} title={selectedCampaignUnapproved ? "Approve every selected email before sending" : paused ? "Turn off Pause all before sending" : selectedIds.size > 25 ? "Send up to 25 emails at a time" : ""}>Send selected now</button>
                      {selectedIds.size > 0 && <button className="quiet-action" onClick={() => setSelectedIds(new Set())}>Clear</button>}
                    </div>
                  </div>
                  {bulkMode === "schedule" && (
                    <div className="bulk-panel">
                      <div><p className="eyebrow">Automatic delivery</p><h3>Schedule {selectedIds.size} campaign emails</h3><p>Brevo will deliver these messages after the dashboard is closed.</p></div>
                      <label>First email time<input type="datetime-local" value={bulkForm.scheduledFor} onChange={(event) => setBulkForm({ ...bulkForm, scheduledFor: event.target.value })} /></label>
                      <label>Spacing between emails<select value={bulkForm.delayMinutes} onChange={(event) => setBulkForm({ ...bulkForm, delayMinutes: Number(event.target.value) })}><option value={2}>2 minutes</option><option value={5}>5 minutes</option><option value={10}>10 minutes</option><option value={15}>15 minutes</option></select></label>
                      <label className="confirm-box"><input type="checkbox" checked={bulkForm.confirmed} onChange={(event) => setBulkForm({ ...bulkForm, confirmed: event.target.checked })} /><span>I reviewed these campaign recipients and approve automatic delivery.</span></label>
                      <div className="bulk-actions"><button className="quiet-action" onClick={() => setBulkMode(null)}>Cancel</button><button className="primary-action" disabled={!bulkForm.scheduledFor || !bulkForm.confirmed || paused || working} onClick={runBulkSchedule}>{working ? "Scheduling…" : "Confirm schedule"}</button></div>
                    </div>
                  )}
                  {bulkMode === "send" && (
                    <div className="bulk-panel danger-panel">
                      <div><p className="eyebrow">Immediate campaign send</p><h3>Send {selectedIds.size} selected emails now</h3><p>This action cannot be undone. Type <strong>SEND</strong> to confirm.</p></div>
                      <label>Confirmation<input value={bulkForm.confirmText} onChange={(event) => setBulkForm({ ...bulkForm, confirmText: event.target.value.toUpperCase() })} placeholder="Type SEND" /></label>
                      <div className="bulk-actions"><button className="quiet-action" onClick={() => setBulkMode(null)}>Cancel</button><button className="danger-action" disabled={bulkForm.confirmText !== "SEND" || paused || working} onClick={runBulkSend}>{working ? "Sending…" : "Send now"}</button></div>
                    </div>
                  )}
                  {bulkMode === "test" && (
                    <div className="bulk-panel test-panel">
                      <div><p className="eyebrow">Inbox preview</p><h3>Send {selectedIds.size} campaign email{selectedIds.size === 1 ? "" : "s"} as a test</h3><p>Only the test inbox below receives these copies. Original recipients and draft statuses remain unchanged.</p></div>
                      <label className="test-recipient-field"><span>Send test to</span><input type="email" value={bulkForm.testRecipients} onChange={(event) => setBulkForm({ ...bulkForm, testRecipients: event.target.value })} placeholder="Enter your email address" autoComplete="email" /></label>
                      <label className="confirm-box"><input type="checkbox" checked={bulkForm.confirmed} onChange={(event) => setBulkForm({ ...bulkForm, confirmed: event.target.checked })} /><span>I confirm this is my test inbox.</span></label>
                      <div className="bulk-actions"><button className="quiet-action" onClick={() => setBulkMode(null)}>Cancel</button><button className="test-send-action" disabled={!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(bulkForm.testRecipients.trim()) || !bulkForm.confirmed || working} onClick={runTestSend}>{working ? "Sending test…" : "Send test email"}</button></div>
                    </div>
                  )}
                  <EmailTable rows={pagedCampaignEmails} onOpen={setSelectedEmail} selected={selectedIds} onSelect={toggleSelected} onDelete={deleteCampaignEmail} deletingDisabled={working || !control?.canManage} />
                  <div className="pagination"><span>Page {page} of {campaignEmailPages}</span><div><button disabled={page === 1} onClick={() => setPage((current) => current - 1)}>Previous</button><button disabled={page === campaignEmailPages} onClick={() => setPage((current) => current + 1)}>Next</button></div></div>
                </section>
              )}

              {campaignDetailOpen && campaignWorkspaceView === "delivery" && selectedCampaign && (
                <section className="campaign-queue campaign-delivery-workspace">
                  <article className="panel campaign-workspace">
                    <div className="campaign-workspace-header">
                      <div><p className="eyebrow">Campaign approval & delivery</p><h2>{selectedCampaign.name}</h2><p>Review the audience, approve every draft, then schedule this campaign as one controlled operation.</p></div>
                      <div className="campaign-stat-strip"><span><b>{selectedCampaignEmails.length}</b>Recipients</span><span><b>{selectedCampaignDrafts}</b>Needs review</span><span><b>{selectedCampaignApproved}</b>Approved</span><span><b>{selectedCampaignScheduled}</b>Scheduled</span><span><b>{selectedCampaignSent}</b>Sent</span></div>
                    </div>
                    <div className="campaign-process">
                      <section>
                        <div className="campaign-step-heading"><span>1</span><div><strong>Review campaign audience</strong><p>All recipients below belong only to this selected campaign.</p></div></div>
                        <div className="campaign-recipient-list">
                          {selectedCampaignEmails.slice(0, 12).map((email) => <div key={email.id}><span><strong>{email.company}</strong><small>{email.recipient}</small></span><span className="campaign-recipient-actions"><StatusPill value={email.sendStatus || email.status} /><button type="button" className="delete-email-action" disabled={working || !control?.canManage || email.status === "sent" || email.status === "scheduled" || String(email.sendStatus || "").startsWith("scheduled")} onClick={() => deleteCampaignEmail(email)} title={email.status === "sent" || email.status === "scheduled" || String(email.sendStatus || "").startsWith("scheduled") ? "Sent or scheduled emails cannot be deleted" : "Delete this generated email"}>Delete</button></span></div>)}
                          {selectedCampaignEmails.length > 12 && <button type="button" onClick={() => setCampaignWorkspaceView("emails")}>Review all {selectedCampaignEmails.length} campaign emails →</button>}
                        </div>
                      </section>
                      <section>
                        <div className="campaign-step-heading"><span>2</span><div><strong>Approve the campaign</strong><p>Approval changes draft status only. It never sends an email.</p></div></div>
                        <div className="campaign-approval-box"><div><b>{selectedCampaignDrafts}</b><span>drafts still need approval</span></div><button disabled={working || !control?.canManage || selectedCampaignDrafts === 0} onClick={approveSelectedCampaign}>{selectedCampaignDrafts ? `Approve ${selectedCampaignDrafts} drafts` : "Campaign approved"}</button></div>
                      </section>
                      <section className="campaign-schedule-section">
                        <div className="campaign-step-heading"><span>3</span><div><strong>Choose campaign delivery</strong><p>Sending identity: {selectedCampaign.senderName} &lt;{selectedCampaign.senderEmail}&gt;. Choose immediate or scheduled Brevo delivery.</p></div></div>
                        <div className="campaign-delivery-choice" role="tablist" aria-label="Campaign delivery choice">
                          <button className={campaignDeliveryChoice === "schedule" ? "active" : ""} onClick={() => setCampaignDeliveryChoice("schedule")}>Schedule campaign</button>
                          <button className={campaignDeliveryChoice === "send" ? "active" : ""} onClick={() => setCampaignDeliveryChoice("send")}>Send campaign now</button>
                        </div>
                        {campaignDeliveryChoice === "schedule" ? (
                          <div className="campaign-schedule-form">
                            <label><span>Campaign starts</span><input type="datetime-local" value={queueForm.scheduledFor} onChange={(event) => setQueueForm({ ...queueForm, scheduledFor: event.target.value })} /><small>Choose a time from 2 minutes up to 72 hours ahead.</small></label>
                            <label><span>Emails in each batch</span><select value={queueForm.batchSize} onChange={(event) => setQueueForm({ ...queueForm, batchSize: Number(event.target.value) })}><option value={1}>1 email at a time</option><option value={2}>2 emails at a time</option><option value={3}>3 emails at a time</option></select><small>Emails in one batch are submitted together.</small></label>
                            <label><span>Gap between batches</span><select value={queueForm.delayMinutes} onChange={(event) => setQueueForm({ ...queueForm, delayMinutes: Number(event.target.value) })}><option value={1}>1 minute</option><option value={2}>2 minutes</option><option value={3}>3 minutes</option><option value={5}>5 minutes</option><option value={10}>10 minutes</option><option value={15}>15 minutes</option></select><small>Effective gap: {effectiveCampaignGap} minute{effectiveCampaignGap === 1 ? "" : "s"}. The global minimum and sending hours always apply.</small></label>
                            <label className="campaign-confirm"><input type="checkbox" disabled={paused || !control?.canManage} checked={queueForm.confirmed} onChange={(event) => setQueueForm({ ...queueForm, confirmed: event.target.checked })} /><span><strong>I reviewed this campaign and approve automatic delivery.</strong><small>{paused ? "Pause all is active. Turn it off in Controls & APIs before scheduling." : "Brevo will continue delivery after the dashboard is closed."}</small></span></label>
                            <button className="primary-action campaign-schedule-button" disabled={working || paused || !control?.canManage || !queueForm.confirmed || !queueForm.scheduledFor || selectedCampaignApproved === 0 || selectedCampaignDrafts > 0} onClick={scheduleSelectedCampaign}>{working ? "Scheduling campaign…" : `Schedule ${selectedCampaignApproved} approved emails`}</button>
                          </div>
                        ) : (
                          <div className="campaign-send-now-form">
                            <div><strong>Immediate delivery cannot be undone</strong><p>All {selectedCampaignApproved} approved, unsent emails in this campaign will be submitted to Brevo now. The daily limit and global Pause all control still apply.</p></div>
                            <label><span>Type SEND CAMPAIGN to confirm</span><input value={campaignSendConfirm} onChange={(event) => setCampaignSendConfirm(event.target.value.toUpperCase())} placeholder="SEND CAMPAIGN" /></label>
                            <button className="danger-action" disabled={working || paused || !control?.canManage || selectedCampaignApproved === 0 || selectedCampaignDrafts > 0 || campaignSendConfirm !== "SEND CAMPAIGN"} onClick={sendSelectedCampaignNow}>{working ? "Submitting campaign…" : `Send ${selectedCampaignApproved} approved emails now`}</button>
                          </div>
                        )}
                      </section>
                    </div>
                  </article>
                  <article className="panel scheduled-campaigns">
                    <div className="panel-heading"><div><p className="eyebrow">24/7 Brevo delivery</p><h2>Scheduled campaign activity</h2><p className="section-helper">Server-owned schedules continue while nobody is signed in.</p></div><span>{scheduledCampaignGroups.length} active</span></div>
                    <div className="scheduled-campaign-list">{scheduledCampaignGroups.length ? scheduledCampaignGroups.map((item) => <div key={item.id}><span className="campaign-symbol">{item.name.slice(0, 2).toUpperCase()}</span><div><strong>{item.name}</strong><small>{item.count} emails · {item.first ? `starts ${new Date(item.first).toLocaleString("en-IN")}` : "start pending"}{item.last && item.last !== item.first ? ` · ends ${new Date(item.last).toLocaleString("en-IN")}` : ""}</small></div><StatusPill value="scheduled" /></div>) : <div className="empty-state">No campaigns are scheduled yet.</div>}</div>
                  </article>
                </section>
              )}
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

          {section === "statistics" && (
            <StatisticsDashboard emails={displayEmails} />
          )}

          {section === "create" && (
            <section className="intelligence-layout">
              {(() => {
                const isStep1Valid = !!(intakeForm.campaignName.trim() && intakeForm.topic.trim() && intakeForm.emailTemplate.trim());
                const isStep2Valid = !!(intakeForm.rawInput.trim() || intakeForm.websites.trim() || intakeFile);
                const parsedEmails = (intakeForm.rawInput.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+)/gi) || []).length;
                const rawInputWithoutEmails = intakeForm.rawInput.replace(/[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+/gi, " ");
                const parsedWebsites = (rawInputWithoutEmails.match(/(https?:\/\/[^\s]+|www\.[^\s]+|[a-zA-Z0-9._-]+\.(com|org|net|io|in|co))/gi) || []).length;
                const scannedOkCount = websiteScans.filter((scan) => scan.ok).length;
                const scannedEmailCount = websiteScans.reduce((sum, scan) => sum + scan.discoveredEmails.length, 0);
                const scannedSkippedCount = websiteScans.filter((scan) => scan.skipped).length;

                return (
                  <article className="intelligence-studio-container">
                    <div className="studio-hero-modern">
                      <nav className="wizard-track" aria-label="Campaign creation steps">
                        <div className="wizard-track-rail"><div className="wizard-track-fill" style={{ width: `${((currentStep - 1) / 2) * 100}%` }} /></div>
                        <button type="button" className={`track-step ${currentStep === 1 ? 'is-active' : ''} ${isStep1Valid && currentStep !== 1 ? 'is-done' : ''}`} onClick={() => setCurrentStep(1)}>
                          <span className="track-index">{isStep1Valid && currentStep !== 1 ? '✓' : '01'}</span>
                          <span className="track-copy"><strong>Setup</strong><small>Name &amp; template</small></span>
                        </button>
                        <span className={`track-arrow ${isStep1Valid ? 'is-filled' : ''}`} aria-hidden="true">›</span>
                        <button type="button" disabled={!isStep1Valid} className={`track-step ${currentStep === 2 ? 'is-active' : ''} ${isStep2Valid && currentStep !== 2 ? 'is-done' : ''}`} onClick={() => setCurrentStep(2)}>
                          <span className="track-index">{isStep2Valid && currentStep !== 2 ? '✓' : '02'}</span>
                          <span className="track-copy"><strong>Audience</strong><small>Contacts &amp; context</small></span>
                        </button>
                        <span className={`track-arrow ${isStep2Valid ? 'is-filled' : ''}`} aria-hidden="true">›</span>
                        <button type="button" disabled={!isStep1Valid || !isStep2Valid} className={`track-step ${currentStep === 3 ? 'is-active' : ''}`} onClick={() => setCurrentStep(3)}>
                          <span className="track-index">03</span>
                          <span className="track-copy"><strong>Generate</strong><small>Review &amp; send</small></span>
                        </button>
                      </nav>
                    </div>
                    <form className="studio-form" onSubmit={(event) => { event.preventDefault(); runIntelligenceStudio("draft"); }}>
                      {currentStep === 1 && (
                        <div className="modern-step-card">
                          <div className="wizard-header"><span className="wizard-badge">1</span><h3 className="wizard-title">Campaign Setup</h3></div>
                          <div className="campaign-setup-grid" id="campaign-setup">
                            <label className="topic-field"><span>Campaign name</span><input required value={intakeForm.campaignName} onChange={(event) => setIntakeForm({ ...intakeForm, campaignName: event.target.value })} placeholder="Example: Manufacturing Leaders - August 2026" /><small>Every draft from this set stays together under this campaign.</small></label>
                            <label className="topic-field"><span>Email topic / subject template</span><input required value={intakeForm.topic} onChange={(event) => setIntakeForm({ ...intakeForm, topic: event.target.value })} placeholder="Example: {{company}} - Product Launch 2026" /><small>Use <code>{"{ASSOCIATION NAME}"}</code> or <code>{"{{company}}"}</code> to insert each recipient’s company. If omitted, the company name is added at the start.</small></label>
                          </div>
                          <section className="template-field" style={{ marginTop: 24 }}>
                            <div className="template-field-heading">
                              <span>Your email template</span>
                              <small>Rich campaign template · Version {intakeForm.emailTemplateVersion}</small>
                            </div>
                            <RichEmailEditor
                              value={intakeForm.emailTemplate}
                              disabled={working}
                              onChange={(emailTemplate) => setIntakeForm((current) => ({ ...current, emailTemplate }))}
                            />
                            <small>Use the <strong>Personalize</strong> menu to insert contact, company, research, topic, industry, website, or focus-area fields. Formatting around each field is preserved in every generated email. Missing values and curly brackets are removed safely before review or delivery.</small>
                          </section>
                          <div className="wizard-nav">
                            <div />
                            <button type="button" className="btn-next" disabled={!isStep1Valid} onClick={() => setCurrentStep(2)}>Next: Add Audience →</button>
                          </div>
                        </div>
                      )}

                      {currentStep === 2 && (
                        <div className="modern-step-card">
                          <div className="wizard-header"><span className="wizard-badge">2</span><h3 className="wizard-title">Add Your Audience</h3></div>
                          
                          <div className="audience-setup-section">
                            <h4 className="section-subheading">Data Sources</h4>
                            <div className="source-grid">
                              <label className="source-card">
                                <span className="source-icon">Aa</span><strong>Paste names and emails</strong><small>One per line, CSV, or Name &lt;email&gt;</small>
                                <textarea rows={6} value={intakeForm.rawInput} onChange={(event) => setIntakeForm({ ...intakeForm, rawInput: event.target.value })} placeholder={"Suraj Sonnar <suraj@company.com>\nPriya, priya@company.in, Company Name\ninfo@company.org"} />
                                {(parsedEmails > 0 || parsedWebsites > 0) && (
                                  <div className="extraction-badge">✨ Found {parsedEmails} email{parsedEmails !== 1 ? 's' : ''} and {parsedWebsites} website{parsedWebsites !== 1 ? 's' : ''}</div>
                                )}
                              </label>
                              <div className="source-card website-source-card">
                                <span className="source-icon">www</span><strong>Add company websites</strong><small>Add as many websites as you need.</small>
                                <textarea id="website-sources" aria-label="Company websites" rows={6} value={intakeForm.websites} onChange={(event) => { setIntakeForm({ ...intakeForm, websites: event.target.value }); setWebsiteScans([]); }} placeholder={"www.company.com\nhttps://association.org/contact-us/\nexample.in"} />
                                {savingDiscoveredContacts && !scanningWebsites ? (
                                  <div className="scan-progress" role="status" aria-live="polite">
                                    <div className="scan-progress-row"><span>Saving found contacts to the database…</span></div>
                                    <i><b className="scan-progress-indeterminate" /></i>
                                  </div>
                                ) : scanningWebsites && scanProgress ? (
                                  <div className="scan-progress" role="status" aria-live="polite">
                                    <div className="scan-progress-row">
                                      <span>Scanning websites… {scanProgress.completed} of {scanProgress.total || "?"}</span>
                                      {!(scanProgress.total > 0 && scanProgress.completed >= scanProgress.total) && (
                                        <button type="button" className="scan-stop-button" onClick={stopWebsiteDiscovery}>Stop</button>
                                      )}
                                    </div>
                                    <i><b style={{ width: `${scanProgress.total ? Math.min(100, Math.round((scanProgress.completed / scanProgress.total) * 100)) : 0}%` }} /></i>
                                    {scanWaitNote && <small className="scan-progress-note scan-progress-warn">{scanWaitNote}</small>}
                                    {scanSavedTotals && (scanSavedTotals.contactsCreated > 0 || scanSavedTotals.companiesCreated > 0) && (
                                      <small className="scan-progress-note">✓ {scanSavedTotals.contactsCreated} contact{scanSavedTotals.contactsCreated === 1 ? "" : "s"} already saved to the database as it goes</small>
                                    )}
                                  </div>
                                ) : (
                                  <button type="button" className="website-scan-button" disabled={scanningWebsites || working || !control?.canManage || !intakeForm.websites.trim()} onClick={runWebsiteDiscovery}>{websiteScans.length > 0 ? "Resume scanning" : "Find public email addresses"}</button>
                                )}
                              </div>
                              <label className={`source-card upload-card ${intakeFile ? "has-file" : ""}`}>
                                <span className="source-icon">↑</span><strong>Upload a contact document</strong><small>PDF, DOCX, CSV, TSV, or TXT · up to 6 MB.</small>
                                <div className="upload-dropzone">
                                  <input type="file" accept=".pdf,.docx,.csv,.tsv,.txt" onChange={(event) => handleFileSelection(event.target.files?.[0] || null)} />
                                  <span className="file-cta">{intakeFile ? intakeFile.name : "Choose document"}</span>
                                </div>
                              </label>
                            </div>
                          </div>

                          <div className="audience-setup-section" style={{ marginTop: 32 }}>
                            <div className="context-header">
                              <h4 className="section-subheading" style={{ textTransform: 'uppercase', fontSize: '13px', letterSpacing: '0.5px' }}>Context & AI Instructions</h4>
                            </div>
                            <div className="context-grid">
                              <label className="brief-field">
                                <span>Industry / business domain <small>(Leave blank to auto-detect)</small></span>
                                <input list="industry-domain-options" value={intakeForm.industry} onChange={(event) => setIntakeForm({ ...intakeForm, industry: event.target.value })} placeholder="E.g. Healthcare, Fintech, Manufacturing" />
                              </label>
                              <label className="brief-field">
                                <span>Optional context or instructions</span>
                                <textarea rows={3} value={intakeForm.brief} onChange={(event) => setIntakeForm({ ...intakeForm, brief: event.target.value })} placeholder="Mention the audience, desired outcome, offer, industry angle, or specific pain points." />
                              </label>
                            </div>
                          </div>
                          {websiteScans.length > 0 && (
                            <section className="website-scan-results" aria-live="polite" style={{ marginTop: 24 }}>
                              <div><span><strong>Website scan results</strong><small>{websiteScans.length} checked · {scannedOkCount} responded · {scannedEmailCount} email{scannedEmailCount === 1 ? "" : "s"} found{scannedSkippedCount ? ` · ${scannedSkippedCount} already in database (skipped)` : ""}</small></span><span className="website-scan-actions"><button type="button" className="website-scan-button" disabled={savingDiscoveredContacts || working || !control?.canManage || !websiteScans.some((scan) => scan.discoveredEmails.length > 0)} onClick={saveDiscoveredContacts} title="Save the discovered companies and email addresses to the database now, without creating a campaign">{savingDiscoveredContacts ? "Saving…" : "Save found contacts to database"}</button><button type="button" onClick={() => setWebsiteScans([])}>Clear results</button></span></div>
                              <div className="website-scan-grid">
                                {websiteScans.map((scan) => (
                                  <article className={scan.skipped ? "website-scan-card skipped" : scan.ok ? "website-scan-card" : "website-scan-card failed"} key={scan.input}>
                                    <span className="scan-state">{scan.skipped ? "↷" : scan.ok ? "✓" : "!"}</span>
                                    <div>
                                      <strong>{scan.companyName || scan.input}</strong>
                                      <small>{scan.skipped ? "Already in the database — scan skipped" : scan.ok ? `${scan.pagesReviewed.length} public page${scan.pagesReviewed.length === 1 ? "" : "s"} scanned` : scan.error}</small>
                                      {scan.discoveredEmails.length ? <div className="email-chip-list">{scan.discoveredEmails.map((email) => <span key={email}>{email}</span>)}</div> : (scan.ok && !scan.skipped) && <p>No public email address found on the scanned pages.</p>}
                                    </div>
                                  </article>
                                ))}
                              </div>
                            </section>
                          )}
                          <div className="wizard-nav">
                            <button type="button" className="btn-back" onClick={() => setCurrentStep(1)}>← Back</button>
                            <button type="button" className="btn-next" disabled={!isStep2Valid} onClick={() => setCurrentStep(3)}>Next: Review & Create →</button>
                          </div>
                        </div>
                      )}

                      {currentStep === 3 && (
                        <div className="modern-step-card">
                          <div className="wizard-header"><span className="wizard-badge">3</span><h3 className="wizard-title">Review Campaign Settings</h3></div>
                          <section className="campaign-creation-actions" style={{ borderTop: 'none', paddingTop: 0 }}>
                            <div className="campaign-identity-fields">
                              <label className="campaign-sender-field">
                                <span>Verified Brevo sender</span>
                                <select value={intakeForm.senderEmail} onChange={(event) => {
                                  const senderEmail = event.target.value;
                                  setIntakeForm((current) => ({ ...current, senderEmail, ...(replyToChoice === "sender" ? { replyToEmail: senderEmail } : {}) }));
                                }}>
                                  {(control?.availableSenders || [control?.sender].filter(Boolean)).map((item) => item && <option key={item.email} value={item.email}>{item.name} &lt;{item.email}&gt;</option>)}
                                </select>
                                <small>Used as the visible From address and email signature.</small>
                              </label>
                              <label className="campaign-sender-field campaign-reply-field">
                                <span>Reply-To email</span>
                                <select value={replyToChoice} onChange={(event) => {
                                  const choice = event.target.value;
                                  setReplyToChoice(choice);
                                  if (choice === "sender") setIntakeForm((current) => ({ ...current, replyToEmail: current.senderEmail }));
                                  else if (choice !== "custom") setIntakeForm((current) => ({ ...current, replyToEmail: choice }));
                                }}>
                                  <option value="sender">Same as selected sender</option>
                                  {(control?.availableSenders || [control?.sender].filter(Boolean)).map((item) => item && <option key={`reply-${item.email}`} value={item.email}>{item.email}</option>)}
                                  <option value="custom">Enter another email</option>
                                </select>
                                {replyToChoice === "custom" && <input type="email" required value={intakeForm.replyToEmail} onChange={(event) => setIntakeForm({ ...intakeForm, replyToEmail: event.target.value })} placeholder="replies@yourcompany.com" autoComplete="email" aria-label="Custom Reply-To email" />}
                                <small>Replies from recipients will be delivered to {isValidEmail(intakeForm.replyToEmail) ? intakeForm.replyToEmail : "the valid inbox you enter"}.</small>
                              </label>
                            </div>
                            <div className="campaign-paths">
                              <div><strong>Choose what happens next</strong><span>Research runs in the background. Sending always remains behind review, approval, and confirmation.</span></div>
                              <button type="submit" className="quiet-action" disabled={working || scanningWebsites || !control?.canManage || !isValidEmail(intakeForm.replyToEmail) || !isStep1Valid || !isStep2Valid}>{working ? "Queuing campaign…" : "Save as draft campaign"}</button>
                              <button type="button" className="primary-action" onClick={() => runIntelligenceStudio("delivery")} disabled={working || scanningWebsites || !control?.canManage || !isValidEmail(intakeForm.replyToEmail) || !isStep1Valid || !isStep2Valid}>Continue to campaign setup</button>
                            </div>
                          </section>
                          <div className="wizard-nav">
                            <button type="button" className="btn-back" onClick={() => setCurrentStep(2)}>← Back</button>
                            <div />
                          </div>
                        </div>
                      )}
                    </form>
                  </article>
                );
              })()}



              {intakeResults.length > 0 && (
                <section className="panel research-results">
                  <div className="panel-heading"><div><p className="eyebrow">Research output</p><h2>{intakeResults.filter((item) => item.ok).length} drafts created</h2></div><button className="text-button" onClick={() => openCampaignWorkspace("emails", intakeForm.campaignName)}>Review campaign emails →</button></div>
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
                        {selectedCampaignEmails.slice(0, 12).map((email) => <div key={email.id}><span><strong>{email.company}</strong><small>{email.recipient}</small></span><span className="campaign-recipient-actions"><StatusPill value={email.sendStatus || email.status} /><button type="button" className="delete-email-action" disabled={working || !control?.canManage || email.status === "sent" || email.status === "scheduled" || String(email.sendStatus || "").startsWith("scheduled")} onClick={() => deleteCampaignEmail(email)} title={email.status === "sent" || email.status === "scheduled" || String(email.sendStatus || "").startsWith("scheduled") ? "Sent or scheduled emails cannot be deleted" : "Delete this generated email"}>Delete</button></span></div>)}
                        {selectedCampaignEmails.length > 12 && <button type="button" onClick={() => openCampaignWorkspace("emails", selectedCampaign.name)}>View all {selectedCampaignEmails.length} campaign emails →</button>}
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
                        <label><span>Emails in each batch</span><select value={queueForm.batchSize} onChange={(event) => setQueueForm({ ...queueForm, batchSize: Number(event.target.value) })}><option value={1}>1 email at a time</option><option value={2}>2 emails at a time</option><option value={3}>3 emails at a time</option></select><small>Emails in one batch are submitted together.</small></label>
                        <label><span>Gap between batches</span><select value={queueForm.delayMinutes} onChange={(event) => setQueueForm({ ...queueForm, delayMinutes: Number(event.target.value) })}><option value={1}>1 minute</option><option value={2}>2 minutes</option><option value={3}>3 minutes</option><option value={5}>5 minutes</option><option value={10}>10 minutes</option><option value={15}>15 minutes</option></select><small>Effective gap: {effectiveCampaignGap} minute{effectiveCampaignGap === 1 ? "" : "s"}. The global minimum and sending hours always apply.</small></label>
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
                <div><p className="eyebrow">IKF Reach operations</p><h2>Sending is {paused ? "paused and protected" : "active within your limits"}</h2><p>{paused ? "Drafting, research, contact editing, and review remain available. Scheduling and client sending are blocked." : "Only approved emails can be scheduled or sent, inside the delivery limits below."}</p></div>
                <StatusPill value={paused ? "paused_user_hold" : "active"} />
              </article>

              <nav className="settings-tabbar" aria-label="Control centre sections">
                <button className={settingsView === "connections" ? "active" : ""} onClick={() => setSettingsView("connections")}>1. Connections</button>
                <button className={settingsView === "workflow" ? "active" : ""} onClick={() => setSettingsView("workflow")}>2. Workflow</button>
                <button className={settingsView === "delivery" ? "active" : ""} onClick={() => setSettingsView("delivery")}>3. Delivery limits</button>
              </nav>

              <article className={`panel settings-section ${settingsView === "connections" ? "" : "settings-section-hidden"}`}>
                <div className="settings-section-heading"><div><span className="settings-number">1</span><div><p className="eyebrow">System readiness</p><h2>Connections and sending identity</h2><p>These services must be available before any delivery action can work.</p></div></div><button onClick={loadControl} disabled={refreshing}>{refreshing ? "Checking…" : "Check connections"}</button></div>
                <div className="connection-cards">
                  <div><span className={`api-dot ${control?.providers?.database ? "online" : "offline"}`} /><div><strong>Supabase database</strong><small>Contacts, companies, campaigns, drafts, and activity</small></div><b>{control?.providers?.database ? "Connected" : "Unavailable"}</b></div>
                  <div><span className={`api-dot ${control?.providers?.brevo ? "online" : "offline"}`} /><div><strong>Brevo delivery</strong><small>Test copies, scheduled delivery, and sending</small></div><b>{control?.providers?.brevo ? "Connected" : "Unavailable"}</b></div>
                  <div><span className="identity-avatar">T</span><div><strong>Tanishka &lt;tanishka@iknowai.in&gt;</strong><small>Sender and Reply-To: {control?.replyTo || "tanishka@iknowai.in"}</small></div><b>Verified</b></div>
                </div>
              </article>

              <article className={`panel settings-section ${settingsView === "workflow" ? "" : "settings-section-hidden"}`}>
                <div className="settings-section-heading"><div><span className="settings-number">2</span><div><p className="eyebrow">Process flow</p><h2>How an email moves through the system</h2><p>Every step is visible and reviewable. Nothing bypasses approval.</p></div></div></div>
                <ol className="sending-flow">
                  <li><span>1</span><div><strong>Create campaign drafts</strong><p>Add recipients, research sources, and your template. Drafts are grouped by campaign.</p></div></li>
                  <li><span>2</span><div><strong>Review and approve</strong><p>Open each email, check personalization, and approve only the drafts you want.</p></div></li>
                  <li><span>3</span><div><strong>Test or schedule</strong><p>Send a preview to your own inbox, or choose the first delivery time and spacing.</p></div></li>
                  <li><span>4</span><div><strong>Track every result</strong><p>Brevo results and all database changes appear in the dashboard activity trail.</p></div></li>
                </ol>
              </article>

              <article className={`panel settings-section ${settingsView === "delivery" ? "" : "settings-section-hidden"}`}>
                <div className="settings-section-heading"><div><span className="settings-number">3</span><div><p className="eyebrow">Delivery guardrails</p><h2>Control when and how fast emails can send</h2><p>All times use Asia/Kolkata. Pause and daily limits protect every client campaign; spacing and sending hours control scheduled delivery. Test previews are excluded.</p></div></div></div>
                <form className="safety-form" onSubmit={(e) => { e.preventDefault(); const form = new FormData(e.currentTarget); runAction({ action: "policy", dailyLimit: form.get("dailyLimit"), delay: form.get("delay"), windowStart: form.get("windowStart"), windowEnd: form.get("windowEnd"), paused: form.get("paused") === "on" }, "Safety settings saved."); }}>
                  <label><span>Daily sending limit</span><input required disabled={!control?.canManage || working} name="dailyLimit" type="number" min="1" max="1000" step="1" defaultValue={control?.settings?.daily_limit || 25} /><small>Maximum client emails per day</small></label>
                  <label><span>Minimum batch gap</span><div className="input-suffix"><input required disabled={!control?.canManage || working} name="delay" type="number" min="1" max="60" step="1" defaultValue={control?.settings?.minimum_delay_minutes || 5} /><b>minutes</b></div><small>Campaigns cannot schedule a smaller gap</small></label>
                  <label><span>Scheduled sending starts</span><input required disabled={!control?.canManage || working} name="windowStart" type="time" defaultValue={control?.settings?.sending_window_start || "10:00"} /><small>Earliest allowed scheduled delivery</small></label>
                  <label><span>Scheduled sending ends</span><input required disabled={!control?.canManage || working} name="windowEnd" type="time" defaultValue={control?.settings?.sending_window_end || "17:00"} /><small>Latest allowed scheduled delivery</small></label>
                  <label className={`pause-control ${paused ? "selected" : ""}`}><input disabled={!control?.canManage || working} name="paused" type="checkbox" defaultChecked={control?.settings?.paused ?? true} /><span><strong>Pause all client sending</strong><small>Recommended while campaigns are being prepared or reviewed.</small></span></label>
                  <div className="safety-actions"><div><strong>{control?.canManage ? "Changes apply immediately after saving." : "Sign in with an authorized IKF account to change controls."}</strong><span>Manual approval remains mandatory in both states.</span></div><button disabled={!control?.canManage || working} className="primary-action">{working ? "Saving…" : "Save delivery controls"}</button></div>
                </form>
              </article>
            </section>
          )}

          {section === "contacts" && (
            <section className="panel data-panel">
              <div className="panel-heading">
                <div><p className="eyebrow">Audience safety</p><h2>{displayContacts.length} contacts</h2><span className="panel-subcopy">{validationCounts.valid.toLocaleString("en-IN")} valid · {validationCounts.risky.toLocaleString("en-IN")} risky · {validationCounts.invalid.toLocaleString("en-IN")} quarantined</span></div>
                <div className="contact-list-controls">
                  <label><span>Industry</span><select value={contactIndustry} onChange={(event) => { setContactIndustry(event.target.value); setContactPage(1); }}><option value="all">All industries</option>{availableIndustries.map((industry) => <option value={industry} key={industry}>{industry}</option>)}</select></label>
                  <label><span>Rows per page</span><select value={contactPageSize} onChange={(event) => { setContactPageSize(Number(event.target.value)); setContactPage(1); }}><option value={50}>50</option><option value={100}>100</option><option value={1000}>1,000</option></select></label>
                  <button type="button" className="primary-action validate-email-button" disabled={!control?.canManage || working || Boolean(activeValidationJob)} onClick={() => { if (selectedContactIds.size) setValidationScope("selected"); setValidationPanelOpen(true); }} title={control?.canManage ? "Validate contacts without sending probe emails" : "Sign in with an authorized IKF account"}>
                    {activeValidationJob ? "Validation active" : selectedContactIds.size ? `Validate selected (${selectedContactIds.size})` : "Validate emails"}
                  </button>
                </div>
              </div>

              <div className="validation-tabs" role="tablist" aria-label="Filter contacts by validation status">
                {([
                  ["all", "All", validationCounts.all],
                  ["valid", "Valid", validationCounts.valid],
                  ["risky", "Risky", validationCounts.risky],
                  ["invalid", "Quarantined", validationCounts.invalid],
                  ["unknown", "Unknown", validationCounts.unknown],
                  ["unchecked", "Not checked", validationCounts.unchecked],
                ] as const).map(([value, label, count]) => (
                  <button type="button" role="tab" aria-selected={validationFilter === value} className={validationFilter === value ? "active" : ""} key={value} onClick={() => { setValidationFilter(value); setContactPage(1); }}>
                    {label}<b>{count.toLocaleString("en-IN")}</b>
                  </button>
                ))}
              </div>

              {activeValidationJob && (
                <div className={`validation-job ${activeValidationJob.status}`}>
                  <div className="validation-job-heading">
                    <div>
                      <p className="eyebrow">Email validation</p>
                      <h3>{activeValidationJob.status === "scheduled" ? "Scheduled validation" : "Validating contacts in the background"}</h3>
                      <span>{activeValidationJob.status === "scheduled" && activeValidationJob.scheduledFor ? `Starts ${new Date(activeValidationJob.scheduledFor).toLocaleString("en-IN")}` : `${activeValidationJob.processedItems.toLocaleString("en-IN")} of ${activeValidationJob.totalItems.toLocaleString("en-IN")} checked`}</span>
                    </div>
                    <button type="button" className="danger-outline" disabled={working || !control?.canManage} onClick={() => cancelEmailValidation(activeValidationJob.id)}>Stop</button>
                  </div>
                  <div className="validation-progress" aria-label="Validation progress"><span style={{ width: `${activeValidationJob.totalItems ? Math.min(100, (activeValidationJob.processedItems / activeValidationJob.totalItems) * 100) : 0}%` }} /></div>
                  <div className="validation-job-metrics">
                    <span><b>{activeValidationJob.validItems}</b> Valid</span><span><b>{activeValidationJob.riskyItems}</b> Risky</span><span><b>{activeValidationJob.invalidItems}</b> Quarantined</span><span><b>{activeValidationJob.unknownItems}</b> Unknown</span><span><b>{activeValidationJob.failedItems}</b> Could not check</span>
                  </div>
                </div>
              )}

              {validationPanelOpen && !activeValidationJob && (
                <div className="validation-setup">
                  <div><p className="eyebrow">Safe validation</p><h3>Choose which contacts to check</h3><p>Checks email format, domain and MX records, disposable domains, role inboxes, and previous Brevo delivery history. No probe email is sent.</p></div>
                  <div className="validation-scope" role="group" aria-label="Contacts to validate">
                    <button type="button" className={validationScope === "unchecked" ? "active" : ""} onClick={() => setValidationScope("unchecked")}><strong>Not checked</strong><span>{validationCounts.unchecked.toLocaleString("en-IN")} contacts</span></button>
                    <button type="button" className={validationScope === "selected" ? "active" : ""} disabled={!selectedContactIds.size} onClick={() => setValidationScope("selected")}><strong>Selected</strong><span>{selectedContactIds.size.toLocaleString("en-IN")} contacts</span></button>
                    <button type="button" className={validationScope === "all" ? "active" : ""} onClick={() => setValidationScope("all")}><strong>All contacts</strong><span>Recheck {displayContacts.length.toLocaleString("en-IN")}</span></button>
                  </div>
                  <div className="validation-mode" role="group" aria-label="Validation timing"><button type="button" className={validationScheduleMode === "now" ? "active" : ""} onClick={() => setValidationScheduleMode("now")}>Run now</button><button type="button" className={validationScheduleMode === "schedule" ? "active" : ""} onClick={() => setValidationScheduleMode("schedule")}>Schedule</button></div>
                  {validationScheduleMode === "schedule" && <label className="validation-date"><span>Start date and time</span><input type="datetime-local" value={validationScheduledFor} onChange={(event) => setValidationScheduledFor(event.target.value)} /></label>}
                  <div className="validation-setup-actions"><button type="button" onClick={() => setValidationPanelOpen(false)}>Cancel</button><button type="button" className="primary-action" disabled={working || !control?.canManage || (validationScope === "selected" && !selectedContactIds.size) || (validationScope === "unchecked" && !validationCounts.unchecked)} onClick={startEmailValidation}>{working ? "Queuing…" : validationScheduleMode === "schedule" ? "Schedule validation" : validationScope === "selected" ? `Validate ${selectedContactIds.size} selected` : validationScope === "unchecked" ? `Validate ${validationCounts.unchecked} not checked` : "Validate all contacts"}</button></div>
                </div>
              )}

              <div className="validation-policy-note"><strong>Validation-first campaign protection</strong><span>New addresses from documents, websites, or pasted lists are validated before a draft is created. Invalid addresses remain in Quarantined and cannot be approved, scheduled, or sent. Any hard-bounced address is permanently suppressed from every future campaign.</span></div>

              <div className="contact-selection-summary">
                <div><strong>{selectedContactIds.size ? `${selectedContactIds.size.toLocaleString("en-IN")} contacts selected` : "Custom validation"}</strong><span>{selectedContactIds.size ? "Validate only this hand-picked set now or schedule it for later." : "Choose individual contacts, this page, or every filtered result."}</span></div>
                <div>
                  <button type="button" onClick={() => setSelectedContactIds(new Set(pageContactIds))}>Select this page ({pageContactIds.length.toLocaleString("en-IN")})</button>
                  <button type="button" onClick={selectAllFilteredContacts}>Select all filtered ({filteredContacts.length.toLocaleString("en-IN")})</button>
                  {selectedContactIds.size > 0 && <button type="button" className="selection-clear" onClick={() => setSelectedContactIds(new Set())}>Clear</button>}
                </div>
              </div>
              <div className="table-wrap contacts-table-wrap"><table className="contacts-table"><thead><tr><th className="contact-select-cell"><input type="checkbox" checked={pageContactsSelected} onChange={togglePageContactSelection} aria-label={pageContactsSelected ? "Clear contacts on this page" : "Select contacts on this page"} /></th><th>Contact</th><th>Company</th><th>Industry</th><th>Validation</th><th>Confidence</th><th>Added</th><th>Action</th></tr></thead><tbody>
                {pagedContacts.map((contact) => {
                  const validation = validationByContact.get(contact.id);
                  return <tr key={contact.id} className={validation?.verdict === "invalid" ? "quarantined-row" : ""}><td className="contact-select-cell"><input type="checkbox" checked={selectedContactIds.has(contact.id)} onChange={() => toggleContactSelection(contact.id)} aria-label={`Select ${contact.email}`} /></td><td><strong>{contactDisplayName(contact)}</strong><span>{contact.email}</span></td><td>{contact.company}</td><td>{contact.industry || "—"}</td><td><ValidationPill result={validation} />{validation?.reasons?.[0] && <small className="validation-reason">{validation.reasons[0]}</small>}</td><td><StatusPill value={contact.confidence} /></td><td>{compactDate(contact.createdAt)}</td><td><button className="edit-contact-button" disabled={!control?.canManage} onClick={() => openContactEditor(contact)} title={control?.canManage ? "Edit this contact" : "Sign in with an authorized IKF account to edit"}>Edit</button></td></tr>;
                })}
              </tbody></table></div>
              <div className="contact-card-list">
                {pagedContacts.map((contact) => {
                  const validation = validationByContact.get(contact.id);
                  return <article key={`mobile-${contact.id}`} className={validation?.verdict === "invalid" ? "contact-mobile-card quarantined-row" : "contact-mobile-card"}>
                    <div className="contact-mobile-heading"><label className="mobile-contact-select"><input type="checkbox" checked={selectedContactIds.has(contact.id)} onChange={() => toggleContactSelection(contact.id)} aria-label={`Select ${contact.email}`} /><span /></label><div><strong>{contactDisplayName(contact)}</strong><a href={`mailto:${contact.email}`}>{contact.email}</a></div><ValidationPill result={validation} /></div>
                    <dl><div><dt>Company</dt><dd>{contact.company}</dd></div><div><dt>Industry</dt><dd>{contact.industry || "Not classified"}</dd></div><div><dt>Confidence</dt><dd><StatusPill value={contact.confidence} /></dd></div></dl>
                    {validation?.reasons?.[0] && <p className="validation-reason">{validation.reasons[0]}</p>}
                    <button className="edit-contact-button" disabled={!control?.canManage} onClick={() => openContactEditor(contact)}>Edit contact</button>
                  </article>;
                })}
              </div>
              {!pagedContacts.length && <div className="empty-state">{validationFilter === "invalid" ? "No quarantined contacts." : "No contacts match your filters."}</div>}
              <div className="pagination">
                <span>{filteredContacts.length ? `Showing ${(safeContactPage - 1) * contactPageSize + 1}–${Math.min(safeContactPage * contactPageSize, filteredContacts.length)} of ${filteredContacts.length} contacts` : "0 contacts"} · Page {safeContactPage} of {contactPages}</span>
                <div><button disabled={safeContactPage === 1} onClick={() => setContactPage(Math.max(1, safeContactPage - 1))}>Previous</button><button disabled={safeContactPage === contactPages} onClick={() => setContactPage(Math.min(contactPages, safeContactPage + 1))}>Next</button></div>
              </div>
            </section>
          )}

          {section === "companies" && (
            <section className="panel data-panel">
              <div className="panel-heading"><div><p className="eyebrow">Organizations</p><h2>{displayCompanies.length} companies</h2><span className="panel-subcopy">Deduplicated by website domain, with every linked contact kept under its company.</span></div><div className="contact-list-controls company-list-controls"><label><span>Industry</span><select value={companyIndustry} onChange={(event) => { setCompanyIndustry(event.target.value); setCompanyPage(1); }}><option value="all">All industries</option>{availableIndustries.map((industry) => <option value={industry} key={industry}>{industry}</option>)}</select></label><label><span>Rows</span><select value={companyPageSize} onChange={(event) => { setCompanyPageSize(Number(event.target.value)); setCompanyPage(1); }}><option value={18}>18</option><option value={50}>50</option><option value={100}>100</option></select></label><div className="view-toggle" role="group" aria-label="Company view"><button type="button" className={companyView === "cards" ? "active" : ""} onClick={() => setCompanyView("cards")}>Cards</button><button type="button" className={companyView === "table" ? "active" : ""} onClick={() => setCompanyView("table")}>Table</button></div></div></div>
              <div className={`company-grid ${companyView === "cards" ? "" : "view-hidden"}`}>
                {pagedCompanies.map((company) => {
                  const website = fullWebsiteUrl(company.website);
                  return <article key={company.id} className="company-card"><div className="company-letter">{company.name.slice(0, 1)}</div><div><strong>{company.name}</strong><span>{company.industry || "Industry pending verification"}</span><small>{company.contacts} contacts · {company.drafts} drafts</small><div className="company-card-actions"><button type="button" onClick={() => setSelectedCompany(company)}>View contacts</button><button type="button" disabled={!control?.canManage} onClick={() => openCompanyEditor(company)}>Edit company</button>{website && <a className="company-website-url" href={website} target="_blank" rel="noreferrer" title={`Open ${website}`}>{website}</a>}</div></div></article>;
                })}
              </div>
              <div className={`table-wrap company-table-wrap ${companyView === "table" ? "" : "view-hidden"}`}><table className="company-table"><thead><tr><th>Company</th><th>Industry</th><th>Contacts</th><th>Drafts</th><th>Website</th><th>Action</th></tr></thead><tbody>{pagedCompanies.map((company) => {
                const website = fullWebsiteUrl(company.website);
                return <tr key={`row-${company.id}`}><td><strong>{company.name}</strong></td><td>{company.industry || "Pending verification"}</td><td>{company.contacts}</td><td>{company.drafts}</td><td>{website ? <a href={website} target="_blank" rel="noreferrer">{website}</a> : "—"}</td><td><div className="company-table-actions"><button type="button" onClick={() => setSelectedCompany(company)}>Contacts</button><button type="button" disabled={!control?.canManage} onClick={() => openCompanyEditor(company)}>Edit</button></div></td></tr>;
              })}</tbody></table></div>
              {!pagedCompanies.length && <div className="empty-state">No companies match your search.</div>}
              <div className="pagination">
                <span>{filteredCompanies.length ? `Showing ${(safeCompanyPage - 1) * companyPageSize + 1}–${Math.min(safeCompanyPage * companyPageSize, filteredCompanies.length)} of ${filteredCompanies.length} companies` : "0 companies"} · Page {safeCompanyPage} of {companyPages}</span>
                <div><button disabled={safeCompanyPage === 1} onClick={() => setCompanyPage(Math.max(1, safeCompanyPage - 1))}>Previous</button><button disabled={safeCompanyPage === companyPages} onClick={() => setCompanyPage(Math.min(companyPages, safeCompanyPage + 1))}>Next</button></div>
              </div>
            </section>
          )}

          {section === "activity" && (
            <section className="panel data-panel">
              <div className="panel-heading"><div><p className="eyebrow">Audit trail</p><h2>Recent activity</h2><span className="panel-subcopy">Every research, approval, scheduling, delivery, and data change is traceable.</span></div><div className="activity-controls"><label><span>Event type</span><select value={activityFilter} onChange={(event) => setActivityFilter(event.target.value)}><option value="all">All events</option>{activityTypes.map((type) => <option key={type} value={type}>{prettyStatus(type)}</option>)}</select></label><span>{filteredActivity.length} events</span></div></div>
              <div className="timeline">
                {filteredActivity.map((item, index) => <div className="timeline-item" key={`${item.id || item.createdAt}-${index}`}><span className="timeline-dot" /><div><strong>{prettyStatus(item.action)}</strong><p>{item.company || item.email || "System-wide operation"}</p><small>{new Date(item.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</small></div></div>)}
                {!filteredActivity.length && <div className="empty-state">No activity matches these filters.</div>}
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
                <label><span>Industry / business domain</span><input list="industry-domain-options" value={contactForm.industry} onChange={(event) => setContactForm({ ...contactForm, industry: event.target.value })} placeholder="Choose or type a company industry" /><small>This classification belongs to the company and is shared with every linked contact.</small></label>
                <label><span>Website</span><input type="url" value={contactForm.website} onChange={(event) => setContactForm({ ...contactForm, website: event.target.value })} placeholder="https://company.com" /></label>
                <label><span>Country</span><input value={contactForm.country} onChange={(event) => setContactForm({ ...contactForm, country: event.target.value })} placeholder="Example: India" /></label>
              </div>
              <div className="contact-editor-actions"><button type="button" className="quiet-action" onClick={() => setSelectedContact(null)}>Cancel</button><button className="primary-action" disabled={working}>{working ? "Saving…" : "Save to database"}</button></div>
            </form>
          </aside>
        </div>
      )}
      {selectedCompany && (
        <div className="drawer-backdrop" onMouseDown={() => setSelectedCompany(null)}>
          <aside className="company-contact-drawer" onMouseDown={(event) => event.stopPropagation()} aria-label={`${selectedCompany.name} contacts`} role="dialog" aria-modal="true">
            <div className="drawer-header">
              <div><p className="eyebrow">Company profile</p><h2>{selectedCompany.name}</h2><p>Every person below is linked to this company in the database.</p></div>
              <button type="button" onClick={() => setSelectedCompany(null)} aria-label="Close company profile">×</button>
            </div>
            <div className="company-profile-summary">
              <span><b>{displayContacts.filter((contact) => contact.companyId === selectedCompany.id).length}</b>Linked contacts</span>
              <span><b>{selectedCompany.drafts}</b>Generated emails</span>
              <span><b>{selectedCompany.industry || "Pending"}</b>Industry / domain</span>
              <span><b>{selectedCompany.country || "—"}</b>Country</span>
            </div>
            <div className="company-contact-list">
              <div className="company-contact-list-heading"><div><p className="eyebrow">People & email addresses</p><h3>{displayContacts.filter((contact) => contact.companyId === selectedCompany.id).length} contacts</h3></div></div>
              {displayContacts.filter((contact) => contact.companyId === selectedCompany.id).map((contact) => (
                <article key={contact.id}>
                  <div><strong>{contactDisplayName(contact)}</strong><a href={`mailto:${contact.email}`}>{contact.email}</a><small>{contact.role || "Role not added"} · {prettyStatus(contact.confidence)}</small></div>
                  <button type="button" disabled={!control?.canManage} onClick={() => { setSelectedCompany(null); openContactEditor(contact); }}>Edit</button>
                </article>
              ))}
              {!displayContacts.some((contact) => contact.companyId === selectedCompany.id) && <div className="empty-state">No contacts are linked to this company yet.</div>}
            </div>
            <div className="drawer-footer"><span>Company details are shared by all linked contacts.</span><div><button type="button" disabled={!control?.canManage} onClick={() => openCompanyEditor(selectedCompany)}>Edit company</button>{selectedCompany.website && <a className="company-website-url" href={fullWebsiteUrl(selectedCompany.website)} target="_blank" rel="noreferrer">{fullWebsiteUrl(selectedCompany.website)}</a>}</div></div>
          </aside>
        </div>
      )}
      {editingCompany && (
        <div className="drawer-backdrop contact-editor-backdrop" onMouseDown={() => setEditingCompany(null)}>
          <aside className="contact-editor company-editor" onMouseDown={(event) => event.stopPropagation()} aria-label="Edit company" role="dialog" aria-modal="true">
            <div className="drawer-header"><div><p className="eyebrow">Database company</p><h2>Edit company details</h2><p>Industry and organization changes automatically appear for every linked contact.</p></div><button type="button" onClick={() => setEditingCompany(null)} aria-label="Close company editor">×</button></div>
            <form className="contact-editor-form company-editor-form" onSubmit={(event) => { event.preventDefault(); saveCompany(); }}>
              <div className="contact-form-section"><div><strong>Organization</strong><span>Use verified information where available.</span></div>
                <label><span>Company or organization</span><input required value={companyForm.name} onChange={(event) => setCompanyForm({ ...companyForm, name: event.target.value })} /></label>
                <label><span>Industry / business domain</span><input list="industry-domain-options" value={companyForm.industry} onChange={(event) => setCompanyForm({ ...companyForm, industry: event.target.value })} placeholder="Choose or type an industry" /><small>You can select a standard category or enter a more specific one.</small></label>
                <label><span>Website</span><input type="url" value={companyForm.website} onChange={(event) => setCompanyForm({ ...companyForm, website: event.target.value })} placeholder="https://company.com" /></label>
                <label><span>Country</span><input value={companyForm.country} onChange={(event) => setCompanyForm({ ...companyForm, country: event.target.value })} placeholder="Example: India" /></label>
              </div>
              <div className="contact-editor-actions"><button type="button" className="quiet-action" onClick={() => setEditingCompany(null)}>Cancel</button><button className="primary-action" disabled={working}>{working ? "Saving…" : "Save company"}</button></div>
            </form>
          </aside>
        </div>
      )}
      <datalist id="industry-domain-options">
        {availableIndustries.map((industry) => <option value={industry} key={industry} />)}
      </datalist>
      {notice && <div className={`toast ${noticeTone}`} role={noticeTone === "error" ? "alert" : "status"}><span>{notice}</span><button onClick={() => setNotice("")} aria-label="Dismiss notification">×</button></div>}
    </div>
  );
}
