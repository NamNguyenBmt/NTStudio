ALTER TABLE `video_projects` ADD `reference_images` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `video_scenes` ADD `start_image` text;--> statement-breakpoint
ALTER TABLE `video_scenes` ADD `end_image` text;--> statement-breakpoint
ALTER TABLE `video_scenes` ADD `scene_refs` text;