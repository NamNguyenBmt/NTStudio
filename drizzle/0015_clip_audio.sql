ALTER TABLE `video_projects` ADD `clip_audio` text DEFAULT 'tts' NOT NULL;--> statement-breakpoint
ALTER TABLE `video_projects` ADD `clip_audio_volume` real DEFAULT 0.35 NOT NULL;