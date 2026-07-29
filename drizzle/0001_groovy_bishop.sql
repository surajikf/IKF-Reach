CREATE TABLE `email_analytics_events` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_event_key` text NOT NULL,
	`campaign_id` text,
	`generated_email_id` text,
	`email_send_id` text,
	`message_id` text,
	`recipient_email` text NOT NULL,
	`sender_email` text,
	`subject` text,
	`event` text NOT NULL,
	`event_at` text NOT NULL,
	`ip_address` text,
	`link` text,
	`reason` text,
	`tag` text,
	`payload` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_analytics_events_provider_uidx` ON `email_analytics_events` (`provider_event_key`);--> statement-breakpoint
CREATE INDEX `email_analytics_events_campaign_idx` ON `email_analytics_events` (`campaign_id`);--> statement-breakpoint
CREATE INDEX `email_analytics_events_recipient_idx` ON `email_analytics_events` (`recipient_email`);--> statement-breakpoint
CREATE INDEX `email_analytics_events_date_idx` ON `email_analytics_events` (`event_at`);--> statement-breakpoint
CREATE INDEX `email_analytics_events_message_idx` ON `email_analytics_events` (`message_id`);