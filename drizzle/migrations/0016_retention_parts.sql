ALTER TABLE `point_types` ADD `retention_period` text;--> statement-breakpoint
ALTER TABLE `terms` ADD `second_semester_starts_at` integer;--> statement-breakpoint
ALTER TABLE `terms` DROP COLUMN `retained_at`;--> statement-breakpoint
ALTER TABLE `terms` DROP COLUMN `probation_below`;--> statement-breakpoint
CREATE UNIQUE INDEX `retention_records_share_event_member_type_idx` ON `retention_records` (`event_id`,`member_id`,`point_type_id`) WHERE source = 'feedback_share';--> statement-breakpoint
-- Hand-written below this line (drizzle-kit emits DDL only). Asserted in scripts/verify-preservation.ts.
-- The 8 retention parts (spec 2026-10-23-retention-parts-design.md). Prod and staged already hold them under these ids,
-- so this only adds rows on beta and local databases. Placed after the existing types, in part order.
INSERT OR IGNORE INTO `point_types` (`id`, `key`, `label`, `milestones_json`, `active`, `position`) SELECT 'pt_ts', 'ts', 'Training Seminar', '[]', 1, COALESCE(MAX(`position`), -1) + 1 FROM `point_types`;--> statement-breakpoint
INSERT OR IGNORE INTO `point_types` (`id`, `key`, `label`, `milestones_json`, `active`, `position`) SELECT 'pt_proj_team', 'proj_team', 'Project Team', '[]', 1, COALESCE(MAX(`position`), -1) + 1 FROM `point_types`;--> statement-breakpoint
INSERT OR IGNORE INTO `point_types` (`id`, `key`, `label`, `milestones_json`, `active`, `position`) SELECT 'pt_advo', 'advo', 'Advocacy-Related', '[]', 1, COALESCE(MAX(`position`), -1) + 1 FROM `point_types`;--> statement-breakpoint
INSERT OR IGNORE INTO `point_types` (`id`, `key`, `label`, `milestones_json`, `active`, `position`) SELECT 'pt_egmt_team', 'egmt_team', 'Engagement Team', '[]', 1, COALESCE(MAX(`position`), -1) + 1 FROM `point_types`;--> statement-breakpoint
INSERT OR IGNORE INTO `point_types` (`id`, `key`, `label`, `milestones_json`, `active`, `position`) SELECT 'pt_gma', 'gma', 'General Membership Activity', '[]', 1, COALESCE(MAX(`position`), -1) + 1 FROM `point_types`;--> statement-breakpoint
INSERT OR IGNORE INTO `point_types` (`id`, `key`, `label`, `milestones_json`, `active`, `position`) SELECT 'pt_hre', 'hre', 'Human Resources Event', '[]', 1, COALESCE(MAX(`position`), -1) + 1 FROM `point_types`;--> statement-breakpoint
INSERT OR IGNORE INTO `point_types` (`id`, `key`, `label`, `milestones_json`, `active`, `position`) SELECT 'pt_cbtb', 'cbtb', 'Community Building Team Bonding', '[]', 1, COALESCE(MAX(`position`), -1) + 1 FROM `point_types`;--> statement-breakpoint
INSERT OR IGNORE INTO `point_types` (`id`, `key`, `label`, `milestones_json`, `active`, `position`) SELECT 'pt_ksa', 'ksa', 'Knowledge-Sharing Activity', '[]', 1, COALESCE(MAX(`position`), -1) + 1 FROM `point_types`;--> statement-breakpoint
-- Matched by id or key, so a database whose ids drifted from prod still gets its parts marked. Retired parts come back:
-- a part cannot be retired.
UPDATE `point_types` SET `retention_period` = 'year', `active` = 1 WHERE `id` IN ('pt_ts', 'pt_proj_team', 'pt_advo', 'pt_egmt_team') OR `key` IN ('ts', 'proj_team', 'advo', 'egmt_team');--> statement-breakpoint
UPDATE `point_types` SET `retention_period` = 'semester', `active` = 1 WHERE `id` IN ('pt_gma', 'pt_hre', 'pt_cbtb', 'pt_ksa') OR `key` IN ('gma', 'hre', 'cbtb', 'ksa');--> statement-breakpoint
-- A first guess at each school year's 2nd semester: 11 January, 00:00 Manila, of the year the school year ends. Officers
-- correct it in Admin > School years. A school year that does not span that date keeps NULL and reads the midpoint.
UPDATE `terms` SET `second_semester_starts_at` = (CAST(strftime('%s', strftime('%Y', (`ends_at` + 28800000) / 1000, 'unixepoch') || '-01-11') AS INTEGER) - 28800) * 1000 WHERE (CAST(strftime('%s', strftime('%Y', (`ends_at` + 28800000) / 1000, 'unixepoch') || '-01-11') AS INTEGER) - 28800) * 1000 > `starts_at` AND (CAST(strftime('%s', strftime('%Y', (`ends_at` + 28800000) / 1000, 'unixepoch') || '-01-11') AS INTEGER) - 28800) * 1000 <= `ends_at`;
