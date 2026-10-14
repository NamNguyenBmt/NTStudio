ALTER TABLE `messages` ADD `action` text DEFAULT 'message' NOT NULL;--> statement-breakpoint
ALTER TABLE `messages` ADD `target_id` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `rule_id` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `send_after` integer;--> statement-breakpoint
ALTER TABLE `messages` ADD `attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `messages` ADD `error` text;--> statement-breakpoint
CREATE INDEX `messages_external_idx` ON `messages` (`external_id`);--> statement-breakpoint
CREATE INDEX `messages_outbox_idx` ON `messages` (`delivery_status`,`send_after`);