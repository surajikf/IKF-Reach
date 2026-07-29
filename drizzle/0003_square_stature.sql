ALTER TABLE `background_research_jobs` ADD `email_template_format` text DEFAULT 'legacy_text_v1' NOT NULL;--> statement-breakpoint
ALTER TABLE `background_research_jobs` ADD `email_template_text` text;--> statement-breakpoint
ALTER TABLE `background_research_jobs` ADD `template_version` integer DEFAULT 1 NOT NULL;