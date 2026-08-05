import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const backgroundResearchJobs = sqliteTable("background_research_jobs", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id").notNull(),
  campaignName: text("campaign_name").notNull(),
  topic: text("topic").notNull(),
  emailTemplate: text("email_template").notNull(),
  emailTemplateFormat: text("email_template_format").notNull().default("legacy_text_v1"),
  emailTemplateText: text("email_template_text"),
  templateVersion: integer("template_version").notNull().default(1),
  brief: text("brief"),
  createdBy: text("created_by").notNull(),
  status: text("status").notNull().default("queued"),
  totalItems: integer("total_items").notNull().default(0),
  completedItems: integer("completed_items").notNull().default(0),
  successfulItems: integer("successful_items").notNull().default(0),
  failedItems: integer("failed_items").notNull().default(0),
  draftsCreated: integer("drafts_created").notNull().default(0),
  contactsFound: integer("contacts_found").notNull().default(0),
  lastError: text("last_error"),
  createdAt: text("created_at").notNull(),
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("background_research_jobs_status_idx").on(table.status),
  index("background_research_jobs_campaign_idx").on(table.campaignId),
]);

export const backgroundResearchItems = sqliteTable("background_research_items", {
  id: text("id").primaryKey(),
  jobId: text("job_id").notNull(),
  inputType: text("input_type").notNull(),
  inputValue: text("input_value").notNull(),
  payload: text("payload").notNull(),
  status: text("status").notNull().default("queued"),
  attempts: integer("attempts").notNull().default(0),
  claimedBy: text("claimed_by"),
  result: text("result"),
  error: text("error"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("background_research_items_job_input_uidx").on(table.jobId, table.inputType, table.inputValue),
  index("background_research_items_job_status_idx").on(table.jobId, table.status),
]);

export const emailAnalyticsEvents = sqliteTable("email_analytics_events", {
  id: text("id").primaryKey(),
  providerEventKey: text("provider_event_key").notNull(),
  campaignId: text("campaign_id"),
  generatedEmailId: text("generated_email_id"),
  emailSendId: text("email_send_id"),
  messageId: text("message_id"),
  recipientEmail: text("recipient_email").notNull(),
  senderEmail: text("sender_email"),
  subject: text("subject"),
  event: text("event").notNull(),
  eventAt: text("event_at").notNull(),
  ipAddress: text("ip_address"),
  link: text("link"),
  reason: text("reason"),
  tag: text("tag"),
  payload: text("payload").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("email_analytics_events_provider_uidx").on(table.providerEventKey),
  index("email_analytics_events_campaign_idx").on(table.campaignId),
  index("email_analytics_events_recipient_idx").on(table.recipientEmail),
  index("email_analytics_events_date_idx").on(table.eventAt),
  index("email_analytics_events_message_idx").on(table.messageId),
]);

export const emailSuppressions = sqliteTable("email_suppressions", {
  normalizedEmail: text("normalized_email").primaryKey(),
  sourceEvent: text("source_event").notNull(),
  reason: text("reason").notNull(),
  messageId: text("message_id"),
  firstSeenAt: text("first_seen_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
  active: integer("active").notNull().default(1),
}, (table) => [
  index("email_suppressions_active_idx").on(table.active),
  index("email_suppressions_event_idx").on(table.sourceEvent),
]);

export const emailValidationJobs = sqliteTable("email_validation_jobs", {
  id: text("id").primaryKey(),
  status: text("status").notNull().default("queued"),
  scheduledFor: text("scheduled_for"),
  totalItems: integer("total_items").notNull().default(0),
  processedItems: integer("processed_items").notNull().default(0),
  validItems: integer("valid_items").notNull().default(0),
  riskyItems: integer("risky_items").notNull().default(0),
  invalidItems: integer("invalid_items").notNull().default(0),
  unknownItems: integer("unknown_items").notNull().default(0),
  failedItems: integer("failed_items").notNull().default(0),
  createdBy: text("created_by").notNull(),
  lastError: text("last_error"),
  cancelRequested: integer("cancel_requested").notNull().default(0),
  createdAt: text("created_at").notNull(),
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("email_validation_jobs_status_idx").on(table.status),
  index("email_validation_jobs_schedule_idx").on(table.scheduledFor),
]);

export const emailValidationItems = sqliteTable("email_validation_items", {
  id: text("id").primaryKey(),
  jobId: text("job_id").notNull(),
  contactId: text("contact_id").notNull(),
  email: text("email").notNull(),
  status: text("status").notNull().default("queued"),
  verdict: text("verdict"),
  score: integer("score"),
  attempts: integer("attempts").notNull().default(0),
  error: text("error"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("email_validation_items_job_contact_uidx").on(table.jobId, table.contactId),
  index("email_validation_items_job_status_idx").on(table.jobId, table.status),
  index("email_validation_items_email_idx").on(table.email),
]);

export const emailValidationResults = sqliteTable("email_validation_results", {
  contactId: text("contact_id").primaryKey(),
  email: text("email").notNull(),
  normalizedEmail: text("normalized_email").notNull(),
  domain: text("domain").notNull(),
  verdict: text("verdict").notNull(),
  score: integer("score").notNull(),
  syntaxValid: integer("syntax_valid").notNull(),
  domainReachable: integer("domain_reachable"),
  roleBased: integer("role_based").notNull().default(0),
  disposable: integer("disposable").notNull().default(0),
  previousHardBounce: integer("previous_hard_bounce").notNull().default(0),
  previousSoftBounce: integer("previous_soft_bounce").notNull().default(0),
  previousDelivered: integer("previous_delivered").notNull().default(0),
  complaint: integer("complaint").notNull().default(0),
  unsubscribed: integer("unsubscribed").notNull().default(0),
  reasons: text("reasons").notNull(),
  mxRecords: text("mx_records").notNull(),
  jobId: text("job_id").notNull(),
  validatedAt: text("validated_at").notNull(),
}, (table) => [
  index("email_validation_results_email_idx").on(table.normalizedEmail),
  index("email_validation_results_verdict_idx").on(table.verdict),
]);

export const emailDomainValidationCache = sqliteTable("email_domain_validation_cache", {
  domain: text("domain").primaryKey(),
  reachable: integer("reachable"),
  mxRecords: text("mx_records").notNull(),
  fallbackAddressRecord: integer("fallback_address_record").notNull().default(0),
  error: text("error"),
  checkedAt: text("checked_at").notNull(),
});

export const appUsers = sqliteTable("app_users", {
  email: text("email").primaryKey(),
  status: text("status").notNull().default("pending"), // pending, approved, rejected
  role: text("role").notNull().default("user"), // user, admin
  createdAt: text("created_at").notNull(),
});

export const zohoThreadMessages = sqliteTable("zoho_thread_messages", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id").notNull(),
  generatedEmailId: text("generated_email_id"),
  emailSendId: text("email_send_id"),
  recipientEmail: text("recipient_email").notNull(),
  subject: text("subject").notNull(),
  zohoMessageId: text("zoho_message_id").notNull(),
  originalZohoMessageId: text("original_zoho_message_id"),
  latestZohoMessageId: text("latest_zoho_message_id"),
  zohoThreadId: text("zoho_thread_id"),
  direction: text("direction").notNull().default("outbound"),
  replied: integer("replied").notNull().default(0),
  sentAt: text("sent_at"),
  lastSyncedAt: text("last_synced_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("zoho_thread_messages_campaign_recipient_uidx").on(table.campaignId, table.recipientEmail),
  index("zoho_thread_messages_message_idx").on(table.zohoMessageId),
]);

export const followupSequences = sqliteTable("followup_sequences", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id").notNull(),
  campaignName: text("campaign_name").notNull(),
  name: text("name").notNull(),
  status: text("status").notNull().default("draft"),
  mode: text("mode").notNull().default("reply_thread"),
  excludeReplied: integer("exclude_replied").notNull().default(1),
  totalRecipients: integer("total_recipients").notNull().default(0),
  eligibleRecipients: integer("eligible_recipients").notNull().default(0),
  excludedRecipients: integer("excluded_recipients").notNull().default(0),
  sentCount: integer("sent_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  cancelRequested: integer("cancel_requested").notNull().default(0),
  scheduledFor: text("scheduled_for"),
  createdBy: text("created_by").notNull(),
  approvedAt: text("approved_at"),
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("followup_sequences_campaign_idx").on(table.campaignId),
  index("followup_sequences_status_idx").on(table.status),
  index("followup_sequences_schedule_idx").on(table.scheduledFor),
]);

export const followupStages = sqliteTable("followup_stages", {
  id: text("id").primaryKey(),
  sequenceId: text("sequence_id").notNull(),
  position: integer("position").notNull(),
  subject: text("subject").notNull(),
  htmlTemplate: text("html_template").notNull(),
  delayMinutes: integer("delay_minutes").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("followup_stages_sequence_position_uidx").on(table.sequenceId, table.position),
]);

export const followupRecipients = sqliteTable("followup_recipients", {
  id: text("id").primaryKey(),
  sequenceId: text("sequence_id").notNull(),
  generatedEmailId: text("generated_email_id"),
  contactId: text("contact_id"),
  recipientEmail: text("recipient_email").notNull(),
  companyName: text("company_name"),
  contactName: text("contact_name"),
  originalSubject: text("original_subject").notNull(),
  zohoMessageId: text("zoho_message_id"),
  status: text("status").notNull().default("eligible"),
  exclusionReason: text("exclusion_reason"),
  currentStage: integer("current_stage").notNull().default(0),
  nextRunAt: text("next_run_at"),
  lastError: text("last_error"),
  replied: integer("replied").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("followup_recipients_sequence_email_uidx").on(table.sequenceId, table.recipientEmail),
  index("followup_recipients_due_idx").on(table.status, table.nextRunAt),
]);

export const followupEvents = sqliteTable("followup_events", {
  id: text("id").primaryKey(),
  sequenceId: text("sequence_id").notNull(),
  recipientId: text("recipient_id"),
  stagePosition: integer("stage_position"),
  event: text("event").notNull(),
  detail: text("detail"),
  messageId: text("message_id"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("followup_events_sequence_idx").on(table.sequenceId),
  index("followup_events_recipient_idx").on(table.recipientId),
]);
