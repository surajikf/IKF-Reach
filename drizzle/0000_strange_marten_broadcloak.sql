CREATE TABLE `background_research_items` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`input_type` text NOT NULL,
	`input_value` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`claimed_by` text,
	`result` text,
	`error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `background_research_items_job_input_uidx` ON `background_research_items` (`job_id`,`input_type`,`input_value`);--> statement-breakpoint
CREATE INDEX `background_research_items_job_status_idx` ON `background_research_items` (`job_id`,`status`);--> statement-breakpoint
CREATE TABLE `background_research_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`campaign_name` text NOT NULL,
	`topic` text NOT NULL,
	`email_template` text NOT NULL,
	`brief` text,
	`created_by` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`total_items` integer DEFAULT 0 NOT NULL,
	`completed_items` integer DEFAULT 0 NOT NULL,
	`successful_items` integer DEFAULT 0 NOT NULL,
	`failed_items` integer DEFAULT 0 NOT NULL,
	`drafts_created` integer DEFAULT 0 NOT NULL,
	`contacts_found` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`created_at` text NOT NULL,
	`started_at` text,
	`completed_at` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `background_research_jobs_status_idx` ON `background_research_jobs` (`status`);--> statement-breakpoint
CREATE INDEX `background_research_jobs_campaign_idx` ON `background_research_jobs` (`campaign_id`);