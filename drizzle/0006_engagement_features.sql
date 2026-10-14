ALTER TABLE `content_items` ADD `first_comment` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `ai_note` text;--> statement-breakpoint
ALTER TABLE `scheduled_posts` ADD `reach` integer;--> statement-breakpoint
ALTER TABLE `scheduled_posts` ADD `views` integer;--> statement-breakpoint
ALTER TABLE `scheduled_posts` ADD `engagements` integer;--> statement-breakpoint
ALTER TABLE `scheduled_posts` ADD `metrics_at` integer;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `knowledge` text;