-- points become fractional (0.75 etc). Neither table has an incoming foreign key,
-- so the rebuild needs no `PRAGMA foreign_keys=OFF`: D1 rejects it (7403) and the
-- local runner wraps each file in a transaction where it would no-op anyway.
CREATE TABLE `__new_event_point_awards` (
	`event_id` text NOT NULL,
	`point_type_id` text NOT NULL,
	`points` real NOT NULL,
	PRIMARY KEY(`event_id`, `point_type_id`),
	FOREIGN KEY (`event_id`) REFERENCES `crs_events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`point_type_id`) REFERENCES `point_types`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_event_point_awards`("event_id", "point_type_id", "points") SELECT "event_id", "point_type_id", "points" FROM `event_point_awards`;--> statement-breakpoint
DROP TABLE `event_point_awards`;--> statement-breakpoint
ALTER TABLE `__new_event_point_awards` RENAME TO `event_point_awards`;--> statement-breakpoint
CREATE TABLE `__new_retention_records` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`term_id` text NOT NULL,
	`event_id` text,
	`point_type_id` text DEFAULT 'pt_retention' NOT NULL,
	`points` real,
	`reason` text NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`recorded_by` text NOT NULL,
	`recorded_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`term_id`) REFERENCES `terms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_id`) REFERENCES `crs_events`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`recorded_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_retention_records`("id", "member_id", "term_id", "event_id", "point_type_id", "points", "reason", "source", "recorded_by", "recorded_at") SELECT "id", "member_id", "term_id", "event_id", "point_type_id", "points", "reason", "source", "recorded_by", "recorded_at" FROM `retention_records`;--> statement-breakpoint
DROP TABLE `retention_records`;--> statement-breakpoint
ALTER TABLE `__new_retention_records` RENAME TO `retention_records`;--> statement-breakpoint
CREATE INDEX `retention_records_member_term_idx` ON `retention_records` (`member_id`,`term_id`);--> statement-breakpoint
CREATE INDEX `retention_records_term_id_idx` ON `retention_records` (`term_id`);--> statement-breakpoint
CREATE INDEX `retention_records_event_id_idx` ON `retention_records` (`event_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `retention_records_event_member_type_idx` ON `retention_records` (`event_id`,`member_id`,`point_type_id`) WHERE source = 'event_attendance';