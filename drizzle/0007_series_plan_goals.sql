CREATE TABLE `channel_goals` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`metric` text NOT NULL,
	`target` integer NOT NULL,
	`label` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `channel_goals_channel_idx` ON `channel_goals` (`channel_id`);--> statement-breakpoint
CREATE TABLE `content_ideas` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text,
	`planned_date` text,
	`title` text NOT NULL,
	`format` text DEFAULT 'free' NOT NULL,
	`hook` text,
	`description` text,
	`status` text DEFAULT 'idea' NOT NULL,
	`project_id` text,
	`content_item_id` text,
	`source` text DEFAULT 'manual' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `video_projects`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`content_item_id`) REFERENCES `content_items`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `content_ideas_date_idx` ON `content_ideas` (`workspace_id`,`planned_date`);--> statement-breakpoint
CREATE TABLE `series` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text,
	`title` text NOT NULL,
	`logline` text,
	`genre` text,
	`visual_style` text,
	`episode_length_sec` integer DEFAULT 60 NOT NULL,
	`tts_provider` text DEFAULT 'edge_tts' NOT NULL,
	`narrator_voice_id` text,
	`render_mode` text DEFAULT 'semi_ai' NOT NULL,
	`target_channel_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`target_channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `series_characters` (
	`id` text PRIMARY KEY NOT NULL,
	`series_id` text NOT NULL,
	`name` text NOT NULL,
	`role` text,
	`appearance` text DEFAULT '' NOT NULL,
	`personality` text,
	`voice_id` text,
	`reference_image` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `series_characters_series_idx` ON `series_characters` (`series_id`);--> statement-breakpoint
CREATE TABLE `series_episodes` (
	`id` text PRIMARY KEY NOT NULL,
	`series_id` text NOT NULL,
	`number` integer NOT NULL,
	`title` text NOT NULL,
	`synopsis` text DEFAULT '' NOT NULL,
	`cliffhanger` text,
	`project_id` text,
	`status` text DEFAULT 'planned' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `video_projects`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `series_episodes_number_uq` ON `series_episodes` (`series_id`,`number`);--> statement-breakpoint
ALTER TABLE `channel_metrics_daily` ADD `watch_minutes` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `scheduled_posts` ADD `avg_watch_sec` real;--> statement-breakpoint
ALTER TABLE `video_projects` ADD `format` text;--> statement-breakpoint
ALTER TABLE `video_scenes` ADD `speaker_id` text;--> statement-breakpoint
ALTER TABLE `video_scenes` ADD `voice_id` text;