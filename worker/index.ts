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
      let body: { jobId?: string };
      try {
        body = await request.json();
      } catch {
        return Response.json({ ok: false, error: "Invalid background campaign request." }, { status: 400 });
      }
      const jobId = String(body.jobId || "");
      const operator = String(request.headers.get("oai-authenticated-user-email") || "").toLowerCase();
      const internal = Boolean(env.SUPABASE_SECRET_KEY) &&
        request.headers.get("x-ikf-background-token") === env.SUPABASE_SECRET_KEY;
      if (!internal && !["gpt@ikf.co.in", "social@ikf.co.in"].includes(operator)) {
        return Response.json({ ok: false, error: "An authorized IKF account is required." }, { status: 403 });
      }
      if (!/^[0-9a-f-]{36}$/i.test(jobId)) {
        return Response.json({ ok: false, error: "A valid campaign job is required." }, { status: 400 });
      }
      ctx.waitUntil(runBackgroundCampaignBatch(request.url, jobId, env.SUPABASE_SECRET_KEY));
      return Response.json({ ok: true, accepted: true, jobId }, { status: 202 });
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

async function runBackgroundCampaignBatch(requestUrl: string, jobId: string, token: string) {
  const controlUrl = new URL("/api/control", requestUrl);
  const response = await fetch(controlUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-ikf-background-token": token,
    },
    body: JSON.stringify({ action: "process_background_campaign", jobId }),
  });
  if (!response.ok) {
    const retry = await fetch(controlUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-ikf-background-token": token,
      },
      body: JSON.stringify({ action: "process_background_campaign", jobId }),
    });
    if (!retry.ok) return;
    const retryResult = await retry.json() as { remaining?: number };
    if (!retryResult.remaining) return;
  } else {
    const result = await response.json() as { remaining?: number };
    if (!result.remaining) return;
  }
  await fetch(new URL("/api/background-campaign", requestUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-ikf-background-token": token,
    },
    body: JSON.stringify({ jobId }),
  });
}

export default worker;
