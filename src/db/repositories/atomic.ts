type AtomicDb = {
	batch?: (queries: unknown[]) => Promise<unknown>;
	transaction?: (callback: () => void) => unknown;
};

/**
 * Run already-built Drizzle query builders as one atomic unit.
 *
 * D1 (Workers, tests): `db.batch` runs them in a single implicit transaction.
 *
 * Local dev (better-sqlite3): db.batch is unavailable, and these `queries` are
 * already-built Drizzle query builders, not thunks, so they can't be re-run
 * inside a fresh callback. db.transaction() is synchronous for this driver and
 * will reject an async callback ("Transaction function cannot return a
 * promise"), so we must not `await` inside it. Instead we call the
 * synchronous `.run()` each builder exposes (verified empirically: since
 * better-sqlite3 has a single shared connection, statements run via `.run()`
 * inside this callback are captured by the surrounding BEGIN/COMMIT/ROLLBACK
 * even though the builders were constructed against `db`, not the `tx`
 * handed to the callback).
 */
export async function runAtomic(db: unknown, queries: unknown[]): Promise<void> {
	const atomicDb = db as AtomicDb;
	if (atomicDb.batch) {
		await atomicDb.batch(queries);
		return;
	}
	if (!atomicDb.transaction) throw new Error("Atomic database updates are unavailable.");
	atomicDb.transaction(() => {
		for (const query of queries) (query as { run: () => unknown }).run();
	});
}
