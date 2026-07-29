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

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/background-campaign" && request.method === "POST") {
      let body: { jobId?: string; refreshDrafts?: boolean };
      try {
        body = await request.json();
      } catch {
        return Response.json({ ok: false, error: "Invalid background campaign request." }, { status: 400 });
      }
      const jobId = String(body.jobId || "");
      if (!/^[0-9a-f-]{36}$/i.test(jobId)) {
        return Response.json({ ok: false, error: "A valid campaign job is required." }, { status: 400 });
      }
      const existingJob = await env.DB.prepare(`
        SELECT status
        FROM background_research_jobs
        WHERE id = ?
        LIMIT 1
      `).bind(jobId).first<{ status: string }>();
      if (!existingJob) {
        return Response.json({ ok: false, error: "Background campaign job not found." }, { status: 404 });
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
};

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

export default worker;
