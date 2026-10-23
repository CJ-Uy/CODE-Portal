import { describe, expect, it } from "vitest";
import { buildSheet, detectDelimiter, matchSheet, parseDelimited, parseXlsx, variableName } from "./sheet";

describe("parseDelimited", () => {
	it("reads a Google Sheets paste with a quoted multi-line cell", () => {
		const paste = 'Email\tBatch\tMessage\r\nana@x.com\t2027\t"Line one\nLine ""two"""\r\nben@x.com\t2026\tHi\r\n';
		expect(parseDelimited(paste)).toEqual([
			["Email", "Batch", "Message"],
			["ana@x.com", "2027", 'Line one\nLine "two"'],
			["ben@x.com", "2026", "Hi"],
		]);
	});
	it("reads CSV with commas inside quotes, a BOM and blank lines", () => {
		expect(parseDelimited('﻿email,note\n\na@x.com,"one, two"\n')).toEqual([["email", "note"], ["a@x.com", "one, two"]]);
	});
	it("detects tab, comma and semicolon headers", () => {
		expect(detectDelimiter("a\tb,c\n")).toBe("\t");
		expect(detectDelimiter("a,b,c")).toBe(",");
		expect(detectDelimiter("a;b;c,d")).toBe(";");
	});
});

describe("variableName", () => {
	it("slugs headers and never collides with email or another column", () => {
		const taken = new Set<string>();
		expect(variableName("Custom Message", taken, 0)).toBe("custom_message");
		expect(variableName("custom-message", taken, 1)).toBe("custom_message_2");
		expect(variableName("Email", taken, 2)).toBe("email_2");
		expect(variableName("2nd Choice", taken, 3)).toBe("col_2nd_choice");
		expect(variableName("  ", taken, 4)).toBe("column_5");
		expect(variableName("Pañuelo", taken, 5)).toBe("panuelo");
	});
});

describe("buildSheet", () => {
	const table = [
		["Name", "E-mail", "Batch", "Message"],
		["Ana", "Ana@X.com ", "2027", "Welcome back"],
		["Ben", "not an email", "2026", "Hi"],
		["Cy", "cy@x.com", "", "First"],
		["Cy again", "CY@x.com", "2025", "Second"],
	];
	it("keys rows by the email column and reports bad and repeated rows", () => {
		const result = buildSheet(table, "batch.csv", undefined, "2026-10-23T00:00:00.000Z");
		expect(result.sheet.keyColumn).toBe("E-mail");
		expect(result.sheet.columns).toEqual([
			{ header: "Name", variable: "name" },
			{ header: "Batch", variable: "batch" },
			{ header: "Message", variable: "message" },
		]);
		expect(result.sheet.rows["ana@x.com"]).toEqual({ name: "Ana", batch: "2027", message: "Welcome back" });
		expect(result.sheet.rows["cy@x.com"].message).toBe("Second");
		expect(result.invalid).toEqual([{ row: 3, value: "not an email" }]);
		expect(result.duplicates).toEqual(["cy@x.com"]);
		expect(result.total).toBe(4);
	});
	it("finds the key column by content when no header says email", () => {
		const result = buildSheet([["Who", "Address"], ["Ana", "ana@x.com"]], "paste");
		expect(result.sheet.keyColumn).toBe("Address");
	});
	it("refuses an empty sheet", () => {
		expect(() => buildSheet([], "paste")).toThrow(/empty/);
	});
});

describe("matchSheet", () => {
	it("counts matches, sheet rows outside the audience and recipients missing values", () => {
		const { sheet } = buildSheet([["email", "message"], ["a@x.com", "Hi"], ["b@x.com", ""], ["z@x.com", "Gone"]], "s");
		const match = matchSheet(sheet, ["A@x.com", "b@x.com", "c@x.com"], ["message", "first_name"]);
		expect(match).toEqual({ rows: 3, matched: 2, unmatched: ["z@x.com"], unmatchedCount: 1, withoutRow: 1, missing: [{ variable: "message", count: 2 }] });
	});
});

const crcTable = Array.from({ length: 256 }, (_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c >>> 0;
});
const crc32 = (data: Uint8Array) => (data.reduce((c, b) => crcTable[(c ^ b) & 0xff] ^ (c >>> 8), 0xffffffff) ^ 0xffffffff) >>> 0;

/** A minimal deflated zip, enough to stand in for an .xlsx written by Excel or Google Sheets. */
async function zip(files: Record<string, string>): Promise<Uint8Array> {
	const encoder = new TextEncoder();
	const locals: Uint8Array[] = [];
	const centrals: Uint8Array[] = [];
	let offset = 0;
	for (const [name, content] of Object.entries(files)) {
		const raw = encoder.encode(content);
		const stream = new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate-raw"));
		const data = new Uint8Array(await new Response(stream).arrayBuffer());
		const nameBytes = encoder.encode(name);
		const local = new Uint8Array(30 + nameBytes.length);
		const lv = new DataView(local.buffer);
		lv.setUint32(0, 0x04034b50, true); lv.setUint16(8, 8, true); lv.setUint32(14, crc32(raw), true);
		lv.setUint32(18, data.length, true); lv.setUint32(22, raw.length, true); lv.setUint16(26, nameBytes.length, true);
		local.set(nameBytes, 30);
		const central = new Uint8Array(46 + nameBytes.length);
		const cv = new DataView(central.buffer);
		cv.setUint32(0, 0x02014b50, true); cv.setUint16(10, 8, true); cv.setUint32(16, crc32(raw), true);
		cv.setUint32(20, data.length, true); cv.setUint32(24, raw.length, true); cv.setUint16(28, nameBytes.length, true); cv.setUint32(42, offset, true);
		central.set(nameBytes, 46);
		locals.push(local, data);
		centrals.push(central);
		offset += local.length + data.length;
	}
	const size = centrals.reduce((n, c) => n + c.length, 0);
	const end = new Uint8Array(22);
	const ev = new DataView(end.buffer);
	ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, centrals.length, true); ev.setUint16(10, centrals.length, true);
	ev.setUint32(12, size, true); ev.setUint32(16, offset, true);
	const parts = [...locals, ...centrals, end];
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let at = 0;
	for (const part of parts) { out.set(part, at); at += part.length; }
	return out;
}

describe("parseXlsx", () => {
	it("reads shared, inline, rich-text, boolean and numeric cells from the first sheet, keeping gaps", async () => {
		const bytes = await zip({
			"[Content_Types].xml": "<Types/>",
			"xl/workbook.xml": '<workbook><sheets><sheet name="People" sheetId="1" r:id="rId7"/></sheets></workbook>',
			"xl/_rels/workbook.xml.rels": '<Relationships><Relationship Id="rId7" Type="worksheet" Target="worksheets/people.xml"/></Relationships>',
			"xl/sharedStrings.xml": '<sst><si><t>Email</t></si><si><t>Message</t></si><si><r><t>Hello </t></r><r><rPr/><t xml:space="preserve">&amp; welcome</t></r></si></sst>',
			"xl/worksheets/people.xml":
				'<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="inlineStr"><is><t>Paid</t></is></c><c r="D1" t="str"><v>Year</v></c></row>' +
				'<row r="2"><c r="A2" t="inlineStr"><is><t>ana@x.com</t></is></c><c r="B2" t="s"><v>2</v></c><c r="C2" t="b"><v>1</v></c><c r="D2"><v>2027</v></c></row>' +
				'<row r="4"><c r="A4" t="inlineStr"><is><t>ben@x.com</t></is></c><c r="D4" s="2"><v>2026</v></c></row></sheetData></worksheet>',
			"xl/worksheets/sheet1.xml": "<worksheet><sheetData><row><c><v>wrong sheet</v></c></row></sheetData></worksheet>",
		});
		expect(await parseXlsx(bytes)).toEqual([
			["Email", "Message", "Paid", "Year"],
			["ana@x.com", "Hello & welcome", "TRUE", "2027"],
			["ben@x.com", "", "", "2026"],
		]);
	});
	it("rejects a file that is not a zip", async () => {
		await expect(parseXlsx(new TextEncoder().encode("email,name\n"))).rejects.toThrow(/not a valid \.xlsx/);
	});
});
