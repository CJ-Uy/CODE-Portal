CREATE TABLE `important_links` (
	`id` text PRIMARY KEY NOT NULL,
	`category_id` text,
	`title` text NOT NULL,
	`url` text NOT NULL,
	`description` text,
	`kind` text,
	`show_in_sidebar` integer DEFAULT false NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`archived_at` integer,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `link_categories`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `important_links_category_position_idx` ON `important_links` (`category_id`,`position`);--> statement-breakpoint
CREATE TABLE `link_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`archived_at` integer,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `link_categories_position_idx` ON `link_categories` (`position`);--> statement-breakpoint
-- Hand-written below this line (drizzle-kit emits DDL only). Asserted in scripts/verify-preservation.ts.
-- Sidebar pins become important links that stay in the sidebar. Ids carry over so old nav_pin audit rows still
-- resolve. kind stays null so the type is detected from the URL, and with no category the pins list under "Other links".
INSERT OR IGNORE INTO `important_links` (`id`, `title`, `url`, `show_in_sidebar`, `position`, `created_by`, `created_at`, `updated_at`) SELECT `id`, `label`, `url`, 1, `position`, `created_by`, `created_at`, `updated_at` FROM `nav_pins`;
