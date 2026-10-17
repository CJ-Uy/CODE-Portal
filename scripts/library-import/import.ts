/**
 * Library v2 seed import (spec §15). Reads only .local/library-import/ and writes only there; never touches a remote.
 *   pnpm tsx scripts/library-import/import.ts plan   manifest.json, tag-map.json (proposals merged with earlier edits), missing.md
 *   pnpm tsx scripts/library-import/import.ts sql    seed.sql, upload-plan.tsv (key, local path, content type; no header)
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ARTICLES } from "@/content/site";
import { seedLibraryTags } from "@/db/seed/data";
import { buildSearchText, libraryBlocksSchema, type LibraryBlock } from "@/lib/library/blocks";
import {
	defaultPublicReadiness,
	defaultSource,
	normalizeDocType,
	normalizeEngagementType,
	splitAuthors,
	splitTopics,
	TAG_GROUPS,
	type LibraryAuthor,
	type LibraryFormat,
	type LibraryKind,
} from "@/lib/library/taxonomy";
import { dedupeByHash, EXTRACTED_TEXT_CAP, SEARCH_TEXT_CAP, seedStatements, verdictFields, type ImportItem, type SeedTag, type Verdict } from "./sql";
import { assertTagMapComplete, proposeTagMap, type TagMap } from "./tag-map";

const ROOT = path.resolve(".local/library-import");
const at = (...parts: string[]) => path.join(ROOT, ...parts);
const readJson = <T>(file: string): T => JSON.parse(readFileSync(at(file), "utf8")) as T;
const ALL_TAGS = TAG_GROUPS.flatMap(({ tags }) => tags);
// Tag names that contain commas, plus the sheet's spelled-out form, so splitTopics keeps them whole.
const KNOWN_PHRASES = [...ALL_TAGS.filter((tag) => tag.includes(",")), "Processes, Systems, and Structures (PSS)", "Processes, Systems, and Structures"];
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;
const MB = 1024 * 1024;

// ---------- sheet and files ----------

type Row = Record<string, unknown>;
type Sheet = Record<string, Record<string, Row>>;
type LocalFile = { path: string; sha256: string; bytes: number; ext: string; contentType: string };

const rowsOf = (sheet: Sheet, tab: string) =>
	Object.entries(sheet[tab] ?? {})
		.map(([n, row]) => ({ n: Number(n), row }))
		.sort((a, b) => a.n - b.n);
const cell = (row: Row, column: string) => String(row[column] ?? "").trim();
const driveId = (url: string) => /(?:\/d\/|[?&]id=)([-\w]{20,})/.exec(url)?.[1] ?? null;
const https = (url: string) => url.trim().replace(/^http:\/\//i, "https://");
const clip = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);
const oneLine = (text: string) => text.replace(/\s*\n\s*/g, "; ").replace(/\s+/g, " ").trim();
const yearOf = (raw: string) => {
	const year = Math.trunc(Number.parseFloat(raw));
	return year >= 1900 && year <= 2100 ? year : null;
};

const TYPES: Record<string, string> = {
	pdf: "application/pdf",
	docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
	xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	png: "image/png",
	jpg: "image/jpeg",
	webp: "image/webp",
	gif: "image/gif",
};

/** File type from magic bytes; Drive downloads often have no extension. Only types the library upload route accepts. */
function sniff(bytes: Buffer): string | null {
	const ascii = (from: number, to: number) => bytes.subarray(from, to).toString("latin1");
	if (ascii(0, 4) === "%PDF") return "pdf";
	if (bytes[0] === 0x89 && ascii(1, 4) === "PNG") return "png";
	if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
	if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
	if (ascii(0, 4) === "GIF8") return "gif";
	if (ascii(0, 4) === "PK\x03\x04") {
		const names = bytes.toString("latin1");
		return names.includes("word/") ? "docx" : names.includes("ppt/") ? "pptx" : names.includes("xl/") ? "xlsx" : null;
	}
	return null;
}

/** The file, or why there is none. */
function readLocal(file: string): LocalFile | string {
	if (!existsSync(file)) return "not downloaded";
	const bytes = readFileSync(file);
	const ext = sniff(bytes);
	if (!ext) return "unsupported file type";
	return { path: file, sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length, ext, contentType: TYPES[ext] };
}

/** `<tab>/<id>` from the public pass, or `<tab>/<id>/<original name>` from rclone. */
function findLocal(tab: string, id: string): LocalFile | string {
	const entry = at(tab, id);
	if (!existsSync(entry)) return "not downloaded";
	const files = statSync(entry).isDirectory() ? readdirSync(entry).map((name) => path.join(entry, name)) : [entry];
	return files.length === 1 ? readLocal(files[0]) : `${files.length} files in its folder`;
}

/** Download attempts per Drive id, from probe.tsv, pull.tsv and download.tsv. */
function downloadLog(): Map<string, string[]> {
	const log = new Map<string, string[]>();
	for (const [file, idColumn, statusColumn] of [
		["probe.tsv", 2, 3],
		["pull.tsv", 1, 2],
		["download.tsv", 1, 2],
	] as const) {
		if (!existsSync(at(file))) continue;
		for (const line of readFileSync(at(file), "utf8").split(/\r?\n/)) {
			const columns = line.split("\t");
			const id = columns[idColumn];
			if (id) log.set(id, [...(log.get(id) ?? []), `${file.replace(".tsv", "")} ${columns[statusColumn] ?? "?"}`]);
		}
	}
	return log;
}

// ---------- authors ----------

type Member = { id: string; name: string | null; full_name: string | null; nickname: string | null; status: string };
const nameKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");

function authorMatcher(members: Member[]) {
	const active = members.filter((member) => member.status === "active");
	const match = (name: string) => {
		const key = nameKey(name);
		const hits = active.filter((member) => {
			const last = member.full_name?.trim().split(/\s+/).at(-1);
			const nickLast = member.nickname && last ? `${member.nickname} ${last}` : null;
			return [member.name, member.full_name, nickLast].some((candidate) => candidate && nameKey(candidate) === key);
		});
		return hits.length === 1 ? hits[0].id : undefined;
	};
	/** memberId on each author that matches exactly one active member; the owner when exactly one member matched. */
	return (names: string[]): { authors: LibraryAuthor[]; owner: string | null } => {
		const authors = names.slice(0, 20).map((name): LibraryAuthor => {
			const memberId = match(name);
			return memberId ? { name: clip(name, 120), memberId } : { name: clip(name, 120) };
		});
		const matched = [...new Set(authors.flatMap((author) => (author.memberId ? [author.memberId] : [])))];
		return { authors, owner: matched.length === 1 ? matched[0] : null };
	};
}

// ---------- blocks ----------

const text = (body: string): LibraryBlock => ({ id: "", type: "text", props: { text: clip(body, 10_000) } });
const heading = (body: string): LibraryBlock => ({ id: "", type: "heading", props: { text: clip(body, 200), level: 2 } });
const list = (items: string[]): LibraryBlock => ({ id: "", type: "list", props: { ordered: false, items: items.slice(0, 100).map((item) => clip(item, 2000)) } });
const paragraphs = (body: string) =>
	body
		.split(/\n\s*\n/)
		.map((part) => part.trim())
		.filter(Boolean);
const bullets = (body: string) =>
	body
		.split("\n")
		.map((line) => line.replace(/^\s*(?:[-–•*●▪◦]|\d+[.)])\s*/, "").trim())
		.filter(Boolean);

/** "[Label] https://…" pairs (or bare links) as link cards. http is upgraded: link blocks only take https. */
function linkCards(body: string): LibraryBlock[] {
	const seen = new Set<string>();
	const cards: LibraryBlock[] = [];
	for (const match of body.matchAll(/(?:\[([^\]]*)\]\s*)?(https?:\/\/[^\s<>"]+)/g)) {
		let url = https(match[2]).replace(/[.,;]+$/, "");
		if (url.endsWith(")") && !url.includes("(")) url = url.slice(0, -1);
		if (seen.has(url)) continue;
		seen.add(url);
		cards.push({ id: "", type: "link", props: { url, title: clip(match[1]?.trim() || url.slice("https://".length).split("/")[0], 200) } });
	}
	return cards;
}

/** Deterministic ids, validated like the editor's save. */
const pageBlocks = (blocks: (LibraryBlock | false | null)[]): LibraryBlock[] =>
	libraryBlocksSchema.parse(blocks.filter((block): block is LibraryBlock => Boolean(block)).map((block, n) => ({ ...block, id: `blk_imp_${n}` })));

// ---------- drafts (what plan records, before verdicts and tags are applied) ----------

type Draft = Omit<ImportItem, "tagSlugs" | "file" | "confidentiality" | "clientDataRedacted" | "containsClientData" | "extractedText" | "searchText"> & {
	origin: string;
	rawTopics: string[];
	/** Tag names given directly, not through the tag map. */
	fixedTags: string[];
	verdict: Verdict | null;
	/** The original file. */
	file: LocalFile | null;
	redactedFile: LocalFile | null;
	/** The upload's name without extension. */
	fileStem: string | null;
	/** Text extracted from the original; sql only uses it for a clean document. */
	textFile: string | null;
	images: { key: string; file: LocalFile }[];
};
type Missing = { origin: string; label: string; driveId: string | null; reason: string };
type Manifest = { importedAt: number; drafts: Draft[]; missing: Missing[]; duplicates: { id: string; of: string; origin: string }[] };

const base = (kind: LibraryKind, format: LibraryFormat, publishedAt: number, year: number | null) => ({
	kind,
	format,
	source: defaultSource(kind),
	publicReadiness: defaultPublicReadiness(kind),
	year,
	publishedAt: year ? Date.UTC(year, 0, 1) - 8 * 3_600_000 : publishedAt,
	fixedTags: [] as string[],
	redactedFile: null,
	textFile: null,
	images: [] as Draft["images"],
	blocks: [] as LibraryBlock[],
	url: null,
	fileCode: null,
	subtype: null,
	formatDetail: null,
	engagementType: null,
	authors: [] as LibraryAuthor[],
	ownerMemberId: null,
	verdict: "clean" as Verdict | null,
	file: null,
	fileStem: null,
	rawTopics: [] as string[],
	dek: "",
});

/** The review file (in the main checkout's .local) mapped to the same place in this checkout's .local. */
function remapReviewed(file: string): string {
	const relative = file.split(/[\\/]\.local[\\/]library-import[\\/]/)[1];
	if (!relative) throw new Error("A verdict file is not under .local/library-import.");
	return at(...relative.split(/[\\/]/));
}

function readReviewedFile(file: string): LocalFile {
	const local = readLocal(remapReviewed(file));
	if (typeof local === "string") throw new Error(`A reviewed file is unusable: ${local}.`);
	return local;
}

function plan(): void {
	const importedAt = Date.now();
	const sheet = readJson<Sheet>("sheet.json");
	const verdicts = readJson<Record<string, { verdict: Verdict; file: string }>>("redacted/verdicts.json");
	const membersExport = existsSync(at("members.json")) ? readJson<{ results: Member[] }[]>("members.json") : [];
	const authorsOf = authorMatcher(membersExport.flatMap((set) => set.results ?? []));
	const log = downloadLog();
	const drafts: Draft[] = [];
	const missing: Missing[] = [];

	// Module/IDF documents.
	const docTab = "⚙️ Document Data";
	for (const { n, row } of rowsOf(sheet, docTab)) {
		const code = cell(row, "B");
		if (n <= 5 || !code) continue;
		const origin = `${docTab} row ${n}`;
		const id = driveId(cell(row, "I_url"));
		const file = id ? findLocal("Document_Data", id) : "no Drive link";
		if (!id || typeof file === "string") {
			missing.push({ origin, label: code, driveId: id, reason: typeof file === "string" ? file : "no Drive link" });
			continue;
		}
		const topicsCell = cell(row, "D");
		const docType = normalizeDocType(cell(row, "E"));
		const topics = splitTopics(topicsCell, KNOWN_PHRASES);
		const { authors, owner } = authorsOf(splitAuthors(cell(row, "G"), "code_document"));
		const reviewed = verdicts[id];
		const title = cell(row, "C") || (topics[0] ? `${code}: ${topics[0]}` : code);
		const draft: Draft = {
			...base("code_document", "file", importedAt, yearOf(cell(row, "H"))),
			id: `lib_imp_${id}`,
			origin,
			title: clip(oneLine(title), 200),
			dek: clip(oneLine(topicsCell), 500),
			fileCode: code,
			// A bare value normalizeDocType does not recognise is still a module, of an unknown format.
			subtype: docType.subtype ?? "Module",
			formatDetail: docType.subtype ? docType.formatDetail : "Other",
			engagementType: normalizeEngagementType(cell(row, "F")),
			authors,
			ownerMemberId: owner,
			// The second of a combined format ("Lecture, SLE") goes through the tag map like any topic.
			rawTopics: [...topics, ...docType.extraFormats],
			verdict: reviewed?.verdict ?? null,
			file,
			redactedFile: reviewed?.verdict === "redacted" ? readReviewedFile(reviewed.file) : null,
			fileStem: code,
			textFile: existsSync(at("text", `${id}.txt`)) ? at("text", `${id}.txt`) : null,
		};
		assertNoFlaggedStrings(id, draft);
		drafts.push(draft);
	}

	// Books and papers.
	const readingTab = "⚙️ External Library Data";
	for (const { n, row } of rowsOf(sheet, readingTab)) {
		const title = oneLine(cell(row, "D"));
		if (n <= 6 || !title) continue;
		const origin = `${readingTab} row ${n}`;
		const id = driveId(cell(row, "H_url"));
		const page = cell(row, "C_url");
		const shared = {
			...base("reading", "file", importedAt, yearOf(cell(row, "E"))),
			origin,
			title: clip(title, 200),
			authors: splitAuthors(cell(row, "C"), "reading")
				.slice(0, 20)
				.map((name) => ({ name: clip(name, 120) })),
			subtype: readingSubtype(cell(row, "G")),
			rawTopics: splitTopics(cell(row, "F"), KNOWN_PHRASES),
		};
		if (id) {
			const file = findLocal("External_Library_Data", id);
			if (typeof file === "string") missing.push({ origin, label: title, driveId: id, reason: file });
			else drafts.push({ ...shared, id: `lib_imp_${id}`, file, fileStem: clip(title.replace(/[\\/:*?"<>|]+/g, " ").trim(), 120) });
		} else if (page) {
			drafts.push({ ...shared, id: `lib_imp_link_${slug(title)}`, format: "link", url: https(page) });
		} else missing.push({ origin, label: title, driveId: null, reason: "no file or link in the sheet" });
	}

	// Frameworks. The diagram is in the right-hand table (code in S, image link in AF/AI/AJ).
	const frameworkTab = "⚙️ Framework Data";
	const frameworkRows = rowsOf(sheet, frameworkTab);
	for (const { n, row } of frameworkRows) {
		const code = cell(row, "A");
		const number = /^FMRW-(\d+)$/.exec(code)?.[1];
		if (!number) continue;
		const id = `lib_imp_fmrw_${number.padStart(3, "0")}`;
		const origin = `${frameworkTab} row ${n}`;
		const name = oneLine(cell(row, "B"));
		const imageRow = frameworkRows.find(({ row: other }) => cell(other, "S") === code)?.row;
		const imageId = imageRow ? ["AF_url", "AI", "AJ", "AF"].map((column) => driveId(cell(imageRow, column))).find(Boolean) : null;
		const image = imageId ? findLocal("Framework_Data", imageId) : "no image link";
		if (typeof image === "string") missing.push({ origin, label: `${code} diagram`, driveId: imageId ?? null, reason: image });
		const images = typeof image === "string" ? [] : [{ key: `library/${id}/import/${image.sha256.slice(0, 8)}.${image.ext}`, file: image }];
		const overview = paragraphs(cell(row, "E"));
		const useCases = bullets(cell(row, "F"));
		const links = linkCards(cell(row, "G"));
		const coders = cell(row, "I").split("\n").map((coder) => coder.trim()).filter(Boolean);
		drafts.push({
			...base("framework", "page", importedAt, null),
			id,
			origin,
			title: clip(name, 200),
			dek: clip(oneLine(overview[0] ?? ""), 300),
			fileCode: code,
			rawTopics: splitTopics(cell(row, "C"), KNOWN_PHRASES),
			images,
			blocks: pageBlocks([
				...overview.map(text),
				...images.map(({ key }): LibraryBlock => ({ id: "", type: "image", props: { key, alt: clip(`${name} diagram`, 200) } })),
				useCases.length > 0 && heading("Potential use cases"),
				useCases.length > 0 && list(useCases),
				links.length > 0 && heading("Read more"),
				...links,
				coders.length > 0 && { id: "", type: "callout", props: { tone: "note", text: clip(`CODErs who have used this framework: ${coders.join(", ")}`, 10_000) } },
			]),
		});
	}

	// Websites.
	const linkTab = "🔗 External Links";
	for (const { n, row } of rowsOf(sheet, linkTab)) {
		const url = cell(row, "F_url");
		if (n <= 6 || !url || !cell(row, "C")) continue;
		const host = new URL(https(url)).hostname.replace(/^www\./, "");
		drafts.push({
			...base("website", "link", importedAt, null),
			id: `lib_imp_web_${host.replace(/[^a-z0-9]+/g, "-")}`,
			origin: `${linkTab} row ${n}`,
			title: clip(oneLine(cell(row, "C")), 200),
			dek: clip(oneLine(cell(row, "D")), 500),
			url: https(url),
		});
	}

	// The public site's guides (committed content, not sheet data).
	for (const article of ARTICLES) {
		drafts.push({
			...base("guide", "page", importedAt, yearOf(/\d{4}/.exec(article.date)?.[0] ?? "")),
			id: `lib_imp_guide_${article.id}`,
			origin: `src/content/site.ts ARTICLES ${article.id}`,
			title: article.title,
			dek: article.dek,
			authors: [{ name: article.author }],
			fixedTags: GUIDE_TAGS[article.id] ?? [],
			blocks: pageBlocks([
				text(article.abstract),
				...article.sections.flatMap((section) => [heading(section.h), text(section.body)]),
				heading(article.components.title),
				list(article.components.items.map((item) => `**${item.name}**: ${item.def} Example: ${item.ex}`)),
				heading("Questions to reflect on"),
				list(article.questions),
				heading("References"),
				list(article.refs),
			]),
		});
	}

	const withFiles = drafts.flatMap((draft) => (draft.file ? [{ id: draft.id, sha256: draft.file.sha256, verdict: draft.verdict, draft }] : []));
	const deduped = dedupeByHash(withFiles);
	const keptFiles = new Set(deduped.kept.map((entry) => entry.draft));
	const duplicates = deduped.duplicates;
	const kept = drafts.filter((draft) => !draft.file || keptFiles.has(draft));
	const ids = kept.map((draft) => draft.id);
	const repeated = ids.filter((id, n) => ids.indexOf(id) !== n);
	if (repeated.length > 0) throw new Error(`Item ids are not unique: ${repeated.join(", ")}`);

	const manifest: Manifest = {
		importedAt,
		drafts: kept,
		missing,
		duplicates: duplicates.map((duplicate) => ({ ...duplicate, origin: drafts.find((draft) => draft.id === duplicate.id)!.origin })),
	};
	writeFileSync(at("manifest.json"), `${JSON.stringify(manifest, null, "\t")}\n`);

	const rawTopics = [...new Set(kept.flatMap((draft) => draft.rawTopics))].sort();
	const proposal = proposeTagMap(rawTopics, ALL_TAGS);
	const edited: TagMap = existsSync(at("tag-map.json")) ? readJson<TagMap>("tag-map.json") : {};
	const isDecided = (value: TagMap[string] | undefined) => value === "drop" || (Array.isArray(value) && value.length > 0);
	const tagMap: TagMap = Object.fromEntries(rawTopics.map((topic) => [topic, isDecided(edited[topic]) ? edited[topic] : proposal[topic]]));
	writeFileSync(at("tag-map.json"), `${JSON.stringify(tagMap, null, "\t")}\n`);

	writeFileSync(
		at("missing.md"),
		[
			"# Library import: not imported",
			"",
			"## Missing or unusable files",
			"",
			...missing.map((entry) => `- ${entry.origin}: ${entry.label}${entry.driveId ? ` (${entry.driveId})` : ""}: ${entry.reason}${entry.driveId && log.has(entry.driveId) ? `. Log: ${log.get(entry.driveId)!.join("; ")}` : ""}`),
			"",
			"## Duplicates (byte-identical file)",
			"",
			...manifest.duplicates.map((duplicate) => `- ${duplicate.origin}: ${duplicate.id} is a duplicate of ${duplicate.of}`),
			"",
		].join("\n"),
	);

	console.log("plan written: manifest.json, tag-map.json, missing.md");
	console.log(`items ${kept.length}`, countBy(kept, (draft) => draft.kind));
	console.log("document verdicts", countBy(kept.filter((draft) => draft.kind === "code_document"), (draft) => String(draft.verdict)));
	console.log(`missing ${missing.length}, duplicates ${duplicates.length}`);
	console.log("tags", tagStats(tagMap, proposal));
}

function readingSubtype(raw: string): string {
	const type = raw.toLowerCase();
	if (type.includes("book")) return "Book";
	if (/academic|research/.test(type)) return "Academic Article";
	return type.includes("report") ? "Report" : "Other";
}

const slug = (text: string) =>
	text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 60);

// The site's guides are committed content, so their tags are set here rather than in the local tag map.
const GUIDE_TAGS: Record<string, string[]> = {
	"organization-identity": ["Org Culture", "Vision & Mission (VMOS)"],
	"human-centered-design": ["Design Thinking / HCD"],
	"planned-change": ["Change Management", "Diagnosis"],
};

/** A redacted or clean document must not show, in its title or summary, a client string the review found in its file. */
function assertNoFlaggedStrings(driveIdValue: string, draft: Draft): void {
	if (draft.verdict === "confidential" || !existsSync(at("review", `${driveIdValue}.json`))) return;
	const review = readJson<{ strings?: { text: string }[] }>(`review/${driveIdValue}.json`);
	const shown = `${draft.title}\n${draft.dek}`.toLowerCase();
	const leaked = (review.strings ?? []).filter(({ text: flagged }) => flagged.trim() && shown.includes(flagged.trim().toLowerCase()));
	if (leaked.length > 0) throw new Error(`${draft.origin}: the title or summary contains ${leaked.length} client string(s) flagged in its file.`);
}

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const item of items) counts[key(item)] = (counts[key(item)] ?? 0) + 1;
	return counts;
}

function tagStats(map: TagMap, proposal: TagMap) {
	const entries = Object.entries(map);
	const same = (a: TagMap[string], b: TagMap[string]) => JSON.stringify(a) === JSON.stringify(b);
	return {
		raw: entries.length,
		auto: entries.filter(([topic, value]) => Array.isArray(value) && value.length > 0 && same(value, proposal[topic])).length,
		hand: entries.filter(([topic, value]) => Array.isArray(value) && value.length > 0 && !same(value, proposal[topic])).length,
		dropped: entries.filter(([, value]) => value === "drop").length,
		unmapped: entries.filter(([, value]) => Array.isArray(value) && value.length === 0).length,
	};
}

// ---------- sql ----------

function readText(file: string): string {
	return readFileSync(file, "utf8")
		.replace(/\f/g, "\n\n")
		.replace(/[\u0000-\u0008\u000B\u000E-\u001F]/g, "")
		.trim();
}

function sql(): void {
	const manifest = readJson<Manifest>("manifest.json");
	const tagMap = readJson<TagMap>("tag-map.json");
	const notInMap = [...new Set(manifest.drafts.flatMap((draft) => draft.rawTopics))].filter((topic) => !(topic in tagMap));
	if (notInMap.length > 0) throw new Error(`${notInMap.length} topic(s) are missing from tag-map.json; run plan again.`);
	assertTagMapComplete(tagMap, ALL_TAGS);
	const unreviewed = manifest.drafts.filter((draft) => draft.verdict === null);
	if (unreviewed.length > 0) throw new Error(`${unreviewed.length} document(s) have no review verdict.`);

	const tags: SeedTag[] = seedLibraryTags.map((tag) => ({ id: tag.id, name: tag.name, slug: tag.slug, groupName: tag.groupName ?? "Ungrouped" }));
	const slugOf = new Map(tags.map((tag) => [tag.name, tag.slug]));
	const uploads: { key: string; file: LocalFile }[] = [];

	const items = manifest.drafts.map((draft): ImportItem => {
		const visibility = verdictFields(draft.verdict);
		// Redacted documents upload only their redacted copy; everything else uploads the original.
		const upload = draft.verdict === "redacted" ? draft.redactedFile : draft.file;
		if (draft.format === "file" && !upload) throw new Error(`${draft.origin}: no file to upload.`);
		const file = upload && { key: `library/${draft.id}/import/${upload.sha256.slice(0, 8)}.${upload.ext}`, name: `${draft.fileStem}.${upload.ext}`, type: upload.contentType, bytes: upload.bytes };
		if (upload && file) uploads.push({ key: file.key, file: upload });
		uploads.push(...draft.images);

		const tagNames = [...new Set([...draft.fixedTags, ...draft.rawTopics.flatMap((topic) => (tagMap[topic] === "drop" ? [] : tagMap[topic]))])];
		const missingTag = tagNames.find((name) => !slugOf.has(name));
		if (missingTag) throw new Error(`${draft.origin}: unknown tag ${missingTag}.`);
		// Only a clean document keeps the text of its original: a redacted original still has the client names in it.
		const extractedText = draft.verdict === "clean" && draft.kind === "code_document" && draft.textFile ? readText(draft.textFile).slice(0, EXTRACTED_TEXT_CAP) : "";
		const searchText = buildSearchText({ ...draft, authorsJson: draft.authors, blocksJson: draft.blocks, extractedText }, tagNames).slice(0, SEARCH_TEXT_CAP);
		return {
			id: draft.id,
			kind: draft.kind,
			format: draft.format,
			source: draft.source,
			title: draft.title,
			dek: draft.dek,
			fileCode: draft.fileCode,
			authors: draft.authors,
			ownerMemberId: draft.ownerMemberId,
			subtype: draft.subtype,
			formatDetail: draft.formatDetail,
			engagementType: draft.engagementType,
			year: draft.year,
			tagSlugs: tagNames.map((name) => slugOf.get(name)!),
			file,
			url: draft.url,
			blocks: draft.blocks,
			...visibility,
			publicReadiness: draft.publicReadiness,
			extractedText,
			searchText,
			publishedAt: draft.publishedAt,
		};
	});

	for (const { key } of uploads) {
		const parts = key.split("/");
		if (parts.length !== 4 || parts[0] !== "library" || !parts.every((part) => SAFE_SEGMENT.test(part))) throw new Error(`Unsafe storage key: ${key}`);
	}

	const statements = seedStatements({
		tags,
		items,
		audit: { id: "aud_library_import_v2", actorMemberId: "mem_charles", detail: `Seeded ${items.length} library items from the library import.` },
	});
	const seed = `${statements.join("\n")}\n`;
	writeFileSync(at("seed.sql"), seed);
	writeFileSync(at("upload-plan.tsv"), uploads.map(({ key, file }) => `${key}\t${file.path}\t${file.contentType}`).join("\n") + "\n");

	const largest = Math.max(...statements.map((statement) => Buffer.byteLength(statement)));
	console.log("sql written: seed.sql, upload-plan.tsv");
	console.log(`items ${items.length}`, countBy(items, (item) => item.kind));
	console.log("formats", countBy(items, (item) => item.format));
	console.log("documents", countBy(manifest.drafts.filter((draft) => draft.kind === "code_document"), (draft) => String(draft.verdict)));
	console.log("confidential", items.filter((item) => item.confidentiality === "confidential").length, "redacted", items.filter((item) => item.clientDataRedacted).length);
	console.log("with extracted text", items.filter((item) => item.extractedText).length, "with tags", items.filter((item) => item.tagSlugs.length > 0).length);
	console.log("owners matched", items.filter((item) => item.ownerMemberId).length, "authors matched", items.flatMap((item) => item.authors).filter((author) => author.memberId).length);
	console.log(`uploads ${uploads.length} files, ${(uploads.reduce((sum, { file }) => sum + file.bytes, 0) / MB).toFixed(1)} MB`);
	console.log(`seed.sql ${statements.length} statements, ${(Buffer.byteLength(seed) / MB).toFixed(2)} MB, largest statement ${largest} bytes`);
}

const command = process.argv[2];
if (command === "plan") plan();
else if (command === "sql") sql();
else {
	console.error("Usage: pnpm tsx scripts/library-import/import.ts plan|sql");
	process.exitCode = 1;
}
