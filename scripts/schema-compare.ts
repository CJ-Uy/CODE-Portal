export type ColumnSpec = { type: string; notnull: number; dflt: string | null; pk: number };
export type DbSnapshot = {
	tables: Record<string, { cols: Record<string, ColumnSpec>; fks: string[] }>;
	indexes: Record<string, { table: string; unique: number; cols: string[] }>;
};

/**
 * sqlite stores a default as the literal text it was declared with, so the same value
 * arrives spelled differently depending on whether the column came from hand-written SQL
 * or a drizzle render. sqlite has no boolean type: true and false are keywords for 1 and
 * 0, and it wraps expression defaults in parentheses.
 */
export function normalizeDefault(value: string | null): string | null {
	if (value === null || value === undefined) return null;
	let v = String(value).replace(/\s+/g, "").replace(/^\((.*)\)$/, "$1").toLowerCase();
	if (v === "true") v = "1";
	if (v === "false") v = "0";
	return v;
}

/**
 * Compares structure rather than DDL text. Column order is deliberately ignored: a column
 * added by ALTER TABLE lands at the end of the table while a from-scratch render places it
 * in declaration order, so one schema has two equally valid texts.
 */
export function compareSnapshots(a: DbSnapshot, b: DbSnapshot): string[] {
	const problems: string[] = [];
	const spec = (c: ColumnSpec) => JSON.stringify({ ...c, dflt: normalizeDefault(c.dflt) });

	for (const table of [...new Set([...Object.keys(a.tables), ...Object.keys(b.tables)])].sort()) {
		const ta = a.tables[table];
		const tb = b.tables[table];
		if (!ta) {
			problems.push(`table only in B: ${table}`);
			continue;
		}
		if (!tb) {
			problems.push(`table only in A: ${table}`);
			continue;
		}
		for (const name of [...new Set([...Object.keys(ta.cols), ...Object.keys(tb.cols)])].sort()) {
			if (!ta.cols[name]) problems.push(`${table}.${name} only in B`);
			else if (!tb.cols[name]) problems.push(`${table}.${name} only in A`);
			else if (spec(ta.cols[name]) !== spec(tb.cols[name])) {
				problems.push(`${table}.${name} differs: A=${spec(ta.cols[name])} B=${spec(tb.cols[name])}`);
			}
		}
		if (JSON.stringify([...ta.fks].sort()) !== JSON.stringify([...tb.fks].sort())) {
			problems.push(`${table} FKs differ: A=[${[...ta.fks].sort().join(" | ")}] B=[${[...tb.fks].sort().join(" | ")}]`);
		}
	}

	for (const name of [...new Set([...Object.keys(a.indexes), ...Object.keys(b.indexes)])].sort()) {
		const ia = a.indexes[name];
		const ib = b.indexes[name];
		if (!ia) problems.push(`index only in B: ${name}`);
		else if (!ib) problems.push(`index only in A: ${name}`);
		else if (JSON.stringify(ia) !== JSON.stringify(ib)) {
			problems.push(`index ${name} differs: A=${JSON.stringify(ia)} B=${JSON.stringify(ib)}`);
		}
	}

	return problems;
}
