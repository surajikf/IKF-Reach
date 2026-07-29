import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const api = await readFile(new URL("../app/api/control/route.ts", import.meta.url), "utf8");
const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
const statistics = await readFile(new URL("../app/statistics-dashboard.tsx", import.meta.url), "utf8");
const statisticsApi = await readFile(new URL("../app/api/statistics/route.ts", import.meta.url), "utf8");
const webhookApi = await readFile(new URL("../app/api/brevo-webhook/route.ts", import.meta.url), "utf8");
const viteConfig = await readFile(new URL("../vite.config.ts", import.meta.url), "utf8");

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
  assert.match(api, /const batchLimit = estimatedRemaining > 200 \? 50 : estimatedRemaining > 50 \? 20 : 1/);
  assert.match(api, /now\.getTime\(\) - 45_000/);
  assert.match(api, /status = 'failed' AND attempts < 2/);
  assert.match(api, /AS retrying/);
  assert.match(api, /LIMIT \?/);
  assert.match(api, /suppliedWebsites\.length > 50/);
  assert.doesNotMatch(api, /parsedContacts\.length > 50/);
  assert.doesNotMatch(api, /\.slice\(0, 120_000\)/);
  assert.match(api, /offset \+= 75/);
  assert.match(api, /selectVerifiedSender/);
});

test("contact documents queue every valid record and retain PDF organization context", () => {
  assert.match(page, /Every valid contact is queued in safe background batches/);
  assert.match(api, /parseDocumentContactInput\(documentText\)/);
  assert.match(api, /mergeContactInputs/);
});

test("worker continues campaign research independently of the browser", () => {
  assert.match(page, /Live campaign generation/);
  assert.match(page, /Unique emails created/);
  assert.match(page, /Duplicates \/ existing skipped/);
  assert.match(page, /Queued for automatic retry/);
  assert.match(page, /Latest generation report/);
  assert.match(page, /All database contacts/);
  assert.match(worker, /const progress = await runBackgroundCampaignBatch/);
  assert.match(worker, /ctx\.waitUntil\(kickNextBackgroundBatch/);
  assert.match(worker, /handler\.fetch\(controlRequest\(\), env, ctx\)/);
  assert.match(worker, /body\.retryFailed === true/);
  assert.match(worker, /Final automatic retry queued/);
  assert.match(worker, /x-ikf-background-token/);
  assert.match(worker, /\/api\/background-campaign/);
  assert.match(viteConfig, /global_fetch_strictly_public/);
});

test("campaign email workspace can select and approve the complete campaign safely", () => {
  assert.match(page, /Select all \{selectedCampaignEmails\.length\}/);
  assert.match(page, /Approve all/);
  assert.match(page, /This only changes approval status\. It will not send or schedule any email/);
  assert.match(api, /body\.action === "approve_campaign"/);
  assert.match(api, /campaign_drafts_approved/);
});

test("generated drafts enforce the requested selective email formatting", () => {
  assert.match(api, /font-family:Calibri,Arial,sans-serif;font-size:11pt/);
  assert.match(api, /company: `<strong><u>/);
  assert.match(api, /emphasizeLeadingTitle/);
  assert.match(api, /emphasizeImportantKeywords/);
  assert.match(api, /<strong>\$1:<\/strong>/);
  assert.match(api, /normalizeAiStyle/);
  assert.match(api, /placeCommunityBeforeSignature/);
  assert.match(api, /signatureIndex/);
  assert.match(api, /formatting_version: 4/);
  assert.match(api, /safe\.split\(`IKFPERSONALIZATIONTOKEN/);
  assert.match(api, /refreshBackgroundCampaignDraftFormatting/);
  assert.match(api, /sent_and_scheduled_excluded: true/);
});

test("contacts and companies paginate their complete filtered datasets independently", () => {
  assert.match(page, /const \[contactPage, setContactPage\] = useState\(1\)/);
  assert.match(page, /const \[companyPage, setCompanyPage\] = useState\(1\)/);
  assert.match(page, /const pagedContacts = filteredContacts\.slice/);
  assert.match(page, /const pagedCompanies = filteredCompanies\.slice/);
  assert.match(page, /Showing.*contacts/);
  assert.match(page, /Showing.*companies/);
});

test("contacts can switch between practical large page sizes", () => {
  assert.match(page, /const \[contactPageSize, setContactPageSize\] = useState\(50\)/);
  assert.match(page, /Rows per page/);
  assert.match(page, /<option value=\{50\}>50<\/option>/);
  assert.match(page, /<option value=\{100\}>100<\/option>/);
  assert.match(page, /<option value=\{1000\}>1,000<\/option>/);
});

test("companies expose every linked contact and keep company-first CRM relationships", () => {
  assert.match(page, /View contacts/);
  assert.match(page, /People & email addresses/);
  assert.match(page, /contact\.companyId === selectedCompany\.id/);
  assert.match(api, /contacts.*company_id: company\.id/s);
  assert.match(api, /isPublicMailbox\(emailDomain\)[\s\S]*company:/);
});

test("company industry classification is inferable, editable, and filterable across CRM views", () => {
  assert.match(page, /Industry \/ business domain/);
  assert.match(page, /industry-domain-options/);
  assert.match(page, /contactIndustry/);
  assert.match(page, /companyIndustry/);
  assert.match(page, /Edit company/);
  assert.match(api, /inferCompanyIndustry/);
  assert.match(api, /body\.action === "update_company"/);
  assert.match(api, /industry: suppliedIndustry \|\| companies\[0\]\.industry/);
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
  assert.match(worker, /if \(progress\.remaining\)/);
});

test("campaign audience permits safe deletion of unsent generated emails only", () => {
  assert.match(page, /deleteCampaignEmail/);
  assert.match(page, /Delete this generated email/);
  assert.match(api, /delete_generated_email/);
  assert.match(api, /Sent or scheduled emails cannot be deleted/);
  assert.match(api, /generated_email_deleted/);
});

test("campaign deletion is explicit, cancels delivery, and preserves shared CRM and audit data", () => {
  assert.match(page, /Delete this campaign/);
  assert.match(page, /Type <b>\{selectedCampaignSummary\.name\}<\/b> to confirm/);
  assert.match(page, /deleteSelectedCampaign/);
  assert.match(api, /delete_campaign/);
  assert.match(api, /Campaign deleted by an authorized operator/);
  assert.match(api, /Brevo could not cancel/);
  assert.match(api, /status: "campaign_deleted"/);
  assert.match(api, /contacts_preserved: true/);
  assert.match(api, /companies_preserved: true/);
});

test("campaigns open from a simple list into template, email, status, and delivery views", () => {
  assert.match(page, /campaignDetailOpen/);
  assert.match(page, /Back to campaigns/);
  assert.match(page, /Original campaign template/);
  assert.match(page, /Current sending status/);
  assert.match(page, /Continue campaign/);
  assert.match(page, /Stop remaining scheduled emails/);
  assert.match(api, /email_template AS emailTemplate/);
  assert.match(api, /abort_campaign_delivery/);
  assert.match(api, /campaign_delivery_aborted/);
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

test("existing unsent drafts can refresh smart greetings without touching sent or scheduled mail", () => {
  assert.match(api, /refresh_unsent_draft_names/);
  assert.match(api, /status=in\.\(draft_pending_review,approved\)/);
  assert.match(api, /rewriteStoredGreeting/);
  assert.match(api, /smart_email_inference/);
  assert.match(api, /respectful_fallback/);
  assert.match(api, /sentAndScheduledExcluded: true/);
});

test("company cards expose the full clickable website URL", () => {
  assert.match(page, /function fullWebsiteUrl/);
  assert.match(page, /className="company-website-url"/);
  assert.doesNotMatch(page, />Visit website</);
});

test("campaign directory uses the full workspace with a responsive card grid", () => {
  assert.match(css, /\.campaign-portfolio-layout \{[^}]*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /\.campaign-directory-list \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 1280px\)[\s\S]*\.campaign-directory-list \{ grid-template-columns: 1fr; \}/);
});

test("campaign creation supports dynamic organization placeholders in subject and body", () => {
  assert.match(page, /Email topic \/ subject template/);
  assert.match(page, /\{ASSOCIATION NAME\}/);
  assert.match(page, /\{\{company\}\}/);
  assert.match(api, /renderPersonalizedSubject/);
  assert.match(api, /replacePersonalizationPlaceholders/);
});

test("empty live datasets do not resurrect deleted snapshot campaigns or emails", () => {
  assert.match(page, /Array\.isArray\(control\?\.campaigns\)/);
  assert.match(page, /Array\.isArray\(control\?\.liveEmails\)/);
  assert.match(page, /Array\.isArray\(control\?\.liveContacts\)/);
  assert.match(page, /Array\.isArray\(control\?\.liveCompanies\)/);
});
