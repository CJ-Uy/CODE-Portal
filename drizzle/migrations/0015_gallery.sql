CREATE TABLE `gallery_folders` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_id` text,
	`name` text NOT NULL,
	`event_id` text,
	`is_public` integer DEFAULT false NOT NULL,
	`is_event_album` integer DEFAULT false NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	`deleted_by` text,
	FOREIGN KEY (`parent_id`) REFERENCES `gallery_folders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`event_id`) REFERENCES `crs_events`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`deleted_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `gallery_folders_parent_idx` ON `gallery_folders` (`parent_id`);--> statement-breakpoint
CREATE INDEX `gallery_folders_deleted_idx` ON `gallery_folders` (`deleted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `gallery_folders_event_album_idx` ON `gallery_folders` (`event_id`) WHERE "gallery_folders"."is_event_album" = 1;--> statement-breakpoint
CREATE TABLE `gallery_hearts` (
	`item_id` text NOT NULL,
	`member_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`item_id`, `member_id`),
	FOREIGN KEY (`item_id`) REFERENCES `gallery_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `gallery_hearts_member_idx` ON `gallery_hearts` (`member_id`);--> statement-breakpoint
CREATE TABLE `gallery_items` (
	`id` text PRIMARY KEY NOT NULL,
	`folder_id` text,
	`kind` text NOT NULL,
	`file_key` text NOT NULL,
	`poster_key` text,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`duration_seconds` real,
	`original_name` text NOT NULL,
	`caption` text,
	`taken_at` integer,
	`event_id` text,
	`uploaded_by` text,
	`uploader_email` text NOT NULL,
	`view_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	`deleted_by` text,
	FOREIGN KEY (`folder_id`) REFERENCES `gallery_folders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`event_id`) REFERENCES `crs_events`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`uploaded_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`deleted_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `gallery_items_folder_idx` ON `gallery_items` (`folder_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `gallery_items_event_idx` ON `gallery_items` (`event_id`);--> statement-breakpoint
CREATE INDEX `gallery_items_deleted_idx` ON `gallery_items` (`deleted_at`);--> statement-breakpoint
CREATE INDEX `gallery_items_uploaded_by_idx` ON `gallery_items` (`uploaded_by`);--> statement-breakpoint
CREATE INDEX `gallery_items_view_count_idx` ON `gallery_items` (`view_count`);--> statement-breakpoint
CREATE TABLE `gallery_tags` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`kind` text NOT NULL,
	`key` text NOT NULL,
	`member_id` text,
	`label` text NOT NULL,
	`tagged_by` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `gallery_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tagged_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gallery_tags_item_kind_key_idx` ON `gallery_tags` (`item_id`,`kind`,`key`);--> statement-breakpoint
CREATE INDEX `gallery_tags_member_idx` ON `gallery_tags` (`member_id`);--> statement-breakpoint
CREATE INDEX `gallery_tags_kind_key_idx` ON `gallery_tags` (`kind`,`key`);--> statement-breakpoint
INSERT OR IGNORE INTO `roles` (`id`, `key`, `label`, `description`, `kind`) VALUES ('role_gallery', 'gallery', 'Photo gallery', 'Restores anything deleted from the photo gallery and chooses which folders are public.', 'admin');
