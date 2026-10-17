ALTER TABLE `survey_responses` ADD `member_id` text REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null;--> statement-breakpoint
CREATE INDEX `survey_responses_survey_member_idx` ON `survey_responses` (`survey_id`,`member_id`);--> statement-breakpoint
ALTER TABLE `surveys` ADD `points_award` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `surveys` ADD `point_type_id` text REFERENCES `point_types`(`id`) ON UPDATE no action ON DELETE no action;--> statement-breakpoint
CREATE UNIQUE INDEX `retention_records_survey_event_member_type_idx` ON `retention_records` (`event_id`,`member_id`,`point_type_id`) WHERE source = 'survey_response';--> statement-breakpoint
-- Hand-written below this line (drizzle-kit emits DDL only). Asserted in scripts/verify-preservation.ts.
-- drizzle-kit wrote both FKs above without ON DELETE; they are corrected by hand to match schema.ts.
-- The point type for answering feedback forms (event feedback spec, section 16.1), placed after the existing ones.
INSERT OR IGNORE INTO `point_types` (`id`, `key`, `label`, `milestones_json`, `active`, `position`) SELECT 'pt_feedback', 'feedback', 'Feedback', '[]', 1, COALESCE(MAX(`position`), -1) + 1 FROM `point_types`;--> statement-breakpoint
-- Drafts take the new default of 1 Feedback point. Running and closed forms went out without points and stay at 0.
UPDATE `surveys` SET `points_award` = 1, `point_type_id` = 'pt_feedback' WHERE `status` = 'draft' AND EXISTS (SELECT 1 FROM `point_types` WHERE `id` = 'pt_feedback' AND `active` = 1);
