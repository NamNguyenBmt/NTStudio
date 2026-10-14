CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text,
	`platform` text NOT NULL,
	`display_name` text NOT NULL,
	`handle` text,
	`external_id` text,
	`avatar_url` text,
	`proxy_id` text,
	`browser_profile_id` text,
	`two_factor_enabled` integer DEFAULT false NOT NULL,
	`session_status` text DEFAULT 'unknown' NOT NULL,
	`session_expires_at` integer,
	`health` text DEFAULT 'idle' NOT NULL,
	`note` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`proxy_id`) REFERENCES `proxies`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`browser_profile_id`) REFERENCES `browser_profiles`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `accounts_workspace_idx` ON `accounts` (`workspace_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_platform_external_uq` ON `accounts` (`platform`,`external_id`);--> statement-breakpoint
CREATE TABLE `activity_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`level` text NOT NULL,
	`scope` text NOT NULL,
	`message` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `activity_created_idx` ON `activity_log` (`created_at`);--> statement-breakpoint
CREATE TABLE `ai_providers` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`category` text NOT NULL,
	`label` text NOT NULL,
	`default_model` text,
	`base_url` text,
	`enabled` integer DEFAULT true NOT NULL,
	`status` text DEFAULT 'untested' NOT NULL,
	`last_tested_at` integer,
	`priority` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ai_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text,
	`workspace_id` text,
	`model` text,
	`feature` text,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`characters` integer DEFAULT 0 NOT NULL,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`ok` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`provider_id`) REFERENCES `ai_providers`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `ai_usage_created_idx` ON `ai_usage` (`created_at`);--> statement-breakpoint
CREATE TABLE `alerts` (
	`id` text PRIMARY KEY NOT NULL,
	`severity` text NOT NULL,
	`kind` text NOT NULL,
	`entity_type` text,
	`entity_id` text,
	`title` text NOT NULL,
	`message` text NOT NULL,
	`resolved_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `alerts_open_idx` ON `alerts` (`resolved_at`,`created_at`);--> statement-breakpoint
CREATE TABLE `auto_reply_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text,
	`channel_id` text,
	`name` text NOT NULL,
	`keywords` text DEFAULT '[]' NOT NULL,
	`action` text NOT NULL,
	`template` text,
	`min_delay_sec` integer DEFAULT 15 NOT NULL,
	`max_delay_sec` integer DEFAULT 35 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `browser_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text,
	`name` text NOT NULL,
	`user_agent` text,
	`locale` text DEFAULT 'vi-VN',
	`timezone` text DEFAULT 'Asia/Ho_Chi_Minh',
	`canvas_noise` integer DEFAULT true NOT NULL,
	`webrtc_shield` integer DEFAULT true NOT NULL,
	`webgl_vendor` text,
	`data_dir` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `channel_metrics_daily` (
	`channel_id` text NOT NULL,
	`day` text NOT NULL,
	`views` integer DEFAULT 0 NOT NULL,
	`engagements` integer DEFAULT 0 NOT NULL,
	`followers` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `channel_metrics_day_uq` ON `channel_metrics_daily` (`channel_id`,`day`);--> statement-breakpoint
CREATE TABLE `channels` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text,
	`account_id` text NOT NULL,
	`platform` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`handle` text,
	`external_id` text,
	`avatar_url` text,
	`role` text,
	`followers` integer DEFAULT 0 NOT NULL,
	`niche_tag` text,
	`token_status` text DEFAULT 'missing' NOT NULL,
	`token_expires_at` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`health` text DEFAULT 'idle' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `channels_workspace_idx` ON `channels` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `channels_account_idx` ON `channels` (`account_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `channels_platform_external_uq` ON `channels` (`platform`,`external_id`);--> statement-breakpoint
CREATE TABLE `content_items` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`caption` text,
	`hashtags` text DEFAULT '[]' NOT NULL,
	`media_paths` text DEFAULT '[]' NOT NULL,
	`thumbnail_path` text,
	`duration_sec` real,
	`aspect` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`spin_variants` integer DEFAULT 0 NOT NULL,
	`ai_reviewed` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `content_workspace_idx` ON `content_items` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `content_status_idx` ON `content_items` (`status`);--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text,
	`channel_id` text NOT NULL,
	`platform` text NOT NULL,
	`source` text NOT NULL,
	`external_id` text,
	`customer_name` text NOT NULL,
	`customer_external_id` text,
	`customer_avatar_url` text,
	`context_post_id` text,
	`context_post_title` text,
	`tags` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`unread_count` integer DEFAULT 0 NOT NULL,
	`last_message_at` integer,
	`last_message_preview` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `conversations_last_idx` ON `conversations` (`last_message_at`);--> statement-breakpoint
CREATE INDEX `conversations_channel_idx` ON `conversations` (`channel_id`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`direction` text NOT NULL,
	`author` text NOT NULL,
	`body` text NOT NULL,
	`attachments` text DEFAULT '[]' NOT NULL,
	`external_id` text,
	`delivery_status` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `messages_conversation_idx` ON `messages` (`conversation_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `proxies` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text,
	`label` text NOT NULL,
	`protocol` text DEFAULT 'socks5' NOT NULL,
	`host` text NOT NULL,
	`port` integer NOT NULL,
	`username` text,
	`password_secret_id` text,
	`country` text,
	`kind` text,
	`exit_ip` text,
	`latency_ms` integer,
	`health` text DEFAULT 'idle' NOT NULL,
	`last_checked_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `proxies_workspace_idx` ON `proxies` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `quick_replies` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text,
	`shortcut` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `render_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`encoder` text,
	`progress` real DEFAULT 0 NOT NULL,
	`output_path` text,
	`error` text,
	`started_at` integer,
	`finished_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `video_projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `render_jobs_status_idx` ON `render_jobs` (`status`);--> statement-breakpoint
CREATE TABLE `scheduled_posts` (
	`id` text PRIMARY KEY NOT NULL,
	`content_item_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`scheduled_at` integer NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`is_golden_hour` integer DEFAULT false NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`published_at` integer,
	`external_post_id` text,
	`error` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`content_item_id`) REFERENCES `content_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `posts_scheduled_idx` ON `scheduled_posts` (`scheduled_at`);--> statement-breakpoint
CREATE INDEX `posts_channel_idx` ON `scheduled_posts` (`channel_id`);--> statement-breakpoint
CREATE TABLE `secrets` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`owner_type` text NOT NULL,
	`owner_id` text NOT NULL,
	`ciphertext` text NOT NULL,
	`iv` text NOT NULL,
	`auth_tag` text NOT NULL,
	`preview` text,
	`expires_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `secrets_owner_kind_uq` ON `secrets` (`owner_type`,`owner_id`,`kind`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `video_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text,
	`content_item_id` text,
	`target_channel_id` text,
	`topic` text NOT NULL,
	`target_duration_sec` integer DEFAULT 30 NOT NULL,
	`tts_provider` text DEFAULT 'edge_tts' NOT NULL,
	`voice_id` text,
	`render_mode` text DEFAULT 'stock' NOT NULL,
	`subtitle_style` text DEFAULT 'montserrat-kara-pop' NOT NULL,
	`bgm_track` text,
	`bgm_volume` real DEFAULT 0.15 NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`content_item_id`) REFERENCES `content_items`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`target_channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `video_scenes` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`position` integer NOT NULL,
	`label` text,
	`voiceover` text DEFAULT '' NOT NULL,
	`duration_sec` real DEFAULT 4 NOT NULL,
	`media_prompt` text,
	`media_source` text,
	`media_path` text,
	FOREIGN KEY (`project_id`) REFERENCES `video_projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `scenes_project_idx` ON `video_scenes` (`project_id`,`position`);--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`color` text DEFAULT '#c0c1ff' NOT NULL,
	`icon` text,
	`description` text,
	`brand_voice` text,
	`watermark_path` text,
	`watermark_position` text DEFAULT 'br',
	`golden_hours` text DEFAULT '[]' NOT NULL,
	`ai_token_quota` integer,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`archived_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
