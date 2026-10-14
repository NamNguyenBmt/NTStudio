ALTER TABLE `video_projects` ADD `acts` text;--> statement-breakpoint
ALTER TABLE `video_scenes` ADD `act` integer DEFAULT 0 NOT NULL;