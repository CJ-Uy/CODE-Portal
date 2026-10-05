CREATE TABLE `email_campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`template_id` text,
	`category_id` text,
	`sender_id` text,
	`subject` text DEFAULT '' NOT NULL,
	`preheader` text DEFAULT '' NOT NULL,
	`blocks` text DEFAULT '[]' NOT NULL,
	`audience` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`scheduled_at` integer,
	`started_at` integer,
	`finished_at` integer,
	`recipient_count` integer DEFAULT 0 NOT NULL,
	`sent_count` integer DEFAULT 0 NOT NULL,
	`failed_count` integer DEFAULT 0 NOT NULL,
	`skipped_count` integer DEFAULT 0 NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`template_id`) REFERENCES `email_templates`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`category_id`) REFERENCES `email_categories`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`sender_id`) REFERENCES `email_senders`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `email_campaigns_status_scheduled_idx` ON `email_campaigns` (`status`,`scheduled_at`);--> statement-breakpoint
CREATE TABLE `email_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`required` integer DEFAULT false NOT NULL,
	`default_sender_id` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`archived_at` integer,
	FOREIGN KEY (`default_sender_id`) REFERENCES `email_senders`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `email_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`member_id` text,
	`email` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer,
	`message_id` text,
	`error` text,
	`sent_at` integer,
	`read_at` integer,
	FOREIGN KEY (`campaign_id`) REFERENCES `email_campaigns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_deliveries_campaign_member_unique` ON `email_deliveries` (`campaign_id`,`member_id`);--> statement-breakpoint
CREATE INDEX `email_deliveries_status_next_idx` ON `email_deliveries` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `email_deliveries_member_status_idx` ON `email_deliveries` (`member_id`,`status`);--> statement-breakpoint
CREATE INDEX `email_deliveries_sent_at_idx` ON `email_deliveries` (`sent_at`);--> statement-breakpoint
CREATE TABLE `email_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`direction` text NOT NULL,
	`message_id` text,
	`in_reply_to` text,
	`references_header` text,
	`from_email` text NOT NULL,
	`to_email` text NOT NULL,
	`subject` text NOT NULL,
	`text` text,
	`html` text,
	`raw_key` text,
	`sent_by` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `email_threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sent_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `email_messages_message_id_idx` ON `email_messages` (`message_id`);--> statement-breakpoint
CREATE INDEX `email_messages_thread_created_idx` ON `email_messages` (`thread_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `email_optouts` (
	`member_id` text NOT NULL,
	`category_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`member_id`, `category_id`),
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `email_categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `email_senders` (
	`id` text PRIMARY KEY NOT NULL,
	`address` text NOT NULL,
	`display_name` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`archived_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_senders_address_unique` ON `email_senders` (`address`);--> statement-breakpoint
CREATE TABLE `email_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`category_id` text,
	`subject` text DEFAULT '' NOT NULL,
	`preheader` text DEFAULT '' NOT NULL,
	`blocks` text DEFAULT '[]' NOT NULL,
	`created_by` text,
	`updated_by` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`archived_at` integer,
	FOREIGN KEY (`category_id`) REFERENCES `email_categories`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `email_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text,
	`member_id` text,
	`from_email` text NOT NULL,
	`from_name` text,
	`subject` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`assignee_id` text,
	`unread` integer DEFAULT true NOT NULL,
	`is_auto` integer DEFAULT false NOT NULL,
	`last_message_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `email_campaigns`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`assignee_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `email_threads_status_last_idx` ON `email_threads` (`status`,`last_message_at`);--> statement-breakpoint
CREATE INDEX `email_threads_campaign_from_idx` ON `email_threads` (`campaign_id`,`from_email`);
--> statement-breakpoint
INSERT OR IGNORE INTO `roles` (`id`, `key`, `label`, `description`, `kind`) VALUES ('role_email', 'email', 'Email', 'Sends member emails and manages templates, categories, and the reply inbox.', 'admin');--> statement-breakpoint
INSERT OR IGNORE INTO `reserved_slugs` (`slug`) VALUES ('unsubscribe');
