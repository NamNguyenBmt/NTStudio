ALTER TABLE `workspaces` ADD `watermark_opacity` real DEFAULT 0.85 NOT NULL;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `tags` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `ai_budget_usd` real;