-- 0004_unify_schema
--
-- Carries a database from release 0003, the state production holds, to what
-- src/db/schema.ts describes. Spec:
-- docs/superpowers/specs/2026-08-07-migration-lineage-unification-design.md
--
-- Authored rather than generated. drizzle-kit generate emits DDL only, and this
-- migration carries seven load-bearing seed and backfill statements copied from
-- the retired beta lineage. An empty event_type_rules means nobody can create an
-- event, so those statements are not optional.
--
-- Statement order is load bearing in three places:
--   1. the public_code backfill runs before its unique index, so a collision
--      fails at the index rather than mis-routing a share link later;
--   2. the point_awards copy runs before point_awards is removed;
--   3. announcement_reads is created after announcements is rebuilt, because it
--      holds a foreign key into it.
--
-- The announcements rebuild is drop-and-recreate rather than
-- ALTER, because SQLite cannot alter nullability or a foreign key. Both were
-- measured at zero rows in staging on 2026-08-07, so neither copies data.

-- 1. Columns added to tables that already exist at 0003.
ALTER TABLE `audit_logs` ADD COLUMN `target_member_id` text REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null;--> statement-breakpoint
ALTER TABLE `crs_events` ADD COLUMN `deleted_at` integer;--> statement-breakpoint
ALTER TABLE `crs_events` ADD COLUMN `grace_minutes` integer;--> statement-breakpoint
ALTER TABLE `crs_events` ADD COLUMN `rsvp_form_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `crs_events` ADD COLUMN `rsvp_responses_public` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `crs_events` ADD COLUMN `all_day` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `crs_events` ADD COLUMN `read_only` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `crs_events` ADD COLUMN `public_code` text;--> statement-breakpoint
ALTER TABLE `event_rsvps` ADD COLUMN `answers_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint

-- 2. Tables absent at 0003, created at the shape schema.ts describes.
CREATE TABLE `point_types` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`label` text NOT NULL,
	`milestones_json` text DEFAULT '[]' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`updated_by` text,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`updated_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
-- The retired beta lineage declared key UNIQUE inline, which sqlite names
-- automatically, so beta never held this index under the name schema.ts uses
-- and permitted duplicate keys through drizzle.
CREATE UNIQUE INDEX `point_types_key_unique` ON `point_types` (`key`);--> statement-breakpoint
CREATE TABLE `event_type_rules` (
	`type` text PRIMARY KEY NOT NULL,
	`required_permission` text,
	`label` text DEFAULT '' NOT NULL,
	`colour` text DEFAULT 'slate' NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`updated_by` text,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`updated_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `event_staff` (
	`event_id` text NOT NULL,
	`member_id` text NOT NULL,
	`role` text NOT NULL,
	`added_by` text,
	`added_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`event_id`, `member_id`),
	FOREIGN KEY (`event_id`) REFERENCES `crs_events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`added_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "event_staff_role_check" CHECK("event_staff"."role" in ('admin', 'scanner'))
);
--> statement-breakpoint
CREATE INDEX `event_staff_member_id_idx` ON `event_staff` (`member_id`);--> statement-breakpoint
CREATE TABLE `event_invites` (
	`event_id` text NOT NULL,
	`member_id` text NOT NULL,
	`invited_by` text,
	`invited_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`event_id`, `member_id`),
	FOREIGN KEY (`event_id`) REFERENCES `crs_events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invited_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `event_invites_member_invited_idx` ON `event_invites` (`member_id`,`invited_at`);--> statement-breakpoint
CREATE TABLE `event_point_awards` (
	`event_id` text NOT NULL,
	`point_type_id` text NOT NULL,
	`points` integer NOT NULL,
	PRIMARY KEY(`event_id`, `point_type_id`),
	FOREIGN KEY (`event_id`) REFERENCES `crs_events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`point_type_id`) REFERENCES `point_types`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `retention_records` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`term_id` text NOT NULL,
	`event_id` text,
	`point_type_id` text DEFAULT 'pt_retention' NOT NULL,
	`points` integer,
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
CREATE INDEX `retention_records_member_term_idx` ON `retention_records` (`member_id`,`term_id`);--> statement-breakpoint
CREATE INDEX `retention_records_term_id_idx` ON `retention_records` (`term_id`);--> statement-breakpoint
CREATE INDEX `retention_records_event_id_idx` ON `retention_records` (`event_id`);--> statement-breakpoint
CREATE TABLE `term_member_roster` (
	`term_id` text NOT NULL,
	`email` text NOT NULL,
	`member_id` text,
	`added_by` text NOT NULL,
	`added_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`term_id`, `email`),
	FOREIGN KEY (`term_id`) REFERENCES `terms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`added_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `term_member_roster_term_id_idx` ON `term_member_roster` (`term_id`);--> statement-breakpoint
CREATE INDEX `term_member_roster_email_idx` ON `term_member_roster` (`email`);--> statement-breakpoint
CREATE TABLE `quick_links` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`url` text NOT NULL,
	`position` integer NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `quick_links_position_idx` ON `quick_links` (`position`);--> statement-breakpoint
CREATE TABLE `rate_limit_counters` (
	`bucket_key` text NOT NULL,
	`window_start` integer NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`bucket_key`, `window_start`)
);
--> statement-breakpoint
CREATE INDEX `rate_limit_counters_window_start_idx` ON `rate_limit_counters` (`window_start`);--> statement-breakpoint
CREATE TABLE `link_hourly_stats` (
	`link_id` text NOT NULL,
	`hour` text NOT NULL,
	`referrer_bucket` text NOT NULL,
	`device_bucket` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`link_id`, `hour`, `referrer_bucket`, `device_bucket`),
	FOREIGN KEY (`link_id`) REFERENCES `short_links`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `link_hourly_stats_link_hour_idx` ON `link_hourly_stats` (`link_id`,`hour`);--> statement-breakpoint
CREATE TABLE `library_items` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text DEFAULT 'article' NOT NULL,
	`confidentiality` text DEFAULT 'members' NOT NULL,
	`category` text DEFAULT 'General' NOT NULL,
	`title` text NOT NULL,
	`dek` text DEFAULT '' NOT NULL,
	`read_minutes` integer DEFAULT 5 NOT NULL,
	`abstract` text DEFAULT '' NOT NULL,
	`sections_json` text DEFAULT '[]' NOT NULL,
	`components_json` text DEFAULT '[]' NOT NULL,
	`questions_json` text DEFAULT '[]' NOT NULL,
	`references_json` text DEFAULT '[]' NOT NULL,
	`topics_json` text DEFAULT '[]' NOT NULL,
	`created_by` text,
	`published_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `library_items_category_idx` ON `library_items` (`category`);--> statement-breakpoint
CREATE INDEX `library_items_published_at_idx` ON `library_items` (`published_at`);--> statement-breakpoint
CREATE TABLE `library_lists` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text DEFAULT '#0c315c' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `library_list_items` (
	`list_id` text NOT NULL,
	`library_item_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`list_id`, `library_item_id`),
	FOREIGN KEY (`list_id`) REFERENCES `library_lists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`library_item_id`) REFERENCES `library_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `library_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`library_item_id` text NOT NULL,
	`member_id` text NOT NULL,
	`parent_id` text,
	`anonymous` integer DEFAULT false NOT NULL,
	`body` text NOT NULL,
	`hidden` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`library_item_id`) REFERENCES `library_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `library_comments_library_item_id_idx` ON `library_comments` (`library_item_id`);--> statement-breakpoint
CREATE TABLE `library_favorites` (
	`member_id` text NOT NULL,
	`library_item_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`member_id`, `library_item_id`),
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`library_item_id`) REFERENCES `library_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `article_feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`article_slug` text NOT NULL,
	`rating` integer NOT NULL,
	`comment` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `article_feedback_article_slug_idx` ON `article_feedback` (`article_slug`);--> statement-breakpoint
CREATE INDEX `article_feedback_created_at_idx` ON `article_feedback` (`created_at`);--> statement-breakpoint
CREATE TABLE `contact_submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`organization` text NOT NULL,
	`email` text NOT NULL,
	`org_segment` text NOT NULL,
	`message` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `contact_submissions_created_at_idx` ON `contact_submissions` (`created_at`);--> statement-breakpoint

-- 3. Indexes on the columns added in section 1. The month view stops being a
-- pure starts_at range scan once it selects by overlap.
CREATE INDEX `crs_events_ends_at_idx` ON `crs_events` (`ends_at`);--> statement-breakpoint
CREATE INDEX `audit_logs_target_member_created_idx` ON `audit_logs` (`target_member_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_logs_action_created_idx` ON `audit_logs` (`action`,`created_at`);--> statement-breakpoint

-- 4. Seeds and backfills carried over from the retired beta lineage, verbatim.
-- Source: 0004_robust_blue_shield.sql
INSERT OR IGNORE INTO `roles` (`id`, `key`, `label`, `description`, `kind`) VALUES ('role_publishing', 'publishing', 'Publishing', 'Manages announcements and the content library.', 'admin');--> statement-breakpoint
-- Source: 0010_event_type_rules.sql
INSERT INTO `event_type_rules` (`type`, `required_permission`) VALUES ('casual', NULL);--> statement-breakpoint
INSERT INTO `event_type_rules` (`type`, `required_permission`) VALUES ('birthday', NULL);--> statement-breakpoint
INSERT INTO `event_type_rules` (`type`, `required_permission`) VALUES ('official', 'event:create_restricted');--> statement-breakpoint
-- Source: 0012_event_type_metadata.sql
UPDATE `event_type_rules` SET `label` = 'Official', `colour` = 'primary', `position` = 0 WHERE `type` = 'official';--> statement-breakpoint
UPDATE `event_type_rules` SET `label` = 'Casual',   `colour` = 'emerald', `position` = 1 WHERE `type` = 'casual';--> statement-breakpoint
UPDATE `event_type_rules` SET `label` = 'Birthday', `colour` = 'accent',  `position` = 2 WHERE `type` = 'birthday';--> statement-breakpoint
-- Source: release-migrations/0004_beta_release_bridge.sql:47
INSERT INTO `point_types` (`id`, `key`, `label`, `milestones_json`, `active`, `position`)
VALUES ('pt_retention', 'retention', 'Retention', '[]', 1, 0);
--> statement-breakpoint
-- Source: 0014_attendance_grace_and_audit_target.sql
UPDATE `audit_logs`
SET `target_member_id` = substr(`detail`, 8)
WHERE `category` = 'event'
  AND `action` IN ('event:scan_attendance', 'event:undo_scan')
  AND `detail` LIKE 'member=%'
  AND EXISTS (SELECT 1 FROM `members` WHERE `members`.`id` = substr(`audit_logs`.`detail`, 8));
--> statement-breakpoint
-- Source: 0019_event_multiday_readonly_and_share_codes.sql
-- Alphabet omits I, L, O, U, 0 and 1, the glyphs people mistype reading a code
-- off a poster. SQLite evaluates random() once per call, so the six terms are
-- independent.
UPDATE crs_events SET public_code = (
	substr('ABCDEFGHJKMNPQRSTVWXYZ23456789', (abs(random()) % 30) + 1, 1) ||
	substr('ABCDEFGHJKMNPQRSTVWXYZ23456789', (abs(random()) % 30) + 1, 1) ||
	substr('ABCDEFGHJKMNPQRSTVWXYZ23456789', (abs(random()) % 30) + 1, 1) ||
	substr('ABCDEFGHJKMNPQRSTVWXYZ23456789', (abs(random()) % 30) + 1, 1) ||
	substr('ABCDEFGHJKMNPQRSTVWXYZ23456789', (abs(random()) % 30) + 1, 1) ||
	substr('ABCDEFGHJKMNPQRSTVWXYZ23456789', (abs(random()) % 30) + 1, 1)
) WHERE public_code IS NULL;
--> statement-breakpoint
-- Created after the backfill so a collision across existing rows fails loudly
-- here rather than silently mis-routing a share link later.
CREATE UNIQUE INDEX `crs_events_public_code_idx` ON `crs_events` (`public_code`);--> statement-breakpoint

-- 5. Point awards become retention records. Verbatim from
-- release-migrations/0004_beta_release_bridge.sql:70. A no-op at zero rows,
-- retained so scripts/verify-preservation.ts can assert on it. This must run
-- before point_awards is retired in section 8.
-- Release blocker: the target DB must pass the documented duplicate point_awards preflight before this migration runs.
INSERT INTO `retention_records`
	(`id`, `member_id`, `term_id`, `event_id`, `point_type_id`, `points`, `reason`, `source`, `recorded_by`, `recorded_at`)
SELECT
	`id`, `member_id`, `term_id`, `event_id`, 'pt_retention', `points`, `reason`,
	CASE WHEN `event_id` IS NULL THEN 'manual' ELSE 'event_attendance' END,
	`awarded_by`, `awarded_at`
FROM `point_awards`;
--> statement-breakpoint
CREATE UNIQUE INDEX `retention_records_event_member_type_idx` ON `retention_records` (`event_id`,`member_id`,`point_type_id`) WHERE source = 'event_attendance';--> statement-breakpoint

-- 6. Rebuilds. SQLite cannot alter nullability or a foreign key, so both tables
-- are recreated at the shape schema.ts describes. Measured at zero rows in
-- staging and production on 2026-08-07, so neither copies data.
DROP TABLE IF EXISTS `announcements`;--> statement-breakpoint
CREATE TABLE `announcements` (
	`id` text PRIMARY KEY NOT NULL,
	`tag` text DEFAULT 'CODE' NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`audience` text DEFAULT 'all' NOT NULL,
	`linked_event_id` text,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`linked_event_id`) REFERENCES `crs_events`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `announcements_pinned_idx` ON `announcements` (`pinned`,`created_at`);--> statement-breakpoint
-- Holds a foreign key into announcements, so it follows the rebuild.
CREATE TABLE `announcement_reads` (
	`announcement_id` text NOT NULL,
	`member_id` text NOT NULL,
	`read_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`announcement_id`, `member_id`),
	FOREIGN KEY (`announcement_id`) REFERENCES `announcements`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `announcement_reads_member_id_idx` ON `announcement_reads` (`member_id`);--> statement-breakpoint
-- nav_pins is deliberately NOT rebuilt. Release 0003 already creates it with
-- created_by nullable, ON DELETE set null and position DEFAULT 0, which is exactly
-- what schema.ts describes, so a rebuild would change nothing structurally while
-- discarding every existing row. Production's nav_pins row count was never measured.

-- 7. The guided tour was never rendered and nothing read these two columns.
ALTER TABLE `members` DROP COLUMN `tour_member_done`;--> statement-breakpoint
ALTER TABLE `members` DROP COLUMN `tour_admin_done`;--> statement-breakpoint

-- 8. Tables schema.ts no longer declares, all measured empty on 2026-08-07.
-- Children precede their parents.
DROP TABLE IF EXISTS `member_feed_state`;--> statement-breakpoint
DROP TABLE IF EXISTS `article_acl`;--> statement-breakpoint
DROP TABLE IF EXISTS `article_components`;--> statement-breakpoint
DROP TABLE IF EXISTS `article_questions`;--> statement-breakpoint
DROP TABLE IF EXISTS `article_refs`;--> statement-breakpoint
DROP TABLE IF EXISTS `article_related`;--> statement-breakpoint
DROP TABLE IF EXISTS `article_sections`;--> statement-breakpoint
DROP TABLE IF EXISTS `article_topics`;--> statement-breakpoint
DROP TABLE IF EXISTS `comments`;--> statement-breakpoint
DROP TABLE IF EXISTS `favorites`;--> statement-breakpoint
DROP TABLE IF EXISTS `articles`;--> statement-breakpoint
DROP TABLE IF EXISTS `team_members`;--> statement-breakpoint
DROP TABLE IF EXISTS `consultancy_teams`;--> statement-breakpoint
DROP TABLE IF EXISTS `list_items`;--> statement-breakpoint
DROP TABLE IF EXISTS `lists`;--> statement-breakpoint
DROP TABLE IF EXISTS `point_awards`;--> statement-breakpoint
DROP TABLE IF EXISTS `topics`;
