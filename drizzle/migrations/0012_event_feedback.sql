CREATE TABLE `event_debriefs` (
	`event_id` text PRIMARY KEY NOT NULL,
	`intended` text,
	`happened` text,
	`why` text,
	`change` text,
	`updated_by` text,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `crs_events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`updated_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `survey_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`questions_json` text DEFAULT '[]' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`archived_at` integer,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
DROP INDEX `survey_assignments_response_token_hash_unique`;--> statement-breakpoint
DROP INDEX `survey_assignments_response_token_hash_idx`;--> statement-breakpoint
ALTER TABLE `survey_assignments` ADD `source` text DEFAULT 'invited' NOT NULL;--> statement-breakpoint
ALTER TABLE `survey_assignments` DROP COLUMN `response_token_hash`;--> statement-breakpoint
DROP INDEX `surveys_event_id_idx`;--> statement-breakpoint
ALTER TABLE `surveys` ADD `template_id` text REFERENCES `survey_templates`(`id`) ON UPDATE no action ON DELETE set null;--> statement-breakpoint
ALTER TABLE `surveys` ADD `closes_at` integer;--> statement-breakpoint
ALTER TABLE `surveys` ADD `sent_at` integer;--> statement-breakpoint
ALTER TABLE `surveys` ADD `reminder_at` integer;--> statement-breakpoint
ALTER TABLE `surveys` ADD `reminder_sent_at` integer;--> statement-breakpoint
ALTER TABLE `surveys` ADD `allow_walk_in` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `surveys` ADD `share_with_organizers` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `surveys` ADD `email_invitees` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `surveys` ADD `ai_summary_json` text;--> statement-breakpoint
ALTER TABLE `surveys` ADD `ai_summary_at` integer;--> statement-breakpoint
ALTER TABLE `surveys` ADD `ai_summary_response_count` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `surveys_event_id_unique` ON `surveys` (`event_id`);--> statement-breakpoint
ALTER TABLE `survey_answers` ADD `hidden_from_organizers` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `survey_questions` ADD `required` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `survey_questions` ADD `help` text;--> statement-breakpoint
ALTER TABLE `survey_questions` ADD `metric_key` text;--> statement-breakpoint
ALTER TABLE `survey_responses` ADD `source` text DEFAULT 'invited' NOT NULL;--> statement-breakpoint
-- Hand-written below this line (drizzle-kit emits DDL only). Asserted in scripts/verify-preservation.ts.
-- drizzle-kit wrote the template_id FK without ON DELETE; it is corrected above by hand to match schema.ts.
-- The standard templates from the event-feedback spec, section 6.
INSERT OR IGNORE INTO `survey_templates` (`id`, `name`, `description`, `questions_json`, `position`) VALUES ('stpl_standard', 'Standard event feedback', 'The default form for any event.', '[{"type":"scale","prompt":"Overall, how satisfied were you with this event?","required":true,"metricKey":"overall","options":["Very dissatisfied","Very satisfied"]},{"type":"scale","prompt":"Event flow: timing and order of activities.","help":"Was the time enough? Did the order make sense?","required":true,"metricKey":"flow","options":["Very dissatisfied","Very satisfied"]},{"type":"scale","prompt":"Content: talks, activities, discussions.","help":"Was it relevant and worth your time?","required":true,"metricKey":"content","options":["Very dissatisfied","Very satisfied"]},{"type":"scale","prompt":"Venue: space and equipment.","help":"Was the space enough? Did the equipment work?","required":true,"metricKey":"venue","options":["Very dissatisfied","Very satisfied"]},{"type":"scale","prompt":"How likely are you to attend a similar CODE event?","required":true,"metricKey":"return_intent","options":["Not at all likely","Very likely"]},{"type":"text","prompt":"What was the most valuable part of the event?","required":false},{"type":"text","prompt":"What is one thing we should change next time?","required":false}]', 0);--> statement-breakpoint
INSERT OR IGNORE INTO `survey_templates` (`id`, `name`, `description`, `questions_json`, `position`) VALUES ('stpl_pulse', 'Quick pulse', 'For small or recurring events.', '[{"type":"scale","prompt":"Overall, how satisfied were you with this event?","required":true,"metricKey":"overall","options":["Very dissatisfied","Very satisfied"]},{"type":"scale","prompt":"How likely are you to attend a similar CODE event?","required":true,"metricKey":"return_intent","options":["Not at all likely","Very likely"]},{"type":"text","prompt":"Anything we should know?","required":false}]', 1);--> statement-breakpoint
INSERT OR IGNORE INTO `survey_templates` (`id`, `name`, `description`, `questions_json`, `position`) VALUES ('stpl_workshop', 'Workshop / learning session', 'For workshops and learning sessions.', '[{"type":"scale","prompt":"Overall, how satisfied were you with this event?","required":true,"metricKey":"overall","options":["Very dissatisfied","Very satisfied"]},{"type":"scale","prompt":"I learned something I can use.","required":true,"metricKey":"learning","options":["Strongly disagree","Strongly agree"]},{"type":"scale","prompt":"Content: was it clear and relevant?","required":true,"metricKey":"content","options":["Very dissatisfied","Very satisfied"]},{"type":"choice","prompt":"The pace was...","required":true,"options":["Too slow","About right","Too fast"]},{"type":"scale","prompt":"How likely are you to attend a similar CODE event?","required":true,"metricKey":"return_intent","options":["Not at all likely","Very likely"]},{"type":"text","prompt":"What should the next session cover?","required":false}]', 2);--> statement-breakpoint
INSERT OR IGNORE INTO email_categories (id, name, description, required, sort_order) VALUES ('ecat_feedback','Feedback requests','Invitations and reminders to give event feedback.',0,90);