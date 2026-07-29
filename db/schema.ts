import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const backgroundResearchJobs = sqliteTable("background_research_jobs", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id").notNull(),
  campaignName: text("campaign_name").notNull(),
  topic: text("topic").notNull(),
  emailTemplate: text("email_template").notNull(),
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
