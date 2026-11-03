CREATE TABLE `gallery_list_items` (
	`list_id` text NOT NULL,
	`item_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`list_id`, `item_id`),
	FOREIGN KEY (`list_id`) REFERENCES `gallery_lists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `gallery_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `gallery_list_items_item_idx` ON `gallery_list_items` (`item_id`);--> statement-breakpoint
CREATE TABLE `gallery_lists` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `gallery_lists_member_idx` ON `gallery_lists` (`member_id`);--> statement-breakpoint
CREATE TABLE `gallery_saves` (
	`item_id` text NOT NULL,
	`member_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`item_id`, `member_id`),
	FOREIGN KEY (`item_id`) REFERENCES `gallery_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `gallery_saves_member_idx` ON `gallery_saves` (`member_id`);