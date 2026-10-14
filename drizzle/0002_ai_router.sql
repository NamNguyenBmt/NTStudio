CREATE TABLE `content_variants` (
	`id` text PRIMARY KEY NOT NULL,
	`content_item_id` text NOT NULL,
	`caption` text NOT NULL,
	`hashtags` text DEFAULT '[]' NOT NULL,
	`model` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`content_item_id`) REFERENCES `content_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `variants_content_idx` ON `content_variants` (`content_item_id`);--> statement-breakpoint
ALTER TABLE `ai_providers` ADD `last_latency_ms` integer;--> statement-breakpoint
ALTER TABLE `ai_providers` ADD `last_error` text;