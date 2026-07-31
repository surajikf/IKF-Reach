import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const validationOperators = new Set(["gpt@ikf.co.in", "social@ikf.co.in"]);
const validationContinuationBatches = 2;
const validationContinuationMs = 22_000;

function isLocalRequest(req: NextRequest) {
  const host = (req.headers.get("host") || "").toLowerCase();
  return host.includes("localhost") || host.includes("127.0.0.1");
}

function canStartEmailValidation(req: NextRequest, jobId: string) {
  if (isLocalRequest(req)) return true;
  const actor = req.headers.get("oai-authenticated-user-email")?.trim().toLowerCase() || "";
  const token = process.env.SUPABASE_SECRET_KEY || "";
  const internal = req.headers.get("x-ikf-validation-job") === jobId
    && Boolean(token)
    && req.headers.get("x-ikf-validation-token") === token;
  return validationOperators.has(actor) || internal;
}

async function runEmailValidationBatch(requestUrl: string, jobId: string) {
  const token = process.env.SUPABASE_SECRET_KEY || "";
  const response = await fetch(new URL("/api/email-validation", requestUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-ikf-validation-job": jobId,
      "x-ikf-validation-token": token,
    },
    body: JSON.stringify({ action: "process", jobId }),
  });
  if (!response.ok) {
    return { remaining: 0, error: await response.text() };
  }
  return (await response.json()) as { remaining?: number; status?: string };
}

async function kickNextEmailValidationBatch(requestUrl: string, jobId: string) {
  const token = process.env.SUPABASE_SECRET_KEY || "";
  const response = await fetch(new URL("/api/background-email-validation", requestUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-ikf-validation-job": jobId,
      "x-ikf-validation-token": token,
    },
    body: JSON.stringify({ jobId }),
  });
  if (!response.ok) {
    throw new Error(`Email validation continuation failed (${response.status}).`);
  }
}

async function continueEmailValidation(requestUrl: string, jobId: string, allowNetworkHandoff: boolean) {
  const deadline = Date.now() + validationContinuationMs;
  let batches = 0;
  let progress: { remaining?: number; status?: string } = { remaining: 1 };
  while (
    Number(progress.remaining || 0) > 0
    && batches < validationContinuationBatches
    && Date.now() < deadline
  ) {
    progress = await runEmailValidationBatch(requestUrl, jobId);
    batches += 1;
  }
  if (allowNetworkHandoff && Number(progress.remaining || 0) > 0) {
    await kickNextEmailValidationBatch(requestUrl, jobId);
  }
  return progress;
}

export async function POST(req: NextRequest) {
  let body: { jobId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid email validation request." }, { status: 400 });
  }
  const jobId = String(body.jobId || "");
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) {
    return NextResponse.json({ ok: false, error: "A valid validation job is required." }, { status: 400 });
  }
  if (!canStartEmailValidation(req, jobId)) {
    return NextResponse.json({ ok: false, error: "Email validation worker authorization failed." }, { status: 403 });
  }
  const progress = await runEmailValidationBatch(req.url, jobId);
  if (Number(progress.remaining || 0) > 0) {
    void continueEmailValidation(req.url, jobId, true).catch(() => {});
  }
  return NextResponse.json({ ok: true, accepted: true, jobId, ...progress }, { status: 202 });
}
