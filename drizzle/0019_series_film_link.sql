ALTER TABLE `film_assets` ADD `series_character_id` text REFERENCES series_characters(id) ON UPDATE no action ON DELETE set null;--> statement-breakpoint
ALTER TABLE `film_assets` ADD `proposal` text;--> statement-breakpoint
ALTER TABLE `film_assets` ADD `proposed_scope` text;--> statement-breakpoint
ALTER TABLE `film_assets` ADD `proposal_reason` text;--> statement-breakpoint
ALTER TABLE `film_projects` ADD `series_id` text REFERENCES series(id) ON UPDATE no action ON DELETE set null;--> statement-breakpoint
ALTER TABLE `film_projects` ADD `episode_id` text REFERENCES series_episodes(id) ON UPDATE no action ON DELETE set null;--> statement-breakpoint
ALTER TABLE `series` ADD `production_mode` text DEFAULT 'video' NOT NULL;--> statement-breakpoint
ALTER TABLE `series_characters` ADD `arc` text;--> statement-breakpoint
ALTER TABLE `series_episodes` ADD `film_id` text;