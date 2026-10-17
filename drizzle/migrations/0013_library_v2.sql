CREATE TABLE `library_item_member_days` (
	`item_id` text NOT NULL,
	`member_id` text NOT NULL,
	`day` text NOT NULL,
	`opens` integer DEFAULT 0 NOT NULL,
	`active_seconds` integer DEFAULT 0 NOT NULL,
	`downloads` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`item_id`, `member_id`, `day`),
	FOREIGN KEY (`item_id`) REFERENCES `library_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `library_item_member_days_item_id_idx` ON `library_item_member_days` (`item_id`);--> statement-breakpoint
CREATE INDEX `library_item_member_days_day_idx` ON `library_item_member_days` (`day`);--> statement-breakpoint
CREATE TABLE `library_item_tags` (
	`item_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`item_id`, `tag_id`),
	FOREIGN KEY (`item_id`) REFERENCES `library_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `library_tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `library_item_tags_tag_id_idx` ON `library_item_tags` (`tag_id`);--> statement-breakpoint
CREATE TABLE `library_list_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`list_id` text NOT NULL,
	`member_id` text NOT NULL,
	`parent_id` text,
	`anonymous` integer DEFAULT false NOT NULL,
	`body` text NOT NULL,
	`hidden` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`list_id`) REFERENCES `library_lists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `library_list_comments_list_id_idx` ON `library_list_comments` (`list_id`);--> statement-breakpoint
CREATE TABLE `library_list_members` (
	`list_id` text NOT NULL,
	`member_id` text NOT NULL,
	`role` text DEFAULT 'editor' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`list_id`, `member_id`),
	FOREIGN KEY (`list_id`) REFERENCES `library_lists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `library_list_members_member_id_idx` ON `library_list_members` (`member_id`);--> statement-breakpoint
CREATE TABLE `library_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text,
	`list_id` text,
	`member_id` text NOT NULL,
	`reason` text NOT NULL,
	`details` text DEFAULT '' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`resolved_by` text,
	`resolved_at` integer,
	`resolution` text,
	FOREIGN KEY (`item_id`) REFERENCES `library_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`list_id`) REFERENCES `library_lists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resolved_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `library_reports_item_id_idx` ON `library_reports` (`item_id`);--> statement-breakpoint
CREATE INDEX `library_reports_list_id_idx` ON `library_reports` (`list_id`);--> statement-breakpoint
CREATE TABLE `library_tags` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`group_name` text DEFAULT 'Ungrouped' NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `library_tags_slug_unique` ON `library_tags` (`slug`);--> statement-breakpoint
ALTER TABLE `library_items` ADD `format` text DEFAULT 'page' NOT NULL;--> statement-breakpoint
ALTER TABLE `library_items` ADD `source` text DEFAULT 'code' NOT NULL;--> statement-breakpoint
ALTER TABLE `library_items` ADD `status` text DEFAULT 'published' NOT NULL;--> statement-breakpoint
ALTER TABLE `library_items` ADD `blocks_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `library_items` ADD `authors_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `library_items` ADD `subtype` text;--> statement-breakpoint
ALTER TABLE `library_items` ADD `format_detail` text;--> statement-breakpoint
ALTER TABLE `library_items` ADD `engagement_type` text;--> statement-breakpoint
ALTER TABLE `library_items` ADD `year` integer;--> statement-breakpoint
ALTER TABLE `library_items` ADD `file_code` text;--> statement-breakpoint
ALTER TABLE `library_items` ADD `file_key` text;--> statement-breakpoint
ALTER TABLE `library_items` ADD `file_name` text;--> statement-breakpoint
ALTER TABLE `library_items` ADD `file_type` text;--> statement-breakpoint
ALTER TABLE `library_items` ADD `file_bytes` integer;--> statement-breakpoint
ALTER TABLE `library_items` ADD `url` text;--> statement-breakpoint
ALTER TABLE `library_items` ADD `contains_client_data` integer;--> statement-breakpoint
ALTER TABLE `library_items` ADD `client_data_redacted` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `library_items` ADD `moderation_reason` text;--> statement-breakpoint
ALTER TABLE `library_items` ADD `public_readiness` text;--> statement-breakpoint
ALTER TABLE `library_items` ADD `extracted_text` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `library_items` ADD `search_text` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `library_items` ADD `indexed_at` integer;--> statement-breakpoint
CREATE INDEX `library_items_status_idx` ON `library_items` (`status`);--> statement-breakpoint
CREATE INDEX `library_items_kind_idx` ON `library_items` (`kind`);--> statement-breakpoint
CREATE INDEX `library_items_source_idx` ON `library_items` (`source`);--> statement-breakpoint
CREATE INDEX `library_items_created_by_idx` ON `library_items` (`created_by`);--> statement-breakpoint
ALTER TABLE `library_list_items` ADD `note` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `library_list_items` ADD `added_by` text REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null;--> statement-breakpoint
ALTER TABLE `library_list_items` ADD `position` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `library_list_items_library_item_id_idx` ON `library_list_items` (`library_item_id`);--> statement-breakpoint
ALTER TABLE `library_lists` ADD `description` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `library_lists` ADD `shared` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `library_lists` ADD `is_default` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `library_lists` ADD `pinned` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `library_lists` ADD `pin_order` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `library_lists` ADD `taken_down_at` integer;--> statement-breakpoint
ALTER TABLE `library_lists` ADD `moderation_reason` text;--> statement-breakpoint
ALTER TABLE `library_lists` ADD `updated_at` integer;--> statement-breakpoint
ALTER TABLE `members` ADD `library_smart_search` integer DEFAULT true NOT NULL;--> statement-breakpoint
-- Hand-written from here down (drizzle-kit emits DDL only). Order matters: favorites are copied into
-- Saved lists BEFORE library_favorites is dropped, and the demo items go after the copy.
-- library_lists.updated_at is nullable because SQLite forbids a non-constant ADD COLUMN default. Backfill it from created_at.
UPDATE `library_lists` SET `updated_at` = `created_at`;--> statement-breakpoint
-- Legacy list rows predate added_by: the list's owner added them.
UPDATE `library_list_items` SET `added_by` = (SELECT `member_id` FROM `library_lists` `l` WHERE `l`.`id` = `library_list_items`.`list_id`) WHERE `added_by` IS NULL;--> statement-breakpoint
INSERT INTO `library_lists` (`id`, `member_id`, `name`, `color`, `is_default`, `created_at`, `updated_at`)
SELECT 'lst_saved_' || `member_id`, `member_id`, 'Saved', '#0c315c', 1, MIN(`created_at`), MIN(`created_at`)
FROM `library_favorites` GROUP BY `member_id`;--> statement-breakpoint
INSERT INTO `library_list_items` (`list_id`, `library_item_id`, `added_by`, `created_at`)
SELECT 'lst_saved_' || `member_id`, `library_item_id`, `member_id`, `created_at` FROM `library_favorites`;--> statement-breakpoint
DELETE FROM `library_items` WHERE `id` IN ('lib_onboarding', 'lib_events_playbook', 'lib_internal_notes');--> statement-breakpoint
DROP TABLE `library_favorites`;