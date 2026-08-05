CREATE TABLE IF NOT EXISTS `zoho_thread_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`generated_email_id` text,
	`email_send_id` text,
	`recipient_email` text NOT NULL,
	`subject` text NOT NULL,
	`zoho_message_id` text NOT NULL,
	`original_zoho_message_id` text,
	`latest_zoho_message_id` text,
	`zoho_thread_id` text,
	`direction` text DEFAULT 'outbound' NOT NULL,
	`replied` integer DEFAULT 0 NOT NULL,
	`sent_at` text,
	`last_synced_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS `zoho_thread_messages_campaign_recipient_uidx` ON `zoho_thread_messages` (`campaign_id`,`recipient_email`);
CREATE INDEX IF NOT EXISTS `zoho_thread_messages_message_idx` ON `zoho_thread_messages` (`zoho_message_id`);

CREATE TABLE IF NOT EXISTS `followup_sequences` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`campaign_name` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`mode` text DEFAULT 'reply_thread' NOT NULL,
	`exclude_replied` integer DEFAULT 1 NOT NULL,
	`total_recipients` integer DEFAULT 0 NOT NULL,
	`eligible_recipients` integer DEFAULT 0 NOT NULL,
	`excluded_recipients` integer DEFAULT 0 NOT NULL,
	`sent_count` integer DEFAULT 0 NOT NULL,
	`failed_count` integer DEFAULT 0 NOT NULL,
	`cancel_requested` integer DEFAULT 0 NOT NULL,
	`scheduled_for` text,
	`created_by` text NOT NULL,
	`approved_at` text,
	`started_at` text,
	`completed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
CREATE INDEX IF NOT EXISTS `followup_sequences_campaign_idx` ON `followup_sequences` (`campaign_id`);
CREATE INDEX IF NOT EXISTS `followup_sequences_status_idx` ON `followup_sequences` (`status`);
CREATE INDEX IF NOT EXISTS `followup_sequences_schedule_idx` ON `followup_sequences` (`scheduled_for`);

CREATE TABLE IF NOT EXISTS `followup_stages` (
	`id` text PRIMARY KEY NOT NULL,
	`sequence_id` text NOT NULL,
	`position` integer NOT NULL,
	`subject` text NOT NULL,
	`html_template` text NOT NULL,
	`delay_minutes` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS `followup_stages_sequence_position_uidx` ON `followup_stages` (`sequence_id`,`position`);

CREATE TABLE IF NOT EXISTS `followup_recipients` (
	`id` text PRIMARY KEY NOT NULL,
	`sequence_id` text NOT NULL,
	`generated_email_id` text,
	`contact_id` text,
	`recipient_email` text NOT NULL,
	`company_name` text,
	`contact_name` text,
	`original_subject` text NOT NULL,
	`zoho_message_id` text,
	`status` text DEFAULT 'eligible' NOT NULL,
	`exclusion_reason` text,
	`current_stage` integer DEFAULT 0 NOT NULL,
	`next_run_at` text,
	`last_error` text,
	`replied` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS `followup_recipients_sequence_email_uidx` ON `followup_recipients` (`sequence_id`,`recipient_email`);
CREATE INDEX IF NOT EXISTS `followup_recipients_due_idx` ON `followup_recipients` (`status`,`next_run_at`);

CREATE TABLE IF NOT EXISTS `followup_events` (
	`id` text PRIMARY KEY NOT NULL,
	`sequence_id` text NOT NULL,
	`recipient_id` text,
	`stage_position` integer,
	`event` text NOT NULL,
	`detail` text,
	`message_id` text,
	`created_at` text NOT NULL
);
CREATE INDEX IF NOT EXISTS `followup_events_sequence_idx` ON `followup_events` (`sequence_id`);
CREATE INDEX IF NOT EXISTS `followup_events_recipient_idx` ON `followup_events` (`recipient_id`);
