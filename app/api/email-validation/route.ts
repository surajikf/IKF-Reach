import { NextRequest, NextResponse } from "next/server";
import { getQueueDb } from "../../../db";
import {
  emailDomain,
  isPracticalEmailSyntax,
  normalizeEmailAddress,
  validateEmailSignals,
  type EmailDomainSignals,
  type EmailHistorySignals,
  type EmailValidationResult,
} from "../../lib/email-validation";

export const dynamic = "force-dynamic";

const allowedOperators = new Set(["gpt@ikf.co.in", "social@ikf.co.in"]);
const supabaseUrl = () => process.env.SUPABASE_URL || "";
const supabaseKey = () => process.env.SUPABASE_SECRET_KEY || "";

function actor(req: NextRequest) {
  return req.headers.get("oai-authenticated-user-email")?.trim().toLowerCase() || "";
}

function canManage(req: NextRequest) {
  return allowedOperators.has(actor(req));
}

function internalRequest(req: NextRequest, jobId: string) {
  const suppliedJob = req.headers.get("x-ikf-validation-job") || "";
  const suppliedToken = req.headers.get("x-ikf-validation-token") || "";
  return suppliedJob === jobId && Boolean(supabaseKey()) && suppliedToken === supabaseKey();
}

async function supabase(path: string, init: RequestInit = {}) {
  const response = await fetch(`${supabaseUrl()}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: supabaseKey(),
      Authorization: `Bearer ${supabaseKey()}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers || {}),
    },
  });
  if (!response.ok) throw new Error(`Database request failed (${response.status}).`);
  const text = await response.text();
  return text ? JSON.parse(text) : [];
}

function chunks<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

async function loadContactsForValidation(requestedIds: string[]) {
  const contacts: Array<Record<string, unknown>> = [];
  if (requestedIds.length) {
    for (const idBatch of chunks(requestedIds, 80)) {
      contacts.push(...await supabase(`contacts?select=id,email&id=in.(${idBatch.join(",")})&limit=100`));
    }
    return contacts.filter((contact) => contact.id && contact.email);
  }
  for (let offset = 0; ; offset += 1000) {
    const page = await supabase(`contacts?select=id,email&order=created_at.asc&offset=${offset}&limit=1000`);
    contacts.push(...page);
    if (page.length < 1000) break;
  }
  return contacts.filter((contact) => contact.id && contact.email);
}

function mapJob(row: Record<string, unknown>) {
  return {
    id: row.id,
    status: row.status,
    scheduledFor: row.scheduled_for,
    totalItems: Number(row.total_items || 0),
    processedItems: Number(row.processed_items || 0),
    validItems: Number(row.valid_items || 0),
    riskyItems: Number(row.risky_items || 0),
    invalidItems: Number(row.invalid_items || 0),
    unknownItems: Number(row.unknown_items || 0),
    failedItems: Number(row.failed_items || 0),
    lastError: row.last_error,
    createdBy: row.created_by,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    updatedAt: row.updated_at,
  };
}

function mapResult(row: Record<string, unknown>) {
  return {
    contactId: row.contact_id,
    email: row.email,
    verdict: row.verdict,
    score: Number(row.score || 0),
    syntaxValid: Boolean(row.syntax_valid),
    domainReachable: row.domain_reachable == null ? null : Boolean(row.domain_reachable),
    roleBased: Boolean(row.role_based),
    disposable: Boolean(row.disposable),
    previousHardBounce: Boolean(row.previous_hard_bounce),
    previousSoftBounce: Boolean(row.previous_soft_bounce),
    previousDelivered: Boolean(row.previous_delivered),
    complaint: Boolean(row.complaint),
    unsubscribed: Boolean(row.unsubscribed),
    reasons: safeJsonArray(row.reasons),
    mxRecords: safeJsonArray(row.mx_records),
    validatedAt: row.validated_at,
  };
}

function safeJsonArray(value: unknown): string[] {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

async function readValidationData(queueDb: D1Database) {
  const [jobs, results] = await Promise.all([
    queueDb.prepare(`
      SELECT * FROM email_validation_jobs
      ORDER BY created_at DESC
      LIMIT 20
    `).all<Record<string, unknown>>(),
    queueDb.prepare(`
      SELECT * FROM email_validation_results
      ORDER BY validated_at DESC
    `).all<Record<string, unknown>>(),
  ]);
  const mappedResults = (results.results || []).map(mapResult);
  const summary = mappedResults.reduce((totals, item) => {
    totals[item.verdict as keyof typeof totals] += 1;
    return totals;
  }, { valid: 0, risky: 0, invalid: 0, unknown: 0 });
  return {
    jobs: (jobs.results || []).map(mapJob),
    results: mappedResults,
    summary: { ...summary, checked: mappedResults.length },
  };
}

export async function GET(req: NextRequest) {
  try {
    const queueDb = getQueueDb();
    return NextResponse.json({
      ok: true,
      canManage: canManage(req),
      ...(await readValidationData(queueDb)),
      refreshedAt: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Email validation data is unavailable.",
    }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Record<string, unknown>;
    const action = String(body.action || "");
    const queueDb = getQueueDb();

    if (action === "process") {
      const jobId = String(body.jobId || "");
      if (!internalRequest(req, jobId)) {
        return NextResponse.json({ ok: false, error: "Validation worker authorization failed." }, { status: 403 });
      }
      return NextResponse.json({ ok: true, ...(await processValidationBatch(queueDb, jobId)) });
    }

    if (!canManage(req)) {
      return NextResponse.json({ ok: false, error: "Sign in with an authorized IKF account." }, { status: 403 });
    }

    if (action === "queue") {
      const existing = await queueDb.prepare(`
        SELECT id FROM email_validation_jobs
        WHERE status IN ('scheduled', 'queued', 'running')
        ORDER BY created_at DESC LIMIT 1
      `).first<{ id: string }>();
      if (existing) {
        return NextResponse.json({
          ok: false,
          error: "An email validation is already scheduled or running. Stop it before starting another.",
          jobId: existing.id,
        }, { status: 409 });
      }

      const scheduledValue = String(body.scheduledFor || "").trim();
      const scheduledDate = scheduledValue ? new Date(scheduledValue) : null;
      if (scheduledDate && !Number.isFinite(scheduledDate.getTime())) {
        return NextResponse.json({ ok: false, error: "Choose a valid validation date and time." }, { status: 400 });
      }
      if (scheduledDate && scheduledDate.getTime() < Date.now() + 60_000) {
        return NextResponse.json({ ok: false, error: "Schedule validation at least 1 minute from now, or choose Run now." }, { status: 400 });
      }

      const requestedIds = Array.isArray(body.contactIds)
        ? body.contactIds.map(String).filter((value) => /^[0-9a-f-]{36}$/i.test(value))
        : [];
      const contacts = await loadContactsForValidation(requestedIds);
      if (!contacts.length) {
        return NextResponse.json({ ok: false, error: "No contacts with email addresses were found." }, { status: 400 });
      }

      const jobId = crypto.randomUUID();
      const now = new Date().toISOString();
      const scheduledFor = scheduledDate?.toISOString() || null;
      await queueDb.prepare(`
        INSERT INTO email_validation_jobs (
          id, status, scheduled_for, total_items, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(
        jobId,
        scheduledFor ? "scheduled" : "queued",
        scheduledFor,
        contacts.length,
        actor(req),
        now,
        now,
      ).run();
      for (const batch of chunks(contacts, 80)) {
        await queueDb.batch(batch.map((contact: Record<string, unknown>) => queueDb.prepare(`
          INSERT INTO email_validation_items (
            id, job_id, contact_id, email, status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, 'queued', ?, ?)
        `).bind(
          crypto.randomUUID(),
          jobId,
          String(contact.id),
          String(contact.email),
          now,
          now,
        )));
      }

      return NextResponse.json({
        ok: true,
        jobId,
        status: scheduledFor ? "scheduled" : "queued",
        scheduledFor,
        totalItems: contacts.length,
      });
    }

    if (action === "cancel") {
      const jobId = String(body.jobId || "");
      await queueDb.batch([
        queueDb.prepare(`
          UPDATE email_validation_jobs
          SET cancel_requested = 1, status = 'cancelled', completed_at = ?, updated_at = ?
          WHERE id = ? AND status IN ('scheduled', 'queued', 'running')
        `).bind(new Date().toISOString(), new Date().toISOString(), jobId),
        queueDb.prepare(`
          UPDATE email_validation_items
          SET status = 'cancelled', updated_at = ?
          WHERE job_id = ? AND status IN ('queued', 'running')
        `).bind(new Date().toISOString(), jobId),
      ]);
      return NextResponse.json({ ok: true, jobId });
    }

    return NextResponse.json({ ok: false, error: "Unknown validation action." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Email validation failed.",
    }, { status: 500 });
  }
}

async function processValidationBatch(queueDb: D1Database, jobId: string) {
  const job = await queueDb.prepare(`
    SELECT * FROM email_validation_jobs WHERE id = ? LIMIT 1
  `).bind(jobId).first<Record<string, unknown>>();
  if (!job) throw new Error("Validation job was not found.");
  if (Number(job.cancel_requested || 0) || ["cancelled", "completed", "completed_with_issues"].includes(String(job.status))) {
    return { jobId, status: job.status, remaining: 0 };
  }
  if (String(job.status) === "scheduled" && new Date(String(job.scheduled_for || "")).getTime() > Date.now()) {
    return { jobId, status: "scheduled", remaining: Number(job.total_items || 0) - Number(job.processed_items || 0) };
  }

  const now = new Date().toISOString();
  await queueDb.prepare(`
    UPDATE email_validation_jobs
    SET status = 'running', started_at = COALESCE(started_at, ?), updated_at = ?
    WHERE id = ?
  `).bind(now, now, jobId).run();

  const itemRows = await queueDb.prepare(`
    SELECT * FROM email_validation_items
    WHERE job_id = ? AND status = 'queued'
    ORDER BY created_at ASC
    LIMIT 50
  `).bind(jobId).all<Record<string, unknown>>();
  const items = itemRows.results || [];
  if (!items.length) return finishValidationJob(queueDb, jobId);

  await queueDb.batch(items.map((item) => queueDb.prepare(`
    UPDATE email_validation_items
    SET status = 'running', attempts = attempts + 1, updated_at = ?
    WHERE id = ? AND status = 'queued'
  `).bind(now, item.id)));

  const histories = await loadHistorySignals(queueDb, items.map((item) => String(item.email)));
  const domains = [...new Set(items.map((item) => emailDomain(item.email)).filter(Boolean))];
  const domainEntries = await Promise.all(domains.map(async (domain) => [domain, await resolveDomainSignals(queueDb, domain)] as const));
  const domainMap = new Map(domainEntries);

  const outcomes = await Promise.all(items.map(async (item) => {
    try {
      const email = normalizeEmailAddress(item.email);
      const domain = emailDomain(email);
      const result = validateEmailSignals(
        email,
        isPracticalEmailSyntax(email) ? (domainMap.get(domain) || { reachable: null }) : { reachable: false },
        histories.get(email) || {},
      );
      return { item, result };
    } catch (error) {
      return { item, error: error instanceof Error ? error.message : "Validation failed." };
    }
  }));

  const completedAt = new Date().toISOString();
  const statements: D1PreparedStatement[] = [];
  for (const outcome of outcomes) {
    if ("error" in outcome) {
      statements.push(queueDb.prepare(`
        UPDATE email_validation_items
        SET status = 'failed', error = ?, updated_at = ?
        WHERE id = ?
      `).bind(outcome.error, completedAt, outcome.item.id));
      continue;
    }
    statements.push(resultUpsert(queueDb, jobId, String(outcome.item.contact_id), outcome.result, completedAt));
    statements.push(queueDb.prepare(`
      UPDATE email_validation_items
      SET status = 'completed', verdict = ?, score = ?, error = NULL, updated_at = ?
      WHERE id = ?
    `).bind(outcome.result.verdict, outcome.result.score, completedAt, outcome.item.id));
  }
  for (const batch of chunks(statements, 80)) await queueDb.batch(batch);
  await refreshJobCounts(queueDb, jobId);
  const remainingRow = await queueDb.prepare(`
    SELECT COUNT(*) AS count FROM email_validation_items
    WHERE job_id = ? AND status = 'queued'
  `).bind(jobId).first<{ count: number }>();
  const remaining = Number(remainingRow?.count || 0);
  if (!remaining) return finishValidationJob(queueDb, jobId);
  return { jobId, status: "running", processed: outcomes.length, remaining };
}

function resultUpsert(
  queueDb: D1Database,
  jobId: string,
  contactId: string,
  result: EmailValidationResult,
  validatedAt: string,
) {
  return queueDb.prepare(`
    INSERT INTO email_validation_results (
      contact_id, email, normalized_email, domain, verdict, score,
      syntax_valid, domain_reachable, role_based, disposable,
      previous_hard_bounce, previous_soft_bounce, previous_delivered,
      complaint, unsubscribed, reasons, mx_records, job_id, validated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(contact_id) DO UPDATE SET
      email = excluded.email,
      normalized_email = excluded.normalized_email,
      domain = excluded.domain,
      verdict = excluded.verdict,
      score = excluded.score,
      syntax_valid = excluded.syntax_valid,
      domain_reachable = excluded.domain_reachable,
      role_based = excluded.role_based,
      disposable = excluded.disposable,
      previous_hard_bounce = excluded.previous_hard_bounce,
      previous_soft_bounce = excluded.previous_soft_bounce,
      previous_delivered = excluded.previous_delivered,
      complaint = excluded.complaint,
      unsubscribed = excluded.unsubscribed,
      reasons = excluded.reasons,
      mx_records = excluded.mx_records,
      job_id = excluded.job_id,
      validated_at = excluded.validated_at
  `).bind(
    contactId,
    result.email,
    result.normalizedEmail,
    result.domain,
    result.verdict,
    result.score,
    result.syntaxValid ? 1 : 0,
    result.domainReachable == null ? null : result.domainReachable ? 1 : 0,
    result.roleBased ? 1 : 0,
    result.disposable ? 1 : 0,
    result.history.hardBounce ? 1 : 0,
    result.history.softBounce ? 1 : 0,
    result.history.delivered ? 1 : 0,
    result.history.complaint ? 1 : 0,
    result.history.unsubscribed ? 1 : 0,
    JSON.stringify(result.reasons),
    JSON.stringify(result.mxRecords),
    jobId,
    validatedAt,
  );
}

async function loadHistorySignals(queueDb: D1Database, emails: string[]) {
  const normalized = [...new Set(emails.map(normalizeEmailAddress).filter(Boolean))];
  const result = new Map<string, EmailHistorySignals>();
  if (!normalized.length) return result;
  const placeholders = normalized.map(() => "?").join(",");
  const rows = await queueDb.prepare(`
    SELECT lower(recipient_email) AS email, event
    FROM email_analytics_events
    WHERE lower(recipient_email) IN (${placeholders})
      AND event IN ('hardBounce', 'softBounce', 'spam', 'unsubscribed', 'delivered', 'blocked', 'invalid')
  `).bind(...normalized).all<{ email: string; event: string }>();
  for (const row of rows.results || []) {
    const signals = result.get(row.email) || {};
    if (["hardBounce", "blocked", "invalid"].includes(row.event)) signals.hardBounce = true;
    if (row.event === "softBounce") signals.softBounce = true;
    if (row.event === "spam") signals.complaint = true;
    if (row.event === "unsubscribed") signals.unsubscribed = true;
    if (row.event === "delivered") signals.delivered = true;
    result.set(row.email, signals);
  }
  return result;
}

async function resolveDomainSignals(queueDb: D1Database, domain: string): Promise<EmailDomainSignals> {
  const cached = await queueDb.prepare(`
    SELECT * FROM email_domain_validation_cache
    WHERE domain = ? AND checked_at >= ?
    LIMIT 1
  `).bind(domain, new Date(Date.now() - 7 * 24 * 60 * 60_000).toISOString()).first<Record<string, unknown>>();
  if (cached) {
    return {
      reachable: cached.reachable == null ? null : Boolean(cached.reachable),
      mxRecords: safeJsonArray(cached.mx_records),
      fallbackAddressRecord: Boolean(cached.fallback_address_record),
      error: cached.error ? String(cached.error) : null,
    };
  }

  let signals: EmailDomainSignals = { reachable: null, mxRecords: [] };
  try {
    const mx = await dnsQuery(domain, "MX");
    const mxRecords = mx.answers.filter((answer) => answer.type === 15).map((answer) => answer.data);
    const explicitNullMx = mxRecords.some((record) => /(?:^|\s)\.$/.test(record));
    if (mxRecords.length && !explicitNullMx) {
      signals = { reachable: true, mxRecords };
    } else if (explicitNullMx) {
      signals = { reachable: false, mxRecords };
    } else {
      const [a, aaaa] = await Promise.all([dnsQuery(domain, "A"), dnsQuery(domain, "AAAA")]);
      const fallbackAddressRecord = a.answers.some((answer) => answer.type === 1)
        || aaaa.answers.some((answer) => answer.type === 28);
      signals = { reachable: fallbackAddressRecord, mxRecords: [], fallbackAddressRecord };
    }
  } catch (error) {
    signals = {
      reachable: null,
      mxRecords: [],
      error: error instanceof Error ? error.message : "DNS lookup failed.",
    };
  }
  await queueDb.prepare(`
    INSERT INTO email_domain_validation_cache (
      domain, reachable, mx_records, fallback_address_record, error, checked_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(domain) DO UPDATE SET
      reachable = excluded.reachable,
      mx_records = excluded.mx_records,
      fallback_address_record = excluded.fallback_address_record,
      error = excluded.error,
      checked_at = excluded.checked_at
  `).bind(
    domain,
    signals.reachable == null ? null : signals.reachable ? 1 : 0,
    JSON.stringify(signals.mxRecords || []),
    signals.fallbackAddressRecord ? 1 : 0,
    signals.error || null,
    new Date().toISOString(),
  ).run();
  return signals;
}

async function dnsQuery(domain: string, type: "MX" | "A" | "AAAA") {
  const response = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=${type}`, {
    headers: { Accept: "application/dns-json" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`DNS lookup failed (${response.status}).`);
  const payload = await response.json() as {
    Status?: number;
    Answer?: Array<{ type?: number; data?: string }>;
  };
  if (payload.Status !== 0 && payload.Status !== 3) throw new Error(`DNS returned status ${payload.Status}.`);
  return {
    status: Number(payload.Status || 0),
    answers: (payload.Answer || []).map((answer) => ({
      type: Number(answer.type || 0),
      data: String(answer.data || ""),
    })),
  };
}

async function refreshJobCounts(queueDb: D1Database, jobId: string) {
  await queueDb.prepare(`
    UPDATE email_validation_jobs SET
      processed_items = (SELECT COUNT(*) FROM email_validation_items WHERE job_id = ? AND status IN ('completed', 'failed')),
      valid_items = (SELECT COUNT(*) FROM email_validation_items WHERE job_id = ? AND verdict = 'valid'),
      risky_items = (SELECT COUNT(*) FROM email_validation_items WHERE job_id = ? AND verdict = 'risky'),
      invalid_items = (SELECT COUNT(*) FROM email_validation_items WHERE job_id = ? AND verdict = 'invalid'),
      unknown_items = (SELECT COUNT(*) FROM email_validation_items WHERE job_id = ? AND verdict = 'unknown'),
      failed_items = (SELECT COUNT(*) FROM email_validation_items WHERE job_id = ? AND status = 'failed'),
      updated_at = ?
    WHERE id = ?
  `).bind(jobId, jobId, jobId, jobId, jobId, jobId, new Date().toISOString(), jobId).run();
}

async function finishValidationJob(queueDb: D1Database, jobId: string) {
  await refreshJobCounts(queueDb, jobId);
  const job = await queueDb.prepare(`
    SELECT * FROM email_validation_jobs WHERE id = ? LIMIT 1
  `).bind(jobId).first<Record<string, unknown>>();
  const status = Number(job?.failed_items || 0) ? "completed_with_issues" : "completed";
  const now = new Date().toISOString();
  await queueDb.prepare(`
    UPDATE email_validation_jobs
    SET status = ?, completed_at = ?, updated_at = ?
    WHERE id = ? AND status != 'cancelled'
  `).bind(status, now, now, jobId).run();
  return { jobId, status, remaining: 0 };
}
