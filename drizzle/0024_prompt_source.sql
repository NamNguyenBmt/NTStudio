ALTER TABLE `film_assets` ADD `description_src` text;--> statement-breakpoint
ALTER TABLE `film_assets` ADD `prompt_manual` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `series_characters` ADD `prompt_manual` integer DEFAULT false NOT NULL;--> statement-breakpoint
-- Mục đã có: coi prompt tiếng Anh hiện tại là bản dịch của tóm tắt hiện tại (không dịch lại hàng loạt)
UPDATE `film_assets` SET `description_src` = trim(`summary`);
--> statement-breakpoint
-- Sửa lỗi cũ: lưu nhân vật từng đánh dấu prompt tiếng Anh cũ là "khớp" mô tả mới → bỏ dấu để AI viết lại theo mô tả hiện tại ở lần dùng tới
UPDATE `series_characters` SET `image_prompt_for` = NULL;
