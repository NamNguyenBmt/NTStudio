CREATE TABLE `film_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`film_id` text NOT NULL,
	`kind` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`name` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`character_ids` text DEFAULT '[]' NOT NULL,
	`location_id` text,
	`camera` text DEFAULT '' NOT NULL,
	`duration_sec` integer DEFAULT 6 NOT NULL,
	`dialogue` text,
	`selected_take_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`film_id`) REFERENCES `film_projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `film_assets_film_idx` ON `film_assets` (`film_id`,`kind`,`position`);--> statement-breakpoint
CREATE TABLE `film_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text,
	`title` text NOT NULL,
	`idea` text DEFAULT '' NOT NULL,
	`logline` text,
	`style` text DEFAULT '' NOT NULL,
	`aspect` text DEFAULT '16:9' NOT NULL,
	`target_sec` integer DEFAULT 120 NOT NULL,
	`video_engine` text DEFAULT 'seedance' NOT NULL,
	`image_engine` text DEFAULT 'google' NOT NULL,
	`takes_per_run` integer DEFAULT 2 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `film_takes` (
	`id` text PRIMARY KEY NOT NULL,
	`film_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`file` text,
	`prompt` text NOT NULL,
	`refs` text DEFAULT '[]' NOT NULL,
	`model` text,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`error` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`not_before` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	FOREIGN KEY (`film_id`) REFERENCES `film_projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `film_assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `film_takes_queue_idx` ON `film_takes` (`status`,`kind`,`created_at`);--> statement-breakpoint
CREATE INDEX `film_takes_asset_idx` ON `film_takes` (`asset_id`);