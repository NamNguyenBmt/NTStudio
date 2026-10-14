ALTER TABLE `film_assets` ADD `selected_video_take_id` text;--> statement-breakpoint
ALTER TABLE `film_projects` ADD `video_resolution` text DEFAULT '720p' NOT NULL;--> statement-breakpoint
ALTER TABLE `film_projects` ADD `video_audio` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `film_projects` ADD `video_tier` text DEFAULT 'fast' NOT NULL;--> statement-breakpoint
ALTER TABLE `film_takes` ADD `duration_sec` integer;