/**
 * Library data cleanup, run by hand. Reads only .local/library-cleanup/ and never touches a remote.
 *
 *   pnpm tsx scripts/library-cleanup/run.ts report   report.md (before and after, plus what needs a person) and cleanup.sql
 *   pnpm tsx scripts/library-cleanup/run.ts local    also loads the cleaned items into LOCAL_SQLITE_PATH for a local preview
 *                                                     (replaces the demo seed items there; local SQLite only)
 *
 * Inputs (private, gitignored):
 *   items.json      [id without "lib_imp_", title, summary (cut at 160 chars), confidential 0/1, type label, by, year][]
 *   overrides.json  { [id]: { title?, authors?: [from, to][], note? } }
 *
 * cleanup.sql is for a person to review and run. It changes titles, summaries and author names only, and
 * leaves search text and the vector index to be rebuilt afterwards from the admin page.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "@/db/schema";
import { buildSearchText } from "@/lib/library/blocks";
import { KIND_LABELS, type LibraryAuthor, type LibraryKind, type LibrarySource } from "@/lib/library/taxonomy";
import { cleanAuthor, cleanTitle, cleanTopics, fallbackTitle, isPlaceholderTitle, undoLineJoin } from "./rules";

const ROOT = path.resolve(".local/library-cleanup");
const at = (file: string) => path.join(ROOT, file);
const SUMMARY_CUT = 160;

type Row = [string, string, string, 0 | 1, string, string, string];
type Override = { title?: string; authors?: [string, string][]; note?: string };
export type Planned = {
	id: string;
	kind: LibraryKind;
	confidential: boolean;
	year: number | null;
	before: { title: string; dek: string; by: string };
	after: { title: string; dek: string; authors: string[] };
	authorFixes: [string, string][];
	dropUnknownAuthor: boolean;
	dekCut: boolean;
	notes: string[];
};

const kindOf = (label: string): LibraryKind => {
	const found = (Object.entries(KIND_LABELS) as [LibraryKind, string][]).find(([, l]) => l === label);
	if (!found) throw new Error(`Unknown type label: ${label}`);
	return found[0];
};

/** Readings list authors as "Last, First" pairs in one comma string; everyone else lists whole names. */
function splitBy(by: string, kind: LibraryKind): string[] {
	const parts = by.split(/,\s*/).filter(Boolean);
	if (kind !== "reading" || parts.length < 2) return kind === "reading" ? (by ? [by] : []) : parts;
	const names: string[] = [];
	for (let i = 0; i < parts.length; i += 2) names.push(parts[i + 1] ? `${parts[i]}, ${parts[i + 1]}` : parts[i]);
	return names;
}

export function plan(rows: Row[], overrides: Record<string, Override>): Planned[] {
	const titleCount = new Map<string, number>();
	for (const [, title] of rows) titleCount.set(title.toLowerCase(), (titleCount.get(title.toLowerCase()) ?? 0) + 1);

	return rows.map(([suffix, title, dek, confidential, label, by, year]) => {
		const kind = kindOf(label);
		const override = overrides[suffix] ?? {};
		const notes: string[] = override.note ? [override.note] : [];
		const dekCut = dek.length >= SUMMARY_CUT;
		const topics = dek.split(/,\s*/);

		// Beta titles went through the old "; " line join, so it is undone here (never in the importer).
		let newTitle = override.title ?? cleanTitle(undoLineJoin(title));
		if (isPlaceholderTitle(newTitle)) {
			// The importer prefixes the real file code. Beta's list view does not show the code, so "Untitled module"
			// stands in for it: a bare topic would read like a real title. The note asks a person for the name.
			const fallback = fallbackTitle(kind === "code_document" ? "Untitled module" : null, dekCut ? [] : topics);
			newTitle = fallback ?? newTitle;
			notes.push("The sheet had no title. This one is made from its topic; ask the author for the real name.");
		}
		if (/^(IDF|MOD)-\d+$/.test(newTitle)) notes.push("Only a file code, no name or topics. Needs a person to name it.");
		if ((titleCount.get(title.toLowerCase()) ?? 0) > 1 && kind !== "reading") notes.push(`Another item has the same title ("${title}"). Duplicate, or two versions?`);

		const names = splitBy(by, kind);
		const dropUnknownAuthor = names.some((name) => cleanAuthor(name) === null);
		const ruleFixes = names.flatMap((name): [string, string][] => {
			const cleaned = cleanAuthor(name);
			return cleaned !== null && cleaned !== name ? [[name, cleaned]] : [];
		});
		const authorFixes = [...ruleFixes, ...(override.authors ?? [])].filter(([from], i, all) => all.findIndex(([f]) => f === from) === i);
		const fixed = new Map(authorFixes);
		const authors = names.map((name) => fixed.get(name) ?? name).filter((name) => cleanAuthor(name) !== null);

		return {
			id: `lib_imp_${suffix}`,
			kind,
			confidential: confidential === 1,
			year: year ? Number(year) : null,
			before: { title, dek, by },
			after: { title: newTitle, dek: dekCut ? dek : cleanTopics(dek), authors },
			authorFixes,
			dropUnknownAuthor,
			dekCut,
			notes,
		};
	});
}

const changed = (p: Planned) => p.before.title !== p.after.title || p.before.dek !== p.after.dek || p.authorFixes.length > 0 || p.dropUnknownAuthor;
const q = (text: string) => `'${text.replace(/'/g, "''")}'`;
const NOW = "CAST(unixepoch('subsec') * 1000 AS INTEGER)";

export function toSql(planned: Planned[]): string {
	const lines = [
		"-- Library cleanup. Review every line, then run it against one database at a time.",
		"-- It changes titles, summaries and author names only. Afterwards, rebuild search text and the index from the admin library page.",
		"-- No BEGIN/COMMIT: wrangler d1 execute --file rejects them and runs the file as one batch. Needs SQLite 3.42+ (D1 has it) for unixepoch('subsec').",
		"-- Every statement is guarded, so running the file twice changes nothing the second time.",
	];
	for (const p of planned.filter(changed)) {
		lines.push(`-- ${p.id}`);
		const where = `WHERE id = ${q(p.id)}`;
		if (p.before.title !== p.after.title) lines.push(`UPDATE library_items SET title = ${q(p.after.title)}, updated_at = ${NOW} ${where} AND title = ${q(p.before.title)};`);
		if (p.before.dek !== p.after.dek) lines.push(`UPDATE library_items SET dek = ${q(p.after.dek)}, updated_at = ${NOW} ${where} AND dek = ${q(p.before.dek)};`);
		for (const [from, to] of p.authorFixes) {
			// Rebuilds the list, changing only an entry whose name is exactly `from`; memberId and the order stay.
			lines.push(
				`UPDATE library_items SET authors_json = (SELECT json_group_array(CASE WHEN json_extract(value, '$.name') = ${q(from)} THEN json_set(value, '$.name', ${q(to)}) ELSE json(value) END) FROM json_each(authors_json)), updated_at = ${NOW} ${where} AND EXISTS (SELECT 1 FROM json_each(authors_json) WHERE json_extract(value, '$.name') = ${q(from)});`,
			);
		}
		if (p.dropUnknownAuthor) {
			lines.push(
				`UPDATE library_items SET authors_json = (SELECT json_group_array(json(value)) FROM json_each(authors_json) WHERE lower(trim(json_extract(value, '$.name'))) <> 'unknown'), updated_at = ${NOW} ${where} AND EXISTS (SELECT 1 FROM json_each(authors_json) WHERE lower(trim(json_extract(value, '$.name'))) = 'unknown');`,
			);
		}
	}
	lines.push("");
	return lines.join("\n");
}

export function toReport(planned: Planned[]): string {
	const changes = planned.filter(changed);
	const flagged = planned.filter((p) => p.notes.length > 0);
	const count = (test: (p: Planned) => boolean) => planned.filter(test).length;
	const out = [
		"# Library cleanup report",
		"",
		"Private. Names and titles of members-only items. Do not commit or post.",
		"",
		`- Items read: ${planned.length}`,
		`- Items changed: ${changes.length}`,
		`- Titles changed: ${count((p) => p.before.title !== p.after.title)}`,
		`- Titles that had line-break leftovers ("; "): ${count((p) => p.before.title.includes(";"))}`,
		`- Titles that were placeholders ("*" or "unknown"): ${count((p) => isPlaceholderTitle(p.before.title))}`,
		`- Summaries changed: ${count((p) => p.before.dek !== p.after.dek)}`,
		`- Items with an "unknown" author removed: ${count((p) => p.dropUnknownAuthor)}`,
		`- Author names corrected: ${planned.reduce((n, p) => n + p.authorFixes.length, 0)}`,
		`- Items that need a person to decide: ${flagged.length}`,
		"",
		"## Needs a person",
		"",
		"| Item | Title now | Why |",
		"|---|---|---|",
		...flagged.map((p) => `| \`${p.id}\` | ${p.after.title} | ${p.notes.join(" ")} |`),
		"",
		"## Every change",
		"",
		"| Item | Field | Before | After |",
		"|---|---|---|---|",
		...changes.flatMap((p) => [
			...(p.before.title !== p.after.title ? [`| \`${p.id}\` | title | ${p.before.title} | ${p.after.title} |`] : []),
			...(p.before.dek !== p.after.dek ? [`| \`${p.id}\` | summary | ${p.before.dek} | ${p.after.dek} |`] : []),
			...p.authorFixes.map(([from, to]) => `| \`${p.id}\` | author | ${from} | ${to} |`),
			...(p.dropUnknownAuthor ? [`| \`${p.id}\` | author | unknown | (removed) |`] : []),
		]),
		"",
	];
	return out.join("\n");
}

/** Replaces the local preview's library items with the cleaned set. Local SQLite only. */
function loadLocal(planned: Planned[]): void {
	const file = process.env.LOCAL_SQLITE_PATH ?? "./.local/dev.db";
	if (!existsSync(file)) throw new Error(`${file} does not exist. Run pnpm db:migrate:local:sqlite and pnpm db:seed:local first.`);
	const sqlite = new Database(file);
	const db = drizzle(sqlite, { schema });
	const outside = new Set<LibraryKind>(["reading", "website"]);
	const rows = planned.map((p) => {
		const source: LibrarySource = outside.has(p.kind) ? "outside" : "code";
		const authorsJson: LibraryAuthor[] = p.after.authors.map((name) => ({ name }));
		const blocksJson = [
			{ id: `blk_${p.id}_note`, type: "callout" as const, props: { tone: "note" as const, text: "Local preview: this item's file and full text stay on the portal. Only its title, summary and authors were copied here." } },
		];
		const item = { title: p.after.title, dek: p.after.dek, fileCode: null, authorsJson, blocksJson, extractedText: "" };
		return {
			id: p.id,
			kind: p.kind,
			format: "page" as const,
			source,
			status: "published" as const,
			confidentiality: p.confidential ? ("confidential" as const) : ("members" as const),
			publicReadiness: p.kind === "reading" ? ("not_eligible" as const) : null,
			title: item.title,
			dek: item.dek,
			authorsJson,
			blocksJson,
			year: p.year,
			readMinutes: 1,
			searchText: buildSearchText(item, []),
		};
	});
	db.delete(schema.libraryItems).where(inArray(schema.libraryItems.id, ["lib_seed_page", "lib_seed_file", "lib_seed_link"])).run();
	db.delete(schema.libraryItems).where(inArray(schema.libraryItems.id, rows.map((r) => r.id))).run();
	for (let i = 0; i < rows.length; i += 20) db.insert(schema.libraryItems).values(rows.slice(i, i + 20)).run();
	sqlite.close();
	console.log(`Loaded ${rows.length} cleaned items into ${file}.`);
}

function main(): void {
	const mode = process.argv[2];
	if (mode !== "report" && mode !== "local") throw new Error("Usage: run.ts report | local");
	const rows = JSON.parse(readFileSync(at("items.json"), "utf8")) as Row[];
	const overrides = existsSync(at("overrides.json")) ? (JSON.parse(readFileSync(at("overrides.json"), "utf8")) as Record<string, Override>) : {};
	const planned = plan(rows, overrides);
	writeFileSync(at("report.md"), toReport(planned));
	writeFileSync(at("cleanup.sql"), toSql(planned));
	console.log(toReport(planned).split("\n## Needs a person")[0]);
	if (mode === "local") loadLocal(planned);
}

if (process.argv[1]?.endsWith("run.ts")) main();
