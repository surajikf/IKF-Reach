"use client";

import { useEffect, useMemo, useState } from "react";

type EmailPreview = { id: string; html: string; subject: string; recipient: string; campaign: string };
type AnalyticsCampaign = { id: string; name: string; status: string; senderName?: string; senderEmail?: string; createdAt?: string };
type AnalyticsEvent = {
  key: string;
  event: string;
  date: string;
  messageId: string;
  campaignId: string | null;
  campaignName: string;
  generatedEmailId: string | null;
  emailSendId: string | null;
  recipient: string;
  sender: string;
  subject: string;
  ip: string;
  link: string;
  reason: string;
  tag: string;
  source: string;
};
type StatisticsPayload = {
  ok: boolean;
  range?: { startDate: string; endDate: string; maximumDays: number };
  provider?: { connected: boolean; warning?: string | null; lastSyncedAt: string };
  campaigns?: AnalyticsCampaign[];
  events?: AnalyticsEvent[];
  coverage?: { liveBrevoEvents: number; storedWebhookEvents: number; matchedOutreachEvents: number };
  error?: string;
};
type ReportTab = "overview" | "deliverability" | "opens" | "clicks" | "recipients" | "domains" | "insights";

const openEvents = new Set(["opened", "uniqueOpened", "loadedByProxy"]);
const clickEvents = new Set(["click"]);
const bounceEvents = new Set(["softBounce", "hardBounce", "invalid", "error"]);
const eventNames: Record<string, string> = {
  sent: "Sent",
  scheduled: "Scheduled",
  delivered: "Delivered",
  opened: "Opened",
  uniqueOpened: "First opening",
  loadedByProxy: "Proxy open",
  click: "Clicked",
  deferred: "Deferred",
  softBounce: "Soft bounce",
  hardBounce: "Hard bounce",
  blocked: "Blocked",
  invalid: "Invalid",
  error: "Error",
  spam: "Spam complaint",
  unsubscribed: "Unsubscribed",
};

function dateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

function presetRange(preset: string, customStart: string, customEnd: string) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (preset === "custom") {
    return {
      start: new Date(`${customStart}T00:00:00`),
      end: new Date(`${customEnd}T23:59:59.999`),
    };
  }
  if (preset === "yesterday") {
    const yesterday = new Date(today.getTime() - 86_400_000);
    return { start: yesterday, end: new Date(yesterday.getTime() + 86_399_999) };
  }
  const days = preset === "today" ? 1 : Number(preset || 7);
  return { start: new Date(today.getTime() - (days - 1) * 86_400_000), end: new Date(today.getTime() + 86_399_999) };
}

function messageKey(event: AnalyticsEvent) {
  return event.generatedEmailId || event.messageId || `${event.recipient}|${event.subject}`;
}

function uniqueMessages(events: AnalyticsEvent[]) {
  return new Set(events.map(messageKey)).size;
}

function percentage(value: number, base: number) {
  return base ? (value / base) * 100 : 0;
}

function prettyPercent(value: number) {
  return `${value.toFixed(value >= 10 ? 1 : 2)}%`;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function eventTone(event: string) {
  if (event === "delivered" || openEvents.has(event) || event === "click") return "positive";
  if (bounceEvents.has(event) || ["blocked", "spam", "unsubscribed"].includes(event)) return "negative";
  if (event === "deferred" || event === "scheduled") return "warning";
  return "neutral";
}

export default function StatisticsDashboard({ emails }: { emails: EmailPreview[] }) {
  const [data, setData] = useState<StatisticsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [preset, setPreset] = useState("7");
  const [customStart, setCustomStart] = useState(dateInput(new Date(Date.now() - 6 * 86_400_000)));
  const [customEnd, setCustomEnd] = useState(dateInput(new Date()));
  const [campaignId, setCampaignId] = useState("all");
  const [sender, setSender] = useState("all");
  const [campaignStatus, setCampaignStatus] = useState("all");
  const [campaignType, setCampaignType] = useState("all");
  const [tag, setTag] = useState("all");
  const [eventFilter, setEventFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<ReportTab>("overview");
  const [selectedEvent, setSelectedEvent] = useState<AnalyticsEvent | null>(null);

  async function loadStatistics() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/statistics?days=90", { cache: "no-store" });
      const result = await response.json() as StatisticsPayload;
      if (!response.ok || !result.ok) throw new Error(result.error || "Statistics could not be loaded.");
      setData(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Statistics could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadStatistics();
  }, []);

  const range = useMemo(() => presetRange(preset, customStart, customEnd), [preset, customStart, customEnd]);
  const senders = useMemo(() => [...new Set((data?.events || []).map((event) => event.sender).filter(Boolean))].sort(), [data]);
  const statuses = useMemo(() => [...new Set((data?.campaigns || []).map((campaign) => campaign.status).filter(Boolean))].sort(), [data]);
  const tags = useMemo(() => [...new Set((data?.events || []).map((event) => event.tag).filter(Boolean))].sort(), [data]);
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const campaignStatuses = new Map((data?.campaigns || []).map((campaign) => [campaign.id, campaign.status]));
    return (data?.events || []).filter((event) => {
      const time = new Date(event.date).getTime();
      return time >= range.start.getTime() && time <= range.end.getTime()
        && (campaignId === "all" || event.campaignId === campaignId)
        && (sender === "all" || event.sender === sender)
        && (campaignStatus === "all" || campaignStatuses.get(event.campaignId || "") === campaignStatus)
        && (campaignType === "all" || campaignType === "transactional")
        && (tag === "all" || event.tag === tag)
        && (eventFilter === "all" || event.event === eventFilter)
        && (!term || `${event.recipient} ${event.subject} ${event.campaignName}`.toLowerCase().includes(term));
    });
  }, [data, range, campaignId, sender, campaignStatus, campaignType, tag, eventFilter, search]);

  const metrics = useMemo(() => {
    const byType = (types: Set<string> | string[]) => filtered.filter((event) => types instanceof Set ? types.has(event.event) : types.includes(event.event));
    const sent = uniqueMessages(byType(["sent"]));
    const delivered = uniqueMessages(byType(["delivered"]));
    const openRows = byType(openEvents);
    const clickRows = byType(clickEvents);
    const uniqueOpens = uniqueMessages(openRows);
    const uniqueClicks = uniqueMessages(clickRows);
    const softBounces = uniqueMessages(byType(["softBounce"]));
    const hardBounces = uniqueMessages(byType(["hardBounce", "invalid", "error"]));
    return {
      sent,
      delivered,
      totalOpens: openRows.length,
      uniqueOpens,
      totalClicks: clickRows.length,
      uniqueClicks,
      softBounces,
      hardBounces,
      deferred: uniqueMessages(byType(["deferred"])),
      blocked: uniqueMessages(byType(["blocked"])),
      complaints: uniqueMessages(byType(["spam"])),
      unsubscribed: uniqueMessages(byType(["unsubscribed"])),
      deliveryRate: percentage(delivered, sent),
      openRate: percentage(uniqueOpens, delivered),
      clickRate: percentage(uniqueClicks, delivered),
      ctor: percentage(uniqueClicks, uniqueOpens),
    };
  }, [filtered]);

  const campaignOverview = useMemo(() => {
    const campaign = (data?.campaigns || []).find((item) => item.id === campaignId);
    const campaignEvents = campaignId === "all" ? filtered : filtered.filter((event) => event.campaignId === campaignId);
    const subjects = [...new Set(campaignEvents.map((event) => event.subject).filter(Boolean))];
    const scheduled = campaignEvents.filter((event) => event.event === "scheduled").map((event) => event.date).sort()[0];
    const sent = campaignEvents.filter((event) => event.event === "sent").map((event) => event.date).sort()[0];
    return {
      name: campaign?.name || "All outreach campaigns",
      subject: campaignId === "all" ? `${subjects.length} subject lines` : subjects[0] || "No sent subject available",
      sender: campaign ? `${campaign.senderName || "Sender"} <${campaign.senderEmail || "—"}>` : `${senders.length} senders`,
      type: "Transactional outreach",
      created: campaign?.createdAt || "",
      scheduled: scheduled || "",
      sent: sent || "",
      status: campaign?.status || "Portfolio",
      recipients: new Set(campaignEvents.map((event) => event.recipient).filter(Boolean)).size,
    };
  }, [data, campaignId, filtered, senders.length]);

  const trend = useMemo(() => {
    const days = new Map<string, { date: string; sent: number; delivered: number; opened: number; clicked: number; bounced: number }>();
    for (let cursor = new Date(range.start); cursor <= range.end; cursor = new Date(cursor.getTime() + 86_400_000)) {
      const key = dateInput(cursor);
      days.set(key, { date: key, sent: 0, delivered: 0, opened: 0, clicked: 0, bounced: 0 });
    }
    for (const event of filtered) {
      const key = dateInput(new Date(event.date));
      const row = days.get(key);
      if (!row) continue;
      if (event.event === "sent") row.sent += 1;
      if (event.event === "delivered") row.delivered += 1;
      if (openEvents.has(event.event)) row.opened += 1;
      if (clickEvents.has(event.event)) row.clicked += 1;
      if (bounceEvents.has(event.event)) row.bounced += 1;
    }
    return [...days.values()];
  }, [filtered, range]);

  const maxTrend = Math.max(1, ...trend.flatMap((day) => [day.sent, day.delivered, day.opened, day.clicked]));
  const domains = useMemo(() => {
    const groups = new Map<string, AnalyticsEvent[]>();
    for (const event of filtered) {
      const domain = event.recipient.split("@")[1] || "unknown";
      groups.set(domain, [...(groups.get(domain) || []), event]);
    }
    return [...groups.entries()].map(([domain, rows]) => {
      const sent = uniqueMessages(rows.filter((event) => event.event === "sent"));
      const delivered = uniqueMessages(rows.filter((event) => event.event === "delivered"));
      const opened = uniqueMessages(rows.filter((event) => openEvents.has(event.event)));
      const clicked = uniqueMessages(rows.filter((event) => clickEvents.has(event.event)));
      const bounced = uniqueMessages(rows.filter((event) => bounceEvents.has(event.event)));
      return { domain, sent, delivered, opened, clicked, bounced, deliveryRate: percentage(delivered, sent), openRate: percentage(opened, delivered), ctr: percentage(clicked, delivered) };
    }).sort((a, b) => b.sent - a.sent);
  }, [filtered]);

  const links = useMemo(() => {
    const groups = new Map<string, AnalyticsEvent[]>();
    for (const event of filtered.filter((item) => item.event === "click" && item.link)) {
      groups.set(event.link, [...(groups.get(event.link) || []), event]);
    }
    return [...groups.entries()].map(([link, rows]) => ({
      link,
      total: rows.length,
      unique: uniqueMessages(rows),
      ctr: percentage(uniqueMessages(rows), metrics.delivered),
    })).sort((a, b) => b.total - a.total);
  }, [filtered, metrics.delivered]);

  const recipients = useMemo(() => {
    const groups = new Map<string, AnalyticsEvent[]>();
    for (const event of filtered) groups.set(event.recipient, [...(groups.get(event.recipient) || []), event]);
    return [...groups.entries()].map(([recipient, rows]) => ({
      recipient,
      campaign: rows[0]?.campaignName || "",
      subject: rows[0]?.subject || "",
      latest: rows[0]?.date || "",
      events: rows,
      score: Math.min(100, (rows.some((event) => event.event === "delivered") ? 15 : 0)
        + Math.min(40, rows.filter((event) => openEvents.has(event.event)).length * 10)
        + Math.min(45, rows.filter((event) => event.event === "click").length * 15)),
    })).sort((a, b) => b.latest.localeCompare(a.latest));
  }, [filtered]);

  const selectedTimeline = useMemo(() => {
    if (!selectedEvent) return [];
    return (data?.events || []).filter((event) =>
      (selectedEvent.messageId && event.messageId === selectedEvent.messageId)
      || (selectedEvent.generatedEmailId && event.generatedEmailId === selectedEvent.generatedEmailId),
    ).sort((a, b) => a.date.localeCompare(b.date));
  }, [data, selectedEvent]);
  const selectedPreview = selectedEvent ? emails.find((email) => email.id === selectedEvent.generatedEmailId) : undefined;

  const bestHour = useMemo(() => {
    const counts = new Map<number, number>();
    for (const event of filtered.filter((item) => openEvents.has(item.event))) {
      const hour = new Date(event.date).getHours();
      counts.set(hour, (counts.get(hour) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  }, [filtered]);

  function exportCsv() {
    const rows = [
      ["Date", "Event", "Campaign", "Recipient", "Sender", "Subject", "Link", "Reason", "Message ID"],
      ...filtered.map((event) => [event.date, eventNames[event.event] || event.event, event.campaignName, event.recipient, event.sender, event.subject, event.link, event.reason, event.messageId]),
    ];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell || "").replaceAll("\"", "\"\"")}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `ikf-outreach-statistics-${dateInput(range.start)}-${dateInput(range.end)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function exportExcel() {
    const rows = [
      ["Date", "Event", "Campaign", "Recipient", "Sender", "Subject", "Tag", "Link", "Reason", "Message ID"],
      ...filtered.map((event) => [event.date, eventNames[event.event] || event.event, event.campaignName, event.recipient, event.sender, event.subject, event.tag, event.link, event.reason, event.messageId]),
    ];
    const tsv = rows.map((row) => row.map((cell) => String(cell || "").replaceAll("\t", " ").replaceAll("\r", " ").replaceAll("\n", " ")).join("\t")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF", tsv], { type: "application/vnd.ms-excel;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `ikf-outreach-statistics-${dateInput(range.start)}-${dateInput(range.end)}.xls`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  if (loading && !data) return <section className="panel statistics-loading"><span className="statistics-spinner" /><h2>Loading Brevo statistics</h2><p>Matching delivery events to IKF campaigns and recipients…</p></section>;

  return (
    <div className="statistics-module">
      <section className="statistics-hero">
        <div><p className="eyebrow">Brevo campaign intelligence</p><h2>Campaign Statistics</h2><p>Delivery, engagement, recipient, domain, and event-level reporting for every IKF outreach campaign.</p></div>
        <div className="statistics-hero-actions"><button onClick={loadStatistics} disabled={loading}>{loading ? "Refreshing…" : "Refresh Brevo data"}</button><button onClick={exportCsv} disabled={!filtered.length}>Export CSV</button><button onClick={exportExcel} disabled={!filtered.length}>Export Excel</button><button onClick={() => window.print()}>Save PDF</button></div>
      </section>

      {error && <div className="statistics-alert error"><strong>Statistics unavailable</strong><span>{error}</span></div>}
      {data?.provider?.warning && <div className="statistics-alert warning"><strong>Brevo live sync needs attention</strong><span>{data.provider.warning} Stored events and database delivery records remain visible.</span></div>}

      <section className="statistics-filter-panel" aria-label="Statistics filters">
        <label><span>Date range</span><select value={preset} onChange={(event) => setPreset(event.target.value)}><option value="today">Today</option><option value="yesterday">Yesterday</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="custom">Custom range</option></select></label>
        {preset === "custom" && <><label><span>From</span><input type="date" value={customStart} max={customEnd} onChange={(event) => setCustomStart(event.target.value)} /></label><label><span>To</span><input type="date" value={customEnd} min={customStart} max={dateInput(new Date())} onChange={(event) => setCustomEnd(event.target.value)} /></label></>}
        <label><span>Campaign</span><select value={campaignId} onChange={(event) => setCampaignId(event.target.value)}><option value="all">All campaigns</option>{(data?.campaigns || []).map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select></label>
        <label><span>Sender</span><select value={sender} onChange={(event) => setSender(event.target.value)}><option value="all">All senders</option>{senders.map((email) => <option key={email} value={email}>{email}</option>)}</select></label>
        <label><span>Campaign type</span><select value={campaignType} onChange={(event) => setCampaignType(event.target.value)}><option value="all">All campaign types</option><option value="transactional">Transactional outreach</option></select></label>
        <label><span>Status</span><select value={campaignStatus} onChange={(event) => setCampaignStatus(event.target.value)}><option value="all">All statuses</option>{statuses.map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}</select></label>
        <label><span>Tag</span><select value={tag} onChange={(event) => setTag(event.target.value)}><option value="all">All tags</option>{tags.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        <label><span>Event</span><select value={eventFilter} onChange={(event) => setEventFilter(event.target.value)}><option value="all">All events</option>{Object.entries(eventNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="statistics-search"><span>Email or subject</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search recipient, subject, or campaign" /></label>
      </section>

      <section className="statistics-campaign-overview">
        <div><span>Campaign name</span><strong>{campaignOverview.name}</strong></div>
        <div><span>Subject line</span><strong>{campaignOverview.subject}</strong></div>
        <div><span>Sender</span><strong>{campaignOverview.sender}</strong></div>
        <div><span>Campaign type</span><strong>{campaignOverview.type}</strong></div>
        <div><span>Created</span><strong>{campaignOverview.created ? formatDateTime(campaignOverview.created) : "—"}</strong></div>
        <div><span>Scheduled</span><strong>{campaignOverview.scheduled ? formatDateTime(campaignOverview.scheduled) : "—"}</strong></div>
        <div><span>First sent</span><strong>{campaignOverview.sent ? formatDateTime(campaignOverview.sent) : "—"}</strong></div>
        <div><span>Status</span><strong>{campaignOverview.status.replaceAll("_", " ")}</strong></div>
        <div><span>Total recipients</span><strong>{campaignOverview.recipients.toLocaleString("en-IN")}</strong></div>
      </section>

      <section className="statistics-kpis">
        <StatCard label="Sent" value={metrics.sent} note="Emails attempted" tone="purple" />
        <StatCard label="Delivered" value={metrics.delivered} note={`${prettyPercent(metrics.deliveryRate)} delivery rate`} tone="blue" />
        <StatCard label="Unique opens" value={metrics.uniqueOpens} note={`${prettyPercent(metrics.openRate)} open rate · ${metrics.totalOpens} total`} tone="green" />
        <StatCard label="Unique clicks" value={metrics.uniqueClicks} note={`${prettyPercent(metrics.clickRate)} CTR · ${metrics.totalClicks} total`} tone="teal" />
        <StatCard label="CTOR" value={prettyPercent(metrics.ctor)} note="Unique clicks ÷ unique opens" tone="indigo" />
        <StatCard label="Bounces" value={metrics.softBounces + metrics.hardBounces} note={`${metrics.softBounces} soft · ${metrics.hardBounces} hard`} tone="red" />
        <StatCard label="Blocked / deferred" value={metrics.blocked + metrics.deferred} note={`${metrics.blocked} blocked · ${metrics.deferred} deferred`} tone="orange" />
        <StatCard label="Complaints / unsubscribed" value={metrics.complaints + metrics.unsubscribed} note={`${metrics.complaints} spam · ${metrics.unsubscribed} unsubscribed`} tone="rose" />
      </section>

      <nav className="statistics-tabs" aria-label="Campaign report sections">
        {([["overview", "Overview"], ["deliverability", "Deliverability"], ["opens", "Opens"], ["clicks", "Click analytics"], ["recipients", "Recipient activity"], ["domains", "Domains"], ["insights", "AI insights"]] as Array<[ReportTab, string]>).map(([value, label]) => <button key={value} className={tab === value ? "active" : ""} onClick={() => setTab(value)}>{label}</button>)}
      </nav>

      {tab === "overview" && <div className="statistics-grid">
        <section className="panel statistics-chart wide">
          <div className="statistics-section-heading"><div><p className="eyebrow">Engagement timeline</p><h3>Campaign activity by day</h3></div><span>{formatDateTime(range.start.toISOString())} – {formatDateTime(range.end.toISOString())}</span></div>
          <div className="trend-chart" aria-label="Daily email activity chart">{trend.map((day) => <div className="trend-day" key={day.date} title={`${day.date}: ${day.sent} sent, ${day.delivered} delivered, ${day.opened} opens, ${day.clicked} clicks`}><div className="trend-bars"><i className="sent" style={{ height: `${Math.max(day.sent ? 6 : 0, day.sent / maxTrend * 100)}%` }} /><i className="delivered" style={{ height: `${Math.max(day.delivered ? 6 : 0, day.delivered / maxTrend * 100)}%` }} /><i className="opened" style={{ height: `${Math.max(day.opened ? 6 : 0, day.opened / maxTrend * 100)}%` }} /><i className="clicked" style={{ height: `${Math.max(day.clicked ? 6 : 0, day.clicked / maxTrend * 100)}%` }} /></div><small>{new Date(`${day.date}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</small></div>)}</div>
          <div className="chart-legend"><span><i className="sent" />Sent</span><span><i className="delivered" />Delivered</span><span><i className="opened" />Opens</span><span><i className="clicked" />Clicks</span></div>
        </section>
        <section className="panel delivery-funnel">
          <div className="statistics-section-heading"><div><p className="eyebrow">Delivery funnel</p><h3>Audience progression</h3></div></div>
          {[["Sent", metrics.sent, 100], ["Delivered", metrics.delivered, metrics.deliveryRate], ["Opened", metrics.uniqueOpens, percentage(metrics.uniqueOpens, metrics.sent)], ["Clicked", metrics.uniqueClicks, percentage(metrics.uniqueClicks, metrics.sent)], ["Replied", 0, 0]].map(([label, count, rate]) => <div className="funnel-row" key={String(label)}><span><strong>{label}</strong><small>{Number(count).toLocaleString("en-IN")} · {prettyPercent(Number(rate))}</small></span><i><b style={{ width: `${Math.min(100, Number(rate))}%` }} /></i></div>)}
          <p className="data-note">Reply tracking requires an inbound mailbox connection and is not currently available from Brevo transactional events.</p>
        </section>
        <section className="panel statistics-events wide">
          <EventTable events={filtered.slice(0, 100)} onOpen={setSelectedEvent} />
        </section>
      </div>}

      {tab === "deliverability" && <div className="statistics-grid">
        <section className="panel deliverability-breakdown"><div className="statistics-section-heading"><div><p className="eyebrow">Delivery outcomes</p><h3>Mail server response</h3></div></div>{[["Delivered", metrics.delivered, metrics.sent, "positive"], ["Deferred", metrics.deferred, metrics.sent, "warning"], ["Blocked", metrics.blocked, metrics.sent, "negative"], ["Soft bounce", metrics.softBounces, metrics.sent, "warning"], ["Hard bounce", metrics.hardBounces, metrics.sent, "negative"], ["Spam complaint", metrics.complaints, metrics.sent, "negative"]].map(([label, count, base, tone]) => <ProgressMetric key={String(label)} label={String(label)} count={Number(count)} rate={percentage(Number(count), Number(base))} tone={String(tone)} />)}</section>
        <section className="panel domain-health"><div className="statistics-section-heading"><div><p className="eyebrow">Smart domain health</p><h3>Recipient-domain deliverability</h3></div></div>{domains.slice(0, 8).map((domain) => <div key={domain.domain}><span><strong>{domain.domain}</strong><small>{domain.sent} sent</small></span><b className={domain.deliveryRate >= 95 ? "good" : domain.deliveryRate >= 85 ? "warning" : "bad"}>{domain.sent ? prettyPercent(domain.deliveryRate) : "—"}</b></div>)}</section>
      </div>}

      {tab === "opens" && <div className="statistics-grid">
        <section className="panel statistics-chart wide"><div className="statistics-section-heading"><div><p className="eyebrow">Open trend</p><h3>Daily engagement</h3></div><span>{metrics.uniqueOpens} unique · {metrics.totalOpens} total</span></div><div className="single-series-chart">{trend.map((day) => <div key={day.date}><i style={{ height: `${Math.max(day.opened ? 8 : 0, day.opened / maxTrend * 100)}%` }} /><small>{new Date(`${day.date}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</small></div>)}</div></section>
        <section className="panel unavailable-analytics"><p className="eyebrow">Client & device analytics</p><h3>Tracking source required</h3><p>Brevo’s transactional event report provides opens and IP addresses, but not reliable device, browser, operating-system, email-client, city, or country fields. These sections will activate when enriched webhook or tracking data is available.</p></section>
      </div>}

      {tab === "clicks" && <div className="statistics-grid">
        <section className="panel links-table wide"><div className="statistics-section-heading"><div><p className="eyebrow">Top-performing links</p><h3>Link performance</h3></div><span>{metrics.totalClicks} click events</span></div>{links.length ? <table><thead><tr><th>Link</th><th>Total clicks</th><th>Unique clicks</th><th>CTR</th></tr></thead><tbody>{links.map((link) => <tr key={link.link}><td><a href={link.link} target="_blank" rel="noreferrer">{link.link}</a></td><td>{link.total}</td><td>{link.unique}</td><td>{prettyPercent(link.ctr)}</td></tr>)}</tbody></table> : <div className="empty-analytics"><strong>No tracked link clicks in this range</strong><p>Links will appear when Brevo reports click events containing the destination URL.</p></div>}</section>
      </div>}

      {tab === "recipients" && <div className="statistics-grid">
        <section className="panel recipient-analytics wide"><div className="statistics-section-heading"><div><p className="eyebrow">Recipient activity</p><h3>Contact journeys</h3></div><span>{recipients.length} recipients</span></div><div className="recipient-table"><div className="recipient-table-head"><span>Recipient</span><span>Campaign</span><span>Latest event</span><span>Engagement</span></div>{recipients.map((recipient) => <button key={recipient.recipient} onClick={() => setSelectedEvent(recipient.events[0])}><span><strong>{recipient.recipient}</strong><small>{recipient.subject}</small></span><span>{recipient.campaign}</span><span>{formatDateTime(recipient.latest)}</span><span className="engagement-score"><i style={{ width: `${recipient.score}%` }} /><b>{recipient.score}</b></span></button>)}</div></section>
      </div>}

      {tab === "domains" && <div className="statistics-grid">
        <section className="panel links-table wide"><div className="statistics-section-heading"><div><p className="eyebrow">Domain analytics</p><h3>Performance by recipient domain</h3></div><span>{domains.length} domains</span></div><table><thead><tr><th>Domain</th><th>Sent</th><th>Delivered</th><th>Opened</th><th>Clicked</th><th>Bounces</th><th>Delivery</th><th>Open rate</th><th>CTR</th></tr></thead><tbody>{domains.map((domain) => <tr key={domain.domain}><td><strong>{domain.domain}</strong></td><td>{domain.sent}</td><td>{domain.delivered}</td><td>{domain.opened}</td><td>{domain.clicked}</td><td>{domain.bounced}</td><td>{domain.sent ? prettyPercent(domain.deliveryRate) : "—"}</td><td>{domain.delivered ? prettyPercent(domain.openRate) : "—"}</td><td>{domain.delivered ? prettyPercent(domain.ctr) : "—"}</td></tr>)}</tbody></table></section>
      </div>}

      {tab === "insights" && <div className="statistics-grid">
        <section className="panel ai-summary wide"><div className="statistics-section-heading"><div><p className="eyebrow">AI performance summary</p><h3>What the campaign data says</h3></div><span>Evidence-based</span></div><div className="insight-cards"><Insight title="Deliverability" value={metrics.sent ? `${prettyPercent(metrics.deliveryRate)} delivery rate` : "Not enough sent data"} text={metrics.deliveryRate >= 95 ? "Deliverability is healthy. Maintain the current sender identity and list hygiene." : metrics.sent ? "Review hard bounces, blocked events, and recipient quality before the next large send." : "Send activity will create a deliverability baseline."} /><Insight title="Engagement" value={metrics.delivered ? `${prettyPercent(metrics.openRate)} opens · ${prettyPercent(metrics.clickRate)} CTR` : "Waiting for delivery data"} text={metrics.uniqueClicks ? `Click-to-open rate is ${prettyPercent(metrics.ctor)}. Prioritize the links receiving genuine recipient engagement.` : "No tracked clicks are available in this range. Use one clear, measurable CTA in the next campaign."} /><Insight title="Best observed time" value={bestHour === undefined ? "Not enough opening data" : `${String(bestHour).padStart(2, "0")}:00–${String((bestHour + 1) % 24).padStart(2, "0")}:00`} text="This is calculated from observed open events in the selected filters, not a fabricated recommendation." /><Insight title="Data coverage" value={`${filtered.length.toLocaleString("en-IN")} matched events`} text={`${data?.coverage?.liveBrevoEvents || 0} Brevo events were checked and ${data?.coverage?.storedWebhookEvents || 0} durable webhook events are available for the selected 90-day source window.`} /></div></section>
        <section className="panel future-data-sources wide"><p className="eyebrow">Additional connections</p><h3>Metrics that need another source</h3><div><span><strong>Replies</strong><small>Connect the Reply-To mailbox or inbound email webhook.</small></span><span><strong>Conversions & revenue</strong><small>Add website/CRM conversion events and order values.</small></span><span><strong>Geography & devices</strong><small>Add enriched tracking fields; the standard event API does not supply them.</small></span><span><strong>Meetings & CRM journey</strong><small>Connect the booking tool and CRM activity feed.</small></span></div></section>
      </div>}

      {selectedEvent && <div className="analytics-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setSelectedEvent(null)}>
        <section className="analytics-modal" role="dialog" aria-modal="true" aria-label="Recipient event details">
          <header><div><p className="eyebrow">Recipient event history</p><h2>{selectedEvent.subject || selectedEvent.recipient}</h2></div><button onClick={() => setSelectedEvent(null)} aria-label="Close event details">×</button></header>
          <div className="analytics-modal-body">
            <article className="message-details"><h3>Message details</h3><dl><div><dt>Campaign</dt><dd>{selectedEvent.campaignName}</dd></div><div><dt>Recipient</dt><dd>{selectedEvent.recipient}</dd></div><div><dt>Sender</dt><dd>{selectedEvent.sender || "—"}</dd></div><div><dt>Message ID</dt><dd>{selectedEvent.messageId || "—"}</dd></div><div><dt>Latest event</dt><dd>{eventNames[selectedEvent.event] || selectedEvent.event} · {formatDateTime(selectedEvent.date)}</dd></div></dl>{selectedPreview ? <div className="analytics-email-preview" dangerouslySetInnerHTML={{ __html: selectedPreview.html }} /> : <div className="empty-analytics"><strong>Email preview unavailable</strong><p>The event is retained, but no matching generated-email body was found.</p></div>}</article>
            <article className="event-timeline"><h3>History</h3>{selectedTimeline.map((event) => <div key={event.key} className={eventTone(event.event)}><i /><span><strong>{eventNames[event.event] || event.event}</strong><small>{event.ip || event.reason || event.link || "Brevo event"}</small><time>{formatDateTime(event.date)}</time></span></div>)}</article>
          </div>
        </section>
      </div>}
    </div>
  );
}

function StatCard({ label, value, note, tone }: { label: string; value: number | string; note: string; tone: string }) {
  return <article className={`statistics-kpi ${tone}`}><span>{label}</span><strong>{typeof value === "number" ? value.toLocaleString("en-IN") : value}</strong><small>{note}</small></article>;
}

function ProgressMetric({ label, count, rate, tone }: { label: string; count: number; rate: number; tone: string }) {
  return <div className={`progress-metric ${tone}`}><span><strong>{label}</strong><small>{count.toLocaleString("en-IN")} · {prettyPercent(rate)}</small></span><i><b style={{ width: `${Math.min(100, rate)}%` }} /></i></div>;
}

function EventTable({ events, onOpen }: { events: AnalyticsEvent[]; onOpen: (event: AnalyticsEvent) => void }) {
  return <><div className="statistics-section-heading"><div><p className="eyebrow">Event log</p><h3>Messages and activity</h3></div><span>Showing {events.length} latest matched events</span></div><div className="analytics-event-table"><div className="analytics-event-head"><span>Event</span><span>Date</span><span>Subject</span><span>From</span><span>To</span><span>Campaign</span></div>{events.map((event) => <button key={event.key} onClick={() => onOpen(event)}><span><i className={eventTone(event.event)} />{eventNames[event.event] || event.event}</span><span>{formatDateTime(event.date)}</span><span><strong>{event.subject || "No subject"}</strong></span><span>{event.sender || "—"}</span><span>{event.recipient}</span><span>{event.campaignName}</span></button>)}</div>{!events.length && <div className="empty-analytics"><strong>No events match these filters</strong><p>Try a wider date range, another campaign, or clear the email search.</p></div>}</>;
}

function Insight({ title, value, text }: { title: string; value: string; text: string }) {
  return <article><span>{title}</span><strong>{value}</strong><p>{text}</p></article>;
}
