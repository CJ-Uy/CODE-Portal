import { describe, expect, it } from "vitest";
import { planMigrations } from "./migrations-plan";

const FILES = [
	"0000_young_bullseye.sql",
	"0001_v5_drop_deferred.sql",
	"0002_v5_add_foundation.sql",
	"0003_phase_9_rate_limit_counters.sql",
	"0004_robust_blue_shield.sql",
	"0005_bored_luke_cage.sql",
	"0006_bright_glorian.sql",
	"0007_flippant_leech.sql",
	"0008_elite_rogue.sql",
	"0009_events_member_owned.sql",
];

describe("planMigrations", () => {
	it("applies everything to a fresh database", () => {
		const plan = planMigrations({ files: FILES, applied: [], legacyAppliedCount: 0 });
		expect(plan.bootstrap).toEqual([]);
		expect(plan.pending).toEqual(FILES);
	});

	it("adopts a drizzle-migrated database without re-applying its history", () => {
		// The real bug: .local/dev.db had 9 __drizzle_migrations rows and no 0009,
		// because 0009 was hand-written and never entered meta/_journal.json.
		const plan = planMigrations({ files: FILES, applied: [], legacyAppliedCount: 9 });
		expect(plan.bootstrap).toEqual(FILES.slice(0, 9));
		expect(plan.pending).toEqual(["0009_events_member_owned.sql"]);
	});

	it("is a no-op on a second run", () => {
		const plan = planMigrations({ files: FILES, applied: FILES, legacyAppliedCount: 9 });
		expect(plan.bootstrap).toEqual([]);
		expect(plan.pending).toEqual([]);
	});

	it("applies only new files once adopted", () => {
		const plan = planMigrations({
			files: [...FILES, "0010_event_type_rules.sql"],
			applied: FILES,
			legacyAppliedCount: 9,
		});
		expect(plan.bootstrap).toEqual([]);
		expect(plan.pending).toEqual(["0010_event_type_rules.sql"]);
	});

	it("sorts by filename and ignores non-sql entries", () => {
		const plan = planMigrations({
			files: ["0002_c.sql", "meta", "0000_a.sql", "0001_b.sql"],
			applied: [],
			legacyAppliedCount: 0,
		});
		expect(plan.pending).toEqual(["0000_a.sql", "0001_b.sql", "0002_c.sql"]);
	});
});
