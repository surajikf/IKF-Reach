CREATE TABLE `email_suppressions` (
	`normalized_email` text PRIMARY KEY NOT NULL,
	`source_event` text NOT NULL,
	`reason` text NOT NULL,
	`message_id` text,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `email_suppressions_active_idx` ON `email_suppressions` (`active`);--> statement-breakpoint
CREATE INDEX `email_suppressions_event_idx` ON `email_suppressions` (`source_event`);--> statement-breakpoint
INSERT OR IGNORE INTO `email_suppressions` (
	`normalized_email`,
	`source_event`,
	`reason`,
	`message_id`,
	`first_seen_at`,
	`last_seen_at`,
	`active`
)
SELECT
	lower(trim(`recipient_email`)),
	CASE
		WHEN max(CASE WHEN `event` = 'hardBounce' THEN 1 ELSE 0 END) = 1 THEN 'hardBounce'
		WHEN max(CASE WHEN `event` = 'spam' THEN 1 ELSE 0 END) = 1 THEN 'spam'
		WHEN max(CASE WHEN `event` = 'unsubscribed' THEN 1 ELSE 0 END) = 1 THEN 'unsubscribed'
		WHEN max(CASE WHEN `event` = 'blocked' THEN 1 ELSE 0 END) = 1 THEN 'blocked'
		ELSE 'invalid'
	END,
	CASE
		WHEN max(CASE WHEN `event` = 'hardBounce' THEN 1 ELSE 0 END) = 1 THEN 'This address hard-bounced and is permanently suppressed.'
		WHEN max(CASE WHEN `event` = 'spam' THEN 1 ELSE 0 END) = 1 THEN 'A spam complaint was recorded. This address is permanently suppressed.'
		WHEN max(CASE WHEN `event` = 'unsubscribed' THEN 1 ELSE 0 END) = 1 THEN 'The recipient unsubscribed. This address is permanently suppressed.'
		ELSE 'This address was rejected and is permanently suppressed.'
	END,
	max(`message_id`),
	min(`event_at`),
	max(`event_at`),
	1
FROM `email_analytics_events`
WHERE `event` IN ('hardBounce', 'blocked', 'invalid', 'spam', 'unsubscribed')
	AND trim(`recipient_email`) != ''
GROUP BY lower(trim(`recipient_email`));--> statement-breakpoint
UPDATE `email_validation_results`
SET
	`verdict` = 'invalid',
	`score` = 0,
	`previous_hard_bounce` = CASE
		WHEN EXISTS (
			SELECT 1
			FROM `email_suppressions`
			WHERE `email_suppressions`.`normalized_email` = `email_validation_results`.`normalized_email`
				AND `email_suppressions`.`source_event` IN ('hardBounce', 'blocked', 'invalid')
		) THEN 1
		ELSE `previous_hard_bounce`
	END,
	`complaint` = CASE
		WHEN EXISTS (
			SELECT 1
			FROM `email_suppressions`
			WHERE `email_suppressions`.`normalized_email` = `email_validation_results`.`normalized_email`
				AND `email_suppressions`.`source_event` = 'spam'
		) THEN 1
		ELSE `complaint`
	END,
	`unsubscribed` = CASE
		WHEN EXISTS (
			SELECT 1
			FROM `email_suppressions`
			WHERE `email_suppressions`.`normalized_email` = `email_validation_results`.`normalized_email`
				AND `email_suppressions`.`source_event` = 'unsubscribed'
		) THEN 1
		ELSE `unsubscribed`
	END,
	`reasons` = (
		SELECT json_array(`email_suppressions`.`reason`)
		FROM `email_suppressions`
		WHERE `email_suppressions`.`normalized_email` = `email_validation_results`.`normalized_email`
		LIMIT 1
	),
	`job_id` = 'suppression-backfill',
	`validated_at` = (
		SELECT `email_suppressions`.`last_seen_at`
		FROM `email_suppressions`
		WHERE `email_suppressions`.`normalized_email` = `email_validation_results`.`normalized_email`
		LIMIT 1
	)
WHERE EXISTS (
	SELECT 1
	FROM `email_suppressions`
	WHERE `email_suppressions`.`normalized_email` = `email_validation_results`.`normalized_email`
		AND `email_suppressions`.`active` = 1
);
