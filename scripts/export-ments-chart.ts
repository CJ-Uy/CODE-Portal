import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

// Published chart snapshot from 2026-10-05. This only writes a reviewable SQL file.
const source = path.resolve("docs/data/ments-chart.tsv");
// Spelling variants confirmed as the same people by the chart owner.
const aliases = new Map([
	["MATUTINA, Lorenzo S. Matutina", "MATUTINA, Lorenzo S."],
	["NAVAL, Victoria Isabell", "NAVAL, Victoria Isabelle S."],
]);
const pairs = readFileSync(source, "utf8").trimEnd().split(/\r?\n/).map((row) => row.split("\t"));
const mentors = new Map<string, string | null>();
for (const [rawName, rawMentor] of pairs) {
	const name = aliases.get(rawName) ?? rawName;
	const mentor = aliases.get(rawMentor) ?? rawMentor;
	if (mentor && !mentors.has(mentor)) mentors.set(mentor, null);
	if (!name) continue;
	if (mentors.get(name) && mentors.get(name) !== mentor) throw new Error(`Conflicting ments for ${name}.`);
	if (mentor || !mentors.has(name)) mentors.set(name, mentor || null);
}
for (const name of mentors.keys()) {
	const seen = new Set([name]);
	let next = mentors.get(name);
	while (next) {
		if (seen.has(next)) throw new Error(`Cycle in chart for ${name}.`);
		seen.add(next);
		next = mentors.get(next);
	}
}
const id = (name: string) => `mnt_chart_${createHash("sha256").update(name).digest("hex").slice(0, 24)}`;
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const values = [...mentors].map(([name, mentor]) => `(${quote(id(name))}, ${quote(name)}, ${mentor ? quote(id(mentor)) : "NULL"})`);
const sql = `-- Beta chart snapshot, additive. Existing profiles are kept.\nINSERT INTO ments_people (id, name, mentor_id) VALUES\n${values.join(",\n")}\nON CONFLICT(id) DO NOTHING;\n`;
const output = path.resolve(".local/ments-chart-seed.sql");
mkdirSync(path.dirname(output), { recursive: true });
writeFileSync(output, sql, "utf8");
console.log(`${mentors.size} people, ${[...mentors.values()].filter(Boolean).length} relationships, ${[...mentors.values()].filter((mentor) => !mentor).length} branches`);
console.log(`Wrote ${output}`);
