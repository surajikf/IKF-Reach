import { NextRequest, NextResponse } from "next/server";
import { getQueueDb } from "../../../db";

export const dynamic = "force-dynamic";

async function runBackgroundCampaignBatch(
  requestUrl: string,
  jobId: string,
  token: string,
  refreshDrafts: boolean,
) {
  const controlUrl = new URL("/api/control", requestUrl);
  const workerHeaders = {
    "Content-Type": "application/json",
    "x-ikf-background-job": jobId,
    ...(token ? { "x-ikf-background-token": token } : {}),
  };
  const body = JSON.stringify({ action: "process_background_campaign", jobId, refreshDrafts });
  const response = await fetch(controlUrl, { method: "POST", headers: workerHeaders, body });
  if (!response.ok) {
    const retry = await fetch(controlUrl, { method: "POST", headers: workerHeaders, body });
    if (!retry.ok) return { remaining: 0 };
    return (await retry.json()) as { remaining?: number };
  }
  return (await response.json()) as { remaining?: number };
}

async function kickNextBackgroundBatch(requestUrl: string, jobId: string, token: string) {
  const workerHeaders = {
    "Content-Type": "application/json",
    "x-ikf-background-job": jobId,
    ...(token ? { "x-ikf-background-token": token } : {}),
  };
  await fetch(new URL("/api/background-campaign", requestUrl), {
    method: "POST",
    headers: workerHeaders,
    body: JSON.stringify({ jobId, refreshDrafts: false }),
  }).catch(() => {});
}

export async function POST(req: NextRequest) {
  let body: { jobId?: string; refreshDrafts?: boolean; retryFailed?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid background campaign request." }, { status: 400 });
  }
  const jobId = String(body.jobId || "");
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) {
    return NextResponse.json({ ok: false, error: "A valid campaign job is required." }, { status: 400 });
  }

  const queueDb = getQueueDb();
  let existingJob = await queueDb.prepare(`
    SELECT status, failed_items AS failedItems
    FROM background_research_jobs
    WHERE id = ?
    LIMIT 1
  `).bind(jobId).first<{ status: string; failedItems: number }>();
  if (!existingJob) {
    return NextResponse.json({ ok: false, error: "Background campaign job not found." }, { status: 404 });
  }

  if (
    body.retryFailed === true
    && ["completed_with_issues", "failed"].includes(String(existingJob.status))
    && Number(existingJob.failedItems || 0) > 0
  ) {
    const retryStartedAt = new Date().toISOString();
    await queueDb.batch([
      queueDb.prepare(`
        UPDATE background_research_items
        SET status = 'queued',
            attempts = 1,
            claimed_by = NULL,
            error = CASE
              WHEN error IS NULL THEN 'Queued for the final automatic retry.'
              ELSE error || ' Final automatic retry queued.'
            END,
            updated_at = ?
        WHERE job_id = ? AND status = 'failed'
      `).bind(retryStartedAt, jobId),
      queueDb.prepare(`
        UPDATE background_research_jobs
        SET status = 'researching',
            failed_items = 0,
            completed_at = NULL,
            last_error = NULL,
            updated_at = ?
        WHERE id = ?
      `).bind(retryStartedAt, jobId),
    ]);
    existingJob = { ...existingJob, status: "researching", failedItems: 0 };
  }

  if (["completed", "completed_with_issues", "failed", "cancelled"].includes(String(existingJob.status))) {
    return NextResponse.json({ ok: true, accepted: false, jobId, status: existingJob.status }, { status: 200 });
  }

  const token = process.env.SUPABASE_SECRET_KEY || "";
  // Complete one bounded batch before responding so an accepted request
  // always represents real progress, even if the browser closes.
  const progress = await runBackgroundCampaignBatch(req.url, jobId, token, body.refreshDrafts !== false);
  if (progress.remaining) {
    void kickNextBackgroundBatch(req.url, jobId, token);
  }
  return NextResponse.json({ ok: true, accepted: true, jobId, ...progress }, { status: 202 });
}
