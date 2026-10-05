CREATE TABLE `ments_pments` (
	`member_id` text NOT NULL,
	`person_id` text NOT NULL,
	PRIMARY KEY(`member_id`, `person_id`),
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `ments_people`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ments_pments_person_idx` ON `ments_pments` (`person_id`);