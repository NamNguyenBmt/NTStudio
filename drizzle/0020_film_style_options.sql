ALTER TABLE `film_projects` ADD `genre` text;--> statement-breakpoint
ALTER TABLE `film_projects` ADD `visual_style` text;--> statement-breakpoint
ALTER TABLE `film_projects` ADD `dialogue_language` text DEFAULT 'Tiếng Việt' NOT NULL;--> statement-breakpoint
ALTER TABLE `film_projects` ADD `notes` text;--> statement-breakpoint
ALTER TABLE `film_projects` ADD `style_for` text;--> statement-breakpoint
ALTER TABLE `series` ADD `dialogue_language` text DEFAULT 'Tiếng Việt' NOT NULL;--> statement-breakpoint
ALTER TABLE `series` ADD `notes` text;