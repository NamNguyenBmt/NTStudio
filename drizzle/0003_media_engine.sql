ALTER TABLE `render_jobs` ADD `stage` text;--> statement-breakpoint
ALTER TABLE `render_jobs` ADD `notes` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `video_scenes` ADD `media_credit` text;