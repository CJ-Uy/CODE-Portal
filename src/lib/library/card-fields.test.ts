import { describe, expect, it } from "vitest";
import type { LibraryCard } from "@/db/repositories/library";
import { toCardFields } from "./card-fields";

const card: LibraryCard = {
	id: "lib_1",
	kind: "guide",
	format: "page",
	source: "member",
	title: "A title",
	dek: "A summary",
	authorsJson: [{ name: "Ana Reyes", memberId: "mem_secret" }, { name: "Outside Author" }],
	year: 2025,
	subtype: null,
	formatDetail: null,
	engagementType: null,
	publicReadiness: "needs_adapting",
	confidentiality: "members",
	status: "published",
	fileType: "application/pdf",
	fileCode: "ABC-1",
	tagNames: ["Goal Setting"],
	saves: 4,
};

describe("toCardFields", () => {
	it("keeps what a card shows", () => {
		expect(toCardFields(card)).toEqual({
			id: "lib_1",
			kind: "guide",
			source: "member",
			title: "A title",
			dek: "A summary",
			year: 2025,
			publicReadiness: "needs_adapting",
			confidentiality: "members",
			tagNames: ["Goal Setting"],
			saves: 4,
			authorsJson: [{ name: "Ana Reyes" }, { name: "Outside Author" }],
		});
	});

	it("never carries a member id out", () => {
		expect(JSON.stringify(toCardFields(card))).not.toContain("mem_secret");
		expect(JSON.stringify(toCardFields(card))).not.toContain("memberId");
	});

	it("leaves out file, status and facet fields", () => {
		const keys = Object.keys(toCardFields(card));
		for (const hidden of ["fileType", "fileCode", "status", "subtype", "formatDetail", "engagementType", "format"]) expect(keys).not.toContain(hidden);
	});
});
