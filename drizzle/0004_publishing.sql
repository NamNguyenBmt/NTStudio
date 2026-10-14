ALTER TABLE `scheduled_posts` ADD `permalink` text;--> statement-breakpoint
ALTER TABLE `scheduled_posts` ADD `next_attempt_at` integer;--> statement-breakpoint
ALTER TABLE `scheduled_posts` ADD `note` text;