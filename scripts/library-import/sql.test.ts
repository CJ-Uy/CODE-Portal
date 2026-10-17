import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { dedupeByHash, itemInsertSql, seedStatements, sqlLiteral, verdictFields, type ImportItem, type SeedTag } from "./sql";

// Synthetic fixtures only: nothing here comes from the real sheet.
const fakeImportItem = (over: Partial<ImportItem> = {}): ImportItem => ({
	id: "lib_imp_fake",
	kind: "code_document",
	format: "file",
	source: "code",
	title: "Synthetic module",
	dek: "",
	fileCode: "MOD-999",
	authors: [{ name: "Test Author" }],
	ownerMemberId: null,
	subtype: "Module",
	formatDetail: "SLE",
	engagementType: null,
	year: 2020,
	tagSlugs: [],
	file: { key: "library/lib_imp_fake/import/abcdef12.pdf", name: "MOD-999.pdf", type: "application/pdf", bytes: 10 },
	url: null,
	blocks: [],
	confidentiality: "members",
	clientDataRedacted: false,
	containsClientData: false,
	publicReadiness: null,
	extractedText: "",
	searchText: "synthetic module",
	publishedAt: Date.UTC(2020, 0, 1),
	...over,
});

const tags: SeedTag[] = [
	{ id: "ltg_leadership", name: "Leadership", slug: "leadership", groupName: "Leadership" },
	{ id: "ltg_facilitation", name: "Facilitation", slug: "facilitation", groupName: "Methods" },
];

const run = (statements: string[]) => env.DB.batch(statements.map((statement) => env.DB.prepare(statement)));
const count = async (table: string) => (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())?.n;

describe("sqlLiteral", () => {
	it("escapes SQL literals", () => {
		expect(sqlLiteral("O'Brien")).toBe("'O''Brien'");
		expect(sqlLiteral(null)).toBe("NULL");
		expect(sqlLiteral(undefined)).toBe("NULL");
		expect(sqlLiteral(true)).toBe("1");
		expect(sqlLiteral(42)).toBe("42");
	});
});

describe("itemInsertSql", () => {
	it("emits idempotent inserts", () => {
		const sql = itemInsertSql(fakeImportItem({ id: "lib_imp_x", tagSlugs: ["leadership"] }));
		expect(sql[0]).toMatch(/^INSERT OR IGNORE INTO library_items/);
		expect(sql.join("\n")).toMatch(/SELECT 'lib_imp_x', id FROM library_tags WHERE slug = 'leadership'/);
	});

	it("never stores text extracted from the original of a redacted or confidential file", () => {
		expect(() => itemInsertSql(fakeImportItem({ clientDataRedacted: true, extractedText: "client name" }))).toThrow(/extracted text/i);
		expect(() =>
			itemInsertSql(fakeImportItem({ confidentiality: "confidential", containsClientData: true, extractedText: "client name" })),
		).toThrow(/extracted text/i);
		expect(() => itemInsertSql(fakeImportItem({ clientDataRedacted: true, extractedText: "" }))).not.toThrow();
	});
});

describe("verdictFields", () => {
	it("maps each review verdict to its visibility", () => {
		expect(verdictFields("clean")).toEqual({ confidentiality: "members", clientDataRedacted: false, containsClientData: false });
		expect(verdictFields("redacted")).toEqual({ confidentiality: "members", clientDataRedacted: true, containsClientData: false });
		expect(verdictFields("confidential")).toEqual({ confidentiality: "confidential", clientDataRedacted: false, containsClientData: true });
		expect(() => verdictFields(null)).toThrow(/verdict/i);
	});
});

describe("dedupeByHash", () => {
	it("keeps one of each byte-identical file, preferring the strictest verdict", () => {
		const { kept, duplicates } = dedupeByHash([
			{ id: "a", sha256: "h1", verdict: "clean" as const },
			{ id: "b", sha256: "h2", verdict: "clean" as const },
			{ id: "c", sha256: "h1", verdict: "confidential" as const },
			{ id: "d", sha256: "h1", verdict: "redacted" as const },
		]);
		expect(kept.map((entry) => entry.id)).toEqual(["b", "c"]);
		expect(duplicates).toEqual([
			{ id: "a", of: "c" },
			{ id: "d", of: "c" },
		]);
	});
});

describe("seedStatements", () => {
	it("seeds tags, then items, then item tags, and a re-run changes nothing", async () => {
		await env.DB.prepare("INSERT INTO members (id, email, name, created_at, updated_at) VALUES ('mem_owner','o@x.org','Owner',0,0)").run();
		const items = [
			fakeImportItem({ id: "lib_imp_a", ownerMemberId: "mem_owner", tagSlugs: ["leadership", "facilitation"] }),
			// An owner missing from this database becomes NULL instead of failing the foreign key.
			fakeImportItem({ id: "lib_imp_b", ownerMemberId: "mem_gone", tagSlugs: ["leadership"] }),
		];
		const statements = seedStatements({ tags, items, audit: { id: "aud_import_test", actorMemberId: "mem_owner", detail: "test import" } });

		const kinds = statements.map((statement) => /^INSERT OR IGNORE INTO (\w+)/.exec(statement)?.[1]);
		expect(kinds).toEqual(["library_tags", "library_tags", "library_items", "library_items", "library_item_tags", "library_item_tags", "library_item_tags", "audit_logs"]);

		await run(statements);
		await run(statements);
		expect(await count("library_items WHERE id IN ('lib_imp_a', 'lib_imp_b')")).toBe(2);
		expect(await count("library_item_tags WHERE item_id IN ('lib_imp_a', 'lib_imp_b')")).toBe(3);
		expect(await count("audit_logs WHERE id = 'aud_import_test'")).toBe(1);
		const owners = await env.DB.prepare("SELECT id, created_by FROM library_items WHERE id IN ('lib_imp_a', 'lib_imp_b') ORDER BY id").all();
		expect(owners.results).toEqual([
			{ id: "lib_imp_a", created_by: "mem_owner" },
			{ id: "lib_imp_b", created_by: null },
		]);
	});

	it("caps extracted text at 40k and search text at 60k characters", async () => {
		const items = [
			fakeImportItem({ id: "lib_imp_long_text", extractedText: "a".repeat(50_000), searchText: "b".repeat(45_000) }),
			fakeImportItem({ id: "lib_imp_long_search", searchText: "c".repeat(70_000) }),
		];
		await run(seedStatements({ tags, items }));
		const rows = await env.DB.prepare("SELECT id, length(extracted_text) AS e, length(search_text) AS s FROM library_items WHERE id LIKE 'lib_imp_long%' ORDER BY id").all();
		expect(rows.results).toEqual([
			{ id: "lib_imp_long_search", e: 0, s: 60_000 },
			{ id: "lib_imp_long_text", e: 40_000, s: 45_000 },
		]);
	});

	it("fails loudly when a statement would pass D1's size limit", () => {
		const blocks = Array.from({ length: 10 }, (_, n) => ({ id: `b${n}`, type: "text" as const, props: { text: "x".repeat(9_500) } }));
		expect(() => seedStatements({ tags, items: [fakeImportItem({ id: "lib_imp_huge", format: "page", file: null, blocks })] })).toThrow(
			/lib_imp_huge.*bytes/,
		);
	});
});
