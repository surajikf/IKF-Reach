"use client";

import { useCallback, useEffect, useState } from "react";
import RichEmailEditor from "./rich-email-editor";

type StageDraft = { subject: string; html: string; delayMinutes: number };
type FollowupWorkspaceProps = {
  campaign: { id: string; name: string; sent?: number };
  canManage: boolean;
  zohoConnected: boolean;
  apiFetch: (url: string, init?: RequestInit) => Promise<Response>;
  onOpenControls: () => void;
  notify: (message: string, tone?: "success" | "error") => void;
};

const starterHtml = `<p>Dear {{name}},</p><p>I wanted to follow up on my earlier email to <strong>{{company}}</strong>.</p><p>Would it be useful to schedule a short discussion this week?</p><p>Regards,<br>Tanishka</p>`;

function localDateTime(iso?: string | null) {
  if (!iso) return "Not scheduled";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "Not scheduled" : date.toLocaleString("en-IN");
}

function sample(html: string, campaignName: string) {
  return html
    .replaceAll("{{name}}", "Suraj")
    .replaceAll("{{company}}", "Example Organisation")
    .replaceAll("{{campaign}}", campaignName)
    .replace(/\{\{[^{}]+\}\}/g, "")
    .replace(/\s+([,.;:])/g, "$1");
}

export default function FollowupWorkspace({ campaign, canManage, zohoConnected, apiFetch, onOpenControls, notify }: FollowupWorkspaceProps) {
  const [sequences, setSequences] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [name, setName] = useState(`${campaign.name} follow-up`);
  const [excludeReplied, setExcludeReplied] = useState(true);
  const [scheduleById, setScheduleById] = useState<Record<string, string>>({});
  const [stages, setStages] = useState<StageDraft[]>([{ subject: "Re: {{company}}", html: starterHtml, delayMinutes: 0 }]);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const response = await apiFetch(`/api/followups?campaignId=${encodeURIComponent(campaign.id)}`);
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Unable to load follow-ups.");
      setSequences(result.sequences || []);
    } catch (error) {
      if (!quiet) notify(error instanceof Error ? error.message : "Unable to load follow-ups.", "error");
    } finally {
      if (!quiet) setLoading(false);
    }
  // Parent helpers are recreated on dashboard renders; the campaign id is the
  // stable reload key for this workspace.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaign.id]);

  useEffect(() => {
    setName(`${campaign.name} follow-up`);
    setSequences([]);
    void load();
  }, [campaign.id, campaign.name, load]);

  useEffect(() => {
    const active = sequences.some((item) => ["scheduled", "running"].includes(item.status));
    if (!active) return;
    const timer = window.setInterval(() => void load(true), 5000);
    return () => window.clearInterval(timer);
  }, [load, sequences]);

  async function action(body: Record<string, any>, success: string) {
    setWorking(true);
    try {
      const response = await apiFetch("/api/followups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Follow-up action failed.");
      notify(success);
      await load(true);
      return result;
    } catch (error) {
      notify(error instanceof Error ? error.message : "Follow-up action failed.", "error");
      return null;
    } finally {
      setWorking(false);
    }
  }

  async function syncThreads() {
    const result = await action({ action: "sync_threads", campaignId: campaign.id, limit: 50 }, "Zoho thread check completed.");
    if (result) notify(`${result.matched} of ${result.checked} checked recipient${result.checked === 1 ? "" : "s"} matched an original Zoho message.`);
  }

  async function createSequence() {
    if (!name.trim() || stages.some((stage) => !stage.subject.trim() || !stage.html.trim())) {
      notify("Add a sequence name, subject, and message for every stage.", "error");
      return;
    }
    const result = await action({ action: "create", campaignId: campaign.id, name, excludeReplied, stages }, "Follow-up draft created. Nothing has been sent.");
    if (result) setComposerOpen(false);
  }

  function updateStage(index: number, patch: Partial<StageDraft>) {
    setStages((current) => current.map((stage, position) => position === index ? { ...stage, ...patch } : stage));
  }

  return <section className="followup-workspace">
    <article className="panel followup-readiness">
      <div>
        <p className="eyebrow">Zoho threaded follow-up</p>
        <h2>Create a follow-up in the original email trail</h2>
        <p>Spark uses only confirmed delivered recipients and requires a saved Zoho message ID before a reply can enter the original thread.</p>
        <p className="section-helper">Only original messages available in the connected Zoho mailbox can become native thread replies. Brevo-only originals stay safely excluded.</p>
      </div>
      <div className={`followup-connection ${zohoConnected ? "connected" : "missing"}`}>
        <strong>{zohoConnected ? "Zoho Mail connected" : "Zoho Mail needs attention"}</strong>
        <span>{zohoConnected ? "Thread lookup and reply delivery are available." : "Connect Tanishka’s mailbox before preparing a threaded sequence."}</span>
        {!zohoConnected && <button onClick={onOpenControls}>Open Controls & APIs</button>}
      </div>
    </article>

    <article className="panel followup-guardrails">
      <div><span>Included</span><strong>Confirmed delivered recipients</strong></div>
      <div><span>Always excluded</span><strong>Hard bounce · Unsubscribed · Suppressed</strong></div>
      <label><input type="checkbox" checked={excludeReplied} onChange={(event) => setExcludeReplied(event.target.checked)} /><span>Exclude recipients who already replied</span></label>
      <button disabled={!canManage || !zohoConnected || working} onClick={syncThreads}>{working ? "Checking…" : "Sync original Zoho threads"}</button>
    </article>

    <div className="followup-heading-row">
      <div><p className="eyebrow">Sequences</p><h2>{sequences.length} follow-up {sequences.length === 1 ? "sequence" : "sequences"}</h2></div>
      <button className="primary-action" disabled={!canManage || !zohoConnected || working} onClick={() => setComposerOpen((value) => !value)}>{composerOpen ? "Close composer" : "Create follow-up"}</button>
    </div>

    {composerOpen && <article className="panel followup-composer">
      <div className="panel-heading"><div><p className="eyebrow">Draft sequence</p><h2>Compose and preview</h2><p className="section-helper">Nothing is sent until the sequence is approved.</p></div></div>
      <label className="followup-name"><span>Sequence name</span><input value={name} onChange={(event) => setName(event.target.value)} /></label>
      <div className="followup-stage-list">
        {stages.map((stage, index) => <section className="followup-stage" key={index}>
          <div className="followup-stage-title"><span>{index + 1}</span><div><strong>{index === 0 ? "First follow-up" : `Drip stage ${index + 1}`}</strong><small>{index === 0 ? "Starts at the approved time." : `Wait ${stage.delayMinutes} minute${stage.delayMinutes === 1 ? "" : "s"} after the previous stage.`}</small></div>{stages.length > 1 && <button onClick={() => setStages((current) => current.filter((_, position) => position !== index))}>Remove</button>}</div>
          <div className="followup-stage-grid">
            <div>
              <label><span>Subject</span><input value={stage.subject} onChange={(event) => updateStage(index, { subject: event.target.value })} /></label>
              {index > 0 && <label><span>Gap after previous stage</span><div className="followup-gap"><input type="number" min={1} value={stage.delayMinutes} onChange={(event) => updateStage(index, { delayMinutes: Math.max(1, Number(event.target.value || 1)) })} /><span>minutes</span></div></label>}
              <RichEmailEditor value={stage.html} onChange={(html) => updateStage(index, { html })} disabled={working} />
            </div>
            <aside><p className="eyebrow">Personalization preview</p><strong>{sample(stage.subject, campaign.name)}</strong><div dangerouslySetInnerHTML={{ __html: sample(stage.html, campaign.name) }} /></aside>
          </div>
        </section>)}
      </div>
      <div className="followup-composer-actions"><button onClick={() => setStages((current) => [...current, { subject: "Re: {{company}}", html: starterHtml, delayMinutes: 1440 }])}>+ Add drip stage</button><button className="primary-action" disabled={working || !canManage || !zohoConnected} onClick={createSequence}>{working ? "Creating…" : "Save follow-up draft"}</button></div>
    </article>}

    {loading ? <article className="panel followup-loading"><i /><div><strong>Loading follow-up workspace</strong><span>Checking sequences, eligible recipients, and Zoho thread references.</span></div></article> : sequences.length === 0 ? <article className="panel empty-state">No follow-up sequence exists for this campaign yet. Sync Zoho threads, then create the first draft.</article> : <div className="followup-sequence-list">
      {sequences.map((sequence) => {
        const statusCounts = (sequence.recipients || []).reduce((counts: Record<string, number>, recipient: any) => ({ ...counts, [recipient.status]: (counts[recipient.status] || 0) + 1 }), {});
        const exclusionCounts = (sequence.recipients || []).reduce((counts: Record<string, number>, recipient: any) => {
          if (recipient.exclusion_reason) counts[recipient.exclusion_reason] = (counts[recipient.exclusion_reason] || 0) + 1;
          return counts;
        }, {});
        const progressed = (statusCounts.completed || 0) + (statusCounts.failed || 0) + (statusCounts.replied || 0);
        const progress = Math.round(progressed / Math.max(1, Number(sequence.eligible_recipients || 0)) * 100);
        return <article className="panel followup-sequence" key={sequence.id}>
          <div className="followup-sequence-head"><div><p className="eyebrow">{sequence.stages?.length || 0} stage drip</p><h2>{sequence.name}</h2><span>Created {localDateTime(sequence.created_at)}</span></div><span className={`followup-status ${sequence.status}`}>{sequence.status}</span></div>
          <div className="followup-progress"><span><strong>{progress}% complete</strong><small>{progressed} of {sequence.eligible_recipients} recipients finished</small></span><i><b style={{ width: `${Math.min(100, progress)}%` }} /></i></div>
          <div className="followup-metrics"><span><b>{sequence.eligible_recipients}</b>Eligible</span><span><b>{sequence.excluded_recipients}</b>Excluded</span><span><b>{statusCounts.completed || 0}</b>Completed</span><span><b>{statusCounts.failed || 0}</b>Failed</span><span><b>{statusCounts.replied || 0}</b>Replied</span></div>
          <div className="followup-stage-summary">{(sequence.stages || []).map((stage: any) => <span key={stage.id}><b>{stage.position}</b><strong>{stage.subject}</strong><small>{stage.position === 1 ? "Initial follow-up" : `${stage.delay_minutes} minute gap`}</small></span>)}</div>
          {sequence.status === "draft" && <div className="followup-approval">
            <label><span>Send now or schedule</span><input type="datetime-local" value={scheduleById[sequence.id] || ""} onChange={(event) => setScheduleById((current) => ({ ...current, [sequence.id]: event.target.value }))} /><small>Leave blank to start now after approval.</small></label>
            <button disabled={working || !canManage || sequence.eligible_recipients < 1} onClick={() => action({ action: "approve", sequenceId: sequence.id, scheduledFor: scheduleById[sequence.id] ? new Date(scheduleById[sequence.id]).toISOString() : null }, scheduleById[sequence.id] ? "Follow-up sequence scheduled." : "Follow-up sequence approved and queued.")}>{scheduleById[sequence.id] ? "Approve & schedule" : "Approve & send now"}</button>
          </div>}
          {["scheduled", "running"].includes(sequence.status) && <div className="followup-live"><div><strong>Background delivery is active</strong><span>Next due emails continue through Zoho after this browser is closed.</span></div><button disabled={working || !canManage} onClick={() => action({ action: "stop", sequenceId: sequence.id }, "Follow-up sequence stopped. Unsent stages will not run.")}>Stop sequence</button></div>}
          <details><summary>View recipients, exclusions, and activity</summary><div className="followup-detail-grid"><div><strong>Exclusion reasons</strong>{Object.entries(exclusionCounts).length ? Object.entries(exclusionCounts).map(([reason, count]) => <span key={reason}>{reason.replaceAll("_", " ")} <b>{Number(count)}</b></span>) : <span>No exclusions</span>}</div><div><strong>Recent activity</strong>{(sequence.events || []).length ? (sequence.events || []).slice(0, 8).map((event: any) => <span key={event.id}>{event.event.replaceAll("_", " ")} <small>{localDateTime(event.created_at)}</small></span>) : <span>No delivery events yet</span>}</div><div className="followup-recipient-results"><strong>Recipient results</strong>{(sequence.recipients || []).slice(0, 12).map((recipient: any) => <span key={recipient.id}><span>{recipient.recipient_email}<small>{recipient.last_error || recipient.exclusion_reason?.replaceAll("_", " ") || `Stage ${recipient.current_stage || 0}`}</small></span><b>{recipient.status}</b></span>)}</div></div></details>
        </article>;
      })}
    </div>}
  </section>;
}
