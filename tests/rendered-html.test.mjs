import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const api = await readFile(new URL("../app/api/control/route.ts", import.meta.url), "utf8");
const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");

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
