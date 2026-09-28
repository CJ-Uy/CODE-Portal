export type MigrationPlan = {
	/** Already-applied files to record without executing (adopting a drizzle-migrated database). */
	bootstrap: string[];
	/** Files to execute, in order. */
	pending: string[];
};

export type MigrationPlanInput = {
	/** Directory listing of the migrations folder; non-.sql entries are ignored. */
	files: string[];
	/** Names already recorded in d1_migrations. */
	applied: string[];
	/** Row count in __drizzle_migrations, or 0 when that table is absent. */
	legacyAppliedCount: number;
};

export function planMigrations(input: MigrationPlanInput): MigrationPlan {
	const sorted = input.files.filter((file) => file.endsWith(".sql")).sort();

	// Drizzle's table stores hashes, not filenames, but its rows are written in
	// strict journal order — so N rows means the first N files ran.
	const bootstrap = input.applied.length === 0 && input.legacyAppliedCount > 0 ? sorted.slice(0, input.legacyAppliedCount) : [];

	const done = new Set([...input.applied, ...bootstrap]);
	return { bootstrap, pending: sorted.filter((file) => !done.has(file)) };
}
