ALTER TABLE `film_assets` ADD `subtitle` text;--> statement-breakpoint
ALTER TABLE `film_assets` ADD `subtitle_src` text;--> statement-breakpoint
ALTER TABLE `film_projects` ADD `subtitle_vi` integer DEFAULT false NOT NULL;