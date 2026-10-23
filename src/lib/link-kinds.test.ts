import { describe, expect, it } from "vitest";
import { detectLinkKind, linkKindOf } from "./link-kinds";

describe("detectLinkKind", () => {
	it.each([
		["https://docs.google.com/spreadsheets/d/abc/edit#gid=0", "sheet"],
		["https://docs.google.com/document/d/abc/edit", "doc"],
		["https://docs.google.com/presentation/d/abc/edit", "slides"],
		["https://docs.google.com/forms/d/e/abc/viewform", "form"],
		["https://forms.gle/abc123", "form"],
		["https://forms.office.com/r/abc", "form"],
		["https://drive.google.com/drive/folders/abc", "folder"],
		["https://drive.google.com/drive/u/1/folders/abc", "folder"],
		["https://ateneo0.sharepoint.com/:x:/r/sites/code/Masterfile.xlsx?d=w1", "sheet"],
		["https://ateneo0.sharepoint.com/:w:/s/code/abc", "doc"],
		["https://ateneo0.sharepoint.com/:p:/s/code/abc", "slides"],
		["https://ateneo0.sharepoint.com/:f:/s/code/abc", "folder"],
		["https://1drv.ms/x/s!abc", "sheet"],
		["https://onedrive.live.com/edit.aspx?resid=abc&app=Excel", "sheet"],
		["https://example.com/files/Masterfile.XLSX", "sheet"],
		["https://example.com/report.pdf", "doc"],
		["https://example.com/deck.pptx", "slides"],
		["https://www.youtube.com/watch?v=abc", "video"],
		["https://youtu.be/abc", "video"],
		["https://ateneo.edu/code", "site"],
		["https://docs.google.com/", "site"],
		["not a url", "site"],
	])("%s is a %s", (url, kind) => {
		expect(detectLinkKind(url)).toBe(kind);
	});
});

describe("linkKindOf", () => {
	it("prefers a stored type and detects from the URL otherwise", () => {
		expect(linkKindOf({ kind: "form", url: "https://code.link/apply" })).toBe("form");
		expect(linkKindOf({ kind: null, url: "https://docs.google.com/spreadsheets/d/abc" })).toBe("sheet");
		expect(linkKindOf({ kind: "retired", url: "https://forms.gle/x" })).toBe("form");
	});
});
