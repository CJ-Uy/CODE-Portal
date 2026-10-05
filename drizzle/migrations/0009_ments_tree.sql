CREATE TABLE `ments_people` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`cohort` text,
	`member_id` text,
	`mentor_id` text,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`mentor_id`) REFERENCES `ments_people`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ments_people_not_self" CHECK("ments_people"."mentor_id" IS NULL OR "ments_people"."mentor_id" <> "ments_people"."id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ments_people_member_unique` ON `ments_people` (`member_id`);--> statement-breakpoint
CREATE INDEX `ments_people_mentor_idx` ON `ments_people` (`mentor_id`);
--> statement-breakpoint
CREATE TRIGGER ments_people_insert_no_cycle
BEFORE INSERT ON ments_people WHEN NEW.mentor_id IS NOT NULL
BEGIN
	SELECT RAISE(ABORT, 'Ments assignment would create a loop') WHERE EXISTS (
		WITH RECURSIVE ancestors(id) AS (
			SELECT NEW.mentor_id
			UNION
			SELECT person.mentor_id FROM ments_people person JOIN ancestors ON person.id = ancestors.id
			WHERE person.mentor_id IS NOT NULL
		) SELECT 1 FROM ancestors WHERE id = NEW.id
	);
END;
--> statement-breakpoint
CREATE TRIGGER ments_people_update_no_cycle
BEFORE UPDATE OF mentor_id ON ments_people WHEN NEW.mentor_id IS NOT NULL
BEGIN
	SELECT RAISE(ABORT, 'Ments assignment would create a loop') WHERE EXISTS (
		WITH RECURSIVE ancestors(id) AS (
			SELECT NEW.mentor_id
			UNION
			SELECT person.mentor_id FROM ments_people person JOIN ancestors ON person.id = ancestors.id
			WHERE person.mentor_id IS NOT NULL
		) SELECT 1 FROM ancestors WHERE id = NEW.id
	);
END;
