CREATE TABLE `email_domain_validation_cache` (
	`domain` text PRIMARY KEY NOT NULL,
	`reachable` integer,
	`mx_records` text NOT NULL,
	`fallback_address_record` integer DEFAULT 0 NOT NULL,
	`error` text,
	`checked_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `email_validation_items` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`email` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`verdict` text,
	`score` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	`error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_validation_items_job_contact_uidx` ON `email_validation_items` (`job_id`,`contact_id`);--> statement-breakpoint
CREATE INDEX `email_validation_items_job_status_idx` ON `email_validation_items` (`job_id`,`status`);--> statement-breakpoint
CREATE INDEX `email_validation_items_email_idx` ON `email_validation_items` (`email`);--> statement-breakpoint
CREATE TABLE `email_validation_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`scheduled_for` text,
	`total_items` integer DEFAULT 0 NOT NULL,
	`processed_items` integer DEFAULT 0 NOT NULL,
	`valid_items` integer DEFAULT 0 NOT NULL,
	`risky_items` integer DEFAULT 0 NOT NULL,
	`invalid_items` integer DEFAULT 0 NOT NULL,
	`unknown_items` integer DEFAULT 0 NOT NULL,
	`failed_items` integer DEFAULT 0 NOT NULL,
	`created_by` text NOT NULL,
	`last_error` text,
	`cancel_requested` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`started_at` text,
	`completed_at` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `email_validation_jobs_status_idx` ON `email_validation_jobs` (`status`);--> statement-breakpoint
CREATE INDEX `email_validation_jobs_schedule_idx` ON `email_validation_jobs` (`scheduled_for`);--> statement-breakpoint
CREATE TABLE `email_validation_results` (
	`contact_id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`normalized_email` text NOT NULL,
	`domain` text NOT NULL,
	`verdict` text NOT NULL,
	`score` integer NOT NULL,
	`syntax_valid` integer NOT NULL,
	`domain_reachable` integer,
	`role_based` integer DEFAULT 0 NOT NULL,
	`disposable` integer DEFAULT 0 NOT NULL,
	`previous_hard_bounce` integer DEFAULT 0 NOT NULL,
	`previous_soft_bounce` integer DEFAULT 0 NOT NULL,
	`previous_delivered` integer DEFAULT 0 NOT NULL,
	`complaint` integer DEFAULT 0 NOT NULL,
	`unsubscribed` integer DEFAULT 0 NOT NULL,
	`reasons` text NOT NULL,
	`mx_records` text NOT NULL,
	`job_id` text NOT NULL,
	`validated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `email_validation_results_email_idx` ON `email_validation_results` (`normalized_email`);--> statement-breakpoint
CREATE INDEX `email_validation_results_verdict_idx` ON `email_validation_results` (`verdict`);