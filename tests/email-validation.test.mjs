import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateEmailSignals } from "../app/lib/email-validation.ts";

test("email validation rejects malformed, disposable, misspelled, and unreachable addresses", () => {
  assert.equal(validateEmailSignals("broken-address", { reachable: false }).verdict, "invalid");
  assert.equal(validateEmailSignals("person@mailinator.com", { reachable: true }).verdict, "invalid");
  assert.equal(validateEmailSignals("person@gamil.com", { reachable: true }).verdict, "invalid");
  assert.equal(validateEmailSignals("person@example.invalid", { reachable: false }).verdict, "invalid");
});

test("delivery history and role inboxes influence the verdict", () => {
  const delivered = validateEmailSignals("person@example.com", { reachable: true, mxRecords: ["10 mx.example.com."] }, { delivered: true });
  const hardBounce = validateEmailSignals("person@example.com", { reachable: true }, { hardBounce: true });
  const roleInbox = validateEmailSignals("info@example.com", { reachable: true });
  assert.equal(delivered.verdict, "valid");
  assert.equal(hardBounce.verdict, "invalid");
  assert.equal(roleInbox.verdict, "risky");
});

test("temporary DNS uncertainty is surfaced instead of guessed", () => {
  const result = validateEmailSignals("person@example.com", { reachable: null, error: "timeout" });
  assert.equal(result.verdict, "unknown");
  assert.match(result.reasons.join(" "), /could not be confirmed/i);
});

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const control = await readFile(new URL("../app/api/control/route.ts", import.meta.url), "utf8");
const validationApi = await readFile(new URL("../app/api/email-validation/route.ts", import.meta.url), "utf8");
const brevoWebhook = await readFile(new URL("../app/api/brevo-webhook/route.ts", import.meta.url), "utf8");
const suppressionMigration = await readFile(new URL("../drizzle/0004_large_the_phantom.sql", import.meta.url), "utf8");
const backgroundValidationApi = await readFile(new URL("../app/api/background-email-validation/route.ts", import.meta.url), "utf8");
const startServer = await readFile(new URL("../scripts/start-server.mjs", import.meta.url), "utf8");

test("contacts UI exposes validation, custom selection, scheduling, progress, and quarantine", () => {
  assert.match(page, /Validate emails/);
  assert.match(page, /Select all filtered/);
  assert.match(page, /Validate only this hand-picked set/);
  assert.match(page, /contactIds/);
  assert.match(page, /Schedule validation/);
  assert.match(page, /Quarantined/);
  assert.match(page, /No probe email is sent/);
  assert.match(page, /Invalid addresses remain in Quarantined and cannot be approved, scheduled, or sent/);
});

test("document and website contacts are validated before drafts are created", () => {
  assert.match(control, /await validateContactBeforeDraft\(String\(contact\.id\), email\)/);
  assert.match(control, /Email quarantined before draft generation/);
  assert.match(control, /status = 'quarantined'/);
  assert.match(control, /contactsFound: 1, draftsCreated: 0, quarantined: true/);
});

test("all approval and delivery paths enforce validation", () => {
  assert.match(control, /This address has not completed email validation/);
  assert.match(control, /\["invalid", "unknown"\]\.includes/);
  // Single/explicit-recipient paths throw via assertContactsDeliverable; bulk paths
  // (batch schedule/send/approve) silently skip undeliverable contacts via
  // filterDeliverableContacts instead of failing the whole batch — both route through
  // the same checkContactsDeliverability gate, so count them together.
  assert.ok(
    (control.match(/await assertContactsDeliverable/g) || []).length
    + (control.match(/await filterDeliverableContacts/g) || []).length >= 9,
  );
  assert.match(control, /event IN \('hardBounce', 'blocked', 'invalid', 'spam', 'unsubscribed'\)/);
});

test("hard bounces are permanently suppressed from every future campaign", () => {
  assert.match(brevoWebhook, /permanentSuppressionEvents/);
  assert.match(brevoWebhook, /INSERT INTO email_suppressions/);
  assert.match(brevoWebhook, /This address hard-bounced and is permanently suppressed/);
  assert.match(brevoWebhook, /UPDATE email_validation_results/);
  assert.match(control, /FROM email_suppressions/);
  assert.match(control, /This address is permanently suppressed/);
  assert.match(validationApi, /FROM email_suppressions/);
  assert.match(suppressionMigration, /FROM `email_analytics_events`/);
  assert.match(suppressionMigration, /WHERE `event` IN \('hardBounce', 'blocked', 'invalid', 'spam', 'unsubscribed'\)/);
  assert.match(page, /Any hard-bounced address is permanently suppressed from every future campaign/);
});

test("validation runs in durable batches and can be scheduled while the browser is closed", () => {
  assert.match(validationApi, /validationBatchSize = 100/);
  assert.match(validationApi, /Recovered after an interrupted validation batch/);
  assert.match(validationApi, /claim:\$\{crypto\.randomUUID\(\)\}/);
  assert.match(validationApi, /status IN \('queued', 'running'\)/);
  assert.match(validationApi, /email_domain_validation_cache/);
  assert.match(validationApi, /cloudflare-dns\.com\/dns-query/);
  assert.match(backgroundValidationApi, /async function runEmailValidationBatch/);
  assert.match(backgroundValidationApi, /async function continueEmailValidation/);
  assert.match(backgroundValidationApi, /async function kickNextEmailValidationBatch/);
  assert.match(startServer, /tickScheduledValidation/);
  assert.match(startServer, /setInterval/);
  assert.match(startServer, /CRON_INTERVAL_MS = 60_000/);
});
