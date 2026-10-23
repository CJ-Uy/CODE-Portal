import { isMergeTag, VARIABLE_PATTERN, type MergeSheet } from "./merge";

/** Limits shared by the importer and the save schema. A draft is posted whole, so the sheet must stay well under 1 MB. */
export const SHEET_LIMITS = { rows: 2000, columns: 30, cell: 2000, bytes: 600_000 } as const;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Splits delimited text (CSV or the TSV that Google Sheets and Excel put on the clipboard). Quoted cells may hold delimiters, quotes and line breaks. */
export function parseDelimited(text: string, delimiter = detectDelimiter(text)): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = "";
	let quoted = false;
	const input = text.replace(/^﻿/, "");
	for (let i = 0; i < input.length; i++) {
		const ch = input[i];
		if (quoted) {
			if (ch === '"' && input[i + 1] === '"') { cell += '"'; i++; }
			else if (ch === '"') quoted = false;
			else cell += ch;
		} else if (ch === '"' && cell === "") quoted = true;
		else if (ch === delimiter) { row.push(cell); cell = ""; }
		else if (ch === "\n" || ch === "\r") {
			if (ch === "\r" && input[i + 1] === "\n") i++;
			row.push(cell); rows.push(row); row = []; cell = "";
		} else cell += ch;
	}
	if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
	return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** Tab wins when present (a clipboard paste); otherwise whichever of comma or semicolon the header row uses more. */
export function detectDelimiter(text: string): string {
	const header = text.slice(0, text.search(/\r|\n|$/));
	if (header.includes("\t")) return "\t";
	return (header.match(/;/g)?.length ?? 0) > (header.match(/,/g)?.length ?? 0) ? ";" : ",";
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
	const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Reads the named files out of a zip archive (stored or deflated entries). */
async function unzip(bytes: Uint8Array, wanted: (name: string) => boolean): Promise<Map<string, string>> {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let end = -1;
	for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
	if (end < 0) throw new Error("This file is not a valid .xlsx workbook.");
	const count = view.getUint16(end + 10, true);
	let at = view.getUint32(end + 16, true);
	const files = new Map<string, string>();
	const decoder = new TextDecoder();
	for (let n = 0; n < count; n++) {
		if (view.getUint32(at, true) !== 0x02014b50) throw new Error("This file is not a valid .xlsx workbook.");
		const method = view.getUint16(at + 10, true);
		const size = view.getUint32(at + 20, true);
		const nameLength = view.getUint16(at + 28, true);
		const local = view.getUint32(at + 42, true);
		const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
		at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
		if (!wanted(name)) continue;
		const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
		const data = bytes.subarray(start, start + size);
		if (method !== 0 && method !== 8) throw new Error("This workbook uses an unsupported compression method.");
		files.set(name, decoder.decode(method === 8 ? await inflateRaw(data) : data));
	}
	return files;
}

const XML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decodeXml = (value: string) =>
	value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) =>
		e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : XML_ENTITIES[e.toLowerCase()],
	);
const textRuns = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decodeXml(m[1])).join("");
const columnIndex = (ref: string) => [...ref.replace(/\d+$/, "").toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

/**
 * Reads the first worksheet of an .xlsx file as rows of display text. No dependency: the browser and Workers both
 * ship DecompressionStream. ponytail: dates arrive as Excel serial numbers; format date columns as text in the sheet.
 */
export async function parseXlsx(bytes: Uint8Array): Promise<string[][]> {
	const files = await unzip(bytes, (name) => /^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/.test(name));
	const workbook = files.get("xl/workbook.xml") ?? "";
	const rid = /<sheet\b[^>]*\br:id="([^"]+)"/.exec(workbook)?.[1]?.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const rels = files.get("xl/_rels/workbook.xml.rels") ?? "";
	const target = rid ? new RegExp(`<Relationship\\b[^>]*\\bId="${rid}"[^>]*\\bTarget="([^"]+)"`).exec(rels)?.[1] ?? new RegExp(`<Relationship\\b[^>]*\\bTarget="([^"]+)"[^>]*\\bId="${rid}"`).exec(rels)?.[1] : undefined;
	const path = target ? (target.startsWith("/") ? target.slice(1) : `xl/${target}`) : "xl/worksheets/sheet1.xml";
	const sheet = files.get(path) ?? [...files.entries()].find(([name]) => name.startsWith("xl/worksheets/"))?.[1];
	if (!sheet) throw new Error("This workbook has no worksheet to read.");
	const shared = [...(files.get("xl/sharedStrings.xml") ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textRuns(m[1]));
	const rows: string[][] = [];
	for (const [, body] of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
		const row: string[] = [];
		for (const [, attrs, inner = ""] of body.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
			const ref = /\br="([A-Z]+\d+)"/i.exec(attrs)?.[1];
			const type = /\bt="([a-zA-Z]+)"/.exec(attrs)?.[1];
			const raw = decodeXml(/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? "");
			const value = type === "s" ? (shared[Number(raw)] ?? "") : type === "inlineStr" ? textRuns(inner) : type === "b" ? (raw === "1" ? "TRUE" : "FALSE") : raw;
			row[ref ? columnIndex(ref) : row.length] = value;
		}
		rows.push(Array.from(row, (cell) => cell ?? ""));
	}
	return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** "Custom Message" becomes custom_message. Never `email`, never a duplicate. */
export function variableName(header: string, taken: Set<string>, index: number): string {
	let base = header.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 36);
	if (!base) base = `column_${index + 1}`;
	if (!/^[a-z]/.test(base)) base = `col_${base}`.slice(0, 36);
	let name = base;
	for (let n = 2; taken.has(name) || name === "email" || !VARIABLE_PATTERN.test(name); n++) name = `${base}_${n}`;
	taken.add(name);
	return name;
}

/** Picks the column named like "email", else the one whose cells most often look like addresses. */
export function guessKeyColumn(table: string[][]): number {
	const [header = [], ...rows] = table;
	const named = header.findIndex((h) => /^e-?mail(\s*address)?$/i.test(h.trim()));
	if (named >= 0) return named;
	const named2 = header.findIndex((h) => /e-?mail/i.test(h));
	if (named2 >= 0) return named2;
	let best = 0;
	let bestScore = -1;
	header.forEach((_, i) => {
		const score = rows.slice(0, 50).filter((r) => EMAIL.test(r[i]?.trim() ?? "")).length;
		if (score > bestScore) { best = i; bestScore = score; }
	});
	return best;
}

export type SheetImport = {
	sheet: MergeSheet;
	/** Data rows read, not counting the header. */
	total: number;
	/** 1-based sheet row numbers whose key cell is not an email address. */
	invalid: { row: number; value: string }[];
	/** Addresses on more than one row. The last row wins. */
	duplicates: string[];
	/** Columns dropped past the limit. */
	extraColumns: number;
};

/** Turns a header row plus data rows into merge data keyed by the chosen email column. */
export function buildSheet(table: string[][], name: string, keyIndex = guessKeyColumn(table), importedAt = new Date().toISOString()): SheetImport {
	const [header = [], ...data] = table;
	if (!header.length) throw new Error("The sheet is empty. Copy the header row with the data.");
	if (data.length > SHEET_LIMITS.rows) throw new Error(`Use at most ${SHEET_LIMITS.rows.toLocaleString()} rows. This sheet has ${data.length.toLocaleString()}.`);
	const width = Math.max(header.length, ...data.map((r) => r.length));
	const taken = new Set<string>();
	const all = Array.from({ length: width }, (_, i) => i).filter((i) => i !== keyIndex);
	const kept = all.slice(0, SHEET_LIMITS.columns);
	const columns = kept.map((i) => ({ index: i, header: (header[i] ?? "").trim() || `Column ${i + 1}`, variable: variableName(header[i] ?? "", taken, i) }));
	const rows: MergeSheet["rows"] = {};
	const invalid: SheetImport["invalid"] = [];
	const seen = new Set<string>();
	const duplicates = new Set<string>();
	data.forEach((cells, n) => {
		const email = (cells[keyIndex] ?? "").trim().toLowerCase();
		if (!EMAIL.test(email)) {
			invalid.push({ row: n + 2, value: (cells[keyIndex] ?? "").trim() });
			return;
		}
		if (seen.has(email)) duplicates.add(email);
		seen.add(email);
		rows[email] = Object.fromEntries(columns.map((c) => [c.variable, (cells[c.index] ?? "").trim().slice(0, SHEET_LIMITS.cell)]));
	});
	const sheet: MergeSheet = { name: name.slice(0, 200), importedAt, keyColumn: (header[keyIndex] ?? "").trim() || `Column ${keyIndex + 1}`, columns: columns.map(({ header, variable }) => ({ header: header.slice(0, 200), variable })), rows };
	return { sheet, total: data.length, invalid, duplicates: [...duplicates], extraColumns: all.length - kept.length };
}

export type SheetMatch = {
	rows: number;
	matched: number;
	/** Sheet addresses that are not in the receiving audience, capped at 50. */
	unmatched: string[];
	unmatchedCount: number;
	/** Receiving recipients with no sheet row. */
	withoutRow: number;
	/** Receiving recipients missing each used sheet variable (no row, or a blank cell). */
	missing: { variable: string; count: number }[];
};

export function matchSheet(sheet: MergeSheet, recipients: string[], tags: string[]): SheetMatch {
	const receiving = new Set(recipients.map((e) => e.trim().toLowerCase()));
	const keys = Object.keys(sheet.rows);
	const unmatched = keys.filter((k) => !receiving.has(k));
	const used = sheet.columns.map((c) => c.variable).filter((v) => tags.includes(v) && !isMergeTag(v));
	return {
		rows: keys.length,
		matched: keys.length - unmatched.length,
		unmatched: unmatched.slice(0, 50),
		unmatchedCount: unmatched.length,
		withoutRow: [...receiving].filter((e) => !sheet.rows[e]).length,
		missing: used.map((variable) => ({ variable, count: [...receiving].filter((e) => !sheet.rows[e]?.[variable]?.trim()).length })),
	};
}

/** A cell that spreadsheet apps would run as a formula gets a leading apostrophe. */
const csvCell = (value: string) => {
	const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
	return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
};

/**
 * The receiving audience as a sheet to fill in: Email, Name, then one column per sheet field or used field that only a
 * sheet can fill. Cells already in the sheet are kept, so the file can be edited and pasted back.
 */
export function recipientsCsv(people: { email: string; name: string }[], sheet: MergeSheet | null, tags: string[]): string {
	const columns = [...(sheet?.columns ?? [])];
	for (const tag of tags) if (!isMergeTag(tag) && !columns.some((c) => c.variable === tag)) columns.push({ header: tag, variable: tag });
	const rows = people.map((p) => {
		const row = sheet?.rows[p.email.trim().toLowerCase()] ?? {};
		return [p.email, p.name, ...columns.map((c) => row[c.variable] ?? "")];
	});
	return [["Email", "Name", ...columns.map((c) => c.header)], ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
