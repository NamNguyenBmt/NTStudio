ALTER TABLE `film_assets` ADD `voice_profile` text;--> statement-breakpoint
ALTER TABLE `film_assets` ADD `voice_provider` text;--> statement-breakpoint
ALTER TABLE `film_assets` ADD `voice_id` text;--> statement-breakpoint
ALTER TABLE `film_projects` ADD `voice_mode` text DEFAULT 'clip' NOT NULL;--> statement-breakpoint
ALTER TABLE `series_characters` ADD `voice_provider` text;--> statement-breakpoint
ALTER TABLE `series_characters` ADD `voice_profile` text;