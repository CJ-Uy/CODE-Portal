import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
	clientNameHits,
	countClientNames,
	crossDocumentNames,
	dedupeByHash,
	itemInsertSql,
	searchTextOf,
	seedStatements,
	sqlLiteral,
	verdictContent,
	verdictFields,
	type ImportItem,
	type SeedTag,
} from "./sql";

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
	tagNames: [],
	file: { key: "library/lib_imp_fake/import/abcdef12.pdf", name: "MOD-999.pdf", type: "application/pdf", bytes: 10 },
	url: null,
	blocks: [],
	confidentiality: "members",
	clientDataRedacted: false,
	containsClientData: false,
	publicReadiness: null,
	extractedText: "",
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

	it("leaves a confidential item ownerless, so only library:manage can open its original (R35)", () => {
		expect(itemInsertSql(fakeImportItem({ ownerMemberId: "mem_owner" }))[0]).toContain("'mem_owner'");
		const confidential = fakeImportItem({ ownerMemberId: "mem_owner", confidentiality: "confidential", containsClientData: true });
		expect(itemInsertSql(confidential)[0]).not.toContain("mem_owner");
	});
});

describe("searchTextOf", () => {
	it("builds search text from the item's own fields, with extracted text only for a clean item", () => {
		const clean = searchTextOf(fakeImportItem({ extractedText: "Needle", tagNames: ["Leadership"] }));
		expect(clean).toContain("needle");
		expect(clean).toContain("leadership");
		expect(clean).toContain("synthetic module");
		for (const over of [{ clientDataRedacted: true }, { confidentiality: "confidential" as const, containsClientData: true }]) {
			expect(searchTextOf(fakeImportItem({ ...over, extractedText: "Needle" }))).not.toContain("needle");
		}
	});

	it("caps search text at 60k characters", () => {
		expect(searchTextOf(fakeImportItem({ dek: "c".repeat(70_000) }))).toHaveLength(60_000);
	});
});

describe("verdictContent", () => {
	const files = { original: "original.pdf", redacted: "redacted.pdf" };
	const text = () => "Original text";
	it("uploads the original with its text when clean, the redacted copy without text when redacted, the original without text when confidential", () => {
		expect(verdictContent("clean", files, text)).toMatchObject({ upload: "original.pdf", extractedText: "Original text", confidentiality: "members" });
		expect(verdictContent("redacted", files, text)).toMatchObject({ upload: "redacted.pdf", extractedText: "", clientDataRedacted: true });
		expect(verdictContent("confidential", files, text)).toMatchObject({ upload: "original.pdf", extractedText: "", confidentiality: "confidential" });
		expect(() => verdictContent("redacted", { original: "original.pdf", redacted: null }, text)).toThrow(/redacted file/);
	});
});

describe("cross-document client names (R32)", () => {
	// Synthetic: "Acme Widgets" is a client org flagged in document A.
	const reviewA = [
		{ text: "Acme  Widgets", label: "[Client org]" },
		{ text: "Zed", label: "[Client org]" },
		{ text: "Jane Roe", label: "[Client member]" },
		{ text: "Budget figures for 2020", label: "[Client detail]" },
	];
	const names = crossDocumentNames(reviewA);

	it("keeps org and member names of two or more words only", () => {
		expect(names).toEqual(["acme widgets", "jane roe"]);
	});

	it("matches whole words, case-insensitively, across line breaks", () => {
		expect(countClientNames("We met ACME\nWidgets twice; acme widgets again.", names)).toBe(2);
		expect(countClientNames("Acme Widgetsmith and Jane Roebuck are other people.", names)).toBe(0);
	});

	it("holds a clean document B that mentions document A's client", () => {
		const docB = { verdict: "clean" as const, shown: ["Module B", "Topics"], text: "Notes from the Acme\n Widgets session.", ownStrings: [] };
		expect(clientNameHits(docB, names)).toBe(1);
		// A single-word flag never escalates.
		expect(clientNameHits({ ...docB, text: "Notes from the Zed session." }, crossDocumentNames([{ text: "Zed", label: "[Client org]" }]))).toBe(0);
	});

	it("checks shown fields of any non-confidential item, and a redacted text except for its own (already removed) strings", () => {
		expect(clientNameHits({ verdict: "clean", shown: ["Working with Jane Roe"], text: "", ownStrings: [] }, names)).toBe(1);
		const redacted = { verdict: "redacted" as const, shown: ["Module C"], text: "Acme Widgets and Jane Roe", ownStrings: [{ text: "Acme Widgets", label: "[Client org]" }] };
		expect(clientNameHits(redacted, names)).toBe(1);
		expect(clientNameHits({ ...redacted, verdict: "confidential" }, names)).toBe(0);
	});

	it("counts a redacted document's own flagged name when its title or summary shows it, and skips an unreviewed one", () => {
		const own = [{ text: "Acme Widgets", label: "[Client org]" }];
		expect(clientNameHits({ verdict: "redacted", shown: ["Acme Widgets retreat"], text: "", ownStrings: own }, names)).toBe(1);
		expect(clientNameHits({ verdict: "redacted", shown: ["Module C", "Summary naming acme widgets"], text: "", ownStrings: own }, names)).toBe(1);
		expect(clientNameHits({ verdict: null, shown: ["Acme Widgets"], text: "Jane Roe", ownStrings: [] }, names)).toBe(0);
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

	it("caps extracted text at 40k characters, and search text follows it", async () => {
		const item = fakeImportItem({ id: "lib_imp_long_text", extractedText: "a".repeat(50_000) });
		await run(seedStatements({ tags, items: [item] }));
		const row = await env.DB.prepare("SELECT length(extracted_text) AS e, length(search_text) AS s FROM library_items WHERE id = 'lib_imp_long_text'").first();
		expect(row).toEqual({ e: 40_000, s: searchTextOf(item).length });
		expect(searchTextOf(item).length).toBeGreaterThan(40_000);
	});

	it("fails loudly when a statement would pass D1's size limit", () => {
		const blocks = Array.from({ length: 10 }, (_, n) => ({ id: `b${n}`, type: "text" as const, props: { text: "x".repeat(9_500) } }));
		expect(() => seedStatements({ tags, items: [fakeImportItem({ id: "lib_imp_huge", format: "page", file: null, blocks })] })).toThrow(
			/lib_imp_huge.*bytes/,
		);
	});
});
