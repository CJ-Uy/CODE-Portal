/**
 * Seed rows to SQL for the library import. Pure (no fs, no crypto) so the Workers test pool can load it.
 * Every statement is INSERT OR IGNORE, so applying seed.sql twice changes nothing.
 */
import { blocksToPlainText, readMinutes, type LibraryBlock } from "@/lib/library/blocks";
import type { LibraryAuthor, LibraryFormat, LibraryKind, LibraryPublicReadiness, LibrarySource } from "@/lib/library/taxonomy";

export type Verdict = "clean" | "redacted" | "confidential";

export type ImportItem = {
	id: string;
	kind: LibraryKind;
	format: LibraryFormat;
	source: LibrarySource;
	title: string;
	dek: string;
	fileCode: string | null;
	authors: LibraryAuthor[];
	ownerMemberId: string | null;
	subtype: string | null;
	formatDetail: string | null;
	engagementType: string | null;
	year: number | null;
	tagSlugs: string[];
	file: { key: string; name: string; type: string; bytes: number } | null;
	url: string | null;
	blocks: LibraryBlock[];
	confidentiality: "members" | "confidential";
	clientDataRedacted: boolean;
	containsClientData: boolean;
	publicReadiness: LibraryPublicReadiness | null;
	extractedText: string;
	searchText: string;
	/** Epoch ms. */
	publishedAt: number;
};

export type SeedTag = { id: string; name: string; slug: string; groupName: string };

export const EXTRACTED_TEXT_CAP = 40_000;
export const SEARCH_TEXT_CAP = 60_000;
/** D1 rejects a statement over about 100 KB. */
export const MAX_STATEMENT_BYTES = 90_000;

/** Mirrors literal() in scripts/export-seed-sql.ts. */
export function sqlLiteral(value: unknown): string {
	if (value === null || value === undefined) return "NULL";
	if (typeof value === "number") return String(value);
	if (typeof value === "bigint") return value.toString();
	if (typeof value === "boolean") return value ? "1" : "0";
	return `'${String(value).replace(/'/g, "''")}'`;
}

/** The client-data review verdict as item visibility. Everything that needed no review counts as clean. */
export function verdictFields(verdict: Verdict | null): Pick<ImportItem, "confidentiality" | "clientDataRedacted" | "containsClientData"> {
	if (verdict === "clean") return { confidentiality: "members", clientDataRedacted: false, containsClientData: false };
	if (verdict === "redacted") return { confidentiality: "members", clientDataRedacted: true, containsClientData: false };
	if (verdict === "confidential") return { confidentiality: "confidential", clientDataRedacted: false, containsClientData: true };
	throw new Error("Every document needs a review verdict before the seed SQL is written.");
}

const STRICTNESS: Record<Verdict, number> = { clean: 0, redacted: 1, confidential: 2 };
// An unreviewed file counts as the strictest, so a duplicate never loosens it.
const strictness = (verdict: Verdict | null) => (verdict === null ? 3 : STRICTNESS[verdict]);

/**
 * One entry per byte-identical file. The kept copy is the one with the strictest verdict (first in input order on a tie),
 * so dropping a duplicate can never make client data more visible. Input order is preserved.
 */
export function dedupeByHash<T extends { id: string; sha256: string; verdict: Verdict | null }>(
	entries: T[],
): { kept: T[]; duplicates: { id: string; of: string }[] } {
	const best = new Map<string, T>();
	for (const entry of entries) {
		const current = best.get(entry.sha256);
		if (!current || strictness(entry.verdict) > strictness(current.verdict)) best.set(entry.sha256, entry);
	}
	const kept = entries.filter((entry) => best.get(entry.sha256) === entry);
	const duplicates = entries.filter((entry) => best.get(entry.sha256) !== entry).map((entry) => ({ id: entry.id, of: best.get(entry.sha256)!.id }));
	return { kept, duplicates };
}

export function tagInsertSql(tag: SeedTag): string {
	return `INSERT OR IGNORE INTO library_tags (id, name, slug, group_name) VALUES (${[tag.id, tag.name, tag.slug, tag.groupName].map(sqlLiteral).join(", ")});`;
}

/** NULL when the member is not in this database, so a seed made from beta's members still applies locally. */
const memberRef = (memberId: string | null) => (memberId ? `(SELECT id FROM members WHERE id = ${sqlLiteral(memberId)})` : "NULL");

/** The item insert, then one tag link per slug (resolved by slug, so it finds a tag whatever its id). */
export function itemInsertSql(item: ImportItem): string[] {
	if (item.extractedText && (item.clientDataRedacted || item.confidentiality === "confidential")) {
		throw new Error(`${item.id}: extracted text is only stored for clean items. Redacted and confidential files are read later by the indexer.`);
	}
	const columns: Record<string, string> = {
		id: sqlLiteral(item.id),
		kind: sqlLiteral(item.kind),
		format: sqlLiteral(item.format),
		source: sqlLiteral(item.source),
		status: sqlLiteral("published"),
		title: sqlLiteral(item.title),
		dek: sqlLiteral(item.dek),
		read_minutes: sqlLiteral(item.format === "page" ? readMinutes(blocksToPlainText(item.blocks)) : 5),
		blocks_json: sqlLiteral(JSON.stringify(item.blocks)),
		authors_json: sqlLiteral(JSON.stringify(item.authors)),
		subtype: sqlLiteral(item.subtype),
		format_detail: sqlLiteral(item.formatDetail),
		engagement_type: sqlLiteral(item.engagementType),
		year: sqlLiteral(item.year),
		file_code: sqlLiteral(item.fileCode),
		file_key: sqlLiteral(item.file?.key),
		file_name: sqlLiteral(item.file?.name),
		file_type: sqlLiteral(item.file?.type),
		file_bytes: sqlLiteral(item.file?.bytes),
		url: sqlLiteral(item.url),
		confidentiality: sqlLiteral(item.confidentiality),
		contains_client_data: sqlLiteral(item.containsClientData),
		client_data_redacted: sqlLiteral(item.clientDataRedacted),
		public_readiness: sqlLiteral(item.publicReadiness),
		extracted_text: sqlLiteral(item.extractedText.slice(0, EXTRACTED_TEXT_CAP)),
		search_text: sqlLiteral(item.searchText.slice(0, SEARCH_TEXT_CAP)),
		created_by: memberRef(item.ownerMemberId),
		published_at: sqlLiteral(item.publishedAt),
		updated_at: sqlLiteral(item.publishedAt),
	};
	return [
		`INSERT OR IGNORE INTO library_items (${Object.keys(columns).join(", ")}) VALUES (${Object.values(columns).join(", ")});`,
		...[...new Set(item.tagSlugs)].map(
			(slug) => `INSERT OR IGNORE INTO library_item_tags (item_id, tag_id) SELECT ${sqlLiteral(item.id)}, id FROM library_tags WHERE slug = ${sqlLiteral(slug)};`,
		),
	];
}

const utf8 = new TextEncoder();

/**
 * Tags, then items, then item tags, then (when the actor exists here) one audit row. Throws naming the item when a
 * statement passes MAX_STATEMENT_BYTES.
 */
export function seedStatements(input: { tags: SeedTag[]; items: ImportItem[]; audit?: { id: string; actorMemberId: string; detail: string } }): string[] {
	const perItem = input.items.map((item) => ({ label: item.id, sql: itemInsertSql(item) }));
	const { audit } = input;
	const labelled = [
		...input.tags.map((tag) => ({ label: tag.id, statement: tagInsertSql(tag) })),
		...perItem.map(({ label, sql }) => ({ label, statement: sql[0] })),
		...perItem.flatMap(({ label, sql }) => sql.slice(1).map((statement) => ({ label, statement }))),
		...(audit
			? [
					{
						label: audit.id,
						// A SELECT from members, so the row is skipped (not a foreign-key failure) where the actor does not exist.
						statement: `INSERT OR IGNORE INTO audit_logs (id, actor_member_id, actor_context, action, target_type, target_id, detail, category) SELECT ${sqlLiteral(audit.id)}, id, 'session', 'library:import', 'library_import', 'seed', ${sqlLiteral(audit.detail)}, 'library' FROM members WHERE id = ${sqlLiteral(audit.actorMemberId)};`,
					},
				]
			: []),
	];
	for (const { label, statement } of labelled) {
		const bytes = utf8.encode(statement).length;
		if (bytes > MAX_STATEMENT_BYTES) throw new Error(`${label}: a statement is ${bytes} bytes, over the ${MAX_STATEMENT_BYTES} bytes D1 can take.`);
	}
	return labelled.map(({ statement }) => statement);
}
