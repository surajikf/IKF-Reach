/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  SUPABASE_SECRET_KEY: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

interface ScheduledController {
  scheduledTime: number;
  cron: string;
}

const validationOperators = new Set(["gpt@ikf.co.in", "social@ikf.co.in"]);
const validationContinuationBatches = 2;
const validationContinuationMs = 22_000;

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/background-campaign" && request.method === "POST") {
      let body: { jobId?: string; refreshDrafts?: boolean; retryFailed?: boolean };
      try {
        body = await request.json();
      } catch {
        return Response.json({ ok: false, error: "Invalid background campaign request." }, { status: 400 });
      }
      const jobId = String(body.jobId || "");
      if (!/^[0-9a-f-]{36}$/i.test(jobId)) {
        return Response.json({ ok: false, error: "A valid campaign job is required." }, { status: 400 });
      }
      let existingJob = await env.DB.prepare(`
        SELECT status, failed_items AS failedItems
        FROM background_research_jobs
        WHERE id = ?
        LIMIT 1
      `).bind(jobId).first<{ status: string; failedItems: number }>();
      if (!existingJob) {
        return Response.json({ ok: false, error: "Background campaign job not found." }, { status: 404 });
      }
      if (body.retryFailed === true
        && ["completed_with_issues", "failed"].includes(String(existingJob.status))
        && Number(existingJob.failedItems || 0) > 0) {
        const retryStartedAt = new Date().toISOString();
        await env.DB.batch([
          env.DB.prepare(`
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
          env.DB.prepare(`
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
        return Response.json({ ok: true, accepted: false, jobId, status: existingJob.status }, { status: 200 });
      }
      // Complete one bounded batch before returning so an accepted request
      // always represents real progress, even if the browser closes.
      const progress = await runBackgroundCampaignBatch(
        request.url,
        jobId,
        env.SUPABASE_SECRET_KEY,
        env,
        ctx,
        body.refreshDrafts !== false,
      );
      if (progress.remaining) {
        ctx.waitUntil(kickNextBackgroundBatch(request.url, jobId, env.SUPABASE_SECRET_KEY));
      }
      return Response.json({ ok: true, accepted: true, jobId, ...progress }, { status: 202 });
    }

    if (url.pathname === "/api/background-email-validation" && request.method === "POST") {
      let body: { jobId?: string };
      try {
        body = await request.json();
      } catch {
        return Response.json({ ok: false, error: "Invalid email validation request." }, { status: 400 });
      }
      const jobId = String(body.jobId || "");
      if (!/^[0-9a-f-]{36}$/i.test(jobId)) {
        return Response.json({ ok: false, error: "A valid validation job is required." }, { status: 400 });
      }
      if (!canStartEmailValidation(request, env, jobId)) {
        return Response.json({ ok: false, error: "Email validation worker authorization failed." }, { status: 403 });
      }
      const progress = await runEmailValidationBatch(request.url, jobId, env, ctx);
      if (Number(progress.remaining || 0) > 0) {
        ctx.waitUntil(continueEmailValidation(request.url, jobId, env, ctx, true));
      }
      return Response.json({ ok: true, accepted: true, jobId, ...progress }, { status: 202 });
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    const dueJobs = await env.DB.prepare(`
      SELECT id
      FROM email_validation_jobs
      WHERE (
        status = 'scheduled' AND scheduled_for <= ?
      ) OR status IN ('queued', 'running')
      ORDER BY created_at ASC
      LIMIT 4
    `).bind(new Date().toISOString()).all<{ id: string }>();
    for (const job of dueJobs.results || []) {
      // The minute heartbeat is a durable fallback for scheduled jobs and for
      // any continuation request interrupted by the platform.
      ctx.waitUntil(continueEmailValidation("https://scheduled.ikf.local", job.id, env, ctx, false));
    }
  },
};

function canStartEmailValidation(request: Request, env: Env, jobId: string) {
  const actor = request.headers.get("oai-authenticated-user-email")?.trim().toLowerCase() || "";
  const internal = request.headers.get("x-ikf-validation-job") === jobId
    && Boolean(env.SUPABASE_SECRET_KEY)
    && request.headers.get("x-ikf-validation-token") === env.SUPABASE_SECRET_KEY;
  return validationOperators.has(actor) || internal;
}

async function runBackgroundCampaignBatch(
  requestUrl: string,
  jobId: string,
  token: string,
  env: Env,
  ctx: ExecutionContext,
  refreshDrafts: boolean,
) {
  const controlUrl = new URL("/api/control", requestUrl);
  const workerHeaders = {
    "Content-Type": "application/json",
    "x-ikf-background-job": jobId,
    ...(token ? { "x-ikf-background-token": token } : {}),
  };
  const controlRequest = () => new Request(controlUrl, {
    method: "POST",
    headers: workerHeaders,
    body: JSON.stringify({ action: "process_background_campaign", jobId, refreshDrafts }),
  });
  // Run the first batch directly through the application handler. This avoids
  // depending on a same-zone network request for the work accepted above.
  const response = await handler.fetch(controlRequest(), env, ctx);
  if (!response.ok) {
    const retry = await handler.fetch(controlRequest(), env, ctx);
    if (!retry.ok) return { remaining: 0 };
    const retryResult = await retry.json() as { remaining?: number };
    return retryResult;
  } else {
    const result = await response.json() as { remaining?: number };
    return result;
  }
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
  });
}

async function runEmailValidationBatch(
  requestUrl: string,
  jobId: string,
  env: Env,
  ctx: ExecutionContext,
) {
  const validationRequest = new Request(new URL("/api/email-validation", requestUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-ikf-validation-job": jobId,
      "x-ikf-validation-token": env.SUPABASE_SECRET_KEY || "",
    },
    body: JSON.stringify({ action: "process", jobId }),
  });
  const response = await handler.fetch(validationRequest, env, ctx);
  if (!response.ok) {
    return { remaining: 0, error: await response.text() };
  }
  return response.json() as Promise<{ remaining?: number; status?: string }>;
}

async function continueEmailValidation(
  requestUrl: string,
  jobId: string,
  env: Env,
  ctx: ExecutionContext,
  allowNetworkHandoff: boolean,
) {
  const deadline = Date.now() + validationContinuationMs;
  let batches = 0;
  let progress: { remaining?: number; status?: string } = { remaining: 1 };
  while (
    Number(progress.remaining || 0) > 0
    && batches < validationContinuationBatches
    && Date.now() < deadline
  ) {
    progress = await runEmailValidationBatch(requestUrl, jobId, env, ctx);
    batches += 1;
  }
  if (allowNetworkHandoff && Number(progress.remaining || 0) > 0) {
    await kickNextEmailValidationBatch(requestUrl, jobId, env.SUPABASE_SECRET_KEY);
  }
  return progress;
}

async function kickNextEmailValidationBatch(requestUrl: string, jobId: string, token: string) {
  const response = await fetch(new URL("/api/background-email-validation", requestUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-ikf-validation-job": jobId,
      "x-ikf-validation-token": token || "",
    },
    body: JSON.stringify({ jobId }),
  });
  if (!response.ok) {
    throw new Error(`Email validation continuation failed (${response.status}).`);
  }
}

export default worker;
