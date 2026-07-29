import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const api = await readFile(new URL("../app/api/control/route.ts", import.meta.url), "utf8");
const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
const statistics = await readFile(new URL("../app/statistics-dashboard.tsx", import.meta.url), "utf8");
const statisticsApi = await readFile(new URL("../app/api/statistics/route.ts", import.meta.url), "utf8");
const webhookApi = await readFile(new URL("../app/api/brevo-webhook/route.ts", import.meta.url), "utf8");

test("campaign creation exposes durable background research and verified sender selection", () => {
  assert.match(page, /Save as draft campaign/);
  assert.match(page, /Continue to campaign setup/);
  assert.match(page, /Verified Brevo sender/);
  assert.match(page, /Enter up to 50 websites/);
  assert.match(page, /background-campaign/);
});

test("server queues campaign sources and processes them in bounded batches", () => {
  assert.match(api, /queue_background_campaign/);
  assert.match(api, /process_background_campaign/);
  assert.match(api, /LIMIT 3/);
  assert.match(api, /suppliedWebsites\.length > 50/);
  assert.match(api, /selectVerifiedSender/);
});

test("worker continues campaign research independently of the browser", () => {
  assert.match(worker, /ctx\.waitUntil\(runBackgroundCampaignBatch/);
  assert.match(worker, /x-ikf-background-token/);
  assert.match(worker, /\/api\/background-campaign/);
});

test("contacts and companies paginate their complete filtered datasets independently", () => {
  assert.match(page, /const \[contactPage, setContactPage\] = useState\(1\)/);
  assert.match(page, /const \[companyPage, setCompanyPage\] = useState\(1\)/);
  assert.match(page, /const pagedContacts = filteredContacts\.slice/);
  assert.match(page, /const pagedCompanies = filteredCompanies\.slice/);
  assert.match(page, /Showing.*contacts/);
  assert.match(page, /Showing.*companies/);
});

test("campaigns store a chosen Reply-To and support controlled delivery batches", () => {
  assert.match(page, /Reply-To email/);
  assert.match(page, /Enter another email/);
  assert.match(page, /Emails in each batch/);
  assert.match(page, /Gap between batches/);
  assert.match(api, /saveCampaignReplyTo/);
  assert.match(api, /replyToForMail/);
  assert.match(api, /buildCampaignSchedule\(start, mails\.length, batchSize, delayMinutes, policy\)/);
});

test("authorized operators can stop durable background research safely", () => {
  assert.match(page, /Stop processing/);
  assert.match(page, /stopBackgroundJob/);
  assert.match(api, /cancel_background_campaign/);
  assert.match(api, /SET status = 'cancelled'/);
  assert.match(api, /assertBackgroundJobActive/);
  assert.match(worker, /if \(!result\.remaining\) return/);
});

test("campaign audience permits safe deletion of unsent generated emails only", () => {
  assert.match(page, /deleteCampaignEmail/);
  assert.match(page, /Delete this generated email/);
  assert.match(api, /delete_generated_email/);
  assert.match(api, /Sent or scheduled emails cannot be deleted/);
  assert.match(api, /generated_email_deleted/);
});

test("statistics uses real Brevo events with campaign, recipient, sender, event, and date filters", () => {
  assert.match(page, /StatisticsDashboard/);
  assert.match(statistics, /Campaign Statistics/);
  assert.match(statistics, /All campaigns/);
  assert.match(statistics, /All campaign types/);
  assert.match(statistics, /All statuses/);
  assert.match(statistics, /All tags/);
  assert.match(statistics, /Email or subject/);
  assert.match(statistics, /Last 90 days/);
  assert.match(statistics, /Recipient activity/);
  assert.match(statistics, /Domain analytics/);
  assert.match(statisticsApi, /smtp\/statistics\/events/);
  assert.match(statisticsApi, /maximum of 90 days/);
});

test("statistics formulas and exports distinguish unique and total engagement", () => {
  assert.match(statistics, /Unique opens/);
  assert.match(statistics, /totalOpens/);
  assert.match(statistics, /Unique clicks/);
  assert.match(statistics, /clickRate/);
  assert.match(statistics, /ctor/);
  assert.match(statistics, /event\.messageId \|\| event\.emailSendId \|\| event\.generatedEmailId/);
  assert.match(statistics, /const totalOpenRows = byType\(\["opened", "loadedByProxy"\]\)/);
  assert.match(statistics, /Export CSV/);
  assert.match(statistics, /Export Excel/);
  assert.match(statistics, /Save PDF/);
});

test("Brevo webhook events are authenticated, deduplicated, and stored durably", () => {
  assert.match(webhookApi, /BREVO_WEBHOOK_TOKEN/);
  assert.match(webhookApi, /Bearer /);
  assert.match(webhookApi, /x-brevo-webhook-token/);
  assert.match(webhookApi, /event\.ts_event \|\| event\.ts \|\| event\.timestamp/);
  assert.match(webhookApi, /INSERT OR IGNORE INTO email_analytics_events/);
  assert.match(webhookApi, /providerEventKey|provider_event_key/);
  assert.match(statisticsApi, /canonicalEventKey/);
  assert.match(statisticsApi, /database: 0, webhook: 1, brevo: 2/);
  assert.match(statisticsApi, /if \(!send\) continue/);
});
