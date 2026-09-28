import { describe, expect, it } from "vitest";
import { compareSnapshots, normalizeDefault, type DbSnapshot } from "./schema-compare";

const col = (over = {}) => ({ type: "text", notnull: 0, dflt: null as string | null, pk: 0, ...over });
const snap = (tables: DbSnapshot["tables"], indexes: DbSnapshot["indexes"] = {}): DbSnapshot => ({ tables, indexes });

describe("normalizeDefault", () => {
	it("treats sqlite boolean keywords as their integer values", () => {
		expect(normalizeDefault("false")).toBe(normalizeDefault("0"));
		expect(normalizeDefault("true")).toBe(normalizeDefault("1"));
	});

	it("strips the parentheses sqlite adds around expressions", () => {
		expect(normalizeDefault("(unixepoch() * 1000)")).toBe(normalizeDefault("unixepoch()*1000"));
	});

	it("keeps different values apart", () => {
		expect(normalizeDefault("'CODE'")).not.toBe(normalizeDefault("'other'"));
		expect(normalizeDefault(null)).toBeNull();
	});
});

describe("compareSnapshots", () => {
	it("ignores column order, which ALTER ADD COLUMN always changes", () => {
		const a = snap({ t: { cols: { x: col(), y: col() }, fks: [] } });
		const b = snap({ t: { cols: { y: col(), x: col() }, fks: [] } });
		expect(compareSnapshots(a, b)).toEqual([]);
	});

	it("reports a column present on only one side", () => {
		const a = snap({ t: { cols: { x: col() }, fks: [] } });
		const b = snap({ t: { cols: { x: col(), y: col() }, fks: [] } });
		expect(compareSnapshots(a, b).join()).toContain("t.y");
	});

	it("reports a nullability difference", () => {
		const a = snap({ t: { cols: { x: col({ notnull: 1 }) }, fks: [] } });
		const b = snap({ t: { cols: { x: col({ notnull: 0 }) }, fks: [] } });
		expect(compareSnapshots(a, b).join()).toContain("t.x");
	});

	it("reports a foreign key action difference", () => {
		const a = snap({ t: { cols: { x: col() }, fks: ["x->m.id del=SET NULL upd=NO ACTION"] } });
		const b = snap({ t: { cols: { x: col() }, fks: ["x->m.id del=CASCADE upd=NO ACTION"] } });
		expect(compareSnapshots(a, b).join()).toContain("t FKs differ");
	});

	it("reports a missing index", () => {
		const a = snap({ t: { cols: { x: col() }, fks: [] } }, {});
		const b = snap({ t: { cols: { x: col() }, fks: [] } }, { i: { table: "t", unique: 1, cols: ["x"] } });
		expect(compareSnapshots(a, b).join()).toContain("i");
	});

	it("reports a table present on only one side", () => {
		const a = snap({ t: { cols: { x: col() }, fks: [] } });
		const b = snap({});
		expect(compareSnapshots(a, b).join()).toContain("t");
	});
});
