#!/usr/bin/env node
// Self-hosted production entry point. Replaces the Cloudflare Worker's
// fetch/scheduled entry (worker/index.ts) now that this app runs as a plain
// Node server instead of deploying to Cloudflare Workers.
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { startProdServer } from "vinext/server/prod-server";

// vinext's own CLI loads .env files before starting the prod server, but
// that loader isn't part of its public exports, so this is the same
// well-known dotenv pattern reimplemented directly. Real environment
// variables (e.g. from a process manager or systemd unit) always win.
function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile(resolve(process.cwd(), ".env"));
loadEnvFile(resolve(process.cwd(), ".env.production"));
loadEnvFile(resolve(process.cwd(), ".env.local"));

const CRON_INTERVAL_MS = 60_000;
const BACKGROUND_CAMPAIGN_INTERVAL_MS = 15_000;

async function tickScheduledValidation(port) {
  const base = `http://127.0.0.1:${port}`;
  try {
    const dueRes = await fetch(`${base}/api/email-validation?dueJobsOnly=1`);
    if (!dueRes.ok) return;
    const { jobIds } = await dueRes.json();
    for (const jobId of jobIds || []) {
      // Fire-and-forget: the endpoint itself schedules its own continuation
      // until the batch finishes or the platform reclaims the process.
      fetch(`${base}/api/background-email-validation`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-ikf-validation-job": jobId,
          "x-ikf-validation-token": process.env.SUPABASE_SECRET_KEY || "",
        },
        body: JSON.stringify({ jobId }),
      }).catch(() => {});
    }
  } catch {
    // Best-effort heartbeat; a missed tick is retried on the next interval.
  }
}

async function tickScheduledFollowups(port) {
  const base = `http://127.0.0.1:${port}`;
  try {
    // The protected worker owns the due-sequence check. Calling it directly
    // keeps scheduled follow-ups independent from interactive dashboard auth.
    await fetch(`${base}/api/background-followups`, { method: "POST", headers: { "Content-Type": "application/json", "x-ikf-followup-token": process.env.SUPABASE_SECRET_KEY || "" }, body: "{}" });
  } catch {
    // Best-effort heartbeat; due replies are retried on the next interval.
  }
}

let backgroundCampaignTickInFlight = false;
async function tickBackgroundCampaigns(port) {
  if (backgroundCampaignTickInFlight) return;
  backgroundCampaignTickInFlight = true;
  try {
    const token = process.env.SUPABASE_SECRET_KEY || "";
    const headers = token ? { "x-ikf-background-token": token } : {};
    const response = await fetch(`http://127.0.0.1:${port}/api/background-campaign`, { headers });
    if (!response.ok) return;
    const payload = await response.json();
    const jobIds = Array.isArray(payload?.jobIds) ? payload.jobIds : [];
    await Promise.all(jobIds.map((jobId) => fetch(`http://127.0.0.1:${port}/api/background-campaign`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers, "x-ikf-background-job": jobId },
      body: JSON.stringify({ jobId, refreshDrafts: false }),
    }).catch(() => null)));
  } catch {
    // The next heartbeat retries unfinished jobs. Avoid stopping the server for
    // a temporary database or network failure.
  } finally {
    backgroundCampaignTickInFlight = false;
  }
}

const { port } = await startProdServer();
console.log(`[ikf-spark] production server listening on port ${port}`);

setInterval(() => { tickScheduledValidation(port); tickScheduledFollowups(port); }, CRON_INTERVAL_MS);
setInterval(() => { tickBackgroundCampaigns(port); }, BACKGROUND_CAMPAIGN_INTERVAL_MS);
setTimeout(() => { tickBackgroundCampaigns(port); }, 2_000);
tickScheduledFollowups(port);
