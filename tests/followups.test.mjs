import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const followups = await readFile(new URL("../app/lib/followups.ts", import.meta.url), "utf8");
const workspace = await readFile(new URL("../app/followup-workspace.tsx", import.meta.url), "utf8");
const api = await readFile(new URL("../app/api/followups/route.ts", import.meta.url), "utf8");
const background = await readFile(new URL("../app/api/background-followups/route.ts", import.meta.url), "utf8");
const zoho = await readFile(new URL("../app/lib/zoho.ts", import.meta.url), "utf8");
const server = await readFile(new URL("../scripts/start-server.mjs", import.meta.url), "utf8");
const control = await readFile(new URL("../app/api/control/route.ts", import.meta.url), "utf8");
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

test("threaded follow-ups store an immutable original Zoho message anchor", () => {
  assert.match(followups, /original_zoho_message_id/);
  assert.match(followups, /latest_zoho_message_id/);
  assert.match(zoho, /action: "reply"/);
});

test("follow-up audience requires delivery and excludes unsafe recipients", () => {
  assert.match(followups, /not_confirmed_delivered/);
  assert.match(followups, /email_suppressions WHERE active=1/);
  assert.match(followups, /unsubscribed/);
  assert.match(followups, /already_replied/);
  assert.match(followups, /thread_unavailable/);
});

test("worker claims recipients atomically and recovers interrupted sends", () => {
  assert.match(followups, /AND status='queued'/);
  assert.match(followups, /Recovered after an interrupted worker attempt/);
  assert.match(background, /processDueFollowups/);
  assert.match(server, /tickScheduledFollowups/);
});

test("campaign UI supports composing, previewing, scheduling, dripping and stopping", () => {
  assert.match(workspace, /Create follow-up/);
  assert.match(workspace, /Personalization preview/);
  assert.match(workspace, /Add drip stage/);
  assert.match(workspace, /Approve & schedule/);
  assert.match(workspace, /Approve & send now/);
  assert.match(workspace, /Stop sequence/);
  assert.match(workspace, /Recipient results/);
});

test("Zoho follow-ups rely on native reply quoting without duplicating history", () => {
  assert.match(zoho, /action: "reply"/);
  assert.doesNotMatch(followups, /quotedTrail/);
  assert.doesNotMatch(followups, /getZohoMessageContent/);
  assert.doesNotMatch(followups, /<blockquote/);
  assert.match(followups, /latestThread\.messageId/);
  assert.match(followups, /recipient\.original_subject/);
  assert.match(followups, /Zoho's native reply action appends the quoted conversation/);
});

test("Zoho thread lookup replies to the newest message while remembering any recipient reply", () => {
  assert.match(zoho, /new Map<string, ZohoMessageSummary>/);
  assert.match(zoho, /candidates\.some\(\(message\) => message\.fromAddress\.includes\(email\)\)/);
  assert.match(zoho, /direction: match\.fromAddress\.includes\(email\)/);
  assert.doesNotMatch(zoho, /if \(aInbound !== bInbound\)/);
  assert.match(followups, /direction: latestThread\.direction/);
});

test("follow-up management APIs require authorized access", () => {
  assert.match(api, /getManagementAccess/);
  assert.match(api, /sync_threads/);
  assert.match(api, /action === "approve"/);
  assert.match(api, /action === "stop"/);
});

test("approved initial campaigns can start native Zoho threads safely", () => {
  assert.match(control, /action === "send_zoho_campaign"/);
  assert.match(control, /START ZOHO THREADS/);
  assert.match(control, /filterDeliverableContacts/);
  assert.match(control, /saveZohoThread/);
  assert.match(control, /generatedEmailId: mail\.id/);
  assert.match(control, /\/api\/unsubscribe\?contact=/);
  assert.match(page, /Start Zoho threads/);
  assert.match(page, /startSelectedCampaignZohoThreads/);
  assert.match(page, /!zohoStatus\?\.connected/);
});
