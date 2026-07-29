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
